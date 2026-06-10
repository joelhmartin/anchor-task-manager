# Contacts Master List — Phase 4: UI (filters, services, CSV, archive)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** Make `ContactsTab` the master list — Status (incl. Archived) / Service / Date filters, a Services column, and an **Export CSV** button — and add to `ContactProfileDrawer` a **Services history** section plus inline **archive/unarchive**. Includes the small backend `PATCH /hub/contacts/:id/archive` the inline control needs.

**Architecture:** Frontend builds on the Phase A `ContactsTab` + Phase B `ContactProfileDrawer`. CSV download via an authed blob fetch. Archive is a tiny owner-scoped, audited endpoint. Status filter maps the existing lifecycle values + `archived`.

**Tech Stack:** React 19 + MUI; Node/Express backend. Verify with `yarn build` + `node --check` + local-DB + lint.

**Spec:** §3, §5, §6. **Depends on:** Phase 3 (filters + export API).

---

## File Structure
- Modify: `server/routes/hub.js` — `PATCH /contacts/:id/archive`.
- Modify: `src/api/contacts.js` — `exportContactsCsv`, `archiveContact`.
- Modify: `src/views/client/ClientPortal/ContactsTab.jsx` — status/service/date filters, Services column, Export CSV button.
- Modify: `src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx` — Services history section + inline archive/unarchive (+ `GET /contacts/:id` should return services; add if missing).

---

## Task 1: Archive endpoint

**Files:** Modify `server/routes/hub.js` (place near the other `/contacts/:id/*` client routes; reuse the `CONTACT_ROUTE_UUID_RE` const added in Phase B).

- [ ] **Step 1: Add the route.**
```js
// PATCH /contacts/:id/archive { archived: boolean } — owner-scoped soft archive/restore.
router.patch('/contacts/:id/archive', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  const archived = req.body?.archived;
  if (typeof archived !== 'boolean') return res.status(400).json({ message: 'archived (boolean) is required.' });
  try {
    const { rows } = await query(
      `UPDATE contacts SET archived_at = CASE WHEN $3 THEN NOW() ELSE NULL END, updated_at = NOW()
         WHERE id = $1 AND owner_user_id = $2 RETURNING id, archived_at`,
      [req.params.id, targetUserId, archived]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contact not found.' });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_archive', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, archived } });
    res.json({ contact: rows[0] });
  } catch (err) { console.error('[contacts:archive]', { code: err?.code }); res.status(500).json({ message: 'Failed to update archive state.' }); }
});
```

- [ ] **Step 2: Ensure `GET /contacts/:id` returns the services history** (for the drawer). In the Phase B profile handler, add a `contact_services` read to the `Promise.all` and include it in the response:
```js
      query(`SELECT cs.id, cs.service_id, cs.service_name, cs.source, cs.source_ref_id, cs.created_at
               FROM contact_services cs WHERE cs.contact_id = $1 ORDER BY cs.created_at DESC`, [id]),
```
…and add `services: services.rows` to the `res.json({...})` (name the destructured var `services`).

- [ ] **Step 3: Verify.** `node --check server/routes/hub.js && echo OK`; `yarn build 2>&1 | tail -3`; eslint clean.

- [ ] **Step 4: Local-DB** — archive then restore a contact, confirm `archived_at` flips and the audit row lands:
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','Arch Test') RETURNING id AS c \gset
UPDATE contacts SET archived_at = CASE WHEN true THEN NOW() ELSE NULL END WHERE id=:'c' AND owner_user_id=:'u';
SELECT archived_at IS NOT NULL AS archived FROM contacts WHERE id=:'c';
UPDATE contacts SET archived_at = CASE WHEN false THEN NOW() ELSE NULL END WHERE id=:'c' AND owner_user_id=:'u';
SELECT archived_at IS NULL AS restored FROM contacts WHERE id=:'c';
ROLLBACK;
SQL
```
Expect `archived=t` then `restored=t`.

- [ ] **Step 5: Commit.** `git add server/routes/hub.js && git commit -m "feat(contacts): archive/unarchive endpoint + services in profile"`

---

## Task 2: API client

**Files:** Modify `src/api/contacts.js`.

- [ ] **Step 1: Add.**
```js
export function archiveContact(id, archived) {
  return client.patch(`/hub/contacts/${id}/archive`, { archived }).then((res) => res.data);
}

// Authed CSV download of the filtered set; returns a Blob.
export function exportContactsCsv(params = {}) {
  return client.get('/hub/contacts/export.csv', { params, responseType: 'blob' }).then((res) => res.data);
}
```

- [ ] **Step 2: Verify.** eslint clean; `yarn build 2>&1 | tail -3`.

- [ ] **Step 3: Commit.** `git add src/api/contacts.js && git commit -m "feat(contacts): archiveContact + exportContactsCsv API client"`

---

## Task 3: ContactsTab — status/service/date filters, Services column, Export CSV

**Files:** Modify `src/views/client/ClientPortal/ContactsTab.jsx`.

- [ ] **Step 1: Replace the lifecycle filter with a Status filter** (add `Archived`), and add Service + Date filters. Update `LIFECYCLE_OPTIONS` → `STATUS_OPTIONS`:
```js
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'lead', label: 'New Lead' },
  { value: 'in_journey', label: 'In Journey' },
  { value: 'active_client', label: 'Active Client' },
  { value: 'archived', label: 'Archived' }
];
```
Add state `statusFilter` (replaces `lifecycleFilter`), `serviceFilter`, `dateFrom`, `dateTo`. Load the owner's services for the Service dropdown via a new `fetchServices()` if one exists (`grep -rn "fetchServices\|/hub/services\|api/services" src/api`) — reuse the existing services API; otherwise add a tiny `GET` to `api/services`. Pass the new params to `fetchContacts({ status, service, from, to, search, tag, page, limit })` (the Phase 3 endpoint reads `status`/`service`/`from`/`to`).

- [ ] **Step 2: Add a Services column** to the DataTable `columns` (after Tags), rendering `row.services` (array of names) as small chips, `'—'` when empty.

- [ ] **Step 3: Add an Export CSV button** in the toolbar (next to the staff merge button). On click, call `exportContactsCsv({ ...currentFilters })`, build a blob URL, trigger a download, toast on success/failure:
```js
const handleExport = useCallback(async () => {
  try {
    const blob = await exportContactsCsv({ search: debouncedSearch || undefined, status: statusFilter || undefined, tag: tagFilter || undefined, service: serviceFilter || undefined, from: dateFrom || undefined, to: dateTo || undefined });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click();
    URL.revokeObjectURL(url);
    triggerMessage?.('success', 'Export ready');
  } catch (err) { triggerMessage?.('error', err?.message || 'Export failed'); }
}, [debouncedSearch, statusFilter, tagFilter, serviceFilter, dateFrom, dateTo, triggerMessage]);
```
Wire `import { fetchContacts, fetchMergeCandidates, exportContactsCsv } from 'api/contacts';` and add the button (`<LoadingButton>` or `<Button startIcon={<DownloadIcon/>}>Export CSV</Button>`).

- [ ] **Step 4: Verify.** `yarn build 2>&1 | tail -5`; eslint clean on the file.

- [ ] **Step 5: Commit.** `git add src/views/client/ClientPortal/ContactsTab.jsx && git commit -m "feat(contacts): status/service/date filters + Services column + Export CSV in ContactsTab"`

---

## Task 4: ContactProfileDrawer — Services history + inline archive/unarchive

**Files:** Modify `src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx`.

- [ ] **Step 1: Render a Services history section** (after Tags or Consent), from `detail.services` (newest first), each row showing `service_name`, a small `source` chip (`journey` / `active_client`), and the date. Empty → "No services recorded yet."

- [ ] **Step 2: Add inline archive/unarchive.** In the header action row (next to Split / Close), add a button that calls `archiveContact(contactId, !isArchived)` where `isArchived = !!detail?.contact?.archived_at`. On success: update `detail.contact.archived_at` locally, toast, and call `onContactUpdated?.({ id: contactId, archived_at: <new> })` so the list can drop/restore the row. Label toggles "Archive" / "Restore".
```js
const handleArchiveToggle = useCallback(async () => {
  const next = !detail?.contact?.archived_at;
  try {
    const { contact } = await archiveContact(contactId, next);
    setDetail((d) => ({ ...d, contact: { ...d.contact, archived_at: contact.archived_at } }));
    onContactUpdated?.({ id: contactId, archived_at: contact.archived_at });
    toast.success(next ? 'Contact archived' : 'Contact restored');
  } catch (err) { toast.error(err?.message || 'Unable to update'); }
}, [contactId, detail, onContactUpdated, toast]);
```
Import `archiveContact` from `api/contacts`.

- [ ] **Step 3: Reflect archive in the list.** In `ContactsTab`, extend the existing `onContactUpdated` handler: if the update carries `archived_at`, drop the row from the current view when it no longer matches the active status filter (e.g. archived a contact while viewing non-archived → remove it), else merge. Keep it simple: on any `archived_at` change, `loadContacts()` to reconcile (the immediate-update rule is satisfied by the toast + the drawer state; a reconciling reload is the safety net).

- [ ] **Step 4: Verify.** `yarn build 2>&1 | tail -5`; eslint clean; `grep -n "Services\|archiveContact\|Archive" src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx`.

- [ ] **Step 5: Commit.** `git add src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx src/views/client/ClientPortal/ContactsTab.jsx && git commit -m "feat(contacts): services history + inline archive/unarchive in profile drawer"`

---

## Task 5: Phase PR
- [ ] Push, open PR (`feat(contacts): master-list UI — filters, services, CSV, archive (Phase 4)`), CodeRabbit, address findings, **stop for user merge approval**.

## Notes for the executor
- The Service dropdown needs the owner's service catalog — reuse the existing services API if present (`grep` first) rather than adding a duplicate.
- CSV download must go through the authed axios `client` (blob), not a raw `<a href>` to the API (which would lack the auth header).
- Inline archive must reflect immediately (CLAUDE.md hard rule) — update drawer state + toast, then reconcile the list with `loadContacts()`.
