/**
 * Normalizes a validated AI report blueprint plus dataPackage into the
 * deterministic payload consumed by the React web-report renderer.
 */

import {
  REPORT_OUTPUT_SCHEMA_VERSION,
  resolveDataKey,
  sha256Json
} from './reportProtocol.js';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US');
}

function formatValue(value, format = 'text') {
  if (value == null) return 'N/A';
  const n = Number(value);
  switch (format) {
    case 'currency':
      return isFiniteNumber(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : String(value);
    case 'percent':
      return isFiniteNumber(n) ? `${Number(n.toFixed(1)).toLocaleString('en-US')}%` : String(value);
    case 'integer':
      return isFiniteNumber(n) ? Math.round(n).toLocaleString('en-US') : String(value);
    case 'decimal':
    case 'number':
      return isFiniteNumber(n) ? Number(n.toFixed(2)).toLocaleString('en-US') : String(value);
    case 'rating':
      return isFiniteNumber(n) ? `${Number(n.toFixed(2)).toLocaleString('en-US')} stars` : String(value);
    case 'date':
      return formatDate(value);
    case 'text':
    default:
      return String(value);
  }
}

function inferDirection(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

function normalizeKpiGrid(section, dataPackage, warnings) {
  return {
    type: 'kpi_grid',
    title: section.title || null,
    items: (section.items || []).map((item) => {
      const rawValue = resolveDataKey(dataPackage, item.metric_key);
      const rawDelta = item.delta_key ? resolveDataKey(dataPackage, item.delta_key) : null;
      if (rawValue === undefined) warnings.push(`Missing KPI metric_key: ${item.metric_key}`);
      if (item.delta_key && rawDelta === undefined) warnings.push(`Missing KPI delta_key: ${item.delta_key}`);
      return {
        label: item.label,
        metric_key: item.metric_key,
        value: formatValue(rawValue, item.value_format || 'number'),
        raw_value: rawValue ?? null,
        delta: item.delta_key ? formatValue(rawDelta, item.delta_format || item.value_format || 'number') : null,
        delta_key: item.delta_key || null,
        direction: item.direction || inferDirection(rawDelta)
      };
    })
  };
}

function normalizeChart(section, dataPackage, warnings) {
  const resolved = resolveDataKey(dataPackage, section.data_key);
  const rows = Array.isArray(resolved) ? resolved : [];
  if (!Array.isArray(resolved)) warnings.push(`Chart data_key did not resolve to an array: ${section.data_key}`);

  const series = (section.series || []).map((s) => ({
    key: s.key,
    label: s.label || s.key,
    value_format: s.value_format || 'number'
  }));

  return {
    type: 'chart',
    title: section.title || null,
    chart_type: section.chart_type || 'bar',
    data_key: section.data_key || null,
    x_key: section.x_key || null,
    series,
    data: rows.map((row) => {
      const next = { [section.x_key]: row?.[section.x_key] ?? '' };
      for (const s of series) next[s.key] = row?.[s.key] ?? 0;
      return next;
    }),
    empty_message: section.empty_message || 'No data is available for this section.'
  };
}

function normalizeNarrative(section) {
  return {
    type: 'narrative',
    title: section.title || null,
    markdown: section.markdown || '',
    source_keys: Array.isArray(section.source_keys) ? section.source_keys : []
  };
}

function normalizeTable(section, dataPackage, warnings) {
  const resolved = resolveDataKey(dataPackage, section.data_key);
  const rows = Array.isArray(resolved) ? resolved : [];
  if (!Array.isArray(resolved)) warnings.push(`Table data_key did not resolve to an array: ${section.data_key}`);

  const columns = (section.columns || []).map((c) => ({
    key: c.key,
    label: c.label || c.key,
    format: c.format || 'text'
  }));
  const maxRows = Math.max(1, Math.min(Number(section.max_rows) || 10, 50));

  return {
    type: 'table',
    title: section.title || null,
    data_key: section.data_key || null,
    columns: columns.map((c) => c.label),
    rows: rows.slice(0, maxRows).map((row) => columns.map((c) => formatValue(row?.[c.key], c.format))),
    empty_message: section.empty_message || 'No rows are available for this section.'
  };
}

function normalizeCallout(section) {
  return {
    type: 'callout',
    title: section.title || null,
    tone: section.tone || 'info',
    body: section.body || '',
    source_keys: Array.isArray(section.source_keys) ? section.source_keys : []
  };
}

function normalizeSection(section, dataPackage, warnings) {
  switch (section.type) {
    case 'kpi_grid':
      return normalizeKpiGrid(section, dataPackage, warnings);
    case 'chart':
      return normalizeChart(section, dataPackage, warnings);
    case 'narrative':
      return normalizeNarrative(section);
    case 'table':
      return normalizeTable(section, dataPackage, warnings);
    case 'callout':
      return normalizeCallout(section);
    default:
      warnings.push(`Unknown section type ignored: ${section.type}`);
      return { type: section.type, title: section.title || null };
  }
}

export function buildRenderedPayload({ aiOutput, dataPackage }) {
  const warnings = [];
  const sections = Array.isArray(aiOutput.sections)
    ? aiOutput.sections.map((section) => normalizeSection(section, dataPackage, warnings))
    : [];

  return {
    schema_version: REPORT_OUTPUT_SCHEMA_VERSION,
    title: aiOutput.title,
    summary: aiOutput.summary || '',
    period: dataPackage.period,
    client: dataPackage.client,
    sections,
    validation_warnings: warnings
  };
}

export function computeRenderHash({ templateVersionId, dataPackage, aiOutput }) {
  return sha256Json({
    templateVersionId: templateVersionId || null,
    dataPackage,
    aiOutput
  });
}
