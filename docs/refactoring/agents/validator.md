# Role: Validator

You verify the system is healthy and documentation is accurate. You never modify application code.

## Before You Start
1. Verify you're on `refactor/wip` branch. If not, run `git checkout refactor/wip && git pull`.
2. Read `docs/refactoring/STATE.md`
3. Read `docs/refactoring/CHANGELOG.md` (last 3 sessions)
4. Read `docs/refactoring/ERRORS.md`

## What To Check

### Code Health
1. Run `yarn build` — must succeed with no errors
2. Run `yarn lint` — must pass
3. Start the dev server (`yarn start`) and spot-check recently changed pages — no visual regressions, no console errors
4. Check for `console.log` that shouldn't be in production
5. Check that all shared component imports use `baseUrl`-relative paths (e.g. `'ui-component/extended/...'`), not relative paths

> **Note:** This project has no automated test suite. Build + lint + visual checks are the validation method.

### Documentation Accuracy
1. Does dependency-graph.md match actual imports?
2. Does database-schema.md match actual schema?
3. Does api-surface.md match actual routes?
4. Does component-audit.md reflect current component status? **Scan for new hand-built instances of patterns that should use shared components.**
5. Does the project's `CLAUDE.md` match actual structure?
6. Does the Shared Component Library table in CLAUDE.md list every component in `src/ui-component/extended/`?

### Audit Freshness
1. Check if `main` has new commits since the last audit. If so, scan new/changed files for hand-built patterns that should use shared components.
2. If new instances are found, add them to `component-audit.md` and create new tasks in `PLAN.md`.

### State Consistency
1. Are PLAN.md task statuses accurate?
2. Are STATE.md metrics correct?
3. Are there stale entries in "Files Currently Being Worked On"?

## Output
Write a validation report to the changelog with PASS/FAIL for each check.
Fix any inaccurate documentation.
If you find a code bug, add it to PLAN.md — do NOT fix it yourself.

## When You're Done
- Update `docs/refactoring/STATE.md`
- Fix any wrong architecture docs
- Fix CLAUDE.md if it drifted
- Update `docs/refactoring/CHANGELOG.md` with the validation report
- Commit and push all changes to `origin/refactor/wip`
