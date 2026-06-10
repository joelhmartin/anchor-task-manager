/**
 * aiRunExecutor.js — Orchestrates a single AI web-report run.
 *
 * Flow:
 *   startRun() → INSERT report_runs + report_run_items → fire-and-forget processRun()
 *   processRun() → concurrent fanout (PER_RUN_CONCURRENCY=2) over client IDs
 *   processItem() → buildDataPackage → generateAiWebReport → buildRenderedPayload
 *                   → UPDATE report_run_items with snapshot + ai_output + rendered_payload + render_hash
 *
 * The caller of startRun() gets the run row back immediately and polls /runs/:id for status.
 *
 * HIPAA note: No PHI is logged. Error messages are truncated to 1000 chars.
 */

import { query } from '../../db.js';
import { buildDataPackage } from './dataPackage.js';
import { generateAiWebReport } from './aiWebReportGenerator.js';
import { buildRenderedPayload, computeRenderHash } from './webReportRenderer.js';
import { getApprovedVersion } from './aiTemplateStore.js';
import { resolveAudience } from './audienceResolver.js';
import { encryptJson } from './payloadCrypto.js';
import { logSecurityEvent, SecurityEventCategories } from '../security/audit.js';

const PER_RUN_CONCURRENCY = 2;
const TEMPLATE_DESIGN_MODEL =
  process.env.AI_REPORT_TEMPLATE_MODEL ||
  process.env.VERTEX_REPORT_MODEL ||
  process.env.VERTEX_MODEL ||
  'gemini-2.5-pro';

function assertDateRange(dateRange) {
  if (!dateRange?.from || !dateRange?.to) {
    throw new Error('dateRange.from/to required (YYYY-MM-DD)');
  }
  const from = new Date(dateRange.from);
  const to = new Date(dateRange.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('dateRange.from/to must be valid dates');
  }
  if (from > to) {
    throw new Error('dateRange.from must be before or equal to dateRange.to');
  }
}

/**
 * Start a report run. Returns the inserted run row immediately; processing
 * happens asynchronously in the background.
 *
 * @param {object} opts
 * @param {string} opts.templateId       - UUID of the report_templates row (engine='ai_web')
 * @param {string} opts.source           - 'test' | 'manual' | 'scheduled'
 * @param {object} [opts.audienceFilter] - ignored when source='test'
 * @param {object} opts.dateRange        - { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * @param {string|null} [opts.createdBy] - user UUID or null
 * @param {string} [opts.testClientId]   - required when source='test'
 * @returns {Promise<object>} the inserted report_runs row
 */
export async function startRun({ templateId, source, audienceFilter, dateRange, createdBy, testClientId }) {
  assertDateRange(dateRange);

  let templateVersionId = null;
  let prompt;
  let dataScope;
  let styleRecipe;
  let modelName;

  // Common gate: archived or disabled templates can't be run via any path.
  // Test runs are allowed for disabled templates so admins can iterate on a
  // draft without re-enabling, but archived templates are off limits.
  const { rows: gateRows } = await query(
    `SELECT enabled, is_archived FROM report_templates WHERE id = $1 AND engine = 'ai_web'`,
    [templateId]
  );
  if (!gateRows[0]) throw new Error('Template not found');
  if (gateRows[0].is_archived) throw new Error('Template is archived; restore it before running');
  if (source !== 'test' && gateRows[0].enabled === false) {
    throw new Error('Template is disabled; enable it before running');
  }

  if (source === 'test') {
    // Test runs use the live draft template — no approved version needed.
    const { rows } = await query(
      `SELECT prompt, data_scope, style_recipe FROM report_templates WHERE id = $1 AND engine = 'ai_web'`,
      [templateId]
    );
    if (!rows[0]) throw new Error('Template not found');
    prompt = rows[0].prompt;
    dataScope = rows[0].data_scope;
    styleRecipe = rows[0].style_recipe || {};
    modelName = styleRecipe.model_name || styleRecipe.modelName || TEMPLATE_DESIGN_MODEL;
  } else {
    // Production runs require an approved version.
    const { rows } = await query(
      `SELECT approved_version_id FROM report_templates WHERE id = $1 AND engine = 'ai_web'`,
      [templateId]
    );
    const approvedId = rows[0]?.approved_version_id;
    if (!approvedId) throw new Error('Template has no approved version; cannot run');
    const v = await getApprovedVersion(approvedId);
    if (!v) throw new Error('Approved version record not found');
    templateVersionId = v.id;
    prompt = v.prompt;
    dataScope = v.data_scope;
    styleRecipe = v.style_recipe;
    modelName = v.model_name;
  }

  const clientIds = source === 'test'
    ? [testClientId]
    : await resolveAudience(audienceFilter);

  if (!clientIds.length) throw new Error('Audience resolved to zero clients');
  await assertClientAudience(clientIds);

  const { rows: runRows } = await query(
    `INSERT INTO report_runs
      (template_id, template_version_id, source, audience_filter,
       selected_client_ids, status, date_range, created_by)
     VALUES ($1, $2, $3, $4, $5, 'running', $6, $7)
     RETURNING *`,
    [
      templateId,
      templateVersionId,
      source,
      audienceFilter || {},
      clientIds,
      dateRange || {},
      createdBy || null
    ]
  );
  const run = runRows[0];

  // Pre-insert run items so the UI can poll status immediately.
  for (const cid of clientIds) {
    await query(
      `INSERT INTO report_run_items (run_id, client_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (run_id, client_id) DO NOTHING`,
      [run.id, cid]
    );
  }

  // Fire and forget — caller polls /runs/:id for progress.
  processRun(run, { prompt, dataScope, styleRecipe, modelName, dateRange })
    .catch((err) => console.error('[aiRunExecutor] run failed:', run.id, err.message));

  return run;
}

async function assertClientAudience(clientIds) {
  const ids = Array.from(new Set(clientIds || []));
  const { rows } = await query(
    `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role = 'client'`,
    [ids]
  );
  if (rows.length !== ids.length) {
    throw new Error('Report runs can only target users with role client');
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function processRun(run, ctx) {
  const pending = run.selected_client_ids.slice();
  let inFlight = 0;
  let anyFailed = false;

  await new Promise((resolve) => {
    const tick = () => {
      while (inFlight < PER_RUN_CONCURRENCY && pending.length) {
        const clientId = pending.shift();
        inFlight++;
        processItem(run, clientId, ctx)
          .catch(() => { anyFailed = true; })
          .finally(() => {
            inFlight--;
            if (!pending.length && inFlight === 0) resolve();
            else tick();
          });
      }
      // Handle edge case: nothing was started (empty list after all shifts)
      if (!pending.length && inFlight === 0) resolve();
    };
    tick();
  });

  const finalStatus = await computeFinalRunStatus(run.id, anyFailed);
  await query(
    `UPDATE report_runs SET status = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [finalStatus, run.id]
  );
}

async function computeFinalRunStatus(runId, anyFailed = false) {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'complete')::int AS complete,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status IN ('pending','running'))::int AS unfinished
     FROM report_run_items
     WHERE run_id = $1`,
    [runId]
  );
  const row = rows[0] || {};
  if ((row.unfinished || 0) > 0) return 'partial';
  if ((row.complete || 0) > 0 && ((row.failed || 0) > 0 || anyFailed)) return 'partial';
  if ((row.complete || 0) > 0) return 'complete';
  return 'failed';
}

export async function recoverInterruptedRuns({ olderThanMinutes = 180 } = {}) {
  const interval = `${Math.max(30, Number(olderThanMinutes) || 180)} minutes`;
  await query(
    `UPDATE report_run_items
        SET status = 'failed',
            error_message = COALESCE(error_message, 'Run was interrupted before completion. Please retry.'),
            updated_at = NOW()
      WHERE status IN ('pending','running')
        AND updated_at < NOW() - $1::interval`,
    [interval]
  );

  const { rows } = await query(
    `SELECT id
       FROM report_runs
      WHERE status IN ('pending','running')
        AND updated_at < NOW() - $1::interval`,
    [interval]
  );
  for (const row of rows) {
    const finalStatus = await computeFinalRunStatus(row.id, true);
    await query(
      `UPDATE report_runs
          SET status = $1,
              error_message = COALESCE(error_message, 'Run was interrupted before completion. Please retry.'),
              completed_at = COALESCE(completed_at, NOW()),
              updated_at = NOW()
        WHERE id = $2`,
      [finalStatus, row.id]
    );
  }
  return { recoveredRuns: rows.length };
}

/**
 * Publish a completed run item as a documents row and link it back.
 * Only called for non-test runs.
 *
 * @param {object} opts
 * @param {string} opts.runItemId
 * @param {string} opts.clientId
 * @param {object|null} opts.payload  - already-decrypted rendered payload object
 * @param {string|null} opts.createdBy
 * @param {string} opts.runId         - parent run UUID (for audit log)
 */
async function publishItem({ runItemId, clientId, payload, createdBy, runId }) {
  const title = payload?.title || 'Report';
  const metaRes = await query(
    `SELECT rt.name AS template_name
       FROM report_runs rr
       LEFT JOIN report_templates rt ON rt.id = rr.template_id
      WHERE rr.id = $1`,
    [runId]
  );
  const label = metaRes.rows[0]?.template_name || title;
  const url = `/portal/reports/${runItemId}`;
  const docRes = await query(
    `INSERT INTO documents (user_id, label, name, url, origin, type, review_status, created_by)
     VALUES ($1, $2, $3, $4, 'admin', 'report', 'none', $5)
     RETURNING id`,
    [clientId, label, title, url, createdBy]
  );
  await query(
    `UPDATE report_run_items
        SET document_id = $1, published_at = NOW(), updated_at = NOW()
      WHERE id = $2`,
    [docRes.rows[0].id, runItemId]
  );

  // Immutable audit trail — HIPAA requires logging every access/generation of
  // data that may contain client information.
  await logSecurityEvent({
    userId: createdBy,
    eventType: 'report_generated',
    eventCategory: SecurityEventCategories.ACCESS,
    success: true,
    details: { runItemId, clientId, runId }
  });
}

async function processItem(run, clientId, ctx) {
  await query(
    `UPDATE report_run_items SET status = 'running', updated_at = NOW()
      WHERE run_id = $1 AND client_id = $2`,
    [run.id, clientId]
  );

  try {
    const dataPackage = await buildDataPackage({
      clientId,
      dateRange: ctx.dateRange,
      dataScope: ctx.dataScope
    });

    const aiOutput = await generateAiWebReport({
      prompt: ctx.prompt,
      dataPackage,
      styleRecipe: ctx.styleRecipe,
      modelName: ctx.modelName
    });

    const renderedPayload = buildRenderedPayload({ aiOutput, dataPackage });

    const renderHash = computeRenderHash({
      templateVersionId: run.template_version_id,
      dataPackage,
      aiOutput
    });

    // Encrypt all three PHI-bearing columns before persisting.
    // encryptJson throws if ENCRYPTION_KEY is unavailable — that is intentional;
    // we must never store these payloads as cleartext.
    await query(
      `UPDATE report_run_items
          SET status = 'complete',
              data_snapshot = $1,
              ai_output = $2,
              rendered_payload = $3,
              render_hash = $4,
              updated_at = NOW()
        WHERE run_id = $5 AND client_id = $6`,
      [
        encryptJson(dataPackage),
        encryptJson(aiOutput),
        encryptJson(renderedPayload),
        renderHash,
        run.id,
        clientId
      ]
    );

    // Publish to documents (skip for test runs — no stable document needed).
    // Pass the in-memory renderedPayload rather than re-fetching + decrypting.
    if (run.source !== 'test') {
      const idRes = await query(
        `SELECT id FROM report_run_items WHERE run_id = $1 AND client_id = $2`,
        [run.id, clientId]
      );
      if (idRes.rows[0]) {
        await publishItem({
          runItemId: idRes.rows[0].id,
          clientId,
          payload: renderedPayload,   // already in memory — no decrypt round-trip needed
          createdBy: run.created_by,
          runId: run.id
        });
      }
    }
  } catch (err) {
    await query(
      `UPDATE report_run_items
          SET status = 'failed',
              error_message = $1,
              updated_at = NOW()
        WHERE run_id = $2 AND client_id = $3`,
      [String(err.message || err).slice(0, 1000), run.id, clientId]
    );
    throw err;
  }
}
