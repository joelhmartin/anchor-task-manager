/**
 * Shared premium chart defaults for the Analytics Dashboard.
 * Import getPremiumChartDefaults, PREMIUM_COLORS, gradientFill, darkTooltip, formatDate
 * into any chart component for a consistent, polished look.
 *
 * IMPORTANT: Under MUI v6 with `cssVariables` enabled, `theme.palette.*` returns the
 * DEFAULT color scheme's static hex values — it does NOT switch when the user toggles
 * dark mode. ApexCharts bakes hex values into inline SVG styles at render time, so
 * passing the static palette would leave every chart stuck on light-mode colors.
 *
 * Use `useChartTheme()` inside chart components to get a theme object whose `palette`
 * reflects the currently-active color scheme. Pass that to `getPremiumChartDefaults`
 * / `getPremiumDonutDefaults` (or read `chartTheme.palette.*` directly in per-chart
 * option overrides).
 */

import { useTheme, useColorScheme } from '@mui/material/styles';

export function useChartTheme() {
  const theme = useTheme();
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === 'system' ? systemMode || 'light' : mode || 'light';
  const palette = theme.colorSchemes?.[resolved]?.palette || theme.palette;
  return { ...theme, palette };
}

export function getPremiumChartDefaults(theme) {
  return {
    chart: {
      toolbar: { show: false },
      fontFamily: theme.typography.fontFamily,
      foreColor: theme.palette.text.primary
    },
    grid: {
      strokeDashArray: 4,
      borderColor: theme.palette.divider,
      xaxis: { lines: { show: false } }
    },
    tooltip: {
      theme: 'dark',
      style: { fontSize: '12px' },
      x: { show: true },
      marker: { show: true }
    },
    states: {
      hover: { filter: { type: 'lighten', value: 0.04 } },
      active: { filter: { type: 'darken', value: 0.88 } }
    }
  };
}

export const PREMIUM_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'
];

export function gradientFill(color, opacityFrom = 0.4, opacityTo = 0.05) {
  return {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom,
      opacityTo,
      stops: [0, 95, 100],
      colorStops: [
        { offset: 0, color, opacity: opacityFrom },
        { offset: 100, color, opacity: opacityTo }
      ]
    }
  };
}

export function darkTooltip(formatters) {
  return {
    theme: 'dark',
    style: { fontSize: '12px' },
    ...formatters
  };
}

export function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Premium card shadow used across all dashboard cards */
export const CARD_SHADOW = '0 2px 14px 0 rgb(32 40 45 / 8%)';

/** Premium donut chart defaults */
export function getPremiumDonutDefaults(theme, colors) {
  const defaults = getPremiumChartDefaults(theme);
  return {
    ...defaults,
    chart: { ...defaults.chart, type: 'donut' },
    colors: colors || PREMIUM_COLORS,
    plotOptions: {
      pie: {
        donut: { size: '70%' },
        expandOnClick: true
      }
    },
    legend: {
      position: 'bottom',
      fontSize: '12px',
      fontFamily: theme.typography.fontFamily,
      labels: { colors: theme.palette.text.primary },
      formatter: function (seriesName, opts) {
        const total = opts.w.globals.seriesTotals.reduce((a, b) => a + b, 0);
        const val = opts.w.globals.series[opts.seriesIndex];
        const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
        return `${seriesName} — ${pct}%`;
      }
    },
    dataLabels: { enabled: false },
    stroke: { width: 2, colors: [theme.palette.background.paper] }
  };
}
