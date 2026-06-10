# Feature: TaskManager.jsx Decomposition (TM-009)

## Problem

TaskManager.jsx is a 2,374-line monolith with 87 `useState` variables, ~35 handler functions, 15 `useEffect` hooks, and ~384 lines of drawer JSX. Every `setState` call re-renders the entire component tree. The file is unmaintainable, difficult to reason about, and a performance bottleneck.

## Solution

Extract state and logic into 10 focused custom hooks and 4 extracted sub-components, reducing the orchestrator to ~200 lines that wires hooks together and routes panes.

## Prerequisites

Complete these first (Phase 0):
- **TM-002**: Fix `selectedItem` → `activeItem` (line 375)
- **TM-003**: Fix `handleToggleGlobalAutomation` undeclared `setGlobalAutomations` (line 965)
- **TM-004**: Remove dead state (`viewPopperAnchor`, `viewPopperUpdateId`) and orphaned reports pane (~280 lines)
- **TM-007**: Deduplicate `DEFAULT_STATUS_LABELS`, `getStatusColor()`, `fmtMinutes()`

---

## Hook Extraction Plan

### Hook 1: `useBoardView(activeBoardId, activeWorkspaceId, pane, setError)`

**State moves here (13 vars):**
- `boardViewLoading`, `boardView`, `boardSearch`, `boardViewType`
- `exportingCsv`
- `newGroupName`, `creatingGroup`
- `newItemNameByGroup`, `creatingItemByGroup`
- `boardReport`, `boardReportLoading`
- `workspaceBoards`, `workspaceBoardsLoading`

**Handlers move here:**
- `loadBoardView(boardId)` — fetches board view data
- `loadBoardReport(boardId)` — fetches board report
- `handleCreateGroup()` — creates group, reloads view
- `handleDeleteGroup(groupId, closeDrawerFn)` — deletes group, accepts closeDrawer callback
- `handleCreateItem(groupId)` — creates item, reloads view
- `handleDownloadCsv()` — exports CSV
- `updateItemInline(itemId, payload, refreshMyWorkFn)` — inline edit, reloads view
- `toggleAssigneeInline(itemId, userId, refreshMyWorkFn)` — toggle assignee, reloads view
- `archiveItem(itemId, closeDrawerFn, refreshMyWorkFn)` — archives item, reloads view

**useEffects move here (2):**
- Board view load on `[activeBoardId, pane]` (line 563)
- Workspace boards on `[activeWorkspaceId, pane]` (line 583)

**Derived values:**
- `statusLabels` — `boardView?.status_labels || DEFAULT_STATUS_LABELS`
- `itemsByGroup` — useMemo filtering items by group + search

**Returns:**
```js
{
  boardView, boardViewLoading, boardSearch, setBoardSearch, boardViewType, setBoardViewType,
  boardReport, boardReportLoading, exportingCsv,
  workspaceBoards, workspaceBoardsLoading,
  statusLabels, itemsByGroup,
  newGroupName, setNewGroupName, creatingGroup,
  newItemNameByGroup, setNewItemNameByGroup, creatingItemByGroup,
  loadBoardView, loadBoardReport,
  handleCreateGroup, handleDeleteGroup, handleCreateItem, handleDownloadCsv,
  updateItemInline, toggleAssigneeInline, archiveItem,
  updateStatusLabelsInView  // callback for useStatusLabels to update boardView.status_labels
}
```

**Cross-dep note:** `updateStatusLabelsInView(fn)` exposes a setter that `useStatusLabels` calls to update labels in the board view without owning `boardView` state. Pattern: `updateStatusLabelsInView(labels => [...labels, newLabel])`.

### Hook 2: `useItemDrawer(activeBoardId, searchParams, setSearchParams)`

**State moves here (7 vars):**
- `activeItem`, `itemDrawerOpen`, `drawerTab`
- `highlightedItemId`, `itemCardRefs`
- `assignees`, `assigneesLoading`, `newAssigneeUserId`, `addingAssignee`

**Handlers move here:**
- `openItemDrawer(item, tab, resetFns)` — opens drawer, resets all sub-hook state via `resetFns`, fires 6 parallel data loads
- `closeItemDrawer()` — closes drawer, clears URL param
- `handleAddAssignee()` — adds assignee to item
- `handleRemoveAssignee(userId)` — removes assignee
- `updateItemField(field, value)` — updates item field from drawer header

**useEffects move here (2):**
- Scroll-into-view on `[activeItem?.id]` (line 1162)
- Deep-link on `[boardView, searchParams]` (line 1174) — needs `boardView` passed in

**Returns:**
```js
{
  activeItem, itemDrawerOpen, drawerTab, setDrawerTab,
  highlightedItemId, itemCardRefs,
  assignees, assigneesLoading, newAssigneeUserId, setNewAssigneeUserId, addingAssignee,
  openItemDrawer, closeItemDrawer,
  handleAddAssignee, handleRemoveAssignee, updateItemField,
  resetDrawerAssignees  // for openItemDrawer to call
}
```

### Hook 3: `useItemUpdates(activeItemId, workspaceMembers, activeWorkspaceId, setError)`

**State moves here (14 vars):**
- `itemUpdates`, `itemUpdatesLoading`, `newUpdateText`, `postingUpdate`
- `updateInputRef`, `mentionOpen`, `mentionQuery`, `mentionOptions`, `mentionLoading`
- `updateViews`
- `aiSummary`, `aiSummaryMeta`, `aiSummaryLoading`, `aiSummaryRefreshing`

**Handlers move here:**
- `handlePostUpdate()` — posts update, refreshes list
- `getMentionStateFromText(text, caretIndex)` — pure function
- `insertMention(member)` — inserts @mention into text
- `handleRefreshAiSummary()` — refreshes AI summary
- `loadUpdates(itemId)` — fetches updates + marks as viewed

**useEffects move here (1):**
- Mention autocomplete search on `[mentionOpen, mentionQuery]` (line 1222)

**Returns:**
```js
{
  itemUpdates, itemUpdatesLoading, newUpdateText, setNewUpdateText, postingUpdate,
  updateInputRef, mentionOpen, mentionQuery, mentionOptions, mentionLoading,
  updateViews,
  aiSummary, aiSummaryMeta, aiSummaryLoading, aiSummaryRefreshing,
  handlePostUpdate, insertMention, handleRefreshAiSummary,
  loadUpdates, reset
}
```

### Hook 4: `useItemTimeTracking(activeItemId, setError)`

**State moves here (11 vars):**
- `timeEntries`, `timeEntriesLoading`, `loggingTime`
- `timeBillable`, `timeCategory`, `timeDescription`
- `timeHours`, `timeMins`, `billableHours`, `billableMins`, `billableTouched`

**Handlers move here:**
- `handleLogTime(loadBoardViewFn)` — logs time entry, calls loadBoardView to refresh time totals

**useEffects move here (2):**
- Sync billable on `[timeBillable]` (line 440)
- Mirror billable on `[timeHours, timeMins, timeBillable, billableTouched]` (line 457)

**Returns:**
```js
{
  timeEntries, timeEntriesLoading, loggingTime,
  timeBillable, setTimeBillable, timeCategory, setTimeCategory, timeDescription, setTimeDescription,
  timeHours, setTimeHours, timeMins, setTimeMins,
  billableHours, setBillableHours, billableMins, setBillableMins, billableTouched, setBillableTouched,
  handleLogTime, loadTimeEntries, reset
}
```

### Hook 5: `useItemFiles(activeItemId, setError)`

**State moves here (3 vars):**
- `itemFiles`, `itemFilesLoading`, `uploadingFile`

**Handlers:**
- `handleUploadFile(file)` — uploads file
- `loadFiles(itemId)` — fetches files

**Returns:**
```js
{ itemFiles, itemFilesLoading, uploadingFile, handleUploadFile, loadFiles, reset }
```

### Hook 6: `useItemSubitems(activeItemId, setError)`

**State moves here (4 vars):**
- `subitems`, `subitemsLoading`, `newSubitemName`, `creatingSubitem`

**Handlers:**
- `handleCreateSubitem()`, `handleToggleSubitemDone(sub)`, `handleDeleteSubitem(subitemId)`
- `loadSubitems(itemId)` — fetches subitems

**Returns:**
```js
{
  subitems, subitemsLoading, newSubitemName, setNewSubitemName, creatingSubitem,
  handleCreateSubitem, handleToggleSubitemDone, handleDeleteSubitem, loadSubitems, reset
}
```

### Hook 7: `useAutomations(activeBoardId, setError)`

**State moves here (14 vars):**
- `automations`, `automationsLoading`, `creatingAutomation`
- `automationsDrawerOpen`
- `automationToStatus`, `automationAction`, `automationTitle`, `automationBody`
- `automationRuns`, `automationRunsLoading`
- `editingAutomation`, `editDraft`
- `deleteAutomationConfirmOpen`, `automationToDelete`

**Handlers:**
- `loadAutomations(boardId)`, `loadAutomationRuns(scope, boardId)`
- `handleAddNeedsAttentionAutomation()`
- `handleCreateAutomation()`
- `handleToggleAutomation(rule)`
- `handleDeleteAutomationClick(automation)`, `handleDeleteAutomationConfirm()`

**useEffects (1):**
- Close drawer on pane change (line 435)

**Returns:**
```js
{
  automations, automationsLoading, creatingAutomation,
  automationsDrawerOpen, setAutomationsDrawerOpen,
  automationToStatus, setAutomationToStatus, automationAction, setAutomationAction,
  automationTitle, setAutomationTitle, automationBody, setAutomationBody,
  automationRuns, automationRunsLoading,
  editingAutomation, setEditingAutomation, editDraft, setEditDraft,
  deleteAutomationConfirmOpen, automationToDelete,
  loadAutomations, loadAutomationRuns,
  handleAddNeedsAttentionAutomation, handleCreateAutomation,
  handleToggleAutomation,
  handleDeleteAutomationClick, handleDeleteAutomationConfirm
}
```

### Hook 8: `useStatusLabels(activeBoardId, updateStatusLabelsInViewFn, setError)`

**State moves here (7 vars):**
- `statusLabelsDialogOpen`, `editingLabel`, `newLabelText`, `newLabelColor`, `savingLabel`
- `deleteLabelConfirmOpen`, `labelToDelete`

**Handlers:**
- `handleInitializeLabels()`, `handleAddLabel()`, `handleCreateLabelFromBoardTable(text, color, isGlobal)`
- `handleUpdateLabel(labelId, updates)`, `handleDeleteLabelClick(label)`, `handleDeleteLabelConfirm()`

All label handlers call `updateStatusLabelsInViewFn` (from useBoardView) to update the labels in boardView.

**Returns:**
```js
{
  statusLabelsDialogOpen, setStatusLabelsDialogOpen,
  editingLabel, setEditingLabel, newLabelText, setNewLabelText, newLabelColor, setNewLabelColor, savingLabel,
  deleteLabelConfirmOpen, labelToDelete,
  handleInitializeLabels, handleAddLabel, handleCreateLabelFromBoardTable,
  handleUpdateLabel, handleDeleteLabelClick, handleDeleteLabelConfirm
}
```

### Hook 9: `useMyWork(pane, userId, setError)`

**State moves here (3 vars):**
- `myWorkBoards`, `myWorkLoading`, `myWorkMembers`

**Derived (useMemo):**
- `myWorkGroups`, `myWorkItemsByGroup`, `myWorkAssigneesByItem`, `myWorkUpdateCounts`, `myWorkTimeTotals`

**useEffects (2):**
- Load my work on `[pane]` (line 609)
- Load members on `[pane, myWorkBoards]` (line 663)

**Returns:**
```js
{
  myWorkBoards, myWorkLoading, myWorkMembers,
  myWorkGroups, myWorkItemsByGroup, myWorkAssigneesByItem, myWorkUpdateCounts, myWorkTimeTotals,
  refreshMyWork
}
```

---

## Component Extraction Plan

### Component 1: `ItemDrawer.jsx` (~400 lines)

Extract the item drawer `<Drawer>` (lines 1825-2209) into a standalone component.

**Props:**
```js
{
  open, onClose, activeItem,
  drawerTab, onChangeTab,
  // Updates
  updatesProps: { itemUpdates, itemUpdatesLoading, newUpdateText, onChangeUpdateText, ... },
  // Files
  filesProps: { itemFiles, itemFilesLoading, uploadingFile, onUploadFile },
  // Time
  timeProps: { timeEntries, timeEntriesLoading, loggingTime, ... },
  // Subitems
  subitemsProps: { subitems, subitemsLoading, ... },
  // Assignees
  assigneesProps: { assignees, assigneesLoading, ... },
  // AI
  aiProps: { aiSummary, aiSummaryMeta, aiSummaryLoading, aiSummaryRefreshing, onRefreshAiSummary },
  // Board
  statusLabels, workspaceMembers, isAdmin,
  onUpdateItemField, onOpenStatusLabelsDialog
}
```

Consider further extracting the 3 tabs into `ItemUpdatesTab.jsx`, `ItemFilesTab.jsx`, `ItemTimeTab.jsx` internally.

### Component 2: `AutomationsDrawer.jsx` (~130 lines)

Extract the automations `<Drawer>` (lines 1567-1699).

**Props:**
```js
{
  open, onClose,
  automations, automationsLoading, creatingAutomation,
  automationRuns, automationRunsLoading,
  onToggleAutomation, onDeleteAutomation, onEditAutomation,
  onAddTemplate, onOpenAutomationsPane
}
```

### Component 3: `EditAutomationDialog.jsx` (~120 lines)

Extract the edit automation `<Dialog>` (lines 1702-1823).

**Props:**
```js
{
  open, onClose,
  automation, editDraft, onChangeDraft,
  statusLabels, onSave
}
```

### Component 4: `StatusLabelsDialog.jsx` (~135 lines)

Extract the status labels editor `<Dialog>` (lines 2211-2346).

**Props:**
```js
{
  open, onClose,
  statusLabels, editingLabel, setEditingLabel,
  newLabelText, newLabelColor, savingLabel,
  onSetNewLabelText, onSetNewLabelColor,
  onInitializeLabels, onAddLabel, onUpdateLabel, onDeleteLabelClick
}
```

---

## Resulting TaskManager.jsx (~200 lines)

```jsx
export default function TaskManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [workspaceMembers, setWorkspaceMembers] = useState([]);

  const pane = /* derive from searchParams */;
  const activeBoardId = /* derive from searchParams */;
  const activeWorkspaceId = /* derive from searchParams */;

  // Load workspace members
  useEffect(() => { /* line 483 logic */ }, [activeWorkspaceId]);

  // Error toast
  useEffect(() => { /* line 174 logic */ }, [error, toast]);

  // Hooks
  const boardView = useBoardView(activeBoardId, activeWorkspaceId, pane, setError);
  const drawer = useItemDrawer(activeBoardId, searchParams, setSearchParams);
  const updates = useItemUpdates(drawer.activeItem?.id, workspaceMembers, activeWorkspaceId, setError);
  const timeTracking = useItemTimeTracking(drawer.activeItem?.id, setError);
  const files = useItemFiles(drawer.activeItem?.id, setError);
  const subitems = useItemSubitems(drawer.activeItem?.id, setError);
  const automations = useAutomations(activeBoardId, setError);
  const labels = useStatusLabels(activeBoardId, boardView.updateStatusLabelsInView, setError);
  const myWork = useMyWork(pane, user?.id, setError);

  // Wire cross-hook callbacks
  const handleArchiveItem = (itemId) => boardView.archiveItem(itemId, drawer.closeItemDrawer, myWork.refreshMyWork);
  // ... similar wiring for other cross-deps

  return (
    <>
      <BoardHeader ... />
      {renderPaneContent()}
      <ItemDrawer ... />
      <AutomationsDrawer ... />
      <EditAutomationDialog ... />
      <StatusLabelsDialog ... />
      <ConfirmDialog /* delete label */ ... />
      <ConfirmDialog /* delete automation */ ... />
    </>
  );
}
```

---

## File Structure

```
src/views/tasks/
├── TaskManager.jsx                    (~200 lines, orchestrator)
├── hooks/
│   ├── useBoardView.js               (~200 lines)
│   ├── useItemDrawer.js              (~120 lines)
│   ├── useItemUpdates.js             (~120 lines)
│   ├── useItemTimeTracking.js        (~80 lines)
│   ├── useItemFiles.js               (~40 lines)
│   ├── useItemSubitems.js            (~60 lines)
│   ├── useAutomations.js             (~120 lines)
│   ├── useStatusLabels.js            (~100 lines)
│   └── useMyWork.js                  (~100 lines)
├── components/
│   ├── BoardTable.jsx                (existing, unchanged)
│   ├── BoardHeader.jsx               (existing, unchanged)
│   ├── ItemDrawer.jsx                (~400 lines, NEW)
│   ├── AutomationsDrawer.jsx         (~130 lines, NEW)
│   ├── EditAutomationDialog.jsx      (~120 lines, NEW)
│   └── StatusLabelsDialog.jsx        (~135 lines, NEW)
└── panes/
    ├── HomePane.jsx                  (existing, unchanged)
    ├── MyWorkPane.jsx                (existing, unchanged)
    ├── AutomationsPane.jsx           (existing, unchanged)
    └── BillingPane.jsx               (existing, unchanged)
```

---

## Execution Order

1. Create all hook files (empty shells with correct signatures)
2. Move state + handlers into hooks one at a time, starting with least-coupled:
   - `useItemFiles` (3 vars, 2 handlers, 0 cross-deps)
   - `useItemSubitems` (4 vars, 3 handlers, 0 cross-deps)
   - `useItemTimeTracking` (11 vars, 1 handler, 2 effects)
   - `useItemUpdates` (14 vars, 4 handlers, 1 effect)
   - `useMyWork` (3 vars + 5 memos, 1 handler, 2 effects)
   - `useStatusLabels` (7 vars, 6 handlers, cross-dep: updateStatusLabelsInView)
   - `useAutomations` (14 vars, 8 handlers, 1 effect)
   - `useItemDrawer` (7 vars, 5 handlers, 2 effects)
   - `useBoardView` (13 vars, 9 handlers, 2 effects) — last, most cross-deps
3. Extract components:
   - `StatusLabelsDialog.jsx`
   - `EditAutomationDialog.jsx`
   - `AutomationsDrawer.jsx`
   - `ItemDrawer.jsx`
4. Wire everything in TaskManager.jsx orchestrator
5. `yarn build` after each extraction to catch issues early

## Validation

1. `yarn build` — must pass with no errors
2. Navigate to boards pane — board loads, items display, inline editing works
3. Open item drawer — all 3 tabs work (updates, files, time)
4. Post update with @mention — mention autocomplete works
5. Log time entry — time appears in list and board view column
6. Upload file — file appears in list
7. Create/toggle/delete subitem — all work
8. Open automations drawer — automations list, create, toggle, delete all work
9. Edit automation dialog — name, trigger, action all save correctly
10. Status labels dialog — create, edit, delete labels all work
11. My Work pane — assigned items display correctly
12. Deep-link with `?item=<id>` — drawer opens to correct item
13. No console errors in browser devtools
