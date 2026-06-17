# Task Manager Polish — Aspect Spec

The iterative polish routine works through these 40 aspects, one per run, one PR each. Routine A reads this file to look up the spec for whatever `next_aspect` is in `.routines/task-manager-state.md`.

Each aspect has:
- **Scope** — what the aspect covers
- **Findings** — concrete `file_path:line_number` references from the original audit
- **Done when** — definition of done for the PR

Before any aspect runs, **Phase 0 critical fixes** below must already be merged to main.

---

## Phase 0 — Critical Fixes (manual, before routine starts)

These are HIPAA-risk bugs surfaced by the original audit. They are NOT polish — they must be fixed before the routine iterates. Recommend one focused PR titled `fix(tasks): close authorization and storage holes before polish routine`.

| # | Bug | File | Severity |
|---|-----|------|----------|
| P0.1 | `PATCH /updates/:updateId` has no workspace access check and no creator-or-admin check. Any authenticated user can edit any comment in any workspace. | `server/routes/tasks.js:3108` | HIGH — workspace isolation breach |
| P0.2 | `GET /items/search` runs a global `ILIKE` over `task_items` with no workspace/board filter. Cross-tenant data leak. | `server/routes/tasks.js:5615` | HIGH — cross-account PHI leak |
| P0.3 | `POST /items/:itemId/files` uses `multer.diskStorage` (ephemeral FS on Cloud Run) and has no `fileFilter` for MIME type. Arbitrary file upload + lost-on-restart. | `server/routes/tasks.js:3216`, multer config at `:312` | MEDIUM-HIGH — Cloud Run correctness + malware vector |

---

## Phase 1 — Safety Net

### phase-1-soft-delete-audit

**Scope:** Make `archived_at IS NULL` filtering consistent across every SELECT touching `task_items`, `task_subitems`, and `task_*_automations`.

**Search scope (MUST grep all of these — not just routes):**
- `server/routes/tasks.js`
- `server/services/taskAutomations.js` *(v1 legacy automation engine — still wired alongside v2 — execution paths here have historically been missed)*
- `server/services/ruleEngine.js` *(v2 automation engine)*
- `server/services/taskEventBus.js`
- `server/services/taskRecurrence.js`
- `server/services/taskCleanup.js`
- `server/services/templateVariables.js`

Run this exact grep at the start of the aspect and again before opening the PR:
```bash
grep -nE "FROM task_(items|subitems|board_automations|global_automations)\b" server/routes/tasks.js server/services/*.js
```
Every match must either contain `archived_at IS NULL` in its WHERE clause, or be documented in the PR body as an intentional exception (single-row by-id lookup used in a mutation/restore path, etc.).

**Findings (initial — non-exhaustive, do your own grep):**
- `server/routes/tasks.js:2331` — filter present (use as reference pattern)
- `server/routes/tasks.js:5615` — `/items/search` missing filter (already fixed in P0.2; verify)
- `server/services/taskAutomations.js:42` — `getActiveBoardAutomations` missing filter (archived board automations still execute on events)
- `server/services/taskAutomations.js:53` — `getActiveGlobalAutomations` missing filter (archived global automations still execute on events)
- `server/services/taskAutomations.js:585` — `runDueDateAutomations` board query missing filter (cron fires archived automations every 5 min)
- `server/services/taskAutomations.js:589` — `runDueDateAutomations` global query, same issue

**Categories of "intentional exception" (don't fix, but document):**
- Single-row by-id lookups in mutation/restore paths (PATCH /items/:itemId before-snapshot, archive/restore handlers, etc. — these legitimately need to find archived rows)
- Cleanup cron queries that explicitly target archived rows for purging (`taskCleanup.js`)
- Event-bus context resolvers that should surface metadata even for archived items (debatable — judgment call)

**Done when:**
- Every item/automation read in the search scope above either filters `archived_at IS NULL` or is listed in the PR body's "intentional exceptions" section.
- An explicit `?includeArchived=true` opt-in (admin/superadmin only) exists for admin-facing list views that need to surface archived rows for review/restore.
- The grep above is included in the PR body with a count of remaining matches and a justification for each non-filter match.
- v1 automation execution paths (`getActiveBoardAutomations`, `getActiveGlobalAutomations`, `runDueDateAutomations`) no longer fire archived automations.

### phase-1-transactions

**Scope:** Wrap multi-step writes in `BEGIN/COMMIT/ROLLBACK` using `db.getClient()`.

**Findings:**
- `server/routes/tasks.js:2029` — item create + `emitTaskEvent` (two writes)
- `server/routes/tasks.js:2354` — automation create + event emit
- `server/services/taskRecurrence.js:15-51` — recurring item + assignees + labels (three INSERTs)

**Done when:**
- Every multi-statement write either runs in a single transaction or has documented idempotent recovery.
- Failures roll back cleanly; no orphaned rows.

### phase-1-pagination

**Scope:** Add `LIMIT` (default 100) and cursor or offset support to unbounded list endpoints.

**Findings:**
- `server/routes/tasks.js:1317` — `GET /labels`
- `server/routes/tasks.js:5909` — `GET /dashboards`
- `server/routes/tasks.js:2561` — `GET /automations/global`
- `server/routes/tasks.js:2622` — `GET /automations/runs`

**Done when:**
- Every list endpoint accepts `?limit=` and `?cursor=` (or `?offset=`), capped at 500.
- Default response includes a `nextCursor` or `total` in the response meta.
- Frontend list views still work after the response shape additions.

### phase-1-response-shape

**Scope:** Normalize endpoint response shapes. Current state has at least four different shapes for analogous endpoints.

**Findings:**
- `server/routes/tasks.js:486` returns `{ workspaces: rows }`
- `server/routes/tasks.js:533` returns `{ workspace: rows[0] }`
- `server/routes/tasks.js:565` returns `{ ok: true }`
- `server/routes/tasks.js:1246` returns `{ success: true }`

**Done when:**
- Every endpoint returns `{ data, meta?, error? }` consistently.
- Frontend client modules have a one-time shim handling the transition.
- Document the new convention in `docs/API_REFERENCE.md`.

---

## Phase 2 — Cross-Cutting Frontend Polish

### phase-2-aria-labels

**Scope:** Add `aria-label` to every icon-only button, drag handle, chevron, and color swatch in the task manager. Audit found only ONE `aria-label` in the entire surface.

**Findings:**
- `src/views/tasks/components/ConditionBuilder.jsx:97` — the only existing aria-label (reference pattern)
- `src/views/tasks/components/BoardTable.jsx:839` — delete IconButton, no label
- `src/views/tasks/components/ItemDrawer.jsx:305-312` — label add button has `title` but no `aria-label`
- `src/views/tasks/components/TimelineView.jsx` — collapse/expand chevrons
- `src/views/tasks/components/StatusLabelsDialog.jsx:53` — color picker swatches

**Done when:**
- axe DevTools reports zero "Buttons must have discernible text" violations on the main task views (Boards, ItemDrawer, AutomationsPane).

### phase-2-toast-on-mutations

**Scope:** Per CLAUDE.md, every state-changing action shows a toast on success AND failure. Several hooks suppress feedback today.

**Findings:**
- `src/views/tasks/hooks/useBoardView.js:119` — create group no toast
- `src/views/tasks/hooks/useBoardView.js:147` — create item, error path only
- `src/views/tasks/hooks/useBoardView.js:257` — archive item, console.error not toast
- `src/views/tasks/hooks/useItemUpdates.js` — AI summary refresh missing success toast
- `src/views/tasks/hooks/useStatusLabels.js:23, 40, 54, 66, 85` — 5 console.error calls instead of toast

**Done when:**
- Every `await api.something()` in `src/views/tasks/hooks/*` is followed by both a success and failure toast.
- `console.error` only used for genuinely unexpected errors that also surface to the user via toast.

### phase-2-theme-tokens

**Scope:** Replace hardcoded hex colors with theme tokens or `BRAND_COLORS` from `src/constants/brandColors.js`.

**Findings:**
- `src/views/tasks/components/TimelineView.jsx:190` — `bgcolor: '#00c875'`
- `src/views/tasks/components/TimelineView.jsx:817, 912` — `bgcolor: '#9e9e9e'`
- `src/views/tasks/components/FlowBuilder.jsx:77, 123, 186` — green/blue
- `src/views/tasks/components/FilterBar.jsx:75, 107` — chip colors

**Done when:**
- `grep -E '#[0-9a-f]{3,6}' src/views/tasks/` returns only theme helper definitions or comments.
- Dark mode still renders correctly (test by toggling).

### phase-2-tooltips-truncated

**Scope:** Every `noWrap` Typography that may truncate must expose full text via `Tooltip` or `title`.

**Findings:**
- `src/views/tasks/components/BoardTable.jsx:88, 223, 764` — item names truncate, no tooltip
- `src/views/tasks/components/TimelineView.jsx:521, 553` — names in timeline bars
- `src/views/tasks/components/FlowBuilder.jsx:79, 128` — trigger/action summaries
- `src/views/tasks/panes/AuditLogPane.jsx:91, 116` — some have `title`, others don't

**Done when:**
- Every `noWrap` Typography in task views has a Tooltip wrapper or `title` attribute.
- The pattern is consistent (pick one: Tooltip everywhere or title everywhere).

### phase-2-loading-empty-error

**Scope:** Every async view has three distinct UI states: loading, empty, error. Use the shared `EmptyState`, `LoadingButton`, and MUI `Skeleton` per CLAUDE.md.

**Findings:**
- `src/views/tasks/components/ItemDrawer.jsx` — tab content has no inner loading state
- `src/views/tasks/components/BoardTable.jsx` — no EmptyState in grid mode
- `src/views/tasks/components/TimelineView.jsx` — raw CircularProgress, no skeleton bars
- `src/views/tasks/panes/AutomationsPane.jsx:900+` — no per-step skeleton in runs panel

**Done when:**
- Every async view renders skeleton/spinner during load, EmptyState when empty, error toast + retry CTA on failure.

### phase-2-confirm-dialogs

**Scope:** Every destructive action goes through `ConfirmDialog` (from `src/ui-component/extended/ConfirmDialog`).

**Findings:**
- `src/views/tasks/components/ItemDrawer.jsx:400-411` — link chip delete is instant
- `src/views/tasks/panes/AutomationsPane.jsx:105+` — delete automation, no confirm
- `src/views/tasks/components/StatusLabelsDialog.jsx` — label delete

**Done when:**
- All destructive actions in task views go through ConfirmDialog with appropriate `severity` and clear consequence text.

---

## Phase 3 — Item Drawer

### phase-3-comments-threading

**Scope:** Add threaded replies to task updates + replace email-regex mention parsing with a real user picker.

**Findings:**
- Schema needs `parent_update_id UUID NULL REFERENCES task_updates(id)` — add via migration.
- `server/routes/tasks.js:359-365` — current email-regex mention extraction
- `src/views/tasks/hooks/useItemUpdates.js:44-110` — mention state machine is solid for autocomplete; swap email-based for `@user_id`-based mentions resolved server-side.

**Done when:**
- A comment can reply to another comment; the UI renders one level of nesting (or full tree — pick one and document).
- @-typing opens a workspace member picker dropdown.
- Notification fanout still works for both top-level mentions and replies.

### phase-3-files-delete-preview

**Scope:** Files tab gets delete button, image/PDF preview, and migrates to persistent storage.

**Findings:**
- `src/views/tasks/components/ItemDrawer.jsx:697-704` — upload exists, no delete UI
- `server/routes/tasks.js:3253` — DELETE backend already exists
- `server/routes/tasks.js:312` — multer disk storage (Cloud Run ephemeral FS issue, per CLAUDE.md gotcha #6)

**Done when:**
- Files tab has delete-with-confirm.
- Inline image/PDF preview (lightbox for images, embedded viewer for PDFs).
- File uploads go to `file_uploads` BYTEA (per CLAUDE.md) or Cloud Storage with signed URLs.

### phase-3-subitems-ui

**Scope:** Surface the existing `useItemSubitems` hook in the item drawer.

**Findings:**
- `src/views/tasks/hooks/useItemSubitems.js` exists with full CRUD.
- ItemDrawer never renders it.
- `server/routes/tasks.js:3280` `GET /items/:itemId/subitems` ready.

**Done when:**
- ItemDrawer has a Subitems tab with create/rename/status/assignees/archive operations.
- Drag-to-reorder subitems within the parent.

### phase-3-activity-tab

**Scope:** Add a per-item Activity tab in the ItemDrawer that surfaces `task_events`.

**Findings:**
- `server/sql/task-events.sql:4` — schema captures every mutation
- No frontend renders this per-item today (AuditLogPane is board-level only).

**Done when:**
- ItemDrawer Activity tab shows an event timeline scoped to that item.
- Each event has actor avatar, human-readable description, and a diff of `old_value` → `new_value` for field changes.

### phase-3-inline-edit

**Scope:** Inline-edit item name + click-to-edit affordances throughout.

**Findings:**
- `src/views/tasks/components/ItemDrawer.jsx:215` — item name is static heading
- `src/views/tasks/components/BoardTable.jsx` — inline cells have no hover affordance

**Done when:**
- Hovering an editable field shows a subtle edit indicator.
- Clicking enters edit mode; Esc cancels; Enter saves.
- Optimistic update; server response reconciles or reverts.

### phase-3-follow-subscribe

**Scope:** Item-level follow/unfollow so users get notifications without being assigned.

**Findings:**
- No `task_item_followers` table currently exists — add via migration.

**Done when:**
- Schema + endpoints exist.
- ItemDrawer has a Follow toggle.
- Following adds the user to notification fanout on updates and status changes.

---

## Phase 4 — Board Views

### phase-4-bulk-select

**Scope:** Multi-select rows in `BoardTable` with a sticky bulk action toolbar.

**Findings:**
- `src/views/tasks/components/BoardTable.jsx` — no select state today

**Done when:**
- Row checkboxes + select-all-in-group.
- Sticky bottom toolbar with Bulk Status, Bulk Assignee, Bulk Label, Bulk Archive.
- Bulk endpoints (new) wrap mutations in transactions.

### phase-4-saved-views

**Scope:** Persist filter sets per user per board.

**Findings:**
- `src/views/tasks/components/FilterBar.jsx` — session-only

**Done when:**
- New `task_board_views` table scoped to (user_id, board_id).
- UI saves/loads filter sets by name; mark one as default.

### phase-4-group-by

**Scope:** Group items by any column (assignee, label, priority, due-date-bucket), not just status.

**Done when:**
- Board header has a Group By selector that re-groups items client-side and persists into the saved view.

### phase-4-timeline-virt

**Scope:** Virtualize `TimelineView` and polish drag-to-reschedule.

**Findings:**
- `src/views/tasks/components/TimelineView.jsx:71-90` — raw SVG positioning, no windowing
- 1,159 lines total; 500+ items would render every SVG row

**Done when:**
- Uses `@tanstack/react-virtual` for row rendering.
- Drag-to-reschedule snaps to day boundaries with visual feedback.
- Dependency arrows update live during drag.

### phase-4-calendar-refactor

**Scope:** Refactor `CalendarView` to use the shared `src/ui-component/extended/Calendar/` component.

**Findings:**
- `src/views/tasks/components/CalendarView.jsx` — 301 lines re-implementing the same grid.

**Done when:**
- `CalendarView.jsx` is a thin adapter over the shared Calendar.
- Drag-to-reschedule works.
- Mobile renders sensibly.

---

## Phase 5 — Notifications & AI

### phase-5-notifications-bell

**Scope:** Notifications bell + panel in the top app bar.

**Findings:**
- `server/services/notifications.js` — backend dispatch exists
- No UI today; only Toast.

**Done when:**
- Nav has a bell with unread count.
- Dropdown panel lists notifications with mark-as-read.
- Click jumps to the relevant item drawer.

### phase-5-email-digest

**Scope:** Email notification templates + per-user digest mode.

**Findings:**
- `server/services/notifications.js:87-108` — bare HTML email construction
- No `task_notification_preferences` table today.

**Done when:**
- `task_notification_preferences` table exists with per-event-type toggles + frequency.
- Templates live in `server/services/emailTemplates/tasks/`.
- Per-user "individual vs daily digest" preference works.

### phase-5-ai-expansion

**Scope:** Expand AI beyond the daily briefing.

**Findings:**
- `server/routes/tasks.js:3859` — `GET /ai/daily-overview` (the only live AI feature)
- `server/routes/tasks.js:91-100` — many AI-action placeholders in the enum, mostly stubbed
- `server/services/ai.js` — AI plumbing

**Done when:**
- At least two new AI features ship (e.g., auto-categorize new items, smart-reply suggestions, weekly digest).
- Gemini call deduplication is in place to control cost.
- Total Vertex spend is tracked per user/day.

---

## Phase 6 — Automations Engine

### phase-6-automations-uxpolish

**Scope:** UX polish for the 1,052-line `AutomationsPane.jsx`.

**Findings:**
- `src/views/tasks/panes/AutomationsPane.jsx:105+` — delete with no confirm
- `src/views/tasks/components/FlowBuilder.jsx:79` — low contrast colors
- Dialogs don't autofocus first input.

**Done when:**
- Destructive actions go through ConfirmDialog.
- Dialogs autofocus the first input.
- Condition builder has aria roles.
- Flow nodes use theme colors.

### phase-6-stubbed-actions

**Scope:** Implement automation actions that are listed in the enum but not in `ruleEngine.js`.

**Findings:**
- `server/routes/tasks.js:91-100` — `actionTypeEnum` lists 23 types
- `server/services/ruleEngine.js` — only ~5 fully implemented in v2
- Stubs to implement: `duplicate_item`, `move_to_board`, `archive_item`, `set_priority`, `set_field` (generic), `send_webhook` (with retry)

**Done when:**
- Every action in the enum either executes correctly or is removed from the enum.
- v1 (`taskAutomations.js`) actions are reachable through v2 routing or marked deprecated.

### phase-6-test-mode

**Scope:** Real dry-run preview for automations.

**Findings:**
- `server/routes/tasks.js:4484` — `POST /automations/:automationId/test` exists but UX is unclear.

**Done when:**
- User picks an item, runs the automation in dry-run, sees a diff of what would change.
- No mutations actually persist.

### phase-6-circular-deps

**Scope:** Reject circular item dependencies on insert.

**Findings:**
- `server/routes/tasks.js:4576` — `POST /items/:itemId/dependencies` has no cycle check.

**Done when:**
- Server detects cycles before insert and returns 409 with the cycle path.
- Frontend surfaces the error clearly.

### phase-6-recurrence-builder

**Scope:** RRULE-style visual recurrence builder.

**Findings:**
- `src/views/tasks/components/ItemDrawer.jsx:445-496` — current simple menu
- `server/services/taskRecurrence.js:58` — `calculateNext`

**Done when:**
- UI supports weekday selector, interval, end condition.
- Respects per-client timezone (per CLAUDE.md project note).

---

## Phase 7 — Time Tracking, Billing, Dashboards

### phase-7-timer

**Scope:** Live start/stop timer UI.

**Findings:**
- `src/views/tasks/hooks/useItemTimeTracking.js` — manual entries only
- `server/services/ruleEngine.js:395-409` — `stop_time_tracking` action exists
- Schema convention: `time_spent_minutes = 0` means an active timer

**Done when:**
- Item drawer + board row both have a start/stop button.
- Only one timer active per user at a time.
- Active timer shows elapsed time in real time.

### phase-7-invoice

**Scope:** PDF invoice / cost-report export from BillingPane.

**Findings:**
- `server/routes/tasks.js:4952` — `GET /billing/cost-report` exists
- `src/views/tasks/panes/BillingPane.jsx` — shows data, no export

**Done when:**
- BillingPane has "Generate Invoice" → PDF export.
- Line items grouped by client/board/period.

### phase-7-chart-widgets

**Scope:** Real chart widgets in dashboards.

**Findings:**
- `src/views/tasks/components/widgets/*.jsx` — KpiNumberWidget, StatusBreakdownWidget exist but most widget types are text-based.
- No pie/bar/line widgets.

**Done when:**
- Pie, bar, line widget types added (use `recharts` if not already in tree — check `package.json` first).
- Each widget configurable with a data query builder.

### phase-7-dashboard-sharing

**Scope:** Dashboard sharing + global date range filter.

**Done when:**
- Shareable read-only link with signed token.
- Global dashboard date picker that all widgets respect.

---

## Phase 8 — Cross-Cutting Infrastructure

### phase-8-mobile

**Scope:** Mobile responsive layout across task views.

**Findings:**
- No mobile-specific breakpoints in BoardTable, KanbanBoard, ItemDrawer per audit.

**Done when:**
- Every task view renders sensibly at 375px width.
- Tables get horizontal scroll with sticky first column.
- ItemDrawer becomes full-screen on mobile.

### phase-8-shortcuts-cmdk

**Scope:** Keyboard shortcuts registry + Cmd+K command palette.

**Done when:**
- Shortcut registry exists with common Monday shortcuts (`n` new, `/` search, `e` open).
- `?` shows a help overlay.
- Cmd+K opens a command palette scoped to task actions.

### phase-8-performance

**Scope:** Performance hot spots — indexes, batching, caching.

**Findings:**
- `server/routes/tasks.js:339-357` — `isDoneStatus` queries status labels per write (uncached)
- `server/routes/tasks.js:374-414` — `notifyMentionedUsers` does O(n) DB calls for permission checks
- Missing composite index on `task_items (group_id, archived_at, updated_at)`

**Done when:**
- Status labels cached per-request (or per-process with invalidation).
- Permission checks batched.
- Missing indexes added via migration.

### phase-8-logging

**Scope:** Structured logging + PHI redaction.

**Findings:**
- `server/services/taskEventBus.js:39`, `server/services/taskRecurrence.js:48`, `server/services/ruleEngine.js:97, 179, 652` — `console.error` lines that may leak metadata

**Done when:**
- Structured logger in place (pino or similar).
- PHI-bearing fields automatically scrubbed.
- `console.error` calls replaced or audited.

### phase-8-templates-import

**Scope:** Board / item templates + CSV import.

**Done when:**
- `task_board_templates` and `task_item_templates` tables + CRUD.
- CSV upload mapper UI.
- "Duplicate this board" action.

---

## Phase 9 — Pro Finish

### phase-9-print-pdf

**Scope:** Print stylesheets + PDF export for board, gantt, item drawer.

**Done when:**
- `@media print` stylesheets exist.
- "Export to PDF" button on board + item drawer.

### phase-9-share-links

**Scope:** Public share links + read-only client view.

**Done when:**
- Signed-URL share links with optional expiration.
- Read-only renderer strips edit affordances.
