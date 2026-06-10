CREATE TABLE IF NOT EXISTS analytics_audit_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'google_ads' CHECK (platform IN ('google_ads', 'meta_ads')),
  provider_preset TEXT NOT NULL CHECK (provider_preset IN ('vertex_auditor')),
  recipient_emails TEXT[] NOT NULL DEFAULT '{}',
  daily_time_local TIME NOT NULL,
  timezone TEXT NOT NULL,
  paused BOOLEAN NOT NULL DEFAULT false,
  next_run_at TIMESTAMPTZ,
  config_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_audit_schedules_user
  ON analytics_audit_schedules(user_id);

CREATE INDEX IF NOT EXISTS idx_analytics_audit_schedules_due
  ON analytics_audit_schedules(next_run_at)
  WHERE paused = false;

CREATE TABLE IF NOT EXISTS analytics_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES analytics_audit_schedules(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'error')),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'google_ads' CHECK (platform IN ('google_ads', 'meta_ads')),
  provider_preset TEXT NOT NULL CHECK (provider_preset IN ('vertex_auditor')),
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}',
  result_json JSONB NOT NULL DEFAULT '{}',
  debug_json JSONB,
  email_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (email_status IN ('not_sent', 'sent', 'failed', 'skipped')),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_audit_runs_user
  ON analytics_audit_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_audit_runs_schedule
  ON analytics_audit_runs(schedule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_audit_runs_status
  ON analytics_audit_runs(status, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_analytics_audit_runs_scheduled_window
  ON analytics_audit_runs(schedule_id, trigger_type, date_range_start, date_range_end)
  WHERE schedule_id IS NOT NULL AND trigger_type = 'scheduled';
