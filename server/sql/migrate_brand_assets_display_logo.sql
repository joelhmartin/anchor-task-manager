-- Brand Assets Display Logo
-- Adds a single email-safe logo (PNG/JPG) per client, stored in file_uploads.
-- Distinct from the existing `logos` JSONB array (which holds the multi-file
-- brand-asset uploads from the onboarding wizard / BrandTab).
--
-- Idempotent: safe to re-run.

ALTER TABLE brand_assets
  ADD COLUMN IF NOT EXISTS display_logo_file_id UUID
  REFERENCES file_uploads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brand_assets_display_logo_file
  ON brand_assets(display_logo_file_id)
  WHERE display_logo_file_id IS NOT NULL;
