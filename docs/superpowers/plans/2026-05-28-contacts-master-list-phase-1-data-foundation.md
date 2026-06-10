# Contacts Master List — Phase 1: Data Foundation (append-only services ledger)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** Add an **append-only `contact_services` ledger** and propagate entries forward whenever a journey is started (with a `service_id`) or services are added to a client (agree-to-service). Each event snapshots the service name at that moment and appends one row per service. No dedup — this is a history.

**Architecture:** New idempotent migration creates `contact_services`. A never-throws helper `appendContactServices()` (mirrors the `resolveContact()` safety style) does the inserts via the pool, **after** the originating transaction commits (best-effort; Phase 2 backfill is the safety net, so a propagation failure must never roll back a conversion or journey). Two call sites in `hub.js`.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL (`pg`). No test suite — verify with `yarn build` + `node --check` + local-DB scenarios (`psql postgresql://bif@localhost:5432/anchor`).

**Spec:** `docs/superpowers/specs/2026-05-28-contacts-master-list-consolidation-design.md` (§4).

---

## File Structure
- Create: `server/sql/migrate_contact_services.sql` — the table + indexes.
- Modify: `server/index.js` — add `maybeRunContactServicesMigration()` + append to the migration chain.
- Create: `server/services/contactServices.js` — `appendContactServices()` helper.
- Modify: `server/routes/hub.js` — propagate at agree-to-service + journey create.

---

## Task 1: Migration — `contact_services` table

**Files:** Create `server/sql/migrate_contact_services.sql`; Modify `server/index.js`.

- [ ] **Step 1: Write the migration SQL.** Append-only — **no unique constraint** (history allows repeats).

```sql
-- migrate_contact_services.sql — append-only ledger of services a contact was interested in.
-- One row per (journey-start | agree-to-service) event × service, with a name snapshot.
CREATE TABLE IF NOT EXISTS contact_services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name  TEXT,                       -- snapshot at append time (stable if catalog changes)
  source        TEXT NOT NULL,              -- 'journey' | 'active_client'
  source_ref_id UUID,                       -- originating client_journeys.id or active_clients.id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_services_contact ON contact_services(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_services_owner   ON contact_services(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_services_service ON contact_services(service_id);
```

- [ ] **Step 2: Register the migration in `server/index.js`.** Find an existing `maybeRunXMigration` (e.g. `grep -n "maybeRunContacts\|migrate_contacts_segmentation" server/index.js`) and copy its shape. Add:

```js
async function maybeRunContactServicesMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_contact_services.sql');
    await pool.query(fs.readFileSync(sqlPath, 'utf8'));
    console.log('[migrations] ran migrate_contact_services.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_contact_services.sql', err.message);
  }
}
```
(Match the file's actual `pool`/`fs`/`path` names — `grep -n "readFileSync\|const pool\|import fs" server/index.js` to confirm.)

- [ ] **Step 3: Append to the migration chain.** Find where the prior contacts migrations are chained (`grep -n "maybeRunContacts\|\.then(() => maybeRun" server/index.js`) and add `.then(() => maybeRunContactServicesMigration())` to the end of that promise chain.

- [ ] **Step 4: Apply + verify locally.**
```bash
psql "postgresql://bif@localhost:5432/anchor" -f server/sql/migrate_contact_services.sql
psql "postgresql://bif@localhost:5432/anchor" -tAc "SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='contact_services';"
# Expect: id,contact_id,owner_user_id,service_id,service_name,source,source_ref_id,created_at
node --check server/index.js && echo OK
```

- [ ] **Step 5: Fresh-scratch-DB test** (ordering safety — [[feedback-test-migrations-on-fresh-db]]):
```bash
createdb anchor_scratch_cs 2>/dev/null; psql anchor_scratch_cs -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' >/dev/null
# contacts + services + users must exist first; quickest is to run init.sql then this migration:
psql anchor_scratch_cs -f server/sql/init.sql >/dev/null 2>&1
psql anchor_scratch_cs -v ON_ERROR_STOP=1 -f server/sql/migrate_contact_services.sql && echo "FRESH_OK"
dropdb anchor_scratch_cs
```
Expected: `FRESH_OK` (no FK/order error). If `contacts`/`services` aren't in init.sql, apply the contacts foundation migration first; the point is the table creates cleanly on a DB where its FK targets already exist.

- [ ] **Step 6: Commit.**
```bash
git add server/sql/migrate_contact_services.sql server/index.js
git commit -m "feat(contacts): contact_services append-only ledger + migration"
```

---

## Task 2: `appendContactServices()` helper

**Files:** Create `server/services/contactServices.js`.

- [ ] **Step 1: Write the helper.** Never throws (returns count, logs `err.code`); snapshots `service_name` from the catalog when not supplied; owner-scoped; uses the pool by default.

```js
import { query as poolQuery } from '../db.js';

/**
 * Append one ledger row per service to contact_services. Best-effort + never-throws —
 * propagation failures must not roll back the originating conversion/journey (Phase-2
 * backfill is the safety net). `services` is an array of { service_id, service_name? }.
 * Missing names are snapshotted from the services catalog at append time.
 * Returns the number of rows appended (0 on any failure / empty input).
 */
export async function appendContactServices({ contactId, ownerUserId, services = [], source, sourceRefId = null }, exec = poolQuery) {
  if (!contactId || !ownerUserId || !source || !Array.isArray(services) || !services.length) return 0;
  try {
    let appended = 0;
    for (const s of services) {
      const serviceId = s?.service_id || null;
      if (!serviceId) continue;
      let name = s?.service_name || null;
      if (!name) {
        const r = await exec('SELECT name FROM services WHERE id = $1 AND user_id = $2', [serviceId, ownerUserId]);
        name = r.rows[0]?.name || null;
      }
      await exec(
        `INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source, source_ref_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [contactId, ownerUserId, serviceId, name, source, sourceRefId]
      );
      appended += 1;
    }
    return appended;
  } catch (err) {
    console.error('[contactServices:append]', { code: err?.code });
    return 0;
  }
}
```
(Confirm `db.js` exports `query` — `grep -n "export.*query" server/db.js`.)

- [ ] **Step 2: Verify.** `node --check server/services/contactServices.js && echo OK`; `npx eslint server/services/contactServices.js 2>&1 | grep -iE "  error  " | head` (none).

- [ ] **Step 3: Local-DB sanity** (insert a contact + service, append, confirm a row lands with the name snapshot):
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','Svc Test') RETURNING id AS c \gset
INSERT INTO services (user_id, name, base_price, active) VALUES (:'u','Invisalign',1000,true) RETURNING id AS s \gset
-- emulate appendContactServices (name resolved from catalog)
INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source, source_ref_id)
SELECT :'c', :'u', :'s', (SELECT name FROM services WHERE id=:'s' AND user_id=:'u'), 'journey', NULL;
SELECT service_name, source FROM contact_services WHERE contact_id=:'c';
ROLLBACK;
SQL
```
Expect one row: `Invisalign | journey`.

- [ ] **Step 4: Commit.** `git add server/services/contactServices.js && git commit -m "feat(contacts): appendContactServices helper (never-throws, name snapshot)"`

---

## Task 3: Propagate at agree-to-service (active-client services)

**Files:** Modify `server/routes/hub.js`.

- [ ] **Step 1: Import the helper.** Near the other service imports (`grep -n "from '../services/contacts.js'" server/routes/hub.js`):
```js
import { appendContactServices } from '../services/contactServices.js';
```

- [ ] **Step 2: Hook the convert flow.** Locate the agree-to-service handler: `grep -n "router.post('/clients/:leadId/agree-to-service'" server/routes/hub.js`. Inside it, the active client is created/looked up (has `contact_id`) and services are inserted into `client_services` (`grep -n "INSERT INTO client_services" server/routes/hub.js`). **After the transaction commits** (find the `COMMIT` / `client.release()` or the success point where you have the `active_client` id + `owner/targetUserId` + the `services` array from `req.body`), append — best-effort, pool-based, never blocks the response:

```js
    // Propagate the agreed services onto the contact's services ledger (best-effort; backfill covers gaps).
    // `contactId` = the resolved contact for this active client; `services` = req.body.services (each has service_id).
    if (contactId && Array.isArray(services) && services.length) {
      await appendContactServices({
        contactId,
        ownerUserId: targetUserId,
        services: services.map((s) => ({ service_id: s.service_id })),
        source: 'active_client',
        sourceRefId: activeClientId
      });
    }
```
Adapt the variable names to what the handler actually has in scope (`grep` around the handler for the resolved contact id — the convert flow calls `resolveContact` and stamps `active_clients.contact_id`; reuse that id; `activeClientId` is the inserted/looked-up active client's id; `targetUserId` is the owner). If the contact id isn't already in a local var at the commit point, `SELECT contact_id FROM active_clients WHERE id = $1` once.

- [ ] **Step 3: Verify.** `node --check server/routes/hub.js && echo OK`; `yarn build 2>&1 | tail -3`; eslint clean (ignore the pre-existing `50_000` parser error).

- [ ] **Step 4: Commit.** `git add server/routes/hub.js && git commit -m "feat(contacts): propagate agreed services to contact_services on agree-to-service"`

---

## Task 4: Propagate at journey create/update (journey.service_id)

**Files:** Modify `server/routes/hub.js`.

- [ ] **Step 1: Hook the journey create/update handler.** Locate it: `grep -n "router.post('/journeys'" server/routes/hub.js`. The handler inserts/updates `client_journeys` with `service_id` and resolves a `contact_id` (`grep -n "service_id\|contact_id"` within the handler). After the journey row is persisted and you have its `id`, the `service_id`, the `contact_id`, and the owner, append one entry when a `service_id` is present:

```js
    // Append the journey's service of interest to the contact's services ledger (best-effort).
    if (journeyContactId && journeyServiceId) {
      await appendContactServices({
        contactId: journeyContactId,
        ownerUserId: targetUserId,
        services: [{ service_id: journeyServiceId }],
        source: 'journey',
        sourceRefId: journeyId
      });
    }
```
Map to the handler's real vars: `journeyId` = the inserted/updated journey id (from the `RETURNING id` or the existing row id), `journeyServiceId` = the `service_id` written, `journeyContactId` = the resolved contact id for the journey, `targetUserId` = owner. Only append on **create or when `service_id` changes** (avoid duplicate appends on unrelated journey edits): guard with `if` on whether `service_id` was supplied in this request (`req.body.service_id`).

- [ ] **Step 2: Verify.** `node --check server/routes/hub.js && echo OK`; `yarn build 2>&1 | tail -3`; eslint clean.

- [ ] **Step 3: Local-DB end-to-end** (simulate both sources land in the ledger for one contact):
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','Ledger Test') RETURNING id AS c \gset
INSERT INTO services (user_id, name, base_price, active) VALUES (:'u','Implants',2000,true) RETURNING id AS s \gset
INSERT INTO contact_services (contact_id,owner_user_id,service_id,service_name,source,source_ref_id) VALUES
  (:'c',:'u',:'s','Implants','journey',NULL),
  (:'c',:'u',:'s','Implants','active_client',NULL);
\echo '--- append-only: same service appears twice (history), distinct sources ---'
SELECT service_name, source, count(*) FROM contact_services WHERE contact_id=:'c' GROUP BY 1,2 ORDER BY 2;
ROLLBACK;
SQL
```
Expect two rows: `Implants|active_client|1` and `Implants|journey|1` — confirming append-only history (no dedup).

- [ ] **Step 4: Commit.** `git add server/routes/hub.js && git commit -m "feat(contacts): propagate journey service_id to contact_services on journey start"`

---

## Task 5: Phase PR

- [ ] Push, open the PR (title: `feat(contacts): contact_services ledger + forward propagation (master-list Phase 1)`), trigger CodeRabbit, address findings, **stop for user merge approval** (see rollout workflow step 10).

## Notes for the executor
- Propagation is **best-effort + after-commit** by design — never let it roll back a conversion/journey. Backfill (Phase 2) reconciles anything missed.
- Append-only: do NOT add a unique constraint or `ON CONFLICT`. Repeats are the feature.
- Snapshot `service_name` at append time so renamed/deleted catalog services keep meaningful history.
