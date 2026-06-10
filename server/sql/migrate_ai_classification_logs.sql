-- =============================================================================
-- AI CLASSIFICATION DEBUG LOGS
-- =============================================================================
-- Stores recent AI classification decisions for review and prompt tuning.
-- Payload fields are encrypted at the application layer before insertion.
-- Retention is capped at 30 days to avoid unbounded growth.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS ai_classification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id TEXT,
  stage TEXT NOT NULL,
  source_type TEXT NOT NULL,
  activity_type TEXT,
  provider TEXT,
  model TEXT,
  final_category TEXT,
  classification TEXT,
  score INTEGER,
  is_referral BOOLEAN NOT NULL DEFAULT FALSE,
  requires_callback BOOLEAN NOT NULL DEFAULT FALSE,
  system_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'new',
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  payload_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_owner_created
  ON ai_classification_logs(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_call
  ON ai_classification_logs(call_id)
  WHERE call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_stage
  ON ai_classification_logs(stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_category
  ON ai_classification_logs(final_category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_review_status
  ON ai_classification_logs(review_status, created_at DESC);

CREATE OR REPLACE FUNCTION cleanup_old_ai_classification_logs(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
  capped_days INTEGER := GREATEST(1, LEAST(retention_days, 30));
BEGIN
  WITH deleted AS (
    DELETE FROM ai_classification_logs
     WHERE created_at < NOW() - (capped_days || ' days')::INTERVAL
     RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE ai_classification_logs IS 'Encrypted AI classification review logs with max 30-day retention';
COMMENT ON FUNCTION cleanup_old_ai_classification_logs IS 'Purge AI classification logs older than the specified retention period, capped at 30 days';
