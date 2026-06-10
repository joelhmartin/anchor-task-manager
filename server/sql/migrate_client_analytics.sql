-- Add per-client analytics defaults (trickle-down to CTM forms)
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS analytics_defaults JSONB;
