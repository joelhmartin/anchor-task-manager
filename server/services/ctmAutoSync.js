// Background CTM sync + classification drain.
//
// Two entry points, both safe to call on an interval:
//
// 1. syncCallsForOwner(userId)
//    Mirrors what `GET /api/hub/calls?sync=true` does for a single owner:
//    pulls new calls from CTM via the owner's sync cursor, upserts them into
//    call_logs, fixes caller_type, posts auto-star scores back to CTM, fires
//    the qualified_call tracking relay, and creates voicemail notifications.
//    If the cursor is fresh (CTM returns no new calls), no AI tokens are spent.
//
// 2. drainPendingClassifications({ limit })
//    Re-runs the AI classifier on rows where meta.classification_pending=true.
//    These are rows the inline sync couldn't classify because of the per-pull
//    AI cap (CLASSIFY_LIMIT=40) or the first-import 30-day window. No CTM API
//    calls — content is already cached in meta.transcript/message.
//
// The 15-minute cron in server/index.js calls both. Bounded concurrency and
// per-owner work skipping keep tick cost ~0 when there's nothing to do.

import { query } from '../db.js';
import {
  pullCallsFromCtm,
  classifyContent,
  resolveCtmCreds,
  postSaleToCTM,
  enrichCallerType,
  getAutoStarRating,
  DEFAULT_AI_PROMPT
} from './ctm.js';
import { sendEvent as sendTrackingEvent } from './trackingRelay.js';
import { createNotification } from './notifications.js';
import { upsertCallLog, callLogsHasContactId } from './callLogUpsert.js';

// Mirror of QUALIFIED_LEAD_CATEGORIES in routes/hub.js — internal classifier
// labels that collapse to the "Lead" chip and should fire qualified_call.
const QUALIFIED_LEAD_CATEGORIES = new Set(['warm', 'very_good', 'good', 'hot', 'very_hot', 'needs_attention', 'converted']);

function stripCtmMediaMeta(meta = {}) {
  const next = { ...(meta || {}) };
  delete next.recording_url;
  delete next.assets;
  return next;
}

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

/**
 * Pull new CTM calls for a single owner and run the same downstream side
 * effects as the interactive sync endpoint. Idempotent: if CTM returns
 * nothing past the cursor, the function exits without writing anything or
 * burning any AI tokens.
 *
 * @param {string} userId
 * @returns {Promise<{ owner: string, newCalls: number, skipped?: string }>}
 */
export async function syncCallsForOwner(userId) {
  const profileRes = await query(
    'SELECT ctm_account_number, ctm_api_key, ctm_api_secret, ai_prompt, auto_star_enabled, ctm_sync_cursor FROM client_profiles WHERE user_id=$1 LIMIT 1',
    [userId]
  );
  const profile = profileRes.rows[0] || {};
  const credentials = resolveCtmCreds(profile);
  if (!credentials?.accountId || !credentials.apiKey || !credentials.apiSecret) {
    return { owner: userId, newCalls: 0, skipped: 'no_credentials' };
  }

  const cached = await query(
    'SELECT * FROM call_logs WHERE owner_user_id=$1 OR user_id=$1 ORDER BY started_at DESC NULLS LAST LIMIT 1000',
    [userId]
  );
  const cachedRows = cached.rows;

  // First-import detection only matters on the very first sync. Cron ticks for
  // an established client will always have a cursor (or cached rows), so the
  // 30-day window stays disengaged here.
  const isFirstImport = !profile.ctm_sync_cursor && (!cachedRows || cachedRows.length === 0);
  const classifyOnlyAfter = isFirstImport ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : null;

  const enrichmentLookup = ({ ownerUserId, callerNumber, callId, contactId }) =>
    enrichCallerType(query, ownerUserId, callerNumber, callId, contactId);

  // Fallback lookup for off-page rows so cron sync doesn't clobber manual scores
  // or category overrides on call_logs outside the cached 1000-row window.
  const findExistingByCallId = async (callId) => {
    const { rows } = await query(
      `SELECT call_id, score, meta FROM call_logs
       WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2)
       LIMIT 1`,
      [callId, userId]
    );
    return rows[0] || null;
  };

  const { results: freshCalls, syncMeta } = await pullCallsFromCtm({
    ownerUserId: userId,
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

  if (!freshCalls.length) {
    return { owner: userId, newCalls: 0 };
  }

  await Promise.all(
    freshCalls.map(async (item) => {
      const { call, meta } = item;
      const startedAt = call.started_at ? new Date(call.started_at) : null;
      const enrichment = item._enrichment ?? (await enrichCallerType(query, userId, call.caller_number, call.id, item._contactId));
      item._enrichment = enrichment;
      // Contact Entity Phase 1: reuse the contact resolved upstream by pullCallsFromCtm.
      const contactId = item._contactId ?? null;

      return upsertCallLog(
        {
          ownerUserId: userId,
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
        },
        query
      );
    })
  );

  await fixCallerTypesPostSync(userId);

  if (syncMeta.latestTimestamp) {
    await query('UPDATE client_profiles SET ctm_sync_cursor=$1 WHERE user_id=$2', [new Date(syncMeta.latestTimestamp), userId]);
  }

  // Auto-star scores back to CTM — skip known clients/journeys
  const autoStarred = freshCalls.filter(({ shouldPostScore, _enrichment }) => {
    if (!shouldPostScore) return false;
    if (_enrichment?.callerType === 'active_client' || _enrichment?.journeyId) return false;
    return true;
  });
  await Promise.all(
    autoStarred.map(async ({ call }) => {
      try {
        await postSaleToCTM(credentials, call.id, { score: call.score, conversion: 1, value: 0 });
        // Stamp the once-marker ONLY after the CTM post succeeds. A failed post
        // leaves the row un-marked so the next sync re-applies and retries.
        await query(
          `UPDATE call_logs SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('auto_star_applied_at', to_jsonb($2::text))
             WHERE call_id = $1 AND (owner_user_id = $3 OR user_id = $3)`,
          [call.id, new Date().toISOString(), userId]
        );
      } catch (err) {
        console.error('[ctmAutoSync:auto-star] post failed', { callId: call.id, error: err.message });
      }
    })
  );

  // Tracking relay for qualified calls
  const qualified = freshCalls.filter(({ call, _enrichment }) => {
    if (!call.category) return false;
    if (_enrichment?.callerType === 'active_client') return false;
    if (_enrichment?.recentlyQualified) return false;     // first-touch: only suppress if 3★+ within last 6 months
    return QUALIFIED_LEAD_CATEGORIES.has(call.category);
  });
  await Promise.all(
    qualified.map(async ({ call }) => {
      try {
        await sendTrackingEvent(userId, 'qualified_call', 'call_log', call.id, {
          event_source_url: '',
          value: 1,
          currency: 'USD'
        });
      } catch (relayErr) {
        console.error('[ctmAutoSync:relay]', relayErr.message);
      }
    })
  );

  // Voicemail-needs-attention notifications
  const attention = freshCalls.filter((item) => item.notifyNeedsAttention);
  await Promise.all(
    attention.map(({ call }) =>
      createNotification({
        userId,
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
        },
        // In-app only — clients should only receive form notifications by email.
        email: false
      })
    )
  );

  return { owner: userId, newCalls: freshCalls.length };
}

/**
 * Re-classify rows previously stamped meta.classification_pending=true.
 *
 * No CTM API calls — content is read from meta.transcript / meta.message that
 * the original pull already cached. Rows with no content are stamped
 * classification_pending=false so they don't sit in Pending Review forever
 * waiting for content that will never arrive.
 *
 * @param {{ limit?: number, owner?: string }} opts
 * @returns {Promise<{ processed: number, skipped: number, failed: number }>}
 */
export async function drainPendingClassifications({ limit = 50, owner = null } = {}) {
  const params = [];
  let where = `WHERE meta->>'classification_pending' = 'true'`;
  if (owner) {
    params.push(owner);
    where += ` AND owner_user_id = $${params.length}`;
  }
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  params.push(safeLimit);
  const sel = await query(
    `SELECT cl.id, cl.owner_user_id, cl.score, cl.meta, cp.ai_prompt, cp.auto_star_enabled
     FROM call_logs cl
     LEFT JOIN client_profiles cp ON cp.user_id = cl.owner_user_id
     ${where}
     ORDER BY cl.started_at DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );

  if (!sel.rows.length) return { processed: 0, skipped: 0, failed: 0 };

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of sel.rows) {
    const m = row.meta || {};
    const transcript = m.transcription || m.transcript || '';
    const message = m.message || '';
    if (!transcript && !message) {
      // No content to classify — stamp pending=false so we stop trying.
      // Row stays with category='unreviewed' which now labels as "Lead" in
      // the UI (per LeadsTab VISIBLE_CATEGORY_MAP fix).
      await query(
        `UPDATE call_logs SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('classification_pending', false) WHERE id = $1`,
        [row.id]
      );
      skipped += 1;
      continue;
    }
    const sourceType = m.activity_type === 'form' ? 'form' : 'call';
    try {
      const ai = await classifyContent(row.ai_prompt || DEFAULT_AI_PROMPT, transcript, message, { source: sourceType });
      const updatedMeta = {
        ...m,
        classification: ai.classification,
        classification_summary: ai.summary,
        classification_reasoning: ai.reasoning || m.classification_reasoning || '',
        category: ai.category,
        semantic_category: ai.category,
        classification_pending: false
      };
      // Auto-star drain rows that match the same rules the inline sync uses:
      // only when the row has no existing rating and the AI label has a score.
      let nextScore = row.score || 0;
      if (row.auto_star_enabled && !nextScore) {
        const stars = getAutoStarRating(ai.category);
        if (stars) nextScore = stars;
      }
      await query(`UPDATE call_logs SET meta = $1::jsonb, score = $2 WHERE id = $3`, [JSON.stringify(updatedMeta), nextScore, row.id]);
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error('[ctmAutoSync:drain] classify failed', { rowId: row.id, error: err.message });
    }
  }

  return { processed, skipped, failed };
}
