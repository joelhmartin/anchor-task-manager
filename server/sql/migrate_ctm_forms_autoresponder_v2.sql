-- CTM Forms autoresponder v2: add preheader + body format, drop from_name
-- (from_name was deprecated in favor of using the client's brand_assets business name).
-- Idempotent.

ALTER TABLE ctm_forms
  ADD COLUMN IF NOT EXISTS autoresponder_preheader TEXT,
  ADD COLUMN IF NOT EXISTS autoresponder_body_format TEXT NOT NULL DEFAULT 'text';

-- Keep autoresponder_from_name column intact (no-op) so existing data isn't lost,
-- but the UI no longer surfaces it. It's still respected as a fallback by the
-- send pipeline if set.
