-- Enhanced time tracking: rate cards and approval status

-- Rate cards: per-user or per-board hourly rates
CREATE TABLE IF NOT EXISTS task_rate_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = default rate for workspace
  board_id UUID REFERENCES task_boards(id) ON DELETE CASCADE,  -- NULL = applies to all boards
  hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,  -- NULL = no end date
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_rate_cards_workspace ON task_rate_cards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_rate_cards_user ON task_rate_cards(user_id);

-- Add approval_status to time entries
ALTER TABLE task_time_entries ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending';
-- 'pending' | 'approved' | 'rejected'
ALTER TABLE task_time_entries ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE task_time_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
