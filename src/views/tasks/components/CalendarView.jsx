import { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material';
import { IconChevronLeft, IconChevronRight, IconCalendarEvent } from '@tabler/icons-react';
import EmptyState from 'ui-component/extended/EmptyState';
import { STATUS_FALLBACK_COLOR } from 'constants/taskDefaults';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const cells = [];
  // Previous month padding
  const prevMonthLast = new Date(year, month, 0).getDate();
  for (let i = startPad - 1; i >= 0; i--) {
    cells.push({ day: prevMonthLast - i, currentMonth: false, date: new Date(year, month - 1, prevMonthLast - i) });
  }
  // Current month
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ day: d, currentMonth: true, date: new Date(year, month, d) });
  }
  // Next month padding to fill 6 rows
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, currentMonth: false, date: new Date(year, month + 1, d) });
  }
  return cells;
}

function getWeekGrid(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ day: d.getDate(), currentMonth: true, date: d });
  }
  return cells;
}

function dateKey(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getStatusColor(status, statusLabels) {
  const label = statusLabels.find((l) => l.label === status || l.id === status);
  return label?.color || STATUS_FALLBACK_COLOR;
}

function isToday(date) {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ── Calendar Item Chip ────────────────────────────────────────────────────────

function CalendarItem({ item, statusLabels, onItemClick }) {
  const color = getStatusColor(item.status, statusLabels);
  return (
    <Tooltip title={`${item.name} — ${item.status}`} arrow>
      <Chip
        label={item.name}
        size="small"
        onClick={(e) => { e.stopPropagation(); onItemClick?.(item); }}
        sx={{
          height: 20,
          fontSize: '0.65rem',
          maxWidth: '100%',
          bgcolor: color + '22',
          borderLeft: `3px solid ${color}`,
          borderRadius: 0.75,
          cursor: 'pointer',
          justifyContent: 'flex-start',
          '& .MuiChip-label': { px: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' },
          '&:hover': { bgcolor: color + '44' }
        }}
      />
    </Tooltip>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CalendarView({ items = [], groups = [], statusLabels = [], itemLabelsMap = {}, onItemClick }) {
  const theme = useTheme();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [mode, setMode] = useState('month'); // 'month' | 'week'
  const [weekAnchor, setWeekAnchor] = useState(today);

  // Group items by due_date
  const itemsByDate = useMemo(() => {
    const map = {};
    items.forEach((item) => {
      if (!item.due_date) return;
      const key = dateKey(item.due_date);
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }, [items]);

  const itemsWithoutDate = useMemo(() => items.filter((i) => !i.due_date), [items]);

  const grid = useMemo(() => {
    if (mode === 'week') return getWeekGrid(weekAnchor);
    return getMonthGrid(year, month);
  }, [year, month, mode, weekAnchor]);

  const handlePrev = useCallback(() => {
    if (mode === 'week') {
      setWeekAnchor((prev) => {
        const d = new Date(prev);
        d.setDate(d.getDate() - 7);
        return d;
      });
    } else {
      if (month === 0) { setMonth(11); setYear((y) => y - 1); }
      else setMonth((m) => m - 1);
    }
  }, [mode, month]);

  const handleNext = useCallback(() => {
    if (mode === 'week') {
      setWeekAnchor((prev) => {
        const d = new Date(prev);
        d.setDate(d.getDate() + 7);
        return d;
      });
    } else {
      if (month === 11) { setMonth(0); setYear((y) => y + 1); }
      else setMonth((m) => m + 1);
    }
  }, [mode, month]);

  const handleToday = useCallback(() => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setWeekAnchor(now);
  }, []);

  const title = mode === 'week'
    ? (() => {
        const start = new Date(weekAnchor);
        start.setDate(start.getDate() - start.getDay());
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${start.getMonth() !== end.getMonth() ? MONTH_NAMES[end.getMonth()] + ' ' : ''}${end.getDate()}, ${end.getFullYear()}`;
      })()
    : `${MONTH_NAMES[month]} ${year}`;

  const rows = [];
  for (let i = 0; i < grid.length; i += 7) {
    rows.push(grid.slice(i, i + 7));
  }

  const cellMinHeight = mode === 'week' ? 200 : 100;
  const MAX_VISIBLE = mode === 'week' ? 8 : 3;

  return (
    <Stack spacing={1.5}>
      {/* Header controls */}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton size="small" onClick={handlePrev} aria-label={mode === 'week' ? 'Previous week' : 'Previous month'}><IconChevronLeft size={18} /></IconButton>
          <Typography variant="h5" sx={{ minWidth: 220, textAlign: 'center' }}>{title}</Typography>
          <IconButton size="small" onClick={handleNext} aria-label={mode === 'week' ? 'Next week' : 'Next month'}><IconChevronRight size={18} /></IconButton>
          <Button size="small" variant="text" onClick={handleToday} sx={{ textTransform: 'none' }}>Today</Button>
        </Stack>
        <ButtonGroup size="small" variant="outlined">
          <Button onClick={() => setMode('week')} variant={mode === 'week' ? 'contained' : 'outlined'}>Week</Button>
          <Button onClick={() => setMode('month')} variant={mode === 'month' ? 'contained' : 'outlined'}>Month</Button>
        </ButtonGroup>
      </Stack>

      {/* Calendar grid */}
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
        {/* Day headers */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid', borderColor: 'divider' }}>
          {DAYS.map((day) => (
            <Box key={day} sx={{ py: 0.75, textAlign: 'center', bgcolor: 'action.hover' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.7rem' }}>{day}</Typography>
            </Box>
          ))}
        </Box>

        {/* Rows */}
        {rows.map((row, ri) => (
          <Box
            key={ri}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              borderBottom: ri < rows.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider'
            }}
          >
            {row.map((cell, ci) => {
              const key = dateKey(cell.date);
              const dayItems = itemsByDate[key] || [];
              const todayCell = isToday(cell.date);

              return (
                <Box
                  key={ci}
                  sx={{
                    minHeight: cellMinHeight,
                    p: 0.5,
                    borderRight: ci < 6 ? '1px solid' : 'none',
                    borderColor: 'divider',
                    bgcolor: !cell.currentMonth ? 'action.hover' : todayCell ? 'primary.main' + '08' : 'background.paper',
                    opacity: cell.currentMonth ? 1 : 0.5,
                    overflow: 'hidden'
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: todayCell ? 700 : 400,
                      color: todayCell ? 'primary.main' : 'text.secondary',
                      fontSize: '0.7rem',
                      display: 'block',
                      mb: 0.25,
                      ...(todayCell && {
                        bgcolor: 'primary.main',
                        color: 'common.white',
                        borderRadius: '50%',
                        width: 20,
                        height: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      })
                    }}
                  >
                    {cell.day}
                  </Typography>
                  <Stack spacing={0.25}>
                    {dayItems.slice(0, MAX_VISIBLE).map((item) => (
                      <CalendarItem key={item.id} item={item} statusLabels={statusLabels} onItemClick={onItemClick} />
                    ))}
                    {dayItems.length > MAX_VISIBLE && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', pl: 0.5 }}>
                        +{dayItems.length - MAX_VISIBLE} more
                      </Typography>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {/* Unscheduled items */}
      {itemsWithoutDate.length > 0 && (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Unscheduled ({itemsWithoutDate.length})
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {itemsWithoutDate.slice(0, 20).map((item) => (
              <CalendarItem key={item.id} item={item} statusLabels={statusLabels} onItemClick={onItemClick} />
            ))}
            {itemsWithoutDate.length > 20 && (
              <Typography variant="caption" color="text.secondary">+{itemsWithoutDate.length - 20} more</Typography>
            )}
          </Stack>
        </Box>
      )}

      {items.length === 0 && (
        <EmptyState
          icon={IconCalendarEvent}
          title="No items"
          message="Create items with due dates to see them on the calendar"
        />
      )}
    </Stack>
  );
}
