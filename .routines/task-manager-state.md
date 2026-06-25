---
schema_version: 2
---

# Task Manager Polish — State

Routine A reads this file for the queue and known_issues only. Merge state lives in GitHub (Routine A's Step 0 queries `gh pr list` for open and merged polish PRs). Routine A opens one polish PR per weekday (08:00 UTC); a companion **Routine B** runs later the same weekday (14:00 UTC) to address the CodeRabbit/Codex findings and squash-merge it. Deploys stay manual.

See the full aspect spec in `docs/refactoring/task-manager-aspects.md`.

## completed (pre-migration)

These aspects were finished and merged in the original repo
(`joelhmartin/Anchor-Client-Dashboard`) **before** this codebase was consolidated
into `joelhmartin/anchor-task-manager` as a single squashed "Baseline" commit on
2026-06-10. That import carried the *code* but NOT the merged-PR history, so
Routine A's Step 0 (`gh pr list --state merged`) sees an empty set in this repo
and would otherwise restart from the top of the queue. They are recorded here and
removed from the queue below so the routine resumes at the correct next aspect.

- phase-1-soft-delete-audit  (merged 2026-05-12, source repo — never in queue)
- phase-1-transactions       (merged 2026-05-12, source repo; re-merged here as PR #1 on 2026-06-17)
- phase-1-pagination         (merged 2026-05-13, source repo)
- phase-1-response-shape     (merged 2026-05-14, source repo)
- phase-2-aria-labels        (merged 2026-05-15, source repo)
- phase-2-toast-on-mutations (merged 2026-05-18, source repo)
- phase-2-theme-tokens       (merged 2026-05-20, source repo)

## queue

Aspects to work through, in order. Routine A picks the first item not already merged on GitHub. Remove items as they merge if you want to keep this list tidy. NOTE: because the pre-migration merge history did not transfer (see "completed" above), the queue prune below is load-bearing, not cosmetic — Routine A's merged-PR filter starts empty in this repo and rebuilds only from PRs merged here going forward.

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
- [phase-1-transactions] `POST /items/:itemId/dependencies` (`server/routes/tasks.js:4790`) runs the cycle-detection DFS outside any transaction, then INSERTs the new edge. Two concurrent requests can each pass the cycle check on a stale snapshot and together commit a cycle. A correct fix needs the DFS + INSERT in a single SERIALIZABLE transaction with 40001 retry, which is larger than a simple tx wrap — deferred to a dedicated race-condition aspect. Cap concurrent damage with an advisory lock keyed on the workspace if the queue gets to it sooner.
- [phase-1-transactions] Additional multi-write endpoints in `server/routes/tasks.js` that still run outside a transaction and are candidates for the next pass: `POST /workspaces/:workspaceId/boards` (board INSERT + event; safe today but should be wrapped once any default-group seeding lands), `POST /items/:itemId/links` and `POST /items/:itemId/recurrence` (multi-step item-link / recurrence rule creation), `POST /automations/steps/:stepId/reorder` (already wrapped — listed here as confirmed OK), and `POST /reports/billing` (read-only, ignore). Defer to a phase-1-transactions-pass-2 once the queue cycles back, scoped to non-event multi-row writes.
- [phase-3-files-delete-preview] Migrate task file attachments to GCS with signed URLs (aspect spec allowed BYTEA *or* GCS — this PR shipped BYTEA because GCS requires bucket creation, IAM bindings, and `GOOGLE_APPLICATION_CREDENTIALS` that aren't wired up). Worth migrating later for files >5MB so `task_files` rows stay small and replication-friendly.
- [phase-3-files-delete-preview] HEIC/HEIF are accepted by the upload allowlist (iOS phones default to them) but `<img src=…>` won't render them in Chrome/Firefox, so the Preview button is hidden for those rows. Add server-side conversion (e.g. `sharp` heic → jpeg) at upload time so iOS uploads get the same in-drawer preview as everyone else.
- [phase-3-files-delete-preview] No backfill for orphaned legacy rows where `data IS NULL` and the matching `/uploads/` file is gone. `/content` returns 410 and the legacy `Open` link 404s. A cleanup migration could soft-delete them, but the right scoping is its own aspect (touches the UI's empty-state copy too).
