-- migrate_classifier_softener_backfill.sql
-- Re-flip rows where the AI's spam/not_a_fit verdict was overridden by the
-- looksLikeExplicit* keyword guards (now removed). Identifiable by AI summary
-- stating spam or not-a-fit while category was downgraded to warm/neutral.
-- Also clears the legacy 'AI classification skipped.' summary so the backfill
-- job can pick those rows up via classification_pending=true.
-- Idempotent: safe to run multiple times.

BEGIN;

-- 1. Re-flip spam-softened rows.
UPDATE call_logs
SET
  meta = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(meta, '{category}', '"spam"'),
        '{classification}', '"spam"'
      ),
      '{category_source_detail}', '"softener_backfill_2026_04"'
    ),
    '{classification_reasoning}', '""'
  ),
  score = 1
WHERE meta->>'classification_summary' ILIKE '%spam%'
  AND meta->>'category' IN ('warm', 'neutral')
  AND COALESCE(meta->>'category_source','ai') = 'ai'
  AND (score IS NULL OR score <= 2);

-- 2. Re-flip not-a-fit-softened rows.
UPDATE call_logs
SET
  meta = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(meta, '{category}', '"not_a_fit"'),
        '{classification}', '"not_a_fit"'
      ),
      '{category_source_detail}', '"softener_backfill_2026_04"'
    ),
    '{classification_reasoning}', '""'
  ),
  score = 2
WHERE (
    meta->>'classification_summary' ILIKE '%not a fit%'
    OR meta->>'classification_summary' ILIKE '%cannot offer%'
    OR meta->>'classification_summary' ILIKE '%don''t offer%'
    OR meta->>'classification_summary' ILIKE '%doesn''t offer%'
  )
  AND meta->>'category' IN ('warm', 'neutral')
  AND COALESCE(meta->>'category_source','ai') = 'ai'
  AND (score IS NULL OR score <= 2);

-- 3. Clear the legacy 'AI classification skipped.' summary so backfill job
--    can re-process these rows. Set classification_pending=true.
UPDATE call_logs
SET meta = jsonb_set(
  jsonb_set(meta, '{classification_pending}', 'true'),
  '{classification_summary}', '""'
)
WHERE meta->>'classification_summary' = 'AI classification skipped.';

-- 4. First-touch attribution backfill: when a caller_number has multiple
--    starred calls under the same owner_user_id, keep the score on the
--    EARLIEST one (first touch) and zero out subsequent ones.
--    Aligns historical data with T14's runtime first-touch suppression.
--    Idempotent: subsequent runs skip rows already flagged via
--    score_suppressed_reason='first_touch_backfill_2026_04'.
WITH ranked AS (
  SELECT
    id,
    REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') AS normalized_from_number,
    ROW_NUMBER() OVER (
      PARTITION BY owner_user_id, REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')
      ORDER BY started_at ASC NULLS LAST, created_at ASC
    ) AS rn
  FROM call_logs
  WHERE score > 0
    AND from_number IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) >= 7
    AND COALESCE(meta->>'category_source', 'ai') = 'ai'
    AND COALESCE(meta->>'score_suppressed_reason', '') = ''
)
UPDATE call_logs cl
SET
  score = 0,
  meta = jsonb_set(
    cl.meta,
    '{score_suppressed_reason}',
    '"first_touch_backfill_2026_04"'
  )
FROM ranked r
WHERE cl.id = r.id
  AND r.rn > 1;

COMMIT;
