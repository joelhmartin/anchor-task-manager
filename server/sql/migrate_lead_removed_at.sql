-- Permanent "removed from leads" stamp on call_logs activities.
-- NULL = the activity still shows in the Lead Inbox; a non-NULL timestamp
-- means it has been permanently removed from the inbox (e.g. its lead's
-- journey reached a terminal state). Unlike hidden_at (inbox-triage dismissal
-- that the show_hidden toggle reveals), this is a durable removal so an
-- archived/terminal journey can't snap a contact back into "Qualified".
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS lead_removed_at TIMESTAMPTZ;

-- Supports the owner-scoped Lead Inbox filter + counts (owner_user_id, lead_removed_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_call_logs_owner_lead_removed
  ON call_logs (owner_user_id, lead_removed_at);
