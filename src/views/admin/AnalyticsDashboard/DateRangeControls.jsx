import { useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import dayjs from 'dayjs';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
import { Stack, ToggleButton, ToggleButtonGroup, Button, Popover, Typography, Switch, FormControlLabel, Divider, Box } from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import SelectField from 'ui-component/extended/SelectField';

dayjs.extend(quarterOfYear);

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const QUICK_PRESETS = ['7d', '30d', '90d'];

const ALL_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'last_quarter', label: 'Last Quarter' },
  { key: 'ytd', label: 'Year to Date' },
  { key: '12m', label: 'Last 12 Months' }
];

const COMPARISON_OPTIONS = [
  { value: 'previous_period', label: 'Previous Period' },
  { value: 'same_period_last_year', label: 'Same Period Last Year' },
  { value: 'custom', label: 'Custom' }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a preset key into { start: dayjs, end: dayjs }.
 */
function resolvePreset(key) {
  const today = dayjs().startOf('day');

  switch (key) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const y = today.subtract(1, 'day');
      return { start: y, end: y };
    }
    case '7d':
      return { start: today.subtract(6, 'day'), end: today };
    case '30d':
      return { start: today.subtract(29, 'day'), end: today };
    case '90d':
      return { start: today.subtract(89, 'day'), end: today };
    case 'this_month':
      return { start: today.startOf('month'), end: today };
    case 'last_month': {
      const lm = today.subtract(1, 'month');
      return { start: lm.startOf('month'), end: lm.endOf('month').startOf('day') };
    }
    case 'this_quarter':
      return { start: today.startOf('quarter'), end: today };
    case 'last_quarter': {
      const lq = today.subtract(1, 'quarter');
      return { start: lq.startOf('quarter'), end: lq.endOf('quarter').startOf('day') };
    }
    case 'ytd':
      return { start: today.startOf('year'), end: today };
    case '12m':
      return { start: today.subtract(12, 'month').add(1, 'day'), end: today };
    default:
      return { start: today.subtract(29, 'day'), end: today };
  }
}

/**
 * Compute a comparison range given the primary range and comparison type.
 * - previous_period: shift back by (duration + 1 day) so periods don't overlap
 * - same_period_last_year: subtract 1 year from both endpoints
 */
function computeComparisonRange(start, end, type) {
  const s = dayjs(start);
  const e = dayjs(end);
  const durationDays = e.diff(s, 'day');

  switch (type) {
    case 'previous_period': {
      const compEnd = s.subtract(1, 'day');
      const compStart = compEnd.subtract(durationDays, 'day');
      return {
        start: compStart.format('YYYY-MM-DD'),
        end: compEnd.format('YYYY-MM-DD')
      };
    }
    case 'same_period_last_year':
      return {
        start: s.subtract(1, 'year').format('YYYY-MM-DD'),
        end: e.subtract(1, 'year').format('YYYY-MM-DD')
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DateRangeControls({ dateRange, onDateRangeChange, comparisonRange, onComparisonChange }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [activePreset, setActivePreset] = useState('30d');
  const [compareEnabled, setCompareEnabled] = useState(!!comparisonRange);
  const [compareType, setCompareType] = useState('previous_period');

  // Detect if the current dateRange matches a quick preset
  const matchedQuickPreset = useMemo(() => {
    if (!dateRange) return null;
    for (const key of QUICK_PRESETS) {
      const resolved = resolvePreset(key);
      if (resolved.start.format('YYYY-MM-DD') === dateRange.start && resolved.end.format('YYYY-MM-DD') === dateRange.end) {
        return key;
      }
    }
    return null;
  }, [dateRange]);

  // Derive a human-readable label for the More button
  const rangeLabel = useMemo(() => {
    if (!dateRange) return 'Select dates';
    const preset = ALL_PRESETS.find((p) => p.key === activePreset);
    if (preset && matchedQuickPreset) return null; // Quick preset is highlighted, no extra label needed
    if (preset) return preset.label;
    return `${dateRange.start} – ${dateRange.end}`;
  }, [dateRange, activePreset, matchedQuickPreset]);

  // Apply a preset or custom range
  const applyRange = useCallback(
    (start, end, presetKey) => {
      const range = {
        start: dayjs(start).format('YYYY-MM-DD'),
        end: dayjs(end).format('YYYY-MM-DD')
      };
      onDateRangeChange(range);
      if (presetKey) setActivePreset(presetKey);

      // Auto-recompute comparison if enabled
      if (compareEnabled && compareType !== 'custom') {
        const comp = computeComparisonRange(range.start, range.end, compareType);
        onComparisonChange(comp);
      }
    },
    [onDateRangeChange, compareEnabled, compareType, onComparisonChange]
  );

  const handleQuickPreset = useCallback(
    (_, val) => {
      if (!val) return;
      const resolved = resolvePreset(val);
      applyRange(resolved.start, resolved.end, val);
    },
    [applyRange]
  );

  const handlePresetClick = useCallback(
    (key) => {
      const resolved = resolvePreset(key);
      applyRange(resolved.start, resolved.end, key);
      setAnchorEl(null);
    },
    [applyRange]
  );

  const handleCompareToggle = useCallback(
    (e) => {
      const enabled = e.target.checked;
      setCompareEnabled(enabled);
      if (!enabled) {
        onComparisonChange(null);
      } else {
        const comp = computeComparisonRange(dateRange.start, dateRange.end, compareType);
        onComparisonChange(comp);
      }
    },
    [dateRange, compareType, onComparisonChange]
  );

  const handleCompareTypeChange = useCallback(
    (e) => {
      const type = e.target.value;
      setCompareType(type);
      if (type === 'custom') {
        // Initialize custom comparison to previous period as a starting point
        const comp = computeComparisonRange(dateRange.start, dateRange.end, 'previous_period');
        onComparisonChange(comp);
      } else {
        const comp = computeComparisonRange(dateRange.start, dateRange.end, type);
        onComparisonChange(comp);
      }
    },
    [dateRange, onComparisonChange]
  );

  const handleCustomStart = useCallback(
    (val) => {
      if (!val || !val.isValid()) return;
      const start = val.format('YYYY-MM-DD');
      const end = dateRange.end;
      applyRange(start, end, null);
      setActivePreset(null);
    },
    [dateRange, applyRange]
  );

  const handleCustomEnd = useCallback(
    (val) => {
      if (!val || !val.isValid()) return;
      const start = dateRange.start;
      const end = val.format('YYYY-MM-DD');
      applyRange(start, end, null);
      setActivePreset(null);
    },
    [dateRange, applyRange]
  );

  const handleComparisonStart = useCallback(
    (val) => {
      if (!val || !val.isValid()) return;
      onComparisonChange({
        start: val.format('YYYY-MM-DD'),
        end: comparisonRange?.end || dateRange.end
      });
    },
    [comparisonRange, dateRange, onComparisonChange]
  );

  const handleComparisonEnd = useCallback(
    (val) => {
      if (!val || !val.isValid()) return;
      onComparisonChange({
        start: comparisonRange?.start || dateRange.start,
        end: val.format('YYYY-MM-DD')
      });
    },
    [comparisonRange, dateRange, onComparisonChange]
  );

  const popoverOpen = Boolean(anchorEl);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, width: '100%' }}>
        {/* Quick presets */}
        <ToggleButtonGroup
          value={matchedQuickPreset || activePreset}
          exclusive
          onChange={handleQuickPreset}
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: { xs: '0.95rem', md: '1rem' },
              fontWeight: 600,
              textTransform: 'none',
              px: { xs: 2, md: 2.5 },
              py: { xs: 0.75, md: 1 },
              minWidth: { xs: 52, md: 60 }
            }
          }}
        >
          {QUICK_PRESETS.map((key) => (
            <ToggleButton key={key} value={key}>
              {key}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* More button */}
        <Button
          variant={!matchedQuickPreset && activePreset && !QUICK_PRESETS.includes(activePreset) ? 'contained' : 'outlined'}
          startIcon={<CalendarMonthIcon />}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            textTransform: 'none',
            minWidth: { xs: 170, md: 210 },
            justifyContent: 'flex-start',
            fontSize: { xs: '0.95rem', md: '1rem' },
            fontWeight: 600,
            py: { xs: 0.75, md: 1 }
          }}
        >
          {rangeLabel || 'More'}
        </Button>

        <Popover
          open={popoverOpen}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: { p: 2, minWidth: 280 } } }}
        >
          <Typography variant="subtitle2" gutterBottom>
            Presets
          </Typography>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            {ALL_PRESETS.map((p) => (
              <Button
                key={p.key}
                size="small"
                variant={activePreset === p.key ? 'contained' : 'text'}
                onClick={() => handlePresetClick(p.key)}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              >
                {p.label}
              </Button>
            ))}
          </Stack>

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2" gutterBottom>
            Custom Range
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <DatePicker
              label="Start"
              value={dateRange ? dayjs(dateRange.start) : null}
              onChange={handleCustomStart}
              slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
              maxDate={dateRange ? dayjs(dateRange.end) : undefined}
            />
            <DatePicker
              label="End"
              value={dateRange ? dayjs(dateRange.end) : null}
              onChange={handleCustomEnd}
              slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
              minDate={dateRange ? dayjs(dateRange.start) : undefined}
              maxDate={dayjs()}
            />
          </Stack>
        </Popover>

        {/* Divider */}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {/* Comparison toggle */}
        <FormControlLabel
          control={<Switch checked={compareEnabled} onChange={handleCompareToggle} />}
          label={
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <CompareArrowsIcon />
              <Typography sx={{ fontSize: { xs: '0.95rem', md: '1rem' }, fontWeight: 600 }}>Compare</Typography>
            </Stack>
          }
          sx={{ mr: 0 }}
        />

        {/* Comparison type selector */}
        {compareEnabled && (
          <Box sx={{ minWidth: 180 }}>
            <SelectField
              value={compareType}
              onChange={handleCompareTypeChange}
              options={COMPARISON_OPTIONS}
              fullWidth={false}
              sx={{
                minWidth: 220,
                '& .MuiInputBase-root': { fontSize: { xs: '0.95rem', md: '1rem' } }
              }}
            />
          </Box>
        )}

        {/* Custom comparison date pickers */}
        {compareEnabled && compareType === 'custom' && (
          <Stack direction="row" spacing={1} alignItems="center">
            <DatePicker
              label="Compare Start"
              value={comparisonRange ? dayjs(comparisonRange.start) : null}
              onChange={handleComparisonStart}
              slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
            />
            <DatePicker
              label="Compare End"
              value={comparisonRange ? dayjs(comparisonRange.end) : null}
              onChange={handleComparisonEnd}
              slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
            />
          </Stack>
        )}
      </Stack>
    </LocalizationProvider>
  );
}

DateRangeControls.propTypes = {
  /** Primary date range as { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } */
  dateRange: PropTypes.shape({
    start: PropTypes.string.isRequired,
    end: PropTypes.string.isRequired
  }).isRequired,
  /** Called when the primary date range changes */
  onDateRangeChange: PropTypes.func.isRequired,
  /** Comparison date range, or null when comparison is disabled */
  comparisonRange: PropTypes.shape({
    start: PropTypes.string.isRequired,
    end: PropTypes.string.isRequired
  }),
  /** Called when comparison range changes; called with null to disable */
  onComparisonChange: PropTypes.func.isRequired
};
