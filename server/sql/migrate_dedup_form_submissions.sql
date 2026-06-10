-- Deduplicate form submissions: hide older exact duplicates, keep the latest
-- Duplicates are identified by: same owner, same phone, same message content
-- Only the most recent submission in each group remains visible
-- Uses hidden_at (already filtered out by the leads query) so nothing is deleted
-- Idempotent: only updates rows where hidden_at IS NULL

UPDATE call_logs
SET hidden_at = NOW()
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY owner_user_id, from_number, meta->>'message'
      ORDER BY started_at DESC
    ) as rn
    FROM call_logs
    WHERE activity_type = 'form'
      AND hidden_at IS NULL
      AND meta->>'message' IS NOT NULL
      AND meta->>'message' != ''
  ) ranked
  WHERE rn > 1
);
