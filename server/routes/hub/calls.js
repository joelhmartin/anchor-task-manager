// /calls route handlers + their /calls-only helpers, extracted verbatim from hub.js.
// Mounted on the hub router (after requireAuth) via router.use(callsRouter) — no auth
// middleware here; the gate is inherited from the parent router.
import express from 'express';
import axios from 'axios';
import { query, getClient } from '../../db.js';
import { activeOnly } from '../../services/queryHelpers.js';
import { logSecurityEvent, SecurityEventTypes, SecurityEventCategories } from '../../services/security/index.js';
import { logUserActivity, ActivityEventTypes, ActivityCategories } from '../../services/activityLog.js';
import { sendEvent as sendTrackingEvent } from '../../services/trackingRelay.js';
import { requireAdmin } from '../../middleware/auth.js';
import {
  DEFAULT_AI_PROMPT,
  pullCallsFromCtm,
  buildCallsFromCache,
  postSaleToCTM,
  fetchCtmActivityDetails,
  getAutoStarRating,
  enrichCallerType,
  buildSystemTags,
  normalizePhoneNumber,
  resolveCtmCreds
} from '../../services/ctm.js';
import { applyContactTags } from '../../services/contactTags.js';
import { upsertCallLog, callLogsHasContactId } from '../../services/callLogUpsert.js';
import { createNotification } from '../../services/notifications.js';
import { logEvent } from '../../services/hubUtils.js';
import { ensureActiveClientArchiveColumn } from './_shared.js';
import { normalizeJourneyStatus, attachJourneyMetaToCalls } from './_journeys.js';
import { isReservedTagName } from './_callHelpers.js';

const router = express.Router();

// Internal classifier labels that collapse to the "Lead" chip in the UI and
// should fire the qualified_call tracking relay (GA4 / Meta CAPI / Google Ads).
// Mirrors VISIBLE_CATEGORY_MAP[*]==='lead' on the frontend.
const QUALIFIED_LEAD_CATEGORIES = new Set([
  'warm',
  'very_good',
  'good',
  'hot',
  'very_hot',
  'needs_attention',
  'converted'
]);

// The server binds the port BEFORE migrations run (Cloud Run health-check gotcha), so right
// after a deploy /calls can be hit before the migration that adds call_logs.lead_removed_at
// has landed — querying that column would 500 the leads list with undefined_column (42703).
// Memoize a one-time information_schema probe: until the column exists we SKIP the
// lead_removed_at filter (harmless — nothing is stamped until the column exists anyway).
// Once seen the flag latches true and costs nothing per request. A failed probe is treated
// as not-ready (re-checked next request) and never crashes the handler.
let leadRemovedColReady = false;
async function ensureLeadRemovedCol() {
  if (leadRemovedColReady) return;
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'call_logs' AND column_name = 'lead_removed_at' LIMIT 1`
    );
    if (rows.length) leadRemovedColReady = true;
  } catch {
    // Not-ready; leave the flag false so we re-probe on the next request.
  }
}

/**
 * Post-sync: fix caller_type and call_sequence for all call_logs belonging to a user.
 * During bulk sync, enrichCallerType can't see sibling rows being inserted in the same
 * Promise.all batch, so repeat/returning callers end up marked as 'new'.
 * This runs a single SQL pass after all inserts are done.
 */
async function fixCallerTypesPostSync(userId) {
  // Probe once — contact_id may not exist yet during the startup window before
  // ensureContactIdColumnsExist runs. Fall back to phone-only partition so the
  // window fn never throws undefined_column (42703).
  const hasContactId = await callLogsHasContactId(query);
  // Phone fallback only groups numbers with >= 7 usable digits (matches enrichCallerType's
  // phoneUsable threshold); shorter/garbage numbers fall back to the row id so they each form
  // their own partition and are never falsely marked repeat.
  const phoneKey = `CASE WHEN LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) >= 7
                    THEN RIGHT(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g'), 10) ELSE id::text END`;
  const partitionExpr = hasContactId ? `COALESCE(contact_id::text, ${phoneKey})` : phoneKey;
  const whereExpr = hasContactId ? '(from_number IS NOT NULL OR contact_id IS NOT NULL)' : 'from_number IS NOT NULL';

  // 1. Mark repeat callers: phone numbers with >1 call_logs row that aren't
  //    already active_client or returning_customer
  await query(
    `UPDATE call_logs cl
     SET caller_type = 'repeat',
         call_sequence = sub.seq
     FROM (
       SELECT id,
              ROW_NUMBER() OVER (PARTITION BY ${partitionExpr}
                                 ORDER BY started_at ASC) AS seq
       FROM call_logs
       WHERE (owner_user_id = $1 OR user_id = $1)
         AND ${whereExpr}
     ) sub
     WHERE cl.id = sub.id
       AND sub.seq > 1
       AND cl.caller_type = 'new'`,
    [userId]
  );

  // 2. Also fix call_sequence for first-occurrence rows (seq = 1) that may have wrong sequence
  await query(
    `UPDATE call_logs cl
     SET call_sequence = 1
     FROM (
       SELECT id,
              ROW_NUMBER() OVER (PARTITION BY ${partitionExpr}
                                 ORDER BY started_at ASC) AS seq
       FROM call_logs
       WHERE (owner_user_id = $1 OR user_id = $1)
         AND ${whereExpr}
     ) sub
     WHERE cl.id = sub.id
       AND sub.seq = 1
       AND cl.call_sequence != 1
       AND cl.caller_type = 'new'`,
    [userId]
  );
}

function stripCtmMediaMeta(meta = {}) {
  const next = { ...(meta || {}) };
  delete next.recording_url;
  delete next.assets;
  return next;
}

async function resolveCallRecording(targetUserId, callId) {
  const callRes = await query(
    `SELECT provider, activity_type, recording_url, meta
       FROM call_logs
      WHERE call_id = $1
        AND (owner_user_id = $2 OR user_id = $2)
      LIMIT 1`,
    [callId, targetUserId]
  );

  if (!callRes.rows.length) {
    return { status: 404, message: 'Lead not found' };
  }

  const row = callRes.rows[0];
  const provider = row.provider || 'ctm';
  const activityType = row.activity_type || row.meta?.activity_type || 'call';
  const cachedRecordingUrl = row.recording_url || row.meta?.recording_url || row.meta?.assets?.[0]?.url || null;

  if (activityType !== 'call') {
    return { status: 404, message: 'No recording available for this activity' };
  }

  if (provider === 'twilio') {
    if (!cachedRecordingUrl) {
      return { status: 404, message: 'No recording available for this call' };
    }
    return { status: 200, audioUrl: cachedRecordingUrl, provider };
  }

  const profileRes = await query(
    'SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id = $1 LIMIT 1',
    [targetUserId]
  );
  const credentials = resolveCtmCreds(profileRes.rows[0] || null);

  if (!credentials?.accountId || !credentials.apiKey || !credentials.apiSecret) {
    if (cachedRecordingUrl) {
      return { status: 200, audioUrl: cachedRecordingUrl, provider };
    }
    return { status: 503, message: 'CTM credentials not configured for this client' };
  }

  const activity = await fetchCtmActivityDetails(credentials, callId);
  const audioUrl =
    activity?.audio ||
    activity?.recording_url ||
    activity?.recordings?.[0]?.public_url ||
    activity?.recordings?.[0]?.url ||
    cachedRecordingUrl;

  if (!audioUrl) {
    return { status: 404, message: 'No recording available for this call' };
  }

  return { status: 200, audioUrl, provider, credentials };
}

async function attachTagsToCalls(ownerId, calls = []) {
  if (!calls?.length) return calls;
  const callIds = calls.map((c) => c.id);
  const { rows } = await query(
    `SELECT clt.call_id, lt.id, lt.name, lt.color
     FROM call_log_tags clt
     JOIN lead_tags lt ON lt.id = clt.tag_id
     WHERE clt.call_id = ANY($1) AND lt.owner_user_id = $2
     ORDER BY lt.name ASC`,
    [callIds, ownerId]
  );
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.call_id)) map.set(row.call_id, []);
    map.get(row.call_id).push({ id: row.id, name: row.name, color: row.color });
  });
  return calls.map((call) => ({
    ...call,
    tags: map.get(call.id) || []
  }));
}

/**
 * Compute lifecycle_state for each call based on phone matching against
 * active_clients and client_journeys. Precedence:
 *   active_client > in_journey > returning_customer > repeat > new
 */
async function attachLifecycleState(ownerId, calls = []) {
  if (!calls?.length) return calls;

  // Collect unique normalized phones (last 10 digits)
  const phoneMap = new Map(); // normalized phone → [call indices]
  calls.forEach((call, i) => {
    const raw = call.from_number || call.caller_number || '';
    const phone = raw.replace(/\D/g, '').slice(-10);
    if (phone.length >= 7) {
      if (!phoneMap.has(phone)) phoneMap.set(phone, []);
      phoneMap.get(phone).push(i);
    }
  });

  // Phase 3: a call can carry a contact_id even with no usable phone (e.g. form-sourced
  // rows). Compute the contact set up front so contact-only pages still reach the
  // contact_id lifecycle path below — don't short-circuit on phones alone.
  const contactIds = [...new Set(calls.map((c) => c.contact_id).filter(Boolean))];

  if (phoneMap.size === 0 && contactIds.length === 0) {
    return calls.map((c) => ({ ...c, lifecycle_state: 'new' }));
  }

  const phones = [...phoneMap.keys()];

  // Batch lookup: active clients by phone
  const acResult = await query(
    `SELECT id, client_name, client_phone, client_email, archived_at
     FROM active_clients
     WHERE owner_user_id = $1
       AND RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10) = ANY($2)`,
    [ownerId, phones]
  );

  // Build phone → active_client lookup
  const activeClientByPhone = new Map();
  const archivedClientByPhone = new Map();
  for (const ac of acResult.rows) {
    const p = (ac.client_phone || '').replace(/\D/g, '').slice(-10);
    if (!p) continue;
    if (ac.archived_at) {
      if (!archivedClientByPhone.has(p)) archivedClientByPhone.set(p, ac);
    } else {
      activeClientByPhone.set(p, ac);
    }
  }

  // Batch lookup: journeys by phone (non-archived)
  const jResult = await query(
    `SELECT id, client_name, client_phone, status, active_client_id, archived_at, created_at
     FROM client_journeys
     WHERE owner_user_id = $1
       AND RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10) = ANY($2)
     ORDER BY created_at DESC`,
    [ownerId, phones]
  );

  // Build phone → journey lookup (newest first, prefer non-archived)
  const journeyByPhone = new Map();
  const archivedJourneyByPhone = new Map();
  for (const j of jResult.rows) {
    const p = (j.client_phone || '').replace(/\D/g, '').slice(-10);
    if (!p) continue;
    const normalizedStatus = normalizeJourneyStatus(j.status, {
      activeClientId: j.active_client_id,
      archivedAt: j.archived_at
    });
    if (normalizedStatus === 'archived' || normalizedStatus === 'won' || normalizedStatus === 'lost') {
      if (!archivedJourneyByPhone.has(p)) archivedJourneyByPhone.set(p, j);
    } else if (normalizedStatus === 'in_progress') {
      if (!journeyByPhone.has(p)) journeyByPhone.set(p, j);
    }
  }

  // Count calls per phone for repeat detection
  const callCountByPhone = new Map();
  for (const call of calls) {
    const raw = call.from_number || call.caller_number || '';
    const phone = raw.replace(/\D/g, '').slice(-10);
    if (phone.length >= 7) {
      callCountByPhone.set(phone, (callCountByPhone.get(phone) || 0) + 1);
    }
  }

  // Phase 3: parallel contact_id-based lookups (contactIds computed up top). A call's
  // contact unifies all of the person's numbers, so this resolves active-client/journey
  // membership even when the call's number differs from the one on file. The per-call
  // logic below prefers these and falls back to the phone maps when contact_id is null
  // (pre-backfill) — so the result is identical to before until backfill, then a superset.
  const activeClientByContact = new Map();
  const archivedClientByContact = new Map();
  const journeyByContact = new Map();
  const archivedJourneyByContact = new Map();
  if (contactIds.length) {
    const acC = await query(
      `SELECT id, contact_id, archived_at FROM active_clients
       WHERE owner_user_id = $1 AND contact_id = ANY($2)`,
      [ownerId, contactIds]
    );
    for (const ac of acC.rows) {
      if (ac.archived_at) {
        if (!archivedClientByContact.has(ac.contact_id)) archivedClientByContact.set(ac.contact_id, ac);
      } else {
        activeClientByContact.set(ac.contact_id, ac);
      }
    }
    const jC = await query(
      `SELECT id, contact_id, status, active_client_id, archived_at, created_at FROM client_journeys
       WHERE owner_user_id = $1 AND contact_id = ANY($2)
       ORDER BY created_at DESC`,
      [ownerId, contactIds]
    );
    for (const j of jC.rows) {
      const ns = normalizeJourneyStatus(j.status, { activeClientId: j.active_client_id, archivedAt: j.archived_at });
      if (ns === 'archived' || ns === 'won' || ns === 'lost') {
        if (!archivedJourneyByContact.has(j.contact_id)) archivedJourneyByContact.set(j.contact_id, j);
      } else if (ns === 'in_progress') {
        if (!journeyByContact.has(j.contact_id)) journeyByContact.set(j.contact_id, j);
      }
    }
  }

  // Assign lifecycle_state to each call
  return calls.map((call) => {
    const raw = call.from_number || call.caller_number || '';
    const phone = raw.replace(/\D/g, '').slice(-10);

    let lifecycle_state = 'new';
    let lifecycle_ref_id = null;
    let lifecycle_ref_type = null;

    const cid = call.contact_id;
    if (phone.length >= 7 || cid) {
      // contact_id match preferred; phone match is the fallback (pre-backfill / null cid).
      const ac = (cid && activeClientByContact.get(cid)) || activeClientByPhone.get(phone);
      const journey = (cid && journeyByContact.get(cid)) || journeyByPhone.get(phone);
      const archivedClient = (cid && archivedClientByContact.get(cid)) || archivedClientByPhone.get(phone);
      const archivedJourney = (cid && archivedJourneyByContact.get(cid)) || archivedJourneyByPhone.get(phone);

      if (ac) {
        lifecycle_state = 'active_client';
        lifecycle_ref_id = ac.id;
        lifecycle_ref_type = 'active_client';
      } else if (journey) {
        lifecycle_state = 'in_journey';
        lifecycle_ref_id = journey.id;
        lifecycle_ref_type = 'journey';
      } else if (archivedClient || archivedJourney) {
        lifecycle_state = 'returning_customer';
        lifecycle_ref_id = archivedClient?.id || archivedJourney?.id;
        lifecycle_ref_type = archivedClient ? 'active_client' : 'journey';
      } else if (call.call_sequence > 1 || (callCountByPhone.get(phone) || 0) > 1) {
        lifecycle_state = 'repeat';
      }
    }

    return { ...call, lifecycle_state, lifecycle_ref_id, lifecycle_ref_type };
  });
}

// Attach the contact's name to each call so the UI can prefer a human-set name over the
// per-call caller_name. Guarded: if the contacts schema/display_name_source column isn't
// present yet (fresh-deploy startup window), returns calls unchanged (UI falls back).
async function attachContactNames(ownerId, calls = []) {
  const contactIds = [...new Set(calls.map((c) => c.contact_id).filter(Boolean))];
  if (!contactIds.length) return calls;
  try {
    const { rows } = await query(
      `SELECT id, display_name, display_name_source FROM contacts
       WHERE id = ANY($1) AND owner_user_id = $2`,
      [contactIds, ownerId]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return calls.map((c) => {
      const co = c.contact_id ? byId.get(c.contact_id) : null;
      return co
        ? { ...c, contact_display_name: co.display_name, contact_name_source: co.display_name_source }
        : c;
    });
  } catch (err) {
    console.error('[attachContactNames] skipped (non-fatal)', { code: err?.code });
    return calls;
  }
}

// GET /calls - Returns cached calls immediately. Use ?sync=true or POST /calls/sync to fetch from CTM.
router.get('/calls', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const shouldSync = req.query.sync === 'true';
  // Gate the lead_removed_at filter on the column actually existing (post-deploy migration
  // window). Cheap: one info-schema query at most until the flag latches true.
  await ensureLeadRemovedCol();
  const parseDateBoundary = (value, endOfDay = false) => {
    if (!value) return null;
    const [year, month, day] = String(value)
      .split('-')
      .map((part) => parseInt(part, 10));
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));
  };

  // Search, filter, and pagination params
  const search = req.query.search?.trim() || '';
  const callerType = req.query.caller_type || '';
  const activityType = req.query.activity_type || '';
  const sourceKey = req.query.source || '';
  const lifecycle = req.query.lifecycle || '';
  const category = req.query.category || '';
  const dateFrom = req.query.date_from || '';
  const dateTo = req.query.date_to || '';
  const parsedDateFrom = parseDateBoundary(dateFrom, false);
  const parsedDateTo = parseDateBoundary(dateTo, true);
  const sortBy = req.query.sort_by || 'started_at';
  const sortOrder = req.query.sort_order === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const showHidden = req.query.show_hidden === 'true';

  const callPhoneSql = `RIGHT(REGEXP_REPLACE(cl.from_number, '[^0-9]', '', 'g'), 10)`;
  // Phase 3: lifecycle membership matches on contact_id OR phone, mirroring the per-row
  // badge logic in attachLifecycleState (contact_id preferred, phone fallback). This
  // keeps the tab FILTERs and counts in sync with the badges — without it, a row matched
  // to an active client / journey via contact_id would show the badge but be missing from
  // its tab and count. Pre-backfill rows have contact_id NULL, so the contact branch is
  // inert and behavior is identical to phone-only until backfill, then a strict superset.
  const activeClientLifecycleSql = `EXISTS (
    SELECT 1 FROM active_clients ac
    WHERE ac.owner_user_id = $1 AND ${activeOnly('ac')}
      AND (
        RIGHT(REGEXP_REPLACE(ac.client_phone, '[^0-9]', '', 'g'), 10) = ${callPhoneSql}
        OR (cl.contact_id IS NOT NULL AND ac.contact_id = cl.contact_id)
      )
  )`;
  const inJourneyLifecycleSql = `EXISTS (
    SELECT 1 FROM client_journeys cj
    WHERE cj.owner_user_id = $1
      AND ${activeOnly('cj')}
      AND cj.active_client_id IS NULL
      AND COALESCE(cj.status, 'in_progress') NOT IN ('active_client', 'won', 'lost', 'archived')
      AND (
        RIGHT(REGEXP_REPLACE(cj.client_phone, '[^0-9]', '', 'g'), 10) = ${callPhoneSql}
        OR (cl.contact_id IS NOT NULL AND cj.contact_id = cl.contact_id)
      )
  )`;
  const leadInboxLifecycleSql = `(NOT (${activeClientLifecycleSql}) AND NOT (${inJourneyLifecycleSql}))`;

  // Build common conditions shared by lifecycle counts and the main listing query.
  const commonConditions = ['(owner_user_id = $1 OR user_id = $1)'];
  const commonParams = [targetUserId];
  let commonParamIndex = 2;

  // Hidden state is inbox-triage, not a global delete. It applies ONLY to the
  // Lead Inbox view — In Journey, Active Client, and All Activity always show
  // every row so clients don't lose contact history when they dismiss an inbox
  // entry. The show_hidden toggle reveals dismissed entries inside Lead Inbox.
  const applyHiddenFilter = !showHidden && lifecycle === 'lead_inbox';
  const hiddenSql = 'hidden_at IS NULL';

  // lead_removed_at is a PERMANENT removal from the Lead Inbox (set when a
  // lead's journey reaches a terminal state), distinct from hidden_at's
  // reversible inbox-triage dismissal. It is applied wherever hidden_at is —
  // i.e. only the Lead Inbox listing + its counts — so an archived/terminal
  // journey can't snap a contact back into "Qualified". No params: static
  // condition, so placeholder alignment is unaffected.
  const leadRemovedSql = 'lead_removed_at IS NULL';

  if (search) {
    commonConditions.push(`(
      call_id ILIKE $${commonParamIndex} OR
      from_number ILIKE $${commonParamIndex} OR
      meta->>'caller_name' ILIKE $${commonParamIndex} OR
      meta->>'classification_summary' ILIKE $${commonParamIndex} OR
      meta->>'source' ILIKE $${commonParamIndex}
    )`);
    commonParams.push(`%${search}%`);
    commonParamIndex++;
  }

  if (req.query.contact_phone) {
    const contactPhoneDigits = String(req.query.contact_phone).replace(/\D/g, '');
    if (contactPhoneDigits.length < 10 || contactPhoneDigits.length > 15) {
      return res.status(400).json({ message: 'contact_phone must contain 10-15 digits' });
    }
    commonConditions.push(
      `RIGHT(REGEXP_REPLACE(cl.from_number, '[^0-9]', '', 'g'), 10) = RIGHT($${commonParamIndex}, 10)`
    );
    commonParams.push(contactPhoneDigits);
    commonParamIndex++;
  }

  if (req.query.contact_id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.query.contact_id)) {
      return res.status(400).json({ message: 'Invalid contact_id.' });
    }
    commonConditions.push(`cl.contact_id = $${commonParamIndex}`);
    commonParams.push(req.query.contact_id);
    commonParamIndex++;
  }

  if (callerType && ['new', 'repeat', 'returning_customer'].includes(callerType)) {
    commonConditions.push(`caller_type = $${commonParamIndex}`);
    commonParams.push(callerType);
    commonParamIndex++;
  }

  if (activityType && ['call', 'sms', 'form', 'email', 'other'].includes(activityType)) {
    commonConditions.push(`activity_type = $${commonParamIndex}`);
    commonParams.push(activityType);
    commonParamIndex++;
  }

  if (sourceKey) {
    commonConditions.push(`meta->>'source_key' = $${commonParamIndex}`);
    commonParams.push(sourceKey);
    commonParamIndex++;
  }

  if (parsedDateFrom) {
    commonConditions.push(`started_at >= $${commonParamIndex}`);
    commonParams.push(parsedDateFrom);
    commonParamIndex++;
  }

  if (parsedDateTo) {
    commonConditions.push(`started_at <= $${commonParamIndex}`);
    commonParams.push(parsedDateTo);
    commonParamIndex++;
  }

  const categoryCountsConditions = [...commonConditions];
  const categoryCountsParams = [...commonParams];
  const queryConditions = [...commonConditions];
  const queryParams = [...commonParams];
  let queryParamIndex = commonParamIndex;

  // Category chip counts ALWAYS reflect the New-Leads inbox (triage) scope, regardless of
  // the listing lifecycle. This is deliberate: 'All Activity' is a firehose that must NOT
  // change the category numbers — otherwise the chips show e.g. "Qualified (247)" under
  // All Activity but clicking one (which drops into the inbox) shows 2, which is confusing.
  // Pinning the counts to the inbox keeps the chip number and the resulting list in sync.
  // Hidden (dismissed) rows are excluded unless show_hidden, matching the inbox view.
  categoryCountsConditions.push(leadInboxLifecycleSql);
  if (!showHidden) {
    categoryCountsConditions.push(hiddenSql);
  }
  // lead_removed_at is a PERMANENT removal, not toggleable triage — apply it to the lead
  // inbox UNCONDITIONALLY (even under show_hidden) so journeyed activity never returns.
  // Gated only on the column existing (post-deploy migration window).
  if (leadRemovedColReady) {
    categoryCountsConditions.push(leadRemovedSql);
  }

  // The main listing query keeps the actual lifecycle scope (incl. 'all' = no filter).
  if (lifecycle === 'lead_inbox') {
    queryConditions.push(leadInboxLifecycleSql);
    if (applyHiddenFilter) {
      queryConditions.push(hiddenSql);
    }
    // Permanent removal — always filter for the lead inbox (not gated by show_hidden).
    if (leadRemovedColReady) {
      queryConditions.push(leadRemovedSql);
    }
  } else if (lifecycle === 'in_journey') {
    queryConditions.push(inJourneyLifecycleSql);
  } else if (lifecycle === 'active_client') {
    queryConditions.push(activeClientLifecycleSql);
  }
  // 'all' or empty = no lifecycle filter on the listing (true "all" firehose)

  // Category filter — supports both raw categories and collapsed visible buckets.
  // Only actual classification outcomes live here. active_client and
  // returning_customer are lifecycle states (tags), not categories — they are
  // filtered through the separate lifecycle tabs. `converted` remains because
  // it is the code-assigned end-state from a manual 5-star rating.
  const VISIBLE_CATEGORY_BUCKETS = {
    lead: ['warm', 'very_good', 'very_hot', 'very-hot', 'hot', 'neutral', 'unreviewed', 'converted'],
    needs_attention: ['needs_attention'],
    unanswered: ['unanswered', 'voicemail'],
    not_a_fit: ['not_a_fit', 'applicant'],
    spam: ['spam']
  };

  if (category) {
    // "Pending Review" is a state flag, not a category value. A row is pending
    // when the AI classifier never produced a usable result for it (per-sync
    // 40-call AI cap overflow, first-import 30-day window stash, or no-content
    // fall-through). Drive it from meta.classification_pending so the chip
    // doesn't surface rows whose category happens to read "unreviewed" but
    // were intentionally left that way.
    if (category === 'pending_review') {
      queryConditions.push(`meta->>'classification_pending' = 'true'`);
    } else if (category === 'qualified') {
      // Qualified = the 3-star+ slice of the lead bucket (forms/SMS never
      // demoted) PLUS Priority (needs_attention) leads, which no longer have
      // their own filter chip — they sort to the top of this list (see the
      // priority-first ORDER BY below). COALESCE NULL activity_type to 'call'.
      queryConditions.push(
        `COALESCE(meta->>'classification_pending', 'false') <> 'true' AND (
           (COALESCE(meta->>'category', 'unreviewed') = ANY($${queryParamIndex}::text[]) AND (COALESCE(activity_type, 'call') <> 'call' OR COALESCE(score, 0) >= 3))
           OR COALESCE(meta->>'category', 'unreviewed') = 'needs_attention'
         )`
      );
      queryParams.push(VISIBLE_CATEGORY_BUCKETS.lead);
      queryParamIndex++;
    } else if (category === 'returning') {
      // Returning/Other = sub-3-star CALLS of the lead bucket (lukewarm +
      // suppressed re-engagement callbacks). Mirrors splitQualifiedReturning().
      queryConditions.push(
        `COALESCE(meta->>'category', 'unreviewed') = ANY($${queryParamIndex}::text[]) AND COALESCE(meta->>'classification_pending', 'false') <> 'true' AND COALESCE(activity_type, 'call') = 'call' AND COALESCE(score, 0) < 3`
      );
      queryParams.push(VISIBLE_CATEGORY_BUCKETS.lead);
      queryParamIndex++;
    } else {
      const bucket = VISIBLE_CATEGORY_BUCKETS[category];
      if (bucket) {
        // Collapsed visible category — expand to raw categories. Exclude rows
        // that are still pending classification so they only appear in the
        // Pending Review tab.
        queryConditions.push(
          `COALESCE(meta->>'category', 'unreviewed') = ANY($${queryParamIndex}::text[]) AND COALESCE(meta->>'classification_pending', 'false') <> 'true'`
        );
        queryParams.push(bucket);
        queryParamIndex++;
      } else {
        // Raw category passed directly. Exclude pending rows so direct API
        // consumers / saved views asking for category=unreviewed don't pull
        // back rows that belong in Pending Review.
        queryConditions.push(
          `COALESCE(meta->>'category', 'unreviewed') = $${queryParamIndex} AND COALESCE(meta->>'classification_pending', 'false') <> 'true'`
        );
        queryParams.push(category);
        queryParamIndex++;
      }
    }
  }

  // Allowed sort columns to prevent SQL injection
  const allowedSortColumns = ['started_at', 'score', 'duration_sec', 'from_number'];
  const safeSort = allowedSortColumns.includes(sortBy) ? sortBy : 'started_at';

  // Count total for pagination metadata
  const countQuery = `SELECT COUNT(*) as total FROM call_logs cl WHERE ${queryConditions.join(' AND ')}`;
  const countResult = await query(countQuery, queryParams);
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  // Category counts (ignores category filter so all tabs always show correct numbers).
  // The category count groups by the raw `category` value AND excludes rows that are
  // still pending classification — those are surfaced under a synthetic pending_review
  // bucket so the chip total matches `meta.classification_pending='true'`, not the
  // raw category column.
  const categoryCountsResult = await query(
    `SELECT
       COALESCE(meta->>'category', 'unreviewed') as category,
       COUNT(*) FILTER (WHERE COALESCE(meta->>'classification_pending', 'false') <> 'true') as count,
       COUNT(*) FILTER (WHERE meta->>'classification_pending' = 'true') as pending_count
     FROM call_logs cl WHERE ${categoryCountsConditions.join(' AND ')}
     GROUP BY COALESCE(meta->>'category', 'unreviewed')`,
    categoryCountsParams
  );
  const categoryCounts = categoryCountsResult.rows.reduce((acc, row) => {
    acc[row.category] = parseInt(row.count, 10);
    acc.pending_review = (acc.pending_review || 0) + parseInt(row.pending_count || 0, 10);
    return acc;
  }, {});

  // Qualified vs Returning/Other can't be expressed by the per-raw-category
  // GROUP BY above (they share raw categories and split on score), so compute
  // them as two scalar aggregates under the same filters. Badges read these
  // directly; the list filter uses the identical predicate.
  const leadSplitParams = [...categoryCountsParams, VISIBLE_CATEGORY_BUCKETS.lead];
  const leadBucketIdx = leadSplitParams.length;
  const leadSplitResult = await query(
    `SELECT
       COUNT(*) FILTER (
         WHERE COALESCE(meta->>'classification_pending', 'false') <> 'true'
           AND (
             (COALESCE(meta->>'category', 'unreviewed') = ANY($${leadBucketIdx}::text[]) AND (COALESCE(activity_type, 'call') <> 'call' OR COALESCE(score, 0) >= 3))
             OR COALESCE(meta->>'category', 'unreviewed') = 'needs_attention'
           )
       ) AS qualified,
       COUNT(*) FILTER (
         WHERE COALESCE(meta->>'category', 'unreviewed') = ANY($${leadBucketIdx}::text[])
           AND COALESCE(meta->>'classification_pending', 'false') <> 'true'
           AND COALESCE(activity_type, 'call') = 'call' AND COALESCE(score, 0) < 3
       ) AS returning
     FROM call_logs cl WHERE ${categoryCountsConditions.join(' AND ')}`,
    leadSplitParams
  );
  categoryCounts.qualified = parseInt(leadSplitResult.rows[0]?.qualified || 0, 10);
  categoryCounts.returning = parseInt(leadSplitResult.rows[0]?.returning || 0, 10);

  // Lifecycle counts ignore the current lifecycle/category filter, but respect
  // all other filters like search, dates, source, and type. Each pill reflects
  // its own tab's view: the Lead Inbox pill hides dismissed rows (unless
  // show_hidden is on), while In Journey / Active Client / All reflect the
  // full contact history regardless of dismissal state.
  // hidden_at is toggleable via show_hidden; lead_removed_at is permanent so it always
  // applies (when the column exists — post-deploy migration window).
  let leadInboxBucketSql = leadInboxLifecycleSql;
  if (!showHidden) leadInboxBucketSql += ` AND ${hiddenSql}`;
  if (leadRemovedColReady) leadInboxBucketSql += ` AND ${leadRemovedSql}`;
  const lifecycleCountsResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE ${leadInboxBucketSql}) as lead_inbox,
       COUNT(*) FILTER (WHERE ${inJourneyLifecycleSql}) as in_journey,
       COUNT(*) FILTER (WHERE ${activeClientLifecycleSql}) as active_client,
       COUNT(*) as total
     FROM call_logs cl WHERE ${commonConditions.join(' AND ')}`,
    commonParams
  );
  const lifecycleCounts = {
    lead_inbox: parseInt(lifecycleCountsResult.rows[0]?.lead_inbox || 0, 10),
    in_journey: parseInt(lifecycleCountsResult.rows[0]?.in_journey || 0, 10),
    active_client: parseInt(lifecycleCountsResult.rows[0]?.active_client || 0, 10),
    all: parseInt(lifecycleCountsResult.rows[0]?.total || 0, 10)
  };

  // Main query with pagination — match form submissions by phone + timestamp proximity
  // Uses hashed_phone for encrypted rows, falls back to JSONB extraction for legacy rows
  const mainQuery = `
    SELECT cl.*,
      (SELECT cf.name
       FROM ctm_form_submissions cfs
       JOIN ctm_forms cf ON cfs.form_id = cf.id
       WHERE cfs.spam IS NOT TRUE
         AND (
           cfs.hashed_phone = encode(digest(RIGHT(REGEXP_REPLACE(cl.from_number, '[^\\d]', '', 'g'), 10), 'sha256'), 'hex')
           OR RIGHT(REGEXP_REPLACE(cfs.field_data->>'phone_number', '[^\\d]', '', 'g'), 10) =
              RIGHT(REGEXP_REPLACE(cl.from_number, '[^\\d]', '', 'g'), 10)
         )
         AND ABS(EXTRACT(EPOCH FROM (cl.started_at - cfs.created_at))) < 120
       ORDER BY ABS(EXTRACT(EPOCH FROM (cl.started_at - cfs.created_at)))
       LIMIT 1) as form_name,
      EXISTS (
        SELECT 1 FROM client_journeys pj
        WHERE pj.owner_user_id = cl.owner_user_id
          AND pj.status = 'archived'
          AND length(right(regexp_replace(COALESCE(pj.client_phone,''), '[^0-9]', '', 'g'), 10)) = 10
          AND right(regexp_replace(COALESCE(pj.client_phone,''), '[^0-9]', '', 'g'), 10)
              = right(regexp_replace(COALESCE(cl.from_number,''), '[^0-9]', '', 'g'), 10)
      ) AS has_previous_journey
    FROM call_logs cl
    WHERE ${queryConditions.join(' AND ')}
    ORDER BY ${safeSort} ${sortOrder} NULLS LAST
    LIMIT $${queryParamIndex} OFFSET $${queryParamIndex + 1}
  `;
  const mainParams = [...queryParams, limit, offset];

  const cached = await query(mainQuery, mainParams);
  const cachedRows = cached.rows;
  let cachedCalls = buildCallsFromCache(cachedRows);
  cachedCalls = await attachJourneyMetaToCalls(targetUserId, cachedCalls);
  cachedCalls = await attachTagsToCalls(targetUserId, cachedCalls);
  cachedCalls = await attachLifecycleState(targetUserId, cachedCalls);
  cachedCalls = await attachContactNames(targetUserId, cachedCalls);

  // Distinct sources for the filter dropdown (unfiltered so all options always show)
  const sourcesResult = await query(
    `SELECT DISTINCT LOWER(meta->>'source_key') as source_key
     FROM call_logs
     WHERE (owner_user_id = $1 OR user_id = $1) AND meta->>'source_key' IS NOT NULL
     ORDER BY source_key`,
    [targetUserId]
  );
  const distinctSources = sourcesResult.rows.map((r) => r.source_key).filter(Boolean);

  // Pagination metadata
  const pagination = {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total
  };

  // If sync not requested, return cache immediately
  if (!shouldSync) {
    return res.json({ calls: cachedCalls, cached: true, pagination, categoryCounts, lifecycleCounts, distinctSources });
  }

  // Sync requested - fetch from CTM with incremental sync
  const profileRes = await query(
    'SELECT ctm_account_number, ctm_api_key, ctm_api_secret, ai_prompt, auto_star_enabled, ctm_sync_cursor FROM client_profiles WHERE user_id=$1 LIMIT 1',
    [targetUserId]
  );
  // Pre-existing latent bug (also on main): the sync block below reads `profile.*`
  // (ctm_sync_cursor / ai_prompt / auto_star_enabled) but only profileRes was defined,
  // so GET /calls?sync=true threw ReferenceError and silently fell back to cached data.
  const profile = profileRes.rows[0] || {};
  const credentials = resolveCtmCreds(profile);

  if (!credentials?.accountId || !credentials.apiKey || !credentials.apiSecret) {
    logEvent('calls:list', 'CTM credentials missing for client', { userId: targetUserId });
    return res.json({ calls: cachedCalls, cached: true, message: 'CTM credentials not configured.', lifecycleCounts, distinctSources });
  }

  try {
    logEvent('calls:sync', 'Syncing calls from CTM', { userId: targetUserId, cursor: profile.ctm_sync_cursor });

    // First-import detection: brand-new client with no prior sync cursor and no cached calls.
    // Cap inline AI classification to the last 30 days; older history still imports for
    // analytics but lands as classification_pending=true (visible in All Activity, not Leads).
    const isFirstImport = !profile.ctm_sync_cursor && (!cachedRows || cachedRows.length === 0);
    const classifyOnlyAfter = isFirstImport
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      : null;

    const enrichmentLookup = ({ ownerUserId, callerNumber, callId, contactId }) =>
      enrichCallerType(query, ownerUserId, callerNumber, callId, contactId);

    // Fallback lookup for off-page rows so sync doesn't clobber manual scores or
    // category overrides on call_logs that weren't in the current paginated view.
    const findExistingByCallId = async (callId) => {
      const { rows } = await query(
        `SELECT call_id, score, meta FROM call_logs
         WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2)
         LIMIT 1`,
        [callId, targetUserId]
      );
      return rows[0] || null;
    };

    const { results: freshCalls, syncMeta } = await pullCallsFromCtm({
      ownerUserId: targetUserId,
      credentials,
      prompt: profile.ai_prompt || DEFAULT_AI_PROMPT,
      existingRows: cachedRows,
      autoStarEnabled: profile.auto_star_enabled || false,
      syncRatings: true,
      sinceTimestamp: profile.ctm_sync_cursor || null,
      classifyOnlyAfter,
      enrichmentLookup,
      findExistingByCallId
    });

    if (freshCalls.length) {
      // Save new/updated calls to database with caller enrichment
      await Promise.all(
        freshCalls.map(async (item) => {
          const { call, meta } = item;
          const startedAt = call.started_at ? new Date(call.started_at) : null;

          // Reuse enrichment computed inside pullCallsFromCtm (via enrichmentLookup);
          // fall back to a fresh lookup only if it's missing for some reason.
          const enrichment = item._enrichment ?? await enrichCallerType(query, targetUserId, call.caller_number, call.id, item._contactId);
          // Store enrichment on item so auto-star guardrail can access it
          item._enrichment = enrichment;
          // Reuse contact resolved upstream by pullCallsFromCtm — no second resolve.
          const contactId = item._contactId ?? null;

          return upsertCallLog({
            ownerUserId: targetUserId,
            callId: call.id,
            direction: call.direction,
            fromNumber: call.caller_number,
            toNumber: call.to_number,
            startedAt,
            durationSec: call.duration_sec,
            score: call.score || 0,
            meta: JSON.stringify({ ...stripCtmMediaMeta(meta), ...enrichment }),
            callerType: enrichment.callerType || 'new',
            activeClientId: enrichment.activeClientId || null,
            callSequence: enrichment.callSequence || 1,
            activityType: call.activity_type || 'call',
            contactId
          }, query);
        })
      );

      // Fix caller_type for repeat callers that were all inserted as 'new' in the batch
      await fixCallerTypesPostSync(targetUserId);

      // Update sync cursor
      if (syncMeta.latestTimestamp) {
        await query('UPDATE client_profiles SET ctm_sync_cursor=$1 WHERE user_id=$2', [new Date(syncMeta.latestTimestamp), targetUserId]);
      }

      // Post auto-starred scores back to CTM — skip known clients/journeys
      const autoStarredCalls = freshCalls.filter(({ shouldPostScore, _enrichment }) => {
        if (!shouldPostScore) return false;
        if (_enrichment?.callerType === 'active_client' || _enrichment?.journeyId) return false;
        return true;
      });
      if (autoStarredCalls.length > 0) {
        logEvent('calls:auto-star', `Auto-starring ${autoStarredCalls.length} call(s)`, { userId: targetUserId });
        await Promise.all(
          autoStarredCalls.map(async ({ call }) => {
            try {
              await postSaleToCTM(credentials, call.id, { score: call.score, conversion: 1, value: 0 });
              // Stamp the once-marker ONLY after the CTM post succeeds. A failed post
              // leaves the row un-marked so the next sync re-applies and retries.
              await query(
                `UPDATE call_logs SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('auto_star_applied_at', to_jsonb($2::text))
                   WHERE call_id = $1 AND (owner_user_id = $3 OR user_id = $3)`,
                [call.id, new Date().toISOString(), targetUserId]
              );
            } catch (err) {
              console.error('[calls:auto-star] Failed to post score to CTM', { callId: call.id, error: err.message });
            }
          })
        );
      }

      // Relay qualified calls to tracking destinations (GA4 / Meta CAPI).
      // call.category here is the internal classifier label (warm/very_good/etc.),
      // NOT the UI-collapsed 'lead'. Match the actual labels that map to a Lead chip.
      const qualifiedCalls = freshCalls.filter(({ call, _enrichment }) => {
        if (!call.category) return false;
        if (_enrichment?.callerType === 'active_client') return false;
        if (_enrichment?.recentlyQualified) return false;     // first-touch: only suppress if 3★+ within last 6 months
        return QUALIFIED_LEAD_CATEGORIES.has(call.category);
      });
      if (qualifiedCalls.length > 0) {
        await Promise.all(
          qualifiedCalls.map(async ({ call }) => {
            try {
              // Dedup: if a form_* call_log already fired lead_submitted for the same
              // caller within ±10 minutes, the qualified_call would double-count the
              // Meta Lead / GA4 conversion. Skip the relay in that case.
              const phone = call.caller_number || null;
              const startedAt = call.started_at || null;
              if (phone && startedAt) {
                const { rows: formSibling } = await query(
                  `SELECT 1 FROM call_logs
                   WHERE (owner_user_id = $1 OR user_id = $1)
                     AND meta->>'source_key' = 'form'
                     AND RIGHT(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g'), 10)
                         = RIGHT(REGEXP_REPLACE($2, '[^0-9]', '', 'g'), 10)
                     AND started_at BETWEEN $3::timestamptz - INTERVAL '10 minutes'
                                       AND $3::timestamptz + INTERVAL '10 minutes'
                   LIMIT 1`,
                  [targetUserId, phone, startedAt]
                );
                if (formSibling.length) return;
              }

              // Pull attribution (gclid/gbraid/wbraid) from the just-inserted call_logs
              // row so Google Ads offline conversion uploads have a click identifier.
              let attribution = null;
              try {
                const { rows: metaRows } = await query(
                  `SELECT meta FROM call_logs WHERE call_id = $1 LIMIT 1`,
                  [call.id]
                );
                attribution = metaRows[0]?.meta?.attribution || null;
              } catch {
                attribution = null;
              }

              // Atomic dedupe: serialize concurrent senders for this (call, event)
              // pair via advisory lock, then re-check tracking_event_log under the
              // lock and send only if no successful row exists. Lock auto-releases
              // on COMMIT — the lock is held through the relay so duplicate sends
              // can't slip in between SELECT and INSERT.
              const relayDbClient = await getClient();
              try {
                await relayDbClient.query('BEGIN');
                await relayDbClient.query(
                  `SELECT pg_advisory_xact_lock(hashtext($1::text))`,
                  [`tracking:qualified_call:${call.id}`]
                );
                const { rows: alreadySent } = await relayDbClient.query(
                  `SELECT 1 FROM tracking_event_log
                   WHERE source_id = $1 AND event_name = 'qualified_call' AND success = true
                   LIMIT 1`,
                  [call.id]
                );
                if (!alreadySent.length) {
                  await sendTrackingEvent(targetUserId, 'qualified_call', 'call_log', call.id, {
                    event_source_url: '',
                    value: 1,
                    currency: 'USD',
                    gclid: attribution?.gclid,
                    gbraid: attribution?.gbraid,
                    wbraid: attribution?.wbraid,
                  });
                }
                await relayDbClient.query('COMMIT');
              } catch (lockErr) {
                await relayDbClient.query('ROLLBACK').catch(() => {});
                throw lockErr;
              } finally {
                relayDbClient.release();
              }
            } catch (relayErr) {
              console.error('[calls:relay]', relayErr.message);
            }
          })
        );
      }

      // Send notifications for voicemails needing attention
      const attentionCalls = freshCalls.filter((item) => item.notifyNeedsAttention);
      if (attentionCalls.length) {
        await Promise.all(
          attentionCalls.map(({ call }) =>
            createNotification({
              userId: targetUserId,
              title: 'Voicemail needs attention',
              body: `${call.caller_name || call.caller_number || 'A caller'} left a voicemail. Summary: ${
                call.classification_summary || 'Review the voicemail details.'
              }`,
              linkUrl: '/portal?tab=leads',
              meta: {
                call_id: call.id,
                caller_name: call.caller_name,
                caller_number: call.caller_number,
                category: call.category,
                requires_callback: call.requires_callback === true
              }
            })
          )
        );
      }
    }

    // Return refreshed data from database (re-run with same filters/pagination)
    const refreshedCount = await query(countQuery, queryParams);
    const refreshedTotal = parseInt(refreshedCount.rows[0]?.total || 0, 10);
    const refreshed = await query(mainQuery, mainParams);
    let shaped = buildCallsFromCache(refreshed.rows);
    shaped = await attachJourneyMetaToCalls(targetUserId, shaped);
    shaped = await attachTagsToCalls(targetUserId, shaped);
    shaped = await attachLifecycleState(targetUserId, shaped);
    shaped = await attachContactNames(targetUserId, shaped);

    const refreshedPagination = {
      page,
      limit,
      total: refreshedTotal,
      totalPages: Math.ceil(refreshedTotal / limit),
      hasMore: page * limit < refreshedTotal
    };

    // Refresh category counts after sync (matches the pre-sync shape: per-category
    // counts exclude pending rows; pending_review is a synthetic bucket from the
    // classification_pending flag).
    const refreshedCategoryCountsResult = await query(
      `SELECT
         COALESCE(meta->>'category', 'unreviewed') as category,
         COUNT(*) FILTER (WHERE COALESCE(meta->>'classification_pending', 'false') <> 'true') as count,
         COUNT(*) FILTER (WHERE meta->>'classification_pending' = 'true') as pending_count
       FROM call_logs cl WHERE ${categoryCountsConditions.join(' AND ')}
       GROUP BY COALESCE(meta->>'category', 'unreviewed')`,
      categoryCountsParams
    );
    const refreshedCategoryCounts = refreshedCategoryCountsResult.rows.reduce((acc, row) => {
      acc[row.category] = parseInt(row.count, 10);
      acc.pending_review = (acc.pending_review || 0) + parseInt(row.pending_count || 0, 10);
      return acc;
    }, {});

    const refreshedLeadSplitParams = [...categoryCountsParams, VISIBLE_CATEGORY_BUCKETS.lead];
    const refreshedLeadBucketIdx = refreshedLeadSplitParams.length;
    const refreshedLeadSplitResult = await query(
      `SELECT
         COUNT(*) FILTER (
           WHERE COALESCE(meta->>'classification_pending', 'false') <> 'true'
             AND (
               (COALESCE(meta->>'category', 'unreviewed') = ANY($${refreshedLeadBucketIdx}::text[]) AND (COALESCE(activity_type, 'call') <> 'call' OR COALESCE(score, 0) >= 3))
               OR COALESCE(meta->>'category', 'unreviewed') = 'needs_attention'
             )
         ) AS qualified,
         COUNT(*) FILTER (
           WHERE COALESCE(meta->>'category', 'unreviewed') = ANY($${refreshedLeadBucketIdx}::text[])
             AND COALESCE(meta->>'classification_pending', 'false') <> 'true'
             AND COALESCE(activity_type, 'call') = 'call' AND COALESCE(score, 0) < 3
         ) AS returning
       FROM call_logs cl WHERE ${categoryCountsConditions.join(' AND ')}`,
      refreshedLeadSplitParams
    );
    refreshedCategoryCounts.qualified = parseInt(refreshedLeadSplitResult.rows[0]?.qualified || 0, 10);
    refreshedCategoryCounts.returning = parseInt(refreshedLeadSplitResult.rows[0]?.returning || 0, 10);

    return res.json({
      calls: shaped,
      synced: true,
      newCalls: freshCalls.length,
      pagination: refreshedPagination,
      categoryCounts: refreshedCategoryCounts,
      lifecycleCounts,
      distinctSources,
      syncMeta: {
        pagesProcessed: syncMeta.pagesProcessed,
        totalFetched: syncMeta.totalFetched
      }
    });
  } catch (err) {
    console.error('[calls:sync]', err);
    return res.json({ calls: cachedCalls, cached: true, stale: true, pagination, categoryCounts, lifecycleCounts, distinctSources, message: 'Sync failed. Showing cached data.' });
  }
});

// POST /calls/sync - Explicitly sync with CTM (for background refresh)
router.post('/calls/sync', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const fullSync = req.body.fullSync === true;

  const profileRes = await query(
    'SELECT ctm_account_number, ctm_api_key, ctm_api_secret, ai_prompt, auto_star_enabled, ctm_sync_cursor FROM client_profiles WHERE user_id=$1 LIMIT 1',
    [targetUserId]
  );
  const profile = profileRes.rows[0] || {};
  const credentials = resolveCtmCreds(profile);

  if (!credentials?.accountId || !credentials.apiKey || !credentials.apiSecret) {
    return res.status(400).json({ message: 'CTM credentials not configured.' });
  }

  const cached = await query('SELECT * FROM call_logs WHERE owner_user_id=$1 OR user_id=$1 ORDER BY started_at DESC NULLS LAST', [
    targetUserId
  ]);

  try {
    logEvent('calls:sync', fullSync ? 'Full sync with CTM' : 'Incremental sync with CTM', {
      userId: targetUserId,
      cursor: profile.ctm_sync_cursor
    });

    // First-import detection: brand-new client with no prior sync cursor and no cached calls.
    // Cap inline AI classification to the last 30 days. fullSync=true (admin-initiated full
    // resync) bypasses the window so historical data can be reclassified on demand.
    const isFirstImport = !fullSync && !profile.ctm_sync_cursor && (!cached.rows || cached.rows.length === 0);
    const classifyOnlyAfter = isFirstImport
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      : null;

    const enrichmentLookup = ({ ownerUserId, callerNumber, callId, contactId }) =>
      enrichCallerType(query, ownerUserId, callerNumber, callId, contactId);

    // Fallback lookup for off-page rows so sync doesn't clobber manual scores or
    // category overrides on rows that weren't in the cached page.
    const findExistingByCallId = async (callId) => {
      const { rows } = await query(
        `SELECT call_id, score, meta FROM call_logs
         WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2)
         LIMIT 1`,
        [callId, targetUserId]
      );
      return rows[0] || null;
    };

    const { results: freshCalls, syncMeta } = await pullCallsFromCtm({
      ownerUserId: targetUserId,
      credentials,
      prompt: profile.ai_prompt || DEFAULT_AI_PROMPT,
      existingRows: cached.rows,
      autoStarEnabled: profile.auto_star_enabled || false,
      syncRatings: true,
      sinceTimestamp: fullSync ? null : profile.ctm_sync_cursor || null,
      fullSync,
      classifyOnlyAfter,
      enrichmentLookup,
      findExistingByCallId
    });

    let updatedCount = 0;
    let newCount = 0;

    if (freshCalls.length) {
      await Promise.all(
        freshCalls.map(async (item) => {
          const { call, meta, isRatingUpdate } = item;
          const startedAt = call.started_at ? new Date(call.started_at) : null;

          // Reuse enrichment computed inside pullCallsFromCtm (via enrichmentLookup);
          // fall back to a fresh lookup only if it's missing for some reason.
          const enrichment = item._enrichment ?? await enrichCallerType(query, targetUserId, call.caller_number, call.id, item._contactId);
          item._enrichment = enrichment;
          // Reuse contact resolved upstream by pullCallsFromCtm — no second resolve.
          const contactId = item._contactId ?? null;

          const result = await upsertCallLog({
            ownerUserId: targetUserId,
            callId: call.id,
            direction: call.direction,
            fromNumber: call.caller_number,
            toNumber: call.to_number,
            startedAt,
            durationSec: call.duration_sec,
            score: call.score || 0,
            meta: JSON.stringify({ ...stripCtmMediaMeta(meta), ...enrichment }),
            callerType: enrichment.callerType || 'new',
            activeClientId: enrichment.activeClientId || null,
            callSequence: enrichment.callSequence || 1,
            activityType: call.activity_type || 'call',
            contactId
          }, query);
          if (result.rows[0]?.inserted) newCount++;
          else updatedCount++;
        })
      );

      // Fix caller_type for repeat callers that were all inserted as 'new' in the batch
      await fixCallerTypesPostSync(targetUserId);

      // Update sync cursor
      if (syncMeta.latestTimestamp) {
        await query('UPDATE client_profiles SET ctm_sync_cursor=$1 WHERE user_id=$2', [new Date(syncMeta.latestTimestamp), targetUserId]);
      }

      // Auto-star new calls — skip known clients/journeys
      const autoStarredCalls = freshCalls.filter(({ shouldPostScore, _enrichment }) => {
        if (!shouldPostScore) return false;
        if (_enrichment?.callerType === 'active_client' || _enrichment?.journeyId) return false;
        return true;
      });
      if (autoStarredCalls.length > 0) {
        await Promise.all(
          autoStarredCalls.map(async ({ call }) => {
            try {
              await postSaleToCTM(credentials, call.id, { score: call.score, conversion: 1, value: 0 });
              // Stamp the once-marker ONLY after the CTM post succeeds. A failed post
              // leaves the row un-marked so the next sync re-applies and retries.
              await query(
                `UPDATE call_logs SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('auto_star_applied_at', to_jsonb($2::text))
                   WHERE call_id = $1 AND (owner_user_id = $3 OR user_id = $3)`,
                [call.id, new Date().toISOString(), targetUserId]
              );
            } catch (err) {
              console.error('[calls:auto-star]', err.message);
            }
          })
        );
      }
    }

    // Return updated data
    const refreshed = await query('SELECT * FROM call_logs WHERE owner_user_id=$1 OR user_id=$1 ORDER BY started_at DESC NULLS LAST', [
      targetUserId
    ]);
    let shaped = buildCallsFromCache(refreshed.rows);
    shaped = await attachJourneyMetaToCalls(targetUserId, shaped);

    return res.json({
      calls: shaped,
      synced: true,
      newCalls: newCount,
      updatedCalls: updatedCount,
      syncMeta: {
        pagesProcessed: syncMeta.pagesProcessed,
        totalFetched: syncMeta.totalFetched,
        fullSync
      },
      message: newCount || updatedCount ? `Synced ${newCount} new, ${updatedCount} updated` : 'Already up to date'
    });
  } catch (err) {
    console.error('[calls:sync]', err);
    return res.status(500).json({ message: 'Sync failed: ' + (err.message || 'Unknown error') });
  }
});

// POST /calls/full-sync - Force full historical sync (admin-only for initial setup)
router.post('/calls/full-sync', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;

  // Only allow admins/super-admins or the user themselves
  if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
    if (req.portalUserId && req.portalUserId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized: Full sync requires admin privileges.' });
    }
  }

  const profileRes = await query(
    'SELECT ctm_account_number, ctm_api_key, ctm_api_secret, ai_prompt, auto_star_enabled FROM client_profiles WHERE user_id=$1 LIMIT 1',
    [targetUserId]
  );
  const profile = profileRes.rows[0] || {};
  const credentials = resolveCtmCreds(profile);

  if (!credentials?.accountId || !credentials.apiKey || !credentials.apiSecret) {
    return res.status(400).json({ message: 'CTM credentials not configured.' });
  }

  // Reset sync cursor for full re-sync
  await query('UPDATE client_profiles SET ctm_sync_cursor=NULL WHERE user_id=$1', [targetUserId]);

  const cached = await query('SELECT * FROM call_logs WHERE owner_user_id=$1 OR user_id=$1 ORDER BY started_at DESC NULLS LAST', [
    targetUserId
  ]);

  try {
    logEvent('calls:full-sync', 'Starting full historical sync with CTM', { userId: targetUserId });

    const enrichmentLookup = ({ ownerUserId, callerNumber, callId, contactId }) =>
      enrichCallerType(query, ownerUserId, callerNumber, callId, contactId);

    const { results: freshCalls, syncMeta } = await pullCallsFromCtm({
      ownerUserId: targetUserId,
      credentials,
      prompt: profile.ai_prompt || DEFAULT_AI_PROMPT,
      existingRows: cached.rows,
      autoStarEnabled: profile.auto_star_enabled || false,
      syncRatings: true,
      fullSync: true,
      enrichmentLookup
    });

    let updatedCount = 0;
    let newCount = 0;

    if (freshCalls.length) {
      await Promise.all(
        freshCalls.map(async (item) => {
          const { call, meta } = item;
          const startedAt = call.started_at ? new Date(call.started_at) : null;

          // Reuse enrichment computed inside pullCallsFromCtm (via enrichmentLookup);
          // fall back to a fresh lookup only if it's missing for some reason.
          const enrichment = item._enrichment ?? await enrichCallerType(query, targetUserId, call.caller_number, call.id, item._contactId);
          item._enrichment = enrichment;
          // Reuse contact resolved upstream by pullCallsFromCtm — no second resolve.
          const contactId = item._contactId ?? null;

          const result = await upsertCallLog({
            ownerUserId: targetUserId,
            callId: call.id,
            direction: call.direction,
            fromNumber: call.caller_number,
            toNumber: call.to_number,
            startedAt,
            durationSec: call.duration_sec,
            score: call.score || 0,
            meta: JSON.stringify({ ...stripCtmMediaMeta(meta), ...enrichment }),
            callerType: enrichment.callerType || 'new',
            activeClientId: enrichment.activeClientId || null,
            callSequence: enrichment.callSequence || 1,
            activityType: call.activity_type || 'call',
            contactId
          }, query);
          if (result.rows[0]?.inserted) newCount++;
          else updatedCount++;
        })
      );

      // Fix caller_type for repeat callers that were all inserted as 'new' in the batch
      await fixCallerTypesPostSync(targetUserId);

      // Update sync cursor
      if (syncMeta.latestTimestamp) {
        await query('UPDATE client_profiles SET ctm_sync_cursor=$1 WHERE user_id=$2', [new Date(syncMeta.latestTimestamp), targetUserId]);
      }
    }

    logEvent('calls:full-sync', 'Full sync completed', {
      userId: targetUserId,
      newCalls: newCount,
      updatedCalls: updatedCount,
      pagesProcessed: syncMeta.pagesProcessed
    });

    return res.json({
      success: true,
      newCalls: newCount,
      updatedCalls: updatedCount,
      syncMeta: {
        pagesProcessed: syncMeta.pagesProcessed,
        totalFetched: syncMeta.totalFetched,
        startDate: syncMeta.startDate,
        endDate: syncMeta.endDate
      },
      message: `Full sync complete: ${newCount} new, ${updatedCount} updated calls`
    });
  } catch (err) {
    console.error('[calls:full-sync]', err);
    return res.status(500).json({ message: 'Full sync failed: ' + (err.message || 'Unknown error') });
  }
});

router.post('/calls/:id/score', async (req, res) => {
  const score = Number(req.body.score);
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;

  if (!score || score < 1 || score > 5) {
    return res.status(400).json({ message: 'Invalid score. Must be between 1 and 5.' });
  }

  try {
    // Save score locally and stamp client override so sync never fights a human-set star
    const scoreResult = await query(
      `UPDATE call_logs
         SET score=$1,
             meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
               'category_source', 'client',
               'category_source_detail', 'dashboard_manual_score',
               'auto_star_applied_at', to_jsonb($4::text)
             )
       WHERE call_id=$2 AND (owner_user_id=$3 OR user_id=$3)`,
      [score, callId, targetUserId, new Date().toISOString()]
    );
    if (!scoreResult.rowCount) {
      return res.status(404).json({ message: 'Call not found' });
    }
    logEvent('calls:score', 'Score saved locally', { user: targetUserId, callId, score });

    // Get CTM credentials to post back to CallTrackingMetrics
    const profileRes = await query('SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1 LIMIT 1', [
      targetUserId
    ]);
    const credentials = resolveCtmCreds(profileRes.rows[0] || null);

    // Post score to CTM if credentials are configured
    if (credentials?.accountId && credentials.apiKey && credentials.apiSecret) {
      try {
        const ctmResponse = await postSaleToCTM(credentials, callId, {
          score,
          conversion: 1,
          value: 0
        });
        logEvent('calls:score', 'Score posted to CTM', { user: targetUserId, callId, score, ctmResponse });
        res.json({ message: 'Score saved and synced to CallTrackingMetrics', rating: score });
      } catch (ctmErr) {
        logEvent('calls:score', 'CTM sync failed', { user: targetUserId, callId, error: ctmErr.message });
        // Don't fail the request if CTM sync fails - score is still saved locally
        res.json({
          message: 'Score saved locally. Warning: Could not sync to CallTrackingMetrics.',
          rating: score,
          warning: ctmErr.message
        });
      }
    } else {
      logEvent('calls:score', 'CTM credentials not configured', { user: targetUserId, callId });
      res.json({ message: 'Score saved (CallTrackingMetrics not configured)', rating: score });
    }
  } catch (err) {
    console.error('[calls:score]', err);
    logEvent('calls:score', 'Failed to save score', { user: targetUserId, callId, error: err.message });
    res.status(500).json({ message: 'Unable to save score' });
  }
});

router.delete('/calls/:id/score', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;

  try {
    // Clear score locally and stamp client override so sync defers to this deliberate clear
    const clearResult = await query(
      `UPDATE call_logs
         SET score=NULL,
             meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
               'category_source', 'client',
               'category_source_detail', 'dashboard_manual_clear'
             )
       WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2)`,
      [callId, targetUserId]
    );
    if (!clearResult.rowCount) {
      return res.status(404).json({ message: 'Call not found' });
    }
    logEvent('calls:score', 'Score cleared locally', { user: targetUserId, callId });

    // Get CTM credentials to clear score in CallTrackingMetrics
    const profileRes = await query('SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1 LIMIT 1', [
      targetUserId
    ]);
    const credentials = resolveCtmCreds(profileRes.rows[0] || null);

    // Clear score in CTM if credentials are configured
    if (credentials?.accountId && credentials.apiKey && credentials.apiSecret) {
      try {
        const ctmResponse = await postSaleToCTM(credentials, callId, {
          score: 0,
          conversion: 0,
          value: 0
        });
        logEvent('calls:score', 'Score cleared in CTM', { user: targetUserId, callId, ctmResponse });
        res.json({ message: 'Score cleared and synced to CallTrackingMetrics' });
      } catch (ctmErr) {
        logEvent('calls:score', 'CTM clear failed', { user: targetUserId, callId, error: ctmErr.message });
        // Don't fail the request if CTM sync fails - score is still cleared locally
        res.json({
          message: 'Score cleared locally. Warning: Could not sync to CallTrackingMetrics.',
          warning: ctmErr.message
        });
      }
    } else {
      logEvent('calls:score', 'CTM credentials not configured for clear', { user: targetUserId, callId });
      res.json({ message: 'Score cleared (CallTrackingMetrics not configured)' });
    }
  } catch (err) {
    console.error('[calls:score:clear]', err);
    logEvent('calls:score', 'Failed to clear score', { user: targetUserId, callId, error: err.message });
    res.status(500).json({ message: 'Unable to clear score' });
  }
});

router.post('/calls/reset-cache', requireAdmin, async (_req, res) => {
  res.json({ message: 'Call cache reset (noop stub)' });
});

// POST /calls/:id/link-client - Link a call to an existing active client
router.post('/calls/:id/link-client', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;
  const { activeClientId } = req.body;

  if (!activeClientId) {
    return res.status(400).json({ message: 'activeClientId is required' });
  }

  try {
    await ensureActiveClientArchiveColumn();
    // Verify the active client exists and belongs to the user
    const clientRes = await query(`SELECT id, client_name FROM active_clients WHERE id=$1 AND owner_user_id=$2 AND ${activeOnly()}`, [
      activeClientId,
      targetUserId
    ]);

    if (!clientRes.rows.length) {
      return res.status(404).json({ message: 'Active client not found' });
    }

    const client = clientRes.rows[0];

    // Update the call log with the active client link
    await query(
      `UPDATE call_logs 
       SET active_client_id=$1, caller_type='returning_customer', 
           meta = meta || $2::jsonb
       WHERE call_id=$3 AND (owner_user_id=$4 OR user_id=$4)`,
      [activeClientId, JSON.stringify({ activeClient: { id: client.id, client_name: client.client_name } }), callId, targetUserId]
    );

    logEvent('calls:link-client', 'Call linked to active client', { callId, activeClientId, userId: targetUserId });

    res.json({
      message: `Call linked to ${client.client_name}`,
      activeClient: client
    });
  } catch (err) {
    console.error('[calls:link-client]', err);
    res.status(500).json({ message: 'Failed to link call to client' });
  }
});

// DELETE /calls/:id/link-client - Unlink a call from active client
router.delete('/calls/:id/link-client', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;

  try {
    // Re-enrich caller type (might still be a repeat caller)
    const callRes = await query('SELECT from_number, contact_id FROM call_logs WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2)', [
      callId,
      targetUserId
    ]);

    if (!callRes.rows.length) {
      return res.status(404).json({ message: 'Call not found' });
    }

    const phoneNumber = callRes.rows[0].from_number;
    const contactId = callRes.rows[0].contact_id;
    const enrichment = await enrichCallerType(query, targetUserId, phoneNumber, callId, contactId);

    // If they were linked to a client but now unlinked, check if still a repeat caller
    const newCallerType = enrichment.callSequence > 1 ? 'repeat' : 'new';

    await query(
      `UPDATE call_logs 
       SET active_client_id=NULL, caller_type=$1,
           meta = meta - 'activeClient'
       WHERE call_id=$2 AND (owner_user_id=$3 OR user_id=$3)`,
      [newCallerType, callId, targetUserId]
    );

    logEvent('calls:unlink-client', 'Call unlinked from active client', { callId, userId: targetUserId });

    res.json({ message: 'Call unlinked from client', callerType: newCallerType });
  } catch (err) {
    console.error('[calls:unlink-client]', err);
    res.status(500).json({ message: 'Failed to unlink call from client' });
  }
});

// GET /calls/:id/history - Get call history for a phone number
router.get('/calls/:id/history', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;

  try {
    // Get the call to find the phone number + its contact link
    const callRes = await query('SELECT from_number, contact_id FROM call_logs WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2)', [
      callId,
      targetUserId
    ]);

    if (!callRes.rows.length) {
      return res.status(404).json({ message: 'Call not found' });
    }

    const phoneNumber = callRes.rows[0].from_number;
    const contactId = callRes.rows[0].contact_id;

    // Phase 3: prefer the contact_id timeline (unifies every number/email the contact
    // has used). Fall back to phone-matching when contact_id isn't populated yet
    // (pre-backfill / null) — behavior-identical to before.
    // Include activity_type so the timeline can distinguish true calls from form-sourced
    // rows: the contact_id branch unifies all of a contact's activity, and the phone
    // branch already matched form rows sharing the number, so both can return non-calls.
    const historyCols = `call_id, COALESCE(activity_type, 'call') AS activity_type, started_at, duration_sec, score, caller_type,
              meta->>'classification' as classification,
              meta->>'classification_summary' as summary,
              meta->>'category' as category`;
    let historyRes;
    if (contactId) {
      historyRes = await query(
        `SELECT ${historyCols}
         FROM call_logs
         WHERE (owner_user_id=$1 OR user_id=$1) AND contact_id=$2
         ORDER BY started_at DESC
         LIMIT 50`,
        [targetUserId, contactId]
      );
    } else {
      if (!phoneNumber) {
        return res.json({ calls: [], message: 'No phone number recorded' });
      }
      const normalized = normalizePhoneNumber(phoneNumber);
      historyRes = await query(
        `SELECT ${historyCols}
         FROM call_logs
         WHERE (owner_user_id=$1 OR user_id=$1)
           AND from_number IS NOT NULL
           AND REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')
         ORDER BY started_at DESC
         LIMIT 50`,
        [targetUserId, normalized]
      );
    }

    res.json({
      calls: historyRes.rows,
      phoneNumber,
      totalCalls: historyRes.rows.length
    });
  } catch (err) {
    console.error('[calls:history]', err);
    res.status(500).json({ message: 'Failed to fetch call history' });
  }
});

// GET /calls/:id/detail - Full lead detail with all related data
router.get('/calls/:id/detail', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;

  try {
    // Get the full call record
    const callRes = await query(`SELECT * FROM call_logs WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2)`, [callId, targetUserId]);

    if (!callRes.rows.length) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const row = callRes.rows[0];
    const call = buildCallsFromCache([row])[0];

    // Get call history for this contact. Phase 3: prefer the contact_id timeline (all of
    // the contact's numbers); fall back to phone-matching when contact_id is null.
    let callHistory = [];
    const detailHistCols = `call_id, started_at, duration_sec, score, caller_type, COALESCE(activity_type, 'call') AS activity_type,
                meta->>'category' as category,
                meta->>'classification_summary' as summary`;
    if (row.contact_id) {
      const historyRes = await query(
        `SELECT ${detailHistCols}
         FROM call_logs
         WHERE (owner_user_id=$1 OR user_id=$1) AND contact_id=$2 AND call_id != $3
         ORDER BY started_at DESC
         LIMIT 20`,
        [targetUserId, row.contact_id, callId]
      );
      callHistory = historyRes.rows;
    } else if (row.from_number) {
      const normalized = normalizePhoneNumber(row.from_number);
      const historyRes = await query(
        `SELECT ${detailHistCols}
         FROM call_logs
         WHERE (owner_user_id=$1 OR user_id=$1)
           AND from_number IS NOT NULL
           AND REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')
           AND call_id != $3
         ORDER BY started_at DESC
         LIMIT 20`,
        [targetUserId, normalized, callId]
      );
      callHistory = historyRes.rows;
    }

    // Get associated journey if any
    let journey = null;
    const journeyRes = await query(
      `SELECT cj.*, s.name as service_name
       FROM client_journeys cj
       LEFT JOIN services s ON cj.service_id = s.id
       WHERE cj.owner_user_id = $1
         AND cj.lead_call_key = $2
         AND ${activeOnly('cj')}
         AND cj.active_client_id IS NULL
         AND COALESCE(cj.status, 'in_progress') NOT IN ('active_client', 'won', 'lost', 'archived')
       ORDER BY cj.created_at DESC
       LIMIT 1`,
      [targetUserId, callId]
    );
    if (journeyRes.rows.length) {
      journey = journeyRes.rows[0];
      // Get journey steps
      const stepsRes = await query(`SELECT * FROM client_journey_steps WHERE journey_id = $1 ORDER BY position ASC`, [journey.id]);
      journey.steps = stepsRes.rows;
    }

    // Get linked active client if any
    let activeClient = null;
    if (row.active_client_id) {
      const clientRes = await query(
        `SELECT ac.*, 
                (SELECT json_agg(cs.*) FROM client_services cs WHERE cs.active_client_id = ac.id) as services
         FROM active_clients ac
         WHERE ac.id = $1`,
        [row.active_client_id]
      );
      if (clientRes.rows.length) {
        activeClient = clientRes.rows[0];
      }
    }

    // Contact name overlay for the drawer header + rename prefill.
    let contactDisplayName = null, contactNameSource = null;
    const detailContactId = row.contact_id || null;
    if (detailContactId) {
      try {
        const cn = await query(
          'SELECT display_name, display_name_source FROM contacts WHERE id = $1 AND owner_user_id = $2',
          [detailContactId, targetUserId]
        );
        contactDisplayName = cn.rows[0]?.display_name || null;
        contactNameSource = cn.rows[0]?.display_name_source || null;
      } catch (err) { console.error('[calls:detail:contactName]', { code: err?.code }); }
    }

    res.json({
      lead: call,
      callHistory,
      journey,
      activeClient,
      contact_id: detailContactId,
      contact_display_name: contactDisplayName,
      contact_name_source: contactNameSource
    });
  } catch (err) {
    console.error('[calls:detail]', err);
    res.status(500).json({ message: 'Failed to fetch lead detail' });
  }
});

// GET /calls/:id/recording - Resolve the current recording URL on demand
router.get('/calls/:id/recording', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;

  try {
    const resolved = await resolveCallRecording(targetUserId, callId);
    if (!resolved.audioUrl) {
      return res.status(resolved.status || 404).json({ message: resolved.message || 'No recording available for this call' });
    }

    return res.json({ audioUrl: resolved.audioUrl });
  } catch (err) {
    console.error('[calls:recording]', err);
    res.status(500).json({ message: 'Failed to fetch recording' });
  }
});

router.get('/calls/:id/recording/stream', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const callId = req.params.id;

  try {
    const resolved = await resolveCallRecording(targetUserId, callId);
    if (!resolved.audioUrl) {
      return res.status(resolved.status || 404).json({ message: resolved.message || 'No recording available for this call' });
    }

    const upstreamHeaders = { Accept: '*/*' };
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;
    if (resolved.provider === 'ctm' && resolved.credentials?.apiKey && resolved.credentials?.apiSecret) {
      upstreamHeaders.Authorization = `Basic ${Buffer.from(`${resolved.credentials.apiKey}:${resolved.credentials.apiSecret}`).toString('base64')}`;
    }

    const upstream = await axios.get(resolved.audioUrl, {
      headers: upstreamHeaders,
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    if (upstream.status >= 400) {
      upstream.data?.destroy?.();
      return res.status(502).json({ message: 'Failed to load recording audio' });
    }

    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'etag',
      'last-modified'
    ];
    passthroughHeaders.forEach((header) => {
      const value = upstream.headers?.[header];
      if (value) res.setHeader(header, value);
    });
    // HTMLAudioElement refuses to play blobs with non-audio MIME types.
    // CTM/Twilio recording CDNs sometimes serve octet-stream or no content-type at all.
    const upstreamType = String(res.getHeader('content-type') || '').toLowerCase();
    if (!upstreamType || !upstreamType.startsWith('audio/')) {
      const url = String(resolved.audioUrl || '').toLowerCase();
      let fallbackType = 'audio/mpeg';
      if (url.includes('.wav')) fallbackType = 'audio/wav';
      else if (url.includes('.m4a') || url.includes('.mp4')) fallbackType = 'audio/mp4';
      else if (url.includes('.ogg')) fallbackType = 'audio/ogg';
      res.setHeader('content-type', fallbackType);
    }
    if (!res.getHeader('accept-ranges')) {
      res.setHeader('accept-ranges', 'bytes');
    }

    res.status(upstream.status);
    upstream.data.on('error', (err) => {
      console.error('[calls:recording:stream] upstream error', err.message);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Failed to stream recording' });
      } else {
        res.destroy(err);
      }
    });
    upstream.data.pipe(res);
  } catch (err) {
    console.error('[calls:recording:stream]', err);
    res.status(500).json({ message: 'Failed to stream recording' });
  }
});

// GET /calls/stats - Lead statistics for dashboard
router.get('/calls/stats', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    // Total leads in period
    const totalRes = await query(
      `SELECT COUNT(*) as total FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) AND started_at >= $2`,
      [targetUserId, startDate]
    );

    // Leads by category
    const categoryRes = await query(
      `SELECT meta->>'category' as category, COUNT(*) as count
       FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) AND started_at >= $2
       GROUP BY meta->>'category'
       ORDER BY count DESC`,
      [targetUserId, startDate]
    );

    // Leads by caller type
    const callerTypeRes = await query(
      `SELECT caller_type, COUNT(*) as count
       FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) AND started_at >= $2
       GROUP BY caller_type`,
      [targetUserId, startDate]
    );

    // Leads by source
    const sourceRes = await query(
      `SELECT meta->>'source' as source, COUNT(*) as count
       FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) AND started_at >= $2
       GROUP BY meta->>'source'
       ORDER BY count DESC
       LIMIT 10`,
      [targetUserId, startDate]
    );

    // Conversion rate (leads with active_client_id / total)
    const convertedRes = await query(
      `SELECT COUNT(*) as converted FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) AND started_at >= $2 AND active_client_id IS NOT NULL`,
      [targetUserId, startDate]
    );

    // Daily volume (last 14 days)
    const volumeRes = await query(
      `SELECT DATE(started_at) as date, COUNT(*) as count
       FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) AND started_at >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(started_at)
       ORDER BY date ASC`,
      [targetUserId]
    );

    // Average rating
    const ratingRes = await query(
      `SELECT AVG(score) as avg_rating, COUNT(*) as rated_count
       FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) AND started_at >= $2 AND score > 0`,
      [targetUserId, startDate]
    );

    // Needs attention count
    const attentionRes = await query(
      `SELECT COUNT(*) as count FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1) 
         AND started_at >= $2 
         AND (
           meta->>'category' = 'needs_attention'
           OR COALESCE(meta->>'requires_callback', 'false') = 'true'
         )`,
      [targetUserId, startDate]
    );

    const total = parseInt(totalRes.rows[0]?.total || 0, 10);
    const converted = parseInt(convertedRes.rows[0]?.converted || 0, 10);

    res.json({
      period: { days, startDate: startDate.toISOString() },
      total,
      converted,
      conversionRate: total > 0 ? ((converted / total) * 100).toFixed(1) : 0,
      needsAttention: parseInt(attentionRes.rows[0]?.count || 0, 10),
      averageRating: parseFloat(ratingRes.rows[0]?.avg_rating || 0).toFixed(1),
      ratedCount: parseInt(ratingRes.rows[0]?.rated_count || 0, 10),
      byCategory: categoryRes.rows.reduce((acc, row) => {
        acc[row.category || 'unreviewed'] = parseInt(row.count, 10);
        return acc;
      }, {}),
      byCallerType: callerTypeRes.rows.reduce((acc, row) => {
        acc[row.caller_type || 'new'] = parseInt(row.count, 10);
        return acc;
      }, {}),
      bySource: sourceRes.rows.map((row) => ({
        source: row.source || 'Unknown',
        count: parseInt(row.count, 10)
      })),
      dailyVolume: volumeRes.rows.map((row) => ({
        date: row.date,
        count: parseInt(row.count, 10)
      }))
    });
  } catch (err) {
    console.error('[calls:stats]', err);
    res.status(500).json({ message: 'Failed to fetch lead statistics' });
  }
});

// GET /calls/export - Export leads to CSV
router.get('/calls/export', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;

  try {
    const callsRes = await query(
      `SELECT 
        call_id,
        from_number,
        to_number,
        direction,
        started_at,
        duration_sec,
        score,
        caller_type,
        meta->>'caller_name' as caller_name,
        meta->>'source' as source,
        meta->>'category' as category,
        meta->>'classification' as classification,
        meta->>'classification_summary' as summary,
        meta->>'region' as region
       FROM call_logs 
       WHERE (owner_user_id=$1 OR user_id=$1)
       ORDER BY started_at DESC`,
      [targetUserId]
    );

    // Build CSV
    const headers = [
      'Call ID',
      'Caller Name',
      'Phone',
      'Direction',
      'Date',
      'Duration (sec)',
      'Rating',
      'Type',
      'Source',
      'Category',
      'Classification',
      'Summary',
      'Region'
    ];
    const rows = callsRes.rows.map((row) => [
      row.call_id,
      row.caller_name || '',
      row.from_number || '',
      row.direction || '',
      row.started_at ? new Date(row.started_at).toISOString() : '',
      row.duration_sec || 0,
      row.score || '',
      row.caller_type || 'new',
      row.source || '',
      row.category || 'unreviewed',
      row.classification || '',
      (row.summary || '').replace(/"/g, '""'),
      row.region || ''
    ]);

    const escapeCsv = (val) => {
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csv = [headers.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');

    // Audit log data export (HIPAA/SOC2 requirement)
    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: {
        action: 'data_export',
        exportType: 'leads_csv',
        targetUserId: targetUserId,
        recordCount: rows.length
      }
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[calls:export]', err);
    res.status(500).json({ message: 'Failed to export leads' });
  }
});

// PUT /calls/:id/stage - Move a lead to a pipeline stage
router.put('/calls/:id/stage', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id: callId } = req.params;
  const { stage_id } = req.body;

  try {
    // Verify stage belongs to user if provided
    if (stage_id) {
      const stageRes = await query('SELECT id FROM lead_pipeline_stages WHERE id = $1 AND owner_user_id = $2', [stage_id, targetUserId]);
      if (!stageRes.rows.length) {
        return res.status(404).json({ message: 'Pipeline stage not found' });
      }
    }

    const result = await query(
      `UPDATE call_logs SET pipeline_stage_id = $1 
       WHERE call_id = $2 AND (owner_user_id = $3 OR user_id = $3)
       RETURNING call_id`,
      [stage_id || null, callId, targetUserId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    res.json({ message: 'Lead moved to stage', callId, stageId: stage_id });
  } catch (err) {
    console.error('[calls:stage]', err);
    res.status(500).json({ message: 'Failed to update lead stage' });
  }
});

// GET /calls/:id/tags - Get tags for a specific call
router.get('/calls/:id/tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id: callId } = req.params;

  try {
    const result = await query(
      `SELECT lt.* FROM lead_tags lt
       JOIN call_log_tags clt ON lt.id = clt.tag_id
       WHERE clt.call_id = $1 AND lt.owner_user_id = $2
       ORDER BY lt.name ASC`,
      [callId, targetUserId]
    );
    res.json({ tags: result.rows });
  } catch (err) {
    console.error('[call-tags:list]', err);
    res.status(500).json({ message: 'Failed to fetch call tags' });
  }
});

// POST /calls/:id/tags - Add tag to a call
router.post('/calls/:id/tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id: callId } = req.params;
  const { tag_id, tag_name, tag_color } = req.body;

  try {
    // Verify the call belongs to this user
    const callOwnerCheck = await query(
      'SELECT call_id, contact_id, owner_user_id FROM call_logs WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2)',
      [callId, targetUserId]
    );
    if (callOwnerCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Call not found or access denied' });
    }

    let tagId = tag_id;

    // If no tag_id but tag_name provided, create or get the tag
    if (!tagId && tag_name) {
      if (isReservedTagName(tag_name)) {
        return res.status(400).json({ message: `“${tag_name.trim()}” is a category, not a tag — pick a different name.` });
      }
      const tagResult = await query(
        `INSERT INTO lead_tags (owner_user_id, name, color)
         VALUES ($1, $2, $3)
         ON CONFLICT (owner_user_id, name) DO UPDATE SET color = COALESCE(EXCLUDED.color, lead_tags.color)
         RETURNING *`,
        [targetUserId, tag_name.trim(), tag_color || '#6366f1']
      );
      tagId = tagResult.rows[0].id;
    }

    if (!tagId) {
      return res.status(400).json({ message: 'Tag ID or name is required' });
    }

    // Add the tag to the call
    await query(
      `INSERT INTO call_log_tags (call_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT (call_id, tag_id) DO NOTHING`,
      [callId, tagId]
    );

    // Roll the tag up onto the linked contact so contact-level tags accrue from activity.
    // Additive + idempotent (mirrors the system-tag rollup); best-effort so a failure here
    // never blocks the primary call-tag write.
    const contactId = callOwnerCheck.rows[0].contact_id;
    if (contactId) {
      await applyContactTags({
        contactId,
        ownerUserId: callOwnerCheck.rows[0].owner_user_id || targetUserId,
        tagIds: [tagId],
        source: 'user',
        createdBy: req.user.id
      }).catch((e) => console.error('[call-tags:contact-rollup]', { code: e?.code }));
    }

    // Return updated tags for this call
    const result = await query(
      `SELECT lt.* FROM lead_tags lt
       JOIN call_log_tags clt ON lt.id = clt.tag_id
       WHERE clt.call_id = $1 AND lt.owner_user_id = $2
       ORDER BY lt.name ASC`,
      [callId, targetUserId]
    );

    res.json({ tags: result.rows });
  } catch (err) {
    console.error('[call-tags:add]', err);
    res.status(500).json({ message: 'Failed to add tag' });
  }
});

// DELETE /calls/:id/tags/:tagId - Remove tag from a call
router.delete('/calls/:id/tags/:tagId', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id: callId, tagId } = req.params;

  try {
    // Verify the call belongs to this user
    const callOwnerCheck = await query(
      'SELECT call_id FROM call_logs WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2)',
      [callId, targetUserId]
    );
    if (callOwnerCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Call not found or access denied' });
    }

    await query('DELETE FROM call_log_tags WHERE call_id = $1 AND tag_id = $2', [callId, tagId]);
    res.json({ message: 'Tag removed from call' });
  } catch (err) {
    console.error('[call-tags:remove]', err);
    res.status(500).json({ message: 'Failed to remove tag' });
  }
});

// PUT /calls/:id/category - Update call category/classification
router.put('/calls/:id/category', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id: callId } = req.params;
  const { category } = req.body;

  // 'unanswered' and 'voicemail' describe a call state — there is no way for
  // a form submission, SMS, or email to be "unanswered." Gate them to
  // activity_type='call' so the Unanswered tab can't be polluted by forms.
  const CALL_ONLY_CATEGORIES = new Set(['unanswered', 'voicemail']);
  const validCategories = new Set([
    'converted',
    'warm',
    'very_good',
    'applicant',
    'needs_attention',
    'unanswered',
    'not_a_fit',
    'spam',
    'neutral',
    'unreviewed'
  ]);

  if (!validCategories.has(category)) {
    return res.status(400).json({ message: 'Invalid category' });
  }

  try {
    const existingRes = await query(
      'SELECT meta, activity_type, score FROM call_logs WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2) LIMIT 1',
      [callId, targetUserId]
    );
    if (!existingRes.rows[0]) {
      return res.status(404).json({ message: 'Entry not found' });
    }
    if (CALL_ONLY_CATEGORIES.has(category) && existingRes.rows[0].activity_type !== 'call') {
      return res.status(400).json({
        message: `The "${category}" category is reserved for phone calls and cannot be applied to ${existingRes.rows[0].activity_type} entries.`
      });
    }
    const meta = existingRes.rows[0]?.meta || {};
    const currentScore = Number(existingRes.rows[0]?.score || 0);
    const systemTags = buildSystemTags({
      semanticCategory: category,
      isReferral: meta?.is_referral === true,
      categorySource: 'client'
    });
    const nowIso = new Date().toISOString();

    await query(
      `UPDATE call_logs
       SET meta = $1::jsonb
       WHERE call_id = $2 AND (owner_user_id = $3 OR user_id = $3)`,
      [
        JSON.stringify({
          ...meta,
          category,
          semantic_category: category,
          category_source: 'client',
          category_source_detail: 'dashboard_manual',
          system_tags: systemTags,
          category_updated_at: nowIso
        }),
        callId,
        targetUserId
      ]
    );

    // Couple category -> star for qualified lead tiers, but never downgrade a
    // manual 4★ or 5★ — those are set by a human (booked/converted) and must
    // be preserved. Only upgrade 0/1/2/3 → 3. Non-qualified categories leave
    // the star to the human (clearing is an explicit DELETE /score action).
    const QUALIFIED_TIERS = new Set(['warm', 'very_good', 'needs_attention']);
    let appliedScore = null;
    if (QUALIFIED_TIERS.has(category) && currentScore < 4) {
      appliedScore = getAutoStarRating(category); // 3
      await query(
        'UPDATE call_logs SET score=$1 WHERE call_id=$2 AND (owner_user_id=$3 OR user_id=$3)',
        [appliedScore, callId, targetUserId]
      );
      const profileRes = await query(
        'SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1 LIMIT 1',
        [targetUserId]
      );
      const credentials = resolveCtmCreds(profileRes.rows[0] || null);
      if (credentials?.accountId && credentials.apiKey && credentials.apiSecret) {
        try {
          await postSaleToCTM(credentials, callId, { score: appliedScore, conversion: 1, value: 0 });
        } catch (ctmErr) {
          logEvent('calls:category', 'CTM score sync failed', { user: targetUserId, callId, error: ctmErr.message });
        }
      }
    }

    const response = { message: 'Category updated', category, categorySource: 'client' };
    if (appliedScore !== null) response.score = appliedScore;
    res.json(response);
  } catch (err) {
    console.error('[calls:category]', err);
    res.status(500).json({ message: 'Failed to update category' });
  }
});

// PUT /calls/:id/hide - Hide all activity from this contact (by phone number)
router.put('/calls/:id/hide', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    // Get the phone number for this call
    const { rows: callRows } = await query(
      `SELECT from_number FROM call_logs WHERE id = $1 AND (owner_user_id = $2 OR user_id = $2)`,
      [req.params.id, targetUserId]
    );
    if (!callRows[0]) return res.status(404).json({ message: 'Call not found' });

    const phone = callRows[0].from_number;
    // Hide ALL calls from this phone number (right 10 digits match)
    const { rowCount } = await query(
      `UPDATE call_logs SET hidden_at = NOW()
       WHERE (owner_user_id = $1 OR user_id = $1)
         AND hidden_at IS NULL
         AND RIGHT(REGEXP_REPLACE(from_number, '[^\\d]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($2, '[^\\d]', '', 'g'), 10)`,
      [targetUserId, phone]
    );
    await logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.HIDE_CALL,
      actionCategory: ActivityCategories.CLIENT,
      targetUserId,
      targetEntityType: 'call_log',
      targetEntityId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { scope: 'phone_bulk', phone_last4: (phone || '').replace(/\D/g, '').slice(-4), rows_affected: rowCount }
    });
    res.json({ success: true, hiddenCount: rowCount, phone });
  } catch (err) {
    console.error('[calls:hide]', err);
    res.status(500).json({ message: 'Failed to hide activity' });
  }
});

// PUT /calls/:id/unhide - Unhide all activity from this contact (by phone number)
router.put('/calls/:id/unhide', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const { rows: callRows } = await query(
      `SELECT from_number FROM call_logs WHERE id = $1 AND (owner_user_id = $2 OR user_id = $2)`,
      [req.params.id, targetUserId]
    );
    if (!callRows[0]) return res.status(404).json({ message: 'Call not found' });

    const phone = callRows[0].from_number;
    const { rowCount } = await query(
      `UPDATE call_logs SET hidden_at = NULL
       WHERE (owner_user_id = $1 OR user_id = $1)
         AND hidden_at IS NOT NULL
         AND RIGHT(REGEXP_REPLACE(from_number, '[^\\d]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($2, '[^\\d]', '', 'g'), 10)`,
      [targetUserId, phone]
    );
    await logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.UNHIDE_CALL,
      actionCategory: ActivityCategories.CLIENT,
      targetUserId,
      targetEntityType: 'call_log',
      targetEntityId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { scope: 'phone_bulk', phone_last4: (phone || '').replace(/\D/g, '').slice(-4), rows_affected: rowCount }
    });
    res.json({ success: true, unhiddenCount: rowCount, phone });
  } catch (err) {
    console.error('[calls:unhide]', err);
    res.status(500).json({ message: 'Failed to unhide activity' });
  }
});

// PUT /calls/:id/hide-single - Hide just this one call entry
router.put('/calls/:id/hide-single', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    await query(
      `UPDATE call_logs SET hidden_at = NOW() WHERE id = $1 AND (owner_user_id = $2 OR user_id = $2)`,
      [req.params.id, targetUserId]
    );
    await logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.HIDE_CALL_SINGLE,
      actionCategory: ActivityCategories.CLIENT,
      targetUserId,
      targetEntityType: 'call_log',
      targetEntityId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { scope: 'single' }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[calls:hide-single]', err);
    res.status(500).json({ message: 'Failed to hide call' });
  }
});

// Clear all calls and reload from CTM
router.delete('/calls', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;

  try {
    // Delete all cached calls for this user
    const { rowCount } = await query('DELETE FROM call_logs WHERE user_id=$1', [targetUserId]);
    logEvent('calls:clear-all', 'All calls cleared', { user: targetUserId, deletedCount: rowCount });

    // Now fetch fresh calls from CTM (same logic as GET /calls)
    const profileRes = await query(
      'SELECT ctm_account_number, ctm_api_key, ctm_api_secret, ai_prompt, auto_star_enabled FROM client_profiles WHERE user_id=$1 LIMIT 1',
      [targetUserId]
    );
    const profile = profileRes.rows[0] || {};
    const credentials = resolveCtmCreds(profile);

    if (!credentials?.accountId || !credentials.apiKey || !credentials.apiSecret) {
      return res.json({
        message: 'All calls cleared. CallTrackingMetrics credentials not configured.',
        calls: []
      });
    }

    // Fetch fresh calls
    const enrichmentLookup = ({ ownerUserId, callerNumber, callId, contactId }) =>
      enrichCallerType(query, ownerUserId, callerNumber, callId, contactId);

    const { results: freshCalls } = await pullCallsFromCtm({
      ownerUserId: targetUserId,
      credentials,
      prompt: profile.ai_prompt || DEFAULT_AI_PROMPT,
      existingRows: [], // Empty since we just cleared everything
      autoStarEnabled: profile.auto_star_enabled || false,
      enrichmentLookup
    });

    // Save fresh calls
    if (freshCalls.length) {
      await Promise.all(
        freshCalls.map(async ({ call, meta, _enrichment, _contactId }) => {
          const startedAt = call.started_at ? new Date(call.started_at) : null;
          const enrichment = _enrichment || {};
          // Reuse contact resolved upstream by pullCallsFromCtm — no second resolve.
          const contactId = _contactId ?? null;
          return upsertCallLog({
            ownerUserId: targetUserId,
            callId: call.id,
            direction: call.direction,
            fromNumber: call.caller_number,
            toNumber: call.to_number,
            startedAt,
            durationSec: call.duration_sec,
            score: call.score || 0,
            meta: JSON.stringify(meta || {}),
            callerType: enrichment.callerType || 'new',
            activeClientId: enrichment.activeClientId || null,
            callSequence: enrichment.callSequence || 1,
            activityType: call.activity_type || 'call',
            contactId
          }, query);
        })
      );

      // Fix caller_type for repeat callers that were all inserted as 'new' in the batch
      await fixCallerTypesPostSync(targetUserId);

      // Post auto-starred scores back to CTM — skip known clients/journeys
      const autoStarredCalls = freshCalls.filter(({ shouldPostScore, _enrichment }) => {
        if (!shouldPostScore) return false;
        if (_enrichment?.callerType === 'active_client' || _enrichment?.journeyId) return false;
        return true;
      });
      if (autoStarredCalls.length > 0) {
        await Promise.all(
          autoStarredCalls.map(async ({ call }) => {
            try {
              await postSaleToCTM(credentials, call.id, {
                score: call.score,
                conversion: 1,
                value: 0
              });
              // Stamp the once-marker ONLY after the CTM post succeeds. A failed post
              // leaves the row un-marked so the next sync re-applies and retries.
              await query(
                `UPDATE call_logs SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('auto_star_applied_at', to_jsonb($2::text))
                   WHERE call_id = $1 AND (owner_user_id = $3 OR user_id = $3)`,
                [call.id, new Date().toISOString(), targetUserId]
              );
            } catch (err) {
              console.error('[calls:clear-reload] Failed to post score to CTM', { callId: call.id, error: err.message });
            }
          })
        );
      }
    }

    const refreshed = await query('SELECT * FROM call_logs WHERE user_id=$1 ORDER BY started_at DESC NULLS LAST', [targetUserId]);
    logEvent('calls:clear-all', 'Calls reloaded', { user: targetUserId, newCount: refreshed.rows.length });
    let shaped = buildCallsFromCache(refreshed.rows);
    shaped = await attachJourneyMetaToCalls(targetUserId, shaped);
    res.json({
      message: `Successfully cleared and reloaded ${freshCalls.length} call(s)`,
      calls: shaped
    });
  } catch (err) {
    console.error('[calls:clear-all]', err);
    logEvent('calls:clear-all', 'Failed to clear/reload calls', { user: targetUserId, error: err.message });
    res.status(500).json({ message: 'Unable to clear and reload calls' });
  }
});

export default router;
