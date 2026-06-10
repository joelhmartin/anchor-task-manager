import { useState, useEffect } from 'react';
import { Paper, Typography, Skeleton, Box } from '@mui/material';
import Chart from 'react-apexcharts';
import { CARD_SHADOW, useChartTheme } from './chartTheme';
import { fetchCallHeatmap, fetchGroupCallHeatmap } from 'api/analytics';
import useChartContainer from './useChartContainer';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return '12am';
  if (i < 12) return `${i}am`;
  if (i === 12) return '12pm';
  return `${i - 12}pm`;
});

export default function CallHeatmap({ userId, selection, dateRange }) {
  const theme = useChartTheme();
  const [data, setData] = useState(null);
  const [userCount, setUserCount] = useState(null);
  const [resolvedTz, setResolvedTz] = useState(null);
  const [loading, setLoading] = useState(true);
  const { ref: chartRef, sx: chartSx } = useChartContainer();

  const isMultiClient = selection && selection.mode !== 'single';

  useEffect(() => {
    setLoading(true);
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = { start: dateRange.start, end: dateRange.end, tz: browserTz };
    const request = isMultiClient
      ? fetchGroupCallHeatmap(selection, params)
      : userId
        ? fetchCallHeatmap(userId, params)
        : Promise.resolve({ heatmap: [] });

    request
      .then((r) => {
        setData(r.heatmap || []);
        setUserCount(r.userCount ?? null);
        setResolvedTz(r.timezone || null);
      })
      .catch(() => {
        setData(null);
        setUserCount(null);
        setResolvedTz(null);
      })
      .finally(() => setLoading(false));
  }, [userId, selection, isMultiClient, dateRange]);

  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton height={280} />
      </Paper>
    );
  }

  if (!data || data.length === 0) return null;

  // Build heatmap series — each series is a day of week, data points are hours
  // ApexCharts heatmap: series = [{ name: 'Mon', data: [{ x: '9am', y: 5 }, ...] }]
  const series = DAY_LABELS.map((day, dow) => ({
    name: day,
    data: HOUR_LABELS.map((hourLabel, hour) => {
      const cell = data.find((d) => d.dow === dow && d.hour === hour);
      return { x: hourLabel, y: cell?.count || 0 };
    })
  })).reverse(); // Reverse so Monday is at top

  const axisColor = theme.palette.text.primary;
  const options = {
    chart: {
      type: 'heatmap',
      toolbar: { show: false },
      fontFamily: theme.typography.fontFamily,
      foreColor: axisColor
    },
    plotOptions: {
      heatmap: {
        shadeIntensity: 0.5,
        radius: 4,
        colorScale: {
          ranges: [
            { from: 0, to: 0, name: 'None', color: theme.palette.grey[100] },
            { from: 1, to: 2, name: 'Low', color: '#93c5fd' },
            { from: 3, to: 5, name: 'Medium', color: '#3b82f6' },
            { from: 6, to: 10, name: 'High', color: '#1d4ed8' },
            { from: 11, to: 100, name: 'Very High', color: '#1e3a5f' }
          ]
        }
      }
    },
    dataLabels: {
      enabled: true,
      style: { fontSize: '10px', colors: ['#fff'] },
      formatter: (val) => (val > 0 ? val : '')
    },
    xaxis: {
      labels: { style: { fontSize: '10px', colors: axisColor }, rotate: -45 },
      axisBorder: { show: false }
    },
    yaxis: {
      labels: { style: { fontSize: '11px', fontWeight: 600, colors: axisColor } }
    },
    legend: { labels: { colors: axisColor } },
    grid: { show: false },
    tooltip: {
      theme: 'dark',
      y: { formatter: (val) => `${val} call${val !== 1 ? 's' : ''}` }
    }
  };

  const subtitle = isMultiClient
    ? `Aggregated call volume across ${userCount ?? 'selected'} ${userCount === 1 ? 'account' : 'accounts'} — darker = more calls.`
    : 'When are calls coming in? Darker = more calls.';

  return (
    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
      <Typography variant="h4" fontWeight={600} sx={{ mb: 0.5 }}>
        Call Volume Heatmap
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        {subtitle}
        {resolvedTz ? ` Times shown in ${resolvedTz}.` : ''}
      </Typography>
      <Box ref={chartRef} sx={chartSx}>
        <Chart options={options} series={series} type="heatmap" height={280} width="100%" />
      </Box>
    </Paper>
  );
}
