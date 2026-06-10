-- ============================================================================
-- CTM Forms Integration Migration
-- Adds notification overrides table and enhanced form settings
-- ============================================================================

-- Per-form email notification overrides
CREATE TABLE IF NOT EXISTS form_notification_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  recipient_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] DEFAULT '{}',
  subject_template TEXT,
  body_template TEXT,
  include_field_values BOOLEAN DEFAULT TRUE,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(form_id)
);

-- Account-level default notification emails for forms
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS form_notification_emails TEXT[] DEFAULT '{}';

-- CTM FormReactor ID on forms table (for linking to CTM)
ALTER TABLE forms
  ADD COLUMN IF NOT EXISTS ctm_reactor_id TEXT;

-- Index for efficient form_notification_overrides lookup
CREATE INDEX IF NOT EXISTS idx_form_notification_overrides_form_id
  ON form_notification_overrides(form_id);
