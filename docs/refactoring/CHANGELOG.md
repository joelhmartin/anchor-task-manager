# Refactoring Changelog

Log of every change made by the refactoring system.

## 2026-03-05 — TM-015v2a Event Bus Subscribers + Rule Engine Stub (Session 22)

**Role:** Task Manager (Phase 2 execution)

### TM-015v2a: Wire Event Bus Subscribers to Rule Engine
- Created `server/services/ruleEngine.js` (~65 lines) — stub rule engine with `evaluateRules()` function
  - Delegates `status_change` and `assignee_added` to existing automation functions
  - New trigger types (10) are no-ops pending TM-015v2b
- Rewrote `server/services/taskEventSubscribers.js` — replaced direct automation calls with `TRIGGER_EVENT_MAP` pattern:
  - 12 trigger types mapped to event bus event types (e.g. `status_change` → `item.status_changed`)
  - All automation subscribers route through `evaluateRules()` instead of calling functions directly
  - Activity log subscribers (4) unchanged
  - Recursive prevention: `actor_type === 'automation'` events skipped

### Modified files
| File | Changes |
|------|---------|
| `server/services/ruleEngine.js` | **NEW** — stub rule engine delegating to existing automation functions |
| `server/services/taskEventSubscribers.js` | Rewrote to use TRIGGER_EVENT_MAP + ruleEngine routing |
| `docs/refactoring/PLAN.md` | TM-015v2a marked DONE |
| `docs/refactoring/STATE.md` | Updated session, task count |
| `docs/refactoring/CHANGELOG.md` | Added Session 22 entry |

---

## 2026-03-05 — TM-014 Event Bus Implementation (Session 21)

**Role:** Backend Specialist (Phase 2 execution)

### TM-014: Event Bus Architecture (L)
- Created `server/sql/task-events.sql` — append-only event log table with 7 indexes
- Created `server/services/taskEventBus.js` (~80 lines) — `emitTaskEvent()` persists to DB + emits to EventEmitter; `onTaskEvent()` subscriber registration; `resolveItemContext()` helper for item→board→workspace resolution
- Created `server/services/taskEventSubscribers.js` (~90 lines) — replicates existing side-effect behavior via subscribers:
  - `item.status_changed` → `runEventAutomationsForItemChange()` + activity log
  - `assignee.added` → `runEventAutomationsForAssigneeAdded()`
  - `item.created` → activity log (CREATE_TASK)
  - `item.updated` → activity log (UPDATE_TASK)
  - `item.archived` → activity log (DELETE_TASK)
  - All automation subscribers skip `actor_type === 'automation'` (recursive prevention)
- Modified `server/index.js` — added `maybeRunTaskEventsMigration()` + `registerTaskEventSubscribers()` after migrations complete
- Modified `server/routes/tasks.js` — instrumented all 35 mutation endpoints with `emitTaskEvent()`:
  - 5 workspace events, 3 board events, 5 status label events, 2 group events
  - 7 item events (status_changed, completed, due_date_changed, updated, created, archived, restored)
  - 4 automation events, 4 subitem events, 2 assignee events
  - 1 update event, 1 file event, 1 time entry event
- Guarded 5 existing direct side-effect calls behind `!EVENT_BUS_ENABLED` to prevent duplicates when subscribers active:
  - `logTaskActivity` (3 calls: item create, update, archive)
  - `runEventAutomationsForItemChange` (1 call: item update)
  - `runEventAutomationsForAssigneeAdded` (1 call: assignee add)
- Feature flag: `TASK_EVENT_BUS_ENABLED=true` enables subscribers; default off (events still persist to DB for audit trail)

### Modified files
| File | Changes |
|------|---------|
| `server/sql/task-events.sql` | **NEW** — task_events table + indexes |
| `server/services/taskEventBus.js` | **NEW** — event bus core |
| `server/services/taskEventSubscribers.js` | **NEW** — subscriber registration |
| `server/index.js` | Added migration + subscriber startup |
| `server/routes/tasks.js` | Added 35 emitTaskEvent() calls, guarded 5 direct calls |
| `docs/refactoring/STATE.md` | Updated last session, task count, session count |
| `docs/refactoring/PLAN.md` | TM-014 marked DONE |
| `docs/refactoring/CHANGELOG.md` | Added Session 21 entry |

---

## 2026-03-05 — TM-015v2 Expanded Automation Engine Spec (Session 20)

**Role:** Task Manager (spec writing)

### TM-015v2: Write expanded automation engine spec
- Created `docs/refactoring/architecture/task-specs/tm-015v2-automation-engine.md` (supersedes original `tm-015-rule-engine.md`)
- **15 triggers** (up from 8): added `item_completed`, `all_subitems_completed` (fan-in), `all_assignees_completed` (fan-in), `field_changed`, `time_entry_logged`, `file_uploaded`, `webhook_received` (Phase 3)
- **22 actions** (up from 15): added `remove_assignee`, `set_due_date`, `set_priority`, `notify_person`, `create_update_on_item`, `delay`, `stop_chain`
- **AND/OR condition groups** replacing single-field conditions — `{ logic: 'and'|'or', conditions: [...] }`
- **Multi-step chains** with `action`, `if`, `else`, `delay` step types and `parent_step_id` for nesting
- **Fan-in via `all_subitems_completed`** trigger — fires when all non-archived subitems reach `is_done_state`
- **Delay blocks** via `task_automation_delayed_runs` table + cron — pause/resume chain execution up to 30 days
- **3 scope levels**: board, workspace (new), global — workspace scope via new `workspace_id` column on `task_global_automations`
- **Circuit breaker**: 5 consecutive errors auto-disables a rule
- **~15 pre-built templates** across 8 categories (status progression, assignment, notifications, escalation, handoff, QC pipeline, time tracking, archival)
- **Two-tier UI approach**: simple mode (current + enhanced) and advanced mode (step builder, not visual canvas)
- **4 new tables**: `task_automation_steps`, `task_automation_quota`, `task_workflow_runs`, `task_automation_delayed_runs`
- **8 new/modified API endpoints** including dry-run test endpoint
- **4 implementation phases**: 2A (event bus), 2B (rule engine core), 2C (fan-in + delays), 2D (templates + UI)
- Spec only — no code changes

### PLAN.md: Break TM-015v2 into implementation sub-tasks
- Marked original TM-015 as SUPERSEDED by TM-015v2
- Added TM-015v2 parent entry (spec-only, XL scope)
- Added 6 implementation sub-tasks:
  - **TM-015v2a**: Event bus subscribers for new triggers (M, backend-specialist)
  - **TM-015v2b**: Rule engine core — multi-step chains + conditions (XL, backend-specialist)
  - **TM-015v2c**: New action types — 17 new actions in executeAction (L, backend-specialist)
  - **TM-015v2d**: Fan-in triggers + delay blocks + workflow runs (L, backend-specialist)
  - **TM-015v2e**: Frontend step builder + condition builder (L, frontend-specialist)
  - **TM-015v2f**: Frontend templates + execution history (M, frontend + backend)
- Updated STATE.md task count: 13/25 (was 13/20)

### Modified files
| File | Changes |
|------|---------|
| `docs/refactoring/architecture/task-specs/tm-015v2-automation-engine.md` | **NEW** — expanded automation engine spec |
| `docs/refactoring/PLAN.md` | TM-015 superseded, TM-015v2 + 6 sub-tasks added |
| `docs/refactoring/STATE.md` | Updated current phase, last session, session count, task metrics |
| `docs/refactoring/CHANGELOG.md` | Added Session 20 entry |

---

## 2026-03-04 — Task Platform Phase 1 Backend Execution (Session 19)

**Role:** Backend Specialist (Phase 1 execution)

### TM-011: Add pagination to backend list endpoints (L)
- Board view (`GET /boards/:boardId/view`): offset-based with `limit`/`offset` params (default 500). Parallel count query for `pagination.total`.
- Item updates (`GET /items/:itemId/updates`): cursor-based with `limit`/`before` params (default 50). Fetches limit+1 to detect `has_more`.
- Item files (`GET /items/:itemId/files`): cursor-based, same pattern.
- Item time entries (`GET /items/:itemId/time-entries`): cursor-based, same pattern.
- All params optional with backward-compatible defaults. Response includes `pagination` metadata.
- Updated frontend API client signatures to accept optional params and return full response objects.
- Updated 3 hooks (useItemUpdates, useItemFiles, useItemTimeTracking) to destructure from new response shape.

### TM-012: Add missing CRUD endpoints (M)
- `PATCH /tasks/groups/:groupId` — rename/reorder groups (workspace member)
- `DELETE /tasks/files/:fileId` — delete uploaded file (workspace member)
- `PATCH /tasks/time-entries/:entryId` — edit time entry (creator or admin)
- `DELETE /tasks/time-entries/:entryId` — delete time entry (creator or admin)
- `PATCH /tasks/updates/:updateId` — edit comment (author only)
- `DELETE /tasks/updates/:updateId` — delete comment (author or admin, cascades to view receipts)
- All endpoints include workspace access checks via `assertWorkspaceAccess`.
- Added 6 new frontend API client methods: `updateTaskGroup`, `deleteTaskFile`, `updateTaskTimeEntry`, `deleteTaskTimeEntry`, `updateTaskItemUpdate`, `deleteTaskItemUpdate`.

### Modified files
| File | Changes |
|------|---------|
| `server/routes/tasks.js` | 4 endpoints modified (pagination), 7 new endpoints added (~225 lines) |
| `src/api/tasks.js` | 4 functions updated (pagination params), 6 new methods added |
| `src/views/tasks/hooks/useItemUpdates.js` | Destructure `data.updates` from new response shape |
| `src/views/tasks/hooks/useItemFiles.js` | Destructure `data.files` from new response shape |
| `src/views/tasks/hooks/useItemTimeTracking.js` | Destructure `data.time_entries` from new response shape |

---

## 2026-03-04 — Task Platform Phase 1 Execution (Session 18)

**Role:** Frontend Specialist (Phase 1 execution)

### TM-009: Decompose TaskManager.jsx (XL)
- Extracted 9 custom hooks from 2,198-line monolith:
  - `useItemFiles`, `useItemSubitems`, `useItemTimeTracking`, `useItemUpdates`
  - `useMyWork`, `useStatusLabels`, `useAutomations`, `useItemDrawer`, `useBoardView`
- Extracted 4 components: `ItemDrawer`, `AutomationsDrawer`, `EditAutomationDialog`, `StatusLabelsDialog`
- TaskManager.jsx reduced from 2,198 → 252 lines (88% reduction)
- Cross-hook wiring via options objects (e.g., `openItemDrawer({ resetFns, loadFns })`)

### TM-010: Introduce TaskContext (L)
- Created `src/contexts/TaskContext.jsx` — shared workspace, board, member state
- Conditional `<TaskProvider>` wrapping in MainLayout when on `/tasks` route
- Eliminated duplicate API calls across TaskSidebarPanel, TaskManager, AutomationsPane, BillingPane
- Context provides: workspaces, boardsByWorkspace, allBoards, workspaceMembers + mutators

### TM-013: Virtualize BoardTable (L)
- Added `@tanstack/react-virtual` (~5KB) for windowed rendering
- Flattened groups + items into single virtual list
- Extracted ItemRow as `React.memo` with custom `areEqual` (skips function props)
- Dynamic row measurement via `measureElement`
- 10-row overscan buffer, lazy Avatar image loading
- Only visible rows rendered — target: 100-item render from ~800ms to ~50ms

### New files
| File | Lines | Purpose |
|------|-------|---------|
| `src/views/tasks/hooks/useBoardView.js` | ~280 | Board view loading, CRUD, inline updates |
| `src/views/tasks/hooks/useItemDrawer.js` | ~115 | Item drawer state + cross-hook coordination |
| `src/views/tasks/hooks/useItemUpdates.js` | ~166 | Updates, mentions, AI summary |
| `src/views/tasks/hooks/useItemTimeTracking.js` | ~130 | Time entry logging |
| `src/views/tasks/hooks/useItemFiles.js` | ~48 | File upload/list |
| `src/views/tasks/hooks/useItemSubitems.js` | ~76 | Subitems CRUD |
| `src/views/tasks/hooks/useAutomations.js` | ~157 | Automation CRUD + runs |
| `src/views/tasks/hooks/useStatusLabels.js` | ~96 | Status label management |
| `src/views/tasks/hooks/useMyWork.js` | ~162 | My Work aggregation |
| `src/views/tasks/components/ItemDrawer.jsx` | ~400 | Item detail drawer (updates/files/time tabs) |
| `src/views/tasks/components/AutomationsDrawer.jsx` | ~115 | Automations side drawer |
| `src/views/tasks/components/EditAutomationDialog.jsx` | ~115 | Edit automation form dialog |
| `src/views/tasks/components/StatusLabelsDialog.jsx` | ~135 | Status label management dialog |
| `src/contexts/TaskContext.jsx` | ~170 | Shared task workspace/board state |

### Bundle impact
- TaskManager chunk: 191.86 KB → 225.38 KB (+33.52 KB — includes @tanstack/react-virtual + extracted components now bundled together)
- New dependency: `@tanstack/react-virtual` (~5KB gzipped)

---

## 2026-03-04 — Task Platform Phase 0 Bug Fixes (Session 17)

**Role:** Frontend Specialist (Phase 0 execution)

### What was done
- Executed all 8 Phase 0 tasks (TM-001 through TM-008)

### Bug fixes
| Task | Fix | File(s) |
|------|-----|---------|
| **TM-001** | Fixed status string case mismatch in report queries (`'todo'` → `'To Do'`, etc.) | `server/routes/tasks.js` |
| **TM-002** | Fixed `selectedItem?.id` → `activeItem?.id` reference in archive handler | `TaskManager.jsx` |
| **TM-003** | Fixed `setGlobalAutomations` → `setAutomations` undeclared setter | `TaskManager.jsx` |

### Cleanup & improvements
| Task | Change | File(s) |
|------|--------|---------|
| **TM-004** | Removed ~130 lines of dead reports pane code (state, effects, handlers, import) | `TaskManager.jsx` |
| **TM-005** | Added ClickAwayListener to BoardTable people picker Popper | `BoardTable.jsx` |
| **TM-006** | Added 5 missing database indexes (assignees, items, updates) | `server/sql/init.sql` |
| **TM-007** | Deduplicated DEFAULT_STATUS_LABELS, getStatusColor, fmtMinutes into `src/constants/taskDefaults.js` | `TaskManager.jsx`, `BoardTable.jsx`, `MyWorkPane.jsx`, `BillingPane.jsx` |
| **TM-008** | Converted 8 raw Dialogs (3 in BoardTable, 5 in TaskSidebarPanel) to ConfirmDialog/FormDialog | `BoardTable.jsx`, `TaskSidebarPanel.jsx` |

### Bundle impact
- TaskManager chunk: 197.21 KB → 191.86 KB (-5.35 KB / -2.7%)
- Removed unused MUI Dialog imports from BoardTable and TaskSidebarPanel

### New files
- `src/constants/taskDefaults.js` — shared task platform constants

---

## 2026-03-04 — Task Platform Phase 1 Specs (Session 16)

**Role:** Task Manager Platform Engineer (Mode 2: Spec — Phase 1 completion)

### What was done
- Wrote 4 remaining Phase 1 specs, completing all spec work for TM-009 through TM-020

### Specs written

| Spec | File | Key Design Decisions |
|------|------|---------------------|
| **TM-010** TaskContext | `tm-010-task-context.md` | React Context for shared workspace/board/member state, eliminates 5+ duplicate API fetches, URL-derived active selections, mutators for consistent state |
| **TM-011** Pagination | `tm-011-pagination.md` | Cursor-based for sub-resources (updates/files/time), offset-based for board view (default 500), backward-compatible optional params |
| **TM-012** Missing CRUD | `tm-012-missing-crud.md` | 7 new endpoints (group rename, file delete, time entry PATCH/DELETE, update PATCH/DELETE), permission checks (creator or admin), GCS file cleanup |
| **TM-013** BoardTable Virtualization | `tm-013-boardtable-virtualization.md` | @tanstack/react-virtual (5KB), flattened group+item list, React.memo rows, lazy-mount Select on click, target 800ms→50ms for 100 items |

### Spec coverage

All 12 spec tasks now complete:
- **Phase 1**: TM-009, TM-010, TM-011, TM-012, TM-013
- **Phase 2**: TM-014, TM-015, TM-016
- **Phase 3**: TM-017, TM-018
- **Phase 4**: TM-019, TM-020

Phase 0 (TM-001–TM-008) are small bug fixes that don't need specs.

### Output files
- 4 spec files in `docs/refactoring/architecture/task-specs/`
- Updated `docs/refactoring/PLAN.md` — TM-010–TM-013 marked SPEC WRITTEN
- Updated `docs/refactoring/STATE.md` — session 16, 12 specs
- Updated `docs/refactoring/CHANGELOG.md` — this entry

### Validation
- `yarn build` — passes (no code changes, specs are docs only)

---

## 2026-03-04 — Task Platform Specs (Session 15)

**Role:** Task Manager Platform Engineer (Mode 2: Spec)

### What was done
- Wrote 8 detailed feature specs covering Phases 1–4 of the task platform upgrade
- Each spec includes: problem statement, data model (SQL), API endpoints, UI changes, migration strategy, validation steps, files affected

### Specs written

| Spec | File | Key Design Decisions |
|------|------|---------------------|
| **TM-009** TaskManager Decomposition | `tm-009-taskmanager-decomposition.md` | 10 hooks + 4 extracted components, cross-dependency analysis, execution order |
| **TM-014** Event Bus | `tm-014-event-bus.md` | In-process EventEmitter (not Pub/Sub), `task_events` table, 35 event types, recursive prevention via `actor_type` |
| **TM-015** Rule Engine | `tm-015-rule-engine.md` | Multi-step chains, if/else branching, 5 new triggers, 10 new actions, 10K/month rate limit |
| **TM-016** Enhanced RBAC | `tm-016-enhanced-rbac.md` | 4 new tables, 12 permission keys, column-level visibility, deny-by-default, staff auto-pass |
| **TM-017** Board Views | `tm-017-board-views.md` | Kanban (@dnd-kit), Timeline (custom), Calendar, view persistence, saved presets |
| **TM-018** Connections & Dependencies | `tm-018-connections-dependencies.md` | Item links (4 types), finish-to-start deps, cycle detection (BFS), advisory enforcement |
| **TM-019** Dashboard Widgets | `tm-019-dashboard-widgets.md` | 5 widget types, Recharts, react-grid-layout, aggregation API |
| **TM-020** Audit Log + Time Tracking | `tm-020-audit-time-tracking.md` | Audit log reads `task_events`, time entry CRUD, approval workflow, rate cards, policies |

### New tables designed (across all specs)
- `task_events` (TM-014) — event bus log
- `task_automation_steps` (TM-015) — multi-step chains
- `task_automation_quota` (TM-015) — rate limiting
- `task_roles`, `task_role_permissions`, `task_user_role_assignments`, `task_column_visibility` (TM-016) — RBAC
- `task_board_view_preferences`, `task_saved_views` (TM-017) — view persistence
- `task_item_links`, `task_item_dependencies` (TM-018) — connections
- `task_dashboards`, `task_dashboard_widgets` (TM-019) — dashboards
- `task_rate_cards`, `task_time_policies` (TM-020) — billing

### Output files
- 8 spec files in `docs/refactoring/architecture/task-specs/`
- Updated `docs/refactoring/PLAN.md` — all 8 specs marked SPEC WRITTEN with detailed file lists
- Updated `docs/refactoring/STATE.md` — session 15, spec counts
- Updated `docs/refactoring/CHANGELOG.md` — this entry

### Validation
- `yarn build` — passes (no code changes, specs are docs only)

---

## 2026-03-04 — Task Platform Audit (Session 14)

**Role:** Task Manager Platform Engineer (Mode 1: Audit)

### What was done
- Deep audit of entire task management system across 14 files (~10,288 lines)
- Documented all 18 database tables with full column definitions, indexes, FK relationships
- Cataloged all 55 API endpoints with auth checks and permission model
- Analyzed automation engine: 3 triggers, 5 actions, dedup strategy, cron flow
- Analyzed frontend: TaskManager monolith (87 state vars), BoardTable, 4 panes, sidebar
- Identified 52 API client methods and their usage patterns

### Findings
- **13 bugs** (8 backend, 5 frontend):
  - CRITICAL: Report status counts always 0 (string case mismatch)
  - HIGH: `handleToggleGlobalAutomation` references undeclared state
  - MEDIUM: Daily overview includes done items, file deletion orphans, drawer auto-close broken, people picker no click-outside-close
- **5 missing indexes**: `task_item_assignees(user_id)`, `task_items(group_id, archived_at)`, `task_items(due_date)`, `task_items(created_by)`, `task_updates(created_at)`
- **20 missing user-expected features**: drag-drop, kanban/timeline views, filtering, sorting, bulk actions, real-time updates, etc.
- **9 accessibility gaps**: no ARIA on grid, no keyboard drag-drop, color-only status, undiscoverable interactions
- **6 missing CRUD operations**: group rename, global label edit/delete, file delete, time entry edit/delete, update edit/delete

### Tasks created (20 total)
- **Phase 0** (Bug fixes & cleanup): TM-001 through TM-008
- **Phase 1** (Decomposition & foundation): TM-009 through TM-013
- **Phase 2** (Automation engine + RBAC specs): TM-014 through TM-016
- **Phase 3** (Views & cross-board specs): TM-017, TM-018
- **Phase 4** (Dashboards & collaboration specs): TM-019, TM-020

### Output files
- `docs/refactoring/architecture/task-platform-audit.md` — comprehensive unified audit (backend + frontend)
- Updated `docs/refactoring/PLAN.md` — 20 TM-xxx tasks added
- Updated `docs/refactoring/STATE.md` — task platform phase noted
- Updated `docs/refactoring/CHANGELOG.md` — this entry

### Validation
- `yarn build` — to be verified before commit

---

## 2026-03-02 — GCP Cost Implementation (Session 13)

**Role:** GCP Cost Optimizer

### Code Changes
1. **vite.config.mjs** — Added `esbuild.drop: ['console', 'debugger']` for production builds. All `console.*` and `debugger` statements are stripped from the frontend bundle.
2. **server/index.js** — Added `console.log = () => {}` when `NODE_ENV === 'production'`. Preserves `console.error` and `console.warn` for operational visibility.
3. **Dockerfile** — Optimized production stage: switched to `node:20-bullseye-slim`, removed build tools (`python3`, `g++`, `make`), copy pre-built `node_modules` from build stage instead of reinstalling. Reduces image size by ~200 MB.
4. **cloudbuild.yaml** — Fixed placeholders: `_PROJECT_ID` → `anchor-hub-480305`, `_AR_REPO` → `cloud-run-source-deploy`, `--memory` → `512Mi`.

### Infrastructure Changes
5. **Cloud SQL tier** — Downgraded from `db-perf-optimized-N-2` (ENTERPRISE_PLUS, ~$490/mo) to `db-custom-1-3840` (ENTERPRISE, ~$50/mo). Saves ~$440/month.
6. **Cloud SQL backups** — Enabled automated backups (03:00 UTC) + point-in-time recovery. Closes HIPAA compliance gap.
7. **ai-endpoint** — Set `minScale=0` (was 1). Scales to zero when idle. Saves ~$75/month.
8. **Artifact Registry cleanup** — Added retention policies (keep 10 recent, delete >30 days) to both `cloud-run-source-deploy` repos (europe-west1 + us-central1).
9. **Deleted `anchor-hub-repo`** — Unused AR repo in us-central1 (1 GB). Removed.
10. **Deleted `OPEN_AI_API_KEY` secret** — Unused secret in Secret Manager. App uses Vertex AI.

### Also Done (follow-up)
11. **Vertex AI region** — Changed default fallback from `us-east4` to `us-central1` in `server/services/ai.js`, `server/services/imagen.js`, and `.env.example`. Eliminates cross-region latency (~20-40ms per AI call).

### Validation
- `yarn build` — passes cleanly (built in 6.30s)
- `gcloud sql instances describe anchor` — confirms `tier: db-custom-1-3840`, `edition: ENTERPRISE`, backups enabled with PITR
- `gcloud run services describe ai-endpoint` — confirms minScale annotation removed (defaults to 0)
- `gcloud artifacts repositories list` — confirms `anchor-hub-repo` deleted, 2 repos remaining
- Cleanup policies confirmed active on both repos

### Estimated Savings: ~$529/month (~90% reduction)

---

## 2026-03-02 — GCP Cost Audit (Session 12)

**Role:** GCP Cost Optimizer

### Infrastructure Findings

#### CRITICAL: Cloud SQL — `db-perf-optimized-N-2` tier (~$490/month)

The Cloud SQL instance `anchor` is using `db-perf-optimized-N-2`, which is a **performance-optimized** tier with 2 vCPUs, 16 GB RAM, and local SSD. This tier costs approximately **$490/month** ($0.67/hr).

**Current config:**
- Tier: `db-perf-optimized-N-2` (2 vCPU, 16 GB RAM)
- Disk: 10 GB PD-SSD
- Availability: ZONAL (single-zone — good for cost)
- Backups: **DISABLED** (risky for production HIPAA app)
- Point-in-time recovery: disabled
- Query Insights: enabled (5 plans/min)

**Problem:** This is a small CRM with likely <100 concurrent users. The app's connection pool is set to `max: 20`. A performance-optimized tier is overkill.

**Recommendation:** Downgrade to `db-custom-1-3840` (1 vCPU, 3.75 GB RAM) or `db-g1-small` (shared-core, 1.7 GB RAM).
- `db-custom-1-3840`: ~$50/month → **saves ~$440/month**
- `db-g1-small`: ~$25/month → **saves ~$465/month**
- Enable automated backups (required for HIPAA compliance regardless)

**Action:** Infrastructure change — recommend to user.

---

#### HIGH: `ai-endpoint` Cloud Run service — unused, always-on (~$50-100/month)

A Cloud Run service `ai-endpoint` exists in `europe-west1` with:
- **minScale: 1** (always running at least 1 instance)
- **maxScale: 20** (can autoscale to 20!)
- 1 vCPU, 512 MB memory per instance

This service is **not referenced anywhere** in the Anchor Client Dashboard codebase. It was deployed from a separate `ai-endpoint` GitHub repo. With `minScale: 1`, it's running 24/7 even with zero traffic.

**Cost:** At minimum 1 instance always on = ~$50-100/month in CPU+memory.

**Recommendation:** Either delete the service or set `minScale: 0` to scale to zero when idle.

**Action:** Infrastructure change — recommend to user.

---

#### HIGH: Artifact Registry — 51 GB of Docker images (~$5-10/month, growing)

Three Artifact Registry repositories total **~51 GB**:
- `us-central1/cloud-run-source-deploy`: **49.4 GB** (main app images)
- `us-central1/anchor-hub-repo`: **1.0 GB** (likely old/unused)
- `europe-west1/cloud-run-source-deploy`: **0.3 GB** (ai-endpoint images)

**No cleanup policies configured.** Every Cloud Build push creates a new ~300 MB image and the old ones are never deleted. At 198 revisions, this adds up fast.

**Recommendation:**
1. Add a cleanup policy to retain only the 10 most recent images
2. Consider deleting `anchor-hub-repo` if unused (saves 1 GB immediately)
3. After cleanup, ongoing storage drops to ~3 GB (~$0.30/month)

**Action:** Infrastructure change — recommend to user.

---

#### MEDIUM: Dockerfile — duplicate `apt-get` + `yarn install` in both stages

The Dockerfile runs `apt-get install` and `yarn install` in BOTH the build stage AND the production stage. The production stage reinstalls all build tools (`python3`, `g++`, `make`) that are only needed for native module compilation (argon2, canvas).

**Current:** Two full `yarn install` runs + two full `apt-get install` runs per build.

**Recommendation:** Use a three-stage build:
1. **Builder stage:** Install all build deps + compile native modules
2. **Production stage:** Copy only the compiled `node_modules` from builder — skip `python3`, `g++`, `make`

This would:
- Reduce image size by ~200 MB (faster pulls, less Artifact Registry storage)
- Speed up builds by ~30-60 seconds
- Reduce Cloud Build minutes cost

**Action:** Code change — add to PLAN.md.

---

#### MEDIUM: Cross-region Vertex AI calls (latency + potential egress)

- Cloud Run: `us-central1`
- Vertex AI: `us-east4` (different region)

Every AI call (lead classification, review response drafting, content generation) incurs cross-region network latency (~20-40ms extra) and potentially minor egress charges.

**Recommendation:** Move Vertex AI to `us-central1` to match Cloud Run region. Change `VERTEX_LOCATION` env var. Gemini Flash is available in us-central1.

**Action:** Infrastructure change — recommend to user.

---

#### MEDIUM: 533 console.log statements in server code

Cloud Run automatically captures stdout/stderr to Cloud Logging. At $0.50/GiB for logging ingestion, verbose logging adds up. The 533 `console.log/error/warn` calls across 33 server files include debug output that shouldn't be in production.

**Recommendation:**
1. Add a structured logger with log levels (e.g., `pino`) — only log `warn`+ in production
2. Or: add `NODE_ENV` guards around debug-only console.log calls
3. Set Cloud Logging exclusion filter for low-severity logs

**Estimated savings:** Depends on traffic volume, but typically $5-20/month for low-traffic apps.

**Action:** Code change — add to PLAN.md.

---

#### LOW: Secret Manager — 26 secrets

26 secrets at $0.06/secret/month = ~$1.56/month. This is fine and appropriate for HIPAA.

Includes an `OPEN_AI_API_KEY` secret that doesn't appear to be used in the codebase (the app uses Vertex AI, not OpenAI). Could be cleaned up.

**Action:** Infrastructure — minor cleanup.

---

#### LOW: File storage in PostgreSQL BYTEA

Files are stored directly in PostgreSQL as BYTEA columns (`file_uploads` table). For small files this is fine, but as file volume grows it inflates database storage costs (Cloud SQL SSD at $0.17/GB/month) vs Cloud Storage ($0.020/GB/month for Standard, 8.5x cheaper).

**Recommendation:** Not urgent for current scale. Monitor file_uploads table size. If it exceeds ~1 GB, consider migrating to Cloud Storage.

**Action:** No action needed now. Add monitoring note.

---

#### INFO: Cloud SQL backups are DISABLED

Backups are currently **disabled** on the production Cloud SQL instance. This is a HIPAA compliance risk — data could be lost with no recovery option.

**Recommendation:** Enable automated daily backups and point-in-time recovery immediately. Cost: ~$0.08/GB/month for backup storage. For 10 GB DB this is ~$0.80/month.

**Action:** Infrastructure change — URGENT recommend to user.

---

### Cost Summary

| Resource | Current Est. Monthly | After Optimization | Savings |
|----------|--------------------:|-------------------:|--------:|
| Cloud SQL (db-perf-optimized-N-2) | ~$490 | ~$50 (db-custom-1-3840) | **~$440** |
| ai-endpoint (always-on, unused) | ~$75 | $0 (delete or scale-to-zero) | **~$75** |
| Artifact Registry (51 GB) | ~$5 | ~$0.30 (cleanup policy) | **~$5** |
| Cloud Build (oversized images) | ~$5 | ~$3 | **~$2** |
| Cloud Logging (verbose) | ~$10 | ~$2 | **~$8** |
| Secret Manager (26 secrets) | ~$1.56 | ~$1.50 | ~$0 |
| Cloud SQL backups (enable) | $0 | +$0.80 | -$0.80 |
| **TOTAL** | **~$587** | **~$58** | **~$529/month** |

**Potential savings: ~$529/month (~90% reduction)**

The single biggest win is downgrading Cloud SQL from the performance-optimized tier.

### Validation
- No code changes made in this session (audit only)
- All findings verified via `gcloud` CLI against live infrastructure

---

## 2026-03-01 — C-010: ClientPortal Decomposition (Session 11)

**Role:** Frontend Refactor

### What was done
- Decomposed ClientPortal.jsx from 4,770 lines to 216 lines (95% reduction)
- Extracted 9 sub-components into `src/views/client/ClientPortal/`:
  1. **AnalyticsTab.jsx** (43 lines) — Analytics iframe with lazy-load on first render
  2. **OnboardingModal.jsx** (80 lines) — Fireworks + congratulations modal after onboarding completion
  3. **ProfileTab.jsx** (174 lines) — Profile form with avatar, name, email, password, revenue goal
  4. **DocumentsTab.jsx** (158 lines) — Shared docs section + client docs with upload/delete/view
  5. **BrandTab.jsx** (231 lines) — Logo uploads, style guide uploads, brand text fields, access fields
  6. **TasksTab.jsx** (240 lines) — Task list with active/completed toggle, request dialog, rush confirm
  7. **ArchiveTab.jsx** (329 lines) — Archived journeys/clients lists with restore, confirmation dialog
  8. **LeadsTab.jsx** (2,190 lines) — Lead management (card/table views, lead detail drawer, service dialog, filters, stats, CSV export, pipeline stages, tags, notes, reclassify dialog, save view dialog)
  9. **JourneyTab.jsx** (1,247 lines) — Journey management (kanban/list views, journey drawer, concern dialog, step/note/timeline/template dialogs)
- Removed dead `updatesDialog` code (state + dialog JSX, never opened)
- Removed unused `handleOpenTimelineDialog` (pre-existing dead code)
- Removed unused `user` destructure from AnalyticsTab

### Architecture decisions
- **Concern dialog** lives in JourneyTab (save logic needs journey upsert), exposed via `openConcernDialogRef` for LeadsTab
- **Service dialog** lives in LeadsTab (all call sites are leads-domain), exposed via `openServiceDialogRef` for JourneyTab
- **Services state** shared from parent orchestrator (used by both Leads and Journey)
- **journeyByLeadId** computed in JourneyTab, passed up to parent via `onJourneysLoaded` callback
- **concernOptions** computed in parent from profile client_type/client_subtype
- **handleArchiveJourney** lives in parent orchestrator (shared between Journey and Archive)
- Each tab owns its own data loading (loads on first render, not via parent useEffect)
- `viewMode` is local to each tab (card/table for Leads, kanban/list for Journey)
- Keyboard shortcuts simplified: tab navigation (1-7) stays in parent

### What stays in ClientPortal (~216 lines)
- Tab routing (activeTab, SECTION_CONFIG, URL sync via useSearchParams)
- Message state + triggerMessage helper
- Auth context wiring (useAuth → user, actingClientId, etc.)
- Services state + loadServices (shared between Leads and Journey)
- Profile state + concernOptions (shared between parent and Journey)
- journeyByLeadId state (computed in Journey, consumed by Leads)
- Cross-tab refs (openConcernDialogRef, openServiceDialogRef)
- handleArchiveJourney callback
- Keyboard shortcuts (tab navigation only)
- Tab navigation JSX (content area switching)
- OnboardingModal render

### Validation
- `yarn build` — passes cleanly (built in 6.06s)
- `yarn lint` — no new errors in ClientPortal files (only pre-existing prettier formatting warnings and catch(err) patterns from original code)

---

## 2026-03-01 — C-009: AdminHub Decomposition (Session 10)

**Role:** Frontend Refactor

### What was done
- Decomposed AdminHub.jsx from 5,460 lines to 2,361 lines (57% reduction)
- Extracted 6 self-contained sub-components into `src/views/admin/AdminHub/`:
  1. **EmailLogsSection.jsx** (783 lines) — Email logs table, filters, stats summary, detail dialog
  2. **ActivityLogsTab.jsx** (252 lines) — User activity logs table with filters, pagination
  3. **OAuthIntegrationsTab.jsx** (1,604 lines) — OAuth connections, resources, Meta insights, 6 dialogs
  4. **DocumentsTab.jsx** (197 lines) — Document upload, listing, review status management
  5. **BrandAssetsTab.jsx** (96 lines) — Brand assets display, brand basics form
  6. **ClientGroupsManager.jsx** (468 lines) — Group CRUD dialog, icon upload, delete confirmation
- Each component receives `clientId` (or relevant props) and manages its own state, effects, and API calls
- AdminHub.jsx remains the orchestrator: client table, drawer shell, tab navigation, onboarding wizard
- Followed existing pattern used by CallTrackingTab and FormsTab (child components receiving `clientId` prop)
- Cleaned up unused imports from AdminHub.jsx after each extraction

### What stays in AdminHub (~2,361 lines)
- Client management state (clients, editing, loading, selectedClientIds, bulk ops)
- Client table rendering (staff + client rows, drag-drop, grouped/ungrouped)
- New client form
- Onboarding wizard (deeply coupled to editing state)
- Client edit drawer shell + tab navigation
- Details tab (reads many state slices)
- Delete/deactivate client dialogs
- Brand data state (brandData/setBrandData — passed to BrandAssetsTab, used by Save button in drawer footer)

### Validation
- `yarn build` — passes cleanly after each extraction and final build (built in 6.19s)
- `yarn lint --quiet` — no new lint errors (only pre-existing `React` unused import warnings)

---

## 2026-03-01 — C-008: SelectField Extraction (Session 9)

**Role:** Frontend Refactor

### What was done
- Created `src/ui-component/extended/SelectField.jsx` — wraps FormControl + InputLabel + Select into a single component
- Props: `label`, `value`, `onChange`, `options` (array of `{value, label}` or strings), `children` (for custom MenuItems), `required`, `fullWidth` (default true), `size`, `disabled`, `sx`, plus rest props forwarded to Select
- Supports both `options` array (simple cases) and `children` (custom MenuItems with complex content)
- Replaced 22 FormControl+InputLabel+Select patterns across 8 files:
  - `FormsManager.jsx` — 5 (client filter, create dialog client + form type, builder form select, submissions form select, embed form select)
  - `FormsTab.jsx` — 2 (create dialog form type + preset)
  - `CallTrackingTab.jsx` — 3 (provider selector, purchase source type, edit source type)
  - `TwilioManager.jsx` — 5 (purchase client + source type, edit source type, inline provider switch, scripts client select)
  - `TeamManagement.jsx` — 1 (invite role with custom Stack MenuItems)
  - `ReviewsPanel.jsx` — 7 (rating/response/priority filters, inline priority, tone, auto-flag threshold, default tone, delivery method, location)
  - `AdminHub.jsx` — 3 (activity category filter, add user role, email type + status filters)
  - `TypeSpecificQuestionnaire.jsx` — 1 (dynamic select field)
- Removed unused FormControl, InputLabel, Select imports from 5 files (FormsTab, CallTrackingTab, TwilioManager, TeamManagement, ReviewsPanel)
- Registered SelectField in CLAUDE.md Shared Component Library table

### Note on original evaluation
- Initial evaluation (Session 8) recommended SKIP for a generic FormField wrapper
- Re-evaluated after user feedback: the Select-in-FormControl pattern (6+ lines → 1 component) IS worth extracting
- TextField wrapping was correctly identified as low-value (already concise as a single element)
- Component renamed from FormField to SelectField to reflect its focused scope

### Intentionally skipped
- TextField patterns — already concise as single elements, no meaningful boilerplate to reduce
- AdminHub FormControl+OutlinedInput patterns — different component (OutlinedInput), not Select
- AdminHub TextField select variant — uses `SelectProps.displayEmpty` + `renderValue`, too specialized
- Existing Form/ wrappers (CustomFormControl, FormControl, FormControlSelect) — legacy template components, not used in practice

### Validation
- `yarn build` — passes cleanly (built in 6.11s)

---

## 2026-03-01 — C-007: Brand Colors Map (Session 8)

**Role:** Frontend Refactor

### What was done
- Created `src/constants/brandColors.js` — centralized BRAND_COLORS constant for third-party provider hex values
- Colors defined: `google` (#4285F4), `facebook` (#1877F2), `facebook_green` (#42b72a), `instagram` (#E4405F), `tiktok` (#000000), `wordpress` (#21759B), `microsoft` (#00A4EF)
- Updated `src/api/oauth.js` — OAUTH_PROVIDERS now imports colors from BRAND_COLORS instead of hardcoding hex values
- Updated `src/views/admin/AdminHub.jsx` — replaced 5 hardcoded brand color hex values with BRAND_COLORS references:
  - 2 × Facebook blue (#1877F2) → `BRAND_COLORS.facebook` (Avatar bgcolor, ThumbUpIcon color)
  - 1 × Facebook green (#42b72a) → `BRAND_COLORS.facebook_green` (LeaderboardIcon color)
  - 2 × Instagram pink (#E4405F) → `BRAND_COLORS.instagram` (CameraAltIcon color, Avatar bgcolor)
- Registered BRAND_COLORS in CLAUDE.md Shared Component Library table

### Intentionally skipped
- AnchorStepIcon.jsx — uses `rgba(33, 150, 243, ...)` which is MUI primary blue (the app's own brand), not a third-party provider color
- TaskManager/BoardTable/MyWorkPane DEFAULT_LABELS colors — task status colors, not brand colors
- ClientPortal lead stats colors — data visualization colors, not brand colors
- OnboardingThankYou dark background — app theming, not brand
- ReviewsPanel italic grey — UI emphasis color, not brand

### Validation
- `yarn build` — passes cleanly (built in 6.13s)

---

## 2026-03-01 — C-006: DataTable Extraction (Session 7)

**Role:** Frontend Refactor

### What was done
- Created `src/ui-component/extended/DataTable.jsx` — declarative table with optional search, sort, pagination, and empty/loading states
- Column-based API: `{ id, label, render?, align?, sortable?, sortValue?, width?, minWidth?, hidden? }`
- Built-in features: client-side search filtering, sort with TableSortLabel, pagination with TablePagination, EmptyState integration, LinearProgress loading, outlined Paper wrapper option
- Replaced 11 table instances across 6 files:
  - `ServicesManagement.jsx` — 1 (services list)
  - `CallTrackingTab.jsx` — 1 (tracking numbers)
  - `TwilioManager.jsx` — 2 (tracking numbers in NumbersPane, client providers in ClientsPane)
  - `TeamManagement.jsx` — 2 (team members with conditional Actions column via `hidden`, pending invitations)
  - `FormsTab.jsx` — 2 (forms list, submissions inside dialog)
  - `FormsManager.jsx` — 1 (submissions in SubmissionsPane)
- Removed unused Table/TableBody/TableCell/TableContainer/TableHead/TableRow/Paper imports from converted files
- Registered DataTable in CLAUDE.md Shared Component Library table

### Intentionally skipped
- AdminHub tables (3) — deferred to C-009 decomposition (large file, complex pagination/search/selection)
- ClientPortal tables (2) — deferred to C-010 decomposition
- ReviewsPanel table (1) — server-side pagination and filtering, not compatible with DataTable's client-side approach
- ActiveClients table (3) — expandable rows with nested tables using Collapse, too complex for flat DataTable
- FormsManager forms list (2) — grouped layout with multiple Table instances per client group, doesn't fit DataTable pattern
- BlogEditor — uses List/ListItem, not a table

### Validation
- `yarn build` — passes cleanly (built in 5.99s)

---

## 2026-03-01 — C-005: FormDialog Extraction (Session 6)

**Role:** Frontend Refactor

### What was done
- Created `src/ui-component/extended/FormDialog.jsx` — standard dialog shell for form-based workflows
- Props: `open`, `onClose`, `onSubmit`, `title`, `maxWidth`, `loading`, `loadingLabel`, `submitLabel`, `cancelLabel`, `submitColor`, `submitDisabled`, `submitIcon`, `dividers`, `actions` (override), `spacing`
- Children are rendered inside `Stack spacing={2} sx={{ mt: 1 }}` — no need to wrap in Stack/DialogContent/DialogActions manually
- Uses LoadingButton internally for submit button
- Replaced 13 form dialog instances across 7 files:
  - `SharedDocuments.jsx` — 1 (edit document)
  - `ServicesManagement.jsx` — 1 (add/edit service)
  - `FormsTab.jsx` — 2 (create form, edit form)
  - `FormsManager.jsx` — 2 (create form, edit form)
  - `CallTrackingTab.jsx` — 2 (purchase number, edit number)
  - `TwilioManager.jsx` — 2 (purchase number, edit number)
  - `ReviewsPanel.jsx` — 1 (request review — uses submitIcon + submitDisabled)
- Bonus: Converted FormsManager archive dialog from hand-built Dialog to ConfirmDialog (it was a confirmation, not a form)
- Removed unused Dialog/DialogActions/DialogContent/DialogTitle/LoadingButton/Grid imports from ServicesManagement
- Registered FormDialog in CLAUDE.md Shared Component Library table

### Intentionally skipped
- SharedDocuments upload dialog — dynamic file list with per-file cards, too specialized
- TeamManagement invite dialog — two-state dialog (form → success URL display), DialogActions change between states
- AdminHub dialogs — deferred to C-009 decomposition (OAuth, onboarding wizard, group management all too complex)
- ClientPortal dialogs — deferred to C-010 decomposition (submit request, journey dialogs, service agreement)
- TaskManager edit automation — highly conditional fields based on trigger/action types
- BoardTable add label — advanced color picker with hex input, opacity slider, palette
- Display-only dialogs (submissions, detail, embed code, invoice preview) — no form submission, just Close button
- FormsTab/CallTrackingTab script/embed dialogs — display-only with Copy button, not form submissions

### Validation
- `yarn build` — passes cleanly (built in 6.42s)

---

## 2026-03-01 — C-004: LoadingButton Extraction (Session 5)

**Role:** Frontend Refactor

### What was done
- Created `src/ui-component/extended/LoadingButton.jsx` — MUI Button wrapper with built-in loading state
- Props: `loading` (bool), `loadingLabel` (text override), `children`, `startIcon`, `disabled`, plus all MUI Button props
- Replaces startIcon with CircularProgress when loading, auto-disables, swaps label text
- Replaced 24 loading button patterns across 10 files:
  - `SharedDocuments.jsx` — 2 (upload, save edit)
  - `FormsTab.jsx` — 2 (archive form, save edit)
  - `CallTrackingTab.jsx` — 2 (purchase number, update number)
  - `BlogEditor.jsx` — 2 (save draft, suggest content)
  - `TwilioManager.jsx` — 4 (purchase, update, reconfigure, save provider)
  - `FormsManager.jsx` — 5 (save field, save form, edit form, create field, update field)
  - `ServicesManagement.jsx` — 1 (save service)
  - `ReviewsPanel.jsx` — 4 (generate response, send response, sync, create request)
  - `TeamManagement.jsx` — 1 (send invitation)
  - `ClientPortal.jsx` — 1 (reclassify leads)
- Removed unused CircularProgress imports from ReviewsPanel.jsx and TeamManagement.jsx
- Registered LoadingButton in CLAUDE.md Shared Component Library table

### Intentionally skipped
- Auth page buttons (ForgotPassword, AcceptClientInvite) — wrapped in AnimateButton motion component, different pattern
- AuthLogin MFA button — complex ternary for MFA step vs login
- ClientOnboarding — complex isLastStep ternary with different labels
- ConfirmDialog.jsx — already has its own internal loading prop
- FileUploadList.jsx — uses `component="span"` label, specialized pattern
- AdminHub buttons — complex conditional disabled states, deferred to C-009 decomposition

### Validation
- `yarn build` — passes cleanly (built in 6.16s)

---

## 2026-03-01 — C-003: EmptyState Extraction (Session 4)

**Role:** Frontend Refactor

### What was done
- Created `src/ui-component/extended/EmptyState.jsx` — consistent empty list/section placeholder
- Props: `title`, `message`, `icon` (optional MUI icon rendered large/muted), `action` (optional button), `sx`
- Replaced 20 empty state patterns across 10 files:
  - `BlogEditor.jsx` — 1 (no blog posts)
  - `ActiveClients.jsx` — 1 (no active clients)
  - `ServicesManagement.jsx` — 1 (no services)
  - `SharedDocuments.jsx` — 1 (no shared documents, was Card-wrapped)
  - `CallTrackingTab.jsx` — 1 (no tracking numbers, was Alert)
  - `FormsTab.jsx` — 1 (no submissions, was Alert)
  - `FormsManager.jsx` — 4 (no fields, no forms, no filtered forms, no submissions — all were Alerts)
  - `TwilioManager.jsx` — 1 (no clients, was Alert)
  - `TaskManager.jsx` — 3 (no automation runs, no updates, no files)
  - `AutomationsPane.jsx` — 2 (no automations, no runs)
  - `ClientPortal.jsx` — 5 (no documents, no calls, archived journeys with icon, archived clients with icon, document review)
- Registered EmptyState in CLAUDE.md Shared Component Library table

### Intentionally skipped
- Table empty rows (`<TableRow><TableCell colSpan>...`) — tightly coupled to Table structure, not worth abstracting
- Alert-based messages in onboarding steps (ServicesStep) — contextual warnings, not empty states
- ClientView ListItem empty — too tightly coupled to list context
- ClientPortal notes/steps inline messages — minor inline text within larger components
- ReviewsPanel table empty row — conditional context-dependent message

### Validation
- `yarn build` — passes cleanly (built in 6.31s)

---

## 2026-03-01 — C-002: StatusChip Extraction (Session 3)

**Role:** Frontend Refactor

### What was done
- Created `src/ui-component/extended/StatusChip.jsx` — centralized status-to-color Chip component
- Built-in STATUS_MAP covering 25+ status keys: active/inactive, enabled/disabled, draft/published/archived, pending/in_progress/completed, connected/disconnected, sent/delivered/failed/bounced/complained, on/off, yes/no, won/lost, viewed, responded, flagged, urgent
- Auto-humanizes labels (e.g., `in_progress` → "In Progress")
- Replaced 16 status indicator chips across 8 files:
  - `BlogEditor.jsx` — 2 chips (published badge + post list status)
  - `FormsTab.jsx` — 2 chips (form status + email_sent boolean), removed local STATUS_COLORS map
  - `FormsManager.jsx` — 1 chip (form status with outlined variant)
  - `CallTrackingTab.jsx` — 1 chip (recording on/off)
  - `ActiveClients.jsx` — 1 chip (journey paused/active)
  - `TwilioManager.jsx` — 3 chips (recording on/off, active/inactive, connection status)
  - `AdminHub.jsx` — 4 chips (OAuth connected/disconnected, FB form status, 2 email log status chips with icons)
  - `ClientPortal.jsx` — 2 chips (document review status, journey status)
- Registered StatusChip in CLAUDE.md Shared Component Library table

### Intentionally skipped (not status indicators)
- Activity category chips (AdminHub) — use domain-specific `getCategoryColor()` function
- Role chips (TeamManagement) — role indicators, not status
- Priority chips (HomePane) — custom P1-P5 labels with sx overrides
- Count/metadata chips — group counts, filenames, dates, permission scopes
- Task view filter chips (ClientPortal) — interactive toggles, not status display
- Journey Kanban column headers — use custom hex colors, not MUI palette

### Validation
- `yarn build` — passes cleanly (built in 6.08s)

---

## 2026-03-01 — C-001: ConfirmDialog Extraction (Session 2)

**Role:** Frontend Refactor

### What was done
- Created `src/ui-component/extended/ConfirmDialog.jsx` — shared confirmation dialog component
- Replaced 15 hand-built confirmation dialogs across 10 files:
  - `AdminHub.jsx` — 6 dialogs (bulkDelete, revokeConnection, deleteConnection, deleteResource, deleteGroup, deactivate)
  - `ActiveClients.jsx` — 2 dialogs (redact, archive)
  - `CallTrackingTab.jsx` — 1 dialog (release number)
  - `ServicesManagement.jsx` — 1 dialog (delete service)
  - `FormsTab.jsx` — 1 dialog (archive form)
  - `SharedDocuments.jsx` — 1 dialog (delete document)
  - `BlogEditor.jsx` — 1 dialog (delete blog post)
  - `TeamManagement.jsx` — 1 dialog (multi-type: revoke/remove/leave)
  - `TwilioManager.jsx` — 1 dialog (release tracking number)
  - `TaskManager.jsx` — 2 dialogs (delete status label, delete automation)
  - `AutomationsPane.jsx` — 1 dialog (delete automation)
- Registered ConfirmDialog in CLAUDE.md Shared Component Library table
- Skipped AdminHub `deleteConfirm` dialog (has Checkbox for "Also delete associated task board" — not a pure confirmation)

### Props supported
`open`, `onClose`, `onConfirm`, `title`, `message`, `secondaryText`, `confirmLabel`, `cancelLabel`, `confirmColor`, `loading`, `loadingLabel`, `severity`, `severityMessage`

### Validation
- `yarn build` — passes cleanly (built in 6.20s)

---

## 2026-03-01 — Frontend Component Audit (Session 1)

**Role:** Frontend Refactor (first run — audit mode)

### What was done
- Audited entire `src/` directory for repeated UI patterns
- Created `docs/refactoring/architecture/component-audit.md` — comprehensive inventory of all tables, dialogs, buttons, form inputs, cards, chips, loading states, and empty states
- Created `docs/refactoring/architecture/component-plan.md` — 8 components to extract in priority order

### Key findings
- **67 dialogs** across 15 files, all hand-built (no shared component)
- **~25 confirmation dialogs** repeating the exact same pattern
- **20+ tables** across 16 files, most missing pagination/search/sort
- **150+ status Chip instances** with inconsistent color mapping
- **No DataGrid usage** — all raw MUI Table
- **useTableSearch hook exists** but only used in 1 file
- Hardcoded brand colors in AdminHub.jsx and AnchorStepIcon.jsx

### Extraction plan (8 components, 8 sessions)
1. C-001: ConfirmDialog (M) — replaces ~25 duplicate confirmation patterns
2. C-002: StatusChip (M) — centralizes 150+ status indicator instances
3. C-003: EmptyState (S) — replaces ~20 inconsistent empty state patterns
4. C-004: LoadingButton (S) — standardizes ~30 button loading patterns
5. C-005: FormDialog (L) — wraps ~40 form dialog shells
6. C-006: DataTable (XL) — replaces 20+ raw MUI tables
7. C-007: Brand Colors Map (S) — centralizes hardcoded hex values
8. C-008: FormField (XL) — unified form input component (deferred)

### Status
Awaiting user approval before starting extraction.

---

## 2026-03-01 — System Initialization

- Created `docs/refactoring/` directory structure
- Created state tracking files: STATE.md, PLAN.md, ERRORS.md, CHANGELOG.md
- Created agent instruction files: mapper.md, planner.md, refactor.md, frontend.md, db-optimizer.md, gcp-cost.md, validator.md
- Created `docs/refactoring/architecture/` directory for audit outputs
- Appended Refactoring System section to project CLAUDE.md
- System is ready. Next step: run a session as "mapper" to audit the codebase.
