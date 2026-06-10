import { query } from '../db.js';
import { encrypt, decrypt } from './security/encryption.js';

const DEFAULT_RETENTION_DAYS = Math.max(1, Math.min(30, Number(process.env.AI_CLASSIFICATION_LOG_RETENTION_DAYS || 30)));
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Mirrors INTERNAL_TO_CANONICAL_LEAD_CATEGORY in src/api/activityLogs.js so server-side
// filtering by canonical UI category matches the chip labels rendered on the client.
const UI_CATEGORY_TO_INTERNAL = {
  lead: ['warm', 'very_good', 'good', 'hot', 'very_hot', 'very-hot', 'neutral', 'converted', 'active_client', 'returning_customer'],
  needs_attention: ['needs_attention'],
  unanswered: ['unanswered', 'voicemail'],
  not_a_fit: ['not_a_fit', 'applicant'],
  spam: ['spam'],
  pending_review: ['unreviewed', 'pending_review']
};

let lastCleanupAttemptAt = 0;
let hasWarnedStorageUnavailable = false;

function encodePayload(payload = {}) {
  const json = JSON.stringify(payload);
  return encrypt(json) || json;
}

function decodePayload(value) {
  if (!value) return {};
  const decrypted = decrypt(value);
  if (!decrypted) return {};
  try {
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

function isStorageUnavailableError(err) {
  const code = String(err?.code || '').trim();
  const message = String(err?.message || '').toLowerCase();
  if (code === '42P01' || code === '42703' || code === '42883') return true;
  return (
    message.includes('ai_classification_logs') ||
    message.includes('cleanup_old_ai_classification_logs')
  ) && (
    message.includes('does not exist') ||
    message.includes('undefined table') ||
    message.includes('undefined column') ||
    message.includes('undefined function')
  );
}

function logStorageUnavailable(context, err) {
  const details = err?.message || err;
  if (hasWarnedStorageUnavailable) return;
  hasWarnedStorageUnavailable = true;
  console.warn(`[ai-classification-log] ${context} unavailable:`, details);
}

async function maybeCleanupLogs() {
  const now = Date.now();
  if (now - lastCleanupAttemptAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAttemptAt = now;
  try {
    await query('SELECT cleanup_old_ai_classification_logs($1)', [DEFAULT_RETENTION_DAYS]);
  } catch (err) {
    if (isStorageUnavailableError(err)) {
      logStorageUnavailable('cleanup', err);
      return;
    }
    console.error('[ai-classification-log] cleanup failed:', err.message);
  }
}

export async function logAiClassificationEvent(event = {}) {
  const {
    ownerUserId,
    callId = null,
    stage = 'unknown',
    sourceType = 'unknown',
    activityType = null,
    provider = null,
    model = null,
    finalCategory = null,
    classification = null,
    score = null,
    isReferral = false,
    requiresCallback = false,
    systemTags = [],
    adjustments = [],
    reviewStatus = 'new',
    input = '',
    prompt = '',
    rawResponse = '',
    summary = '',
    reasoning = '',
    metadata = {}
  } = event;

  if (!ownerUserId) return;

  const payloadEncrypted = encodePayload({
    input,
    prompt,
    rawResponse,
    summary,
    reasoning,
    metadata
  });

  try {
    await query(
      `INSERT INTO ai_classification_logs (
        owner_user_id, call_id, stage, source_type, activity_type, provider,
        model, final_category, classification, score, is_referral, requires_callback,
        system_tags, adjustments, review_status, payload_encrypted
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13::jsonb, $14::jsonb, $15, $16
      )`,
      [
        ownerUserId,
        callId,
        stage,
        sourceType,
        activityType,
        provider,
        model,
        finalCategory,
        classification,
        Number.isFinite(score) ? score : null,
        Boolean(isReferral),
        Boolean(requiresCallback),
        JSON.stringify(Array.isArray(systemTags) ? systemTags : []),
        JSON.stringify(Array.isArray(adjustments) ? adjustments : []),
        reviewStatus,
        payloadEncrypted
      ]
    );
  } catch (err) {
    if (isStorageUnavailableError(err)) {
      logStorageUnavailable('insert', err);
      return;
    }
    console.error('[ai-classification-log] insert failed:', err.message);
  }

  void maybeCleanupLogs();
}

export async function fetchAiClassificationLogs({
  ownerUserId,
  page = 1,
  limit = 50,
  stage,
  sourceType,
  category,
  reviewStatus,
  callId,
  startDate,
  endDate
} = {}) {
  const conditions = ['owner_user_id = $1'];
  const params = [ownerUserId];
  let index = params.length + 1;

  if (stage) {
    conditions.push(`stage = $${index++}`);
    params.push(stage);
  }
  if (sourceType) {
    conditions.push(`source_type = $${index++}`);
    params.push(sourceType);
  }
  if (category) {
    const expanded = UI_CATEGORY_TO_INTERNAL[category] || [category];
    conditions.push(`final_category = ANY($${index++}::text[])`);
    params.push(expanded);
  }
  if (reviewStatus) {
    conditions.push(`review_status = $${index++}`);
    params.push(reviewStatus);
  }
  if (callId) {
    conditions.push(`call_id = $${index++}`);
    params.push(callId);
  }
  if (startDate) {
    conditions.push(`created_at >= $${index++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`created_at < ($${index++}::date + INTERVAL '1 day')`);
    params.push(endDate);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;

  let countResult;
  let rowsResult;
  try {
    countResult = await query(
      `SELECT COUNT(*)::int AS total
         FROM ai_classification_logs
        ${whereClause}`,
      params
    );

    rowsResult = await query(
      `SELECT id, owner_user_id, call_id, stage, source_type, activity_type, provider,
              model, final_category, classification, score, is_referral, requires_callback,
              system_tags, adjustments, review_status, review_notes, reviewed_at, created_at,
              payload_encrypted
         FROM ai_classification_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${index++} OFFSET $${index++}`,
      [...params, safeLimit, offset]
    );
  } catch (err) {
    if (isStorageUnavailableError(err)) {
      logStorageUnavailable('fetch', err);
      return {
        logs: [],
        pagination: {
          page: safePage,
          limit: safeLimit,
          total: 0,
          totalPages: 1,
          hasMore: false
        }
      };
    }
    throw err;
  }

  const total = countResult.rows[0]?.total || 0;
  const logs = rowsResult.rows.map((row) => {
    const payload = decodePayload(row.payload_encrypted);
    return {
      id: row.id,
      owner_user_id: row.owner_user_id,
      call_id: row.call_id,
      stage: row.stage,
      source_type: row.source_type,
      activity_type: row.activity_type,
      provider: row.provider,
      model: row.model,
      final_category: row.final_category,
      classification: row.classification,
      score: row.score,
      is_referral: row.is_referral,
      requires_callback: row.requires_callback,
      system_tags: Array.isArray(row.system_tags) ? row.system_tags : [],
      adjustments: Array.isArray(row.adjustments) ? row.adjustments : [],
      review_status: row.review_status,
      review_notes: row.review_notes || '',
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      input: payload.input || '',
      prompt: payload.prompt || '',
      raw_response: payload.rawResponse || '',
      summary: payload.summary || '',
      reasoning: payload.reasoning || '',
      metadata: payload.metadata || {}
    };
  });

  return {
    logs,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
      hasMore: offset + logs.length < total
    }
  };
}

export async function updateAiClassificationLogReview(id, { reviewStatus, reviewNotes = '' } = {}) {
  const normalizedStatus = ['new', 'flagged', 'reviewed', 'ignored'].includes(reviewStatus) ? reviewStatus : 'new';
  let rows = [];
  try {
    const result = await query(
      `UPDATE ai_classification_logs
          SET review_status = $2,
              review_notes = NULLIF($3, ''),
              reviewed_at = NOW()
        WHERE id = $1
        RETURNING id, review_status, review_notes, reviewed_at`,
      [id, normalizedStatus, String(reviewNotes || '').slice(0, 4000)]
    );
    rows = result.rows;
  } catch (err) {
    if (isStorageUnavailableError(err)) {
      logStorageUnavailable('review update', err);
      return null;
    }
    throw err;
  }
  return rows[0] || null;
}
