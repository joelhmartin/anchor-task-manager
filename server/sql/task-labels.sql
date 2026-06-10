-- Task Labels System — Global label definitions + item-label junction

CREATE TABLE IF NOT EXISTS task_label_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES task_workspaces(id) ON DELETE CASCADE,
    category        VARCHAR(50) NOT NULL,
    label           VARCHAR(100) NOT NULL,
    color           VARCHAR(7) NOT NULL,
    icon            VARCHAR(50),
    is_exclusive    BOOLEAN DEFAULT false,
    is_system       BOOLEAN DEFAULT false,
    order_index     INT DEFAULT 0,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_label_def_ws_cat_label
  ON task_label_definitions(workspace_id, category, label);

CREATE TABLE IF NOT EXISTS task_item_labels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    label_id        UUID NOT NULL REFERENCES task_label_definitions(id) ON DELETE CASCADE,
    applied_by      UUID REFERENCES users(id),
    applied_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_item_labels_item ON task_item_labels(item_id);
CREATE INDEX IF NOT EXISTS idx_item_labels_label ON task_item_labels(label_id);
