# Contacts UI — Phase A: List/Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A "Contacts" tab in the client portal showing an owner-scoped, searchable/filterable, paginated list of contacts (name, phone, email, lifecycle chip, tags, last activity), backed by a new `GET /hub/contacts` endpoint.

**Architecture:** New owner-scoped `GET /hub/contacts` in `hub.js` (mirrors the `/calls` ownership pattern: `targetUserId = req.portalUserId || req.user.id`, scoped `owner_user_id = targetUserId`). New `src/api/contacts.js` client + `ContactsTab.jsx` using the shared `DataTable`, wired as a portal tab. Read-only — no mutations in Phase A.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL (`pg`); React 19 + MUI. No test suite — verify with `yarn build` + lint + local-DB scenarios via `psql postgresql://bif@localhost:5432/anchor` (NOT the prod `.env` URL).

**Spec:** `docs/superpowers/specs/2026-05-27-contacts-management-ui-design.md` (§3 GET /hub/contacts, §4 Phase A).
**Branch:** `feat/contacts-management` (created). **Depends on PR #105** being merged (the list shows the `display_name_source` "set by user" indicator). Confirm `display_name_source` exists: `psql "postgresql://bif@localhost:5432/anchor" -tAc "SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='display_name_source'"` → expect `1`. If empty, merge #105 first or apply its migration locally.

---

## File Structure
- `server/routes/hub.js` — add `GET /contacts` (owner-scoped list).
- `src/api/contacts.js` — NEW client module (`fetchContacts`).
- `src/views/client/ClientPortal/ContactsTab.jsx` — NEW tab component (DataTable).
- `src/views/client/ClientPortal.jsx` — register the `contacts` tab (SECTION_CONFIG + render).

---

## Task 1: `GET /hub/contacts` endpoint

**Files:** Modify `server/routes/hub.js`

- [ ] **Step 1: Add the route** (place near the other `/contacts` and `/calls` client routes, e.g. just after the `PATCH /contacts/:id/name` rename route).

```js
// GET /contacts — owner-scoped contact list. Search (name/phone/email), filter (lifecycle, tag),
// paginate. Read-only. Mirrors /calls ownership (targetUserId = portal or self).
router.get('/contacts', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const search = (req.query.search || '').trim();
  const lifecycle = ['lead', 'in_journey', 'active_client'].includes(req.query.lifecycle) ? req.query.lifecycle : null;
  const tagId = req.query.tag && /^[0-9a-f-]{36}$/i.test(req.query.tag) ? req.query.tag : null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const conds = ['c.owner_user_id = $1', 'c.archived_at IS NULL'];
  const params = [targetUserId];
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    params.push(search.replace(/[^0-9]/g, ''));
    const digits = `$${params.length}`;
    conds.push(`(
      c.display_name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.contact_id = c.id AND ${digits} <> '' AND cp.phone_digits10 LIKE '%' || RIGHT(${digits}, 10) || '%')
      OR EXISTS (SELECT 1 FROM contact_emails ce WHERE ce.contact_id = c.id AND ce.email ILIKE ${p})
    )`);
  }
  if (tagId) {
    params.push(tagId);
    conds.push(`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = $${params.length})`);
  }

  const lifecycleSql = `CASE
    WHEN EXISTS (SELECT 1 FROM active_clients ac WHERE ac.owner_user_id = c.owner_user_id AND ac.contact_id = c.id AND ac.archived_at IS NULL) THEN 'active_client'
    WHEN EXISTS (SELECT 1 FROM client_journeys cj WHERE cj.owner_user_id = c.owner_user_id AND cj.contact_id = c.id AND cj.active_client_id IS NULL AND COALESCE(cj.status,'in_progress') NOT IN ('active_client','won','lost','archived')) THEN 'in_journey'
    ELSE 'lead' END`;

  const inner = `
    SELECT c.id, c.display_name, c.display_name_source, c.primary_phone, c.primary_email,
           c.last_activity_at,
           (SELECT COUNT(*) FROM call_logs cl WHERE cl.contact_id = c.id) AS activity_count,
           (SELECT COALESCE(json_agg(json_build_object('id', lt.id, 'name', lt.name, 'color', lt.color)), '[]'::json)
              FROM contact_tags ct2 JOIN lead_tags lt ON lt.id = ct2.tag_id WHERE ct2.contact_id = c.id) AS tags,
           ${lifecycleSql} AS lifecycle
    FROM contacts c
    WHERE ${conds.join(' AND ')}`;

  try {
    const lifeParams = [...params];
    let lifeFilter = '';
    if (lifecycle) { lifeParams.push(lifecycle); lifeFilter = `WHERE t.lifecycle = $${lifeParams.length}`; }
    const countResult = await query(`SELECT COUNT(*) AS total FROM (${inner}) t ${lifeFilter}`, lifeParams);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    const pageParams = [...lifeParams, limit, offset];
    const { rows } = await query(
      `SELECT * FROM (${inner}) t ${lifeFilter}
       ORDER BY t.last_activity_at DESC NULLS LAST
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );
    res.json({ contacts: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[contacts:list]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load contacts.' });
  }
});
```

- [ ] **Step 2: Build + lint + node check**

Run: `yarn build 2>&1 | tail -3 && node --check server/routes/hub.js && echo OK && npx eslint server/routes/hub.js 2>&1 | grep -iE "  error  " | grep -v "50_000" | head`
Expected: build ok; `OK`; no new errors.

- [ ] **Step 3: Local-DB query check** (owner-scoping + shape)

```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name, display_name_source, primary_phone, last_activity_at) VALUES (:'u','Test Person','user','555-444-0001', NOW()) RETURNING id AS c \gset
INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10) VALUES (:'c',:'u','5554440001');
-- the list query (inlined) for this owner, search by partial phone
SELECT c.id, c.display_name, c.display_name_source,
  (SELECT COUNT(*) FROM call_logs cl WHERE cl.contact_id=c.id) AS activity_count,
  CASE WHEN EXISTS (SELECT 1 FROM active_clients ac WHERE ac.owner_user_id=c.owner_user_id AND ac.contact_id=c.id AND ac.archived_at IS NULL) THEN 'active_client'
       WHEN EXISTS (SELECT 1 FROM client_journeys cj WHERE cj.owner_user_id=c.owner_user_id AND cj.contact_id=c.id AND cj.active_client_id IS NULL AND COALESCE(cj.status,'in_progress') NOT IN ('active_client','won','lost','archived')) THEN 'in_journey'
       ELSE 'lead' END AS lifecycle
  FROM contacts c WHERE c.owner_user_id=:'u' AND c.archived_at IS NULL
    AND (c.display_name ILIKE '%Test%' OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.contact_id=c.id AND cp.phone_digits10 LIKE '%4440001%'));
ROLLBACK;
SQL
```
Expected: one row, `lifecycle='lead'`, `activity_count=0`, `display_name_source='user'`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(contacts): GET /hub/contacts owner-scoped list (search/filter/paginate)"
```

---

## Task 2: API client `fetchContacts`

**Files:** Create `src/api/contacts.js`

- [ ] **Step 1: Create the module**

```js
import client from './client';

// Owner-scoped contact list. params: { search, lifecycle, tag, page, limit }
export function fetchContacts(params = {}) {
  return client.get('/hub/contacts', { params }).then((res) => ({
    contacts: res.data.contacts || [],
    pagination: res.data.pagination || null
  }));
}
```

- [ ] **Step 2: Verify** — `npx eslint src/api/contacts.js 2>&1 | tail -2` (no errors); `yarn build 2>&1 | tail -3` (ok).

- [ ] **Step 3: Commit** — `git add src/api/contacts.js && git commit -m "feat(contacts): fetchContacts API client"`

---

## Task 3: `ContactsTab.jsx` (DataTable list)

**Files:** Create `src/views/client/ClientPortal/ContactsTab.jsx`

- [ ] **Step 1: Build the component.** Use the shared `DataTable` (`ui-component/extended/DataTable`), `StatusChip` (`ui-component/extended/StatusChip`) for the lifecycle chip, MUI `Chip` for tags, `SelectField` (`ui-component/extended/SelectField`) for the lifecycle/tag filters, `useToast` from `contexts/ToastContext`. Follow the structure of an existing simple tab (read `src/views/client/ClientPortal/ArchiveTab.jsx` for the load/empty/error pattern).

Component spec:
- State: `rows`, `loading`, `search` (debounced ~300ms), `lifecycleFilter`, `tagFilter`, `page`, `pagination`, plus `tags` (for the tag filter dropdown — fetch via the existing `fetchAllTags` from `api/calls`).
- On mount + whenever search/filters/page change → call `fetchContacts({ search, lifecycle, tag, page, limit: 50 })`, set `rows` + `pagination`; on error show a toast.
- `DataTable` columns: `display_name` (render: name + a small "✎ set" caption when `row.display_name_source === 'user'`), `primary_phone`, `primary_email`, `lifecycle` (render a `StatusChip` — map 'active_client'→active, 'in_journey'→in progress, 'lead'→default), `tags` (render the tag chips), `last_activity_at` (formatted relative/short date), `activity_count`.
- `searchable={false}` on DataTable (we drive search server-side via the toolbar field), `paginated` driven by `pagination` (or use DataTable's own pagination over the page rows — since the server paginates, render the current page's rows and a pager bound to `setPage`). `onRowClick={(row) => /* Phase B opens drawer; in Phase A, no-op or console */}`. `rowKey="id"`. `emptyTitle="No contacts yet"`, `emptyMessage` per `EmptyState`.
- Accept `key={activePortalClientId}` from the parent (re-mounts per client) — no extra prop needed.

(The implementer may use the frontend-design skill for polish; keep it consistent with the existing tabs. Don't introduce `window.alert/confirm`.)

- [ ] **Step 2: Verify** — `yarn build 2>&1 | tail -5` (MUST succeed — catches import/JSX errors); `npx eslint src/views/client/ClientPortal/ContactsTab.jsx 2>&1 | grep -iE "  error  " | head` (no errors).

- [ ] **Step 3: Commit** — `git add src/views/client/ClientPortal/ContactsTab.jsx && git commit -m "feat(contacts): ContactsTab list view"`

---

## Task 4: Register the Contacts tab in ClientPortal

**Files:** Modify `src/views/client/ClientPortal.jsx`

- [ ] **Step 1: Import + add to SECTION_CONFIG.** Add `import ContactsTab from './ClientPortal/ContactsTab';` with the other tab imports. In `SECTION_CONFIG`, add an entry after `leads` (a natural neighbor):
```js
      { value: 'leads', label: 'Leads' },
      { value: 'contacts', label: 'Contacts' },
```

- [ ] **Step 2: Render it.** In the render section where tabs are conditionally rendered (e.g. near `{activeTab === 'reviews' && <ReviewsPanel .../>}`), add:
```jsx
        {activeTab === 'contacts' && <ContactsTab key={activePortalClientId} triggerMessage={triggerMessage} />}
```
(Match the actual prop pattern siblings use — most pass `key={activePortalClientId}`; pass `triggerMessage` only if ContactsTab uses it for toasts. Confirm `activePortalClientId` is the variable in scope here via `grep -n "activePortalClientId" src/views/client/ClientPortal.jsx`.)

- [ ] **Step 3: Verify** — `yarn build 2>&1 | tail -5` (succeeds); `grep -n "ContactsTab\|'contacts'" src/views/client/ClientPortal.jsx` (import + config + render present).

- [ ] **Step 4: Commit** — `git add src/views/client/ClientPortal.jsx && git commit -m "feat(contacts): wire Contacts tab into client portal"`

---

## Task 5: Verify + PR

- [ ] **Step 1:** `yarn build` (succeeds) + `npx eslint server/routes/hub.js src/api/contacts.js src/views/client/ClientPortal/ContactsTab.jsx src/views/client/ClientPortal.jsx 2>&1 | grep -iE "  error  " | grep -v "50_000" | head` (no new errors).
- [ ] **Step 2:** Local-DB: insert 2 contacts for a user (one with an active_clients row → lifecycle should compute 'active_client'), call the inlined list query, confirm lifecycle + search + the owner predicate behave; cross-owner returns nothing.
- [ ] **Step 3:** `git push origin feat/contacts-management` and `gh pr create --base main --title "feat(contacts): Contacts tab — list/search (Phase A)" --body "Implements Phase A of docs/superpowers/specs/2026-05-27-contacts-management-ui-design.md. New owner-scoped GET /hub/contacts + ContactsTab list (search/filter/paginate, lifecycle chip, tags). Read-only. No migration."`
- [ ] **Step 4:** Trigger CodeRabbit (`@coderabbitai review`), address findings, merge on user's go. **Offer the user a client-facing portal Update** (new visible tab) per the project rule.

## Notes for the executor
- Owner-scoping is mandatory in SQL (`owner_user_id = targetUserId`), not just the UI.
- No migration — schema is already in place.
- `display_name_source` requires PR #105 (see header).
- Keep the endpoint read-only; mutations come in Phases B/C.
