-- Lead Journey Redesign — schema + safe one-time carry-over.
-- Idempotent: schema parts use IF NOT EXISTS; the data block self-guards on an
-- app_settings sentinel so it runs exactly once even across reboots/replicas.

-- ── Schema (idempotent) ───────────────────────────────────────────────
ALTER TABLE client_journeys
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE active_clients
  ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS journey_email_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  subject       TEXT,
  body          TEXT,
  body_format   TEXT NOT NULL DEFAULT 'html' CHECK (body_format IN ('html','text')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_journey_email_templates_owner
  ON journey_email_templates(owner_user_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS client_journey_activities (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id    UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('email','call','text','note','stage_change')),
  stage_at      TEXT,
  to_stage      TEXT,
  subject       TEXT,
  body          TEXT,
  body_format   TEXT DEFAULT 'text' CHECK (body_format IN ('html','text')),
  template_id   UUID REFERENCES journey_email_templates(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,
  email_status  TEXT,            -- scheduled | sent | failed | canceled | skipped
  email_error   TEXT,
  send_attempts INTEGER NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_journey_activities_journey
  ON client_journey_activities(journey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_activities_due
  ON client_journey_activities(scheduled_for)
  WHERE email_status = 'scheduled';

-- ── Data carry-over (runs exactly once; sentinel-guarded, transactional) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'migration:lead_journey_redesign_v1') THEN
    RETURN;
  END IF;

  -- (a) Map each existing journey to the new stage/status.
  WITH progress AS (
    SELECT j.id AS journey_id,
           COUNT(s.id) FILTER (WHERE s.completed_at IS NOT NULL) AS completed_steps
    FROM client_journeys j
    LEFT JOIN client_journey_steps s ON s.journey_id = j.id
    GROUP BY j.id
  )
  UPDATE client_journeys j
  SET
    status = CASE
      WHEN j.archived_at IS NOT NULL                                            THEN 'archived'
      WHEN j.active_client_id IS NOT NULL OR j.status IN ('active_client','won') THEN 'converted'
      WHEN j.status = 'lost'                                                    THEN 'archived'
      ELSE 'active'
    END,
    stage = CASE
      WHEN j.archived_at IS NOT NULL
        OR j.active_client_id IS NOT NULL
        OR j.status IN ('active_client','won','lost')                          THEN NULL
      ELSE (ARRAY['first_touch','second_touch','third_touch','fourth_touch','awaiting_decision'])
             [LEAST(p.completed_steps, 4) + 1]
    END,
    archived_at = CASE WHEN j.status = 'lost' AND j.archived_at IS NULL THEN NOW() ELSE j.archived_at END,
    next_action_at = NULL
  FROM progress p
  WHERE p.journey_id = j.id;

  -- (b) Copy history into activities with removable provenance.
  INSERT INTO client_journey_activities (journey_id, owner_user_id, type, body, created_by, created_at, metadata)
  SELECT n.journey_id, j.owner_user_id, 'note', n.body, n.author_id, n.created_at,
         '{"source":"journey_redesign_migration"}'::jsonb
  FROM client_journey_notes n JOIN client_journeys j ON j.id = n.journey_id;

  INSERT INTO client_journey_activities (journey_id, owner_user_id, type, subject, body, body_format, email_status, created_at, metadata)
  SELECT s.journey_id, j.owner_user_id, 'email', s.email_subject, s.email_body,
         COALESCE(s.email_body_format,'text'), 'sent', s.email_sent_at,
         '{"source":"journey_redesign_migration"}'::jsonb
  FROM client_journey_steps s JOIN client_journeys j ON j.id = s.journey_id
  WHERE s.email_sent_at IS NOT NULL;

  INSERT INTO client_journey_activities (journey_id, owner_user_id, type, body, created_at, metadata)
  SELECT s.journey_id, j.owner_user_id, 'note', s.notes, s.created_at,
         '{"source":"journey_redesign_migration"}'::jsonb
  FROM client_journey_steps s JOIN client_journeys j ON j.id = s.journey_id
  WHERE s.notes IS NOT NULL AND btrim(s.notes) <> '';

  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('migration:lead_journey_redesign_v1', 'true'::jsonb, NOW())
  ON CONFLICT (key) DO NOTHING;
END $$;
