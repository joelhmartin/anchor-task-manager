# Component Audit

Audit date: 2026-03-01

---

## 1. Tables (16 files, 20+ table instances)

**No DataGrid usage** — all tables use raw MUI `Table` components.

### Existing Tables

| File | Lines | Tables | Pagination | Search | Sort | Selection | Empty State | Loading |
|------|-------|--------|-----------|--------|------|-----------|-------------|---------|
| AdminHub.jsx | 5534 | 3 (email logs, activity logs, clients) | YES (2) | YES (useTableSearch) | YES | YES (bulk checkboxes) | YES | YES |
| ReviewsPanel.jsx | 1566 | 1 (reviews) | YES | YES | YES | NO | YES | YES |
| FormsManager.jsx | 1465 | 2 (forms, nested per client) | NO | YES | YES | NO | YES | YES |
| CallTrackingTab.jsx | 608 | 1 (tracking numbers) | NO | NO | NO | NO | NO | NO |
| TwilioManager.jsx | 820 | 1 (tracking numbers — duplicate of above) | NO | NO | NO | NO | NO | NO |
| ActiveClients.jsx | 450 | 1 (collapsible client rows) | NO | NO | NO | NO | NO | NO |
| ServicesManagement.jsx | 259 | 1 (services) | NO | NO | NO | NO | NO | NO |
| TeamManagement.jsx | 594 | 2 (members, invitations) | NO | NO | NO | NO | YES | NO |
| FormsTab.jsx | 662 | 2 (forms, nested) | NO | NO | YES | NO | NO | NO |
| BillingPane.jsx | 631 | 1 (board selection) | NO | NO | NO | YES (checkboxes) | YES | NO |
| ClientPortal.jsx | 4779 | 2 (tasks, journey concerns) | NO | NO | NO | NO | YES | YES |
| BoardTable.jsx | 867 | Custom CSS grid (kanban-style) | NO | NO | NO | NO | NO | NO |

### Issues
- **Most tables lack pagination** — only 3/16 files have it
- **Most tables lack search** — only 3/16 files have it
- **Sorting is ad-hoc** — inline `.sort()` calls, no shared pattern
- **Empty states inconsistent** — some use Alert, some use Typography, some have none
- **Loading states inconsistent** — mix of Skeleton, CircularProgress, or nothing
- **Duplicate tables** — CallTrackingTab.jsx and TwilioManager.jsx have nearly identical tracking number tables
- **useTableSearch hook exists** (`src/hooks/useTableSearch.js`, 35 lines) but only used in AdminHub

---

## 2. Dialogs / Modals (67 total across 15 files)

**No raw MUI Modal usage** — all use Dialog component.

### Dialog Count by File

| File | Dialogs | Types |
|------|---------|-------|
| AdminHub.jsx | 11 | Email detail, group mgmt, onboarding wizard, OAuth (4), confirmations (4) |
| ClientPortal.jsx | 6 | Request submission, rush confirm, task updates, service selection, journey (2) |
| AutomationsPane.jsx | 6 | Create board/group/workspace, delete confirmations (3) |
| TaskSidebarPanel.jsx | 6 | Create board/group/workspace, delete confirmations (3) |
| FormsTab.jsx | 6 | Create, edit, submissions, detail, embed code, delete confirm |
| CallTrackingTab.jsx | 5 | Purchase, edit, attribution script, release confirm, settings |
| TaskManager.jsx | 4 | Edit automation, status labels, delete label/automation confirms |
| TwilioManager.jsx | 4 | Purchase, edit, tracking script, release confirm |
| FormsManager.jsx | 4 | Create, edit, archive confirm, submission detail |
| BoardTable.jsx | 3 | Add label, delete item/group confirms |
| SharedDocuments.jsx | 3 | Upload, edit, delete confirm |
| ActiveClients.jsx | 2 | Redact services confirm, archive client confirm |
| TeamManagement.jsx | 2 | Invite member, remove member confirm |
| ServicesManagement.jsx | 2 | Add/edit service, delete confirm |
| ReviewsPanel.jsx | 1 | Request review |
| BlogEditor.jsx | 1 | Delete post confirm |
| BillingPane.jsx | 1 | Invoice preview |

### Dialog Sizing Conventions (inconsistent)
- Confirmations: `maxWidth="xs"` (most, but some omit it)
- Forms: `maxWidth="sm"` + `fullWidth`
- Data displays / code: `maxWidth="md"` + `fullWidth`
- Some dialogs lack maxWidth/fullWidth entirely

### Confirmation Dialog Pattern (repeated ~25 times)
Every confirmation dialog rebuilds:
```jsx
const [confirmOpen, setConfirmOpen] = useState(false);
const [itemToDelete, setItemToDelete] = useState(null);

<Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
  <DialogTitle>Delete Item</DialogTitle>
  <DialogContent>
    <Typography>Are you sure?</Typography>
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
    <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
  </DialogActions>
</Dialog>
```

### Issues
- **No shared ConfirmDialog component** — pattern duplicated ~25 times
- **No shared FormDialog wrapper** — each dialog rebuilds the same shell
- **State management inconsistent** — some use `{ open, data }` objects, some use separate booleans
- **Close handlers vary** — some reset state inline, some use named functions

---

## 3. Buttons

### Theme Override
`src/themes/overrides/Button.jsx`: `textTransform: 'none'`, `fontWeight: 600`, `borderRadius: 10`

### Patterns
- **Contained** (primary actions): Save, Submit, Create — `variant="contained"`
- **Outlined** (secondary): Cancel, Generate Link — `variant="outlined"`
- **Text** (tertiary): Resend, secondary links — `variant="text"`
- **Error** (destructive): Delete, Archive — `color="error"` + `variant="contained"`
- **IconButton + Tooltip** (row actions): Edit, Delete, Copy — always wrapped in Tooltip

### Issues
- **Loading state inconsistent** — some show text change ("Saving..."), some just disable, no consistent spinner
- **No LoadingButton component** — MUI has one but it's not used
- **Button sizes vary** — `size="small"` in tables, `size="large"` in auth, inconsistent elsewhere

---

## 4. Form Inputs

### Existing Shared Components
- `src/ui-component/extended/Form/CustomFormControl.jsx` — styled FormControl wrapper (used in auth)
- `src/ui-component/extended/Form/FormControl.jsx` — with icon adornments (rarely used)
- `src/ui-component/extended/Form/FormControlSelect.jsx` — select with icons (rarely used)
- `src/ui-component/extended/Form/InputLabel.jsx` — custom label (rarely used)
- `src/ui-component/extended/Form/FileUploadList.jsx` — drag-and-drop file upload (well-built)

### Common Patterns
- **TextField** — most common, used everywhere with `fullWidth`, sometimes `size="small"`
- **TextField select** — `<TextField select>` with MenuItem children
- **FormControl + Select** — alternative select pattern
- **Autocomplete** — server-side search in AdminHub, ReviewsPanel
- **OutlinedInput** — password fields with visibility toggle (auth)

### Issues
- **Error handling inconsistent** — sometimes `helperText`, sometimes Alert above form, sometimes Toast
- **Form layout varies** — some use `Stack spacing={2}`, some use custom margins
- **Custom form components rarely used** — CustomFormControl only in auth, others barely used
- **No unified form field component** with built-in label + error + helper text

---

## 5. Cards

### Existing Shared Components (well-adopted)
- `MainCard.jsx` — 90+ uses across all views, primary section wrapper
- `SubCard.jsx` — 50+ uses for nested content

### Issues
- Some views use raw `Card` instead of MainCard (inconsistent)
- Skeleton loading cards exist but only for dashboard-specific shapes

---

## 6. Status Indicators (Chips)

### Usage: 150+ instances across codebase

### Color Mapping (inconsistent)
| Meaning | Color Used | Files |
|---------|-----------|-------|
| Active | `color="success"` OR `color="primary"` | Varies by file |
| Inactive | `color="error"` OR `variant="outlined"` | Varies |
| Paused/Warning | `color="warning"` | Consistent |
| Pending/Info | `color="info"` OR `color="default"` | Varies |
| Count badge | `size="small"` custom sx | AdminHub |

### Issues
- **No centralized status-to-color mapping** — each file decides independently
- **Active can be green OR blue** depending on the view
- **No StatusChip component** to enforce consistency

---

## 7. Loading States

### Patterns in Use
- `CircularProgress` — inline loading spinners (dialogs, buttons)
- `LinearProgress` — page-level loader (`src/ui-component/Loader.jsx`)
- `Skeleton` — dashboard card shapes (`src/ui-component/cards/Skeleton/`)

### Issues
- **No unified loading overlay** component
- **Some views show nothing during load** — no skeleton or spinner
- **Inconsistent placement** — sometimes centered, sometimes inline

---

## 8. Empty States

### Pattern: `<Alert severity="info">No data message</Alert>`

### Issues
- **No dedicated EmptyState component** with icon + title + message
- **Message text varies** — "No data found", "Nothing here yet", etc.
- **Some tables have no empty state at all** (just render empty tbody)

---

## 9. Toast / Notifications

### Existing: `src/contexts/ToastContext.jsx`
- Methods: `toast.success()`, `toast.error()`, `toast.warning()`, `toast.info()`
- Renders Snackbar with Alert at bottom-right
- Auto-dismiss after 5000ms

### Status: Well-implemented and used consistently. No issues.

---

## 10. Hardcoded Colors

### Violations Found
| File | Line | Value | Should Be |
|------|------|-------|-----------|
| AdminHub.jsx | 2574 | `#666` | `text.secondary` |
| AdminHub.jsx | 2591 | `#fff` | `common.white` |
| AdminHub.jsx | 2722 | `#1877F2` | Brand color constant |
| AdminHub.jsx | 2829 | `#E4405F` | Brand color constant |
| AnchorStepIcon.jsx | 34 | `rgba(33,150,243,0.18)` | `alpha(theme.palette.primary.main, 0.18)` |

**Note:** OAuth provider brand colors (Facebook blue, Instagram pink) are acceptable as hardcoded constants in a brand color map, but should not be inline.

---

## Summary: What Needs Extraction

| Priority | Component | Instances to Replace | Effort |
|----------|-----------|---------------------|--------|
| 1 | **ConfirmDialog** | ~25 confirmation dialogs | M |
| 2 | **DataTable** | 16+ tables across 12 files | XL |
| 3 | **StatusChip** | 150+ chip instances | M |
| 4 | **EmptyState** | 20+ empty state patterns | S |
| 5 | **FormDialog** | 40+ form dialogs | L |
| 6 | **LoadingButton** | 30+ button loading patterns | S |
| 7 | **FormField** | Hundreds of form inputs | XL |
| 8 | **Brand Colors Map** | 5+ hardcoded color values | S |
