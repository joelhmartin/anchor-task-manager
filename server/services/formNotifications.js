/**
 * Enhanced Form Notification Service
 *
 * Extends the existing HIPAA-safe notification system with:
 * - {{field_name}} token substitution in subject/body templates
 * - Field values included for CONVERSION forms (non-PHI)
 * - Account-level default recipients with per-form overrides
 * - Intake forms remain HIPAA-safe (portal link only, no field data)
 */

import { query } from '../db.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from './mailgun.js';
import { wrapEmailHtml } from './emailTemplate.js';

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Replace {{field_name}} tokens in a template string.
 * HTML-escapes values to prevent XSS in email clients.
 *
 * Also supports built-in tokens:
 *   {{form_name}}, {{submission_date}}, {{portal_url}}
 */
export function renderTemplate(template, variables = {}) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    if (value === undefined || value === null) return match; // Keep unresolved tokens
    return escapeHtml(String(value));
  });
}

/**
 * Escape HTML special characters to prevent XSS in email clients.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

/**
 * Resolve notification recipients for a form submission.
 * Merges account-level defaults with per-form overrides.
 *
 * @param {string} formId - Form UUID
 * @param {string} ownerUserId - Client/owner user ID
 * @returns {object} { to, cc, subjectTemplate, bodyTemplate, includeFieldValues }
 */
export async function resolveNotificationConfig(formId, ownerUserId) {
  // 1. Check for per-form override
  const { rows: overrides } = await query(
    `SELECT * FROM form_notification_overrides WHERE form_id = $1 AND enabled = true`,
    [formId]
  );

  // 2. Get account-level defaults from client_profiles
  const { rows: profiles } = await query(
    `SELECT form_notification_emails FROM client_profiles WHERE user_id = $1`,
    [ownerUserId]
  );

  const accountEmails = profiles[0]?.form_notification_emails || [];

  // 3. Get owner + team member emails as fallback
  const { rows: teamEmails } = await query(
    `SELECT u.email FROM users u
     WHERE u.id = $1
        OR u.id IN (
          SELECT tm.user_id FROM team_members tm WHERE tm.client_id = $1
        )`,
    [ownerUserId]
  );
  const teamEmailList = teamEmails.map((r) => r.email).filter(Boolean);

  if (overrides.length > 0) {
    // Per-form override takes precedence
    const override = overrides[0];
    return {
      to: override.recipient_emails?.length > 0 ? override.recipient_emails : accountEmails.length > 0 ? accountEmails : teamEmailList,
      cc: override.cc_emails || [],
      subjectTemplate: override.subject_template || null,
      bodyTemplate: override.body_template || null,
      includeFieldValues: override.include_field_values ?? true
    };
  }

  // Account defaults
  return {
    to: accountEmails.length > 0 ? accountEmails : teamEmailList,
    cc: [],
    subjectTemplate: null,
    bodyTemplate: null,
    includeFieldValues: true
  };
}

// ---------------------------------------------------------------------------
// Email sending
// ---------------------------------------------------------------------------

/**
 * Send enhanced form submission notification.
 *
 * For CONVERSION forms: includes field values in email body.
 * For INTAKE forms: sends HIPAA-safe portal link only (forced, no override).
 *
 * @param {object} params
 * @param {string} params.submissionId
 * @param {object} params.form - { id, name, form_type, org_id }
 * @param {object} params.fieldValues - Raw form field values (only used for conversion)
 * @param {array}  params.schemaFields - Form schema field definitions (for ordering/labels)
 * @param {string} params.ownerUserId
 */
export async function sendEnhancedNotification({ submissionId, form, fieldValues, schemaFields, ownerUserId, isMedicalClient = true, leadCallId = null }) {
  if (!isMailgunConfigured()) {
    console.warn('[formNotifications] Mailgun not configured, skipping');
    return;
  }

  const config = await resolveNotificationConfig(form.id, ownerUserId);

  if (!config.to || config.to.length === 0) {
    console.warn('[formNotifications] No recipients for submission:', submissionId);
    return;
  }

  const isIntake = form.form_type === 'intake';
  // PHI email restrictions only apply to medical clients
  const restrictFieldsInEmail = isIntake && isMedicalClient;
  const baseUrl = process.env.APP_BASE_URL || process.env.CLIENT_APP_URL || 'https://app.anchordigital.io';
  const linkParams = new URLSearchParams({
    clientId: ownerUserId,
    submissionId
  });
  if (leadCallId) linkParams.set('lead', leadCallId);
  // Send every recipient through an authenticated redirect so clients and staff
  // land in the right account context before opening the leads view.
  const portalUrl = `${baseUrl}/open-submission?${linkParams.toString()}`;

  // Build template variables
  const templateVars = {
    form_name: form.name,
    submission_date: new Date().toLocaleString(),
    portal_url: portalUrl,
    // Include field values unless this is a medical client's intake form (HIPAA compliance)
    ...(restrictFieldsInEmail ? {} : (fieldValues || {}))
  };

  // Force no field values for medical intake forms regardless of config
  const includeFieldValues = restrictFieldsInEmail ? false : (config.includeFieldValues ?? true);

  // Resolve subject
  const subject = config.subjectTemplate
    ? renderTemplate(config.subjectTemplate, templateVars)
    : `New ${form.name} Submission`;

  // Build email body
  let htmlBody;
  let textBody;

  if (config.bodyTemplate && !restrictFieldsInEmail) {
    // Custom body template (allowed when not a medical intake)
    htmlBody = buildCustomHtmlEmail(
      renderTemplate(config.bodyTemplate, templateVars),
      subject,
      portalUrl
    );
    textBody = renderTemplate(config.bodyTemplate, templateVars) + `\n\nView in dashboard: ${portalUrl}`;
  } else if (includeFieldValues && fieldValues && !restrictFieldsInEmail) {
    // Default body with field values
    htmlBody = buildFieldValuesHtmlEmail(form, fieldValues, schemaFields, portalUrl);
    textBody = buildFieldValuesTextEmail(form, fieldValues, schemaFields, portalUrl);
  } else {
    // HIPAA-safe body (medical intake forms, or no field values configured)
    htmlBody = buildSecureHtmlEmail(form, portalUrl);
    textBody = buildSecureTextEmail(form, portalUrl);
  }

  try {
    await sendMailgunMessageWithLogging(
      {
        to: config.to,
        cc: config.cc || [],
        subject,
        text: textBody,
        html: htmlBody
      },
      {
        emailType: 'form_submission_notification',
        metadata: {
          formId: form.id,
          submissionId,
          recipientCount: config.to.length,
          includeFieldValues
        }
      }
    );

    // Update submission email_sent flag
    await query(
      `UPDATE form_submissions SET email_sent = true WHERE id = $1`,
      [submissionId]
    );

    console.log(`[formNotifications] Sent to ${config.to.length} recipients for submission ${submissionId}`);
  } catch (err) {
    console.error('[formNotifications] Send failed:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

/**
 * Build HTML email that includes field values (conversion forms only).
 */
function buildFieldValuesHtmlEmail(form, fieldValues, schemaFields = [], portalUrl) {
  // Order fields by schema if available
  const orderedFields = schemaFields.length > 0
    ? schemaFields
        .filter((sf) => !['heading', 'paragraph', 'divider', 'score_display', 'hidden'].includes(sf.type))
        .map((sf) => ({ key: sf.name, label: sf.label || sf.name, value: fieldValues[sf.name] }))
        .filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
    : Object.entries(fieldValues)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => ({ key: k, label: humanize(k), value: v }));

  const fieldRows = orderedFields
    .map((f) => {
      const val = Array.isArray(f.value) ? f.value.join(', ') : String(f.value);
      return `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: 500; color: #555; width: 35%; vertical-align: top;">
            ${escapeHtml(f.label)}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #333;">
            ${escapeHtml(val)}
          </td>
        </tr>`;
    })
    .join('');

  const bodyHtml = `
    <p style="margin-top: 0;">A new form submission was received on <strong>${escapeHtml(form.name)}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      ${fieldRows}
    </table>
    <a href="${escapeHtml(portalUrl)}" style="display: inline-block; background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin: 16px 0; font-size: 14px;">View in Dashboard</a>
    <p style="font-size: 12px; color: #888; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
      Submitted: ${new Date().toLocaleString()}<br>
      You can manage your notification preferences in your account settings.
    </p>`;

  return wrapEmailHtml({
    subject: `New ${form.name} Submission`,
    preheader: `A new submission was received on ${form.name}`,
    bodyHtml,
  });
}

/**
 * Build plain text email with field values.
 */
function buildFieldValuesTextEmail(form, fieldValues, schemaFields = [], portalUrl) {
  const orderedFields = schemaFields.length > 0
    ? schemaFields
        .filter((sf) => !['heading', 'paragraph', 'divider', 'score_display', 'hidden'].includes(sf.type))
        .map((sf) => ({ label: sf.label || sf.name, value: fieldValues[sf.name] }))
        .filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
    : Object.entries(fieldValues)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => ({ label: humanize(k), value: v }));

  const lines = orderedFields
    .map((f) => `  ${f.label}: ${Array.isArray(f.value) ? f.value.join(', ') : f.value}`)
    .join('\n');

  return `New ${form.name} Submission\n\n${lines}\n\nSubmitted: ${new Date().toLocaleString()}\nView in dashboard: ${portalUrl}`;
}

/**
 * HIPAA-safe HTML email (intake forms — no field data).
 */
function buildSecureHtmlEmail(form, portalUrl) {
  const bodyHtml = `
    <p style="margin-top: 0;">You have received a new submission on <strong>${escapeHtml(form.name)}</strong>.</p>
    <p>To view the complete submission details securely, please log in to your dashboard:</p>
    <a href="${escapeHtml(portalUrl)}" style="display: inline-block; background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin: 16px 0; font-size: 14px;">View Submission</a>
    <p style="font-size: 12px; color: #888; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
      Submitted: ${new Date().toLocaleString()}<br>
      You can manage your notification preferences in your account settings.
    </p>`;

  return wrapEmailHtml({
    subject: `New ${form.name} Submission`,
    preheader: `A new submission was received on ${form.name}`,
    bodyHtml,
  });
}

/**
 * HIPAA-safe plain text email.
 */
function buildSecureTextEmail(form, portalUrl) {
  return `New ${form.name} Submission\n\nTo view the submission details securely, please log in:\n${portalUrl}\n\nSubmitted: ${new Date().toLocaleString()}`;
}

/**
 * Wrap custom body content in email shell.
 */
function buildCustomHtmlEmail(bodyContent, subject, portalUrl) {
  const bodyHtml = `
    ${bodyContent}
    <br>
    <a href="${escapeHtml(portalUrl)}" style="display: inline-block; background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin: 16px 0; font-size: 14px;">View in Dashboard</a>
    <p style="font-size: 12px; color: #888; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
      You can manage your notification preferences in your account settings.
    </p>`;

  return wrapEmailHtml({ subject, preheader: subject, bodyHtml });
}

// ---------------------------------------------------------------------------
// Notification overrides CRUD
// ---------------------------------------------------------------------------

/**
 * Get notification override for a form.
 */
export async function getNotificationOverride(formId) {
  const { rows } = await query(
    `SELECT * FROM form_notification_overrides WHERE form_id = $1`,
    [formId]
  );
  return rows[0] || null;
}

/**
 * Create or update notification override for a form.
 */
export async function upsertNotificationOverride(formId, config) {
  const { recipientEmails, ccEmails, subjectTemplate, bodyTemplate, includeFieldValues, enabled } = config;

  const { rows } = await query(
    `INSERT INTO form_notification_overrides
       (form_id, recipient_emails, cc_emails, subject_template, body_template, include_field_values, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (form_id)
     DO UPDATE SET
       recipient_emails = EXCLUDED.recipient_emails,
       cc_emails = EXCLUDED.cc_emails,
       subject_template = EXCLUDED.subject_template,
       body_template = EXCLUDED.body_template,
       include_field_values = EXCLUDED.include_field_values,
       enabled = EXCLUDED.enabled,
       updated_at = NOW()
     RETURNING *`,
    [
      formId,
      recipientEmails || [],
      ccEmails || [],
      subjectTemplate || null,
      bodyTemplate || null,
      includeFieldValues ?? true,
      enabled ?? true
    ]
  );
  return rows[0];
}

/**
 * Delete notification override for a form.
 */
export async function deleteNotificationOverride(formId) {
  await query(`DELETE FROM form_notification_overrides WHERE form_id = $1`, [formId]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert snake_case field name to human-readable label.
 */
function humanize(str) {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
