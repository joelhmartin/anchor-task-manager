-- CTM Forms: submission outcome model, conversion funnel telemetry, and CTM retry queue.
--
-- Embedded-form reliability work. Adds a first-class triage model to ctm_form_submissions
-- so the dashboard can show WHY a submission was held (recaptcha vs AI spam) and whether it
-- was forwarded to CTM, plus a lightweight funnel-events table for "loaded -> submitted ->
-- blocked -> sent" diagnostics, plus a retry queue so transient CTM outages don't permanently
-- strand leads.
--
-- Idempotent: safe to run repeatedly.

-- ── Submission triage columns ──────────────────────────────────────────────
-- status: high-level triage state, independent of CTM delivery (ctm_sent/ctm_error).
--   'received'  — clean, accepted
--   'review'    — accepted but flagged for a human eyeball (soft reCAPTCHA: missing token /
--                 service unavailable — could be a real user behind a privacy browser)
--   'held'      — spam-held, NOT forwarded to CTM
--   'released'  — was held, then released by staff
ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS status TEXT;
-- block_reason: granular cause when status is 'review' or 'held'.
--   recaptcha_missing_token | recaptcha_low_score | recaptcha_invalid_token |
--   recaptcha_action_mismatch | recaptcha_service_unavailable | ai_spam | heuristic_spam
ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS block_reason TEXT;
ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS released_by UUID;
ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS ctm_retry_count INT DEFAULT 0;

-- Backfill triage state for pre-existing rows so the dashboard isn't blank.
UPDATE ctm_form_submissions
   SET status = CASE WHEN spam IS TRUE THEN 'held' ELSE 'received' END
 WHERE status IS NULL;

-- Best-effort backfill of block_reason for legacy spam-held rows from recaptcha_json.
UPDATE ctm_form_submissions
   SET block_reason = CASE
     WHEN (recaptcha_json->>'passed') = 'false' THEN
       CASE
         WHEN recaptcha_json->>'reason' = 'missing_token'        THEN 'recaptcha_missing_token'
         WHEN recaptcha_json->>'reason' = 'low_score'            THEN 'recaptcha_low_score'
         WHEN recaptcha_json->>'reason' = 'action_mismatch'      THEN 'recaptcha_action_mismatch'
         WHEN recaptcha_json->>'reason' = 'service_unavailable'  THEN 'recaptcha_service_unavailable'
         WHEN recaptcha_json->>'reason' LIKE 'invalid_token%'    THEN 'recaptcha_invalid_token'
         ELSE 'recaptcha_failed'
       END
     ELSE 'ai_spam'
   END
 WHERE block_reason IS NULL AND spam IS TRUE;

-- ── Conversion funnel telemetry ────────────────────────────────────────────
-- One row per client-side funnel event (form rendered, submit clicked, validation
-- failed, POST started/failed/succeeded, etc.). Lets the dashboard distinguish
-- "nobody submitted" from "submitted but blocked" from "blocked at the dashboard".
CREATE TABLE IF NOT EXISTS ctm_form_funnel_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    UUID NOT NULL REFERENCES ctm_forms(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctm_funnel_form_created ON ctm_form_funnel_events(form_id, created_at);

-- ── CTM retry queue ────────────────────────────────────────────────────────
-- Transient CTM API failures get a job here; a cron worker retries with exponential
-- backoff. Spam-held submissions are NOT enqueued unless released by staff.
CREATE TABLE IF NOT EXISTS ctm_form_submission_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES ctm_form_submissions(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
  attempts      INT  NOT NULL DEFAULT 0,
  max_attempts  INT  NOT NULL DEFAULT 5,
  last_error    TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctm_jobs_pending ON ctm_form_submission_jobs(status, scheduled_at);
-- Only one open (pending/processing) job per submission.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ctm_jobs_one_open
  ON ctm_form_submission_jobs(submission_id)
  WHERE status IN ('pending', 'processing');
