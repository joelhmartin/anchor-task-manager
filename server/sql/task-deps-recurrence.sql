-- Phase 4: Dependencies, Recurrence, Start Date

-- Add start_date to task_items
ALTER TABLE task_items ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;

-- Task dependencies (finish-to-start)
CREATE TABLE IF NOT EXISTS task_item_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    predecessor_id  UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    successor_id    UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    dependency_type VARCHAR(30) DEFAULT 'finish_to_start',
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(predecessor_id, successor_id)
);

CREATE INDEX IF NOT EXISTS idx_deps_predecessor ON task_item_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_deps_successor ON task_item_dependencies(successor_id);

-- Recurring tasks
CREATE TABLE IF NOT EXISTS task_recurrence_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    pattern         VARCHAR(20) NOT NULL,
    rrule           VARCHAR(255),
    next_occurrence TIMESTAMPTZ,
    last_generated  TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurrence_item ON task_recurrence_rules(item_id);
CREATE INDEX IF NOT EXISTS idx_recurrence_next ON task_recurrence_rules(next_occurrence) WHERE is_active = true;
