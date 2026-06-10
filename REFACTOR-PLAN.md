# Refactor Plan — Anchor Client Dashboard

Created: 2026-05-14
Branch: claude/practical-hopper-tqmVL

---

## Live Duplication Counts (as of 2026-05-14)

| Pattern | Count | Helper Available |
|---------|-------|-----------------|
| `archived_at IS NULL` (inline) | 80 | `activeOnly()` in queryHelpers.js |
| `revoked_at IS NULL` (inline) | 60 | `notRevoked()` in queryHelpers.js |
| `deleted_at IS NULL` (inline) | 2 | `notDeleted()` in queryHelpers.js |
| First+last name JS reconstruction | ~35 server, ~57 JSX | `formatUserName`/`formatClientLabel` (server), `clientLabel()` (frontend) |
| Private `clientLabel()` in groupAnalytics.js | 1 local copy | `formatClientLabel` in userFormatters.js |
| Private `clientName()` in groupAnalytics.js | 1 local copy | `formatUserName` in userFormatters.js |

## Helper Files (Already Exist)

- `server/services/queryHelpers.js` — `activeOnly`, `notRevoked`, `notDeleted`, `parsePagination`
- `server/services/clientLabel.js` — `clientLabelExpression`, `clientLabelSelect`, `clientLabelJoins`
- `server/services/userFormatters.js` — `formatUserName`, `formatClientLabel`
- `src/hooks/useClientLabel.js` — `clientLabel`, `useClientLabel`, `useClientLabels`

**Import note**: `queryHelpers.js` only imported in 1 file currently (`social.js`). All others are inline.

---

## Phase 1 — Backend SQL-Helper Sweeps (Highest ROI)

Target: eliminate inline `archived_at IS NULL` / `revoked_at IS NULL` by adopting `activeOnly()` / `notRevoked()`.

### 1a. `server/routes/tasks.js` — archived_at (35 sites, 1 file)
- ~29 pure `archived_at IS NULL` / `i.archived_at IS NULL` (replaceable)
- ~6 conditional `($N::boolean OR archived_at IS NULL)` — SKIP (admin-bypass semantic, not simple soft-delete)
- Est. LOC delta: −29 (wash — same chars but centralised)
- Risk: LOW — all in SQL strings, no behavior change

### 1b. `server/routes/hub.js` — revoked_at (23 sites, 1 file)
- Most appear with `consumed_at IS NULL AND revoked_at IS NULL` chains
- Can replace `revoked_at IS NULL` fragment only; `consumed_at IS NULL` stays inline
- Risk: LOW-MED — hub.js is 12k+ lines; each change must be verified individually

### 1c. `server/services/security/tokens.js` — revoked_at (7 sites, 1 file)
- Clean, mostly standalone predicates
- Risk: LOW

### 1d. `server/services/security/deviceFingerprint.js` — revoked_at (5 sites, 1 file)
- Risk: LOW

### 1e. `server/routes/clientTeam.js` — revoked_at (4 sites, 1 file)
- Risk: LOW

### 1f. `server/routes/onboarding.js` — revoked_at (4 sites, 1 file)
- Risk: LOW

---

## Phase 2 — Backend JS Reconstruction Dedup

### 2a. `server/services/analytics/groupAnalytics.js`
- Private `clientLabel()` fn (lines 237–248) duplicates `formatClientLabel`
- Private `clientName()` fn (line 169) duplicates `formatUserName`
- Replace both with imports from userFormatters.js
- Risk: VERY LOW — 1 file, no PHI leak (function is not forwarded to external services)

### 2b. `server/services/analytics/selectionResolver.js` — first+last reconstruction
- Similar reconstruction patterns, check for formatClientLabel suitability
- Risk: LOW

### 2c. `server/auth.js` — 2 sites of `[first, last].filter(Boolean).join(' ').trim() || 'there'`
- These have a specific `|| 'there'` fallback that formatUserName doesn't support natively
- Can use `formatUserName(user, 'there')` since formatUserName takes a fallback arg
- Risk: LOW

### 2d. `server/services/notifications.js` — name reconstruction for email salutation
- Similar `|| 'there'` pattern
- Risk: LOW

---

## Phase 3 — Frontend Shared-Component / Hook Adoption

### 3a. `src/views/admin/AdminHub.jsx` — 8 first+last patterns
- Mix of client-label and user-name patterns
- Some use `business_name ||` prefix (→ clientLabel hook)
- Some are staff names (→ formatUserName equivalent in JSX)
- Risk: MED — large file, test each context

### 3b. `src/views/admin/ClientView.jsx` — 2 client label patterns
- Already uses `c.business_name || first+last` — replace with `clientLabel(c)` from useClientLabel
- Risk: LOW

### 3c. `src/views/admin/AdminHub/TeamTab.jsx` — 3 patterns (staff names)
- Staff members displayed by name — `[first, last].filter(Boolean).join(' ') || 'Unnamed'`
- Risk: LOW

### 3d. Missing toast audit — silent catch blocks
- ~12 catch blocks with console.error but no toast
- Each needs `toast(message, 'error')` added
- Risk: LOW per site; audit all

### 3e. Brand colors
- `src/views/admin/AnalyticsDashboard/AdPerformanceChart.jsx` — `META_COLOR = '#1877F2'` → `BRAND_COLORS.META`
- `src/ui-component/extended/FacebookPostPreview.jsx` — `bgcolor: '#1877F2'` → `BRAND_COLORS.META`
- Risk: VERY LOW (2 files)

---

## Phase 4 — File Splits (600–2000 LOC files)

Each is a separate run — one domain group per session. Seams identified:

| File | LOC | Natural Seam |
|------|-----|-------------|
| `server/routes/ctmForms.js` | 1835 | analytics routes vs CRUD routes |
| `server/services/reviews.js` | 1848 | automation rules vs review fetch/respond |
| `server/services/oauthIntegration.js` | 1437 | per-provider adapters → separate service per provider |
| `src/views/client/ClientPortal/JourneyTab.jsx` | 1634 | phases list vs phase-detail panel |
| `src/views/ctm-forms/BuilderPane.jsx` | 1902 | field-type panels vs builder shell |
| `src/views/admin/AdminHub/OAuthIntegrationsTab.jsx` | 1687 | per-provider sections → subcomponents |

---

## Phase 5 — hub.js Decomposition (Multi-run, Needs Sub-Plan)

`server/routes/hub.js` is 12,428 lines. Candidate domain groups:
1. Blog routes (~200 lines) → `server/routes/hubBlog.js`
2. Twilio config routes (~150 lines) → `server/routes/hubTwilio.js`
3. Document routes (~200 lines) → `server/routes/hubDocuments.js`
4. OAuth integration delegations (already in oauthIntegration.js service) → thin router wrapper
5. Client profile CRUD (core, most sensitive, last)

Sub-plan required before starting. Do not begin without it.

---

## Architecture Decisions

- 2026-05-14: Sweep uses `activeOnly()` / `notRevoked()` from queryHelpers.js. These helpers return the raw SQL fragment (no table prefix if arg omitted). Callers must pass the table alias used in their query.
- 2026-05-14: `formatClientLabel()` fallback includes `email` — PHI. Do NOT use in paths that forward data to AI/external analytics. Those sites keep inline `business_name || client_identifier_value` only.
- 2026-05-14: Conditional `($N::boolean OR archived_at IS NULL)` patterns are NOT replaced — they carry admin-bypass semantics not representable by `activeOnly()`.
