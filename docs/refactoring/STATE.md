# Refactoring State

## Branch
All work happens on `refactor/wip`. Do NOT commit to main. Push to `origin/refactor/wip` after every session.

## Current Phase
CTM Forms Enhancement — ALL 9 PHASES COMPLETE. Enhanced forms builder with 16+ field types, multi-step forms, conditional logic, scoring, CTM FormReactor integration, email notifications with field values, AI form builder, after-submission actions, import/export/duplicate, and fully rewritten embed script.

## Phase Progression
1. **Mapping** — audit the entire codebase and document every connection
2. **Planning** — create a prioritized task list from the audit
3. **Refactoring** — execute tasks from the plan in small, testable batches
4. ~~**Frontend Refactor**~~ — **IN PROGRESS** — extract repeated UI into reusable components
5. **Database Optimization** — optimize queries, indexes, and schema
6. **GCP Cost Optimization** — reduce cloud spend through code and config changes
7. **Complete** — all tasks done

## Last Session
2026-03-23 — CTM Forms Enhancement (Session 23). All 9 phases complete. Decomposed FormsManager (1417→85 lines orchestrator + 12 component files). New features: 16+ field types, multi-step forms with progress bar, conditional logic (8 operators, ALL/ANY), scoring system with ranges, CTM FormReactor integration (auto-create/link/submit), enhanced email notifications with {{field}} tokens, AI form builder via Vertex AI, after-submission actions (message/redirect/popup), import/export/duplicate, fully rewritten embed script supporting all features.

## Active Concerns
- AdminHub.jsx decomposed (5,460 → 2,361 lines) — C-009 complete
- ClientPortal.jsx decomposed (4,770 → 216 lines) — C-010 complete
- Remaining raw Table usage: AdminHub (3, in orchestrator), ReviewsPanel (1, server-side pagination), ActiveClients (3, expandable/nested rows), FormsManager forms list (2, grouped layout)
- Frontend component extraction (C-001 through C-008) complete — all 8 shared components extracted

## Known Risks
- **No automated test suite** — verification relies on `yarn build` + `yarn lint` + visual checks
- Branch divergence: `refactor/wip` must rebase onto `main` at the start of every session to prevent merge hell
- Audit staleness: new features on `main` may add hand-built patterns that bypass shared components — validator role checks for this

## Files Currently Being Worked On
None (CTM Forms all 9 phases complete)

## Metrics
- Modules mapped: 0
- Refactoring tasks completed: 10 / 10 (all CODE/INFRA tasks)
- Task platform tasks: 15 / 25 (TM-001–TM-014 + TM-015v2a DONE) — TM-015 superseded by TM-015v2 (broken into 6 sub-tasks: TM-015v2a–f). TM-016–TM-020 specs written, execution pending.
- Components extracted: 8 shared + 6 AdminHub sub-components + 9 ClientPortal sub-components
- Components audited: 10
- Tests passing: unknown
- Estimated monthly GCP spend: ~$58 (after optimization, down from ~$587)
- GCP savings realized: ~$529/month (90% reduction)
- Task platform bugs found: 13 (8 backend, 5 frontend)
- Task platform missing features identified: 20
- Sessions completed: 23
