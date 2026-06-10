-- migrate_contact_services_editable.sql — make contact_services a properly editable ledger.
-- Two idempotent changes:
--   1) Add redacted_at for soft-removal (manual un-link without losing history).
--   2) Widen the source CHECK to allow 'manual' (direct add on a contact), alongside the
--      existing 'journey' / 'active_client' writers.

-- 1) Soft-removal marker — NULL = active, set = removed (hidden from reads).
ALTER TABLE contact_services ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ;

-- 2) Allow source='manual'. Drop-and-recreate the named CHECK so it's idempotent on both
--    fresh DBs (created by migrate_contact_services.sql with the narrow list) and re-runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_services_source_check') THEN
    ALTER TABLE contact_services DROP CONSTRAINT contact_services_source_check;
  END IF;
  ALTER TABLE contact_services
    ADD CONSTRAINT contact_services_source_check
    CHECK (source IN ('journey', 'active_client', 'manual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- benign: constraint already present (concurrent re-run)
END $$;
