# Contacts Master List — Phase 3: Master-List API (filters + CSV export)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** Extend `GET /hub/contacts` with `status` (incl. `archived`), `service`, and date-range filters; add `GET /hub/contacts/export.csv` that exports the filtered set (owner-scoped, audited). Builds on the Phase A endpoint, which already does `search`/`lifecycle`/`tag`/pagination + the lifecycle CASE.

**Architecture:** Factor the WHERE/param building into one helper used by both the list and the export so they stay in lockstep (DRY). `status` supersedes `lifecycle` (kept as an alias). Archived is a flip of the current hardcoded `archived_at IS NULL`. Service filter = `EXISTS` against `contact_services`. CSV is built server-side (capped), `text/csv` attachment, audited.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL. Verify with `yarn build` + `node --check` + local-DB + `curl`-shape checks.

**Spec:** §3, §5. **Depends on:** Phase 1 (`contact_services`).

---

## File Structure
- Modify: `server/routes/hub.js` — refactor the `GET /contacts` filter-builder; add `GET /contacts/export.csv`.

---

## Task 1: Refactor the filter builder + add status/service/date to the list

**Files:** Modify `server/routes/hub.js` (the `GET /contacts` handler — `grep -n "GET /contacts — owner-scoped contact list" server/routes/hub.js`).

- [ ] **Step 1: Extract a `buildContactListQuery(req)` helper** above the route. It returns `{ inner, params, lifeFilter, lifeParams }` so both list + export reuse it. Move the existing conds/params/lifecycleSql/inner logic in, and add the new filters:

```js
// Shared filter/SQL builder for the contacts list + CSV export. Owner-scoped.
function buildContactListQuery(req) {
  const targetUserId = req.portalUserId || req.user.id;
  const search = (req.query.search || '').trim();
  const tagRaw = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
  const serviceRaw = typeof req.query.service === 'string' ? req.query.service.trim() : '';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // status supersedes lifecycle; 'archived' is orthogonal (the contact row is archived).
  const statusRaw = (req.query.status || req.query.lifecycle || '').trim();
  const lifecycleStatus = ['lead', 'in_journey', 'active_client'].includes(statusRaw) ? statusRaw : null;
  const archived = statusRaw === 'archived';
  if (tagRaw && !UUID_RE.test(tagRaw)) return { error: 'Invalid tag filter.' };
  if (serviceRaw && !UUID_RE.test(serviceRaw)) return { error: 'Invalid service filter.' };
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;

  const conds = ['c.owner_user_id = $1', archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL'];
  const params = [targetUserId];
  if (search) {
    params.push(`%${search}%`); const p = `$${params.length}`;
    params.push(search.replace(/[^0-9]/g, '')); const digits = `$${params.length}`;
    conds.push(`(c.display_name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.contact_id = c.id AND ${digits} <> '' AND cp.phone_digits10 LIKE '%' || RIGHT(${digits}, 10) || '%')
      OR EXISTS (SELECT 1 FROM contact_emails ce WHERE ce.contact_id = c.id AND ce.email ILIKE ${p}))`);
  }
  if (tagRaw) { params.push(tagRaw); conds.push(`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = $${params.length})`); }
  if (serviceRaw) { params.push(serviceRaw); conds.push(`EXISTS (SELECT 1 FROM contact_services csv WHERE csv.contact_id = c.id AND csv.service_id = $${params.length})`); }
  if (dateFrom) { params.push(dateFrom); conds.push(`c.last_activity_at >= $${params.length}::date`); }
  if (dateTo) { params.push(dateTo); conds.push(`c.last_activity_at < ($${params.length}::date + INTERVAL '1 day')`); }

  const lifecycleSql = `CASE
    WHEN EXISTS (SELECT 1 FROM active_clients ac WHERE ac.owner_user_id = c.owner_user_id AND ac.contact_id = c.id AND ac.archived_at IS NULL) THEN 'active_client'
    WHEN EXISTS (SELECT 1 FROM client_journeys cj WHERE cj.owner_user_id = c.owner_user_id AND cj.contact_id = c.id AND cj.active_client_id IS NULL AND COALESCE(cj.status,'in_progress') NOT IN ('active_client','won','lost','archived')) THEN 'in_journey'
    ELSE 'lead' END`;

  const inner = `
    SELECT c.id, c.display_name, c.display_name_source, c.primary_phone, c.primary_email, c.last_activity_at, c.first_seen_at, c.archived_at,
           (SELECT COUNT(*) FROM call_logs cl WHERE cl.contact_id = c.id) AS activity_count,
           (SELECT COALESCE(json_agg(json_build_object('id', lt.id, 'name', lt.name, 'color', lt.color)), '[]'::json)
              FROM contact_tags ct2 JOIN lead_tags lt ON lt.id = ct2.tag_id WHERE ct2.contact_id = c.id) AS tags,
           (SELECT COALESCE(json_agg(DISTINCT cs2.service_name), '[]'::json)
              FROM contact_services cs2 WHERE cs2.contact_id = c.id AND cs2.service_name IS NOT NULL) AS services,
           ${lifecycleSql} AS lifecycle
    FROM contacts c
    WHERE ${conds.join(' AND ')}`;

  // lifecycle filter only when a lifecycle status (not 'archived') was requested
  const lifeParams = [...params];
  let lifeFilter = '';
  if (lifecycleStatus) { lifeParams.push(lifecycleStatus); lifeFilter = `WHERE t.lifecycle = $${lifeParams.length}`; }
  return { targetUserId, inner, params, lifeParams, lifeFilter };
}
```

- [ ] **Step 2: Rewrite the `GET /contacts` body to use the helper.** Keep pagination as-is:
```js
router.get('/contacts', async (req, res) => {
  const built = buildContactListQuery(req);
  if (built.error) return res.status(400).json({ message: built.error });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  try {
    const countResult = await query(`SELECT COUNT(*) AS total FROM (${built.inner}) t ${built.lifeFilter}`, built.lifeParams);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);
    const pageParams = [...built.lifeParams, limit, offset];
    const { rows } = await query(
      `SELECT * FROM (${built.inner}) t ${built.lifeFilter}
       ORDER BY t.last_activity_at DESC NULLS LAST
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`, pageParams);
    res.json({ contacts: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[contacts:list]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load contacts.' });
  }
});
```

- [ ] **Step 3: Verify.** `node --check server/routes/hub.js && echo OK`; `yarn build 2>&1 | tail -3`; eslint clean (ignore pre-existing `50_000`).

- [ ] **Step 4: Local-DB filter checks** (status archived flip + service filter):
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name, last_activity_at) VALUES (:'u','Live One', NOW()) RETURNING id AS a \gset
INSERT INTO contacts (owner_user_id, display_name, archived_at) VALUES (:'u','Gone One', NOW()) RETURNING id AS b \gset
INSERT INTO services (user_id,name,base_price,active) VALUES (:'u','Veneers',900,true) RETURNING id AS s \gset
INSERT INTO contact_services (contact_id,owner_user_id,service_id,service_name,source) VALUES (:'a',:'u',:'s','Veneers','journey');
\echo '--- default (archived hidden) sees Live One not Gone One ---'
SELECT display_name FROM contacts c WHERE c.owner_user_id=:'u' AND c.archived_at IS NULL AND c.id IN (:'a',:'b');
\echo '--- status=archived sees Gone One ---'
SELECT display_name FROM contacts c WHERE c.owner_user_id=:'u' AND c.archived_at IS NOT NULL AND c.id IN (:'a',:'b');
\echo '--- service filter matches Live One ---'
SELECT display_name FROM contacts c WHERE c.owner_user_id=:'u' AND c.id IN (:'a',:'b') AND EXISTS (SELECT 1 FROM contact_services csv WHERE csv.contact_id=c.id AND csv.service_id=:'s');
ROLLBACK;
SQL
```

- [ ] **Step 5: Commit.** `git add server/routes/hub.js && git commit -m "feat(contacts): status/service/date filters on GET /hub/contacts (DRY builder)"`

---

## Task 2: CSV export endpoint

**Files:** Modify `server/routes/hub.js` (add route right after `GET /contacts`).

- [ ] **Step 1: Add the route.** Same filters (via the helper), capped, audited, `text/csv` attachment. Includes a small CSV-escape helper.
```js
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /contacts/export.csv — owner-scoped CSV of the filtered set (PHI export → audited).
router.get('/contacts/export.csv', async (req, res) => {
  const built = buildContactListQuery(req);
  if (built.error) return res.status(400).json({ message: built.error });
  const MAX = 10000;
  try {
    const { rows } = await query(
      `SELECT * FROM (${built.inner}) t ${built.lifeFilter}
       ORDER BY t.last_activity_at DESC NULLS LAST LIMIT ${MAX + 1}`, built.lifeParams);
    const capped = rows.length > MAX;
    const out = rows.slice(0, MAX);
    await logSecurityEvent({
      userId: req.user.id, eventType: 'contacts_export', eventCategory: 'contacts', success: true,
      details: { ownerUserId: built.targetUserId, count: out.length, capped, filters: { status: req.query.status || req.query.lifecycle || null, tag: req.query.tag || null, service: req.query.service || null, from: req.query.from || null, to: req.query.to || null } }
    });
    const header = ['Name', 'Phone', 'Email', 'Status', 'Tags', 'Services', 'Last activity', 'First seen'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of out) {
      const status = r.archived_at ? 'Archived' : (r.lifecycle === 'active_client' ? 'Active Client' : r.lifecycle === 'in_journey' ? 'In Journey' : 'New Lead');
      const tags = Array.isArray(r.tags) ? r.tags.map((t) => t.name).join('; ') : '';
      const services = Array.isArray(r.services) ? r.services.join('; ') : '';
      lines.push([r.display_name, r.primary_phone, r.primary_email, status, tags, services, r.last_activity_at, r.first_seen_at].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[contacts:export]', { code: err?.code });
    res.status(500).json({ message: 'Failed to export contacts.' });
  }
});
```
(Confirm `logSecurityEvent` is imported in hub.js — it is, used by the rename/tag/consent routes.)

- [ ] **Step 2: Verify.** `node --check server/routes/hub.js && echo OK`; `yarn build 2>&1 | tail -3`; eslint clean.

- [ ] **Step 3: Local check** — start the server (`yarn server`), authenticate as needed, and `curl` the endpoint, OR assert the SQL shape via psql (header + at least the seeded row). Confirm the audit row is written:
```bash
psql "postgresql://bif@localhost:5432/anchor" -tAc "SELECT event_type FROM security_events WHERE event_type='contacts_export' ORDER BY created_at DESC LIMIT 1;"
# (after hitting the endpoint once) → contacts_export
```

- [ ] **Step 4: Commit.** `git add server/routes/hub.js && git commit -m "feat(contacts): GET /hub/contacts/export.csv (owner-scoped, audited)"`

---

## Task 3: Phase PR
- [ ] Push, open PR (`feat(contacts): master-list filters + CSV export (Phase 3)`), CodeRabbit, address findings, **stop for user merge approval**.

## Notes for the executor
- `status` is the new param; keep `lifecycle` working as an alias so the Phase A UI doesn't break before Phase 4 updates it.
- Export is PHI → the `logSecurityEvent` audit is mandatory; never put names/phones/emails in `details`.
- Keep the list and export on the **same** `buildContactListQuery` helper so filters can never drift apart.
