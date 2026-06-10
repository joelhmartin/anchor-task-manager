# Qualified / Returning-Other Lead Split + Convert-to-Client Patient Type

**Date:** 2026-05-20
**Status:** Approved design — ready for implementation plan
**Surface:** Client Portal Leads list (`ClientPortal/LeadsTab.jsx`), lead listing endpoint (`hub.js`), convert-to-client flow (`ServiceDialog.jsx` + `agree-to-service`)

---

## Problem

The Leads list's **"New"** category chip is a dumping ground. Server-side it maps to the `lead`
bucket, which expands to raw classifier categories `warm, very_good, very_hot, hot, neutral,
unreviewed, converted` (`hub.js:5595`). Of those, only `warm`/`very_good` earn an auto **3-star**
score; `neutral`/`unreviewed` calls land there at **0 stars**. The result is a massive, low-signal
list that duplicates the All Activity view.

The naive fix — "gate New to 3★ calls, dump the rest into All Activity" — has a real revenue hole.
The star-suppression rules are deliberate (first-touch attribution; see CLAUDE.md "First-touch
attribution"): once a caller has been starred/engaged once, **subsequent calls are intentionally
NOT auto-starred** and don't re-fire ad relay, and "Existing Client"–tagged callers aren't
re-starred. So a caller marked 3★ on Monday, never added to a journey, who calls back a week later
and **actually books**, comes in at **0★** (positive category like `warm`, but `score = 0`). If
that call falls out of the Leads workflow into All Activity, the front desk loses the booking.

Separately: the convert-to-client flow unconditionally stamps **5★** on every conversion. The user
wants conversions to distinguish a genuinely **new patient** (a real acquisition → 5★ + ad
conversion) from an **existing patient** being added to the client list (no star, no ad
conversion).

---

## Goals

1. Replace the single **New** chip with two chips that **partition** the current `lead` bucket — so
   nothing is hidden, only re-sorted:
   - **Qualified** — the 3★ leads (plus all forms/SMS, which keep today's behavior).
   - **Returning/Other** — sub-3★ **calls**: lukewarm `neutral` calls *and* the suppressed
     re-engagement / "Existing Client" callbacks.
2. Keep `Priority`, `Unanswered`, `Not a Fit`, `Spam`, `Pending Review` exactly as they are.
3. Count badges must match their lists (no "Qualified (40)" showing 8 rows).
4. Convert-to-client asks **New patient vs Existing patient**; both add to the client list, but only
   **new** gets 5★ + the `new_client` ad-conversion relay + the CTM 5★ post.

## Non-Goals

- No change to the AI classifier, the star-suppression rules, or `getAutoStarRating()`.
- No change to the admin AI-classification-log surface (`activityLogs.js`
  `INTERNAL_TO_CANONICAL_LEAD_CATEGORY` / `getLeadCategoryLabel`). Those are a different screen.
- No change to All Activity's firehose behavior.
- No new DB columns, no migration. The split is a pure read-time computation on existing
  `call_logs.score` and `activity_type`; patient-type is a request-time flag, not stored.

---

## Definitions (the boolean)

Operate on the existing `lead` bucket raw categories. Define them once and share:

```
LEAD_BUCKET_CATEGORIES = ['warm','very_good','very_hot','very-hot','hot','neutral','unreviewed','converted']
```

A row in the lead bucket (and not pending) is:

- **Qualified** when it is **not** a sub-3★ call:
  `activity_type <> 'call' OR COALESCE(score, 0) >= 3`
  → all forms/SMS, plus calls with score ≥ 3 (AI 3★ and manual/converted 5★).
- **Returning/Other** when it is a sub-3★ call:
  `activity_type = 'call' AND COALESCE(score, 0) < 3`

These two are complementary and exhaustive over the lead bucket. The gate is **calls-only** by
design (`activity_type = 'call'`); forms and SMS are never demoted. Threshold is `>= 3` (4★ is
unused; 5★ conversions stay Qualified).

Pending rows (`meta.classification_pending = 'true'`) remain excluded from both and surface only
under `Pending Review`, unchanged.

---

## Piece 1 — Server: lead listing + counts (`server/routes/hub.js`)

### 1a. Category filter (the `VISIBLE_CATEGORY_BUCKETS` block, ~line 5594–5633)

Today `category === 'lead'` expands to the bucket array via
`meta->>'category' = ANY($n) AND classification_pending <> 'true'`.

Add two new handled category values, `qualified` and `returning`, both built on
`LEAD_BUCKET_CATEGORIES`:

- `category === 'qualified'`:
  ```sql
  COALESCE(meta->>'category','unreviewed') = ANY($n::text[])
  AND COALESCE(meta->>'classification_pending','false') <> 'true'
  AND (activity_type <> 'call' OR COALESCE(score, 0) >= 3)
  ```
- `category === 'returning'`:
  ```sql
  COALESCE(meta->>'category','unreviewed') = ANY($n::text[])
  AND COALESCE(meta->>'classification_pending','false') <> 'true'
  AND activity_type = 'call' AND COALESCE(score, 0) < 3
  ```

**Backward compatibility:** keep `category === 'lead'` working as the **full ungated bucket**
(qualified ∪ returning). Saved localStorage views or direct API callers passing `category=lead`
keep getting the whole bucket rather than erroring. The frontend will stop sending `lead` and send
`qualified`/`returning` instead.

### 1b. Counts (the `categoryCountsResult` query, ~line 5649–5662)

The existing per-raw-category `GROUP BY` cannot express the score split (qualified/returning share
raw categories). Add **two explicit scalar aggregates** computed under the same
`categoryCountsConditions`/`categoryCountsParams` (same lifecycle + common filters as the grouped
counts). Either extend the existing query with window-free `COUNT(*) FILTER (...)` columns or run a
small second query — implementer's choice; the cleanest is a dedicated query returning two numbers:

```sql
SELECT
  COUNT(*) FILTER (
    WHERE COALESCE(meta->>'category','unreviewed') = ANY($lead_bucket::text[])
      AND COALESCE(meta->>'classification_pending','false') <> 'true'
      AND (activity_type <> 'call' OR COALESCE(score,0) >= 3)
  ) AS qualified,
  COUNT(*) FILTER (
    WHERE COALESCE(meta->>'category','unreviewed') = ANY($lead_bucket::text[])
      AND COALESCE(meta->>'classification_pending','false') <> 'true'
      AND activity_type = 'call' AND COALESCE(score,0) < 3
  ) AS returning
FROM call_logs cl
WHERE <categoryCountsConditions>
```

Merge into the response `categoryCounts` object as `categoryCounts.qualified` and
`categoryCounts.returning`. Leave the existing per-raw-category counts intact (the other chips still
sum from them) and leave `pending_review` handling untouched.

> The same `freshCalls`/post-sync counts refresh paths (~line 5998–6011 and ~6003) should stay
> consistent. If they recompute category counts, apply the same two aggregates so badges don't drift
> after a sync. Verify during implementation.

### 1c. `score` is already exposed

The listing selects `cl.*` (`hub.js:~5691`), so `score` and `activity_type` already reach the
client. No payload change needed.

---

## Piece 2 — Frontend: chips + per-row labels (`src/views/client/ClientPortal/LeadsTab.jsx`)

### 2a. Labels, colors, default

- `VISIBLE_CATEGORY_LABELS`: replace `lead: 'New'` with `qualified: 'Qualified'` and
  `returning: 'Returning/Other'`. Final order (this drives chip render order at ~line 1589):
  `qualified, returning, needs_attention, unanswered, not_a_fit, spam, pending_review`.
- `VISIBLE_CATEGORY_COLORS`: add `qualified` (reuse today's lead blue `#dbeafe/#1e40af/#93c5fd`)
  and `returning` (neutral/slate, e.g. `#f1f5f9/#475569/#cbd5e1`, distinct from the indigo
  `unanswered` and amber `needs_attention`).
- `DEFAULT_VISIBLE_CATEGORY_FILTER`: `'lead'` → `'qualified'`. Update the two
  `setCallFilters(... category: DEFAULT_VISIBLE_CATEGORY_FILTER)` reset sites (~1334, ~1554, ~1565)
  — they already reference the constant, so changing the constant is enough; confirm none hardcode
  `'lead'`.

### 2b. Score-aware per-row chip — `getVisibleCategory()` (~line 326)

Today it maps raw category → visible bucket. Make lead-bucket rows resolve to `qualified` vs
`returning` using the **same boolean** as the server:

- If `classification_pending` → `pending_review` (unchanged).
- Compute `mapped = VISIBLE_CATEGORY_MAP[rawCategory]`.
- If `mapped === 'lead'` (i.e., a lead-bucket row):
  - `returning` when it's a call with a known score < 3
  - else `qualified`
- Else return `mapped` as today.

**Field-name gotcha (must handle):** the shaped list rows from `buildCallsFromCache`
(`server/services/ctm.js:1619`) expose the score as **`rating`** (`rating: row.score || 0`), not
`score`, and carry `activity_type` via the `meta` spread. The caller-history rows
(`historyRes.rows`, hub.js `GET /calls/:id/history`) are raw DB rows that expose **`score`** but
do **not** select `activity_type`. So the shared frontend helper must read the score as
`call.rating ?? call.score`, and the history SELECT must add `activity_type` (a two-token change) so
history form chips aren't mislabeled. The server-side filter/counts correctly use the `score`
column directly.

`getCategoryColor()` (~line 110) and any other consumer of `VISIBLE_CATEGORY_MAP` for a row's chip
must go through this score-aware resolution so the row chip matches the chip the row was filtered
into. Keep `VISIBLE_CATEGORY_MAP` itself (raw→`lead`) as the internal first step; the score split
is layered on top in `getVisibleCategory`. The history sub-view (~line 3129) and `LeadActivityRow`
chip should use the same resolver for consistency (in-scope; both render a row's category chip).

### 2c. Count badges (~line 1596–1603)

For `key === 'qualified'` read `categoryCounts.qualified || 0`; for `key === 'returning'` read
`categoryCounts.returning || 0`; `pending_review` reads `categoryCounts.pending_review` as today;
all other keys keep summing raw-category counts via `VISIBLE_CATEGORY_MAP`. (Raw lead-bucket cats
no longer map to a rendered chip directly, so they won't double-count — but guard the sum to skip
any raw cat whose `VISIBLE_CATEGORY_MAP` value is `'lead'`, since there's no longer a `lead` chip.)

### 2d. `sanitizeDefaultView` allowlist

`callFilters.category` is currently accepted as any string (~line 239). No change strictly required,
but a stale saved view with `category: 'lead'` will now hit the server's backward-compat `lead`
branch (full bucket). Acceptable. Optionally normalize `'lead' → 'qualified'` on load for a cleaner
default.

---

## Piece 3 — Convert-to-client: New vs Existing patient

### 3a. Dialog (`src/views/client/ClientPortal/ServiceDialog.jsx`)

Add a **required** patient-type choice at the top of the dialog (radio group or two-button toggle):
"Is this a new patient or an existing patient?" — `new` | `existing`. Both paths add to the client
list; the only difference is the star/relay downstream. Keep service selection as-is. `Confirm` is
disabled until a patient type is chosen (in addition to the existing ≥1-service requirement).

Pass it through `agreeToService(lead.id, { ...existing, patient_type })` in the payload (~line 73),
where `patient_type` is the string `'new' | 'existing'` (chosen as the single wire format;
`new_patient` is derived server-side as `patient_type === 'new'`). This single dialog is the only
convert UI — the LeadsTab buttons
(~2002, ~2244, ~2415) and the journey drawer (`useJourneyDrawer.jsx:223`) all open it via
`onOpenServiceDialog`, so this one edit covers every path.

Toast on success/failure as today; immediate UI update via the existing `onServiceAgreed` →
`lead-converted` event path (no change).

### 3b. Endpoint (`POST /hub/clients/:leadId/agree-to-service`, `hub.js:9135`)

- Read `patient_type` from the body, validate against the allowlist `['new','existing']`, and
  derive `const isNewPatient = patient_type === 'new'`. **Default to `existing` (no star) if absent
  or invalid**, so an un-upgraded client cache or a malformed body can't accidentally stamp 5★.
- Gate the 5★ block (~line 9359–9376): only run the `UPDATE call_logs SET score = 5` when
  `isNewPatient`. For existing patients, leave `score` untouched.
- Gate `shouldPostCtmScore` / the CTM 5★ post (~line 9446–9464) on `isNewPatient`.
- Gate the **`new_client` relay** (~line 9389–9444): require `isNewPatient` **in addition to** the
  existing `isNewClient` check. (`isNewClient` = "not already in `active_clients`"; `isNewPatient` =
  user's clinical new/existing answer. Both must hold to count a conversion.)
- The active-client insert/journey→`active_client` transition runs for **both** patient types,
  unchanged.

### 3c. Interaction with Piece 1

Converted leads (new or existing) get `status = 'active_client'` on their journey, which removes
them from the `lead_inbox` lifecycle — so they don't appear in Qualified/Returning in the inbox
regardless of star. A new-patient 5★ that surfaces in All Activity reads as **Qualified** (score
≥ 3). An existing-patient conversion with a residual 0★ call reads as **Returning/Other** in All
Activity. Both correct.

---

## Edge Cases

- **Suppressed re-engagement booking** (the motivating case): `warm` category, `score = 0`, call →
  **Returning/Other**. Carries its existing "Existing Client" system tag, so staff can spot it.
  No relay re-fire (we never touch scoring here). ✅
- **Lead-bucket form, 0★** (opt-in form, name/email only, `unreviewed` non-pending or `neutral`):
  `activity_type <> 'call'` → **Qualified** (forms unchanged). ✅
- **SMS in lead bucket:** treated like a form (`activity_type <> 'call'`) → **Qualified**. ✅
- **Pending row** (`classification_pending = true`): excluded from both, shows under Pending
  Review. ✅
- **Manual downgrade:** staff sets a `warm` call to 2★ → moves to Returning/Other. ✅
- **Saved view with `category: 'lead'`:** server backward-compat returns full bucket (ungated);
  no error. ✅
- **Existing patient, brand-new to `active_clients`** (`isNewClient = true`, `new_patient = false`):
  added to list, **no 5★, no relay, no CTM post**. ✅
- **`agree-to-service` called without patient type** (old client cache mid-deploy): defaults to
  existing → no star. Conservative; never spuriously fires a conversion. ✅

---

## Compliance Notes (HIPAA / SOC2)

- No PHI added to logs. `patient_type`/`new_patient` is a non-PHI boolean classification, not health
  data. The existing `logEvent('active-clients:agree', ...)` calls log IDs only — keep it that way.
- All new SQL uses parameterized arrays (`$n::text[]`), consistent with surrounding code. No string
  concatenation of user input.
- `patient_type` validated against an allowlist (`new` | `existing`) at the endpoint boundary;
  reject/normalize anything else.
- Access control unchanged — same `agree-to-service` auth; the `actingClient`/`x-acting-user`
  scoping in the listing endpoint is untouched.
- No change to the medical/non-medical relay HIPAA gate in `trackingRelay.js`; we only add an
  *additional* `new_patient` precondition to a relay that already runs.

---

## Verification (no test suite)

1. `yarn build` + `yarn lint` pass.
2. Leads list: `Qualified` shows 3★ calls + lead-bucket forms; `Returning/Other` shows sub-3★ calls
   including a known/"Existing Client" callback; badge counts equal row counts for both.
3. The other chips (Priority/Unanswered/Not a Fit/Spam/Pending Review) and All Activity are visually
   unchanged in content.
4. Convert a lead as **New patient** → originating call shows 5★; conversion event appears in
   `tracking_event_log` (`new_client`). Convert another as **Existing patient** → no star change;
   no new `new_client` row. (Verify in local DB; do not mutate prod.)
5. Per-row chip on each call matches the chip/tab it's filtered under (no row showing "Qualified"
   while sitting in the Returning/Other list).
6. Console clean (no new errors) in both card and table view modes.

---

## Files Touched

| File | Change |
|------|--------|
| `server/routes/hub.js` | `qualified`/`returning` category branches + backward-compat `lead`; two count aggregates; mirror in post-sync count refresh; gate 5★/CTM/relay on `new_patient` in `agree-to-service` |
| `src/views/client/ClientPortal/LeadsTab.jsx` | Labels/colors/default filter; score-aware `getVisibleCategory`/`getCategoryColor`; badge reads for qualified/returning; history sub-view chip |
| `src/views/client/ClientPortal/leads/LeadActivityRow.jsx` | Score-aware chip resolution (shared helper) |
| `src/views/client/ClientPortal/ServiceDialog.jsx` | Required New/Existing patient choice; pass `patient_type` |
| `src/api/services.js` | **No change** — `agreeToService(userId, payload)` POSTs the payload verbatim, so `patient_type` flows through |
| `server/routes/hub.js` (history SELECT) | Add `activity_type` to `GET /calls/:id/history` so the history mini-chip splits correctly |
| `docs/API_REFERENCE.md` | Document `patient_type` body param on `agree-to-service`; note `qualified`/`returning` category values on the leads listing |
