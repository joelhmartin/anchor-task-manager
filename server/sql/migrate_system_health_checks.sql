-- Production health-check run history. Append-only telemetry (NOT audit data).
-- One row per check per run. 30-day retention pruned by the daily job.
CREATE TABLE IF NOT EXISTS system_health_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL,
  check_id     text NOT NULL,
  label        text NOT NULL,
  category     text NOT NULL,            -- 'agent' | 'integration' | 'job'
  status       text NOT NULL,            -- 'ok' | 'warn' | 'fail'
  detail       text,
  error        text,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms  integer,
  trigger      text NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_health_checks_run    ON system_health_checks (run_id);
CREATE INDEX IF NOT EXISTS idx_system_health_checks_recent ON system_health_checks (check_id, created_at DESC);
