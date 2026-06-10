# AI Web Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the widget-canvas report authoring model with AI-generated, per-client immutable web reports — published into each client's Documents tab as stable links, driven by approved template versions.

**Architecture:** Strangler migration on the existing `feature/report-builder-phase1` branch. New tables (`report_runs`, `report_run_items`, `ai_report_template_versions`) and a new `engine='ai_web'` discriminator on `report_templates` coexist with the legacy widget-canvas system. Server flow: deterministic `dataPackage.js` → `aiWebReportGenerator.js` (Vertex Gemini with `responseSchema`) → JSON validator → normalized `rendered_payload` → snapshot persisted to `report_run_items` → `documents` row inserted with `type='report'` → client portal route renders from snapshot only (never live data).

**Tech Stack:** Existing — Express 4, React 19, MUI 7 (legacy Grid alias), Postgres 15 (UUID + JSONB), Vertex AI Gemini via `server/services/ai.js:generateAiResponse`, existing widget data fetchers under `server/services/reports/widgetDataFetchers/`, existing `documents` table + `DocumentsTab.jsx` rendering.

**Branch:** `feature/ai-reports` (new branch off `main`). The widget-canvas Reports system is live on main; we add the AI engine alongside (strangler migration) and remove only the canvas authoring UI as the final task. Tables, data fetchers, scheduler, and `server/routes/reports.js` are reused.

**Verification:** This codebase has **no automated test suite**. Each task ends with `yarn lint` + `yarn build` (must pass) plus a manual smoke step described inline. See `.claude/skills/verify-without-tests/`.

---

## File Structure

### New backend files
- `server/sql/migrate_ai_web_reports.sql` — additive migration (new tables + columns)
- `server/services/reports/dataPackage.js` — deterministic per-client data builder
- `server/services/reports/aiWebReportGenerator.js` — Vertex call with strict `responseSchema`
- `server/services/reports/webReportRenderer.js` — AI JSON → `rendered_payload` normalizer
- `server/services/reports/aiTemplateStore.js` — CRUD for AI templates + approved versions
- `server/services/reports/aiRunExecutor.js` — orchestrates a single run (fanout per client)
- `server/services/reports/audienceResolver.js` — resolves `audience_filter` → concrete client_ids

### Modified backend files
- `server/index.js` — register new migration in chain
- `server/routes/reports.js` — new endpoints under `/api/reports/ai-templates`, `/runs`, `/run-items`
- `server/services/reports/scheduler.js` — branch on `engine`; route AI templates through new executor

### New frontend files
- `src/api/aiReports.js` — axios client for new endpoints
- `src/views/admin/AdminHub/reports/ai/AiTemplateList.jsx`
- `src/views/admin/AdminHub/reports/ai/AiTemplateEditor.jsx` (the prompt + data-source builder)
- `src/views/admin/AdminHub/reports/ai/AiTestRunPanel.jsx`
- `src/views/admin/AdminHub/reports/ai/AiAudiencePicker.jsx`
- `src/views/admin/AdminHub/reports/ai/AiRunHistory.jsx`
- `src/views/admin/AdminHub/reports/ai/blocks/` — one component per block type (KpiGrid, Chart, Narrative, Table, etc.)
- `src/views/admin/AdminHub/reports/ai/WebReportRenderer.jsx` — renders a `rendered_payload`
- `src/views/portal/PortalReportPage.jsx` — public-ish client-facing report view

### Modified frontend files
- `src/views/admin/AdminHub/reports/ReportsList.jsx` — add "New AI Template" button + AI tab
- `src/views/client/ClientPortal/DocumentsTab.jsx` — `type === 'report'` row variant
- `src/routes/MainRoutes.jsx` (or whichever Router config) — register `/portal/reports/:itemId` and admin AI builder routes
- `docs/API_REFERENCE.md` — append new endpoints

### Removed in Task 16 (final cleanup)
- `src/views/admin/AdminHub/reports/canvas/` and `widgets/` — entire widget canvas authoring UI
- `src/views/admin/AdminHub/reports/{Palette,PropertiesPanel,ReportBuilder,VersionHistoryDrawer,GenerateDialog,ReportViewer,ReportRendererPage}.jsx`
- `server/services/reports/widgetDataFetchers/`, `widgetRegistry.js`, `reportRenderer.js`, `legacyMigration.js`, `internalRenderRoute.js`, `csvRenderer.js`, `generationJob.js`, `pdfRenderer.js`
- Legacy generation endpoints in `server/routes/reports.js` (kept until Task 16)

### Kept untouched
- `server/services/reports/scheduler.js` — extended (Task 13), not replaced
- `server/services/reports/queue.js` — kept (concurrency primitive)
- `server/services/reports/templateStore.js` — kept; AI uses sibling `aiTemplateStore.js`
- `server/services/reports/signedToken.js`, `filterResolver.js` — kept (small utilities; may be useful for future PDF export)
- All `report_*` tables — additive migration only, no drops
- All existing `report_*` migrations under `server/sql/` — DDL is already applied; never delete migration files

---

## Task 0: Branch setup

**Files:** none

- [ ] **Step 1: Branch off main, push for safety**

```bash
git checkout main
git pull --rebase origin main
git checkout -b feature/ai-reports
git push -u origin feature/ai-reports
git status
```

Expected: working tree clean (untracked `.claude/scheduled_tasks.lock` is fine). Branch tracks origin so there's a remote rollback point.

- [ ] **Step 2: Verify baseline build passes**

```bash
yarn install
yarn lint
yarn build
```

Expected: lint exits 0, build emits `dist/` with no errors. If anything is already broken on the branch, stop and fix or report before proceeding.

---

## Task 1: ~~Fix the starter-template text bug~~ — DROPPED

User confirmed this is not a real bug worth chasing. The legacy widget-canvas authoring UI will be removed entirely in Task 16 anyway. Skip directly to Task 2.

---

## Task 2: Database migration — additive schema

**Files:**
- Create: `server/sql/migrate_ai_web_reports.sql`
- Modify: `server/index.js` (append `maybeRunAiWebReportsMigration()` to migration chain)

Migrations in this codebase are **idempotent SQL** (use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) wrapped in a `maybeRunX()` Node helper that runs once per boot. See `.claude/skills/add-migration/`.

- [ ] **Step 1: Write the migration SQL**

Create `server/sql/migrate_ai_web_reports.sql`:

```sql
-- migrate_ai_web_reports.sql — adds AI web-report engine tables.
-- Idempotent: safe to run multiple times.

-- 1) Engine discriminator + AI fields on existing report_templates
ALTER TABLE report_templates
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'widget_canvas',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS prompt TEXT,
  ADD COLUMN IF NOT EXISTS data_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS style_recipe JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_version_id UUID;

-- 2) Approved-version table for AI templates (kept separate from legacy report_template_versions)
CREATE TABLE IF NOT EXISTS ai_report_template_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  data_scope JSONB NOT NULL,
  style_recipe JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  model_name TEXT NOT NULL,
  approved_example_output JSONB,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_template_versions_template
  ON ai_report_template_versions(template_id);

-- FK from report_templates.approved_version_id → ai_report_template_versions.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_templates_approved_version_fk'
  ) THEN
    ALTER TABLE report_templates
      ADD CONSTRAINT report_templates_approved_version_fk
      FOREIGN KEY (approved_version_id) REFERENCES ai_report_template_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3) Run header (one row per "fire the report")
CREATE TABLE IF NOT EXISTS report_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  template_version_id UUID REFERENCES ai_report_template_versions(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('test','manual','scheduled')),
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_client_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','partial','complete','failed','canceled')),
  date_range JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_report_runs_template ON report_runs(template_id);
CREATE INDEX IF NOT EXISTS idx_report_runs_status ON report_runs(status);
CREATE INDEX IF NOT EXISTS idx_report_runs_created ON report_runs(created_at DESC);

-- 4) One row per client per run — the immutable, portal-facing snapshot
CREATE TABLE IF NOT EXISTS report_run_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed')),
  data_snapshot JSONB,
  ai_output JSONB,
  rendered_payload JSONB,
  render_hash TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_report_run_items_run ON report_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_report_run_items_client ON report_run_items(client_id);
CREATE INDEX IF NOT EXISTS idx_report_run_items_status ON report_run_items(status);
```

- [ ] **Step 2: Register the migration in `server/index.js`**

Locate the existing migration chain (search for `maybeRunReportBuilderMigration` or the last `.then(()=>maybeRun…())` before `console.log('migrations complete')`). Add the new function alongside the others (mirror the pattern of an existing one — typically: read the SQL file once, run it inside a single `pool.query`, log start/end).

```javascript
async function maybeRunAiWebReportsMigration() {
  const sql = fs.readFileSync(
    path.join(__dirname, 'sql', 'migrate_ai_web_reports.sql'),
    'utf8'
  );
  console.warn('[migration] ai_web_reports: starting');
  await pool.query(sql);
  console.warn('[migration] ai_web_reports: complete');
}
```

Append to the migration `.then()` chain immediately after `maybeRunReportBuilderMigration()`.

- [ ] **Step 3: Run locally and verify**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null; yarn server &
sleep 5
psql postgresql://bif@localhost:5432/anchor -c "\d report_runs"
psql postgresql://bif@localhost:5432/anchor -c "\d report_run_items"
psql postgresql://bif@localhost:5432/anchor -c "\d ai_report_template_versions"
psql postgresql://bif@localhost:5432/anchor -c "SELECT column_name FROM information_schema.columns WHERE table_name='report_templates' AND column_name IN ('engine','prompt','data_scope','style_recipe','approved_version_id','status');"
```

Expected: all three new tables exist; `report_templates` shows the 6 new columns.

- [ ] **Step 4: Re-run server to confirm idempotence**

Restart `yarn server` once more. Migration must complete with no errors (already-applied DDL is a no-op). Lint + build:

```bash
yarn lint && yarn build
```

- [ ] **Step 5: Commit**

```bash
git add server/sql/migrate_ai_web_reports.sql server/index.js
git commit -m "feat(reports): migration for AI web-report tables (engine, runs, run_items, ai versions)"
```

---

## Task 3: `dataPackage.js` — deterministic per-client data builder

**Files:**
- Create: `server/services/reports/dataPackage.js`

This is the single source of truth for what goes into the AI prompt. It must be **pure**: same inputs ⇒ same JSON output. The AI never fetches data on its own.

- [ ] **Step 1: Write the module**

```javascript
// server/services/reports/dataPackage.js
//
// Builds the deterministic data package for a single client + date range.
// Reuses analytics/widget services that already exist on this branch.
//
// Output shape is stable; bump SCHEMA_VERSION whenever fields are added/removed
// so cached snapshots can be re-rendered against the right contract.

import { pool } from '../../db.js';
import { fetchUnifiedAnalytics } from '../analytics/index.js';

export const SCHEMA_VERSION = 1;

const ALL_SOURCES = [
  'ctm_leads',
  'ga4',
  'google_ads',
  'meta_ads',
  'reviews',
  'tasks'
];

export async function buildDataPackage({ clientId, dateRange, dataScope }) {
  if (!clientId) throw new Error('buildDataPackage: clientId required');
  if (!dateRange?.from || !dateRange?.to) {
    throw new Error('buildDataPackage: dateRange.from and dateRange.to required (YYYY-MM-DD)');
  }
  const include = Array.isArray(dataScope?.include) && dataScope.include.length
    ? dataScope.include.filter((s) => ALL_SOURCES.includes(s))
    : ALL_SOURCES;

  const client = await loadClient(clientId);
  const period = computePeriod(dateRange);

  const unavailable = [];
  const sections = {};

  // Pull unified analytics once; downstream selectors slice it.
  let analytics = null;
  if (
    include.includes('ga4') ||
    include.includes('google_ads') ||
    include.includes('meta_ads') ||
    include.includes('ctm_leads')
  ) {
    try {
      analytics = await fetchUnifiedAnalytics(clientId, period.from, period.to);
    } catch (err) {
      unavailable.push({ source: 'unified_analytics', reason: err.message });
    }
  }

  if (include.includes('ctm_leads')) {
    sections.lead_sources = analytics?.lead_sources ?? [];
    sections.lead_activity = analytics?.lead_activity ?? [];
    sections.kpis = analytics?.kpis ?? {};
  }
  if (include.includes('ga4')) {
    sections.traffic_sources = analytics?.ga4?.traffic_sources ?? [];
    sections.ga4_summary = analytics?.ga4?.summary ?? {};
  }
  if (include.includes('google_ads')) {
    sections.google_ads_campaigns = analytics?.google_ads?.campaigns ?? [];
  }
  if (include.includes('meta_ads')) {
    sections.meta_campaigns = analytics?.meta?.campaigns ?? [];
  }
  if (include.includes('reviews')) {
    sections.reviews = await loadReviews(clientId, period);
  }
  if (include.includes('tasks')) {
    sections.tasks = await loadTaskSummary(clientId, period);
  }

  return {
    schema_version: SCHEMA_VERSION,
    client,
    period,
    sources_included: include,
    ...sections,
    notes: { unavailable_sources: unavailable }
  };
}

async function loadClient(clientId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name,
            cp.client_package, cp.client_type,
            ba.business_name
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       LEFT JOIN brand_assets ba ON ba.user_id = u.id
      WHERE u.id = $1`,
    [clientId]
  );
  if (!rows[0]) throw new Error(`buildDataPackage: client ${clientId} not found`);
  const r = rows[0];
  return {
    id: r.id,
    name: [r.first_name, r.last_name].filter(Boolean).join(' '),
    business_name: r.business_name || null,
    package: r.client_package || null,
    client_type: r.client_type || null
  };
}

function computePeriod({ from, to }) {
  // Comparison window = same length immediately preceding `from`.
  const start = new Date(from);
  const end = new Date(to);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const compEnd = new Date(start.getTime() - 86400000);
  const compStart = new Date(compEnd.getTime() - (days - 1) * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    from,
    to,
    comparison_from: fmt(compStart),
    comparison_to: fmt(compEnd)
  };
}

async function loadReviews(clientId, period) {
  const { rows } = await pool.query(
    `SELECT id, rating, comment, reviewer_name, created_at
       FROM reviews
      WHERE user_id = $1
        AND created_at >= $2
        AND created_at < ($3::date + INTERVAL '1 day')
      ORDER BY created_at DESC
      LIMIT 50`,
    [clientId, period.from, period.to]
  );
  return rows;
}

async function loadTaskSummary(clientId, period) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE ti.status = 'done')                     AS completed,
       COUNT(*) FILTER (WHERE ti.status NOT IN ('done','archived'))   AS open
       FROM task_items ti
       JOIN task_boards tb ON tb.id = ti.board_id
       JOIN task_workspaces tw ON tw.id = tb.workspace_id
      WHERE tw.client_id = $1
        AND ti.updated_at >= $2
        AND ti.updated_at < ($3::date + INTERVAL '1 day')`,
    [clientId, period.from, period.to]
  );
  return rows[0] || { completed: 0, open: 0 };
}
```

- [ ] **Step 2: Verify imports resolve**

```bash
yarn lint
yarn build
```

If `fetchUnifiedAnalytics` lives elsewhere or has a different signature, the executing engineer should grep `server/services/analytics/` to confirm the import path before this task — and update the import without changing the public shape of `buildDataPackage()`.

- [ ] **Step 3: Smoke test from a Node REPL**

```bash
node --experimental-vm-modules -e "
import('./server/services/reports/dataPackage.js').then(async m => {
  const pkg = await m.buildDataPackage({
    clientId: '<paste a real client UUID from \"select id from users where role=\\\"client\\\" limit 1\">',
    dateRange: { from: '2026-04-01', to: '2026-04-30' },
    dataScope: { include: ['ctm_leads','reviews'] }
  });
  console.log(JSON.stringify(pkg, null, 2).slice(0, 2000));
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: a JSON object with `schema_version: 1`, `client`, `period.comparison_from/to`, plus the included sections. No throw.

- [ ] **Step 4: Commit**

```bash
git add server/services/reports/dataPackage.js
git commit -m "feat(reports): deterministic dataPackage builder for AI web reports"
```

---

## Task 4: `aiWebReportGenerator.js` — Vertex with strict JSON

**Files:**
- Create: `server/services/reports/aiWebReportGenerator.js`

The generator uses Vertex's `responseSchema` to force structured output. No free-form HTML.

- [ ] **Step 1: Write the module**

```javascript
// server/services/reports/aiWebReportGenerator.js
import { generateAiResponse } from '../ai.js';

export const REPORT_OUTPUT_SCHEMA_VERSION = 1;

// JSON Schema enforced via Vertex responseSchema. Keep this conservative —
// every block type listed here must have a renderer in WebReportRenderer.jsx.
export const REPORT_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['title', 'sections'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            enum: ['kpi_grid', 'chart', 'narrative', 'table', 'callout']
          },
          title: { type: 'string' },
          // kpi_grid
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                delta: { type: 'string' },
                direction: { type: 'string', enum: ['up', 'down', 'flat'] }
              }
            }
          },
          // chart
          chart_type: { type: 'string', enum: ['bar', 'line', 'donut', 'area'] },
          data_key: { type: 'string' },
          // narrative
          markdown: { type: 'string' },
          // table
          columns: { type: 'array', items: { type: 'string' } },
          rows: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' } }
          },
          // callout
          tone: { type: 'string', enum: ['info', 'success', 'warning'] },
          body: { type: 'string' }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = `You are a marketing analyst writing a monthly executive report for a single client.
You will be given:
  1. A plain-language brief written by the agency admin.
  2. A frozen JSON data package — every fact in the report MUST come from this package.
  3. A style recipe describing tone and chart preferences.
You MUST respond with JSON matching the provided schema. Do not invent metrics that
are not present in the data. If a section the brief asks for has no data, say so
in a short callout. Use markdown for narrative blocks; do not include HTML.`;

export async function generateAiWebReport({ prompt, dataPackage, styleRecipe, modelName }) {
  if (!prompt) throw new Error('generateAiWebReport: prompt required');
  if (!dataPackage) throw new Error('generateAiWebReport: dataPackage required');

  const userPrompt = [
    'BRIEF FROM ADMIN:',
    prompt,
    '',
    'STYLE RECIPE:',
    JSON.stringify(styleRecipe || {}, null, 2),
    '',
    'DATA PACKAGE (the only facts you may cite):',
    JSON.stringify(dataPackage, null, 2)
  ].join('\n');

  const raw = await generateAiResponse({
    prompt: userPrompt,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 4000,
    model: modelName || undefined,
    responseMimeType: 'application/json',
    responseSchema: REPORT_OUTPUT_SCHEMA
  });

  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    throw new ReportGenerationError(
      'AI returned non-JSON output',
      { raw }
    );
  }

  validateReportOutput(parsed);
  return parsed;
}

export class ReportGenerationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ReportGenerationError';
    this.details = details;
  }
}

const ALLOWED_BLOCK_TYPES = new Set(['kpi_grid', 'chart', 'narrative', 'table', 'callout']);

export function validateReportOutput(output) {
  if (!output || typeof output !== 'object') {
    throw new ReportGenerationError('Output not an object');
  }
  if (typeof output.title !== 'string' || !output.title.trim()) {
    throw new ReportGenerationError('Missing title');
  }
  if (!Array.isArray(output.sections) || output.sections.length === 0) {
    throw new ReportGenerationError('sections must be a non-empty array');
  }
  output.sections.forEach((s, i) => {
    if (!ALLOWED_BLOCK_TYPES.has(s.type)) {
      throw new ReportGenerationError(`section[${i}] has unknown type "${s.type}"`);
    }
    if (s.type === 'chart' && !s.chart_type) {
      throw new ReportGenerationError(`section[${i}] chart missing chart_type`);
    }
  });
  return true;
}
```

- [ ] **Step 2: Verify build**

```bash
yarn lint && yarn build
```

- [ ] **Step 3: Smoke test against a real client (manual)**

```bash
node --experimental-vm-modules -e "
import('./server/services/reports/dataPackage.js').then(async (dp) => {
  const gen = await import('./server/services/reports/aiWebReportGenerator.js');
  const pkg = await dp.buildDataPackage({
    clientId: '<real client UUID>',
    dateRange: { from: '2026-04-01', to: '2026-04-30' },
    dataScope: { include: ['ctm_leads','ga4','google_ads','meta_ads'] }
  });
  const out = await gen.generateAiWebReport({
    prompt: 'Write a 1-page exec summary covering lead volume, top sources, and ad spend efficiency.',
    dataPackage: pkg,
    styleRecipe: { tone: 'executive', charts: ['kpi_grid','bar','line'] }
  });
  console.log(JSON.stringify(out, null, 2));
});
"
```

Expected: valid JSON with `title`, `sections[]`, no thrown error. If Vertex returns malformed output, the validator throws — that's the correct behavior; do not loosen the validator to make a one-off run pass.

- [ ] **Step 4: Commit**

```bash
git add server/services/reports/aiWebReportGenerator.js
git commit -m "feat(reports): AI web report generator with strict JSON schema"
```

---

## Task 5: `webReportRenderer.js` — payload normalizer + render hash

**Files:**
- Create: `server/services/reports/webReportRenderer.js`

This converts the AI's `ai_output` into the `rendered_payload` shape the React renderer consumes. Keeping the normalization server-side means the React layer never has to defensively reshape.

- [ ] **Step 1: Write the module**

```javascript
// server/services/reports/webReportRenderer.js
import { createHash } from 'node:crypto';
import { REPORT_OUTPUT_SCHEMA_VERSION } from './aiWebReportGenerator.js';

export function buildRenderedPayload({ aiOutput, dataPackage }) {
  const sections = aiOutput.sections.map((s) => normalizeSection(s, dataPackage));
  return {
    schema_version: REPORT_OUTPUT_SCHEMA_VERSION,
    title: aiOutput.title,
    summary: aiOutput.summary || '',
    period: dataPackage.period,
    client: dataPackage.client,
    sections
  };
}

function normalizeSection(s, dataPackage) {
  const base = { type: s.type, title: s.title || null };
  switch (s.type) {
    case 'kpi_grid':
      return { ...base, items: Array.isArray(s.items) ? s.items : [] };
    case 'chart': {
      const data = s.data_key ? resolveDataKey(dataPackage, s.data_key) : null;
      return { ...base, chart_type: s.chart_type, data_key: s.data_key, data };
    }
    case 'narrative':
      return { ...base, markdown: s.markdown || '' };
    case 'table': {
      // If the AI provided rows directly, use them. Otherwise resolve from data_key.
      if (Array.isArray(s.rows) && Array.isArray(s.columns)) {
        return { ...base, columns: s.columns, rows: s.rows };
      }
      const data = s.data_key ? resolveDataKey(dataPackage, s.data_key) : [];
      return { ...base, columns: s.columns || [], rows: arrayToRows(data, s.columns) };
    }
    case 'callout':
      return { ...base, tone: s.tone || 'info', body: s.body || '' };
    default:
      return base;
  }
}

function resolveDataKey(pkg, key) {
  // Supports dot paths like "campaigns.google_ads"
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), pkg);
}

function arrayToRows(arr, columns) {
  if (!Array.isArray(arr) || !Array.isArray(columns)) return [];
  return arr.map((row) =>
    columns.map((c) => (row && row[c] != null ? String(row[c]) : ''))
  );
}

export function computeRenderHash({ templateVersionId, dataPackage, aiOutput }) {
  const h = createHash('sha256');
  h.update(String(templateVersionId || 'no-version'));
  h.update('\n');
  h.update(JSON.stringify(dataPackage));
  h.update('\n');
  h.update(JSON.stringify(aiOutput));
  return h.digest('hex');
}
```

- [ ] **Step 2: Verify**

```bash
yarn lint && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/webReportRenderer.js
git commit -m "feat(reports): rendered_payload normalizer + render hash"
```

---

## Task 6: `aiTemplateStore.js` + `aiRunExecutor.js` + `audienceResolver.js`

**Files:**
- Create: `server/services/reports/aiTemplateStore.js`
- Create: `server/services/reports/audienceResolver.js`
- Create: `server/services/reports/aiRunExecutor.js`

- [ ] **Step 1: Write `aiTemplateStore.js`**

```javascript
// server/services/reports/aiTemplateStore.js
import { pool } from '../../db.js';

export async function listAiTemplates({ includeArchived = false } = {}) {
  const where = ["engine = 'ai_web'"];
  if (!includeArchived) where.push('is_archived = false');
  const { rows } = await pool.query(
    `SELECT id, name, description, status, prompt, data_scope, style_recipe,
            approved_version_id, schedule, next_run_at, default_client_id,
            created_at, updated_at
       FROM report_templates
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC`
  );
  return rows;
}

export async function getAiTemplate(id) {
  const { rows } = await pool.query(
    `SELECT * FROM report_templates WHERE id = $1 AND engine = 'ai_web'`,
    [id]
  );
  return rows[0] || null;
}

export async function createAiTemplate({ name, description, prompt, dataScope, styleRecipe, defaultClientId, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO report_templates
      (engine, name, description, layout, filters_default, prompt, data_scope, style_recipe,
       default_client_id, status, created_by)
     VALUES ('ai_web', $1, $2, '[]'::jsonb, '{}'::jsonb, $3, $4, $5, $6, 'draft', $7)
     RETURNING *`,
    [name, description || null, prompt || '', dataScope || {}, styleRecipe || {}, defaultClientId || null, createdBy]
  );
  return rows[0];
}

export async function updateAiTemplate(id, patch) {
  const fields = [];
  const params = [];
  let i = 1;
  for (const [col, val] of Object.entries({
    name: patch.name,
    description: patch.description,
    prompt: patch.prompt,
    data_scope: patch.dataScope,
    style_recipe: patch.styleRecipe,
    default_client_id: patch.defaultClientId,
    schedule: patch.schedule
  })) {
    if (val !== undefined) {
      fields.push(`${col} = $${i++}`);
      params.push(val);
    }
  }
  if (!fields.length) return getAiTemplate(id);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE report_templates SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${i} AND engine = 'ai_web' RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function approveTemplateVersion({ templateId, modelName, approvedExampleOutput, approvedBy }) {
  const tpl = await getAiTemplate(templateId);
  if (!tpl) throw new Error('Template not found');
  const { rows: versionRows } = await pool.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM ai_report_template_versions WHERE template_id = $1`,
    [templateId]
  );
  const nextVersion = versionRows[0].next_version;
  const { rows } = await pool.query(
    `INSERT INTO ai_report_template_versions
      (template_id, version, prompt, data_scope, style_recipe, model_name,
       approved_example_output, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [templateId, nextVersion, tpl.prompt, tpl.data_scope, tpl.style_recipe,
     modelName || 'gemini-2.5-flash', approvedExampleOutput || null, approvedBy]
  );
  await pool.query(
    `UPDATE report_templates SET approved_version_id = $1, status = 'approved', updated_at = NOW()
      WHERE id = $2`,
    [rows[0].id, templateId]
  );
  return rows[0];
}

export async function getApprovedVersion(versionId) {
  const { rows } = await pool.query(
    `SELECT * FROM ai_report_template_versions WHERE id = $1`,
    [versionId]
  );
  return rows[0] || null;
}
```

- [ ] **Step 2: Write `audienceResolver.js`**

```javascript
// server/services/reports/audienceResolver.js
import { pool } from '../../db.js';

// audienceFilter shapes:
//   { mode: 'all' }
//   { mode: 'package', client_package: 'Growth Essentials', include_inactive: false }
//   { mode: 'manual', client_ids: ['uuid', ...] }
export async function resolveAudience(audienceFilter) {
  const f = audienceFilter || { mode: 'all' };
  if (f.mode === 'manual') {
    return Array.from(new Set(f.client_ids || []));
  }
  const where = [`u.role = 'client'`];
  const params = [];
  if (!f.include_inactive) where.push(`u.is_demo = false OR u.is_demo IS NULL`);
  if (f.mode === 'package') {
    params.push(f.client_package);
    where.push(`cp.client_package = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT u.id
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
      WHERE ${where.join(' AND ')}`,
    params
  );
  return rows.map((r) => r.id);
}
```

- [ ] **Step 3: Write `aiRunExecutor.js`**

```javascript
// server/services/reports/aiRunExecutor.js
import { pool } from '../../db.js';
import { buildDataPackage } from './dataPackage.js';
import { generateAiWebReport } from './aiWebReportGenerator.js';
import { buildRenderedPayload, computeRenderHash } from './webReportRenderer.js';
import { getApprovedVersion } from './aiTemplateStore.js';
import { resolveAudience } from './audienceResolver.js';

// Concurrency cap matches the existing pdfRenderer queue's default of 2.
const PER_RUN_CONCURRENCY = 2;

export async function startRun({ templateId, source, audienceFilter, dateRange, createdBy, testClientId }) {
  let templateVersionId = null;
  let prompt;
  let dataScope;
  let styleRecipe;
  let modelName;

  if (source === 'test') {
    // Test runs use the draft (live) template, not an approved version.
    const { rows } = await pool.query(
      `SELECT prompt, data_scope, style_recipe FROM report_templates WHERE id = $1 AND engine = 'ai_web'`,
      [templateId]
    );
    if (!rows[0]) throw new Error('Template not found');
    prompt = rows[0].prompt;
    dataScope = rows[0].data_scope;
    styleRecipe = rows[0].style_recipe;
    modelName = 'gemini-2.5-flash';
  } else {
    const { rows } = await pool.query(
      `SELECT approved_version_id FROM report_templates WHERE id = $1`,
      [templateId]
    );
    const approvedId = rows[0]?.approved_version_id;
    if (!approvedId) throw new Error('Template has no approved version; cannot run');
    const v = await getApprovedVersion(approvedId);
    templateVersionId = v.id;
    prompt = v.prompt;
    dataScope = v.data_scope;
    styleRecipe = v.style_recipe;
    modelName = v.model_name;
  }

  const clientIds = source === 'test'
    ? [testClientId]
    : await resolveAudience(audienceFilter);

  if (!clientIds.length) throw new Error('Audience resolved to zero clients');

  const { rows: runRows } = await pool.query(
    `INSERT INTO report_runs
      (template_id, template_version_id, source, audience_filter,
       selected_client_ids, status, date_range, created_by)
     VALUES ($1, $2, $3, $4, $5, 'running', $6, $7)
     RETURNING *`,
    [templateId, templateVersionId, source, audienceFilter || {},
     clientIds, dateRange || {}, createdBy]
  );
  const run = runRows[0];

  // Insert run_items eagerly so the UI can poll status.
  for (const cid of clientIds) {
    await pool.query(
      `INSERT INTO report_run_items (run_id, client_id, status) VALUES ($1, $2, 'pending')
       ON CONFLICT DO NOTHING`,
      [run.id, cid]
    );
  }

  // Fire and forget. Caller polls /runs/:id.
  processRun(run, { prompt, dataScope, styleRecipe, modelName, dateRange })
    .catch((err) => console.error('[aiRunExecutor] run failed:', run.id, err.message));

  return run;
}

async function processRun(run, ctx) {
  let pending = run.selected_client_ids.slice();
  let inFlight = 0;
  let anyFailed = false;

  await new Promise((resolve) => {
    const tick = () => {
      while (inFlight < PER_RUN_CONCURRENCY && pending.length) {
        const clientId = pending.shift();
        inFlight++;
        processItem(run, clientId, ctx)
          .catch(() => { anyFailed = true; })
          .finally(() => {
            inFlight--;
            if (!pending.length && inFlight === 0) resolve();
            else tick();
          });
      }
    };
    tick();
  });

  const finalStatus = anyFailed ? 'partial' : 'complete';
  await pool.query(
    `UPDATE report_runs SET status = $1, completed_at = NOW() WHERE id = $2`,
    [finalStatus, run.id]
  );
}

async function processItem(run, clientId, ctx) {
  await pool.query(
    `UPDATE report_run_items SET status = 'running' WHERE run_id = $1 AND client_id = $2`,
    [run.id, clientId]
  );
  try {
    const dataPackage = await buildDataPackage({
      clientId,
      dateRange: ctx.dateRange,
      dataScope: ctx.dataScope
    });
    const aiOutput = await generateAiWebReport({
      prompt: ctx.prompt,
      dataPackage,
      styleRecipe: ctx.styleRecipe,
      modelName: ctx.modelName
    });
    const renderedPayload = buildRenderedPayload({ aiOutput, dataPackage });
    const renderHash = computeRenderHash({
      templateVersionId: run.template_version_id,
      dataPackage,
      aiOutput
    });

    await pool.query(
      `UPDATE report_run_items
          SET status = 'complete',
              data_snapshot = $1,
              ai_output = $2,
              rendered_payload = $3,
              render_hash = $4
        WHERE run_id = $5 AND client_id = $6`,
      [dataPackage, aiOutput, renderedPayload, renderHash, run.id, clientId]
    );
  } catch (err) {
    await pool.query(
      `UPDATE report_run_items SET status = 'failed', error_message = $1
        WHERE run_id = $2 AND client_id = $3`,
      [String(err.message || err).slice(0, 1000), run.id, clientId]
    );
    throw err;
  }
}
```

- [ ] **Step 4: Verify**

```bash
yarn lint && yarn build
```

- [ ] **Step 5: Commit**

```bash
git add server/services/reports/aiTemplateStore.js \
        server/services/reports/audienceResolver.js \
        server/services/reports/aiRunExecutor.js
git commit -m "feat(reports): AI template store, audience resolver, run executor"
```

---

## Task 7: API endpoints in `server/routes/reports.js`

**Files:**
- Modify: `server/routes/reports.js`

Add new endpoints. **Do not remove or alter existing endpoints** — the legacy widget canvas keeps working.

- [ ] **Step 1: Read the existing file's top so the new code matches its style**

```bash
sed -n '1,40p' server/routes/reports.js
```

You're looking for the existing `import` block, the `requireAuth, isStaff` middleware usage, and the helper for `req.user.id`.

- [ ] **Step 2: Add imports + new routes**

Append to the top imports:

```javascript
import {
  listAiTemplates, getAiTemplate, createAiTemplate, updateAiTemplate,
  approveTemplateVersion
} from '../services/reports/aiTemplateStore.js';
import { startRun } from '../services/reports/aiRunExecutor.js';
import { pool } from '../db.js';
```

Add the following endpoints (place after the existing `/templates` routes block):

```javascript
// ---- AI web-report templates ----

router.get('/ai-templates', requireAuth, isStaff, async (req, res) => {
  const rows = await listAiTemplates({ includeArchived: req.query.archived === '1' });
  res.json({ templates: rows });
});

router.get('/ai-templates/:id', requireAuth, isStaff, async (req, res) => {
  const tpl = await getAiTemplate(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'not found' });
  res.json({ template: tpl });
});

router.post('/ai-templates', requireAuth, isStaff, async (req, res) => {
  const { name, description, prompt, dataScope, styleRecipe, defaultClientId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const tpl = await createAiTemplate({
    name, description, prompt, dataScope, styleRecipe, defaultClientId,
    createdBy: req.user.id
  });
  res.status(201).json({ template: tpl });
});

router.patch('/ai-templates/:id', requireAuth, isStaff, async (req, res) => {
  const tpl = await updateAiTemplate(req.params.id, req.body || {});
  if (!tpl) return res.status(404).json({ error: 'not found' });
  res.json({ template: tpl });
});

router.post('/ai-templates/:id/test-run', requireAuth, isStaff, async (req, res) => {
  const { clientId, dateRange } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  if (!dateRange?.from || !dateRange?.to) {
    return res.status(400).json({ error: 'dateRange.from/to required (YYYY-MM-DD)' });
  }
  try {
    const run = await startRun({
      templateId: req.params.id,
      source: 'test',
      testClientId: clientId,
      dateRange,
      createdBy: req.user.id
    });
    res.status(202).json({ run });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/ai-templates/:id/approve', requireAuth, isStaff, async (req, res) => {
  try {
    const v = await approveTemplateVersion({
      templateId: req.params.id,
      modelName: req.body?.modelName,
      approvedExampleOutput: req.body?.approvedExampleOutput,
      approvedBy: req.user.id
    });
    res.json({ version: v });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Runs ----

router.post('/runs', requireAuth, isStaff, async (req, res) => {
  const { templateId, audienceFilter, dateRange } = req.body || {};
  if (!templateId) return res.status(400).json({ error: 'templateId required' });
  try {
    const run = await startRun({
      templateId,
      source: 'manual',
      audienceFilter: audienceFilter || { mode: 'all' },
      dateRange,
      createdBy: req.user.id
    });
    res.status(202).json({ run });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/runs/:id', requireAuth, isStaff, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM report_runs WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const { rows: items } = await pool.query(
    `SELECT id, client_id, status, error_message, document_id, published_at
       FROM report_run_items WHERE run_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.json({ run: rows[0], items });
});

router.get('/run-items/:id', requireAuth, isStaff, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM report_run_items WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ item: rows[0] });
});

router.get('/client/:clientId/items', requireAuth, isStaff, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, run_id, status, published_at, document_id
       FROM report_run_items
      WHERE client_id = $1
        AND status = 'complete'
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT 100`,
    [req.params.clientId]
  );
  res.json({ items: rows });
});
```

- [ ] **Step 3: Lint + build**

```bash
yarn lint && yarn build
```

- [ ] **Step 4: Smoke test endpoints with curl**

```bash
# Log in via browser first; copy your session cookie or auth token.
# Replace <COOKIE> below with your actual auth cookie value.
TOKEN='<COOKIE>'

curl -s -H "Cookie: $TOKEN" http://localhost:4000/api/reports/ai-templates | head -c 200
curl -s -H "Cookie: $TOKEN" -H 'Content-Type: application/json' \
  -X POST http://localhost:4000/api/reports/ai-templates \
  -d '{"name":"Test AI Template","prompt":"Write a one-paragraph summary."}' | head -c 400
```

Expected: 200 with `{templates: []}` then 201 with the new template row.

- [ ] **Step 5: Commit**

```bash
git add server/routes/reports.js
git commit -m "feat(reports): API endpoints for AI templates, test runs, runs, run-items"
```

---

## Task 8: Documents-tab integration when a run item completes

**Files:**
- Modify: `server/services/reports/aiRunExecutor.js`

When an item finishes successfully, insert a `documents` row pointing at `/portal/reports/<itemId>`. This is the only piece of the brief that touches an existing user-visible surface.

- [ ] **Step 1: Add a `publishItem()` helper in `aiRunExecutor.js` and call it from the success branch of `processItem`**

```javascript
async function publishItem(runItemId, clientId, payload, createdBy) {
  const title = payload?.title || 'Report';
  const url = `/portal/reports/${runItemId}`;
  const { rows } = await pool.query(
    `INSERT INTO documents (user_id, label, name, url, origin, type, review_status, created_by)
     VALUES ($1, $2, $2, $3, 'admin', 'report', 'none', $4)
     RETURNING id`,
    [clientId, title, url, createdBy]
  );
  await pool.query(
    `UPDATE report_run_items SET document_id = $1, published_at = NOW() WHERE id = $2`,
    [rows[0].id, runItemId]
  );
}
```

In `processItem`, immediately after the successful `UPDATE report_run_items SET status='complete'`, fetch the inserted item id and call publishItem **only when the run is not a test run**:

```javascript
if (run.source !== 'test') {
  const { rows: idRows } = await pool.query(
    `SELECT id, rendered_payload FROM report_run_items WHERE run_id = $1 AND client_id = $2`,
    [run.id, clientId]
  );
  if (idRows[0]) {
    await publishItem(idRows[0].id, clientId, idRows[0].rendered_payload, run.created_by);
  }
}
```

Pass `created_by` through from `run` (already on the row).

- [ ] **Step 2: Update `DocumentsTab.jsx` — featured-latest report + archive table**

Per user requirement: when a client has multiple AI reports, the latest is featured at the top of the Documents tab as a prominent card; older runs of the *same* report appear below in a collapsed archive table. Reports from *different* templates each get their own featured card.

Add a new section to `src/views/client/ClientPortal/DocumentsTab.jsx`:

```jsx
import { Link } from 'react-router-dom';
import {
  Card, CardContent, CardActionArea, Stack, Typography, Box, Chip,
  Accordion, AccordionSummary, AccordionDetails, Table, TableBody, TableRow, TableCell
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AssessmentIcon from '@mui/icons-material/Assessment';

// Group documents where type === 'report' by their template_id.
// We don't currently store template_id on documents, so group by label
// (one template = one consistent report title). This is good enough for v1.
function groupReports(docs) {
  const reports = docs.filter((d) => d.type === 'report');
  const byKey = new Map();
  for (const d of reports) {
    const key = d.label || d.name || d.id;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(d);
  }
  // Within each group, newest first.
  for (const arr of byKey.values()) {
    arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return [...byKey.entries()].map(([key, items]) => ({
    key,
    latest: items[0],
    archive: items.slice(1)
  }));
}

function ReportCard({ group }) {
  const { latest, archive } = group;
  return (
    <Card sx={{ mb: 2 }}>
      <CardActionArea component={Link} to={latest.url}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <AssessmentIcon color="primary" />
            <Box flex={1}>
              <Typography variant="h6">{latest.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                Generated {new Date(latest.created_at).toLocaleDateString()}
              </Typography>
            </Box>
            <Chip label="Latest" color="primary" size="small" />
          </Stack>
        </CardContent>
      </CardActionArea>
      {archive.length > 0 && (
        <Accordion disableGutters elevation={0} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" color="text.secondary">
              {archive.length} earlier {archive.length === 1 ? 'run' : 'runs'}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Table size="small">
              <TableBody>
                {archive.map((d) => (
                  <TableRow key={d.id} hover component={Link} to={d.url}
                    sx={{ textDecoration: 'none', cursor: 'pointer' }}>
                    <TableCell>{new Date(d.created_at).toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <Typography variant="caption" color="primary">View</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>
      )}
    </Card>
  );
}
```

Render the groups above the existing documents list:

```jsx
const reportGroups = useMemo(() => groupReports(documents || []), [documents]);
const nonReportDocs = useMemo(() => (documents || []).filter((d) => d.type !== 'report'), [documents]);

return (
  <Box>
    {reportGroups.length > 0 && (
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom>Reports</Typography>
        {reportGroups.map((g) => <ReportCard key={g.key} group={g} />)}
      </Box>
    )}
    {/* existing rendering loop, but iterate over nonReportDocs instead of documents */}
  </Box>
);
```

**Important:** find every place in the existing component that maps over `documents` and switch it to `nonReportDocs` so report rows don't appear twice.

- [ ] **Step 3: Verify**

```bash
yarn lint && yarn build
```

Manual smoke (after Task 9 lands the renderer): trigger a manual run for one client, confirm a documents row appears in the client's Documents tab with label = AI report title and a "View Report" button.

- [ ] **Step 4: Commit**

```bash
git add server/services/reports/aiRunExecutor.js src/views/client/ClientPortal/DocumentsTab.jsx
git commit -m "feat(reports): publish AI run items to client Documents tab"
```

---

## Task 9: React renderer for `rendered_payload`

**Files:**
- Create: `src/views/admin/AdminHub/reports/ai/blocks/KpiGrid.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/blocks/ChartBlock.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/blocks/Narrative.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/blocks/TableBlock.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/blocks/Callout.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/WebReportRenderer.jsx`
- Create: `src/api/aiReports.js`

The renderer ONLY consumes `rendered_payload`. It never fetches live data.

- [ ] **Step 1: Write `src/api/aiReports.js`**

```javascript
import axios from 'axios';

export const listAiTemplates = () =>
  axios.get('/api/reports/ai-templates').then((r) => r.data.templates);

export const getAiTemplate = (id) =>
  axios.get(`/api/reports/ai-templates/${id}`).then((r) => r.data.template);

export const createAiTemplate = (body) =>
  axios.post('/api/reports/ai-templates', body).then((r) => r.data.template);

export const updateAiTemplate = (id, body) =>
  axios.patch(`/api/reports/ai-templates/${id}`, body).then((r) => r.data.template);

export const testRunAiTemplate = (id, body) =>
  axios.post(`/api/reports/ai-templates/${id}/test-run`, body).then((r) => r.data.run);

export const approveAiTemplate = (id, body) =>
  axios.post(`/api/reports/ai-templates/${id}/approve`, body).then((r) => r.data.version);

export const startRun = (body) =>
  axios.post('/api/reports/runs', body).then((r) => r.data.run);

export const getRun = (id) =>
  axios.get(`/api/reports/runs/${id}`).then((r) => r.data);

export const getRunItem = (id) =>
  axios.get(`/api/reports/run-items/${id}`).then((r) => r.data.item);

export const listClientReports = (clientId) =>
  axios.get(`/api/reports/client/${clientId}/items`).then((r) => r.data.items);
```

- [ ] **Step 2: Write the block components**

Each block is a thin presentational component. Use MUI primitives that already appear elsewhere in the codebase. Use `recharts` (already a dep — confirm via `grep recharts package.json`) for charts.

`KpiGrid.jsx`:

```jsx
import { Grid, Card, Typography, Stack } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';

const dirIcon = { up: TrendingUpIcon, down: TrendingDownIcon, flat: TrendingFlatIcon };

export default function KpiGrid({ items = [] }) {
  return (
    <Grid container spacing={2}>
      {items.map((it, i) => {
        const Icon = dirIcon[it.direction] || TrendingFlatIcon;
        return (
          <Grid item xs={12} sm={6} md={3} key={i}>
            <Card sx={{ p: 2 }}>
              <Typography variant="caption" color="text.secondary">{it.label}</Typography>
              <Typography variant="h4" sx={{ mt: 0.5 }}>{it.value}</Typography>
              {it.delta && (
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                  <Icon fontSize="small" />
                  <Typography variant="body2">{it.delta}</Typography>
                </Stack>
              )}
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}
```

`ChartBlock.jsx`:

```jsx
import { Box, Typography } from '@mui/material';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend
} from 'recharts';

const PALETTE = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f'];

export default function ChartBlock({ title, chart_type, data }) {
  const series = Array.isArray(data) ? data : [];
  if (!series.length) {
    return <Typography color="text.secondary">No data for {title || 'chart'}.</Typography>;
  }
  const xKey = inferXKey(series[0]);
  const yKey = inferYKey(series[0], xKey);

  return (
    <Box sx={{ mt: 2 }}>
      {title && <Typography variant="h6" gutterBottom>{title}</Typography>}
      <Box sx={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart_type === 'donut' ? (
            <PieChart>
              <Pie data={series} dataKey={yKey} nameKey={xKey} innerRadius={60} outerRadius={110}>
                {series.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip /><Legend />
            </PieChart>
          ) : chart_type === 'line' ? (
            <LineChart data={series}>
              <XAxis dataKey={xKey} /><YAxis /><Tooltip /><Legend />
              <Line type="monotone" dataKey={yKey} stroke={PALETTE[0]} />
            </LineChart>
          ) : chart_type === 'area' ? (
            <AreaChart data={series}>
              <XAxis dataKey={xKey} /><YAxis /><Tooltip /><Legend />
              <Area type="monotone" dataKey={yKey} fill={PALETTE[0]} stroke={PALETTE[0]} />
            </AreaChart>
          ) : (
            <BarChart data={series}>
              <XAxis dataKey={xKey} /><YAxis /><Tooltip /><Legend />
              <Bar dataKey={yKey} fill={PALETTE[0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}

function inferXKey(row) {
  return Object.keys(row).find((k) => typeof row[k] === 'string') || Object.keys(row)[0];
}
function inferYKey(row, xKey) {
  return Object.keys(row).find((k) => k !== xKey && typeof row[k] === 'number')
    || Object.keys(row).find((k) => k !== xKey)
    || 'value';
}
```

`Narrative.jsx`:

```jsx
import { Typography, Box } from '@mui/material';

// Tiny markdown subset (paragraphs, **bold**, *italic*, single-line bullets).
// Enough for AI narrative blocks; no need to pull a full markdown lib.
function renderMarkdown(md) {
  const lines = (md || '').split(/\n+/);
  return lines.map((line, i) => {
    if (line.startsWith('- ')) {
      return <Typography key={i} component="li" sx={{ ml: 2 }}>{inline(line.slice(2))}</Typography>;
    }
    return <Typography key={i} paragraph>{inline(line)}</Typography>;
  });
}
function inline(s) {
  const parts = [];
  let rest = s;
  while (rest.length) {
    const m = rest.match(/\*\*(.+?)\*\*|\*(.+?)\*/);
    if (!m) { parts.push(rest); break; }
    parts.push(rest.slice(0, m.index));
    parts.push(m[1] ? <strong key={parts.length}>{m[1]}</strong> : <em key={parts.length}>{m[2]}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return parts;
}
export default function Narrative({ markdown }) {
  return <Box sx={{ mt: 2 }}>{renderMarkdown(markdown)}</Box>;
}
```

`TableBlock.jsx`:

```jsx
import { Table, TableHead, TableBody, TableRow, TableCell, Typography, Box } from '@mui/material';

export default function TableBlock({ title, columns = [], rows = [] }) {
  return (
    <Box sx={{ mt: 2 }}>
      {title && <Typography variant="h6" gutterBottom>{title}</Typography>}
      <Table size="small">
        <TableHead>
          <TableRow>{columns.map((c) => <TableCell key={c}>{c}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>{r.map((cell, j) => <TableCell key={j}>{cell}</TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
```

`Callout.jsx`:

```jsx
import { Alert } from '@mui/material';

export default function Callout({ tone = 'info', title, body }) {
  return (
    <Alert severity={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'info'} sx={{ mt: 2 }}>
      {title && <strong>{title}: </strong>}{body}
    </Alert>
  );
}
```

`WebReportRenderer.jsx`:

```jsx
import { Box, Typography, Divider } from '@mui/material';
import KpiGrid from './blocks/KpiGrid';
import ChartBlock from './blocks/ChartBlock';
import Narrative from './blocks/Narrative';
import TableBlock from './blocks/TableBlock';
import Callout from './blocks/Callout';

export default function WebReportRenderer({ payload }) {
  if (!payload) return null;
  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto', p: 3 }}>
      <Typography variant="h3" gutterBottom>{payload.title}</Typography>
      {payload.client?.business_name && (
        <Typography variant="subtitle1" color="text.secondary">
          {payload.client.business_name} · {payload.period?.from} → {payload.period?.to}
        </Typography>
      )}
      {payload.summary && <Typography sx={{ mt: 2 }}>{payload.summary}</Typography>}
      <Divider sx={{ my: 3 }} />
      {payload.sections?.map((s, i) => {
        switch (s.type) {
          case 'kpi_grid':  return <KpiGrid key={i} {...s} />;
          case 'chart':     return <ChartBlock key={i} {...s} />;
          case 'narrative': return <Narrative key={i} {...s} />;
          case 'table':     return <TableBlock key={i} {...s} />;
          case 'callout':   return <Callout key={i} {...s} />;
          default:          return null;
        }
      })}
    </Box>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
yarn lint && yarn build
```

- [ ] **Step 4: Commit**

```bash
git add src/views/admin/AdminHub/reports/ai/ src/api/aiReports.js
git commit -m "feat(reports): WebReportRenderer + block components for AI web reports"
```

---

## Task 10: Admin AI template editor

**Files:**
- Create: `src/views/admin/AdminHub/reports/ai/AiTemplateList.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/AiTemplateEditor.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/AiTestRunPanel.jsx`
- Modify: `src/views/admin/AdminHub/reports/ReportsList.jsx` (add tab + button)
- Modify: routing config (register the editor route)

The editor is a two-column layout: left = settings (name, prompt, data sources, style), right = test-run panel (client picker + date range + Run + preview).

- [ ] **Step 1: `AiTemplateList.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { Box, Stack, Button, Typography, Card, Chip } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { listAiTemplates, createAiTemplate } from 'api/aiReports';

export default function AiTemplateList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    listAiTemplates().then((r) => { setRows(r); setLoading(false); }).catch((e) => {
      toast.error(`Failed to load templates: ${e.message}`); setLoading(false);
    });
  }, []);

  const handleCreate = async () => {
    try {
      const tpl = await createAiTemplate({ name: 'Untitled AI Report' });
      setRows((p) => [tpl, ...p]);
      toast.success('Template created');
      navigate(`/admin/reports/ai/${tpl.id}`);
    } catch (e) { toast.error(`Create failed: ${e.message}`); }
  };

  if (!loading && !rows.length) {
    return <EmptyState
      title="No AI templates yet"
      message="Create your first AI report template."
      action={<Button variant="contained" onClick={handleCreate}>New AI Template</Button>}
    />;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">AI Report Templates</Typography>
        <Button variant="contained" onClick={handleCreate}>New AI Template</Button>
      </Stack>
      <DataTable
        rows={rows} loading={loading} rowKey="id"
        searchable searchFields={['name', 'description']}
        columns={[
          { key: 'name', label: 'Name', render: (r) => (
              <Link to={`/admin/reports/ai/${r.id}`}>{r.name}</Link>
            ) },
          { key: 'status', label: 'Status', render: (r) => <StatusChip status={r.status} /> },
          { key: 'updated_at', label: 'Updated', render: (r) => new Date(r.updated_at).toLocaleString() }
        ]}
      />
    </Box>
  );
}
```

- [ ] **Step 2: `AiTemplateEditor.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Grid, Paper, TextField, Stack, Typography, Button,
  FormGroup, FormControlLabel, Checkbox, Divider
} from '@mui/material';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import {
  getAiTemplate, updateAiTemplate, approveAiTemplate
} from 'api/aiReports';
import AiTestRunPanel from './AiTestRunPanel';

const ALL_SOURCES = ['ctm_leads', 'ga4', 'google_ads', 'meta_ads', 'reviews', 'tasks'];

export default function AiTemplateEditor() {
  const { id } = useParams();
  const [tpl, setTpl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const toast = useToast();

  useEffect(() => { getAiTemplate(id).then(setTpl).catch((e) => toast.error(e.message)); }, [id]);

  if (!tpl) return null;

  const include = tpl.data_scope?.include || ALL_SOURCES;
  const setField = (patch) => setTpl((p) => ({ ...p, ...patch }));
  const setScope = (next) => setTpl((p) => ({ ...p, data_scope: { ...(p.data_scope || {}), ...next } }));
  const setStyle = (next) => setTpl((p) => ({ ...p, style_recipe: { ...(p.style_recipe || {}), ...next } }));

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateAiTemplate(id, {
        name: tpl.name, description: tpl.description, prompt: tpl.prompt,
        dataScope: tpl.data_scope, styleRecipe: tpl.style_recipe
      });
      setTpl(next); toast.success('Saved');
    } catch (e) { toast.error(`Save failed: ${e.message}`); }
    finally { setSaving(false); }
  };

  const approve = async () => {
    setApproving(true);
    try {
      await approveAiTemplate(id, {});
      const fresh = await getAiTemplate(id);
      setTpl(fresh); toast.success('Approved version published');
    } catch (e) { toast.error(`Approve failed: ${e.message}`); }
    finally { setApproving(false); }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Edit AI Template</Typography>
        <Stack direction="row" spacing={1}>
          <LoadingButton loading={saving} variant="outlined" onClick={save}>Save Draft</LoadingButton>
          <LoadingButton loading={approving} variant="contained" onClick={approve}>
            Approve This Version
          </LoadingButton>
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <TextField label="Name" value={tpl.name || ''}
                onChange={(e) => setField({ name: e.target.value })} />
              <TextField label="Description" value={tpl.description || ''}
                onChange={(e) => setField({ description: e.target.value })} />
              <TextField label="Prompt" multiline minRows={6} value={tpl.prompt || ''}
                onChange={(e) => setField({ prompt: e.target.value })}
                helperText="Plain-language brief. The AI sees this plus a frozen data package." />
              <Divider />
              <Typography variant="subtitle2">Data sources</Typography>
              <FormGroup>
                {ALL_SOURCES.map((s) => (
                  <FormControlLabel key={s}
                    control={<Checkbox checked={include.includes(s)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...new Set([...include, s])]
                          : include.filter((x) => x !== s);
                        setScope({ include: next });
                      }} />}
                    label={s} />
                ))}
              </FormGroup>
              <Divider />
              <Typography variant="subtitle2">Style</Typography>
              <TextField label="Tone" value={tpl.style_recipe?.tone || 'executive'}
                onChange={(e) => setStyle({ tone: e.target.value })} />
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <AiTestRunPanel templateId={id} />
        </Grid>
      </Grid>
    </Box>
  );
}
```

- [ ] **Step 3: `AiTestRunPanel.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react';
import {
  Paper, Stack, TextField, Typography, Box, Autocomplete, CircularProgress
} from '@mui/material';
import axios from 'axios';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { testRunAiTemplate, getRun, getRunItem } from 'api/aiReports';
import WebReportRenderer from './WebReportRenderer';

export default function AiTestRunPanel({ templateId }) {
  const [clients, setClients] = useState([]);
  const [client, setClient] = useState(null);
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [running, setRunning] = useState(false);
  const [payload, setPayload] = useState(null);
  const pollRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    axios.get('/api/hub/clients').then((r) => setClients(r.data.clients || r.data));
    return () => clearInterval(pollRef.current);
  }, []);

  const start = async () => {
    if (!client) return toast.error('Pick a client');
    setRunning(true); setPayload(null);
    try {
      const run = await testRunAiTemplate(templateId, {
        clientId: client.id, dateRange: { from, to }
      });
      pollRef.current = setInterval(async () => {
        const data = await getRun(run.id);
        const item = data.items[0];
        if (item?.status === 'complete') {
          clearInterval(pollRef.current);
          const fresh = await getRunItem(item.id);
          setPayload(fresh.rendered_payload);
          setRunning(false);
        } else if (item?.status === 'failed') {
          clearInterval(pollRef.current);
          toast.error(`Run failed: ${item.error_message}`);
          setRunning(false);
        }
      }, 1500);
    } catch (e) { toast.error(e.response?.data?.error || e.message); setRunning(false); }
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Test Run</Typography>
      <Stack spacing={2}>
        <Autocomplete
          options={clients}
          getOptionLabel={(o) => `${o.first_name || ''} ${o.last_name || ''} (${o.business_name || o.email || ''})`}
          value={client} onChange={(_, v) => setClient(v)}
          renderInput={(p) => <TextField {...p} label="Test client" />}
        />
        <Stack direction="row" spacing={1}>
          <TextField type="date" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField type="date" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
        </Stack>
        <LoadingButton variant="contained" onClick={start} loading={running}>Generate Test Report</LoadingButton>
      </Stack>
      <Box sx={{ mt: 3 }}>
        {running && <CircularProgress size={24} />}
        {payload && <WebReportRenderer payload={payload} />}
      </Box>
    </Paper>
  );
}

function defaultFrom() { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); }
function defaultTo() { return new Date().toISOString().slice(0, 10); }
```

- [ ] **Step 4: Wire routes + add list tab**

Find the React Router config (likely `src/routes/MainRoutes.jsx` or similar — grep for `/admin/reports`). Register:

```jsx
{
  path: '/admin/reports/ai',
  element: <AiTemplateList />,
},
{
  path: '/admin/reports/ai/:id',
  element: <AiTemplateEditor />,
},
```

In `ReportsList.jsx` (the existing reports list), add a button or tab linking to `/admin/reports/ai`:

```jsx
<Button component={Link} to="/admin/reports/ai" variant="outlined">AI Templates</Button>
```

- [ ] **Step 5: Verify**

```bash
yarn lint && yarn build
```

Manual: `./dev.sh`, log in as admin, click into the new AI Templates list, create one, write a brief prompt, run a test, verify the preview renders. Open browser console — confirm no errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/admin/AdminHub/reports/ai/ src/views/admin/AdminHub/reports/ReportsList.jsx <routes file>
git commit -m "feat(reports): admin AI template list + editor + test-run panel"
```

---

## Task 11: Audience picker + manual run dialog

**Files:**
- Create: `src/views/admin/AdminHub/reports/ai/AiAudiencePicker.jsx`
- Create: `src/views/admin/AdminHub/reports/ai/AiRunDialog.jsx`
- Modify: `AiTemplateEditor.jsx` (add a "Run for clients…" button when status='approved')

- [ ] **Step 1: `AiAudiencePicker.jsx`**

```jsx
import { useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, RadioGroup, Radio, FormControlLabel, TextField, Checkbox, List,
  ListItem, ListItemButton, ListItemText, Typography, Divider, Chip
} from '@mui/material';
import axios from 'axios';
import SelectField from 'ui-component/extended/SelectField';

// audience: { mode: 'all' | 'package' | 'manual', client_package?, client_ids? }
export default function AiAudiencePicker({ value, onChange }) {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    axios.get('/api/hub/clients').then((r) => setClients(r.data.clients || r.data));
  }, []);

  const packages = useMemo(() => {
    return [...new Set(clients.map((c) => c.client_package).filter(Boolean))]
      .map((p) => ({ value: p, label: p }));
  }, [clients]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter((c) =>
      `${c.first_name} ${c.last_name} ${c.business_name || ''} ${c.email || ''}`.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const ids = value?.client_ids || [];

  return (
    <Stack spacing={2}>
      <RadioGroup value={value?.mode || 'all'} onChange={(_, m) => onChange({ mode: m })}>
        <FormControlLabel value="all" control={<Radio />} label="All clients" />
        <FormControlLabel value="package" control={<Radio />} label="By package" />
        <FormControlLabel value="manual" control={<Radio />} label="Pick clients" />
      </RadioGroup>

      {value?.mode === 'package' && (
        <SelectField
          label="Package" value={value.client_package || ''} options={packages}
          onChange={(e) => onChange({ ...value, client_package: e.target.value })}
        />
      )}

      {value?.mode === 'manual' && (
        <Box>
          <TextField fullWidth size="small" placeholder="Search clients…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <Typography variant="caption" color="text.secondary">
            Selected: {ids.length}
          </Typography>
          <Divider sx={{ my: 1 }} />
          <List dense sx={{ maxHeight: 280, overflow: 'auto' }}>
            {filtered.map((c) => {
              const checked = ids.includes(c.id);
              return (
                <ListItem key={c.id} disablePadding>
                  <ListItemButton onClick={() => {
                    const next = checked ? ids.filter((x) => x !== c.id) : [...ids, c.id];
                    onChange({ ...value, client_ids: next });
                  }}>
                    <Checkbox edge="start" checked={checked} disableRipple />
                    <ListItemText
                      primary={c.business_name || `${c.first_name} ${c.last_name}`}
                      secondary={c.client_package && <Chip size="small" label={c.client_package} />}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: `AiRunDialog.jsx`**

```jsx
import { useState } from 'react';
import { TextField, Stack } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import { useToast } from 'contexts/ToastContext';
import { startRun } from 'api/aiReports';
import AiAudiencePicker from './AiAudiencePicker';

export default function AiRunDialog({ open, onClose, templateId, onStarted }) {
  const [audience, setAudience] = useState({ mode: 'all' });
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setSubmitting(true);
    try {
      const run = await startRun({ templateId, audienceFilter: audience, dateRange: { from, to } });
      toast.success(`Run started (${run.selected_client_ids.length} clients)`);
      onStarted?.(run); onClose();
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <FormDialog open={open} onClose={onClose} onSubmit={submit}
      title="Run AI Report" submitLabel="Run" loading={submitting}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1}>
          <TextField type="date" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField type="date" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
        </Stack>
        <AiAudiencePicker value={audience} onChange={setAudience} />
      </Stack>
    </FormDialog>
  );
}

function defaultFrom() { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); }
function defaultTo() { return new Date().toISOString().slice(0, 10); }
```

- [ ] **Step 3: Wire button into `AiTemplateEditor.jsx`**

Add state `const [runOpen, setRunOpen] = useState(false);` and a button in the header:

```jsx
<Button
  variant="contained"
  disabled={tpl.status !== 'approved'}
  onClick={() => setRunOpen(true)}
>
  Run for Clients
</Button>
<AiRunDialog open={runOpen} onClose={() => setRunOpen(false)} templateId={id} />
```

- [ ] **Step 4: Verify**

```bash
yarn lint && yarn build
```

Manual: approve a template, click "Run for Clients", select package or manual list, kick off, confirm `/api/reports/runs/:id` shows items moving from pending → running → complete.

- [ ] **Step 5: Commit**

```bash
git add src/views/admin/AdminHub/reports/ai/AiAudiencePicker.jsx \
        src/views/admin/AdminHub/reports/ai/AiRunDialog.jsx \
        src/views/admin/AdminHub/reports/ai/AiTemplateEditor.jsx
git commit -m "feat(reports): audience picker + manual-run dialog for AI templates"
```

---

## Task 12: Client portal report route

**Files:**
- Create: `src/views/portal/PortalReportPage.jsx`
- Modify: routing config (register `/portal/reports/:itemId`)
- Modify: `server/routes/reports.js` (add a portal-scoped GET)

The portal page must enforce that the requesting user matches `report_run_items.client_id` (or admin/staff override). Route the auth through the existing portal auth flow.

- [ ] **Step 1: Add a portal-scoped backend endpoint to `server/routes/reports.js`**

```javascript
import { requireAuth as requireAuthAny } from '../middleware/auth.js'; // confirm path

router.get('/portal/items/:id', requireAuthAny, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, client_id, status, rendered_payload, schema_version, published_at
       FROM report_run_items WHERE id = $1`,
    [req.params.id]
  );
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'not found' });
  const portalUserId = req.portalUserId || req.user.id;
  const isStaffUser = req.user.role === 'admin' || req.user.role === 'team' || req.user.role === 'superadmin';
  if (!isStaffUser && item.client_id !== portalUserId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (item.status !== 'complete') return res.status(409).json({ error: 'not ready' });
  res.json({ item });
});
```

(Use the same `requireAuth` middleware that `/api/hub/docs` uses for the portal — grep `requireAuth` in `server/routes/hub.js` if uncertain.)

- [ ] **Step 2: `PortalReportPage.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Alert } from '@mui/material';
import WebReportRenderer from 'views/admin/AdminHub/reports/ai/WebReportRenderer';

export default function PortalReportPage() {
  const { itemId } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get(`/api/reports/portal/items/${itemId}`)
      .then((r) => setItem(r.data.item))
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, [itemId]);

  if (error) return <Alert severity="error" sx={{ m: 4 }}>{error}</Alert>;
  if (!item) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;
  return <WebReportRenderer payload={item.rendered_payload} />;
}
```

- [ ] **Step 3: Register route**

In the portal routes config:

```jsx
{
  path: '/portal/reports/:itemId',
  element: <PortalReportPage />
}
```

- [ ] **Step 4: Verify**

```bash
yarn lint && yarn build
```

Manual end-to-end smoke (the headline test of the whole feature):
1. Create AI template, write prompt mentioning leads + ad spend.
2. Test run for one client → confirm preview renders.
3. Approve.
4. Run for that one client.
5. Open the client portal as that client (or use `actingClient` impersonation via `x-acting-user`).
6. Documents tab shows a new "View Report" entry.
7. Click → `/portal/reports/<itemId>` renders the same content from the cached snapshot.
8. Re-load — page is stable (no live data calls).

- [ ] **Step 5: Commit**

```bash
git add server/routes/reports.js src/views/portal/PortalReportPage.jsx <routes file>
git commit -m "feat(reports): client portal route for AI web reports"
```

---

## Task 13: Wire scheduled runs to approved versions

**Files:**
- Modify: `server/services/reports/scheduler.js`

The existing scheduler triggers a generation per template. Branch on `engine`. AI templates use `aiRunExecutor.startRun()` instead of the legacy hydrate-and-PDF pipeline.

- [ ] **Step 1: Read existing `scheduler.js` to find the dispatch site**

```bash
sed -n '1,80p' server/services/reports/scheduler.js
```

Identify the function that, for each due template, enqueues a generation job. Typically it loads the template, calls `enqueueGenerationJob(...)`, and advances `next_run_at`.

- [ ] **Step 2: Add a branch for `engine === 'ai_web'`**

```javascript
import { startRun } from './aiRunExecutor.js';

// inside the per-template loop, after loading `tpl`:
if (tpl.engine === 'ai_web') {
  if (!tpl.approved_version_id) {
    console.warn('[scheduler] skipping AI template without approved version:', tpl.id);
    await advanceNextRun(tpl); // existing helper
    continue;
  }
  await startRun({
    templateId: tpl.id,
    source: 'scheduled',
    audienceFilter: tpl.schedule?.audience_filter || { mode: 'all' },
    dateRange: resolveScheduledDateRange(tpl.schedule), // see helper below
    createdBy: null
  });
  await advanceNextRun(tpl);
  continue;
}

// fall through to existing widget-canvas path for engine !== 'ai_web'
```

Add the helper at the bottom of the file (or a sibling util):

```javascript
function resolveScheduledDateRange(schedule) {
  // Default: previous calendar month relative to today.
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    from: schedule?.date_range?.from || fmt(first),
    to:   schedule?.date_range?.to   || fmt(last)
  };
}
```

- [ ] **Step 3: Verify**

```bash
yarn lint && yarn build
```

Manual: insert a fake AI template with `next_run_at = now() - interval '1 minute'`, restart the server (or manually call `tickScheduler()` from a node REPL), confirm a `report_runs` row appears with `source='scheduled'`.

- [ ] **Step 4: Commit**

```bash
git add server/services/reports/scheduler.js
git commit -m "feat(reports): scheduler branches AI templates to aiRunExecutor"
```

---

## Task 16: Remove the widget-canvas authoring UI

**Files:**
- Delete: `src/views/admin/AdminHub/reports/canvas/` (entire directory)
- Delete: `src/views/admin/AdminHub/reports/widgets/` (entire directory)
- Delete: `src/views/admin/AdminHub/reports/Palette.jsx`
- Delete: `src/views/admin/AdminHub/reports/PropertiesPanel.jsx`
- Delete: `src/views/admin/AdminHub/reports/ReportBuilder.jsx`
- Delete: `src/views/admin/AdminHub/reports/VersionHistoryDrawer.jsx`
- Delete: `src/views/admin/AdminHub/reports/StarterTemplateDialog.jsx` (if present)
- Modify: `src/views/admin/AdminHub/reports/ReportsList.jsx` — remove "New Template" / canvas links; the AI flow is the only entry point
- Modify: routing config — remove `/admin/reports/builder/:id`, `/admin/reports/builder` routes
- Modify: routing config — make `/admin/reports` redirect to `/admin/reports/ai`
- Modify: `src/views/admin/AdminHub/reports/GenerateDialog.jsx` — delete; AI runs use `AiRunDialog` only

**Do NOT delete:**
- `server/services/reports/widgetDataFetchers/` (data fetchers may be reused indirectly by `dataPackage.js` — check imports first; only delete the ones not transitively imported)
- `server/services/reports/widgetRegistry.js` — keep until you confirm no fetcher imports it
- `server/services/reports/scheduler.js` — heavily modified, kept
- `server/services/reports/queue.js` — kept (may be reused)
- `server/services/reports/templateStore.js` — kept; AI uses `aiTemplateStore.js`
- `server/sql/migrate_report_builder.sql` and other report migrations — DO NOT remove (already-applied DDL)
- Any `report_*` tables — leave existing rows in place; they're inert
- `server/routes/reports.js` — extended, not replaced; existing endpoints stay so historical generated PDFs remain downloadable for now

This task runs **last** so the AI flow has been verified working end-to-end before any code is removed.

- [ ] **Step 1: Verify AI path works in dev**

```bash
./dev.sh
```
Manually create an AI template, test-run, approve, run-for-clients, view in client portal. Documents tab shows the featured card. All four actions toast success.

- [ ] **Step 2: Identify which `widgetDataFetchers/*` are still imported**

```bash
grep -r "widgetDataFetchers" server/services/reports/dataPackage.js src/ 2>/dev/null
```

If `dataPackage.js` doesn't import any of them (current plan reuses `fetchUnifiedAnalytics` directly from `server/services/analytics/index.js`, not the widget fetchers), the fetchers are dead and can go.

- [ ] **Step 3: Delete files**

```bash
git rm -r src/views/admin/AdminHub/reports/canvas
git rm -r src/views/admin/AdminHub/reports/widgets
git rm src/views/admin/AdminHub/reports/Palette.jsx
git rm src/views/admin/AdminHub/reports/PropertiesPanel.jsx
git rm src/views/admin/AdminHub/reports/ReportBuilder.jsx
git rm src/views/admin/AdminHub/reports/VersionHistoryDrawer.jsx
git rm src/views/admin/AdminHub/reports/GenerateDialog.jsx
git rm -f src/views/admin/AdminHub/reports/StarterTemplateDialog.jsx 2>/dev/null
git rm src/views/admin/AdminHub/reports/ReportViewer.jsx
git rm src/views/admin/AdminHub/reports/ReportRendererPage.jsx
# Server-side, only after confirming step 2:
git rm -r server/services/reports/widgetDataFetchers
git rm server/services/reports/widgetRegistry.js
git rm server/services/reports/reportRenderer.js
git rm server/services/reports/legacyMigration.js
git rm server/services/reports/internalRenderRoute.js
git rm server/services/reports/csvRenderer.js
git rm server/services/reports/generationJob.js
git rm server/services/reports/pdfRenderer.js
```

- [ ] **Step 4: Update `server/routes/reports.js`**

Remove imports referencing the deleted modules. Remove the legacy generation/template endpoints (`POST /generations`, `GET /generations`, `GET /generations/:id`, `GET /generations/:id/download`, image upload/serve if not used by AI). Keep only the AI endpoints from Task 7 and Task 12.

- [ ] **Step 5: Update `server/index.js`**

Remove imports / scheduler hooks for legacy generation. The `tickScheduler()` call stays (modified in Task 13 to handle AI-only).

- [ ] **Step 6: Verify**

```bash
yarn lint
yarn build
```

Fix any unresolved imports (the deletions will likely cascade — that's expected; chase them down).

- [ ] **Step 7: Manual smoke (full)**

```bash
./dev.sh
```

Click through:
1. Login as admin → Reports → confirm only AI templates UI is shown.
2. Visiting `/admin/reports/builder` returns a 404 or redirects.
3. Test-run an AI template → preview renders.
4. Approve → run for clients → confirm Documents tab updates.
5. Login as that client → click report → confirm renders from snapshot.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(reports): remove widget-canvas authoring UI; AI is the only Reports engine"
```

---

## Task 14: PDF export from web report (deferred — placeholder)

**Files:** none yet.

The brief explicitly defers PDF as optional, generated from the same web report. We will reuse the existing `pdfRenderer.js` + `internalRenderRoute.js` (Puppeteer + signed-token render). Plan for a future task:

- Add `GET /api/reports/run-items/:id/pdf` — mints a signed token, opens `/internal/portal-report-pdf/:itemId?token=...`, Puppeteer prints to PDF, stores in `file_uploads`, returns the file URL.
- A new internal-only React route that renders `WebReportRenderer` with print CSS.

**Do not implement this in the same PR as Tasks 0–13.** Ship the web flow, get sign-off, then plan the PDF task separately.

---

## Task 15: Documentation update

**Files:**
- Modify: `docs/API_REFERENCE.md`

- [ ] **Step 1: Append a new section for the AI report endpoints**

Add under the existing reports section:

```markdown
### AI Web Reports

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET    | /api/reports/ai-templates                         | List AI templates           | staff |
| GET    | /api/reports/ai-templates/:id                     | Get one                     | staff |
| POST   | /api/reports/ai-templates                         | Create draft                | staff |
| PATCH  | /api/reports/ai-templates/:id                     | Update draft                | staff |
| POST   | /api/reports/ai-templates/:id/test-run            | Test run vs one client      | staff |
| POST   | /api/reports/ai-templates/:id/approve             | Snapshot approved version   | staff |
| POST   | /api/reports/runs                                 | Start manual run            | staff |
| GET    | /api/reports/runs/:id                             | Run + items status          | staff |
| GET    | /api/reports/run-items/:id                        | One item (admin)            | staff |
| GET    | /api/reports/client/:clientId/items               | List a client's reports     | staff |
| GET    | /api/reports/portal/items/:id                     | Portal-facing snapshot      | client (own) or staff |
```

- [ ] **Step 2: Verify**

```bash
yarn lint
```

- [ ] **Step 3: Commit**

```bash
git add docs/API_REFERENCE.md
git commit -m "docs: AI web reports API reference"
```

---

## Self-Review Notes

- **Spec coverage:** All 13 steps in the brief's "Implementation Order" map to Tasks 1–13 (PDF deferred per brief). Documents-tab integration is Task 8. Approved-version flow is Task 6 (store) + Task 10 (UI button) + Task 13 (scheduler honors it).
- **Compliance:** No PHI is sent to Vertex unless the admin's prompt + selected data sources include it. The data package never includes raw call transcripts; it includes aggregates and KPI rollups. **Before approving the first medical-client AI template, the operator MUST verify that selected data sources do not include caller_name/phone/transcript fields** — flag this in onboarding docs (separate task, not in this plan).
- **HIPAA gate carryover:** This plan does NOT route AI reports through Meta CAPI. The Meta/HIPAA gate in `trackingRelay.js` is unaffected.
- **Strangler safety:** The legacy widget canvas system is untouched; no rows in `report_templates` are mutated by the migration except via additive columns with safe defaults (`engine='widget_canvas'`).
- **Documents dedupe:** Re-running a template for the same client creates a new `documents` row each time. Brief did not specify dedupe behavior; if the user wants "replace previous" semantics, add a follow-up task.
- **Audience freshness for scheduled runs:** `audience_filter` is stored on `report_runs`, but resolved to `selected_client_ids` at run time — meaning each scheduled run picks up newly-added clients in the package. This matches the brief.
- **`client_package` has no enum constraint** (per audit). The package picker reads distinct values from existing client rows, so misspellings will appear as separate "packages." Worth adding a CHECK constraint or a managed list — not in this plan.

---

## Resolved Direction (2026-05-08)

- **Branch:** `feature/ai-reports` off main.
- **Task 1 (starter bug):** dropped.
- **Dedupe:** new doc each run; latest featured at top of Documents tab; older runs collapsed in archive table beneath (Task 8 updated).
- **Portal access:** Reports tab is admin-only. Generated reports surface for clients only via Documents tab. Anyone with access to the client account sees them via standard portal auth.
- **Scheduling:** included in v1 (Task 13). Reuses existing `report_templates.schedule` JSONB.
- **Removal scope:** Strangler — keep tables, fetchers (only those reused), scheduler, routes file, queue. Delete only the canvas authoring UI files (Task 16). Existing widget-canvas DB rows are inert and left in place; nothing migrated, nothing dropped.
