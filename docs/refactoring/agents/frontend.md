# Role: Frontend Refactor

You are extracting repeated UI patterns into a reusable component library. No UI element should ever be built from scratch twice in this application.

## Before You Start
1. Verify you're on `refactor/wip` branch. If not, run `git checkout refactor/wip && git pull`.
2. Sync with main: `git fetch origin && git rebase origin/main`. Fix conflicts before proceeding.
3. Run `yarn build` to confirm the app builds cleanly before you touch anything.
4. Read `docs/refactoring/STATE.md`
5. Read `docs/refactoring/PLAN.md`
6. Read the project's `CLAUDE.md`
7. Read `docs/refactoring/architecture/dependency-graph.md` if it exists
8. Read `docs/refactoring/architecture/component-audit.md` if it exists

## First Time Running This Role

If `docs/refactoring/architecture/component-audit.md` does not exist yet, your first job is to create it:

### Component Audit

Scan the entire frontend codebase. For every UI element that appears more than once, document:
- What it is (button, table, form input, modal, card, dropdown, badge, etc.)
- Every file where a version of it exists, with line numbers
- How each version differs (styling, props, behavior, features)
- Which version is the most complete

Flag specifically:
- Tables missing search/filter
- Tables missing sorting
- Tables missing pagination
- Buttons with inconsistent styling
- Forms rebuilding the same input patterns
- Modals built differently in different places
- Color values hardcoded instead of using variables/tokens
- Typography inconsistencies

Write this to `docs/refactoring/architecture/component-audit.md`.

Then write a component extraction plan to `docs/refactoring/architecture/component-plan.md` listing every shared component to create, with:
- Component name
- Props/API design
- Built-in features (see below)
- What files it replaces
- Extraction order (least dependencies first)

Then STOP and tell me the plan. Don't start building yet.

## Subsequent Sessions

**Before picking up the next component**, do a quick re-scan of the target pattern to catch any new instances added to `main` since the last audit. If you find new instances, add them to `component-audit.md` before starting extraction.

Pick the next component from the plan and extract it.

### Required Built-In Features Per Component Type

**DataTable:**
- Search/filter — always present, toggleable via prop
- Column sorting
- Pagination with configurable page size
- Loading state
- Empty state
- Row selection (prop-controlled)
- Responsive/scroll behavior
- Consistent styling from design tokens

**Button:**
- Variants: primary, secondary, outline, ghost, danger
- Sizes: sm, md, lg
- Loading state with spinner
- Disabled state
- Icon support (left, right, icon-only)
- Colors from design tokens — change once, changes everywhere

**FormInput / FormSelect / FormTextarea:**
- Label built in
- Error state and message built in
- Helper text
- Required indicator
- Consistent sizing
- Disabled state

**Modal:**
- Consistent backdrop and animation
- Close on escape and backdrop click
- Header, body, footer sections
- Size variants
- Loading state

**Card:**
- Consistent padding, border, shadow
- Header, body, footer sections
- Clickable variant
- Loading skeleton

Add any other components discovered during the audit.

### Design Tokens

Create a central design tokens file (or extend one if it exists):
- Colors: primary, secondary, accent, danger, warning, success, neutral scale
- Typography: font families, sizes, weights, line heights
- Spacing scale
- Border radius values
- Shadow values
- Breakpoints

Every component references these tokens. Never hardcode values. Changing the primary color means changing ONE value.

### Where to Put New Components
- **Reusable UI components** → `src/ui-component/extended/` (e.g. `ConfirmDialog.jsx`, `StatusChip.jsx`, `DataTable.jsx`)
- **Card variants** → `src/ui-component/cards/`
- **Shared constants** (color maps, status maps) → `src/constants/`
- **Never** create a new directory for shared components. Use the existing locations above.

### Import Paths
Use `baseUrl`-relative imports (NOT relative paths) for all shared components:
```js
// CORRECT
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
// WRONG
import ConfirmDialog from '../../../ui-component/extended/ConfirmDialog';
```

### For Each Component Extraction
1. Create the component file in `src/ui-component/extended/` with full prop types and comments documenting usage
2. Find EVERY place the old pattern exists
3. STOP AND ASK ME if:
   - Multiple versions differ significantly — show me all versions and ask which behavior to keep
   - You're unsure if two similar things should be the same component or separate
   - A component change would touch more than 10 files
   - You find a pattern that doesn't fit cleanly into one component
   - One version has a feature others don't — ask if the shared version should have it
4. Replace each instance with the new component using `baseUrl`-relative imports
5. After each replacement, run `yarn build` to catch import/compile errors immediately
6. If the build breaks, revert that replacement and log it
7. After all replacements, start the dev server (`yarn start`) and visually verify every changed page renders correctly. Check browser console for new errors.

## Rules
- **ASK before deciding between conflicting implementations.** Don't pick for me.
- **ASK before dropping any UI behavior.** If one version has a feature, ask me before leaving it out.
- **One component per session.** Build it, replace every instance, test everything.
- **Never break existing functionality.** Every replacement must behave exactly like what it replaced.
- **Document every component** with a comment block explaining props, variants, and usage.

## When You're Done (each session)

Update `docs/refactoring/architecture/component-audit.md` — mark what's been extracted

Update `docs/refactoring/PLAN.md` — mark completed tasks, add new ones discovered

Update `docs/refactoring/STATE.md` — update metrics, note what was done

Update `docs/refactoring/CHANGELOG.md` with:
- Which component was created
- Its props/API
- Which files were modified to use it
- Test results before and after
- Any instances that couldn't be migrated and why

**CRITICAL: Register the new component in `CLAUDE.md`.**
In the "Shared Component Library" table under Quality Guidelines, add a row for the new component with:
- Component name (bold)
- Import path
- "Use For" description (when to reach for this component)

This ensures every future session (not just refactoring sessions) knows to use the shared component instead of building custom UI. The table in CLAUDE.md is the authoritative registry — if it's not in the table, future sessions won't know it exists.

Commit and push all changes to `origin/refactor/wip`.
