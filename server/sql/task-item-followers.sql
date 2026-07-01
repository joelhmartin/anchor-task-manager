-- Item-level followers: users who opt in to notifications for an item
-- without being assigned to it (status changes, updates, comments).
CREATE TABLE IF NOT EXISTS task_item_followers (
  item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, user_id)
);

-- The PK (item_id, user_id) already provides a leading-column index on item_id,
-- so per-item fanout queries use it directly — no dedicated item index needed.

-- User-side lookup powers "items I follow" list views and profile queries.
CREATE INDEX IF NOT EXISTS idx_task_item_followers_user
  ON task_item_followers (user_id);
