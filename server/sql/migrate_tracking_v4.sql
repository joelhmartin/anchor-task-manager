-- Meta campaign allowlist — per-client campaign ownership

CREATE TABLE IF NOT EXISTS tracking_campaign_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('meta', 'google_ads')),
  ad_account_id   TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  campaign_name   TEXT,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (platform, ad_account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS tracking_campaign_claims_user_platform_idx
  ON tracking_campaign_claims (user_id, platform);

CREATE INDEX IF NOT EXISTS tracking_campaign_claims_account_idx
  ON tracking_campaign_claims (platform, ad_account_id);
