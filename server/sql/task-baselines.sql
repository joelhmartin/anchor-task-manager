-- Baseline snapshots: frozen copies of board dates for timeline comparison
CREATE TABLE IF NOT EXISTS task_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '[]',  -- [{item_id, name, start_date, due_date, status}]
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_baselines_board ON task_baselines(board_id);
