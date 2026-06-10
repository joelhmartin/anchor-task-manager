-- Report Builder schema (Phase 1)
-- Replaces analytics_report_templates / analytics_generated_reports

CREATE TABLE IF NOT EXISTS report_templates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  description       TEXT,
  layout            JSONB NOT NULL,
  filters_default   JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  schedule          JSONB,
  next_run_at       TIMESTAMPTZ,
  legacy_template_id UUID,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_templates_active
  ON report_templates (is_archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_templates_next_run
  ON report_templates (next_run_at)
  WHERE schedule IS NOT NULL AND is_archived = false;

CREATE TABLE IF NOT EXISTS report_template_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id     UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  layout          JSONB NOT NULL,
  filters_default JSONB NOT NULL,
  saved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS idx_report_template_versions_template
  ON report_template_versions (template_id, version DESC);

CREATE TABLE IF NOT EXISTS report_generations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id       UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  template_version  INTEGER,
  client_ids        UUID[] NOT NULL,
  filters           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','complete','failed','canceled')),
  error_message     TEXT,
  description       TEXT,
  pdf_file_id       UUID REFERENCES file_uploads(id) ON DELETE SET NULL,
  hydrated_payload  JSONB,
  generated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  generation_source TEXT NOT NULL DEFAULT 'manual'
                    CHECK (generation_source IN ('manual','scheduled','api')),
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_report_generations_template
  ON report_generations (template_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_generations_status
  ON report_generations (status, generated_at)
  WHERE status IN ('pending','running');
