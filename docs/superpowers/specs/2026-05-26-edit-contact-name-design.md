# Edit Contact Name — Design

**Status:** Designed 2026-05-26, approved. Small feature on top of the live Contact Entity (Phases 1 + 2 merged/deployed). Lets a user rename a contact so a recognized-but-unlabeled caller (e.g. caller-ID name withheld) shows the right name across all their activity.

## 1. Goal & scenario
A caller withholds their CNAM (name), so the lead shows "Unknown Caller", but the front-desk staff recognizes the number/person. They should be able to set the name once and have it show for that person everywhere — now and going forward.

## 2. Decisions (approved)
1. **Scope = whole contact.** Editing sets `contacts.display_name`; it propagates to all that contact's leads/calls/forms (contact_id is backfilled).
2. **Human-set name wins.** A person-edited name is authoritative and is what's displayed for that contact, overriding the per-call auto-captured `caller_name`.
3. **Who = both staff and client-portal users**, scoped to contacts their account owns.
4. **Single free-text name field** → `display_name` (no separate first/last in v1).
5. **Display overlay scoped to the leads list + lead detail drawer** (not every name site, e.g. not historical voicemail-notification text).

## 3. Design

### 3.1 Schema (one additive migration)
`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS display_name_source TEXT NOT NULL DEFAULT 'auto';`
- `'auto'` (default) = name was auto-captured at ingest (or empty).
- `'user'` = a person set it → authoritative for display.
`resolveContact` already never overwrites a non-empty `display_name` (it `COALESCE(NULLIF(display_name,''), …)`), so future ingest won't clobber a human edit. The flag makes the intent explicit and drives the display overlay. Idempotent; no backfill needed (existing rows default `'auto'`).

### 3.2 Edit endpoint — lives in `hub.js`, NOT the staff-only contacts router
`PATCH /api/hub/contacts/:id/name`  body `{ name }`.
- **Why hub.js:** `server/routes/contacts.js` is gated `router.use(requireAuth, isStaff)` — staff-only for the whole router. This feature needs client-portal users too, so the endpoint is defined in `hub.js` (per-route `requireAuth`, client-accessible). hub.js is mounted at `/api/hub` *before* contacts.js, so `/contacts/:id/name` resolves in hub.js (no collision — contacts.js doesn't define `/name`).
- **Auth/ownership:** `requireAuth`. Resolve the requester's effective owner (`req.portalUserId` honoring `x-acting-user`; client-account via `x-client-account`). Allow if the requester is staff (`isStaff`) **or** `contacts.owner_user_id` = that effective owner. Reject cross-owner with 403/404.
- **Validation:** trim; reject empty; cap length (e.g. 200, matching `cleanName`). 
- **Write:** `UPDATE contacts SET display_name = $name, display_name_source = 'user', updated_at = NOW() WHERE id = $id AND owner_user_id = <scoped>` (owner predicate enforces tenancy in SQL too).
- **Audit (PHI):** `logSecurityEvent({ eventType: 'contact_name_update', eventCategory: 'contacts', userId: actor, details: { contactId } })` — never the name value in logs.
- **Returns:** `{ id, display_name, display_name_source }` for immediate UI update.

### 3.3 Read overlay (leads list + detail)
The `/calls` list and lead-detail responses already carry `contact_id` per row. Add the contact's `display_name` + `display_name_source` to those rows (LEFT JOIN contacts on the call's `contact_id`, owner-scoped). The **frontend** computes the shown name:
```js
displayName = (contact_display_name_source === 'user' && contact_display_name)
  ? contact_display_name
  : (caller_name || 'Unknown Caller')
```
Applied in `LeadActivityRow.jsx` (list row, currently `call?.caller_name || 'Unknown Caller'`) and the lead detail drawer header. Raw `caller_name` stays intact in the payload (explicit, not mutated).

### 3.4 UI — edit affordance in the lead detail drawer
- In the lead detail drawer (`LeadsTab.jsx` `leadDetailDrawer`), the caller-name header gets a small edit control (pencil) → inline `TextField` or a `FormDialog` prefilled with the current effective name.
- On save → `PATCH /api/hub/contacts/:id/name` → on success: update the drawer's displayed name **and** patch the matching row(s) in the leads list local state immediately (the immediate-UI hard rule — don't wait for refetch); show a success toast; failure toast on error.
- **Availability:** shown only when the lead has a `contact_id`. A fully-anonymous lead (no number *and* no email → no contact was ever resolved) has no contact to rename; the edit is hidden/disabled there in v1. (The common "CNAM withheld but number present" case *does* have a contact_id, so it works.)
- Rendered in both AdminHub and ClientPortal leads (both use the same LeadsTab/drawer), so staff and client users both get it (server enforces ownership).

## 4. Affected code
- `server/sql/migrate_contacts_display_name_source.sql` (new) + register in `server/index.js` migration chain (append-only).
- `server/routes/hub.js` — new `PATCH /contacts/:id/name`; `/calls` list + lead-detail SELECTs add contact `display_name`/`display_name_source`.
- `src/api/` (the leads/activity client module) — add the rename call.
- `src/views/client/ClientPortal/LeadsTab.jsx` + `leads/LeadActivityRow.jsx` — display overlay + edit affordance + local-state update.

## 5. Compliance
Name is PHI: endpoint is ownership-scoped server-side (not just UI), parameterized, audit-logged (no name in logs), TLS in transit, encrypted at rest per existing policy. No PHI added to logs anywhere in the path.

## 6. Verification (no test suite)
- `yarn build` + lint on touched files.
- Migration: apply on a fresh scratch DB + idempotent re-run (per the migration-testing lesson).
- Local-DB: rename a contact via the endpoint → row updates `display_name`/`display_name_source='user'`; a `/calls` fetch returns the contact name; cross-owner rename is rejected.
- Manual: in the drawer, rename a blocked-caller lead (with a number) → name shows in the drawer and the list row immediately; a second lead from the same contact shows the new name; a fully-anonymous lead has no edit control.

## 7. Out of scope (v1)
- Editing fully-anonymous (contactless) leads.
- Editing first/last separately, or other contact fields (email/phone) — a future contacts-management UI.
- Overlaying the name onto non-leads surfaces (voicemail notification text, etc.).
