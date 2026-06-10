-- =============================================================================
-- SECURITY MIGRATION - Session Management, MFA, Audit Logging
-- =============================================================================
-- Run this migration to add security infrastructure for:
-- - Short-lived access tokens + rotating refresh tokens
-- - Session tracking with device fingerprinting
-- - MFA (email OTP initially, TOTP/WebAuthn ready)
-- - Security audit logging
-- - Rate limiting
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. USER SESSIONS - Refresh token management with rotation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Refresh token (hashed for security)
  refresh_token_hash TEXT NOT NULL,
  refresh_token_family UUID NOT NULL,  -- Token family for reuse detection
  
  -- Device identification
  device_id UUID NOT NULL,
  device_fingerprint TEXT,
  device_name TEXT,
  is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  trusted_until TIMESTAMPTZ,
  
  -- Location & context
  ip_address INET,
  user_agent TEXT,
  country_code CHAR(2),
  city TEXT,
  
  -- Lifecycle timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  absolute_expiry_at TIMESTAMPTZ NOT NULL,  -- Hard limit (90 days from creation)
  refresh_expiry_at TIMESTAMPTZ NOT NULL,   -- Sliding window (30 days from last refresh)
  
  -- Revocation
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,  -- 'logout', 'password_change', 'mfa_change', 'admin_revoke', 'reuse_detected', 'suspicious'
  
  CONSTRAINT user_sessions_refresh_token_unique UNIQUE (refresh_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_device ON user_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_family ON user_sessions(refresh_token_family);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(refresh_expiry_at) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. TRUSTED DEVICES - For skipping MFA on known devices
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_trusted_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- 30 days from trust
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  
  CONSTRAINT user_trusted_devices_unique UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON user_trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_active ON user_trusted_devices(user_id) 
  WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. MFA SETTINGS - Per-user MFA configuration
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_mfa_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  
  -- Email OTP (default for email/password users)
  email_otp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- TOTP authenticator app (future)
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret_encrypted TEXT,
  totp_backup_codes_encrypted TEXT,
  
  -- WebAuthn security keys (future)
  webauthn_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Preferences
  preferred_method TEXT DEFAULT 'email',  -- 'email', 'totp', 'webauthn'
  require_mfa_always BOOLEAN NOT NULL DEFAULT FALSE,  -- Admin can enforce
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. MFA CHALLENGES - Pending MFA verifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
  
  challenge_type TEXT NOT NULL,  -- 'email_otp', 'totp', 'webauthn'
  
  -- For email OTP (hashed)
  otp_hash TEXT,
  
  -- State tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  
  -- Why MFA was triggered
  trigger_reason TEXT,  -- 'new_device', 'new_ip', 'new_country', 'inactivity', 'sensitive_action', 'always_required'
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_pending ON mfa_challenges(user_id, expires_at) 
  WHERE verified_at IS NULL;

-- -----------------------------------------------------------------------------
-- 5. OAUTH IDENTITIES - For Google/Microsoft login
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_oauth_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  provider TEXT NOT NULL,  -- 'google', 'microsoft'
  provider_user_id TEXT NOT NULL,
  provider_email TEXT NOT NULL,
  provider_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  provider_name TEXT,
  provider_picture TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  
  CONSTRAINT user_oauth_identities_provider_unique UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON user_oauth_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_lookup ON user_oauth_identities(provider, provider_email);

-- -----------------------------------------------------------------------------
-- 6. SECURITY AUDIT LOG - Immutable event log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor information
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID,
  
  -- Event classification
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,  -- 'authentication', 'session', 'mfa', 'account', 'access'
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  country_code CHAR(2),
  device_id UUID,
  
  -- Event details (NEVER include passwords, tokens, or secrets)
  details JSONB NOT NULL DEFAULT '{}',
  
  -- Outcome
  success BOOLEAN NOT NULL,
  failure_reason TEXT,
  
  -- Immutable timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON security_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON security_audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON security_audit_log(event_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON security_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_session ON security_audit_log(session_id) WHERE session_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. RATE LIMITING - Track attempts for throttling
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Identifier (hashed IP, user_id, or combination)
  limit_key TEXT NOT NULL,
  limit_type TEXT NOT NULL,  -- 'login_ip', 'login_user', 'mfa_user', 'password_reset_ip'
  
  -- Tracking
  attempts INTEGER NOT NULL DEFAULT 1,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Lockout state
  locked_until TIMESTAMPTZ,
  
  CONSTRAINT auth_rate_limits_unique UNIQUE (limit_key, limit_type)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON auth_rate_limits(limit_key, limit_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_locked ON auth_rate_limits(locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON auth_rate_limits(last_attempt_at);

-- -----------------------------------------------------------------------------
-- 8. EMAIL VERIFICATION TOKENS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,  -- The email being verified (in case user changes it)
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id);

-- -----------------------------------------------------------------------------
-- 9. EXTEND USERS TABLE - Add security columns
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local';

-- Backfill existing users: assume pre-existing accounts are verified
-- (they were created before email verification was required)
UPDATE users SET email_verified_at = COALESCE(created_at, NOW())
WHERE email_verified_at IS NULL;

-- Make password_hash nullable for OAuth-only users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Index for lockout checks
CREATE INDEX IF NOT EXISTS idx_users_locked ON users(locked_until) WHERE locked_until IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 10. CLEANUP FUNCTIONS - Scheduled maintenance
-- -----------------------------------------------------------------------------

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM user_sessions
    WHERE revoked_at IS NOT NULL 
       OR refresh_expiry_at < NOW()
       OR absolute_expiry_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired rate limit records
CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM auth_rate_limits
    WHERE last_attempt_at < NOW() - INTERVAL '24 hours'
      AND (locked_until IS NULL OR locked_until < NOW())
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired MFA challenges
CREATE OR REPLACE FUNCTION cleanup_expired_mfa_challenges() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM mfa_challenges
    WHERE expires_at < NOW() - INTERVAL '1 hour'
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old audit logs (retain 1 year by default)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(retention_days INTEGER DEFAULT 365) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM security_audit_log
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 11. REVOKE ALL USER SESSIONS - Utility function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revoke_all_user_sessions(
  p_user_id UUID,
  p_reason TEXT DEFAULT 'admin_revoke',
  p_except_session_id UUID DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  revoked_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE user_sessions
    SET revoked_at = NOW(),
        revoked_reason = p_reason
    WHERE user_id = p_user_id
      AND revoked_at IS NULL
      AND (p_except_session_id IS NULL OR id != p_except_session_id)
    RETURNING id
  )
  SELECT COUNT(*) INTO revoked_count FROM updated;
  RETURN revoked_count;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- MIGRATION COMPLETE
-- -----------------------------------------------------------------------------
-- Next steps:
-- 1. Deploy application code that uses these tables
-- 2. Set up scheduled job to call cleanup functions daily
-- 3. Configure audit log retention policy
-- =============================================================================

