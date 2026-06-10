# Refactor Log (append-only)

---

## Run 2026-05-20 (cost: ~$1.40, duration: ~60m)

- Branch: claude/loving-sagan-tiYFt @ 13e425e
- Targets attempted: hub.js decomposition (Phase 5 started)
  - Unit 1: Extract `logEvent` + `resolveBaseUrl` → `server/services/hubUtils.js`
  - Unit 2: Extract 8 blog routes + 2 helpers → `server/routes/blogPosts.js`
  - Unit 3: Extract 9 Twilio config routes → `server/routes/twilioConfig.js`
  - Unit 4: Extract 2 PDF regen routes → `server/routes/onboardingPdfRoutes.js`
- Helpers created: `server/services/hubUtils.js` (logEvent, resolveBaseUrl)
- New route files: blogPosts.js, twilioConfig.js, onboardingPdfRoutes.js
- Call sites swept: N/A (structural refactor, not call-site sweep)
- LOC delta: hub.js -824 lines; codebase net +76 (new files + imports)
  - hub.js: 12,657 → 11,833 lines
- Files touched: 6 (hub.js, index.js, hubUtils.js, blogPosts.js, twilioConfig.js, onboardingPdfRoutes.js) + 2 state files
- Verifications: yarn build [skipped — no node_modules], yarn lint [skipped], node --check [✓ all 6 server files], DB smoke [skipped — no SQL changes]
- Compliance checks run:
  - No PHI in logs/errors: ✓ (blogPosts.js logs only userId/id UUIDs + error messages; pre-existing `console.log` phone number in Twilio routes preserved as-is)
  - All queries parameterized: ✓ (hub.js dynamic UPDATE builds only from column-name literals, not user input)
  - No new email/phone fields to AI/external: ✓ (blog AI routes forward only business-context + content, same as before)
  - Server-side auth checks preserved: ✓ (`router.use(requireAuth)` applied in all 3 new routers)
  - Audit trail still written: ✓ (security events in twilioConfig.js preserved verbatim)
  - Data retention semantics: ✓ (no soft-delete logic touched)
- Commits:
  - a30f05f refactor(hub): extract logEvent + resolveBaseUrl to server/services/hubUtils.js
  - 71111ae refactor(hub): extract blog post routes to server/routes/blogPosts.js
  - 3aaa4d4 refactor(hub): extract Twilio config routes to server/routes/twilioConfig.js
  - 13e425e refactor(hub): extract onboarding PDF regen routes to onboardingPdfRoutes.js
- PR: branch pushed; PR to be created as Ready for Review
- Blocked items added:
  - onboardingPdf.js:74 + templateVariables.js:63 formatUserName sites — same email-fallback risk as auth.js. Added to Blocked.
- Next session should:
  1. Extract Client Team Management routes from hub.js (~840 lines, lines 10993-11833) — HIGHEST remaining hub.js ROI but complex (tokens, emails, invites). Audit imports first: `hashToken`, `maskEmail`, `sendMailgunMessage`, `sendMailgunMessageWithLogging`, `createNotification`, `notifyAdminsByEmail`, `logUserActivity`, `logClientActivity`, `logDocumentActivity`, `fetchActivityLogs`, `ActivityEventTypes`, `ActivityCategories`, `logSecurityEvent`, `SecurityEventTypes`, `SecurityEventCategories`, `encrypt`, `decrypt`, `isEncrypted`. Most of these are used elsewhere in hub.js so imports stay; only the route code moves.
  2. Extract OAuth Providers CRUD (9529-9620, ~90 lines) — smallest clean OAuth chunk to extract before tackling full OAuth section.
  3. Resolve blocked items: human decision on email-fallback in formatUserName, isPlaceholderEmail extension.

---

## Run 2026-05-19 (cost: ~$1.20, duration: ~50m)

- Branch: refactor/component-system (pushed as claude/loving-sagan-bzpDF) @ 2479082
- Targets attempted: revoked_at sweep (6 files, 13 sites), archived_at sweep (10 files, 16 sites), frontend clientLabel adoption (3 files, 4 sites), silent toast audit + fixes (4 files, 7 catch blocks)
- Helpers created / extended: none (pre-existing helpers adopted by new import sites)
- Call sites swept: 13 revoked_at + 16 archived_at + 4 clientLabel + 7 toast fixes = 40 sites
- LOC delta: -29 net (70 insertions, 41 deletions; imports add lines, each replacement is slightly shorter)
- Files touched: 24 server + frontend files + 2 state files
- Verifications: yarn build [skipped — network-restricted env, no node_modules], yarn lint [skipped — same], node --check [✓ all 14 changed .js server files], DB smoke [skipped], JSX syntax checked by careful reading
- Compliance checks run:
  - No PHI in logs/errors: ✓ (SQL predicate helpers only; toast messages contain no user data)
  - All queries parameterized: ✓ (no parameter changes; helpers output identical SQL fragments)
  - No new email/phone fields to AI/external: ✓ (pure refactor; AI-forwarded paths explicitly skipped)
  - Server-side auth checks preserved: ✓ (revoked_at/archived_at still enforced via helpers)
  - Audit trail still written: ✓ (no audit paths touched)
  - Data retention semantics: ✓ (soft-delete columns still enforced; helper output identical)
- Commits:
  - a12c0ab refactor(sql-helpers): sweep notRevoked() into clientInvite, socialMediaTokens, onboardingReminders, gsc (9 sites)
  - d040a81 refactor(sql-helpers): sweep notRevoked() into reviews service + routes (4 sites)
  - 515d6f4 refactor(sql-helpers): sweep activeOnly() into socialClientLinkSync, metaPagePosting, social, analytics (8 sites)
  - af65686 refactor(sql-helpers): sweep activeOnly() into journeyEmailScheduler, taskRecurrence, dataPackage, ops skills (5 sites)
  - f6a9fa8 refactor(sql-helpers): sweep activeOnly() into hub.js + operations.js remaining inline sites (3 sites)
  - 09d0261 refactor(frontend): adopt clientLabel() for user name display in TeamTab, ClientGroupAccessPanel, TeamManagement (4 sites)
  - 62e63cd fix(toast): add error toasts for silent catch blocks in ReviewsPanel (4 sites) + SharedDocuments drag-reorder
  - 2479082 fix(toast): add error toasts for silent background-load failures in InsightsCard + EmailLogsSection
- PR: #77 Ready for Review — https://github.com/joelhmartin/Anchor-Client-Dashboard/pull/77
- Blocked items added: none new (existing blocks unchanged)
- Next session should:
  1. Resolve blocked items: auth.js/notifications.js email-fallback in salutations; AdminHub isPlaceholderEmail extension
  2. Sweep remaining frontend name patterns: FilterBar, WorkloadWidget, BoardTable, ProfileSettings, ProfileTab, ClientOnboarding (6 files, 7 sites — skip AI paths)
  3. Complete silent toast audit: ActiveClients.jsx loadProfile, BuilderPane autosave
  4. Begin Phase 2 backend JS reconstruction sweep (formatUserName in server/services/)
  5. Begin Phase 4: hub.js splitting sub-plan (blog routes first, ~400 LOC)

---

## Run 2026-05-14 (cost: ~$1, duration: ~60m)

- Branch: claude/practical-hopper-tqmVL @ 26559fd
- Targets attempted: Discovery, groupAnalytics.js dedup, tasks.js archived_at sweep, tokens/deviceFingerprint/clientTeam/onboarding revoked_at sweep
- Helpers created / extended: none (pre-existing helpers adopted by new import sites)
- Call sites swept: 48 (28 archived_at in tasks.js + 12 revoked_at in tokens/deviceFingerprint/clientTeam + 4 revoked_at in onboarding) + 2 private helper duplicates removed (groupAnalytics.js)
- LOC delta (code only): approximately −11 (groupAnalytics private fn removal) + wash (tasks.js) + minor import additions ≈ net −5 code lines + 216 plan/state files
- Files touched: 9 (3 state files + 6 server files)
- Verifications: yarn build [✗ — no node_modules, network-restricted env], yarn lint [✗ — same reason], node --check [✓ all 6 changed server files], DB smoke [skipped]
- Compliance checks run:
  - No PHI in logs/errors: ✓ (changes are SQL predicate helpers only)
  - All queries parameterized: ✓ (no parameter changes, only predicate fragments)
  - No new email/phone fields to AI/external: ✓ (groupAnalytics.js data stays internal)
  - Server-side auth checks preserved: ✓ (revoked_at helpers produce identical SQL)
  - Audit trail still written: ✓ (no audit-trail paths touched)
  - Data retention semantics: ✓ (soft-delete columns still checked)
- Commits:
  - 899e849 chore(refactor): initialize refactor plan and state
  - 92efd1a refactor(analytics): replace private clientLabel/clientName with shared helpers
  - 5d8b269 refactor(sql-helpers): sweep activeOnly() into tasks.js (28 call sites)
  - 61ded8f refactor(sql-helpers): sweep notRevoked() into tokens.js, deviceFingerprint.js, clientTeam.js
  - 26559fd refactor(sql-helpers): sweep notRevoked() into onboarding.js (4 sites)
- PR: TBD (to be created as Draft)
- Blocked items added: none
- Next session should:
  1. Sweep hub.js revoked_at IS NULL (23 sites) — highest remaining LOC impact
  2. Sweep hub.js + taskAutomations.js + ruleEngine.js archived_at IS NULL
  3. Sweep auth.js + notifications.js name reconstruction → formatUserName(row, 'there')
  4. ClientView.jsx + AdminHub.jsx clientLabel adoption (frontend)

---

## Run 2026-05-15 (cost: ~$0.80, duration: ~45m)

- Branch: refactor/component-system @ c35396b
- Targets attempted: hub.js revoked_at sweep, hub.js archived_at sweep, taskAutomations.js archived_at sweep, ruleEngine.js archived_at sweep, auth.js name reconstruction (attempted, reverted), brand colors (2 files), clientLabel adoption (AdminHub + ClientView)
- Helpers created / extended: none (pre-existing helpers adopted by new import sites)
- Call sites swept: 23 revoked_at in hub.js + 12 archived_at in hub.js + 5 archived_at in taskAutomations.js + 5 archived_at in ruleEngine.js + 2 brand color inline values + 2 clientLabel setActingClient sites = 49 sites
- LOC delta: -4 net (replacements wash; two displayName lines shortened; import lines added)
- Files touched: 7 (server/routes/hub.js, server/services/taskAutomations.js, server/services/ruleEngine.js, src/views/admin/AdminHub.jsx, src/views/admin/ClientView.jsx, src/views/admin/AnalyticsDashboard/AdPerformanceChart.jsx, src/ui-component/extended/FacebookPostPreview.jsx) + 2 state files
- Verifications: yarn build [✗ — no node_modules, network-restricted env], yarn lint [✗ — same reason], node --check [✓ all changed .js server files; .jsx cannot be checked], DB smoke [skipped]
- Compliance checks run:
  - No PHI in logs/errors: ✓ (SQL predicate helpers only; no data handling)
  - All queries parameterized: ✓ (no parameter changes; identical SQL output from helpers)
  - No new email/phone fields to AI/external: ✓ (pure refactor)
  - Server-side auth checks preserved: ✓
  - Audit trail still written: ✓ (no audit paths touched)
  - Data retention semantics: ✓ (soft-delete columns still enforced)
- Commits:
  - f8a4d5e refactor(sql-helpers): sweep notRevoked/activeOnly into hub.js, taskAutomations.js, ruleEngine.js + brand colors
  - c35396b refactor(frontend): adopt clientLabel() for setActingClient displayName in AdminHub + ClientView
- PR: #74 Draft — https://github.com/joelhmartin/Anchor-Client-Dashboard/pull/74
- Blocked items added:
  - auth.js + notifications.js name reconstruction: formatUserName introduces email fallback not present in originals (behavior change in salutation edge case)
  - AdminHub.jsx / ClientView.jsx isPlaceholderEmail sites: incompatible with clientLabel()
- Next session should:
  1. Resolve blocked items with human: accept email-fallback in salutations? extend clientLabel with placeholder-email guard?
  2. Sweep remaining archived_at IS NULL in routes not yet touched (ctmForms.js, reviews.js, social.js, analytics/*.js)
  3. Sweep remaining revoked_at IS NULL in any unswept files (check ctmForms.js, auth.js)
  4. Begin Phase 2 JS-reconstruction sweep (TeamTab.jsx staff names)
  5. Silent toast audit (Phase 3)

---

## Run 2026-05-19 (cost: ~$1.20, duration: ~50m)

- Branch: claude/loving-sagan-nn3UR @ 03a926d
- Targets attempted: Phase 3 frontend clientLabel() sweep (all remaining viable sites), ActiveClients toast audit
- Helpers created / extended: none (existing clientLabel() from hooks/useClientLabel adopted by new import sites)
- Call sites swept: 26 frontend name reconstruction sites + 1 toast fix = 27 total
- LOC delta: ~-28 (redundant || email chains removed; name+label → label simplifications; each import adds +1)
- Files touched: 16 frontend files + 2 state files
- Verifications: yarn build [✗ — no node_modules, network-restricted env], yarn lint [✗ — same reason], node --check [partial — sweep includes 1 .js file (useItemUpdates.js); rest are .jsx and not checkable without build], DB smoke [skipped — no server changes]
- Compliance checks run:
  - No PHI in logs/errors: ✓ (display-only changes; clientLabel() falls through to email but only for UI display, not logging/external APIs)
  - All queries parameterized: ✓ (no SQL changes this run)
  - No new email/phone fields to AI/external: ✓ (skipped AiTestRunPanel/AiAudiencePicker explicitly)
  - Server-side auth checks preserved: ✓ (no server files changed)
  - Audit trail still written: ✓ (no audit paths touched)
  - Data retention semantics: ✓ (no data handling changed)
- Commits:
  - 7b2a2fe refactor(frontend): sweep clientLabel() into 7 name-reconstruction sites + ActiveClients toast
  - ba4024e refactor(frontend): sweep clientLabel() into task/ctm-forms name patterns (5 files, 7 sites)
  - 21d390d refactor(frontend): sweep clientLabel() into AdminHub + ClientFormsPane (3 sites)
  - 69fd947 refactor(frontend): sweep clientLabel() into BoardTable, ItemDrawer, EditAutomation, TwilioManager (9 sites)
  - 03a926d refactor(frontend): sweep clientLabel() into useItemUpdates hook + WorkloadPane (2 sites)
- PR: #81 Ready for Review — https://github.com/joelhmartin/Anchor-Client-Dashboard/pull/81
- Blocked items added: none new (existing blocks unchanged)
- Next session should:
  1. Begin Phase 4: hub.js file splitting — start with blog routes (~200 LOC), write sub-plan first
  2. Backend formatUserName sweep — 2 safe sites: onboardingPdf.js:74, templateVariables.js:63 (low ROI, batch together)
  3. Resolve blocked items if human provides decision: auth.js/notifications.js salutation email fallback; AdminHub isPlaceholderEmail extension
  4. Consider Phase 4 splits on ctmForms.js (1835 LOC) — analytics vs CRUD seam is clean
