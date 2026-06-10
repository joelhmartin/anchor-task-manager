# AI Classifier Softener + Bulk Import Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop misclassifying obvious B2B-vendor spam as warm leads, limit new-client CTM imports to a 30-day classification window, hide unreviewed rows from the Leads list, and clean up category cruft from the UI/docs.

**Architecture:** The bug is in `server/services/ctm.js:878-890` — two over-eager downgrade rules (`looksLikeExplicitSpam`, `looksLikeExplicitNotFit`) override the AI's `spam`/`not_a_fit` classification whenever the transcript doesn't match a hardcoded keyword list. Removing those rules (keeping the referral-context promotion) restores the AI's authority. Separately, we cap inline AI classification on bulk import to the last 30 days, persist non-classified rows with `meta.classification_pending = true` instead of a fake "AI classification skipped" summary, and update the leads UI + admin filter dropdown to canonicalize on the 5 user-facing categories (Lead, Needs Attention, Unanswered, Not a Fit, Spam) plus a Pending Review state.

**Tech Stack:** Node 20 (ESM), Express 4, PostgreSQL 15 (jsonb), React 19, MUI 7, Vite 7. No automated test suite — verification = `yarn lint`, `yarn build`, manual visual check, and DB-state spot checks via Cloud SQL Auth Proxy.

**Working tree:** `/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard-main` (existing main worktree). **Working directly on `main`** — user explicitly opted out of a feature branch for this work. Each task is its own commit so any one can be reverted independently. Push to `origin/main` only after user gives green light at Task 16.

**Verification environment:**
- Cloud SQL: `gcloud secrets versions access latest --secret=DATABASE_URL` for prod creds
- Cloud SQL Auth Proxy: `/Users/bif/google-cloud-sdk/bin/cloud-sql-proxy --port 5433 anchor-hub-480305:us-central1:anchor`
- Local dev: `postgresql://bif@localhost:5432/anchor` (different schema state — useful for dev only)

---

## File Map

| File | Change |
|------|--------|
| `server/services/ctm.js` | Remove `looksLikeExplicitSpam` / `looksLikeExplicitNotFit` softening branches at lines 878–890. Delete the now-unused helper functions. Replace `summary = 'AI classification skipped.'` (line 1243) with `meta.classification_pending = true` flag, blank summary. Add 30-day cutoff for first-import classification. |
| `server/routes/hub.js` | First-sync detection: when `existingRows.length === 0` AND `ctm_sync_cursor IS NULL`, pass `firstImport: true` to `pullCallsFromCtm`. Fix dead `call.category === 'lead'` filter at line 5104. |
| `src/views/client/ClientPortal/LeadsTab.jsx` | Stop collapsing `unreviewed` into `lead`. Default category filter excludes `unreviewed` and the new `pending_review` state. Add a "Pending Review" chip option in the filter dropdown. |
| `src/api/activityLogs.js` | Trim `LEAD_CATEGORY_LABELS` to canonical 5 + Unreviewed. Server `meta.category` values that are internal labels (warm, very_good, neutral, applicant, converted) are no longer valid filter inputs. |
| `src/views/admin/AdminHub/AiClassificationLogsTab.jsx` | Filter dropdown rebuilt on the trimmed `LEAD_CATEGORY_LABELS`. |
| `server/routes/calls.js` *(or `hub.js` `/calls` handler)* | Filter category dropdown values: `lead` translates server-side to `category IN ('warm','very_good','neutral','converted')` until phase 5+ canonicalizes the data. |
| `server/sql/migrate_classifier_softener_backfill.sql` | New idempotent migration — re-flip rows where `meta.classification_summary ILIKE '%spam%'` AND `meta.category IN ('warm','neutral')` to `category=spam`, `score=1`. Same pattern for not_a_fit. |
| `server/index.js` | Register the new migration in the chain. |
| `CLAUDE.md` | Replace the "AI Classification & Star Rating" section to document canonical 5 user-facing categories and clarify warm/very_good/neutral/applicant are *internal scoring labels*, not user-facing categories. |
| `scripts/backfill-pending-classifications.js` | New one-off script (manual run) that scans for `meta.classification_pending = true` and processes them in batches of 25 with a sleep between batches. |

---

## Task 1: Sanity check (no branch — working on main)

**Files:** none (git only)

- [ ] **Step 1: Confirm we're on main, working tree clean, fetch latest**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard-main"
git status
git fetch origin
git log --oneline origin/main..HEAD
```

Expected: branch is `main`, working tree clean, `git log origin/main..HEAD` shows the 1 commit user already has staged for push (`9cff47b docs(reports): add Phase 1 implementation plan`). DO NOT pull — user has stated main's current state is fine. Just append commits.

- [ ] **Step 2: Confirm `yarn install` is current (so build/lint pass before changes)**

```bash
yarn install
yarn lint
yarn build
```

Expected: all three succeed. If lint or build fail before any change, stop and report — fixing those is out of scope.

- [ ] **Step 3: Capture baseline classifier behavior**

Document the current state of three production rows we expect to fix. Run via Cloud SQL Auth Proxy:

```bash
/Users/bif/google-cloud-sdk/bin/cloud-sql-proxy --port 5433 anchor-hub-480305:us-central1:anchor &
sleep 3
PASS=$(node -e "console.log(decodeURIComponent('%24SgBXQ%40%28c%2F0%2FQ%7DXD'))")
PGPASSWORD="$PASS" psql -h 127.0.0.1 -p 5433 -U jmartin -d anchor <<'SQL'
SELECT meta->>'name' AS name, meta->>'category' AS category, score,
  LEFT(meta->>'classification_summary',120) AS summary,
  LEFT(meta->>'classification_reasoning',120) AS reasoning
FROM call_logs
WHERE owner_user_id='30c10201-97c0-4848-b6d7-c22dc623b17f'
  AND meta->>'classification_summary' ILIKE '%spam%'
  AND meta->>'category' <> 'spam'
ORDER BY started_at DESC;
SQL
kill %1
```

Expected: at least the 2 rows we found in investigation (Sarah Cameto = neutral, Minneapolis MN = warm with score=3). Save output to verify Task 8 backfill works.

---

## Task 2: Remove the spam softener (the real bug)

**Files:**
- Modify: `server/services/ctm.js:878-890` (the `else if` softener branches)
- Modify: `server/services/ctm.js:492-561` (delete unused `looksLikeExplicitSpam` + `looksLikeExplicitNotFit` helpers if no other callers)

- [ ] **Step 1: Find current state of the softener block**

```bash
grep -n "looksLikeExplicitSpam\|looksLikeExplicitNotFit\|spam_softened_to\|not_a_fit_softened_to" server/services/ctm.js
```

Expected output: lines around 492 (def `looksLikeExplicitSpam`), 561 (def `looksLikeExplicitNotFit`), 878 (use of `looksLikeExplicitSpam`), 886 (use of `looksLikeExplicitNotFit`). Confirm the only callers are the softener block.

- [ ] **Step 2: Delete the softener branches but keep referral promotion + form remap**

Edit `server/services/ctm.js`. The current block at ~line 869:

```js
const combinedContext = `${content}\n${summary}`;
if (isReferralContext(combinedContext) && ['spam', 'not_a_fit', 'applicant'].includes(finalCategory)) {
  finalCategory = 'warm';
  classification = 'warm';
  adjustments.push('referral_context_promoted_to_warm');
} else if (isForm && looksLikeHighIntentPatientLead(combinedContext) && ['neutral', 'unreviewed', 'not_a_fit', 'applicant'].includes(finalCategory)) {
  finalCategory = 'very_good';
  classification = 'very_good';
  adjustments.push('high_intent_patient_form_promoted_to_very_good');
} else if (finalCategory === 'spam' && !looksLikeExplicitSpam(combinedContext)) {
  finalCategory = isForm ? 'neutral' : 'warm';
  classification = finalCategory;
  adjustments.push(`spam_softened_to_${finalCategory}`);
} else if (finalCategory === 'not_a_fit' && looksLikeSoftLead(combinedContext)) {
  finalCategory = 'warm';
  classification = 'warm';
  adjustments.push('not_a_fit_softened_to_warm');
} else if (finalCategory === 'not_a_fit' && !looksLikeExplicitNotFit(combinedContext)) {
  finalCategory = isForm ? 'neutral' : 'warm';
  classification = finalCategory;
  adjustments.push(`not_a_fit_softened_to_${finalCategory}`);
}
```

Replace with:

```js
const combinedContext = `${content}\n${summary}`;
if (isReferralContext(combinedContext) && ['spam', 'not_a_fit', 'applicant'].includes(finalCategory)) {
  finalCategory = 'warm';
  classification = 'warm';
  adjustments.push('referral_context_promoted_to_warm');
} else if (isForm && looksLikeHighIntentPatientLead(combinedContext) && ['neutral', 'unreviewed', 'not_a_fit', 'applicant'].includes(finalCategory)) {
  finalCategory = 'very_good';
  classification = 'very_good';
  adjustments.push('high_intent_patient_form_promoted_to_very_good');
} else if (finalCategory === 'not_a_fit' && looksLikeSoftLead(combinedContext)) {
  finalCategory = 'warm';
  classification = 'warm';
  adjustments.push('not_a_fit_softened_to_warm');
}
```

Rationale: the referral promotion stays (protects medical clients from false spam flags on doctor-office calls). The high-intent-form promotion stays (correctly upgrades enthusiastic patient inquiries). The `looksLikeSoftLead` not_a_fit promotion stays (caller talking about insurance/financing genuinely is a follow-up lead). Deleted: the two keyword-list overrides that were silencing the AI.

- [ ] **Step 3: Delete now-unused helpers**

Re-grep:

```bash
grep -n "looksLikeExplicitSpam\|looksLikeExplicitNotFit" server/services/ctm.js
```

Expected: only the function declarations remain (no other callers). Delete the function bodies (`looksLikeExplicitSpam` ~lines 492-515, `looksLikeExplicitNotFit` ~lines 561-590 — verify exact lines first with `grep -n "^function looksLikeExplicit"`).

- [ ] **Step 4: Lint + build**

```bash
yarn lint
yarn build
```

Expected: both pass. If lint complains about unused imports, remove them.

- [ ] **Step 5: Smoke-test against locally crafted spam transcript**

Create a quick repro using the running classifier — open a node REPL and import `classifyContent`:

```bash
node --experimental-vm-modules -e "
import('./server/services/ctm.js').then(async (m) => {
  const r = await m.classifyContent(
    'You are an AI helping a dental practice triage inbound calls.',
    'Hi, I am calling from Insurance Untangled. We offer a complimentary practice growth meeting to help you move out of insurance. Do you have a moment?',
    null,
    { source: 'call' }
  );
  console.log(JSON.stringify(r, null, 2));
}).catch((e) => { console.error(e); process.exit(1); });
"
```

Expected: `category: 'spam'` (or at least not warm/neutral). If still wrong, classifier prompt itself needs review — but the output should show the AI's raw classification is now respected.

- [ ] **Step 6: Commit**

```bash
git add server/services/ctm.js
git commit -m "fix(ctm): stop overriding AI spam/not_a_fit verdict with keyword guard

The looksLikeExplicitSpam and looksLikeExplicitNotFit guards required the
transcript to contain one of ~15 hardcoded phrases (telemarketer, robocall,
sales call, seo, etc.) before letting the AI's spam classification stand.
Modern B2B vendor pitches (review management, practice growth meeting,
AI agent service) didn't match, so legitimate spam got downgraded to
warm/neutral and auto-starred 3 stars.

Keep referral-context promotion (medical client protection) and
high-intent-patient-form promotion. Drop the keyword guards entirely."
```

---

## Task 3: Stop labeling skipped rows as completed

**Files:**
- Modify: `server/services/ctm.js:1241-1245` (the `else if (!classification)` branch)

- [ ] **Step 1: Read the current skip path**

```bash
sed -n '1226,1250p' server/services/ctm.js
```

Expected output ends with:
```js
} else if (!classification) {
  classification = 'unreviewed';
  summary = summary || 'AI classification skipped.';
  category = category || 'unreviewed';
}
```

- [ ] **Step 2: Replace with a pending flag**

Replace the `else if (!classification)` block with:

```js
} else if (!classification) {
  classification = 'unreviewed';
  category = category || 'unreviewed';
  // Don't fabricate a summary. Mark it pending so the backfill job can pick it up
  // and the UI can show "Pending Review" instead of pretending the AI ran.
  // summary stays blank.
}
```

- [ ] **Step 3: Persist the pending flag in the call meta**

Find the `callData` object construction near line 1279. Add `classification_pending` to it. Locate the line `classification_summary: summary || '',` and below it add:

```js
classification_pending: !classification || (!summary && classification === 'unreviewed') || false,
```

Actually simpler — set a const earlier in the function:
```js
const classificationPending = (classification === 'unreviewed') && !summary;
```
right after the `else if (!classification)` block, then add `classification_pending: classificationPending,` to the `callData` object.

- [ ] **Step 4: Lint + build**

```bash
yarn lint
yarn build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/ctm.js
git commit -m "fix(ctm): mark uncategorized rows as pending instead of fake skipped summary

When CTM sync hits the per-request classification cap, we previously wrote
'AI classification skipped.' as the summary, which made the row look done
to every downstream check (the next sync, UI filters, getAutoStarRating).
Mark them classification_pending=true with blank summary instead so a
backfill job can resume them and the UI can show a Pending Review state."
```

---

## Task 4: First-import 30-day classification window

**Files:**
- Modify: `server/services/ctm.js` — accept a `classifyOnlyAfter: Date|null` option in `pullCallsFromCtm`. When set, only classify calls newer than that date; older ones get the same `classification_pending=true` treatment.
- Modify: `server/routes/hub.js:5004-5025` and `:5197-5230` — pass `classifyOnlyAfter` when first-import is detected.

- [ ] **Step 1: Find existing pullCallsFromCtm signature**

```bash
grep -n "export async function pullCallsFromCtm" server/services/ctm.js
```

Expected: line ~1114, current params are `{ ownerUserId, credentials, prompt, existingRows, autoStarEnabled, syncRatings, sinceTimestamp, fullSync }`.

- [ ] **Step 2: Add `classifyOnlyAfter` parameter**

Edit the function signature at line ~1114:

```js
export async function pullCallsFromCtm({
  ownerUserId = null,
  credentials,
  prompt = DEFAULT_AI_PROMPT,
  existingRows = [],
  autoStarEnabled = false,
  syncRatings = false,
  sinceTimestamp = null,
  fullSync = false,
  classifyOnlyAfter = null
}) {
```

- [ ] **Step 3: Use it inside the classification gate**

Find the `if (hasConversation)` block at line ~1226. The current condition that runs AI is:

```js
if (!summary && classified < CLASSIFY_LIMIT) {
```

Change to:

```js
const isOutsideClassificationWindow =
  classifyOnlyAfter && raw_started_at && new Date(raw_started_at) < classifyOnlyAfter;

if (!summary && classified < CLASSIFY_LIMIT && !isOutsideClassificationWindow) {
```

Where `raw_started_at` is whatever the existing code uses for the call's start time inside the loop. Locate it — it should already be parsed earlier in the iteration (look at line ~1276 `parseTimestamp(raw)` for the canonical source, but it's parsed too late; promote that parse up before the classification gate).

Actually cleanest: declare `const startedAtForGate = raw.called_at || raw.start_time || raw.created_at || null;` near the top of the loop iteration. Then:

```js
const isOutsideClassificationWindow =
  classifyOnlyAfter && startedAtForGate && new Date(startedAtForGate) < classifyOnlyAfter;
```

- [ ] **Step 4: Wire from hub.js GET /calls (incremental sync at line 5017)**

Find:
```js
const { results: freshCalls, syncMeta } = await pullCallsFromCtm({
  ownerUserId: targetUserId,
  credentials,
  prompt: profile.ai_prompt || DEFAULT_AI_PROMPT,
  existingRows: cachedRows,
  autoStarEnabled: profile.auto_star_enabled || false,
  syncRatings: true,
  sinceTimestamp: profile.ctm_sync_cursor || null
});
```

Just above, compute first-import detection:
```js
const isFirstImport = !profile.ctm_sync_cursor && (!cachedRows || cachedRows.length === 0);
const classifyOnlyAfter = isFirstImport
  ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  : null;
```

Pass `classifyOnlyAfter` to `pullCallsFromCtm`.

- [ ] **Step 5: Wire from hub.js POST /calls/sync (line 5221)**

Same change. Detect first-import the same way (using `cached.rows` from the SELECT at line 5211 and `profile.ctm_sync_cursor`). For `fullSync=true` calls explicitly initiated by an admin, do NOT apply the 30-day window — full sync is intentional. So:

```js
const isFirstImport = !fullSync && !profile.ctm_sync_cursor && (!cached.rows || cached.rows.length === 0);
const classifyOnlyAfter = isFirstImport
  ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  : null;
```

- [ ] **Step 6: Lint + build**

```bash
yarn lint
yarn build
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/services/ctm.js server/routes/hub.js
git commit -m "feat(ctm): cap first-import AI classification to last 30 days

When a brand-new client is added with an existing CTM history, importing
hundreds of historical leads and classifying every one of them inline
hits the per-request cap. Most of the misses end up >30 days old and
have no actionable lead value anyway. Pull all calls into call_logs
(for analytics) but only classify those newer than 30 days; everything
older is stored as classification_pending=true and stays in All Activity."
```

---

## Task 5: UI — Pending Review chip + filter exclusion

**Files:**
- Modify: `src/views/client/ClientPortal/LeadsTab.jsx:111-136`

- [ ] **Step 1: Read current visible-category map**

```bash
sed -n '108,140p' src/views/client/ClientPortal/LeadsTab.jsx
```

Confirm current state:
```js
const VISIBLE_CATEGORY_MAP = {
  warm: 'lead',
  very_good: 'lead',
  ...
  unreviewed: 'lead',
  ...
};

const VISIBLE_CATEGORY_LABELS = {
  lead: 'Lead',
  needs_attention: 'Needs Attention',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam'
};
```

- [ ] **Step 2: Add pending_review key, separate unreviewed**

Replace the two consts with:

```js
// Map raw server categories to collapsed front-desk visible set
const VISIBLE_CATEGORY_MAP = {
  warm: 'lead',
  very_good: 'lead',
  very_hot: 'lead',
  'very-hot': 'lead',
  hot: 'lead',
  neutral: 'lead',
  needs_attention: 'needs_attention',
  unanswered: 'unanswered',
  voicemail: 'unanswered',
  not_a_fit: 'not_a_fit',
  applicant: 'not_a_fit',
  spam: 'spam',
  converted: 'lead',
  active_client: 'lead',
  returning_customer: 'lead',
  unreviewed: 'pending_review'
};

const VISIBLE_CATEGORY_LABELS = {
  lead: 'Lead',
  needs_attention: 'Needs Attention',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};
```

- [ ] **Step 3: Update VISIBLE_CATEGORY_COLORS**

Find the const around line 181 and add a `pending_review` color:

```js
pending_review: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' },
```

- [ ] **Step 4: Default filter excludes pending_review**

Find `DEFAULT_VISIBLE_CATEGORY_FILTER` at line ~189. Confirm it's `'lead'`. The Leads tab already filters by category, so users won't see pending_review unless they pick it. No code change needed beyond adding the new key, but verify the dropdown renders all keys (line ~1391 — `Object.entries(VISIBLE_CATEGORY_LABELS).map(...)`).

- [ ] **Step 5: Hide pending_review rows from "All leads" mode if needed**

Find any place that renders rows when category filter is "all" or unset. If the All view currently shows pending_review (it will, since they exist in the data), that's fine — the user wanted them in All Activity, not in the Lead-default view. The Leads tab already defaults to `lead`, so they're hidden by default. No change.

- [ ] **Step 6: Lint + build**

```bash
yarn lint
yarn build
```

Expected: pass.

- [ ] **Step 7: Visual smoke check**

```bash
yarn server &
yarn start
```

Open the Lead detail view of an `unreviewed` row in admin Acting-as Gunnerson. Confirm the chip set shows `Lead | Needs Attention | Unanswered | Not a Fit | Spam | Pending Review` and the active chip is "Pending Review" (not "Lead").

- [ ] **Step 8: Commit**

```bash
git add src/views/client/ClientPortal/LeadsTab.jsx
git commit -m "feat(leads): split unreviewed into Pending Review chip

Previously unreviewed/AI-skipped rows collapsed into the 'Lead' chip,
making the Leads list a junk drawer. Promote unreviewed to its own
'Pending Review' state (gray, neutral). Default Leads filter still
shows 'Lead' so pending rows are excluded; users can switch to
Pending Review to see them or use All Activity."
```

---

## Task 6: Admin AI Classification Review filter dropdown

**Files:**
- Modify: `src/api/activityLogs.js:159-169`
- Modify: `src/views/admin/AdminHub/AiClassificationLogsTab.jsx:265` (verify still works after label change)
- Modify: server-side endpoint that powers AI classification logs filter

- [ ] **Step 1: Find the API endpoint that takes the `category` filter**

```bash
grep -rn "ai_classification_logs\|classification_logs.*category\|/ai-classification" server/routes 2>&1 | head -10
```

Identify the route and what it does with the category filter param.

- [ ] **Step 2: Trim LEAD_CATEGORY_LABELS in src/api/activityLogs.js**

Replace lines 159-169:

```js
export const LEAD_CATEGORY_LABELS = {
  lead: 'Lead',
  needs_attention: 'Needs Attention',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};
```

Note: `lead` is a UI-canonical key, not a server category. The server still emits warm/very_good/neutral/etc. So the filter handler must translate.

- [ ] **Step 3: Server-side filter translation**

In the route from Step 1, when `category` query param matches a UI-canonical key, expand to the set of server categories it represents. Insert a mapping helper:

```js
const UI_CATEGORY_TO_SERVER = {
  lead: ['warm', 'very_good', 'neutral', 'converted'],
  needs_attention: ['needs_attention'],
  unanswered: ['unanswered', 'voicemail'],
  not_a_fit: ['not_a_fit', 'applicant'],
  spam: ['spam'],
  pending_review: ['unreviewed']
};

function expandCategoryFilter(uiCategory) {
  return UI_CATEGORY_TO_SERVER[uiCategory] || [uiCategory];
}
```

Where the SQL is built, replace the single-equals filter on category with `WHERE final_category = ANY($N)` and pass `expandCategoryFilter(category)` as the parameter.

- [ ] **Step 4: Verify dropdown renders**

`AiClassificationLogsTab.jsx:265` already iterates `LEAD_CATEGORY_LABELS`. After Step 2, it will render the canonical 6.

- [ ] **Step 5: Lint + build**

```bash
yarn lint
yarn build
```

Expected: pass.

- [ ] **Step 6: Visual smoke check**

Open AdminHub → AI Classification Review. Confirm dropdown shows: All Categories, Lead, Needs Attention, Unanswered, Not a Fit, Spam, Pending Review. Pick "Spam"; confirm the listed rows actually have server-side category=spam.

- [ ] **Step 7: Commit**

```bash
git add src/api/activityLogs.js src/views/admin/AdminHub/AiClassificationLogsTab.jsx server/routes/<the-route-from-step-1>.js
git commit -m "fix(admin): trim AI Classification Review filter to canonical 5 + Pending

Filter dropdown was exposing every internal classifier label
(Very Good, Good, Warm, Neutral, Applicant, Unreviewed) which
confused users about what categories actually exist. Trim to the
user-facing 5 (Lead, Needs Attention, Unanswered, Not a Fit, Spam)
plus Pending Review, and translate the UI key to the server-side
category set in the filter handler."
```

---

## Task 7: DB backfill migration for already-misclassified rows

**Files:**
- Create: `server/sql/migrate_classifier_softener_backfill.sql`
- Modify: `server/index.js` (register migration)

- [ ] **Step 1: Read the migration chain pattern**

```bash
grep -n "maybeRun.*Migration\b" server/index.js | head -20
```

Note the structure. New migrations look like:
```js
async function maybeRunClassifierSoftenerBackfill() {
  try {
    const sqlPath = path.join(__dirname, 'sql', 'migrate_classifier_softener_backfill.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_classifier_softener_backfill.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_classifier_softener_backfill.sql', err.message);
  }
}
```

- [ ] **Step 2: Write the SQL migration**

Create `server/sql/migrate_classifier_softener_backfill.sql`:

```sql
-- Re-flip rows where the AI's spam/not_a_fit verdict was overridden by the
-- looksLikeExplicit* keyword guards. Identifiable by AI summary stating spam
-- or not-a-fit while category was downgraded to warm/neutral.
-- Idempotent: only updates rows still in the wrong state.

BEGIN;

UPDATE call_logs
SET
  meta = jsonb_set(
    jsonb_set(
      jsonb_set(meta, '{category}', '"spam"'),
      '{classification}', '"spam"'
    ),
    '{category_source_detail}', '"softener_backfill_2026_04"'
  ),
  score = 1
WHERE meta->>'classification_summary' ILIKE '%spam%'
  AND meta->>'category' IN ('warm', 'neutral')
  AND COALESCE(meta->>'category_source','ai') = 'ai';

UPDATE call_logs
SET
  meta = jsonb_set(
    jsonb_set(
      jsonb_set(meta, '{category}', '"not_a_fit"'),
      '{classification}', '"not_a_fit"'
    ),
    '{category_source_detail}', '"softener_backfill_2026_04"'
  ),
  score = 2
WHERE (
    meta->>'classification_summary' ILIKE '%not a fit%'
    OR meta->>'classification_summary' ILIKE '%cannot offer%'
    OR meta->>'classification_summary' ILIKE '%don''t offer%'
    OR meta->>'classification_summary' ILIKE '%doesn''t offer%'
  )
  AND meta->>'category' IN ('warm', 'neutral')
  AND COALESCE(meta->>'category_source','ai') = 'ai';

-- Clear the old fake "AI classification skipped." summary on rows that should
-- now be re-evaluated by the backfill job.
UPDATE call_logs
SET meta = jsonb_set(
  jsonb_set(meta, '{classification_pending}', 'true'),
  '{classification_summary}', '""'
)
WHERE meta->>'classification_summary' = 'AI classification skipped.';

COMMIT;
```

- [ ] **Step 3: Register in server/index.js**

Find the migration chain (look for `maybeRunXxx().then(...)` near the bottom of the file). Append:

```js
.then(maybeRunClassifierSoftenerBackfill)
```

And define the function near the others.

- [ ] **Step 4: Lint**

```bash
yarn lint
```

Expected: pass.

- [ ] **Step 5: Test on local DB first (it's safe even if no Gunnerson rows exist locally)**

```bash
psql postgresql://bif@localhost:5432/anchor -f server/sql/migrate_classifier_softener_backfill.sql
```

Expected: BEGIN/UPDATE statements run, COMMIT.

- [ ] **Step 6: Commit**

```bash
git add server/sql/migrate_classifier_softener_backfill.sql server/index.js
git commit -m "feat(db): backfill miscategorized rows from ctm.js softener bug

Idempotent migration that re-flips category=warm|neutral rows whose AI
summary actually said 'spam' to category=spam (score=1), and similar for
not_a_fit. Also clears the fake 'AI classification skipped.' summary so
the backfill job can pick those rows up via classification_pending=true."
```

---

## Task 8: Verify migration against production (read-only spot check)

**Files:** none (verification only)

- [ ] **Step 1: Run a dry-run SELECT against prod to confirm row counts**

```bash
/Users/bif/google-cloud-sdk/bin/cloud-sql-proxy --port 5433 anchor-hub-480305:us-central1:anchor &
sleep 3
PASS=$(node -e "console.log(decodeURIComponent('%24SgBXQ%40%28c%2F0%2FQ%7DXD'))")
PGPASSWORD="$PASS" psql -h 127.0.0.1 -p 5433 -U jmartin -d anchor <<'SQL'
SELECT
  'spam_to_fix' AS bucket, COUNT(*) AS n
FROM call_logs
WHERE meta->>'classification_summary' ILIKE '%spam%'
  AND meta->>'category' IN ('warm','neutral')
  AND COALESCE(meta->>'category_source','ai') = 'ai'
UNION ALL
SELECT 'notfit_to_fix', COUNT(*)
FROM call_logs
WHERE (meta->>'classification_summary' ILIKE '%not a fit%' OR meta->>'classification_summary' ILIKE '%cannot offer%' OR meta->>'classification_summary' ILIKE '%don''t offer%' OR meta->>'classification_summary' ILIKE '%doesn''t offer%')
  AND meta->>'category' IN ('warm','neutral')
  AND COALESCE(meta->>'category_source','ai') = 'ai'
UNION ALL
SELECT 'pending_to_clear', COUNT(*)
FROM call_logs
WHERE meta->>'classification_summary' = 'AI classification skipped.';
SQL
kill %1
```

Expected: 3 row counts. The pending_to_clear count should be ~145+ across all clients (Gunnerson alone has 145).

- [ ] **Step 2: Note migration runs on next deploy**

The migration is idempotent and runs at server startup. No manual action needed beyond a deploy. Document in commit body of the deploy.

---

## Task 9: Backfill job script for Pending Review rows

**Files:**
- Create: `scripts/backfill-pending-classifications.js`

Purpose: one-off batch script run manually to drain `classification_pending=true` rows. Doesn't auto-run; admin invokes it. (We could trigger from a route in a follow-up; out of scope for this PR.)

- [ ] **Step 1: Find the existing classify entrypoint**

```bash
grep -n "classifyContent\|reclassif" server/routes/hub.js | head -10
```

Identify the existing reclassify endpoint pattern; we'll reuse `classifyContent` directly from the script.

- [ ] **Step 2: Write the script**

Create `scripts/backfill-pending-classifications.js`:

```js
#!/usr/bin/env node
// One-off script: drain classification_pending=true rows in batches.
// Usage: node scripts/backfill-pending-classifications.js [--owner <userId>] [--limit 200] [--batch 25]

import 'dotenv/config';
import { query } from '../server/db.js';
import { classifyContent, getAutoStarRating, DEFAULT_AI_PROMPT } from '../server/services/ctm.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const ownerFilter = getArg('owner', null);
const limit = parseInt(getArg('limit', '200'), 10);
const batchSize = parseInt(getArg('batch', '25'), 10);
const sleepMs = parseInt(getArg('sleep', '500'), 10);

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const where = ownerFilter
    ? `WHERE meta->>'classification_pending' = 'true' AND owner_user_id = $1`
    : `WHERE meta->>'classification_pending' = 'true'`;
  const params = ownerFilter ? [ownerFilter] : [];

  const sel = await query(
    `SELECT cl.id, cl.owner_user_id, cl.meta, cp.ai_prompt
     FROM call_logs cl
     LEFT JOIN client_profiles cp ON cp.user_id = cl.owner_user_id
     ${where}
     ORDER BY cl.started_at DESC
     LIMIT ${limit}`,
    params
  );

  console.log(`[backfill] processing ${sel.rows.length} pending rows`);
  let n = 0;
  for (const row of sel.rows) {
    const m = row.meta || {};
    const transcript = m.transcription || m.transcript || '';
    const message = m.message || '';
    if (!transcript && !message) {
      // No content to classify — leave pending=true, skip.
      continue;
    }
    try {
      const ai = await classifyContent(
        row.ai_prompt || DEFAULT_AI_PROMPT,
        transcript,
        message,
        { source: m.activity_type === 'form' ? 'form' : 'call' }
      );
      const newScore = getAutoStarRating(ai.category) || row.score || 0;
      const newMeta = {
        ...m,
        category: ai.category,
        classification: ai.classification,
        classification_summary: ai.summary,
        classification_reasoning: ai.reasoning,
        classification_pending: false,
        category_source: 'ai',
        category_source_detail: 'pending_backfill_2026_04'
      };
      await query(
        `UPDATE call_logs SET meta = $2::jsonb, score = $3 WHERE id = $1`,
        [row.id, JSON.stringify(newMeta), newScore]
      );
      n += 1;
      if (n % batchSize === 0) {
        console.log(`[backfill] ${n}/${sel.rows.length}`);
        await sleep(sleepMs);
      }
    } catch (err) {
      console.error(`[backfill] row ${row.id} failed:`, err.message);
    }
  }
  console.log(`[backfill] done — ${n} rows reclassified`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Make it executable**

```bash
chmod +x scripts/backfill-pending-classifications.js
```

- [ ] **Step 4: Smoke test against local DB**

```bash
node scripts/backfill-pending-classifications.js --limit 5
```

Expected: either says "processing 0 pending rows" (local has no Gunnerson data) or processes a few. No crash.

- [ ] **Step 5: Document usage in script header (already done)**

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-pending-classifications.js
git commit -m "feat(scripts): batch backfill for classification_pending rows

Manual one-off script. Reads call_logs where classification_pending=true,
re-runs classifyContent against the stored transcript, persists category +
score. Run after deploy with: node scripts/backfill-pending-classifications.js
[--owner <userId>] [--limit N] [--batch N]"
```

---

## Task 10: Update CLAUDE.md to canonical category model

**Files:**
- Modify: `CLAUDE.md` — the "AI Classification & Star Rating" section (~line where `getAutoStarRating` is documented)

- [ ] **Step 1: Locate the section**

```bash
grep -n "AI Classification & Star Rating\|getAutoStarRating" CLAUDE.md
```

- [ ] **Step 2: Replace with canonical model**

Find the block that currently lists `spam → 1 star | not_a_fit, applicant → 2 stars | warm, very_good, needs_attention → 3 stars`. Replace with:

```markdown
### Categories — canonical user-facing set (5)

The Leads UI surfaces exactly five categories: **Lead, Needs Attention, Unanswered, Not a Fit, Spam.** A sixth state, **Pending Review**, exists for rows that haven't been classified yet (e.g. older calls outside the 30-day import window, or transient cap overflow).

The classifier internally emits richer labels (`warm`, `very_good`, `neutral`, `applicant`, `converted`) for scoring purposes. These are NEVER user-facing as categories — they are scoring labels that map into the canonical 5 at the UI layer (`src/views/client/ClientPortal/LeadsTab.jsx:VISIBLE_CATEGORY_MAP`):

- `warm`, `very_good`, `neutral`, `converted` → "Lead" chip
- `needs_attention` → "Needs Attention"
- `unanswered`, `voicemail` → "Unanswered"
- `not_a_fit`, `applicant` → "Not a Fit"
- `spam` → "Spam"
- `unreviewed` → "Pending Review"

Things like Repeat Caller, Referral, Active Client, Applicant — those are **tags** (added by `buildSystemTags` in `services/ctm.js`), not categories.

### Auto-star rating

Driven by the internal scoring label, not the canonical category. `getAutoStarRating` in `services/ctm.js`:
- `spam` → 1 star
- `not_a_fit`, `applicant` → 2 stars
- `warm`, `very_good`, `needs_attention` → 3 stars
- `voicemail`, `unanswered`, `neutral`, `unreviewed` → 0 stars (no auto-score)
- 4–5 stars are manual only, never auto-assigned

### First-import classification window

When a brand-new client is added with an existing CTM history, only calls newer than 30 days are classified inline. Older calls are stored as `classification_pending=true` so they appear in All Activity but not in the Leads list. Use `scripts/backfill-pending-classifications.js` to retroactively classify them in batches when needed.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: clarify canonical 5 categories vs internal scoring labels

CLAUDE.md previously listed the 9 internal classifier labels as if they
were user-facing categories. Document that user-facing categories are 5
(Lead/Needs Attention/Unanswered/Not a Fit/Spam) plus Pending Review,
and warm/very_good/neutral/applicant are internal scoring labels that
never appear in the UI as categories."
```

---

## Task 11: Fix dead `category === 'lead'` filter in hub.js

**Files:**
- Modify: `server/routes/hub.js:5101-5105`

- [ ] **Step 1: Read the current filter**

```bash
sed -n '5099,5121p' server/routes/hub.js
```

Current:
```js
const qualifiedCalls = freshCalls.filter(({ call, _enrichment }) => {
  if (!call.category) return false;
  if (_enrichment?.callerType === 'active_client') return false;
  return call.category === 'lead' || call.category === 'converted';
});
```

`call.category === 'lead'` never matches because the server emits warm/very_good/needs_attention/etc., not 'lead'.

- [ ] **Step 2: Replace with the correct server-category set**

```js
const QUALIFIED_LEAD_CATEGORIES = new Set([
  'warm', 'very_good', 'needs_attention', 'converted'
]);

const qualifiedCalls = freshCalls.filter(({ call, _enrichment }) => {
  if (!call.category) return false;
  if (_enrichment?.callerType === 'active_client') return false;
  return QUALIFIED_LEAD_CATEGORIES.has(call.category);
});
```

Hoist `QUALIFIED_LEAD_CATEGORIES` to the top of `routes/hub.js` near other constants if there's a natural home.

- [ ] **Step 3: Lint + build**

```bash
yarn lint
yarn build
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "fix(hub): tracking-relay qualified-call filter never matched

call.category === 'lead' was dead — the server emits internal scoring
labels (warm/very_good/needs_attention/converted), 'lead' is a UI-only
collapse target. Use the correct server-category set so qualified
calls actually relay to GA4 / Meta CAPI / Google Ads."
```

---

## Task 12: Final review checkpoint (no PR — direct push pending user OK)

**Files:** none

- [ ] **Step 1: Self-review the full diff against origin/main**

```bash
git log --oneline origin/main..HEAD
git diff origin/main..HEAD --stat
```

Expected: ~12 commits, only files in the File Map are touched. No drive-by changes.

- [ ] **Step 2: Build + lint one more time on the merged tip**

```bash
yarn lint
yarn build
```

Both pass.

- [ ] **Step 3: Hand back to user — DO NOT push yet**

Tell user: "All tasks complete on main. N commits ahead of origin/main. Ready to push when you say go." Wait for explicit "push" before running `git push origin main`.

---

## Task 13: Extend caller enrichment with first-touch + prior-engagement signals

**Files:**
- Modify: `server/routes/hub.js` — `enrichCallerType` (locate via grep)
- Or: wherever `enrichCallerType` is defined (could be in `server/services/` — check first)

The user's intuition: the system already pulls a caller's full history into the Lead Detail page, so the data is there. We add two new fields to the enrichment return so the classifier and tracking relay can consume them.

- [ ] **Step 1: Locate enrichCallerType**

```bash
grep -rn "function enrichCallerType\|export.*enrichCallerType\|const enrichCallerType" server/
```

Expected: one source file. Read it to understand current return shape (`{ callerType, activeClientId, callSequence, ... }`).

- [ ] **Step 2: Add `priorStarred` and `priorEngaged` to the return**

In `enrichCallerType`, after the existing prior-call lookup, add:

```js
// First-touch attribution: did this caller already get an autostar / engagement
// on a prior contact? If yes, suppress autostar and tracking-relay on this call.
const priorRes = await query(
  `SELECT
     COUNT(*) FILTER (WHERE score > 0)              AS prior_starred,
     COUNT(*) FILTER (WHERE meta->>'category' IN ('warm','very_good','needs_attention','converted')) AS prior_engaged,
     MIN(started_at) FILTER (WHERE score > 0)        AS first_starred_at
   FROM call_logs
   WHERE owner_user_id = $1
     AND from_number = $2
     AND call_id <> $3`,
  [ownerUserId, callerNumber, currentCallId]
);
const priorStarred = parseInt(priorRes.rows[0]?.prior_starred || 0, 10) > 0;
const priorEngaged = parseInt(priorRes.rows[0]?.prior_engaged || 0, 10) > 0;
const firstStarredAt = priorRes.rows[0]?.first_starred_at || null;
```

Add these to the return:

```js
return {
  callerType, activeClientId, callSequence, journeyId,
  priorStarred,
  priorEngaged,
  firstStarredAt
};
```

- [ ] **Step 3: Lint + build**

```bash
yarn lint
yarn build
```

Expected: pass.

- [ ] **Step 4: Smoke-test against local DB**

Pick a caller_number that has multiple call_logs locally:

```bash
psql postgresql://bif@localhost:5432/anchor -c "SELECT from_number, COUNT(*) FROM call_logs WHERE from_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 3;"
```

Then write a quick node REPL invocation if needed, or rely on Task 14's logic exercising it in dev.

- [ ] **Step 5: Commit**

```bash
git add server/<the-file>.js
git commit -m "feat(hub): enrichCallerType returns priorStarred + priorEngaged

Existing repeat-caller detection only told us they had called before; it
didn't say whether prior contact got attributed (starred or engagement-
categorized). Add priorStarred / priorEngaged / firstStarredAt so the
classifier can apply first-touch attribution and the tag builder can
add an existing_client chip without relying on transcript keywords."
```

---

## Task 14: Existing-client tag + first-touch autostar suppression + relay exclusion

**Files:**
- Modify: `server/services/ctm.js` — `buildSystemTags` to add `existing_client` tag based on enrichment
- Modify: `server/services/ctm.js` — autostar guard around line 1267 to skip if `priorStarred`
- Modify: `server/services/ctm.js` — pass enrichment through so `buildSystemTags` can read it (it currently takes `{ semanticCategory, isReferral, categorySource }`)
- Modify: `server/routes/hub.js:5101` qualified-call filter to exclude existing-client calls
- Modify: `server/routes/hub.js` — wherever journey-start auto-trigger lives, gate it on `!priorEngaged`

- [ ] **Step 1: Read current buildSystemTags signature**

```bash
grep -n "function buildSystemTags\|buildSystemTags =" server/services/ctm.js
```

Read the function. Confirm current shape `({ semanticCategory, isReferral, categorySource })` returns an array of tag objects.

- [ ] **Step 2: Extend buildSystemTags to accept enrichment**

Edit the signature to:

```js
function buildSystemTags({ semanticCategory, isReferral, categorySource, enrichment = {} }) {
  const tags = [];
  // existing tag logic ...

  // Existing-client tag — driven by data, not keywords
  // Active in active_clients table OR has prior engagement (starred or engaged category)
  if (
    enrichment.callerType === 'active_client' ||
    enrichment.priorStarred ||
    enrichment.priorEngaged
  ) {
    tags.push({ key: 'existing_client', label: 'Existing Client', color: '#1e40af' });
  }

  return tags;
}
```

- [ ] **Step 3: Pass enrichment into buildSystemTags caller**

Find where `buildSystemTags` is called in the per-call loop in `pullCallsFromCtm`. Currently:

```js
const systemTags = buildSystemTags({ semanticCategory, isReferral, categorySource });
```

The enrichment is set on the item object after `pullCallsFromCtm` returns (`item._enrichment = enrichment;` in hub.js). That's too late. Two options:

**Option A — move enrichment into pullCallsFromCtm.** Cleaner. Pass `enrichCallerType` (or its results) into ctm.js. Requires importing enrichCallerType where it lives.

**Option B — apply system_tags after enrichment in hub.js.** Keeps ctm.js pure but means tags are written twice (once during sync, once after enrichment).

**Choose Option A.** Pass an `enrichmentLookup` callback into `pullCallsFromCtm` so it can call `enrichCallerType` per call:

```js
// pullCallsFromCtm new param:
export async function pullCallsFromCtm({
  ownerUserId = null, credentials, prompt = DEFAULT_AI_PROMPT,
  existingRows = [], autoStarEnabled = false, syncRatings = false,
  sinceTimestamp = null, fullSync = false, classifyOnlyAfter = null,
  enrichmentLookup = null  // new
}) {
```

Inside the loop, before computing `systemTags`:

```js
const enrichment = enrichmentLookup
  ? await enrichmentLookup({ ownerUserId, callerNumber: call.caller_number, callId: stringId })
  : {};
```

Use enrichment for `buildSystemTags`.

In hub.js callers (both `/calls` and `/calls/sync`), construct the lookup:

```js
const enrichmentLookup = ({ ownerUserId, callerNumber, callId }) =>
  enrichCallerType(query, ownerUserId, callerNumber, callId);
```

Pass to `pullCallsFromCtm`. Remove the duplicate `enrichCallerType` call from the post-pull loop in hub.js (it would now be a re-fetch).

- [ ] **Step 4: First-touch autostar suppression**

In `pullCallsFromCtm`, find the autostar branch around line 1267:

```js
if (autoStarEnabled && shouldAutoStar && !hasExistingCtmRating && existingScore === 0) {
  finalScore = getAutoStarRating(category);
}
```

Change to:

```js
if (
  autoStarEnabled
  && shouldAutoStar
  && !hasExistingCtmRating
  && existingScore === 0
  && !enrichment?.priorStarred           // first-touch attribution
) {
  finalScore = getAutoStarRating(category);
}
```

Add a debug-log line so we can see the suppression reason:

```js
if (enrichment?.priorStarred && shouldAutoStar) {
  logAiClassificationDebug('autostar:suppressed_first_touch', {
    callId: stringId,
    callerNumber: call.caller_number,
    firstStarredAt: enrichment.firstStarredAt
  });
}
```

- [ ] **Step 5: Tracking-relay qualified-call filter excludes existing clients**

In `server/routes/hub.js:5101` (already updated in Task 11). Extend:

```js
const QUALIFIED_LEAD_CATEGORIES = new Set([
  'warm', 'very_good', 'needs_attention', 'converted'
]);

const qualifiedCalls = freshCalls.filter(({ call, _enrichment }) => {
  if (!call.category) return false;
  if (_enrichment?.callerType === 'active_client') return false;
  if (_enrichment?.priorStarred) return false;          // first-touch only
  if (_enrichment?.priorEngaged) return false;          // re-engagement
  return QUALIFIED_LEAD_CATEGORIES.has(call.category);
});
```

- [ ] **Step 6: Journey auto-start gated on !priorEngaged**

```bash
grep -n "createJourney\|startJourney\|journey.*auto" server/routes/hub.js | head -10
```

Identify where a journey is auto-started during sync (if any). If the system never auto-starts journeys (only manual via the "Start Journey" button), this step is a no-op — verify.

If it does auto-start: gate the call on `!enrichment.priorEngaged`. Existing patients calling about an appointment should NOT trigger a journey.

- [ ] **Step 7: Lint + build**

```bash
yarn lint
yarn build
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add server/services/ctm.js server/routes/hub.js
git commit -m "feat(ctm): existing_client tag + first-touch attribution

- buildSystemTags now adds an 'Existing Client' chip when caller is
  in active_clients OR has prior starred/engaged calls. Data-driven
  (not keyword-based), so existing patients get tagged on appointment-
  related calls without needing 'cancel/reschedule' keywords.
- Autostar suppression: if a caller was already starred on a prior
  call, do NOT autostar again. Lead is attributed to first touch.
- Tracking-relay qualified_call filter excludes priorStarred /
  priorEngaged callers so re-engagement calls don't double-fire
  conversion events to GA4 / Meta CAPI / Google Ads."
```

---

## Task 15: DB backfill — strip duplicate stars from re-engagement rows

**Files:**
- Modify: `server/sql/migrate_classifier_softener_backfill.sql` (extend the migration from Task 7)

The Task 7 migration already exists. Extend it idempotently rather than creating a second migration file.

- [ ] **Step 1: Append the backfill block to the existing migration file**

Add to the bottom of `server/sql/migrate_classifier_softener_backfill.sql`, before the final `COMMIT;`:

```sql
-- First-touch attribution backfill: any caller_number that has multiple starred
-- calls within the same owner_user_id should keep the score on the EARLIEST one
-- and zero out subsequent ones. This applies the new first-touch rule to
-- historical data so re-engagement calls aren't counted as fresh conversions.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY owner_user_id, from_number
      ORDER BY started_at ASC NULLS LAST, created_at ASC
    ) AS rn
  FROM call_logs
  WHERE score > 0
    AND from_number IS NOT NULL
    AND COALESCE(meta->>'category_source','ai') = 'ai'
)
UPDATE call_logs cl
SET
  score = 0,
  meta = jsonb_set(meta, '{score_suppressed_reason}', '"first_touch_backfill_2026_04"')
FROM ranked r
WHERE cl.id = r.id
  AND r.rn > 1;
```

- [ ] **Step 2: Verify idempotency**

The `score_suppressed_reason` flag is set on every backfilled row. Re-running the migration is safe — the same rows get the same update. No new rows would be touched on a second run because future re-engagement calls won't go through the autostar branch (Task 14 prevents it at write time).

- [ ] **Step 3: Lint check (SQL syntax via psql dry-run on local DB)**

```bash
psql postgresql://bif@localhost:5432/anchor -f server/sql/migrate_classifier_softener_backfill.sql
```

Expected: BEGIN, three UPDATE blocks, plus the new backfill block, then COMMIT.

- [ ] **Step 4: Production count check (read-only)**

Cloud SQL Auth Proxy:

```bash
/Users/bif/google-cloud-sdk/bin/cloud-sql-proxy --port 5433 anchor-hub-480305:us-central1:anchor &
sleep 3
PASS=$(node -e "console.log(decodeURIComponent('%24SgBXQ%40%28c%2F0%2FQ%7DXD'))")
PGPASSWORD="$PASS" psql -h 127.0.0.1 -p 5433 -U jmartin -d anchor <<'SQL'
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_user_id, from_number ORDER BY started_at ASC) AS rn
  FROM call_logs WHERE score > 0 AND from_number IS NOT NULL AND COALESCE(meta->>'category_source','ai') = 'ai'
)
SELECT COUNT(*) AS duplicate_stars_to_clear FROM ranked WHERE rn > 1;
SQL
kill %1
```

Expected: a count. Note it for the deploy notes.

- [ ] **Step 5: Commit**

```bash
git add server/sql/migrate_classifier_softener_backfill.sql
git commit -m "feat(db): first-touch backfill — clear duplicate stars on re-engagement

When a caller has multiple starred calls under the same owner, keep the
earliest (first-touch) and zero out subsequent ones. Idempotent via the
score_suppressed_reason flag. Aligns historical data with the new
first-touch attribution rule from Task 14."
```

---

## Task 16: CLAUDE.md — document existing-client tag + first-touch rule

**Files:**
- Modify: `CLAUDE.md` (extend the Categories section from Task 10)

- [ ] **Step 1: Extend the tags subsection**

Find the line that mentions tags ("Things like Repeat Caller, Referral, Active Client, Applicant — those are tags..."). Replace with:

```markdown
### Tags (semantic, additive — added by `buildSystemTags` in `services/ctm.js`)

Tags are not categories; they're additional context shown alongside the category chip:
- **Repeat Caller** — set when `caller_type='repeat'` (this caller has called before)
- **Referral** — keyword-driven; see `isReferralContext` for matching phrases
- **Active Client** — caller is in `active_clients` table
- **Applicant** — set by classifier when AI category was `applicant`
- **Existing Client** — *data-driven*, NOT keyword-driven. Set when caller is in `active_clients` OR has any prior starred / engaged call (see `enrichCallerType`'s `priorStarred` / `priorEngaged` flags). The tag is added regardless of the caller's transcript content — even an appointment-confirmation call from a known patient gets tagged.

### First-touch attribution

A caller's *first* starred/engaged contact is the lead. Subsequent calls or form fills from the same caller_number under the same `owner_user_id` do NOT:
- Get auto-starred (`enrichment.priorStarred` blocks the autostar branch)
- Trigger qualified-call tracking relay to GA4 / Meta CAPI / Google Ads (the qualified_call filter in `routes/hub.js` excludes `priorStarred` and `priorEngaged`)
- Auto-start a journey

They still appear in the Leads list (so the front desk can see the re-engagement) and are tagged "Existing Client" so the staff knows this isn't a fresh inbound. Stars / journey starts can still be applied manually.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: existing_client tag is data-driven; first-touch attribution rules

Document that existing_client is NOT keyword-driven — it's set whenever
a caller has prior engagement (starred or engaged-category call) under
the same owner. Document first-touch attribution: only the earliest
starred/engaged contact is the lead; later contacts get the tag and
the leads-list visibility but no autostar / no tracking-relay /
no auto-journey."
```

---

## Verification checklist (post-deploy)

After this lands on main and Cloud Run picks it up:

- [ ] Cloud Run logs show `[migrations] ran migrate_classifier_softener_backfill.sql` once.
- [ ] Re-run the Task 1 Step 3 baseline query — expect zero rows where AI summary says spam but category is warm/neutral.
- [ ] In the dashboard, open Gunnerson's leads — Sarah Cameto, Jennifer Obrien, Minneapolis MN should now display as Spam.
- [ ] Run `node scripts/backfill-pending-classifications.js --owner 30c10201-97c0-4848-b6d7-c22dc623b17f --limit 200` and confirm Gunnerson's pending count drops.
- [ ] Add an unrelated existing client with CTM history; confirm import doesn't classify pre-30d calls; confirm those rows show as Pending Review only in All Activity.
- [ ] Pick a known repeat caller in production. Confirm only the earliest starred/engaged call retains a star; subsequent ones show score=0 with the `score_suppressed_reason` flag.
- [ ] Confirm the same caller's most-recent call shows the `Existing Client` tag.
- [ ] Trigger a re-sync; confirm Cloud Run logs show `autostar:suppressed_first_touch` for repeat-caller calls and that the qualified_call relay does NOT fire for them.

---

## Out of scope (deferred)

- Prompt-level refinement of `CATEGORY_DEFINITIONS` / `FORM_CATEGORY_DEFINITIONS`. Trusting the AI more might surface different miss patterns; revisit only if observed in production after this lands.
- Collapsing the server's 9 internal labels to the 5 canonical user-facing ones at the storage layer. Bigger data migration; not needed for the user-visible fix.
- Auto-running the pending-classification backfill on a schedule. The script exists; admin runs manually for now.
