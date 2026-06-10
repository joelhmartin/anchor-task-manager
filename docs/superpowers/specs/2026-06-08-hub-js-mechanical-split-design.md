# hub.js Mechanical Split — Design

**Date:** 2026-06-08
**Status:** Approved (design); pending implementation plan
**Branch:** `refactor/hub-split` (off `main`)

## Problem

`server/routes/hub.js` is **13,103 lines / 195 routes** — the single largest file in the
codebase. It mixes ~24 distinct domains (clients, calls, contacts, leads, journeys,
client accounts, OAuth integrations, documents, profile/brand, portal, notifications,
email, and a dozen smaller surfaces) plus dozens of domain-specific helper functions in
one module. This hurts:

- **Agent workability** — reading, grepping, and editing a 13k-line file is slow and
  error-prone; it can't be held in context at once.
- **Human maintainability** — no clear domain boundaries; hard to navigate and onboard.
- **Correctness / coupling** — tangled responsibilities make changes ripple (cf. past
  bugs: journey status schism, ambiguous `contact_id`, auto-star coupling).

## Goal & Non-Goals

**Goal:** Decompose `hub.js` into ~24 focused domain files via a **pure mechanical
split** — moving route handlers and their helpers verbatim into per-domain sub-router
files, with **zero behavior change**.

**Non-goals (explicitly out of scope):**
- No HTTP-vs-logic layering (handlers are NOT rewritten to call service modules).
- No business-logic refactoring, no SQL changes, no endpoint signature changes.
- No changes to `index.js` mount behavior or to any other router.
- No new features.

This is the lowest-risk option, chosen specifically because the project has **no
automated test suite** and **deploys auto-trigger to production on push to `main`**.

## Key Constraints Discovered

1. **Auth boundary at `hub.js:1651`.** `router.use(requireAuth)` gates the file. The
   **5 routes defined before it are PUBLIC** and must stay reachable without auth:
   - `GET /users/:id/avatar`
   - `GET /oauth/google/callback`
   - `GET /oauth/facebook/callback`
   - `GET /oauth/tiktok/callback`
   - `GET /oauth/wordpress/callback`

   Everything after line 1651 requires auth. **This ordering MUST be preserved exactly.**

2. **98 inline per-route guards** (`requireAdmin`, `requireSuperadmin`, `isAdmin`, …)
   sit on individual routes and must stay attached to their routes.

3. **`hub.js` only exports `default router`.** No other file imports its internals, so
   extraction has **no external blast radius** — only internal helper references move.

4. **Mounted first** in `index.js` (`app.use('/api/hub', hubRouter)` at line 203)
   *because* it owns the public routes; other `/api/hub` routers mount after it. This
   mount stays unchanged.

## Architecture

`server/routes/hub.js` becomes a **thin aggregator (~30 lines)** that imports domain
sub-routers from a new `server/routes/hub/` directory and mounts them in the order that
preserves the public → auth boundary:

```js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import publicRouter from './hub/public.js';
import clientsRouter from './hub/clients.js';
// … all domain sub-routers …

const router = express.Router();

router.use(publicRouter);     // 5 public routes — MUST mount first
router.use(requireAuth);      // the global gate, unchanged
router.use(clientsRouter);    // all authed sub-routers mount after the gate
router.use(callsRouter);
// … remaining authed sub-routers …

export default router;
```

- `index.js` is **untouched** — still `app.use('/api/hub', hubRouter)`.
- Authed sub-routers do **NOT** call `requireAuth` themselves; the aggregator applies it
  globally before mounting them, mirroring today's behavior exactly.
- Per-route guards (`requireAdmin`, etc.) stay inline on their routes inside the
  sub-router files.
- Each authed sub-router registers its routes with the **same relative order** as today.
  Cross-router order is safe because domains use distinct path prefixes; intra-prefix
  ordering (e.g. `/clients/:id` vs `/clients/groups`) is preserved within a single file.

## File Layout (`server/routes/hub/`)

**24 files total** — 12 core domains + 10 small domains + `public.js` + `_shared.js`.

### Core domains
| File | Route prefixes | ~routes |
|------|---------------|---------|
| `public.js` | avatar + 4 OAuth callbacks (the pre-`requireAuth` block) | 5 |
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
| `_shared.js` | constants + helpers used by 2+ sub-routers | — |

### Small domains (own files, for precedent + room to grow)
| File | Route prefixes | ~routes |
|------|---------------|---------|
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

None should exceed ~2k lines (`clients.js` is the largest at ~2k).

### Helper placement rule
- A helper/constant used by **exactly one** domain moves into that domain's file.
- A helper/constant used by **2+** domains moves into `_shared.js` and is imported.
- `_shared.js` is the only "movement" in an otherwise verbatim split; it is established
  first so domain files can import from it.

## Verification (the safety net — no test suite)

1. **Route-inventory baseline.** Before any change, write a script that boots the router,
   walks the **runtime Express stack** (NOT a source-text regex — several route defs span
   multiple lines, e.g. `PUT /brand`), and dumps every `(method, full path)` plus whether
   it sits **before/after the `requireAuth` gate**. Save as the golden baseline.
2. **After each extraction**, regenerate the inventory and **diff against baseline — it
   must be identical.** This mechanically catches any dropped route, changed path, or
   auth-boundary violation.
3. `yarn build` + `yarn lint` after each file — catches import/tree-shaking/syntax issues.
4. Server boots clean, **195 routes register**, no new console errors.

## Execution (incremental, reversible)

- New branch `refactor/hub-split` off `main` (never directly on `main`; deploy auto-fires).
- Establish `_shared.js` first (move cross-used helpers/constants).
- **One sub-router extracted per commit**, verified by the route-diff *before* committing.
  If the diff drifts, that single commit reverts trivially.
- Work through the file list in order; subagent-driven execution.
- Final commit: reduce `hub.js` to the thin aggregator and confirm the full route-diff +
  build + lint + boot once more.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Auth boundary violated (a public route ends up gated, or vice-versa) | Baseline inventory records the gate position per route; diff fails if it moves. |
| A route silently dropped during move | Route-count + per-route diff against baseline after every commit. |
| Express route-ordering collision across sub-routers | Distinct prefixes per domain; intra-prefix order preserved within one file. |
| Shared helper missed / duplicated | `_shared.js` established first; lint flags unused/undefined; build flags missing imports. |
| Large change merged to prod accidentally | Dedicated branch; explicit human sign-off required before merge to `main`. |

## Compliance Note

No PHI handling, logging, query construction, or access-control logic changes — handlers
move verbatim. The auth boundary is preserved by construction and verified by the
route-inventory diff. No `.env` or migration changes.
