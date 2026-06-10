# Plan: Unify notes onto the contact (one notes list everywhere)

**Date:** 2026-06-09
**Status:** PLAN — implementing on `feature/contact-notes-unification` for review (no autonomous deploy).
**Owner decisions:** reuse `lead_notes` (add `contact_id`); **amalgamate** existing journey notes into it so nothing is lost; ship after PR #180 (done — #180 merged).

## Problem
Notes live in 3 stores, none keyed by the contact:
- `lead_notes` — keyed by `call_id` (TEXT). The per-activity note (the "Patient wants to think about it" note). API `/leads/:callId/notes` GET/POST/DELETE; UI in `LeadsTab.jsx` (lead detail drawer).
- `client_journey_activities` (type=`note`, by `journey_id`) — what the journey drawer's **Notes** tab shows (`useJourneyDrawer.jsx`).
- `client_journey_notes` (by `journey_id`) — separate/legacy path.
So a note added on the activity never appears on the journey, and vice-versa, even though it's the same person.

## Model (owner's intent)
- **Notes = contact-level.** One list per contact, shown identically everywhere (lead/activity drawer, journey drawer, contact drawer): "every note for this contact." **Add and delete** from any of them.
- The journey **"Activity"** tab stays as the stage-movement / event log (separate from notes).
- `lead_notes` becomes the spine via a new `contact_id` FK.

## Implementation

### N1 — Schema + amalgamation (one migration, idempotent)
- `ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL` + index `(owner_user_id, contact_id, created_at DESC)`.
- **Backfill** `lead_notes.contact_id` from `call_logs.contact_id` matched on `lead_notes.call_id = call_logs.call_id` (owner-scoped), where contact_id is NULL.
- **Amalgamate journey notes** into `lead_notes` (copy, don't delete the originals): for each `client_journey_notes` row and each `client_journey_activities` row with `type='note'` and a non-empty body, INSERT a `lead_notes` row with `owner_user_id`, `author_id`, `body`, `created_at`, `contact_id` (from the journey's `contact_id`), `note_type='note'`, and `metadata` carrying a source marker (e.g. `{"source":"journey_note","source_id":"<uuid>"}`). Idempotent: skip if a `lead_notes` row already exists with that source marker (`WHERE NOT EXISTS ...`).
- Runs on startup (after server bind) like other migrations; idempotent + never rethrows. This is the "don't lose journey notes" step the owner asked for — it executes on the (owner-approved) deploy.

### N2 — Contact-scoped notes endpoints
- `GET /api/hub/contacts/:id/notes` — all non-deleted notes for the contact (by `contact_id`), owner-scoped, newest first.
- `POST /api/hub/contacts/:id/notes { body }` — insert a `lead_notes` row stamped with `contact_id` (+ author). Return the row.
- `DELETE /api/hub/contacts/:id/notes/:noteId` — owner+contact-scoped delete.
- Keep the existing `/leads/:callId/notes` POST working but also stamp `contact_id` (resolve from the call's `contact_id`) so notes added from an activity are contact-linked. The lead-notes GET should return the **contact's** notes (resolve callId → contact_id → all notes), so the activity drawer shows every note for the contact.

### N3 — Frontend: every notes surface reads the contact's notes
- **`LeadsTab.jsx`** lead/activity drawer: `fetchLeadNotes` → contact notes (by the lead's contact_id); add → contact note; add a **delete** affordance per note. Immediate UI + toast.
- **`useJourneyDrawer.jsx`** Notes tab: read the **contact's** notes (via journey `contact_id`) instead of journey activities; `addJourneyNote` → write a contact note; add delete. The **Activity** tab keeps showing journey activities (stage moves/emails). Immediate UI + toast.
- **`ContactProfileDrawer.jsx`**: add a Notes section (all contact notes, add/delete) — parity with services.
- New API client fns: `fetchContactNotes(contactId)`, `addContactNote(contactId, body)`, `deleteContactNote(contactId, noteId)`.

## Verification (no test suite)
`yarn build`+`yarn lint`; migration applies idempotently on local DB (twice) and amalgamation dedups on re-run; a note added on an activity appears on that contact's journey drawer and contact drawer and is deletable from each; existing journey notes appear after migration. Human sign-off before merge/deploy.
