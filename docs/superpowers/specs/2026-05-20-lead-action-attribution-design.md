# Lead-Lifecycle Action Attribution — Design

**Date:** 2026-05-20
**Branch:** `feature/qualified-returning-leads`
**Status:** ⚠️ SUPERSEDED (2026-05-21) by `2026-05-21-lead-journey-redesign-design.md`

> **Superseded.** The lead journey redesign retires the timed `client_journey_steps` model this spec builds on, so the centerpiece here — the `client_journey_step_notes` threaded-notes table — is **dropped** (do not build it). The surviving pieces are absorbed into the redesign spec: `client_journeys.created_by`, `active_clients.converted_by`, actor identity = real `req.user.id`, the activity-log event types, and admin-only log visibility. Under the new model every touch lives in `client_journey_activities` and is inherently authored (`created_by`), so "who did what" is satisfied natively. Implement from the redesign spec, not this one.

## Problem

When staff or client-side team members manage leads in the client list / client portal, there is no visible record of **who did what**. Specifically:

- Starting a journey (moving a lead from the list into a journey) shows no "started by."
- Converting a lead to a client / adding to the client list shows no "converted by."
- Journey **step notes** are plain text with no author at all.
- Lead notes and journey notes *do* already record + display an author — but the action is not reflected in the activity feed.

The app already has an in-depth activity log (`user_activity_logs`) that records the **real** acting user. We will both (a) stamp durable attribution on the entities themselves and (b) feed these actions into that existing activity log.

## Decisions (confirmed with user)

1. **Storage model:** durable actor column on each entity (survives the activity log's 30-day purge and renders inline) **plus** an entry in `user_activity_logs`.
2. **Notes scope:** lead-lifecycle only — lead notes, journey notes, journey step notes. No app-wide note sweep.
3. **Convert display:** in the client detail / drawer (not the client list row).
4. **Actor identity:** the real logged-in user (`req.user.id`), even under admin impersonation — consistent with how `user_activity_logs` already behaves. This is distinct from `owner_user_id` (the data owner) used by the existing endpoints (`req.portalUserId || req.user.id`).
5. **Step notes:** convert from a single overwrite-able text field to an **append-only threaded** list, each note carrying its own author (mirrors lead/journey notes).
6. **Activity-log visibility:** stays **admin/editor-only**, as today. Client users see only the inline bylines.

## Current-state facts (verified in code)

| Surface | Table / column | Actor today? | Display today? |
|---|---|---|---|
| Journey start | `client_journeys` — only `owner_user_id` | ❌ no actor column | ❌ |
| Convert to client | `active_clients` — only `owner_user_id` | ❌ no actor column | ❌ |
| Lead note | `lead_notes.author_id` | ✅ | ✅ `LeadsTab.jsx` (~2725) |
| Journey note | `client_journey_notes.author_id` | ✅ | ✅ `useJourneyDrawer.jsx` (~909–922) |
| Journey step note | `client_journey_steps.notes` (TEXT) | ❌ | text only (`useJourneyDrawer.jsx` ~642–665) |

Key endpoints:
- `POST /journeys` — `server/routes/hub.js:8034` (INSERT branch ~8137; `ownerId` line 8035).
- `POST /clients/:leadId/agree-to-service` — `hub.js:9135` (active_clients INSERT ~9262, new-client guard `isNewClient`).
- `PUT /journeys/:id/steps/:stepId` — `hub.js:8499`.
- `POST /leads/:callId/notes` — `hub.js:7422` (INSERT ~7444, already stamps `author_id`).
- `POST /journeys/:id/notes` — `hub.js:8754` (INSERT ~8768, already stamps `author_id`).
- Journey read shaping: `fetchJourneysForOwner` — `hub.js:~810–938` (steps query ~828, notes query ~838).
- Active-clients read paths (for `converted_by` join): `hub.js:1026`, `1245`, `6883`, `8978`, `9085`.
- Activity log service + event-type registry: `server/services/activityLog.js` (`ActivityEventTypes` lines 16–84, `ActivityCategories` 89–99, `logUserActivity` 115–157).

## Design

### 1. Database — one idempotent migration

New migration file `server/sql/migrate_lead_attribution.sql`, registered as `maybeRunLeadAttributionMigration()` and appended to the migration chain in `server/index.js` (see `.claude/skills/add-migration`).

```sql
-- Actor columns (real acting user, distinct from owner_user_id)
ALTER TABLE client_journeys
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE active_clients
  ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Threaded step notes
CREATE TABLE IF NOT EXISTS client_journey_step_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  step_id   UUID NOT NULL REFERENCES client_journey_steps(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journey_step_notes_step ON client_journey_step_notes(step_id);

-- One-time migration of existing single-field step notes into the thread.
-- author_id stays NULL (we cannot honestly attribute historical text).
INSERT INTO client_journey_step_notes (step_id, journey_id, author_id, body, created_at)
SELECT s.id, s.journey_id, NULL, s.notes, s.created_at
FROM client_journey_steps s
WHERE s.notes IS NOT NULL AND btrim(s.notes) <> ''
  AND NOT EXISTS (SELECT 1 FROM client_journey_step_notes n WHERE n.step_id = s.id);
```

- **No backfill** of `created_by` / `converted_by` for existing rows — they stay NULL and render no byline. `owner_user_id` is the data owner, not the actor, so copying it would be misleading.
- The legacy `client_journey_steps.notes` column is left in place (vestigial) after the data is copied; reads switch to the new table. Dropping the column is deferred to a later cleanup migration.

### 2. Activity log — new event types

In `server/services/activityLog.js`:

```js
// add to ActivityEventTypes
START_JOURNEY:     'start_journey',
CONVERT_TO_CLIENT: 'convert_to_client',
ADD_LEAD_NOTE:     'add_lead_note',
ADD_JOURNEY_NOTE:  'add_journey_note',
ADD_STEP_NOTE:     'add_step_note',

// add to ActivityCategories
LEAD: 'lead',
```

Category mapping: `start_journey`, `add_lead_note`, `add_journey_note`, `add_step_note` → `lead`; `convert_to_client` → `client` (it creates a client). Update `deriveCategory()` accordingly.

Each action logs via `logUserActivity({ userId: req.user.id, actionType, actionCategory, targetUserId: ownerId, targetEntityType, targetEntityId, ipAddress: req.ip, userAgent: req.headers['user-agent'], details })`.

**Compliance (HIPAA):** `details` carries only IDs and non-PHI labels — e.g. `{ journeyId, serviceCount, status }`. Never the lead's name, phone, email, or symptoms. `sanitizeDetails()` runs as a backstop. Logging calls are fire-and-forget (`.catch(() => {})`) so they never break the request, matching the existing pattern.

### 3. Backend wiring

**Write paths**
- `POST /journeys` (8034): add `created_by` to the INSERT column list, value `req.user.id`. After commit, on the **new-journey** branch only (`newlyCreatedJourneyId`), log `start_journey` (`targetEntityType: 'journey'`, `targetEntityId: journeyId`). Do not log on the update-existing branch.
- `agree-to-service` (9135): add `converted_by = req.user.id` to the active_clients INSERT (the `if (!activeClientId)` branch, ~9262). Log `convert_to_client` (`targetEntityType: 'active_client'`, `targetEntityId: activeClientId`) only when `isNewClient`.
- `PUT /journeys/:id/steps/:stepId` (8499): stop writing the `notes` text column. The step-note write becomes a new endpoint (below).
- `POST /leads/:callId/notes` (7422): keep author stamping; **add** `add_lead_note` log.
- `POST /journeys/:id/notes` (8754): keep author stamping; **add** `add_journey_note` log.

**New step-note endpoints** (threaded model)
- `POST /journeys/:id/steps/:stepId/notes` — insert into `client_journey_step_notes` with `author_id = req.user.id`; return the created note with resolved `author_name`; log `add_step_note`. Validate the step belongs to a journey owned by `ownerId`.
- `GET /journeys/:id/steps/:stepId/notes` — list notes (joined to `users` for author name), newest first.
- `DELETE /journeys/:id/steps/:stepId/notes/:noteId` — owner-scoped delete (mirrors `lead_notes` delete at 7467).

**Read paths**
- `fetchJourneysForOwner`: add `created_by` to the journey SELECT and join `users` → `created_by_name` (filter Boolean first/last, fallback email, else `null`). Replace the per-step `notes` text with a `notes` array sourced from `client_journey_step_notes` (join `users` for `author_name`), batched by `step_id = ANY(...)` like the existing journey-notes query. Shape each step note as `{ id, author_id, author_name, body, created_at }`.
- Active-clients read paths used by the client detail/drawer (1026 / 1245 / 6883 / 8978 / 9085 — confirm which feeds the detail view in the plan): add `converted_by` and a `users` join → `converted_by_name`.

### 4. Frontend — display only

- **Journey drawer / timeline header** (`src/views/client/ClientPortal/.../useJourneyDrawer.jsx`): render `Started by {created_by_name} · {formatDateDisplay(created_at)}` near the journey title. Omit the "by …" clause when `created_by_name` is null (older journeys).
- **Step notes** (`useJourneyDrawer.jsx` ~642–665): replace the single text field with a small thread — each note shows `{author_name} · {date}` above the body, plus an add-note input. Reuse the journey-notes rendering pattern already in this hook for consistency.
- **Convert attribution** (client detail / drawer component, located in the plan): show `Converted by {converted_by_name} on {date}`; hide when null.
- **Lead notes / journey notes** (`LeadsTab.jsx` ~2699–2729; journey timeline ~909–922): already render the author byline. Verify the null-author fallback reads cleanly (`Unknown` is acceptable) and that the byline is visually a "name above the note." No data changes.
- **Toast on every state change** for the new add/delete step-note actions; update local state immediately from the server response (per the immediate-UI-update rule). The new note must appear without reopening the drawer.

## Out of scope

- App-wide note author sweep (client profile, onboarding, tasks).
- Backfilling actor identity for historical rows.
- Dropping the legacy `client_journey_steps.notes` column (deferred cleanup).
- Exposing the activity-log feed to client users.

## Verification (no test suite)

`yarn build` + `yarn lint` must pass. Then visual check per `.claude/skills/verify-without-tests`:
- Start a journey → drawer shows "Started by <me>"; row appears in admin activity log under `lead`.
- Convert a lead → client detail shows "Converted by <me>"; activity log shows `convert_to_client`.
- Add lead/journey/step notes → author byline shows immediately (no reopen); each emits the matching activity-log event.
- Confirm no PHI lands in `user_activity_logs.details` (inspect a row).
- Confirm client users cannot reach the activity-log endpoint.

## Compliance checkpoint

- No PHI in `details` (IDs + counts only). ✅ by design.
- Parameterized queries only. ✅
- Access control: activity-log endpoint stays admin/editor-only; new step-note endpoints are owner-scoped server-side. ✅
- Names of staff/team members are not PHI.
