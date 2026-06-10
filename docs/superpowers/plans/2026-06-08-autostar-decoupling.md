# Auto-Star Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make qualified-call auto-star apply on every sync (not only the classify cycle), so leads that miss their star once are no longer permanently frozen at score 0 in the "Returning/Other" bucket — plus couple manual category↔star and recover the already-frozen leads.

**Architecture:** Extract the auto-star decision into a pure, dependency-free `computeAutoStar` helper (its own module so it's unit-testable without the DB). Call it on every row in `pullCallsFromCtm` (decoupled from `shouldAutoStar`/classification). A once-marker `meta.auto_star_applied_at` heals frozen leads exactly once and respects deliberate manual 0s. Manual category/star endpoints become coherent. A one-time backfill recovers existing frozen leads, posting to CTM (which is authoritative under `syncRatings`).

**Tech Stack:** Node 20 ESM, Express, PostgreSQL, CTM API (`postSaleToCTM`), Vertex AI. Tests via Node's built-in `node:test` (no test runner installed; project otherwise verifies via `yarn build` + `yarn lint`).

**Spec:** `docs/superpowers/specs/2026-06-08-autostar-decoupling-design.md`

**Branch:** `fix/autostar-decoupling` (already created; spec committed).

---

## File Structure

- **Create** `server/services/autoStar.js` — pure module: `getAutoStarRating` (moved here) + new `computeAutoStar`. Zero DB/AI imports so it's trivially testable.
- **Create** `server/services/__tests__/autoStar.test.js` — `node:test` unit tests for the pure helper.
- **Modify** `server/services/ctm.js` — remove the local `getAutoStarRating` definition; import both from `autoStar.js` and re-export `getAutoStarRating` (so all existing `from './ctm.js'` imports keep working). Replace the inline auto-star score gate in `pullCallsFromCtm` with a `computeAutoStar` call + marker write.
- **Modify** `server/routes/hub.js` — category→star coupling in `PUT /calls/:id/category`; star protection in `POST` and `DELETE /calls/:id/score`; fix `reclassify-leads` to star calls (via `computeAutoStar`) and post to CTM.
- **Modify** `scripts/backfill-failed-classifications.mjs` — star calls (not just forms) via `computeAutoStar` + post to CTM.
- **Create** `scripts/backfill-frozen-autostar.mjs` — one-time recovery of currently-frozen leads.
- **Modify** `docs/LEAD_CLASSIFICATION.md` — document decoupled auto-star + once-marker.

---

## Task 1: Pure `computeAutoStar` helper + unit tests

**Files:**
- Create: `server/services/autoStar.js`
- Test: `server/services/__tests__/autoStar.test.js`
- Modify: `server/services/ctm.js:143-164` (remove `getAutoStarRating` def), `server/services/ctm.js:1-17` (imports)

- [ ] **Step 1: Create the pure module**

Create `server/services/autoStar.js`:

```js
// Pure auto-star decision logic. NO db/ai imports so it stays unit-testable
// and side-effect free. Imported (and getAutoStarRating re-exported) by ctm.js.

/**
 * Maps an AI category to the auto-star rating.
 * Never returns 4 or 5 (those are manual only).
 * 1 = spam, 2 = real person but not a fit, 3 = solid lead, 0 = not scored.
 */
export function getAutoStarRating(category) {
  switch (category) {
    case 'spam':
      return 1;
    case 'not_a_fit':
    case 'applicant':
      return 2;
    case 'warm':
    case 'very_good':
    case 'needs_attention':
      return 3;
    case 'active_client':
    case 'returning_customer':
      return 0; // Existing clients don't get auto-scored as leads
    case 'voicemail':
    case 'unanswered':
    case 'neutral':
    case 'unreviewed':
    default:
      return 0;
  }
}

/**
 * Decide whether to auto-apply a star to a row, decoupled from the
 * classification cycle. Pure: same inputs → same output, no side effects.
 *
 * @param {object} p
 * @param {string} p.category          - semantic category
 * @param {number} p.existingScore     - current score (CTM-authoritative under syncRatings)
 * @param {boolean} p.hasCtmRating     - CTM already holds a rating (>0)
 * @param {object} p.enrichment        - { callerType, recentlyQualified, lookupFailed }
 * @param {string} p.categorySource    - 'client' means a human override; never overwrite
 * @param {boolean} p.alreadyApplied   - meta.auto_star_applied_at is set
 * @returns {{ score: number, apply: boolean, reason: string }}
 */
export function computeAutoStar({
  category,
  existingScore = 0,
  hasCtmRating = false,
  enrichment = {},
  categorySource = 'ai',
  alreadyApplied = false
} = {}) {
  const score = Number(existingScore) || 0;
  const star = getAutoStarRating(category);

  if (String(categorySource).toLowerCase() === 'client') {
    return { score, apply: false, reason: 'client_override' };
  }
  if (hasCtmRating || score > 0) {
    return { score, apply: false, reason: 'existing_rating' };
  }
  if (enrichment?.callerType === 'active_client') {
    return { score: 0, apply: false, reason: 'active_client' };
  }
  // Mirror ctm.js gate: only suppress on recentlyQualified when the lookup did NOT fail.
  if (enrichment?.recentlyQualified && !enrichment?.lookupFailed) {
    return { score: 0, apply: false, reason: 'recently_qualified' };
  }
  if (alreadyApplied) {
    return { score, apply: false, reason: 'already_applied' };
  }
  if (star <= 0) {
    return { score, apply: false, reason: 'non_scoring_category' };
  }
  return { score: star, apply: true, reason: 'auto_star' };
}
```

- [ ] **Step 2: Write the failing tests**

Create `server/services/__tests__/autoStar.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoStar, getAutoStarRating } from '../autoStar.js';

test('frozen new very_good lead heals (applies 3)', () => {
  const r = computeAutoStar({
    category: 'very_good', existingScore: 0, hasCtmRating: false,
    enrichment: { callerType: 'new', recentlyQualified: false }, categorySource: 'ai', alreadyApplied: false
  });
  assert.deepEqual(r, { score: 3, apply: true, reason: 'auto_star' });
});

test('respects a deliberate manual 0 via the once-marker', () => {
  const r = computeAutoStar({
    category: 'very_good', existingScore: 0, enrichment: { callerType: 'new' }, alreadyApplied: true
  });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'already_applied');
});

test('client override is never overwritten', () => {
  const r = computeAutoStar({ category: 'very_good', existingScore: 0, categorySource: 'client' });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'client_override');
});

test('existing CTM rating is preserved', () => {
  const r = computeAutoStar({ category: 'very_good', existingScore: 0, hasCtmRating: true });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'existing_rating');
});

test('active_client caller is suppressed', () => {
  const r = computeAutoStar({ category: 'very_good', enrichment: { callerType: 'active_client' } });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'active_client');
});

test('recentlyQualified suppresses, but NOT when the lookup failed', () => {
  const suppressed = computeAutoStar({ category: 'very_good', enrichment: { recentlyQualified: true, lookupFailed: false } });
  assert.equal(suppressed.apply, false);
  assert.equal(suppressed.reason, 'recently_qualified');
  const healed = computeAutoStar({ category: 'very_good', enrichment: { recentlyQualified: true, lookupFailed: true } });
  assert.equal(healed.apply, true);
});

test('non-scoring category does not apply', () => {
  const r = computeAutoStar({ category: 'neutral', enrichment: { callerType: 'new' } });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'non_scoring_category');
});

test('getAutoStarRating mapping unchanged', () => {
  assert.equal(getAutoStarRating('very_good'), 3);
  assert.equal(getAutoStarRating('warm'), 3);
  assert.equal(getAutoStarRating('needs_attention'), 3);
  assert.equal(getAutoStarRating('not_a_fit'), 2);
  assert.equal(getAutoStarRating('applicant'), 2);
  assert.equal(getAutoStarRating('spam'), 1);
  assert.equal(getAutoStarRating('neutral'), 0);
  assert.equal(getAutoStarRating('active_client'), 0);
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `node --test server/services/__tests__/autoStar.test.js`
Expected: PASS (8 tests). The module from Step 1 is a pure translation of the already-specified gate, so the suite passes immediately and serves as the regression guard for the helper's behavior.

- [ ] **Step 4: Point ctm.js at the new module**

In `server/services/ctm.js`, near the top imports (currently line 7 imports `resolveContact`), add:

```js
import { getAutoStarRating, computeAutoStar } from './autoStar.js';
```

Then DELETE the local definition at `server/services/ctm.js:134-164` (the JSDoc block + `export function getAutoStarRating(category) { ... }`) and replace it with a re-export so existing `import { getAutoStarRating } from './ctm.js'` consumers keep working:

```js
// getAutoStarRating now lives in ./autoStar.js (pure, testable). Re-exported
// here so existing importers (hub.js, backfill scripts) need no change.
export { getAutoStarRating };
```

- [ ] **Step 5: Verify nothing else broke**

Run: `node --test server/services/__tests__/autoStar.test.js && yarn build && yarn lint`
Expected: tests PASS, build succeeds, lint clean. (`yarn build` resolves the ctm.js → autoStar.js import chain and the re-export.)

- [ ] **Step 6: Commit**

```bash
git add server/services/autoStar.js server/services/__tests__/autoStar.test.js server/services/ctm.js
git commit -m "feat(autostar): extract pure computeAutoStar helper + unit tests"
```

---

## Task 2: Decouple the score from the classify cycle in `pullCallsFromCtm`

**Files:**
- Modify: `server/services/ctm.js:1359-1384` (the score gate), `server/services/ctm.js:1424` (callData score), `server/services/ctm.js:1480-1481` (shouldPostScore / notifyNeedsAttention)

Background: today `finalScore` is only set when `shouldAutoStar` is true, and `shouldAutoStar` is set ONLY inside the `classifyContent` branch (`ctm.js:1322`). We keep `shouldAutoStar` for `notifyNeedsAttention` (it means "freshly classified this cycle") but drive the SCORE from `computeAutoStar`, independent of it.

- [ ] **Step 1: Replace the score-gate block**

Replace `server/services/ctm.js:1359-1384` (from `// Determine final score` through the `autostar:suppressed_first_touch` log block) with:

```js
    // Determine final score — NEVER overwrite existing CTM ratings. Decoupled
    // from the classify cycle: computeAutoStar runs every sync so a qualified,
    // unrated, non-suppressed call heals even when its summary is already real.
    const autoStar = computeAutoStar({
      category,
      existingScore,
      hasCtmRating: hasExistingCtmRating,
      enrichment: enrichment || {},
      categorySource: hasClientCategoryOverride ? 'client' : 'ai',
      alreadyApplied: Boolean(prevMeta.auto_star_applied_at)
    });
    let finalScore = existingScore;
    let autoStarAppliedAt = prevMeta.auto_star_applied_at || null;
    if (autoStarEnabled && autoStar.apply) {
      finalScore = autoStar.score;
      autoStarAppliedAt = new Date().toISOString();
    }
    if (autoStarEnabled && !autoStar.apply && (autoStar.reason === 'active_client' || autoStar.reason === 'recently_qualified')) {
      logAiClassificationDebug('autostar:suppressed_first_touch', {
        callId: stringId,
        callerNumber: lookupCallerNumber || null,
        callerType: enrichment?.callerType,
        reason: autoStar.reason,
        firstStarredAt: enrichment?.firstStarredAt
      });
    }
```

- [ ] **Step 2: Persist the marker on the row**

In the `callData` object (`server/services/ctm.js`, the block starting ~1389 where `score: finalScore` is set, near line 1424), add a sibling field right after `score: finalScore,`:

```js
      score: finalScore,
      auto_star_applied_at: autoStarAppliedAt,
```

(The stored meta is `{ ...callData }` / `{ ...stripCtmMediaMeta(meta), ...enrichment }`; enrichment carries no `auto_star_applied_at`, so this value persists across syncs.)

- [ ] **Step 3: Update shouldPostScore; leave notifyNeedsAttention keyed on shouldAutoStar**

At `server/services/ctm.js:1480-1481`, change:

```js
      shouldPostScore: autoStarEnabled && shouldAutoStar && finalScore > 0 && !hasExistingCtmRating,
      notifyNeedsAttention: requiresCallback && shouldAutoStar,
```

to:

```js
      shouldPostScore: autoStarEnabled && autoStar.apply && finalScore > 0,
      notifyNeedsAttention: requiresCallback && shouldAutoStar,
```

(`autoStar.apply` already implies `!hasExistingCtmRating` and not-suppressed. `notifyNeedsAttention` stays on `shouldAutoStar` so we only notify on a fresh classification, unchanged.)

- [ ] **Step 4: Verify build + lint + helper tests**

Run: `yarn build && yarn lint && node --test server/services/__tests__/autoStar.test.js`
Expected: all pass. Grep to confirm no remaining reference to the removed local gate: `grep -n "shouldAutoStar && !hasExistingCtmRating" server/services/ctm.js` → no output.

- [ ] **Step 5: Commit**

```bash
git add server/services/ctm.js
git commit -m "fix(autostar): apply star every sync via computeAutoStar + once-marker"
```

---

## Task 3: Couple manual category → star (`PUT /calls/:id/category`)

**Files:**
- Modify: `server/routes/hub.js:8599-8639` (inside the category update handler)

Today this handler sets `category_source='client'` + meta but never touches `score`. We make a qualified-tier category also set the 3★ and post to CTM. Non-qualified categories leave the star alone.

- [ ] **Step 1: Add credentials lookup + star write**

In the category handler, after the existing `UPDATE call_logs SET meta=...` query (ends ~`server/routes/hub.js:8637`) and before `res.json({ message: 'Category updated', ... })`, insert:

```js
    // Couple category -> star for the qualified lead tiers so re-choosing
    // "Qualified" actually moves the star (and posts to CTM, which is
    // authoritative under syncRatings). Non-qualified categories leave the
    // star to the human (clearing is an explicit DELETE /score action).
    const QUALIFIED_TIERS = new Set(['warm', 'very_good', 'needs_attention']);
    let appliedScore = null;
    if (QUALIFIED_TIERS.has(category)) {
      appliedScore = getAutoStarRating(category); // 3
      await query(
        'UPDATE call_logs SET score=$1 WHERE call_id=$2 AND (owner_user_id=$3 OR user_id=$3)',
        [appliedScore, callId, targetUserId]
      );
      const profileRes = await query(
        'SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1 LIMIT 1',
        [targetUserId]
      );
      const credentials = resolveCtmCreds(profileRes.rows[0] || null);
      if (credentials?.accountId && credentials.apiKey && credentials.apiSecret) {
        try {
          await postSaleToCTM(credentials, callId, { score: appliedScore, conversion: 1, value: 0 });
        } catch (ctmErr) {
          logEvent('calls:category', 'CTM score sync failed', { user: targetUserId, callId, error: ctmErr.message });
        }
      }
    }
```

Then change the response to surface the score:

```js
    res.json({ message: 'Category updated', category, categorySource: 'client', score: appliedScore });
```

(`getAutoStarRating`, `resolveCtmCreds`, and `postSaleToCTM` are already imported in `hub.js` — see lines 40, 51, 37.)

- [ ] **Step 2: Frontend reflects the new score immediately**

The category dropdown's success handler must update the row's `score`/`rating` in local state from the response (`score`) so the chip moves Qualified↔Returning without a reload (CLAUDE.md "Immediate UI Updates" rule). Locate the category-change handler in `src/views/client/ClientPortal.jsx` (it calls the category API) and, on success, merge `score` into the affected lead row in local state. Show the existing success toast.

- [ ] **Step 3: Verify**

Run: `yarn build && yarn lint`
Expected: pass. Manual check after deploy: set a call's category to "Qualified" → row immediately shows 3★ and leaves "Returning/Other".

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js src/views/client/ClientPortal.jsx
git commit -m "feat(leads): manual Qualified category sets 3-star + posts to CTM"
```

---

## Task 4: Protect manual stars (`POST` / `DELETE /calls/:id/score`)

**Files:**
- Modify: `server/routes/hub.js:7252-7257` (POST score local update), `server/routes/hub.js:7304-7308` (DELETE score local update)

A human-set star or a deliberate clear must mark the row `category_source='client'` so the sync's `computeAutoStar` never fights it even if the CTM post fails.

- [ ] **Step 1: POST /score — stamp client override**

Replace the local update at `server/routes/hub.js:7254-7257`:

```js
    const scoreResult = await query(
      'UPDATE call_logs SET score=$1 WHERE call_id=$2 AND (owner_user_id=$3 OR user_id=$3)',
      [score, callId, targetUserId]
    );
```

with (jsonb merge so we don't clobber other meta):

```js
    const scoreResult = await query(
      `UPDATE call_logs
         SET score=$1,
             meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
               'category_source', 'client',
               'category_source_detail', 'dashboard_manual_score',
               'auto_star_applied_at', to_jsonb($4::text)
             )
       WHERE call_id=$2 AND (owner_user_id=$3 OR user_id=$3)`,
      [score, callId, targetUserId, new Date().toISOString()]
    );
```

- [ ] **Step 2: DELETE /score — mark human-managed so it stays at 0**

Replace the local clear at `server/routes/hub.js:7305-7308`:

```js
    const clearResult = await query(
      'UPDATE call_logs SET score=NULL WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2)',
      [callId, targetUserId]
    );
```

with:

```js
    const clearResult = await query(
      `UPDATE call_logs
         SET score=NULL,
             meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
               'category_source', 'client',
               'category_source_detail', 'dashboard_manual_clear'
             )
       WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2)`,
      [callId, targetUserId]
    );
```

- [ ] **Step 3: Verify**

Run: `yarn build && yarn lint`
Expected: pass. Note: setting a star already posts the score to CTM (lines 7270-7287, unchanged) and clearing posts 0 to CTM (lines 7321-7328, unchanged), so durability is preserved both ways.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "fix(autostar): manual star/clear marks row client-managed so sync defers"
```

---

## Task 5: Star CALLS (not just forms) in the reclassify paths

**Files:**
- Modify: `server/routes/hub.js:7359-7360` (add CTM creds), `server/routes/hub.js:7442-7445` (nextScore), and the per-row update at `7463-7469`
- Modify: `scripts/backfill-failed-classifications.mjs:105` and its update at `:129-132`

Both re-classify paths currently star forms only (`isFormActivity && score === 0 ? getAutoStarRating(...) : score`), so a re-classified CALL keeps score 0 and gets locked out of sync auto-star. Use `computeAutoStar` and post to CTM.

- [ ] **Step 1: reclassify-leads — fetch CTM creds once**

At `server/routes/hub.js:7359`, widen the profile query and resolve credentials:

```js
    const profileRes = await query(
      'SELECT ai_prompt, ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1 LIMIT 1',
      [clientId]
    );
    const prompt = profileRes.rows[0]?.ai_prompt || DEFAULT_AI_PROMPT;
    const credentials = resolveCtmCreds(profileRes.rows[0] || null);
```

- [ ] **Step 2: reclassify-leads — compute star for calls too**

Replace `server/routes/hub.js:7442-7445`:

```js
        const nextScore =
          isFormActivity && score === 0 && !hasClientCategoryOverride
            ? getAutoStarRating(finalCategory)
            : score;
```

with:

```js
        // Star both forms AND calls. computeAutoStar respects manual overrides,
        // existing ratings, and first-touch suppression.
        const autoStar = computeAutoStar({
          category: finalCategory,
          existingScore: score,
          hasCtmRating: false,
          enrichment: { callerType: meta?.caller_type, recentlyQualified: false },
          categorySource,
          alreadyApplied: Boolean(meta?.auto_star_applied_at)
        });
        const nextScore = autoStar.apply ? autoStar.score : score;
```

Then add the marker to `nextMeta` (after `system_tags: systemTags,` at ~`server/routes/hub.js:7459`):

```js
          auto_star_applied_at: autoStar.apply ? new Date().toISOString() : (meta?.auto_star_applied_at || null),
```

- [ ] **Step 3: reclassify-leads — post a newly-applied call star to CTM**

Immediately after the `UPDATE call_logs SET meta=...` query (`server/routes/hub.js:7463-7469`), add:

```js
        if (autoStar.apply && nextScore > 0 && credentials?.accountId && credentials.apiKey && credentials.apiSecret) {
          try {
            await postSaleToCTM(credentials, callId, { score: nextScore, conversion: 1, value: 0 });
          } catch (ctmErr) {
            console.error('[reclassify:ctm-post] failed', { callId, error: ctmErr.message });
          }
        }
```

- [ ] **Step 4: backfill script — same call-star fix**

In `scripts/backfill-failed-classifications.mjs`, add a new import for `computeAutoStar`. Note `getAutoStarRating` is already imported from `ctm.js` (still valid via the re-export from Task 1), but `computeAutoStar` is NOT re-exported from `ctm.js` — import it directly from the new module. Add alongside the existing imports (line 14-22 block):

```js
import { computeAutoStar } from '/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/autoStar.js';
```

Replace line 105:

```js
      const nextScore = isFormActivity && score === 0 && !hasClientCategoryOverride ? getAutoStarRating(finalCategory) : score;
```

with:

```js
      const autoStar = computeAutoStar({
        category: finalCategory,
        existingScore: score,
        hasCtmRating: false,
        enrichment: { callerType: meta?.caller_type, recentlyQualified: false },
        categorySource: hasClientCategoryOverride ? 'client' : 'ai',
        alreadyApplied: Boolean(meta?.auto_star_applied_at)
      });
      const nextScore = autoStar.apply ? autoStar.score : score;
```

Add the marker into `nextMeta` (after `reclassified_at: ...` at line 120):

```js
        auto_star_applied_at: autoStar.apply ? new Date().toISOString() : (meta?.auto_star_applied_at || null),
```

(The standalone backfill does NOT post to CTM — it is a documented recovery script; the durable CTM post is the dedicated recovery script in Task 6. Note this limitation in a comment.)

- [ ] **Step 5: Verify**

Run: `yarn build && yarn lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/hub.js scripts/backfill-failed-classifications.mjs
git commit -m "fix(autostar): reclassify paths star calls (not only forms) via computeAutoStar"
```

---

## Task 6: One-time recovery backfill for frozen leads

**Files:**
- Create: `scripts/backfill-frozen-autostar.mjs`

Recovers existing frozen leads durably: applies the star locally, stamps the marker, AND posts to CTM (required — `syncRatings` is authoritative). No relay re-fire. `DRY_RUN=1` default.

- [ ] **Step 1: Create the script**

Create `scripts/backfill-frozen-autostar.mjs`:

```js
// One-time recovery: star qualified CALL leads that are frozen at score 0
// because the auto-star missed its single classify-cycle window. Posts the
// corrected score to CTM (authoritative under syncRatings) so it sticks.
// Does NOT re-fire the conversion relay (conversions already fired on category).
//
// Run from a cwd WITHOUT a .env so loadEnv.js can't override DB creds:
//   DRY_RUN=1 LIMIT=50 DATABASE_URL=... PGPASSWORD=... node scripts/backfill-frozen-autostar.mjs
// DRY_RUN defaults to 1 (prints only). Set DRY_RUN=0 to write + post to CTM.

import { query } from '/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/db.js';
import { computeAutoStar } from '/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/autoStar.js';
import { resolveCtmCreds, postSaleToCTM } from '/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/ctm.js';

const DRY_RUN = process.env.DRY_RUN !== '0';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null;
const QUALIFIED = ['warm', 'very_good', 'needs_attention', 'not_a_fit', 'applicant', 'spam'];

async function main() {
  console.error(`[recover] mode=${DRY_RUN ? 'DRY_RUN' : 'WRITE'} limit=${LIMIT ?? 'none'}`);

  // Frozen = call, unrated, qualified category, AI-sourced (not a client override),
  // not an active-client caller, no marker yet. recently_qualified is excluded via caller_type.
  const { rows } = await query(
    `SELECT call_id, COALESCE(owner_user_id, user_id) AS client_id, score, caller_type, meta
       FROM call_logs
      WHERE activity_type = 'call'
        AND COALESCE(score, 0) = 0
        AND meta->>'category' = ANY($1)
        AND COALESCE(meta->>'category_source', 'ai') <> 'client'
        AND COALESCE(caller_type, 'new') <> 'active_client'
        AND meta->>'auto_star_applied_at' IS NULL
      ORDER BY started_at DESC NULLS LAST
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
    [QUALIFIED]
  );
  console.error(`[recover] candidate rows: ${rows.length}`);

  const credCache = new Map();
  async function creds(clientId) {
    if (credCache.has(clientId)) return credCache.get(clientId);
    const r = await query(
      'SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1 LIMIT 1',
      [clientId]
    );
    const c = resolveCtmCreds(r.rows[0] || null);
    credCache.set(clientId, c);
    return c;
  }

  let updated = 0, skipped = 0, posted = 0, errors = 0;
  for (const row of rows) {
    const meta = row.meta || {};
    const autoStar = computeAutoStar({
      category: meta.category,
      existingScore: row.score || 0,
      hasCtmRating: false,
      enrichment: { callerType: row.caller_type, recentlyQualified: false },
      categorySource: meta.category_source || 'ai',
      alreadyApplied: false
    });
    if (!autoStar.apply) { skipped += 1; continue; }
    const nextMeta = { ...meta, auto_star_applied_at: new Date().toISOString() };
    if (DRY_RUN) {
      console.log(JSON.stringify({ callId: row.call_id, clientId: row.client_id, category: meta.category, scoreAfter: autoStar.score }));
      updated += 1;
      continue;
    }
    try {
      await query(
        `UPDATE call_logs SET score=$1, meta=$2::jsonb WHERE call_id=$3 AND (owner_user_id=$4 OR user_id=$4)`,
        [autoStar.score, JSON.stringify(nextMeta), row.call_id, row.client_id]
      );
      updated += 1;
      const c = await creds(row.client_id);
      if (c?.accountId && c.apiKey && c.apiSecret) {
        await postSaleToCTM(c, row.call_id, { score: autoStar.score, conversion: 1, value: 0 });
        posted += 1;
        await new Promise((r) => setTimeout(r, 150)); // throttle CTM posts
      }
    } catch (err) {
      errors += 1;
      console.error('[recover] error', row.call_id, err?.message || err);
    }
  }
  console.error(`[recover] done. ${DRY_RUN ? 'would-update' : 'updated'}=${updated} ctmPosted=${posted} skipped=${skipped} errors=${errors}`);
  process.exit(0);
}

main().catch((e) => { console.error('[recover] fatal', e); process.exit(1); });
```

- [ ] **Step 2: Lint the script**

Run: `yarn lint`
Expected: clean (script follows the existing `backfill-failed-classifications.mjs` style).

- [ ] **Step 3: DRY_RUN against prod (read-only) — review before any write**

Establish prod read-only access (see `reference-prod-db-readonly-access` memory): start `cloud-sql-proxy --port 5434 ...`, fetch + URL-decode `DATABASE_URL`. Then from `/tmp` (no `.env`):

Run: `DRY_RUN=1 LIMIT=20 DATABASE_URL="postgresql://jmartin:<decoded>@127.0.0.1:5434/anchor?sslmode=disable" node "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/scripts/backfill-frozen-autostar.mjs"`
Expected: prints ~20 candidate rows with `scoreAfter: 3` (and 2/1 for not_a_fit/spam). Sanity-check the call_ids against `ai_classification_logs`. **Get user sign-off on the dry-run output before a live run.**

- [ ] **Step 4: Commit the script (do NOT run live yet)**

```bash
git add scripts/backfill-frozen-autostar.mjs
git commit -m "feat(autostar): one-time recovery backfill for frozen call leads (DRY_RUN default)"
```

---

## Task 7: Docs + final verification

**Files:**
- Modify: `docs/LEAD_CLASSIFICATION.md`

- [ ] **Step 1: Document the decoupled auto-star**

Append a short subsection to `docs/LEAD_CLASSIFICATION.md` explaining: auto-star is decided by the pure `computeAutoStar` (`server/services/autoStar.js`) on every sync, not just the classify cycle; `meta.auto_star_applied_at` is a once-marker that heals a missed star exactly once and never re-stars a human-cleared lead; manual category (qualified tiers) and manual star both write `category_source='client'` and post to CTM; CTM remains authoritative under `syncRatings`.

- [ ] **Step 2: Full verification**

Run: `node --test server/services/__tests__/autoStar.test.js && yarn build && yarn lint`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add docs/LEAD_CLASSIFICATION.md
git commit -m "docs(autostar): document decoupled auto-star + once-marker"
```

- [ ] **Step 4: Post-deploy verification (after merge to main → auto-deploy)**

Re-sync South Anchorage Dental and confirm the 8 frozen `very_good` new-caller calls (e.g. `4251965990`, `4252327529`, `4252598129`) move to 3★ and leave the "Returning/Other" bucket. Then run the Task 6 recovery script live (`DRY_RUN=0`, with `LIMIT` first, then full) once the user approves the dry-run output, to recover the historical platform-wide backlog.

---

## Notes for the implementer

- **No prod mutations without sign-off.** The recovery script (Task 6) writes to prod + CTM; only run live after the user approves the dry-run. Merge to `main` = auto-deploy to prod, so get explicit human sign-off before merging (per project rule).
- **HIPAA:** never log caller name/number/email/transcript — log `call_id`, score, category, reason only.
- **CTM is authoritative** under `syncRatings: true`; any durable score change must be posted to CTM or the next sync re-zeros it.
- **Forms unchanged** — this work is call-focused; the form path already stars in `forms.js`.
