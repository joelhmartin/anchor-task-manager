-- TM-015v2e Phase 1B + Phase 3A: Soft deletes + Step run tracking
-- Idempotent — safe to run multiple times

-- Soft delete columns for automation tables
ALTER TABLE task_board_automations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE task_global_automations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Per-step execution tracking (Phase 3A)
CREATE TABLE IF NOT EXISTS task_workflow_step_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES task_workflow_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES task_automation_steps(id) ON DELETE SET NULL,
  step_type TEXT NOT NULL,
  action_type TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','error','skipped')),
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_run ON task_workflow_step_runs(workflow_run_id);
