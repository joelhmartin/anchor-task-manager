-- Migration: Fix onboarding tokens that were incorrectly revoked
--
-- Previously, when a user started onboarding (activated their account),
-- ALL tokens were revoked immediately. This caused the admin UI to show
-- "No Link" even though the user was still mid-onboarding.
--
-- This migration converts those revoked tokens to "consumed" status for
-- users who started onboarding but haven't completed it yet.

-- Convert revoked tokens to consumed for users who:
-- 1. Have a revoked token (revoked_at IS NOT NULL)
-- 2. Don't have consumed_at set yet
-- 3. Are clients (role = 'client')
-- 4. Haven't completed onboarding (onboarding_completed_at IS NULL in client_profiles)
-- 5. Have set a password (meaning they went through activation)
UPDATE client_onboarding_tokens t
SET consumed_at = revoked_at, revoked_at = NULL
FROM users u
LEFT JOIN client_profiles cp ON cp.user_id = u.id
WHERE t.user_id = u.id
  AND t.revoked_at IS NOT NULL
  AND t.consumed_at IS NULL
  AND u.role = 'client'
  AND cp.onboarding_completed_at IS NULL
  AND u.password_hash IS NOT NULL;
