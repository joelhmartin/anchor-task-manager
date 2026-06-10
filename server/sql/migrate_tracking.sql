-- migrate_tracking.sql
-- Tracking provisioning system tables

-- 1. Tracking templates (reusable GTM tag/trigger/variable definitions)
CREATE TABLE IF NOT EXISTS tracking_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'web_container',
  description TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, version)
);

-- 2. Tracking configs (one per client — source of truth)
CREATE TABLE IF NOT EXISTS tracking_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL CHECK (client_type IN ('medical', 'non_medical')),
  website_domain TEXT NOT NULL,
  gtm_account_id TEXT,
  gtm_container_id TEXT,
  gtm_container_public_id TEXT,
  gtm_workspace_id TEXT,
  ga4_property_id TEXT,
  ga4_measurement_id TEXT,
  ga4_api_secret TEXT,
  google_ads_customer_id TEXT,
  google_ads_conversion_id TEXT,
  google_ads_conversion_label TEXT,
  meta_pixel_id TEXT,
  meta_capi_token TEXT,
  meta_test_event_code TEXT,
  allowed_events JSONB NOT NULL DEFAULT '["lead_submitted","qualified_call","new_client","appointment_request"]'::jsonb,
  blocked_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  browser_meta_pixel_enabled BOOLEAN NOT NULL DEFAULT false,
  relay_enabled BOOLEAN NOT NULL DEFAULT false,
  provisioning_status TEXT NOT NULL DEFAULT 'draft',
  gtm_version_id TEXT,
  install_snippet TEXT,
  config_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provisioned_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_configs_user ON tracking_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_tracking_configs_status ON tracking_configs(provisioning_status);

-- 3. Tracking provisioning jobs (audit of each provisioning run)
CREATE TABLE IF NOT EXISTS tracking_provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_config_id UUID NOT NULL REFERENCES tracking_configs(id) ON DELETE CASCADE,
  triggered_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tracking_jobs_config ON tracking_provisioning_jobs(tracking_config_id, created_at DESC);

-- 4. Tracking event log (audit trail for relay events)
CREATE TABLE IF NOT EXISTS tracking_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_config_id UUID NOT NULL REFERENCES tracking_configs(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  source_type TEXT,
  source_id UUID,
  payload_sent JSONB,
  response_status INT,
  response_body TEXT,
  success BOOLEAN,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_config ON tracking_event_log(tracking_config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_failed ON tracking_event_log(success) WHERE success = false;

-- 5. Seed the standard web container template v1
INSERT INTO tracking_templates (name, template_type, description, tags, triggers, variables, version, is_active)
VALUES (
  'standard_web_v1',
  'web_container',
  'Standard web container template with GA4 and optional Meta Pixel',
  '[
    {
      "name": "GA4 Configuration",
      "type": "gaawc",
      "parameter": [
        {"type": "template", "key": "measurementId", "value": "{{ga4_measurement_id}}"}
      ],
      "firingTriggerId": ["__ALL_PAGES"]
    },
    {
      "name": "Meta Pixel - PageView",
      "type": "html",
      "parameter": [
        {
          "type": "template",
          "key": "html",
          "value": "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version=\"2.0\";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,\"script\",\"https://connect.facebook.net/en_US/fbevents.js\");fbq(\"init\",\"{{meta_pixel_id}}\");fbq(\"track\",\"PageView\");</script>"
        }
      ],
      "firingTriggerId": ["__ALL_PAGES"],
      "meta": {"conditional": "browser_meta_pixel_enabled"}
    }
  ]'::jsonb,
  '[
    {
      "name": "CTA Click",
      "type": "linkClick",
      "autoEventFilter": [
        {"type": "matchRegex", "parameter": [
          {"type": "template", "key": "arg0", "value": "{{Click URL}}"},
          {"type": "template", "key": "arg1", "value": "tel:|mailto:|#(contact|book|schedule|appointment)"}
        ]}
      ]
    },
    {
      "name": "Scroll Depth",
      "type": "scrollDepth",
      "parameter": [
        {"type": "template", "key": "verticalThresholdsPercent", "value": "25,50,75,90"},
        {"type": "boolean", "key": "verticalThresholdOn", "value": "true"},
        {"type": "template", "key": "triggerStartOption", "value": "WINDOW_LOAD"}
      ]
    },
    {
      "name": "Form Embed View",
      "type": "elementVisibility",
      "parameter": [
        {"type": "template", "key": "elementSelector", "value": ".anchor-form-embed, [data-anchor-form]"},
        {"type": "template", "key": "selectorType", "value": "CSS_SELECTOR"},
        {"type": "boolean", "key": "useOnScreenDuration", "value": "false"},
        {"type": "template", "key": "firingFrequency", "value": "ONCE_PER_PAGE"}
      ]
    }
  ]'::jsonb,
  '[
    {
      "name": "GA4 Measurement ID",
      "type": "c",
      "parameter": [{"type": "template", "key": "value", "value": "{{ga4_measurement_id}}"}]
    },
    {
      "name": "Google Ads Conversion ID",
      "type": "c",
      "parameter": [{"type": "template", "key": "value", "value": "{{google_ads_conversion_id}}"}]
    },
    {
      "name": "Google Ads Conversion Label",
      "type": "c",
      "parameter": [{"type": "template", "key": "value", "value": "{{google_ads_conversion_label}}"}]
    },
    {
      "name": "Meta Pixel ID",
      "type": "c",
      "parameter": [{"type": "template", "key": "value", "value": "{{meta_pixel_id}}"}]
    }
  ]'::jsonb,
  1,
  true
)
ON CONFLICT (name, version) DO NOTHING;
