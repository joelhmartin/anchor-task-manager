-- Phase 5: Dashboards and Widgets

CREATE TABLE IF NOT EXISTS task_dashboards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    layout          JSONB,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboards_workspace ON task_dashboards(workspace_id);

CREATE TABLE IF NOT EXISTS task_dashboard_widgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id    UUID NOT NULL REFERENCES task_dashboards(id) ON DELETE CASCADE,
    widget_type     VARCHAR(30) NOT NULL,
    config          JSONB NOT NULL DEFAULT '{}',
    position        JSONB NOT NULL DEFAULT '{"x":0,"y":0,"w":6,"h":4}'
);

CREATE INDEX IF NOT EXISTS idx_widgets_dashboard ON task_dashboard_widgets(dashboard_id);
