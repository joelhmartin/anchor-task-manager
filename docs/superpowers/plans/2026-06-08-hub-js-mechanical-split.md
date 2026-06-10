# hub.js Mechanical Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `server/routes/hub.js` (13,103 lines / 195 routes) into ~24 focused domain sub-routers under `server/routes/hub/`, mounted by a thin aggregator, with **zero behavior change**.

**Architecture:** Pure mechanical move — route handlers and their helpers relocate verbatim into per-domain `express.Router()` files. `hub.js` becomes a ~40-line aggregator that mounts them in the order that preserves the public → `requireAuth` boundary. No HTTP/logic layering, no SQL or signature changes.

**Tech Stack:** Express 4 routers, Node 20 ESM. Verification harness: a runtime route-inventory diff (no automated test suite exists) + `yarn build` + `yarn lint` + clean server boot.

**Design spec:** `docs/superpowers/specs/2026-06-08-hub-js-mechanical-split-design.md`

**Branch:** `refactor/hub-split` (already created off `main`; spec already committed there).

---

## Critical Invariants (read before any task)

1. **Auth boundary.** `hub.js:1651` is `router.use(requireAuth)`. The 5 routes before it are PUBLIC and must stay public:
   - `GET /users/:id/avatar`
   - `GET /oauth/google/callback`, `/oauth/facebook/callback`, `/oauth/tiktok/callback`, `/oauth/wordpress/callback`

   Everything else is authed. The aggregator must mount `publicRouter` **before** `router.use(requireAuth)` and all other routers **after**.

2. **Per-route guards stay attached.** `requireAdmin`, `requireSuperadmin`, `isAdmin`, etc. (98 inline uses) move verbatim with their route.

3. **No behavior change.** Handler bodies, SQL, validation, logging, and response shapes move byte-for-byte. The only new code is `import` lines and the aggregator's `router.use(...)` calls.

4. **Green at every commit.** After each task the route-inventory diff must be empty, `yarn build` + `yarn lint` pass, and the server boots clean. If any fails, fix or revert that single commit before proceeding.

---

## File Structure

New directory `server/routes/hub/`:

| File | Route prefixes | ~routes |
|------|---------------|---------|
| `_shared.js` | cross-cutting helpers/constants/upload infra (2+ consumers) | — |
| `public.js` | avatar + 4 OAuth callbacks (pre-auth block) | 5 |
| `clients.js` | `/clients` | 31 |
| `calls.js` | `/calls` | 23 |
| `contacts.js` | `/contacts` | 10 |
| `leads.js` | `/leads`, `/lead-views`, `/lead-tags`, `/pipeline-stages` | 13 |
| `journeys.js` | `/journeys`, `/journey-email-templates` | 17 |
| `accounts.js` | `/client-groups`, `/active-clients` | 17 |
| `oauth.js` | authed `/oauth`, `/oauth-connections`, `/oauth-providers`, `/oauth-resources` | ~23 |
| `documents.js` | `/docs`, `/shared-docs` | 14 |
| `profile.js` | `/profile`, `/brand` | 14 |
| `portal.js` | `/portal` | 5 |
| `services.js` | `/services` | 4 |
| `notifications.js` | `/notifications` | 3 |
| `email.js` | `/email/test`, `/email-logs` | 4 |
| `wordpress.js` | `/wordpress` | 2 |
| `aiClassificationLogs.js` | `/ai-classification-logs` | 2 |
| `admin.js` | `/admin/clients/:id/services` | 2 |
| `activity.js` | `/activity/page-view`, `/user-activity-logs` | 2 |
| `analytics.js` | `/analytics` | 1 |
| `meta.js` | `/meta/test-permissions` | 1 |
| `users.js` | `/internal-users` | 1 |

`hub.js` shrinks to the aggregator. `server/index.js` is **not modified**.

---

## Task 1: Route-inventory harness + golden baseline

**Files:**
- Create: `scripts/hub-route-inventory.mjs`
- Create (output, git-ignored): `/tmp/hub-routes.baseline.txt`

- [ ] **Step 1: Write the inventory script**

```js
// scripts/hub-route-inventory.mjs
// Boots the hub router and walks the RUNTIME Express stack (not source regex —
// several route defs span multiple lines). Emits one stable line per route:
//   "<PUB|AUTH> <METHOD> <path>"  sorted, so it can be diffed across refactors.
import hubRouter from '../server/routes/hub.js';

const out = [];
const state = { gated: false };

function isRequireAuth(layer) {
  // router.use(requireAuth) appears as a middleware layer named 'requireAuth'.
  return layer && !layer.route && typeof layer.handle === 'function'
    && (layer.handle.name === 'requireAuth' || layer.name === 'requireAuth');
}

function walk(stack) {
  for (const layer of stack) {
    if (isRequireAuth(layer)) { state.gated = true; continue; }
    if (layer.route) {
      const p = layer.route.path;
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route.methods[m]);
      for (const m of methods) {
        out.push(`${state.gated ? 'AUTH' : 'PUB '} ${m.toUpperCase().padEnd(6)} ${p}`);
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      // mounted sub-router (express.Router) — recurse, preserving gate state
      walk(layer.handle.stack);
    }
  }
}

walk(hubRouter.stack);
out.sort();
process.stdout.write(out.join('\n') + '\n');
process.stderr.write(`TOTAL ROUTES: ${out.length}\n`);
```

- [ ] **Step 2: Capture the golden baseline (before any structural change)**

Run:
```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"
node scripts/hub-route-inventory.mjs > /tmp/hub-routes.baseline.txt
wc -l /tmp/hub-routes.baseline.txt
grep -c '^PUB ' /tmp/hub-routes.baseline.txt
```
Expected: `195` total lines (±0), and exactly `5` `PUB ` lines (the avatar + 4 OAuth callbacks).

**If the script errors on import** (a service does DB/network work at import time): prepend env via the project loader by running from the repo root (loadEnv reads `.env`). If it still fails, isolate by running `node --input-type=module` with the same body. Do NOT proceed to Task 2 until the baseline captures 195 routes with 5 public.

- [ ] **Step 3: Sanity-check the 5 public routes are exactly right**

Run:
```bash
grep '^PUB ' /tmp/hub-routes.baseline.txt
```
Expected (order may differ, set must match):
```
PUB  GET    /oauth/facebook/callback
PUB  GET    /oauth/google/callback
PUB  GET    /oauth/tiktok/callback
PUB  GET    /oauth/wordpress/callback
PUB  GET    /users/:id/avatar
```

- [ ] **Step 4: Commit the harness**

```bash
git add scripts/hub-route-inventory.mjs
git commit -m "test(refactor): hub route-inventory harness + baseline (195 routes, 5 public)"
```

---

## Task 2: Scaffold `hub/` + seed `_shared.js` with cross-cutting infra

This isolates helper-movement risk from route-movement risk. After this task, **all 195 routes still live in `hub.js`** — only shared helpers moved out, and `hub.js` imports them back. The route-inventory diff must be empty.

**Files:**
- Create: `server/routes/hub/_shared.js`
- Modify: `server/routes/hub.js` (remove moved decls, add one import)

- [ ] **Step 1: Create `_shared.js` and move the upload infra + obvious cross-cutting helpers**

Move these declarations **verbatim** from `hub.js` into `server/routes/hub/_shared.js` and `export` each. They are referenced by 2+ domains (uploads by brand/docs/avatar/groups; the rest below by multiple list/account endpoints):

- Upload infra (`hub.js:1233-1281` region): `uploadRoot`, `brandDir`, `docsDir`, `avatarDir`, `groupIconsDir`, the `mkdirSync` loop, `storage`, `uploadBrand`, `uploadDocs`, `uploadAvatar`, `uploadGroupIcon`, `publicUrl`, plus `uploadDisplayLogo` (`~2315`) and `uploadDisplayLogoSingle` (`~2418`).
- `hashToken` (`~1229`)
- `canWriteAccount` (`~264`)
- `normalizeEmailForCollision` (`~333`)
- `buildNormalizedPhoneMatchSql` (`~353`)
- `DAY_IN_MS` (`129`), `WEEK_IN_DAYS` (`190`)

`_shared.js` needs its own imports at top (copy the ones these helpers use):
```js
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
```
(Add any other import a moved helper references; `yarn lint` will flag a missing one.)

- [ ] **Step 2: Import the moved symbols back into `hub.js`**

At the top of `hub.js`, add:
```js
import {
  uploadRoot, brandDir, docsDir, avatarDir, groupIconsDir,
  storage, uploadBrand, uploadDocs, uploadAvatar, uploadGroupIcon,
  uploadDisplayLogo, uploadDisplayLogoSingle, publicUrl,
  hashToken, canWriteAccount, normalizeEmailForCollision,
  buildNormalizedPhoneMatchSql, DAY_IN_MS, WEEK_IN_DAYS
} from './hub/_shared.js';
```
Remove the now-duplicated `multer`/`fs`/`crypto` etc. imports from `hub.js` **only if** nothing else in `hub.js` still uses them (check with `grep -n`). When unsure, leave them — `yarn lint` reports unused imports.

- [ ] **Step 3: Verify — route diff must be empty**

Run:
```bash
node scripts/hub-route-inventory.mjs > /tmp/hub-routes.now.txt
diff /tmp/hub-routes.baseline.txt /tmp/hub-routes.now.txt && echo "ROUTES IDENTICAL"
```
Expected: `ROUTES IDENTICAL` (no diff output).

- [ ] **Step 4: Verify build + lint**

Run:
```bash
yarn lint && yarn build
```
Expected: lint clean (no new errors), build succeeds.

- [ ] **Step 5: Verify clean boot**

Run (background, then check log):
```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null; node server/index.js > /tmp/hub-boot.log 2>&1 &
sleep 6; grep -iE "error|cannot find|undefined is not|SyntaxError" /tmp/hub-boot.log || echo "BOOT CLEAN"; lsof -ti:4000 | xargs kill -9 2>/dev/null
```
Expected: `BOOT CLEAN` (server bound port 4000, no import/runtime errors).

- [ ] **Step 6: Commit**

```bash
git add server/routes/hub/_shared.js server/routes/hub.js
git commit -m "refactor(hub): extract cross-cutting upload + helper infra to hub/_shared.js"
```

---

## Standard Extraction Procedure (referenced by Tasks 3–24)

Each domain task below is an application of this exact procedure. Parameters per task: **PREFIXES** (the URL prefixes this file owns), **FILE** (`server/routes/hub/<name>.js`), and **POSITION** (where to mount in the aggregator — for now, always append after the previously-mounted authed router; `public.js` is the sole exception and mounts before `requireAuth`).

For each domain:

1. **Identify the routes.** In `hub.js`, find every `router.<method>('<PREFIX>...'` (and multi-line `router.<method>(\n  '<PREFIX>...`) for the task's PREFIXES.

2. **Identify helper deps.** For each route body, list the locally-defined helpers/constants it calls (anything not imported at the top of `hub.js` and not already in `_shared.js`). For each such helper run:
   ```bash
   grep -nc "\b<helperName>\b" server/routes/hub.js
   ```
   - Referenced only by **this** domain's routes → move the helper into FILE.
   - Referenced by routes in **other** (still-unextracted or already-extracted) domains → move it into `_shared.js` and `export` it; import it in FILE (and update earlier extracted files / `hub.js` to import from `_shared.js` if they had a local copy).

3. **Create FILE:**
   ```js
   import express from 'express';
   const router = express.Router();
   // ...domain-only imports (copy the subset of hub.js's service imports these routes use)...
   // ...domain-only helpers moved in step 2...
   // ...the route handlers, moved VERBATIM...
   export default router;
   ```
   Copy only the `import` lines from `hub.js` that the moved routes/helpers actually use. Import shared symbols from `./_shared.js`. Import per-route guards (`requireAdmin`, etc.) from their middleware module exactly as `hub.js` does.

4. **Remove from `hub.js`** the moved route handlers and any moved single-domain helpers.

5. **Mount in the aggregator.** In `hub.js`, add `import <name>Router from './hub/<name>.js';` and `router.use(<name>Router);` at POSITION (after the prior authed router; before any catch-all). `public.js` only: `router.use(publicRouter)` goes **above** `router.use(requireAuth)`.

6. **Verify (all four must pass):**
   ```bash
   node scripts/hub-route-inventory.mjs > /tmp/hub-routes.now.txt
   diff /tmp/hub-routes.baseline.txt /tmp/hub-routes.now.txt && echo "ROUTES IDENTICAL"
   yarn lint && yarn build
   lsof -ti:4000 | xargs kill -9 2>/dev/null; node server/index.js > /tmp/hub-boot.log 2>&1 & sleep 6; grep -iE "error|cannot find|SyntaxError" /tmp/hub-boot.log || echo "BOOT CLEAN"; lsof -ti:4000 | xargs kill -9 2>/dev/null
   ```
   Expected: `ROUTES IDENTICAL`, lint clean, build OK, `BOOT CLEAN`. **The diff catches a dropped route, a changed path, or a public/authed boundary flip — the #1 risk.**

7. **Commit:** `git commit -m "refactor(hub): extract <PREFIXES> into hub/<name>.js"`

> If the route diff is non-empty: a route was dropped, renamed, or crossed the auth gate. Do not patch forward — `git checkout -- .` and redo the move carefully. Each task is one isolated commit specifically so this is cheap.

---

## Task 3: Extract `public.js` (do this FIRST among extractions)

Apply the Standard Extraction Procedure with:
- **PREFIXES:** the exact 5 pre-auth routes: `GET /users/:id/avatar`, `GET /oauth/google/callback`, `GET /oauth/facebook/callback`, `GET /oauth/tiktok/callback`, `GET /oauth/wordpress/callback` (`hub.js` lines ~1274–1650, the block above `router.use(requireAuth)`).
- **FILE:** `server/routes/hub/public.js`
- **POSITION:** `router.use(publicRouter)` mounts **above** `router.use(requireAuth)` in the aggregator. This is the only router mounted before the gate.
- **Helper deps to expect:** `upsertUserAvatarFromUpload` (`~1653` — check if used elsewhere; likely public+profile → `_shared.js`), `uploadAvatar`/`publicUrl` (already in `_shared.js`), the OAuth callback helpers from `services/oauth*` (already imported from services — copy those import lines). The OAuth callback bodies are large; move them verbatim.

Verify per the procedure. Confirm specifically: `grep -c '^PUB ' /tmp/hub-routes.now.txt` still returns `5`, and those 5 are the avatar + 4 callbacks.

---

## Tasks 4–23: Extract the remaining domains

Apply the Standard Extraction Procedure once per row, **in this order** (leaf/independent domains first to surface shared helpers early; biggest domains last). After each, run the full 4-check verify and commit.

| Task | FILE | PREFIXES |
|------|------|----------|
| 4  | `notifications.js` | `/notifications` |
| 5  | `email.js` | `/email/test`, `/email-logs` |
| 6  | `wordpress.js` | `/wordpress` |
| 7  | `meta.js` | `/meta` |
| 8  | `analytics.js` | `/analytics` |
| 9  | `users.js` | `/internal-users` |
| 10 | `activity.js` | `/activity`, `/user-activity-logs` |
| 11 | `aiClassificationLogs.js` | `/ai-classification-logs` |
| 12 | `admin.js` | `/admin` |
| 13 | `services.js` | `/services` |
| 14 | `pipeline-stages` → fold into `leads.js` later; extract now as part of Task 17 | (skip — see Task 17) |
| 15 | `documents.js` | `/docs`, `/shared-docs` |
| 16 | `portal.js` | `/portal` |
| 17 | `leads.js` | `/leads`, `/lead-views`, `/lead-tags`, `/pipeline-stages` |
| 18 | `journeys.js` | `/journeys`, `/journey-email-templates` |
| 19 | `accounts.js` | `/client-groups`, `/active-clients` |
| 20 | `oauth.js` | `/oauth` (authed only — callbacks already in `public.js`), `/oauth-connections`, `/oauth-providers`, `/oauth-resources` |
| 21 | `profile.js` | `/profile`, `/brand` |
| 22 | `contacts.js` | `/contacts` |
| 23 | `calls.js` | `/calls` |
| 24 | `clients.js` | `/clients` |

Notes that affect specific tasks:
- **Task 18 (journeys):** the journey helper cluster is large (`hub.js:343–786` region: status/offset/schedule normalizers, `fetchJourneysForOwner`, `syncJourneySchedule`, `maybeBackfillJourneySchedules`, etc.). Most are journey-only → move into `journeys.js`. But `attachJourneyMetaToCalls` (`~790`) is called by calls/leads list endpoints → move to `_shared.js`. Run the grep in Procedure step 2 for each before placing.
- **Task 17/22/23 (leads/contacts/calls):** these share the call-list decorators `attachTagsToCalls` (`~822`), `attachLifecycleState` (`~849`), `attachContactNames` (`~1012`), `shapeActivityRow` (`~774`), `resolveLeadCallLink` (`~1041`), `parseDateValue` (`~1034`). Grep will show 2+ consumers → put them in `_shared.js` during whichever task hits them first.
- **Task 21 (profile/brand):** `serializeHubProfileUser` (`~1672`), `attachDisplayLogo` (`~2127`), `setDisplayLogo`/`clearDisplayLogo` (`~2325/2379`), the `applyXPatch` family + `getClientSnapshot` + `applyClientPatchTx` (`~4650–5400` region) — check consumers; the `applyClientPatchTx` family is used by `/clients` PATCH too, so likely `_shared.js`.
- **Task 24 (clients):** largest file (~2k lines). Includes `requireOwnerInviteClient` (`~3082`), `fixCallerTypesPostSync` (`~199`), `derivePresetAiPrompt`/`isAutoManagedPrompt` (`~151–181`), `sanitizeSymptomList` (`~358`). Grep each.

(Task numbering 14 intentionally folds into 17; keep the table's FILE/PREFIXES as the contract — `pipeline-stages` ships inside `leads.js`.)

---

## Task 25: Collapse `hub.js` to the thin aggregator + final verification

After Tasks 3–24, `hub.js` should contain only: imports, the `express.Router()`, the ordered `router.use(...)` mounts, and `export default router`. No route definitions, no handler bodies.

**Files:**
- Modify: `server/routes/hub.js` (final form)

- [ ] **Step 1: Confirm `hub.js` has no remaining route definitions**

Run:
```bash
grep -cE "router\.(get|post|put|patch|delete)\(" server/routes/hub.js
```
Expected: `0`.

- [ ] **Step 2: Confirm the aggregator shape**

`hub.js` should read (order matters — public before the gate):
```js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import publicRouter from './hub/public.js';
import clientsRouter from './hub/clients.js';
import callsRouter from './hub/calls.js';
import contactsRouter from './hub/contacts.js';
import leadsRouter from './hub/leads.js';
import journeysRouter from './hub/journeys.js';
import accountsRouter from './hub/accounts.js';
import oauthRouter from './hub/oauth.js';
import documentsRouter from './hub/documents.js';
import profileRouter from './hub/profile.js';
import portalRouter from './hub/portal.js';
import servicesRouter from './hub/services.js';
import notificationsRouter from './hub/notifications.js';
import emailRouter from './hub/email.js';
import wordpressRouter from './hub/wordpress.js';
import aiClassificationLogsRouter from './hub/aiClassificationLogs.js';
import adminRouter from './hub/admin.js';
import activityRouter from './hub/activity.js';
import analyticsRouter from './hub/analytics.js';
import metaRouter from './hub/meta.js';
import usersRouter from './hub/users.js';

const router = express.Router();

router.use(publicRouter);   // 5 public routes — before the gate
router.use(requireAuth);    // global auth gate, unchanged

router.use(clientsRouter);
router.use(callsRouter);
router.use(contactsRouter);
router.use(leadsRouter);
router.use(journeysRouter);
router.use(accountsRouter);
router.use(oauthRouter);
router.use(documentsRouter);
router.use(profileRouter);
router.use(portalRouter);
router.use(servicesRouter);
router.use(notificationsRouter);
router.use(emailRouter);
router.use(wordpressRouter);
router.use(aiClassificationLogsRouter);
router.use(adminRouter);
router.use(activityRouter);
router.use(analyticsRouter);
router.use(metaRouter);
router.use(usersRouter);

export default router;
```

- [ ] **Step 3: Final route-inventory diff**

Run:
```bash
node scripts/hub-route-inventory.mjs > /tmp/hub-routes.final.txt
diff /tmp/hub-routes.baseline.txt /tmp/hub-routes.final.txt && echo "ROUTES IDENTICAL"
grep -c '^PUB ' /tmp/hub-routes.final.txt
```
Expected: `ROUTES IDENTICAL`, and `5` public.

- [ ] **Step 4: Final build + lint + boot**

```bash
yarn lint && yarn build
lsof -ti:4000 | xargs kill -9 2>/dev/null; node server/index.js > /tmp/hub-boot.log 2>&1 & sleep 6; grep -iE "error|cannot find|SyntaxError" /tmp/hub-boot.log || echo "BOOT CLEAN"; lsof -ti:4000 | xargs kill -9 2>/dev/null
```
Expected: clean lint, successful build, `BOOT CLEAN`.

- [ ] **Step 5: Report file sizes (sanity — none should be huge)**

```bash
wc -l server/routes/hub.js server/routes/hub/*.js | sort -n
```
Expected: `hub.js` ~40 lines; largest domain file (`clients.js`) ≲ ~2,100 lines.

- [ ] **Step 6: Commit**

```bash
git add server/routes/hub.js
git commit -m "refactor(hub): collapse hub.js to thin aggregator (195 routes verified identical)"
```

---

## Task 26: Manual smoke + docs + PR

- [ ] **Step 1: Targeted manual smoke (the route diff proves wiring, this proves runtime).** With a local server + a logged-in session, hit one representative endpoint per high-traffic domain and confirm normal responses:
  - `GET /api/hub/clients` (list)
  - `GET /api/hub/calls?...` (leads list)
  - `GET /api/hub/contacts`
  - `GET /api/hub/journeys`
  - `GET /api/hub/notifications`
  - `GET /api/hub/users/<id>/avatar` **without** a token → must still return the image / not 401 (public-route proof).

  Record outcomes. Any 500/401 regression → debug before PR (use `superpowers:systematic-debugging`).

- [ ] **Step 2: Update docs.** Add a one-line note to `docs/ROUTE_TABLE.md` that `/api/hub` is now served by `server/routes/hub/` sub-routers (aggregator in `hub.js`). Update the CLAUDE.md "hub.js is ~7400 lines" gotcha (#11) to point at `server/routes/hub/<domain>.js`.

- [ ] **Step 3: Push + open PR (do NOT merge — auto-deploys to prod).**

```bash
git push -u origin refactor/hub-split
gh pr create --title "refactor(hub): split hub.js into domain sub-routers" \
  --body "Mechanical split of the 13,103-line hub.js into ~24 domain sub-routers under server/routes/hub/, mounted by a thin aggregator. Zero behavior change — verified by runtime route-inventory diff (195 routes identical, 5 public) after every commit, plus build/lint/boot. Spec: docs/superpowers/specs/2026-06-08-hub-js-mechanical-split-design.md"
```

- [ ] **Step 4: Trigger CodeRabbit** (per project convention): comment `@coderabbitai review` on the PR; wait for its pass before requesting human sign-off. **Human approval required before merge** (merge = prod deploy).

---

## Self-Review (completed by plan author)

- **Spec coverage:** every spec section maps to a task — auth-boundary preservation (Task 1 baseline + every verify), file layout (Tasks 3–24 table), `_shared.js` rule (Task 2 + Procedure step 2), thin aggregator (Task 25), verification harness (Task 1 + Procedure step 6), incremental one-commit-per-router execution (Tasks 3–24), branch/PR/human-signoff (Task 26). ✓
- **Placeholder scan:** the per-domain bodies are verbatim moves of existing source identified by exact prefix + line region — not placeholders. The repeatable work is captured once in the Standard Extraction Procedure and parameterized per task (PREFIXES/FILE/POSITION), not deferred. ✓
- **Type/name consistency:** aggregator import/variable names in Task 25 match the FILE names in the Tasks 3–24 table; helper names (`attachJourneyMetaToCalls`, `applyClientPatchTx`, etc.) match their `hub.js` line references. ✓
- **Verification realism:** no test suite — the harness (route-inventory diff) is the contract, with build/lint/boot as backstops; manual smoke covers runtime. ✓
