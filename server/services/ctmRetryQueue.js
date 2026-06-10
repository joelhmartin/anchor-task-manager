/**
 * CTM Forms — retry queue + shared forwarder.
 *
 * Transient CTM API failures (timeouts, 5xx, brief outages) used to permanently strand a
 * lead: ctm_error was recorded and nothing retried it. This queue stores a job on failure
 * and a cron worker retries it with exponential backoff. Spam-held submissions are never
 * enqueued unless a staff member releases them.
 *
 * forwardSubmissionToCtm() is the single forwarding implementation, shared by the live
 * submit path's failure-enqueue, the staff "release" action, and the worker.
 */

import { query } from '../db.js';
import { submitToCtm, setCallCustomFields, sanitizeFieldName } from './ctmFormBuilder.js';
import { resolveCtmCreds } from './ctm.js';
import { decrypt } from './security/index.js';

const CORE_NAMES = ['caller_name', 'email', 'phone_number', 'phone', 'country_code'];

function decryptFieldData(fieldData) {
  if (!fieldData) return fieldData;
  if (fieldData._enc === true && fieldData.v) {
    const decrypted = decrypt(fieldData.v);
    if (decrypted) {
      try { return JSON.parse(decrypted); } catch { return fieldData; }
    }
  }
  return fieldData;
}

async function getCtmCredentials(orgId) {
  const { rows } = await query(
    `SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id = $1`,
    [orgId]
  );
  return resolveCtmCreds(rows[0] || null);
}

/**
 * Forward a stored submission to CTM. Updates ctm_sent / ctm_error on the row.
 * Returns { ok, trackbackId } on success, or { ok:false, error, retriable } on failure.
 *
 * @param {object} sub  Submission row (must include id, field_data, attribution_json,
 *                       ctm_reactor_id, org_id, config_json).
 */
export async function forwardSubmissionToCtm(sub) {
  if (sub.ctm_sent) return { ok: true, trackbackId: sub.ctm_trackback_id, skipped: true };
  if (!sub.ctm_reactor_id) {
    return { ok: false, error: 'No CTM reactor configured for this form', retriable: false };
  }

  const allFields = decryptFieldData(sub.field_data);
  if (!allFields || allFields.anonymized) {
    return { ok: false, error: 'Submission data has been erased', retriable: false };
  }

  const core = {};
  const custom = {};
  for (const [k, v] of Object.entries(allFields)) {
    if (CORE_NAMES.includes(k)) core[k] = v;
    else custom[k] = v;
  }

  const credentials = await getCtmCredentials(sub.org_id);
  if (!credentials) {
    return { ok: false, error: 'CTM credentials not configured for this client', retriable: false };
  }

  try {
    const attribution = sub.attribution_json || {};
    const trackbackId = await submitToCtm(credentials, sub.ctm_reactor_id, core, custom, attribution);
    await query(
      `UPDATE ctm_form_submissions SET ctm_sent = true, ctm_trackback_id = $1, ctm_error = NULL WHERE id = $2`,
      [trackbackId, sub.id]
    );

    // Post-submission: set registered custom fields via /modify.json (best-effort).
    if (trackbackId && Object.keys(custom).length > 0) {
      const fields = (sub.config_json && sub.config_json.fields) || [];
      const cfValues = {};
      for (const f of fields) {
        if (!f.registerField) continue;
        const fname = sanitizeFieldName(f.name || '');
        if (CORE_NAMES.includes(fname)) continue;
        if (fname && custom[fname] !== undefined) {
          cfValues[`cf_${fname}`] = Array.isArray(custom[fname]) ? custom[fname].join(', ') : custom[fname];
        }
      }
      if (Object.keys(cfValues).length > 0) {
        setCallCustomFields(credentials, trackbackId, cfValues).catch((err) => {
          console.error('[ctmRetryQueue:modify.json]', err.message);
        });
      }
    }

    return { ok: true, trackbackId };
  } catch (err) {
    await query(`UPDATE ctm_form_submissions SET ctm_error = $1 WHERE id = $2`, [err.message, sub.id]).catch(() => {});
    return { ok: false, error: err.message, retriable: true };
  }
}

/**
 * Enqueue a CTM retry job for a submission. No-op if an open job already exists
 * (enforced by the partial unique index).
 */
export async function enqueueCtmRetry(submissionId) {
  try {
    await query(
      `INSERT INTO ctm_form_submission_jobs (submission_id, status, scheduled_at)
       VALUES ($1, 'pending', NOW() + INTERVAL '1 minute')
       ON CONFLICT DO NOTHING`,
      [submissionId]
    );
  } catch (err) {
    console.error('[ctmRetryQueue:enqueue]', err.message);
  }
}

/**
 * Worker — claims due jobs and retries forwarding. Exponential backoff (2^attempts min,
 * capped at 60). Marks completed on success or once max_attempts is reached.
 * Returns { processed, succeeded }.
 */
export async function processPendingCtmJobs(limit = 10) {
  let processed = 0;
  let succeeded = 0;

  const { rows: jobs } = await query(
    `UPDATE ctm_form_submission_jobs SET status = 'processing', started_at = NOW()
     WHERE id IN (
       SELECT id FROM ctm_form_submission_jobs
       WHERE (
           status = 'pending'
           OR (status = 'processing' AND started_at <= NOW() - INTERVAL '15 minutes')
         )
         AND attempts < max_attempts
         AND scheduled_at <= NOW()
       ORDER BY scheduled_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING id, submission_id, attempts, max_attempts`,
    [limit]
  );

  for (const job of jobs) {
    processed += 1;
    const attempts = job.attempts + 1;

    const { rows } = await query(
      `SELECT s.*, f.config_json, f.org_id
       FROM ctm_form_submissions s
       JOIN ctm_forms f ON f.id = s.form_id
       WHERE s.id = $1`,
      [job.submission_id]
    );
    const sub = rows[0];

    if (!sub) {
      await query(
        `UPDATE ctm_form_submission_jobs SET status = 'completed', completed_at = NOW(), last_error = 'submission missing', attempts = $2 WHERE id = $1`,
        [job.id, attempts]
      );
      continue;
    }

    // Never auto-forward a held submission — it must be released by staff first.
    if (sub.status === 'held') {
      await query(
        `UPDATE ctm_form_submission_jobs SET status = 'completed', completed_at = NOW(), last_error = 'submission held', attempts = $2 WHERE id = $1`,
        [job.id, attempts]
      );
      continue;
    }

    const result = await forwardSubmissionToCtm(sub);
    await query(`UPDATE ctm_form_submissions SET ctm_retry_count = COALESCE(ctm_retry_count, 0) + 1 WHERE id = $1`, [job.submission_id]).catch(() => {});

    if (result.ok) {
      succeeded += 1;
      await query(
        `UPDATE ctm_form_submission_jobs SET status = 'completed', completed_at = NOW(), attempts = $2, last_error = NULL WHERE id = $1`,
        [job.id, attempts]
      );
    } else if (!result.retriable || attempts >= job.max_attempts) {
      await query(
        `UPDATE ctm_form_submission_jobs SET status = 'failed', completed_at = NOW(), attempts = $2, last_error = $3 WHERE id = $1`,
        [job.id, attempts, result.error || 'unknown']
      );
    } else {
      const backoffMin = Math.min(Math.pow(2, attempts - 1), 60);
      await query(
        `UPDATE ctm_form_submission_jobs
         SET status = 'pending', attempts = $2, last_error = $3, scheduled_at = NOW() + ($4 || ' minutes')::interval
         WHERE id = $1`,
        [job.id, attempts, result.error || 'unknown', String(backoffMin)]
      );
    }
  }

  return { processed, succeeded };
}
