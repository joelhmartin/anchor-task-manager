import { nanoid } from 'nanoid';

const M = 32;   // margin
const GAP = 16; // gap between widgets
const PAGE_W = 816;
const CONT_W = PAGE_W - M * 2; // 752

function w(type, x, y, width, height, props = {}) {
  return { id: nanoid(), type, x, y, w: width, h: height, z: 1, props: { filter_override: null, ...props } };
}

function page(widgets) {
  return { id: nanoid(), background_color: '#FFFFFF', widgets };
}

function baseLayout(pages) {
  return {
    version: 1,
    page_size: 'letter_portrait',
    page_dimensions_px: { w: 816, h: 1056 },
    page_margin_px: M,
    page_chrome: {
      header: { enabled: true, height: 48, show_logo: true, show_template_name: true },
      footer: { enabled: true, height: 32, show_page_numbers: true, show_date_range: true },
    },
    pages,
  };
}

// ─── Lead Insights (1 page) ───────────────────────────────────────────────────
// Row of 4 KPI tiles → lead_source_breakdown → lead_activity_table

function buildLeadInsights() {
  const KPI_W = Math.floor((CONT_W - GAP * 3) / 4); // 181
  const kpiY = 80;
  const kpis = [
    w('kpi_tile', M + 0 * (KPI_W + GAP), kpiY, KPI_W, 140, { metric: 'total_leads', label: 'Total Leads', label_auto: true, display: 'number' }),
    w('kpi_tile', M + 1 * (KPI_W + GAP), kpiY, KPI_W, 140, { metric: 'qualified_leads', label: 'Qualified Leads', label_auto: true, display: 'number' }),
    w('kpi_tile', M + 2 * (KPI_W + GAP), kpiY, KPI_W, 140, { metric: 'qualification_rate', label: 'Qual. Rate', label_auto: true, display: 'number' }),
    w('kpi_tile', M + 3 * (KPI_W + GAP), kpiY, KPI_W, 140, { metric: 'total_calls', label: 'Total Calls', label_auto: true, display: 'number' }),
  ];

  const brkY = kpiY + 140 + GAP;
  const actY = brkY + 240 + GAP;

  return baseLayout([page([
    ...kpis,
    w('lead_source_breakdown', M, brkY, CONT_W, 240, { display: 'table', show_qualified_rate: true }),
    w('lead_activity_table',   M, actY, CONT_W, 320),
  ])]);
}

// ─── Quick KPIs (1 page, comparison) ─────────────────────────────────────────
// 3×2 grid of 240×140, sparklines on first two

function buildQuickKPIs() {
  const COL = 240;
  const ROW = 140;
  const xs = [M, M + COL + GAP, M + COL * 2 + GAP * 2]; // 32, 288, 544

  const row1Y = 80;
  const row2Y = row1Y + ROW + GAP;

  return baseLayout([page([
    w('kpi_tile', xs[0], row1Y, COL, ROW, { metric: 'total_leads',         label: 'Total Leads',       label_auto: true, display: 'sparkline' }),
    w('kpi_tile', xs[1], row1Y, COL, ROW, { metric: 'qualified_leads',     label: 'Qualified Leads',   label_auto: true, display: 'sparkline' }),
    w('kpi_tile', xs[2], row1Y, COL, ROW, { metric: 'qualification_rate',  label: 'Qual. Rate',        label_auto: true, display: 'number' }),
    w('kpi_tile', xs[0], row2Y, COL, ROW, { metric: 'total_calls',         label: 'Total Calls',       label_auto: true, display: 'number' }),
    w('kpi_tile', xs[1], row2Y, COL, ROW, { metric: 'total_forms',         label: 'Total Forms',       label_auto: true, display: 'number' }),
    w('kpi_tile', xs[2], row2Y, COL, ROW, { metric: 'cpl',                 label: 'Cost per Lead',     label_auto: true, display: 'number' }),
  ])]);
}

// ─── Full Marketing Report (3 pages) ─────────────────────────────────────────

function buildFullMarketing() {
  const KPI_W = Math.floor((CONT_W - GAP * 3) / 4);

  // Page 1: Executive summary
  const headingH = 64;
  const p1HeadY = 80;
  const p1KpiY  = p1HeadY + headingH + GAP;
  const p1AiY   = p1KpiY  + 140 + GAP;

  const p1Kpis = [
    w('kpi_tile', M + 0*(KPI_W+GAP), p1KpiY, KPI_W, 140, { metric: 'total_leads',        label: 'Total Leads',      label_auto: true, display: 'number' }),
    w('kpi_tile', M + 1*(KPI_W+GAP), p1KpiY, KPI_W, 140, { metric: 'qualification_rate', label: 'Qual. Rate',       label_auto: true, display: 'number' }),
    w('kpi_tile', M + 2*(KPI_W+GAP), p1KpiY, KPI_W, 140, { metric: 'total_spend',        label: 'Total Spend',      label_auto: true, display: 'number' }),
    w('kpi_tile', M + 3*(KPI_W+GAP), p1KpiY, KPI_W, 140, { metric: 'ga4_sessions',       label: 'GA4 Sessions',     label_auto: true, display: 'number' }),
  ];

  const page1 = page([
    w('static_text_block', M, p1HeadY, CONT_W, headingH, { text: 'Executive Summary', variant: 'heading', align: 'left' }),
    ...p1Kpis,
    w('ai_insights_text', M, p1AiY, CONT_W, 280),
  ]);

  // Page 2: Lead performance
  const LEFT_W  = 360;
  const RIGHT_W = CONT_W - LEFT_W - GAP; // 376
  const p2HeadY = 80;
  const p2RowY  = p2HeadY + headingH + GAP;
  const p2UtmY  = p2RowY  + 240 + GAP;

  const page2 = page([
    w('static_text_block',     M,           p2HeadY, CONT_W,  headingH, { text: 'Lead Performance', variant: 'heading', align: 'left' }),
    w('lead_source_breakdown', M,           p2RowY,  LEFT_W,  240, { display: 'bar',  show_qualified_rate: true }),
    w('leads_by_day_table',    M+LEFT_W+GAP, p2RowY, RIGHT_W, 240, { display: 'line', granularity: 'day' }),
    w('utm_sources_table',     M,           p2UtmY,  CONT_W,  240, { display: 'table', limit: 10 }),
  ]);

  // Page 3: Paid advertising
  const p3HeadY  = 80;
  const p3GadsY  = p3HeadY  + headingH + GAP;
  const p3MetaY  = p3GadsY  + 240 + GAP;
  const p3Ga4Y   = p3MetaY  + 240 + GAP;

  const page3 = page([
    w('static_text_block',    M, p3HeadY, CONT_W, headingH, { text: 'Paid Advertising', variant: 'heading', align: 'left' }),
    w('google_ads_campaigns', M, p3GadsY, CONT_W, 240),
    w('meta_campaigns',       M, p3MetaY, CONT_W, 240),
    w('ga4_traffic_summary',  M, p3Ga4Y,  CONT_W, 280, { display: 'donut' }),
  ]);

  const layout = baseLayout([page1, page2, page3]);
  layout.filters_default = { comparison: { enabled: true, mode: 'previous_period' } };
  return layout;
}

// ─── Traffic Deep-dive (1 page) ───────────────────────────────────────────────

function buildTrafficDeepdive() {
  const LEFT_W  = 360;
  const RIGHT_W = CONT_W - LEFT_W - GAP; // 376
  const headingH = 64;

  const headY = 80;
  const kpiY  = headY  + headingH + GAP;
  const ga4Y  = kpiY   + 120 + GAP;
  const rowY  = ga4Y   + 240 + GAP;

  return baseLayout([page([
    w('static_text_block',    M,           headY, CONT_W,  headingH, { text: 'Traffic Overview', variant: 'heading', align: 'left' }),
    w('kpi_tile',             M,           kpiY,  LEFT_W,  120, { metric: 'ga4_sessions', label: 'Sessions',  label_auto: true, display: 'number' }),
    w('kpi_tile',             M+LEFT_W+GAP, kpiY, RIGHT_W, 120, { metric: 'ga4_users',    label: 'Users',     label_auto: true, display: 'number' }),
    w('ga4_traffic_summary',  M,           ga4Y,  CONT_W,  240, { display: 'donut' }),
    w('utm_sources_table',    M,           rowY,  LEFT_W,  240, { display: 'table', limit: 10 }),
    w('leads_by_day_table',   M+LEFT_W+GAP, rowY, RIGHT_W, 240, { display: 'line', granularity: 'day' }),
  ])]);
}

export const STARTER_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start from scratch with an empty canvas.',
    layout: null,
    filters_default: {},
  },
  {
    id: 'lead_insights',
    name: 'Lead Insights',
    description: '1-page overview of lead volume, sources, and activity.',
    layout: buildLeadInsights(),
    filters_default: {},
  },
  {
    id: 'quick_kpis',
    name: 'Quick KPIs',
    description: '3×2 grid of key metrics with sparklines and period comparison.',
    layout: buildQuickKPIs(),
    filters_default: { comparison: { enabled: true, mode: 'previous_period' } },
  },
  {
    id: 'full_marketing',
    name: 'Full Marketing Report',
    description: '3-page report: executive summary, lead performance, and paid advertising.',
    layout: buildFullMarketing(),
    filters_default: { comparison: { enabled: true, mode: 'previous_period' } },
  },
  {
    id: 'traffic_deepdive',
    name: 'Traffic Deep-dive',
    description: '1-page breakdown of sessions, users, traffic sources, and lead trends.',
    layout: buildTrafficDeepdive(),
    filters_default: {},
  },
];
