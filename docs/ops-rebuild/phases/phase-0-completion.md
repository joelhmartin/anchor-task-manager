# Phase 0 — Stabilize: Completion Report

**Date:** 2026-05-05
**Specialist:** ops-stabilizer
**Branch:** main (all work landed directly per coordinator instruction)
**Sub-tickets shipped:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9 — defects D1, D2, D3, D4, D5, D6, D8, D9, D11

## Summary

Operations was running with multiple latent risks: Vertex safety thresholds set to BLOCK_NONE, no audit trail on agent-approved tool calls, no rate limiting on the assistant or exec endpoints, a substring-matched WP-CLI blocklist that could be evaded, a drift baseline that silently rolled forward, an arbitrary-URL fetch with no SSRF guard, a stub `divi_safe_update` tool polluting Vertex's tool-planning, silent context truncation, and a UI shell mounting Analytics-owned views as top-level Operations tabs.

This phase fixed all of those without introducing any new domain-model concepts (that's Phase 1).

## Changes by group

### Group A — opsAssistant safety/truncation (D1, D6, §2.8)

- `server/services/operations/opsAssistant.js:188-195` — safety thresholds changed from `BLOCK_NONE` to `BLOCK_MEDIUM_AND_ABOVE` for DANGEROUS_CONTENT and HARASSMENT, plus newly added thresholds for HATE_SPEECH and SEXUALLY_EXPLICIT.
- `server/services/operations/opsAssistant.js:99-128` (`buildContextText`) — when CLAUDE.md or scan_json is sliced past their limits, a `## Context truncation notice` block now appends to the system prompt with `[truncated: N bytes omitted]` so the AI is aware its context is incomplete.

### Group B — Approval audit (D11 / §2.1)

- `server/services/security/audit.js` — added `OPERATIONS_TOOL_PROPOSED`, `OPERATIONS_TOOL_APPROVED`, `OPERATIONS_TOOL_EXECUTED` event types and an `OPERATIONS` category. `deriveCategory` now maps `operations.*` to that category.
- `server/services/operations/opsAssistant.js` — added `canonicalJson` + `hashArgs` helpers (sorted-key SHA-256 of args). The assistant now writes:
  - `tool_proposed` when a mutating tool is paused for approval (line ~227).
  - `tool_approved` when an admin re-enters with `approveToolName` set, before execution (line ~167). Includes `proposedArgsHash`, `approvedArgsHash`, and `argsOverridden` so reviewers can see when the admin tweaked args (e.g. flipped `dry_run`).
  - `tool_executed` after the handler runs, with success/failure and `failureReason` (truncated to 200 chars).
- All three events use `eventCategory` (per CLAUDE.md gotcha) and include `tool`, `agentType`, `siteId`, `envId`, never raw arg values (only their hash).

### Group C — Rate limiting (D9 / §2.2)

- `server/services/security/rateLimit.js` — added `operations_assistant_user` (30 req / 5 min) and `operations_exec_user` (60 req / 5 min) to `RATE_LIMIT_CONFIG`. Per-user identifier (not per-IP) so admins are throttled individually.
- `server/routes/operations.js` — added `userRateLimit(limitType)` factory near the top of the file, applied to:
  - `POST /api/operations/assistant/chat`
  - `POST /api/operations/environments/:envId/exec`

  Returns HTTP 429 with `code: 'RATE_LIMIT_EXCEEDED'` and `retryAfter`.

### Group D — WP-CLI tokenized blocklist (D2 / §2.3)

- `server/services/operations/agentTools.js` — replaced the substring-match list with `classifyWpcliRead()` which:
  - Tokenizes the command and strips flags.
  - Checks `pairOne`, `pairTwo`, `pairThree` (verb / verb+sub / verb+sub+subsub) against `WPCLI_HARD_DENY_PAIRS` first (e.g. `eval`, `eval-file`, `db query`, `site empty`, `db drop`, `db reset`, `db import`, `db export`, `shell`).
  - Then matches against an explicit `WPCLI_READ_ONLY_VERBS` allowlist (`plugin list`, `option get`, `core check-update`, `cli`, etc.).
  - Fail-closed: anything not on the allowlist is refused.

### Group E — Drift baseline (D3 / §2.4)

- New migration `server/sql/migrate_ops_phase0_drift_baseline.sql`:
  - `ALTER TABLE kinsta_site_workspaces ADD COLUMN IF NOT EXISTS baseline_accepted_at TIMESTAMPTZ`
  - `ALTER TABLE kinsta_site_workspaces ADD COLUMN IF NOT EXISTS baseline_accepted_by UUID`
  - Backfills `baseline_accepted_at = COALESCE(last_scan_at, NOW())` for any workspace already holding scan_json so the new no-rollover behavior doesn't re-flag every existing site.
  - Creates `kinsta_scan_history (id, workspace_site_id, scanned_at, baseline_snapshot, fresh_snapshot, diff_summary, created_at)` plus `idx_kinsta_scan_history_site` on `(workspace_site_id, scanned_at DESC)`.
- `server/index.js` — registered `maybeRunOpsPhase0DriftBaselineMigration()` in the migration chain after `maybeRunKinstaFindingsMigration`.
- `server/services/operations/driftScanner.js`:
  - `fetchBaseline()` now returns `{ scan, accepted_at }` instead of the raw scan blob.
  - `runDriftCheck()` rolls baseline forward only on the very first scan; subsequent scans only update `last_scan_at` / `last_scan_status`.
  - Every scan inserts a row into `kinsta_scan_history` with the baseline + fresh snapshots and a category-count diff summary (best-effort — failures are warned, not thrown).
  - New exported `acceptBaseline(siteId, { userId })` re-scans the live env and overwrites `scan_json`, stamps `baseline_accepted_at = NOW()` and `baseline_accepted_by = userId`.
- `server/routes/operations.js` — new endpoint `POST /api/operations/sites/:siteId/drift-baseline/accept` calls `acceptBaseline()`.

### Group F — Tracking-check always-on (D8 / §2.5)

- `server/services/operations/driftScanner.js:runDriftCheck` — the `includeTrackingCheck` parameter is gone; the tracking check always runs as part of drift.
- `server/services/operations/bulkRunner.js:drift_check.run` — no longer passes `includeTrackingCheck: true`.
- `server/routes/operations.js:/sites/:siteId/drift-check` — no longer reads `req.body?.include_tracking`.

### Group G — Remove stale `divi_safe_update` (D5 / §2.6)

- `server/services/operations/agentTools.js` — deleted the `divi_safe_update` tool definition and its registry entry. Replaced with a one-line comment marker referencing Phase 0 and noting it can return when the divi-safe mu-plugin actually ships.

### Group H — SSRF guards (D4 / §2.7)

- New file `server/services/security/ssrfGuard.js` — exports `assertPublicHttpUrl(url)` and `SsrfBlockedError`. Behavior:
  - Validates URL parses cleanly.
  - Refuses any scheme other than `http:` / `https:`.
  - If host is a literal IP, classifies directly; otherwise resolves via `dns.promises.lookup({ all: true })` and checks every returned address.
  - Blocks: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, 100.64/10, IPv6 `::1`, `::`, `fc00::/7` (fc/fd), `fe80::/10` (fe8–feb), and IPv4-mapped IPv6 addresses.
- `server/services/operations/agentTools.js:verify_tracking_install.handler` — wraps `fetchUrl(homeUrl)` with `assertPublicHttpUrl(homeUrl)` and surfaces a clean `Refused to fetch ...` error on `SsrfBlockedError`.

### Group I — UI excision (§2.9)

- `src/views/admin/OperationsWorkspace/index.jsx` — full rewrite. Was 1220 lines; now **75 lines**. Renders only the Sites and Bulk tabs. `PortfolioPanel`, `OperationsAssistantPanel`, the Client Detail panel, and the imports of `AuditsTab` / `fetchAuditRuns` / `fetchAuditSchedules` / etc. are removed.
- `docs/superpowers/plans/2026-04-29-kinsta-operations.md` — added a 2026-05-05 update note at the top recording the excision.
- Verified `AuditsTab.jsx` still imports `fetchAuditRuns` / `fetchAuditSchedules` from `api/analytics.js` directly, so it continues to work as the canonical Analytics-side surface.

## Validation

- `yarn build` — succeeds (final bundle output preserved; chunk sizes unchanged outside Operations).
- `yarn lint` — produces only the pre-existing 5026 warnings/errors that were already present on `main`. Filtering by my changed files surfaces zero new errors. Many warnings in the codebase are prettier formatting rules untouched by this work.
- No DB writes performed in this session; migration is idempotent and runs on next server boot.

## Decisions made en route

- **Rate-limit identifier**: chose user id over IP. Operations is admin-only, so per-IP limits would punish a whole office network sharing one egress NAT.
- **Args hash canonicalization**: sorted-key SHA-256 of JSON, computed in-process (no extra dep). Good enough for "did the admin override the AI's proposed args?" detection without persisting the raw values, which keeps PHI risk low.
- **Drift backfill**: existing workspaces with scan_json are treated as already-accepted. Without this, the first scan after deploy would silently *not* roll the baseline and admins would see persistent drift findings against a stale snapshot.
- **WP-CLI allowlist scope**: kept narrowly read-only. Things like `wp search-replace --dry-run` are *not* on the list — they should go through a future explicit mutating tool with approval, not the read endpoint with a flag.

## Punted / follow-ups

- The `kinsta_scan_history` table is written but no UI consumes it yet. Phase 1 / 9 will need a "scan history" view per site.
- `acceptBaseline` route exists but no UI button hooks into it yet — admins can hit it with curl in the meantime. UI button is Phase 9 work.
- Vertex tool-decl list is now smaller (no `divi_safe_update`); no caching layer to invalidate.
- The `WPCLI_READ_ONLY_VERBS` allowlist is conservative — admins may report legitimate read commands that get refused. Plan is to add to the allowlist as those reports come in rather than relax the matching logic.
- Rate-limit retry-after returned to UI but no existing toast wiring yet — admins will see the raw 429 message until the UI is updated.

## Files touched (summary)

| File | Status | Purpose |
|------|--------|---------|
| `server/services/operations/opsAssistant.js` | modified | safety thresholds, truncation surfacing, approval audit |
| `server/services/operations/agentTools.js` | modified | tokenized WP-CLI parser, SSRF guard, removed `divi_safe_update` |
| `server/services/operations/driftScanner.js` | modified | versioned baseline, scan history, `acceptBaseline()` |
| `server/services/operations/bulkRunner.js` | modified | dropped `includeTrackingCheck` flag |
| `server/routes/operations.js` | modified | rate-limit middleware, accept-baseline route, dropped `include_tracking` |
| `server/services/security/audit.js` | modified | new `operations.*` event types + `OPERATIONS` category |
| `server/services/security/rateLimit.js` | modified | new `operations_assistant_user` + `operations_exec_user` configs |
| `server/services/security/ssrfGuard.js` | new | reusable SSRF guard |
| `server/sql/migrate_ops_phase0_drift_baseline.sql` | new | `baseline_accepted_at`, `kinsta_scan_history` |
| `server/index.js` | modified | registered new migration in chain |
| `src/views/admin/OperationsWorkspace/index.jsx` | rewritten | excised Portfolio / Client / Assistant tabs |
| `docs/superpowers/plans/2026-04-29-kinsta-operations.md` | modified | excision note |
| `docs/ops-rebuild/STATE.md` | modified | Phase 0 marked shipped, Phase 1 set active |
