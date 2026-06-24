-- Threaded replies on task_updates: one level of nesting via parent_update_id.
-- Top-level updates have parent_update_id IS NULL; replies point to the parent
-- update on the same item. ON DELETE CASCADE so deleting a parent removes its
-- thread; the application enforces the one-level constraint (a reply's parent
-- must itself have parent_update_id IS NULL).
ALTER TABLE task_updates
  ADD COLUMN IF NOT EXISTS parent_update_id UUID
  REFERENCES task_updates(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_task_updates_parent ON task_updates(parent_update_id);
