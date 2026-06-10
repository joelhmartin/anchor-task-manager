# Contacts UI — Phase C: Merge Queue + Split (staff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give staff a UI to resolve the pending merge-candidates queue (merge / dismiss — endpoints exist) and a `split` (un-merge) capability + UI to break a wrongly-grouped person out of a contact into a new one. Staff-only.

**Architecture:** New staff-only `POST /contacts/:id/split` in `contacts.js` (transactional + audited, mirrors the existing `merge` endpoint). Per spec §3, split reassigns `call_logs`, `client_journeys`, AND `active_clients` whose identifier matches the split-off phone/email — not just call_logs. Response shape: `{ ok, sourceId, newContactId, moved: { calls, journeys, activeClients } }`. A merge-queue resolver section in the Contacts tab (staff-gated) over the existing `GET /contacts/merge-candidates` + `POST /contacts/merge` + dismiss. A split dialog launched from the profile drawer (staff). Both fully owner-isolated; nothing is deleted on split (both contacts kept).

**Tech Stack:** Node 20 ESM, Express, PostgreSQL; React 19 + MUI. No test suite — verify with `yarn build` + lint + local-DB transactional scenarios (`psql postgresql://bif@localhost:5432/anchor`).

**Spec:** `docs/superpowers/specs/2026-05-27-contacts-management-ui-design.md` (§3 split, §4 Phase C, §2.5 split=un-merge keep-both).
**Branch:** `feat/contacts-management`. **Depends on Phases A + B** (the tab + profile drawer) and the existing Phase-4 merge endpoints (`contacts.js`).

---

## File Structure
- `server/routes/contacts.js` — NEW `POST /contacts/:id/split` (staff-only, transactional).
- `src/api/contacts.js` — `splitContact`; plus `fetchMergeCandidates`, `mergeContacts`, `dismissMergeCandidate` (wrap the existing endpoints).
- `src/views/client/ClientPortal/contacts/MergeQueuePanel.jsx` — NEW staff-only queue resolver.
- `src/views/client/ClientPortal/contacts/SplitContactDialog.jsx` — NEW staff split dialog.
- `src/views/client/ClientPortal/ContactsTab.jsx` — staff-gated entry to the merge queue.
- `src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx` — wire the split dialog (staff).

---

## Task 1: `POST /hub/contacts/:id/split` (staff-only, transactional)

**Files:** Modify `server/routes/contacts.js`

- [ ] **Step 1: Add the route.** Read the existing `POST /contacts/merge` handler in `contacts.js` first — mirror its structure (`getClient()` inside a guarded try, `BEGIN`, `FOR UPDATE` locks, owner checks, audit, `client.release()` in finally). The router is already `requireAuth, isStaff`.

Semantics: split off ONE identifier (a phone or email row) from `:id` into a NEW contact under the same owner, and move the activity that belongs to that identifier. "Belongs to" = `call_logs` whose normalized `from_number` (for a phone) or `meta->>'caller_email'` (for an email) matches the split-off identifier; reassign those rows' `contact_id` to the new contact. Leave the rest on the original.

```js
// POST /contacts/:id/split { identifierType: 'phone'|'email', identifierId } — un-merge:
// move one identifier + its matching activity into a NEW contact. Original is kept.
router.post('/contacts/:id/split', async (req, res) => {
  const sourceId = req.params.id;
  const { identifierType, identifierId } = req.body || {};
  if (!['phone', 'email'].includes(identifierType) || !identifierId) {
    return res.status(400).json({ message: 'identifierType (phone|email) and identifierId are required' });
  }
  let client;
  try {
    client = await getClient();
    await client.query('BEGIN');
    const src = await client.query('SELECT id, owner_user_id, display_name FROM contacts WHERE id = $1 FOR UPDATE', [sourceId]);
    if (!src.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Contact not found.' }); }
    const owner = src.rows[0].owner_user_id;

    // Load the identifier to split off (must belong to the source contact).
    const idTable = identifierType === 'phone' ? 'contact_phones' : 'contact_emails';
    const idRow = await client.query(`SELECT * FROM ${idTable} WHERE id = $1 AND contact_id = $2`, [identifierId, sourceId]);
    if (!idRow.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Identifier not found on this contact.' }); }
    const ident = idRow.rows[0];

    // Create the new contact (anchored on the split-off identifier).
    const ins = await client.query(
      `INSERT INTO contacts (owner_user_id, display_name, primary_phone, primary_email, first_seen_at, last_activity_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
      [owner, null,
       identifierType === 'phone' ? (ident.phone_e164 || null) : null,
       identifierType === 'email' ? ident.email : null]
    );
    const newId = ins.rows[0].id;

    // Move the identifier row to the new contact (is_primary on the new one).
    await client.query(`UPDATE ${idTable} SET contact_id = $1, is_primary = true WHERE id = $2`, [newId, identifierId]);

    // Reassign matching activity AND lifecycle rows. Per spec §3, split moves call_logs,
    // client_journeys, AND active_clients whose identifier matches the split-off phone/email.
    // Heuristic: phone → last-10 digits of from_number/client_phone matches phone_digits10;
    // email → lower(meta->>'caller_email')/lower(client_email) matches lower(email).
    let movedCalls = 0;
    let movedJourneys = 0;
    let movedActiveClients = 0;
    if (identifierType === 'phone') {
      const r1 = await client.query(
        `UPDATE call_logs SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND RIGHT(REGEXP_REPLACE(COALESCE(from_number,''), '[^0-9]', '', 'g'), 10) = $3`,
        [newId, sourceId, ident.phone_digits10, owner]
      );
      movedCalls = r1.rowCount;
      const r2 = await client.query(
        `UPDATE client_journeys SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND RIGHT(REGEXP_REPLACE(COALESCE(client_phone,''), '[^0-9]', '', 'g'), 10) = $3`,
        [newId, sourceId, ident.phone_digits10, owner]
      );
      movedJourneys = r2.rowCount;
      const r3 = await client.query(
        `UPDATE active_clients SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND RIGHT(REGEXP_REPLACE(COALESCE(client_phone,''), '[^0-9]', '', 'g'), 10) = $3`,
        [newId, sourceId, ident.phone_digits10, owner]
      );
      movedActiveClients = r3.rowCount;
    } else {
      const r1 = await client.query(
        `UPDATE call_logs SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND LOWER(meta->>'caller_email') = LOWER($3)`,
        [newId, sourceId, ident.email, owner]
      );
      movedCalls = r1.rowCount;
      const r2 = await client.query(
        `UPDATE client_journeys SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND LOWER(COALESCE(client_email,'')) = LOWER($3)`,
        [newId, sourceId, ident.email, owner]
      );
      movedJourneys = r2.rowCount;
      const r3 = await client.query(
        `UPDATE active_clients SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND LOWER(COALESCE(client_email,'')) = LOWER($3)`,
        [newId, sourceId, ident.email, owner]
      );
      movedActiveClients = r3.rowCount;
    }

    await client.query('COMMIT');
    await logSecurityEvent({
      userId: req.user.id, eventType: 'contact_split', eventCategory: 'contacts', success: true,
      details: { ownerUserId: owner, sourceId, newId, identifierType, movedCalls, movedJourneys, movedActiveClients }
    });
    res.json({ ok: true, sourceId, newContactId: newId, moved: { calls: movedCalls, journeys: movedJourneys, activeClients: movedActiveClients } });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[contacts:split]', { code: err?.code });
    res.status(500).json({ message: 'Split failed.' });
  } finally {
    if (client) client.release();
  }
});
```
(`getClient`, `logSecurityEvent` are already imported in contacts.js — confirm via grep. The owner-scoped composite FK on `call_logs(contact_id, owner_user_id)` is `DEFERRABLE INITIALLY DEFERRED`, so moving rows to `newId` (same owner) is fine.)

- [ ] **Step 2: Verify** — `yarn build`; `node --check server/routes/contacts.js && echo OK`; lint clean.
- [ ] **Step 3: Local-DB transactional test** (split moves call_logs + journey + active_client for the matching identifier; keeps both; owner intact):
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
-- one contact wrongly holding two numbers + a call from each + a journey/client tied to phone 1
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','Shared Line') RETURNING id AS c \gset
INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10, phone_e164, is_primary) VALUES
  (:'c',:'u','5556660001','+15556660001',true) RETURNING id AS pid \gset
INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10, phone_e164) VALUES (:'c',:'u','5556660002','+15556660002');
INSERT INTO call_logs (owner_user_id,user_id,call_id,from_number,contact_id,activity_type,meta) VALUES
  (:'u',:'u','__sp1__','555-666-0001',:'c','call','{}'),
  (:'u',:'u','__sp2__','555-666-0002',:'c','call','{}');
INSERT INTO client_journeys (owner_user_id, client_name, client_phone, contact_id) VALUES
  (:'u','Wrong Person','+15556660001',:'c') RETURNING id AS j \gset
INSERT INTO active_clients (owner_user_id, client_name, client_phone, contact_id) VALUES
  (:'u','Wrong Person','+15556660001',:'c') RETURNING id AS ac \gset
-- simulate the split: phone pid (5556660001) → new contact, and move matching rows
INSERT INTO contacts (owner_user_id) VALUES (:'u') RETURNING id AS n \gset
UPDATE contact_phones SET contact_id=:'n', is_primary=true WHERE id=:'pid';
UPDATE call_logs       SET contact_id=:'n' WHERE contact_id=:'c' AND owner_user_id=:'u' AND RIGHT(REGEXP_REPLACE(COALESCE(from_number,''),'[^0-9]','','g'),10)='5556660001';
UPDATE client_journeys SET contact_id=:'n' WHERE contact_id=:'c' AND owner_user_id=:'u' AND RIGHT(REGEXP_REPLACE(COALESCE(client_phone,''),'[^0-9]','','g'),10)='5556660001';
UPDATE active_clients  SET contact_id=:'n' WHERE contact_id=:'c' AND owner_user_id=:'u' AND RIGHT(REGEXP_REPLACE(COALESCE(client_phone,''),'[^0-9]','','g'),10)='5556660001';
SELECT call_id, contact_id=:'n' AS on_new FROM call_logs WHERE call_id IN ('__sp1__','__sp2__') ORDER BY call_id;
SELECT (SELECT contact_id=:'n' FROM client_journeys WHERE id=:'j') AS journey_on_new,
       (SELECT contact_id=:'n' FROM active_clients  WHERE id=:'ac') AS active_client_on_new;
SELECT (SELECT count(*) FROM contacts WHERE id IN (:'c',:'n')) AS both_exist;
ROLLBACK;
SQL
```
Expected: `__sp1__ | t`, `__sp2__ | f`; `journey_on_new=t`; `active_client_on_new=t`; `both_exist=2`.

- [ ] **Step 4: Commit** — `git commit -am "feat(contacts): POST /hub/contacts/:id/split (un-merge, transactional, staff-only)"`

---

## Task 2: API client (split + merge-queue wrappers)

**Files:** Modify `src/api/contacts.js`

- [ ] **Step 1:** Add:
```js
export function fetchMergeCandidates(status = 'pending') {
  return client.get('/hub/contacts/merge-candidates', { params: { status } }).then((res) => res.data.candidates || []);
}
export function mergeContacts(keepId, mergeId, candidateId) {
  return client.post('/hub/contacts/merge', { keepId, mergeId, candidateId }).then((res) => res.data);
}
export function dismissMergeCandidate(candidateId) {
  return client.post(`/hub/contacts/merge-candidates/${candidateId}/dismiss`).then((res) => res.data);
}
export function splitContact(id, identifierType, identifierId) {
  return client.post(`/hub/contacts/${id}/split`, { identifierType, identifierId }).then((res) => res.data);
}
```
- [ ] **Step 2: Verify** — lint clean; `yarn build` ok.
- [ ] **Step 3: Commit** — `git commit -am "feat(contacts): split + merge-queue API client"`

---

## Task 3: Merge queue panel (staff-only)

**Files:** Create `src/views/client/ClientPortal/contacts/MergeQueuePanel.jsx`

- [ ] **Step 1: Build it.** A list of pending `fetchMergeCandidates()` rows; each shows both sides (keep_name/keep_phone/keep_email vs other_name/other_phone/other_email — fields returned by the existing endpoint) with **Merge** and **Dismiss** actions. Merge → `ConfirmDialog` ("Merge these two contacts? Activity from the second moves to the first; this can't be auto-undone.") → `mergeContacts(keep, other, candidateId)` → on success remove the row + toast. Dismiss → `dismissMergeCandidate(id)` → remove row + toast. Use `DataTable` or a simple `Stack` of `SubCard`s; `LoadingButton`, `ConfirmDialog`, `useToast`, `EmptyState` ("No pending merges"). Immediate local-state update on resolve.

- [ ] **Step 2: Verify** — `yarn build 2>&1 | tail -5` (succeeds); lint clean.
- [ ] **Step 3: Commit** — `git add src/views/client/ClientPortal/contacts/MergeQueuePanel.jsx && git commit -m "feat(contacts): merge-candidates queue resolver (staff)"`

---

## Task 4: Split dialog (staff)

**Files:** Create `src/views/client/ClientPortal/contacts/SplitContactDialog.jsx`

- [ ] **Step 1: Build it.** Props `{ open, contact, phones, emails, onClose, onSplit }`. A `FormDialog` listing the contact's identifiers (phones + emails) with a radio/select to choose ONE to break out; explanatory text ("This moves the selected number/email and its activity into a new separate contact. The original is kept."). Confirm → `splitContact(contact.id, type, identifierId)` → on success call `onSplit(result)` (so the drawer/list can refresh) + toast; close. `LoadingButton` for the action; `useToast`. No `window.confirm`.

- [ ] **Step 2: Verify** — `yarn build`; lint clean.
- [ ] **Step 3: Commit** — `git add src/views/client/ClientPortal/contacts/SplitContactDialog.jsx && git commit -m "feat(contacts): split contact dialog (staff)"`

---

## Task 5: Wire staff entries (merge queue + split)

**Files:** Modify `ContactsTab.jsx` (merge queue) + `ContactProfileDrawer.jsx` (split)

- [ ] **Step 1: Staff gating.** Determine the staff flag in the portal context (grep how other components detect role — e.g. an auth context `user.role` in ['admin','team','superadmin'], or an `isStaff` already threaded through ClientPortal). Use that single source.

- [ ] **Step 2: Merge queue in ContactsTab.** When `isStaff`, render a toggle/button "Review merges (N)" that opens `MergeQueuePanel` (in a `Drawer` or a dialog, or a sub-section). After a merge/dismiss resolves, optionally refresh the contacts list. Hidden for non-staff.

- [ ] **Step 3: Split in the drawer.** In `ContactProfileDrawer`, replace the Phase-B-hidden "Merge into…/split" placeholder with a staff-only **Split** button that opens `SplitContactDialog` (passing the loaded `phones`/`emails`). `onSplit` → refresh the drawer (`fetchContact`) + toast; the new contact appears in the list on next load.

- [ ] **Step 4: Verify** — `yarn build 2>&1 | tail -5` (succeeds); lint clean; `grep -n "MergeQueuePanel\|SplitContactDialog\|isStaff" src/views/client/ClientPortal/ContactsTab.jsx src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx`.
- [ ] **Step 5: Commit** — `git commit -am "feat(contacts): wire staff merge-queue + split into Contacts tab/drawer"`

---

## Task 6: Verify + PR

- [ ] **Step 1:** `yarn build` + lint (no new errors) across touched files.
- [ ] **Step 2:** Re-run the split transactional local-DB test (Task 1 Step 3) and confirm: the moved activity follows the identifier, the rest stays, both contacts exist, owner unchanged. Confirm split is staff-only (the route is on the `isStaff` router).
- [ ] **Step 3:** Push + PR (`feat(contacts): merge queue + split (Phase C)`), CodeRabbit, merge on user's go.

## Notes for the executor
- Split is on the **staff-only** `contacts.js` router — do NOT add it to hub.js.
- Split **keeps both contacts** — never delete the source.
- Mirror the existing `merge` endpoint's transaction/lock/audit shape exactly.
- Split's "which activity moves" is by identifier match (phone last-10 / lower(email)); document this in the PR so reviewers know the heuristic.
- No migration in this phase.
