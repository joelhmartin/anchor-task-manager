/**
 * dataPackage.js — Deterministic data assembler for AI web reports
 *
 * Builds a structured, PHI-safe snapshot of a client's performance data
 * for use as Vertex AI context. Only aggregates and KPI rollups are included;
 * no individual lead rows, caller names, phone numbers, or transcripts.
 *
 * HIPAA note: This file must NEVER log or include PHI. Reviews are the only
 * source with potential PII (reviewer names); those are explicitly redacted below.
 */

import { query } from '../../db.js';
import { activeOnly } from '../queryHelpers.js';
import { fetchUnifiedAnalytics } from '../analytics/index.js';
import { clientLabelJoins } from '../clientLabel.js';

export const SCHEMA_VERSION = 1;

// Phone-like pattern for redaction in review comments
const PHONE_PATTERN = /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/**
 * Compute the comparison window (same length, immediately preceding from).
 * @param {string} from - YYYY-MM-DD
 * @param {string} to   - YYYY-MM-DD
 * @returns {{ comparison_from: string, comparison_to: string }}
 */
function computePeriod(from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  // Window length in days (inclusive)
  const windowMs = toDate.getTime() - fromDate.getTime();
  const windowDays = Math.round(windowMs / 86400000) + 1;

  const compTo = new Date(fromDate.getTime() - 86400000); // day before from
  const compFrom = new Date(compTo.getTime() - (windowDays - 1) * 86400000);

  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    comparison_from: fmt(compFrom),
    comparison_to: fmt(compTo),
  };
}

/**
 * Redact a review comment: remove phone-like patterns, truncate to 240 chars.
 * @param {string|null} text
 * @returns {string|null}
 */
function redactComment(text) {
  if (!text) return null;
  return text
    .replace(PHONE_PATTERN, '[REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED]')
    .slice(0, 240);
}

/**
 * Fetch client metadata from users + client_profiles + brand_assets.
 * Throws if the client user is not found.
 * @param {string} clientId
 */
async function fetchClientInfo(clientId) {
  const { rows } = await query(
    // PHI-safe: this row is forwarded to the AI report generator. We deliberately
    // do NOT fall back to u.email here — that would leak contact PHI into prompts.
    // Business identifiers only (client_identifier_value / brand_assets.business_name),
    // with a generic placeholder as last resort.
    `SELECT
       u.id,
       (u.first_name || ' ' || u.last_name) AS name,
       cp.client_package,
       cp.client_type,
       cp.task_board_id,
       COALESCE(
         NULLIF(TRIM(cp.client_identifier_value), ''),
         NULLIF(TRIM(ba.business_name), ''),
         'Client ' || LEFT(u.id::text, 8)
       ) AS business_name
     FROM users u
     ${clientLabelJoins()}
     WHERE u.id = $1
     LIMIT 1`,
    [clientId]
  );
  if (!rows.length) {
    throw new Error(`Client not found: ${clientId}`);
  }
  return rows[0];
}

/**
 * Fetch review aggregates + recent redacted reviews for a client.
 * @param {string} clientId
 * @param {string} from - YYYY-MM-DD
 * @param {string} to   - YYYY-MM-DD
 */
async function fetchReviewsData(clientId, from, to) {
  const aggRes = await query(
    `SELECT
       COUNT(*)::int AS count,
       ROUND(AVG(rating)::numeric, 2)::float AS avg_rating
     FROM reviews
     WHERE client_id = $1
       AND review_created_at >= $2::date
       AND review_created_at <  ($3::date + INTERVAL '1 day')`,
    [clientId, from, to]
  );

  const recentRes = await query(
    `SELECT rating, review_text, review_created_at
     FROM reviews
     WHERE client_id = $1
       AND review_created_at >= $2::date
       AND review_created_at <  ($3::date + INTERVAL '1 day')
     ORDER BY review_created_at DESC
     LIMIT 20`,
    [clientId, from, to]
  );

  const agg = aggRes.rows[0];
  return {
    count: agg.count ?? 0,
    avg_rating: agg.avg_rating ?? null,
    recent: recentRes.rows.map((r) => ({
      rating: r.rating,
      comment: redactComment(r.review_text),
      created_at: r.review_created_at,
    })),
  };
}

/**
 * Fetch task counts for a client (completed vs open) in the period.
 * Uses client_profiles.task_board_id to scope to the client's board,
 * then navigates board → groups → items.
 * @param {string} taskBoardId - may be null if no board configured
 * @param {string} from - YYYY-MM-DD
 * @param {string} to   - YYYY-MM-DD
 */
async function fetchTasksData(taskBoardId, from, to) {
  if (!taskBoardId) {
    return { completed: 0, open: 0 };
  }

  const res = await query(
    `SELECT
       COUNT(*) FILTER (WHERE ti.status = 'Done' OR ti.status = 'Complete' OR ti.status = 'Completed')::int AS completed,
       COUNT(*) FILTER (WHERE ti.status IS DISTINCT FROM 'Done' AND ti.status IS DISTINCT FROM 'Complete' AND ti.status IS DISTINCT FROM 'Completed' AND ${activeOnly('ti')})::int AS open
     FROM task_items ti
     JOIN task_groups tg ON tg.id = ti.group_id
     WHERE tg.board_id = $1
       AND ti.updated_at >= $2::date
       AND ti.updated_at <  ($3::date + INTERVAL '1 day')`,
    [taskBoardId, from, to]
  );

  const row = res.rows[0] || { completed: 0, open: 0 };
  return {
    completed: row.completed ?? 0,
    open: row.open ?? 0,
  };
}

/**
 * Build a deterministic, PHI-safe data package for AI web report generation.
 *
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {{ from: string, to: string }} opts.dateRange  - YYYY-MM-DD
 * @param {{ include?: string[] }} [opts.dataScope]
 * @returns {Promise<object>} Structured data package
 */
export async function buildDataPackage({ clientId, dateRange, dataScope }) {
  const include = (dataScope?.include?.length ? dataScope.include : ['analytics', 'reviews', 'tasks']);
  if (!dateRange?.from || !dateRange?.to) {
    throw new Error('dateRange.from/to required (YYYY-MM-DD)');
  }
  const { from, to } = dateRange;

  const { comparison_from, comparison_to } = computePeriod(from, to);
  const sources_included = [];
  const unavailable_sources = [];
  const errors = [];

  // ── Client info (required) ───────────────────────────────────────────────
  const clientInfo = await fetchClientInfo(clientId);

  const pkg = {
    schema_version: SCHEMA_VERSION,
    client: {
      id: clientInfo.id,
      name: clientInfo.name,
      business_name: clientInfo.business_name,
      package: clientInfo.client_package ?? null,
      client_type: clientInfo.client_type ?? null,
    },
    period: {
      from,
      to,
      comparison_from,
      comparison_to,
    },
    sources_included,
    notes: {
      unavailable_sources,
      errors,
    },
  };

  // ── Analytics ─────────────────────────────────────────────────────────────
  if (include.includes('analytics')) {
    try {
      // fetchUnifiedAnalytics expects userId; for clients, userId === clientId.
      const result = await fetchUnifiedAnalytics(clientId, from, to);

      // Surface adapter errors from the analytics layer.
      // Partial failures (e.g. Google Ads adapter down, GA4 succeeded) are pushed
      // to both errors[] and unavailable_sources[] so the AI layer knows which
      // platforms are missing from the data package.
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        for (const e of result.errors) {
          errors.push({ source: 'analytics', detail: e });
          unavailable_sources.push({ source: e.scope, reason: e.message });
        }
      }

      pkg.kpis = result.kpis ?? null;

      // Rename camelCase byPlatform → snake_case by_platform for consistency
      const bp = result.byPlatform ?? {};
      pkg.by_platform = {
        ga4: bp.ga4 ?? null,
        google_ads: bp.googleAds ?? null,
        meta_ads: bp.metaAds ?? null,
        ctm: bp.ctm ?? null,
      };

      pkg.time_series = result.timeSeries ?? [];

      sources_included.push('analytics');
    } catch (err) {
      errors.push({ source: 'analytics', reason: err.message });
      unavailable_sources.push({ source: 'analytics', reason: err.message });
    }
  }

  // ── Reviews ──────────────────────────────────────────────────────────────
  if (include.includes('reviews')) {
    try {
      pkg.reviews = await fetchReviewsData(clientId, from, to);
      sources_included.push('reviews');
    } catch (err) {
      errors.push({ source: 'reviews', reason: err.message });
      unavailable_sources.push({ source: 'reviews', reason: err.message });
    }
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  // Scoping: client_profiles.task_board_id → task_items.board_id.
  // The plan referenced task_workspaces.client_id, but that column doesn't exist
  // in the schema. Workspace-level client scoping is encoded via client_profiles.
  if (include.includes('tasks')) {
    try {
      pkg.tasks = await fetchTasksData(clientInfo.task_board_id, from, to);
      sources_included.push('tasks');
    } catch (err) {
      errors.push({ source: 'tasks', reason: err.message });
      unavailable_sources.push({ source: 'tasks', reason: err.message });
    }
  }

  // ── HIPAA guardrail (defense-in-depth) ─────────────────────────────────────
  // For medical clients, scrub any free-text fields that could carry PHI even
  // if a future code change accidentally introduces per-patient detail.
  // The actual data sources above should never include per-lead data, but this
  // final pass ensures we can never accidentally ship raw text to the AI layer
  // or into the encrypted snapshot for a medical client.
  if (pkg.client?.client_type === 'medical') {
    if (pkg.reviews) {
      pkg.reviews.recent = (pkg.reviews.recent || []).map((r) => ({
        rating: r.rating,
        created_at: r.created_at
        // intentionally drop comment / review_text for medical clients
      }));
    }
    // Drop any lead or activity arrays a future change might introduce.
    delete pkg.lead_activity;
    delete pkg.leads;
  }

  return pkg;
}
