# Contacts UI — Phase B: Profile Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Clicking a contact in the Contacts list opens a slide-over drawer showing the contact's identifiers, tags, consent toggles, an editable name, and a paginated activity timeline — backed by `GET /hub/contacts/:id`, a new `?contact_id=` filter on `/hub/calls`, and client-accessible owner-scoped tags/consent endpoints.

**Architecture:** New owner-scoped reads/mutations in `hub.js` (reusing the `contactTags` service for DRY); `?contact_id=` added to the existing `/calls` query conditions; a `ContactProfileDrawer.jsx` that reuses the rename inline-edit pattern + `LeadActivityRow` for the timeline. All mutations update local state immediately.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL; React 19 + MUI. No test suite — verify with `yarn build` + lint + local-DB scenarios (`psql postgresql://bif@localhost:5432/anchor`).

**Spec:** `docs/superpowers/specs/2026-05-27-contacts-management-ui-design.md` (§3, §4 Phase B).
**Branch:** `feat/contacts-management`. **Depends on Phase A** (ContactsTab + fetchContacts) and **PR #105** (rename endpoint + `display_name_source`).

---

## File Structure
- `server/routes/hub.js` — `GET /contacts/:id`; `?contact_id=` filter in `/calls`; client-accessible owner-scoped `GET/POST/DELETE /contacts/:id/tags` + `PATCH /contacts/:id/consent`.
- `src/api/contacts.js` — add `fetchContact`, `fetchContactTags`, `addContactTag`, `removeContactTag`, `updateContactConsent`; reuse `renameContact` (from PR #105) and `fetchCalls`(`{contact_id}`) from `api/calls`.
- `src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx` — NEW drawer.
- `src/views/client/ClientPortal/ContactsTab.jsx` — open the drawer on row click + reflect updates.

---

## Task 1: `GET /hub/contacts/:id` (profile)

**Files:** Modify `server/routes/hub.js`

- [ ] **Step 1: Add the route** (near the other `/contacts` routes). Owner-scoped; returns the contact + identifiers + tags + consent. Validate UUID (reuse the `UUID_RE` pattern from the rename endpoint).
```js
router.get('/contacts/:id', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const id = req.params.id;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid contact id.' });
  try {
    const c = await query(
      `SELECT id, display_name, display_name_source, primary_phone, primary_email,
              sms_opted_out, email_opted_out, email_unsubscribed_at, first_seen_at, last_activity_at
         FROM contacts WHERE id = $1 AND owner_user_id = $2`,
      [id, targetUserId]
    );
    if (!c.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    const [phones, emails, tags, count] = await Promise.all([
      query('SELECT id, phone_digits10, phone_e164, is_primary FROM contact_phones WHERE contact_id = $1 ORDER BY is_primary DESC', [id]),
      query('SELECT id, email, is_primary FROM contact_emails WHERE contact_id = $1 ORDER BY is_primary DESC', [id]),
      query('SELECT lt.id, lt.name, lt.color, ct.source FROM contact_tags ct JOIN lead_tags lt ON lt.id = ct.tag_id WHERE ct.contact_id = $1 ORDER BY lt.name', [id]),
      query('SELECT COUNT(*) AS n FROM call_logs WHERE contact_id = $1', [id])
    ]);
    res.json({
      contact: c.rows[0],
      phones: phones.rows,
      emails: emails.rows,
      tags: tags.rows,
      consent: { sms_opted_out: c.rows[0].sms_opted_out, email_opted_out: c.rows[0].email_opted_out, email_unsubscribed_at: c.rows[0].email_unsubscribed_at },
      activity_count: parseInt(count.rows[0]?.n || 0, 10)
    });
  } catch (err) {
    console.error('[contacts:get]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load contact.' });
  }
});
```
NOTE: define `UUID_RE` once at module scope if the rename route already added it; don't redeclare in a way that shadows/conflicts (grep `grep -n "UUID_RE" server/routes/hub.js` — if it's already module-level, reuse it; else local-const is fine).

- [ ] **Step 2: Verify** — `yarn build 2>&1 | tail -3 && node --check server/routes/hub.js && echo OK`; lint clean.
- [ ] **Step 3: Local-DB** — insert a contact + a phone + an email + a tag; run the above SELECTs for that id+owner; confirm shape + that a wrong owner returns 0 contact rows.
- [ ] **Step 4: Commit** — `git commit -am "feat(contacts): GET /hub/contacts/:id profile (owner-scoped)"`

---

## Task 2: `?contact_id=` filter on `/hub/calls`

**Files:** Modify `server/routes/hub.js` (the `GET /calls` handler's filter-building block)

- [ ] **Step 1: Add the filter.** Find where `/calls` builds `commonConditions`/`commonParams` (search for `req.query.contact_phone` — the contact filter goes right alongside it). Add an owner-scoped `contact_id` condition (the column is on `cl`):
```js
  if (req.query.contact_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.query.contact_id)) {
    commonConditions.push(`cl.contact_id = $${commonParamIndex}`);
    commonParams.push(req.query.contact_id);
    commonParamIndex++;
  }
```
Place it adjacent to the existing `contact_phone` block so it shares the same conditions array. (This also supersedes the deferred `?contact_phone=` filter — leave that block in place; the two are independent.)

- [ ] **Step 2: Verify** — `yarn build`; `node --check`. Local-DB: `psql ... -c "SELECT call_id FROM call_logs WHERE (owner_user_id=(SELECT id FROM users LIMIT 1)) AND contact_id = '00000000-0000-0000-0000-000000000000' LIMIT 1;"` (parses, 0 rows).
- [ ] **Step 3: Commit** — `git commit -am "feat(contacts): /hub/calls ?contact_id= filter (contact timeline + supersedes contact_phone)"`

---

## Task 3: Client-accessible owner-scoped tags + consent

**Files:** Modify `server/routes/hub.js` (reuse `server/services/contactTags.js`)

- [ ] **Step 1: Import the service + add routes.** At top of hub.js add (if not present): `import { applyContactTags, removeContactTag } from '../services/contactTags.js';` (grep first). Add owner-scoped routes mirroring the staff versions in contacts.js but scoped to `targetUserId`:
```js
// Tags (client-accessible, owner-scoped). The staff copies in contacts.js remain.
router.get('/contacts/:id/tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    const { rows } = await query(
      `SELECT lt.id, lt.name, lt.color, lt.system_key, ct.source, ct.created_at
         FROM contact_tags ct JOIN lead_tags lt ON lt.id = ct.tag_id
        WHERE ct.contact_id = $1 ORDER BY lt.name`, [req.params.id]);
    res.json({ tags: rows });
  } catch (err) { console.error('[contacts:tags:get]', { code: err?.code }); res.status(500).json({ message: 'Failed to load tags.' }); }
});

router.post('/contacts/:id/tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { tagId } = req.body || {};
  if (!tagId) return res.status(400).json({ message: 'tagId is required' });
  try {
    const owns = await query('SELECT owner_user_id FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    const t = await query('SELECT 1 FROM lead_tags WHERE id = $1 AND owner_user_id = $2', [tagId, targetUserId]);
    if (!t.rows.length) return res.status(400).json({ message: 'Tag not found for this owner.' });
    await applyContactTags({ contactId: req.params.id, ownerUserId: targetUserId, tagIds: [tagId], source: 'user', createdBy: req.user.id });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_tag_add', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, tagId } });
    res.json({ ok: true });
  } catch (err) { console.error('[contacts:tags:add]', { code: err?.code }); res.status(500).json({ message: 'Failed to add tag.' }); }
});

router.delete('/contacts/:id/tags/:tagId', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    await removeContactTag({ contactId: req.params.id, tagId: req.params.tagId, ownerUserId: targetUserId });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_tag_remove', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, tagId: req.params.tagId } });
    res.json({ ok: true });
  } catch (err) { console.error('[contacts:tags:del]', { code: err?.code }); res.status(500).json({ message: 'Failed to remove tag.' }); }
});

// Consent (client-accessible, owner-scoped).
router.patch('/contacts/:id/consent', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { sms_opted_out, email_opted_out } = req.body || {};
  if (typeof sms_opted_out !== 'boolean' && typeof email_opted_out !== 'boolean') {
    return res.status(400).json({ message: 'Provide sms_opted_out and/or email_opted_out (boolean).' });
  }
  try {
    const sets = []; const params = [req.params.id, targetUserId];
    if (typeof sms_opted_out === 'boolean') { params.push(sms_opted_out); sets.push(`sms_opted_out = $${params.length}`); }
    if (typeof email_opted_out === 'boolean') { params.push(email_opted_out); sets.push(`email_opted_out = $${params.length}`); sets.push(`email_unsubscribed_at = ${email_opted_out ? 'NOW()' : 'NULL'}`); }
    const { rowCount } = await query(`UPDATE contacts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND owner_user_id = $2`, params);
    if (!rowCount) return res.status(404).json({ message: 'Contact not found.' });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_consent_update', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, sms_opted_out, email_opted_out } });
    res.json({ ok: true });
  } catch (err) { console.error('[contacts:consent]', { code: err?.code }); res.status(500).json({ message: 'Failed to update consent.' }); }
});
```
(`removeContactTag` already takes `ownerUserId` per PR #105's hardening — confirm with `grep -n "export async function removeContactTag" server/services/contactTags.js`. `logSecurityEvent` is already imported in hub.js.)

- [ ] **Step 2: Verify** — `yarn build`; `node --check`; lint clean. Local-DB: apply a tag + a consent update to a test contact via the same SQL the service runs; confirm owner-scoping (wrong owner → 0 rows / 404 path).
- [ ] **Step 3: Commit** — `git commit -am "feat(contacts): client-accessible owner-scoped tags + consent endpoints"`

---

## Task 4: API client additions

**Files:** Modify `src/api/contacts.js`

- [ ] **Step 1:** Add:
```js
export function fetchContact(id) {
  return client.get(`/hub/contacts/${id}`).then((res) => res.data);
}
export function addContactTag(id, tagId) {
  return client.post(`/hub/contacts/${id}/tags`, { tagId }).then((res) => res.data);
}
export function removeContactTagApi(id, tagId) {
  return client.delete(`/hub/contacts/${id}/tags/${tagId}`).then((res) => res.data);
}
export function updateContactConsent(id, patch) {
  return client.patch(`/hub/contacts/${id}/consent`, patch).then((res) => res.data);
}
```
(For the timeline, reuse `fetchCalls({ contact_id: id, page, limit })` from `api/calls`. For rename, reuse `renameContact` from `api/calls` — PR #105.)

- [ ] **Step 2: Verify** — lint clean; `yarn build` ok.
- [ ] **Step 3: Commit** — `git commit -am "feat(contacts): profile/tags/consent API client"`

---

## Task 5: `ContactProfileDrawer.jsx`

**Files:** Create `src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx`

- [ ] **Step 1: Build the drawer.** Read the existing lead detail drawer in `LeadsTab.jsx` (the `leadDetailDrawer` + the inline rename pattern built in PR #105) and mirror it. Use MUI `Drawer`, the shared `LoadingButton`, `ConfirmDialog` (not needed here), `useToast`, MUI `Switch` for consent, `Autocomplete` over the owner's tags (`fetchAllTags` from `api/calls`), and `LeadActivityRow` (`./leads/LeadActivityRow`) for the timeline.

Spec — props: `{ open, contactId, onClose, onContactUpdated, isStaff }`.
- On open (contactId set): `fetchContact(contactId)` → store `detail` ({contact, phones, emails, tags, consent}); `fetchCalls({ contact_id: contactId, limit: 25 })` → store `timeline` (+ paginate via a "load more"/page).
- Header: the contact name with the **inline rename** (reuse the exact pattern from PR #105 — pencil → TextField + Save via `renameContact`); on success update `detail` + call `onContactUpdated(updated)` so the list row reflects it.
- Body sections: Identifiers (phones/emails list, primary marked); Tags (chips with remove ✕ + an Autocomplete to add → `addContactTag`/`removeContactTagApi`, update `detail.tags` immediately + toast); Consent (two `Switch`es for SMS / email opt-out → `updateContactConsent({ sms_opted_out }|{ email_opted_out })`, optimistic update + toast); Activity timeline (map `timeline` through `LeadActivityRow`, read-only here).
- A "Merge into…" button rendered **only when `isStaff`** — in Phase B it can be a disabled placeholder or hidden; the merge/split UI is Phase C. (Hide it in Phase B to avoid dead controls; Phase C adds it.)
- All mutations: immediate local-state update (the hard rule), success/error toasts. No `window.alert/confirm`.

- [ ] **Step 2: Verify** — `yarn build 2>&1 | tail -5` (MUST succeed); lint clean on the new file.
- [ ] **Step 3: Commit** — `git add src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx && git commit -m "feat(contacts): contact profile drawer (identifiers, tags, consent, rename, timeline)"`

---

## Task 6: Open the drawer from the list + reflect updates

**Files:** Modify `src/views/client/ClientPortal/ContactsTab.jsx`

- [ ] **Step 1:** Add drawer state (`const [drawer, setDrawer] = useState({ open: false, contactId: null })`). Set `DataTable`'s `onRowClick={(row) => setDrawer({ open: true, contactId: row.id })}`. Render `<ContactProfileDrawer open={drawer.open} contactId={drawer.contactId} onClose={() => setDrawer({ open:false, contactId:null })} onContactUpdated={(u) => setRows((prev) => prev.map((r) => r.id === u.id ? { ...r, display_name: u.display_name, display_name_source: u.display_name_source } : r))} isStaff={/* role flag available in this portal context */} />`. Pass `isStaff` from the role/acting context the portal exposes (grep for how other tabs detect staff/role; if not readily available, pass `false` for now — Phase C wires staff gating). Tag/consent changes don't need a list-row patch (not shown in the list) — but a tag change could refresh the row's tags; optional.

- [ ] **Step 2: Verify** — `yarn build` (succeeds); lint clean; `grep -n "ContactProfileDrawer\|onRowClick" src/views/client/ClientPortal/ContactsTab.jsx`.
- [ ] **Step 3: Commit** — `git commit -am "feat(contacts): open profile drawer from contacts list"`

---

## Task 7: Verify + PR

- [ ] **Step 1:** `yarn build` + lint (no new errors) on all touched files.
- [ ] **Step 2:** Local-DB end-to-end: a contact with 2 phones, an email, a tag, and 2 call_logs (contact_id set) → `GET /contacts/:id` returns identifiers+tags+consent; `/calls?contact_id=` returns the 2 activities; a tag add/remove + consent toggle update the row owner-scoped; cross-owner fetch → 404.
- [ ] **Step 3:** Push + PR (`feat(contacts): contact profile drawer (Phase B)`), CodeRabbit, merge on user's go.

## Notes for the executor
- Reuse the `contactTags` service (DRY) — don't reimplement tag SQL.
- Reuse the rename inline-edit UI from PR #105 in the drawer header.
- Owner-scope every endpoint in SQL.
- No migration. The "Merge into…" / split controls are Phase C — hide them here.
