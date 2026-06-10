-- migrate_ai_web_reports.sql — adds AI web-report engine tables.
-- Idempotent: safe to run multiple times.

-- 1) Engine discriminator + AI fields on existing report_templates
ALTER TABLE report_templates
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'widget_canvas',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS prompt TEXT,
  ADD COLUMN IF NOT EXISTS data_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS style_recipe JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_version_id UUID;

-- 2) Approved-version table for AI templates (kept separate from legacy report_template_versions)
CREATE TABLE IF NOT EXISTS ai_report_template_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  data_scope JSONB NOT NULL,
  style_recipe JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  model_name TEXT NOT NULL,
  approved_example_output JSONB,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_template_versions_template
  ON ai_report_template_versions(template_id);

-- CHECK: engine must be a known value (prevents silent typos from reaching the pipeline)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_templates_engine_check'
  ) THEN
    ALTER TABLE report_templates
      ADD CONSTRAINT report_templates_engine_check
      CHECK (engine IN ('widget_canvas', 'ai_web'));
  END IF;
END $$;

-- CHECK: template-level status is distinct from run-level status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_templates_ai_status_check'
  ) THEN
    ALTER TABLE report_templates
      ADD CONSTRAINT report_templates_ai_status_check
      CHECK (status IN ('draft', 'approved', 'archived'));
  END IF;
END $$;

-- FK from report_templates.approved_version_id → ai_report_template_versions.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_templates_approved_version_fk'
  ) THEN
    ALTER TABLE report_templates
      ADD CONSTRAINT report_templates_approved_version_fk
      FOREIGN KEY (approved_version_id) REFERENCES ai_report_template_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3) Run header (one row per "fire the report")
CREATE TABLE IF NOT EXISTS report_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  template_version_id UUID REFERENCES ai_report_template_versions(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('test','manual','scheduled')),
  -- audience_filter = the query expression; selected_client_ids = the materialized resolution at run time. Maintain only selected_client_ids after fan-out.
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_client_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','partial','complete','failed','canceled')),
  date_range JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- updated_at safety net: add if table already existed before this migration run
ALTER TABLE report_runs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_report_runs_template ON report_runs(template_id);
CREATE INDEX IF NOT EXISTS idx_report_runs_status ON report_runs(status);
CREATE INDEX IF NOT EXISTS idx_report_runs_created ON report_runs(created_at DESC);

-- 4) One row per client per run — the immutable, portal-facing snapshot
-- IMPORTANT (HIPAA): data_snapshot, ai_output, and rendered_payload may contain
-- PHI for medical clients (lead names, contact info, transcripts). Filtering
-- and redaction MUST happen in server/services/reports/dataPackage.js BEFORE
-- write. See Task 3 of docs/superpowers/plans/2026-05-08-ai-web-reports.md.
-- DO NOT store raw lead PHI in these columns for medical clients (client_type='medical').
CREATE TABLE IF NOT EXISTS report_run_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed')),
  data_snapshot JSONB,
  ai_output JSONB,
  rendered_payload JSONB,
  render_hash TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, client_id)
);

-- updated_at safety net: add if table already existed before this migration run
ALTER TABLE report_run_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_report_run_items_run ON report_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_report_run_items_client ON report_run_items(client_id);
CREATE INDEX IF NOT EXISTS idx_report_run_items_status ON report_run_items(status);
