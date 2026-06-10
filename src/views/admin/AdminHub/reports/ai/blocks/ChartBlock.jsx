import { Box, Typography } from '@mui/material';
import Chart from 'react-apexcharts';

const PALETTE = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f'];

export default function ChartBlock({ title, chart_type, data, x_key, series: blueprintSeries = [], empty_message }) {
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return <Typography color="text.secondary" sx={{ mt: 2 }}>{empty_message || `No data for ${title || 'chart'}.`}</Typography>;
  }

  const sample = rows[0] || {};
  const xKey = x_key || Object.keys(sample).find((k) => typeof sample[k] === 'string') || Object.keys(sample)[0];
  const configuredSeries = blueprintSeries.length
    ? blueprintSeries
    : Object.keys(sample)
        .filter((k) => k !== xKey && typeof sample[k] === 'number')
        .map((key) => ({ key, label: key }));

  if (!configuredSeries.length) {
    return <Typography color="text.secondary" sx={{ mt: 2 }}>{empty_message || `No numeric series for ${title || 'chart'}.`}</Typography>;
  }

  let chartProps;
  if (chart_type === 'donut') {
    const firstSeries = configuredSeries[0];
    chartProps = {
      type: 'donut',
      series: rows.map((r) => Number(r[firstSeries.key]) || 0),
      options: { labels: rows.map((r) => String(r[xKey] ?? '')), colors: PALETTE, legend: { position: 'bottom' } }
    };
  } else {
    const apexType = chart_type === 'area' ? 'area' : chart_type === 'line' ? 'line' : 'bar';
    chartProps = {
      type: apexType,
      series: configuredSeries.map((s) => ({
        name: s.label || s.key,
        data: rows.map((r) => Number(r[s.key]) || 0)
      })),
      options: {
        chart: { toolbar: { show: false } },
        xaxis: { categories: rows.map((r) => String(r[xKey] ?? '')) },
        colors: PALETTE
      }
    };
  }

  return (
    <Box sx={{ mt: 2 }}>
      {title && <Typography variant="h6" gutterBottom>{title}</Typography>}
      <Box sx={{ height: 320 }}>
        <Chart {...chartProps} height={320} />
      </Box>
    </Box>
  );
}
