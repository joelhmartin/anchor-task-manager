# Contacts Management — Backend Completion + UI Design

**Status:** Designed 2026-05-27, approved. Builds the contacts-management surface on top of the live Contact Entity (entity + backfill + contact-aware recognition + rename all merged/deployed; rename UI in PR #105 pending merge). Completes the remaining backend gaps and adds a client-portal **Contacts** tab. Decomposed into **3 independently-shippable phases** — each gets its own implementation plan.

## 1. Goal
The contact entity has rich backend (resolve, merge/dismiss queue, tags, consent, rename) but **no management surface** — contacts are only visible woven into the Leads views. Give staff and client-portal users a place to browse/search contacts, view a person's unified profile + timeline, manage tags/consent, and (staff) resolve merge conflicts + un-merge mistakes.

## 2. Decisions (approved)
1. **Placement/audience:** a new **"Contacts" tab in the client portal** (mirrors the Leads tab). Clients see their own contacts; staff see a client's via the existing acting-client context (`x-acting-user`/`x-client-account`). Both via the same `ClientPortal` tab.
2. **Auth split:** browse/search, profile, rename, tags, consent are **client-accessible + owner-scoped**. **Merge-queue, dismiss, and split are staff-only** (destructive identity ops).
3. **Profile presentation:** a **slide-over drawer** (same pattern as the lead detail drawer), not a full page.
4. **List includes a lifecycle chip** (active client / in journey / lead) computed per contact.
5. **Phase C "fix" tools = split (un-merge) only.** Split pulls a wrongly-grouped person's identifier(s) + their activity into a NEW contact; the original is kept (both are real people). **No delete/archive in v1** — nothing is destroyed.
6. **3 phases, sequenced A → B → C**, each shippable on its own.

## 3. Backend completion

### Auth boundaries (important)
`server/routes/contacts.js` is gated `router.use(requireAuth, isStaff)` — staff-only for the whole router. So:
- **Client-accessible, owner-scoped** endpoints (list, profile, tags, consent) go in **`hub.js`** (per-route `requireAuth`; `targetUserId = req.portalUserId || req.user.id`; every query scoped `owner_user_id = targetUserId`) — the exact pattern rename (`PATCH /hub/contacts/:id/name`) already uses. They **reuse the existing service functions** (`server/services/contactTags.js`: `applyContactTags`/`removeContactTag`; etc.) rather than duplicating logic — thin owner-scoped route wrappers over shared services (DRY).
- **Staff-only** destructive ops (merge, dismiss, **split**) stay in **`contacts.js`** (`isStaff`).

### New/changed endpoints
- **`GET /hub/contacts`** (new, hub.js): owner-scoped list. Query params: `search` (matches `display_name` ILIKE, `contact_phones.phone_digits10`, `contact_emails.email`), `lifecycle` (lead|in_journey|active_client), `tag` (tag id), `page`/`limit`, `sort`. Returns rows: `{ id, display_name, display_name_source, primary_phone, primary_email, tags[], last_activity_at, activity_count, lifecycle }`. **Lifecycle** is derived in a batch pass (reuse the `contact_id` → active_clients/client_journeys lookups, like `attachLifecycleState` but keyed by contact) — cheap for a page.
- **`GET /hub/contacts/:id`** (new, hub.js): owner-scoped. Returns `{ contact: {…all fields}, phones: [...], emails: [...], tags: [...], consent: { sms_opted_out, email_opted_out, email_unsubscribed_at }, counts }`. The **activity timeline is NOT in this payload** — the drawer fetches it via the calls filter below (paginated, reuses existing rendering).
- **`GET /hub/calls?contact_id=<id>`** (extend the existing `/calls` list): add a `contact_id` filter (owner-scoped) to the query conditions. This powers the profile timeline AND resolves the deferred Phase-2 `?contact_phone=` item (the contact filter supersedes the phone filter).
- **Tags (client-accessible, hub.js, owner-scoped):** `GET /hub/contacts/:id/tags`, `POST /hub/contacts/:id/tags { tagId }`, `DELETE /hub/contacts/:id/tags/:tagId` — owner-scoped wrappers calling the existing `contactTags` service (validate the tag belongs to the owner, as the staff version does). The staff-only copies in contacts.js remain.
- **Consent (client-accessible, hub.js, owner-scoped):** `PATCH /hub/contacts/:id/consent { sms_opted_out?, email_opted_out? }` — owner-scoped version of the existing staff endpoint.
- **`POST /hub/contacts/:id/split`** (new, contacts.js, **staff-only**, transactional + audited): body `{ identifierType: 'phone'|'email', identifierId }` (or a list). Creates a NEW contact under the same owner, moves the selected `contact_phones`/`contact_emails` row(s) to it, and reassigns the activity that belongs to the split-off identifier — `call_logs` whose normalized `from_number` (or `meta.caller_email`) matches the moved identifier(s) → new contact; `client_journeys`/`active_clients` matched the same way. Everything else stays on the original. Returns both contacts. Mirrors the merge endpoint's transaction + `FOR UPDATE` + audit (`contact_split`).

All new endpoints: parameterized, owner-scoped in SQL (not just UI), mutations audited without logging PHI values.

## 4. Frontend (3 phases)

**Phase A — Contacts list** (`src/views/client/ClientPortal/ContactsTab.jsx` + a `contacts` entry in the ClientPortal tab array + `src/api/contacts.js`): a `DataTable` (shared component) with columns: Name (+ a small "set by user" indicator when `display_name_source==='user'`), Phone, Email, Lifecycle chip (`StatusChip`), Tags (chips), Last activity. Search box + lifecycle/tag filter dropdowns (`SelectField`). Pagination. Row click → opens the profile drawer (Phase B). Empty state via `EmptyState`.

**Phase B — Contact profile drawer** (`src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx`): header with the editable name (reuse the rename endpoint + the inline-edit pattern already built for the lead drawer); identifier list (phones/emails, primary marked); tag add/remove (autocomplete over the owner's `lead_tags`); SMS/email consent toggles; and the **activity timeline** (paginated, fetched via `/hub/calls?contact_id=`, rendered with the existing `LeadActivityRow`). A "Merge into…" action **visible to staff only**. All mutations update local state immediately (drawer + list row) + toast.

**Phase C — Merge queue + split** (staff-only UI): a view (likely a section/sub-tab within Contacts, staff-gated) listing pending `contact_merge_candidates` with both sides side-by-side → **Merge** / **Dismiss** (existing endpoints). A **Split** action in the profile drawer (staff) → a small dialog to pick the identifier(s) to break out → calls the split endpoint → both contacts reflected immediately. Confirmations via `ConfirmDialog`.

Use shared components throughout (`DataTable`, `StatusChip`, `SelectField`, `ConfirmDialog`, `LoadingButton`, `EmptyState`, `useToast`). Staff-vs-client gating uses the existing role/acting context the portal already exposes.

## 5. Compliance
Names/phones/emails are PHI. Every endpoint owner-scoped server-side; mutations (rename/tag/consent/merge/split) audited without the value; parameterized; TLS + at-rest encryption per existing policy. Per-read auditing follows the `/calls` precedent (the owner's own data isn't per-read audited; staff cross-tenant reads via the existing merge-candidates/by-tag endpoints already are). **Big-portal-change note:** this adds a visible client-portal tab — per the project rule, offer the user a client-facing portal Update when Phase A ships.

## 6. Decomposition & sequencing
Each phase = its backend endpoint(s) + the UI that consumes them, and is independently shippable + reviewable:
- **Phase A** (`GET /hub/contacts` + `ContactsTab` list) — browse/search lands first; immediately useful.
- **Phase B** (`GET /hub/contacts/:id` + `?contact_id=` calls filter + client-accessible tags/consent + profile drawer) — manage one contact.
- **Phase C** (`POST /split` + merge-queue UI + split UI) — staff conflict resolution + un-merge.
Each gets its OWN implementation plan (the writing-plans step will produce them; start with Phase A).

## 7. Verification (no test suite)
Per phase: `yarn build` + lint on touched files; local-DB scenarios (list search/filter/owner-scoping; profile fetch; tag/consent owner-scoped; the `?contact_id=` filter; split = transactional move with both contacts correct + cross-owner rejected); manual UI check in the portal; CodeRabbit before merge. No migration in any phase (schema is already in place).

## 8. Out of scope (v1)
- Delete/archive a contact (only split/un-merge).
- Creating a contact manually from scratch (contacts arise from activity).
- Editing identifiers directly (add/remove a phone/email) beyond what split does.
- A staff/AdminHub-native contacts page (clients + acting-staff use the portal tab).
- Bulk operations (bulk tag, bulk export) — future.
