-- Contact Entity — Phase 1 (foundation). Additive, idempotent, ZERO behavior change.
-- Spec: docs/superpowers/specs/2026-05-22-contact-entity-design.md (§4, §10 decisions).
--
-- Introduces a first-class `contacts` entity (one row per person, per owner/client)
-- plus multi-value identity tables and a merge-candidate review queue, and adds
-- nullable `contact_id` FKs on the activity/journey/client tables. Nothing READS
-- contact_id yet — the resolveContact() chokepoint (server/services/contacts.js)
-- populates it going forward. Historical backfill is a separate phase (Cloud Run Job).
--
-- §10 decisions baked in here:
--   Q1  one contact per (owner, phone)  -> UNIQUE(owner_user_id, phone_digits10)
--   Q2  phone primary + email secondary -> UNIQUE(owner_user_id, email) on CITEXT
--   Q4  capture conflicts only (no UI)  -> contact_merge_candidates

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

-- §4.1 — one row per person, per owner (owner_user_id = Anchor's client, e.g. a practice)
CREATE TABLE IF NOT EXISTS contacts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name     TEXT,
  first_name       TEXT,
  last_name        TEXT,
  primary_phone    TEXT,
  primary_email    TEXT,
  lifecycle_state  TEXT,           -- derived/cached later (§6); unused in Phase 1
  sms_consent      BOOLEAN NOT NULL DEFAULT false,
  sms_opted_out    BOOLEAN NOT NULL DEFAULT false,
  tags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- "any and all contact info"
  first_seen_at    TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_lifecycle ON contacts (owner_user_id, lifecycle_state);

-- §4.2 — multi-value identity. Separate rows (not JSONB arrays) so the unique
-- indexes give O(1) matching and prevent two contacts claiming the same identifier.
CREATE TABLE IF NOT EXISTS contact_phones (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id     UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL,        -- denormalized for the unique index + scoping
  phone_digits10 TEXT NOT NULL,        -- last 10 digits — the match key
  phone_e164     TEXT,
  is_primary     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Q1: a phone maps to exactly one contact per owner.
CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_owner_digits_uniq
  ON contact_phones (owner_user_id, phone_digits10);
CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones (contact_id);

CREATE TABLE IF NOT EXISTS contact_emails (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id     UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL,
  email          CITEXT NOT NULL,      -- case-insensitive match key
  is_primary     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Q2: an email maps to exactly one contact per owner.
CREATE UNIQUE INDEX IF NOT EXISTS contact_emails_owner_email_uniq
  ON contact_emails (owner_user_id, email);
CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON contact_emails (contact_id);

-- §5 / Q4 — phone↔email conflicts are NEVER auto-merged; they land here for human
-- review. v1 only captures rows; the merge/split admin UI is Phase 4.
CREATE TABLE IF NOT EXISTS contact_merge_candidates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id_keep  UUID REFERENCES contacts(id) ON DELETE CASCADE,   -- the phone match (winner)
  contact_id_other UUID REFERENCES contacts(id) ON DELETE CASCADE,   -- the email match (other)
  reason           TEXT NOT NULL DEFAULT 'phone_email_conflict',
  detail           JSONB NOT NULL DEFAULT '{}'::jsonb,               -- triggering phone/email/name
  status           TEXT NOT NULL DEFAULT 'pending',                  -- pending | merged | dismissed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_merge_candidates_owner_status
  ON contact_merge_candidates (owner_user_id, status);
-- Don't pile up duplicate pending rows for the same pair (used by ON CONFLICT in resolveContact).
CREATE UNIQUE INDEX IF NOT EXISTS contact_merge_candidates_pending_pair_uniq
  ON contact_merge_candidates (owner_user_id, contact_id_keep, contact_id_other)
  WHERE status = 'pending';

-- §4.3 — nullable contact_id columns on existing tables (additive; ON DELETE SET NULL
-- so removing a contact never deletes activity/journey/client history).
-- The COLUMN is added without the FK first, then the FK is attached idempotently below
-- (a separate ADD CONSTRAINT so it lands even if the column already existed). Ingest is
-- safe before this runs because INSERTs omit the contact_id column until the schema
-- probe reports ready (see contactIdInsert in services/contacts.js).
ALTER TABLE call_logs       ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE client_journeys ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE active_clients  ADD COLUMN IF NOT EXISTS contact_id UUID;
DO $$ BEGIN
  ALTER TABLE call_logs       ADD CONSTRAINT call_logs_contact_id_fkey       FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE client_journeys ADD CONSTRAINT client_journeys_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE active_clients  ADD CONSTRAINT active_clients_contact_id_fkey  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_call_logs_contact       ON call_logs (contact_id);
CREATE INDEX IF NOT EXISTS idx_client_journeys_contact ON client_journeys (contact_id);
CREATE INDEX IF NOT EXISTS idx_active_clients_contact  ON active_clients (contact_id);

-- R5 (owner-scoped referential integrity): guarantee a child identity row's
-- owner_user_id always matches its parent contact's owner — blocks cross-owner
-- contact links. Composite FK requires a (id, owner_user_id) unique key on contacts.
DO $$ BEGIN
  ALTER TABLE contacts ADD CONSTRAINT contacts_id_owner_uniq UNIQUE (id, owner_user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE contact_phones ADD CONSTRAINT contact_phones_owner_match_fkey
    FOREIGN KEY (contact_id, owner_user_id) REFERENCES contacts(id, owner_user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE contact_emails ADD CONSTRAINT contact_emails_owner_match_fkey
    FOREIGN KEY (contact_id, owner_user_id) REFERENCES contacts(id, owner_user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
-- N3: same owner-scoped integrity for the merge-candidate queue, so a pending pair can
-- never reference contacts from a different owner (tenant isolation in the queue).
DO $$ BEGIN
  ALTER TABLE contact_merge_candidates ADD CONSTRAINT contact_merge_candidates_keep_owner_fkey
    FOREIGN KEY (contact_id_keep, owner_user_id) REFERENCES contacts(id, owner_user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE contact_merge_candidates ADD CONSTRAINT contact_merge_candidates_other_owner_fkey
    FOREIGN KEY (contact_id_other, owner_user_id) REFERENCES contacts(id, owner_user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;

-- C5 (CodeRabbit): owner-scoped integrity on the STAMPED contact_id columns too — a
-- call / journey / active-client may only point at a contact owned by the SAME user.
-- MUST come AFTER contacts_id_owner_uniq above: these composite FKs reference
-- contacts(id, owner_user_id), so the UNIQUE backing that key has to exist first or the
-- ADD CONSTRAINT fails with 42830 (no matching unique key) on a fresh DB and rolls back
-- the whole migration. They coexist with the single-column ON DELETE SET NULL FKs (which
-- null ONLY contact_id when a contact is removed). Deliberately NOT "ON DELETE SET NULL"
-- (that would also null owner_user_id) — default NO ACTION, DEFERRABLE INITIALLY DEFERRED
-- so the single-column SET NULL fires first and the deferred owner check passes at COMMIT
-- (contact deletion / the admin merge never break). NOT VALID: enforce new + updated rows
-- only, never block the migration on legacy data (contact_id is freshly added + all-NULL
-- here; resolveContact only stamps owner-matched ids). MATCH SIMPLE skips rows where
-- either column is NULL, so unstamped / owner-less rows are unaffected.
DO $$ BEGIN
  ALTER TABLE call_logs ADD CONSTRAINT call_logs_contact_owner_fkey
    FOREIGN KEY (contact_id, owner_user_id) REFERENCES contacts(id, owner_user_id)
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE client_journeys ADD CONSTRAINT client_journeys_contact_owner_fkey
    FOREIGN KEY (contact_id, owner_user_id) REFERENCES contacts(id, owner_user_id)
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE active_clients ADD CONSTRAINT active_clients_contact_owner_fkey
    FOREIGN KEY (contact_id, owner_user_id) REFERENCES contacts(id, owner_user_id)
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
