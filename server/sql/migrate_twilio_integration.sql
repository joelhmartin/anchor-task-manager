-- ============================================================================
-- Twilio Integration & Forms Presets Migration
-- ============================================================================
-- This migration adds tables for Twilio call tracking integration and
-- form presets for the unified lead pipeline.
--
-- COMPLIANCE: All credentials are encrypted at application layer before storage.
-- No PHI is stored in these tables - attribution data only.
-- ============================================================================

-- ============================================================================
-- TWILIO CLIENT CONFIGS
-- Per-client Twilio credentials (encrypted at application layer)
-- ============================================================================
CREATE TABLE IF NOT EXISTS twilio_client_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_sid TEXT NOT NULL,        -- Encrypted at application layer
  auth_token TEXT NOT NULL,         -- Encrypted at application layer
  twiml_app_sid TEXT,               -- Optional TwiML app for advanced routing
  webhook_secret TEXT,              -- Encrypted, for webhook signature validation
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_user_id)
);

CREATE INDEX IF NOT EXISTS idx_twilio_client_configs_user ON twilio_client_configs(client_user_id);
CREATE INDEX IF NOT EXISTS idx_twilio_client_configs_active ON twilio_client_configs(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- TWILIO TRACKING NUMBERS
-- Tracking phone numbers purchased/managed via Twilio
-- Note: twilio_config_id is nullable because we now use global agency credentials
-- ============================================================================
CREATE TABLE IF NOT EXISTS twilio_tracking_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  twilio_config_id UUID REFERENCES twilio_client_configs(id) ON DELETE SET NULL,  -- Nullable for global config mode
  phone_number TEXT NOT NULL,           -- E.164 format (+1XXXXXXXXXX)
  phone_number_sid TEXT NOT NULL,       -- Twilio's phone number SID (PN...)
  friendly_name TEXT,                   -- Human-readable label e.g., "Google Ads - Main"
  forward_to_number TEXT NOT NULL,      -- Where to forward calls (E.164)
  source_type TEXT,                     -- 'google_ads', 'facebook', 'tv', 'organic', etc.
  campaign_name TEXT,                   -- For attribution grouping
  recording_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transcription_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(phone_number)
);

-- Make twilio_config_id nullable if table already exists (for existing deployments)
ALTER TABLE twilio_tracking_numbers ALTER COLUMN twilio_config_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_twilio_tracking_numbers_user ON twilio_tracking_numbers(client_user_id);
CREATE INDEX IF NOT EXISTS idx_twilio_tracking_numbers_config ON twilio_tracking_numbers(twilio_config_id);
CREATE INDEX IF NOT EXISTS idx_twilio_tracking_numbers_phone ON twilio_tracking_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_twilio_tracking_numbers_active ON twilio_tracking_numbers(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- CALL ATTRIBUTION
-- Attribution data linked to calls (both CTM and Twilio)
-- ============================================================================
CREATE TABLE IF NOT EXISTS call_attribution (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_log_id UUID REFERENCES call_logs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Google Attribution
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  -- Facebook Attribution
  fbclid TEXT,
  fbc TEXT,
  fbp TEXT,
  -- UTM Parameters
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  -- Context
  landing_page_url TEXT,
  referrer_url TEXT,
  user_agent TEXT,
  ip_hash TEXT,                         -- Hashed IP for privacy compliance
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_attribution_call ON call_attribution(call_log_id);
CREATE INDEX IF NOT EXISTS idx_call_attribution_session ON call_attribution(session_id);
CREATE INDEX IF NOT EXISTS idx_call_attribution_user ON call_attribution(client_user_id);
CREATE INDEX IF NOT EXISTS idx_call_attribution_gclid ON call_attribution(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_attribution_fbclid ON call_attribution(fbclid) WHERE fbclid IS NOT NULL;

-- ============================================================================
-- ATTRIBUTION SESSIONS
-- Website visitor sessions for linking attribution to calls/forms
-- ============================================================================
CREATE TABLE IF NOT EXISTS attribution_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT NOT NULL,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tracking_number_id UUID REFERENCES twilio_tracking_numbers(id) ON DELETE SET NULL,
  visitor_data JSONB NOT NULL DEFAULT '{}',
  -- Quick-access attribution fields
  gclid TEXT,
  fbclid TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  landing_page TEXT,
  referrer TEXT,
  -- Session lifecycle
  expires_at TIMESTAMPTZ NOT NULL,
  call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL,
  form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attribution_sessions_session ON attribution_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_attribution_sessions_user ON attribution_sessions(client_user_id);
CREATE INDEX IF NOT EXISTS idx_attribution_sessions_expires ON attribution_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_attribution_sessions_tracking ON attribution_sessions(tracking_number_id);
CREATE INDEX IF NOT EXISTS idx_attribution_sessions_call ON attribution_sessions(call_log_id) WHERE call_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attribution_sessions_form ON attribution_sessions(form_submission_id) WHERE form_submission_id IS NOT NULL;

-- ============================================================================
-- FORM PRESETS
-- Global form templates that clients can use as starting points
-- ============================================================================
CREATE TABLE IF NOT EXISTS form_presets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,                        -- 'contact', 'intake', 'appointment', 'consultation'
  form_type TEXT NOT NULL DEFAULT 'conversion' CHECK (form_type IN ('conversion', 'intake')),
  schema_json JSONB NOT NULL DEFAULT '{"fields":[]}',  -- Field definitions
  react_code TEXT,                      -- Pre-built React component (optional)
  css_code TEXT,                        -- Custom CSS (optional)
  is_system BOOLEAN NOT NULL DEFAULT FALSE,  -- System presets can't be deleted
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_presets_category ON form_presets(category);
CREATE INDEX IF NOT EXISTS idx_form_presets_type ON form_presets(form_type);
CREATE INDEX IF NOT EXISTS idx_form_presets_system ON form_presets(is_system) WHERE is_system = TRUE;

-- ============================================================================
-- MODIFICATIONS TO EXISTING TABLES
-- ============================================================================

-- call_logs: Add provider tracking for Twilio
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'ctm';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS provider_call_sid TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS tracking_number_id UUID REFERENCES twilio_tracking_numbers(id) ON DELETE SET NULL;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'call';

CREATE INDEX IF NOT EXISTS idx_call_logs_provider ON call_logs(provider);
CREATE INDEX IF NOT EXISTS idx_call_logs_provider_sid ON call_logs(provider_call_sid) WHERE provider_call_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_logs_tracking_number ON call_logs(tracking_number_id) WHERE tracking_number_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_logs_activity_type ON call_logs(activity_type);

-- client_profiles: Add provider preference and twilio config reference
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS call_provider TEXT DEFAULT 'ctm';
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS twilio_config_id UUID REFERENCES twilio_client_configs(id) ON DELETE SET NULL;

-- forms: Add owner_user_id for client-specific forms
ALTER TABLE forms ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS preset_id UUID REFERENCES form_presets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forms_owner ON forms(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forms_preset ON forms(preset_id) WHERE preset_id IS NOT NULL;

-- ============================================================================
-- SEED DEFAULT FORM PRESETS
-- ============================================================================
INSERT INTO form_presets (name, category, form_type, schema_json, is_system) VALUES
(
  'Contact Form',
  'contact',
  'conversion',
  '{
    "fields": [
      {"name": "name", "type": "text", "label": "Full Name", "required": true},
      {"name": "email", "type": "email", "label": "Email Address", "required": true},
      {"name": "phone", "type": "tel", "label": "Phone Number", "required": false},
      {"name": "message", "type": "textarea", "label": "How can we help?", "required": true}
    ],
    "submitLabel": "Send Message",
    "successMessage": "Thanks! We''ll be in touch soon."
  }',
  TRUE
),
(
  'Request Appointment',
  'appointment',
  'conversion',
  '{
    "fields": [
      {"name": "name", "type": "text", "label": "Full Name", "required": true},
      {"name": "email", "type": "email", "label": "Email Address", "required": true},
      {"name": "phone", "type": "tel", "label": "Phone Number", "required": true},
      {"name": "preferred_date", "type": "date", "label": "Preferred Date", "required": false},
      {"name": "preferred_time", "type": "select", "label": "Preferred Time", "required": false, "options": ["Morning", "Afternoon", "Evening"]},
      {"name": "reason", "type": "textarea", "label": "Reason for Visit", "required": false}
    ],
    "submitLabel": "Request Appointment",
    "successMessage": "Thanks! We''ll confirm your appointment soon."
  }',
  TRUE
),
(
  'Free Consultation',
  'consultation',
  'conversion',
  '{
    "fields": [
      {"name": "name", "type": "text", "label": "Full Name", "required": true},
      {"name": "email", "type": "email", "label": "Email Address", "required": true},
      {"name": "phone", "type": "tel", "label": "Phone Number", "required": true},
      {"name": "service_interest", "type": "select", "label": "Service You''re Interested In", "required": false, "options": []},
      {"name": "questions", "type": "textarea", "label": "Questions or Comments", "required": false}
    ],
    "submitLabel": "Request Free Consultation",
    "successMessage": "Thanks! We''ll reach out to schedule your consultation."
  }',
  TRUE
),
(
  'Patient Intake',
  'intake',
  'intake',
  '{
    "fields": [
      {"name": "first_name", "type": "text", "label": "First Name", "required": true},
      {"name": "last_name", "type": "text", "label": "Last Name", "required": true},
      {"name": "dob", "type": "date", "label": "Date of Birth", "required": true, "phi": true},
      {"name": "email", "type": "email", "label": "Email Address", "required": true},
      {"name": "phone", "type": "tel", "label": "Phone Number", "required": true},
      {"name": "address", "type": "textarea", "label": "Address", "required": false},
      {"name": "insurance_provider", "type": "text", "label": "Insurance Provider", "required": false, "phi": true},
      {"name": "insurance_id", "type": "text", "label": "Insurance Member ID", "required": false, "phi": true},
      {"name": "emergency_contact", "type": "text", "label": "Emergency Contact Name", "required": false},
      {"name": "emergency_phone", "type": "tel", "label": "Emergency Contact Phone", "required": false},
      {"name": "medical_conditions", "type": "textarea", "label": "Current Medical Conditions", "required": false, "phi": true},
      {"name": "medications", "type": "textarea", "label": "Current Medications", "required": false, "phi": true},
      {"name": "allergies", "type": "textarea", "label": "Known Allergies", "required": false, "phi": true}
    ],
    "submitLabel": "Submit Intake Form",
    "successMessage": "Thank you! Your information has been securely submitted."
  }',
  TRUE
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- TRIGGER: Auto-update updated_at on twilio_client_configs
-- ============================================================================
CREATE OR REPLACE FUNCTION update_twilio_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS twilio_client_configs_updated_at_trigger ON twilio_client_configs;
CREATE TRIGGER twilio_client_configs_updated_at_trigger
  BEFORE UPDATE ON twilio_client_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_twilio_config_updated_at();

-- ============================================================================
-- TRIGGER: Auto-update updated_at on twilio_tracking_numbers
-- ============================================================================
CREATE OR REPLACE FUNCTION update_twilio_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS twilio_tracking_numbers_updated_at_trigger ON twilio_tracking_numbers;
CREATE TRIGGER twilio_tracking_numbers_updated_at_trigger
  BEFORE UPDATE ON twilio_tracking_numbers
  FOR EACH ROW
  EXECUTE FUNCTION update_twilio_tracking_updated_at();

-- ============================================================================
-- TRIGGER: Auto-update updated_at on form_presets
-- ============================================================================
CREATE OR REPLACE FUNCTION update_form_presets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS form_presets_updated_at_trigger ON form_presets;
CREATE TRIGGER form_presets_updated_at_trigger
  BEFORE UPDATE ON form_presets
  FOR EACH ROW
  EXECUTE FUNCTION update_form_presets_updated_at();

-- ============================================================================
-- CLEANUP: Expired attribution sessions (run via cron)
-- This just creates the function - actual scheduling done in application
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_attribution_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM attribution_sessions
  WHERE expires_at < NOW()
    AND call_log_id IS NULL
    AND form_submission_id IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
