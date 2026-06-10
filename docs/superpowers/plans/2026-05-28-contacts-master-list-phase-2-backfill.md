# Contacts Master List — Phase 2: Services Backfill

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** One-time, idempotent backfill of `contact_services` from existing data: `client_services` (via `active_clients.contact_id`, `source='active_client'`) and `client_journeys.service_id` (via `client_journeys.contact_id`, `source='journey'`). Runs locally for dev and as a **Cloud Run job** off the deployed image for prod (after Phase 1's migration has deployed).

**Architecture:** Two idempotent `INSERT … SELECT … WHERE NOT EXISTS(…)` statements (keyed on `contact_id + service_id + source + source_ref_id` so re-runs don't duplicate — there's no unique constraint on this append table). Wrapped in `server/services/contactServicesBackfill.js` (returns counts; dry-run = counts only) + a CLI `scripts/backfill-contact-services.js`, mirroring `server/services/contactBackfill.js` + `scripts/backfill-contacts.js`.

**Tech Stack:** Node 20 ESM, PostgreSQL. Verify with local-DB scenarios.

**Spec:** §4 (backfill). **Depends on:** Phase 1 (`contact_services` table). **Prod run gated on Phase 1 being deployed to prod first.**

---

## File Structure
- Create: `server/services/contactServicesBackfill.js` — `runContactServicesBackfill({ dryRun })`.
- Create: `scripts/backfill-contact-services.js` — CLI wrapper (`--dry-run`, masked summary).

---

## Task 1: Backfill service module

**Files:** Create `server/services/contactServicesBackfill.js`.

- [ ] **Step 1: Write it.** Read `server/services/contactBackfill.js` first to match style (pool usage, logging, return shape).

```js
import { query } from '../db.js';

// Idempotent: NOT EXISTS guards on (contact_id, service_id, source, source_ref_id) prevent
// duplicate rows on re-run, even though contact_services has no unique constraint (it's an append log).
const ACTIVE_CLIENT_SQL = `
  INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source, source_ref_id)
  SELECT ac.contact_id, ac.owner_user_id, cs.service_id, s.name, 'active_client', ac.id
    FROM client_services cs
    JOIN active_clients ac ON ac.id = cs.active_client_id
    LEFT JOIN services s ON s.id = cs.service_id
   WHERE ac.contact_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM contact_services x
        WHERE x.contact_id = ac.contact_id AND x.service_id = cs.service_id
          AND x.source = 'active_client' AND x.source_ref_id = ac.id
     )`;

const JOURNEY_SQL = `
  INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source, source_ref_id)
  SELECT cj.contact_id, cj.owner_user_id, cj.service_id, s.name, 'journey', cj.id
    FROM client_journeys cj
    LEFT JOIN services s ON s.id = cj.service_id
   WHERE cj.contact_id IS NOT NULL AND cj.service_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM contact_services x
        WHERE x.contact_id = cj.contact_id AND x.service_id = cj.service_id
          AND x.source = 'journey' AND x.source_ref_id = cj.id
     )`;

// Dry-run counts: how many rows WOULD be inserted (the SELECT bodies of the inserts).
const ACTIVE_CLIENT_COUNT = ACTIVE_CLIENT_SQL.replace(/^[\s\S]*?SELECT/, 'SELECT count(*) AS n FROM (SELECT').replace(/$/, ') q');
const JOURNEY_COUNT = JOURNEY_SQL.replace(/^[\s\S]*?SELECT/, 'SELECT count(*) AS n FROM (SELECT').replace(/$/, ') q');

export async function runContactServicesBackfill({ dryRun = false } = {}) {
  if (dryRun) {
    const [a, j] = await Promise.all([query(ACTIVE_CLIENT_COUNT), query(JOURNEY_COUNT)]);
    return { dryRun: true, activeClient: Number(a.rows[0]?.n || 0), journey: Number(j.rows[0]?.n || 0) };
  }
  const a = await query(ACTIVE_CLIENT_SQL);
  const j = await query(JOURNEY_SQL);
  return { dryRun: false, activeClient: a.rowCount, journey: j.rowCount };
}
```
> If the `.replace(...)` count-query derivation feels fragile, instead hand-write two explicit `SELECT count(*) …` queries with the same FROM/WHERE bodies. The point is: dry-run reports counts without inserting.

- [ ] **Step 2: Verify.** `node --check server/services/contactServicesBackfill.js && echo OK`; eslint clean.

- [ ] **Step 3: Commit.** `git add server/services/contactServicesBackfill.js && git commit -m "feat(contacts): contact_services backfill service (idempotent)"`

---

## Task 2: CLI wrapper

**Files:** Create `scripts/backfill-contact-services.js`.

- [ ] **Step 1: Write it.** Read `scripts/backfill-contacts.js` first to match the arg-parsing + masked-summary style.

```js
#!/usr/bin/env node
import { runContactServicesBackfill } from '../server/services/contactServicesBackfill.js';

const dryRun = process.argv.includes('--dry-run');

(async () => {
  try {
    const res = await runContactServicesBackfill({ dryRun });
    // No PHI — counts only.
    console.log(`[backfill-contact-services] ${dryRun ? 'DRY-RUN' : 'APPLIED'} active_client=${res.activeClient} journey=${res.journey}`);
    process.exit(0);
  } catch (err) {
    console.error('[backfill-contact-services] failed', { code: err?.code, message: err?.message });
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Verify.** `node --check scripts/backfill-contact-services.js && echo OK`.

- [ ] **Step 3: Local-DB dry-run → apply → idempotent re-run.**
```bash
# seed a contact with an active-client service + a journey service
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','BF Test') RETURNING id AS c \gset
INSERT INTO services (user_id,name,base_price,active) VALUES (:'u','Whitening',300,true) RETURNING id AS s \gset
INSERT INTO active_clients (user_id,owner_user_id,client_name,contact_id) VALUES (:'u',:'u','BF Test',:'c') RETURNING id AS ac \gset
INSERT INTO client_services (active_client_id,service_id,agreed_price) VALUES (:'ac',:'s',300);
INSERT INTO client_journeys (owner_user_id,client_name,contact_id,service_id) VALUES (:'u','BF Test',:'c',:'s');
SQL
node scripts/backfill-contact-services.js --dry-run     # expect active_client>=1 journey>=1
node scripts/backfill-contact-services.js               # APPLIED active_client=N journey=M
psql "postgresql://bif@localhost:5432/anchor" -tAc "SELECT source, count(*) FROM contact_services GROUP BY 1 ORDER BY 1;"
node scripts/backfill-contact-services.js               # re-run: APPLIED active_client=0 journey=0 (idempotent)
# cleanup test rows
psql "postgresql://bif@localhost:5432/anchor" -c "DELETE FROM contacts WHERE display_name='BF Test';"  # cascades contact_services
```
Expected: dry-run shows pending counts; first apply inserts; **second apply inserts 0** (idempotent).

- [ ] **Step 4: Commit.** `git add scripts/backfill-contact-services.js && git commit -m "feat(contacts): backfill-contact-services CLI (dry-run + idempotent)"`

---

## Task 3: Phase PR + prod run plan

- [ ] **Step 1:** Push, open PR (`feat(contacts): contact_services backfill (master-list Phase 2)`), CodeRabbit, address findings, **stop for user merge approval**.
- [ ] **Step 2: Document the prod run (do NOT run until Phase 1 migration has deployed to prod).** The runtime image already ships `scripts/` (Dockerfile `COPY --from=build /app/scripts ./scripts`). After this PR merges + deploys, run as a one-off Cloud Run job off the deployed image, then delete it. Take a Cloud SQL on-demand backup first. Pattern (confirm exact image/SA with the user — mirrors the original contact backfill job):
```bash
# 1) backup, 2) deploy a one-off job from the current anchor-hub image, 3) execute, 4) delete
#   --set-cloudsql-instances anchor-hub-480305:us-central1:anchor
#   --set-secrets DATABASE_URL=DATABASE_URL:latest
#   command: node scripts/backfill-contact-services.js   (run with --dry-run first, inspect logs, then without)
```
- [ ] **Step 3:** After the prod run, capture the applied counts (active_client / journey) in the rollout status notes. Re-running is safe (idempotent).

## Notes for the executor
- The backfill snapshots `service_name` from the **current** catalog (acceptable for a one-time historical backfill).
- Idempotency comes from the `NOT EXISTS` guards, not a unique constraint — keep them.
- Prod run is **gated** on Phase 1 being live in prod (the table must exist). `.env` points at prod — never run the apply locally against it.
