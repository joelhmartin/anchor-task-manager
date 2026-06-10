/**
 * aiTemplateStore.js — CRUD for AI web-report templates and approved versions.
 *
 * Templates with engine='ai_web' are managed here; legacy widget-canvas templates
 * live in templateStore.js. The two systems coexist on the same report_templates table
 * differentiated by the `engine` column.
 */

import { query } from '../../db.js';
import { decryptJson, encryptJson } from './payloadCrypto.js';
import { REPORT_OUTPUT_SCHEMA_VERSION, sha256Json } from './reportProtocol.js';

const TEMPLATE_DESIGN_MODEL =
  process.env.AI_REPORT_TEMPLATE_MODEL ||
  process.env.VERTEX_REPORT_MODEL ||
  process.env.VERTEX_MODEL ||
  'gemini-2.5-pro';

// scope: 'active' (status='approved' AND is_archived=false)
//      | 'drafts' (status='draft' AND is_archived=false)
//      | 'trash'  (is_archived=true, any status)
//      | 'all'    (no filter)
// includeArchived (legacy compat): when true and scope omitted, also returns archived rows.
export async function listAiTemplates({ scope, includeArchived = false } = {}) {
  const where = ["engine = 'ai_web'"];

  if (scope === 'active') {
    where.push("status = 'approved'", 'is_archived = false');
  } else if (scope === 'drafts') {
    where.push("status = 'draft'", 'is_archived = false');
  } else if (scope === 'trash') {
    where.push('is_archived = true');
  } else if (!includeArchived) {
    where.push('is_archived = false');
  }

  const { rows } = await query(
    `SELECT id, name, description, status, prompt, data_scope, style_recipe,
            approved_version_id, schedule, next_run_at, default_client_id,
            enabled, is_archived, created_at, updated_at
       FROM report_templates
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC`
  );
  return rows;
}

export async function getAiTemplate(id) {
  const { rows } = await query(
    `SELECT * FROM report_templates WHERE id = $1 AND engine = 'ai_web'`,
    [id]
  );
  return rows[0] || null;
}

export async function createAiTemplate({ name, description, prompt, dataScope, styleRecipe, defaultClientId, createdBy }) {
  const { rows } = await query(
    `INSERT INTO report_templates
      (engine, name, description, layout, filters_default, prompt, data_scope, style_recipe,
       default_client_id, status, is_archived, created_by)
     VALUES ('ai_web', $1, $2, '[]'::jsonb, '{}'::jsonb, $3, $4, $5, $6, 'draft', false, $7)
     RETURNING *`,
    [
      name,
      description || null,
      prompt || '',
      dataScope || {},
      styleRecipe || {},
      defaultClientId || null,
      createdBy || null
    ]
  );
  return rows[0];
}

export async function updateAiTemplate(id, patch) {
  const fields = [];
  const params = [];
  let i = 1;
  const columnMap = {
    name: patch.name,
    description: patch.description,
    prompt: patch.prompt,
    data_scope: patch.dataScope,
    style_recipe: patch.styleRecipe,
    default_client_id: patch.defaultClientId,
    schedule: patch.schedule,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : undefined,
    is_archived: typeof patch.isArchived === 'boolean' ? patch.isArchived : undefined
  };
  for (const [col, val] of Object.entries(columnMap)) {
    if (val !== undefined) {
      fields.push(`${col} = $${i++}`);
      params.push(val);
    }
  }
  if (!fields.length) return getAiTemplate(id);
  params.push(id);
  const { rows } = await query(
    `UPDATE report_templates SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${i} AND engine = 'ai_web' RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function approveTemplateVersion({ templateId, modelName, approvedRunItemId, approvedBy }) {
  const tpl = await getAiTemplate(templateId);
  if (!tpl) throw new Error('Template not found');
  if (!approvedRunItemId) throw new Error('approvedRunItemId is required; run a successful test report before approval');

  const { rows: testRows } = await query(
    `SELECT
       i.id,
       i.status,
       i.data_snapshot,
       i.ai_output,
       i.rendered_payload,
       i.render_hash,
       r.template_id,
       r.source
     FROM report_run_items i
     JOIN report_runs r ON r.id = i.run_id
     WHERE i.id = $1
     LIMIT 1`,
    [approvedRunItemId]
  );
  const testItem = testRows[0];
  if (!testItem || testItem.template_id !== templateId || testItem.source !== 'test') {
    throw new Error('Approved example must come from a test run for this template');
  }
  if (testItem.status !== 'complete') {
    throw new Error('Approved example test run is not complete');
  }

  const approvedDataSnapshot = decryptJson(testItem.data_snapshot);
  const approvedAiOutput = decryptJson(testItem.ai_output);
  const approvedRenderedPayload = decryptJson(testItem.rendered_payload);
  if (!approvedDataSnapshot || !approvedAiOutput || !approvedRenderedPayload) {
    throw new Error('Approved example payload could not be decrypted');
  }

  const { rows: versionRows } = await query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM ai_report_template_versions WHERE template_id = $1`,
    [templateId]
  );
  const nextVersion = versionRows[0].next_version;

  const { rows } = await query(
    `INSERT INTO ai_report_template_versions
      (template_id, version, prompt, data_scope, style_recipe, model_name,
       approved_example_output, approved_by, approved_run_item_id,
       approved_data_snapshot, approved_ai_output, approved_rendered_payload,
       prompt_hash, blueprint_hash, data_package_schema_version,
       output_schema_version, model_params)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      templateId,
      nextVersion,
      tpl.prompt,
      tpl.data_scope,
      tpl.style_recipe,
      modelName || tpl.style_recipe?.model_name || tpl.style_recipe?.modelName || TEMPLATE_DESIGN_MODEL,
      {
        run_item_id: testItem.id,
        title: approvedRenderedPayload.title || approvedAiOutput.title || tpl.name,
        section_count: Array.isArray(approvedRenderedPayload.sections) ? approvedRenderedPayload.sections.length : 0,
        render_hash: testItem.render_hash || null,
        approved_at: new Date().toISOString()
      },
      approvedBy || null,
      testItem.id,
      encryptJson(approvedDataSnapshot),
      encryptJson(approvedAiOutput),
      encryptJson(approvedRenderedPayload),
      sha256Json({
        prompt: tpl.prompt,
        data_scope: tpl.data_scope,
        style_recipe: tpl.style_recipe
      }),
      sha256Json(approvedAiOutput),
      approvedDataSnapshot.schema_version || null,
      REPORT_OUTPUT_SCHEMA_VERSION,
      {
        temperature: 0.1,
        topP: 0.8,
        candidateCount: 1,
        responseSchemaVersion: REPORT_OUTPUT_SCHEMA_VERSION
      }
    ]
  );

  const newVersion = rows[0];

  await query(
    `UPDATE report_templates
        SET approved_version_id = $1, status = 'approved', updated_at = NOW()
      WHERE id = $2`,
    [newVersion.id, templateId]
  );

  return newVersion;
}

export async function getApprovedVersion(versionId) {
  const { rows } = await query(
    `SELECT * FROM ai_report_template_versions WHERE id = $1`,
    [versionId]
  );
  return rows[0] || null;
}
