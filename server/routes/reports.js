import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isStaff } from '../middleware/roles.js';
import { query } from '../db.js';
import {
  listAiTemplates, getAiTemplate, createAiTemplate, updateAiTemplate,
  approveTemplateVersion
} from '../services/reports/aiTemplateStore.js';
import { startRun } from '../services/reports/aiRunExecutor.js';
import { decryptJson } from '../services/reports/payloadCrypto.js';
import { logSecurityEvent, SecurityEventCategories } from '../services/security/audit.js';

const router = express.Router();

// Portal-scoped report fetch — clients view their own snapshots.
// Registered BEFORE the staff guard so client/team-member roles can hit it.
router.get('/portal/items/:id', requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT id, client_id, run_id, status, rendered_payload, schema_version, published_at
         FROM report_run_items WHERE id = $1`,
      [req.params.id]
    );
    const item = r.rows[0];
    if (!item) return res.status(404).json({ error: 'not found' });
    const role = req.user?.role;
    const isStaffRole = role === 'superadmin' || role === 'admin' || role === 'team';
    const portalUserId = req.portalUserId || req.user?.id;
    if (!isStaffRole && item.client_id !== portalUserId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (item.status !== 'complete') {
      return res.status(409).json({ error: 'not ready' });
    }

    // Decrypt before returning — never send ciphertext to the client.
    const decryptedPayload = decryptJson(item.rendered_payload);

    // Immutable audit trail for every report view (HIPAA / SOC2).
    await logSecurityEvent({
      userId: req.user.id,
      eventType: 'report_viewed_portal',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { runItemId: item.id, clientId: item.client_id, viewerRole: role }
    });

    res.json({ item: { ...item, rendered_payload: decryptedPayload } });
  } catch (err) {
    console.error('[reports] portal item fetch:', err);
    res.status(500).json({ error: 'failed' });
  }
});

router.use(requireAuth, isStaff);

// ---- AI web-report templates ----

router.get('/ai-templates', async (req, res) => {
  try {
    const allowedScopes = new Set(['active', 'drafts', 'trash', 'all']);
    const scope = allowedScopes.has(req.query.scope) ? req.query.scope : undefined;
    const rows = await listAiTemplates({
      scope,
      includeArchived: req.query.archived === '1'
    });
    res.json({ templates: rows });
  } catch (err) {
    console.error('[reports] list ai-templates:', err);
    res.status(500).json({ error: 'failed to list templates' });
  }
});

router.get('/ai-templates/:id', async (req, res) => {
  try {
    const tpl = await getAiTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'not found' });
    res.json({ template: tpl });
  } catch (err) {
    console.error('[reports] get ai-template:', err);
    res.status(500).json({ error: 'failed to load template' });
  }
});

router.post('/ai-templates', async (req, res) => {
  const { name, description, prompt, dataScope, styleRecipe, defaultClientId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const tpl = await createAiTemplate({
      name, description, prompt, dataScope, styleRecipe, defaultClientId,
      createdBy: req.user.id
    });
    res.status(201).json({ template: tpl });
  } catch (err) {
    console.error('[reports] create ai-template:', err);
    res.status(500).json({ error: 'failed to create template' });
  }
});

router.patch('/ai-templates/:id', async (req, res) => {
  try {
    const tpl = await updateAiTemplate(req.params.id, req.body || {});
    if (!tpl) return res.status(404).json({ error: 'not found' });
    res.json({ template: tpl });
  } catch (err) {
    console.error('[reports] update ai-template:', err);
    res.status(500).json({ error: 'failed to update template' });
  }
});

router.post('/ai-templates/:id/test-run', async (req, res) => {
  const { clientId, dateRange } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  if (!dateRange?.from || !dateRange?.to) {
    return res.status(400).json({ error: 'dateRange.from/to required (YYYY-MM-DD)' });
  }
  try {
    const run = await startRun({
      templateId: req.params.id,
      source: 'test',
      testClientId: clientId,
      dateRange,
      createdBy: req.user.id
    });
    res.status(202).json({ run });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/ai-templates/:id/approve', async (req, res) => {
  try {
    const v = await approveTemplateVersion({
      templateId: req.params.id,
      modelName: req.body?.modelName,
      approvedRunItemId: req.body?.approvedRunItemId,
      approvedBy: req.user.id
    });
    res.json({ version: v });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Runs ----

router.post('/runs', async (req, res) => {
  const { templateId, audienceFilter, dateRange } = req.body || {};
  if (!templateId) return res.status(400).json({ error: 'templateId required' });
  if (!dateRange?.from || !dateRange?.to) {
    return res.status(400).json({ error: 'dateRange.from/to required (YYYY-MM-DD)' });
  }
  try {
    const run = await startRun({
      templateId,
      source: 'manual',
      audienceFilter: audienceFilter || { mode: 'all' },
      dateRange,
      createdBy: req.user.id
    });
    res.status(202).json({ run });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/runs/:id', async (req, res) => {
  try {
    const r = await query(`SELECT * FROM report_runs WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const items = await query(
      `SELECT id, client_id, status, error_message, document_id, published_at
         FROM report_run_items WHERE run_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    res.json({ run: r.rows[0], items: items.rows });
  } catch (err) {
    console.error('[reports] get run:', err);
    res.status(500).json({ error: 'failed' });
  }
});

router.get('/run-items/:id', async (req, res) => {
  try {
    const r = await query(`SELECT * FROM report_run_items WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const row = r.rows[0];

    // Decrypt all three PHI-bearing columns before returning to staff.
    const item = {
      ...row,
      data_snapshot:    decryptJson(row.data_snapshot),
      ai_output:        decryptJson(row.ai_output),
      rendered_payload: decryptJson(row.rendered_payload)
    };

    // Immutable audit trail for every admin access (HIPAA / SOC2).
    await logSecurityEvent({
      userId: req.user.id,
      eventType: 'report_viewed_admin',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { runItemId: row.id, clientId: row.client_id }
    });

    res.json({ item });
  } catch (err) {
    console.error('[reports] get run-item:', err);
    res.status(500).json({ error: 'failed' });
  }
});

router.get('/client/:clientId/items', async (req, res) => {
  try {
    const r = await query(
      `SELECT id, run_id, status, published_at, document_id, created_at
         FROM report_run_items
        WHERE client_id = $1 AND status = 'complete'
        ORDER BY published_at DESC NULLS LAST, created_at DESC
        LIMIT 100`,
      [req.params.clientId]
    );
    res.json({ items: r.rows });
  } catch (err) {
    console.error('[reports] list client items:', err);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
