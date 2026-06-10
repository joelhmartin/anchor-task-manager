-- Adds immutable approval metadata for AI web-report templates.
-- The full approved data/output/rendered payloads are encrypted TEXT; the JSONB
-- approved_example_output column only stores safe summary metadata.

ALTER TABLE ai_report_template_versions
  ADD COLUMN IF NOT EXISTS approved_run_item_id UUID REFERENCES report_run_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_data_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS approved_ai_output TEXT,
  ADD COLUMN IF NOT EXISTS approved_rendered_payload TEXT,
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT,
  ADD COLUMN IF NOT EXISTS blueprint_hash TEXT,
  ADD COLUMN IF NOT EXISTS data_package_schema_version INTEGER,
  ADD COLUMN IF NOT EXISTS output_schema_version INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS model_params JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_template_versions_approved_run_item
  ON ai_report_template_versions(approved_run_item_id);

COMMENT ON COLUMN ai_report_template_versions.approved_run_item_id IS 'Successful test run item explicitly approved by an admin.';
COMMENT ON COLUMN ai_report_template_versions.approved_data_snapshot IS 'AES-256-GCM encrypted JSON test data snapshot used for approval.';
COMMENT ON COLUMN ai_report_template_versions.approved_ai_output IS 'AES-256-GCM encrypted JSON approved model blueprint/output.';
COMMENT ON COLUMN ai_report_template_versions.approved_rendered_payload IS 'AES-256-GCM encrypted JSON approved rendered example.';
COMMENT ON COLUMN ai_report_template_versions.prompt_hash IS 'SHA-256 hash of prompt + data scope + style recipe at approval.';
COMMENT ON COLUMN ai_report_template_versions.blueprint_hash IS 'SHA-256 hash of the approved AI output.';
