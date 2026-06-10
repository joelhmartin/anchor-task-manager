/**
 * Journey activity + stage helpers (redesigned lead journey).
 * Single source of truth for the fixed stage order and for recording touches.
 * No PHI in logs. All callers pass the real acting user as createdBy.
 */
import { query } from '../db.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured, getMailgunFromAddress } from './mailgun.js';
import { isNonMedicalClient } from './clientType.js';
import { wrapClientEmailHtml, plainTextToParagraphs } from './emailTemplate.js';
import { renderTemplate } from './ctmFormNotifications.js';

export const JOURNEY_STAGES = ['first_touch', 'second_touch', 'third_touch', 'fourth_touch', 'awaiting_decision'];
export const JOURNEY_STAGE_LABELS = {
  first_touch: 'First Touch',
  second_touch: 'Second Touch',
  third_touch: 'Third Touch',
  fourth_touch: 'Fourth Touch',
  awaiting_decision: 'Awaiting Decision'
};
export const ACTIVITY_TYPES = ['email', 'call', 'text', 'note', 'stage_change'];

/** Next stage after a completed touch; clamps at awaiting_decision. */
export function nextStage(stage) {
  const i = JOURNEY_STAGES.indexOf(stage);
  if (i < 0) return 'first_touch';
  return JOURNEY_STAGES[Math.min(i + 1, JOURNEY_STAGES.length - 1)];
}

export function isValidStage(stage) {
  return JOURNEY_STAGES.includes(stage);
}

/**
 * Insert one activity row. Returns the created row (raw).
 * runQuery lets callers pass a transaction client.
 */
export async function recordActivity(
  {
    journeyId,
    ownerId,
    type,
    stageAt = null,
    toStage = null,
    subject = null,
    body = null,
    bodyFormat = 'text',
    templateId = null,
    scheduledFor = null,
    emailStatus = null,
    createdBy = null,
    metadata = {}
  },
  runQuery = query
) {
  const { rows } = await runQuery(
    `INSERT INTO client_journey_activities
       (journey_id, owner_user_id, type, stage_at, to_stage, subject, body, body_format,
        template_id, scheduled_for, email_status, created_by, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      journeyId,
      ownerId,
      type,
      stageAt,
      toStage,
      subject,
      body,
      bodyFormat,
      templateId,
      scheduledFor,
      emailStatus,
      createdBy,
      JSON.stringify(metadata || {})
    ]
  );
  return rows[0];
}

/** Move a journey to a stage (used by manual moves and by touch advancement). */
export async function setJourneyStage(journeyId, ownerId, stage, runQuery = query) {
  await runQuery(
    `UPDATE client_journeys SET stage = $3, updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2`,
    [journeyId, ownerId, stage]
  );
}

/** Fetch + shape the activity timeline for one journey (newest first). */
export async function fetchJourneyActivities(journeyId, runQuery = query) {
  const { rows } = await runQuery(
    `SELECT a.*, u.first_name, u.last_name, u.email
       FROM client_journey_activities a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.journey_id = $1
      ORDER BY a.created_at DESC`,
    [journeyId]
  );
  return rows.map(shapeActivity);
}

export function shapeActivity(a) {
  const authorName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || null;
  return {
    id: a.id,
    type: a.type,
    stage_at: a.stage_at,
    to_stage: a.to_stage,
    subject: a.subject || '',
    body: a.body || '',
    body_format: a.body_format || 'text',
    template_id: a.template_id,
    scheduled_for: a.scheduled_for,
    email_status: a.email_status,
    email_error: a.email_error,
    created_by: a.created_by,
    author_name: authorName,
    created_at: a.created_at,
    metadata: a.metadata || {}
  };
}

/** Cancel a journey's pending scheduled sends (used by cancel endpoint + convert/archive). */
export async function cancelPendingSends(journeyId, runQuery = query) {
  await runQuery(
    `UPDATE client_journey_activities
        SET email_status = 'canceled'
      WHERE journey_id = $1 AND email_status = 'scheduled'`,
    [journeyId]
  );
}

const isValidEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const firstNameOf = (full) => (full ? String(full).trim().split(/\s+/)[0] || '' : '');

async function resolveClientBranding(ownerUserId) {
  let businessName = '',
    logoUrl = '';
  try {
    const { rows } = await query(
      `SELECT business_name, logos FROM brand_assets WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [ownerUserId]
    );
    businessName = rows[0]?.business_name || '';
    let logos = rows[0]?.logos;
    if (typeof logos === 'string') {
      try {
        logos = JSON.parse(logos);
      } catch {
        logos = [];
      }
    }
    if (Array.isArray(logos) && logos.length) {
      const first = logos.find((l) => l?.url && String(l.url).trim());
      if (first) logoUrl = String(first.url).trim();
    }
  } catch {}

  // Owner business-contact info for the {{business_name}} / {{phone}} / {{email}}
  // tokens (the CLIENT's own info so the lead can reach them — distinct from the
  // {{client_*}} tokens, which are the lead's). Business name follows the
  // CLAUDE.md canonical order: client_identifier_value → brand_assets.business_name
  // → user name. Phone/email are the client-provided contact fields.
  let identifierName = '',
    ownerPhone = '',
    ownerEmail = '',
    userName = '';
  try {
    const { rows } = await query(
      `SELECT cp.client_identifier_value, cp.call_tracking_main_number, cp.office_admin_email,
              u.first_name, u.last_name
         FROM users u
         LEFT JOIN client_profiles cp ON cp.user_id = u.id
        WHERE u.id = $1
        LIMIT 1`,
      [ownerUserId]
    );
    if (rows[0]) {
      identifierName = (rows[0].client_identifier_value || '').trim();
      ownerPhone = (rows[0].call_tracking_main_number || '').trim();
      ownerEmail = (rows[0].office_admin_email || '').trim();
      userName = [rows[0].first_name, rows[0].last_name].filter(Boolean).join(' ').trim();
    }
  } catch {}
  const tokenBusinessName = identifierName || businessName || userName || '';

  return { businessName, identifierName, logoUrl, tokenBusinessName, ownerPhone, ownerEmail };
}

const REPLY_TO_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function dedupeValidEmails(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const t = String(v || '').trim();
    if (t && REPLY_TO_EMAIL_RE.test(t) && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/**
 * Resolve the Reply-To list for a journey email. Precedence:
 *   override (per-email, from the send dialog) → template's reply_to →
 *   the practice's global form-notification recipients
 *   (client_profiles.form_notification_emails).
 * Returns a de-duplicated array of valid emails (possibly empty).
 */
export async function resolveJourneyReplyTo({ ownerUserId, override = null, templateReplyTo = null }) {
  const ov = dedupeValidEmails(override);
  if (ov.length) return ov;
  const tpl = dedupeValidEmails(templateReplyTo);
  if (tpl.length) return tpl;
  try {
    const { rows } = await query(
      `SELECT form_notification_emails FROM client_profiles WHERE user_id = $1 LIMIT 1`,
      [ownerUserId]
    );
    // A missing row / unconfigured recipients is a legitimate empty default.
    return dedupeValidEmails(rows[0]?.form_notification_emails || []);
  } catch (err) {
    // Surface the failure (no PHI — code only) so a broken default-Reply-To lookup is
    // visible in logs instead of silently sending with no Reply-To. We still return []
    // rather than rethrow: a transient DB blip must not block a patient-facing send.
    console.error('[resolveJourneyReplyTo] default lookup failed', { code: err?.code });
    return [];
  }
}

/**
 * The display-only From name + the resolved default Reply-To for a practice, so the
 * UI can show "Sending as <name> <noreply…>" and prefill the Reply-To field.
 */
export async function getJourneyEmailDefaults(ownerUserId) {
  const { businessName, identifierName } = await resolveClientBranding(ownerUserId);
  const fromAddress = process.env.MAILGUN_DEFAULT_FROM_ADDRESS || getMailgunFromAddress() || '';
  const fromName = (businessName || identifierName || 'Anchor').replace(/[<>"\r\n]/g, '').trim();
  const defaultReplyTo = await resolveJourneyReplyTo({ ownerUserId });
  return { from_name: fromName, from_address: fromAddress, default_reply_to: defaultReplyTo };
}

// HTML tag allowlist — the elements the RichTextEditor (CKEditor) actually emits. Used to
// decide whether a body is HTML even when its stored body_format says 'text' (journey
// email bodies are authored as HTML, and client_journey_activities.body_format defaults to
// 'text' at the DB level). Deliberately NOT "any <…>", so genuine plain-text prose like
// "Reply with <YES>" or "Use <Account Name>" stays plain text instead of being mangled by
// email clients. Scoped to journey emails — CTM autoresponders keep an honest text/html
// toggle and must still escape plain text.
const JOURNEY_EMAIL_HTML_TAG =
  /<\/?(?:p|br|hr|div|span|a|ul|ol|li|strong|em|b|i|u|s|h[1-6]|img|table|thead|tbody|tr|td|th|blockquote|figure|figcaption|pre|code|sub|sup)\b[^>]*>/i;

// Synthetic lead tokens for template test sends (no real lead exists). Business-facing
// tokens (business_name/phone/email) and the logo still resolve from the real account
// branding, so the test looks authentic.
const SAMPLE_TEST_TOKENS = {
  client_name: 'Jane Doe',
  first_name: 'Jane',
  client_email: 'jane.doe@example.com',
  client_phone: '(555) 123-4567'
};

/**
 * Shared render + send core for client-facing journey emails. Resolves the owner's
 * branding, builds the token map (caller `leadTokens` merged with branding-derived
 * business_name/phone/email), renders subject/body/preheader (HTML-aware), wraps in the
 * client email shell, attaches owner-scoped files, and sends via Mailgun (logged,
 * body redacted). Both real touches (`sendJourneyEmailNow`) and template tests
 * (`sendJourneyTestEmail`) go through here so a test can never drift from production.
 * Returns the Mailgun response. Throws on failure.
 */
async function renderAndSendJourneyEmail({
  ownerUserId,
  to,
  subject,
  body,
  bodyFormat = 'html',
  preheader = null,
  attachmentFileIds = [],
  leadTokens = {},
  subjectPrefix = '',
  replyTo = null,
  logging = {}
}) {
  if (!isMailgunConfigured()) throw new Error('Mailgun is not configured');
  if (!to || !isValidEmail(to)) throw new Error('No valid recipient email address');

  const { businessName, identifierName, logoUrl, tokenBusinessName, ownerPhone, ownerEmail } = await resolveClientBranding(ownerUserId);
  const tokens = {
    // Lead's own info (recipient). For real sends these come from the journey; for tests
    // they're synthetic sample values.
    client_name: leadTokens.client_name || '',
    first_name: leadTokens.first_name || firstNameOf(leadTokens.client_name || ''),
    client_email: leadTokens.client_email || '',
    client_phone: leadTokens.client_phone || '',
    // The client's own business info (so the lead can reach them). Missing values
    // resolve to '' rather than leaving a literal {{token}} in the email.
    business_name: tokenBusinessName || '',
    phone: ownerPhone || '',
    email: ownerEmail || ''
  };

  const renderedSubjectBody = renderTemplate(subject || '', tokens);
  if (!renderedSubjectBody.trim()) throw new Error('Email subject is empty');
  const renderedSubject = `${subjectPrefix}${renderedSubjectBody}`;

  const renderAsHtml = bodyFormat === 'html' || JOURNEY_EMAIL_HTML_TAG.test(body || '');
  const bodyHtml = renderAsHtml ? renderTemplate(body || '', tokens) : renderTemplate(plainTextToParagraphs(body || ''), tokens);
  const renderedPreheader = preheader ? renderTemplate(preheader, tokens) : '';

  // From display name: prefer the brand-asset business name, then the canonical
  // practice identifier (CLAUDE.md canonical client name), then 'Anchor'. The from
  // ADDRESS stays the Anchor noreply (deliverability/DKIM) — only the display name
  // reflects the practice. Reply-To (below) is what routes replies to the practice.
  const fromName = (businessName || identifierName || 'Anchor').replace(/[<>"\r\n]/g, '').trim();
  const fromAddress = process.env.MAILGUN_DEFAULT_FROM_ADDRESS || getMailgunFromAddress();
  if (!fromAddress) throw new Error('Mailgun From address is not configured');

  const htmlEmail = wrapClientEmailHtml({
    subject: renderedSubject,
    preheader: renderedPreheader || renderedSubject,
    bodyHtml: bodyHtml || '<p style="margin:0;">.</p>',
    logoUrl: logoUrl || null
  });

  // Fetch owner-scoped attachments. A file must belong to the owner (owner_type='user',
  // owner_id=ownerUserId) — prevents cross-client file access.
  let mailgunAttachments = [];
  if (Array.isArray(attachmentFileIds) && attachmentFileIds.length > 0) {
    const { rows: fileRows } = await query(
      `SELECT id, original_name, content_type, bytes
         FROM file_uploads
        WHERE id = ANY($1::uuid[])
          AND owner_id = $2
          AND owner_type = 'user'`,
      [attachmentFileIds, String(ownerUserId)]
    );
    if (fileRows.length !== attachmentFileIds.length) {
      console.warn(
        `[journeyActivities] attachment mismatch: requested=${attachmentFileIds.length} found=${fileRows.length} (owner=${ownerUserId})`
      );
    }
    mailgunAttachments = fileRows.map((row) => ({
      data: row.bytes,
      filename: row.original_name,
      contentType: row.content_type || 'application/octet-stream'
    }));
  }

  // Persist the rendered body ONLY for non-medical clients (fail-closed): for medical clients
  // the body may contain PHI, so it's never stored in email_logs. For non-medical clients the
  // body is retained so it's viewable in the portal, then auto-redacted after 30 days by the
  // [cron:redact-email-bodies] sweep in server/index.js.
  const storeBody = await isNonMedicalClient(ownerUserId);

  return sendMailgunMessageWithLogging(
    {
      to: [to],
      subject: renderedSubject,
      html: htmlEmail,
      from: `${fromName} <${fromAddress}>`,
      ...(Array.isArray(replyTo) && replyTo.length ? { replyTo } : (replyTo ? { replyTo } : {})),
      ...(mailgunAttachments.length > 0 ? { attachments: mailgunAttachments } : {})
    },
    {
      emailType: logging.emailType || 'journey_touch_email',
      recipientName: logging.recipientName || undefined,
      clientId: ownerUserId,
      metadata: logging.metadata || {},
      skipBodyLogging: !storeBody
    }
  );
}

/**
 * Render + send one journey email immediately. Throws on failure.
 * Tokens are non-PHI only (client_name/first_name/email/phone). Body is stored only for
 * non-medical clients (then redacted after 30 days); medical clients are never stored.
 * `journey` must include id, owner_user_id, client_name, client_email, client_phone.
 * `attachmentFileIds` is an optional array of file_uploads UUIDs; files are fetched
 * owner-scoped so a client can never attach files they don't own.
 */
export async function sendJourneyEmailNow({
  journey,
  subject,
  body,
  bodyFormat = 'html',
  activityId,
  attachmentFileIds = [],
  preheader = null,
  replyTo = null
}) {
  if (!journey.client_email || !isValidEmail(journey.client_email)) {
    throw new Error('Lead has no valid email address');
  }
  return renderAndSendJourneyEmail({
    ownerUserId: journey.owner_user_id,
    to: journey.client_email,
    subject,
    body,
    bodyFormat,
    preheader,
    attachmentFileIds,
    replyTo,
    leadTokens: {
      client_name: journey.client_name || '',
      first_name: firstNameOf(journey.client_name || ''),
      client_email: journey.client_email || '',
      client_phone: journey.client_phone || ''
    },
    logging: {
      emailType: 'journey_touch_email',
      recipientName: journey.client_name || undefined,
      metadata: { journey_id: journey.id, activity_id: activityId }
    }
  });
}

/**
 * Send a test of a journey email draft/template to one recipient, through the exact same
 * render+send path as a real touch. Uses synthetic sample lead tokens and a "[Test] "
 * subject prefix; real account branding (business name, phone, email, logo) still
 * resolves so the preview is faithful. Does NOT create an activity row or advance a stage.
 */
export async function sendJourneyTestEmail({
  ownerUserId,
  to,
  subject,
  body,
  bodyFormat = 'html',
  preheader = null,
  attachmentFileIds = [],
  replyTo = null
}) {
  if (!to || !isValidEmail(to)) throw new Error('No valid recipient email address');
  return renderAndSendJourneyEmail({
    ownerUserId,
    to,
    subject,
    body,
    bodyFormat,
    preheader,
    attachmentFileIds,
    replyTo,
    leadTokens: SAMPLE_TEST_TOKENS,
    subjectPrefix: '[Test] ',
    logging: {
      emailType: 'journey_test_email',
      recipientName: 'Test recipient',
      metadata: { test: true }
    }
  });
}
