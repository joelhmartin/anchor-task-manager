-- migrate_lead_notes_contact_unify.sql
-- Unifies notes onto lead_notes as the contact-level spine.
-- 1. Adds lead_notes.contact_id (+ owner/contact/created index).
-- 2. Backfills contact_id from the matching call_log (owner-scoped).
-- 3. Amalgamates (COPIES) journey notes + journey "note" activities into
--    lead_notes, keyed by the journey's contact. Originals are NOT deleted.
-- Idempotent: re-running inserts 0 duplicates via a metadata source marker.

-- 1. New column + index ------------------------------------------------------
ALTER TABLE lead_notes
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_notes_contact
  ON lead_notes (owner_user_id, contact_id, created_at DESC);

-- 2. Backfill contact_id from the matching call_log (owner-scoped) ------------
UPDATE lead_notes ln
   SET contact_id = cl.contact_id
  FROM call_logs cl
 WHERE ln.contact_id IS NULL
   AND cl.contact_id IS NOT NULL
   AND ln.call_id = cl.call_id
   AND (cl.owner_user_id = ln.owner_user_id OR cl.user_id = ln.owner_user_id);

-- 2b. Concurrency-safe idempotency guard -------------------------------------
--     server/index.js can fan out concurrent startup runners; the WHERE NOT EXISTS
--     checks below are not atomic across sessions. A partial unique index on the
--     source marker lets the amalgamation INSERTs fall back to ON CONFLICT DO NOTHING
--     so two racing runners can never double-insert the same journey note.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_notes_journey_source
  ON lead_notes ((metadata->>'source'), (metadata->>'source_id'))
  WHERE metadata->>'source_id' IS NOT NULL;

-- 3a. Amalgamate client_journey_notes ---------------------------------------
--     call_id is NOT NULL on lead_notes (no CHECK) -> '' sentinel for
--     journey-sourced notes; contact_id is the meaningful linkage. Only copy
--     when the journey actually has a contact — a NULL contact_id would produce an
--     unreachable row (call_id='' + contact_id=NULL); the original is kept either way.
INSERT INTO lead_notes (owner_user_id, call_id, author_id, note_type, body, metadata, contact_id, created_at)
SELECT j.owner_user_id,
       '',
       cjn.author_id,
       'note',
       cjn.body,
       jsonb_build_object('source', 'journey_note', 'source_id', cjn.id::text),
       j.contact_id,
       cjn.created_at
  FROM client_journey_notes cjn
  JOIN client_journeys j ON j.id = cjn.journey_id
 WHERE j.owner_user_id IS NOT NULL
   AND j.contact_id IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM lead_notes ln
         WHERE ln.metadata->>'source' = 'journey_note'
           AND ln.metadata->>'source_id' = cjn.id::text
       )
ON CONFLICT DO NOTHING;

-- 3b. Amalgamate client_journey_activities (type='note') ---------------------
--     Note text lives in the `body` column; author is `created_by`.
INSERT INTO lead_notes (owner_user_id, call_id, author_id, note_type, body, metadata, contact_id, created_at)
SELECT j.owner_user_id,
       '',
       cja.created_by,
       'note',
       cja.body,
       jsonb_build_object('source', 'journey_activity_note', 'source_id', cja.id::text),
       j.contact_id,
       cja.created_at
  FROM client_journey_activities cja
  JOIN client_journeys j ON j.id = cja.journey_id
 WHERE cja.type = 'note'
   AND cja.body IS NOT NULL
   AND cja.body <> ''
   AND j.owner_user_id IS NOT NULL
   AND j.contact_id IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM lead_notes ln
         WHERE ln.metadata->>'source' = 'journey_activity_note'
           AND ln.metadata->>'source_id' = cja.id::text
       )
ON CONFLICT DO NOTHING;
