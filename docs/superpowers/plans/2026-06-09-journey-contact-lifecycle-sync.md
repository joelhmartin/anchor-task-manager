# Plan: Journey ↔ Contact Lifecycle Sync + Live Board Updates

**Date:** 2026-06-09
**Branch base:** built on top of `refactor/hub-split` (coordinate — `hub/contacts.js`, `hub/journeys.js` are being split live)
**Trigger:** N. Texas (TMJ North Texas) — archived/finished patients reappear as active leads; two computers disagree; staff re-contact "done" patients.

---

## Confirmed diagnosis (prod data, 2026-06-09)

North Texas owner `5ffb80b4-9d08-4dd9-9139-74ebb16d37ff`, in the 19-client "TMJ" group.

- **NOT the multi-account scope bug.** All 6 NT account users resolve to exactly 1 account; all 357 contacts owned by the single NT owner (0 split). Everyone shares one scope.
- **Root cause: Journey and Contact lifecycles are fully decoupled.** No sync logic in either direction.
  - Archive a CONTACT → nothing happens to the journey (`hub/contacts.js:374`).
  - Archive/win/convert a JOURNEY → nothing happens to the contact (`hub/journeys.js:667,965`).
  - Scheduler filters only `j.status='active'`, never reads `contacts.archived_at` (`services/journeyScheduledSends.js:37`).
  - Contacts-board lifecycle derivation returns `'lead'` for a contact whose only journey is terminal (`hub/contacts.js:190`).
- **Measured impact at NT:** 98 journeys terminal (60 archived + 37 active_client/won + 1 converted) while contact still live → **92 distinct finished patients still show as workable leads on the Contacts board.** "Two computers disagree, refresh doesn't help" = Journey board vs Contacts board genuinely out of sync in the DB.
- Forward direction (archived contact still emailed by scheduler) = 0 current NT cases, but a real latent bug → still add the cheap guard.

## Locked decisions

- Resolution (scope bug, Workstream A): force the picker, never silent-fallback to own id. **Demoted** — latent, not NT's issue.
- Contact archive → **archive the journey** (status='archived') alongside it.
- Callback (`reactivateArchived`) → re-attach the existing archived contact (old data preserved); journey starts **fresh** (history viewable).
- Live updates: lightweight **~15s state-version poll**, refetch only on diff.
- Services (Workstream D): contact is source of truth (`contact_services`); journey-stage + direct contact add/remove all write it. **Two separate fields** — catalog **Services** vs free-text **Concerns/Symptoms**.

---

## Workstream B — Journey ↔ Contact lifecycle coupling (PRIMARY)

1. **Scheduler guard** (`services/journeyScheduledSends.js`): add `AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = j.contact_id AND c.archived_at IS NOT NULL)` to the due-sends query, and mirror in the post-claim re-check. Archived contact ⇒ never auto-emailed.
2. **Contact archive cascade** (`hub/contacts.js` PATCH `/contacts/:id/archive`): when `archived=true`, also set the contact's live journeys to `status='archived', archived_at=NOW(), next_action_at=NULL`. When `archived=false` (manual restore), leave journeys archived (callback path handles re-entry).
3. **Journey terminal cascade** (`hub/journeys.js` archive / lost): when a journey goes to `archived`/`lost` and the contact has no other live journey and no active_clients row, archive the contact (so it leaves the Contacts board). Won/converted (`active_client`) → ensure the contact is reflected as `active_client` (active_clients link / lifecycle_state), NOT archived.
4. **Reconcile the status schism** ([[project_journey_status_schism]]): make "live" consistent across scheduler (`='active'`) vs canonical options (`pending`/`in_progress`). Pick one canonical live set; scheduler + board + lifecycle all use it.
5. **Backfill the 92 stuck NT contacts** (idempotent script, run prod after deploy): for contacts whose only journey is terminal and no active_clients row → archive contact (or mark active_client for won). Per-owner, dry-run first. Generalize beyond NT (other group clients likely have the same).

## Workstream C — Live board updates (~15s poll)

1. **State-version endpoint** (e.g. `GET /api/hub/state-version`): returns per-owner cheap tokens — `MAX(updated_at)` + `COUNT(*)` for `contacts` and `client_journeys` (both indexed by `owner_user_id`). Two index aggregates; sub-ms.
2. **Client poll**: every 15s hit the endpoint; if token unchanged, do nothing; if changed, refetch the visible list once. Wire into Contacts board + Journey pipeline (+ leads views) in the client portal.
3. Respects the `req.portalUserId` funnel ⇒ multi-tenant safe.

## Workstream D — Unified Services field (CONFIRMED bug + product gap)

**Confirmed root cause (2026-06-09, prod-verified):** the "Start Journey" dialog field labeled *"Services / Interests"* (`ConcernDialog.jsx:75,86`) saves `symptoms: selections` → `client_journeys.symptoms` (free-text JSONB array, `freeSolo`), **not** a catalog `service_id`. The contact's Services column reads `contact_services` (catalog-backed), which that dialog never writes. So services "added" while starting a journey never appear on the contact (reproduced).

Prod data confirms the journey→contact path is effectively **dead**, not regressed:
- NT: **0 of 204** journeys have a `service_id`; **125** have free-text `symptoms`. They use the mislabeled symptoms field exclusively.
- **Platform-wide: 216/216 `contact_services` rows are `source='active_client'`** across all 15 owners — i.e. `appendContactServices` (journey `service_id` → contact) has produced **zero rows ever**. The ONLY populated path is active-client conversion (`client_services` → `contact_services`).
- So "contacts have services" = converted active-client contacts; "new ones don't" = journey-stage service additions go to the `symptoms` dead-end and never reach the contact.

Separately, `appendContactServices` silently skips when the journey's `service_id`'s `services.user_id` ≠ owner, or the journey has no `contact_id` — but since nobody sets `service_id`, this path is moot today.

Services are fragmented across: `services` (catalog, `user_id`-scoped), `client_journeys.service_id` (single, set at create only), `journey.symptoms` (free text, mislabeled "Services"), `contact_services` (read-only/append-only ledger — the contact/list Services column; soft-remove via `redacted_at` exists per `ArchiveTab.jsx`), and `client_services` (active-client, +price, `POST /active-clients/:id/services`).

**Requirement (user):** services must be a real, catalog-backed field that can be **added and removed at will** throughout the **journey, contact, and client list**.

Fix direction:
1. Make `contact_services` the **single source of truth** for a contact's services. Add editable endpoints: `POST /contacts/:id/services` (attach, idempotent), `DELETE /contacts/:id/services/:serviceId` (soft-remove via `redacted_at`). Owner-scoped via `req.portalUserId`.
2. **DECIDED:** keep two distinct fields. A catalog **Services** multi-select (catalog-backed, writes `contact_services`) is separate from a free-text **Concerns/Symptoms** field (stays `journey.symptoms`, e.g. "jaw clicking"). One field must not do both. The current "Services / Interests" box in `ConcernDialog.jsx` becomes the **Concerns** field; a new catalog **Services** picker is added alongside it (and on the contact + client list).
3. Surface the same editable Services control on: journey drawer, contact detail drawer, and the contacts/client list row — all read/write `contact_services`.
4. Reconcile sync: setting a journey `service_id` and adding `client_services` both propagate into `contact_services` (the spine); fix the silent-skip in `appendContactServices` to surface failures instead of swallowing.
5. Backfill `contact_services` from existing `client_journeys.service_id` + `client_services` (`contactServicesBackfill.js` already exists — extend/verify). Free-text `journey.symptoms` are NOT migrated (they aren't catalog services).

## Workstream A — Account scope resolution (DEFERRED, latent)

For genuinely multi-account clients only (not NT). Force-picker + server-persisted selection; close the `middleware/auth.js:117` silent fallback. Track separately; do not block B/C.

---

## Verification (no test suite — `verify-without-tests`)

- `yarn build` + `yarn lint`.
- Manual: archive a journey → contact leaves Contacts board; archive a contact → journey archived + no scheduled sends; callback re-creates contact + fresh journey with history; two browsers → change on one appears on the other within ~15s without manual refresh.
- Backfill: dry-run counts match the 92 before applying; re-run is idempotent.
- Human sign-off before merge to main (= auto-deploy to prod) — see [[feedback_review_before_prod_merge]].
- Big portal behavior change ⇒ ask about a client-facing Update banner.
