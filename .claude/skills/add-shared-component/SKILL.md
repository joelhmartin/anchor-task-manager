---
name: add-shared-component
description: Use when creating a new reusable React/MUI component for the Anchor Client Dashboard. Covers file placement, import conventions, and registering the component in CLAUDE.md so future sessions use it.
---

# Add a Shared UI Component

## 1. Check if a component already exists

Before creating anything, check `CLAUDE.md`'s Shared Component Library table and scan `src/ui-component/extended/`. The rule is: if a shared component covers your use case, use it. Extend it rather than bypassing it.

## 2. Place the file correctly

| Type | Location |
|------|----------|
| Reusable UI component (dialogs, tables, chips, buttons, fields) | `src/ui-component/extended/<ComponentName>.jsx` |
| Card wrapper variant | `src/ui-component/cards/<ComponentName>.jsx` |
| Shared constants (colors, maps, enums) | `src/constants/<name>.js` |

Never put shared components in a feature directory (`views/`, `admin/`, etc.) — they become invisible to other features and eventually get duplicated.

## 3. Write the component

- Props: be explicit and minimal. Document non-obvious props with a one-line comment.
- MUI base components only — no third-party UI libs beyond MUI.
- `baseUrl`-relative imports: `import X from 'ui-component/extended/X'` not `'../../../...'`
- No hardcoded colors for status — use `StatusChip` and extend its color map.
- No `window.alert/confirm/prompt` — use `ConfirmDialog`.

## 4. Register in CLAUDE.md

Add a row to the Shared Component Library table in `CLAUDE.md`:

```
| **ComponentName** | `ui-component/extended/ComponentName` | One-sentence description of when to use it. Key props listed inline. |
```

This is what makes the component discoverable to future Claude sessions — **do not skip this step**.

## 5. Update the import in consuming files

Use the `baseUrl`-relative path:
```js
import MyComponent from 'ui-component/extended/MyComponent';
```

## 6. Verify

```bash
yarn build   # confirms no circular imports or tree-shaking issues
yarn lint    # confirms no unused imports
```

## Extending an existing shared component

If the existing component almost covers your use case, add a new prop rather than building a separate component. Update the component, update the CLAUDE.md table entry to document the new prop, and verify all existing callers aren't broken.
