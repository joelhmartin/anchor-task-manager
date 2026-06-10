# Edit Contact Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff and client-portal users rename a contact (set its name); the human-set name then shows across that contact's leads, overriding the per-call auto-captured `caller_name`.

**Architecture:** Add `contacts.display_name_source` ('auto'|'user'). A `PATCH /api/hub/contacts/:id/name` endpoint (in hub.js — client-accessible, owner-scoped like `/calls/:id/score`) sets `display_name` + `display_name_source='user'`. The `/calls` list + lead-detail attach the contact's name via a guarded `attachContactNames` post-processor (mirrors `attachLifecycleState`); the leads UI prefers the human-set name. Edit affordance lives in the lead detail drawer.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL (`pg`), React 19 + MUI. No test suite — verification = `yarn build` + `yarn lint` + local-DB scenarios via `psql postgresql://bif@localhost:5432/anchor` (NOT the prod `.env` URL).

**Spec:** `docs/superpowers/specs/2026-05-26-edit-contact-name-design.md`
**Branch:** `feat/edit-contact-name` (already created, off main).

---

## File Structure
- `server/sql/migrate_contacts_display_name_source.sql` — NEW migration (Task 1).
- `server/index.js` — register + append the migration (Task 1).
- `server/routes/hub.js` — NEW `PATCH /contacts/:id/name` (Task 2); NEW `attachContactNames` helper + wire into `/calls` pipeline (Task 3); `/calls/:id/detail` includes contact name (Task 3).
- `src/api/calls.js` — `renameContact()` (Task 4).
- `src/views/client/ClientPortal/leads/LeadActivityRow.jsx` — display overlay (Task 5).
- `src/views/client/ClientPortal/LeadsTab.jsx` — drawer edit affordance + immediate state update (Task 5).

---

## Task 1: Migration — `contacts.display_name_source`

**Files:**
- Create: `server/sql/migrate_contacts_display_name_source.sql`
- Modify: `server/index.js` (add `maybeRunContactsDisplayNameSourceMigration` + append to the migration chain)

- [ ] **Step 1: Write the migration SQL**

Create `server/sql/migrate_contacts_display_name_source.sql`:
```sql
-- Edit Contact Name: distinguish a human-set contact name from an auto-captured one.
-- 'user' = a person set contacts.display_name (authoritative for display); 'auto' = ingest-captured/empty.
-- Additive, idempotent. Instant on PG (non-volatile default → no table rewrite).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS display_name_source TEXT NOT NULL DEFAULT 'auto';
```

- [ ] **Step 2: Add the migration runner in `server/index.js`**

Find an existing `maybeRunContactsSegmentationMigration` function (added by the contact-entity work) and add a sibling right after it:
```js
async function maybeRunContactsDisplayNameSourceMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_contacts_display_name_source.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_contacts_display_name_source.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_contacts_display_name_source.sql', err.message);
  }
}
```

- [ ] **Step 3: Append to the migration chain**

In the `app.listen` migration `.then(...)` chain, find `.then(maybeRunContactsSegmentationMigration)` and add the new one immediately after it (append-only, per CLAUDE.md gotcha #3):
```js
    .then(maybeRunContactsSegmentationMigration)
    .then(maybeRunContactsDisplayNameSourceMigration)
```

- [ ] **Step 4: Verify on a FRESH scratch DB (not local `anchor` — it would mask issues)**

```bash
psql "postgresql://bif@localhost:5432/postgres" -c "DROP DATABASE IF EXISTS anchor_dnstest;" -c "CREATE DATABASE anchor_dnstest;"
psql "postgresql://bif@localhost:5432/anchor_dnstest" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE TABLE contacts (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), display_name TEXT);"
psql "postgresql://bif@localhost:5432/anchor_dnstest" -v ON_ERROR_STOP=1 -f server/sql/migrate_contacts_display_name_source.sql && echo "RUN1 OK"
psql "postgresql://bif@localhost:5432/anchor_dnstest" -v ON_ERROR_STOP=1 -f server/sql/migrate_contacts_display_name_source.sql && echo "RUN2 OK (idempotent)"
psql "postgresql://bif@localhost:5432/anchor_dnstest" -tAc "SELECT column_name, column_default FROM information_schema.columns WHERE table_name='contacts' AND column_name='display_name_source';"
psql "postgresql://bif@localhost:5432/postgres" -c "DROP DATABASE anchor_dnstest;"
```
Expected: `RUN1 OK`, `RUN2 OK`, and the column reported with default `'auto'::text`.

- [ ] **Step 5: Apply to local dev DB + node check**

```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 -f server/sql/migrate_contacts_display_name_source.sql
node --check server/index.js && echo OK
```
Expected: applies cleanly; `OK`.

- [ ] **Step 6: Commit**

```bash
git add server/sql/migrate_contacts_display_name_source.sql server/index.js
git commit -m "feat(contacts): add display_name_source column (migration)"
```

---

## Task 2: Endpoint — `PATCH /api/hub/contacts/:id/name`

**Files:**
- Modify: `server/routes/hub.js` (add the route; it must be in hub.js, NOT the staff-only contacts.js router)

- [ ] **Step 1: Add the route**

Place it near the other `/calls`/`/contacts` client-facing routes in `hub.js` (e.g. just before `router.post('/calls/:id/score'`). It mirrors the ownership scoping of `/calls/:id/score` (`targetUserId = req.portalUserId || req.user.id`; staff viewing a client operate via actingClient so `targetUserId` is the client = the contact's `owner_user_id`). `logSecurityEvent` is already imported/used in hub.js (confirm with `grep -n "logSecurityEvent" server/routes/hub.js`; if not imported, import it from `../services/security/audit.js` matching contacts.js).
```js
// PATCH /contacts/:id/name — rename a contact (human-set, authoritative for display).
// In hub.js (not the staff-only contacts router) so client-portal users can rename their
// own contacts too. Owner-scoped like /calls/:id/score.
router.patch('/contacts/:id/name', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const contactId = req.params.id;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ message: 'A name is required.' });
  if (name.length > 200) return res.status(400).json({ message: 'Name is too long (max 200 characters).' });
  try {
    const { rows } = await query(
      `UPDATE contacts SET display_name = $1, display_name_source = 'user', updated_at = NOW()
       WHERE id = $2 AND owner_user_id = $3
       RETURNING id, display_name, display_name_source`,
      [name, contactId, targetUserId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contact not found.' });
    // PHI: audit the change — never log the name value.
    await logSecurityEvent({
      userId: req.user.id,
      eventType: 'contact_name_update',
      eventCategory: 'contacts',
      success: true,
      details: { contactId, ownerUserId: targetUserId }
    });
    res.json({ contact: rows[0] });
  } catch (err) {
    console.error('[contacts:name]', { code: err?.code });
    res.status(500).json({ message: 'Failed to update name.' });
  }
});
```

- [ ] **Step 2: Verify build + lint + node check**

```bash
yarn build 2>&1 | tail -3
node --check server/routes/hub.js && echo OK
npx eslint server/routes/hub.js 2>&1 | grep -iE "error" | grep -v "50_000" | head
```
Expected: build succeeds; `OK`; no new errors (pre-existing `50_000` parse error is unrelated).

- [ ] **Step 3: Local-DB endpoint behavior check (SQL-level, proves the UPDATE + scoping)**

```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name, display_name_source) VALUES (:'u','Auto Name','auto') RETURNING id AS c \gset
-- owner match → updates
UPDATE contacts SET display_name='Set Name', display_name_source='user', updated_at=NOW() WHERE id=:'c' AND owner_user_id=:'u' RETURNING display_name, display_name_source;
-- wrong owner → 0 rows (scoping works)
SELECT count(*) AS wrong_owner_rows FROM contacts WHERE id=:'c' AND owner_user_id='00000000-0000-0000-0000-000000000000';
ROLLBACK;
SQL
```
Expected: update returns `Set Name | user`; `wrong_owner_rows = 0`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(contacts): PATCH /hub/contacts/:id/name rename endpoint (owner-scoped, audited)"
```

---

## Task 3: Read overlay — `attachContactNames` + wire into `/calls` + detail

**Files:**
- Modify: `server/routes/hub.js` (add `attachContactNames`; call it in the `/calls` pipeline after each `attachLifecycleState`; add contact fields to `/calls/:id/detail`)

- [ ] **Step 1: Add the `attachContactNames` helper**

Place it near `attachLifecycleState` in `hub.js`. It batch-fetches the page's contacts and attaches `contact_display_name` + `contact_name_source` to each call. Guarded so a missing column/table (startup window / pre-migration) degrades to no overlay.
```js
// Attach the contact's name to each call so the UI can prefer a human-set name over the
// per-call caller_name. Guarded: if the contacts schema/column isn't present yet, returns
// calls unchanged (UI falls back to caller_name).
async function attachContactNames(ownerId, calls = []) {
  const contactIds = [...new Set(calls.map((c) => c.contact_id).filter(Boolean))];
  if (!contactIds.length) return calls;
  try {
    const { rows } = await query(
      `SELECT id, display_name, display_name_source FROM contacts
       WHERE id = ANY($1) AND owner_user_id = $2`,
      [contactIds, ownerId]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return calls.map((c) => {
      const co = c.contact_id ? byId.get(c.contact_id) : null;
      return co
        ? { ...c, contact_display_name: co.display_name, contact_name_source: co.display_name_source }
        : c;
    });
  } catch (err) {
    console.error('[attachContactNames] skipped (non-fatal)', { code: err?.code });
    return calls;
  }
}
```

- [ ] **Step 2: Wire it into the `/calls` pipeline(s)**

Find every `attachLifecycleState(targetUserId, ...)` call in the `/calls` handler (`grep -n "await attachLifecycleState(targetUserId" server/routes/hub.js` — there are ~2: the cached path ~L5671 and the fresh/shaped path ~L5923). After EACH, add an `attachContactNames` line on the same variable. Example for the cached path:
```js
  cachedCalls = await attachLifecycleState(targetUserId, cachedCalls);
  cachedCalls = await attachContactNames(targetUserId, cachedCalls);
```
And for the shaped path:
```js
    shaped = await attachLifecycleState(targetUserId, shaped);
    shaped = await attachContactNames(targetUserId, shaped);
```
(Match the actual variable name at each site.)

- [ ] **Step 3: Add contact name to `/calls/:id/detail`**

In `router.get('/calls/:id/detail', ...)` (~L6722), after the lead row is loaded, surface the contact's name so the drawer header + edit can prefill. Read the handler; if it returns a `lead`/`call` object with `contact_id`, add (using the call's `contact_id` and `targetUserId`):
```js
    // Contact name overlay for the drawer header + rename prefill.
    let contactName = null, contactNameSource = null;
    if (<the lead row>.contact_id) {
      try {
        const cn = await query(
          'SELECT display_name, display_name_source FROM contacts WHERE id = $1 AND owner_user_id = $2',
          [<the lead row>.contact_id, targetUserId]
        );
        contactName = cn.rows[0]?.display_name || null;
        contactNameSource = cn.rows[0]?.display_name_source || null;
      } catch (err) { console.error('[calls:detail:contactName]', { code: err?.code }); }
    }
```
and include `contact_id`, `contact_display_name: contactName`, `contact_name_source: contactNameSource` in the detail JSON response object. (Read the handler to use its actual row variable + response shape; if it already returns `contact_id`, reuse it.)

- [ ] **Step 4: Verify build + lint + node check**

```bash
yarn build 2>&1 | tail -3
node --check server/routes/hub.js && echo OK
npx eslint server/routes/hub.js 2>&1 | grep -iE "error" | grep -v "50_000" | head
```
Expected: build succeeds; `OK`; no new errors.

- [ ] **Step 5: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(contacts): overlay contact name onto /calls list + detail (guarded)"
```

---

## Task 4: Frontend API — `renameContact`

**Files:**
- Modify: `src/api/calls.js`

- [ ] **Step 1: Add the API function**

Add near the other call helpers in `src/api/calls.js`:
```js
// Rename the contact behind a lead (human-set name; shows across the contact's activity).
export function renameContact(contactId, name) {
  return client.patch(`/hub/contacts/${contactId}/name`, { name }).then((res) => res.data.contact);
}
```

- [ ] **Step 2: Verify lint + build**

```bash
npx eslint src/api/calls.js 2>&1 | tail -3
yarn build 2>&1 | tail -3
```
Expected: no new errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/api/calls.js
git commit -m "feat(contacts): renameContact API client"
```

---

## Task 5: Frontend — display overlay + drawer edit affordance

**Files:**
- Modify: `src/views/client/ClientPortal/leads/LeadActivityRow.jsx` (display overlay)
- Modify: `src/views/client/ClientPortal/LeadsTab.jsx` (drawer edit affordance + immediate state update)

- [ ] **Step 1: List row — prefer the human-set contact name**

In `LeadActivityRow.jsx`, change line 82 from:
```js
  const callerName = call?.caller_name || 'Unknown Caller';
```
to:
```js
  const callerName = (call?.contact_name_source === 'user' && call?.contact_display_name)
    ? call.contact_display_name
    : (call?.caller_name || 'Unknown Caller');
```

- [ ] **Step 2: Drawer — add an editable name with inline save**

In `LeadsTab.jsx`, the lead detail drawer renders the caller name in its header. Read the drawer JSX (search for where `leadDetailDrawer.detail`/`leadDetailDrawer.lead` caller name is shown). Add a small edit control next to it. Import the API + toast at top:
```js
import { renameContact } from 'api/calls';
// useToast is already imported in this file (confirm: grep -n "useToast" src/views/client/ClientPortal/LeadsTab.jsx)
```
Add local state near the other drawer state (`const [leadDetailDrawer, setLeadDetailDrawer] = ...`):
```js
  const [renameState, setRenameState] = useState({ editing: false, value: '', saving: false });
```
Compute the effective name + the contact id from the open lead/detail (use the same preference rule as the row):
```js
  const openLead = leadDetailDrawer.detail || leadDetailDrawer.lead;
  const openContactId = openLead?.contact_id || null;
  const effectiveName = (openLead?.contact_name_source === 'user' && openLead?.contact_display_name)
    ? openLead.contact_display_name
    : (openLead?.caller_name || 'Unknown Caller');
```
Render: show `effectiveName` with a pencil `IconButton` (only when `openContactId` is truthy) that sets `renameState.editing = true` and seeds `value` with the current contact name (or ''). When editing, show a `TextField` + Save/Cancel (`LoadingButton` for Save). Save handler:
```js
  const handleSaveName = useCallback(async () => {
    if (!openContactId) return;
    const name = renameState.value.trim();
    if (!name) return;
    setRenameState((s) => ({ ...s, saving: true }));
    try {
      const updated = await renameContact(openContactId, name);
      // Immediate UI update (do NOT wait for refetch): update the drawer + every list row
      // for this contact.
      setLeadDetailDrawer((prev) => ({
        ...prev,
        detail: prev.detail ? { ...prev.detail, contact_display_name: updated.display_name, contact_name_source: updated.display_name_source } : prev.detail,
        lead: prev.lead ? { ...prev.lead, contact_display_name: updated.display_name, contact_name_source: updated.display_name_source } : prev.lead
      }));
      setCalls((prev) => prev.map((c) => (c.contact_id === openContactId
        ? { ...c, contact_display_name: updated.display_name, contact_name_source: updated.display_name_source }
        : c)));
      setRenameState({ editing: false, value: '', saving: false });
      triggerMessage?.('Name updated', 'success');
    } catch (err) {
      setRenameState((s) => ({ ...s, saving: false }));
      triggerMessage?.('Couldn’t update the name. Please try again.', 'error');
    }
  }, [openContactId, renameState.value, triggerMessage]);
```
NOTE: confirm the actual list-state setter name (the file uses some `setCalls`-like setter feeding the rows — `grep -n "setCalls\|const \[calls" src/views/client/ClientPortal/LeadsTab.jsx`) and the toast helper name (`triggerMessage` is used elsewhere in this file per existing code — confirm via grep; use whatever this file already uses). Use the existing `LoadingButton` (`ui-component/extended/LoadingButton`) + `TextField` for the inline editor. Keep it minimal — no new shared component needed.

- [ ] **Step 3: Verify build + lint**

```bash
yarn build 2>&1 | tail -5
npx eslint src/views/client/ClientPortal/leads/LeadActivityRow.jsx src/views/client/ClientPortal/LeadsTab.jsx 2>&1 | tail -3
```
Expected: build succeeds; no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/client/ClientPortal/leads/LeadActivityRow.jsx src/views/client/ClientPortal/LeadsTab.jsx
git commit -m "feat(contacts): rename contact from the lead drawer + prefer human-set name in leads"
```

---

## Task 6: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full build + lint**

```bash
yarn build && npx eslint server/routes/hub.js src/api/calls.js src/views/client/ClientPortal/LeadsTab.jsx src/views/client/ClientPortal/leads/LeadActivityRow.jsx 2>&1 | grep -iE "  error  " | grep -v "50_000" | head
```
Expected: build succeeds; no new errors (the pre-existing hub.js `50_000` numeric-separator parse error is unrelated).

- [ ] **Step 2: End-to-end local-DB scenario**

```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name, display_name_source) VALUES (:'u','','auto') RETURNING id AS c \gset
INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10) VALUES (:'c',:'u','5553330001');
-- two leads for the same contact, both with blocked/blank caller name
INSERT INTO call_logs (owner_user_id,user_id,call_id,from_number,contact_id,activity_type,meta) VALUES
  (:'u',:'u','__en1__','555-333-0001',:'c','call','{}'),
  (:'u',:'u','__en2__','555-333-0001',:'c','call','{}');
-- rename the contact (simulates the endpoint)
UPDATE contacts SET display_name='Jane Recognized', display_name_source='user' WHERE id=:'c' AND owner_user_id=:'u';
-- both leads now resolve the human-set name via the overlay query
SELECT cl.call_id, co.display_name, co.display_name_source
  FROM call_logs cl JOIN contacts co ON co.id = cl.contact_id
  WHERE cl.contact_id = :'c' ORDER BY cl.call_id;
ROLLBACK;
SQL
```
Expected: both `__en1__` and `__en2__` rows show `Jane Recognized | user`.

- [ ] **Step 3: Push + open PR**

```bash
git push origin feat/edit-contact-name
gh pr create --base main --title "feat(contacts): edit contact name (rename → shows across leads)" --body "Implements docs/superpowers/specs/2026-05-26-edit-contact-name-design.md. Adds contacts.display_name_source, an owner-scoped PATCH /hub/contacts/:id/name (staff + client), a guarded attachContactNames overlay on /calls + detail, and a rename affordance in the lead drawer. Human-set name wins on display. Migration is additive/idempotent."
```

- [ ] **Step 4: Trigger CodeRabbit, address findings, then merge** (per workflow — comment `@coderabbitai review`, wait, fix, re-review until clean; then merge on user's go).

---

## Notes for the executor
- **Endpoint MUST be in hub.js**, not `server/routes/contacts.js` (that router is gated `requireAuth, isStaff` for the whole router — client users couldn't reach it). hub.js mounts first at `/api/hub`, so `/contacts/:id/name` resolves there.
- **Ownership** mirrors `/calls/:id/score`: `targetUserId = req.portalUserId || req.user.id`, scope `owner_user_id = targetUserId`. Staff edit via the actingClient context (same as every other lead action), so no separate `isStaff` branch is needed.
- **Overlay is guarded** — `attachContactNames` and the detail lookup swallow errors so a pre-migration / missing-column window degrades to showing `caller_name` (never breaks the leads list).
- **Immediate UI update** is a hard rule: on save, patch the drawer + matching list rows from the endpoint response; don't rely on a refetch.
- Migration verified on a FRESH scratch DB (local `anchor` already has the column after Task 1 Step 5, so it would mask a first-apply bug).
