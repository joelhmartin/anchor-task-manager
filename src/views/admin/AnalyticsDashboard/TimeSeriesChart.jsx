import Chart from 'react-apexcharts';
import { Paper, Typography, Stack, Skeleton, Box } from '@mui/material';
import { getPremiumChartDefaults, formatDate, CARD_SHADOW, useChartTheme } from './chartTheme';
import useChartContainer from './useChartContainer';

export default function TimeSeriesChart({ timeSeries, loading }) {
  const theme = useChartTheme();
  const defaults = getPremiumChartDefaults(theme);
  const { ref: chartRef, sx: chartSx } = useChartContainer();

  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton width={200} height={28} sx={{ mb: 1 }} />
        <Skeleton variant="rectangular" height={350} sx={{ borderRadius: 1 }} />
      </Paper>
    );
  }
  if (!timeSeries?.length) return null;

  const categories = timeSeries.map((d) => d.date);
  const formattedCategories = categories.map(formatDate);
  const cpqlSeries = timeSeries.map((d) => {
    if (!d.leads) return null;
    return Math.round(((d.spend || 0) / d.leads) * 100) / 100;
  });

  const colors = [theme.palette.primary.main, theme.palette.warning.main, theme.palette.error.main];

  const series = [
    { name: 'Qualified Leads', type: 'column', data: timeSeries.map((d) => d.leads) },
    { name: 'Spend', type: 'line', data: timeSeries.map((d) => Math.round(d.spend * 100) / 100) },
    { name: 'CPQL', type: 'line', data: cpqlSeries }
  ];

  const options = {
    ...defaults,
    chart: {
      ...defaults.chart,
      type: 'line',
      stacked: false,
      height: 350
    },
    colors,
    plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
    stroke: {
      width: [0, 2.5, 2.5],
      curve: 'smooth'
    },
    fill: {
      type: ['solid', 'solid', 'solid'],
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.05,
        stops: [0, 95, 100]
      }
    },
    xaxis: {
      categories: formattedCategories,
      labels: {
        rotate: -45,
        style: { fontSize: '11px' },
        rotateAlways: categories.length > 20
      },
      tickAmount: Math.min(categories.length, 15),
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: [
      { title: { text: 'Qualified Leads' }, seriesName: 'Qualified Leads', labels: { style: { fontSize: '11px' } } },
      {
        opposite: true,
        title: { text: 'Spend / CPQL ($)' },
        seriesName: 'Spend',
        labels: { formatter: (v) => `$${v}`, style: { fontSize: '11px' } }
      },
      {
        show: false,
        seriesName: 'CPQL'
      }
    ],
    tooltip: {
      theme: 'dark',
      shared: true,
      intersect: false,
      custom: function ({ series: seriesData, dataPointIndex, w }) {
        const date = categories[dataPointIndex];
        const formatted = formatDate(date);
        let html = '<div style="padding: 12px 16px; min-width: 180px;">';
        html += `<div style="font-size: 12px; color: #999; margin-bottom: 8px;">${formatted}</div>`;
        w.config.series.forEach((s, i) => {
          const val = seriesData[i][dataPointIndex];
          const color = w.config.colors[i];
          const display = i === 0 ? val : val == null ? '\u2014' : `$${Number(val).toFixed(2)}`;
          html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">';
          html += `<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block;"></span>${s.name}</span>`;
          html += `<span style="font-weight: 600;">${display}</span>`;
          html += '</div>';
        });
        html += '</div>';
        return html;
      }
    },
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      fontSize: '12px',
      fontFamily: theme.typography.fontFamily,
      labels: { colors: theme.palette.text.secondary },
      markers: { radius: 12 }
    }
  };

  // Determine date range label
  const startDate = formatDate(categories[0]);
  const endDate = formatDate(categories[categories.length - 1]);

  return (
    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Performance Overview
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Qualified Leads as bars, with Spend and CPQL as lines.
            <br />
            {startDate} &mdash; {endDate}
          </Typography>
        </Box>
      </Stack>
      <Box ref={chartRef} sx={chartSx}>
        <Chart options={options} series={series} type="line" height={350} width="100%" />
      </Box>
    </Paper>
  );
}
