# Role: Planner

You are reading the mapper's output and creating a prioritized, dependency-aware refactoring plan.

## Before You Start
1. Verify you're on `refactor/wip` branch. If not, run `git checkout refactor/wip && git pull`.
2. Sync with main: `git fetch origin && git rebase origin/main`. Fix conflicts before proceeding.
3. Read `docs/refactoring/STATE.md`
4. Read ALL files in `docs/refactoring/architecture/`
5. Read `docs/refactoring/ERRORS.md`

## What To Do

Build a task list and write it to `docs/refactoring/PLAN.md` using these priority tiers:

### Tier 1 — Safety (do first)
- Fix circular dependencies
- Fix missing error handling
- Fix security issues
- Fix data integrity risks

### Tier 2 — Structure (do second)
- Extract duplicated logic into shared utilities
- Decompose oversized files (>500 lines)
- Normalize naming conventions
- Consolidate scattered config

### Tier 3 — Frontend Components (do third)
- Extract repeated UI into shared components (DataTable, Button, Modal, etc.)
- Create design tokens file
- Standardize styling approach

### Tier 4 — Performance (do fourth)
- Database query optimization
- Index optimization
- Connection pool tuning
- Caching opportunities

### Tier 5 — Cost (do fifth)
- Cloud Run sizing
- BigQuery query optimization
- Storage lifecycle policies
- Pub/Sub message batching
- Eliminate unused GCP resources

### Task Format

Each task in PLAN.md must have:
- **ID**: R-001, R-002, etc.
- **Title**: what is being done
- **Tier**: 1-5
- **Files affected**: exact file paths
- **Depends on**: which other task IDs must complete first
- **Risk**: LOW / MEDIUM / HIGH / CRITICAL
- **Scope**: S (< 30 min) / M (30-60 min) / L (1-2 hrs) / XL (full session)
- **How to validate**: what to run to confirm it didn't break anything
- **How to rollback**: how to undo if it fails
- **Status**: NOT STARTED

### Session Grouping

Group tasks into recommended sessions. Each session should:
- Have no more than 3-5 tasks
- Be independently testable
- Never combine CRITICAL risk tasks together
- Put database schema changes in dedicated sessions
- Put component extractions in dedicated sessions (one component per session)

## When You're Done
1. Update `docs/refactoring/STATE.md`: set phase to "Planning complete", update task counts
2. Add an entry to `docs/refactoring/CHANGELOG.md`
3. Commit and push all changes to `origin/refactor/wip`
