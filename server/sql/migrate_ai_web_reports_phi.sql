-- Migrate report_run_items PHI-bearing columns from JSONB to encrypted TEXT.
-- Existing rows (smoke-test only — branch not yet in production) are dropped
-- because their unencrypted contents cannot be retroactively encrypted safely.
-- Idempotent: detects column type and only alters when still JSONB.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_run_items' AND column_name='data_snapshot' AND data_type='jsonb'
  ) THEN
    ALTER TABLE report_run_items DROP COLUMN data_snapshot;
    ALTER TABLE report_run_items ADD COLUMN data_snapshot TEXT;
  END IF;
END $$;

-- Drop the previously-added flag column if a prior run of this migration created it.
ALTER TABLE report_run_items DROP COLUMN IF EXISTS data_snapshot_encrypted;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_run_items' AND column_name='ai_output' AND data_type='jsonb'
  ) THEN
    ALTER TABLE report_run_items DROP COLUMN ai_output;
    ALTER TABLE report_run_items ADD COLUMN ai_output TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_run_items' AND column_name='rendered_payload' AND data_type='jsonb'
  ) THEN
    ALTER TABLE report_run_items DROP COLUMN rendered_payload;
    ALTER TABLE report_run_items ADD COLUMN rendered_payload TEXT;
  END IF;
END $$;

COMMENT ON COLUMN report_run_items.data_snapshot     IS 'AES-256-GCM encrypted JSON. May contain PHI for medical clients. Encrypt via server/services/security/encryption.js. Never log raw.';
COMMENT ON COLUMN report_run_items.ai_output          IS 'AES-256-GCM encrypted JSON. AI-generated narrative may reference client data; encrypted at rest.';
COMMENT ON COLUMN report_run_items.rendered_payload   IS 'AES-256-GCM encrypted JSON. Read via decrypt() before rendering. Never log raw.';
