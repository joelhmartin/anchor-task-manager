---
schema_version: 2
---

# Task Manager Polish — State

Routine A reads this file for the queue and known_issues only. Merge state lives in GitHub (Routine A's Step 0 queries `gh pr list` for open and merged polish PRs). There is no automated review/merge routine — the user reviews and merges manually.

See the full aspect spec in `docs/refactoring/task-manager-aspects.md`.

## queue

Aspects to work through, in order. Routine A picks the first item not already merged on GitHub. Remove items as they merge if you want to keep this list tidy (cosmetic — Routine A filters by merged state regardless).

- phase-1-transactions
- phase-1-pagination
- phase-1-response-shape
- phase-2-aria-labels
- phase-2-toast-on-mutations
- phase-2-theme-tokens
- phase-2-tooltips-truncated
- phase-2-loading-empty-error
- phase-2-confirm-dialogs
- phase-3-comments-threading
- phase-3-files-delete-preview
- phase-3-subitems-ui
- phase-3-activity-tab
- phase-3-inline-edit
- phase-3-follow-subscribe
- phase-4-bulk-select
- phase-4-saved-views
- phase-4-group-by
- phase-4-timeline-virt
- phase-4-calendar-refactor
- phase-5-notifications-bell
- phase-5-email-digest
- phase-5-ai-expansion
- phase-6-automations-uxpolish
- phase-6-stubbed-actions
- phase-6-test-mode
- phase-6-circular-deps
- phase-6-recurrence-builder
- phase-7-timer
- phase-7-invoice
- phase-7-chart-widgets
- phase-7-dashboard-sharing
- phase-8-mobile
- phase-8-shortcuts-cmdk
- phase-8-performance
- phase-8-logging
- phase-8-templates-import
- phase-9-print-pdf
- phase-9-share-links

## known_issues

Deferred items discovered during runs. Each line prefixed with the aspect slug that surfaced it. Format: `- [{discovering-aspect}] {description}`.

- [phase-1-soft-delete-audit] JOIN-side `task_items` references in `server/routes/tasks.js` don't filter `archived_at` on the joined side: mirror data link targets (5490/5500/5572/5586), time-tracking aggregates (5044/5099/5114/5130), calendar events (5379). Behavior change is non-trivial in some places (billing/time reports may want archived history) — needs a dedicated pass scoped beyond the spec's `FROM` grep.
- [phase-1-soft-delete-audit] AI summary refresh endpoint (`server/routes/tasks.js:3000` `buildItemUpdateContext`) does not short-circuit when the item is archived. Out of scope for the soft-delete audit but should be guarded.
- [phase-1-soft-delete-audit] PATCH `/automations/:automationId` (`server/routes/tasks.js:2493/2496`) inherits the same unfiltered lookup as DELETE so the update path silently accepts edits on archived rules. Split the lookups or guard PATCH.
- [phase-1-soft-delete-audit] `?includeArchived=true` is wired server-side on four list endpoints but the admin UI doesn't expose it yet. Surface an "Archived" toggle / pane in `src/views/tasks/` for board view, automations, and the subitems drawer.
- [phase-1-soft-delete-audit] `?includeArchived=true` privileged accesses (allowed and denied) are not logged to `security_events`. Per HIPAA compliance, access to soft-deleted PHI-adjacent records should be audit-trailed. Implement async `security_events` inserts for both the 403 denial and the allowed path across all four endpoints in `server/routes/tasks.js`.
- [phase-1-pagination] Additional unbounded list endpoints in `server/routes/tasks.js` not covered by the 4 spec findings: `GET /workspaces` (553), `GET /workspaces/:workspaceId/members` (647), `GET /boards` (922), `GET /workspaces/:workspaceId/boards` (901), `GET /boards/:boardId/status-labels` (1060), `GET /status-labels/global` (1122), `GET /items/:itemId/labels` (1483), `GET /boards/:boardId/automations` (2428), `GET /webhooks` (4918), `GET /rate-cards` (5048), `GET /workload` (5180), `GET /audit-log/event-types` (5492), `GET /boards/:boardId/mirror-columns` (5510), `GET /automations/:automationId/steps` (4346), `GET /automations/runs/:runId/steps` (4619). All should accept `?limit=` / `?offset=` and return `meta`. Out of scope per the aspect's 4-endpoint scope.
- [phase-1-pagination] `GET /api/tasks/dashboards` (`server/routes/tasks.js:6100`) does NOT call `assertWorkspaceAccess` before returning `task_dashboards` rows for the supplied `workspace_id` — any authenticated staff user can read any workspace's dashboard list by passing the right `workspace_id`. The companion `GET /api/tasks/labels` does check, so this is an inconsistency, not by design. Add the same `assertWorkspaceAccess` guard. Out of scope for pagination but flagged here so it lands in an auth-audit aspect.
- [phase-1-response-shape] Wholesale envelope migration of the remaining ~95 task-manager endpoints. This PR established the convention (`respondOk` / `respondCreated` / `respondError` in `server/services/responseEnvelope.js`, `unwrapData` shim in `src/api/responseEnvelope.js`) and migrated the 4 cited examples (one of each legacy shape). The remaining endpoints across `server/routes/tasks.js` still emit named-key shapes (`{ workspaces: rows }`, `{ workspace: rows[0] }`, `{ ok: true }`, `{ success: true }`, `{ board: ... }`, `{ item: ... }`, etc.). Each migration is mechanical: swap the `res.json({ named: x })` for `respondOk(res, x)` server-side, and swap the matching `res.data.named` for `unwrapData(res, { legacyKey: 'named' })` in `src/api/tasks.js`. Should be done in chunks by resource (workspaces, boards, groups, items, subitems, automations, dashboards, etc.) so each chunk stays reviewable.
- [phase-1-response-shape] Error response shape (`{ message: '...' }`) is unchanged. The new envelope spec calls for `{ error: { code, message } }`, but migrating it would ripple through every frontend error handler (toasts, retries, form validation) since the existing `err.response.data.message` reads are everywhere. Migrate alongside (not before) a frontend-side `unwrapError(err)` shim that reads both shapes. Until then, `respondError` is unused — keep the helper available for the migration but don't deploy it yet.
- [phase-1-response-shape] Status code consistency: a handful of mutation endpoints return 200 for create (should be 201). Document this in API_REFERENCE.md or fix as part of the per-resource migration chunks above.
- [phase-2-theme-tokens] Hardcoded `rgba(255,255,255,0.7)` / `rgba(255,255,255,...)` whites remain in `FilterBar.jsx` (status/label chip delete-icon color) and `LabelPicker.jsx` (`LabelChips` delete-icon hover). These are alpha-whites, not hex, so they're outside this aspect's `#[0-9a-f]{3,6}` grep and were left as-is. Low-value follow-up: swap for `alpha(theme.palette.common.white, 0.7)` for full theme-token consistency.
