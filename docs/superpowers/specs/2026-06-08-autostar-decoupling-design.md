# Auto-Star Decoupling — Design Spec

**Date:** 2026-06-08
**Author:** jmartin (with Claude)
**Status:** Approved design — pending implementation plan
**Area:** Lead classification / auto-star (`server/services/ctm.js`, `server/services/ctmAutoSync.js`, `server/routes/hub.js`)

---

## 1. Problem

Clearly-qualified inbound **call** leads are silently failing to receive an auto-star, so they
collapse into the client-portal **"Returning/Other"** bucket and look like they were treated as
returning callers. The reporting user suspected name-based matching of returning callers. That
hypothesis is **disproven** (see §2). The real defect is in the auto-star **application** path.

### Evidence (production, read-only)

Traced example — South Anchorage Dental Center, call `4251965990`, caller `(907) 764-8460`:

- `caller_type = new`, `call_sequence = 1`, a single row for that phone, no prior history →
  correctly recognized as a **brand-new caller**.
- `category = very_good`, summary *"Caller booked a same-day cleaning appointment for tomorrow…"* →
  AI classified it **correctly** as a strong lead.
- `score = 0`. Across **116** classification-log events the score was logged **0 every time** —
  never 3. (Starred control calls log `3` from their first event.)

Scope (all clients with `auto_star_enabled = true`, last 30 days): genuinely-**new** `very_good`
call leads split **33 stuck at 0 vs 36 starred** — roughly half of the strongest new leads never
star. For South Anchorage specifically: 9/25 `very_good`, 7/12 `warm`, 9/21 `needs_attention`
stuck at 0. 8 of 9 stuck `very_good` are `caller_type='new'`, `call_sequence=1` — i.e. NOT
returning.

### What "Returning/Other" actually is

`src/views/client/ClientPortal/leads/leadCategory.js:24` —
`return isCall && score < 3 ? 'returning' : 'qualified'`. It is a **frontend bucket = any call with
score < 3**, not a tag and not a match. It is the *symptom* of the missing star, and it sweeps
genuinely-new unstarred leads in with real re-engagements.

### Disproven: name / returning-match theories

- `resolveContact` (`server/services/contacts.js:142-176`) matches only on `phone_digits10` or
  `email`; the name only fills a blank `display_name`. No name match.
- `enrichCallerType` (`server/services/ctm.js:1841-1846`) matches only on normalized phone OR
  `contact_id`. No name match.
- `buildSystemTags` (`server/services/ctm.js:626-638`) emits only `referral` / `applicant` /
  `client_provided`. There is **no** "returning" system tag.

---

## 2. Root Cause

The auto-star score for a call is **only ever written in the single sync cycle where
`classifyContent` runs.** `shouldAutoStar` is set `true` exclusively inside that branch
(`server/services/ctm.js:1322`). The score gate at `ctm.js:1361` requires `shouldAutoStar`.

Once a **real** (non-stub) summary exists, every later sync **skips re-classification** (the
`!summary || isNoConversationStubSummary(summary)` gate at `ctm.js:1312`), so `shouldAutoStar`
stays `false` and `finalScore` stays `existingScore` (0). Therefore **any one-time miss is
permanent** — the lead can never be re-evaluated. This is the same "summary-lock" gate class behind
the earlier stale-`unanswered` bug.

Contributing instances of the same decoupling:

- `scripts/backfill-failed-classifications.mjs:105` —
  `isFormActivity && score === 0 ? getAutoStarRating(...) : score` — the re-classify recovery
  applies the star **only for forms**; for **calls** it writes the qualified summary but leaves
  score 0, which then locks the call out of the sync's auto-star forever.
- `POST /api/hub/clients/:id/reclassify-leads` (the endpoint that script mirrors) shares the
  same call-vs-form asymmetry.

Why it looks intermittent / interleaved by day: the miss is per-row (depends on the state of the
gate inputs at the row's first classification — e.g. `auto_star_enabled` read for that run, or a
non-sync writer setting the summary first). `syncRatings: true` (CTM authoritative) then keeps
re-reading `ctmScore = 0` every cycle, cementing the 0.

### Manual-control findings (confirmed in code)

- **CTM is authoritative for scores** (`syncRatings: true`, `ctmAutoSync.js:149`,
  `hub.js:5960`). Scores set **directly in CTM** sync back as `existingScore` and are preserved —
  not re-classified, not zeroed. (So leads already fixed in CTM self-heal.)
- **Dashboard star** (`POST /calls/:id/score`, `hub.js:7243`) writes locally **and** posts to CTM,
  but does **not** tag the row `category_source='client'`. It survives future syncs only because
  CTM holds it; a failed CTM post leaves it vulnerable to the same reset.
- **Dashboard category change** (`PUT /calls/:id/category`, `hub.js:8620`) sets
  `category_source='client'` + the "Client Provided" tag but **never touches `score`**. So
  re-choosing "Qualified" does **not** set a 3★ today — category and star are fully decoupled.
- The **conversion relay** (GA4/Meta/Google Ads) fires off **category**, not score
  (`ctmAutoSync.js:214-219`, `QUALIFIED_LEAD_CATEGORIES.has(call.category)`). So conversions very
  likely already fired for the frozen leads — this is a **star/visibility** bug, not a
  conversion-tracking bug.

---

## 3. Goals / Non-Goals

**Goals**
- Decouple auto-star application from the classification cycle so a qualified, unrated,
  non-suppressed call gets starred on the next sync — and stays self-healing.
- Make manual category and star edits coherent (changing one drives/protects the other), matching
  user expectation.
- One-time recovery of currently-frozen leads, durable under CTM-authoritative sync.
- Never fight a human decision (manual star, manual 0, client-provided category).

**Non-Goals**
- No change to the form auto-star path (forms already star in their own path).
- No re-firing of conversion relay / ad-platform events (already fired on category).
- No change to first-touch suppression semantics (`active_client` / `recentlyQualified`).
- No new cron/scheduled job.

---

## 4. Design

### 4.1 Shared helper `computeAutoStar` (single source of truth)

```text
computeAutoStar({ category, existingScore, hasCtmRating, enrichment, categorySource, alreadyApplied })
  → { score, apply: boolean, reason }
```

Apply (`apply = true`) only when ALL hold:
- `categorySource !== 'client'` — manual override wins; never fight a human.
- `!hasCtmRating` AND `existingScore` is 0/null — never overwrite an existing CTM/manual score.
- `enrichment.callerType !== 'active_client'` AND not `enrichment.recentlyQualified` — existing
  first-touch suppression, unchanged.
- `!alreadyApplied` — the once-marker (§4.2).
- `getAutoStarRating(category) > 0`.

`score = getAutoStarRating(category)` (3 = warm/very_good/needs_attention, 2 =
not_a_fit/applicant, 1 = spam — identical to today's mapping). `reason` is a short enum string for
PHI-free logging. Pure function; testable in isolation. Reused by the sync, the backfill, and the
category-coupling.

### 4.2 Once-marker `meta.auto_star_applied_at`

- Stamped (`= now ISO`) on the row whenever `computeAutoStar` applies a star.
- Gate reads `alreadyApplied = Boolean(prevMeta.auto_star_applied_at)`.

Effects:
- Frozen leads (never auto-starred → no marker) heal on the next natural sync.
- A lead we auto-starred that a human later **cleared to 0** (`DELETE /score`, which posts 0 to
  CTM) has the marker → gate will not re-star it. Human decision respected.
- Manual category/star edits set `category_source='client'`, which independently blocks the gate.

### 4.3 Sync integration (the decoupling)

In `pullCallsFromCtm` (`server/services/ctm.js`), replace the inline auto-star block (currently
gated on `shouldAutoStar`, only set inside the `classifyContent` branch) with a call to
`computeAutoStar` that runs for **every** row each sync, independent of whether classification ran
this cycle. `shouldPostScore` becomes `apply === true`. `postSaleToCTM` and the relay paths in
`ctmAutoSync.js` / `hub.js` are unchanged (they key off `shouldPostScore` / category). The `meta`
written by the upsert includes `auto_star_applied_at` when applied.

### 4.4 Category ↔ star coupling (both directions)

**Category → star** — `PUT /calls/:id/category` (`hub.js:8620`): when the new category is one of
the **qualified lead tiers** (`warm` / `very_good` / `needs_attention` → 3★), also write the 3★
score, post it to CTM (`postSaleToCTM`), keep the existing `category_source='client'` + "Client
Provided" tag. For **any other** category (`neutral`, `unanswered`, `not_a_fit`, `applicant`,
`spam`, `unreviewed`) the endpoint sets the category + Client-Provided tag but **does not change
the star** — it neither forces a low star (no surprise 2★ on a `not_a_fit`) nor drops an existing
star. Removing a star is always an explicit human action via `DELETE /calls/:id/score`. Note this
is intentionally narrower than `computeAutoStar` (which scores not_a_fit/spam too): manual
re-categorization is about surfacing leads, not auto-assigning dispositions.

**Star → protection** — `POST /calls/:id/score` (`hub.js:7243`): also stamp
`category_source='client'` (+ tag) so the sync never touches a human-set star even if the CTM post
later fails. `DELETE /calls/:id/score` likewise marks the row human-managed
(`category_source='client'`) so a cleared lead stays at 0.

Both endpoints already post to CTM → durable under `syncRatings`.

### 4.5 One-time recovery backfill

Script modeled on `backfill-failed-classifications.mjs` (default `DRY_RUN=1`, `LIMIT` cap,
run from a `.env`-free cwd against prod via cloud-sql-proxy).

**Target rows:** `activity_type='call'` AND `score` 0/NULL AND
`meta->>'category'` ∈ {warm, very_good, needs_attention, not_a_fit, applicant, spam} AND
`category_source != 'client'` AND `caller_type != 'active_client'` AND NOT `recently_qualified`
AND no existing CTM rating.

**Per row:** `getAutoStarRating(category)` → write locally, stamp `meta.auto_star_applied_at`, **and
post to CTM** (required — `syncRatings` would otherwise re-zero it). **No relay re-fire.** Throttle
CTM posts; log `call_id` + score + category only.

**Excluded automatically:** leads already fixed directly in CTM (they now carry a CTM rating →
`hasCtmRating` true).

---

## 5. Edge Cases & Compliance

- **No PHI in logs** — log `call_id`, score, category, `reason` only; never name/number/transcript
  (matches `logAiClassificationDebug` discipline).
- **Idempotency** — re-running the backfill is a no-op (marker + CTM rating both gate it out).
- **Owner/`actingClient` scoping** — all queries `owner_user_id`/`user_id` scoped; backfill
  iterates per owner.
- **`recentlyQualified` lookup failure** — on enrichment failure the conservative path keeps
  suppression; auto-star defers rather than risk double-firing (unchanged behavior).
- **Forms** — unchanged.

---

## 6. Verification (no automated test suite)

- `yarn build` + `yarn lint` must pass.
- Focused unit-style harness for the pure `computeAutoStar`: frozen-heal, manual-0-respected,
  active-client-suppressed, recently-qualified-suppressed, existing-CTM-rating-preserved,
  client-override-respected.
- `DRY_RUN` backfill diff reviewed against prod (read-only) before any live run; live run with
  `LIMIT` first, then full.
- Post-deploy spot check: re-sync South Anchorage; confirm the 8 frozen `very_good` new-caller
  calls move to 3★ and leave the "Returning/Other" bucket.

---

## 7. Affected Files (anticipated)

- `server/services/ctm.js` — extract/define `computeAutoStar`; replace inline auto-star gate;
  write `auto_star_applied_at`.
- `server/services/ctmAutoSync.js` / `server/routes/hub.js` — `shouldPostScore = apply`; no relay
  change.
- `server/routes/hub.js` — `PUT /calls/:id/category` (category→star), `POST /calls/:id/score` &
  `DELETE /calls/:id/score` (client-provided protection).
- `scripts/backfill-failed-classifications.mjs` (or a sibling) — star **calls**, not only forms;
  plus the one-time recovery backfill script.
- Docs: `docs/LEAD_CLASSIFICATION.md` note on decoupled auto-star + once-marker.
