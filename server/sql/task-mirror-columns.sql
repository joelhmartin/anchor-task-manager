-- Mirror columns: read-only columns that display values from linked items
CREATE TABLE IF NOT EXISTS task_mirror_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_field TEXT NOT NULL,          -- field to read from linked item: 'status', 'due_date', 'assignees', 'name'
  link_type TEXT NOT NULL DEFAULT 'related',  -- which link type to follow
  aggregation TEXT NOT NULL DEFAULT 'first',  -- 'first', 'list', 'count', 'latest_date', 'earliest_date'
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(board_id, name)
);

CREATE INDEX IF NOT EXISTS idx_task_mirror_columns_board
  ON task_mirror_columns (board_id);
