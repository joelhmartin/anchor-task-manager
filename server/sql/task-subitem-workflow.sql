-- Subitem Workflow: assignees, start dates, dependencies

-- Add start_date to subitems
ALTER TABLE task_subitems ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;

-- Subitem assignees (same pattern as task_item_assignees)
CREATE TABLE IF NOT EXISTS task_subitem_assignees (
    subitem_id  UUID NOT NULL REFERENCES task_subitems(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subitem_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_subitem_assignees_user ON task_subitem_assignees(user_id);

-- Subitem dependencies (DAG — supports fan-out and fan-in)
CREATE TABLE IF NOT EXISTS task_subitem_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    predecessor_id  UUID NOT NULL REFERENCES task_subitems(id) ON DELETE CASCADE,
    successor_id    UUID NOT NULL REFERENCES task_subitems(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(predecessor_id, successor_id)
);
CREATE INDEX IF NOT EXISTS idx_subitem_deps_predecessor ON task_subitem_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_subitem_deps_successor ON task_subitem_dependencies(successor_id);
