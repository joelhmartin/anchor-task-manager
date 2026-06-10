# Phase 9 — UI rebuild (completion)

**Date:** 2026-05-05
**Specialist:** ops-ui-engineer
**Branch:** main

## Scope

Built the Operations command-center IA per `docs/superpowers/plans/2026-05-05-operations-rebuild-plan.md` §11.
New tabs added alongside the Phase 0 / Phase 3 / Phase 7 surfaces; no folder
renames (Phase 10 owns the rename of `OperationsWorkspace/` → `Operations/`).

## Tab order (final)

`Overview · Runs · Findings · Clients · Sites · Bulk · Schedule · Cost · AI Chat`

Tabs are scrollable so the count fits cleanly on narrow viewports. New tabs are
lazy-loaded via `React.lazy` to keep the main bundle light (each is ~10 KB
gzipped except ClientsTab at ~3.7 KB gzipped).

## Files added

- `src/views/admin/OperationsWorkspace/Overview/OverviewTab.jsx` — KPI strip + 7-day inline-SVG trend
- `src/views/admin/OperationsWorkspace/Findings/FindingsTab.jsx` — cross-run feed with filters, ack/resolve, bulk-ack
- `src/views/admin/OperationsWorkspace/Clients/ClientsTab.jsx` — client list (left) + ClientOpsView (right)
- `src/views/admin/OperationsWorkspace/Clients/ClientOpsView.jsx` — latest runs + subscriptions editor + credentials health + Open Chat
- `src/views/admin/OperationsWorkspace/Schedule/ScheduleTab.jsx` — run definition CRUD with raw JSON `check_set` editor
- `src/views/admin/OperationsWorkspace/Cost/CostTab.jsx` — per-client MTD spend with cap chip, by-tier and by-subagent breakdowns, "Edit cap" dialog

## Files modified

- `src/views/admin/OperationsWorkspace/index.jsx` — full shell rewrite to host 9 tabs with lazy loading and cross-tab navigation (run id + client id via query params)
- `src/views/admin/Operations/Runs/RunsTab.jsx` — added Status / Tier / From / To filters, accepts `runIdToOpen` prop for cross-tab open
- `src/views/admin/Operations/Runs/RunDetail.jsx` — added Re-run button (POST `/runs` with same `client_user_id` + `run_definition_id`) and Report download (signed URL via `/runs/:id/report`)
- `src/views/admin/Operations/Chat/ClientChat.jsx` — accepts `initialClientUserId` prop so Clients tab "Open Chat" pre-selects the client
- `src/api/ops.js` — Phase 9 surface: `getOpsOverview`, `getOpsCostSummary`, `updateClientOpsCap`, `listClientOpsSubscriptions`, `updateClientOpsSubscriptions`, `listClientOpsCredentials`, `validateOpsCredential`, `deleteOpsCredential`, `createOpsRunDefinition`, `updateOpsRunDefinition`
- `server/routes/ops.js` — three new endpoints (see below)

## New backend endpoints

All admin-gated, parameterized queries, no PHI in payloads:

- `GET /api/ops/overview` — portfolio KPIs (`runs_last_7d`, `critical_findings_open`, `runs_throttled_mtd`, `active_subscribed_clients`, `mtd_cost_cents`) + 7-day trend rows (run count + finding severity counts).
- `GET /api/ops/cost-summary?month=YYYY-MM` — per-client MTD spend joining `ops_runs` with `client_profiles.ops_monthly_cap_cents` and reducing `token_usage_json.by_subagent` across rows. Falls back to `users` / `brand_assets` for client display name.
- `PUT /api/ops/clients/:clientUserId/cap` — updates `client_profiles.ops_monthly_cap_cents` (validated 0–100000).

Bulk findings ack: implemented client-side as a per-id loop in FindingsTab; backend bulk endpoint not added (loop is fine for the expected throughput).

## Cross-tab navigation contract

The shell consumes two query params:
- `?run=<uuid>` — sets `pendingRunId` and pushes Runs tab into RunDetail.
- `?clientUserId=<uuid>` — pre-selects a client in Clients or Chat tab.

`openRun(runId)` and `openChatForClient(clientUserId)` are passed down to
FindingsTab and ClientsTab respectively, so the user flow Findings → Run and
Clients → Chat are both single-click.

## Validation

- `yarn build` — clean (12.23s, all chunks emitted, lazy chunks visible: `OverviewTab`, `FindingsTab`, `ClientsTab`, `ScheduleTab`, `CostTab`).
- `yarn lint` — pre-existing warnings only. The pre-existing parse warning at `RunsTab.jsx:64` (numeric separator `60_000`) is unchanged. No new lint errors traceable to Phase 9 files.
- New tabs render without console errors when API returns empty arrays (each path has a graceful EmptyState).

## Known follow-ups (deferred to Phase 10 or v2)

- Folder rename `OperationsWorkspace/` → `Operations/` (Phase 10 owns).
- Inline `check_set` builder UI on Schedule (currently raw JSON textarea per spec).
- Per-platform credential validators (Phase 1 endpoint accepts `{ok, error}` only; Validate button manually marks OK).
- `email_on_completion` on subscriptions — column not in schema; left out of subscriptions editor.

## Conventions followed

- `src/`-rooted imports, no relative paths to shared components
- Toast on every state change (success + failure)
- No `window.alert/confirm/prompt` — `ConfirmDialog` for destructive credential delete
- Shared components used: `MainCard`, `SubCard`, `DataTable`, `StatusChip`, `EmptyState`, `LoadingButton`, `FormDialog`, `ConfirmDialog`, `SelectField`
- All backend queries parameterized; admin-gated; no PHI in payloads or logs
- Brand voice: "We've got you" tone (e.g. "Couldn't load overview", "Cap set to $X.XX")
