-- ============================================================================
-- CTM Form Templates
-- Reusable form configurations that can be applied to any client
-- ============================================================================

CREATE TABLE IF NOT EXISTS ctm_form_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,                        -- e.g. 'quiz', 'contact', 'intake', 'assessment'
  config_json JSONB NOT NULL DEFAULT '{"settings":{},"fields":[]}',
  form_mode TEXT NOT NULL DEFAULT 'builder',
  submit_action TEXT DEFAULT 'message',
  success_message TEXT DEFAULT '',
  redirect_url TEXT DEFAULT '',
  thankyou_html TEXT DEFAULT '',
  multi_step BOOLEAN DEFAULT FALSE,
  auto_advance BOOLEAN DEFAULT FALSE,
  title_page BOOLEAN DEFAULT FALSE,
  title_heading TEXT DEFAULT '',
  title_desc TEXT DEFAULT '',
  start_text TEXT DEFAULT 'Get Started',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  source_form_id UUID,                  -- which form this was saved from (informational)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctm_form_templates_category ON ctm_form_templates(category);
CREATE INDEX IF NOT EXISTS idx_ctm_form_templates_system ON ctm_form_templates(is_system) WHERE is_system = TRUE;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_ctm_form_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ctm_form_templates_updated_at_trigger ON ctm_form_templates;
CREATE TRIGGER ctm_form_templates_updated_at_trigger
  BEFORE UPDATE ON ctm_form_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_ctm_form_templates_updated_at();
