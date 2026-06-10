-- ============================================================================
-- Migration: Add WordPress support to OAuth tables
-- ============================================================================
-- This migration adds WordPress as a supported OAuth provider and wordpress_site
-- as a resource type for managing blog posts on WordPress sites.
--
-- Run:
--   psql "$DATABASE_URL" -f server/sql/migrate_wordpress_oauth.sql
-- ============================================================================

BEGIN;

-- Update oauth_providers provider constraint to include wordpress
ALTER TABLE oauth_providers DROP CONSTRAINT IF EXISTS oauth_providers_provider_check;

ALTER TABLE oauth_providers ADD CONSTRAINT oauth_providers_provider_check 
  CHECK (provider IN ('google', 'facebook', 'instagram', 'tiktok', 'wordpress'));

-- Update oauth_connections provider constraint to include wordpress
ALTER TABLE oauth_connections DROP CONSTRAINT IF EXISTS oauth_connections_provider_check;

ALTER TABLE oauth_connections ADD CONSTRAINT oauth_connections_provider_check 
  CHECK (provider IN ('google', 'facebook', 'instagram', 'tiktok', 'wordpress'));

-- Update oauth_resources provider constraint to include wordpress
ALTER TABLE oauth_resources DROP CONSTRAINT IF EXISTS oauth_resources_provider_check;

ALTER TABLE oauth_resources ADD CONSTRAINT oauth_resources_provider_check 
  CHECK (provider IN ('google', 'facebook', 'instagram', 'tiktok', 'wordpress'));

-- Update oauth_resources resource_type constraint to include wordpress_site
ALTER TABLE oauth_resources DROP CONSTRAINT IF EXISTS oauth_resources_resource_type_check;

ALTER TABLE oauth_resources ADD CONSTRAINT oauth_resources_resource_type_check 
  CHECK (resource_type IN ('google_location', 'facebook_page', 'instagram_account', 'tiktok_account', 'wordpress_site'));

COMMIT;

-- ============================================================================
-- Verification queries (run manually to verify the migration)
-- ============================================================================
-- SELECT conname, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'oauth_connections'::regclass AND contype = 'c';
--
-- SELECT conname, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'oauth_resources'::regclass AND contype = 'c';

