-- Snapshot of who was included and platform coverage at report generation time
ALTER TABLE analytics_generated_reports
  ADD COLUMN IF NOT EXISTS selection_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS coverage_snapshot JSONB;
