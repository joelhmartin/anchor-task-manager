-- ============================================================================
-- CTM Forms V2 — Dedicated CTM Form Builder Module
-- Fresh tables, separate from the generic forms system.
-- ============================================================================

-- CTM form definitions
CREATE TABLE IF NOT EXISTS ctm_forms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  form_mode TEXT NOT NULL DEFAULT 'builder' CHECK (form_mode IN ('reactor', 'builder')),

  -- Builder mode: full config JSON { settings: {}, fields: [] }
  config_json JSONB NOT NULL DEFAULT '{"settings":{},"fields":[]}',
  rendered_html TEXT,

  -- Reactor mode: user-provided HTML template
  reactor_html TEXT,

  -- CTM integration
  ctm_reactor_id TEXT,
  ctm_reactor_fields_hash TEXT,

  -- After submission
  submit_action TEXT DEFAULT 'message' CHECK (submit_action IN ('message', 'redirect', 'popup')),
  success_message TEXT DEFAULT 'Thanks! We''ll be in touch shortly.',
  redirect_url TEXT,
  thankyou_html TEXT,

  -- Duplicate submission protection
  dupe_phone TEXT,
  dupe_phone_href TEXT,

  -- Analytics (per-form overrides)
  analytics_override BOOLEAN DEFAULT FALSE,
  analytics_json JSONB,

  -- Multi-step (applies to both modes)
  multi_step BOOLEAN DEFAULT FALSE,
  title_page BOOLEAN DEFAULT FALSE,
  title_heading TEXT,
  title_desc TEXT,
  start_text TEXT DEFAULT 'Get Started',
  auto_advance BOOLEAN DEFAULT FALSE,

  -- Email notifications (NEW — not in WP plugin)
  notification_enabled BOOLEAN DEFAULT TRUE,
  notification_emails TEXT[] DEFAULT '{}',
  notification_cc TEXT[] DEFAULT '{}',
  notification_subject_template TEXT,
  notification_body_template TEXT,

  -- Embed
  embed_token TEXT UNIQUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CTM form submissions (local record of what was sent to CTM)
CREATE TABLE IF NOT EXISTS ctm_form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id UUID NOT NULL REFERENCES ctm_forms(id) ON DELETE CASCADE,
  field_data JSONB NOT NULL,
  attribution_json JSONB,
  ctm_reactor_id TEXT,
  ctm_trackback_id TEXT,
  ctm_sent BOOLEAN DEFAULT FALSE,
  ctm_error TEXT,
  email_sent BOOLEAN DEFAULT FALSE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics diagnostics log (client-side report of what fired / failed)
ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS analytics_log JSONB;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ctm_forms_org_id ON ctm_forms(org_id);
CREATE INDEX IF NOT EXISTS idx_ctm_forms_status ON ctm_forms(status);
CREATE INDEX IF NOT EXISTS idx_ctm_forms_embed_token ON ctm_forms(embed_token);
CREATE INDEX IF NOT EXISTS idx_ctm_form_submissions_form_id ON ctm_form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_ctm_form_submissions_created_at ON ctm_form_submissions(created_at DESC);
