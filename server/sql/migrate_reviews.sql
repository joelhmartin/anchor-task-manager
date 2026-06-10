-- ============================================================================
-- Reviews Management System - Database Migration
-- ============================================================================
-- This migration creates tables for:
-- 1. Google Reviews storage and sync
-- 2. Review responses (drafts and sent)
-- 3. Review request campaigns
-- 4. AI automation rules and audit logs
-- ============================================================================

-- ============================================================================
-- Core Reviews Table
-- Stores synced reviews from Google Business Profile (and future platforms)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oauth_resource_id UUID REFERENCES oauth_resources(id) ON DELETE SET NULL,
  
  -- Platform identification
  platform TEXT NOT NULL DEFAULT 'google' CHECK (platform IN ('google', 'yelp', 'facebook', 'healthgrades')),
  platform_review_id TEXT NOT NULL,
  
  -- Location/business reference
  location_name TEXT,
  location_id TEXT,
  
  -- Review content
  reviewer_name TEXT NOT NULL,
  reviewer_photo_url TEXT,
  reviewer_profile_url TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  review_language TEXT DEFAULT 'en',
  
  -- Timestamps from platform
  review_created_at TIMESTAMPTZ NOT NULL,
  review_updated_at TIMESTAMPTZ,
  
  -- Response tracking
  has_response BOOLEAN NOT NULL DEFAULT FALSE,
  response_text TEXT,
  response_created_at TIMESTAMPTZ,
  response_updated_at TIMESTAMPTZ,
  
  -- Internal management
  is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason TEXT,
  flagged_at TIMESTAMPTZ,
  flagged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  internal_notes TEXT,
  
  -- Sentiment analysis (AI-generated)
  sentiment_score DECIMAL(3, 2) CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative', 'mixed')),
  sentiment_analyzed_at TIMESTAMPTZ,
  
  -- Sync metadata
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_error TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Prevent duplicate reviews per platform
  UNIQUE(client_id, platform, platform_review_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_client ON reviews(client_id);
CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews(platform);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_has_response ON reviews(has_response);
CREATE INDEX IF NOT EXISTS idx_reviews_is_flagged ON reviews(is_flagged);
CREATE INDEX IF NOT EXISTS idx_reviews_priority ON reviews(priority);
CREATE INDEX IF NOT EXISTS idx_reviews_review_created ON reviews(review_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_oauth_resource ON reviews(oauth_resource_id);
CREATE INDEX IF NOT EXISTS idx_reviews_sentiment ON reviews(sentiment_label);

-- ============================================================================
-- Review Response Drafts
-- Tracks AI-generated drafts and manual edits before sending
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_response_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Draft content
  draft_text TEXT NOT NULL,
  draft_version INTEGER NOT NULL DEFAULT 1,
  
  -- AI generation metadata
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ai_model TEXT,
  ai_prompt_used TEXT,
  ai_generation_params JSONB NOT NULL DEFAULT '{}',
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'failed', 'discarded')),
  
  -- Human review
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  
  -- Send tracking
  sent_at TIMESTAMPTZ,
  send_error TEXT,
  platform_response_id TEXT,
  
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_response_drafts_review ON review_response_drafts(review_id);
CREATE INDEX IF NOT EXISTS idx_review_response_drafts_client ON review_response_drafts(client_id);
CREATE INDEX IF NOT EXISTS idx_review_response_drafts_status ON review_response_drafts(status);
CREATE INDEX IF NOT EXISTS idx_review_response_drafts_created ON review_response_drafts(created_at DESC);

-- ============================================================================
-- Review Requests
-- Campaigns to request reviews from customers
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oauth_resource_id UUID REFERENCES oauth_resources(id) ON DELETE SET NULL,
  
  -- Request target
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  
  -- Delivery configuration
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('email', 'sms', 'link_only')),
  review_link TEXT NOT NULL,
  custom_message TEXT,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'completed', 'failed', 'bounced')),
  
  -- Tracking metadata
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- If they left a review, link it
  resulting_review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  
  -- Metadata
  source TEXT DEFAULT 'manual', -- manual, api, automation
  campaign_id UUID, -- For batch campaigns
  metadata JSONB NOT NULL DEFAULT '{}',
  
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_requests_client ON review_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(status);
CREATE INDEX IF NOT EXISTS idx_review_requests_delivery ON review_requests(delivery_method);
CREATE INDEX IF NOT EXISTS idx_review_requests_created ON review_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_campaign ON review_requests(campaign_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_customer_email ON review_requests(customer_email);

-- ============================================================================
-- Review Request Campaigns
-- Batch review request campaigns
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_request_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Campaign settings
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('email', 'sms', 'link_only')),
  template_message TEXT,
  
  -- Statistics (denormalized for quick access)
  total_requests INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  clicked_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'paused', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_request_campaigns_client ON review_request_campaigns(client_id);
CREATE INDEX IF NOT EXISTS idx_review_request_campaigns_status ON review_request_campaigns(status);

-- ============================================================================
-- AI Automation Rules
-- Configurable rules for AI-assisted review responses (future-ready)
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Rule conditions
  is_active BOOLEAN NOT NULL DEFAULT FALSE, -- Disabled by default for safety
  
  -- Trigger conditions
  min_rating INTEGER CHECK (min_rating >= 1 AND min_rating <= 5),
  max_rating INTEGER CHECK (max_rating >= 1 AND max_rating <= 5),
  sentiment_filter TEXT[] DEFAULT '{}', -- ['positive', 'neutral', 'negative']
  keyword_triggers TEXT[] DEFAULT '{}', -- Keywords that trigger this rule
  keyword_exclusions TEXT[] DEFAULT '{}', -- Keywords that exclude this rule
  location_ids TEXT[] DEFAULT '{}', -- Specific locations, empty = all
  
  -- Action configuration
  action_type TEXT NOT NULL DEFAULT 'draft' CHECK (action_type IN ('draft', 'auto_send', 'flag', 'notify')),
  
  -- For auto_send and draft actions
  response_template TEXT,
  use_ai_personalization BOOLEAN NOT NULL DEFAULT TRUE,
  ai_tone TEXT DEFAULT 'professional' CHECK (ai_tone IN ('professional', 'friendly', 'casual', 'formal', 'empathetic')),
  
  -- Approval requirements
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE, -- Should always be TRUE for negative reviews
  approval_threshold_rating INTEGER DEFAULT 3, -- Reviews at or below this need approval
  
  -- Notification settings
  notify_on_trigger BOOLEAN NOT NULL DEFAULT FALSE,
  notification_emails TEXT[] DEFAULT '{}',
  
  -- Execution limits
  daily_limit INTEGER,
  hourly_limit INTEGER,
  executions_today INTEGER NOT NULL DEFAULT 0,
  executions_this_hour INTEGER NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Priority (higher = evaluated first)
  priority INTEGER NOT NULL DEFAULT 0,
  
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT review_automation_rules_rating_check CHECK (
    min_rating IS NULL OR max_rating IS NULL OR min_rating <= max_rating
  )
);

CREATE INDEX IF NOT EXISTS idx_review_automation_rules_client ON review_automation_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_review_automation_rules_active ON review_automation_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_review_automation_rules_priority ON review_automation_rules(priority DESC);

-- ============================================================================
-- AI Automation Execution Log
-- Audit trail for all AI-generated actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_automation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- What triggered this log
  review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES review_automation_rules(id) ON DELETE SET NULL,
  draft_id UUID REFERENCES review_response_drafts(id) ON DELETE SET NULL,
  
  -- Action details
  action_type TEXT NOT NULL,
  action_status TEXT NOT NULL DEFAULT 'pending' CHECK (action_status IN ('pending', 'executed', 'approved', 'rejected', 'failed', 'skipped')),
  
  -- AI details
  ai_model TEXT,
  ai_input JSONB NOT NULL DEFAULT '{}',
  ai_output JSONB NOT NULL DEFAULT '{}',
  ai_tokens_used INTEGER,
  ai_latency_ms INTEGER,
  
  -- Human intervention
  human_action TEXT,
  human_action_by UUID REFERENCES users(id) ON DELETE SET NULL,
  human_action_at TIMESTAMPTZ,
  human_notes TEXT,
  
  -- Error handling
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '{}',
  
  -- Metadata
  metadata JSONB NOT NULL DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_automation_logs_client ON review_automation_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_review_automation_logs_review ON review_automation_logs(review_id);
CREATE INDEX IF NOT EXISTS idx_review_automation_logs_rule ON review_automation_logs(rule_id);
CREATE INDEX IF NOT EXISTS idx_review_automation_logs_status ON review_automation_logs(action_status);
CREATE INDEX IF NOT EXISTS idx_review_automation_logs_created ON review_automation_logs(created_at DESC);

-- ============================================================================
-- Review Settings (per client)
-- Client-specific review management configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_settings (
  client_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  
  -- Sync settings
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_sync_at TIMESTAMPTZ,
  sync_error TEXT,
  
  -- Flagging thresholds
  auto_flag_threshold INTEGER DEFAULT 3, -- Auto-flag reviews at or below this rating
  auto_flag_keywords TEXT[] DEFAULT '{}', -- Keywords that trigger auto-flag
  
  -- Notification settings
  notify_new_reviews BOOLEAN NOT NULL DEFAULT TRUE,
  notify_negative_reviews BOOLEAN NOT NULL DEFAULT TRUE,
  negative_review_threshold INTEGER DEFAULT 3,
  notification_emails TEXT[] DEFAULT '{}',
  
  -- Response settings
  default_response_tone TEXT DEFAULT 'professional' CHECK (default_response_tone IN ('professional', 'friendly', 'casual', 'formal', 'empathetic')),
  include_business_name_in_response BOOLEAN NOT NULL DEFAULT TRUE,
  include_reviewer_name_in_response BOOLEAN NOT NULL DEFAULT TRUE,
  response_signature TEXT,
  
  -- AI settings
  ai_drafting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ai_auto_draft_positive BOOLEAN NOT NULL DEFAULT FALSE, -- Auto-draft for positive reviews
  ai_auto_draft_negative BOOLEAN NOT NULL DEFAULT FALSE, -- Auto-draft for negative reviews (requires approval)
  
  -- Review request settings
  default_review_request_template TEXT,
  review_link_base_url TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Review Statistics (materialized/cached stats per client per period)
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oauth_resource_id UUID REFERENCES oauth_resources(id) ON DELETE SET NULL,
  
  -- Period
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly', 'all_time')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Counts
  total_reviews INTEGER NOT NULL DEFAULT 0,
  new_reviews INTEGER NOT NULL DEFAULT 0,
  responded_reviews INTEGER NOT NULL DEFAULT 0,
  pending_reviews INTEGER NOT NULL DEFAULT 0,
  flagged_reviews INTEGER NOT NULL DEFAULT 0,
  
  -- Ratings breakdown
  rating_1_count INTEGER NOT NULL DEFAULT 0,
  rating_2_count INTEGER NOT NULL DEFAULT 0,
  rating_3_count INTEGER NOT NULL DEFAULT 0,
  rating_4_count INTEGER NOT NULL DEFAULT 0,
  rating_5_count INTEGER NOT NULL DEFAULT 0,
  
  -- Averages
  average_rating DECIMAL(3, 2),
  average_response_time_hours DECIMAL(10, 2),
  
  -- Sentiment breakdown
  positive_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  
  -- Review requests
  requests_sent INTEGER NOT NULL DEFAULT 0,
  requests_completed INTEGER NOT NULL DEFAULT 0,
  request_conversion_rate DECIMAL(5, 2),
  
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(client_id, oauth_resource_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_review_statistics_client ON review_statistics(client_id);
CREATE INDEX IF NOT EXISTS idx_review_statistics_period ON review_statistics(period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_review_statistics_resource ON review_statistics(oauth_resource_id);

-- ============================================================================
-- Add review-related columns to client_profiles for quick access
-- ============================================================================
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS reviews_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS reviews_last_sync_at TIMESTAMPTZ;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS reviews_total_count INTEGER DEFAULT 0;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS reviews_average_rating DECIMAL(3, 2);
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS reviews_pending_response_count INTEGER DEFAULT 0;

-- ============================================================================
-- Add Google Business Profile scopes to oauth_providers check
-- ============================================================================
-- Note: The oauth_providers table already exists and supports Google.
-- We just need to ensure the Business Profile API scopes are documented:
-- - https://www.googleapis.com/auth/business.manage (read/write reviews)

COMMENT ON TABLE reviews IS 'Stores synced reviews from Google Business Profile and other platforms';
COMMENT ON TABLE review_response_drafts IS 'Tracks AI-generated and manual response drafts';
COMMENT ON TABLE review_requests IS 'Review request campaigns sent to customers';
COMMENT ON TABLE review_automation_rules IS 'AI automation rules for review responses (future-ready)';
COMMENT ON TABLE review_automation_logs IS 'Audit trail for all AI-generated review actions';
COMMENT ON TABLE review_settings IS 'Per-client review management configuration';
COMMENT ON TABLE review_statistics IS 'Cached statistics for review reporting';

