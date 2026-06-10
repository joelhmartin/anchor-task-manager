-- Contact Entity — Phase 6 (segmentation foundation). Additive, idempotent.
-- Spec: docs/superpowers/specs/2026-05-22-contact-entity-design.md
--
-- Makes tags first-class ON THE CONTACT (not just on activity), so the eventual UI
-- can search "everyone with tag X" and bulk-segment people. Reuses the existing
-- lead_tags catalog (user tags + system_key system tags). Also adds email-marketing
-- consent fields (mirrors the SMS ones) so compliant bulk email has a home.
--
-- Service-by-contact already works via client_journeys.service_id + contact_id and
-- client_services → active_clients.contact_id, so no table is needed for that.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Contact-level tags. A tag (from lead_tags) applied to a PERSON, with provenance.
CREATE TABLE IF NOT EXISTS contact_tags (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  tag_id        UUID NOT NULL REFERENCES lead_tags(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'user',   -- 'user' (applied in UI) | 'system' (rolled up from activity)
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One row per (contact, tag).
CREATE UNIQUE INDEX IF NOT EXISTS contact_tags_contact_tag_uniq ON contact_tags (contact_id, tag_id);
-- "Everyone with tag X" (owner-scoped segmentation) + per-contact lookup.
CREATE INDEX IF NOT EXISTS idx_contact_tags_owner_tag ON contact_tags (owner_user_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_contact   ON contact_tags (contact_id);
-- Owner-scoped referential integrity (match the contacts pattern): a tag row's owner
-- must equal its contact's owner.
DO $$ BEGIN
  ALTER TABLE contact_tags ADD CONSTRAINT contact_tags_owner_match_fkey
    FOREIGN KEY (contact_id, owner_user_id) REFERENCES contacts(id, owner_user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
-- Owner-scope tag_id too (CodeRabbit): block attaching a lead_tag owned by ANOTHER tenant.
-- The backing UNIQUE must be created BEFORE the composite FK references it, or the FK
-- ADD fails with 42830 on a fresh DB (the same ordering trap the contacts FKs hit).
DO $$ BEGIN
  ALTER TABLE lead_tags ADD CONSTRAINT lead_tags_id_owner_uniq UNIQUE (id, owner_user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE contact_tags ADD CONSTRAINT contact_tags_tag_owner_match_fkey
    FOREIGN KEY (tag_id, owner_user_id) REFERENCES lead_tags(id, owner_user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;

-- Email-marketing consent (CAN-SPAM). Mirrors sms_consent / sms_opted_out.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_opted_out      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_unsubscribed_at TIMESTAMPTZ;
