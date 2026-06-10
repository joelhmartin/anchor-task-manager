# Contact-Aware Caller Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `enrichCallerType` and the repeat/sequence + first-touch sites it feeds key off `contact_id` (with permanent phone fallback), so a known contact is recognized across all their numbers.

**Architecture:** Resolve the contact FIRST at each ingest site; thread its `contact_id` into `enrichCallerType`, whose 4 lookups match `contact_id` OR phone. Auto-star + ad-relay suppression inherit contact-awareness because they already read the enrichment flags. Post-sync repeat/sequence window functions partition by contact. A shared `call_logs` upsert helper omits `contact_id` when the column isn't present yet (startup race). Forward-only; no migration.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL (`pg`), no automated test suite — verification = `yarn build` + `yarn lint` + local-DB scenario checks via `psql postgresql://bif@localhost:5432/anchor`.

**Spec:** `docs/superpowers/specs/2026-05-26-contact-aware-caller-recognition-design.md`

**Branch:** `feat/contact-aware-recognition` (already created).

---

## File Structure

- `server/services/ctm.js` — `enrichCallerType` gains `contactId` (Task 1); `pullCallsFromCtm` resolves contact-first + threads `contactId` + attaches `_contactId` (Task 3). Auto-star/relay unchanged (verify only).
- `server/services/callLogUpsert.js` — NEW: shared `upsertCallLog()` with `contact_id` column-guard (Task 2).
- `server/routes/hub.js` — 4 sync save-loops use `_contactId` + `upsertCallLog` + pass `contactId` to the `enrichmentLookup` callbacks (Task 4); `fixCallerTypesPostSync` window fns partition by contact (Task 6); `/calls/:id/history` passes `contactId` (Task 7).
- `server/services/ctmAutoSync.js` — save-loop + `enrichmentLookup` (Task 5); its 2 window fns (Task 6).
- `server/services/forms.js`, `server/services/twilio.js` — resolve-first, pass `contactId` to `enrichCallerType` (Task 5).

---

## Task 1: `enrichCallerType` — contact-aware lookups

**Files:**
- Modify: `server/services/ctm.js` (`enrichCallerType`, ~L1802–1879)

- [ ] **Step 1: Add `contactId` param + OR-match the 4 lookups**

Change the signature (line ~1802) from:
```js
export async function enrichCallerType(query, userId, phoneNumber, currentCallId = null) {
```
to:
```js
export async function enrichCallerType(query, userId, phoneNumber, currentCallId = null, contactId = null) {
```

The two early-return guards (no phone / short phone, ~L1803-1810) must still allow a contact-only match. Replace:
```js
  if (!phoneNumber) {
    return { callerType: 'new', activeClientId: null, journeyId: null, callSequence: 1, previousCalls: [], priorStarred: false, priorEngaged: false, firstStarredAt: null };
  }

  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized || normalized.length < 7) {
    return { callerType: 'new', activeClientId: null, journeyId: null, callSequence: 1, previousCalls: [], priorStarred: false, priorEngaged: false, firstStarredAt: null };
  }
```
with:
```js
  const normalized = phoneNumber ? normalizePhoneNumber(phoneNumber) : null;
  const phoneUsable = !!(normalized && normalized.length >= 7);
  // Need at least one identity key. Contact-only rows (no usable phone) still match by contact.
  if (!phoneUsable && !contactId) {
    return { callerType: 'new', activeClientId: null, journeyId: null, callSequence: 1, previousCalls: [], priorStarred: false, priorEngaged: false, firstStarredAt: null };
  }
```

- [ ] **Step 2: Make the active_clients lookup contact-OR-phone**

Replace the active_clients query (~L1813-1822) with a builder that ORs on contact_id. Note: parameters are `[userId, normalized, contactId]`; the phone branch is omitted when phone isn't usable.
```js
  const matchSql = (phoneCol) => {
    const parts = [];
    if (phoneUsable) parts.push(`REGEXP_REPLACE(${phoneCol}, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')`);
    if (contactId) parts.push(`contact_id = $3`);
    return parts.join(' OR ');
  };

  const clientResult = await query(
    `SELECT id, client_name, client_email, status
     FROM active_clients
     WHERE owner_user_id = $1 AND (${matchSql('client_phone')})
     ORDER BY archived_at NULLS FIRST, created_at DESC
     LIMIT 1`,
    [userId, normalized, contactId]
  );
```

- [ ] **Step 3: Make the client_journeys lookup contact-OR-phone**

Replace the journeys query (~L1825-1836):
```js
  const journeyResult = await query(
    `SELECT cj.id, cj.client_name, cj.client_phone, cj.status, cj.archived_at,
            ac.id as active_client_id, ac.client_name as active_client_name
     FROM client_journeys cj
     LEFT JOIN active_clients ac ON cj.active_client_id = ac.id
     WHERE cj.owner_user_id = $1 AND (${matchSql('cj.client_phone')})
     ORDER BY cj.archived_at NULLS FIRST, cj.created_at DESC
     LIMIT 1`,
    [userId, normalized, contactId]
  );
```

- [ ] **Step 4: Make the previous-calls filter contact-OR-phone (drives callSequence + first-touch stats)**

Replace the `callFilter` construction (~L1838-1847) with:
```js
  // Previous activity under this owner, matched by contact_id OR phone. Reused by the
  // preview list and the first-touch stats so callSequence/priorStarred/priorEngaged
  // are computed across ALL of the contact's numbers.
  const idMatch = [];
  if (phoneUsable) idMatch.push(`REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')`);
  if (contactId) idMatch.push(`contact_id = $3`);
  let callFilter = `owner_user_id = $1 AND (${idMatch.join(' OR ')})`;
  const params = [userId, normalized, contactId];

  if (currentCallId) {
    callFilter += ` AND call_id != $${params.length + 1}`;
    params.push(currentCallId);
  }
```
The two queries that use `callFilter` (previous-calls list ~L1849, and `previousCallStatsResult` ~L1863) stay as-is — their `$${params.length + 1}` for the ENGAGED_PRIOR_CATEGORIES array still resolves correctly because `params` now has 3 base entries (+1 if currentCallId). Verify the stats query's final param index references `params.length + 1` (it does).

- [ ] **Step 5: Verify build + lint**

Run: `yarn build 2>&1 | tail -2 && npx eslint server/services/ctm.js 2>&1 | grep -c error`
Expected: build succeeds; eslint error count `0` (prettier warnings OK).

- [ ] **Step 6: Local-DB scenario — cross-number recognition**

Run this against local (read-only verification that the new SQL shape is valid + matches by contact):
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','__t1__') RETURNING id AS c \gset
INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10) VALUES (:'c',:'u','5551110001'),(:'c',:'u','5551110002');
INSERT INTO call_logs (owner_user_id,user_id,call_id,from_number,contact_id,activity_type,score,meta)
  VALUES (:'u',:'u','__t1a__','555-111-0001',:'c','call',3,'{"category":"warm"}');
-- a call from the SECOND number for the same contact: prior-engaged should see the first via contact_id
SELECT COUNT(*) AS prior_via_contact, BOOL_OR(COALESCE(score,0)>1) AS prior_starred
  FROM call_logs WHERE owner_user_id=:'u' AND (REGEXP_REPLACE(from_number,'[^0-9]','','g')=REGEXP_REPLACE('5551110002','[^0-9]','','g') OR contact_id=:'c') AND call_id!='__t1b__';
ROLLBACK;
SQL
```
Expected: `prior_via_contact = 1`, `prior_starred = t` — i.e. the second number sees the first call's engagement via `contact_id`. (Phone-only would have returned 0.)

- [ ] **Step 7: Commit**

```bash
git add server/services/ctm.js
git commit -m "feat(contacts): enrichCallerType matches contact_id OR phone (Phase 2)"
```

---

## Task 2: Shared `call_logs` upsert helper with contact_id column-guard

**Files:**
- Create: `server/services/callLogUpsert.js`
- Test: local-DB scenario

- [ ] **Step 1: Create the helper**

The existing ingest INSERT (hub.js ~L5751, ctmAutoSync ~L167) is duplicated and always names `contact_id`. Extract it, guarded by a cached column-readiness probe so it degrades to omitting `contact_id` if the column isn't present yet (server binds before migrations).

Create `server/services/callLogUpsert.js`. **Use two explicit SQL templates** (no dynamic placeholder-index math — that index-sensitivity is a known footgun). The only difference between them is the `contact_id` column/value/SET clause:
```js
// Shared call_logs upsert for the ingest paths (CTM pull, autosync, forms, twilio).
// Guards contact_id: the server binds the port before migrations run, and the
// contact_id column is added by ensureContactIdColumnsExist()/the foundation migration.
// Until it exists, omit contact_id rather than throw undefined_column (42703).
import { query as poolQuery } from '../db.js';

let _contactIdColReady = false; // only ever latches true (mirrors contacts.js schema probe)

async function contactIdColumnReady(exec) {
  if (_contactIdColReady) return true;
  try {
    const r = await exec(
      "SELECT 1 FROM information_schema.columns WHERE table_name='call_logs' AND column_name='contact_id' LIMIT 1"
    );
    if (r.rows.length) _contactIdColReady = true;
    return _contactIdColReady;
  } catch {
    return false;
  }
}

// owner_user_id AND user_id both bind $1. $2..$14 are the remaining columns in order.
const SET_COMMON = `direction=EXCLUDED.direction, from_number=EXCLUDED.from_number,
  to_number=EXCLUDED.to_number, started_at=EXCLUDED.started_at, duration_sec=EXCLUDED.duration_sec,
  score=EXCLUDED.score, meta=EXCLUDED.meta, caller_type=EXCLUDED.caller_type,
  active_client_id=EXCLUDED.active_client_id, call_sequence=EXCLUDED.call_sequence,
  activity_type=EXCLUDED.activity_type`;

const SQL_WITH_CONTACT = `INSERT INTO call_logs
  (owner_user_id, user_id, call_id, direction, from_number, to_number, started_at, duration_sec, score, meta, caller_type, active_client_id, call_sequence, activity_type, contact_id)
  VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (call_id) DO UPDATE SET ${SET_COMMON},
    contact_id=COALESCE(call_logs.contact_id, EXCLUDED.contact_id)`;

const SQL_NO_CONTACT = `INSERT INTO call_logs
  (owner_user_id, user_id, call_id, direction, from_number, to_number, started_at, duration_sec, score, meta, caller_type, active_client_id, call_sequence, activity_type)
  VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (call_id) DO UPDATE SET ${SET_COMMON}`;

/**
 * Upsert one call_logs row (ON CONFLICT (call_id)). Omits contact_id if the column
 * isn't present yet. `row` carries every column value.
 * @param {object} row { ownerUserId, callId, direction, fromNumber, toNumber, startedAt,
 *   durationSec, score, meta, callerType, activeClientId, callSequence, activityType, contactId }
 */
export async function upsertCallLog(row, exec = poolQuery) {
  // $1..$13 (owner_user_id reused for user_id via $1,$1 in the SQL).
  const params = [
    row.ownerUserId, row.callId, row.direction || null, row.fromNumber || null,
    row.toNumber || null, row.startedAt, row.durationSec || null, row.score || 0, row.meta,
    row.callerType || 'new', row.activeClientId || null, row.callSequence || 1, row.activityType || 'call'
  ];
  if (await contactIdColumnReady(exec)) {
    return exec(SQL_WITH_CONTACT, [...params, row.contactId || null]); // adds $14
  }
  return exec(SQL_NO_CONTACT, params);
}
```

- [ ] **Step 2: Verify build + lint + a real upsert round-trip**

Run: `node --check server/services/callLogUpsert.js && echo OK`
Expected: `OK`.

Then a local round-trip (confirms placeholder alignment — the riskiest part):
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','__t2__') RETURNING id AS c \gset
-- mimic the generated INSERT (with contact_id) to confirm column/value count aligns
INSERT INTO call_logs (owner_user_id,user_id,call_id,direction,from_number,to_number,started_at,duration_sec,score,meta,caller_type,active_client_id,call_sequence,activity_type,contact_id)
VALUES ($1,$1,'__t2c__','inbound','5551110003',NULL,NOW(),10,0,'{}','new',NULL,1,'call',$2)
ON CONFLICT (call_id) DO UPDATE SET score=EXCLUDED.score, contact_id=COALESCE(call_logs.contact_id, EXCLUDED.contact_id);
\set u2 :u
SELECT call_id, contact_id IS NOT NULL AS has_contact FROM call_logs WHERE call_id='__t2c__';
ROLLBACK;
SQL
```
Expected: one row, `has_contact = t`. (This validates the column/value/placeholder shape the helper produces.)

- [ ] **Step 3: Commit**

```bash
git add server/services/callLogUpsert.js
git commit -m "feat(contacts): shared call_logs upsert with contact_id column-guard"
```

---

## Task 3: `pullCallsFromCtm` — resolve contact first, thread contactId

**Files:**
- Modify: `server/services/ctm.js` (imports; per-row enrichment ~L1199-1215; `results.push` ~L1449-1460)

- [ ] **Step 1: Import resolveContact**

At the top of `ctm.js` where services are imported, add:
```js
import { resolveContact } from './contacts.js';
```
(Verify it isn't already imported; if `contacts.js` would create a circular import with `ctm.js`, instead accept a `resolveContactFn` param on `pullCallsFromCtm` and pass `resolveContact` from the caller. Check by grep: `grep -n "from './ctm.js'" server/services/contacts.js` — if empty, no cycle, import directly.)

- [ ] **Step 2: Resolve the contact before the enrichment lookup**

Replace the enrichment block (~L1199-1215) so the contact is resolved first and passed into the lookup:
```js
    const lookupCallerNumber = getCallerNumber(raw);
    // Contact Entity Phase 2: resolve the contact FIRST so enrichment is contact-aware.
    // resolveContact never throws (returns null on failure). Runs on the pool.
    let contactId = null;
    try {
      contactId = await resolveContact({
        ownerUserId,
        phone: lookupCallerNumber,
        email: getCallerEmail(raw),
        name: getCallerName(raw)
      });
    } catch (e) {
      console.error('[ctm:pullCalls] resolveContact failed; contact_id=NULL', { code: e?.code });
    }
    let enrichment = null;
    if (enrichmentLookup && (lookupCallerNumber || contactId)) {
      try {
        enrichment = await enrichmentLookup({
          ownerUserId,
          callerNumber: lookupCallerNumber,
          callId: stringId,
          contactId
        });
      } catch (lookupErr) {
        console.error('[ctm:pullCalls] enrichmentLookup failed (conservative suppress)', { callId: stringId, err: lookupErr.message });
        enrichment = { callerType: 'unknown', priorStarred: true, priorEngaged: true, firstStarredAt: null, lookupFailed: true };
      }
    }
```
(Confirm `getCallerEmail` and `getCallerName` exist in `ctm.js` — `getCallerEmail` is used by the CTM email import per CLAUDE.md; if `getCallerName` doesn't exist, pass `raw.name || raw.caller_name || null` instead. Grep: `grep -n "function getCallerName\|const getCallerName\|function getCallerEmail" server/services/ctm.js`.)

- [ ] **Step 3: Attach `_contactId` to the pushed result**

In the `results.push({ ... _enrichment: enrichment ?? null })` block (~L1449-1460), add `_contactId`:
```js
      _enrichment: enrichment ?? null,
      _contactId: contactId ?? null
```

- [ ] **Step 4: Verify build + lint**

Run: `yarn build 2>&1 | tail -2 && npx eslint server/services/ctm.js 2>&1 | grep -c error`
Expected: build succeeds; `0` errors.

- [ ] **Step 5: Commit**

```bash
git add server/services/ctm.js
git commit -m "feat(contacts): pullCallsFromCtm resolves contact first + threads contactId into enrichment"
```

---

## Task 4: hub.js sync save-loops — use `_contactId`, shared upsert, pass `contactId` to enrichmentLookup

**Files:**
- Modify: `server/routes/hub.js` — 4 enrichmentLookup callbacks (~L5712, 6043, 6212, 7891); 4 save-loops (~L5748, 6082, 6236, and the L7900 loop); import `upsertCallLog`.

- [ ] **Step 1: Import the shared upsert**

Near the other service imports in `hub.js`, add:
```js
import { upsertCallLog } from '../services/callLogUpsert.js';
```

- [ ] **Step 2: Update each enrichmentLookup callback to forward contactId**

There are 4 identical callbacks. Each currently reads:
```js
    const enrichmentLookup = ({ ownerUserId, callerNumber, callId }) =>
      enrichCallerType(query, ownerUserId, callerNumber, callId);
```
Change each to:
```js
    const enrichmentLookup = ({ ownerUserId, callerNumber, callId, contactId }) =>
      enrichCallerType(query, ownerUserId, callerNumber, callId, contactId);
```
Apply at all 4 sites (anchors: ~L5712, ~L6043, ~L6212, ~L7891). They are byte-identical; the same edit applies to each.

- [ ] **Step 3: Update each save-loop to reuse `_contactId` and call `upsertCallLog`**

Each save-loop currently resolves the contact again and inlines the INSERT. Replace the per-item body (the `const contactId = await resolveContact(...)` line + the inline `query(\`INSERT INTO call_logs ...\`)`) with reuse of the already-resolved id + the shared helper. The representative block (hub.js ~L5747-5775) becomes:
```js
          // Contact already resolved in pullCallsFromCtm; reuse it (no double-resolve).
          const contactId = item._contactId ?? null;
          return upsertCallLog({
            ownerUserId: targetUserId,
            callId: call.id,
            direction: call.direction,
            fromNumber: call.caller_number,
            toNumber: call.to_number,
            startedAt,
            durationSec: call.duration_sec,
            score: call.score || 0,
            meta: JSON.stringify({ ...stripCtmMediaMeta(meta), ...enrichment }),
            callerType: enrichment.callerType || 'new',
            activeClientId: enrichment.activeClientId || null,
            callSequence: enrichment.callSequence || 1,
            activityType: call.activity_type || 'call',
            contactId
          });
```
Apply the same transformation at all 4 save-loops (anchors: ~L5748, ~L6082, ~L6236, ~L7900). Each builds the same `meta` shape it does today — preserve whatever `meta` JSON each loop currently constructs (copy that loop's existing meta expression into the `meta:` field); only the INSERT mechanics change. Remove the now-unused inline `resolveContact` call and the inline INSERT in each.

- [ ] **Step 4: Verify build + lint**

Run: `yarn build 2>&1 | tail -2 && npx eslint server/routes/hub.js 2>&1 | grep -c error`
Expected: build succeeds; `0` errors. Grep to confirm no orphaned inline INSERTs remain in the save-loops: `grep -n "INSERT INTO call_logs" server/routes/hub.js` should no longer show the 4 sync-loop inserts (history/other reads may remain).

- [ ] **Step 5: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(contacts): hub.js sync loops reuse resolved contact + shared upsert + contact-aware enrichment"
```

---

## Task 5: ctmAutoSync + forms + twilio — same reorder

**Files:**
- Modify: `server/services/ctmAutoSync.js` (~L127 callback, ~L162-199 save-loop), `server/services/forms.js` (~L871-883), `server/services/twilio.js` (~L530)

- [ ] **Step 1: ctmAutoSync enrichmentLookup + save-loop**

Update the callback (~L127) exactly as Task 4 Step 2. Update the save-loop (~L162-199): import `upsertCallLog` at top (`import { upsertCallLog } from './callLogUpsert.js';`), reuse `item._contactId`, and replace the inline INSERT with `upsertCallLog({...})` using the same field mapping as Task 4 Step 3 (this loop's `meta` is `JSON.stringify({ ...stripCtmMediaMeta(meta), ...enrichment })`, `ownerUserId: userId`).

- [ ] **Step 2: forms.js — resolve-first, pass contactId**

`forms.js` already resolves a contact in `processSubmission` (search: `grep -n "resolveContact" server/services/forms.js`). Ensure that resolution happens BEFORE the `enrichCallerType` call (~L874) and pass its id as the 5th arg:
```js
      callerInfo = await enrichCallerType(query, ownerUserId, phone, null, formContactId);
```
where `formContactId` is the variable holding the `resolveContact(...)` result in this function. If resolution currently happens after L874, move the `resolveContact` call above it. The catch-block fallback (L879) stays unchanged.

- [ ] **Step 3: twilio.js — resolve-first, pass contactId**

Same pattern at `twilio.js` ~L530. Find the `resolveContact` call in this handler (`grep -n "resolveContact" server/services/twilio.js`); ensure it runs before the `enrichCallerType(query, clientUserId, From, null)` call and pass its id:
```js
  const callerInfo = await enrichCallerType(query, clientUserId, From, null, twilioContactId);
```

- [ ] **Step 4: Verify build + lint**

Run: `yarn build 2>&1 | tail -2 && npx eslint server/services/ctmAutoSync.js server/services/forms.js server/services/twilio.js 2>&1 | grep -c error`
Expected: build succeeds; `0` errors.

- [ ] **Step 5: Commit**

```bash
git add server/services/ctmAutoSync.js server/services/forms.js server/services/twilio.js
git commit -m "feat(contacts): contact-aware enrichment in autosync/forms/twilio ingest"
```

---

## Task 6: Post-sync repeat/sequence — partition by contact

**Files:**
- Modify: `server/routes/hub.js` (`fixCallerTypesPostSync`, ~L195-230), `server/services/ctmAutoSync.js` (~L57-90)

- [ ] **Step 1: hub.js — partition by contact (fallback phone)**

In `fixCallerTypesPostSync`, both window functions use `PARTITION BY REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')`. Replace BOTH (~L201 and ~L219) with:
```sql
              ROW_NUMBER() OVER (PARTITION BY COALESCE(contact_id::text, RIGHT(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g'), 10))
                                 ORDER BY started_at ASC) AS seq
```
And widen each inner `WHERE` from `AND from_number IS NOT NULL` to `AND (from_number IS NOT NULL OR contact_id IS NOT NULL)` so contact-only rows are sequenced too.

- [ ] **Step 2: ctmAutoSync — same change**

Apply the identical partition-key + WHERE change to the two window functions in `ctmAutoSync.js` (~L61 and ~L78).

- [ ] **Step 3: Verify build + lint + SQL validity**

Run: `yarn build 2>&1 | tail -2 && npx eslint server/routes/hub.js server/services/ctmAutoSync.js 2>&1 | grep -c error`
Expected: build succeeds; `0` errors.

Validate the window SQL parses against local:
```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 -c "SELECT id, ROW_NUMBER() OVER (PARTITION BY COALESCE(contact_id::text, RIGHT(REGEXP_REPLACE(from_number,'[^0-9]','','g'),10)) ORDER BY started_at ASC) AS seq FROM call_logs WHERE (from_number IS NOT NULL OR contact_id IS NOT NULL) LIMIT 3;"
```
Expected: 3 rows, no error.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js server/services/ctmAutoSync.js
git commit -m "feat(contacts): post-sync repeat/sequence partitions by contact (fallback phone)"
```

---

## Task 7: `/calls/:id/history` — pass contactId to its enrichment recompute

**Files:**
- Modify: `server/routes/hub.js` (~L6674)

- [ ] **Step 1: Thread the call's contact_id into the recompute**

This endpoint already SELECTs `contact_id` for the call (used by the history queries). At the `enrichCallerType(query, targetUserId, phoneNumber, callId)` call (~L6674), pass the `contactId` variable already in scope (the one read from the call row in this handler — `grep -n "contact_id" server/routes/hub.js` near L6695 confirms it's selected as `contactId`):
```js
    const enrichment = await enrichCallerType(query, targetUserId, phoneNumber, callId, contactId);
```
If the contact_id isn't already selected/in scope here, add it to that handler's call SELECT and pass it.

- [ ] **Step 2: Verify build + lint**

Run: `yarn build 2>&1 | tail -2 && npx eslint server/routes/hub.js 2>&1 | grep -c error`
Expected: build succeeds; `0` errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(contacts): /calls/:id/history recompute is contact-aware"
```

---

## Task 8: Final verification + first-touch suppression check

**Files:** none (verification only)

- [ ] **Step 1: Full build + lint**

Run: `yarn build && npx eslint server/services/ctm.js server/services/callLogUpsert.js server/routes/hub.js server/services/ctmAutoSync.js server/services/forms.js server/services/twilio.js 2>&1 | grep -c error`
Expected: build succeeds; `0` errors (prettier warnings OK).

- [ ] **Step 2: Confirm auto-star + relay inheritance is intact (read-only code check)**

Run: `grep -n "priorStarred\|priorEngaged" server/services/ctm.js | grep -iE "autostar|finalScore|1345|1346|631|632"` — confirm the auto-star guard (~L1345-1346) and relay filter (~L631-632) still gate on `enrichment.priorStarred/priorEngaged`. No code change expected; they now receive contact-level values from Task 1. Document this in the PR description.

- [ ] **Step 3: Local end-to-end scenario — single-number contact unchanged; multi-number recognized**

```bash
psql "postgresql://bif@localhost:5432/anchor" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT id AS u FROM users LIMIT 1 \gset
-- single-number contact: contact-match == phone-match (behavior unchanged)
INSERT INTO contacts (owner_user_id, display_name) VALUES (:'u','__solo__') RETURNING id AS s \gset
INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10) VALUES (:'s',:'u','5552220001');
INSERT INTO call_logs (owner_user_id,user_id,call_id,from_number,contact_id,activity_type,score,meta)
  VALUES (:'u',:'u','__solo_a__','555-222-0001',:'s','call',2,'{"category":"warm"}');
SELECT BOOL_OR(COALESCE(score,0)>1) AS phone_only_prior FROM call_logs
  WHERE owner_user_id=:'u' AND REGEXP_REPLACE(from_number,'[^0-9]','','g')='5552220001' AND call_id!='__solo_b__';
SELECT BOOL_OR(COALESCE(score,0)>1) AS contact_prior FROM call_logs
  WHERE owner_user_id=:'u' AND (REGEXP_REPLACE(from_number,'[^0-9]','','g')='5552220001' OR contact_id=:'s') AND call_id!='__solo_b__';
ROLLBACK;
SQL
```
Expected: `phone_only_prior = t` AND `contact_prior = t` — identical for a single-number contact (proves no regression for the common case).

- [ ] **Step 4: Push + open PR**

```bash
git push origin feat/contact-aware-recognition
gh pr create --base main --title "feat(contacts): contact-aware caller recognition (Phase 2 core)" --body "Implements docs/superpowers/specs/2026-05-26-contact-aware-caller-recognition-design.md. enrichCallerType + repeat/sequence + first-touch now key off contact_id (phone fallback). Auto-star/relay inherit. Forward-only, no migration."
```

- [ ] **Step 5: Trigger CodeRabbit, address findings, then merge** (per workflow — comment `@coderabbitai review`, wait, fix, re-review until clean).

---

## Notes for the executor
- **No migration in this PR** — purely code. The `contacts` schema + backfill are already live in prod.
- **Phone fallback is permanent** — never remove the phone branch; it covers residual NULL-`contact_id` rows.
- **Watch placeholder/param alignment** in `callLogUpsert.js` (Task 2) — it's the one piece with index-sensitivity; the round-trip check in Task 2 Step 2 guards it.
- **Behavior change is bounded to multi-number contacts**; single-number callers are provably unchanged (Task 8 Step 3).
