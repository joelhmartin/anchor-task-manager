# Contact Entity — Design & Phased Rollout Plan

**Status:** **Phases 1–4 implemented** on branch `feat/contact-entity` (PR #98), all locally verified; **Phase 5 deferred by design** until the prod backfill coverage is confirmed. §10 open questions resolved & signed off. Everything remains additive / behavior-neutral until the backfill runs in prod (every read keeps a phone-match fallback).
- **Phase 1 — foundation:** tables + `resolveContact()` + ingest wiring; nothing depends on `contact_id` existing (deploy-safe: columns added pre-traffic, schema-probe gate). 2 CodeRabbit rounds clean.
- **Phase 2 — backfill:** `server/services/contactBackfill.js` + `scripts/backfill-contacts.js` (replays history through `resolveContact`; idempotent; **prod run gated**).
- **Phase 3 — read migration (behind fallback):** activity history (`/calls/:id/history`,`/detail`), `lifecycle_state`, journey `resolved_email` prefer `contact_id`, fall back to phone when null. (3d: the `/calls` `contact_phone` filter still uses phone — the unified timeline is already served by `/history`.)
- **Phase 4 — merge/split admin API + audit:** `server/routes/contacts.js` (merge-candidates queue, transactional merge, dismiss; audit-logged). UI contact-list table is owner-built; SMS-consent reads tie to the deferred CTM-texting feature.
- **Phase 5 — retire fallbacks: REVISED → the phone-match fallback is RETAINED by design.** Design review (PR #99, closed) showed `resolveContact` is intentionally never-throw — it returns `null` on a transient error and rejects sub-10-digit phones — so a small number of rows will *always* have `contact_id = NULL`, even after backfill. Deleting the fallback would permanently regress those rows. So the end state is the **Phase-3 behavior** (contact_id primary + phone fallback that only fires when `contact_id` is null — nearly free). No fallback removal.

- **Phase 6 — segmentation (added):** `contact_tags` makes tags first-class on the person (search "everyone with tag X" + bulk segments), reusing the `lead_tags` catalog; `contacts.email_opted_out`/`email_unsubscribed_at` for compliant bulk email; `/api/hub/contacts/by-tag`, `/:id/tags`, `/:id/consent`. Service-by-contact needs no table (query `client_journeys.service_id`+`contact_id`). Helper `rollupSystemTagsForContact` is ready to wire system-tag rollup into ingest (follow-up).

**Author:** mapped out for a future implementation cycle. Phases 1–4 + 6 shipped to the branch; **Phase 5 resolved as "keep the fallback" (no removal)** after design review (PR #99 closed).
**One-line:** Introduce a first-class `contacts` entity (one row per person, per client) that owns all of a contact's info, replacing the ad-hoc phone-number string matching scattered across the codebase.

---

## 1. Why — the problem today

There is **no contact/person entity**. A "person" is reconstructed *at query time* by matching normalized phone digits across three separate tables:

- `call_logs` — every call/form/SMS is its own row (`from_number`, `meta.caller_email`, `meta.caller_name`).
- `client_journeys` — `client_name` / `client_phone` / `client_email`.
- `active_clients` — `client_name` / `client_phone` / `client_email`.

The matching key everywhere is `REGEXP_REPLACE(phone,'[^0-9]','','g')` (now last-10 in the newest code). This drives:

- `lifecycle_state` (hub.js — *"Compute lifecycle_state for each call based on phone matching against active_clients and client_journeys"*),
- `enrichCallerType()` (new vs repeat vs existing) in `services/ctm.js`,
- the "all activity for this person" views (`ContactActivityExpander`, lead drawer history),
- the journey/lead **email resolution** shipped in PR #93 (same phone-match pattern).

> **Terminology note:** `owner_user_id` is the **client** (Anchor's customer — e.g. a dental practice). A **contact** is a person who reached out *to* that client (a lead/patient). Contacts are therefore scoped **per `owner_user_id`**. The same phone may be two different contacts under two different clients — that's correct and must be preserved.

### Why this is fragile
- One person with **two numbers** = two entities.
- A **shared/front-desk number** merges distinct people.
- Identity can't key off **email or name** — only phone.
- Every new feature re-implements phone matching (drift, inconsistency, the exact privacy edge CodeRabbit flagged: short-digit false matches).
- There is nowhere to durably store "all info for a contact" (consent, tags, preferences, notes, custom fields).

---

## 2. Goal

A `contacts` table that is the **single source of truth for a person**, with `contact_id` foreign keys on the activity/journey/client tables, and **identity resolution at ingest** so the link is maintained going forward. Retire the scattered phone-matching behind one `resolveContact()` chokepoint.

**Non-goals (v1):** cross-client identity (a person who is a contact for multiple clients stays as separate contact rows per owner); fuzzy name matching; external enrichment (Clearbit-style).

---

## 3. What it unlocks

- **CTM SMS** (`docs/superpowers/specs/2026-05-21-ctm-texting-design.md`): contact-level consent + STOP/opt-out suppression has a real home instead of phone-string lists.
- **Unified activity timeline** per person across calls/forms/SMS/email — already half-built via phone lookups; becomes a clean `WHERE contact_id = …`.
- **Accurate repeat/returning detection** and **attribution** (first-touch owner) keyed on identity, not a phone string.
- **Dedup + merge/split** tooling for shared numbers / multi-number people.
- One place to store **any and all contact info**: emails[], phones[], addresses, tags, consent flags, preferences, notes, custom JSONB.
- Lifecycle becomes a **contact property** (cached/derived) instead of recomputed per call.

---

## 4. Data model

### 4.1 `contacts` (one row per person, per owner)
```sql
CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name    TEXT,
  first_name      TEXT,
  last_name       TEXT,
  primary_phone   TEXT,          -- E.164
  primary_email   TEXT,
  lifecycle_state TEXT,          -- cached: lead | in_journey | active_client | … (derived; see §6)
  sms_consent     BOOLEAN NOT NULL DEFAULT false,
  sms_opted_out   BOOLEAN NOT NULL DEFAULT false,
  tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- "any and all info"
  first_seen_at   TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ
);
```

### 4.2 Multi-value identity (indexed, enables matching + uniqueness)
```sql
CREATE TABLE contact_phones (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,         -- denormalized for the unique index
  phone_digits10 TEXT NOT NULL,        -- last 10 digits, the match key
  phone_e164   TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (owner_user_id, phone_digits10)   -- a phone maps to exactly one contact per owner
);
CREATE TABLE contact_emails (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  email        CITEXT NOT NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (owner_user_id, email)
);
```
(Storing phones/emails as separate rows — not JSONB arrays — gives us the unique indexes that make matching O(1) and prevent two contacts claiming the same number.)

### 4.3 Foreign keys on existing tables (nullable, additive)
```sql
ALTER TABLE call_logs        ADD COLUMN contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE client_journeys  ADD COLUMN contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE active_clients   ADD COLUMN contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX ON call_logs (contact_id);
-- + indexes on the others
```

---

## 5. Identity resolution — the chokepoint

A single service `resolveContact({ ownerUserId, phone, email, name })` → `contactId`:

1. Normalize phone → last-10 (`REGEXP_REPLACE`, require ≥10 digits — same guard as the shipped email resolver).
2. Look up `contact_phones` by `(owner_user_id, phone_digits10)`; else `contact_emails` by `(owner_user_id, email)`.
3. **Match found** → return its `contact_id`; opportunistically add any *new* phone/email to that contact (so a known person's second number links forward).
4. **No match** → create a `contacts` row + its phone/email rows.
5. **Conflict** (phone → contact A, email → contact B) → do **not** auto-merge; pick the phone match deterministically and enqueue a `contact_merge_candidates` row for human review.

**Called at every ingest point** (this is the part that's *not* find/replace and is the real work):
- `services/ctm.js → pullCallsFromCtm` (per call/form),
- `services/forms.js → processSubmission`,
- journey creation (`routes/hub.js`),
- active-client conversion.

Without ingest-time resolution, new rows have no `contact_id` and we're back to phone matching — so this is mandatory, not optional.

---

## 6. Lifecycle as a contact property
Today `lifecycle_state` is recomputed per call by phone match. Options:
- **(a) Derived view/function** off `contact_id` (no stored state; always correct). *Recommended* — avoids drift.
- **(b) Cached column** on `contacts`, updated on journey/client transitions. Faster reads, but needs careful invalidation.

Start with (a) (a SQL function/`LEFT JOIN` on contact_id), measure, cache later only if needed.

---

## 7. Backfill (one-time, idempotent)
Per `owner_user_id`, group existing rows into contacts:
1. Gather all `(phone_digits10, email, name, source_row)` from `call_logs`, `active_clients`, `client_journeys`.
2. Union-find / group by **phone last-10** (primary key) and **email** (secondary) into contact clusters.
3. For each cluster create a `contacts` row + `contact_phones`/`contact_emails`; pick `display_name`/`primary_*` from the richest/most-recent source (prefer `active_clients` > journey > call).
4. Stamp `contact_id` back onto every source row.
5. Fold in the **CTM email backfill** (`scripts/backfill-ctm-contact-emails.js`) here — emails become `contact_emails` rows rather than `call_logs.meta` patches, making that script's job a subset of this one. *(This is why the standalone email backfill was deferred — it's redundant once contacts exist.)*

Volume: bounded per owner; run as a Cloud Run Job (native prod DB + creds), dry-run first. Shared-number clusters and multi-number people will need the merge tool (§9).

---

## 8. Incremental rollout (de-risks the "changes everything at once" concern)

The whole point is that this does **not** land as a big-bang rewrite:

- **Phase 1 — Foundation (additive, zero behavior change).** Tables + nullable `contact_id` + `resolveContact()`; call it at ingest to populate `contact_id` going forward. Phone-matching stays authoritative. Nothing reads `contact_id` yet. *Shippable on its own.*
- **Phase 2 — Backfill.** Populate `contacts` + historical `contact_id` (Cloud Run Job). Verify coverage %.
- **Phase 3 — Migrate reads, one site at a time, behind the accessor.** Convert `lifecycle_state`, `enrichCallerType`, activity history, and the email resolver to `contact_id` joins **with phone-match fallback** when `contact_id` is null. Validate each independently.
- **Phase 4 — Contact as source of truth.** UI shows `contact.display_name` / `contact.primary_email`; build the **merge/split admin tool**; consent/opt-out for SMS read from `contacts`.
- **Phase 5 — Retire fallbacks → REVISED: do NOT retire them.** The original plan was to delete the phone-match fallbacks once `contact_id` coverage was complete. A design review (PR #99, **closed without merging** 2026-05-23) showed this is unsafe: `resolveContact` is intentionally **never-throw** (returns `null` on a transient DB error) and rejects sub-10-digit phones, so a small number of rows will *always* carry `contact_id = NULL` — even after backfill, in steady state. Deleting the fallback permanently regresses those rows (empty history, `'new'` lifecycle, lost email resolution).

  **Decision:** the phone-match fallback is a **permanent NULL-`contact_id` safety net** — it only fires when `contact_id` is null, so it costs essentially nothing. The end state is the **Phase-3 behavior**: `contact_id` primary, phone fallback for the residual null rows. Nothing to remove.

  - *Optional* future hardening (not fallback removal): a periodic re-backfill to re-stamp rows whose `contact_id` is null from a transient ingest failure (re-running `backfillContacts` self-heals them — verified), shrinking the set the fallback has to cover.
  - `enrichCallerType` + other pure phone-match sites (hide/unhide-all, active-client link, `/calls` `contact_phone` filter) were never migrated to `contact_id`; migrating them is optional future work, independent of this decision.

Each phase is independently shippable and reversible; the phone-match fallback means no phase can regress existing behavior.

---

## 9. Risks & mitigations
- **Dedup correctness** — shared numbers over-merge; multi-number people under-merge. → confidence + a `contact_merge_candidates` queue + an admin **merge/split** UI; never auto-merge on conflict.
- **Blast radius** — many read sites. → §8 phased + single accessor + fallback.
- **Backfill volume / bad data** — malformed/short phones. → require ≥10 digits to match (already the rule); leave un-matchable rows `contact_id = NULL` (fallback covers them).
- **HIPAA** — contacts hold PHI (name, phone, email, notes). → encrypt sensitive columns at rest, audit-log contact CRUD + merges, scope all access by `owner_user_id` + staff role, never log PHI, honor retention. Consult `compliance-auditor`.

---

## 10. Resolved decisions (signed off 2026-05-22)

All five questions resolved with the owner before building. Decisions are binding for the implementation cycle.

1. **Shared-number policy → one contact per `(owner, phone)`.** Keep `contact_phones.UNIQUE (owner_user_id, phone_digits10)` (this is what makes matching O(1) and stops two contacts claiming the same number). Accept that households / shared lines merge; correct the rare genuine false-merge with the split tool in Phase 4. *Rejected:* splitting by name at ingest — it would require dropping the unique constraint and doing fuzzy name disambiguation on every ingest, reintroducing the drift this plan kills.
2. **Match aggressiveness → phone primary, email secondary, conflict → review queue.** `contact_emails.UNIQUE (owner_user_id, email)` makes email a hard identity key, which is required for email-only form leads (no phone clears the ≥10-digit guard). `resolveContact()`: phone match wins deterministically; email match used only when phone yields nothing; a phone↔email conflict is **never auto-merged** — it enqueues a `contact_merge_candidates` row. **Known caveat:** generic/shared emails (e.g. `info@`, a shared family address) can over-merge; treat this as a Phase-2 backfill consideration, not a v1 blocker.
3. **Lifecycle → derived first (§6a).** No stored state, always correct, zero invalidation logic. Add a cached column (§6b) later *only* if a read hotspot proves it necessary.
4. **Merge/split UX → capture conflicts only in v1; defer the admin merge/split UI to Phase 4.** Phases 1–3 only need `contact_merge_candidates` populated at ingest so no conflict is ever lost. Building the merge/split UI earlier bloats the foundation PR for work with no payoff until reads migrate.
5. **Scope sequencing → ship Phase 1 (foundation) alone first.** `resolveContact()` is the riskiest new logic — validate it on *live* ingest (new rows getting correct `contact_id`) before running the same logic across all history. The Phase 2 backfill is a Cloud Run Job against prod (bigger blast radius) and gets its own reviewed PR. *Rejected:* shipping Phase 1+2 together, which couples the unproven resolver to a prod-wide backfill.

---

## 11. Affected code inventory (migration targets for Phase 3)
- `server/services/ctm.js` — `enrichCallerType`, `pullCallsFromCtm` (ingest), `getCallerEmail`, the lifecycle/caller-type phone queries.
- `server/routes/hub.js` — `lifecycle_state` computation (~L799), `fetchJourneysForOwner` `resolved_email` (~L650), journey creation.
- `server/services/forms.js` — `processSubmission` (ingest).
- `src/views/client/ClientPortal/leads/ContactActivityExpander.jsx` — activity-by-phone → activity-by-contact.
- `src/views/client/ClientPortal/LeadsTab.jsx` — lead drawer identity/email.
- `scripts/backfill-ctm-contact-emails.js` — folds into the contact backfill.

---

## 12. Verification (no test suite)
`yarn build` + `yarn lint`; idempotency check on every migration (run twice); per-phase manual validation that lifecycle/activity/email match pre-migration output on a sample; backfill dry-run with coverage stats; `compliance-auditor` review before any contact data ships.
