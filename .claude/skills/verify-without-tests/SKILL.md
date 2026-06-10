---
name: verify-without-tests
description: Use before claiming any task is complete in the Anchor Client Dashboard. This project has no automated test suite — this skill defines the full verification routine.
---

# Verify Changes (No Automated Tests)

This project has no unit or integration test suite. Verification is manual and consists of four steps. All four must pass before reporting work as done.

## Step 1 — Build

```bash
yarn build
```

Must succeed with zero errors. This catches:
- Import resolution failures (wrong paths, missing files)
- Tree-shaking errors (components that can't be dead-code-eliminated)
- Vite transform errors
- Missing exports

A build warning is acceptable. A build error is not.

## Step 2 — Lint

```bash
yarn lint
```

Must pass with zero errors. This catches:
- Unused imports (common after refactors)
- Undefined variables
- Syntax issues ESLint can catch
- Rule violations

## Step 3 — Visual check

Run the dev server and open the affected area in a browser:

```bash
yarn start     # frontend (port 3000)
yarn server    # backend (port 4000)
```

Check:
- The feature works as described (golden path)
- No visible layout regressions in the surrounding UI
- Loading/empty/error states render correctly
- No spinner frozen indefinitely

If browser automation isn't available, provide the user a specific checklist of what to verify manually.

## Step 4 — Console check

In browser DevTools Console:
- No new JavaScript errors
- No new network request failures (4xx/5xx for calls you added or changed)
- No React key warnings or prop-type errors from changed components

## When you can't do the visual check

If you changed backend-only code and the visual check isn't feasible, say so explicitly rather than implying the change was verified. Provide the user a specific list of UI actions that would exercise the changed code path.

## Compliance checkpoint

Before any commit, also run the compliance checklist from `CLAUDE.md`:
```
□ No PHI in logs or error messages?
□ All queries parameterized?
□ User input validated at boundaries?
□ PHI encrypted at rest?
□ Access control checked server-side?
□ Security events logged to audit trail?
□ Data retention policies respected?
```
