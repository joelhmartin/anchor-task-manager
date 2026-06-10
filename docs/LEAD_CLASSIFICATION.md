# AI Classification & Star Rating

Both calls and forms use the same classification pipeline and star rating logic.

## Categories — canonical user-facing set (5)

The Leads UI surfaces exactly five categories: **Lead, Needs Attention, Unanswered, Not a Fit, Spam.** A sixth state, **Pending Review**, exists for rows that haven't been classified yet (e.g. older calls outside the 30-day import window, or transient overflow when classification hits the per-request cap).

The classifier internally emits richer scoring labels (`warm`, `very_good`, `neutral`, `applicant`, `converted`) that drive auto-star and analytics, but they are **never user-facing as categories**. They map into the canonical 5 at the UI layer (see `src/views/client/ClientPortal/LeadsTab.jsx:VISIBLE_CATEGORY_MAP` and `src/api/activityLogs.js:INTERNAL_TO_CANONICAL_LEAD_CATEGORY`):

- `warm`, `very_good`, `good`, `hot`, `very_hot`, `neutral`, `converted`, `active_client`, `returning_customer` → **Lead** chip
- `needs_attention` → **Needs Attention**
- `unanswered`, `voicemail` → **Unanswered**
- `not_a_fit`, `applicant` → **Not a Fit**
- `spam` → **Spam**
- `unreviewed` → **Pending Review**

## Tags (semantic, additive — added by `buildSystemTags` in `services/ctm.js`)

Tags are not categories; they're additional context shown alongside the category chip:

- **Repeat Caller** — set when `caller_type='repeat'` (this caller has called before).
- **Referral** — keyword-driven via `isReferralContext` (matches "mutual patient", "treatment plan", "dental office", etc.).
- **Active Client** — caller is in the `active_clients` table.
- **Applicant** — set when AI category was `applicant` (job inquiry).
- **Existing Client** — *data-driven*, NOT keyword-driven. Set whenever the caller is an active client OR has any prior starred / engaged-category call (driven by `enrichCallerType`'s `priorStarred` / `priorEngaged` flags). The tag is added regardless of transcript content — even an appointment-confirmation call from a known patient gets tagged.

## First-touch attribution

A caller's *first* starred or engaged contact owns the lead attribution. Subsequent calls or form fills from the same `from_number` under the same `owner_user_id` do NOT:

- Get auto-starred (`enrichment.priorStarred` blocks the autostar branch in both `pullCallsFromCtm` and `forms.js:processSubmission`).
- Trigger qualified-call tracking relay to GA4 / Meta CAPI / Google Ads (the qualified_call filter in `routes/hub.js` excludes `priorStarred` and `priorEngaged`).
- Auto-start a journey (the system never auto-starts journeys during sync; journeys are explicit user-initiated only).

Re-engagement contacts still appear in the Leads list (so the front desk can see them) and are tagged "Existing Client" so staff knows this isn't a fresh inbound. Stars and journey starts can still be applied manually.

**Auto-star suppression window (intentional):** the auto-star suppression keys off `recentlyQualified` — a caller who had a **3★+ contact within the last ~6 months**. A genuine re-engagement *after* 6 months is treated as a fresh lead and CAN auto-star again. (The "Existing Client" tag is still added based on any prior starred/engaged contact ever; only the auto-star/relay suppression uses the 6-month window.)

If `enrichCallerType` ever fails (DB hiccup), the lookup falls back conservatively (`priorStarred=true, priorEngaged=true, recentlyQualified=true, lookupFailed=true`). On failure we **still suppress the ad-platform relay** (avoid duplicate conversions — keyed off `priorStarred`/`priorEngaged`), but we **no longer suppress the internal auto-star SCORE** (the `lookupFailed` flag gates the score-suppression off) so a transient DB error doesn't silently demote a possibly-new real lead into Returning. Score-posting to CTM and the internal star are benign; only the ad relay carries duplicate-conversion risk.

The historical backfill that aligned existing data with this rule lives in `server/sql/migrate_classifier_softener_backfill.sql` (4th UPDATE block, marked with `score_suppressed_reason='first_touch_backfill_2026_04'`).

## Implementation

- **`classifyContent()`** in `services/ctm.js` — Sends content to Vertex AI with category definitions. Forms use `FORM_CATEGORY_DEFINITIONS` (excludes voicemail/unanswered).
- **`getAutoStarRating()`** in `services/ctm.js` (exported) — Single source of truth for **internal scoring label → star rating**:
  - `spam` → 1 star
  - `not_a_fit`, `applicant` → 2 stars
  - `warm`, `very_good`, `needs_attention` → 3 stars
  - `voicemail`, `unanswered`, `neutral`, `unreviewed` → 0 (no auto-score)
  - 4–5 stars are manual only (never auto-assigned)
- Both the **call pipeline** and **form pipeline** (`forms.js:processSubmission`) write the resulting `score` to `call_logs.score`.
- Forms create `call_logs` entries with `provider='form'`, `activity_type='form'` for the unified lead pipeline.

## First-import classification window

When a brand-new client is added with an existing CTM history, only calls newer than 30 days are classified inline. Older calls are stored with `meta.classification_pending = true` so they appear in All Activity but not in the Leads list. The 30-day cap is bypassed for admin-initiated full sync (`fullSync=true`). To retroactively classify older rows, use `scripts/backfill-pending-classifications.js`:

```bash
node scripts/backfill-pending-classifications.js --owner <userId> --limit 200 [--dry-run]
```

## Decoupled auto-star (introduced 2026-06-08)

### How it works

Auto-star decisions are made by the pure helper `computeAutoStar` in `server/services/autoStar.js` and are evaluated on **every CTM sync** (inside `pullCallsFromCtm`), not only in the cycle where AI classification runs. This "decoupling" fixes the previous "summary-lock" bug: a qualified call that entered the system before its AI classification completed was permanently frozen at score 0 because the old logic only applied auto-star during the classify step, which never re-ran once `meta.summary` was populated.

### The once-marker (`meta.auto_star_applied_at`)

`meta.auto_star_applied_at` is a once-marker that locks a star decision for a row. It is stamped in two situations:

1. **Auto-star fires** — when `computeAutoStar` returns `apply: true` during a sync.
2. **A human manually sets a star** — `POST /calls/:id/score` stamps this marker.

The manual clear (`DELETE /calls/:id/score`) and the category endpoint (`PUT /calls/:id/category`) do **not** write this marker; they rely on `category_source='client'` instead, which `computeAutoStar` always checks first.

The marker broadly means **"a star decision is locked for this row"**, not strictly "auto-star was the actor." Its effect: a missed star heals exactly once (the next sync applies it), and a star a human deliberately cleared to 0 is never re-applied by subsequent syncs.

### Manual coherence

Setting a category in the qualified tiers (`warm`, `very_good`, `needs_attention`) via `PUT /calls/:id/category` also applies a 3★ and posts the score to CTM. Non-qualified categories leave the existing star untouched. Both `POST /calls/:id/score` (manual set) and `DELETE /calls/:id/score` (manual clear) stamp `category_source='client'` so the sync's `computeAutoStar` always defers to the human's choice.

### CTM remains authoritative

Durable score changes are posted to CTM via `postSaleToCTM`. The two-way `syncRatings` sync treats CTM as the source of truth for scores; any star that isn't posted to CTM will be re-zeroed on the next pull.

### One-time recovery

`scripts/backfill-frozen-autostar.mjs` recovers pre-existing frozen 3★-tier call leads: it applies the corrected star locally, stamps the once-marker, and posts to CTM — without re-firing the conversion relay. It defaults to `DRY_RUN=1` (prints only); set `DRY_RUN=0` to write. Run with user sign-off after reviewing the dry-run output.
