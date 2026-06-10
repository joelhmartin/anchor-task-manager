// Hub client-journeys routes: /journeys (and lifecycle actions: archive, unarchive,
// stage, email, note, text, schedule/cancel, convert) plus /journey-email-templates.
// Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`. The journey-scheduling
// engine helpers live in hub/_journeys.js; cross-cutting helpers in hub/_shared.js.
import express from 'express';

import { query, getClient } from '../../db.js';
import {
  isValidStage,
  nextStage,
  recordActivity,
  setJourneyStage,
  cancelPendingSends,
  sendJourneyEmailNow,
  sendJourneyTestEmail,
  resolveJourneyReplyTo,
  getJourneyEmailDefaults
} from '../../services/journeyActivities.js';
import { logUserActivity, ActivityEventTypes, ActivityCategories } from '../../services/activityLog.js';
import { createNotification } from '../../services/notifications.js';
import { resolveContact } from '../../services/contacts.js';
import { appendContactServices } from '../../services/contactServices.js';
import { activeOnly } from '../../services/queryHelpers.js';
import {
  JOURNEY_STATUS_OPTIONS,
  normalizeJourneyStatus,
  parseJourneyReplyToInput,
  fetchJourneysForOwner,
  fetchJourneyForOwner,
  ensureJourneyTables
} from './_journeys.js';
import {
  parseDateValue,
  canWriteAccount,
  buildNormalizedPhoneMatchSql,
  resolveLeadCallLink
} from './_shared.js';

const router = express.Router();

// Symptom-list sanitizer (journey-route-only; moved verbatim from hub.js).
function sanitizeSymptomList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Return the subset of catalog service ids not already present (un-redacted) on a
// contact's services ledger, so journey saves don't pile up duplicate contact_services
// rows. Owner-scoped + parameterized. Best-effort: on any error, fall back to the input
// (appendContactServices itself still guards tenant ownership before inserting).
async function filterNewContactServiceIds(contactId, ownerId, serviceIds) {
  const ids = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : [];
  if (!contactId || !ownerId || !ids.length) return [];
  try {
    const { rows } = await query(
      `SELECT service_id FROM contact_services
        WHERE contact_id = $1 AND owner_user_id = $2 AND redacted_at IS NULL
          AND service_id = ANY($3::uuid[])`,
      [contactId, ownerId, ids]
    );
    const have = new Set(rows.map((r) => String(r.service_id)));
    return ids.filter((id) => !have.has(String(id)));
  } catch (err) {
    console.error('[journeys:filterNewContactServiceIds]', { code: err?.code });
    return ids;
  }
}

// After a journey is closed dead (archived/lost), archive its contact too IF the contact has
// nothing else keeping it live: no other live journey and no active (non-archived) active_clients
// row. Owner-scoped, parameterized. Runs on a txn client. Best-effort: never throw.
async function maybeArchiveContactForDeadJourney(exec, contactId, ownerId) {
  if (!contactId || !ownerId) return false;
  try {
    const { rows } = await exec(
      `SELECT 1
         WHERE NOT EXISTS (
           SELECT 1 FROM client_journeys j
            WHERE j.contact_id = $1 AND j.owner_user_id = $2
              AND COALESCE(j.status,'in_progress') NOT IN ('active_client','won','lost','archived','converted'))
           AND NOT EXISTS (
           SELECT 1 FROM active_clients ac
            WHERE ac.contact_id = $1 AND ac.owner_user_id = $2 AND ac.archived_at IS NULL)`,
      [contactId, ownerId]
    );
    if (!rows.length) return false;
    const upd = await exec(
      `UPDATE contacts SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL`,
      [contactId, ownerId]
    );
    return (upd.rowCount || 0) > 0;
  } catch (err) {
    console.error('[journeys:maybeArchiveContactForDeadJourney]', { code: err?.code });
    return false;
  }
}

// When a journey reaches a terminal state, permanently remove that contact's existing
// activities from the Leads inbox (they predate/are within the journey). New post-terminal
// activity is a fresh call_logs row (lead_removed_at NULL) and still shows. Owner-scoped,
// parameterized, best-effort (never throws).
async function markContactActivityRemovedFromLeads(exec, contactId, ownerId, phone) {
  if (!ownerId || (!contactId && !phone)) return 0;
  try {
    const { rowCount } = await exec(
      `UPDATE call_logs
          SET lead_removed_at = COALESCE(lead_removed_at, NOW())
        WHERE (owner_user_id = $1 OR user_id = $1)
          AND lead_removed_at IS NULL
          AND (
            ($2::uuid IS NOT NULL AND contact_id = $2)
            OR ($2::uuid IS NULL AND $3::text IS NOT NULL AND RIGHT(REGEXP_REPLACE(from_number,'[^0-9]','','g'),10) = RIGHT(REGEXP_REPLACE($3,'[^0-9]','','g'),10))
          )`,
      [ownerId, contactId || null, phone || null]
    );
    return rowCount || 0;
  } catch (err) { console.error('[journeys:markContactActivityRemovedFromLeads]', { code: err?.code }); return 0; }
}

// Per-client reusable email templates (replaces the old single journey-template).

/**
 * Validate and sanitize the `attachments` field on journey email templates.
 * Each entry must be { file_id: string, name: string }. Capped at 10 entries.
 * Returns sanitized array or null if invalid.
 */
async function sanitizeTemplateAttachments(raw, ownerId) {
  if (!Array.isArray(raw)) return null;
  if (raw.length > 10) return null;
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.file_id !== 'string' || !item.file_id.trim()) return null;
    if (typeof item.name !== 'string' || !item.name.trim()) return null;
  }
  const shaped = raw.map((item) => ({ file_id: item.file_id.trim(), name: item.name.trim() }));
  if (shaped.length > 0 && ownerId) {
    const fileIds = shaped.map((item) => item.file_id);
    const { rows } = await query(
      `SELECT id FROM file_uploads WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND owner_type = 'user'`,
      [fileIds, String(ownerId)]
    );
    if (rows.length !== fileIds.length) return 'ownership';
  }
  return shaped;
}

router.get('/journey-email-templates', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  try {
    // Lazy-seed the read-only example template for client accounts that don't have
    // it yet (covers brand-new clients on first tab load; existing clients are
    // backfilled by migrate_journey_example_template.sql). Same idempotency rules:
    // created_by IS NULL marks the system seed, and the NOT EXISTS guard counts
    // archived rows so a deleted example never resurrects. Best-effort — a failure
    // here must never break the list.
    await query(
      `INSERT INTO journey_email_templates
              (owner_user_id, name, subject, body, body_format, preheader, created_by)
       SELECT $1, 'Checking In (example)', 'Greetings from {{business_name}}',
         '<p>Hi {{first_name}}, we''re checking to see if there''s anything we can do to assist you. We''re happy to help at any time — please call us back at {{phone}} or email us at {{email}}.</p>',
         'html', 'Just checking in', NULL
        WHERE EXISTS (SELECT 1 FROM client_profiles cp WHERE cp.user_id = $1)
          AND NOT EXISTS (
            SELECT 1 FROM journey_email_templates t
             WHERE t.owner_user_id = $1 AND t.created_by IS NULL
               AND t.name = 'Checking In (example)')`,
      [ownerId]
    ).catch((err) => console.error('[journey-templates:seed-example]', err?.message));

    const { rows } = await query(
      `SELECT id, name, subject, body, body_format, attachments, reply_to,
              preheader, sms_use_email_body, sms_body, sms_opt_out,
              created_at, updated_at
         FROM journey_email_templates
        WHERE owner_user_id = $1 AND archived_at IS NULL
        ORDER BY updated_at DESC`, [ownerId]);
    // Practice-level defaults so the UI can show the read-only From line and prefill
    // Reply-To (template reply_to → these form-notification recipients).
    const meta = await getJourneyEmailDefaults(ownerId).catch(() => ({ from_name: '', from_address: '', default_reply_to: [] }));
    res.json({ templates: rows, meta });
  } catch (err) {
    console.error('[journey-templates:list]', err);
    res.status(500).json({ message: 'Unable to load templates' });
  }
});

router.post('/journey-email-templates', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const {
    name = '', subject = '', body = '', body_format = 'html',
    attachments: rawAttachments,
    preheader: rawPreheader,
    reply_to: rawReplyTo,
    sms_use_email_body: rawSmsUseEmailBody,
    sms_body: rawSmsBody,
    sms_opt_out: rawSmsOptOut
  } = req.body || {};
  if (!name.trim()) return res.status(400).json({ message: 'Template name is required' });
  if (!['html', 'text'].includes(body_format)) return res.status(400).json({ message: 'Invalid format' });
  const attachments = await sanitizeTemplateAttachments(rawAttachments ?? [], ownerId);
  if (attachments === null) {
    return res.status(400).json({ message: 'attachments must be an array of up to 10 objects each with file_id and name strings' });
  }
  if (attachments === 'ownership') {
    return res.status(400).json({ message: 'One or more attachments are not available.' });
  }
  // Validate new fields
  const preheader = rawPreheader != null ? String(rawPreheader).slice(0, 2000) : null;
  const parsedReplyTo = parseJourneyReplyToInput(rawReplyTo);
  if (parsedReplyTo.error) return res.status(400).json({ message: parsedReplyTo.error });
  const replyTo = parsedReplyTo.value;
  const smsUseEmailBody = rawSmsUseEmailBody !== false;
  const smsBody = rawSmsBody != null ? String(rawSmsBody).slice(0, 2000) : null;
  const smsOptOut = rawSmsOptOut != null ? String(rawSmsOptOut).slice(0, 2000) : null;
  try {
    const { rows } = await query(
      `INSERT INTO journey_email_templates
              (owner_user_id, name, subject, body, body_format, attachments, created_by,
               preheader, reply_to, sms_use_email_body, sms_body, sms_opt_out)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, name, subject, body, body_format, attachments, reply_to,
                 preheader, sms_use_email_body, sms_body, sms_opt_out,
                 created_at, updated_at`,
      [ownerId, name.trim(), subject, body, body_format, JSON.stringify(attachments), req.user.id,
       preheader, replyTo, smsUseEmailBody, smsBody, smsOptOut]);
    res.json({ template: rows[0] });
  } catch (err) {
    console.error('[journey-templates:create]', err);
    res.status(500).json({ message: 'Unable to create template' });
  }
});

router.put('/journey-email-templates/:templateId', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { templateId } = req.params;
  const {
    name, subject, body, body_format, attachments: rawAttachments,
    preheader: rawPreheader,
    reply_to: rawReplyTo,
    sms_use_email_body: rawSmsUseEmailBody,
    sms_body: rawSmsBody,
    sms_opt_out: rawSmsOptOut
  } = req.body || {};
  if (body_format && !['html', 'text'].includes(body_format)) {
    return res.status(400).json({ message: 'Invalid format' });
  }
  let attachmentsJson = null;
  if (rawAttachments !== undefined) {
    const sanitized = await sanitizeTemplateAttachments(rawAttachments, ownerId);
    if (sanitized === null) {
      return res.status(400).json({ message: 'attachments must be an array of up to 10 objects each with file_id and name strings' });
    }
    if (sanitized === 'ownership') {
      return res.status(400).json({ message: 'One or more attachments are not available.' });
    }
    attachmentsJson = JSON.stringify(sanitized);
  }
  // Validate and coerce new fields (undefined → pass null → COALESCE is no-op)
  const preheader = rawPreheader !== undefined ? (rawPreheader != null ? String(rawPreheader).slice(0, 2000) : null) : undefined;
  // undefined → no-op (keeps existing); any provided value (incl. []) → set, so a
  // cleared Reply-To falls back to the practice default at send time. Invalid → 400.
  const parsedReplyTo = parseJourneyReplyToInput(rawReplyTo, { allowUndefined: true });
  if (parsedReplyTo.error) return res.status(400).json({ message: parsedReplyTo.error });
  const replyTo = parsedReplyTo.value;
  const smsUseEmailBody = rawSmsUseEmailBody !== undefined ? Boolean(rawSmsUseEmailBody) : undefined;
  const smsBody = rawSmsBody !== undefined ? (rawSmsBody != null ? String(rawSmsBody).slice(0, 2000) : null) : undefined;
  const smsOptOut = rawSmsOptOut !== undefined ? (rawSmsOptOut != null ? String(rawSmsOptOut).slice(0, 2000) : null) : undefined;
  try {
    const { rows } = await query(
      `UPDATE journey_email_templates
          SET name = COALESCE($3,name), subject = COALESCE($4,subject),
              body = COALESCE($5,body), body_format = COALESCE($6,body_format),
              attachments = COALESCE($7::jsonb,attachments),
              preheader = COALESCE($8,preheader),
              reply_to = COALESCE($9::text[],reply_to),
              sms_use_email_body = COALESCE($10::boolean,sms_use_email_body),
              sms_body = COALESCE($11,sms_body),
              sms_opt_out = COALESCE($12,sms_opt_out),
              updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL
        RETURNING id, name, subject, body, body_format, attachments, reply_to,
                  preheader, sms_use_email_body, sms_body, sms_opt_out,
                  created_at, updated_at`,
      [templateId, ownerId,
       name ?? null, subject ?? null, body ?? null, body_format ?? null, attachmentsJson,
       preheader ?? null, replyTo ?? null, smsUseEmailBody ?? null, smsBody ?? null, smsOptOut ?? null]);
    if (!rows.length) return res.status(404).json({ message: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    console.error('[journey-templates:update]', err);
    res.status(500).json({ message: 'Unable to update template' });
  }
});

router.delete('/journey-email-templates/:templateId', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { templateId } = req.params;
  try {
    const { rowCount } = await query(
      `UPDATE journey_email_templates SET archived_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL`, [templateId, ownerId]);
    if (!rowCount) return res.status(404).json({ message: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[journey-templates:delete]', err);
    res.status(500).json({ message: 'Unable to delete template' });
  }
});

// Send a test of the current email draft (subject/body/attachments) to chosen recipients,
// through the exact same render+send path as a real journey touch. Sample lead tokens +
// "[Test] " subject; real account branding resolves. Does NOT create an activity or
// advance any journey. One message per recipient (no cross-exposure of who else got it).
const JOURNEY_TEST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JOURNEY_TEST_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.post('/journey-email-templates/test', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const {
    subject = '',
    body = '',
    body_format = 'html',
    preheader: rawPreheader,
    attachment_file_ids: rawAttachmentIds,
    recipients: rawRecipients
  } = req.body || {};
  const preheader = rawPreheader != null ? String(rawPreheader).slice(0, 2000) : null;
  if (!String(subject).trim() && !String(body).trim()) {
    return res.status(400).json({ message: 'Add a subject or body first.' });
  }
  if (body_format && !['html', 'text'].includes(body_format)) {
    return res.status(400).json({ message: 'Invalid format' });
  }
  // Validate + de-dupe recipients (case-insensitive), cap at 10.
  const recipientsIn = Array.isArray(rawRecipients) ? rawRecipients : [];
  const seen = new Set();
  const recipients = [];
  for (const raw of recipientsIn) {
    const addr = String(raw || '').trim();
    const key = addr.toLowerCase();
    if (!addr || seen.has(key)) continue;
    if (!JOURNEY_TEST_EMAIL_RE.test(addr)) {
      return res.status(400).json({ message: `Not a valid email: ${addr}` });
    }
    seen.add(key);
    recipients.push(addr);
    if (recipients.length >= 10) break;
  }
  if (!recipients.length) {
    return res.status(400).json({ message: 'Add at least one recipient.' });
  }
  // Verify attachment ownership at the boundary (same guard as POST /journeys/:id/email).
  // Validate UUID format up front — the ownership query casts to ::uuid[], which would
  // throw (not 400) on a malformed id since it runs before the try below.
  const attachmentIds = rawAttachmentIds ?? [];
  if (!Array.isArray(attachmentIds) || attachmentIds.some((v) => typeof v !== 'string' || !JOURNEY_TEST_UUID_RE.test(v))) {
    return res.status(400).json({ message: 'attachment_file_ids must be an array of file UUIDs' });
  }
  if (attachmentIds.length > 0) {
    const dedupedIds = [...new Set(attachmentIds)];
    const { rows: ownedFiles } = await query(
      `SELECT id FROM file_uploads WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND owner_type = 'user'`,
      [dedupedIds, String(ownerId)]
    );
    if (ownedFiles.length !== dedupedIds.length) {
      return res.status(400).json({ message: 'One or more attachments are not available.' });
    }
  }
  try {
    let sent = 0;
    const failures = [];
    for (const to of recipients) {
      try {
        await sendJourneyTestEmail({
          ownerUserId: ownerId,
          to,
          subject,
          body,
          bodyFormat: body_format,
          preheader,
          attachmentFileIds: attachmentIds
        });
        sent += 1;
      } catch (err) {
        failures.push({ to, error: String(err?.message || err).slice(0, 200) });
      }
    }
    logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.SEND_JOURNEY_EMAIL,
      actionCategory: ActivityCategories.LEAD,
      targetUserId: ownerId,
      targetEntityType: 'journey_email_template',
      targetEntityId: null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { test: true, recipients: recipients.length, sent }
    }).catch(() => {});
    if (sent === 0) {
      return res.status(502).json({ message: `Test email failed to send: ${failures[0]?.error || 'unknown error'}` });
    }
    return res.json({ sent, failed: failures.length });
  } catch (err) {
    console.error('[journey-templates:test]', err);
    return res.status(500).json({ message: 'Unable to send test email' });
  }
});

router.get('/journeys', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  try {
    await ensureJourneyTables();
    const filters = {};
    if (req.query.archived === 'true') {
      filters.archived = true;
    }
    if (req.query.status && JOURNEY_STATUS_OPTIONS.includes(req.query.status)) {
      filters.status = req.query.status;
    }
    if (req.query.active_client_id) {
      filters.active_client_id = req.query.active_client_id;
    }
    if (req.query.include_archived === 'true') {
      filters.includeArchived = true;
    }
    const journeys = await fetchJourneysForOwner(ownerId, filters);
    res.json({ journeys });
  } catch (err) {
    console.error('[journeys:list]', err);
    res.status(500).json({ message: 'Unable to load client journeys' });
  }
});

router.get('/journeys/:id', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    await ensureJourneyTables();
    const journey = await fetchJourneyForOwner(ownerId, id);
    if (!journey) {
      return res.status(404).json({ message: 'Journey not found' });
    }
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:get]', err);
    res.status(500).json({ message: 'Unable to load journey' });
  }
});

router.post('/journeys', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const {
    lead_call_id,
    active_client_id,
    client_name,
    client_phone,
    client_email,
    symptoms = [],
    status = 'in_progress',
    next_action_at,
    notes_summary,
    service_id,
    services = [], // Catalog service ids selected in the Start/Update Journey dialog → contact_services
    parent_journey_id,
    force_new = false // If true, always create a new journey (for multi-journey support)
  } = req.body || {};

  if (!client_name && !client_phone && !client_email && !lead_call_id && !active_client_id) {
    return res.status(400).json({ message: 'Client name, contact info, or active client is required' });
  }

  const normalizedSymptoms = sanitizeSymptomList(symptoms);
  const symptomsJsonPayload = JSON.stringify(normalizedSymptoms);
  const catalogServiceIds = Array.isArray(services) ? services.filter(Boolean) : [];
  // If no explicit service_id was supplied, fall back to the first catalog service so the
  // journey card still shows a service_name. The contact_services ledger remains the source
  // of truth for the full set selected below.
  const effectiveServiceId = service_id || catalogServiceIds[0] || null;
  const desiredStatus = normalizeJourneyStatus(status, { activeClientId: active_client_id });
  const nextActionAt = parseDateValue(next_action_at);
  const normalizedPhone = String(client_phone || '').trim();

  // If force_new is true, skip the existing journey lookup (allows multiple journeys per client)
  const findExisting = async (callKey, runQuery = query) => {
    if (force_new) return null;

    const params = [ownerId];
    const matchers = [];

    if (callKey) {
      params.push(callKey);
      matchers.push(`lead_call_key = $${params.length}`);
    }
    if (normalizedPhone) {
      params.push(normalizedPhone);
      matchers.push(buildNormalizedPhoneMatchSql('client_phone', `$${params.length}`));
    }
    if (active_client_id) {
      params.push(active_client_id);
      matchers.push(`active_client_id = $${params.length}`);
    }
    if (!matchers.length) return null;

    const { rows } = await runQuery(
      `SELECT id
       FROM client_journeys
       WHERE owner_user_id = $1
         AND ${activeOnly()}
         AND COALESCE(status, 'active') NOT IN ('converted', 'archived')
         AND (${matchers.join(' OR ')})
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      params
    );
    if (rows.length) {
      return rows[0].id;
    }
    return null;
  };

  await ensureJourneyTables();
  const { leadCallKey, leadCallUuid } = await resolveLeadCallLink(ownerId, lead_call_id);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Contact Entity Phase 1: resolve contact_id on the POOL (not this transaction's
    // client). A statement error inside resolveContact would otherwise abort the whole
    // journey transaction (Postgres 25P02) even though resolveContact catches it and
    // returns null. Running on a separate pool connection keeps it independent; the
    // contact row autocommits, which is fine for an append-only identity record.
    const journeyContactId = await resolveContact({ ownerUserId: ownerId, phone: client_phone, email: client_email, name: client_name });
    const journeyId = await findExisting(leadCallKey, client.query.bind(client));
    let resultingId = journeyId;
    let newlyCreatedJourneyId = null;
    let priorJourneyServiceId = null;
    if (journeyId) {
      const prior = await client.query(
        'SELECT service_id FROM client_journeys WHERE id = $1 AND owner_user_id = $2',
        [journeyId, ownerId]
      );
      priorJourneyServiceId = prior.rows[0]?.service_id || null;
      await client.query(
        `UPDATE client_journeys
         SET client_name = COALESCE($1, client_name),
             client_phone = COALESCE($2, client_phone),
             client_email = COALESCE($3, client_email),
             symptoms = $4,
             status = $5,
             next_action_at = COALESCE($6, next_action_at),
             notes_summary = COALESCE($7, notes_summary),
             lead_call_key = COALESCE($8, lead_call_key),
             lead_call_id = COALESCE($9, lead_call_id),
             service_id = COALESCE($10, service_id),
             contact_id = COALESCE(contact_id, $13),
             updated_at = NOW()
         WHERE id = $11 AND owner_user_id = $12`,
        [
          client_name || null,
          client_phone || null,
          client_email || null,
          symptomsJsonPayload,
          desiredStatus,
          nextActionAt,
          notes_summary || null,
          leadCallKey,
          leadCallUuid,
          effectiveServiceId,
          journeyId,
          ownerId,
          journeyContactId
        ]
      );
    } else {
      const insert = await client.query(
        `INSERT INTO client_journeys (
           owner_user_id, lead_call_id, lead_call_key, active_client_id,
           client_name, client_phone, client_email, symptoms,
           status, stage, paused, next_action_at, notes_summary,
           service_id, parent_journey_id, created_by, contact_id
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','first_touch',false,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          ownerId, leadCallUuid, leadCallKey, active_client_id || null,
          client_name || null, client_phone || null, client_email || null, symptomsJsonPayload,
          nextActionAt, notes_summary || null, effectiveServiceId, parent_journey_id || null,
          req.user.id, journeyContactId
        ]
      );
      resultingId = insert.rows[0].id;
      newlyCreatedJourneyId = resultingId;
    }
    if (newlyCreatedJourneyId) {
      await recordActivity(
        {
          journeyId: newlyCreatedJourneyId, ownerId, type: 'stage_change',
          toStage: 'first_touch', stageAt: null, createdBy: req.user.id,
          metadata: { event: 'started' }
        },
        client.query.bind(client)
      );
    }
    await client.query('COMMIT');
    // Append the journey's service-of-interest to the contact's append-only services
    // ledger (best-effort, after-commit on the pool; backfill covers any gaps). Append on
    // a true create, or on an upsert only when the service_id actually changed — so
    // re-saving an existing journey with the same service doesn't add duplicate history.
    const journeyServiceChanged = newlyCreatedJourneyId
      ? Boolean(service_id)
      : Boolean(service_id && service_id !== priorJourneyServiceId);
    if (journeyContactId && journeyServiceChanged) {
      await appendContactServices({
        contactId: journeyContactId,
        ownerUserId: ownerId,
        services: [{ service_id }],
        source: 'journey',
        sourceRefId: resultingId
      });
    }
    // Catalog services selected in the Start/Update Journey dialog → contact's services
    // ledger. Runs on both create and upsert. Skip ids already present (un-redacted) on
    // the contact so re-saving a journey doesn't pile up duplicate ledger rows in the
    // editable Services UI. appendContactServices validates each id against the owner's
    // catalog, snapshots the name, and never throws.
    if (journeyContactId && catalogServiceIds.length) {
      const newServiceIds = await filterNewContactServiceIds(journeyContactId, ownerId, catalogServiceIds);
      if (newServiceIds.length) {
        await appendContactServices({
          contactId: journeyContactId,
          ownerUserId: ownerId,
          services: newServiceIds.map((id) => ({ service_id: id })),
          source: 'journey',
          sourceRefId: resultingId
        });
      }
    }
    if (newlyCreatedJourneyId) {
      logUserActivity({
        userId: req.user.id, actionType: ActivityEventTypes.START_JOURNEY,
        actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
        targetEntityType: 'journey', targetEntityId: newlyCreatedJourneyId,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        details: { journeyId: newlyCreatedJourneyId }
      }).catch(() => {});
    }
    const journey = await fetchJourneyForOwner(ownerId, resultingId);
    if (newlyCreatedJourneyId) {
      try {
        await createNotification({
          userId: ownerId,
          title: 'Lead added to journey',
          body: 'A new journey was started.',
          linkUrl: `/client-hub?journey=${resultingId}`,
          meta: { journey_id: resultingId },
          // In-app only — do not email when a journey is started ("getting started").
          email: false
        });
      } catch (_) {}
    }
    res.json({ journey });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[journeys:create]', err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Unable to save client journey' });
  } finally {
    client.release();
  }
});

router.put('/journeys/:id', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (req.body.client_name !== undefined) {
    fields.push(`client_name = $${paramIndex++}`);
    params.push(req.body.client_name || null);
  }
  if (req.body.client_phone !== undefined) {
    fields.push(`client_phone = $${paramIndex++}`);
    params.push(req.body.client_phone || null);
  }
  if (req.body.client_email !== undefined) {
    fields.push(`client_email = $${paramIndex++}`);
    params.push(req.body.client_email || null);
  }
  if (Array.isArray(req.body.symptoms)) {
    fields.push(`symptoms = $${paramIndex++}`);
    params.push(JSON.stringify(sanitizeSymptomList(req.body.symptoms)));
  }
  // Catalog services selected in the Update Journey dialog. Written to contact_services
  // after commit; also seeds the journey's service_id if it doesn't have one yet so the
  // card shows a service_name.
  const catalogServiceIds = Array.isArray(req.body.services) ? req.body.services.filter(Boolean) : [];
  if (catalogServiceIds.length) {
    fields.push(`service_id = COALESCE(service_id, $${paramIndex++})`);
    params.push(catalogServiceIds[0]);
  }
  if (req.body.status) {
    if (!JOURNEY_STATUS_OPTIONS.includes(req.body.status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    fields.push(`status = $${paramIndex++}`);
    params.push(normalizeJourneyStatus(req.body.status));
  }
  if (req.body.paused !== undefined) {
    fields.push(`paused = $${paramIndex++}`);
    params.push(Boolean(req.body.paused));
  }
  if (req.body.next_action_at !== undefined) {
    fields.push(`next_action_at = $${paramIndex++}`);
    params.push(parseDateValue(req.body.next_action_at));
  }
  if (req.body.notes_summary !== undefined) {
    fields.push(`notes_summary = $${paramIndex++}`);
    params.push(req.body.notes_summary || null);
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'No updates supplied' });
  }

  let client;
  try {
    await ensureJourneyTables();
    client = await getClient();
    await client.query('BEGIN');
    params.push(id);
    params.push(ownerId);
    const result = await client.query(
      `UPDATE client_journeys
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex++} AND owner_user_id = $${paramIndex}
       RETURNING id, contact_id, status, client_phone`,
      params
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Journey not found' });
    }
    // If this update closed the journey dead (lost/archived), cascade-archive the contact
    // when nothing else keeps it live, and permanently stamp the contact's existing
    // activities out of the Leads inbox. Only for dead terminal statuses. Same txn client.
    const resultStatus = result.rows[0].status;
    if (resultStatus === 'lost' || resultStatus === 'archived') {
      await maybeArchiveContactForDeadJourney(
        (text, vals) => client.query(text, vals), result.rows[0].contact_id, ownerId
      );
      await markContactActivityRemovedFromLeads(
        (text, vals) => client.query(text, vals), result.rows[0].contact_id, ownerId, result.rows[0].client_phone
      );
    }
    await client.query('COMMIT');
    const journey = await fetchJourneyForOwner(ownerId, id);
    // Append catalog services to the contact's services ledger (best-effort, never throws).
    // Skip ids already present (un-redacted) so re-saves don't create duplicate rows.
    if (catalogServiceIds.length && journey?.contact_id) {
      const newServiceIds = await filterNewContactServiceIds(journey.contact_id, ownerId, catalogServiceIds);
      if (newServiceIds.length) {
        await appendContactServices({
          contactId: journey.contact_id,
          ownerUserId: ownerId,
          services: newServiceIds.map((sid) => ({ service_id: sid })),
          source: 'journey',
          sourceRefId: id
        });
      }
    }
    res.json({ journey });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('[journeys:update]', err);
    res.status(500).json({ message: 'Unable to update journey' });
  } finally {
    client?.release();
  }
});

router.post('/journeys/:id/archive', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  let client;
  try {
    await ensureJourneyTables();
    client = await getClient();
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE client_journeys
          SET status='archived', stage=NULL, archived_at=COALESCE(archived_at,NOW()),
              next_action_at=NULL, updated_at=NOW()
        WHERE id=$1 AND owner_user_id=$2 RETURNING id, contact_id, client_phone`, [id, ownerId]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Journey not found' });
    }
    // Cascade-archive the contact if this dead journey was the last thing keeping it live,
    // then permanently stamp its existing activities out of the Leads inbox. Same txn client.
    await maybeArchiveContactForDeadJourney(
      (text, vals) => client.query(text, vals), result.rows[0].contact_id, ownerId
    );
    await markContactActivityRemovedFromLeads(
      (text, vals) => client.query(text, vals), result.rows[0].contact_id, ownerId, result.rows[0].client_phone
    );
    await client.query('COMMIT');
    await cancelPendingSends(id);
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ARCHIVE_JOURNEY,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { journeyId: id }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('[journeys:archive]', err);
    res.status(500).json({ message: 'Unable to archive journey' });
  } finally {
    client?.release();
  }
});

router.post('/journeys/:id/unarchive', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  try {
    await ensureJourneyTables();
    const result = await query(
      `UPDATE client_journeys
          SET status='active', stage=COALESCE(stage,'first_touch'), archived_at=NULL, updated_at=NOW()
        WHERE id=$1 AND owner_user_id=$2 RETURNING id`, [id, ownerId]);
    if (!result.rowCount) return res.status(404).json({ message: 'Journey not found' });
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:unarchive]', err);
    res.status(500).json({ message: 'Unable to restore journey' });
  }
});

// Task 8 — manual stage move
router.patch('/journeys/:id/stage', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  const { stage } = req.body || {};
  if (!isValidStage(stage)) {
    return res.status(400).json({ message: 'Invalid stage' });
  }
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT stage FROM client_journeys
        WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`,
      [id, ownerId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    const fromStage = rows[0].stage;
    const expected = nextStage(fromStage);
    // Reject if not a single-step-forward advance, or if already at the last stage
    if (!expected || fromStage === expected || stage !== expected) {
      return res.status(400).json({ message: `Journey can only advance to ${fromStage === expected ? 'no further stage' : expected}` });
    }
    await setJourneyStage(id, ownerId, stage);
    await recordActivity({
      journeyId: id, ownerId, type: 'stage_change',
      stageAt: fromStage, toStage: stage, createdBy: req.user.id
    });
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ADVANCE_JOURNEY_STAGE,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      details: { from: fromStage, to: stage }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:stage]', err);
    res.status(500).json({ message: 'Unable to move journey' });
  }
});

// Task 9 — send email now or schedule (does NOT advance the stage; staff advance manually)
router.post('/journeys/:id/email', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  const {
    template_id = null,
    subject = '',
    body = '',
    body_format = 'html',
    scheduled_for = null,
    attachment_file_ids: rawAttachmentIds,
    preheader: rawPreheader,
    reply_to: rawReplyTo
  } = req.body || {};
  const preheader = rawPreheader != null ? String(rawPreheader).slice(0, 2000) : null;
  if (!subject.trim() && !body.trim()) {
    return res.status(400).json({ message: 'Email needs a subject or body' });
  }
  // Validate attachment_file_ids: must be an array of strings (UUIDs)
  const attachmentIds = rawAttachmentIds ?? [];
  if (!Array.isArray(attachmentIds) || attachmentIds.some((v) => typeof v !== 'string')) {
    return res.status(400).json({ message: 'attachment_file_ids must be an array of strings' });
  }
  // Verify attachment ownership at the boundary before any DB mutation
  if (attachmentIds.length > 0) {
    const dedupedIds = [...new Set(attachmentIds)];
    const { rows: ownedFiles } = await query(
      `SELECT id FROM file_uploads WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND owner_type = 'user'`,
      [dedupedIds, String(ownerId)]
    );
    if (ownedFiles.length !== dedupedIds.length) {
      return res.status(400).json({ message: 'One or more attachments are not available.' });
    }
  }
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT * FROM client_journeys WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`,
      [id, ownerId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    const journey = rows[0];

    // Recipient email. The raw client_journeys.client_email is empty for most journeys
    // (they're created phone-first), but the drawer shows a RESOLVED email — the contact's
    // primary_email, then phone-matched client/call — via fetchJourneysForOwner. Resolve the
    // same way here so a send goes to exactly what's displayed; otherwise sendJourneyEmailNow
    // throws "Lead has no valid email address" and the send silently fails.
    if (!String(journey.client_email || '').trim()) {
      const shaped = await fetchJourneyForOwner(ownerId, id); // returns resolved client_email
      journey.client_email = String(shaped?.client_email || '').trim();
    }
    if (!String(journey.client_email || '').trim()) {
      return res.status(400).json({ message: 'This lead has no email on file. Add an email to the contact, then send.' });
    }

    // Resolve Reply-To: per-send override → template's reply_to → practice default
    // (client_profiles.form_notification_emails). Persisted on the activity metadata so
    // a scheduled send fires with the same Reply-To that was resolved at compose time.
    let templateReplyTo = null;
    if (template_id) {
      try {
        const { rows: tpl } = await query(
          `SELECT reply_to FROM journey_email_templates WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL`,
          [template_id, ownerId]
        );
        templateReplyTo = tpl[0]?.reply_to || null;
      } catch { /* non-fatal — fall through to practice default */ }
    }
    const parsedOverride = parseJourneyReplyToInput(rawReplyTo, { allowUndefined: true });
    if (parsedOverride.error) return res.status(400).json({ message: parsedOverride.error });
    const replyTo = await resolveJourneyReplyTo({
      ownerUserId: ownerId,
      override: parsedOverride.value,
      templateReplyTo
    });

    if (scheduled_for) {
      const when = new Date(scheduled_for);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Schedule time must be in the future' });
      }
      await cancelPendingSends(id);
      await recordActivity({
        journeyId: id, ownerId, type: 'email', stageAt: journey.stage,
        subject, body, bodyFormat: body_format, templateId: template_id,
        scheduledFor: when.toISOString(), emailStatus: 'scheduled', createdBy: req.user.id,
        // Persist the resolved recipient so the deferred send doesn't re-derive from the
        // (often empty) raw client_email and silently fail.
        metadata: { attachment_file_ids: attachmentIds, preheader: preheader || null, reply_to: replyTo, recipient_email: journey.client_email }
      });
      logUserActivity({
        userId: req.user.id, actionType: ActivityEventTypes.SEND_JOURNEY_EMAIL,
        actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
        targetEntityType: 'journey', targetEntityId: id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        details: { scheduled: true, templateId: template_id || null }
      }).catch(() => {});
    } else {
      const activity = await recordActivity({
        journeyId: id, ownerId, type: 'email', stageAt: journey.stage,
        subject, body, bodyFormat: body_format, templateId: template_id,
        emailStatus: 'sent', createdBy: req.user.id,
        metadata: { attachment_file_ids: attachmentIds, preheader: preheader || null, reply_to: replyTo }
      });
      try {
        await sendJourneyEmailNow({
          journey, subject, body, bodyFormat: body_format,
          activityId: activity.id, attachmentFileIds: attachmentIds, preheader, replyTo
        });
      } catch (sendErr) {
        await query(`UPDATE client_journey_activities SET email_status='failed', email_error=$2 WHERE id=$1`,
          [activity.id, String(sendErr.message || sendErr).slice(0, 500)]);
        return res.status(502).json({ message: `Email failed to send: ${sendErr.message}` });
      }
      // Sending a journey email no longer auto-advances the stage. Staff move the
      // journey to the next stage manually via the stage controls.
      logUserActivity({
        userId: req.user.id, actionType: ActivityEventTypes.SEND_JOURNEY_EMAIL,
        actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
        targetEntityType: 'journey', targetEntityId: id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        details: { scheduled: false, templateId: template_id || null }
      }).catch(() => {});
    }
    const journeyOut = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey: journeyOut });
  } catch (err) {
    console.error('[journeys:email]', err);
    res.status(500).json({ message: 'Unable to send email' });
  }
});

// Task 11 — add a note (no advance)
router.post('/journeys/:id/note', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  const { body = '' } = req.body || {};
  if (!body.trim()) return res.status(400).json({ message: 'Note body is required' });
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT stage FROM client_journeys WHERE id=$1 AND owner_user_id=$2`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    await recordActivity({ journeyId: id, ownerId, type: 'note', stageAt: rows[0].stage,
      body, createdBy: req.user.id });
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ADD_JOURNEY_NOTE,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { journeyId: id }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:note]', err);
    res.status(500).json({ message: 'Unable to add note' });
  }
});

// Task 12 — gated SMS stub (records intent, never dispatches)
router.post('/journeys/:id/text', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  const enabled = process.env.JOURNEY_SMS_ENABLED === 'true';
  const { body = '', scheduled_for = null } = req.body || {};
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT stage FROM client_journeys WHERE id=$1 AND owner_user_id=$2 AND status='active'`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    if (!enabled) {
      await recordActivity({ journeyId: id, ownerId, type: 'text', stageAt: rows[0].stage,
        body: body || null, scheduledFor: scheduled_for || null, emailStatus: 'skipped',
        createdBy: req.user.id, metadata: { gated: true } });
      const journey = await fetchJourneyForOwner(ownerId, id);
      return res.status(200).json({ journey, gated: true, message: 'SMS is not enabled yet' });
    }
    return res.status(501).json({ message: 'SMS dispatch not implemented' });
  } catch (err) {
    console.error('[journeys:text]', err);
    res.status(500).json({ message: 'Unable to record text' });
  }
});

// Task 13 — cancel pending scheduled send
router.post('/journeys/:id/schedule/cancel', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT id FROM client_journeys WHERE id=$1 AND owner_user_id=$2`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    await cancelPendingSends(id);
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:schedule-cancel]', err);
    res.status(500).json({ message: 'Unable to cancel scheduled send' });
  }
});

// Task 15 — close a journey as converted (the active_clients row itself is created
// by the existing agree-to-service flow the UI calls).
router.post('/journeys/:id/convert', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  if (!canWriteAccount(req)) return res.status(403).json({ message: 'Forbidden' });
  const { id } = req.params;
  const { active_client_id = null } = req.body || {};
  try {
    await ensureJourneyTables();
    const result = await query(
      `UPDATE client_journeys
          SET status='converted', stage=NULL, next_action_at=NULL,
              active_client_id=COALESCE($3, active_client_id), updated_at=NOW()
        WHERE id=$1 AND owner_user_id=$2 RETURNING id, contact_id, client_phone`, [id, ownerId, active_client_id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Journey not found' });
    // Converted journeys become clients → drop their existing activities out of the Leads
    // inbox. Plain (non-txn) query is fine here; the helper is idempotent/best-effort.
    await markContactActivityRemovedFromLeads(
      query, result.rows[0].contact_id, ownerId, result.rows[0].client_phone
    );
    await cancelPendingSends(id);
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.CONVERT_TO_CLIENT,
      actionCategory: ActivityCategories.CLIENT, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { journeyId: id }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:convert]', err);
    res.status(500).json({ message: 'Unable to convert journey' });
  }
});

async function ensureJourneyOwnership(journeyId, ownerId) {
  await ensureJourneyTables();
  const { rows } = await query(`SELECT id FROM client_journeys WHERE id = $1 AND owner_user_id = $2 AND ${activeOnly()} LIMIT 1`, [journeyId, ownerId]);
  return rows.length > 0;
}

export default router;
