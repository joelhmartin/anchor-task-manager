# Refactor State

## Current Phase

Phase 4 (file splits) — hub.js decomposition in progress

## Active Target

_(none — run complete)_

## Queue (Next Up, ROI-ordered)

1. **hub.js: extract Client Team Management routes** — Phase 4 continuation. Lines 10993-11833 (~840 lines). Depends on `logSecurityEvent`, `sendMailgunMessageWithLogging`, `maskEmail`, `hashToken`, many other hub.js imports. Complex (invites, tokens, emails). Needs careful import audit before starting. HIGH ROI: ~840 lines removed from hub.js.
2. **hub.js: extract AI classification + activity log routes** — Lines 10771-10906 (~135 lines). Uses `fetchAiClassificationLogs`, `updateAiClassificationLogReview`, `fetchActivityLogs`, `ActivityEventTypes`, `logUserActivity` — most already imported elsewhere in hub.js so won't reduce imports. LOW ROI: ~135 lines.
3. **hub.js: extract OAuth provider management routes** — Lines 9524–10612 (~1088 lines, OAuth Providers + Connections + Google/Facebook/Meta/TikTok/WordPress). Very complex: many private helpers, many service imports. MULTI-RUN. Start with OAuth Providers CRUD only (~90 lines at 9529-9620).
4. **formatUserName sweep (backend)** — BLOCKED: onboardingPdf.js:74, templateVariables.js:63 both have same email-fallback behavior-change risk as auth.js. Added to blocked.
5. **auth.js + notifications.js name reconstruction** — BLOCKED (see Blocked section)
6. **AdminHub.jsx remaining clientLabel sites** — BLOCKED (see Blocked section)
7. **ctmForms.js (1864 LOC)** — Phase 4 target. Templates section (lines 1491–1729) is cleanest seam but uses `generateEmbedToken` shared with other routes. Low ROI per run since it's only 238 lines.
8. **FormsPane.jsx** — decommissioned (`/api/forms`), 2 sites. Low ROI; leave until deprecation removal.

## Completed

- 2026-05-14: Discovery Phase — scanned codebase, identified all duplication patterns, wrote REFACTOR-PLAN.md
- 2026-05-14: groupAnalytics.js — removed private `clientLabel()` (12 lines) and fixed `clientName()` null-interpolation bug
- 2026-05-14: tasks.js — swept 28 pure `archived_at IS NULL` → `activeOnly()`
- 2026-05-14: tokens.js — swept 7 `revoked_at IS NULL` → `notRevoked()`
- 2026-05-14: deviceFingerprint.js — swept 5 `revoked_at IS NULL` → `notRevoked()`
- 2026-05-14: clientTeam.js — swept 4 `revoked_at IS NULL` → `notRevoked()`
- 2026-05-14: onboarding.js — swept 4 `revoked_at IS NULL` → `notRevoked()`
- 2026-05-15: hub.js — swept 23 `revoked_at IS NULL` + 12 of 13 `archived_at IS NULL` → `notRevoked()`/`activeOnly()`
- 2026-05-15: taskAutomations.js — swept 5 `archived_at IS NULL` → `activeOnly()`
- 2026-05-15: ruleEngine.js — swept 5 `archived_at IS NULL` → `activeOnly()`
- 2026-05-15: AdPerformanceChart.jsx — META_COLOR `#1877F2` → `BRAND_COLORS.facebook`
- 2026-05-15: FacebookPostPreview.jsx — inline `#1877F2` → `BRAND_COLORS.facebook`
- 2026-05-15: AdminHub.jsx + ClientView.jsx — `setActingClient` displayName inline → `clientLabel(c) || 'Client'`
- 2026-05-18: clientInvite.js — swept 4 `revoked_at IS NULL` → `notRevoked()` (cuit + cgit aliases)
- 2026-05-18: socialMediaTokens.js — swept 2 `revoked_at IS NULL` → `notRevoked()`
- 2026-05-18: onboardingReminders.js — swept 2 `revoked_at IS NULL` → `notRevoked()` (t + newer aliases)
- 2026-05-18: gsc.js — swept 1 `revoked_at IS NULL` → `notRevoked()`
- 2026-05-18: reviews.js service — swept 3 `revoked_at IS NULL` → `notRevoked()` (oc + c aliases)
- 2026-05-18: routes/reviews.js — swept 1 `revoked_at IS NULL` → `notRevoked()`
- 2026-05-18: **revoked_at IS NULL SWEEP COMPLETE — 0 remaining inline sites**
- 2026-05-18: socialClientLinkSync.js — swept 4 `archived_at IS NULL` → `activeOnly()`
- 2026-05-18: metaPagePosting.js — swept 2 `archived_at IS NULL` → `activeOnly()`
- 2026-05-18: routes/social.js — swept 1 `archived_at IS NULL` → `activeOnly()`
- 2026-05-18: routes/analytics.js — swept 1 `archived_at IS NULL` → `activeOnly()`
- 2026-05-18: journeyEmailScheduler.js — swept 1 `archived_at IS NULL` → `activeOnly('j')`
- 2026-05-18: taskRecurrence.js — swept 1 `archived_at IS NULL` → `activeOnly('i')`
- 2026-05-18: reports/dataPackage.js — swept 1 `archived_at IS NULL` → `activeOnly('ti')` (inside FILTER clause)
- 2026-05-18: ops/skills/store.js + recipes.js — swept 2 `archived_at IS NULL` → `activeOnly()` (dynamic where-array push)
- 2026-05-18: hub.js 2 plain remaining — swept to `activeOnly()`
- 2026-05-18: operations.js 2 sites — swept to `activeOnly('s')` (1 string assignment + 1 WHERE clause)
- 2026-05-18: **archived_at IS NULL SWEEP ~90% COMPLETE** — 10 remaining, all intentional (see Known Duplications)
- 2026-05-18: TeamTab.jsx + ClientGroupAccessPanel.jsx + TeamManagement.jsx — adopted `clientLabel()` for staff name display (4 sites)
- 2026-05-18: ReviewsPanel.jsx — added `triggerMessage?.('error', ...)` toasts in 4 silent catch blocks
- 2026-05-18: SharedDocuments.jsx — added error toast in drag-reorder failure catch
- 2026-05-18: InsightsCard.jsx + EmailLogsSection.jsx — added error toasts in silent background-load catches
- 2026-05-19: **clientLabel() FRONTEND SWEEP — 26 sites across 16 files** (see run 4 log)
  - FilterBar, WorkloadWidget, BoardTable (×4), ProfileSettings, ProfileTab, ClientOnboarding (batch 1+2)
  - WorkloadView, KanbanBoard, StepEditorDialog, FormsListPane (×2), CTMFormsManager (batch 3)
  - AdminHub (×2), ClientFormsPane (batch 4)
  - ItemDrawer, EditAutomationDialog, TwilioManager (×4) (batch 5)
  - useItemUpdates, WorkloadPane (batch 6)
- 2026-05-19: **clientLabel() frontend sweep EFFECTIVELY COMPLETE** — 6 remaining sites all non-sweepable (aliased columns, reversed fallbacks, decommissioned code)
- 2026-05-19: ActiveClients.jsx loadProfile() — added missing error toast
- 2026-05-20: **server/services/hubUtils.js** — extracted `logEvent` + `resolveBaseUrl` from hub.js. Hub.js imports these; enables clean per-domain extraction going forward.
- 2026-05-20: **server/routes/blogPosts.js** — extracted 8 blog routes (~296 lines) + 2 private helpers from hub.js. Also removed `generateAiResponse` + `generateImagenImage` imports from hub.js (no longer needed there).
- 2026-05-20: **server/routes/twilioConfig.js** — extracted 9 Twilio config routes (~280 lines) from hub.js. All Twilio service imports removed from hub.js.
- 2026-05-20: **server/routes/onboardingPdfRoutes.js** — extracted 2 PDF regen routes (~87 lines) from hub.js. Removed `generateClientOnboardingPdf` + `getOnboardingPayloadForUser` imports.
- 2026-05-20: **hub.js: 12,657 → 11,833 lines (-824 lines this run)**

## Blocked / Needs Human Review

- **auth.js + notifications.js name reconstruction** — `formatUserName(user, 'there')` changes behavior: introduces email as intermediate fallback (produces `user@example.com` as salutation name when user has email but no first/last). Original code uses only `'there'` for that case. Human must decide: is the email fallback acceptable in email subjects/salutations, or should these stay inline?
- **AdminHub.jsx line 636 + ClientView.jsx line 93** — `isPlaceholderEmail` pattern: the `(isPlaceholderEmail(c.email) ? 'New Client' : c.email)` fallback has no equivalent in `clientLabel()`. Could extend the hook with a placeholder-email guard, but that's a behavior change. Needs human decision.
- **AdminHub.jsx line 992** — delete confirmation uses `email || name` (reversed from canonical). Intentional for identification; leave as-is unless explicitly overridden.
- **onboardingPdf.js:74 + templateVariables.js:63** — `formatUserName` sweep blocked: both have same email-fallback behavior-change risk as auth.js/notifications.js. If first_name+last_name is blank, `formatUserName` falls through to email; original code produces empty string (shows '—' in PDF; empty in template). Not safe to swap without human decision.

## Known Duplications (Active Audit Backlog)

- Pattern: `archived_at IS NULL` inline SQL — 10 remaining, ALL INTENTIONAL:
  - `tasks.js` (7): `($N::boolean OR archived_at IS NULL)` admin-bypass pattern — different semantic, do not replace
  - `ctm.js:1919`: `(cj.archived_at IS NULL OR cj.archived_at > NOW())` compound clause — not a soft-delete predicate
  - `hub.js` (line ~8000-ish in new numbering): dynamic ternary `IS NOT NULL` / `IS NULL` — ternary format required
  - `formFlow.js:9`: comment only

- Pattern: `revoked_at IS NULL` inline SQL — **0 remaining** ✓

- Pattern: `[first_name, last_name].filter(Boolean).join(' ')` JS reconstruction
  - Remaining frontend sites: 6 non-sweepable (see Completed above)
    - `EmailLogsSection.jsx:754,767` — aliased columns (triggered_by_first_name, client_first_name)
    - `AdminHub.jsx:636` — `isPlaceholderEmail` guard in same expression (BLOCKED)
    - `AdminHub.jsx:992` — reversed fallback `email || name` (intentional)
    - `FormsPane.jsx:74,343` — decommissioned code
  - **FRONTEND SWEEP EFFECTIVELY COMPLETE ✓**
  - Backend: `formatUserName` sweep — all remaining sites BLOCKED (email-fallback concern)

## Architecture Decisions

- 2026-05-14: Conditional `($N::boolean OR archived_at IS NULL)` admin-bypass patterns NOT replaced by `activeOnly()` — different semantic
- 2026-05-14: `formatClientLabel` falls through to email (PHI) — do NOT use in external-API / AI-forwarded paths
- 2026-05-15: `formatUserName(user, 'there')` introduces email fallback not present in auth.js/notifications.js originals — do NOT replace without human sign-off
- 2026-05-15: `clientLabel(c) || 'Client'` is safe for setActingClient displayName (adds client_identifier_value lookup as improvement)
- 2026-05-18: `clientLabel(row) || 'Unnamed'` safe for table display (staff members) — email fallback before 'Unnamed' is UX improvement
- 2026-05-18: AiTestRunPanel.jsx + AiAudiencePicker.jsx — do NOT use clientLabel/formatClientLabel here; these forward data to AI/external
- 2026-05-19: SiteClientLinks.jsx has intentional composite `primary — personName` label logic; do NOT replace with plain clientLabel
- 2026-05-19: FormsPane.jsx (decommissioned) — do not invest refactoring time; tag for eventual deletion
- 2026-05-20: hub.js extraction pattern — each new router mounts at /api/hub in index.js; Express falls through to hubRouter for routes not claimed by specialized routers. `router.use(requireAuth)` must be at the top of each extracted router file.
- 2026-05-20: `logEvent` uses `console.log` which is nulled in production — this is pre-existing behavior preserved verbatim. Pre-existing `console.log` in Twilio routes (phone number logging) also preserved; forwardTo phone number exposure is a pre-existing issue, not introduced by refactor.
