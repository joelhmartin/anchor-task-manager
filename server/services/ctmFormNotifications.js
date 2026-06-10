/**
 * CTM Form Notifications Service
 *
 * Email notifications with {{field_name}} token replacement.
 * Uses the shared Anchor Corps email template (logo + layout).
 * Phone numbers are formatted for readability.
 */

import { query } from '../db.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from './mailgun.js';
import { wrapEmailHtml, wrapClientEmailHtml, plainTextToParagraphs } from './emailTemplate.js';
import { sanitizeFieldName } from './ctmFormBuilder.js';
import { isNonMedicalClient } from './clientType.js';

// ---------------------------------------------------------------------------
// Phone formatting
// ---------------------------------------------------------------------------

/**
 * Format a phone number string for display.
 * 10 digits → (XXX) XXX-XXXX
 * 11 digits starting with 1 → +1 (XXX) XXX-XXXX
 * Otherwise return as-is with spaces for readability.
 */
function formatPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  // For other lengths, just add some spacing
  if (digits.length > 6) {
    return `+${digits.slice(0, digits.length - 10)} (${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
  }
  return phone; // Return original if can't format
}

/**
 * Check if a field name is phone-related and should be formatted.
 */
function isPhoneField(name) {
  const lower = (name || '').toLowerCase();
  return lower === 'phone' || lower === 'phone_number' || lower === 'tel' || lower.includes('phone');
}

// ---------------------------------------------------------------------------
// Redacted lead label (medical clients)
// ---------------------------------------------------------------------------

// Field-name patterns (sanitized, letters only) that identify name fields.
const FIRST_NAME_KEYS = new Set(['firstname', 'fname', 'first', 'givenname', 'forename']);
const LAST_NAME_KEYS = new Set(['lastname', 'lname', 'last', 'surname', 'familyname']);
// 'callername' is the CTM core full-name key (ctmForms maps name → caller_name), so it's the
// one almost every real submission carries — it must be here or the label never renders.
const FULL_NAME_KEYS = new Set(['name', 'fullname', 'yourname', 'contactname', 'callername']);

/** "Sarah" → "S***". Returns '' for empty/non-string input. */
function redactNamePart(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  return `${t[0].toUpperCase()}***`;
}

/**
 * Build a privacy-redacted lead label from the submitted name fields, e.g. "S*** M***".
 * Medical clients only — gives staff just enough to recognize which lead the notification
 * is about (correlate with the dashboard) without putting an actual name (PHI) in the inbox.
 * Returns '' when no name field can be identified.
 */
function buildRedactedLeadLabel(fieldData = {}) {
  const norm = (k) => String(k || '').toLowerCase().replace(/[^a-z]/g, '');
  let first = '';
  let last = '';
  for (const [k, v] of Object.entries(fieldData)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const n = norm(k);
    if (!first && FIRST_NAME_KEYS.has(n)) first = v;
    else if (!last && LAST_NAME_KEYS.has(n)) last = v;
  }
  // Fall back to a single combined name field ("Sarah Martin") split into first/last.
  if (!first && !last) {
    for (const [k, v] of Object.entries(fieldData)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      if (FULL_NAME_KEYS.has(norm(k))) {
        const parts = v.trim().split(/\s+/);
        first = parts[0] || '';
        last = parts.length > 1 ? parts[parts.length - 1] : '';
        break;
      }
    }
  }
  return [redactNamePart(first), redactNamePart(last)].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSubmissionUrl(baseUrl, { clientId, submissionId, formId = null, leadId = null }) {
  const params = new URLSearchParams({
    clientId,
    submissionId
  });
  if (formId) params.set('formId', formId);
  if (leadId) params.set('lead', leadId);
  return `${baseUrl}/open-submission?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Replace {{field_name}} tokens in a template string.
 * HTML-escapes values to prevent XSS in email clients.
 */
export function renderTemplate(template, variables = {}) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    if (value === undefined || value === null) return match;
    let display = Array.isArray(value) ? value.join(', ') : String(value);
    if (isPhoneField(key)) display = formatPhone(display);
    return escapeHtml(display);
  });
}

// ---------------------------------------------------------------------------
// Main send function
// ---------------------------------------------------------------------------

/**
 * Send form submission notification email.
 *
 * @param {object} form - ctm_forms row
 * @param {object} fieldData - all submitted fields (core + custom merged)
 * @param {string} submissionId - UUID of ctm_form_submissions row
 */
export async function sendSubmissionNotification(form, fieldData, submissionId) {
  if (!isMailgunConfigured()) {
    console.warn('[ctmFormNotifications] Mailgun not configured');
    return;
  }

  if (!form.notification_enabled) return;

  // Fetch client business name for the email
  let clientName = '';
  try {
    const { rows: baRows } = await query(
      `SELECT business_name FROM brand_assets WHERE user_id = $1 LIMIT 1`,
      [form.org_id]
    );
    clientName = baRows[0]?.business_name || '';
  } catch (_) {}

  // Resolve recipients
  let recipients = form.notification_emails || [];

  if (recipients.length === 0) {
    const { rows } = await query(
      `SELECT form_notification_emails FROM client_profiles WHERE user_id = $1`,
      [form.org_id]
    );
    recipients = rows[0]?.form_notification_emails || [];
  }

  if (recipients.length === 0) {
    const { rows } = await query(`SELECT email FROM users WHERE id = $1`, [form.org_id]);
    if (rows[0]?.email) recipients = [rows[0].email];
  }

  if (recipients.length === 0) {
    console.warn('[ctmFormNotifications] No recipients for form:', form.id);
    return;
  }

  const cc = form.notification_cc || [];

  // Subject — include client name so agency staff know who it's for
  const subject = clientName
    ? `New ${form.name} Submission — ${clientName}`
    : `New ${form.name} Submission`;

  // Client type gates whether the email may include the submitted field values.
  // Medical clients — and anything NOT explicitly non-medical — stay link-only so PHI
  // never lands in an inbox. Fail closed: only a confirmed non-medical client (no PHI)
  // gets the full submission inline. isNonMedicalClient() resolves across BOTH
  // client_profiles.client_type and tracking_configs.client_type (see services/clientType.js),
  // so a non-medical client onboarded via the tracking wizard isn't misread as medical just
  // because the optional profile column was never filled in.
  const isNonMedical = await isNonMedicalClient(form.org_id);

  const dashboardUrl = process.env.APP_URL || 'https://dashboard.anchorcorps.com';
  const bodyHtml = isNonMedical
    ? buildFieldValuesBody(form, fieldData, dashboardUrl, clientName, submissionId)
    : buildLinkOnlyBody(form, dashboardUrl, clientName, submissionId, fieldData);
  const textBody = isNonMedical
    ? buildFieldValuesText(form, fieldData, dashboardUrl, clientName, submissionId)
    : buildLinkOnlyText(form, dashboardUrl, clientName, submissionId, fieldData);

  // Wrap in the Anchor Corps email template (logo + layout)
  const htmlEmail = wrapEmailHtml({
    subject,
    preheader: clientName ? `New submission on ${form.name} for ${clientName}` : `New submission on ${form.name}`,
    bodyHtml
  });

  // Send individual emails per recipient to avoid same-domain delivery issues.
  // When multiple recipients share a domain (e.g. office@ and dentaloffice@krish.com),
  // some mail servers silently drop one if both arrive in the same SMTP transaction.
  try {
    const allRecipients = [...recipients, ...cc];
    const results = await Promise.allSettled(
      allRecipients.map(addr =>
        sendMailgunMessageWithLogging(
          { to: [addr], subject, text: textBody, html: htmlEmail },
          {
            emailType: 'ctm_form_submission',
            metadata: { formId: form.id, submissionId },
            skipBodyLogging: true
          }
        )
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[ctmFormNotifications] ${failed.length} of ${allRecipients.length} emails failed:`,
        failed.map(r => r.reason?.message).join('; '));
    }

    if (sent > 0) {
      await query(`UPDATE ctm_form_submissions SET email_sent = true WHERE id = $1`, [submissionId]);
    }
    console.log(`[ctmFormNotifications] Sent ${sent}/${allRecipients.length} emails for submission ${submissionId}`);
  } catch (err) {
    console.error('[ctmFormNotifications] Send failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Test submission notification (Anchor Corps passphrase bypass)
// ---------------------------------------------------------------------------

/**
 * Send a test-only notification to webforms@anchorcorps.com.
 * Bypasses normal recipients so client inboxes aren't cluttered by test submissions.
 */
export async function sendTestNotification(form, submissionId) {
  if (!isMailgunConfigured()) return;

  let clientName = '';
  try {
    const { rows: baRows } = await query(
      `SELECT business_name FROM brand_assets WHERE user_id = $1 LIMIT 1`,
      [form.org_id]
    );
    clientName = baRows[0]?.business_name || '';
  } catch (_) {}

  const subject = clientName
    ? `New Anchor Form Test — ${clientName}`
    : 'New Anchor Form Test';
  const dashboardUrl = process.env.APP_URL || 'https://dashboard.anchorcorps.com';
  const bodyHtml = buildLinkOnlyBody(form, dashboardUrl, clientName, submissionId);
  const textBody = buildLinkOnlyText(form, dashboardUrl, clientName, submissionId);

  const htmlEmail = wrapEmailHtml({
    subject,
    preheader: `Test submission on ${form.name}${clientName ? ` for ${clientName}` : ''}`,
    bodyHtml
  });

  await sendMailgunMessageWithLogging(
    { to: ['webforms@anchorcorps.com'], subject, text: textBody, html: htmlEmail },
    {
      emailType: 'ctm_form_submission_test',
      metadata: { formId: form.id, submissionId },
      skipBodyLogging: true
    }
  );

  await query(`UPDATE ctm_form_submissions SET email_sent = true WHERE id = $1`, [submissionId]);
  console.log(`[ctmFormNotifications] Test notification sent for submission ${submissionId}`);
}

// ---------------------------------------------------------------------------
// Submitter autoresponder — sends a confirmation email + optional PDF
// attachments to the person who filled out the form.
// ---------------------------------------------------------------------------

const AUTORESPONDER_MAX_FILES = 5;
const AUTORESPONDER_MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB

function pickSubmitterEmail(fieldData = {}) {
  const candidate = fieldData.email || fieldData.Email || fieldData.email_address;
  if (!candidate || typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Send a confirmation email to the form submitter, optionally with PDF
 * attachments referenced by file_uploads.id.
 *
 * @param {object} form - ctm_forms row (must include autoresponder_* columns)
 * @param {object} fieldData - merged submission fields (must include `email`)
 * @param {string} submissionId - UUID of the ctm_form_submissions row
 * @param {boolean} isSpam - submission was flagged as spam; suppress send
 */
export async function sendAutoresponderEmail(form, fieldData, submissionId, isSpam = false) {
  if (!form?.autoresponder_enabled) return;
  if (isSpam) return;
  if (!isMailgunConfigured()) {
    console.warn('[ctmFormNotifications] autoresponder skipped: Mailgun not configured');
    return;
  }

  const recipient = pickSubmitterEmail(fieldData);
  if (!recipient) return;

  const subjectTpl = form.autoresponder_subject || 'Thanks for reaching out';
  const bodyTpl = form.autoresponder_body || '';
  const preheaderTpl = form.autoresponder_preheader || '';
  const bodyFormat = form.autoresponder_body_format === 'html' ? 'html' : 'text';

  const subject = renderTemplate(subjectTpl, fieldData);
  const preheader = renderTemplate(preheaderTpl, fieldData);

  // Body rendering by format.
  // - text: escape user-entered text, split blank-line paragraphs into <p>,
  //   THEN substitute tokens (which renderTemplate also escapes).
  // - html: pass through user-entered HTML, substitute tokens (values escaped).
  let renderedBodyHtml;
  if (bodyFormat === 'html') {
    renderedBodyHtml = renderTemplate(bodyTpl, fieldData);
  } else {
    renderedBodyHtml = renderTemplate(plainTextToParagraphs(bodyTpl), fieldData);
  }

  // Look up client business name + logo for branding.
  let businessName = '';
  let clientLogoUrl = '';
  try {
    const { rows } = await query(
      `SELECT business_name, logos FROM brand_assets WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [form.org_id]
    );
    businessName = rows[0]?.business_name || '';
    let logos = rows[0]?.logos;
    if (typeof logos === 'string') {
      try { logos = JSON.parse(logos); } catch { logos = []; }
    }
    if (Array.isArray(logos) && logos.length) {
      const first = logos.find((l) => l && typeof l === 'object' && typeof l.url === 'string' && l.url.trim());
      if (first) clientLogoUrl = first.url.trim();
    }
  } catch (_) {}

  // From name: legacy autoresponder_from_name override → client business name → fallback.
  let fromName = (form.autoresponder_from_name || '').trim() || businessName.trim() || 'Anchor Corps';

  // Reply-To resolution:
  // 1. Per-form override (autoresponder_reply_to)
  // 2. Form-level notification recipients (notification_emails)
  // 3. Client-level default (client_profiles.form_notification_emails)
  const validEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  const dedupe = (arr) => {
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      const t = String(v || '').trim();
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out;
  };
  let replyToList = dedupe(Array.isArray(form.autoresponder_reply_to) ? form.autoresponder_reply_to : []).filter(validEmail);
  if (!replyToList.length) {
    replyToList = dedupe(Array.isArray(form.notification_emails) ? form.notification_emails : []).filter(validEmail);
  }
  if (!replyToList.length) {
    try {
      const { rows } = await query(
        `SELECT form_notification_emails FROM client_profiles WHERE user_id = $1`,
        [form.org_id]
      );
      replyToList = dedupe(rows[0]?.form_notification_emails || []).filter(validEmail);
    } catch (_) {}
  }

  // Resolve attachments. autoresponder_attachments is a JSONB array of
  // { file_id, filename }. Fetch the bytes from file_uploads.
  let attachments = [];
  const configured = Array.isArray(form.autoresponder_attachments) ? form.autoresponder_attachments : [];
  const fileIds = configured
    .map((a) => a?.file_id)
    .filter((id) => typeof id === 'string' && id.length);

  if (fileIds.length > AUTORESPONDER_MAX_FILES) {
    console.warn(`[ctmFormNotifications] autoresponder for form ${form.id} has ${fileIds.length} attachments (cap ${AUTORESPONDER_MAX_FILES}); truncating`);
  }
  const cappedIds = fileIds.slice(0, AUTORESPONDER_MAX_FILES);

  if (cappedIds.length) {
    try {
      const { rows } = await query(
        `SELECT id, original_name, content_type, size_bytes, bytes
           FROM file_uploads
          WHERE id = ANY($1::uuid[])`,
        [cappedIds]
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      let totalBytes = 0;
      for (const id of cappedIds) {
        const row = byId.get(id);
        if (!row) {
          console.warn(`[ctmFormNotifications] autoresponder attachment ${id} not found, skipping`);
          continue;
        }
        const size = Number(row.size_bytes) || (row.bytes ? row.bytes.length : 0);
        if (totalBytes + size > AUTORESPONDER_MAX_TOTAL_BYTES) {
          console.warn(`[ctmFormNotifications] autoresponder for form ${form.id} exceeds ${AUTORESPONDER_MAX_TOTAL_BYTES} bytes; dropping ${row.original_name}`);
          continue;
        }
        totalBytes += size;
        attachments.push({
          data: row.bytes,
          filename: row.original_name,
          contentType: row.content_type || 'application/pdf'
        });
      }
    } catch (err) {
      console.error('[ctmFormNotifications] autoresponder attachment fetch failed:', err.message);
      attachments = [];
    }
  }

  const htmlEmail = wrapClientEmailHtml({
    subject,
    preheader: preheader || subject,
    bodyHtml: renderedBodyHtml || '<p style="margin:0;">Thanks for getting in touch — we received your submission.</p>',
    logoUrl: clientLogoUrl || null
  });
  // Mailgun strips angle brackets from display names automatically.
  const safeFromName = fromName.replace(/[<>"\r\n]/g, '').trim() || 'Anchor Corps';
  const fromAddress = `${safeFromName} <${process.env.MAILGUN_DEFAULT_FROM_ADDRESS || `webforms@${process.env.MAILGUN_DOMAIN || 'mg.anchorcorps.com'}`}>`;

  // Plain-text alternative: always use the raw template (tokens substituted),
  // regardless of body format — strip HTML tags for the text/plain part.
  const textAlternative = (renderTemplate(bodyTpl, fieldData) || 'Thanks for getting in touch — we received your submission.')
    .replace(/<[^>]+>/g, '')
    .trim();

  try {
    await sendMailgunMessageWithLogging(
      {
        to: [recipient],
        from: fromAddress,
        replyTo: replyToList.length ? replyToList : undefined,
        subject,
        html: htmlEmail,
        text: textAlternative,
        attachments: attachments.length ? attachments : undefined
      },
      {
        emailType: 'ctm_form_autoresponder',
        clientId: form.org_id,
        metadata: { formId: form.id, submissionId, attachmentCount: attachments.length },
        skipBodyLogging: true
      }
    );
    console.log(`[ctmFormNotifications] Autoresponder sent for submission ${submissionId} (${attachments.length} attachment(s))`);
  } catch (err) {
    // Never let an autoresponder failure interrupt submission processing.
    console.error('[ctmFormNotifications] autoresponder send failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Email body builders — link-only to prevent PHI in email logs
// ---------------------------------------------------------------------------

/**
 * Build a link-only HTML body (no field values / PHI).
 * Staff must log in to view submission details. For medical clients we add a privacy-redacted
 * lead label (e.g. "S*** M***") so staff can recognize which lead the alert is for without any
 * actual PHI landing in the inbox. `fieldData` is optional — when omitted (e.g. test sends) the
 * lead label is simply skipped.
 */
function buildLinkOnlyBody(form, dashboardUrl, clientName, submissionId, fieldData = null) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const submissionsLink = buildSubmissionUrl(dashboardUrl, {
    clientId: form.org_id,
    submissionId,
    formId: form.id
  });
  const leadLabel = fieldData ? buildRedactedLeadLabel(fieldData) : '';
  return `
    <h2 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 700; color: #0b1f33;">
      New Submission: ${escapeHtml(form.name)}
    </h2>
    ${clientName ? `<p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #2271b1;">${escapeHtml(clientName)}</p>` : ''}
    <p style="margin: 0 0 18px 0; font-size: 13px; color: #6b7280;">
      Received on ${escapeHtml(date)}
    </p>
    ${leadLabel ? `<p style="margin: 0 0 18px 0; font-size: 15px; color: #0b1f33;">
      Lead: <strong>${escapeHtml(leadLabel)}</strong>
      <span style="color: #9ca3af; font-size: 12px;">(redacted for privacy)</span>
    </p>` : ''}
    <p style="margin: 0 0 24px 0; font-size: 15px; color: #0b1f33;">
      A new form submission was received. Log in to the Anchor dashboard to view the details.
    </p>
    <p style="text-align: center; margin: 0 0 24px 0;">
      <a href="${escapeHtml(submissionsLink)}"
         style="display:inline-block;padding:12px 28px;background:#2271b1;color:#fff;border-radius:4px;
                font-size:15px;font-weight:600;text-decoration:none;">
        View Submission
      </a>
    </p>
    <p style="margin: 20px 0 0 0; font-size: 12px; color: #9ca3af; text-align: center;">
      This notification was sent because you are set to receive form submission alerts.
    </p>
  `;
}

/**
 * Convert a snake_case field key to a human-readable label.
 */
function humanize(str) {
  return String(str || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Order submitted fields using the form schema (labels + ordering) when available,
 * falling back to the raw submission keys. Layout-only field types are skipped, and
 * any submitted key not represented in the schema is appended so nothing is dropped.
 * Only used for non-medical clients (no PHI) — see sendSubmissionNotification.
 */
function orderSubmittedFields(form, fieldData = {}) {
  const SKIP_TYPES = new Set(['heading', 'paragraph', 'divider', 'html', 'score_display', 'spacer', 'image', 'hidden']);
  const schemaFields = Array.isArray(form?.config_json?.fields) ? form.config_json.fields : [];
  const valueOf = (v) => (v !== undefined && v !== null && v !== '');

  if (schemaFields.length) {
    const used = new Set();
    const ordered = [];
    for (const f of schemaFields) {
      if (!f) continue;
      const key = sanitizeFieldName(f.name || '');
      // Layout-only / hidden fields must never surface. Mark their key as used so the
      // fallback append loop below can't re-add a submitted value for the same key
      // (hidden inputs often carry internal/default values).
      if (SKIP_TYPES.has(f.type)) {
        if (key) used.add(key);
        continue;
      }
      if (!key || used.has(key) || !valueOf(fieldData[key])) continue;
      used.add(key);
      ordered.push({ key, label: f.label || humanize(key), value: fieldData[key] });
    }
    for (const [k, v] of Object.entries(fieldData)) {
      if (used.has(k) || !valueOf(v)) continue;
      ordered.push({ key: k, label: humanize(k), value: v });
    }
    return ordered;
  }

  return Object.entries(fieldData)
    .filter(([, v]) => valueOf(v))
    .map(([k, v]) => ({ key: k, label: humanize(k), value: v }));
}

/**
 * Build an HTML body that includes the submitted field values in a table.
 * NON-MEDICAL clients only — these submissions contain no PHI.
 */
function buildFieldValuesBody(form, fieldData, dashboardUrl, clientName, submissionId) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const submissionsLink = buildSubmissionUrl(dashboardUrl, {
    clientId: form.org_id,
    submissionId,
    formId: form.id
  });
  const rows = orderSubmittedFields(form, fieldData)
    .map(({ key, label, value }) => {
      let display = Array.isArray(value) ? value.join(', ') : String(value);
      if (isPhoneField(key)) display = formatPhone(display);
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eef2f6;font-weight:600;color:#46596b;width:34%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eef2f6;color:#0b1f33;">${escapeHtml(display)}</td>
      </tr>`;
    })
    .join('');

  return `
    <h2 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 700; color: #0b1f33;">
      New Submission: ${escapeHtml(form.name)}
    </h2>
    ${clientName ? `<p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #2271b1;">${escapeHtml(clientName)}</p>` : ''}
    <p style="margin: 0 0 18px 0; font-size: 13px; color: #6b7280;">
      Received on ${escapeHtml(date)}
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px 0; font-size: 14px;">
      ${rows}
    </table>
    <p style="text-align: center; margin: 0 0 24px 0;">
      <a href="${escapeHtml(submissionsLink)}"
         style="display:inline-block;padding:12px 28px;background:#2271b1;color:#fff;border-radius:4px;
                font-size:15px;font-weight:600;text-decoration:none;">
        View Submission
      </a>
    </p>
    <p style="margin: 20px 0 0 0; font-size: 12px; color: #9ca3af; text-align: center;">
      This notification was sent because you are set to receive form submission alerts.
    </p>
  `;
}

/**
 * Plain text version of the field-values body (non-medical clients only).
 */
function buildFieldValuesText(form, fieldData, dashboardUrl, clientName, submissionId) {
  const prefix = clientName ? `${clientName} — ` : '';
  const submissionsLink = buildSubmissionUrl(dashboardUrl, {
    clientId: form.org_id,
    submissionId,
    formId: form.id
  });
  const lines = orderSubmittedFields(form, fieldData)
    .map(({ key, label, value }) => {
      let display = Array.isArray(value) ? value.join(', ') : String(value);
      if (isPhoneField(key)) display = formatPhone(display);
      return `${label}: ${display}`;
    })
    .join('\n');
  return `${prefix}New Submission: ${form.name}\n\n${lines}\n\nView in dashboard: ${submissionsLink}\n\nSubmitted: ${new Date().toLocaleString()}`;
}

/**
 * Build a link-only plain text version. Mirrors buildLinkOnlyBody: adds the privacy-redacted
 * lead label for medical clients (no PHI). `fieldData` is optional.
 */
function buildLinkOnlyText(form, dashboardUrl, clientName, submissionId, fieldData = null) {
  const prefix = clientName ? `${clientName} — ` : '';
  const submissionsLink = buildSubmissionUrl(dashboardUrl, {
    clientId: form.org_id,
    submissionId,
    formId: form.id
  });
  const leadLabel = fieldData ? buildRedactedLeadLabel(fieldData) : '';
  const leadLine = leadLabel ? `Lead: ${leadLabel} (redacted for privacy)\n\n` : '';
  return `${prefix}New Submission: ${form.name}\n\n${leadLine}A new form submission was received. Log in to the Anchor dashboard to view the details.\n\n${submissionsLink}\n\nSubmitted: ${new Date().toLocaleString()}`;
}
