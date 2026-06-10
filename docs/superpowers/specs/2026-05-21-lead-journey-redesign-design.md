# Lead Journey Redesign — Design

**Date:** 2026-05-21
**Branch:** `feature/priority-section-headers` (brainstorm only; implementation branch TBD)
**Status:** Approved design, pending spec review
**Supersedes:** `2026-05-20-lead-action-attribution-design.md` (its surviving pieces are absorbed below; its `client_journey_step_notes` work is dropped — see §9).

## Problem

The current lead journey is a **rigid, timed-template** system and it's fragile:

- A journey is seeded by copying a per-owner template (stored in `app_settings` under `journey_template:<owner_user_id>`) into `client_journey_steps` rows at creation time. Editing or deleting the template afterward does **not** update existing journeys — and `POST /journeys/:id/apply-template` will seed a *different* (current) version into new journeys, so old and new journeys silently diverge.
- Steps carry `offset_days`/`offset_weeks` → a computed `due_at`, and a cron (`journeyEmailScheduler.js`, every 5 min) auto-sends scheduled emails. The whole thing is automation-first and time-driven, which is the opposite of how the team actually works leads.
- Email content lives inline on each step with no reuse; there's no library of "the email we send people interested in implants."

We want a **human-driven pipeline** modeled on the part of HubSpot that actually fits: a custom Lead-Status pipeline (the touch stages) plus manual one-off email sends — *not* a timed sequence.

## HubSpot fact-check (informs the model)

HubSpot splits this across three concepts; the redesign deliberately fuses two of them:

- **Lifecycle Stage** — coarse, mostly automatic funnel position (Lead → MQL → SQL → Customer). Not our "touches."
- **Lead Status** — a manual property a rep moves a lead through (New, Attempted to Contact, Connected, …). **This is our touch pipeline.**
- **Sequences** — automated *time-delayed* email cadences; a reply auto-unenrolls; sending advances the step. We keep "sending advances" **and** optional time-delayed sends, but **drop the auto-seeded template cadence** — every scheduled send is set by a human, one at a time, not pre-loaded from a template.

Net: the new model is a custom Lead-Status pipeline (Kanban columns) where you advance by *doing a touch* (now or scheduled), with reusable email templates as a convenience. This also lets us **delete the template-fragility problem at the root** rather than version around it (HubSpot itself only versions around the same copy-on-enroll coupling).

## Decisions (confirmed with user)

1. **Stages are a fixed global set** — no per-client config, no templates to copy. A journey just stores "which stage am I in." (Kills the fragility entirely.)
2. **Stage = the touch you're currently working on.** Columns: **First Touch → Second Touch → Third Touch → Fourth Touch → Awaiting Decision.** Lead enters at First Touch. After the fourth touch it lands in Awaiting Decision, where you Convert or Archive.
3. **Any logged touch advances the stage** by one (both *Send Email* and *Log Call*), capped at Awaiting Decision; each records an activity with timestamp + notes. Reps can also drag a card to any stage (forward or back) to correct.
4. **Email templates are a per-client private library** — free wording, not tied to services at the DB level. Picked (and editable) at send time, or write a fully custom email.
5. **Re-entry → new "Previous Journey" tag.** When a new lead's phone/email matches an *archived* journey under the same owner, surface a dedicated badge (distinct from the existing "Existing Client" tag). Clicking shows the old journey's activity history.
6. **Existing journeys carry over safely, preserving their position.** In-flight journeys migrate to `active` at a **mapped stage** (completed-step count → touch: 0→First, 1→Second, 2→Third, 3→Fourth, 4+→Awaiting Decision); their notes and sent-email history fold into the new activity timeline. Already-terminal journeys (archived / lost / converted) stay terminal. The migration is **additive and non-destructive**: old tables are never dropped, the data block runs **exactly once** behind a sentinel flag, every migrated activity carries a removable provenance tag, and **no old auto-scheduled emails are carried forward or fire** (the timeline cron is replaced by the manual scheduler). Safety guarantees in §2a.
7. **Approach A — evolve `client_journeys` in place**, retire the timed machinery, add an activity-log table and a template table. (Rejected: fresh parallel tables; reusing `client_journey_steps` as fixed stage rows.)
8. **Touches can be scheduled, not just sent now.** Completing a touch advances the stage; in the new stage the rep can either act immediately or **schedule** the next email/text for a future time (default **+7 days**, editable at the moment of scheduling — pick a template or custom content, same dialog as send-now plus a date). A scheduled send sits as a pending item on the journey and fires via a **lean cron**; when a scheduled *email* actually sends, it advances the stage per the normal rule. Scheduling is opt-in and manual — there is **no template-driven auto-seeded timeline** (that's the fragile thing we removed). A journey holds **at most one pending scheduled touch** (which may carry an email and/or a text); scheduling again reschedules/replaces it. Pending scheduled sends are **cancelled automatically** if the journey is converted or archived first — we never email/text a terminal lead.
9. **Automated text is wired but gated off** — the `text` activity type, both the send and schedule paths, and a disabled "Send Text" button exist, but nothing dispatches (immediate *or* scheduled) until the agency Twilio number is swapped for a non-geographic/service-style number and tested. "Schedule both" schedules the email and leaves the text half gated until the flag flips.

### Absorbed from the 2026-05-20 attribution design

10. **Durable actor columns** survive the activity log's 30-day purge and render inline: `client_journeys.created_by` ("started by") and `active_clients.converted_by`.
11. **Actor identity = the real logged-in user** (`req.user.id`), even under admin impersonation — distinct from `owner_user_id` / `req.portalUserId` (the data owner). This rule now applies to **every** activity row, since each touch carries `created_by`.
12. **Activity-log feed stays admin/editor-only;** client users see only inline bylines.

## Current-state facts (verified in code)

| Surface | Table / column | Today |
|---|---|---|
| Journey row | `client_journeys` (`owner_user_id`, `lead_call_id`/`lead_call_key`, `active_client_id`, `status`, `next_action_at`, `symptoms`, `archived_at`) | timed model |
| Timed steps | `client_journey_steps` (`position`, `offset_days`/`offset_weeks`, `due_at`, `completed_at`, `notes`, `email_*`) | **to retire** |
| Journey notes | `client_journey_notes.author_id` | ✅ authored |
| Templates | `app_settings` key `journey_template:<owner>` | **to retire** |
| Email cron | `server/services/journeyEmailScheduler.js`, registered in `server/index.js:~1753` (every 5 min) | **to retire** |

Key endpoints / functions (ground truth from the attribution spec + exploration):
- `POST /journeys` — `server/routes/hub.js:8110` (new-journey INSERT branch ~8137; dedupe ~8138–8173).
- `GET /journeys` ~8069 · `GET /journeys/:id` ~8094 · `PUT /journeys/:id` ~8280 · `archive` ~8360 · `unarchive` ~8386.
- Step CRUD ~8427 / ~8517 / ~8738; `notes` ~8772; `apply-template` ~8795; template GET/PUT ~8044/8056 — **all retired or repurposed**.
- Convert path: `POST /clients/:leadId/agree-to-service` — `hub.js:9135` (active_clients INSERT ~9262, guard `isNewClient`).
- Lead notes: `POST /leads/:callId/notes` — `hub.js:7422` (already stamps `author_id`); delete ~7467.
- Read shaping: `fetchJourneysForOwner` — `hub.js:~810–938`.
- Active-clients read paths (for `converted_by` join): `hub.js:1026, 1245, 6883, 8978, 9085`.
- Helper timeline math to retire: `getJourneyTemplate`/`saveJourneyTemplate` (~592–629), `seedJourneySteps` (~677–721), `syncJourneySchedule` (~631–675), `deriveJourneyStepSchedule` (~533–576).
- Activity log: `server/services/activityLog.js` (`ActivityEventTypes` ~16–84, `ActivityCategories` ~89–99, `logUserActivity` ~115–157, `deriveCategory`, `sanitizeDetails`).
- Frontend: `LeadsTab.jsx`, `leads/JourneyGroupedView.jsx`, `JourneyTab.jsx`, `leads/journeyHelpers.js`, `useJourneyDrawer.jsx`, `src/hooks/useJourneys.js`, `src/api/journeys.js`.

## Design

### 1. Stage model

`client_journeys` carries two working fields:
- **`stage`** — one of `first_touch`, `second_touch`, `third_touch`, `fourth_touch`, `awaiting_decision`; `NULL` when terminal.
- **`status`** — `active` | `converted` | `archived`.

Advancement rule (server-enforced): a **sent** `email` and a logged `call` advance `stage` by one position, clamped at `awaiting_decision` (no wraparound, no auto-terminal). `note` and `text` do not advance. A scheduled email advances **when it actually sends** (cron fires it), not when it's scheduled — while pending it leaves the stage untouched. A manual move (`PATCH …/stage`) can set any stage, forward or back, and is recorded as a `stage_change` activity. Convert sets `status='converted'`, `stage=NULL`; Archive sets `status='archived'`, `stage=NULL` — both cancel any pending scheduled send.

### 2. Database — one idempotent migration

New file `server/sql/migrate_lead_journey_redesign.sql`, registered as `maybeRunLeadJourneyRedesignMigration()` appended to the chain in `server/index.js` (per `.claude/skills/add-migration`).

```sql
-- Stage pointer + durable actor on the journey
ALTER TABLE client_journeys
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Durable converted-by actor
ALTER TABLE active_clients
  ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Per-client reusable email templates
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

-- Per-touch activity log (the timeline; replaces timed steps + step notes)
CREATE TABLE IF NOT EXISTS client_journey_activities (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id    UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- data owner (scoping)
  type          TEXT NOT NULL CHECK (type IN ('email','call','text','note','stage_change')),
  stage_at      TEXT,            -- stage when the activity occurred
  to_stage      TEXT,            -- destination, for stage_change
  subject       TEXT,            -- email subject
  body          TEXT,            -- email body / call notes / note text
  body_format   TEXT DEFAULT 'text',
  template_id   UUID REFERENCES journey_email_templates(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,     -- future send time; NULL = immediate / already happened
  email_status  TEXT,            -- scheduled | sent | failed | canceled | skipped
  email_error   TEXT,
  send_attempts INTEGER NOT NULL DEFAULT 0,  -- cron claim/retry counter
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,   -- real acting user
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_journey_activities_journey
  ON client_journey_activities(journey_id, created_at DESC);
-- Scheduler hot path: only pending future sends.
CREATE INDEX IF NOT EXISTS idx_journey_activities_due
  ON client_journey_activities(scheduled_for)
  WHERE email_status = 'scheduled';

-- ─── DATA MIGRATION (runs exactly once; see §2a for the sentinel guard) ───

-- (a) Carry each existing journey forward at its mapped stage.
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
    WHEN j.archived_at IS NOT NULL                                    THEN 'archived'
    WHEN j.active_client_id IS NOT NULL OR j.status IN ('active_client','won') THEN 'converted'
    WHEN j.status = 'lost'                                            THEN 'archived'
    ELSE 'active'
  END,
  stage = CASE
    -- terminal journeys carry no working stage
    WHEN j.archived_at IS NOT NULL
      OR j.active_client_id IS NOT NULL
      OR j.status IN ('active_client','won','lost')                   THEN NULL
    -- in-progress: completed-step count → touch, clamped at awaiting_decision
    ELSE (ARRAY['first_touch','second_touch','third_touch','fourth_touch','awaiting_decision'])
           [LEAST(p.completed_steps, 4) + 1]
  END,
  archived_at = CASE WHEN j.status = 'lost' AND j.archived_at IS NULL THEN NOW() ELSE j.archived_at END,
  next_action_at = NULL
FROM progress p
WHERE p.journey_id = j.id;

-- (b) Preserve history → activities, each tagged with removable provenance.
--     (paused journeys map to 'active'; nothing auto-sends, so the pause is harmless.)
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
```

- **No `created_by`/`converted_by` backfill** for historical rows — they stay NULL and render no byline (`owner_user_id` is the owner, not the actor; copying it would lie).
- `client_journey_steps`, `client_journey_notes`, and the `journey_template:*` app-settings rows are **left in place** (vestigial, read-only). History is **copied, not moved** — the originals remain as the source of truth if the mapping ever needs re-deriving. Dropping them is a later cleanup migration.
- **Old auto-scheduled emails do not carry forward.** Unsent template-timeline steps (`email_enabled`, future `due_at`) are *not* turned into pending scheduled sends — the new schedule is manual-only, so nothing the user didn't explicitly set will fire.

### 2a. Migration safety

The carry-over is the riskiest part, so it ships with these guarantees:

1. **Runs exactly once.** `maybeRunLeadJourneyRedesignMigration()` checks an `app_settings` sentinel (`migration:lead_journey_redesign_v1`). If set, it skips the data block entirely. The schema block (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) is naturally idempotent and may run any time; the **data block (the mapping `UPDATE` + the three history `INSERT`s) is wrapped in a transaction**, and the sentinel is set inside that same transaction. So a crash mid-migration rolls back cleanly and re-runs; a successful run never repeats. This prevents the only real hazard — duplicated activity rows.
2. **Additive & non-destructive.** Nothing is deleted or dropped. The only mutation to existing rows is setting `client_journeys.stage`/`status`/`next_action_at`. `client_journey_steps` and `client_journey_notes` stay intact as the source of truth, so the mapping can be re-derived if it's ever judged wrong.
3. **Removable provenance.** Every migrated activity carries `metadata->>'source' = 'journey_redesign_migration'` (mirrors the existing `score_suppressed_reason='first_touch_backfill_2026_04'` pattern). One `DELETE … WHERE metadata->>'source' = …` fully reverses the history copy without touching live data.
4. **Dry-run preview before flipping.** Run this read-only query first and eyeball the distribution — it changes nothing:
   ```sql
   SELECT
     CASE WHEN j.archived_at IS NOT NULL THEN 'archived'
          WHEN j.active_client_id IS NOT NULL OR j.status IN ('active_client','won') THEN 'converted'
          WHEN j.status = 'lost' THEN 'archived'
          ELSE 'active' END AS new_status,
     LEAST(COUNT(s.id) FILTER (WHERE s.completed_at IS NOT NULL), 4) AS mapped_touch_index,
     COUNT(DISTINCT j.id) AS journeys
   FROM client_journeys j LEFT JOIN client_journey_steps s ON s.journey_id = j.id
   GROUP BY 1, 2 ORDER BY 1, 2;
   ```
5. **Post-migration sanity checks** (part of verification): every non-terminal journey has a non-NULL `stage`; every terminal journey has `stage IS NULL`; activity-note count ≥ source-note count; no journey landed at an invalid stage value.
6. **Local-first.** Because there is no live backfill risk locally, the migration is exercised against the local `anchor` DB (which already mirrors production journey data patterns) and visually verified before it ever runs in Cloud Run on startup.

### 3. Activity log + attribution

In `server/services/activityLog.js`:

```js
// ActivityEventTypes
START_JOURNEY:        'start_journey',
ADVANCE_JOURNEY_STAGE:'advance_journey_stage',
SEND_JOURNEY_EMAIL:   'send_journey_email',
LOG_JOURNEY_CALL:     'log_journey_call',
ADD_JOURNEY_NOTE:     'add_journey_note',
ADD_LEAD_NOTE:        'add_lead_note',
ARCHIVE_JOURNEY:      'archive_journey',
CONVERT_TO_CLIENT:    'convert_to_client',
// ActivityCategories
LEAD: 'lead',
```

- Category: all journey/lead events → `lead`; `convert_to_client` → `client`. Update `deriveCategory()`.
- Every action logs via `logUserActivity({ userId: req.user.id, actionType, actionCategory, targetUserId: ownerId, targetEntityType, targetEntityId, ipAddress, userAgent, details })`, fire-and-forget (`.catch(()=>{})`).
- **`add_step_note` is dropped** — there are no steps; note authorship lives on `client_journey_activities.created_by`.

### 4. Backend API (`/api/hub`)

Repurpose the existing journey router section. `ownerId = req.portalUserId || req.user.id`; `actorId = req.user.id`.

| Method + path | Behavior |
|---|---|
| `GET /journeys` | Board feed: active journeys grouped by `stage`; filters `status`, `stage`, search. Includes `created_by_name` (join `users`). |
| `POST /journeys` | Start a journey from a lead (`lead_call_id`/`lead_call_key`). Sets `stage='first_touch'`, `status='active'`, `created_by=actorId`. Logs `start_journey` on the new-journey branch only. Keep existing dedupe (don't re-create if an active journey already exists for the contact). |
| `GET /journeys/:id` | Journey + `client_journey_activities` timeline (joined to `users` for `created_by_name`), newest first. |
| `PATCH /journeys/:id/stage` | Manual move to a target stage; inserts a `stage_change` activity (`stage_at`, `to_stage`, `created_by`); logs `advance_journey_stage`. |
| `POST /journeys/:id/email` | Body: `{ template_id?, subject, body, body_format, scheduled_for? }`. **No `scheduled_for`** → render non-PHI tokens, send via Mailgun (client-branded, authenticated domain), insert `email` activity (`email_status='sent'`, `created_by`, `template_id`), auto-advance, log `send_journey_email`. **With `scheduled_for`** → insert `email` activity with `email_status='scheduled'` + `scheduled_for`, **do not send, do not advance**, log `send_journey_email` with `{ scheduled: true }`. Validate `scheduled_for` is in the future. Reschedule replaces the journey's existing pending send. On immediate-send failure: `email_status='failed'` + `email_error`, **no advance**, error toast. |
| `POST /journeys/:id/call` | Body: `{ body }` (notes). Inserts `call` activity, auto-advances, logs `log_journey_call`. No telephony awareness — manual log only. |
| `POST /journeys/:id/text` | **Gated** (`JOURNEY_SMS_ENABLED`, default false). Accepts the same shape as email incl. `scheduled_for`. While gated: with a future `scheduled_for` it may record a `text` activity as `skipped` for visibility, but **never dispatches**; immediate sends return the gated response. No Twilio call until the flag flips. |
| `POST /journeys/:id/note` | Inserts `note` activity, **no advance**, logs `add_journey_note`. |
| `POST /journeys/:id/schedule/cancel` | Cancels the journey's pending scheduled send(s): flips `email_status` `scheduled → canceled`. Owner-scoped. Used by the "Cancel scheduled" UI and internally by convert/archive. |
| `POST /journeys/:id/convert` | Hooks the existing `agree-to-service` convert flow; sets journey `status='converted'`, `stage=NULL`; stamps `active_clients.converted_by=actorId`; logs `convert_to_client` when `isNewClient`. |
| `POST /journeys/:id/archive` | `status='archived'`, `stage=NULL`, `archived_at=NOW()`; logs `archive_journey`. (Existing endpoint, simplified.) |
| `POST /journeys/:id/unarchive` | Reopen → `status='active'`, `stage='first_touch'` (or last known); clears `archived_at`. |
| `GET/POST/PUT/DELETE /journey-email-templates` | Per-client template CRUD, owner-scoped. Soft-delete via `archived_at`. |

**Scheduled-send processor (lean cron).** The old template-timeline cron is **replaced**, not removed, by a much simpler `journeyScheduledSends.js` invoked from `server/index.js` (keep the existing ~5-min interval). Each run:
1. Selects due rows: `email_status='scheduled' AND scheduled_for <= NOW() AND send_attempts < MAX (5)`, joined to journeys still `status='active'` and not paused, `LIMIT` a small batch.
2. **Atomically claims** each row (increment `send_attempts` / flip status in a transaction) so concurrent Cloud Run replicas can't double-send — reuse the claim pattern from the legacy `journeyEmailScheduler.js`.
3. Renders + sends the email via Mailgun, sets `email_status='sent'`, **auto-advances the stage** (same rule as an immediate send), logs `send_journey_email`. On failure: `email_status='failed'` + `email_error`, no advance.
4. **Skips/cancels** any row whose journey went terminal (`converted`/`archived`) since scheduling — sets `canceled`, never dispatches.
5. `text` rows stay gated: skipped (not dispatched) while `JOURNEY_SMS_ENABLED=false`.

No template lookup, no offset math, no per-step timeline — just "send the things that are due."

**Retired endpoints:** `POST /journeys/:id/steps`, `PUT /journeys/:id/steps/:stepId`, `DELETE …/steps/:stepId`, `POST /journeys/:id/apply-template`, `GET/PUT /journey-template`.

### 5. Frontend — dedicated Journeys page, two tabs

Lives where leads already live (`ClientPortal`; reachable by admins via impersonation).

- **Pipeline tab** — Kanban board, columns = the five stages. Cards show client name, phone, last-activity summary, time-in-stage. Drag a card to move it (reuse an existing DnD pattern if present; otherwise a per-card "Move to…" menu as the fallback). Click a card → drawer. Replaces `JourneyGroupedView`.
- **Email Templates tab** — per-client list (`DataTable`) + create/edit dialog (`FormDialog`): `name`, `subject`, `body` (rich/text per `body_format`) with a documented non-PHI merge-token set. Soft-delete with confirm.
- **Per-lead drawer** (redesigned `JourneyTab` / `useJourneyDrawer`):
  - Header: client name, current-stage `StatusChip`, `Started by {created_by_name} · {date}` (omit byline when null), Convert / Archive actions.
  - **Activity timeline**: each `client_journey_activities` row with `{type icon} {created_by_name} · {date}` and its body/subject; stage-change rows read "Moved to Third Touch." A **pending scheduled send** pins to the top as a distinct item — "📅 Email scheduled for May 28 · by {name}" — with **Cancel** / **Reschedule** controls.
  - **Action bar**: **Send Email**, **Log Call** (notes field), **Send Text** (disabled, tooltip "Coming soon — pending Twilio number"), **Add Note**, **Move/Advance**.
  - **Send Email dialog**: choose content (*Use a template* → picker pre-fills subject/body, fully editable / or *Custom*), then choose timing — **Send now** or **Schedule** (a date/time field defaulting to **+7 days**, editable) — and channel (Email / Text[disabled, gated] / Both). *Send now* sends + advances; *Schedule* creates the pending item without advancing. If a pending send already exists, the dialog shows it and scheduling again reschedules.
  - Every action updates the drawer immediately from the server response (prepend the new activity or pin/clear the pending send, reflect any stage change) and fires a success/failure toast. No reopen required.
- **Leads list** (`LeadsTab`): add a **Stage** column for leads that have an active journey; render a **Previous Journey** badge for leads matching an archived journey (click → read-only history of that journey's activities).

### 6. "Previous Journey" re-entry (computed)

Not stored. When shaping the leads list, run an `EXISTS` check per lead: an `archived` journey under the same `owner_user_id` whose `client_phone` (normalized to last 10 digits) or `client_email` matches the lead's contact. Surface as a derived boolean → badge, mirroring the data-driven "Existing Client" tag pattern (so it self-corrects as journeys are archived/unarchived). Distinct from "Existing Client" / "Repeat Caller" — it specifically means *we worked this person and they didn't convert.* Does not interfere with first-touch attribution (no auto-star, no relay re-fire — that logic is unchanged).

### 7. Twilio text deferral

`type='text'` activities, the `POST /journeys/:id/text` endpoint, the "Both" schedule option, and the disabled UI button all ship. Both **immediate and scheduled** SMS are gated behind `JOURNEY_SMS_ENABLED` (default false) — the cron skips `text` rows and the immediate path returns a gated response, so nothing dispatches over SMS. **Open task captured in spec, not built:** swap the single agency Twilio number for a non-geographic/service-style number, then test before flipping the flag.

## Migration & retirement summary

- **Add:** `client_journeys.stage`, `client_journeys.created_by`, `active_clients.converted_by`, tables `journey_email_templates` + `client_journey_activities`.
- **Carry over (safe, once):** in-flight journeys → `active` at a mapped stage (completed steps → touch); terminal journeys stay terminal; notes/sent-emails/step-notes copied into activities with removable provenance. Sentinel-guarded, transactional, non-destructive (§2a). Pending template-timeline emails never fire (old scheduler replaced).
- **Replace:** `journeyEmailScheduler.js` (template-timeline cron) → `journeyScheduledSends.js` (lean due-row processor, same interval).
- **Retire:** `offset_*`/`due_at`/`syncJourneySchedule` timeline math; `journey_template:*` + `seedJourneySteps`/`apply-template`; step CRUD endpoints; the template-editor UI in `JourneyTab`.
- **Leave vestigial (later cleanup):** `client_journey_steps`, `client_journey_notes`, template app-settings rows.

## Compliance checkpoint (HIPAA / SOC2)

- **Email merge tokens** stay on the existing non-PHI allowlist (first name, client name, phone, email) — never symptoms/health data.
- **Activity bodies** (call notes, custom emails) are free-text authored by staff and may contain contact-level detail; stored in DB like existing notes, **never written to logs** (`console.log` is nulled in prod). `symptoms` stays encrypted/redactable as today.
- **Activity-log `details`** carries IDs + non-PHI labels only (`{ journeyId, stage, templateId? }`); `sanitizeDetails()` as backstop. No name/phone/email/symptoms.
- **Parameterized queries only**; new endpoints owner-scoped server-side; activity-log feed stays admin/editor-only.
- **Email sends** (immediate and cron-fired) logged to `email_logs`; conversion relay behavior (first-touch suppression) unchanged.
- **Scheduled sends never fire to a terminal lead** — convert/archive cancel pending sends, and the cron re-checks `status='active'` at send time, so an archived/converted contact is never emailed by a stale schedule.
- Staff/team member names are not PHI (safe to render in bylines).

## Out of scope (YAGNI)

- **Recurring/repeating** scheduled sends or multi-step cadences — a journey holds **one** pending scheduled touch at a time, set manually. (Single scheduled send *is* in scope; auto-seeded timelines are not.)
- Telephony auto-detection of calls — manual log only.
- Template versioning — unnecessary once copy-on-create is gone.
- App-wide note-author sweep (client profile, onboarding, tasks).
- Backfilling actor identity for historical rows.
- Dropping vestigial tables/columns (deferred cleanup migration).
- Exposing the activity-log feed to client users.

## Verification (no test suite)

`yarn build` + `yarn lint` must pass, then visual checks per `.claude/skills/verify-without-tests`:

- **Migration:** run the §2a dry-run preview and confirm the distribution looks sane; run the migration; confirm every `active` journey has a non-NULL `stage`, every terminal journey has `stage IS NULL`, no invalid stage values, and migrated activity-note count ≥ source-note count. Spot-check a few real journeys: a partially-worked one lands at the expected touch with its notes/sent emails visible in the timeline; an archived one stays archived. Re-run the migration once → confirm zero new/duplicated activity rows (sentinel held).
- Start a journey → lands in **First Touch**; drawer shows "Started by <me>"; admin activity log shows `start_journey` under `lead`.
- Send a template email → email sends, activity appears with my byline, card advances one stage, toast fires, no reopen needed.
- Schedule an email (+7-day default, then edit the date) → a pending "📅 scheduled" item pins to the timeline, **stage does not advance**; backdate `scheduled_for` and run the cron → it sends, the pending item becomes a sent activity, and the card advances.
- Cancel a pending scheduled send → pending item clears, nothing dispatches; archive a journey with a pending send → the send is cancelled and never fires.
- Log a call → activity logged, stage advances; `log_journey_call` in the activity log.
- "Send Text" is visibly disabled; the endpoint returns the gated response and dispatches nothing.
- Drag a card backward → `stage_change` activity recorded ("Moved to …").
- Convert from Awaiting Decision → client detail shows "Converted by <me>"; `convert_to_client` logged; journey `status='converted'`.
- Archive → leaves the board; re-submitting that contact as a new lead shows the **Previous Journey** badge linking to the archived history.
- Confirm no PHI in `user_activity_logs.details` and no PHI in server logs.
- Confirm client users cannot reach the activity-log endpoint.
