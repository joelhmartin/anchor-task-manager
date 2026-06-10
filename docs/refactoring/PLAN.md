# Refactoring Plan

## Infrastructure Tasks — ALL COMPLETE (Session 13)

### ~~INFRA-001: Downgrade Cloud SQL tier~~ DONE
- Downgraded from `db-perf-optimized-N-2` (ENTERPRISE_PLUS) to `db-custom-1-3840` (ENTERPRISE)
- Saves ~$440/month

### ~~INFRA-002: Enable Cloud SQL backups~~ DONE
- Enabled automated backups at 03:00 UTC + point-in-time recovery
- HIPAA compliance gap closed

### ~~INFRA-003: Scale ai-endpoint to zero~~ DONE
- Set minScale=0 (was 1). Service now scales to zero when idle.
- Saves ~$75/month

### ~~INFRA-004: AR cleanup policy + delete unused repo~~ DONE
- Added cleanup policies (keep 10 recent, delete >30 days) to both `cloud-run-source-deploy` repos
- Deleted unused `anchor-hub-repo` (1 GB freed)

### ~~INFRA-005: Move Vertex AI to same region as Cloud Run~~ DONE
- Changed hardcoded fallback from `us-east4` to `us-central1` in `ai.js` and `imagen.js`
- Updated `.env.example` to match

### ~~INFRA-006: Delete unused OPEN_AI_API_KEY secret~~ DONE

## Code Tasks — ALL COMPLETE (Session 13)

### ~~CODE-001: Optimize Dockerfile~~ DONE
- Switched production stage to `node:20-bullseye-slim`, removed build tools, copy pre-built `node_modules`

### ~~CODE-002: Silence console.log in production~~ DONE
- Frontend: `esbuild.drop: ['console', 'debugger']` in vite.config.mjs
- Server: `console.log = () => {}` in production (preserves error/warn)
- Simpler than full structured logging migration; achieves same Cloud Logging cost reduction

### ~~CODE-003: Update cloudbuild.yaml~~ DONE
- Fixed _PROJECT_ID (`anchor-hub-480305`), _AR_REPO (`cloud-run-source-deploy`), --memory (`512Mi`)

---

## Task Platform Upgrade — Phase 0: Bug Fixes & Cleanup

### TM-001: Fix status string mismatches in reports and daily overview
- **Phase**: 0
- **Files affected**: `server/routes/tasks.js` (lines 1085-1090, 2817)
- **Depends on**: None
- **Risk**: LOW
- **Scope**: S
- **Agent**: backend-specialist
- **How to validate**: `yarn build` + manual check that board reports show correct status counts
- **Status**: DONE

### TM-002: Fix `selectedItem` → `activeItem` reference in TaskManager
- **Phase**: 0
- **Files affected**: `src/views/tasks/TaskManager.jsx` (line 375)
- **Depends on**: None
- **Risk**: LOW
- **Scope**: S
- **Agent**: frontend-specialist
- **How to validate**: `yarn build` + archive open item, verify drawer closes
- **Status**: DONE

### TM-003: Fix `handleToggleGlobalAutomation` undeclared state reference
- **Phase**: 0
- **Files affected**: `src/views/tasks/TaskManager.jsx` (line 965)
- **Depends on**: None
- **Risk**: LOW
- **Scope**: S
- **Agent**: frontend-specialist
- **How to validate**: `yarn build` + toggle global automation, verify no ReferenceError
- **Status**: DONE

### TM-004: Remove dead state variables and orphaned reports pane code
- **Phase**: 0
- **Files affected**: `src/views/tasks/TaskManager.jsx` (lines 233-234, ~280 lines of reports pane)
- **Depends on**: None
- **Risk**: LOW
- **Scope**: S
- **Agent**: frontend-specialist
- **How to validate**: `yarn build`
- **Status**: DONE

### TM-005: Add ClickAwayListener to BoardTable people picker
- **Phase**: 0
- **Files affected**: `src/views/tasks/components/BoardTable.jsx`
- **Depends on**: None
- **Risk**: LOW
- **Scope**: S
- **Agent**: frontend-specialist
- **How to validate**: `yarn build` + click outside people picker, verify it closes
- **Status**: DONE

### TM-006: Add 5 missing database indexes
- **Phase**: 0
- **Files affected**: `server/sql/init.sql` or new migration file
- **Depends on**: None
- **Risk**: LOW
- **Scope**: S
- **Agent**: backend-specialist
- **Details**: `task_item_assignees(user_id)`, `task_items(group_id, archived_at)`, `task_items(due_date)`, `task_items(created_by)`, `task_updates(created_at)`
- **How to validate**: `yarn build` + verify indexes exist via psql
- **Status**: DONE

### TM-007: Deduplicate shared constants (DEFAULT_STATUS_LABELS, getStatusColor, fmtMinutes)
- **Phase**: 0
- **Files affected**: `src/views/tasks/TaskManager.jsx`, `src/views/tasks/components/BoardTable.jsx`, `src/views/tasks/panes/MyWorkPane.jsx`, `src/views/tasks/panes/BillingPane.jsx` + new constants file
- **Depends on**: None
- **Risk**: LOW
- **Scope**: S
- **Agent**: frontend-specialist
- **How to validate**: `yarn build`
- **Status**: DONE

### TM-008: Convert raw Dialogs in BoardTable and Sidebar to shared components
- **Phase**: 0
- **Files affected**: `src/views/tasks/components/BoardTable.jsx`, `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx`
- **Depends on**: None
- **Risk**: LOW
- **Scope**: M
- **Agent**: frontend-specialist
- **How to validate**: `yarn build` + verify dialogs still work (archive item, delete group, create workspace/board)
- **Status**: DONE

---

## Task Platform Upgrade — Phase 1: Decomposition & Foundation

### TM-009: Decompose TaskManager.jsx into hooks and sub-components
- **Phase**: 1
- **Files affected**: `src/views/tasks/TaskManager.jsx` → extract ~10 hooks + 4 components
- **Depends on**: TM-002, TM-003, TM-004, TM-007
- **Risk**: MEDIUM
- **Scope**: XL
- **Agent**: frontend-specialist
- **Details**: Extract useBoardView, useItemDrawer, useItemUpdates, useItemTimeTracking, useItemFiles, useItemSubitems, useAutomations, useStatusLabels hooks. Extract ItemDrawer, AutomationsDrawer, EditAutomationDialog, StatusLabelsDialog components.
- **How to validate**: `yarn build` + all board/drawer/pane functionality works
- **Spec**: `docs/refactoring/architecture/task-specs/tm-009-taskmanager-decomposition.md`
- **Status**: DONE

### TM-010: Introduce TaskContext for shared state
- **Phase**: 1
- **Files affected**: New `src/contexts/TaskContext.jsx`; modified `TaskManager.jsx`, `TaskSidebarPanel.jsx`, `AutomationsPane.jsx`, `BillingPane.jsx`, route config
- **Depends on**: TM-009
- **Risk**: MEDIUM
- **Scope**: L
- **Agent**: frontend-specialist
- **Details**: React Context holding workspaces, boardsByWorkspace, allBoards, workspaceMembers, statusLabels, active selections. Eliminates 5+ duplicate `fetchTaskBoardsAll()`/`fetchTaskBoards()` calls across components. Provides mutators (addBoard, removeBoard, etc.) for consistent state after CRUD. URL-derived activeWorkspaceId/activeBoardId.
- **How to validate**: `yarn build` + verify no duplicate API calls in network tab
- **Spec**: `docs/refactoring/architecture/task-specs/tm-010-task-context.md`
- **Status**: DONE

### TM-011: Add pagination to backend list endpoints
- **Phase**: 1
- **Files affected**: `server/routes/tasks.js`, `src/api/tasks.js`, `src/views/tasks/TaskManager.jsx`
- **Depends on**: TM-006
- **Risk**: MEDIUM
- **Scope**: L
- **Agent**: backend-specialist
- **Details**: Cursor-based pagination for updates/files/time-entries (default 20, `before` cursor). Offset-based pagination for board view items (default 500, `limit`/`offset`). All params optional with backward-compatible defaults. "Load More" UI for sub-resources. Banner for large boards.
- **How to validate**: `yarn build` + verify API returns paginated results, test with 600-item board
- **Spec**: `docs/refactoring/architecture/task-specs/tm-011-pagination.md`
- **Status**: DONE

### TM-012: Add missing CRUD endpoints (group rename, file delete, time entry edit/delete, update edit/delete)
- **Phase**: 1
- **Files affected**: `server/routes/tasks.js`, `src/api/tasks.js`, `src/views/tasks/components/BoardTable.jsx`, `src/views/tasks/TaskManager.jsx`
- **Depends on**: None
- **Risk**: LOW
- **Scope**: M
- **Agent**: backend-specialist
- **Details**: 7 new endpoints: PATCH `/groups/:id` (rename/reorder), DELETE `/files/:id` (+ GCS cleanup), PATCH/DELETE `/time-entries/:id` (creator or admin), PATCH/DELETE `/updates/:id` (creator for edit, creator+admin for delete). 6 new API client methods. UI: inline group rename, edit/delete icons for files/time/comments with ConfirmDialog.
- **How to validate**: `yarn build` + test each endpoint, verify permission checks
- **Spec**: `docs/refactoring/architecture/task-specs/tm-012-missing-crud.md`
- **Status**: DONE

### TM-013: Virtualize BoardTable
- **Phase**: 1
- **Files affected**: `src/views/tasks/components/BoardTable.jsx`, `package.json`
- **Depends on**: TM-009
- **Risk**: MEDIUM
- **Scope**: L
- **Agent**: frontend-specialist
- **Details**: Replace `.map()` rendering with `@tanstack/react-virtual` (~5KB). Flatten groups+items into virtual list. React.memo on ItemRow. Lazy-mount Select (status picker) only on click — saves N×M MenuItem instances. Lazy `loading="lazy"` on Avatar images. Target: 100-item initial render from ~800ms to ~50ms, 60fps scroll.
- **How to validate**: `yarn build` + test with 200+ item board, verify smooth scrolling, DevTools Performance tab
- **Spec**: `docs/refactoring/architecture/task-specs/tm-013-boardtable-virtualization.md`
- **Status**: DONE

---

## Task Platform Upgrade — Phase 2: Automation Engine + RBAC (Specs Required)

### ~~TM-014: Event Bus Architecture~~ DONE
- **Phase**: 2
- **Files affected**: New `server/services/taskEventBus.js`, `server/services/taskEventSubscribers.js`, `server/sql/task-events.sql`; modified `server/routes/tasks.js`, `server/index.js`
- **Depends on**: TM-009
- **Risk**: LOW
- **Scope**: L
- **Agent**: backend-specialist
- **Details**: In-process EventEmitter with DB-backed `task_events` table. 35 event types covering all mutations. Subscriber pattern for automations + activity log. Feature-flagged via `TASK_EVENT_BUS_ENABLED`. All 35 mutation endpoints instrumented with `emitTaskEvent()`. 5 existing direct side-effect calls guarded behind `!EVENT_BUS_ENABLED`.
- **Spec**: `docs/refactoring/architecture/task-specs/tm-014-event-bus.md`
- **Status**: DONE

### ~~TM-015: Spec — Rule Engine Upgrade~~ SUPERSEDED by TM-015v2
- **Status**: SUPERSEDED
- **Note**: Original spec proposed 8 triggers, 15 actions, basic if/else. Replaced by TM-015v2 which adds fan-in/fan-out, delay blocks, AND/OR conditions, workspace scope, templates.

### TM-015v2: Spec — Automation Engine v2
- **Phase**: 2
- **Files affected**: See sub-tasks below (TM-015v2a through TM-015v2d)
- **Depends on**: TM-014
- **Risk**: N/A (spec only)
- **Scope**: XL
- **Agent**: task-manager
- **Details**: Enterprise-grade automation engine. 15 triggers (inc. fan-in `all_subitems_completed`), 22 actions (inc. `delay`, `stop_chain`), AND/OR condition groups, multi-step chains with if/else/delay, 3 scope levels (board/workspace/global), circuit breaker, ~15 pre-built templates.
- **Spec**: `docs/refactoring/architecture/task-specs/tm-015v2-automation-engine.md`
- **Status**: SPEC WRITTEN

#### ~~TM-015v2a: Event Bus Subscribers for New Triggers~~ DONE
- **Phase**: 2B (after TM-014)
- **Files affected**: `server/services/taskEventSubscribers.js`, new `server/services/ruleEngine.js`
- **Depends on**: TM-014
- **Risk**: LOW
- **Scope**: M
- **Agent**: backend-specialist
- **Details**: Refactored subscribers to use `TRIGGER_EVENT_MAP` pattern routing all 12 event-driven trigger types through `ruleEngine.evaluateRules()`. Created `ruleEngine.js` stub that delegates `status_change` and `assignee_added` to existing automation functions; new triggers are no-ops pending TM-015v2b. Removed direct imports of `runEventAutomationsForItemChange`/`runEventAutomationsForAssigneeAdded` from subscribers.
- **How to validate**: `yarn build` + `node --check server/services/ruleEngine.js`
- **Status**: DONE

#### TM-015v2b: Rule Engine Core — Multi-Step Chains + Conditions
- **Phase**: 2B
- **Files affected**: New `server/services/ruleEngine.js`, `server/services/conditionEvaluator.js`, `server/services/templateVariables.js`, `server/sql/task-automation-steps.sql`, `server/sql/task-automation-quota.sql`; modified `server/services/taskAutomations.js`, `server/routes/tasks.js`, `src/api/tasks.js`
- **Depends on**: TM-015v2a
- **Risk**: MEDIUM
- **Scope**: XL
- **Agent**: backend-specialist
- **Details**: Core engine rewrite. `ruleEngine.evaluateRules()` matches rules across 3 scopes (board, workspace, global), builds execution context, runs multi-step chains. `task_automation_steps` table with `step_type` (action/if/else/delay), `parent_step_id` for nesting, `condition_group` JSONB. AND/OR condition evaluation with 12 operators. Template variable interpolation. Monthly quota via `task_automation_quota`. Circuit breaker (5 errors → auto-disable). Legacy single-action rules continue to work (no steps = direct execute). Step CRUD API endpoints (GET/POST steps, PATCH/DELETE step, reorder, quota).
- **How to validate**: `yarn build` + create multi-step automation with if/else → trigger → verify steps execute in order with correct branching
- **Status**: NOT STARTED

#### TM-015v2c: New Action Types
- **Phase**: 2B
- **Files affected**: `server/services/taskAutomations.js` (executeAction dispatcher)
- **Depends on**: TM-015v2b
- **Risk**: MEDIUM
- **Scope**: L
- **Agent**: backend-specialist
- **Details**: Implement 17 new action types in `executeAction()`: `move_item_to_group`, `move_item_to_board` (permission check), `create_item`, `duplicate_item`, `create_subitem`, `send_email` (Mailgun), `archive_item`, `assign_person`, `start_time_tracking`, `trigger_webhook` (HMAC-SHA256, 10s timeout), `remove_assignee`, `set_due_date` (absolute/relative), `set_priority`, `notify_person` (by ID or role), `create_update_on_item` (cross-item), `delay` (creates delayed_run), `stop_chain`. Each action increments quota and emits event with `actor_type: 'automation'`.
- **How to validate**: `yarn build` + test each action type individually via automation trigger
- **Status**: NOT STARTED

#### TM-015v2d: Fan-In Triggers + Delay Blocks
- **Phase**: 2C
- **Files affected**: New `server/sql/task-workflow-runs.sql`, `server/sql/task-automation-delayed-runs.sql`; modified `server/services/taskAutomations.js`, `server/services/ruleEngine.js`, `server/index.js` (cron), `server/routes/tasks.js` (runs endpoint)
- **Depends on**: TM-015v2b, TM-015v2c
- **Risk**: MEDIUM
- **Scope**: L
- **Agent**: backend-specialist
- **Details**: `all_subitems_completed` trigger: on every `subitem.updated` event, query whether all non-archived subitems of parent item have `is_done_state` status → fire trigger if zero remaining. `all_assignees_completed` same logic. `task_workflow_runs` table tracks chain execution progress (running/success/partial/error/delayed/halted/skipped). `task_automation_delayed_runs` table for delay blocks: on `delay` action, snapshot context + schedule `resume_at`. Cron job (every 60s) processes pending delayed runs: verify item still exists, resume chain. Auto-cancel on item archive/delete. `GET /automations/:id/runs` endpoint. `POST /automations/:id/test` dry-run endpoint.
- **How to validate**: `yarn build` + create fan-in workflow (subitems → parent advance) + create delay workflow (action → wait → action)
- **Status**: NOT STARTED

#### TM-015v2e: Frontend — Step Builder + Condition Builder
- **Phase**: 2D
- **Files affected**: New `src/views/tasks/components/StepBuilder.jsx`, `src/views/tasks/components/ConditionBuilder.jsx`; modified `src/views/tasks/panes/AutomationsPane.jsx`, `src/views/tasks/components/EditAutomationDialog.jsx`
- **Depends on**: TM-015v2b (API endpoints must exist)
- **Risk**: MEDIUM
- **Scope**: L
- **Agent**: frontend-specialist
- **Details**: Two-tier UI: Simple mode (current, enhanced with new trigger/action dropdowns) + Advanced mode (step builder). Step builder: ordered list of steps, each shows order# + condition badge + action type + config summary. Add/remove/reorder steps. If/else blocks indent children. Condition builder: "Match ALL/ANY" toggle + rows of field/operator/value dropdowns. 12 operators, evaluable fields as dropdown options. Template variable insert helper button.
- **How to validate**: `yarn build` + create multi-step automation with conditions via UI → verify steps save correctly
- **Status**: NOT STARTED

#### TM-015v2f: Frontend — Templates + Execution History
- **Phase**: 2D
- **Files affected**: New `src/views/tasks/components/TemplatePickerDialog.jsx`, `server/services/automationTemplates.js`; modified `src/views/tasks/panes/AutomationsPane.jsx`, `server/routes/tasks.js`
- **Depends on**: TM-015v2e
- **Risk**: LOW
- **Scope**: M
- **Agent**: frontend-specialist + backend-specialist
- **Details**: ~15 pre-built template recipes (hardcoded JSON definitions, not a DB table). Template picker dialog: browse by category, one-click install with configurable fields (status selectors, group selectors, user selectors). Execution history panel: list workflow runs for an automation with status/timestamp/step progress. Workspace-scope automation creation UI (dropdown to select scope: board/workspace/global).
- **How to validate**: `yarn build` + install template from picker → verify automation created with correct config → trigger and view execution history
- **Status**: NOT STARTED

### TM-016: Spec — Enhanced RBAC
- **Phase**: 2
- **Files affected**: New `server/sql/task-roles.sql`, `server/middleware/taskPermissions.js`, `src/views/tasks/components/RolesDialog.jsx`; modified `server/routes/tasks.js`, `server/index.js`, `src/views/tasks/TaskManager.jsx`, `src/views/tasks/components/BoardTable.jsx`, `src/api/tasks.js`
- **Depends on**: TM-014
- **Risk**: N/A (spec only)
- **Scope**: L
- **Agent**: task-manager
- **Details**: 4 new tables (`task_roles`, `task_role_permissions`, `task_user_role_assignments`, `task_column_visibility`). 12 permission keys across workspace/board scopes. Column-level visibility (visible/read_only/hidden). Custom role builder UI. 3 system roles auto-seeded. Deny-by-default with staff auto-pass backward compat.
- **Spec**: `docs/refactoring/architecture/task-specs/tm-016-enhanced-rbac.md`
- **Status**: SPEC WRITTEN

---

## Task Platform Upgrade — Phase 3: Views & Cross-Board (Specs Required)

### TM-017: Spec — Board Views (Kanban, Timeline, Calendar)
- **Phase**: 3
- **Files affected**: New `server/sql/task-board-views.sql`, `src/views/tasks/components/KanbanView.jsx`, `KanbanColumn.jsx`, `KanbanCard.jsx`, `TimelineView.jsx`, `CalendarView.jsx`, `ViewSwitcher.jsx`; modified `server/routes/tasks.js`, `src/views/tasks/TaskManager.jsx`, `src/views/tasks/components/BoardHeader.jsx`, `src/api/tasks.js`
- **Depends on**: TM-009, TM-013
- **Risk**: N/A (spec only)
- **Scope**: XL
- **Agent**: task-manager
- **Details**: 3 new views: Kanban (drag-drop via @dnd-kit), Timeline/Gantt (custom SVG, zoom day/week/month/quarter), Calendar (month/week). View preferences persisted per-user per-board. Saved view presets. New npm deps: `@dnd-kit/core`, `@dnd-kit/sortable`.
- **Spec**: `docs/refactoring/architecture/task-specs/tm-017-board-views.md`
- **Status**: SPEC WRITTEN

### TM-018: Spec — Board Connections & Dependencies
- **Phase**: 3
- **Files affected**: New `server/sql/task-item-links.sql`, `server/sql/task-item-dependencies.sql`, `src/views/tasks/components/ItemLinksSection.jsx`, `ItemDependenciesSection.jsx`, `LinkItemSearch.jsx`; modified `server/routes/tasks.js`, `server/services/taskEventSubscribers.js`, `src/views/tasks/TaskManager.jsx`, `src/views/tasks/components/BoardTable.jsx`, `src/api/tasks.js`
- **Depends on**: TM-014, TM-017
- **Risk**: N/A (spec only)
- **Scope**: L
- **Agent**: task-manager
- **Details**: Item-to-item links (related/blocks/blocked_by/duplicate) with auto-inverse for blocks. Finish-to-start dependencies with cycle detection (BFS). Advisory enforcement in v1 (warnings, not hard-blocks). 6 new event types. Timeline view dependency arrows (Phase C). Mirror columns deferred.
- **Spec**: `docs/refactoring/architecture/task-specs/tm-018-connections-dependencies.md`
- **Status**: SPEC WRITTEN

---

## Task Platform Upgrade — Phase 4: Dashboards & Collaboration (Specs Required)

### TM-019: Spec — Dashboard Widget Engine
- **Phase**: 4
- **Files affected**: New `server/sql/task-dashboards.sql`, `src/views/tasks/panes/DashboardPane.jsx`, `src/views/tasks/components/widgets/NumberWidget.jsx`, `BatteryWidget.jsx`, `ChartWidget.jsx`, `TableWidget.jsx`, `TimelineWidget.jsx`, `WidgetConfigPanel.jsx`; modified `server/routes/tasks.js`, `src/views/tasks/TaskManager.jsx`, `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx`, `src/api/tasks.js`
- **Depends on**: TM-014, TM-017
- **Risk**: N/A (spec only)
- **Scope**: XL
- **Agent**: task-manager
- **Details**: 5 widget types: Chart (bar/line/pie/stacked/donut via Recharts), Number (KPI with comparison), Battery (status distribution), Table (filtered items), Timeline (mini Gantt). 12-column responsive grid layout via `react-grid-layout`. Workspace-scoped dashboards. Widget data API with aggregation queries. Board-level permission filtering.
- **Spec**: `docs/refactoring/architecture/task-specs/tm-019-dashboard-widgets.md`
- **Status**: SPEC WRITTEN

### TM-020: Spec — Audit Log + Enhanced Time Tracking
- **Phase**: 4
- **Files affected**: New `server/sql/task-time-tracking-enhanced.sql`, `src/views/tasks/panes/AuditLogPane.jsx`, `src/views/tasks/components/TimePolicyDialog.jsx`, `RateCardDialog.jsx`; modified `server/routes/tasks.js`, `server/index.js`, `src/views/tasks/TaskManager.jsx`, `src/views/tasks/panes/BillingPane.jsx`, `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx`, `src/api/tasks.js`
- **Depends on**: TM-014
- **Risk**: N/A (spec only)
- **Scope**: L
- **Agent**: task-manager
- **Details**: Unified audit log UI reading from `task_events` (TM-014). Time entry PATCH/DELETE + approval workflow (pending/approved/rejected). Board-level time policies (require time before completion, min/max, lockout). Rate cards with cascading resolution (user+board → user → board → workspace). Human-readable event descriptions for 35 event types.
- **Spec**: `docs/refactoring/architecture/task-specs/tm-020-audit-time-tracking.md`
- **Status**: SPEC WRITTEN
