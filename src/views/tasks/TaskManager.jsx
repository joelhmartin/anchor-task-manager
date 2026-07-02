import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Button, Divider, Stack, TextField, Typography
} from '@mui/material';
import { updateTaskBoard, fetchItemDependencies, fetchMirrorData, fetchBaselines, fetchBaseline, createBaseline, fetchCriticalPath } from 'api/tasks';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import MainCard from 'ui-component/cards/MainCard';
import useAuth from 'hooks/useAuth';
import { useToast } from 'contexts/ToastContext';
import { useTaskContext } from 'contexts/TaskContext';

import BoardHeader from './components/BoardHeader';
import BoardTable from './components/BoardTable';
import CalendarView from './components/CalendarView';
import ChartView from './components/ChartView';
import KanbanBoard from './components/KanbanBoard';
import WorkloadView from './components/WorkloadView';
import TimelineView from './components/TimelineView';
import FilterBar from './components/FilterBar';
import SortMenu from './components/SortMenu';
import ItemDrawer from './components/ItemDrawer';
import AutomationsDrawer from './components/AutomationsDrawer';
import StatusLabelsDialog from './components/StatusLabelsDialog';
import HomePane from './panes/HomePane';
import MyWorkPane from './panes/MyWorkPane';
import DashboardPane from './panes/DashboardPane';
import AutomationsPane from './panes/AutomationsPane';
import BillingPane from './panes/BillingPane';
import AuditLogPane from './panes/AuditLogPane';
import WorkloadPane from './panes/WorkloadPane';
import PortfolioPane from './panes/PortfolioPane';

import useBoardView from './hooks/useBoardView';
import useFilters from './hooks/useFilters';
import useItemDrawer from './hooks/useItemDrawer';
import useItemUpdates from './hooks/useItemUpdates';
import useItemTimeTracking from './hooks/useItemTimeTracking';
import useItemFiles from './hooks/useItemFiles';
import useItemSubitems from './hooks/useItemSubitems';
import useItemActivity from './hooks/useItemActivity';
import useStatusLabels from './hooks/useStatusLabels';
import useMyWork from './hooks/useMyWork';

export default function TaskManager() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPane = searchParams.get('pane') || 'home';
  const pane = ['home', 'boards', 'my-work', 'dashboards', 'automations', 'billing', 'audit-log', 'portfolio', 'workload'].includes(rawPane) ? rawPane : 'home';

  const [error, setError] = useState('');
  const toast = useToast();
  const lastToastErrorRef = useRef('');

  useEffect(() => {
    if (!error) return;
    if (lastToastErrorRef.current === error) return;
    lastToastErrorRef.current = error;
    toast.error(error);
  }, [error, toast]);

  const activeWorkspaceId = searchParams.get('workspace') || '';
  const activeBoardId = searchParams.get('board') || '';
  const { workspaceMembers, workspaceLabels, loadLabels } = useTaskContext();
  const isAdmin = ['superadmin', 'admin'].includes(user?.effective_role);

  // ─── Hooks ───
  const board = useBoardView(activeBoardId, activeWorkspaceId, pane, searchParams, setSearchParams, setError);
  const drawer = useItemDrawer(activeBoardId, searchParams, setSearchParams, setError);
  const updates = useItemUpdates(workspaceMembers, activeWorkspaceId, setError);
  const time = useItemTimeTracking(setError);
  const files = useItemFiles(setError);
  const subs = useItemSubitems(setError);
  const activity = useItemActivity(setError);
  const [automationsDrawerOpen, setAutomationsDrawerOpen] = useState(false);
  const labels = useStatusLabels(activeBoardId, board.updateStatusLabelsInView);
  const myWork = useMyWork(pane, user?.id);

  // ─── Timeline dependencies ───
  const [timelineDeps, setTimelineDeps] = useState([]);
  const loadTimelineDeps = useCallback(async (items) => {
    if (!items?.length) { setTimelineDeps([]); return; }
    try {
      const seen = new Set();
      const allDeps = [];
      const results = await Promise.all(items.map((it) => fetchItemDependencies(it.id).catch(() => ({ predecessors: [], successors: [] }))));
      for (const r of results) {
        for (const dep of [...(r.predecessors || []), ...(r.successors || [])]) {
          if (!seen.has(dep.id)) {
            seen.add(dep.id);
            allDeps.push(dep);
          }
        }
      }
      setTimelineDeps(allDeps);
    } catch (_err) {
      setTimelineDeps([]);
    }
  }, []);

  useEffect(() => {
    if (board.boardViewType === 'timeline' && board.boardView?.items?.length) {
      loadTimelineDeps(board.boardView.items);
    } else {
      setTimelineDeps([]);
    }
  }, [board.boardViewType, board.boardView?.items, loadTimelineDeps]);

  // ─── Baseline & Critical Path ───
  const [baselineSnapshot, setBaselineSnapshot] = useState(null);
  const [criticalPathIds, setCriticalPathIds] = useState([]);

  useEffect(() => {
    if (board.boardViewType !== 'timeline' || !activeBoardId) {
      setBaselineSnapshot(null);
      setCriticalPathIds([]);
      return;
    }
    let cancelled = false;
    // Load critical path
    fetchCriticalPath(activeBoardId)
      .then((result) => { if (!cancelled) setCriticalPathIds((result.critical_path || []).map((i) => i.id)); })
      .catch(() => { if (!cancelled) setCriticalPathIds([]); });
    // Load latest baseline if any
    fetchBaselines(activeBoardId)
      .then(async (baselines) => {
        if (cancelled || !baselines.length) return;
        const latest = await fetchBaseline(baselines[0].id);
        if (!cancelled && latest?.snapshot) setBaselineSnapshot(latest.snapshot);
      })
      .catch(() => { if (!cancelled) setBaselineSnapshot(null); });
    return () => { cancelled = true; };
  }, [board.boardViewType, activeBoardId]);

  // ─── Mirror columns ───
  const [mirrorColumns, setMirrorColumns] = useState([]);
  const [mirrorData, setMirrorData] = useState({});
  useEffect(() => {
    if (!activeBoardId) { setMirrorColumns([]); setMirrorData({}); return; }
    let cancelled = false;
    fetchMirrorData(activeBoardId)
      .then((result) => {
        if (cancelled) return;
        setMirrorColumns(result.mirror_columns || []);
        setMirrorData(result.mirror_data || {});
      })
      .catch(() => {
        if (!cancelled) { setMirrorColumns([]); setMirrorData({}); }
      });
    return () => { cancelled = true; };
  }, [activeBoardId]);

  // ─── Filter & Sort ───
  // Enrich items with assignee data for filtering
  const enrichedItems = useMemo(() => {
    const items = board.boardView?.items || [];
    const assigneesMap = board.boardView?.assignees_by_item || {};
    const updateCountsMap = board.boardView?.update_counts_by_item || {};
    const timeTotalsMap = board.boardView?.time_totals_by_item || {};
    return items.map((it) => ({
      ...it,
      assignees: assigneesMap[it.id] || [],
      assignee_count: (assigneesMap[it.id] || []).length,
      update_count: updateCountsMap[it.id] || 0,
      time_total: timeTotalsMap[it.id] || 0
    }));
  }, [board.boardView]);
  const filterHook = useFilters({ items: enrichedItems, itemLabelsMap: board.itemLabelsMap });
  const [filterBarVisible, setFilterBarVisible] = useState(false);
  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);
  const sortButtonRef = useRef(null);

  // ─── Cross-hook wiring ───
  const handleOpenItemDrawer = (item, tab) => {
    if (tab) drawer.setDrawerTab(tab);
    drawer.openItemDrawer(item, {
      resetFns: [updates.reset, time.reset, files.reset, subs.reset, activity.reset],
      loadFns: [updates.loadUpdates, files.loadFiles, time.loadTimeEntries, updates.loadAiSummary, subs.loadSubitems, activity.loadActivity]
    });
  };

  const handleArchiveItem = (itemId) =>
    board.archiveItem(itemId, {
      closeDrawerFn: drawer.closeItemDrawer,
      refreshMyWork: myWork.refreshMyWork,
      activeItem: drawer.activeItem
    });

  const handleDeleteGroup = (groupId) =>
    board.handleDeleteGroup(groupId, drawer.closeItemDrawer);

  const handleUpdateItemInline = (itemId, patch) =>
    board.updateItemInline(itemId, patch, {
      activeItem: drawer.activeItem,
      setActiveItem: drawer.setActiveItem,
      refreshMyWork: myWork.refreshMyWork
    });

  const handleToggleAssigneeInline = (itemId, userId, isAssigned) =>
    board.toggleAssigneeInline(itemId, userId, isAssigned, {
      workspaceMembers,
      activeItem: drawer.activeItem,
      setAssignees: drawer.setAssignees,
      refreshMyWork: myWork.refreshMyWork
    });

  const handleToggleItemLabel = (itemId, labelId, isApplied) =>
    board.toggleItemLabel(itemId, labelId, isApplied);

  // Bulk-action toolbar wiring. Each handler delegates to useBoardView, which
  // owns the mutation + refresh cycle and shows the success/error toast.
  const handleBulkStatus = (itemIds, status) =>
    board.bulkUpdateStatus(itemIds, status, { refreshMyWork: myWork.refreshMyWork });
  const handleBulkAssignees = (itemIds, userId, action) =>
    board.bulkUpdateAssignees(itemIds, userId, action, { refreshMyWork: myWork.refreshMyWork });
  const handleBulkLabels = (itemIds, labelId, action) =>
    board.bulkUpdateLabels(itemIds, labelId, action);
  const handleBulkArchive = (itemIds) =>
    board.bulkArchive(itemIds, {
      closeDrawerFn: drawer.closeItemDrawer,
      refreshMyWork: myWork.refreshMyWork,
      activeItem: drawer.activeItem
    });

  const handleUpdateItemField = (patch) =>
    drawer.updateItemField(patch, {
      loadBoardView: board.loadBoardView,
      loadBoardReport: board.loadBoardReport
    });

  const handleRenameItem = (name) =>
    drawer.renameItem(name, {
      loadBoardView: board.loadBoardView,
      loadBoardReport: board.loadBoardReport
    });

  const handleLogTime = () =>
    time.handleLogTime(drawer.activeItem?.id, () => board.loadBoardView(activeBoardId));

  const handlePostUpdate = () => updates.handlePostUpdate(drawer.activeItem?.id);
  const handlePostReply = () => updates.handlePostReply(drawer.activeItem?.id);
  const handleRefreshAiSummary = () => updates.handleRefreshAiSummary(drawer.activeItem?.id);
  const handleUploadFile = (file) => files.handleUploadFile(drawer.activeItem?.id, file);
  const handleDeleteFile = (fileId) => files.handleDeleteFile(drawer.activeItem?.id, fileId);

  // Deep-link effect: open item from URL
  useEffect(() => {
    const itemFromUrl = searchParams.get('item') || '';
    if (!itemFromUrl || !board.boardView?.items?.length) return;
    if (drawer.activeItem?.id === itemFromUrl && drawer.itemDrawerOpen) return;
    const found = board.boardView.items.find((it) => it.id === itemFromUrl);
    if (found) handleOpenItemDrawer(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.boardView, searchParams]);

  // ─── Filtered itemsByGroup (replaces board.itemsByGroup when filters/sort active) ───
  const filteredItemsByGroup = useMemo(() => {
    // Start from the filtered+sorted items, then apply the board search on top
    let items = filterHook.filteredItems;
    if (board.boardSearch.trim()) {
      const q = board.boardSearch.trim().toLowerCase();
      items = items.filter((it) => String(it.name || '').toLowerCase().includes(q));
    }
    const map = {};
    for (const it of items) {
      if (!map[it.group_id]) map[it.group_id] = [];
      map[it.group_id].push(it);
    }
    return map;
  }, [filterHook.filteredItems, board.boardSearch]);

  // ─── Pane rendering ───
  const renderContent = () => {
    if (pane === 'home') return <HomePane />;

    if (pane === 'automations')
      return (
        <AutomationsPane
          activeBoardId={activeBoardId}
          activeWorkspaceId={activeWorkspaceId}
          boardStatusLabels={board.statusLabels}
          onSelectBoard={(boardId) => {
            const next = new URLSearchParams(searchParams);
            next.set('pane', 'boards');
            if (activeWorkspaceId) next.set('workspace', activeWorkspaceId);
            next.set('board', boardId);
            setSearchParams(next);
          }}
        />
      );

    if (pane === 'dashboards') return <DashboardPane activeWorkspaceId={activeWorkspaceId} />;

    if (pane === 'billing') return <BillingPane />;

    if (pane === 'audit-log') return <AuditLogPane />;

    if (pane === 'portfolio') return <PortfolioPane />;

    if (pane === 'workload') return <WorkloadPane />;

    if (pane === 'my-work')
      return (
        <MyWorkPane
          loading={myWork.myWorkLoading}
          groups={myWork.myWorkGroups}
          itemsByGroup={myWork.myWorkItemsByGroup}
          assigneesByItem={myWork.myWorkAssigneesByItem}
          updateCountsByItem={myWork.myWorkUpdateCounts}
          timeTotalsByItem={myWork.myWorkTimeTotals}
          workspaceMembers={myWork.myWorkMembers}
          subitems={myWork.myWorkSubitems}
          onUpdateItem={handleUpdateItemInline}
          onToggleAssignee={handleToggleAssigneeInline}
          onClickItem={(it, tab) => handleOpenItemDrawer(it, tab)}
        />
      );

    // Boards pane
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, minHeight: 420 }}>
        {!activeBoardId && (
          <Typography variant="body2" color="text.secondary">
            Select a board from the sidebar to begin.
          </Typography>
        )}

        {activeBoardId && board.boardViewType === 'kanban' && (
          <KanbanBoard
            items={filterHook.filteredItems}
            statusLabels={board.statusLabels}
            itemLabelsMap={board.itemLabelsMap}
            assigneesByItem={board.boardView?.assignees_by_item || {}}
            onUpdateItem={handleUpdateItemInline}
            onClickItem={(it) => handleOpenItemDrawer(it)}
          />
        )}

        {activeBoardId && board.boardViewType === 'timeline' && (
          <TimelineView
            items={filterHook.filteredItems}
            groups={board.boardView?.groups || []}
            statusLabels={board.statusLabels}
            itemLabelsMap={board.itemLabelsMap}
            loading={board.boardViewLoading}
            onItemClick={(it) => handleOpenItemDrawer(it)}
            dependencies={timelineDeps}
            baselineSnapshot={baselineSnapshot}
            criticalPathIds={criticalPathIds}
          />
        )}

        {activeBoardId && board.boardViewType === 'calendar' && (
          <CalendarView
            items={filterHook.filteredItems}
            groups={board.boardView?.groups || []}
            statusLabels={board.statusLabels}
            itemLabelsMap={board.itemLabelsMap}
            onItemClick={(it) => handleOpenItemDrawer(it)}
          />
        )}

        {activeBoardId && board.boardViewType === 'chart' && (
          <ChartView
            items={filterHook.filteredItems}
            groups={board.boardView?.groups || []}
            statusLabels={board.statusLabels}
            itemLabelsMap={board.itemLabelsMap}
            onItemClick={(it) => handleOpenItemDrawer(it)}
          />
        )}

        {activeBoardId && board.boardViewType === 'workload' && (
          <WorkloadView
            items={filterHook.filteredItems}
            groups={board.boardView?.groups || []}
            statusLabels={board.statusLabels}
            assigneesByItem={board.boardView?.assignees_by_item || {}}
            onItemClick={(it) => handleOpenItemDrawer(it)}
          />
        )}

        {activeBoardId && !['kanban', 'timeline', 'calendar', 'chart', 'workload'].includes(board.boardViewType) && (
          <Stack spacing={1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <TextField
                fullWidth
                size="small"
                label="New group"
                value={board.newGroupName}
                onChange={(e) => board.setNewGroupName(e.target.value)}
              />
              <Button variant="contained" onClick={board.handleCreateGroup} disabled={board.creatingGroup || !board.newGroupName.trim()}>
                Create group
              </Button>
            </Stack>

            <Divider />

            <BoardTable
              boardId={activeBoardId}
              loading={board.boardViewLoading}
              groups={board.boardView?.groups || []}
              itemsByGroup={filteredItemsByGroup}
              assigneesByItem={board.boardView?.assignees_by_item || {}}
              workspaceMembers={workspaceMembers}
              updateCountsByItem={board.boardView?.update_counts_by_item || {}}
              timeTotalsByItem={board.boardView?.time_totals_by_item || {}}
              itemLabelsMap={board.itemLabelsMap}
              workspaceLabels={workspaceLabels}
              statusLabels={board.statusLabels}
              canManageLabels={isAdmin}
              onCreateStatusLabel={labels.handleCreateLabelFromBoardTable}
              onToggleItemLabel={handleToggleItemLabel}
              onArchiveItem={handleArchiveItem}
              onDeleteGroup={isAdmin ? handleDeleteGroup : undefined}
              highlightedItemId={drawer.highlightedItemId}
              onUpdateItem={handleUpdateItemInline}
              onToggleAssignee={handleToggleAssigneeInline}
              newItemNameByGroup={board.newItemNameByGroup}
              creatingItemByGroup={board.creatingItemByGroup}
              onChangeNewItemName={(groupId, val) =>
                board.setNewItemNameByGroup((prev) => ({ ...prev, [groupId]: val }))
              }
              onCreateItem={board.handleCreateItem}
              onClickItem={(it, tab) => handleOpenItemDrawer(it, tab)}
              mirrorColumns={mirrorColumns}
              mirrorData={mirrorData}
              onBulkStatus={handleBulkStatus}
              onBulkAssignees={handleBulkAssignees}
              onBulkLabels={handleBulkLabels}
              onBulkArchive={handleBulkArchive}
            />
          </Stack>
        )}
      </Box>
    );
  };

  return (
    <MainCard title="Task Manager">
      <Stack spacing={2}>
        {pane === 'boards' && activeBoardId && (
          <>
            <BoardHeader
              board={board.boardView?.board}
              view={board.boardViewType}
              onChangeView={board.setBoardViewType}
              search={board.boardSearch}
              onChangeSearch={board.setBoardSearch}
              onOpenAutomations={() => {
                if (!activeBoardId) return;
                setAutomationsDrawerOpen(true);
              }}
              onOpenBoardMenu={() => {}}
              onUpdateBoard={async (patch) => {
                if (!board.boardView?.board?.id) return;
                try {
                  const updated = await updateTaskBoard(board.boardView.board.id, patch);
                  board.setBoardView((prev) => (prev ? { ...prev, board: updated } : prev));
                } catch (err) {
                  setError(err.message || 'Unable to update board');
                }
              }}
              filterBarVisible={filterBarVisible}
              onToggleFilterBar={() => setFilterBarVisible((v) => !v)}
              activeFilterCount={filterHook.activeFilterCount}
              sortBy={filterHook.sortBy}
              sortDir={filterHook.sortDir}
              onOpenSortMenu={(e) => setSortMenuAnchor(e.currentTarget)}
              sortButtonRef={sortButtonRef}
            />
            {filterBarVisible && (
              <FilterBar
                filters={filterHook.filters}
                onUpdateFilter={filterHook.updateFilter}
                onClearFilters={filterHook.clearFilters}
                hasActiveFilters={filterHook.hasActiveFilters}
                statusLabels={board.statusLabels}
                workspaceLabels={workspaceLabels}
                workspaceMembers={workspaceMembers}
                groups={board.boardView?.groups || []}
              />
            )}
            <SortMenu
              anchorEl={sortMenuAnchor}
              open={Boolean(sortMenuAnchor)}
              onClose={() => setSortMenuAnchor(null)}
              sortBy={filterHook.sortBy}
              sortDir={filterHook.sortDir}
              onToggleSort={filterHook.toggleSort}
              onClearSort={filterHook.clearSort}
            />
          </>
        )}
        {renderContent()}
      </Stack>

      <AutomationsDrawer
        open={automationsDrawerOpen}
        onClose={() => setAutomationsDrawerOpen(false)}
        boardId={activeBoardId}
        onOpenAutomationsPane={() => {
          const next = new URLSearchParams(searchParams);
          next.set('pane', 'automations');
          if (activeBoardId) next.set('board', activeBoardId);
          if (activeWorkspaceId) next.set('workspace', activeWorkspaceId);
          setSearchParams(next);
          setAutomationsDrawerOpen(false);
        }}
      />

      <ItemDrawer
        open={drawer.itemDrawerOpen}
        onClose={drawer.closeItemDrawer}
        activeItem={drawer.activeItem}
        drawerTab={drawer.drawerTab}
        onChangeTab={drawer.setDrawerTab}
        updatesProps={{
          itemUpdates: updates.itemUpdates,
          itemUpdatesLoading: updates.itemUpdatesLoading,
          newUpdateText: updates.newUpdateText,
          onChangeUpdateText: updates.setNewUpdateText,
          postingUpdate: updates.postingUpdate,
          updateInputRef: updates.updateInputRef,
          mentionOpen: updates.mentionOpen,
          mentionOptions: updates.mentionOptions,
          mentionLoading: updates.mentionLoading,
          mentionTarget: updates.mentionTarget,
          openMentionPicker: updates.openMentionPicker,
          onPostUpdate: handlePostUpdate,
          getMentionStateFromText: updates.getMentionStateFromText,
          onSetMentionOpen: updates.setMentionOpen,
          onSetMentionQuery: updates.setMentionQuery,
          insertMention: updates.insertMention,
          updateViews: updates.updateViews,
          replyTo: updates.replyTo,
          replyText: updates.replyText,
          onChangeReplyText: updates.setReplyText,
          replyInputRef: updates.replyInputRef,
          postingReply: updates.postingReply,
          onBeginReply: updates.beginReply,
          onCancelReply: updates.cancelReply,
          onPostReply: handlePostReply,
          workspaceMembers
        }}
        filesProps={{
          itemFiles: files.itemFiles,
          itemFilesLoading: files.itemFilesLoading,
          uploadingFile: files.uploadingFile,
          onUploadFile: handleUploadFile,
          onDeleteFile: handleDeleteFile
        }}
        subitemsProps={{
          subitems: subs.subitems,
          subitemsLoading: subs.subitemsLoading,
          newSubitemName: subs.newSubitemName,
          setNewSubitemName: subs.setNewSubitemName,
          creatingSubitem: subs.creatingSubitem,
          handleCreateSubitem: subs.handleCreateSubitem,
          handleToggleSubitemDone: subs.handleToggleSubitemDone,
          handleArchiveSubitem: subs.handleArchiveSubitem,
          handleRenameSubitem: subs.handleRenameSubitem,
          handleSetSubitemStatus: subs.handleSetSubitemStatus,
          handleAddSubitemAssignee: subs.handleAddSubitemAssignee,
          handleRemoveSubitemAssignee: subs.handleRemoveSubitemAssignee,
          handleReorderSubitems: subs.handleReorderSubitems
        }}
        activityProps={{
          itemEvents: activity.itemEvents,
          itemEventsLoading: activity.itemEventsLoading
        }}
        timeProps={{
          timeEntries: time.timeEntries,
          timeEntriesLoading: time.timeEntriesLoading,
          loggingTime: time.loggingTime,
          timeBillable: time.timeBillable,
          setTimeBillable: time.setTimeBillable,
          timeCategory: time.timeCategory,
          setTimeCategory: time.setTimeCategory,
          timeDescription: time.timeDescription,
          setTimeDescription: time.setTimeDescription,
          timeHours: time.timeHours,
          setTimeHours: time.setTimeHours,
          timeMins: time.timeMins,
          setTimeMins: time.setTimeMins,
          billableHours: time.billableHours,
          setBillableHours: time.setBillableHours,
          billableMins: time.billableMins,
          setBillableMins: time.setBillableMins,
          billableTouched: time.billableTouched,
          setBillableTouched: time.setBillableTouched,
          onLogTime: handleLogTime
        }}
        aiProps={{
          aiSummary: updates.aiSummary,
          aiSummaryMeta: updates.aiSummaryMeta,
          aiSummaryLoading: updates.aiSummaryLoading,
          aiSummaryRefreshing: updates.aiSummaryRefreshing,
          onRefreshAiSummary: handleRefreshAiSummary
        }}
        assigneesProps={{
          assignees: drawer.assignees,
          assigneesLoading: drawer.assigneesLoading,
          newAssigneeUserId: drawer.newAssigneeUserId,
          setNewAssigneeUserId: drawer.setNewAssigneeUserId,
          addingAssignee: drawer.addingAssignee,
          onAddAssignee: drawer.handleAddAssignee,
          onRemoveAssignee: drawer.handleRemoveAssignee
        }}
        statusLabels={board.statusLabels}
        workspaceMembers={workspaceMembers}
        isAdmin={isAdmin}
        onUpdateItemField={handleUpdateItemField}
        onRenameItem={handleRenameItem}
        onOpenStatusLabelsDialog={() => labels.setStatusLabelsDialogOpen(true)}
        itemLabels={board.itemLabelsMap[drawer.activeItem?.id] || []}
        workspaceLabels={workspaceLabels}
        onToggleItemLabel={handleToggleItemLabel}
        boardItems={board.boardView?.items || []}
      />

      <StatusLabelsDialog
        open={labels.statusLabelsDialogOpen}
        onClose={() => labels.setStatusLabelsDialogOpen(false)}
        statusLabels={board.statusLabels}
        editingLabel={labels.editingLabel}
        setEditingLabel={labels.setEditingLabel}
        newLabelText={labels.newLabelText}
        newLabelColor={labels.newLabelColor}
        savingLabel={labels.savingLabel}
        onSetNewLabelText={labels.setNewLabelText}
        onSetNewLabelColor={labels.setNewLabelColor}
        onInitializeLabels={labels.handleInitializeLabels}
        onAddLabel={labels.handleAddLabel}
        onUpdateLabel={labels.handleUpdateLabel}
        onDeleteLabelClick={labels.handleDeleteLabelClick}
        updateStatusLabelsInView={board.updateStatusLabelsInView}
      />

      <ConfirmDialog
        open={labels.deleteLabelConfirmOpen}
        onClose={() => { labels.setDeleteLabelConfirmOpen(false); labels.setLabelToDelete(null); }}
        onConfirm={labels.handleDeleteLabelConfirm}
        title="Delete Status Label"
        message={<Typography>Delete <strong>{labels.labelToDelete?.label}</strong>?</Typography>}
        secondaryText="Items using this label will keep their current status text."
        confirmLabel="Delete"
        confirmColor="error"
        loading={labels.savingLabel}
      />

    </MainCard>
  );
}
