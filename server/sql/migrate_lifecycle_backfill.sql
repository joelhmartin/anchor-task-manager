-- Lifecycle v2 Backfill Migration
-- Idempotent: safe to run multiple times
-- Purpose: normalize phones, attach active_client_id where deterministically known,
-- backfill activity_type from meta for CTM rows, add functional index for phone-based lifecycle queries

-- 1. Backfill activity_type from meta JSONB — covers both NULL rows and rows
-- that got the DEFAULT 'call' when the column was added but have a different
-- value in meta (e.g., form submissions with meta.activity_type = 'form')
UPDATE call_logs
SET activity_type = meta->>'activity_type'
WHERE meta->>'activity_type' IS NOT NULL
  AND meta->>'activity_type' != ''
  AND activity_type IS DISTINCT FROM meta->>'activity_type';

-- 2. Attach active_client_id to historical call_logs where phone matches a known active client
-- Only updates rows that don't already have an active_client_id
UPDATE call_logs cl
SET active_client_id = ac.id
FROM active_clients ac
WHERE cl.active_client_id IS NULL
  AND ac.archived_at IS NULL
  AND (cl.owner_user_id = ac.owner_user_id OR cl.user_id = ac.owner_user_id)
  AND LENGTH(REGEXP_REPLACE(cl.from_number, '[^0-9]', '', 'g')) >= 7
  AND LENGTH(REGEXP_REPLACE(ac.client_phone, '[^0-9]', '', 'g')) >= 7
  AND RIGHT(REGEXP_REPLACE(cl.from_number, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(ac.client_phone, '[^0-9]', '', 'g'), 10);

-- 3. Functional index on normalized phone for faster lifecycle lookups
-- Used by attachLifecycleState() and lifecycle filter subqueries
CREATE INDEX IF NOT EXISTS idx_call_logs_phone_norm
  ON call_logs (RIGHT(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g'), 10))
  WHERE from_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_active_clients_phone_norm
  ON active_clients (RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10))
  WHERE client_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_journeys_phone_norm
  ON client_journeys (RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10))
  WHERE client_phone IS NOT NULL;

-- 4. Index on meta->>'source_key' for source filter queries
CREATE INDEX IF NOT EXISTS idx_call_logs_source_key
  ON call_logs ((meta->>'source_key'))
  WHERE meta->>'source_key' IS NOT NULL;

-- 5. Migrate saved views: remap old raw categories to new visible bucket names
-- Old raw categories -> new visible buckets:
--   warm, very_good, neutral, unreviewed, converted, active_client, returning_customer -> lead
--   needs_attention -> needs_attention
--   unanswered, voicemail -> unanswered
--   not_a_fit, applicant -> not_a_fit
--   spam -> spam
UPDATE lead_saved_views
SET filters = jsonb_set(
  filters,
  '{category}',
  CASE
    WHEN filters->>'category' IN ('warm', 'very_good', 'neutral', 'unreviewed', 'converted', 'active_client', 'returning_customer') THEN '"lead"'::jsonb
    WHEN filters->>'category' IN ('unanswered', 'voicemail') THEN '"unanswered"'::jsonb
    WHEN filters->>'category' IN ('not_a_fit', 'applicant') THEN '"not_a_fit"'::jsonb
    WHEN filters->>'category' = 'needs_attention' THEN '"needs_attention"'::jsonb
    WHEN filters->>'category' = 'spam' THEN '"spam"'::jsonb
    ELSE filters->'category'
  END
)
WHERE filters->>'category' IS NOT NULL
  AND filters->>'category' NOT IN ('all', 'lead', 'needs_attention', 'unanswered', 'not_a_fit', 'spam');
