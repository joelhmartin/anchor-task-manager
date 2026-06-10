# Component Extraction Plan

Created: 2026-03-01

Components listed in extraction order (least dependencies first).

---

## C-001: ConfirmDialog

**Priority:** 1 (extract first — simplest, most duplicated)

**Props:**
```jsx
<ConfirmDialog
  open={boolean}
  onClose={() => void}
  onConfirm={() => void}
  title={string}                    // e.g. "Delete Client"
  message={string | ReactNode}      // e.g. "Are you sure you want to delete {name}?"
  confirmLabel={string}             // default: "Confirm"
  cancelLabel={string}              // default: "Cancel"
  confirmColor="error"|"warning"|"primary"  // default: "primary"
  loading={boolean}                 // disable buttons + show spinner on confirm
  severity="error"|"warning"|"info" // optional Alert banner inside
  severityMessage={string}          // text for the Alert banner
/>
```

**Built-in features:**
- Consistent `maxWidth="xs"` + `fullWidth`
- Cancel button (text) + Confirm button (contained, colored)
- Optional loading state on confirm button
- Optional severity Alert above message

**Files to replace (~25 instances):**
- AdminHub.jsx (4 confirmations: revoke OAuth, delete OAuth, delete resource, delete group, deactivate client)
- ActiveClients.jsx (2: redact services, archive client)
- TaskManager.jsx (2: delete label, delete automation)
- TwilioManager.jsx (1: release number)
- CallTrackingTab.jsx (1: release number)
- FormsTab.jsx (1: delete form)
- FormsManager.jsx (1: archive form)
- ServicesManagement.jsx (1: delete service)
- SharedDocuments.jsx (1: delete document)
- BlogEditor.jsx (1: delete post)
- TeamManagement.jsx (1: remove member)
- BoardTable.jsx (2: delete item, delete group)
- AutomationsPane.jsx (3: delete workspace, board, automation)
- TaskSidebarPanel.jsx (3: delete workspace, board, automation)

**Location:** `src/ui-component/extended/ConfirmDialog.jsx`

---

## C-002: StatusChip

**Priority:** 2 (no dependencies, high impact on consistency)

**Props:**
```jsx
<StatusChip
  status="active"|"inactive"|"paused"|"pending"|"error"|"success"|"warning"|"draft"|"published"|"archived"
  label={string}                    // optional override label
  size="small"|"medium"             // default: "small"
  variant="filled"|"outlined"       // default: "filled"
/>
```

**Built-in features:**
- Centralized status-to-color mapping
- Consistent sizing
- Human-readable labels from status keys (e.g. "in_progress" → "In Progress")

**Status color map:**
| Status | Color | Variant |
|--------|-------|---------|
| active / success / connected | success | filled |
| inactive / error / disconnected / failed | error | filled |
| paused / warning | warning | filled |
| pending / info / draft | info | filled |
| published | primary | filled |
| archived | default | outlined |

**Files to replace (150+ instances):**
- AdminHub.jsx (OAuth status, email status, role chips)
- ActiveClients.jsx (service status, journey status)
- ClientPortal.jsx (journey status, concern tags)
- ReviewsPanel.jsx (review status: responded/pending/flagged/urgent)
- FormsManager.jsx (form status: active/draft/published/archived)
- FormsTab.jsx (form status)

**Location:** `src/ui-component/extended/StatusChip.jsx`

---

## C-003: EmptyState

**Priority:** 3 (no dependencies, quick win)

**Props:**
```jsx
<EmptyState
  icon={ReactElement}               // optional icon component
  title={string}                    // e.g. "No clients found"
  message={string}                  // optional secondary text
  action={ReactNode}                // optional action button
/>
```

**Built-in features:**
- Centered layout with padding
- Subtle icon (grey, 48px)
- Title in `variant="h6"` + `color="text.secondary"`
- Message in `variant="body2"` + `color="text.secondary"`
- Optional action button below

**Files to replace (~20 instances):**
- All tables with `<Alert severity="info">No data</Alert>` pattern
- AdminHub.jsx, ActiveClients.jsx, FormsTab.jsx, SharedDocuments.jsx, TeamManagement.jsx, etc.

**Location:** `src/ui-component/extended/EmptyState.jsx`

---

## C-004: LoadingButton

**Priority:** 4 (no dependencies, replaces inconsistent loading patterns)

**Approach:** Adopt MUI Lab's `LoadingButton` or create a thin wrapper.

**Props:**
```jsx
<LoadingButton
  loading={boolean}
  loadingText={string}              // optional, e.g. "Saving..."
  variant="contained"|"outlined"|"text"
  color="primary"|"error"|"warning"|"success"
  size="small"|"medium"|"large"
  startIcon={ReactElement}
  // ... all standard MUI Button props
/>
```

**Built-in features:**
- Disabled state during loading
- CircularProgress spinner replaces startIcon (or shows inline)
- Optional loading text

**Files to replace (~30 instances):**
- Every dialog with `disabled={saving}` + `{saving ? 'Saving...' : 'Save'}` pattern

**Location:** `src/ui-component/extended/LoadingButton.jsx` (or just import from `@mui/lab`)

---

## C-005: FormDialog

**Priority:** 5 (depends on ConfirmDialog pattern being established)

**Props:**
```jsx
<FormDialog
  open={boolean}
  onClose={() => void}
  onSubmit={() => void}
  title={string}
  maxWidth="xs"|"sm"|"md"          // default: "sm"
  loading={boolean}                 // disable submit + show spinner
  submitLabel={string}              // default: "Save"
  cancelLabel={string}              // default: "Cancel"
  submitColor="primary"|"error"     // default: "primary"
  submitDisabled={boolean}          // additional disable condition
  dividers={boolean}                // divider lines on DialogContent
>
  {children}                        // form fields go here
</FormDialog>
```

**Built-in features:**
- Consistent Dialog shell with `fullWidth`
- DialogTitle
- DialogContent with `<Stack spacing={2} sx={{ mt: 1 }}>` wrapper
- DialogActions with Cancel + Submit (LoadingButton)
- Handles Enter key submission

**Files to replace (~40 form dialogs):**
- All non-confirmation dialogs across the codebase

**Location:** `src/ui-component/extended/FormDialog.jsx`

---

## C-006: DataTable

**Priority:** 6 (largest effort, most dependencies)

**Props:**
```jsx
<DataTable
  columns={[
    { id: string, label: string, sortable?: boolean, width?: number, render?: (row) => ReactNode }
  ]}
  rows={array}
  rowKey={string|function}          // unique key field or getter

  // Search
  searchable={boolean}              // default: false
  searchFields={string[]}           // fields to search across
  searchPlaceholder={string}

  // Sorting
  defaultSort={{ field: string, direction: 'asc'|'desc' }}

  // Pagination
  paginated={boolean}               // default: false
  pageSize={number}                 // default: 10
  pageSizeOptions={number[]}        // default: [10, 25, 50]
  serverSide={boolean}              // default: false (client-side)
  totalCount={number}               // for server-side pagination
  page={number}                     // controlled page (server-side)
  onPageChange={(page, pageSize) => void}

  // Selection
  selectable={boolean}              // default: false
  selectedIds={Set|array}
  onSelectionChange={(ids) => void}

  // States
  loading={boolean}
  emptyIcon={ReactElement}
  emptyTitle={string}
  emptyMessage={string}

  // Table props
  size="small"|"medium"             // default: "small"
  stickyHeader={boolean}            // default: false
  maxHeight={number|string}

  // Row features
  onRowClick={(row) => void}
  hover={boolean}                   // default: true
  collapsible={boolean}             // expandable rows
  renderCollapsed={(row) => ReactNode}
/>
```

**Built-in features:**
- Search bar (uses existing `useTableSearch` hook internally)
- Column sorting with sort indicators
- Client-side or server-side pagination with TablePagination
- Row selection with checkboxes + "select all"
- Loading state (skeleton rows or overlay)
- Empty state (uses EmptyState component)
- Responsive horizontal scroll
- Sticky header option

**Files to replace (16+ files, 20+ tables):**
- All MUI Table implementations listed in the audit

**Location:** `src/ui-component/extended/DataTable.jsx`

---

## C-007: Brand Colors Map

**Priority:** 7 (quick win, can be done alongside any other work)

**What:** Centralize OAuth provider brand colors into a constants file.

**File:** `src/constants/brandColors.js`

```js
export const BRAND_COLORS = {
  facebook: '#1877F2',
  instagram: '#E4405F',
  google: '#4285F4',
  tiktok: '#000000',
  wordpress: '#21759B',
};
```

**Files to update:**
- AdminHub.jsx (replace inline hex values)
- AnchorStepIcon.jsx (replace rgba values with theme alpha utility)

---

## C-008: FormField (Future — after DataTable)

**Priority:** 8 (largest scope, do after other components stabilize)

**Props:**
```jsx
<FormField
  label={string}
  required={boolean}
  error={string}                    // error message
  helperText={string}
  type="text"|"email"|"password"|"select"|"autocomplete"|"date"|"file"|"multiline"
  // ... passthrough to underlying MUI component
/>
```

**Deferred** — scope is very large (hundreds of inputs). Evaluate after C-001 through C-006 are complete.

---

---

## C-009: Decompose AdminHub.jsx (5,534 lines)

**Priority:** 9 (do after component extractions reduce its size)

**Problem:** AdminHub.jsx is the largest file in the codebase at 5,534 lines with 11 dialogs, 3 tables, OAuth management, onboarding wizard, email logs, activity logs, and client management all in one file.

**Approach:** Extract logical sections into separate components:
- `AdminHub/ClientsTable.jsx` — client list + search + bulk actions
- `AdminHub/EmailLogsTable.jsx` — email logs table + pagination
- `AdminHub/ActivityLogs.jsx` — activity log table + date filters
- `AdminHub/OAuthConnections.jsx` — OAuth provider management + all related dialogs
- `AdminHub/OnboardingWizard.jsx` — multi-step onboarding dialog
- `AdminHub/GroupManagement.jsx` — client group CRUD + dialogs
- `AdminHub/index.jsx` — thin orchestrator that imports the above

**Files affected:** `src/views/admin/AdminHub.jsx` → split into `src/views/admin/AdminHub/` directory

**Effort:** XL (full session)
**Risk:** HIGH — most connected file in the app, many shared state dependencies
**Dependencies:** C-001 (ConfirmDialog), C-005 (FormDialog) should be done first to reduce dialog boilerplate before splitting

---

## C-010: Decompose ClientPortal.jsx (4,779 lines)

**Priority:** 10 (do after AdminHub decomposition pattern is established)

**Problem:** ClientPortal.jsx is the second largest file at 4,779 lines with 6 dialogs, multiple tab panels, journey management, request submission, and task display.

**Approach:** Extract tab panels into separate components:
- `ClientPortal/RequestsPanel.jsx` — service requests + submission dialog
- `ClientPortal/JourneyPanel.jsx` — journey management + concern tracking
- `ClientPortal/TasksPanel.jsx` — Monday.com task display
- `ClientPortal/index.jsx` — tab navigation + orchestrator

**Files affected:** `src/views/client/ClientPortal.jsx` → split into `src/views/client/ClientPortal/` directory

**Effort:** XL (full session)
**Risk:** HIGH — large file with complex state
**Dependencies:** C-001, C-005 should be done first

---

## Extraction Order Summary

| Session | Component | Effort | Dependencies |
|---------|-----------|--------|-------------|
| 1 | C-001: ConfirmDialog | M (30-60 min) | None |
| 2 | C-002: StatusChip | M (30-60 min) | None |
| 3 | C-003: EmptyState | S (< 30 min) | None |
| 4 | C-004: LoadingButton | S (< 30 min) | None |
| 5 | C-005: FormDialog | L (1-2 hrs) | C-001 pattern, C-004 |
| 6 | C-006: DataTable | XL (full session) | C-003 (EmptyState) |
| 7 | C-007: Brand Colors | S (< 30 min) | None |
| 8 | C-008: FormField | XL (full session) | C-005 pattern |
| 9 | C-009: Decompose AdminHub.jsx | XL (full session) | C-001, C-005 |
| 10 | C-010: Decompose ClientPortal.jsx | XL (full session) | C-001, C-005 |
