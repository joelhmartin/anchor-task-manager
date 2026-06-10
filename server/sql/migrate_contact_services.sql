-- migrate_contact_services.sql — append-only ledger of services a contact was interested in.
-- One row per (journey-start | agree-to-service) event × service, with a name snapshot.
CREATE TABLE IF NOT EXISTS contact_services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name  TEXT,                       -- snapshot at append time (stable if catalog changes)
  source        TEXT NOT NULL,              -- 'journey' | 'active_client'
  source_ref_id UUID,                       -- originating client_journeys.id or active_clients.id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_services_contact ON contact_services(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_services_owner   ON contact_services(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_services_service ON contact_services(service_id);

-- Constrain `source` to the documented values. Added via a guarded named-constraint
-- ALTER (not inline) so it is idempotent on both fresh DBs and an already-created table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_services_source_check') THEN
    ALTER TABLE contact_services
      ADD CONSTRAINT contact_services_source_check CHECK (source IN ('journey', 'active_client'));
  END IF;
END $$;
