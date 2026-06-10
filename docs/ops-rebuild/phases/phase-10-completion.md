# Phase 10 — Decommission + cleanup (shipped 2026-05-05)

**Specialist:** ops-decom-engineer
**Branch:** `main`
**Commits:** seven (C1–C7), each pushed independently.

## Mandate

Plan §12 of `docs/superpowers/plans/2026-05-05-operations-rebuild-plan.md`:
fold the legacy assistant + Kinsta scope under the unified `services/ops/`
tree, deprecate the legacy /api/operations/findings surface, mark
`audit_runs` / `audit_schedules` as kept-separate, and refresh
documentation. No functional changes.

## Commits

| # | Subject | Notes |
|---|---|---|
| C1 | `chore(ops-decom): delete opsAssistant + agentPrompts shims` | Legacy assistant gone. SiteAssistant.jsx replaced with a forwarding notice. `agentTools.js` kept (live importers in bulkRunner + driftScanner) but marked `@deprecated`. |
| C2 | `chore(ops-decom): rename OperationsWorkspace -> Operations (frontend)` | `git mv` of all sub-folders into `src/views/admin/Operations/`. Component renamed. MainRoutes loader updated. |
| C3 | `chore(ops-decom): rename services/operations -> services/ops/operations-website` | 8 files moved. Relative imports fixed (`../../db.js → ../../../db.js`, `../security/ → ../../security/`). External importers updated: `routes/operations.js`, `ws/operationsTerminal.js`, `agents/subAgents/websiteTools.js`. |
| C4 | `chore(ops-decom): deprecate /api/operations/findings + audit_runs marker` | New `migrate_ops_audit_runs_deprecation_marker.sql` (idempotent, gated via `to_regclass`). Registered in `server/index.js` after `maybeRunOpsMonthlyCap`. `deprecateLegacyFindings` middleware adds `Deprecation: true` + `Link: rel=successor-version` to `/findings`, `/findings/counts`, `/sites/:id/findings`. |
| C5 | `docs(ops-decom): add OPERATIONS.md authoritative architecture doc` | New `docs/OPERATIONS.md` (~250 lines). Old `2026-04-29-kinsta-operations.md` archived as `.archived.md`; replaced with a 5-line DONE stub. |
| C6 | `docs(ops-decom): refresh INTEGRATIONS, SECURITY, CLAUDE for new ops surface` | INTEGRATIONS.md gains SEMrush/GSC/PSI/WPVuln. SECURITY.md gains an "Operations approval audit + credential storage" section. CLAUDE.md route table + Where-to-look table + new gotcha #16. |
| C7 | `docs(ops-rebuild): mark Phase 10 shipped — rebuild complete` | This doc + STATE.md update. |

## Files added

- `docs/OPERATIONS.md`
- `docs/superpowers/plans/2026-04-29-kinsta-operations.archived.md` (rename of the old plan)
- `docs/ops-rebuild/phases/phase-10-completion.md` (this file)
- `server/sql/migrate_ops_audit_runs_deprecation_marker.sql`

## Files removed

- `server/services/operations/opsAssistant.js`
- `server/services/operations/agentPrompts.js`
- (folder) `server/services/operations/` — empty after migration

## Files renamed (history preserved via `git mv`)

Frontend:
- `src/views/admin/OperationsWorkspace/index.jsx` → `src/views/admin/Operations/index.jsx`
- `src/views/admin/OperationsWorkspace/{Bulk,Clients,Cost,Findings,Overview,Schedule,Sites}/` →
  `src/views/admin/Operations/{Bulk,Clients,Cost,Findings,Overview,Schedule,Sites}/`

Backend:
- `server/services/operations/{agentTools,bulkRunner,claudeMdMerge,claudeMdTemplate,driftScanner,kinstaApi,siteScanner,sshClient}.js`
  → `server/services/ops/operations-website/<same>.js`

Plan archive:
- `docs/superpowers/plans/2026-04-29-kinsta-operations.md` → `.archived.md`,
  with a fresh DONE stub at the original path.

## Files modified

- `server/routes/operations.js` — drop `runAssistantTurn` import, replace `/assistant/chat` body with a 410 Gone, swap all `services/operations/...` paths to `services/ops/operations-website/...`, add `deprecateLegacyFindings` middleware on the `/findings*` endpoints.
- `server/ws/operationsTerminal.js` — fix sshClient import path.
- `server/services/ops/agents/subAgents/websiteTools.js` — fix sshClient import path + comment text.
- `server/services/ops/operations-website/agentTools.js` — `@deprecated` JSDoc header (kept alive for `bulkRunner.js` + `driftScanner.js` `getTool()` callers); fix relative imports (`../../db.js`, `../security/...`).
- `server/services/ops/operations-website/{bulkRunner,driftScanner,siteScanner,sshClient}.js` — fix relative imports.
- `server/index.js` — add + register `maybeRunOpsAuditRunsDeprecationMarkerMigration` after the monthly-cap migration.
- `src/api/operations.js` — remove `opsAssistantChat` (the legacy endpoint is gone).
- `src/views/admin/Operations/Sites/SiteAssistant.jsx` — replace the legacy chat with a single forwarding notice that links to the new AI Chat tab. SiteDrawer panel kept so deep links keep resolving.
- `src/views/admin/Operations/index.jsx` — rename component, normalize relative imports from `../Operations/...` to `./...`, refresh header comment.
- `src/routes/MainRoutes.jsx` — `Operations` instead of `OperationsWorkspace`.
- `docs/INTEGRATIONS.md`, `docs/SECURITY.md`, `CLAUDE.md` — see C6 commit.
- `docs/ops-rebuild/STATE.md` — mark Phase 10 shipped, set active phase to `—`, add 🎉 rebuild-complete marker.

## Decisions

- **Kept `agentTools.js` alive.** Live importers in `bulkRunner.js` and
  `driftScanner.js` use `getTool('verify_tracking_install')` and
  `getTool('wpcli_read')`. Refactoring those callers to point at the new
  Phase-7 `subAgents/websiteTools.js` handlers is mechanical but out of
  scope for the cleanup phase. Deferred as a follow-up.
- **Audit runs not migrated.** Per P6 of the rebuild, `audit_runs` and
  `audit_schedules` stay separate from `ops_runs`. Phase 10 only
  attaches deprecation `COMMENT` strings (gated via `to_regclass` so a
  fresh DB without the analytics audits migration doesn't error).
- **Legacy findings table not removed.** `kinsta_findings` is still
  written by `web.kinsta.drift` (the Phase-3 wrapper around the legacy
  drift scanner), and Phase 1's `kinsta_findings_compat` view keeps
  reads working. Only the `/api/operations/findings*` endpoints are
  marked deprecated; new callers should go through `/api/ops/findings`.
- **`/api/operations/assistant/chat` returns 410 Gone** rather than a
  shim. Callers should migrate to `/api/ops/chat`. The Site drawer's
  inline chat panel was the only remaining UI consumer; replaced with a
  forwarding notice.
- **Folder rename uses `git mv`** so blame/history is preserved file by
  file. No re-export shims at the old paths — every importer was
  updated in the same commit.

## Validation

- `yarn build` — clean (`✓ built in 11.97s`).
- `yarn lint` — 128 errors / 4954 warnings; same baseline as Phases 7–9
  (preexisting prettier warnings + a handful of legacy errors). No new
  errors traceable to Phase 10 files.
- `yarn test:ops` — 11/11 pass after the rename.
- `grep -rn "OperationsWorkspace" src/ server/` — only one match (a
  comment string inside `Operations/index.jsx` that explicitly notes
  the rename for blame readers).
- `grep -rn "services/operations" src/ server/` — no matches outside
  the new `services/ops/operations-website/` tree.

## Compliance posture

- No PHI handling changes. The HIPAA gate on the Meta sub-agent / Meta
  checks (Phase 5) and the tracking relay (legacy) is preserved.
- The approval audit chain (Phase 7 — `tool_proposed → approved →
  executed`, or `rejected`) is preserved verbatim. SECURITY.md now
  documents it explicitly.
- AES-256 credential storage for `client_platform_credentials` is
  preserved. SECURITY.md now documents it.
- SSRF guard, WP-CLI tokenized allowlist, per-user rate limiters all
  unchanged.
- The legacy `/api/operations/assistant/chat` route still hits the
  rate limiter before returning 410, so the limiter contract is
  preserved for any clients still issuing those requests.

## Follow-ups punted

- **Refactor `bulkRunner.js` + `driftScanner.js` off `agentTools.js`.**
  Migrate the two `getTool()` callers to the new sub-agent tool module
  exports, then delete `agentTools.js`. Tracked as a future cleanup
  ticket.
- **Inline `check_set` builder UI** on the Schedule tab (currently a
  raw JSON textarea — Phase 9 carry-over, not Phase 10 scope).
- **Per-platform credential validators** (Phase 1 endpoint accepts
  `{ok, error}` only; the Validate button manually marks OK).
- **`umbrella` filter** on `GET /api/ops/findings`. Currently filters
  by `client_user_id`, `severity`, `category`, `open`. Add `umbrella`
  as a first-class filter so the deprecation header pointing at
  `/api/ops/findings` can become an explicit `?umbrella=website`
  redirect rather than a soft Link header.

## How to verify post-merge

```bash
# Builds + tests + smoke
yarn build
yarn lint
yarn test:ops

# Confirm the legacy assistant returns 410:
curl -i -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' http://localhost:4000/api/operations/assistant/chat
# expect: HTTP/1.1 410 Gone, Deprecation: true,
#         Link: </api/ops/chat>; rel="successor-version"

# Confirm /api/operations/findings advertises its successor:
curl -is -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/operations/findings | head
# expect: 200 OK, Deprecation: true,
#         Link: </api/ops/findings>; rel="successor-version"

# Confirm the audit_runs comment migration ran (Postgres):
psql $DATABASE_URL -c "SELECT obj_description('audit_runs'::regclass);"
# expect: "Legacy analytics audit runs — kept separate from ops_runs ..."
```

🎉 **Operations rebuild complete.** All 11 phases (0–10) shipped on 2026-05-05.
