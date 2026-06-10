-- TM-015v2b: Rule Engine v2 — multi-step chains, conditions, quota, workflow runs
-- Idempotent: safe to re-run.

-- === ALTER existing tables ===

-- Board automations: add trigger_events array, error tracking, updated_at
ALTER TABLE task_board_automations ADD COLUMN IF NOT EXISTS trigger_events TEXT[];
ALTER TABLE task_board_automations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE task_board_automations ADD COLUMN IF NOT EXISTS error_count INT NOT NULL DEFAULT 0;
ALTER TABLE task_board_automations ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

-- Global automations: same + workspace scoping
ALTER TABLE task_global_automations ADD COLUMN IF NOT EXISTS trigger_events TEXT[];
ALTER TABLE task_global_automations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE task_global_automations ADD COLUMN IF NOT EXISTS error_count INT NOT NULL DEFAULT 0;
ALTER TABLE task_global_automations ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
ALTER TABLE task_global_automations ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES task_workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_global_automations_workspace
  ON task_global_automations(workspace_id) WHERE workspace_id IS NOT NULL;

-- === New tables ===

-- Multi-step automation chains
CREATE TABLE IF NOT EXISTS task_automation_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL,
  automation_scope TEXT NOT NULL CHECK (automation_scope IN ('board', 'global')),
  step_order INT NOT NULL DEFAULT 0,
  step_type TEXT NOT NULL CHECK (step_type IN ('action', 'if', 'else', 'delay')),
  action_type TEXT,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  condition_group JSONB,
  parent_step_id UUID REFERENCES task_automation_steps(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_automation_steps_lookup
  ON task_automation_steps(automation_scope, automation_id, step_order);
CREATE INDEX IF NOT EXISTS idx_task_automation_steps_parent
  ON task_automation_steps(parent_step_id) WHERE parent_step_id IS NOT NULL;

-- Monthly action quota
CREATE TABLE IF NOT EXISTS task_automation_quota (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start DATE NOT NULL UNIQUE,
  actions_consumed INT NOT NULL DEFAULT 0,
  actions_limit INT NOT NULL DEFAULT 10000
);

-- Workflow execution runs (per-rule-per-event tracking)
CREATE TABLE IF NOT EXISTS task_workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL,
  automation_scope TEXT NOT NULL CHECK (automation_scope IN ('board', 'global')),
  board_id UUID REFERENCES task_boards(id) ON DELETE SET NULL,
  item_id UUID REFERENCES task_items(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL,
  trigger_event_id UUID REFERENCES task_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error', 'delayed', 'halted', 'skipped')),
  steps_completed INT NOT NULL DEFAULT 0,
  steps_total INT NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_runs_automation
  ON task_workflow_runs(automation_scope, automation_id);
CREATE INDEX IF NOT EXISTS idx_task_workflow_runs_item
  ON task_workflow_runs(item_id);
CREATE INDEX IF NOT EXISTS idx_task_workflow_runs_active
  ON task_workflow_runs(status) WHERE status IN ('running', 'delayed');
