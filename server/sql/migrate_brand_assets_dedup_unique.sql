-- Dedupe brand_assets so user_id can carry an unconditional UNIQUE index.
--
-- Background:
--   init.sql only created idx_brand_assets_user_unique when no duplicates were
--   present at migration time (the CREATE was guarded by a DO $$ ... HAVING
--   COUNT(*) > 1 $$ block). In any environment where duplicates existed at the
--   moment init.sql first ran, the index was never built, leaving the 1:1
--   contract enforced only at the application layer. That broke clientLabelJoins
--   in subtle ways — see PR #63.
--
-- This migration:
--   1. Archives all losing duplicate rows into brand_assets_dedup_archive so
--      the operation is reversible.
--   2. Deletes losers; per user_id we keep the row with the most recent
--      updated_at, tie-broken by id DESC.
--   3. Creates idx_brand_assets_user_unique unconditionally.
--
-- Idempotent: on subsequent runs, no duplicates exist, nothing is archived,
-- nothing is deleted, and the index creation is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS brand_assets_dedup_archive (
  archive_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL DEFAULT 'brand_assets_user_unique_2026_05',
  original_row JSONB NOT NULL
);

WITH losers AS (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY user_id
             ORDER BY updated_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM brand_assets
  ) ranked
  WHERE rn > 1
),
archived AS (
  INSERT INTO brand_assets_dedup_archive (original_row)
  SELECT to_jsonb(b.*)
  FROM brand_assets b
  JOIN losers ON losers.id = b.id
  RETURNING (original_row->>'id')::uuid AS id
)
DELETE FROM brand_assets
WHERE id IN (SELECT id FROM archived);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_assets_user_unique
  ON brand_assets(user_id);

COMMIT;
