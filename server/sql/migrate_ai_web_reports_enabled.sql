-- Adds an `enabled` flag to report_templates for the AI web-report engine.
-- Disabled approved templates do NOT fire on schedule and refuse manual runs.
-- Defaults to true so existing approved templates continue to behave as before.
-- Idempotent.

ALTER TABLE report_templates
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN report_templates.enabled IS
  'Per-template runtime gate. When false, scheduler skips and manual runs are refused. Independent of status (draft/approved/archived) and is_archived.';
