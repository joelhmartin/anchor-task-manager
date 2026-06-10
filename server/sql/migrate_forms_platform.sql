-- Forms Platform Migration
-- This creates all tables needed for the HIPAA-compliant form platform

-- Main forms table
CREATE TABLE IF NOT EXISTS forms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES users(id) ON DELETE SET NULL, -- optional org/client association
  name TEXT NOT NULL,
  description TEXT,
  form_type TEXT NOT NULL CHECK (form_type IN ('conversion', 'intake')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  active_version_id UUID, -- will be FK'd after form_versions table created
  -- Settings stored as JSON for flexibility
  settings_json JSONB NOT NULL DEFAULT '{
    "email_recipients": [],
    "email_on_submission": true,
    "email_on_draft_resumed": false,
    "save_and_resume_enabled": false,
    "resume_token_ttl_hours": 72,
    "new_patient_button_label": "New Patient",
    "new_patient_button_helper": "Start a new form",
    "resume_button_label": "Resume",
    "resume_button_helper": "Continue where you left off",
    "ctm_enabled": false,
    "ctm_conversion_action_id": null,
    "ctm_five_star_enabled": false,
    "domain_allowlist": [],
    "custom_thank_you_message": "Thank you for your submission!"
  }'::jsonb,
  embed_token TEXT UNIQUE, -- signed token for embed verification
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);
CREATE INDEX IF NOT EXISTS idx_forms_org ON forms(org_id);
CREATE INDEX IF NOT EXISTS idx_forms_embed_token ON forms(embed_token);

-- Form versions (immutable once published)
CREATE TABLE IF NOT EXISTS form_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  react_code TEXT NOT NULL, -- React + MUI component code
  css_code TEXT, -- Scoped CSS
  -- Normalized schema for server-side validation (derived from code)
  schema_json JSONB NOT NULL DEFAULT '{"fields": []}'::jsonb,
  -- AI generation metadata
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ai_source_pdf_path TEXT,
  ai_prompt_used TEXT,
  -- Publishing info
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(form_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_form_versions_form ON form_versions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_versions_published ON form_versions(published_at) WHERE published_at IS NOT NULL;

-- Add FK for active_version_id after form_versions exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'forms_active_version_id_fkey'
  ) THEN
    ALTER TABLE forms ADD CONSTRAINT forms_active_version_id_fkey 
      FOREIGN KEY (active_version_id) REFERENCES form_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Form submissions
CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  form_version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
  submission_kind TEXT NOT NULL CHECK (submission_kind IN ('conversion', 'intake', 'draft')),
  -- PHI payload is encrypted at rest (for intake forms)
  -- Uses pgcrypto or application-level encryption
  encrypted_payload BYTEA, -- nullable, only for intake forms
  encryption_key_id TEXT, -- reference to key used for encryption
  -- Non-PHI payload for conversion forms (plain JSON)
  non_phi_payload JSONB,
  -- Attribution data (UTMs, referrer, CTM identifiers)
  attribution_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- CTM integration status
  ctm_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ctm_sent_at TIMESTAMPTZ,
  ctm_response JSONB,
  ctm_error TEXT,
  -- Email notification status
  email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  referrer TEXT,
  embed_domain TEXT, -- domain where form was embedded
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_kind ON form_submissions(submission_kind);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_form_submissions_ctm_pending ON form_submissions(ctm_sent) WHERE ctm_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_form_submissions_email_pending ON form_submissions(email_sent) WHERE email_sent = FALSE;

-- Draft sessions for save-and-continue-later
CREATE TABLE IF NOT EXISTS form_draft_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  form_version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
  -- Resume token stored hashed for security
  resume_token_hash TEXT NOT NULL UNIQUE,
  -- Email for OTP-based resume (hashed or encrypted)
  email_hash TEXT,
  -- Partial payload (encrypted)
  encrypted_partial_payload BYTEA NOT NULL,
  encryption_key_id TEXT,
  -- OTP tracking
  otp_hash TEXT,
  otp_attempts INTEGER NOT NULL DEFAULT 0,
  otp_last_sent_at TIMESTAMPTZ,
  -- Expiration
  expires_at TIMESTAMPTZ NOT NULL,
  -- Tracking
  last_saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Client onboarding draft (save & continue later)
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS onboarding_draft_json JSONB;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS onboarding_draft_saved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_form_draft_sessions_form ON form_draft_sessions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_draft_sessions_token ON form_draft_sessions(resume_token_hash);
CREATE INDEX IF NOT EXISTS idx_form_draft_sessions_expires ON form_draft_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_form_draft_sessions_email ON form_draft_sessions(email_hash) WHERE email_hash IS NOT NULL;

-- PDF artifacts for submissions
CREATE TABLE IF NOT EXISTS form_pdf_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL, -- path in GCS or local storage
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT,
  checksum TEXT NOT NULL, -- SHA-256 for integrity
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_form_pdf_artifacts_submission ON form_pdf_artifacts(submission_id);

-- Audit logs for compliance
CREATE TABLE IF NOT EXISTS form_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL, -- null for public/anonymous actions
  action TEXT NOT NULL, -- e.g., 'form.created', 'submission.viewed', 'pdf.downloaded', 'ai.generated'
  entity_type TEXT NOT NULL, -- e.g., 'form', 'submission', 'version', 'pdf'
  entity_id UUID NOT NULL,
  -- Additional context (no PHI!)
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_audit_logs_actor ON form_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_form_audit_logs_entity ON form_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_form_audit_logs_action ON form_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_form_audit_logs_created ON form_audit_logs(created_at);

-- Job queue for reliable submission processing (CTM, email)
CREATE TABLE IF NOT EXISTS form_submission_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('ctm_conversion', 'email_notification', 'pdf_generation')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  idempotency_key TEXT UNIQUE, -- prevent double-processing
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_submission_jobs_pending ON form_submission_jobs(status, scheduled_at) 
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_form_submission_jobs_submission ON form_submission_jobs(submission_id);

-- PHI field definitions - tracks which fields contain PHI for validation
CREATE TABLE IF NOT EXISTS form_phi_field_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  field_type TEXT NOT NULL UNIQUE, -- e.g., 'ssn', 'dob', 'medical_record_number', 'diagnosis'
  display_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default PHI field types
INSERT INTO form_phi_field_definitions (field_type, display_name, description) VALUES
  ('ssn', 'Social Security Number', 'Full or partial SSN'),
  ('dob', 'Date of Birth', 'Full date of birth'),
  ('medical_record_number', 'Medical Record Number', 'Patient MRN'),
  ('diagnosis', 'Diagnosis/Condition', 'Medical diagnosis or condition'),
  ('medication', 'Medication', 'Current or past medications'),
  ('treatment', 'Treatment History', 'Medical treatment information'),
  ('insurance_id', 'Insurance ID', 'Health insurance member ID'),
  ('health_history', 'Health History', 'General health history'),
  ('emergency_contact', 'Emergency Contact', 'Emergency contact information'),
  ('physician', 'Physician Information', 'Referring or primary physician')
ON CONFLICT (field_type) DO NOTHING;

-- CTM field allowlist - fields that can be sent to CTM
CREATE TABLE IF NOT EXISTS form_ctm_allowed_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  field_name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default allowed CTM fields (non-PHI)
INSERT INTO form_ctm_allowed_fields (field_name, description) VALUES
  ('utm_source', 'UTM source parameter'),
  ('utm_medium', 'UTM medium parameter'),
  ('utm_campaign', 'UTM campaign parameter'),
  ('utm_term', 'UTM term parameter'),
  ('utm_content', 'UTM content parameter'),
  ('referrer', 'HTTP referrer'),
  ('landing_page', 'Landing page URL'),
  ('form_name', 'Name of the form submitted'),
  ('form_id', 'Form identifier'),
  ('submission_id', 'Submission identifier'),
  ('timestamp', 'Submission timestamp'),
  ('page_url', 'Page URL where form was embedded'),
  ('conversion_type', 'Type of conversion (contact, intake, etc.)')
ON CONFLICT (field_name) DO NOTHING;

-- Trigger to update updated_at on forms
CREATE OR REPLACE FUNCTION update_forms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS forms_updated_at_trigger ON forms;
CREATE TRIGGER forms_updated_at_trigger
  BEFORE UPDATE ON forms
  FOR EACH ROW
  EXECUTE FUNCTION update_forms_updated_at();

