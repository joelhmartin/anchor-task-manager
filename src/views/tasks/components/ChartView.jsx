import { useMemo, useState } from 'react';
import { Box, ButtonGroup, Button, Stack, Typography, useTheme } from '@mui/material';
import { IconChartBar, IconChartPie, IconChartLine } from '@tabler/icons-react';
import EmptyState from 'ui-component/extended/EmptyState';
import Chart from 'react-apexcharts';
import { CHART_PALETTE, STATUS_FALLBACK_COLOR } from 'constants/taskDefaults';

function groupBy(items, field) {
  const map = {};
  items.forEach((item) => {
    const key = item[field] || 'Unknown';
    if (!map[key]) map[key] = 0;
    map[key]++;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ChartView({ items = [], groups = [], statusLabels = [], itemLabelsMap = {}, onItemClick }) {
  const theme = useTheme();
  const [chartType, setChartType] = useState('bar'); // 'bar' | 'pie' | 'line'
  const [groupByField, setGroupByField] = useState('status'); // 'status' | 'group' | 'assignee' | 'month'

  const groupMap = useMemo(() => {
    const m = {};
    groups.forEach((g) => { m[g.id] = g.name; });
    return m;
  }, [groups]);

  const chartData = useMemo(() => {
    if (!items.length) return { categories: [], series: [] };

    if (groupByField === 'month') {
      const byMonth = {};
      items.forEach((item) => {
        const key = getMonthKey(item.due_date) || getMonthKey(item.created_at) || 'No date';
        if (!byMonth[key]) byMonth[key] = 0;
        byMonth[key]++;
      });
      const sorted = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
      return { categories: sorted.map(([k]) => k), series: [{ name: 'Items', data: sorted.map(([, v]) => v) }] };
    }

    if (groupByField === 'group') {
      const enriched = items.map((it) => ({ ...it, _group: groupMap[it.group_id] || 'Unknown' }));
      const grouped = groupBy(enriched, '_group');
      return { categories: grouped.map(([k]) => k), series: [{ name: 'Items', data: grouped.map(([, v]) => v) }] };
    }

    const grouped = groupBy(items, groupByField === 'status' ? 'status' : 'status');
    return { categories: grouped.map(([k]) => k), series: [{ name: 'Items', data: grouped.map(([, v]) => v) }] };
  }, [items, groupByField, groupMap]);

  const statusColors = useMemo(() => {
    const map = {};
    statusLabels.forEach((sl) => { map[sl.label] = sl.color; });
    return map;
  }, [statusLabels]);

  const colors = useMemo(() => {
    if (groupByField === 'status') {
      return chartData.categories.map((cat) => statusColors[cat] || STATUS_FALLBACK_COLOR);
    }
    return CHART_PALETTE;
  }, [chartData.categories, groupByField, statusColors]);

  if (!items.length) {
    return <EmptyState icon={IconChartBar} title="No items" message="Create items to see charts" />;
  }

  const barOptions = {
    chart: { type: 'bar', toolbar: { show: false }, background: 'transparent' },
    plotOptions: { bar: { borderRadius: 4, horizontal: false, columnWidth: '60%' } },
    xaxis: { categories: chartData.categories },
    colors,
    dataLabels: { enabled: true },
    theme: { mode: theme.palette.mode },
    grid: { borderColor: theme.palette.divider }
  };

  const pieOptions = {
    chart: { type: 'donut', background: 'transparent' },
    labels: chartData.categories,
    colors,
    legend: { position: 'bottom', fontSize: '12px' },
    dataLabels: { enabled: true },
    theme: { mode: theme.palette.mode }
  };

  const lineOptions = {
    chart: { type: 'line', toolbar: { show: false }, background: 'transparent' },
    xaxis: { categories: chartData.categories },
    colors: [colors[0] || CHART_PALETTE[0]],
    stroke: { curve: 'smooth', width: 3 },
    markers: { size: 5 },
    dataLabels: { enabled: false },
    theme: { mode: theme.palette.mode },
    grid: { borderColor: theme.palette.divider }
  };

  return (
    <Stack spacing={2}>
      {/* Controls */}
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap">
        <ButtonGroup size="small" variant="outlined">
          <Button onClick={() => setChartType('bar')} variant={chartType === 'bar' ? 'contained' : 'outlined'} startIcon={<IconChartBar size={14} />}>Bar</Button>
          <Button onClick={() => setChartType('pie')} variant={chartType === 'pie' ? 'contained' : 'outlined'} startIcon={<IconChartPie size={14} />}>Pie</Button>
          <Button onClick={() => setChartType('line')} variant={chartType === 'line' ? 'contained' : 'outlined'} startIcon={<IconChartLine size={14} />}>Line</Button>
        </ButtonGroup>

        <ButtonGroup size="small" variant="outlined">
          <Button onClick={() => setGroupByField('status')} variant={groupByField === 'status' ? 'contained' : 'outlined'}>By Status</Button>
          <Button onClick={() => setGroupByField('group')} variant={groupByField === 'group' ? 'contained' : 'outlined'}>By Group</Button>
          <Button onClick={() => setGroupByField('month')} variant={groupByField === 'month' ? 'contained' : 'outlined'}>By Month</Button>
        </ButtonGroup>
      </Stack>

      {/* Chart */}
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
        {chartType === 'bar' && (
          <Chart options={barOptions} series={chartData.series} type="bar" height={350} />
        )}
        {chartType === 'pie' && (
          <Chart options={pieOptions} series={chartData.series[0]?.data || []} type="donut" height={350} />
        )}
        {chartType === 'line' && (
          <Chart options={lineOptions} series={chartData.series} type="line" height={350} />
        )}
      </Box>

      {/* Summary */}
      <Typography variant="caption" color="text.secondary">
        {items.length} items across {chartData.categories.length} {groupByField === 'status' ? 'statuses' : groupByField === 'group' ? 'groups' : 'periods'}
      </Typography>
    </Stack>
  );
}
