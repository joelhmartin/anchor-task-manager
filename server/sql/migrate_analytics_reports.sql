-- Analytics report templates and generated reports
CREATE TABLE IF NOT EXISTS analytics_report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  schedule_frequency TEXT,
  schedule_paused BOOLEAN DEFAULT false,
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics_generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES analytics_report_templates(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'pdf',
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now()
);
