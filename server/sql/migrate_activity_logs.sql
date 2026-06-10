-- =============================================================================
-- USER ACTIVITY LOGS MIGRATION
-- =============================================================================
-- Comprehensive activity logging for all user types with admin-only visibility.
-- Tracks logins, client views/edits, tasks, documents, forms, reviews, and admin actions.
-- Includes automatic 30-day data retention via cleanup function.
-- =============================================================================

-- Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. USER ACTIVITY LOGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Who performed the action
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Target user (for client-related actions)
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Target entity (for tasks, forms, documents, reviews)
  target_entity_type TEXT,  -- 'task', 'form', 'document', 'review', 'form_submission'
  target_entity_id UUID,

  -- Action classification
  action_type TEXT NOT NULL,
  action_category TEXT NOT NULL,

  -- Request context
  ip_address INET,
  user_agent TEXT,

  -- Flexible details (entity names, changes made, etc.)
  -- NEVER include PHI, passwords, tokens, or secrets
  details JSONB NOT NULL DEFAULT '{}',

  -- Immutable timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comment for documentation
COMMENT ON TABLE user_activity_logs IS 'Comprehensive user activity audit log with 30-day retention';
COMMENT ON COLUMN user_activity_logs.action_category IS 'authentication, client, task, document, form, review, admin';
COMMENT ON COLUMN user_activity_logs.details IS 'Metadata about the action - NEVER include PHI or secrets';

-- -----------------------------------------------------------------------------
-- 2. INDEXES FOR EFFICIENT QUERYING
-- -----------------------------------------------------------------------------

-- Primary query: fetch logs for a specific user
CREATE INDEX IF NOT EXISTS idx_activity_user
  ON user_activity_logs(user_id, created_at DESC);

-- Query logs by target user (e.g., who viewed this client)
CREATE INDEX IF NOT EXISTS idx_activity_target_user
  ON user_activity_logs(target_user_id, created_at DESC);

-- Filter by action type
CREATE INDEX IF NOT EXISTS idx_activity_type
  ON user_activity_logs(action_type);

-- Filter by category
CREATE INDEX IF NOT EXISTS idx_activity_category
  ON user_activity_logs(action_category);

-- Cleanup job: find old entries to purge
CREATE INDEX IF NOT EXISTS idx_activity_cleanup
  ON user_activity_logs(created_at);

-- Composite index for common admin queries
CREATE INDEX IF NOT EXISTS idx_activity_admin_query
  ON user_activity_logs(created_at DESC, action_category, action_type);

-- -----------------------------------------------------------------------------
-- 3. CLEANUP FUNCTION - Purge logs older than retention period
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM user_activity_logs
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_activity_logs IS 'Purge activity logs older than specified retention period (default 30 days)';

-- -----------------------------------------------------------------------------
-- MIGRATION COMPLETE
-- -----------------------------------------------------------------------------
-- Next steps:
-- 1. Run this migration against the database
-- 2. Deploy the activityLog.js service
-- 3. Add cron job for daily cleanup (calls cleanup_old_activity_logs)
-- =============================================================================
