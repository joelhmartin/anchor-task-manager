-- Per-client business timezone, used for time-of-day analytics (heat map, etc.).
-- IANA name (e.g. 'America/Chicago'). Existing rows default to America/New_York;
-- admins / clients adjust per-account from the UI.
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
