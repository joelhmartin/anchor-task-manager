import { useState, useEffect } from 'react';
import { Paper, Typography, Skeleton, Box } from '@mui/material';
import Chart from 'react-apexcharts';
import { CARD_SHADOW, useChartTheme } from './chartTheme';
import { fetchFunnelData } from 'api/analytics';
import useChartContainer from './useChartContainer';

export default function FunnelChart({ userId, dateRange }) {
  const theme = useChartTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { ref: chartRef, sx: chartSx } = useChartContainer();

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchFunnelData(userId, { start: dateRange.start, end: dateRange.end })
      .then((r) => setData(r.funnel || []))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [userId, dateRange]);

  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton height={280} />
      </Paper>
    );
  }

  if (!data || data.every((d) => d.value === 0)) return null;

  const categories = data.map((d) => d.stage);
  const values = data.map((d) => d.value);

  // Calculate conversion rates between stages
  const rates = data.map((d, i) => {
    if (i === 0) return '';
    const prev = data[i - 1].value;
    return prev > 0 ? `${((d.value / prev) * 100).toFixed(1)}%` : '\u2014';
  });

  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#22c55e', '#06b6d4'];

  const options = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: theme.typography.fontFamily },
    plotOptions: {
      bar: {
        horizontal: true,
        distributed: true,
        borderRadius: 6,
        barHeight: '70%',
        dataLabels: { position: 'center' }
      }
    },
    colors,
    xaxis: { categories, labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { fontSize: '13px', fontWeight: 600 } } },
    grid: { show: false },
    dataLabels: {
      enabled: true,
      formatter: (val, { dataPointIndex }) => {
        const rate = rates[dataPointIndex];
        return rate ? `${val.toLocaleString()} (${rate})` : val.toLocaleString();
      },
      style: { fontSize: '13px', fontWeight: 600, colors: ['#fff'] }
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: (val, { dataPointIndex }) => {
          const rate = rates[dataPointIndex];
          return rate ? `${val.toLocaleString()} \u2014 ${rate} from previous stage` : val.toLocaleString();
        }
      }
    },
    legend: { show: false }
  };

  return (
    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
      <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>
        Conversion Funnel
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Sessions &rarr; Engaged &rarr; Leads &rarr; Qualified &rarr; Clients
      </Typography>
      <Box ref={chartRef} sx={chartSx}>
        <Chart options={options} series={[{ data: values }]} type="bar" height={280} width="100%" />
      </Box>
    </Paper>
  );
}
