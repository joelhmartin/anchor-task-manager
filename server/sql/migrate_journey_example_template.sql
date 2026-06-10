-- Seed one read-to-edit example journey email template for every client owner so
-- the "Email Templates" tab is never empty and clients can see what's possible.
--
-- Idempotent + non-resurrecting:
--   * created_by IS NULL is the system-seed marker (user-created rows always carry
--     created_by = the creating user, set in routes/hub.js POST handler).
--   * The NOT EXISTS guard counts archived rows too, so once a client deletes the
--     example (soft delete -> archived_at), re-running this migration will NOT
--     recreate it.
--   * The partial unique index blocks a race from inserting two active examples
--     for the same owner (e.g. concurrent first-load lazy-ensure calls in hub.js).

-- At most one active system-seeded template per owner (race guard for lazy-ensure).
CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_email_templates_owner_system
  ON journey_email_templates (owner_user_id)
  WHERE created_by IS NULL AND archived_at IS NULL;

INSERT INTO journey_email_templates
  (owner_user_id, name, subject, body, body_format, preheader, created_by)
SELECT
  cp.user_id,
  'Checking In (example)',
  'Greetings from {{business_name}}',
  '<p>Hi {{first_name}}, we''re checking to see if there''s anything we can do to assist you. We''re happy to help at any time — please call us back at {{phone}} or email us at {{email}}.</p>',
  'html',
  'Just checking in',
  NULL
FROM client_profiles cp
WHERE NOT EXISTS (
  SELECT 1 FROM journey_email_templates t
   WHERE t.owner_user_id = cp.user_id
     AND t.created_by IS NULL
     AND t.name = 'Checking In (example)'
)
-- The name-scoped NOT EXISTS above does NOT cover the partial unique index, which is
-- name-agnostic (one active system row per owner). If an owner already has a system row
-- under a DIFFERENT name (e.g. hub.js lazy-ensure), this INSERT would collide and throw
-- a duplicate-key error — which previously rethrew and broke the whole migration chain,
-- skipping every migration after this one. DO NOTHING on that index makes it idempotent.
ON CONFLICT (owner_user_id) WHERE created_by IS NULL AND archived_at IS NULL
DO NOTHING;
