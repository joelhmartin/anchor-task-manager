-- Client Portal Updates banner (idempotent).
-- portal_updates: agency-authored announcements broadcast to all client users.
-- user_update_dismissals: per-user dismissal state (a row = dismissed).
CREATE TABLE IF NOT EXISTS portal_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'notice',          -- feature | improvement | notice | maintenance
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | published | archived
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_updates_status_published
  ON portal_updates (status, published_at DESC);

-- Enforce the type/status enums at the DB level too (defense in depth — route
-- validation already covers the API, but direct SQL writes shouldn't bypass it).
-- Idempotent: only add the constraint if it isn't already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portal_updates_type_check' AND conrelid = 'portal_updates'::regclass
  ) THEN
    ALTER TABLE portal_updates ADD CONSTRAINT portal_updates_type_check
      CHECK (type IN ('feature', 'improvement', 'notice', 'maintenance'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portal_updates_status_check' AND conrelid = 'portal_updates'::regclass
  ) THEN
    ALTER TABLE portal_updates ADD CONSTRAINT portal_updates_status_check
      CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_update_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  update_id UUID NOT NULL REFERENCES portal_updates(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, update_id)
);
