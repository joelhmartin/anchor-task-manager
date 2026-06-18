import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Avatar, Box, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import { common } from '@mui/material/colors';
import { IconChevronDown, IconChevronRight, IconLock } from '@tabler/icons-react';
import { getStatusColor, TIMELINE_COLORS } from 'constants/taskDefaults';
import { fetchTaskItemSubitems, fetchSubitemDependencies, fetchSubitemAssignees } from 'api/tasks';
import { useToast } from 'contexts/ToastContext';

const DAY_WIDTH = 36;
const BAR_HEIGHT = 24;
const SUBITEM_BAR_HEIGHT = 18;
const BAR_GAP = 4;
const ROW_HEIGHT = BAR_HEIGHT + BAR_GAP;
const SIDEBAR_WIDTH = 200;
const HEADER_HEIGHT = 48;
const SUBITEM_INDENT = 24;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const msPerDay = 86400000;
  return Math.round((b - a) / msPerDay);
}

function parseDateLocal(str) {
  if (!str) return null;
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

/* ── Dependency Arrows (SVG) ────────────────────────────────── */
function DependencyArrows({ dependencies, itemPositions }) {
  if (!dependencies?.length || !itemPositions) return null;

  const lines = [];
  for (const dep of dependencies) {
    const fromId = dep.predecessor_id;
    const toId = dep.item_id || dep.successor_id;
    const fromPos = itemPositions[fromId];
    const toPos = itemPositions[toId];
    if (!fromPos || !toPos) continue;

    const x1 = fromPos.right;
    const y1 = fromPos.cy;
    const x2 = toPos.left;
    const y2 = toPos.cy;

    // Horizontal-then-vertical connector
    const midX = x1 + 12;
    const path = `M${x1},${y1} H${midX} V${y2} H${x2}`;
    lines.push(
      <g key={`${fromId}-${toId}`}>
        <path d={path} fill="none" stroke={TIMELINE_COLORS.pending} strokeWidth={1.5} />
        {/* Arrowhead */}
        <polygon
          points={`${x2},${y2} ${x2 - 6},${y2 - 4} ${x2 - 6},${y2 + 4}`}
          fill={TIMELINE_COLORS.pending}
        />
      </g>
    );
  }

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible'
      }}
    >
      {lines}
    </svg>
  );
}

/* ── Subitem Dependency Arrows ──────────────────────────────── */
function SubitemDependencyArrows({ subitemDeps, subitemPositions }) {
  if (!subitemDeps?.length || !subitemPositions) return null;

  const lines = [];
  for (const dep of subitemDeps) {
    const fromPos = subitemPositions[dep.predecessor_id];
    const toPos = subitemPositions[dep.successor_id];
    if (!fromPos || !toPos) continue;

    const x1 = fromPos.right;
    const y1 = fromPos.cy;
    const x2 = toPos.left;
    const y2 = toPos.cy;

    // Horizontal-then-vertical connector with a midpoint
    const midX = x1 + 10;
    const path = `M${x1},${y1} H${midX} V${y2} H${x2}`;
    lines.push(
      <g key={`sub-${dep.predecessor_id}-${dep.successor_id}`}>
        <path d={path} fill="none" stroke={TIMELINE_COLORS.dependency} strokeWidth={1.2} strokeDasharray="4 2" />
        <polygon
          points={`${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}`}
          fill={TIMELINE_COLORS.dependency}
        />
      </g>
    );
  }

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible'
      }}
    >
      {lines}
    </svg>
  );
}

/* ── Parent Summary Bar ─────────────────────────────────────── */
function ParentSummaryBar({ item, subitems, statusLabels, top, timelineStart }) {
  if (!subitems?.length) return null;

  const doneCount = subitems.filter((s) => {
    const sl = statusLabels.find((l) => l.label === s.status);
    return sl?.is_done_state || s.status === 'Done';
  }).length;
  const progress = doneCount / subitems.length;

  // Compute the overall span from all subitems
  let earliest = null;
  let latest = null;
  for (const s of subitems) {
    const sd = parseDateLocal(s.start_date);
    const dd = parseDateLocal(s.due_date);
    const e = sd || dd;
    const l = dd || sd;
    if (e && (!earliest || e < earliest)) earliest = e;
    if (l && (!latest || l > latest)) latest = l;
  }
  if (!earliest) return null;
  if (!latest) latest = earliest;

  const startOffset = daysBetween(timelineStart, earliest);
  const endOffset = daysBetween(timelineStart, latest);
  const barWidth = Math.max((endOffset - startOffset + 1) * DAY_WIDTH, DAY_WIDTH);
  const barLeft = startOffset * DAY_WIDTH;

  return (
    <Tooltip
      title={
        <Stack spacing={0.5} sx={{ p: 0.5 }}>
          <Typography variant="caption" fontWeight={700}>{item.name} (Summary)</Typography>
          <Typography variant="caption">
            {doneCount}/{subitems.length} subitems complete ({Math.round(progress * 100)}%)
          </Typography>
        </Stack>
      }
      arrow
      placement="top"
    >
      <Box
        sx={{
          position: 'absolute',
          top: top + BAR_GAP / 2 + BAR_HEIGHT - 6,
          left: barLeft,
          width: barWidth,
          height: 4,
          bgcolor: 'grey.300',
          borderRadius: 0.5,
          overflow: 'hidden'
        }}
      >
        <Box
          sx={{
            width: `${progress * 100}%`,
            height: '100%',
            bgcolor: TIMELINE_COLORS.done,
            borderRadius: 0.5,
            transition: 'width 0.3s'
          }}
        />
      </Box>
    </Tooltip>
  );
}

/* ── Main TimelineView ──────────────────────────────────────── */
export default function TimelineView({
  items = [],
  groups = [],
  statusLabels = [],
  itemLabelsMap = {},
  onItemClick,
  dependencies = [],
  baselineSnapshot = null,
  criticalPathIds = []
}) {
  const criticalSet = useMemo(() => new Set(criticalPathIds), [criticalPathIds]);
  const scrollRef = useRef(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const toast = useToast();

  // ── Expand/collapse state ──
  const [expandedItems, setExpandedItems] = useState({});
  // Cache: { [parentItemId]: { subitems, deps, assignees, loading } }
  const [subitemCache, setSubitemCache] = useState({});

  const toggleExpand = useCallback(async (itemId) => {
    setExpandedItems((prev) => {
      const next = { ...prev };
      if (next[itemId]) {
        delete next[itemId];
      } else {
        next[itemId] = true;
      }
      return next;
    });

    // If we already have cached data, no need to fetch
    if (subitemCache[itemId]?.subitems) return;

    // Fetch subitems and their deps/assignees
    setSubitemCache((prev) => ({ ...prev, [itemId]: { subitems: null, deps: [], assigneeMap: {}, blockedMap: {}, loading: true } }));
    try {
      const subitems = await fetchTaskItemSubitems(itemId);
      if (!subitems.length) {
        setSubitemCache((prev) => ({ ...prev, [itemId]: { subitems: [], deps: [], assigneeMap: {}, blockedMap: {}, loading: false } }));
        return;
      }

      // Fetch deps and assignees for all subitems in parallel
      const [depsResults, assigneeResults] = await Promise.all([
        Promise.all(subitems.map((s) => fetchSubitemDependencies(s.id).catch(() => ({ predecessors: [], successors: [] })))),
        Promise.all(subitems.map((s) => fetchSubitemAssignees(s.id).catch(() => [])))
      ]);

      // Build dependency list (deduplicated)
      const depsSeen = new Set();
      const allDeps = [];
      for (const r of depsResults) {
        for (const dep of [...(r.predecessors || []), ...(r.successors || [])]) {
          const key = `${dep.predecessor_id}-${dep.successor_id}`;
          if (!depsSeen.has(key)) {
            depsSeen.add(key);
            allDeps.push(dep);
          }
        }
      }

      // Build assignee map { subitemId: [assignees] }
      const assigneeMap = {};
      subitems.forEach((s, i) => {
        assigneeMap[s.id] = assigneeResults[i] || [];
      });

      // Build blocked map: a subitem is blocked if any predecessor is not done
      const blockedMap = {};
      const subitemStatusMap = {};
      for (const s of subitems) {
        subitemStatusMap[s.id] = s.status;
      }
      for (const s of subitems) {
        // Find predecessors of this subitem
        const predecessors = allDeps.filter((d) => d.successor_id === s.id);
        if (predecessors.length > 0) {
          const hasIncomplete = predecessors.some((p) => {
            const predStatus = subitemStatusMap[p.predecessor_id] || p.subitem_status;
            const sl = statusLabels.find((l) => l.label === predStatus);
            return !(sl?.is_done_state || predStatus === 'Done');
          });
          blockedMap[s.id] = hasIncomplete;
        }
      }

      setSubitemCache((prev) => ({
        ...prev,
        [itemId]: { subitems, deps: allDeps, assigneeMap, blockedMap, loading: false }
      }));
    } catch {
      toast.error('Unable to load subitems for timeline');
      setSubitemCache((prev) => ({ ...prev, [itemId]: { subitems: [], deps: [], assigneeMap: {}, blockedMap: {}, loading: false } }));
    }
  }, [subitemCache, statusLabels, toast]);

  // Compute date range from items (include subitems)
  const { timelineStart, totalDays } = useMemo(() => {
    let minDate = null;
    let maxDate = null;
    const checkDate = (str) => {
      const d = parseDateLocal(str);
      if (d && (!minDate || d < minDate)) minDate = d;
      if (d && (!maxDate || d > maxDate)) maxDate = d;
    };
    for (const item of items) {
      checkDate(item.start_date);
      checkDate(item.due_date);
    }
    // Include expanded subitems in date range
    for (const [, cache] of Object.entries(subitemCache)) {
      if (cache.subitems) {
        for (const s of cache.subitems) {
          checkDate(s.start_date);
          checkDate(s.due_date);
        }
      }
    }
    if (!minDate) minDate = new Date();
    if (!maxDate) maxDate = new Date();
    // Add 7-day padding on each side
    const start = new Date(minDate);
    start.setDate(start.getDate() - 7);
    const end = new Date(maxDate);
    end.setDate(end.getDate() + 7);
    const total = daysBetween(start, end) + 1;
    return { timelineStart: start, totalDays: Math.max(total, 14) };
  }, [items, subitemCache]);

  // Build date labels
  const dateLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(timelineStart);
      d.setDate(d.getDate() + i);
      labels.push(d);
    }
    return labels;
  }, [timelineStart, totalDays]);

  // Group items
  const groupedRows = useMemo(() => {
    const noDateItems = [];
    const datedItems = [];
    for (const item of items) {
      if (!item.start_date && !item.due_date) {
        noDateItems.push(item);
      } else {
        datedItems.push(item);
      }
    }
    const result = [];
    for (const group of groups) {
      const groupItems = datedItems.filter((it) => it.group_id === group.id);
      const groupNoDate = noDateItems.filter((it) => it.group_id === group.id);
      if (groupItems.length || groupNoDate.length) {
        result.push({ group, items: groupItems, noDateItems: groupNoDate });
      }
    }
    // Items with no matching group
    const orphanDated = datedItems.filter((it) => !groups.some((g) => g.id === it.group_id));
    const orphanNoDate = noDateItems.filter((it) => !groups.some((g) => g.id === it.group_id));
    if (orphanDated.length || orphanNoDate.length) {
      result.push({ group: { id: '__orphan', name: 'Other' }, items: orphanDated, noDateItems: orphanNoDate });
    }
    return result;
  }, [items, groups]);

  // Compute item bar positions for dependency arrows (including subitem rows offset)
  const { itemPositions, subitemPositionsByParent, totalRowsComputed } = useMemo(() => {
    const positions = {};
    const subPositionsByParent = {};
    let rowIndex = 0;

    for (const grp of groupedRows) {
      rowIndex++; // group header row
      for (const item of grp.items) {
        const sd = parseDateLocal(item.start_date);
        const dd = parseDateLocal(item.due_date);
        const barStart = sd || dd;
        const barEnd = dd || sd;

        // Compute yOffset accounting for variable row heights
        // We need to track exact pixel offset
        const top = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;

        if (barStart) {
          const startOffset = daysBetween(timelineStart, barStart);
          const endOffset = daysBetween(timelineStart, barEnd);
          const left = startOffset * DAY_WIDTH;
          const width = Math.max((endOffset - startOffset + 1) * DAY_WIDTH, DAY_WIDTH);
          positions[item.id] = {
            left,
            right: left + width,
            cy: top + BAR_GAP / 2 + BAR_HEIGHT / 2,
            top: top + BAR_GAP / 2,
            width
          };
        }
        rowIndex++;

        // Add subitem rows
        if (expandedItems[item.id]) {
          const cache = subitemCache[item.id];
          const subPositions = {};
          if (cache?.subitems?.length) {
            for (const sub of cache.subitems) {
              const ssd = parseDateLocal(sub.start_date);
              const sdd = parseDateLocal(sub.due_date);
              const sBarStart = ssd || sdd;
              const sBarEnd = sdd || ssd;
              // Subitem rows use SUBITEM_ROW_HEIGHT but we track via rowIndex
              // Use a fractional system — subitems are placed at computed pixel offset
              const subTop = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
              if (sBarStart) {
                const sStartOffset = daysBetween(timelineStart, sBarStart);
                const sEndOffset = daysBetween(timelineStart, sBarEnd);
                const sLeft = sStartOffset * DAY_WIDTH;
                const sWidth = Math.max((sEndOffset - sStartOffset + 1) * DAY_WIDTH, DAY_WIDTH);
                subPositions[sub.id] = {
                  left: sLeft,
                  right: sLeft + sWidth,
                  cy: subTop + BAR_GAP / 2 + SUBITEM_BAR_HEIGHT / 2,
                  top: subTop + BAR_GAP / 2,
                  width: sWidth
                };
              }
              rowIndex++;
            }
          } else if (cache?.loading) {
            rowIndex++; // loading row
          }
          subPositionsByParent[item.id] = subPositions;
        }
      }
      rowIndex += grp.noDateItems.length;
    }
    return { itemPositions: positions, subitemPositionsByParent: subPositionsByParent, totalRowsComputed: rowIndex };
  }, [groupedRows, timelineStart, expandedItems, subitemCache]);

  // Scroll to today on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const todayOffset = daysBetween(timelineStart, new Date());
    const scrollTo = Math.max(0, todayOffset * DAY_WIDTH - 200);
    scrollRef.current.scrollLeft = scrollTo;
  }, [timelineStart]);

  const todayStr = toDateStr(new Date());
  const todayOffset = daysBetween(timelineStart, new Date());
  const gridWidth = totalDays * DAY_WIDTH;

  const contentHeight = HEADER_HEIGHT + totalRowsComputed * ROW_HEIGHT;

  return (
    <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', maxHeight: 600 }}>
      {/* Left sidebar */}
      <Box
        sx={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          borderRight: '1px solid',
          borderColor: 'divider',
          overflowY: 'auto',
          bgcolor: 'background.paper'
        }}
      >
        {/* Header spacer */}
        <Box sx={{ height: HEADER_HEIGHT, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', px: 1 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">Items</Typography>
        </Box>
        {groupedRows.map((grp) => (
          <Box key={grp.group.id}>
            {/* Group header */}
            <Box sx={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', px: 1, bgcolor: 'action.hover' }}>
              <Typography variant="caption" fontWeight={700} noWrap title={grp.group.name}>{grp.group.name}</Typography>
            </Box>
            {grp.items.map((item) => {
              const isExpanded = !!expandedItems[item.id];
              const cache = subitemCache[item.id];
              const isLoading = cache?.loading;

              return (
                <Box key={item.id}>
                  <Box
                    sx={{
                      height: ROW_HEIGHT,
                      display: 'flex',
                      alignItems: 'center',
                      px: 0.5,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                  >
                    {/* Expand/collapse toggle */}
                    <Box
                      component="button"
                      type="button"
                      aria-label={isExpanded ? `Collapse subitems for ${item.name}` : `Expand subitems for ${item.name}`}
                      aria-expanded={isExpanded}
                      sx={{
                        width: 20,
                        height: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        borderRadius: 0.5,
                        flexShrink: 0,
                        p: 0,
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        '&:hover': { bgcolor: 'action.selected' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 }
                      }}
                      onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                    >
                      {isLoading ? (
                        <CircularProgress size={12} />
                      ) : isExpanded ? (
                        <IconChevronDown size={14} />
                      ) : (
                        <IconChevronRight size={14} />
                      )}
                    </Box>
                    <Typography
                      variant="caption"
                      noWrap
                      sx={{ maxWidth: SIDEBAR_WIDTH - 32, ml: 0.25 }}
                      title={item.name}
                      onClick={() => onItemClick?.(item)}
                    >
                      {item.name}
                    </Typography>
                  </Box>
                  {/* Expanded subitems in sidebar */}
                  {isExpanded && cache?.subitems?.map((sub) => {
                    const isBlocked = cache.blockedMap?.[sub.id];
                    const assignees = cache.assigneeMap?.[sub.id] || [];
                    return (
                      <Box
                        key={sub.id}
                        sx={{
                          height: ROW_HEIGHT,
                          display: 'flex',
                          alignItems: 'center',
                          pl: `${SUBITEM_INDENT + 4}px`,
                          pr: 0.5,
                          bgcolor: 'grey.50',
                          borderLeft: '2px solid',
                          borderColor: 'primary.light'
                        }}
                      >
                        {isBlocked && (
                          <Tooltip title="Blocked by incomplete predecessor(s)" arrow>
                            <IconLock size={12} style={{ marginRight: 4, color: TIMELINE_COLORS.blocked, flexShrink: 0 }} />
                          </Tooltip>
                        )}
                        <Typography
                          variant="caption"
                          noWrap
                          title={sub.name}
                          sx={{
                            flex: 1,
                            fontSize: '0.7rem',
                            color: isBlocked ? 'text.disabled' : 'text.secondary'
                          }}
                        >
                          {sub.name}
                        </Typography>
                        {assignees.length > 0 && (
                          <Tooltip title={assignees.map((a) => a.name || a.email).join(', ')} arrow>
                            <Avatar
                              src={assignees[0].avatar_url}
                              sx={{ width: 16, height: 16, fontSize: '0.5rem', ml: 0.5, flexShrink: 0 }}
                            >
                              {getInitials(assignees[0].name || assignees[0].email)}
                            </Avatar>
                          </Tooltip>
                        )}
                      </Box>
                    );
                  })}
                  {isExpanded && isLoading && (
                    <Box sx={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', pl: `${SUBITEM_INDENT + 4}px` }}>
                      <CircularProgress size={12} sx={{ mr: 1 }} />
                      <Typography variant="caption" color="text.disabled">Loading subitems...</Typography>
                    </Box>
                  )}
                  {isExpanded && !isLoading && cache?.subitems?.length === 0 && (
                    <Box sx={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', pl: `${SUBITEM_INDENT + 4}px` }}>
                      <Typography variant="caption" color="text.disabled" fontStyle="italic">No subitems</Typography>
                    </Box>
                  )}
                </Box>
              );
            })}
            {grp.noDateItems.map((item) => (
              <Box
                key={item.id}
                sx={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  px: 1,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
                onClick={() => onItemClick?.(item)}
              >
                <Typography variant="caption" noWrap sx={{ maxWidth: SIDEBAR_WIDTH - 16, fontStyle: 'italic', color: 'text.disabled' }} title={item.name}>
                  {item.name}
                </Typography>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      {/* Right timeline area */}
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'auto',
          position: 'relative'
        }}
      >
        <Box sx={{ width: gridWidth, minHeight: contentHeight, position: 'relative' }}>
          {/* Date header */}
          <Box
            sx={{
              display: 'flex',
              height: HEADER_HEIGHT,
              borderBottom: '1px solid',
              borderColor: 'divider',
              position: 'sticky',
              top: 0,
              zIndex: 2,
              bgcolor: 'background.paper'
            }}
          >
            {dateLabels.map((d) => {
              const ds = toDateStr(d);
              const isToday = ds === todayStr;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <Box
                  key={ds}
                  sx={{
                    width: DAY_WIDTH,
                    minWidth: DAY_WIDTH,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    bgcolor: isToday ? 'error.lighter' : isWeekend ? 'action.hover' : 'transparent',
                    px: 0.25
                  }}
                >
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', lineHeight: 1.2, color: isToday ? 'error.main' : 'text.secondary' }}>
                    {d.toLocaleDateString(undefined, { weekday: 'short' })}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.65rem', lineHeight: 1.2, fontWeight: isToday ? 700 : 400, color: isToday ? 'error.main' : 'text.primary' }}>
                    {d.getDate()}
                  </Typography>
                  {d.getDate() === 1 && (
                    <Typography variant="caption" sx={{ fontSize: '0.55rem', lineHeight: 1, color: 'text.secondary' }}>
                      {d.toLocaleDateString(undefined, { month: 'short' })}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>

          {/* Grid background columns */}
          <Box sx={{ position: 'absolute', top: HEADER_HEIGHT, left: 0, right: 0, bottom: 0 }}>
            {dateLabels.map((d) => {
              const ds = toDateStr(d);
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              const offset = daysBetween(timelineStart, d);
              return (
                <Box
                  key={ds}
                  sx={{
                    position: 'absolute',
                    left: offset * DAY_WIDTH,
                    width: DAY_WIDTH,
                    top: 0,
                    bottom: 0,
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    bgcolor: isWeekend ? 'action.hover' : 'transparent',
                    opacity: 0.4
                  }}
                />
              );
            })}
          </Box>

          {/* Today line */}
          {todayOffset >= 0 && todayOffset <= totalDays && (
            <Box
              sx={{
                position: 'absolute',
                left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2,
                top: 0,
                bottom: 0,
                width: 2,
                bgcolor: 'error.main',
                zIndex: 3,
                pointerEvents: 'none'
              }}
            />
          )}

          {/* Bars */}
          <Box sx={{ position: 'relative', top: HEADER_HEIGHT }}>
            {(() => {
              let rowIndex = 0;
              return groupedRows.map((grp) => {
                const groupHeaderRow = rowIndex;
                rowIndex++;
                return (
                  <Box key={grp.group.id}>
                    {/* Group header row (background bar spanning full width) */}
                    <Box
                      sx={{
                        position: 'absolute',
                        top: groupHeaderRow * ROW_HEIGHT,
                        left: 0,
                        width: gridWidth,
                        height: ROW_HEIGHT,
                        bgcolor: 'action.hover',
                        borderBottom: '1px solid',
                        borderColor: 'divider'
                      }}
                    />

                    {grp.items.map((item) => {
                      const currentRow = rowIndex;
                      rowIndex++;
                      const sd = parseDateLocal(item.start_date);
                      const dd = parseDateLocal(item.due_date);
                      const barStart = sd || dd;
                      const barEnd = dd || sd;
                      const isPoint = !sd || !dd || toDateStr(barStart) === toDateStr(barEnd);
                      const statusColor = getStatusColor(item.status, statusLabels);

                      const isExpanded = !!expandedItems[item.id];
                      const cache = subitemCache[item.id];
                      const expandedSubitems = isExpanded && cache?.subitems ? cache.subitems : [];

                      // Count subitem rows for rowIndex advancement
                      let subitemRowCount = 0;
                      if (isExpanded) {
                        if (cache?.subitems?.length) {
                          subitemRowCount = cache.subitems.length;
                        } else if (cache?.loading || (cache?.subitems?.length === 0 && !cache?.loading)) {
                          // loading row or "no subitems" row — but we only add it in sidebar
                          // for the timeline bars area, we skip if no subitems with dates
                          if (cache?.loading) subitemRowCount = 1;
                        }
                      }
                      const subitemStartRow = rowIndex;
                      rowIndex += subitemRowCount;

                      if (!barStart) {
                        return (
                          <Box key={item.id}>
                            {/* Subitem rows even if parent has no date */}
                            {isExpanded && expandedSubitems.map((sub, si) => {
                              const subRow = subitemStartRow + si;
                              return renderSubitemBar(sub, subRow, cache, statusLabels, timelineStart, gridWidth);
                            })}
                          </Box>
                        );
                      }

                      const startOffset = daysBetween(timelineStart, barStart);
                      const endOffset = daysBetween(timelineStart, barEnd);
                      const barWidth = isPoint ? DAY_WIDTH : Math.max((endOffset - startOffset + 1) * DAY_WIDTH, DAY_WIDTH);
                      const barLeft = startOffset * DAY_WIDTH;

                      const tipContent = (
                        <Stack spacing={0.5} sx={{ p: 0.5 }}>
                          <Typography variant="caption" fontWeight={700}>{item.name}</Typography>
                          {item.start_date && <Typography variant="caption">Start: {item.start_date}</Typography>}
                          {item.due_date && <Typography variant="caption">Due: {item.due_date}</Typography>}
                          <Typography variant="caption">Status: {item.status || 'To Do'}</Typography>
                          {isExpanded && expandedSubitems.length > 0 && (
                            <Typography variant="caption" color="inherit">
                              {expandedSubitems.filter((s) => {
                                const sl = statusLabels.find((l) => l.label === s.status);
                                return sl?.is_done_state || s.status === 'Done';
                              }).length}/{expandedSubitems.length} subitems done
                            </Typography>
                          )}
                        </Stack>
                      );

                      // Baseline ghost bar
                      const baselineItem = baselineSnapshot?.find?.((b) => b.item_id === item.id);
                      let baselineBar = null;
                      if (baselineItem) {
                        const bsd = parseDateLocal(baselineItem.start_date);
                        const bdd = parseDateLocal(baselineItem.due_date);
                        const bStart = bsd || bdd;
                        const bEnd = bdd || bsd;
                        if (bStart) {
                          const bStartOff = daysBetween(timelineStart, bStart);
                          const bEndOff = daysBetween(timelineStart, bEnd);
                          const bWidth = Math.max((bEndOff - bStartOff + 1) * DAY_WIDTH, DAY_WIDTH);
                          baselineBar = (
                            <Box
                              sx={{
                                position: 'absolute',
                                top: currentRow * ROW_HEIGHT + BAR_GAP / 2 + BAR_HEIGHT - 4,
                                left: bStartOff * DAY_WIDTH,
                                width: bWidth,
                                height: 4,
                                bgcolor: TIMELINE_COLORS.pending,
                                borderRadius: 0.5,
                                opacity: 0.5
                              }}
                            />
                          );
                        }
                      }

                      const isCritical = criticalSet.has(item.id);

                      // Compute progress for collapsed summary
                      let progressWidth = null;
                      if (!isExpanded && cache?.subitems?.length > 0) {
                        const doneCount = cache.subitems.filter((s) => {
                          const sl = statusLabels.find((l) => l.label === s.status);
                          return sl?.is_done_state || s.status === 'Done';
                        }).length;
                        progressWidth = doneCount / cache.subitems.length;
                      }

                      return (
                        <Box key={item.id}>
                          {baselineBar}
                          <Tooltip title={tipContent} arrow placement="top">
                            <Box
                              sx={{
                                position: 'absolute',
                                top: currentRow * ROW_HEIGHT + BAR_GAP / 2,
                                left: barLeft,
                                width: isPoint ? 12 : barWidth,
                                height: BAR_HEIGHT,
                                bgcolor: statusColor.bg,
                                borderRadius: isPoint ? '50%' : 1,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                px: isPoint ? 0 : 0.75,
                                overflow: 'hidden',
                                border: isCritical ? `2px solid ${TIMELINE_COLORS.critical}` : hoveredItem === item.id ? '2px solid' : 'none',
                                borderColor: isCritical ? TIMELINE_COLORS.critical : 'primary.main',
                                transition: 'border 0.15s',
                                ...(isPoint && {
                                  width: 12,
                                  height: 12,
                                  mt: '6px',
                                  ml: `${(DAY_WIDTH - 12) / 2}px`
                                }),
                                '&:hover': { opacity: 0.85, boxShadow: 2 }
                              }}
                              onClick={() => onItemClick?.(item)}
                              onMouseEnter={() => setHoveredItem(item.id)}
                              onMouseLeave={() => setHoveredItem(null)}
                            >
                              {!isPoint && barWidth > 60 && (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: statusColor.fg,
                                    fontSize: '0.65rem',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}
                                >
                                  {item.name}
                                </Typography>
                              )}
                            </Box>
                          </Tooltip>

                          {/* Collapsed progress bar under parent */}
                          {!isExpanded && progressWidth !== null && !isPoint && (
                            <Tooltip
                              title={`${Math.round(progressWidth * 100)}% of subitems done`}
                              arrow
                              placement="bottom"
                            >
                              <Box
                                sx={{
                                  position: 'absolute',
                                  top: currentRow * ROW_HEIGHT + BAR_GAP / 2 + BAR_HEIGHT - 3,
                                  left: barLeft,
                                  width: barWidth,
                                  height: 3,
                                  bgcolor: 'grey.300',
                                  borderRadius: 0.5,
                                  overflow: 'hidden',
                                  pointerEvents: 'auto'
                                }}
                              >
                                <Box
                                  sx={{
                                    width: `${progressWidth * 100}%`,
                                    height: '100%',
                                    bgcolor: TIMELINE_COLORS.done,
                                    borderRadius: 0.5,
                                    transition: 'width 0.3s'
                                  }}
                                />
                              </Box>
                            </Tooltip>
                          )}

                          {/* Expanded parent summary bar */}
                          {isExpanded && expandedSubitems.length > 0 && (
                            <ParentSummaryBar
                              item={item}
                              subitems={expandedSubitems}
                              statusLabels={statusLabels}
                              top={currentRow * ROW_HEIGHT}
                              timelineStart={timelineStart}
                            />
                          )}

                          {/* Subitem bars */}
                          {isExpanded && expandedSubitems.map((sub, si) => {
                            const subRow = subitemStartRow + si;
                            return renderSubitemBar(sub, subRow, cache, statusLabels, timelineStart, gridWidth);
                          })}

                          {/* Loading indicator row in timeline */}
                          {isExpanded && cache?.loading && (
                            <Box
                              sx={{
                                position: 'absolute',
                                top: subitemStartRow * ROW_HEIGHT + BAR_GAP / 2,
                                left: 8,
                                height: SUBITEM_BAR_HEIGHT,
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              <CircularProgress size={12} sx={{ mr: 1 }} />
                              <Typography variant="caption" color="text.disabled" fontSize="0.65rem">Loading...</Typography>
                            </Box>
                          )}

                          {/* Subitem dependency arrows */}
                          {isExpanded && cache?.deps?.length > 0 && subitemPositionsByParent[item.id] && (
                            <SubitemDependencyArrows
                              subitemDeps={cache.deps}
                              subitemPositions={subitemPositionsByParent[item.id]}
                            />
                          )}
                        </Box>
                      );
                    })}

                    {grp.noDateItems.map((item) => {
                      const currentRow = rowIndex;
                      rowIndex++;
                      return (
                        <Box
                          key={item.id}
                          sx={{
                            position: 'absolute',
                            top: currentRow * ROW_HEIGHT + BAR_GAP / 2,
                            left: 8,
                            height: BAR_HEIGHT,
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ fontStyle: 'italic', color: 'text.disabled', cursor: 'pointer' }}
                            onClick={() => onItemClick?.(item)}
                          >
                            No dates set
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                );
              });
            })()}

            {/* Item-level dependency arrows */}
            <DependencyArrows
              dependencies={dependencies}
              itemPositions={itemPositions}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/* ── Render a subitem bar ───────────────────────────────────── */
function renderSubitemBar(sub, subRow, cache, statusLabels, timelineStart, gridWidth) {
  const ssd = parseDateLocal(sub.start_date);
  const sdd = parseDateLocal(sub.due_date);
  const sBarStart = ssd || sdd;
  const sBarEnd = sdd || ssd;
  const isBlocked = cache?.blockedMap?.[sub.id];
  const assignees = cache?.assigneeMap?.[sub.id] || [];
  const statusColor = getStatusColor(sub.status, statusLabels);
  const isDone = (() => {
    const sl = statusLabels.find((l) => l.label === sub.status);
    return sl?.is_done_state || sub.status === 'Done';
  })();

  if (!sBarStart) {
    return (
      <Box key={sub.id}>
        {/* Subitem row background */}
        <Box
          sx={{
            position: 'absolute',
            top: subRow * ROW_HEIGHT,
            left: 0,
            width: gridWidth,
            height: ROW_HEIGHT,
            bgcolor: 'grey.50',
            borderBottom: '1px solid',
            borderColor: 'divider',
            opacity: 0.5
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: subRow * ROW_HEIGHT + BAR_GAP / 2,
            left: SUBITEM_INDENT,
            height: SUBITEM_BAR_HEIGHT,
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <Typography variant="caption" sx={{ fontStyle: 'italic', color: 'text.disabled', fontSize: '0.6rem' }}>
            No dates
          </Typography>
        </Box>
      </Box>
    );
  }

  const isPoint = !ssd || !sdd || toDateStr(sBarStart) === toDateStr(sBarEnd);
  const sStartOffset = daysBetween(timelineStart, sBarStart);
  const sEndOffset = daysBetween(timelineStart, sBarEnd);
  const sBarWidth = isPoint ? DAY_WIDTH : Math.max((sEndOffset - sStartOffset + 1) * DAY_WIDTH, DAY_WIDTH);
  const sBarLeft = sStartOffset * DAY_WIDTH;

  const tipContent = (
    <Stack spacing={0.5} sx={{ p: 0.5 }}>
      <Typography variant="caption" fontWeight={700}>{sub.name}</Typography>
      {sub.start_date && <Typography variant="caption">Start: {sub.start_date?.slice?.(0, 10)}</Typography>}
      {sub.due_date && <Typography variant="caption">Due: {sub.due_date?.slice?.(0, 10)}</Typography>}
      <Typography variant="caption">Status: {sub.status || 'To Do'}</Typography>
      {isBlocked && <Typography variant="caption" sx={{ color: TIMELINE_COLORS.blocked }}>Blocked by predecessor(s)</Typography>}
      {assignees.length > 0 && (
        <Typography variant="caption">Assigned: {assignees.map((a) => a.name || a.email).join(', ')}</Typography>
      )}
    </Stack>
  );

  return (
    <Box key={sub.id}>
      {/* Subitem row background */}
      <Box
        sx={{
          position: 'absolute',
          top: subRow * ROW_HEIGHT,
          left: 0,
          width: gridWidth,
          height: ROW_HEIGHT,
          bgcolor: 'grey.50',
          borderBottom: '1px solid',
          borderColor: 'divider',
          opacity: 0.5
        }}
      />
      <Tooltip title={tipContent} arrow placement="top">
        <Box
          sx={{
            position: 'absolute',
            top: subRow * ROW_HEIGHT + BAR_GAP / 2 + (BAR_HEIGHT - SUBITEM_BAR_HEIGHT) / 2,
            left: isPoint ? sBarLeft : sBarLeft,
            width: isPoint ? 10 : sBarWidth,
            height: SUBITEM_BAR_HEIGHT,
            bgcolor: isBlocked ? 'grey.400' : statusColor.bg,
            borderRadius: isPoint ? '50%' : 0.75,
            display: 'flex',
            alignItems: 'center',
            px: isPoint ? 0 : 0.5,
            overflow: 'hidden',
            opacity: isBlocked ? 0.6 : isDone ? 0.75 : 1,
            border: isBlocked ? `1px dashed ${TIMELINE_COLORS.blocked}` : 'none',
            transition: 'opacity 0.15s',
            ...(isPoint && {
              width: 10,
              height: 10,
              mt: `${(SUBITEM_BAR_HEIGHT - 10) / 2}px`,
              ml: `${(DAY_WIDTH - 10) / 2}px`
            }),
            '&:hover': { opacity: 0.85, boxShadow: 1 }
          }}
        >
          {/* Lock icon for blocked */}
          {isBlocked && !isPoint && (
            <IconLock size={10} style={{ marginRight: 2, color: common.white, flexShrink: 0 }} />
          )}
          {/* Subitem name */}
          {!isPoint && sBarWidth > 50 && (
            <Typography
              variant="caption"
              sx={{
                color: statusColor.fg,
                fontSize: '0.6rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                lineHeight: 1.2
              }}
            >
              {sub.name}
            </Typography>
          )}
          {/* Assignee avatar on bar */}
          {!isPoint && assignees.length > 0 && sBarWidth > 40 && (
            <Avatar
              src={assignees[0].avatar_url}
              sx={{
                width: 14,
                height: 14,
                fontSize: '0.45rem',
                ml: 0.25,
                flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.7)'
              }}
            >
              {getInitials(assignees[0].name || assignees[0].email)}
            </Avatar>
          )}
        </Box>
      </Tooltip>
    </Box>
  );
}
