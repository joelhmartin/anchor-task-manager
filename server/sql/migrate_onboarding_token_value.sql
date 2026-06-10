-- Migration: Add token_value column to client_onboarding_tokens
-- This allows the "Copy Link" feature to retrieve the active token without generating a new one.
-- The token_hash is still used for validation when the link is accessed.

ALTER TABLE client_onboarding_tokens 
ADD COLUMN IF NOT EXISTS token_value TEXT;

-- Add an index for faster lookups when copying links
CREATE INDEX IF NOT EXISTS idx_onboarding_tokens_active 
ON client_onboarding_tokens (user_id, consumed_at, revoked_at, expires_at) 
WHERE consumed_at IS NULL AND revoked_at IS NULL;

COMMENT ON COLUMN client_onboarding_tokens.token_value IS 'Stored token value for copy link retrieval. Used alongside token_hash which is used for validation.';

