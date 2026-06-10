ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS account_manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
