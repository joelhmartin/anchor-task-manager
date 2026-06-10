-- migrate_tracking_v3.sql
-- Tracking wizard: add ad account ID and conversion mappings

ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT;
ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS conversion_mappings JSONB NOT NULL DEFAULT '{}'::jsonb;
