/**
 * Forms API Routes
 *
 * Handles form CRUD, presets, submissions, and public embed endpoints.
 *
 * Route structure:
 * - /api/forms/* - Authenticated endpoints for form management
 * - /api/forms/embed/* - Public endpoints for form embedding
 * - /api/forms/presets/* - Global preset management (admin)
 */

import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isAdminOrEditor } from '../middleware/roles.js';
import {
  getFormPresets,
  createForm,
  getForm,
  listForms,
  updateForm,
  saveDraftSchema,
  archiveForm,
  publishForm,
  getFormVersions,
  getFormByEmbedToken,
  processSubmission,
  getFormSubmissions,
  getSubmissionDetail,
  createFormPreset,
  updateFormPreset,
  deleteFormPreset
} from '../services/forms.js';
import {
  listFormReactors,
  getFormReactor,
  createFormReactor,
  listCustomFields,
  listTrackingNumbers
} from '../services/ctmForms.js';
import {
  getNotificationOverride,
  upsertNotificationOverride,
  deleteNotificationOverride
} from '../services/formNotifications.js';
import { generateFormFromPrompt } from '../services/formAI.js';
import { resolveCtmCreds } from '../services/ctm.js';

const router = Router();

// ==========================
// Public Embed Endpoints (no auth, CORS enabled)
// ==========================

// CORS middleware for embed endpoints - allows any origin
function embedCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
}

function checkAllowedOrigin(form, origin, { requireVerifiedOrigin = false } = {}) {
  const settings = form?.settings_json || {};
  const allowlist = settings.domain_allowlist || [];

  if (!allowlist.length) {
    return { allowed: true, reason: null, originHost: null };
  }

  if (!origin) {
    return {
      allowed: !requireVerifiedOrigin,
      reason: requireVerifiedOrigin ? 'Missing origin' : null,
      originHost: null
    };
  }

  try {
    const originHost = new URL(origin).hostname;
    const allowed = allowlist.some((domain) => {
      if (domain.startsWith('*.')) {
        const baseDomain = domain.slice(2);
        return originHost === baseDomain || originHost.endsWith(`.${baseDomain}`);
      }
      return originHost === domain;
    });

    return { allowed, reason: allowed ? null : 'Domain not allowed', originHost };
  } catch {
    return {
      allowed: !requireVerifiedOrigin,
      reason: requireVerifiedOrigin ? 'Malformed origin' : null,
      originHost: null
    };
  }
}

// Apply CORS to all embed routes
router.options('/embed/:token', embedCors);

/**
 * GET /api/forms/embed/:token
 * Get embeddable form configuration
 */
router.get('/embed/:token', embedCors, async (req, res) => {
  const { token } = req.params;

  try {
    console.log('[forms:embed:get] Fetching form with token:', token?.slice(0, 8) + '...');
    const form = await getFormByEmbedToken(token);

    if (!form) {
      console.log('[forms:embed:get] Form not found or not published for token:', token?.slice(0, 8) + '...');
      return res.status(404).json({ error: 'Form not found or not published' });
    }

    console.log('[forms:embed:get] Found form:', form.id, 'status:', form.status, 'has schema:', !!form.schema_json);

    const settings = form.settings_json || {};
    const origin = req.headers.origin || req.headers.referer;
    const originCheck = checkAllowedOrigin(form, origin);
    if (!originCheck.allowed) {
      console.log('[forms:embed:get] Domain not allowed:', originCheck.originHost || origin || 'unknown');
      return res.status(403).json({ error: originCheck.reason || 'Domain not allowed' });
    }

    // Note: clientId intentionally omitted to minimize data exposure (HIPAA)
    res.json({
      formId: form.id,
      name: form.name,
      formType: form.form_type,
      schema: form.schema_json,
      html: form.react_code || '',
      css: form.css_code || '',
      settings: {
        thankYouMessage: settings.custom_thank_you_message,
        saveAndResumeEnabled: settings.save_and_resume_enabled,
        newPatientButtonLabel: settings.new_patient_button_label,
        resumeButtonLabel: settings.resume_button_label
      }
    });
  } catch (err) {
    console.error('[forms:embed:get] Error loading form:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to load form' });
  }
});

/**
 * POST /api/forms/embed/:token
 * Submit a form (public endpoint)
 */
router.post('/embed/:token', embedCors, async (req, res) => {
  const { token } = req.params;
  const { fields, attribution, sessionId } = req.body;

  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'fields object is required' });
  }

  try {
    const form = await getFormByEmbedToken(token);

    if (!form) {
      return res.status(404).json({ error: 'Form not found or not published' });
    }

    const origin = req.headers.origin || req.headers.referer;
    const originCheck = checkAllowedOrigin(form, origin, { requireVerifiedOrigin: true });
    if (!originCheck.allowed) {
      return res.status(403).json({ error: originCheck.reason || 'Domain not allowed' });
    }

    // Safely parse origin hostname
    let embedDomain = null;
    try {
      if (req.headers.origin) {
        embedDomain = new URL(req.headers.origin).hostname;
      }
    } catch {
      // Malformed origin header - ignore
    }

    const result = await processSubmission(form.id, { fields, attribution, sessionId }, {
      ipAddress: req.ip || req.headers['x-forwarded-for']?.split(',')[0],
      userAgent: req.headers['user-agent'],
      embedDomain,
      referrer: req.headers.referer
    });

    res.json({
      success: true,
      submissionId: result.submissionId,
      thankYouMessage: result.thankYouMessage
    });
  } catch (err) {
    console.error('[forms:embed:submit]', err);
    res.status(400).json({ error: err.message || 'Failed to submit form' });
  }
});

// ==========================
// Authenticated Form Management
// ==========================

// All remaining routes require authentication
router.use(requireAuth);

/**
 * POST /api/forms/ai/generate
 * Generate form schema from natural language prompt using AI
 */
router.post('/ai/generate', isAdminOrEditor, async (req, res) => {
  try {
    const { prompt, formType } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    const schema = await generateFormFromPrompt(prompt.trim(), { formType });
    res.json({ schema });
  } catch (err) {
    console.error('[forms:ai:generate]', err.message);
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

/**
 * GET /api/forms
 * List forms for a client
 */
router.get('/', async (req, res) => {
  const { clientId, status } = req.query;
  const isAdmin = req.user.role === 'superadmin' || req.user.role === 'admin' || req.user.role === 'editor';

  // Only admins can view other clients' forms
  if (clientId && clientId !== req.user.id && !isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    let forms;
    if (!clientId && isAdmin) {
      // Admins without clientId filter see all forms
      forms = await listForms(null, { status });
    } else {
      forms = await listForms(clientId || req.user.id, { status });
    }
    res.json({ forms });
  } catch (err) {
    console.error('[forms:list]', err);
    res.status(500).json({ error: 'Failed to list forms' });
  }
});

/**
 * POST /api/forms
 * Create a new form
 */
router.post('/', isAdminOrEditor, async (req, res) => {
  const { clientId, name, description, formType, presetId, schemaJson, settings } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  if (!formType) {
    return res.status(400).json({ error: 'formType is required' });
  }

  try {
    const form = await createForm(clientId, {
      name,
      description,
      formType,
      presetId,
      schemaJson,
      settings
    });

    res.status(201).json({ form });
  } catch (err) {
    console.error('[forms:create]', err);
    res.status(400).json({ error: err.message || 'Failed to create form' });
  }
});

// ==========================
// Global Form Presets
// NOTE: These routes MUST come before /:id routes to avoid conflicts
// ==========================

/**
 * GET /api/forms/presets
 * List all form presets
 */
router.get('/presets', async (req, res) => {
  const { category, formType } = req.query;

  try {
    const presets = await getFormPresets({ category, formType });
    res.json({ presets });
  } catch (err) {
    console.error('[forms:presets:list]', err);
    res.status(500).json({ error: 'Failed to list presets' });
  }
});

/**
 * POST /api/forms/presets
 * Create a new preset (admin only)
 */
router.post('/presets', requireAdmin, async (req, res) => {
  const { name, description, category, formType, schemaJson, reactCode, cssCode } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const preset = await createFormPreset(
      { name, description, category, formType, schemaJson, reactCode, cssCode },
      req.user.id
    );

    res.status(201).json({ preset });
  } catch (err) {
    console.error('[forms:presets:create]', err);
    res.status(400).json({ error: err.message || 'Failed to create preset' });
  }
});

/**
 * PUT /api/forms/presets/:id
 * Update a preset (admin only, non-system presets)
 */
router.put('/presets/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description, category, schemaJson, reactCode, cssCode } = req.body;

  try {
    const preset = await updateFormPreset(id, {
      name,
      description,
      category,
      schema_json: schemaJson,
      react_code: reactCode,
      css_code: cssCode
    });

    res.json({ preset });
  } catch (err) {
    console.error('[forms:presets:update]', err);
    res.status(400).json({ error: err.message || 'Failed to update preset' });
  }
});

/**
 * DELETE /api/forms/presets/:id
 * Delete a preset (admin only, non-system presets)
 */
router.delete('/presets/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await deleteFormPreset(id);
    res.json({ success: true });
  } catch (err) {
    console.error('[forms:presets:delete]', err);
    res.status(400).json({ error: err.message || 'Failed to delete preset' });
  }
});

/**
 * GET /api/forms/submissions/:id
 * Get submission detail (includes decrypted PHI for authorized users)
 * NOTE: Must be before /:id route to avoid conflict
 */
router.get('/submissions/:id', isAdminOrEditor, async (req, res) => {
  const { id } = req.params;

  try {
    const submission = await getSubmissionDetail(id, req.user.id);

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.json({ submission });
  } catch (err) {
    console.error('[forms:submissions:get]', err);
    res.status(500).json({ error: 'Failed to get submission' });
  }
});

// ==========================
// Form CRUD with :id param
// ==========================

/**
 * GET /api/forms/:id
 * Get form details
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const form = await getForm(id);

    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Check authorization
    const isOwner = form.owner_user_id === req.user.id || form.org_id === req.user.id;
    const isAdminUser = req.user.role === 'superadmin' || req.user.role === 'admin' || req.user.role === 'editor';

    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ form });
  } catch (err) {
    console.error('[forms:get]', err);
    res.status(500).json({ error: 'Failed to get form' });
  }
});

/**
 * PUT /api/forms/:id
 * Update form details
 */
router.put('/:id', isAdminOrEditor, async (req, res) => {
  const { id } = req.params;
  const { name, description, settings_json } = req.body;

  // Only include fields that are actually provided
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (settings_json !== undefined) updates.settings_json = settings_json;

  try {
    const form = await updateForm(id, updates, req.user.id);
    res.json({ form });
  } catch (err) {
    console.error('[forms:update]', err);
    res.status(400).json({ error: err.message || 'Failed to update form' });
  }
});

/**
 * PUT /api/forms/:id/draft
 * Save draft schema (without publishing)
 */
router.put('/:id/draft', isAdminOrEditor, async (req, res) => {
  const { id } = req.params;
  const { schemaJson } = req.body;

  if (!schemaJson) {
    return res.status(400).json({ error: 'schemaJson is required' });
  }

  try {
    const form = await saveDraftSchema(id, schemaJson, req.user.id);
    res.json({ form });
  } catch (err) {
    console.error('[forms:draft]', err);
    res.status(400).json({ error: err.message || 'Failed to save draft' });
  }
});

/**
 * DELETE /api/forms/:id
 * Archive a form
 */
router.delete('/:id', isAdminOrEditor, async (req, res) => {
  const { id } = req.params;

  try {
    await archiveForm(id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[forms:archive]', err);
    res.status(400).json({ error: err.message || 'Failed to archive form' });
  }
});

/**
 * POST /api/forms/:id/publish
 * Publish a form version
 */
router.post('/:id/publish', isAdminOrEditor, async (req, res) => {
  const { id } = req.params;
  const { reactCode, schemaJson, cssCode } = req.body;

  if (!schemaJson) {
    return res.status(400).json({ error: 'schemaJson is required' });
  }

  try {
    const version = await publishForm(id, { reactCode, schemaJson, cssCode }, req.user.id);
    res.json({ success: true, version });
  } catch (err) {
    console.error('[forms:publish]', err);
    res.status(400).json({ error: err.message || 'Failed to publish form' });
  }
});

/**
 * GET /api/forms/:id/versions
 * Get form version history
 */
router.get('/:id/versions', isAdminOrEditor, async (req, res) => {
  const { id } = req.params;

  try {
    const versions = await getFormVersions(id);
    res.json({ versions });
  } catch (err) {
    console.error('[forms:versions]', err);
    res.status(500).json({ error: 'Failed to get versions' });
  }
});

/**
 * GET /api/forms/:id/submissions
 * List form submissions
 */
router.get('/:id/submissions', isAdminOrEditor, async (req, res) => {
  const { id } = req.params;
  const { limit, offset, dateFrom, dateTo } = req.query;

  try {
    const submissions = await getFormSubmissions(id, {
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
      dateFrom,
      dateTo
    });

    res.json({ submissions });
  } catch (err) {
    console.error('[forms:submissions:list]', err);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// ==========================
// Import / Export / Duplicate
// ==========================

// Export form as JSON
router.get('/:id/export', isAdminOrEditor, async (req, res) => {
  try {
    const form = await getForm(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const exportData = {
      name: form.name,
      form_type: form.form_type,
      schema_json: form.schema_json,
      settings_json: form.settings_json || {},
      exported_at: new Date().toISOString()
    };
    // Strip CTM-specific data (not portable)
    delete exportData.settings_json.ctm_enabled;

    res.setHeader('Content-Disposition', `attachment; filename="${form.name.replace(/[^a-z0-9]/gi, '_')}_export.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
  } catch (err) {
    console.error('[forms:export]', err.message);
    res.status(500).json({ error: 'Failed to export form' });
  }
});

// Import form from JSON
router.post('/import', isAdminOrEditor, async (req, res) => {
  try {
    const { clientId, formData } = req.body;
    if (!clientId || !formData) {
      return res.status(400).json({ error: 'clientId and formData are required' });
    }

    const newForm = await createForm(clientId, {
      name: formData.name || 'Imported Form',
      formType: formData.form_type || 'conversion'
    });

    // Save the imported schema
    if (formData.schema_json) {
      await saveDraftSchema(newForm.id, formData.schema_json);
    }

    // Update settings if provided
    if (formData.settings_json) {
      await updateForm(newForm.id, { settings_json: formData.settings_json });
    }

    res.json({ form: await getForm(newForm.id), message: 'Form imported as draft' });
  } catch (err) {
    console.error('[forms:import]', err.message);
    res.status(500).json({ error: 'Failed to import form' });
  }
});

// Duplicate form
router.post('/:id/duplicate', isAdminOrEditor, async (req, res) => {
  try {
    const source = await getForm(req.params.id);
    if (!source) return res.status(404).json({ error: 'Form not found' });

    const targetClientId = req.body.clientId || source.org_id;

    const newForm = await createForm(targetClientId, {
      name: `${source.name} (Copy)`,
      formType: source.form_type
    });

    // Copy schema
    if (source.schema_json) {
      await saveDraftSchema(newForm.id, source.schema_json);
    }

    // Copy settings (without CTM-specific data)
    if (source.settings_json) {
      const settings = { ...source.settings_json };
      delete settings.ctm_enabled;
      await updateForm(newForm.id, { settings_json: settings });
    }

    res.json({ form: await getForm(newForm.id), message: 'Form duplicated' });
  } catch (err) {
    console.error('[forms:duplicate]', err.message);
    res.status(500).json({ error: 'Failed to duplicate form' });
  }
});

// ==========================
// CTM FormReactor Integration (admin/editor only)
// ==========================

/**
 * Get client CTM credentials for a form.
 * Helper function — looks up credentials from client_profiles via form ownership.
 */
async function getCtmCredentialsForForm(formId) {
  const { rows } = await query(
    `SELECT cp.ctm_account_number, cp.ctm_api_key, cp.ctm_api_secret
     FROM forms f
     JOIN client_profiles cp ON cp.user_id = f.org_id
     WHERE f.id = $1`,
    [formId]
  );
  return resolveCtmCreds(rows[0] || null);
}

// List CTM FormReactors for a form's client
router.get('/:id/ctm/reactors', isAdminOrEditor, async (req, res) => {
  try {
    const credentials = await getCtmCredentialsForForm(req.params.id);
    if (!credentials) {
      return res.status(400).json({ error: 'CTM not configured for this client' });
    }
    const reactors = await listFormReactors(credentials);
    res.json({ reactors });
  } catch (err) {
    console.error('[forms:ctm:reactors]', err.message);
    res.status(500).json({ error: 'Failed to list FormReactors' });
  }
});

// Create a CTM FormReactor from form schema
router.post('/:id/ctm/reactor', isAdminOrEditor, async (req, res) => {
  try {
    const form = await getForm(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const credentials = await getCtmCredentialsForForm(req.params.id);
    if (!credentials) {
      return res.status(400).json({ error: 'CTM not configured for this client' });
    }

    const schema = form.schema_json || {};
    const reactor = await createFormReactor(credentials, {
      name: form.name,
      trackingNumberId: req.body.trackingNumberId || null,
      fields: schema.fields || [],
      includeEmail: true,
      includeName: true
    });

    // Store reactor ID on the form
    await query(
      `UPDATE forms SET ctm_reactor_id = $1, settings_json = COALESCE(settings_json, '{}'::jsonb) || $2::jsonb WHERE id = $3`,
      [reactor.id || reactor.form_reactor?.id, JSON.stringify({ ctm_enabled: true }), req.params.id]
    );

    res.json({ reactor, message: 'FormReactor created and linked' });
  } catch (err) {
    console.error('[forms:ctm:create-reactor]', err.message);
    res.status(500).json({ error: 'Failed to create FormReactor' });
  }
});

// Link form to an existing CTM FormReactor
router.post('/:id/ctm/link', isAdminOrEditor, async (req, res) => {
  try {
    const { reactorId } = req.body;
    if (!reactorId) return res.status(400).json({ error: 'reactorId is required' });

    const credentials = await getCtmCredentialsForForm(req.params.id);
    if (!credentials) {
      return res.status(400).json({ error: 'CTM not configured for this client' });
    }

    // Verify reactor exists
    await getFormReactor(credentials, reactorId);

    // Store reactor ID and enable CTM
    await query(
      `UPDATE forms SET ctm_reactor_id = $1, settings_json = COALESCE(settings_json, '{}'::jsonb) || $2::jsonb WHERE id = $3`,
      [reactorId, JSON.stringify({ ctm_enabled: true }), req.params.id]
    );

    res.json({ message: 'FormReactor linked', reactorId });
  } catch (err) {
    console.error('[forms:ctm:link]', err.message);
    res.status(500).json({ error: 'Failed to link FormReactor' });
  }
});

// List CTM custom fields for a form's client
router.get('/:id/ctm/custom-fields', isAdminOrEditor, async (req, res) => {
  try {
    const credentials = await getCtmCredentialsForForm(req.params.id);
    if (!credentials) {
      return res.status(400).json({ error: 'CTM not configured for this client' });
    }
    const customFields = await listCustomFields(credentials);
    res.json({ customFields });
  } catch (err) {
    console.error('[forms:ctm:custom-fields]', err.message);
    res.status(500).json({ error: 'Failed to list custom fields' });
  }
});

// List CTM tracking numbers for a form's client
router.get('/:id/ctm/numbers', isAdminOrEditor, async (req, res) => {
  try {
    const credentials = await getCtmCredentialsForForm(req.params.id);
    if (!credentials) {
      return res.status(400).json({ error: 'CTM not configured for this client' });
    }
    const numbers = await listTrackingNumbers(credentials);
    res.json({ numbers });
  } catch (err) {
    console.error('[forms:ctm:numbers]', err.message);
    res.status(500).json({ error: 'Failed to list tracking numbers' });
  }
});

// Disable CTM integration for a form
router.delete('/:id/ctm', isAdminOrEditor, async (req, res) => {
  try {
    await query(
      `UPDATE forms SET ctm_reactor_id = NULL, settings_json = COALESCE(settings_json, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ ctm_enabled: false }), req.params.id]
    );
    res.json({ message: 'CTM integration disabled' });
  } catch (err) {
    console.error('[forms:ctm:disable]', err.message);
    res.status(500).json({ error: 'Failed to disable CTM' });
  }
});

// ==========================
// Notification Overrides (admin/editor only)
// ==========================

// Get notification config for a form
router.get('/:id/notifications', isAdminOrEditor, async (req, res) => {
  try {
    const override = await getNotificationOverride(req.params.id);
    res.json({ override: override || null });
  } catch (err) {
    console.error('[forms:notifications:get]', err.message);
    res.status(500).json({ error: 'Failed to get notification config' });
  }
});

// Create or update notification config for a form
router.put('/:id/notifications', isAdminOrEditor, async (req, res) => {
  try {
    const override = await upsertNotificationOverride(req.params.id, req.body);
    res.json({ override });
  } catch (err) {
    console.error('[forms:notifications:upsert]', err.message);
    res.status(500).json({ error: 'Failed to update notification config' });
  }
});

// Delete notification override for a form (revert to account defaults)
router.delete('/:id/notifications', isAdminOrEditor, async (req, res) => {
  try {
    await deleteNotificationOverride(req.params.id);
    res.json({ message: 'Notification override removed, using account defaults' });
  } catch (err) {
    console.error('[forms:notifications:delete]', err.message);
    res.status(500).json({ error: 'Failed to delete notification config' });
  }
});

export default router;
