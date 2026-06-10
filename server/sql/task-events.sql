-- TM-014: Event Bus — append-only event log for all task system mutations
-- This table serves as both an audit trail and the foundation for the automation engine.

CREATE TABLE IF NOT EXISTS task_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  workspace_id UUID REFERENCES task_workspaces(id) ON DELETE SET NULL,
  board_id UUID REFERENCES task_boards(id) ON DELETE SET NULL,
  item_id UUID REFERENCES task_items(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'user',
  old_value JSONB,
  new_value JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_type ON task_events (event_type);
CREATE INDEX IF NOT EXISTS idx_task_events_entity ON task_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_task_events_workspace ON task_events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_events_board ON task_events (board_id);
CREATE INDEX IF NOT EXISTS idx_task_events_item ON task_events (item_id);
CREATE INDEX IF NOT EXISTS idx_task_events_actor ON task_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_task_events_created ON task_events (created_at);
