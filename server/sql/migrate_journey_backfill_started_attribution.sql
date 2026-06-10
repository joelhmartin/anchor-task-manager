-- Journey backfill: "started" activity + best-effort attribution for journeys
-- created before the lead-journey redesign.
--
-- The redesign migration (migrate_lead_journey_redesign.sql) backfilled stage +
-- carried over notes/emails, but left two gaps for pre-existing journeys:
--   1. created_by is NULL (the column is new; the actor who started old journeys
--      was never recorded).
--   2. There is no initial "started" stage_change activity, so the Activity tab
--      shows no beginning for old journeys.
--
-- Both statements are idempotent (NULL-guard / NOT EXISTS), so this file is safe
-- to run on every server start without a sentinel.

-- (1) Best-effort attribution: assume the journey owner started it.
--     Only fills NULLs, so it never overwrites a real recorded actor and only
--     ever touches pre-redesign rows (new journeys set created_by at insert).
UPDATE client_journeys
SET created_by = owner_user_id
WHERE created_by IS NULL
  AND owner_user_id IS NOT NULL;

-- (2) Synthetic "started" event for any journey missing one.
--     Dated at created_at so it sorts to the start of the timeline. Marked as
--     backfilled + inferred so it is distinguishable in the audit trail and
--     removable later. New journeys already record this event at creation
--     (metadata.event='started'), so NOT EXISTS skips them.
INSERT INTO client_journey_activities
  (journey_id, owner_user_id, type, stage_at, to_stage, created_by, created_at, metadata)
SELECT
  j.id,
  j.owner_user_id,
  'stage_change',
  NULL,
  'first_touch',
  j.owner_user_id,
  j.created_at,
  '{"source":"journey_redesign_backfill","event":"started","inferred_actor":true}'::jsonb
FROM client_journeys j
WHERE NOT EXISTS (
  SELECT 1 FROM client_journey_activities a
  WHERE a.journey_id = j.id
    AND a.type = 'stage_change'
    AND a.metadata->>'event' = 'started'
);
