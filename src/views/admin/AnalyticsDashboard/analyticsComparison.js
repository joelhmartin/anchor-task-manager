import { alpha } from '@mui/material/styles';

/**
 * Single source of truth for whether higher values mean a better outcome
 * for each metric. Used by KPI delta chips, comparison tooltips, and bar
 * outcome coloring across analytics dashboards.
 *
 * Default when a metric is missing from this map: upIsGood = true.
 */
export const METRIC_POLARITY = {
  // Costs / negative-direction metrics (down is good)
  spend: false,
  totalSpend: false,
  cpc: false,
  cpm: false,
  cpa: false,
  cpql: false,
  costPerLead: false,
  costPerConversion: false,
  missedCalls: false,
  missedRate: false,

  // Volume / engagement / quality (up is good)
  totalLeads: true,
  qualifiedLeads: true,
  qualifiedCalls: true,
  qualifiedRate: true,
  totalCalls: true,
  totalForms: true,
  totalSessions: true,
  sessions: true,
  engagedSessions: true,
  engagementRate: true,
  conversionRate: true,
  conversions: true,
  clicks: true,
  impressions: true,
  ctr: true,
  reach: true,
  landingPageViews: true,
  avgDuration: true
};

export function getMetricPolarity(metricKey) {
  return METRIC_POLARITY[metricKey] ?? true;
}

export function computeDelta(current, previous) {
  if (previous == null || previous === 0) return null;
  if (current == null) return null;
  const pct = ((current - previous) / previous) * 100;
  if (!isFinite(pct)) return null;
  return pct;
}

export function getDeltaOutcome(deltaPct, upIsGood) {
  if (deltaPct == null || Math.abs(deltaPct) < 0.01) return 'neutral';
  const isUp = deltaPct > 0;
  return isUp === upIsGood ? 'improved' : 'regressed';
}

export function getOutcomeColor(theme, outcome, fallback) {
  if (outcome === 'improved') return theme.palette.success.main;
  if (outcome === 'regressed') return theme.palette.error.main;
  return fallback || theme.palette.grey[500];
}

export function formatDeltaPercent(current, previous) {
  const pct = computeDelta(current, previous);
  if (pct == null) return null;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Sum a numeric array, treating null/undefined as 0.
 */
function sum(arr) {
  return (arr || []).reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

/**
 * Per-chart aggregate outcome coloring. Compares the totals of the
 * current vs comparison series and returns the color the Current
 * series should use in the chart.
 *
 * Comparison series should use a neutral light color from the same util.
 */
export function getCurrentSeriesColor(theme, currentValues, comparisonValues, upIsGood, fallback) {
  const currentTotal = sum(currentValues);
  const comparisonTotal = sum(comparisonValues);
  if (!comparisonValues?.length || comparisonTotal === 0) {
    return fallback || theme.palette.primary.main;
  }
  const delta = computeDelta(currentTotal, comparisonTotal);
  const outcome = getDeltaOutcome(delta, upIsGood);
  return getOutcomeColor(theme, outcome, fallback || theme.palette.primary.main);
}

/**
 * Lighter neutral color for the comparison series in a paired bar chart.
 */
export function getComparisonSeriesColor(theme) {
  return alpha(theme.palette.text.primary, 0.18);
}

/**
 * Returns [currentColor, comparisonColor] suitable for an ApexCharts
 * `colors` array on a paired bar chart. Falls back to fallbackColor when
 * no comparison data is supplied.
 */
export function buildComparisonSeriesColors(theme, currentValues, comparisonValues, upIsGood, fallback) {
  const hasComparison = (comparisonValues?.length || 0) > 0 && sum(comparisonValues) > 0;
  if (!hasComparison) return [fallback || theme.palette.primary.main];
  return [
    getCurrentSeriesColor(theme, currentValues, comparisonValues, upIsGood, fallback),
    getComparisonSeriesColor(theme)
  ];
}

/**
 * ApexCharts custom tooltip that renders Current / Previous / Δ% with a
 * colored arrow reflecting whether the change is good or bad given the
 * metric's polarity.
 *
 * @param {object} opts
 * @param {(v: any) => string} opts.formatter
 * @param {string[]} opts.labels
 * @param {boolean} opts.upIsGood
 */
export function buildComparisonTooltip({ formatter, labels, upIsGood }) {
  return {
    theme: 'dark',
    shared: true,
    intersect: false,
    custom({ series, dataPointIndex }) {
      const label = labels?.[dataPointIndex] || '';
      const current = series?.[0]?.[dataPointIndex];
      const previous = series?.[1]?.[dataPointIndex];
      const delta = computeDelta(current, previous);
      const outcome = getDeltaOutcome(delta, upIsGood);
      const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';
      const color = outcome === 'improved' ? '#22c55e' : outcome === 'regressed' ? '#ef4444' : '#a1a1aa';
      const deltaStr = formatDeltaPercent(current, previous);
      let html = '<div style="padding: 10px 14px; min-width: 200px;">';
      html += `<div style="font-size: 11px; color: #cbd5e1; margin-bottom: 8px;">${label}</div>`;
      html += '<div style="display: flex; justify-content: space-between; gap: 16px; margin-bottom: 4px;">';
      html += '<span style="color:#e2e8f0;">Current</span>';
      html += `<span style="font-weight: 600; color: #ffffff;">${formatter(current)}</span>`;
      html += '</div>';
      if (previous != null) {
        html += '<div style="display: flex; justify-content: space-between; gap: 16px;">';
        html += '<span style="color:#cbd5e1;">Previous</span>';
        html += `<span style="font-weight: 500; color: #cbd5e1;">${formatter(previous)}</span>`;
        html += '</div>';
        if (deltaStr) {
          const cleanDelta = deltaStr.replace(/^[+-]/, '');
          html += '<div style="display: flex; justify-content: space-between; gap: 16px; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08);">';
          html += '<span style="color:#e2e8f0;">Δ</span>';
          html += `<span style="font-weight: 700; color: ${color};">${arrow} ${cleanDelta}</span>`;
          html += '</div>';
        }
      }
      html += '</div>';
      return html;
    }
  };
}

/**
 * Single-series fallback tooltip when no comparison is present.
 */
export function buildSimpleTooltip({ formatter, labels }) {
  return {
    theme: 'dark',
    x: { formatter: (_v, opts) => labels?.[opts.dataPointIndex] || '' },
    y: { formatter }
  };
}
