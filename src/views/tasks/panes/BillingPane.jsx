import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronRight as IconNext,
  IconDownload,
  IconFileSpreadsheet,
  IconX
} from '@tabler/icons-react';
import { runBillingReport } from 'api/tasks';
import { useTaskContext } from 'contexts/TaskContext';
import { fmtMinutes } from 'constants/taskDefaults';

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

// Group items by category from their time entries
function groupByCategory(items) {
  const categoryMap = {}; // category -> { items: [...], totalMinutes, billableMinutes }

  for (const item of items) {
    // Aggregate time entries by category for this item
    const categoryData = {};
    for (const entry of item.time_entries || []) {
      const cat = entry.work_category || 'Uncategorized';
      if (!categoryData[cat]) {
        categoryData[cat] = { total: 0, billable: 0, count: 0, entries: [] };
      }
      categoryData[cat].total += entry.time_spent_minutes || 0;
      categoryData[cat].billable += entry.billable_minutes || 0;
      categoryData[cat].count += 1;
      categoryData[cat].entries.push(entry);
    }

    // Add item to each category it has time in
    for (const [cat, data] of Object.entries(categoryData)) {
      if (!categoryMap[cat]) {
        categoryMap[cat] = { items: [], totalMinutes: 0, billableMinutes: 0 };
      }
      categoryMap[cat].items.push({
        ...item,
        category_total_minutes: data.total,
        category_billable_minutes: data.billable,
        category_entry_count: data.count,
        category_entries: data.entries // Only entries for this category
      });
      categoryMap[cat].totalMinutes += data.total;
      categoryMap[cat].billableMinutes += data.billable;
    }
  }

  // Sort categories alphabetically, but put "Uncategorized" last
  const sortedCategories = Object.keys(categoryMap).sort((a, b) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    return a.localeCompare(b);
  });

  return sortedCategories.map((cat) => ({
    category: cat,
    ...categoryMap[cat]
  }));
}

export default function BillingPane() {
  // All boards from shared context
  const { allBoards, boardsLoading: loadingBoards, loadAllBoards } = useTaskContext();

  // Date range - default to current month
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
  });

  // Single board search/select
  const [singleBoard, setSingleBoard] = useState(null);
  const [singleBoardInput, setSingleBoardInput] = useState('');

  // Bulk selection
  const [selectedBoardIds, setSelectedBoardIds] = useState(new Set());

  // Report state - supports multiple reports (one per board)
  const [reports, setReports] = useState([]); // [{ boardId, boardName, items }]
  const [activeReportIndex, setActiveReportIndex] = useState(0);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  // Expanded items (track by "category-itemId")
  const [expandedItems, setExpandedItems] = useState(new Set());

  // Load boards via context if not already loaded
  useEffect(() => {
    if (!allBoards.length) loadAllBoards();
  }, [allBoards.length, loadAllBoards]);

  // Toggle single board selection
  const toggleBoard = (boardId) => {
    setSelectedBoardIds((prev) => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  // Toggle all boards
  const toggleAllBoards = () => {
    const ids = allBoards.map((b) => b.id);
    setSelectedBoardIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  };

  const allSelected = useMemo(() => {
    return allBoards.length > 0 && allBoards.every((b) => selectedBoardIds.has(b.id));
  }, [allBoards, selectedBoardIds]);

  const someSelected = useMemo(() => {
    return selectedBoardIds.size > 0 && !allSelected;
  }, [selectedBoardIds, allSelected]);

  // Run report for single board
  const handleRunSingleReport = async () => {
    if (!singleBoard?.id) return;
    setReportLoading(true);
    setReportError('');
    setExpandedItems(new Set());
    try {
      const items = await runBillingReport({
        board_ids: [singleBoard.id],
        start_date: startDate || null,
        end_date: endDate || null
      });
      setReports([{ boardId: singleBoard.id, boardName: singleBoard.name || 'Board', items: items || [] }]);
      setActiveReportIndex(0);
      setPreviewOpen(true);
    } catch (err) {
      setReportError(err.message || 'Unable to run report');
    } finally {
      setReportLoading(false);
    }
  };

  // Run report for bulk selected boards - creates separate report per board
  const handleRunBulkReport = async () => {
    const ids = Array.from(selectedBoardIds);
    if (!ids.length) return;
    setReportLoading(true);
    setReportError('');
    setExpandedItems(new Set());
    try {
      const items = await runBillingReport({
        board_ids: ids,
        start_date: startDate || null,
        end_date: endDate || null
      });

      // Group items by board
      const itemsByBoard = new Map();
      for (const item of items || []) {
        const bid = item.board_id;
        if (!itemsByBoard.has(bid)) itemsByBoard.set(bid, []);
        itemsByBoard.get(bid).push(item);
      }

      // Build board name lookup
      const boardNameById = new Map(allBoards.map((b) => [b.id, b.name]));

      // Create one report per selected board (even if empty)
      const newReports = ids.map((boardId) => ({
        boardId,
        boardName: boardNameById.get(boardId) || 'Board',
        items: itemsByBoard.get(boardId) || []
      }));

      setReports(newReports);
      setActiveReportIndex(0);
      setPreviewOpen(true);
    } catch (err) {
      setReportError(err.message || 'Unable to run report');
    } finally {
      setReportLoading(false);
    }
  };

  // Toggle item expansion
  const toggleItemExpand = (key) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Current report
  const currentReport = reports[activeReportIndex] || { boardId: null, boardName: '', items: [] };
  const reportItems = currentReport.items || [];
  const totalReports = reports.length;
  const hasMultipleReports = totalReports > 1;
  const hasNextReport = activeReportIndex < totalReports - 1;

  // Group items by category for current report
  const groupedByCategory = useMemo(() => groupByCategory(reportItems), [reportItems]);

  // Navigate to next report
  const handleNextReport = () => {
    if (!hasNextReport) return;
    setActiveReportIndex((i) => i + 1);
    setExpandedItems(new Set());
  };

  // Close dialog and reset
  const handleCloseDialog = () => {
    setPreviewOpen(false);
    // Reset to first report for next time
    setActiveReportIndex(0);
    setExpandedItems(new Set());
  };

  // Export to CSV (current report, grouped by category, with individual entries)
  const handleExportCsv = () => {
    if (!groupedByCategory.length) return;
    const headers = ['Category', 'Item', 'Status', 'Entry Date', 'Description', 'Total (min)', 'Billable (min)', 'Logged By'];
    const lines = [headers.join(',')];

    for (const group of groupedByCategory) {
      for (const item of group.items) {
        // Add item summary row
        lines.push(
          [
            group.category,
            item.item_name,
            item.status,
            '',
            `(${item.category_entry_count} entries)`,
            item.category_total_minutes || 0,
            item.category_billable_minutes || 0,
            ''
          ]
            .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
            .join(',')
        );
        // Add individual entry rows
        for (const entry of item.category_entries || []) {
          lines.push(
            [
              '',
              '',
              '',
              entry.created_at ? new Date(entry.created_at).toLocaleString() : '',
              entry.description || '',
              entry.time_spent_minutes || 0,
              entry.billable_minutes || 0,
              entry.user_name || ''
            ]
              .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
              .join(',')
          );
        }
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeBoardName = String(currentReport.boardName || 'board')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-_]/g, '')
      .slice(0, 60);
    link.download = `billing-report-${safeBoardName}-${dateStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Summary totals for current report
  const totalMinutes = useMemo(() => reportItems.reduce((sum, r) => sum + (r.total_minutes || 0), 0), [reportItems]);
  const totalBillable = useMemo(() => reportItems.reduce((sum, r) => sum + (r.billable_minutes || 0), 0), [reportItems]);

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, minHeight: 420 }}>
      <Stack spacing={2}>
        {/* Header */}
        <Stack spacing={0.25}>
          <Typography variant="h5">Billing Reports</Typography>
          <Typography variant="body2" color="text.secondary">
            Generate time tracking reports for billing
          </Typography>
        </Stack>

        <Divider />

        {/* Date Range */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField
            label="Start Date"
            type="date"
            size="small"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
          />
          <TextField
            label="End Date"
            type="date"
            size="small"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
          />
        </Stack>

        <Divider />

        {/* Single Board Search */}
        <Stack spacing={1}>
          <Typography variant="subtitle2">Quick Report (Single Board)</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Autocomplete
              options={allBoards}
              getOptionLabel={(option) => `${option.name} (${option.workspace_name || 'No workspace'})`}
              value={singleBoard}
              onChange={(_e, newValue) => setSingleBoard(newValue)}
              inputValue={singleBoardInput}
              onInputChange={(_e, newInput) => setSingleBoardInput(newInput)}
              loading={loadingBoards}
              size="small"
              sx={{ minWidth: 300, flex: 1 }}
              renderInput={(params) => <TextField {...params} placeholder="Search boards..." />}
            />
            <Button
              variant="outlined"
              onClick={handleRunSingleReport}
              disabled={!singleBoard || reportLoading}
              startIcon={reportLoading ? <CircularProgress size={16} /> : <IconFileSpreadsheet size={18} />}
            >
              Run Report
            </Button>
          </Stack>
        </Stack>

        <Divider />

        {/* Bulk Selection Table */}
        <Stack spacing={1}>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2">Bulk Report (Multiple Boards)</Typography>
            <Button
              variant="contained"
              onClick={handleRunBulkReport}
              disabled={selectedBoardIds.size === 0 || reportLoading}
              startIcon={reportLoading ? <CircularProgress size={16} /> : <IconFileSpreadsheet size={18} />}
            >
              Run Report ({selectedBoardIds.size} selected)
            </Button>
          </Stack>

          {loadingBoards ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAllBoards} />
                    </TableCell>
                    <TableCell>Board</TableCell>
                    <TableCell>Workspace</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allBoards.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                          No boards found.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {allBoards.map((b) => (
                    <TableRow key={b.id} hover onClick={() => toggleBoard(b.id)} sx={{ cursor: 'pointer' }}>
                      <TableCell padding="checkbox">
                        <Checkbox checked={selectedBoardIds.has(b.id)} />
                      </TableCell>
                      <TableCell>{b.name}</TableCell>
                      <TableCell>{b.workspace_name || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>

        {/* Error */}
        {reportError && (
          <Typography variant="body2" color="error">
            {reportError}
          </Typography>
        )}
      </Stack>

      {/* Report Preview Dialog */}
      <Dialog open={previewOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ m: 0, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Stack>
              <Typography variant="h6">
                {currentReport.boardName || 'Report Preview'}
                {hasMultipleReports && (
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    ({activeReportIndex + 1} of {totalReports})
                  </Typography>
                )}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Total: <strong>{fmtMinutes(totalMinutes)}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Billable: <strong>{fmtMinutes(totalBillable)}</strong>
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            {groupedByCategory.length > 0 && (
              <Button variant="contained" size="small" startIcon={<IconDownload size={16} />} onClick={handleExportCsv}>
                Export to CSV
              </Button>
            )}
            {hasNextReport && (
              <Button variant="outlined" size="small" endIcon={<IconNext size={16} />} onClick={handleNextReport}>
                Next Report
              </Button>
            )}
            <IconButton onClick={handleCloseDialog} size="small" aria-label="Close billing report">
              <IconX size={20} />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {groupedByCategory.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No time entries found for the selected date range.
            </Typography>
          ) : (
            <Stack spacing={3}>
              {groupedByCategory.map((group) => (
                <Box key={group.category}>
                  {/* Category Header */}
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'white',
                      px: 2,
                      py: 1,
                      borderRadius: 1,
                      mb: 1
                    }}
                  >
                    <Typography variant="subtitle1" fontWeight={600} color="white">
                      {group.category}
                    </Typography>
                    <Stack direction="row" spacing={2}>
                      <Typography variant="body2" color="white">
                        Total: <strong>{fmtMinutes(group.totalMinutes)}</strong>
                      </Typography>
                      <Typography variant="body2" color="white">
                        Billable: <strong>{fmtMinutes(group.billableMinutes)}</strong>
                      </Typography>
                    </Stack>
                  </Stack>

                  {/* Items Table */}
                  {/* custom table — DataTable cannot express nested expandable rows with per-item time-entry sub-rows */}
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 40 }} />
                          <TableCell>Item</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Total</TableCell>
                          <TableCell align="right">Billable</TableCell>
                          <TableCell align="right">Entries</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {group.items.map((item) => {
                          const itemKey = `${group.category}-${item.item_id}`;
                          const isExpanded = expandedItems.has(itemKey);
                          return (
                            <>
                              <TableRow
                                key={itemKey}
                                hover
                                onClick={() => toggleItemExpand(itemKey)}
                                sx={{ cursor: 'pointer', '& > td': { borderBottom: isExpanded ? 'none' : undefined } }}
                              >
                                <TableCell sx={{ width: 40, py: 0.5 }}>
                                  <IconButton
                                    size="small"
                                    sx={{ p: 0.5 }}
                                    aria-label={isExpanded ? `Collapse entries for ${item.item_name}` : `Expand entries for ${item.item_name}`}
                                    aria-expanded={isExpanded}
                                  >
                                    {isExpanded ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                                  </IconButton>
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2" fontWeight={500}>
                                    {item.item_name}
                                  </Typography>
                                </TableCell>
                                <TableCell>{item.status}</TableCell>
                                <TableCell align="right">{fmtMinutes(item.category_total_minutes)}</TableCell>
                                <TableCell align="right">{fmtMinutes(item.category_billable_minutes)}</TableCell>
                                <TableCell align="right">{item.category_entry_count}</TableCell>
                              </TableRow>
                              {/* Expanded entries */}
                              <TableRow key={`${itemKey}-entries`}>
                                <TableCell colSpan={6} sx={{ p: 0, bgcolor: 'action.hover' }}>
                                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                    <Box sx={{ py: 1, px: 2 }}>
                                      <Table size="small">
                                        <TableHead>
                                          <TableRow>
                                            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Date</TableCell>
                                            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Description</TableCell>
                                            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Logged By</TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
                                              Total
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
                                              Billable
                                            </TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {(item.category_entries || []).map((entry) => (
                                            <TableRow key={entry.entry_id}>
                                              <TableCell sx={{ fontSize: '0.8rem' }}>{formatDateTime(entry.created_at)}</TableCell>
                                              <TableCell sx={{ fontSize: '0.8rem' }}>{entry.description || '—'}</TableCell>
                                              <TableCell sx={{ fontSize: '0.8rem' }}>{entry.user_name || '—'}</TableCell>
                                              <TableCell align="right" sx={{ fontSize: '0.8rem' }}>
                                                {fmtMinutes(entry.time_spent_minutes)}
                                              </TableCell>
                                              <TableCell align="right" sx={{ fontSize: '0.8rem' }}>
                                                {fmtMinutes(entry.billable_minutes)}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </Box>
                                  </Collapse>
                                </TableCell>
                              </TableRow>
                            </>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
