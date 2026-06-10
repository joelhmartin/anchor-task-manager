-- Outbound webhooks: configurable event-driven HTTP notifications

CREATE TABLE IF NOT EXISTS task_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,  -- HMAC signing secret
  event_types TEXT[] NOT NULL DEFAULT '{}',  -- which events trigger this webhook
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_webhooks_workspace ON task_webhooks(workspace_id);

-- Delivery log for webhook attempts
CREATE TABLE IF NOT EXISTS task_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES task_webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  response_status INTEGER,
  response_body TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'success' | 'failed' | 'retrying'
  error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_webhook_deliveries_webhook ON task_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_task_webhook_deliveries_status ON task_webhook_deliveries(status) WHERE status != 'success';
