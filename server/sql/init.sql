-- ============================================================================
-- DATABASE SCHEMA - Anchor Client Dashboard
-- ============================================================================
-- ⚠️ MAINTENANCE REMINDER: When modifying this schema (adding tables, columns,
-- or indexes), ALWAYS update the Database Schema Map in SKILLS.md to keep
-- documentation synchronized.
-- ============================================================================

-- Enable UUIDs and create users table
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name VARCHAR(60) NOT NULL,
  last_name VARCHAR(60) NOT NULL,
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful index for lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Persistent avatar storage.
-- NOTE: Cloud Run filesystem is ephemeral; storing avatars under /uploads will "disappear" after instance recycle.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Client profile metadata
CREATE TABLE IF NOT EXISTS client_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  looker_url TEXT,
  client_package TEXT,
  -- Client contact + routing info (client-provided)
  call_tracking_main_number TEXT,
  front_desk_emails TEXT,
  office_admin_name TEXT,
  office_admin_email TEXT,
  office_admin_phone TEXT,
  form_email_recipients TEXT,
  -- Single-answer onboarding statuses (one per step)
  website_access_status TEXT,
  ga4_access_status TEXT,
  google_ads_access_status TEXT,
  meta_access_status TEXT,
  website_forms_details_status TEXT,
  -- Access steps enabled/disabled (admin-configured)
  requires_website_access BOOLEAN NOT NULL DEFAULT TRUE,
  requires_ga4_access BOOLEAN NOT NULL DEFAULT TRUE,
  requires_google_ads_access BOOLEAN NOT NULL DEFAULT TRUE,
  requires_meta_access BOOLEAN NOT NULL DEFAULT TRUE,
  requires_forms_step BOOLEAN NOT NULL DEFAULT TRUE,
  -- Access & onboarding confirmations (client-provided)
  website_access_provided BOOLEAN NOT NULL DEFAULT FALSE,
  website_access_understood BOOLEAN NOT NULL DEFAULT FALSE,
  ga4_access_provided BOOLEAN NOT NULL DEFAULT FALSE,
  ga4_access_understood BOOLEAN NOT NULL DEFAULT FALSE,
  google_ads_access_provided BOOLEAN NOT NULL DEFAULT FALSE,
  google_ads_access_understood BOOLEAN NOT NULL DEFAULT FALSE,
  meta_access_provided BOOLEAN NOT NULL DEFAULT FALSE,
  meta_access_understood BOOLEAN NOT NULL DEFAULT FALSE,
  website_forms_details_provided BOOLEAN NOT NULL DEFAULT FALSE,
  website_forms_details_understood BOOLEAN NOT NULL DEFAULT FALSE,
  website_forms_uses_third_party BOOLEAN NOT NULL DEFAULT FALSE,
  website_forms_uses_hipaa BOOLEAN NOT NULL DEFAULT FALSE,
  website_forms_connected_crm BOOLEAN NOT NULL DEFAULT FALSE,
  website_forms_custom BOOLEAN NOT NULL DEFAULT FALSE,
  website_forms_notes TEXT,
  monday_board_id TEXT,
  monday_group_id TEXT,
  monday_active_group_id TEXT,
  monday_completed_group_id TEXT,
  client_identifier_value TEXT,
  -- Internal Task Manager board provisioning (columns added via ALTER TABLE after task_workspaces exists)
  account_manager_person_id TEXT,
  ctm_account_number TEXT,
  ctm_api_key TEXT,
  ctm_api_secret TEXT,
  ai_prompt TEXT,
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brand assets per client
CREATE TABLE IF NOT EXISTS brand_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT,
  business_description TEXT,
  primary_brand_colors TEXT,
  logos JSONB NOT NULL DEFAULT '[]',
  style_guides JSONB NOT NULL DEFAULT '[]',
  brand_notes TEXT,
  website_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_assets_user ON brand_assets(user_id);

ALTER TABLE brand_assets ADD COLUMN IF NOT EXISTS primary_brand_colors TEXT;

-- Ensure 1 brand_assets row per user when possible.
-- IMPORTANT: Only create the UNIQUE index if no duplicates already exist, to avoid crashing startup migrations in prod.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM brand_assets
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_assets_user_unique ON brand_assets(user_id)';
  END IF;
END $$;

-- Documents (client + admin uploaded)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  name TEXT,
  url TEXT,
  origin TEXT DEFAULT 'client',
  type TEXT DEFAULT 'client',
  review_status TEXT DEFAULT 'none',
  review_requested_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

-- Shared Documents (admin-uploaded, visible to ALL clients under "Helpful Documents")
CREATE TABLE IF NOT EXISTS shared_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  name TEXT,
  url TEXT NOT NULL,
  description TEXT,
  sort_order INT DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shared_documents_sort ON shared_documents(sort_order, created_at DESC);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  status TEXT NOT NULL DEFAULT 'unread',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);

-- Calls (CTM)
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id TEXT UNIQUE,
  direction TEXT,
  from_number TEXT,
  to_number TEXT,
  started_at TIMESTAMPTZ,
  duration_sec INTEGER,
  score INTEGER,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_logs_user ON call_logs(user_id);

-- Requests/tasks (create items on monday.com)
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  due_date DATE,
  rush BOOLEAN NOT NULL DEFAULT FALSE,
  person_override TEXT,
  monday_item_id TEXT,
  monday_board_id TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);

-- App-wide settings (JSON payloads by key)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Services (user's service offerings for their clients)
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  base_price DECIMAL(10, 2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active Clients (user's customers converted from leads)
CREATE TABLE IF NOT EXISTS active_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  client_name TEXT,
  client_phone TEXT,
  client_email TEXT,
  source TEXT,
  funnel_data JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
-- Ensure user_id exists on databases created before this column was added
ALTER TABLE active_clients ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Client Journey tracking
CREATE TABLE IF NOT EXISTS client_journeys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_call_id UUID REFERENCES call_logs(id) ON DELETE SET NULL,
  lead_call_key TEXT REFERENCES call_logs(call_id) ON DELETE SET NULL,
  active_client_id UUID REFERENCES active_clients(id) ON DELETE SET NULL,
  client_name TEXT,
  client_phone TEXT,
  client_email TEXT,
  symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
  symptoms_redacted BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  next_action_at TIMESTAMPTZ,
  notes_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_client_journeys_owner ON client_journeys(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_client_journeys_status ON client_journeys(status);
CREATE INDEX IF NOT EXISTS idx_client_journeys_lead_call_key ON client_journeys(lead_call_key);

CREATE TABLE IF NOT EXISTS client_journey_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  channel TEXT,
  message TEXT,
  offset_days INTEGER DEFAULT 0,
  offset_weeks INTEGER DEFAULT 0,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_journey_steps_journey ON client_journey_steps(journey_id);

CREATE TABLE IF NOT EXISTS client_journey_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_journey_notes_journey ON client_journey_notes(journey_id);

-- Client Services (junction table with pricing and service history)
CREATE TABLE IF NOT EXISTS client_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  active_client_id UUID NOT NULL REFERENCES active_clients(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  agreed_price DECIMAL(10, 2),
  agreed_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_services_active_client ON client_services(active_client_id);
CREATE INDEX IF NOT EXISTS idx_client_services_service ON client_services(service_id);
CREATE INDEX IF NOT EXISTS idx_client_services_redacted ON client_services(redacted_at);

-- Blog Posts
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_user ON blog_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);

-- Client onboarding tokens
CREATE TABLE IF NOT EXISTS client_onboarding_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_onboarding_tokens_user ON client_onboarding_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_client_onboarding_tokens_token ON client_onboarding_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_client_onboarding_tokens_expires ON client_onboarding_tokens(expires_at);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);

-- ==========================
-- Internal task platform v1
-- ==========================

CREATE TABLE IF NOT EXISTS task_workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_boards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  board_prefix TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_boards_workspace ON task_boards(workspace_id);

CREATE TABLE IF NOT EXISTS task_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_task_groups_board ON task_groups(board_id);

CREATE TABLE IF NOT EXISTS task_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'To Do',
  due_date DATE,
  is_voicemail BOOLEAN NOT NULL DEFAULT FALSE,
  needs_attention BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Status is now a free-form text field to support custom board status labels
);
CREATE INDEX IF NOT EXISTS idx_task_items_group ON task_items(group_id);
CREATE INDEX IF NOT EXISTS idx_task_items_status ON task_items(status);
CREATE INDEX IF NOT EXISTS idx_task_items_due_date ON task_items(due_date);
CREATE INDEX IF NOT EXISTS idx_task_items_created_by ON task_items(created_by);

CREATE TABLE IF NOT EXISTS task_subitems (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'To Do',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Status is now a free-form text field to support custom board status labels
);
CREATE INDEX IF NOT EXISTS idx_task_subitems_parent ON task_subitems(parent_item_id);

CREATE TABLE IF NOT EXISTS task_item_assignees (
  item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_item_assignees_user ON task_item_assignees(user_id);

CREATE TABLE IF NOT EXISTS task_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_updates_item ON task_updates(item_id);
CREATE INDEX IF NOT EXISTS idx_task_updates_created_at ON task_updates(created_at);

CREATE TABLE IF NOT EXISTS task_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID REFERENCES task_items(id) ON DELETE CASCADE,
  update_id UUID REFERENCES task_updates(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_files_item ON task_files(item_id);
CREATE INDEX IF NOT EXISTS idx_task_files_update ON task_files(update_id);

CREATE TABLE IF NOT EXISTS task_time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  time_spent_minutes INTEGER NOT NULL DEFAULT 0,
  billable_minutes INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  work_category TEXT,
  is_billable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_time_billable_minutes_check CHECK (billable_minutes >= 0),
  CONSTRAINT task_time_spent_minutes_check CHECK (time_spent_minutes >= 0)
);
CREATE INDEX IF NOT EXISTS idx_task_time_entries_item ON task_time_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_task_time_entries_user ON task_time_entries(user_id);

-- Automations (v1: board-scoped rules)
CREATE TABLE IF NOT EXISTS task_board_automations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_board_automations_board ON task_board_automations(board_id);
CREATE INDEX IF NOT EXISTS idx_task_board_automations_active ON task_board_automations(is_active);

-- Global automations (apply across all boards)
CREATE TABLE IF NOT EXISTS task_global_automations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_global_automations_active ON task_global_automations(is_active);

-- Automation execution log (audit + dedupe for scheduled triggers)
CREATE TABLE IF NOT EXISTS task_automation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope TEXT NOT NULL, -- 'board' | 'global'
  automation_id UUID NOT NULL,
  board_id UUID REFERENCES task_boards(id) ON DELETE CASCADE,
  item_id UUID REFERENCES task_items(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'success', -- success | error | skipped
  error TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_automation_runs_automation ON task_automation_runs(scope, automation_id);
CREATE INDEX IF NOT EXISTS idx_task_automation_runs_item ON task_automation_runs(item_id);
CREATE INDEX IF NOT EXISTS idx_task_automation_runs_ran_at ON task_automation_runs(ran_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_automation_runs_dedupe
  ON task_automation_runs(scope, automation_id, item_id, trigger_fingerprint)
  WHERE trigger_fingerprint IS NOT NULL;

-- AI summaries (cached)
CREATE TABLE IF NOT EXISTS task_item_ai_summaries (
  item_id UUID PRIMARY KEY REFERENCES task_items(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'vertex',
  model TEXT,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_meta JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_task_item_ai_summaries_generated_at ON task_item_ai_summaries(generated_at);

-- Board status labels (customizable per board)
CREATE TABLE IF NOT EXISTS task_board_status_labels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#808080',
  order_index INTEGER NOT NULL DEFAULT 0,
  is_done_state BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_board_status_labels_board ON task_board_status_labels(board_id);

-- Global status labels (available on all boards)
CREATE TABLE IF NOT EXISTS task_global_status_labels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#808080',
  order_index INTEGER NOT NULL DEFAULT 0,
  is_done_state BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_global_status_labels_order ON task_global_status_labels(order_index);

-- Update view tracking (who saw each update)
CREATE TABLE IF NOT EXISTS task_update_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  update_id UUID NOT NULL REFERENCES task_updates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(update_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_update_views_update ON task_update_views(update_id);
CREATE INDEX IF NOT EXISTS idx_task_update_views_user ON task_update_views(user_id);

-- AI daily overview cache
CREATE TABLE IF NOT EXISTS task_ai_daily_overviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overview_date DATE NOT NULL,
  summary TEXT NOT NULL,
  todo_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending_mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  unanswered_mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT NOT NULL DEFAULT 'vertex',
  model TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, overview_date)
);
CREATE INDEX IF NOT EXISTS idx_task_ai_daily_overviews_user_date ON task_ai_daily_overviews(user_id, overview_date);

-- Idempotent alter helpers
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'client';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ctm_account_number TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ctm_api_key TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ctm_api_secret TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ai_prompt TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS auto_star_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS monthly_revenue_goal DECIMAL(10, 2);
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS call_tracking_main_number TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS front_desk_emails TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS office_admin_name TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS office_admin_email TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS office_admin_phone TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS form_email_recipients TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_access_status TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ga4_access_status TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS google_ads_access_status TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS google_ads_account_id TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS meta_access_status TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_details_status TEXT;
-- Access steps enabled/disabled (admin-configured)
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS requires_website_access BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS requires_ga4_access BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS requires_google_ads_access BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS requires_meta_access BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS requires_forms_step BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS client_type TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS client_subtype TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS client_package TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS looker_url TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS monday_board_id TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS monday_group_id TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS monday_active_group_id TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS monday_completed_group_id TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS client_identifier_value TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS account_manager_person_id TEXT;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_access_provided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_access_understood BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ga4_access_provided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ga4_access_understood BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS google_ads_access_provided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS google_ads_access_understood BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS meta_access_provided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS meta_access_understood BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_details_provided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_details_understood BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_uses_third_party BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_uses_hipaa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_connected_crm BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_custom BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS website_forms_notes TEXT;
-- Type-specific onboarding questionnaire responses (JSONB for flexibility per client type)
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS onboarding_questionnaire JSONB NOT NULL DEFAULT '{}';

-- Client Groups (organizational grouping for admin view)
CREATE TABLE IF NOT EXISTS client_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT, -- Optional color for visual distinction
  icon TEXT, -- Optional MUI icon name (e.g., 'Business', 'Store', 'LocalHospital')
  icon_url TEXT, -- Optional custom uploaded image URL
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_groups_sort ON client_groups(sort_order);
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- Add group reference to client_profiles
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS client_group_id UUID REFERENCES client_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_client_profiles_group ON client_profiles(client_group_id);

-- Remove deprecated per-client OAuth fields (replaced by oauth_* tables)
ALTER TABLE client_profiles DROP COLUMN IF EXISTS google_client_id;
ALTER TABLE client_profiles DROP COLUMN IF EXISTS google_client_secret;

-- OAuth Providers (app-level credentials per platform)
CREATE TABLE IF NOT EXISTS oauth_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'facebook', 'instagram', 'tiktok', 'wordpress')),
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uri TEXT,
  auth_url TEXT,
  token_url TEXT,
  scopes JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_providers_provider ON oauth_providers(provider);

-- OAuth Connections (per client, per provider login)
CREATE TABLE IF NOT EXISTS oauth_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'facebook', 'instagram', 'tiktok', 'wordpress')),
  provider_account_id TEXT NOT NULL,
  provider_account_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_type TEXT,
  scope_granted JSONB NOT NULL DEFAULT '[]',
  expires_at TIMESTAMPTZ,
  is_connected BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ,
  last_error TEXT,
  external_metadata JSONB NOT NULL DEFAULT '{}',
  -- Security recommendations (store encrypted tokens when possible)
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_hash TEXT,
  kms_key_id TEXT,
  last_rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_connections_client ON oauth_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_connections_provider ON oauth_connections(provider);

-- OAuth Resources (pages/locations/profiles under a connection)
CREATE TABLE IF NOT EXISTS oauth_resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oauth_connection_id UUID NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'facebook', 'instagram', 'tiktok', 'wordpress')),
  resource_type TEXT NOT NULL CHECK (
    resource_type IN ('google_location', 'facebook_page', 'instagram_account', 'tiktok_account', 'wordpress_site')
  ),
  resource_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_username TEXT,
  resource_url TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_resources_connection_resource ON oauth_resources(oauth_connection_id, resource_id);
CREATE INDEX IF NOT EXISTS idx_oauth_resources_client ON oauth_resources(client_id);
-- Client onboarding draft (save & continue later)
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS onboarding_draft_json JSONB;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS onboarding_draft_saved_at TIMESTAMPTZ;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS task_workspace_id UUID REFERENCES task_workspaces(id) ON DELETE SET NULL;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS task_board_id UUID REFERENCES task_boards(id) ON DELETE SET NULL;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS board_prefix TEXT;

-- Remove deprecated brand fields (keep website_url)
ALTER TABLE brand_assets DROP COLUMN IF EXISTS website_admin_email;
ALTER TABLE brand_assets DROP COLUMN IF EXISTS ga_emails;
ALTER TABLE brand_assets DROP COLUMN IF EXISTS meta_bm_email;
ALTER TABLE brand_assets DROP COLUMN IF EXISTS social_links;
ALTER TABLE brand_assets DROP COLUMN IF EXISTS pricing_list_url;
ALTER TABLE brand_assets DROP COLUMN IF EXISTS promo_calendar_url;

ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS board_prefix TEXT;

-- Task item/subitem archival (soft delete)
ALTER TABLE task_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE task_items ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_task_items_archived_at ON task_items(archived_at);
CREATE INDEX IF NOT EXISTS idx_task_items_group_archived ON task_items(group_id, archived_at);

ALTER TABLE task_subitems ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE task_subitems ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_task_subitems_archived_at ON task_subitems(archived_at);

ALTER TABLE client_onboarding_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE client_onboarding_tokens ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS task_global_status_labels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#808080',
  order_index INTEGER NOT NULL DEFAULT 0,
  is_done_state BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_global_status_labels_order ON task_global_status_labels(order_index);
ALTER TABLE brand_assets ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE brand_assets ADD COLUMN IF NOT EXISTS business_description TEXT;
ALTER TABLE brand_assets ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Add user_id columns to services and active_clients tables
ALTER TABLE services ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE active_clients ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE active_clients ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE active_clients ADD COLUMN IF NOT EXISTS client_phone TEXT;
ALTER TABLE active_clients ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE active_clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE client_services ADD COLUMN IF NOT EXISTS agreed_date TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE client_journeys ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE client_journeys ADD COLUMN IF NOT EXISTS lead_call_key TEXT;
ALTER TABLE client_journeys ADD COLUMN IF NOT EXISTS symptoms_redacted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_client_journeys_lead_call_key ON client_journeys(lead_call_key);
UPDATE client_journeys cj
SET lead_call_key = cl.call_id
FROM call_logs cl
WHERE cj.lead_call_key IS NULL AND cj.lead_call_id = cl.id;

-- Create indexes AFTER adding columns
CREATE INDEX IF NOT EXISTS idx_services_user ON services(user_id);
CREATE INDEX IF NOT EXISTS idx_active_clients_owner ON active_clients(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_client_services_agreed_date ON client_services(agreed_date);

-- CTM CRM Professional Upgrade - Phase 1: Paginated Incremental Sync
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ctm_sync_cursor TIMESTAMPTZ;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS ctm_last_page_token TEXT;

-- CTM CRM Professional Upgrade - Phase 2: Repeat Caller Detection
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_call_logs_owner_user ON call_logs(owner_user_id);
-- Backfill owner_user_id from user_id for existing records
UPDATE call_logs SET owner_user_id = user_id WHERE owner_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_from_number ON call_logs(from_number);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS caller_type TEXT DEFAULT 'new';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS active_client_id UUID REFERENCES active_clients(id) ON DELETE SET NULL;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS call_sequence INTEGER DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_call_logs_caller_type ON call_logs(caller_type);
CREATE INDEX IF NOT EXISTS idx_call_logs_active_client ON call_logs(active_client_id);

-- CTM CRM Professional Upgrade - Phase 4: Multi-Journey Support
ALTER TABLE client_journeys ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE client_journeys ADD COLUMN IF NOT EXISTS parent_journey_id UUID REFERENCES client_journeys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_client_journeys_service ON client_journeys(service_id);
CREATE INDEX IF NOT EXISTS idx_client_journeys_parent ON client_journeys(parent_journey_id);

-- Full CRM Upgrade - Pipeline Stages
CREATE TABLE IF NOT EXISTS lead_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  position INTEGER NOT NULL DEFAULT 0,
  is_won_stage BOOLEAN NOT NULL DEFAULT FALSE,
  is_lost_stage BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_pipeline_stages_owner ON lead_pipeline_stages(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_pipeline_stages_position ON lead_pipeline_stages(owner_user_id, position);

-- Add pipeline stage to call_logs
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID REFERENCES lead_pipeline_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_call_logs_pipeline_stage ON call_logs(pipeline_stage_id);

-- Full CRM Upgrade - Lead Notes (Communication Log)
CREATE TABLE IF NOT EXISTS lead_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note_type TEXT NOT NULL DEFAULT 'note', -- note, call, email, sms, meeting
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_notes_call ON lead_notes(call_id);
CREATE INDEX IF NOT EXISTS idx_lead_notes_owner ON lead_notes(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_notes_created ON lead_notes(created_at DESC);

-- Full CRM Upgrade - Saved Views
CREATE TABLE IF NOT EXISTS lead_saved_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_saved_views_owner ON lead_saved_views(owner_user_id);

-- Full CRM Upgrade - Lead Tags
CREATE TABLE IF NOT EXISTS lead_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_lead_tags_owner ON lead_tags(owner_user_id);

-- Junction table for call_logs <-> tags
CREATE TABLE IF NOT EXISTS call_log_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id TEXT NOT NULL,
  tag_id UUID NOT NULL REFERENCES lead_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(call_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_call_log_tags_call ON call_log_tags(call_id);
CREATE INDEX IF NOT EXISTS idx_call_log_tags_tag ON call_log_tags(tag_id);

-- Email Logs - Track all emails sent from the application
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  cc_emails TEXT[],
  bcc_emails TEXT[],
  subject TEXT NOT NULL,
  text_body TEXT,
  html_body TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  mailgun_id TEXT,
  mailgun_message TEXT,
  error_message TEXT,
  triggered_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  -- Mailgun tracking events
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  open_count INTEGER NOT NULL DEFAULT 0,
  clicked_at TIMESTAMPTZ,
  click_count INTEGER NOT NULL DEFAULT 0,
  bounced_at TIMESTAMPTZ,
  bounce_type TEXT,
  bounce_code TEXT,
  complained_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  -- Delivery verification (DKIM, DMARC, SPF)
  delivery_status JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_type ON email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_client ON email_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_mailgun_id ON email_logs(mailgun_id);

-- Add tracking columns to existing email_logs table
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS bounce_type TEXT;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS bounce_code TEXT;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS delivery_status JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_email_logs_mailgun_id ON email_logs(mailgun_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_submission ON email_logs((metadata->>'submissionId')) WHERE email_type IN ('ctm_form_submission', 'ctm_form_submission_test');

-- ============================================================================
-- Client Team Management (Multi-user Client Accounts)
-- ============================================================================

-- Junction table linking users to client accounts (for invited team members)
CREATE TABLE IF NOT EXISTS client_account_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'removed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_account_members_unique UNIQUE (client_owner_id, member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_client_account_members_owner ON client_account_members(client_owner_id);
CREATE INDEX IF NOT EXISTS idx_client_account_members_member ON client_account_members(member_user_id);
CREATE INDEX IF NOT EXISTS idx_client_account_members_status ON client_account_members(status);

-- Invitation tokens for client user invites
CREATE TABLE IF NOT EXISTS client_user_invite_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  token_value TEXT, -- For copy-link feature (stored temporarily until consumed)
  invite_email CITEXT NOT NULL,
  invite_first_name TEXT,
  invite_role TEXT NOT NULL DEFAULT 'member',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  resulting_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_user_invite_tokens_owner ON client_user_invite_tokens(client_owner_id);
CREATE INDEX IF NOT EXISTS idx_client_user_invite_tokens_hash ON client_user_invite_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_client_user_invite_tokens_email ON client_user_invite_tokens(invite_email);
CREATE INDEX IF NOT EXISTS idx_client_user_invite_tokens_expires ON client_user_invite_tokens(expires_at);

-- Group-wide access memberships (derived into account access at runtime)
CREATE TABLE IF NOT EXISTS client_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_group_id UUID NOT NULL REFERENCES client_groups(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'admin', 'member'
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'removed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_group_members_unique UNIQUE (client_group_id, member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_client_group_members_group ON client_group_members(client_group_id);
CREATE INDEX IF NOT EXISTS idx_client_group_members_member ON client_group_members(member_user_id);
CREATE INDEX IF NOT EXISTS idx_client_group_members_status ON client_group_members(status);

-- Invitation tokens for group-wide client access
CREATE TABLE IF NOT EXISTS client_group_invite_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_group_id UUID NOT NULL REFERENCES client_groups(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  token_value TEXT, -- For copy-link feature (stored temporarily until consumed)
  invite_email CITEXT NOT NULL,
  invite_first_name TEXT,
  invite_role TEXT NOT NULL DEFAULT 'member',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  resulting_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_group_invite_tokens_group ON client_group_invite_tokens(client_group_id);
CREATE INDEX IF NOT EXISTS idx_client_group_invite_tokens_hash ON client_group_invite_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_client_group_invite_tokens_email ON client_group_invite_tokens(invite_email);
CREATE INDEX IF NOT EXISTS idx_client_group_invite_tokens_expires ON client_group_invite_tokens(expires_at);

-- Backfill: Register existing clients as "owner" of their own account
-- Only for ACTUAL account owners, identified by a positive owner signal:
--   (a) they have brand_assets, OR
--   (b) their client_profiles carries a business name (client_identifier_value), OR
--   (c) they already own an active account (someone is a member of it).
-- This MUST mirror ensureLegacyOwnerMembership() in services/clientAccounts.js.
--
-- Do NOT add a branch like "OR the user is not currently an active member of
-- another account" — that mints a self-owner row for any team member who was
-- removed from all their real accounts, turning them into a phantom standalone
-- client. Because this runs on every startup, it would also recreate that
-- phantom after an admin deletes it. (Root cause of the recurring "team member
-- shows up as its own client account" bug — see maybeRunTeamMemberCleanup.)
INSERT INTO client_account_members (client_owner_id, member_user_id, role, status, accepted_at)
SELECT u.id, u.id, 'owner', 'active', u.created_at
FROM users u
WHERE u.role = 'client'
  AND (
    EXISTS (SELECT 1 FROM brand_assets ba WHERE ba.user_id = u.id)
    OR EXISTS (SELECT 1 FROM client_profiles cp WHERE cp.user_id = u.id AND cp.client_identifier_value IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM client_account_members cam_owner
      WHERE cam_owner.client_owner_id = u.id
        AND cam_owner.status = 'active'
    )
  )
ON CONFLICT (client_owner_id, member_user_id) DO NOTHING;
