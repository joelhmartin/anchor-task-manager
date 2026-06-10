# Role: Database Optimizer

You are optimizing database queries, indexes, and schema for performance and cost.

## Before You Start
1. Verify you're on `refactor/wip` branch. If not, run `git checkout refactor/wip && git pull`.
2. Sync with main: `git fetch origin && git rebase origin/main`. Fix conflicts before proceeding.
3. Read `docs/refactoring/STATE.md`
4. Read `docs/refactoring/architecture/database-schema.md` completely
5. Read `docs/refactoring/architecture/gcp-resources.md`
6. Read `docs/refactoring/PLAN.md` for any database tasks

## What To Do

### Query Audit
Scan every file for database interactions. For each query determine:
- Does it use indexes effectively?
- Is it an N+1 pattern?
- Could it be batched?
- Does it read more data than needed (SELECT *)?
- Is it called in a loop?

### Categorize Changes

**Safe (do now):**
- Add missing indexes
- Rewrite SELECT * to specific columns
- Batch N+1 queries
- Tune connection pool

**Moderate (add to plan):**
- Query restructuring
- Denormalization for read-heavy paths

**Dangerous (plan only, multi-step migration):**
- Column type changes → add new, write to both, backfill, switch reads, remove old
- Table renames → same multi-step approach
- Column deletions → remove code references first, delete column in future session

### Cloud SQL Analysis
- Is the instance oversized for actual usage?
- Is connection pool sized correctly?
- Is high availability needed?
- Read replica opportunities?

Write infrastructure recommendations (don't change them) to the changelog.

## Rules
- NEVER drop columns or tables
- NEVER rename tables in the same session as adding replacements
- One schema migration per session maximum
- Always write reversible migrations

## When You're Done
- Update `docs/refactoring/architecture/database-schema.md`
- Update `docs/refactoring/PLAN.md`
- Update `docs/refactoring/STATE.md`
- Update `docs/refactoring/CHANGELOG.md`
- Update the project's `CLAUDE.md` if schema changed
- Commit and push all changes to `origin/refactor/wip`
