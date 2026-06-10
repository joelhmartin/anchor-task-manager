/**
 * Forms Service
 *
 * Manages form creation, submission processing, and integration with the lead pipeline.
 * Form submissions are processed into call_logs for unified lead management.
 *
 * COMPLIANCE NOTES:
 * - PHI in intake forms is encrypted at application layer
 * - Conversion forms store only non-PHI data
 * - All form operations are audit logged
 * - IP addresses are hashed before storage
 */

import crypto from 'crypto';
import { query } from '../db.js';
import { resolveContact } from './contacts.js';
import { encrypt, decrypt } from './security/encryption.js';
import { clientLabelSelect, clientLabelJoins } from './clientLabel.js';
import {
  classifyContent,
  enrichCallerType,
  normalizePhoneNumber,
  resolveCtmCreds,
  getAutoStarRating,
  buildSystemTags,
  isReferralContext,
  logAiClassificationDebug
} from './ctm.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from './mailgun.js';
import { wrapEmailHtml } from './emailTemplate.js';
import { submitToFormReactor, buildCtmPayload } from './ctmForms.js';
import { sendEnhancedNotification } from './formNotifications.js';
import { sendEvent as sendTrackingEvent } from './trackingRelay.js';
import { logAiClassificationEvent } from './aiClassificationLog.js';
import { callLogsHasContactId } from './callLogUpsert.js';

/**
 * Generate a unique embed token for a form
 * @returns {string}
 */
function generateEmbedToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash an IP address for privacy-compliant storage
 * @param {string} ip
 * @returns {string}
 */
function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT || 'anchor-forms-salt';
  return crypto.createHash('sha256').update(ip + salt).digest('hex').slice(0, 16);
}

const LAYOUT_FIELD_TYPES = new Set(['heading', 'paragraph', 'divider', 'score_display', 'hidden']);

function normalizeFieldValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : item))
      .filter((item) => item !== '' && item !== null && item !== undefined);
  }
  return typeof value === 'string' ? value.trim() : value;
}

function getFieldValue(values, key) {
  if (!key || !values || typeof values !== 'object') return undefined;
  return values[key];
}

function isEmptyFieldValue(field, value) {
  const normalized = normalizeFieldValue(value);

  if (field?.type === 'checkbox') {
    return !Array.isArray(normalized) || normalized.length === 0;
  }

  if (field?.type === 'consent') {
    const consent = String(normalized || '').toLowerCase();
    return !['yes', 'true', '1', 'on'].includes(consent);
  }

  if (Array.isArray(normalized)) {
    return normalized.length === 0;
  }

  return normalized === '' || normalized === null || normalized === undefined;
}

function evaluateSubmissionCondition(rule, values) {
  const raw = getFieldValue(values, rule?.fieldId) ?? getFieldValue(values, rule?.field);
  const normalized = normalizeFieldValue(raw);
  const target = String(rule?.value ?? '');

  switch (rule?.operator) {
    case 'equals':
      return Array.isArray(normalized) ? normalized.map(String).includes(target) : String(normalized ?? '') === target;
    case 'not_equals':
      return Array.isArray(normalized) ? !normalized.map(String).includes(target) : String(normalized ?? '') !== target;
    case 'contains':
      return Array.isArray(normalized) ? normalized.map(String).includes(target) : String(normalized ?? '').includes(target);
    case 'not_contains':
      return Array.isArray(normalized) ? !normalized.map(String).includes(target) : !String(normalized ?? '').includes(target);
    case 'is_empty':
      return isEmptyFieldValue(null, normalized);
    case 'is_not_empty':
      return !isEmptyFieldValue(null, normalized);
    case 'greater_than':
      return parseFloat(Array.isArray(normalized) ? normalized[0] : normalized) > parseFloat(target);
    case 'less_than':
      return parseFloat(Array.isArray(normalized) ? normalized[0] : normalized) < parseFloat(target);
    default:
      return true;
  }
}

function shouldValidateField(field, values) {
  const conditions = Array.isArray(field?.conditions) ? field.conditions : [];
  if (!conditions.length) return true;
  const logic = field.conditionLogic === 'any' ? 'any' : 'all';
  return logic === 'any'
    ? conditions.some((rule) => evaluateSubmissionCondition(rule, values))
    : conditions.every((rule) => evaluateSubmissionCondition(rule, values));
}

function validateSubmissionFields(fields, schemaFields = []) {
  for (const field of schemaFields) {
    if (!field?.required || LAYOUT_FIELD_TYPES.has(field.type)) continue;
    if (!shouldValidateField(field, fields)) continue;

    const value = getFieldValue(fields, field.name) ?? getFieldValue(fields, field.id);
    if (isEmptyFieldValue(field, value)) {
      throw new Error(`${field.label || field.name || 'This field'} is required`);
    }
  }
}

function extractSubmissionIdentity(fields = {}) {
  const firstName = fields.first_name || fields.firstName || null;
  const lastName = fields.last_name || fields.lastName || null;
  const fullName =
    fields.name ||
    fields.full_name ||
    fields.fullName ||
    fields.caller_name ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    null;

  const email = fields.email || fields.email_address || fields.emailAddress || null;
  const phone =
    fields.phone ||
    fields.phone_number ||
    fields.phoneNumber ||
    fields.telephone ||
    fields.mobile ||
    fields.cell ||
    null;

  const derivedFirstName = firstName || (fullName ? String(fullName).trim().split(/\s+/)[0] : null);
  const derivedLastName =
    lastName ||
    (fullName && String(fullName).trim().split(/\s+/).length > 1
      ? String(fullName).trim().split(/\s+/).slice(1).join(' ')
      : null);

  return {
    fullName: fullName || 'Form Submission',
    email,
    phone,
    firstName: derivedFirstName,
    lastName: derivedLastName
  };
}

/**
 * Log a form audit event
 * @param {Object} event
 */
async function logFormAudit(event) {
  const { actorId, action, entityType, entityId, metadata, ipAddress, userAgent } = event;

  try {
    await query(
      `INSERT INTO form_audit_logs
         (actor_id, action, entity_type, entity_id, metadata_json, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actorId || null,
        action,
        entityType,
        entityId,
        JSON.stringify(metadata || {}),
        ipAddress || null,
        userAgent || null
      ]
    );
  } catch (err) {
    console.error('[forms:audit] Failed to log audit event:', err.message);
  }
}

/**
 * Get all form presets
 * @param {Object} options - { category?, formType? }
 * @returns {Promise<Array>}
 */
export async function getFormPresets(options = {}) {
  const { category, formType } = options;
  let sql = `SELECT * FROM form_presets WHERE 1=1`;
  const params = [];

  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }

  if (formType) {
    params.push(formType);
    sql += ` AND form_type = $${params.length}`;
  }

  sql += ` ORDER BY is_system DESC, name ASC`;

  const { rows } = await query(sql, params);
  return rows;
}

/**
 * Create a new form (from preset or custom)
 * @param {string} ownerUserId - The client's user ID
 * @param {Object} config - { name, description, formType, presetId?, schemaJson?, settings? }
 * @returns {Promise<Object>}
 */
export async function createForm(ownerUserId, config) {
  const { name, description, formType, presetId, schemaJson, settings } = config;

  if (!name) {
    throw new Error('Form name is required');
  }

  const validTypes = ['conversion', 'intake'];
  if (!validTypes.includes(formType)) {
    throw new Error(`formType must be one of: ${validTypes.join(', ')}`);
  }

  let finalSchemaJson = schemaJson || { fields: [] };

  // If using a preset, copy its schema
  if (presetId) {
    const { rows: presets } = await query(
      `SELECT schema_json, form_type FROM form_presets WHERE id = $1`,
      [presetId]
    );

    if (!presets.length) {
      throw new Error('Preset not found');
    }

    finalSchemaJson = presets[0].schema_json;
  }

  const embedToken = generateEmbedToken();
  const defaultSettings = {
    email_recipients: [],
    email_on_submission: true,
    domain_allowlist: [],
    custom_thank_you_message: 'Thank you for your submission!'
  };

  const { rows } = await query(
    `INSERT INTO forms
       (owner_user_id, org_id, name, description, form_type, preset_id, settings_json, embed_token)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      ownerUserId,
      name,
      description || null,
      formType,
      presetId || null,
      JSON.stringify({ ...defaultSettings, ...settings }),
      embedToken
    ]
  );

  const form = rows[0];

  // Create initial draft version
  await query(
    `INSERT INTO form_versions (form_id, version_number, react_code, schema_json, created_by)
     VALUES ($1, 1, '', $2, $3)`,
    [form.id, JSON.stringify(finalSchemaJson), ownerUserId]
  );

  await logFormAudit({
    actorId: ownerUserId,
    action: 'form.created',
    entityType: 'form',
    entityId: form.id,
    metadata: { name, formType, presetId }
  });

  // Return form with schema_json included
  return { ...form, schema_json: finalSchemaJson };
}

/**
 * Get a form by ID
 * @param {string} formId
 * @returns {Promise<Object|null>}
 */
export async function getForm(formId) {
  // First try to get with active_version_id, otherwise get latest draft version
  const { rows } = await query(
    `SELECT f.*,
            COALESCE(fv_active.schema_json, fv_latest.schema_json) as schema_json,
            COALESCE(fv_active.react_code, fv_latest.react_code) as react_code,
            COALESCE(fv_active.css_code, fv_latest.css_code) as css_code,
            COALESCE(fv_active.version_number, fv_latest.version_number) as current_version,
            fv_latest.id as draft_version_id
     FROM forms f
     LEFT JOIN form_versions fv_active ON f.active_version_id = fv_active.id
     LEFT JOIN LATERAL (
       SELECT * FROM form_versions
       WHERE form_id = f.id
       ORDER BY version_number DESC
       LIMIT 1
     ) fv_latest ON true
     WHERE f.id = $1`,
    [formId]
  );

  return rows[0] || null;
}

/**
 * Get forms for a client
 * @param {string} ownerUserId
 * @param {Object} options - { status?, limit?, offset? }
 * @returns {Promise<Array>}
 */
export async function listForms(ownerUserId, options = {}) {
  const { status, limit = 50, offset = 0 } = options;

  let sql = `
    SELECT f.*,
           fv.schema_json,
           (SELECT COUNT(*) FROM form_submissions WHERE form_id = f.id) as submission_count
    FROM forms f
    LEFT JOIN form_versions fv ON f.active_version_id = fv.id
  `;
  const params = [];

  if (ownerUserId) {
    params.push(ownerUserId);
    sql += ` WHERE f.owner_user_id = $${params.length}`;
  } else {
    sql += ` WHERE 1=1`;
  }

  if (status) {
    params.push(status);
    sql += ` AND f.status = $${params.length}`;
  }

  sql += ` ORDER BY f.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await query(sql, params);
  return rows;
}

/**
 * Update a form
 * @param {string} formId
 * @param {Object} updates - Fields to update
 * @param {string} actorId - User making the update
 * @returns {Promise<Object>}
 */
export async function updateForm(formId, updates, actorId) {
  const allowedFields = ['name', 'description', 'settings_json'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(key === 'settings_json' ? JSON.stringify(value) : value);
      paramIndex++;
    }
  }

  if (!setClauses.length) {
    throw new Error('No valid fields to update');
  }

  values.push(formId);
  const { rows } = await query(
    `UPDATE forms SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  await logFormAudit({
    actorId,
    action: 'form.updated',
    entityType: 'form',
    entityId: formId,
    metadata: { updatedFields: Object.keys(updates) }
  });

  return rows[0];
}

/**
 * Save draft schema (updates latest version's schema without publishing)
 * @param {string} formId
 * @param {Object} schemaJson - { fields, submitLabel?, style? }
 * @param {string} actorId - User making the update
 * @returns {Promise<Object>}
 */
export async function saveDraftSchema(formId, schemaJson, actorId) {
  // Get or create the draft version
  const { rows: existingVersions } = await query(
    `SELECT id, version_number FROM form_versions
     WHERE form_id = $1
     ORDER BY version_number DESC
     LIMIT 1`,
    [formId]
  );

  let versionId;
  if (existingVersions.length === 0) {
    // Create initial version if none exists
    const { rows: newVersion } = await query(
      `INSERT INTO form_versions (form_id, version_number, schema_json, created_by)
       VALUES ($1, 1, $2, $3)
       RETURNING id`,
      [formId, JSON.stringify(schemaJson), actorId]
    );
    versionId = newVersion[0].id;
  } else {
    versionId = existingVersions[0].id;
    // Update existing version's schema
    await query(
      `UPDATE form_versions SET schema_json = $1 WHERE id = $2`,
      [JSON.stringify(schemaJson), versionId]
    );
  }

  // Update form's updated_at timestamp
  await query(`UPDATE forms SET updated_at = NOW() WHERE id = $1`, [formId]);

  await logFormAudit({
    actorId,
    action: 'form.draft_saved',
    entityType: 'form',
    entityId: formId,
    metadata: { versionId, fieldCount: schemaJson?.fields?.length || 0 }
  });

  // Return the full form with updated schema
  return getForm(formId);
}

/**
 * Archive a form
 * @param {string} formId
 * @param {string} actorId
 * @returns {Promise<boolean>}
 */
export async function archiveForm(formId, actorId) {
  await query(
    `UPDATE forms SET status = 'archived', updated_at = NOW() WHERE id = $1`,
    [formId]
  );

  await logFormAudit({
    actorId,
    action: 'form.archived',
    entityType: 'form',
    entityId: formId
  });

  return true;
}

/**
 * Publish a form version
 * @param {string} formId
 * @param {Object} versionData - { reactCode, schemaJson, cssCode? }
 * @param {string} actorId
 * @returns {Promise<Object>}
 */
export async function publishForm(formId, versionData, actorId) {
  const { reactCode, schemaJson, cssCode } = versionData;

  // Get next version number
  const { rows: versionRows } = await query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM form_versions WHERE form_id = $1`,
    [formId]
  );
  const nextVersion = versionRows[0].next_version;

  // Create new version
  const { rows: newVersion } = await query(
    `INSERT INTO form_versions
       (form_id, version_number, react_code, css_code, schema_json, published_at, created_by)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)
     RETURNING *`,
    [
      formId,
      nextVersion,
      reactCode || '',
      cssCode || null,
      JSON.stringify(schemaJson || { fields: [] }),
      actorId
    ]
  );

  // Update form to point to new version and set status to published
  await query(
    `UPDATE forms SET active_version_id = $1, status = 'published', updated_at = NOW()
     WHERE id = $2`,
    [newVersion[0].id, formId]
  );

  await logFormAudit({
    actorId,
    action: 'form.published',
    entityType: 'form',
    entityId: formId,
    metadata: { versionNumber: nextVersion, versionId: newVersion[0].id }
  });

  return newVersion[0];
}

/**
 * Get form version history
 * @param {string} formId
 * @returns {Promise<Array>}
 */
export async function getFormVersions(formId) {
  const { rows } = await query(
    `SELECT fv.*, u.first_name, u.last_name
     FROM form_versions fv
     LEFT JOIN users u ON fv.created_by = u.id
     WHERE fv.form_id = $1
     ORDER BY fv.version_number DESC`,
    [formId]
  );
  return rows;
}

/**
 * Get form by embed token (for public embed endpoint)
 * @param {string} token
 * @returns {Promise<Object|null>}
 */
export async function getFormByEmbedToken(token) {
  try {
    const { rows } = await query(
      `SELECT f.*, fv.schema_json, fv.react_code, fv.css_code
       FROM forms f
       LEFT JOIN form_versions fv ON f.active_version_id = fv.id
       WHERE f.embed_token = $1 AND f.status = 'published'`,
      [token]
    );

    if (rows.length === 0) {
      // Debug: check if form exists but isn't published
      const { rows: debugRows } = await query(
        `SELECT id, status, active_version_id FROM forms WHERE embed_token = $1`,
        [token]
      );
      if (debugRows.length > 0) {
        console.log('[forms:getByToken] Form exists but not retrievable:', {
          id: debugRows[0].id,
          status: debugRows[0].status,
          hasActiveVersion: !!debugRows[0].active_version_id
        });
      }
    }

    return rows[0] || null;
  } catch (err) {
    console.error('[forms:getByToken] Database error:', err.message);
    throw err;
  }
}

/**
 * Process a form submission
 * Creates a call_logs entry for unified lead pipeline
 * @param {string} formId
 * @param {Object} data - { fields, attribution, sessionId? }
 * @param {Object} context - { ipAddress, userAgent, embedDomain?, referrer? }
 * @returns {Promise<Object>}
 */
export async function processSubmission(formId, data, context) {
  const { fields, attribution, sessionId } = data;
  const { ipAddress, userAgent, embedDomain, referrer } = context;

  // Get form and owner info
  const form = await getForm(formId);
  if (!form) {
    throw new Error('Form not found');
  }

  if (form.status !== 'published') {
    throw new Error('Form is not published');
  }

  const ownerUserId = form.owner_user_id || form.org_id;
  const formType = form.form_type;
  const isIntake = formType === 'intake';
  const schemaFields = form.schema_json?.fields || [];

  validateSubmissionFields(fields, schemaFields);

  // Check if the client is in a medical vertical (gates PHI email restrictions).
  // NOTE (audit 2026-06): this is the LEGACY /api/forms path (decommissioned — see CLAUDE.md).
  // It reads client_profiles.client_type only and is fail-OPEN (NULL → treated as non-medical),
  // which diverges from the canonical, fail-closed resolveClientType() in services/clientType.js
  // used by the live CTM Forms notifications. Left as-is intentionally since this path no longer
  // handles real submissions — but do NOT copy this pattern; use clientType.js for any new work.
  const { rows: cpRows } = await query(
    `SELECT client_type FROM client_profiles WHERE user_id = $1`,
    [ownerUserId]
  );
  const clientType = cpRows[0]?.client_type || null;
  const isMedicalClient = clientType === 'medical';

  // Prepare submission data
  let encryptedPayload = null;
  let nonPhiPayload = null;

  if (isIntake) {
    // Encrypt the entire payload for intake forms (contains PHI)
    const payloadStr = JSON.stringify(fields);
    encryptedPayload = encrypt(payloadStr);
    if (!encryptedPayload) {
      throw new Error('Failed to encrypt form data');
    }
  } else {
    // Conversion forms store plain JSON
    nonPhiPayload = fields;
  }

  // Create submission record
  const hashedIp = hashIp(ipAddress);
  const { rows: submissions } = await query(
    `INSERT INTO form_submissions
       (form_id, form_version_id, submission_kind, encrypted_payload, non_phi_payload,
        attribution_json, ip_address, user_agent, embed_domain, referrer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      formId,
      form.active_version_id,
      formType,
      isIntake ? Buffer.from(encryptedPayload) : null,
      isIntake ? null : JSON.stringify(nonPhiPayload),
      JSON.stringify(attribution || {}),
      hashedIp,
      userAgent,
      embedDomain || null,
      referrer || null
    ]
  );

  const submission = submissions[0];

  // Create lead entry in call_logs for unified pipeline
  const leadEntry = await createLeadFromSubmission(ownerUserId, form, submission, fields, attribution);

  // === CTM FormReactor Integration ===
  // If CTM is enabled and a reactor is linked, submit to CTM (non-blocking)
  const settings = form.settings_json || {};
  if (settings.ctm_enabled && form.ctm_reactor_id) {
    try {
      const { rows: ctmCreds } = await query(
        `SELECT cp.ctm_account_number, cp.ctm_api_key, cp.ctm_api_secret
         FROM client_profiles cp WHERE cp.user_id = $1`,
        [ownerUserId]
      );
      const credentials = resolveCtmCreds(ctmCreds[0] || null);
      if (credentials) {
        const ctmPayload = buildCtmPayload(fields, schemaFields, attribution || {});
        const ctmResponse = await submitToFormReactor(credentials, form.ctm_reactor_id, ctmPayload);

        // Update submission with CTM status
        await query(
          `UPDATE form_submissions SET ctm_sent = true, ctm_sent_at = NOW(), ctm_response = $1 WHERE id = $2`,
          [JSON.stringify(ctmResponse), submission.id]
        );
        console.log(`[forms:ctm] Submitted to CTM reactor ${form.ctm_reactor_id} for submission ${submission.id}`);
      } else {
        const ctmError = 'CTM credentials are not configured for this client';
        await query(
          `UPDATE form_submissions SET ctm_error = $1 WHERE id = $2`,
          [ctmError, submission.id]
        ).catch(() => {});
        await queueSubmissionJob(submission.id, 'ctm_conversion');
      }
    } catch (ctmErr) {
      console.error('[forms:ctm] CTM submission failed (non-blocking):', ctmErr.message);
      // Update submission with CTM error (don't fail the whole submission)
      await query(
        `UPDATE form_submissions SET ctm_error = $1 WHERE id = $2`,
        [ctmErr.message, submission.id]
      ).catch(() => {});
      await queueSubmissionJob(submission.id, 'ctm_conversion');
    }
  }

  // === Enhanced Email Notifications ===
  const notificationsEnabled = settings.email_on_submission !== false; // Default to true

  if (notificationsEnabled) {
    if (!isMailgunConfigured()) {
      await queueSubmissionNotification(submission.id);
    } else {
      try {
        await sendEnhancedNotification({
          submissionId: submission.id,
          form,
          fieldValues: (isIntake && isMedicalClient) ? null : fields,
          schemaFields,
          ownerUserId,
          isMedicalClient,
          leadCallId: leadEntry?.call_id || null
        });
      } catch (notifErr) {
        console.error('[forms:notification] Enhanced notification failed, queuing retry:', notifErr.message);
        await queueSubmissionNotification(submission.id);
      }
    }
  }

  // Link attribution session if provided
  if (sessionId) {
    await query(
      `UPDATE attribution_sessions SET form_submission_id = $1 WHERE session_id = $2`,
      [submission.id, sessionId]
    );
  }

  await logFormAudit({
    actorId: null, // Anonymous submission
    action: 'submission.created',
    entityType: 'submission',
    entityId: submission.id,
    metadata: {
      formId,
      formType,
      hasAttribution: Boolean(attribution && Object.keys(attribution).length)
    },
    ipAddress: hashedIp,
    userAgent
  });

  // Relay to tracking destinations (GA4 / Meta CAPI)
  const identity = extractSubmissionIdentity(fields);
  try {
    await sendTrackingEvent(ownerUserId, 'lead_submitted', 'form_submission', submission.id, {
      event_source_url: referrer || embedDomain || '',
      value: 1,
      currency: 'USD',
      email: identity.email,
      phone: identity.phone,
      first_name: identity.firstName,
      last_name: identity.lastName,
      gclid: attribution?.gclid,
      gbraid: attribution?.gbraid,
      wbraid: attribution?.wbraid,
    });
  } catch (relayErr) {
    console.error('[forms:relay]', relayErr.message);
  }

  return {
    submissionId: submission.id,
    leadId: leadEntry?.id,
    thankYouMessage: settings.custom_thank_you_message || 'Thank you for your submission!'
  };
}

/**
 * Create a lead (call_logs entry) from a form submission
 * @param {string} ownerUserId
 * @param {Object} form
 * @param {Object} submission
 * @param {Object} fields
 * @param {Object} attribution
 * @returns {Promise<Object>}
 */
async function createLeadFromSubmission(ownerUserId, form, submission, fields, attribution) {
  const identity = extractSubmissionIdentity(fields);
  const name = identity.fullName;
  const email = identity.email;
  const phone = identity.phone;

  // Check for a dedicated message/comments field to use for AI classification
  // This is treated like a call transcript for lead classification
  const messageContent =
    fields.message ||
    fields.comments ||
    fields.notes ||
    fields.inquiry ||
    fields.details ||
    fields.description ||
    null;

  // Build supplementary context from other fields (exclude sensitive PHI)
  const supplementaryFields = [];
  const excludeFromContext = [
    'ssn', 'dob', 'insurance_id', 'medical_conditions', 'medications', 'allergies',
    // Also exclude fields we've already extracted
    'name', 'full_name', 'fullName', 'first_name', 'firstName', 'last_name', 'lastName',
    'email', 'email_address', 'emailAddress',
    'phone', 'phone_number', 'phoneNumber', 'telephone', 'mobile', 'cell',
    'message', 'comments', 'notes', 'inquiry', 'details', 'description'
  ];

  for (const [key, value] of Object.entries(fields)) {
    if (!excludeFromContext.includes(key) && value) {
      supplementaryFields.push(`${key}: ${value}`);
    }
  }

  // For AI classification: use message field if available, otherwise build from all fields
  let classificationContent;
  if (messageContent) {
    // Treat message like a call transcript - primary content for classification
    classificationContent = messageContent;
    // Add name context if relevant
    if (name && name !== 'Form Submission') {
      classificationContent = `From: ${name}\n\n${classificationContent}`;
    }
  } else {
    // No dedicated message field - build from all non-PHI fields
    const allFields = [];
    const excludeFromMessage = ['ssn', 'dob', 'insurance_id', 'medical_conditions', 'medications', 'allergies'];
    for (const [key, value] of Object.entries(fields)) {
      if (!excludeFromMessage.includes(key) && value) {
        allFields.push(`${key}: ${value}`);
      }
    }
    classificationContent = allFields.join('\n');
  }

  // Full message for storage includes everything non-PHI
  const fullMessage = messageContent
    ? `Message: ${messageContent}${supplementaryFields.length ? '\n\nAdditional info:\n' + supplementaryFields.join('\n') : ''}`
    : classificationContent;

  // Get AI classification using the message content (like a call transcript)
  const { rows: profileRows } = await query(
    `SELECT ai_prompt FROM client_profiles WHERE user_id = $1`,
    [ownerUserId]
  );
  const aiPrompt = profileRows[0]?.ai_prompt;

  // Classify using the message content - explicitly mark as form to avoid call-specific categories
  const classification = await classifyContent(aiPrompt, null, classificationContent, { source: 'form' });
  const semanticCategory = classification.category;
  const isReferral = isReferralContext(`${classificationContent}\n${classification.summary || ''}`);

  // Contact Entity Phase 1: resolve contact first so we can pass contactId into
  // enrichCallerType for contact-aware repeat-caller detection.
  // Pass null for the synthetic fallback name so anonymous submissions don't seed a
  // contact named literally "Form Submission" (resolveContact's cleanName also filters
  // this, but be explicit at the boundary).
  // Live form submission → reactivate the contact if it was archived (genuinely returning lead).
  const contactId = await resolveContact({ ownerUserId, phone, email, name: name === 'Form Submission' ? null : name, reactivateArchived: true });

  // Check if this is a repeat caller/submitter — drives the first-touch suppression gate
  // and first-touch autostar suppression (re-engagement form fills should NOT
  // double-fire conversions or auto-star a returning caller).
  let callerInfo;
  if (phone || contactId) {
    try {
      callerInfo = await enrichCallerType(query, ownerUserId, phone || null, null, contactId);
    } catch (lookupErr) {
      console.error('[forms:processSubmission] enrichmentLookup failed (conservative suppress)', { ownerUserId, err: lookupErr.message });
      // Conservative: treat as a returning caller so we'd rather miss a conversion
      // than fire a duplicate. Mirrors ctm.js failure handling.
      callerInfo = { callerType: 'unknown', callSequence: 1, activeClientId: null, priorStarred: true, priorEngaged: true, recentlyQualified: true, firstStarredAt: null };
    }
  } else {
    callerInfo = { callerType: 'new', callSequence: 1, activeClientId: null };
  }

  const systemTags = buildSystemTags({
    semanticCategory,
    isReferral,
    categorySource: 'ai',
    enrichment: callerInfo
  });

  // Create call_id for the lead
  const callId = `form_${submission.id}`;

  // Build meta object - store contact info explicitly for easy access
  const meta = {
    // Contact info (mapped from form fields)
    caller_name: name !== 'Form Submission' ? name : null,
    caller_email: email,
    caller_phone: phone,

    // Source/form info
    source: form.name,
    source_key: 'form',
    form_id: form.id,
    form_name: form.name,
    form_type: form.form_type,
    submission_id: submission.id,

    // AI classification results
    category: semanticCategory,
    semantic_category: semanticCategory,
    category_source: 'ai',
    category_source_detail: 'form_submission',
    classification: classification.classification,
    classification_summary: classification.summary,
    classification_reasoning: classification.reasoning || classification.summary,
    is_referral: isReferral,
    system_tags: systemTags,

    // Message content (what was classified)
    message: fullMessage,
    message_content: messageContent, // The raw message field if present

    // Caller enrichment
    caller_type: callerInfo.callerType,
    previous_calls: callerInfo.previousCalls?.slice(0, 5) || [],

    // Attribution data
    attribution: attribution || {}
  };

  // Auto-star based on AI classification (same logic as call pipeline).
  // Suppress when the submitter is already an active client OR had a 3★+
  // contact in the last 6 months. Previously-spam / not-a-fit / applicant
  // callers coming back qualified are NOT suppressed. Mirrors ctm.js:pullCallsFromCtm.
  const score = (callerInfo?.callerType === 'active_client' || callerInfo?.recentlyQualified)
    ? 0
    : getAutoStarRating(semanticCategory);
  logAiClassificationDebug('form_submission:decision', {
    ownerUserId,
    formId: form.id,
    formName: form.name,
    submissionId: submission.id,
    callId,
    semanticCategory,
    classification: classification.classification,
    summary: classification.summary,
    reasoning: classification.reasoning || classification.summary,
    score,
    isReferral,
    systemTags
  });
  await logAiClassificationEvent({
    ownerUserId,
    callId,
    stage: 'form_submission',
    sourceType: 'form',
    activityType: 'form',
    provider: 'form',
    model: classification.debug?.model || process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
    finalCategory: semanticCategory,
    classification: classification.classification,
    score,
    isReferral,
    requiresCallback: false,
    systemTags,
    adjustments: classification.debug?.adjustments || [],
    input: classificationContent,
    prompt: classification.debug?.prompt || aiPrompt || '',
    rawResponse: classification.debug?.rawResponse || '',
    summary: classification.summary,
    reasoning: classification.reasoning || classification.summary,
    metadata: {
      formId: form.id,
      formName: form.name,
      submissionId: submission.id,
      inputLength: classification.debug?.inputLength || classificationContent.length,
      parsedCategory: classification.debug?.parsedCategory || classification.classification,
      debugSource: classification.debug?.source || 'form'
    }
  });

  // Insert into call_logs — gate contact_id column (may not exist pre-migration
  // during the startup window before ensureContactIdColumnsExist runs).
  const hasContactId = await callLogsHasContactId(query);
  const baseCols = `(owner_user_id, user_id, call_id, provider, activity_type, direction,
        from_number, started_at, caller_type, active_client_id, call_sequence, score, meta${hasContactId ? ', contact_id' : ''})`;
  const baseVals = `($1, $1, $2, 'form', 'form', 'inbound', $3, NOW(), $4, $5, $6, $7, $8${hasContactId ? ', $9' : ''})`;
  const baseParams = [ownerUserId, callId, phone ? normalizePhoneNumber(phone) : null, callerInfo.callerType, callerInfo.activeClientId, callerInfo.callSequence, score, JSON.stringify(meta)];
  if (hasContactId) baseParams.push(contactId);
  const { rows: leads } = await query(
    `INSERT INTO call_logs ${baseCols} VALUES ${baseVals} RETURNING *`,
    baseParams
  );

  return leads[0];
}

/**
 * Get default notification recipients for a client account
 * Includes the account owner and all team members
 * @param {string} ownerUserId - The client account owner's user ID
 * @returns {Promise<string[]>} - Array of email addresses
 */
async function getDefaultNotificationRecipients(ownerUserId) {
  const { rows } = await query(
    `SELECT DISTINCT u.email
     FROM users u
     WHERE u.id = $1

     UNION

     SELECT DISTINCT u.email
     FROM client_account_members cam
     JOIN users u ON u.id = cam.member_user_id
     WHERE cam.client_owner_id = $1
       AND u.email IS NOT NULL`,
    [ownerUserId]
  );

  return rows.map(r => r.email).filter(Boolean);
}

function buildNotificationSettingsFromForm(form) {
  const settings = form?.settings_json || {};
  return {
    recipients: settings.email_recipients || [],
    cc: settings.email_cc || [],
    bcc: settings.email_bcc || [],
    useDefaults: settings.use_default_recipients !== false
  };
}

async function queueSubmissionJob(submissionId, jobType) {
  const idempotencyKey = `${jobType}_${submissionId}`;
  await query(
    `INSERT INTO form_submission_jobs
       (submission_id, job_type, idempotency_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [submissionId, jobType, idempotencyKey]
  );
}

/**
 * Queue a submission notification email
 */
async function queueSubmissionNotification(submissionId) {
  await queueSubmissionJob(submissionId, 'email_notification');
}

async function processSubmissionJob(job) {
  const { rows } = await query(
    `SELECT j.id, j.submission_id, j.job_type,
            fs.form_id, fs.form_version_id, fs.non_phi_payload,
            f.id as current_form_id, f.name, f.form_type, f.owner_user_id, f.org_id,
            f.settings_json, f.ctm_reactor_id,
            fv.schema_json
     FROM form_submission_jobs j
     JOIN form_submissions fs ON fs.id = j.submission_id
     JOIN forms f ON f.id = fs.form_id
     LEFT JOIN form_versions fv ON fv.id = fs.form_version_id
     WHERE j.id = $1`,
    [job.id]
  );

  const record = rows[0];
  if (!record) {
    throw new Error('Submission job record no longer exists');
  }

  const ownerUserId = record.owner_user_id || record.org_id;

  if (record.job_type === 'email_notification') {
    await sendSubmissionNotification(
      record.submission_id,
      record,
      ownerUserId,
      buildNotificationSettingsFromForm(record)
    );
    return;
  }

  if (record.job_type === 'ctm_conversion') {
    if (!record.ctm_reactor_id) {
      throw new Error('CTM reactor is not configured for this form');
    }

    const credentials = await query(
      `SELECT cp.ctm_account_number, cp.ctm_api_key, cp.ctm_api_secret
       FROM client_profiles cp WHERE cp.user_id = $1`,
      [ownerUserId]
    ).then((result) => resolveCtmCreds(result.rows[0] || null));

    if (!credentials) {
      throw new Error('CTM credentials are not configured for this client');
    }

    const fields = record.non_phi_payload || {};
    const ctmPayload = buildCtmPayload(fields, record.schema_json?.fields || [], {});
    const ctmResponse = await submitToFormReactor(credentials, record.ctm_reactor_id, ctmPayload);

    await query(
      `UPDATE form_submissions
       SET ctm_sent = true, ctm_sent_at = NOW(), ctm_response = $1, ctm_error = NULL
       WHERE id = $2`,
      [JSON.stringify(ctmResponse), record.submission_id]
    );
    return;
  }

  throw new Error(`Unsupported job type: ${record.job_type}`);
}

export async function processPendingFormSubmissionJobs(limit = 10) {
  const { rows: claimedJobs } = await query(
    `WITH claimed AS (
       SELECT id
       FROM form_submission_jobs
       WHERE status IN ('pending', 'failed')
         AND attempts < max_attempts
         AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC, created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE form_submission_jobs j
     SET status = 'processing',
         started_at = NOW(),
         attempts = j.attempts + 1
     FROM claimed
     WHERE j.id = claimed.id
     RETURNING j.*`,
    [limit]
  );

  let processed = 0;
  for (const job of claimedJobs) {
    try {
      await processSubmissionJob(job);
      await query(
        `UPDATE form_submission_jobs
         SET status = 'completed', completed_at = NOW(), last_error = NULL
         WHERE id = $1`,
        [job.id]
      );
      processed += 1;
    } catch (err) {
      const backoffMinutes = Math.min(Math.pow(2, Math.max(job.attempts, 1) - 1), 60);
      await query(
        `UPDATE form_submission_jobs
         SET status = 'failed',
             last_error = $2,
             scheduled_at = NOW() + ($3 || ' minutes')::interval
         WHERE id = $1`,
        [job.id, err.message, String(backoffMinutes)]
      );
      console.error('[forms:jobs] Job failed:', job.id, job.job_type, err.message);
    }
  }

  return { processed, claimed: claimedJobs.length };
}

/**
 * Send submission notification email
 * HIPAA Compliant: Does NOT include any PHI - only a link to view in the portal
 *
 * @param {string} submissionId
 * @param {Object} form
 * @param {string} ownerUserId
 * @param {Object} notificationSettings - { recipients, cc, bcc, useDefaults }
 */
export async function sendSubmissionNotification(submissionId, form, ownerUserId, notificationSettings = {}) {
  const { recipients: customRecipients, cc, bcc, useDefaults = true } = notificationSettings;

  // Determine recipients
  let toRecipients = customRecipients || [];

  // If using defaults or no custom recipients specified, get owner + team members
  if (useDefaults || toRecipients.length === 0) {
    const defaultRecipients = await getDefaultNotificationRecipients(ownerUserId);
    // Merge with custom recipients (dedupe)
    toRecipients = [...new Set([...toRecipients, ...defaultRecipients])];
  }

  if (toRecipients.length === 0) {
    console.warn('[forms:notification] No recipients for submission:', submissionId);
    return;
  }

  // Resolve business name for email — formal name preferred, informal name as fallback
  let businessName = '';
  try {
    const { rows: nameRows } = await query(
      `SELECT ${clientLabelSelect('business_name')}
         FROM users u
         ${clientLabelJoins()}
        WHERE u.id = $1`,
      [ownerUserId]
    );
    businessName = nameRows[0]?.business_name || '';
  } catch (_err) {
    // non-blocking — email still sends without the business name
  }

  // Build portal URL - HIPAA compliant: only a link, no PHI in email.
  // Route through an authenticated redirect so clients and staff land in the
  // correct account context before opening the leads view.
  const baseUrl = process.env.APP_BASE_URL || process.env.CLIENT_APP_URL || 'https://app.anchordigital.io';
  const linkParams = new URLSearchParams({
    clientId: ownerUserId,
    submissionId
  });
  const portalUrl = `${baseUrl}/open-submission?${linkParams.toString()}`;

  const clientLabel = businessName ? `${businessName}: ` : '';
  const subject = `${clientLabel}New ${form.name} Submission`;

  // HIPAA Compliant email - NO PHI included, just a link to view securely
  const textBody = `
You have a new form submission!

Form: ${form.name}${businessName ? `\nClient: ${businessName}` : ''}
Submitted: ${new Date().toLocaleString()}

To view the submission details securely, please log in to your dashboard:
${portalUrl}

This notification was sent because you are set to receive form submission alerts.
You can manage your notification preferences in your account settings.
  `.trim();

  const htmlBody = wrapEmailHtml({
    subject,
    preheader: `A new submission was received on ${form.name}${businessName ? ` for ${businessName}` : ''}`,
    bodyHtml: `
      <p style="margin-top: 0;">You have received a new submission on <strong>${form.name}</strong>${businessName ? ` for <strong>${businessName}</strong>` : ''}.</p>
      <p>Submitted: ${new Date().toLocaleString()}</p>
      <p>To view the complete submission details securely, please log in to your dashboard:</p>
      <a href="${portalUrl}" style="display: inline-block; background: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 16px 0;">View Submission</a>
      <p style="font-size: 12px; color: #666; margin-top: 20px;">
        This notification was sent because you are set to receive form submission alerts.<br>
        You can manage your notification preferences in your account settings.
      </p>`,
  });

  try {
    await sendMailgunMessageWithLogging(
      {
        to: toRecipients,
        cc: cc || [],
        bcc: bcc || [],
        subject,
        text: textBody,
        html: htmlBody
      },
      {
        emailType: 'form_submission_notification',
        metadata: { formId: form.id, submissionId, recipientCount: toRecipients.length }
      }
    );
    console.log(`[forms:notification] Sent notification to ${toRecipients.length} recipients for submission ${submissionId}`);

    await query(
      `UPDATE form_submissions SET email_sent = TRUE, email_sent_at = NOW() WHERE id = $1`,
      [submissionId]
    );
  } catch (err) {
    console.error(`[forms:notification] Failed to send notification:`, err.message);
    throw err;
  }
}

/**
 * Get form submissions
 * @param {string} formId
 * @param {Object} options - { limit?, offset?, dateFrom?, dateTo? }
 * @returns {Promise<Array>}
 */
export async function getFormSubmissions(formId, options = {}) {
  const { limit = 50, offset = 0, dateFrom, dateTo } = options;

  let sql = `
    SELECT id, form_id, submission_kind, attribution_json, created_at,
           email_sent, embed_domain, referrer
    FROM form_submissions
    WHERE form_id = $1
  `;
  const params = [formId];

  if (dateFrom) {
    params.push(dateFrom);
    sql += ` AND created_at >= $${params.length}`;
  }

  if (dateTo) {
    params.push(dateTo);
    sql += ` AND created_at <= $${params.length}`;
  }

  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await query(sql, params);
  return rows;
}

/**
 * Get a single submission with decrypted data (admin only)
 * @param {string} submissionId
 * @param {string} actorId - For audit logging
 * @returns {Promise<Object|null>}
 */
export async function getSubmissionDetail(submissionId, actorId) {
  const { rows } = await query(
    `SELECT fs.*, f.name as form_name, f.form_type
     FROM form_submissions fs
     JOIN forms f ON fs.form_id = f.id
     WHERE fs.id = $1`,
    [submissionId]
  );

  if (!rows.length) return null;

  const submission = rows[0];

  // Decrypt PHI payload if present
  if (submission.encrypted_payload) {
    try {
      const decrypted = decrypt(submission.encrypted_payload.toString());
      submission.decrypted_payload = JSON.parse(decrypted);
    } catch (err) {
      console.error('[forms:decrypt] Failed to decrypt submission:', err.message);
      submission.decrypted_payload = null;
      submission.decryption_error = true;
    }
  }

  // Log the access for HIPAA compliance
  await logFormAudit({
    actorId,
    action: 'submission.viewed',
    entityType: 'submission',
    entityId: submissionId,
    metadata: {
      formId: submission.form_id,
      formType: submission.form_type,
      hadPhi: Boolean(submission.encrypted_payload)
    }
  });

  return submission;
}

/**
 * Create a form preset (admin only)
 * @param {Object} preset - { name, description, category, formType, schemaJson, reactCode?, cssCode? }
 * @param {string} createdBy
 * @returns {Promise<Object>}
 */
export async function createFormPreset(preset, createdBy) {
  const { name, description, category, formType, schemaJson, reactCode, cssCode } = preset;

  const { rows } = await query(
    `INSERT INTO form_presets
       (name, description, category, form_type, schema_json, react_code, css_code, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      name,
      description || null,
      category || null,
      formType || 'conversion',
      JSON.stringify(schemaJson || { fields: [] }),
      reactCode || null,
      cssCode || null,
      createdBy
    ]
  );

  return rows[0];
}

/**
 * Update a form preset (admin only, non-system presets)
 * @param {string} presetId
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
export async function updateFormPreset(presetId, updates) {
  // Check if system preset
  const { rows: existing } = await query(
    `SELECT is_system FROM form_presets WHERE id = $1`,
    [presetId]
  );

  if (!existing.length) {
    throw new Error('Preset not found');
  }

  if (existing[0].is_system) {
    throw new Error('Cannot modify system presets');
  }

  const allowedFields = ['name', 'description', 'category', 'schema_json', 'react_code', 'css_code'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(key === 'schema_json' ? JSON.stringify(value) : value);
      paramIndex++;
    }
  }

  if (!setClauses.length) {
    throw new Error('No valid fields to update');
  }

  values.push(presetId);
  const { rows } = await query(
    `UPDATE form_presets SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return rows[0];
}

/**
 * Delete a form preset (admin only, non-system presets)
 * @param {string} presetId
 * @returns {Promise<boolean>}
 */
export async function deleteFormPreset(presetId) {
  const { rows } = await query(
    `DELETE FROM form_presets WHERE id = $1 AND is_system = FALSE RETURNING id`,
    [presetId]
  );

  if (!rows.length) {
    throw new Error('Preset not found or is a system preset');
  }

  return true;
}
