# Qualified / Returning-Other Lead Split + Convert Patient Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Leads "New" chip into **Qualified** (3★+ calls + all forms/SMS) and **Returning/Other** (sub-3★ calls, including suppressed re-engagement callbacks), and make convert-to-client ask New vs Existing patient — only New gets 5★ + the ad-conversion relay.

**Architecture:** Pure read-time computation on existing `call_logs.score` + `activity_type`. Server adds `qualified`/`returning` category branches to the leads listing and two matching count aggregates. Frontend layers a score-aware split on top of the existing raw→visible category map via one shared helper used by both row-rendering components. Convert-to-client adds a required patient-type choice that gates the existing 5★/relay/CTM logic in `agree-to-service`. No DB migration.

**Tech Stack:** Express 4 (ESM, `server/routes/hub.js`), React 19 + MUI 7 (`src/views/client/ClientPortal/`), PostgreSQL 15 (parameterized queries via `query()`/`getClient()`).

**Spec:** `docs/superpowers/specs/2026-05-20-qualified-returning-leads-and-convert-patient-type-design.md`

**Verification note:** This project has **no automated test suite** (per CLAUDE.md and the `verify-without-tests` skill). Verification = `yarn lint` + `yarn build` + a stated manual check. Every task ends with lint/build + a concrete manual check + a commit. Run all commands from the repo root: `/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard`.

**Branch:** Already on `feature/qualified-returning-leads` (spec committed). All task commits land here.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/views/client/ClientPortal/leads/leadCategory.js` | Single source of truth for the score-aware Qualified/Returning split decision | **Create** |
| `server/routes/hub.js` | Leads listing category filter + counts; `agree-to-service` patient-type gating | Modify |
| `src/views/client/ClientPortal/LeadsTab.jsx` | Chip labels/colors, default filter, score-aware row chip + color, badge counts, history chip | Modify |
| `src/views/client/ClientPortal/leads/LeadActivityRow.jsx` | Compact activity-row chip (uses shared split) | Modify |
| `src/views/client/ClientPortal/ServiceDialog.jsx` | Required New/Existing patient choice + payload | Modify |
| `docs/API_REFERENCE.md` | Document `patient_type` body param + `qualified`/`returning` category values | Modify |

`src/api/services.js` needs **no change**: `agreeToService(userId, payload)` POSTs the payload object verbatim, so adding `patient_type` to the dialog's payload flows through untouched.

---

## Task 1: Shared score-split helper

**Files:**
- Create: `src/views/client/ClientPortal/leads/leadCategory.js`

- [ ] **Step 1: Create the helper**

```javascript
// Shared, score-aware split of the collapsed "lead" bucket into the two
// front-desk chips: Qualified vs Returning/Other.
//
// `baseKey` is the result of mapping a raw classifier category through the
// raw->visible map, where every lead-bucket category (warm, very_good, neutral,
// unreviewed, converted, ...) collapses to 'lead'. Only lead-bucket rows get
// split; every other visible key (needs_attention, unanswered, not_a_fit, spam,
// pending_review) passes through unchanged.
//
// Rule (mirrors the server filter in hub.js):
//   - forms / SMS / anything that isn't a call  -> Qualified (never demoted)
//   - calls with a known score < 3 (1-2 star)    -> Returning/Other
//   - calls with score >= 3, or no score present -> Qualified
//
// Field-name note: list rows (buildCallsFromCache) expose the score as `rating`;
// caller-history rows expose it as `score`. Read both. The "no score present"
// guard keeps rows that didn't fetch either field from being mislabeled.
export function splitQualifiedReturning(baseKey, call) {
  if (baseKey !== 'lead') return baseKey;
  const isCall = (call?.activity_type || 'call') === 'call';
  const rawScore = call?.rating ?? call?.score;
  const hasScore = rawScore !== null && rawScore !== undefined && rawScore !== '';
  const score = Number(rawScore || 0);
  return isCall && hasScore && score < 3 ? 'returning' : 'qualified';
}
```

- [ ] **Step 2: Lint the new file**

Run: `yarn lint`
Expected: PASS (no new errors). The file is not imported yet, so this only checks syntax/style.

- [ ] **Step 3: Commit**

```bash
git add src/views/client/ClientPortal/leads/leadCategory.js
git commit -m "feat(leads): shared Qualified/Returning split helper"
```

---

## Task 2: Server — listing category filter (`qualified` / `returning`)

**Files:**
- Modify: `server/routes/hub.js` (the `if (category)` block, ~line 5602–5633)

- [ ] **Step 1: Add qualified/returning branches**

Find this block (~5602):

```javascript
  if (category) {
    // "Pending Review" is a state flag, not a category value. ...
    if (category === 'pending_review') {
      queryConditions.push(`meta->>'classification_pending' = 'true'`);
    } else {
      const bucket = VISIBLE_CATEGORY_BUCKETS[category];
      if (bucket) {
```

Replace the `} else {` line and the start of the bucket handling so a `qualified`/`returning` case runs first. The new shape:

```javascript
  if (category) {
    // "Pending Review" is a state flag, not a category value. ...
    if (category === 'pending_review') {
      queryConditions.push(`meta->>'classification_pending' = 'true'`);
    } else if (category === 'qualified' || category === 'returning') {
      // Score-aware split of the lead bucket. Forms/SMS are never demoted;
      // only sub-3-star CALLS fall to Returning/Other. Mirrors
      // splitQualifiedReturning() on the frontend.
      const leadBucket = VISIBLE_CATEGORY_BUCKETS.lead;
      const gate =
        category === 'qualified'
          ? `(activity_type <> 'call' OR COALESCE(score, 0) >= 3)`
          : `activity_type = 'call' AND COALESCE(score, 0) < 3`;
      queryConditions.push(
        `COALESCE(meta->>'category', 'unreviewed') = ANY($${queryParamIndex}::text[]) AND COALESCE(meta->>'classification_pending', 'false') <> 'true' AND ${gate}`
      );
      queryParams.push(leadBucket);
      queryParamIndex++;
    } else {
      const bucket = VISIBLE_CATEGORY_BUCKETS[category];
      if (bucket) {
```

Leave the rest of the `else`/`if (bucket)` body exactly as-is. The existing `lead` key in `VISIBLE_CATEGORY_BUCKETS` keeps working through the generic `bucket` branch (full ungated bucket = backward compatibility for saved views / direct API callers passing `category=lead`).

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: PASS.

- [ ] **Step 3: Manual check — start the backend and query both buckets**

Start the server (kill any stale one first):

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null; yarn server > /tmp/anchor-server.log 2>&1 &
```

Confirm the new branches are reachable (no auth token needed to prove the route parses — a 401 is fine; a 500 referencing the SQL is not):

```bash
sleep 4 && curl -s "http://localhost:4000/api/hub/calls?category=qualified&lifecycle=lead_inbox&limit=1" -o /dev/null -w "%{http_code}\n"
curl -s "http://localhost:4000/api/hub/calls?category=returning&lifecycle=lead_inbox&limit=1" -o /dev/null -w "%{http_code}\n"
```

Expected: `401` (auth required) for both — proves the route + SQL string built without throwing. If you have a dev session token, hit it authenticated and confirm `200` with a `calls` array. Check `/tmp/anchor-server.log` has no `error: syntax error at or near` lines.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(leads): server qualified/returning category filter"
```

---

## Task 3: Server — qualified/returning count aggregates

**Files:**
- Modify: `server/routes/hub.js` (after `categoryCountsResult` reduce ~line 5662, and after `refreshedCategoryCounts` reduce ~line 6014)

- [ ] **Step 1: Add the split-count query after the main category counts**

Find the end of the main category counts reduce (~5662):

```javascript
  const categoryCounts = categoryCountsResult.rows.reduce((acc, row) => {
    acc[row.category] = parseInt(row.count, 10);
    acc.pending_review = (acc.pending_review || 0) + parseInt(row.pending_count || 0, 10);
    return acc;
  }, {});
```

Immediately after that closing `}, {});`, insert:

```javascript
  // Qualified vs Returning/Other can't be expressed by the per-raw-category
  // GROUP BY above (they share raw categories and split on score), so compute
  // them as two scalar aggregates under the same filters. Badges read these
  // directly; the list filter in Task 2 uses the identical predicate.
  const leadSplitParams = [...categoryCountsParams, VISIBLE_CATEGORY_BUCKETS.lead];
  const leadBucketIdx = leadSplitParams.length;
  const leadSplitResult = await query(
    `SELECT
       COUNT(*) FILTER (
         WHERE COALESCE(meta->>'category', 'unreviewed') = ANY($${leadBucketIdx}::text[])
           AND COALESCE(meta->>'classification_pending', 'false') <> 'true'
           AND (activity_type <> 'call' OR COALESCE(score, 0) >= 3)
       ) AS qualified,
       COUNT(*) FILTER (
         WHERE COALESCE(meta->>'category', 'unreviewed') = ANY($${leadBucketIdx}::text[])
           AND COALESCE(meta->>'classification_pending', 'false') <> 'true'
           AND activity_type = 'call' AND COALESCE(score, 0) < 3
       ) AS returning
     FROM call_logs cl WHERE ${categoryCountsConditions.join(' AND ')}`,
    leadSplitParams
  );
  categoryCounts.qualified = parseInt(leadSplitResult.rows[0]?.qualified || 0, 10);
  categoryCounts.returning = parseInt(leadSplitResult.rows[0]?.returning || 0, 10);
```

- [ ] **Step 2: Mirror it for the post-sync refresh**

Find the post-sync refresh reduce (~6010):

```javascript
    const refreshedCategoryCounts = refreshedCategoryCountsResult.rows.reduce((acc, row) => {
      acc[row.category] = parseInt(row.count, 10);
      acc.pending_review = (acc.pending_review || 0) + parseInt(row.pending_count || 0, 10);
      return acc;
    }, {});
```

Immediately after its closing `}, {});`, insert (note the indentation is one level deeper here):

```javascript
    const refreshedLeadSplitParams = [...categoryCountsParams, VISIBLE_CATEGORY_BUCKETS.lead];
    const refreshedLeadBucketIdx = refreshedLeadSplitParams.length;
    const refreshedLeadSplitResult = await query(
      `SELECT
         COUNT(*) FILTER (
           WHERE COALESCE(meta->>'category', 'unreviewed') = ANY($${refreshedLeadBucketIdx}::text[])
             AND COALESCE(meta->>'classification_pending', 'false') <> 'true'
             AND (activity_type <> 'call' OR COALESCE(score, 0) >= 3)
         ) AS qualified,
         COUNT(*) FILTER (
           WHERE COALESCE(meta->>'category', 'unreviewed') = ANY($${refreshedLeadBucketIdx}::text[])
             AND COALESCE(meta->>'classification_pending', 'false') <> 'true'
             AND activity_type = 'call' AND COALESCE(score, 0) < 3
         ) AS returning
       FROM call_logs cl WHERE ${categoryCountsConditions.join(' AND ')}`,
      refreshedLeadSplitParams
    );
    refreshedCategoryCounts.qualified = parseInt(refreshedLeadSplitResult.rows[0]?.qualified || 0, 10);
    refreshedCategoryCounts.returning = parseInt(refreshedLeadSplitResult.rows[0]?.returning || 0, 10);
```

> Note: `VISIBLE_CATEGORY_BUCKETS` is defined inside the listing handler (~5594), before both insertion points, so it is in scope at both. Confirm `categoryCountsConditions` / `categoryCountsParams` are likewise in scope at the post-sync site (they are declared once near ~5564 for the whole handler).

- [ ] **Step 3: Lint + restart + manual check**

Run: `yarn lint` → Expected PASS.

Restart the backend and confirm no SQL errors:

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null; yarn server > /tmp/anchor-server.log 2>&1 &
sleep 4 && curl -s "http://localhost:4000/api/hub/calls?lifecycle=lead_inbox&limit=1" -o /dev/null -w "%{http_code}\n"
grep -i "syntax error\|column .* does not exist" /tmp/anchor-server.log || echo "no SQL errors"
```

Expected: `401` and `no SQL errors`. (Authenticated, the JSON `categoryCounts` now includes `qualified` and `returning` keys.)

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(leads): qualified/returning count aggregates (listing + post-sync)"
```

---

## Task 4: Frontend — labels, colors, default filter (`LeadsTab.jsx`)

**Files:**
- Modify: `src/views/client/ClientPortal/LeadsTab.jsx` (~144–151, ~196–205)

- [ ] **Step 1: Replace `VISIBLE_CATEGORY_LABELS`**

Find (~144):

```javascript
const VISIBLE_CATEGORY_LABELS = {
  lead: 'New',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};
```

Replace with (order drives chip render order):

```javascript
const VISIBLE_CATEGORY_LABELS = {
  qualified: 'Qualified',
  returning: 'Returning/Other',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};
```

- [ ] **Step 2: Replace `VISIBLE_CATEGORY_COLORS`**

Find (~196):

```javascript
const VISIBLE_CATEGORY_COLORS = {
  lead: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  needs_attention: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  unanswered: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  not_a_fit: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  spam: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  pending_review: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
};
```

Replace with:

```javascript
const VISIBLE_CATEGORY_COLORS = {
  qualified: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  returning: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  needs_attention: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  unanswered: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  not_a_fit: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  spam: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  pending_review: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
};
```

- [ ] **Step 3: Flip the default filter**

Find (~205): `const DEFAULT_VISIBLE_CATEGORY_FILTER = 'lead';`
Replace with: `const DEFAULT_VISIBLE_CATEGORY_FILTER = 'qualified';`

(The reset sites at ~1334, ~1554, ~1565 already reference `DEFAULT_VISIBLE_CATEGORY_FILTER`, so this one constant covers them. No hardcoded `'lead'` to chase there.)

- [ ] **Step 4: Lint**

Run: `yarn lint`
Expected: PASS. (Build deferred to Task 6 once all `LeadsTab` edits are in.)

- [ ] **Step 5: Commit**

```bash
git add src/views/client/ClientPortal/LeadsTab.jsx
git commit -m "feat(leads): Qualified/Returning chip labels, colors, default filter"
```

---

## Task 5: Frontend — score-aware row chip + color + history chip (`LeadsTab.jsx`)

**Files:**
- Modify: `src/views/client/ClientPortal/LeadsTab.jsx` (import; `getCategoryColor` ~110; `getVisibleCategory` ~326; history chip ~3126)

- [ ] **Step 1: Import the shared helper**

Add to the import block near the other local imports at the top of the file (after the existing `import` lines; place near the `api`/`ui-component` imports):

```javascript
import { splitQualifiedReturning } from './leads/leadCategory';
```

- [ ] **Step 2: Make `getCategoryColor` score-aware**

Find (~110):

```javascript
const getCategoryColor = (callOrCategory) => {
  const lead = typeof callOrCategory === 'object' && callOrCategory !== null ? callOrCategory : null;
  const rawCategory = lead ? lead.category : callOrCategory;
  if (lead && lead.classification_pending) {
    return VISIBLE_CATEGORY_COLORS.pending_review;
  }
  const mapped = VISIBLE_CATEGORY_MAP[rawCategory?.toLowerCase()] || 'lead';
  return VISIBLE_CATEGORY_COLORS[mapped] || CATEGORY_COLORS.unreviewed;
};
```

Replace the last two statements (the `const mapped` line and `return`):

```javascript
  const base = VISIBLE_CATEGORY_MAP[rawCategory?.toLowerCase()] || 'lead';
  const mapped = splitQualifiedReturning(base, lead);
  return VISIBLE_CATEGORY_COLORS[mapped] || CATEGORY_COLORS.unreviewed;
};
```

- [ ] **Step 3: Make `getVisibleCategory` score-aware**

Find (~326):

```javascript
const getVisibleCategory = (callOrCategory) => {
  const lead = typeof callOrCategory === 'object' && callOrCategory !== null ? callOrCategory : null;
  const rawCategory = lead ? lead.category : callOrCategory;
  const isPending = lead ? Boolean(lead.classification_pending) : false;
  if (isPending) {
    return { key: 'pending_review', label: VISIBLE_CATEGORY_LABELS.pending_review };
  }
  const mapped = VISIBLE_CATEGORY_MAP[(rawCategory || 'unreviewed').toLowerCase()] || 'lead';
  return { key: mapped, label: VISIBLE_CATEGORY_LABELS[mapped] || 'Lead' };
};
```

Replace the last two statements (the `const mapped` line and `return`):

```javascript
  const base = VISIBLE_CATEGORY_MAP[(rawCategory || 'unreviewed').toLowerCase()] || 'lead';
  const mapped = splitQualifiedReturning(base, lead);
  return { key: mapped, label: VISIBLE_CATEGORY_LABELS[mapped] || 'Qualified' };
};
```

- [ ] **Step 4: Add `activity_type` to the caller-history query (server)**

So the history mini-chip can tell calls from forms, add `activity_type` to the history SELECT in `server/routes/hub.js` (~6737). Find:

```javascript
      `SELECT call_id, started_at, duration_sec, score, caller_type, 
              meta->>'classification' as classification,
```

Replace the first line with:

```javascript
      `SELECT call_id, started_at, duration_sec, score, caller_type, activity_type,
              meta->>'classification' as classification,
```

- [ ] **Step 5: Fix the caller-history mini-chip**

Find (~3126):

```javascript
                                    <Chip
                                      label={
                                        VISIBLE_CATEGORY_LABELS[
                                          VISIBLE_CATEGORY_MAP[(histCall.category || 'unreviewed').toLowerCase()] || 'lead'
                                        ] || 'New'
                                      }
                                      size="small"
                                      sx={{ fontSize: '0.7rem' }}
                                    />
```

Replace the `label={...}` expression:

```javascript
                                    <Chip
                                      label={getVisibleCategory(histCall).label}
                                      size="small"
                                      sx={{ fontSize: '0.7rem' }}
                                    />
```

(History rows now carry `score` + `activity_type`, so the resolver labels them correctly; the no-score guard still protects any row that fetched neither field.)

- [ ] **Step 6: Lint**

Run: `yarn lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/client/ClientPortal/LeadsTab.jsx server/routes/hub.js
git commit -m "feat(leads): score-aware row chip, color, history query + chip"
```

---

## Task 6: Frontend — badge counts read qualified/returning (`LeadsTab.jsx`)

**Files:**
- Modify: `src/views/client/ClientPortal/LeadsTab.jsx` (the chip-count `reduce`, ~1596–1603)

- [ ] **Step 1: Update the count derivation**

Find (~1596):

```javascript
                const count =
                  key === 'pending_review'
                    ? categoryCounts.pending_review || 0
                    : Object.entries(categoryCounts).reduce((sum, [rawCat, c]) => {
                        if (rawCat === 'pending_review') return sum;
                        if (VISIBLE_CATEGORY_MAP[rawCat] === key) return sum + c;
                        return sum;
                      }, 0);
```

Replace with:

```javascript
                const count =
                  key === 'pending_review'
                    ? categoryCounts.pending_review || 0
                    : key === 'qualified'
                      ? categoryCounts.qualified || 0
                      : key === 'returning'
                        ? categoryCounts.returning || 0
                        : Object.entries(categoryCounts).reduce((sum, [rawCat, c]) => {
                            if (['pending_review', 'qualified', 'returning'].includes(rawCat)) return sum;
                            if (VISIBLE_CATEGORY_MAP[rawCat] === key) return sum + c;
                            return sum;
                          }, 0);
```

(Raw lead-bucket categories like `warm`/`neutral` map to `'lead'`, which is no longer a rendered chip key, so they naturally contribute to neither Qualified nor the other chips' sums — they're now represented only by the explicit server `qualified`/`returning` totals.)

- [ ] **Step 2: Lint + full build**

```bash
yarn lint && yarn build
```

Expected: both PASS. `yarn build` catches any import/tree-shaking issue from the new helper and the constant changes across all `LeadsTab` edits.

- [ ] **Step 3: Manual check — chips render and counts match**

With backend running (Task 3) and `yarn start` (frontend on :3000), log in and open the Client Portal Leads tab (or admin → impersonate a client with call data):

1. The "Lead Category" row shows chips in order: **Qualified · Returning/Other · Priority · Unanswered · Not a Fit · Spam · Pending Review** (no "New").
2. Click **Qualified** → list shows only 3★+ calls and any lead-bucket forms. The `Qualified (N)` badge equals the visible row count.
3. Click **Returning/Other** → list shows sub-3★ calls (look for one carrying an "Existing Client" tag). Badge equals row count.
4. Browser console: no new errors. Toggle card/table view — chips identical.

- [ ] **Step 4: Commit**

```bash
git add src/views/client/ClientPortal/LeadsTab.jsx
git commit -m "feat(leads): Qualified/Returning badge counts from server totals"
```

---

## Task 7: Frontend — `LeadActivityRow` uses the shared split

**Files:**
- Modify: `src/views/client/ClientPortal/leads/LeadActivityRow.jsx` (~12–56)

- [ ] **Step 1: Import the shared helper**

After the existing icon imports (after line 10), add:

```javascript
import { splitQualifiedReturning } from './leadCategory';
```

- [ ] **Step 2: Update labels + colors**

Find (~31):

```javascript
const VISIBLE_CATEGORY_LABELS = {
  lead: 'New',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};

const VISIBLE_CATEGORY_COLORS = {
  lead: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  needs_attention: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  unanswered: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  not_a_fit: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  spam: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  pending_review: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
};
```

Replace with:

```javascript
const VISIBLE_CATEGORY_LABELS = {
  qualified: 'Qualified',
  returning: 'Returning/Other',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};

const VISIBLE_CATEGORY_COLORS = {
  qualified: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  returning: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  needs_attention: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  unanswered: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  not_a_fit: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  spam: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  pending_review: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
};
```

(Leave the local `VISIBLE_CATEGORY_MAP` at lines 12–29 unchanged — it still maps raw→`lead`, and the split happens after.)

- [ ] **Step 3: Make `getVisibleCategory` score-aware**

Find (~49):

```javascript
const getVisibleCategory = (call) => {
  if (call?.classification_pending) {
    return { key: 'pending_review', label: VISIBLE_CATEGORY_LABELS.pending_review, color: VISIBLE_CATEGORY_COLORS.pending_review };
  }
  const raw = String(call?.category || 'unreviewed').toLowerCase();
  const key = VISIBLE_CATEGORY_MAP[raw] || 'lead';
  return { key, label: VISIBLE_CATEGORY_LABELS[key], color: VISIBLE_CATEGORY_COLORS[key] };
};
```

Replace the last two statements:

```javascript
  const raw = String(call?.category || 'unreviewed').toLowerCase();
  const base = VISIBLE_CATEGORY_MAP[raw] || 'lead';
  const key = splitQualifiedReturning(base, call);
  return { key, label: VISIBLE_CATEGORY_LABELS[key], color: VISIBLE_CATEGORY_COLORS[key] };
};
```

- [ ] **Step 4: Lint + build**

```bash
yarn lint && yarn build
```

Expected: both PASS.

- [ ] **Step 5: Manual check**

Wherever `LeadActivityRow` renders (it's the compact activity row — e.g. caller detail / activity strip), confirm a sub-3★ call shows the **Returning/Other** chip and a 3★+ call or a form shows **Qualified**. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/client/ClientPortal/leads/LeadActivityRow.jsx
git commit -m "feat(leads): LeadActivityRow chip uses shared Qualified/Returning split"
```

---

## Task 8: Convert dialog — New vs Existing patient (`ServiceDialog.jsx`)

**Files:**
- Modify: `src/views/client/ClientPortal/ServiceDialog.jsx`

- [ ] **Step 1: Add the MUI imports**

After the existing MUI imports (after line 14, `import Typography ...`), add:

```javascript
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
```

- [ ] **Step 2: Add patient-type state + reset**

Find (~27):

```javascript
  const [selectedServices, setSelectedServices] = useState([]);
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setSelectedServices([]);
    setSaving(false);
    onClose();
  };
```

Replace with:

```javascript
  const [selectedServices, setSelectedServices] = useState([]);
  const [patientType, setPatientType] = useState(''); // '' | 'new' | 'existing'
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setSelectedServices([]);
    setPatientType('');
    setSaving(false);
    onClose();
  };
```

- [ ] **Step 3: Validate + send patient_type in `handleConfirm`**

Find (~54):

```javascript
    if (selectedServices.length === 0) {
      triggerMessage('error', 'Please select at least one service');
      return;
    }
```

Insert immediately after that block:

```javascript
    if (patientType !== 'new' && patientType !== 'existing') {
      triggerMessage('error', 'Please choose new or existing patient');
      return;
    }
```

Then find the `agreeToService` call (~73):

```javascript
      await agreeToService(lead.id, {
        services: selectedServices,
        source: lead.source || 'CTM',
        funnel_data: funnelData,
        journey_id: lead.journey_id || null
      });
```

Replace with:

```javascript
      await agreeToService(lead.id, {
        services: selectedServices,
        source: lead.source || 'CTM',
        funnel_data: funnelData,
        journey_id: lead.journey_id || null,
        patient_type: patientType
      });
```

- [ ] **Step 4: Add the radio group to the dialog body**

Find the opening of the content stack (~94):

```javascript
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            All activity from this client will move to the &lsquo;Client List&rsquo; Tab.
          </Typography>
```

Insert the radio group right after that `<Typography>` (before the `{lead && (` block):

```javascript
          <FormControl required>
            <FormLabel sx={{ fontWeight: 600, color: 'text.primary' }}>Is this a new or existing patient?</FormLabel>
            <RadioGroup row value={patientType} onChange={(e) => setPatientType(e.target.value)}>
              <FormControlLabel value="new" control={<Radio />} label="New patient — marks 5★ and counts as a conversion" />
              <FormControlLabel value="existing" control={<Radio />} label="Existing patient — add to list only" />
            </RadioGroup>
          </FormControl>
```

- [ ] **Step 5: Disable Confirm until a patient type is chosen**

Find (~176):

```javascript
        <Button variant="contained" onClick={handleConfirm} disabled={saving || selectedServices.length === 0}>
```

Replace with:

```javascript
        <Button variant="contained" onClick={handleConfirm} disabled={saving || selectedServices.length === 0 || !patientType}>
```

- [ ] **Step 6: Lint + build**

```bash
yarn lint && yarn build
```

Expected: both PASS.

- [ ] **Step 7: Manual check**

Open a lead → "Convert to Client". The dialog shows the New/Existing radios; Confirm stays disabled until both a service and a patient type are chosen. (Backend behavior verified in Task 9.)

- [ ] **Step 8: Commit**

```bash
git add src/views/client/ClientPortal/ServiceDialog.jsx
git commit -m "feat(convert): require new vs existing patient choice in ServiceDialog"
```

---

## Task 9: Backend — gate 5★ / relay / CTM on new patient (`agree-to-service`)

**Files:**
- Modify: `server/routes/hub.js` (`agree-to-service` handler ~9135–9444)

- [ ] **Step 1: Parse + derive the patient flag**

Find (~9138):

```javascript
  const { services, source, funnel_data, journey_id } = req.body;
  const funnelData = funnel_data || {};
```

Replace with:

```javascript
  const { services, source, funnel_data, journey_id } = req.body;
  const funnelData = funnel_data || {};
  // New-patient flag from the convert dialog. Anything other than the explicit
  // string 'new' is treated as an existing patient — the conservative default
  // (no 5-star, no conversion relay) so a stale client or malformed body can't
  // spuriously inflate conversions.
  const isNewPatient = String(req.body?.patient_type || 'existing').toLowerCase() === 'new';
```

- [ ] **Step 2: Add the flag to the request log (non-PHI)**

Find (~9141):

```javascript
  logEvent('active-clients:agree', 'Received agree-to-service request', {
    userId,
    leadId,
    servicesCount: services?.length,
    source,
    funnelData
  });
```

Replace with (add `patientType` — a non-PHI classification, not health data):

```javascript
  logEvent('active-clients:agree', 'Received agree-to-service request', {
    userId,
    leadId,
    servicesCount: services?.length,
    source,
    patientType: isNewPatient ? 'new' : 'existing',
    funnelData
  });
```

- [ ] **Step 3: Gate the 5★ block on `isNewPatient`**

Find (~9359):

```javascript
      if (leadCallKey || leadCallUuid) {
        const scoredLead = await dbClient.query(
          `UPDATE call_logs
           SET score = 5
           WHERE (call_id = $1 OR id = $2)
             AND (owner_user_id = $3 OR user_id = $3)
           RETURNING call_id`,
          [leadCallKey, leadCallUuid, userId]
        );

        if (scoredLead.rowCount) {
          logEvent('active-clients:agree', 'Applied 5-star score to converted lead', {
            userId,
            leadId: leadCallKey || leadCallUuid
          });
          shouldPostCtmScore = Boolean(leadCallKey && ctmCredentials.accountId && ctmCredentials.apiKey && ctmCredentials.apiSecret);
        }
      }
```

Replace the `if (leadCallKey || leadCallUuid) {` condition with the patient gate:

```javascript
      if (isNewPatient && (leadCallKey || leadCallUuid)) {
        const scoredLead = await dbClient.query(
          `UPDATE call_logs
           SET score = 5
           WHERE (call_id = $1 OR id = $2)
             AND (owner_user_id = $3 OR user_id = $3)
           RETURNING call_id`,
          [leadCallKey, leadCallUuid, userId]
        );

        if (scoredLead.rowCount) {
          logEvent('active-clients:agree', 'Applied 5-star score to converted lead', {
            userId,
            leadId: leadCallKey || leadCallUuid
          });
          shouldPostCtmScore = Boolean(leadCallKey && ctmCredentials.accountId && ctmCredentials.apiKey && ctmCredentials.apiSecret);
        }
      }
```

(`shouldPostCtmScore` is only set inside this block, so the CTM 5★ post at ~9446 is now skipped for existing patients automatically — no change needed there.)

- [ ] **Step 4: Gate the conversion relay on `isNewPatient`**

Find (~9389):

```javascript
    if (isNewClient) {
      try {
        // Pull attribution from the originating lead call_log (if any) ...
```

Replace the condition:

```javascript
    if (isNewClient && isNewPatient) {
      try {
        // Pull attribution from the originating lead call_log (if any) ...
```

- [ ] **Step 5: Lint + restart**

```bash
yarn lint
lsof -ti:4000 | xargs kill -9 2>/dev/null; yarn server > /tmp/anchor-server.log 2>&1 &
sleep 4 && grep -i "syntax error" /tmp/anchor-server.log || echo "server clean"
```

Expected: lint PASS, `server clean`.

- [ ] **Step 6: Manual check (local DB only — never mutate prod)**

With a local dev session, convert one lead as **New patient** and another as **Existing patient**, then inspect:

```bash
psql "postgresql://bif@localhost:5432/anchor" -c "SELECT call_id, score FROM call_logs WHERE call_id IN ('<new-lead-call-id>','<existing-lead-call-id>');"
psql "postgresql://bif@localhost:5432/anchor" -c "SELECT source_id, event_name, success FROM tracking_event_log WHERE event_name='new_client' ORDER BY created_at DESC LIMIT 5;"
```

Expected: the **new** lead's call shows `score = 5` and a `new_client` row exists for its `active_client_id`; the **existing** lead's call score is unchanged (no bump to 5) and there is **no** new `new_client` row for it. Both clients appear under the Client List tab.

- [ ] **Step 7: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(convert): only new patients get 5-star + conversion relay"
```

---

## Task 10: Docs — API reference

**Files:**
- Modify: `docs/API_REFERENCE.md`

- [ ] **Step 1: Document the new request param and category values**

Locate the `POST /hub/clients/:leadId/agree-to-service` entry (search the file for `agree-to-service`). Add to its request-body documentation:

```markdown
- `patient_type` (string, optional): `"new"` or `"existing"`. `"new"` stamps the
  originating lead 5★, fires the `new_client` conversion relay (GA4 / Meta CAPI /
  Google Ads offline), and posts the 5★ conversion to CTM. `"existing"` (the
  default when omitted or invalid) adds the client to the list with no star and
  no conversion event.
```

Locate the leads listing entry (the `GET /hub/calls` / lead-list endpoint, search for `category`). Add to its `category` query-param documentation:

```markdown
- `category` accepts the visible chips `qualified`, `returning`, `needs_attention`,
  `unanswered`, `not_a_fit`, `spam`, `pending_review`. `qualified` = lead-bucket
  forms/SMS plus calls scored ≥ 3★; `returning` = lead-bucket calls scored < 3★
  (lukewarm + suppressed re-engagement callbacks). The legacy `lead` value still
  resolves to the full ungated bucket for backward compatibility. The response
  `categoryCounts` includes `qualified` and `returning` totals.
```

- [ ] **Step 2: Commit**

```bash
git add docs/API_REFERENCE.md
git commit -m "docs(api): patient_type param + qualified/returning category values"
```

---

## Final Verification

- [ ] **Full build + lint clean**

```bash
yarn lint && yarn build
```

Expected: both PASS.

- [ ] **End-to-end manual pass** (frontend `yarn start` + backend running, logged in / impersonating a client with real call + form data):
  1. Leads chips read `Qualified · Returning/Other · Priority · Unanswered · Not a Fit · Spam · Pending Review`; default landing chip is Qualified.
  2. Qualified = 3★+ calls + lead-bucket forms; Returning/Other = sub-3★ calls (incl. an "Existing Client" callback). Both badge counts equal their row counts.
  3. Every visible row's chip matches the chip it's filtered under (no Qualified-labeled row inside the Returning/Other list).
  4. Priority / Unanswered / Not a Fit / Spam / Pending Review unchanged; All Activity still shows everything.
  5. Convert as New patient → 5★ + `new_client` relay row; convert as Existing patient → no star, no relay row (verified in local DB, Task 9).
  6. Browser console clean in both card and table views.

- [ ] **Compliance checkpoint** (per CLAUDE.md): no PHI added to logs (only IDs + `patient_type` classification); all new SQL parameterized (`$n::text[]`); `patient_type` normalized at the boundary; access control + `actingClient` scoping untouched; medical/non-medical relay HIPAA gate in `trackingRelay.js` unchanged.

- [ ] **Update memory / project notes** if the Qualified/Returning split changes how future lead work is reasoned about (optional).
```
