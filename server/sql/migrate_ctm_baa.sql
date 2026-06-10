-- Migration: add CTM BAA confirmed flag to client_profiles
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS ctm_baa_confirmed BOOLEAN DEFAULT FALSE;
