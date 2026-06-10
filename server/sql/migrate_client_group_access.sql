CREATE TABLE IF NOT EXISTS client_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_group_id UUID NOT NULL REFERENCES client_groups(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_group_members_unique UNIQUE (client_group_id, member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_group_members_group ON client_group_members(client_group_id);
CREATE INDEX IF NOT EXISTS idx_client_group_members_member ON client_group_members(member_user_id);
CREATE INDEX IF NOT EXISTS idx_client_group_members_status ON client_group_members(status);

CREATE TABLE IF NOT EXISTS client_group_invite_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_group_id UUID NOT NULL REFERENCES client_groups(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  token_value TEXT,
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
