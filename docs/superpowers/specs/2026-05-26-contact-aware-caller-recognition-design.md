# Contact-Aware Caller Recognition — Design (Contact Entity Phase 2, core)

**Status:** Designed 2026-05-26, approved. Follows the merged + backfilled Contact Entity foundation (`docs/superpowers/specs/2026-05-22-contact-entity-design.md`). This is the deferred slice of that spec's **Phase 3** — converting `enrichCallerType` (and the repeat/sequence + first-touch sites it feeds) from phone-matching to `contact_id`, so the contact becomes authoritative for caller recognition.

## 1. Goal

Today caller recognition (new vs repeat vs existing/active-client, call sequence, and the first-touch attribution signals that gate auto-star + GA4/Meta/Google-Ads conversion relay) is decided by **normalized phone number**. A known person calling from a *new* number is mis-seen as a fresh lead. The `contacts` entity (now populated — 7,481 contacts, prod backfill done) lets recognition key off the **contact** across all of a person's numbers.

**Confirmed intent:** a known contact calling from a new number is recognized as returning and does **not** re-fire auto-star or a duplicate ad-platform conversion (contact-level first-touch). This is the cleaner form of today's phone/activity-ID first-touch checks.

## 2. Scope

**In (this PR — "core"):**
- `enrichCallerType` → contact-aware (4 lookups match `contact_id` OR phone).
- Ingest reorder: `resolveContact` runs first; its `contact_id` is threaded into `enrichCallerType` at every ingest site.
- Post-sync repeat/sequence window functions → partition by contact (fallback phone).
- First-touch suppression (auto-star + relay) → inherits contact-awareness automatically (it reads the enrichment flags; no separate change).
- Fold in the deferred upsert `contact_id` guard (undefined_column startup race) via one shared upsert path.

**Deferred (small follow-up PR):** the `?contact_phone=` list filter and the CTM form 15-min dedup (`hashed_phone`) — cosmetic, don't affect classification or conversions.

**Principle (from the foundation spec):** one source of truth, no parallel clustering. Phone remains a **permanent fallback** for residual NULL-`contact_id` rows (the Phase-5 "keep the fallback" decision stands).

## 3. Design

### 3.1 `enrichCallerType` — add `contactId`, OR-match every lookup
Signature: `enrichCallerType(query, userId, phoneNumber, currentCallId = null, contactId = null)` (`server/services/ctm.js`, ~L1802).

Each of its 4 phone-keyed lookups gains an `OR contact_id = $contactId` branch (guarded so it's inert when `contactId` is null):
1. **active_clients** match → cross-number.
2. **client_journeys** match → cross-number.
3. **previous-calls preview list** (drives `callSequence`) → counts across all the contact's numbers.
4. **first-touch stats** (`prior_starred`, `prior_engaged`, `first_starred_at`, `total_previous_calls`) → computed contact-wide.

When `contactId` is null (unresolved row — short/garbage phone, transient resolve failure), behavior is **identical to today** (phone-only). The existing conservative fallback (`lookupFailed → priorStarred=true, priorEngaged=true`, `ctm.js` ~L1213) is unchanged — still over-suppress rather than risk duplicate conversions.

### 3.2 Ingest reorder — resolve-first, thread `contact_id`
Today enrichment is computed inside `pullCallsFromCtm` (via the `enrichmentLookup` callback) *before* `resolveContact` runs in the save loop. We invert this so `resolveContact` runs first and its `contact_id` is passed into `enrichCallerType`. Sites (all call `enrichCallerType` today):
- `hub.js` GET /calls sync paths + save-loop fallbacks (~L5712/5748, 6043/6082, 6212/6236, 7891) and the `/calls/:id/history` recompute (~L6674).
- `ctmAutoSync.js` (~L127/162).
- `forms.js` `processSubmission` (~L874) and `twilio.js` (~L530) — single-row ingest, simpler to reorder.

The `enrichmentLookup` callback signature gains `contactId`; `pullCallsFromCtm` resolves the contact for each fresh row before invoking the lookup. Exact threading mechanics are the implementation plan's job.

### 3.3 Post-sync repeat/sequence window functions
`hub.js` (~L201/219) and `ctmAutoSync.js` (~L61/78) recompute repeat-caller status + `call_sequence` with `ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(from_number,...))`. Change the partition key to `COALESCE(contact_id::text, RIGHT(REGEXP_REPLACE(from_number,'[^0-9]','','g'),10))` so cross-number calls share one sequence — consistent with §3.1's `callSequence`. (Rows with neither fall back to phone, then to per-row.)

### 3.4 First-touch suppression — inherits, verify only
The auto-star guard (`ctm.js` ~L1345-1351) and the qualified-call relay filter (~L631-632) already read `enrichment.priorStarred` / `priorEngaged`. Once §3.1 makes those contact-level, suppression is contact-level automatically — **no code change**, but the implementation must add a test/verification that a second number on an already-attributed contact does NOT auto-star or relay.

### 3.5 Upsert `contact_id` guard (folded-in)
The `call_logs` / `active_clients` upserts reference `contact_id` unconditionally; if the column isn't present yet (server binds before migrations; the column is added first by `ensureContactIdColumnsExist`, but a cron could fire in the gap), the upsert throws `undefined_column`. Add a single shared upsert builder/guard (cached column-readiness flag, reusing the `contacts.js` schema-ready signal) that omits `contact_id` when absent. DRY: one helper, used by all the ingest upserts touched in §3.2.

## 4. Affected files
- `server/services/ctm.js` — `enrichCallerType` (§3.1); the `enrichmentLookup` plumbing inside `pullCallsFromCtm`; verify auto-star/relay (§3.4).
- `server/routes/hub.js` — 4 sync save-loops + `/calls/:id/history` reorder (§3.2); 2 post-sync window fns (§3.3); shared upsert (§3.5).
- `server/services/ctmAutoSync.js` — sync save-loop reorder (§3.2); 2 window fns (§3.3); shared upsert (§3.5).
- `server/services/forms.js`, `server/services/twilio.js` — single-row ingest reorder (§3.2).
- New (or in `contacts.js`): shared `call_logs` upsert helper + column-readiness flag (§3.5).

## 5. Behavior change & risk
- **Blast radius is naturally bounded to multi-number contacts.** Single-number callers (the vast majority) resolve to a `contact_id` whose only phone equals their number → contact-match and phone-match return the *same* result → behavior unchanged. Only people who used 2+ numbers under one owner see new behavior — and that new behavior is the intended cross-number recognition.
- **Ad-conversion impact:** strictly *fewer* duplicate conversions (a cross-number re-engagement that today fires a fresh conversion will be suppressed). It can suppress a conversion that currently fires; per the documented first-touch rule that is correct. No conversion fires that wouldn't today.
- **Forward-only:** existing rows keep their stored `caller_type` snapshot. The dashboard already shows cross-number lifecycle (Phase-3 reads + completed backfill), so no historical recompute is required. (Optional future: a one-off `caller_type` recompute job — out of scope.)

## 6. Testing / verification (no automated suite)
- `yarn build` + lint on touched files.
- Local DB scenario: one contact with two phone numbers; ingest a call from each; assert (a) the 2nd is `caller_type` repeat/existing, (b) `callSequence` increments across numbers, (c) `priorStarred`/`priorEngaged` reflect the contact's history, (d) auto-star + relay are suppressed on the 2nd per first-touch, (e) a single-number contact is unchanged vs current behavior.
- Verify the upsert guard: simulate missing `contact_id` column → upsert degrades (omits column) instead of throwing.
- CodeRabbit review before merge (per workflow). Fresh-DB check not needed (no migration in this PR).

## 7. Decisions resolved
1. Scope = core-first; cosmetic filter/dedup deferred. ✔
2. Cross-number first-touch suppression = desired. ✔
3. Mechanism = resolve-first, pass `contact_id` (single chokepoint). ✔
4. Phone fallback = permanent. ✔
5. Upsert guard = folded into this PR. ✔
6. Rollout = forward-only (no historical `caller_type` recompute). ✔
