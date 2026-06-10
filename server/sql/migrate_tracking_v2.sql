-- migrate_tracking_v2.sql
-- Add Bing UET and TikTok Pixel support to tracking configs

ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS bing_uet_id TEXT;
ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS tiktok_pixel_id TEXT;
ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS browser_bing_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS browser_tiktok_enabled BOOLEAN NOT NULL DEFAULT false;
