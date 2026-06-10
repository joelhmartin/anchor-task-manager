# Report Builder — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing analytics report engine with a unified, widget-based report builder. After Phase 1, admins can create templates with absolute-positioned widgets across multi-page canvases, save versioned templates, and generate per-client PDFs that exactly match the on-screen layout.

**Architecture:** Single-renderer pipeline using Puppeteer + Chromium. Templates are JSON layouts stored in Postgres. Backend hydrates widget data server-side, renders via React shell at an internal URL, screenshots each page to PDF. 8 widgets in Phase 1; legacy templates migrated 1:1.

**Tech Stack:** React 19, MUI 7 (legacy Grid alias), Vite, Express + Node 20 ESM, PostgreSQL, `react-rnd` (canvas), `puppeteer-core` + `@sparticuz/chromium` (PDF), `pdf-lib` (page merging), `nanoid` (widget IDs), Mailgun (delivery).

**Spec reference:** `docs/superpowers/specs/2026-04-28-report-builder-design.md`

**Verification model:** No test suite. Per CLAUDE.md, every commit must pass `yarn build` and `yarn lint`. Each task includes a manual smoke check.

---

## File Structure

### Files to create

**Backend:**
- `server/sql/migrate_report_builder.sql` — new tables
- `server/routes/reports.js` — HTTP routes
- `server/services/reports/templateStore.js` — template CRUD + version history
- `server/services/reports/widgetRegistry.js` — backend widget registry
- `server/services/reports/widgetDataFetchers/index.js` — fetcher map
- `server/services/reports/widgetDataFetchers/kpiTile.js`
- `server/services/reports/widgetDataFetchers/leadSourceBreakdown.js`
- `server/services/reports/widgetDataFetchers/leadActivityTable.js`
- `server/services/reports/widgetDataFetchers/googleAdsCampaigns.js`
- `server/services/reports/widgetDataFetchers/metaCampaigns.js`
- `server/services/reports/widgetDataFetchers/aiInsightsText.js`
- `server/services/reports/widgetDataFetchers/staticTextBlock.js`
- `server/services/reports/widgetDataFetchers/pageChrome.js`
- `server/services/reports/reportRenderer.js` — orchestrator
- `server/services/reports/pdfRenderer.js` — Puppeteer pool
- `server/services/reports/queue.js` — in-process FIFO
- `server/services/reports/scheduler.js` — cron handler
- `server/services/reports/legacyMigration.js` — one-shot translator
- `server/services/reports/signedToken.js` — HMAC mint/verify
- `server/services/reports/filterResolver.js` — filter inheritance
- `server/services/reports/internalRenderRoute.js` — `/internal/report-render/:id`

**Frontend:**
- `src/api/reports.js` — axios client
- `src/views/admin/AdminHub/reports/ReportsList.jsx`
- `src/views/admin/AdminHub/reports/ReportBuilder.jsx`
- `src/views/admin/AdminHub/reports/canvas/Canvas.jsx`
- `src/views/admin/AdminHub/reports/canvas/WidgetWrapper.jsx`
- `src/views/admin/AdminHub/reports/canvas/PageNavigator.jsx`
- `src/views/admin/AdminHub/reports/Palette.jsx`
- `src/views/admin/AdminHub/reports/PropertiesPanel.jsx`
- `src/views/admin/AdminHub/reports/GenerateDialog.jsx`
- `src/views/admin/AdminHub/reports/VersionHistoryDrawer.jsx`
- `src/views/admin/AdminHub/reports/MigrationBanner.jsx`
- `src/views/admin/AdminHub/reports/ReportRendererPage.jsx` — internal render shell
- `src/views/admin/AdminHub/reports/widgets/registry.js` — frontend registry
- `src/views/admin/AdminHub/reports/widgets/kpiTile/{KpiTile.jsx, KpiTilePropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/widgets/leadSourceBreakdown/{LeadSourceBreakdown.jsx, LeadSourceBreakdownPropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/widgets/leadActivityTable/{LeadActivityTable.jsx, LeadActivityTablePropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/widgets/googleAdsCampaigns/{GoogleAdsCampaigns.jsx, GoogleAdsCampaignsPropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/widgets/metaCampaigns/{MetaCampaigns.jsx, MetaCampaignsPropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/widgets/aiInsightsText/{AiInsightsText.jsx, AiInsightsTextPropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/widgets/staticTextBlock/{StaticTextBlock.jsx, StaticTextBlockPropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/widgets/pageChrome/{PageChrome.jsx, PageChromePropsForm.jsx, index.js}`
- `src/views/admin/AdminHub/reports/utils/filterMerge.js`
- `src/views/admin/AdminHub/reports/utils/layoutHelpers.js`
- `src/views/admin/AdminHub/reports/hooks/useReportDraft.js`
- `src/views/admin/AdminHub/reports/hooks/useUndoRedo.js`

### Files to modify

- `package.json` — add deps
- `Dockerfile` — Chromium system libs
- `.env.example` — `REPORT_RENDER_SECRET`
- `server/index.js` — mount route, register migration, replace cron, mount internal render
- `src/views/admin/AnalyticsDashboard/index.jsx` — retarget Reports tab
- `src/routes/MainRoutes.jsx` — add report builder routes (list, builder, internal render)
- `src/api/analytics.js` — remove old report endpoints

### Files to delete (in cutover task)

- `server/services/analytics/reportGenerator.js`
- `src/views/admin/AnalyticsDashboard/ReportsTab.jsx`
- `server/generated-reports/` directory + contents

---

## Section A — Foundation

### Task A1: Add new dependencies

**Files:**
- Modify: `package.json`
- Modify: `yarn.lock` (auto)

- [ ] **Step 1: Add dependencies via yarn**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"
yarn add puppeteer-core @sparticuz/chromium pdf-lib react-rnd nanoid
```

- [ ] **Step 2: Verify install**

```bash
yarn install
```
Expected: success, `yarn.lock` updated.

- [ ] **Step 3: Verify build still passes**

```bash
yarn build
```
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore(reports): add puppeteer, chromium, pdf-lib, react-rnd, nanoid"
```

---

### Task A2: Create the new database migration

**Files:**
- Create: `server/sql/migrate_report_builder.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Report Builder schema (Phase 1)
-- Replaces analytics_report_templates / analytics_generated_reports

CREATE TABLE IF NOT EXISTS report_templates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  description       TEXT,
  layout            JSONB NOT NULL,
  filters_default   JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  schedule          JSONB,
  next_run_at       TIMESTAMPTZ,
  legacy_template_id UUID,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_templates_active
  ON report_templates (is_archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_templates_next_run
  ON report_templates (next_run_at)
  WHERE schedule IS NOT NULL AND is_archived = false;

CREATE TABLE IF NOT EXISTS report_template_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id     UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  layout          JSONB NOT NULL,
  filters_default JSONB NOT NULL,
  saved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS idx_report_template_versions_template
  ON report_template_versions (template_id, version DESC);

CREATE TABLE IF NOT EXISTS report_generations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id       UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  template_version  INTEGER,
  client_ids        UUID[] NOT NULL,
  filters           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','complete','failed')),
  error_message     TEXT,
  description       TEXT,
  pdf_file_id       UUID REFERENCES file_uploads(id) ON DELETE SET NULL,
  hydrated_payload  JSONB,
  generated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  generation_source TEXT NOT NULL DEFAULT 'manual'
                    CHECK (generation_source IN ('manual','scheduled','api')),
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_report_generations_template
  ON report_generations (template_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_generations_status
  ON report_generations (status, generated_at)
  WHERE status IN ('pending','running');
```

- [ ] **Step 2: Commit**

```bash
git add server/sql/migrate_report_builder.sql
git commit -m "feat(reports): add report_templates, report_template_versions, report_generations tables"
```

---

### Task A3: Wire the migration into server startup

**Files:**
- Modify: `server/index.js` (find `maybeRunCtmFormTemplatesMigration` near line 821 — append after it; also add to the migration chain in `maybeRunMigrations`)

- [ ] **Step 1: Add the migration runner function**

Add after the existing `maybeRunCtmFormTemplatesMigration` function in `server/index.js`:

```js
async function maybeRunReportBuilderMigration() {
  try {
    const migrationPath = path.join(__dirname, 'sql', 'migrate_report_builder.sql');
    const sql = await fs.readFile(migrationPath, 'utf8');
    await pool.query(sql);
    console.warn('[migrations] report_builder schema ensured');
  } catch (err) {
    console.error('[migrations] report_builder failed:', err);
  }
}
```

- [ ] **Step 2: Call it from the migration chain**

Find the chain inside `maybeRunMigrations` (around line 294). Append the new call to the end of the chain:

```js
  await maybeRunCtmFormTemplatesMigration();
  await maybeRunReportBuilderMigration();
```

- [ ] **Step 3: Restart server and verify**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
yarn server
```

Watch the log for `[migrations] report_builder schema ensured`. Verify in psql:

```bash
psql postgresql://bif@localhost:5432/anchor -c "\d report_templates"
psql postgresql://bif@localhost:5432/anchor -c "\d report_generations"
psql postgresql://bif@localhost:5432/anchor -c "\d report_template_versions"
```

Expected: each table prints its column list.

- [ ] **Step 4: Verify build/lint**

```bash
yarn build && yarn lint
```

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(reports): run report_builder migration on server startup"
```

---

### Task A4: Add `REPORT_RENDER_SECRET` to env

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append env var**

Append to `.env.example`:

```
# Report Builder (Phase 1)
# 32-byte hex string used to sign internal render-route tokens.
# Generate with: openssl rand -hex 32
REPORT_RENDER_SECRET=
```

- [ ] **Step 2: Set it in your local `.env`**

Per CLAUDE.md, do NOT modify `.env` casually — but this is a NEW required var, so add it:

```bash
echo "REPORT_RENDER_SECRET=$(openssl rand -hex 32)" >> .env
```

(In production, set this via Cloud Run secrets — do not commit a real secret.)

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(reports): add REPORT_RENDER_SECRET env var"
```

---

### Task A5: Scaffold backend service directory

**Files:**
- Create: `server/services/reports/.gitkeep`
- Create: `server/services/reports/widgetDataFetchers/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
mkdir -p server/services/reports/widgetDataFetchers
touch server/services/reports/.gitkeep server/services/reports/widgetDataFetchers/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add server/services/reports/
git commit -m "chore(reports): scaffold reports service directory"
```

---

### Task A6: Scaffold frontend reports directory

**Files:**
- Create: `src/views/admin/AdminHub/reports/widgets/.gitkeep`
- Create: `src/views/admin/AdminHub/reports/canvas/.gitkeep`
- Create: `src/views/admin/AdminHub/reports/utils/.gitkeep`
- Create: `src/views/admin/AdminHub/reports/hooks/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/views/admin/AdminHub/reports/widgets src/views/admin/AdminHub/reports/canvas src/views/admin/AdminHub/reports/utils src/views/admin/AdminHub/reports/hooks
touch src/views/admin/AdminHub/reports/{.gitkeep,widgets/.gitkeep,canvas/.gitkeep,utils/.gitkeep,hooks/.gitkeep}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/AdminHub/reports/
git commit -m "chore(reports): scaffold reports view directory"
```

---

## Section B — Backend rendering core

### Task B1: Implement `signedToken.js`

**Files:**
- Create: `server/services/reports/signedToken.js`

- [ ] **Step 1: Write the module**

```js
import crypto from 'crypto';

const SECRET = process.env.REPORT_RENDER_SECRET || '';
const TTL_MS = 5 * 60 * 1000;

function assertSecret() {
  if (!SECRET || SECRET.length < 32) {
    throw new Error('REPORT_RENDER_SECRET must be set to a 32+ char hex string');
  }
}

export function mintRenderToken(generationId) {
  assertSecret();
  const exp = Date.now() + TTL_MS;
  const payload = `${generationId}.${exp}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyRenderToken(token, expectedGenerationId) {
  assertSecret();
  if (typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [generationId, expStr, sig] = parts;
  if (generationId !== expectedGenerationId) return { ok: false, reason: 'mismatch' };
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, reason: 'expired' };
  const expected = crypto.createHmac('sha256', SECRET).update(`${generationId}.${expStr}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' };
  return { ok: true };
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/signedToken.js
git commit -m "feat(reports): add HMAC-signed render-route tokens"
```

---

### Task B2: Implement `filterResolver.js`

**Files:**
- Create: `server/services/reports/filterResolver.js`

- [ ] **Step 1: Write the module**

```js
const PRESET_RESOLVERS = {
  last_7_days:  () => offsetRange(7),
  last_30_days: () => offsetRange(30),
  last_90_days: () => offsetRange(90),
  this_month:   () => monthRange(0),
  last_month:   () => monthRange(-1),
};

function offsetRange(days) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function monthRange(offset) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const next = new Date(target.getFullYear(), target.getMonth() + 1, 1);
  const last = new Date(next.getTime() - 86400000);
  return {
    from: target.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

export function resolveDateRange(dateRange) {
  if (!dateRange) return offsetRange(30);
  if (dateRange.from && dateRange.to) {
    return { from: dateRange.from, to: dateRange.to };
  }
  if (dateRange.preset && PRESET_RESOLVERS[dateRange.preset]) {
    return PRESET_RESOLVERS[dateRange.preset]();
  }
  return offsetRange(30);
}

const ALL_LEAD_SOURCES = ['call', 'sms', 'form', 'email', 'other'];

export function mergeFilters({ generationFilters, templateDefaults, widgetOverride }) {
  const base = { ...templateDefaults, ...generationFilters };
  const widget = widgetOverride || {};
  const merged = {
    date_range: widget.date_range || base.date_range,
    lead_sources: widget.lead_sources && widget.lead_sources.length > 0
      ? widget.lead_sources
      : (base.lead_sources && base.lead_sources.length > 0 ? base.lead_sources : ALL_LEAD_SOURCES),
    include_archived_clients: typeof widget.include_archived_clients === 'boolean'
      ? widget.include_archived_clients
      : !!base.include_archived_clients,
  };
  const range = resolveDateRange(merged.date_range);
  merged.resolved_from = range.from;
  merged.resolved_to = range.to;
  return merged;
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/filterResolver.js
git commit -m "feat(reports): resolve filter inheritance and date presets"
```

---

### Task B3: Implement `widgetRegistry.js` (backend)

**Files:**
- Create: `server/services/reports/widgetRegistry.js`

- [ ] **Step 1: Write the registry**

```js
import { kpiTileFetcher } from './widgetDataFetchers/kpiTile.js';
import { leadSourceBreakdownFetcher } from './widgetDataFetchers/leadSourceBreakdown.js';
import { leadActivityTableFetcher } from './widgetDataFetchers/leadActivityTable.js';
import { googleAdsCampaignsFetcher } from './widgetDataFetchers/googleAdsCampaigns.js';
import { metaCampaignsFetcher } from './widgetDataFetchers/metaCampaigns.js';
import { aiInsightsTextFetcher } from './widgetDataFetchers/aiInsightsText.js';
import { staticTextBlockFetcher } from './widgetDataFetchers/staticTextBlock.js';
import { pageChromeFetcher } from './widgetDataFetchers/pageChrome.js';

const REGISTRY = {
  kpi_tile: { fetcher: kpiTileFetcher },
  lead_source_breakdown: { fetcher: leadSourceBreakdownFetcher },
  lead_activity_table: { fetcher: leadActivityTableFetcher },
  google_ads_campaigns: { fetcher: googleAdsCampaignsFetcher },
  meta_campaigns: { fetcher: metaCampaignsFetcher },
  ai_insights_text: { fetcher: aiInsightsTextFetcher },
  static_text_block: { fetcher: staticTextBlockFetcher },
  page_chrome: { fetcher: pageChromeFetcher },
};

export function getWidgetFetcher(type) {
  return REGISTRY[type]?.fetcher;
}

export function isKnownWidgetType(type) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, type);
}

export const KNOWN_WIDGET_TYPES = Object.keys(REGISTRY);
```

Note: this file imports fetchers that don't exist yet — they'll be created as stubs in B4 so the registry compiles, then implemented in Section D and Section F.

- [ ] **Step 2: Commit (will not build yet — fetcher files come next)**

```bash
git add server/services/reports/widgetRegistry.js
git commit -m "feat(reports): backend widget registry with 8 widget types"
```

---

### Task B4: Stub all 8 widget fetchers

**Files:**
- Create: `server/services/reports/widgetDataFetchers/kpiTile.js`
- Create: `server/services/reports/widgetDataFetchers/leadSourceBreakdown.js`
- Create: `server/services/reports/widgetDataFetchers/leadActivityTable.js`
- Create: `server/services/reports/widgetDataFetchers/googleAdsCampaigns.js`
- Create: `server/services/reports/widgetDataFetchers/metaCampaigns.js`
- Create: `server/services/reports/widgetDataFetchers/aiInsightsText.js`
- Create: `server/services/reports/widgetDataFetchers/staticTextBlock.js`
- Create: `server/services/reports/widgetDataFetchers/pageChrome.js`

- [ ] **Step 1: Write each stub**

For each file, write the same template (replace export name):

```js
// kpiTile.js
export async function kpiTileFetcher({ config, filters, clientIds, ctx }) {
  return { __stub: true, type: 'kpi_tile' };
}
```

```js
// leadSourceBreakdown.js
export async function leadSourceBreakdownFetcher({ config, filters, clientIds, ctx }) {
  return { __stub: true, type: 'lead_source_breakdown' };
}
```

(Repeat the pattern for `leadActivityTableFetcher`, `googleAdsCampaignsFetcher`, `metaCampaignsFetcher`, `aiInsightsTextFetcher`, `staticTextBlockFetcher`, `pageChromeFetcher`. Each just returns `{ __stub: true, type: '<widget_type>' }`.)

- [ ] **Step 2: Verify build**

```bash
yarn build
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/widgetDataFetchers/
git commit -m "feat(reports): stub all 8 widget data fetchers"
```

---

### Task B5: Implement `templateStore.js`

**Files:**
- Create: `server/services/reports/templateStore.js`

- [ ] **Step 1: Write the module**

```js
import { pool } from '../../db.js';

export async function listTemplates({ includeArchived = false } = {}) {
  const sql = `
    SELECT id, name, description, layout, filters_default, default_client_id,
           schedule, next_run_at, legacy_template_id, created_by, is_archived,
           created_at, updated_at
    FROM report_templates
    ${includeArchived ? '' : 'WHERE is_archived = false'}
    ORDER BY updated_at DESC`;
  const { rows } = await pool.query(sql);
  return rows;
}

export async function getTemplate(id) {
  const { rows } = await pool.query(
    `SELECT * FROM report_templates WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

export async function createTemplate({ name, description, layout, filtersDefault, defaultClientId, schedule, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO report_templates
       (name, description, layout, filters_default, default_client_id, schedule, created_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7)
     RETURNING *`,
    [name, description || null, JSON.stringify(layout), JSON.stringify(filtersDefault || {}),
     defaultClientId || null, schedule ? JSON.stringify(schedule) : null, createdBy]
  );
  const tmpl = rows[0];
  await snapshotVersion(tmpl.id, 1, layout, filtersDefault || {}, createdBy);
  return tmpl;
}

export async function updateTemplate(id, patch, savedBy) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (['name', 'description', 'is_archived', 'default_client_id'].includes(k)) {
      fields.push(`${k} = $${i++}`); values.push(v);
    } else if (k === 'layout' || k === 'filters_default' || k === 'schedule') {
      fields.push(`${k} = $${i++}::jsonb`); values.push(JSON.stringify(v));
    }
  }
  if (fields.length === 0) return getTemplate(id);
  fields.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE report_templates SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  const tmpl = rows[0];
  if (patch.layout || patch.filters_default) {
    const next = await nextVersionNumber(id);
    await snapshotVersion(id, next, tmpl.layout, tmpl.filters_default, savedBy);
  }
  return tmpl;
}

async function nextVersionNumber(templateId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM report_template_versions WHERE template_id = $1`,
    [templateId]
  );
  return rows[0].next;
}

async function snapshotVersion(templateId, version, layout, filtersDefault, savedBy) {
  await pool.query(
    `INSERT INTO report_template_versions
       (template_id, version, layout, filters_default, saved_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT DO NOTHING`,
    [templateId, version, JSON.stringify(layout), JSON.stringify(filtersDefault), savedBy]
  );
}

export async function listVersions(templateId) {
  const { rows } = await pool.query(
    `SELECT id, version, saved_by, saved_at FROM report_template_versions
     WHERE template_id = $1 ORDER BY version DESC`,
    [templateId]
  );
  return rows;
}

export async function getVersion(templateId, version) {
  const { rows } = await pool.query(
    `SELECT * FROM report_template_versions WHERE template_id = $1 AND version = $2`,
    [templateId, version]
  );
  return rows[0] || null;
}

export async function archiveTemplate(id) {
  await pool.query(`UPDATE report_templates SET is_archived = true, updated_at = NOW() WHERE id = $1`, [id]);
}

export async function duplicateTemplate(id, createdBy) {
  const src = await getTemplate(id);
  if (!src) throw new Error('Template not found');
  return createTemplate({
    name: `${src.name} (Copy)`,
    description: src.description,
    layout: src.layout,
    filtersDefault: src.filters_default,
    defaultClientId: src.default_client_id,
    schedule: null,
    createdBy,
  });
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/templateStore.js
git commit -m "feat(reports): template CRUD with version snapshots"
```

---

### Task B6: Implement `queue.js`

**Files:**
- Create: `server/services/reports/queue.js`

- [ ] **Step 1: Write the queue**

```js
const MAX_CONCURRENCY = 2;

const pending = [];
let active = 0;

export function enqueueGenerationJob(handler) {
  pending.push(handler);
  pump();
}

async function pump() {
  while (active < MAX_CONCURRENCY && pending.length > 0) {
    const handler = pending.shift();
    active += 1;
    Promise.resolve()
      .then(() => handler())
      .catch((err) => console.error('[reports.queue] job failed:', err))
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

export function queueDepth() {
  return { pending: pending.length, active };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/reports/queue.js
git commit -m "feat(reports): in-process FIFO queue with concurrency 2"
```

---

### Task B7: Implement `reportRenderer.js`

**Files:**
- Create: `server/services/reports/reportRenderer.js`

- [ ] **Step 1: Write the orchestrator**

```js
import { pool } from '../../db.js';
import { getWidgetFetcher } from './widgetRegistry.js';
import { mergeFilters } from './filterResolver.js';
import crypto from 'crypto';

function widgetCacheKey(widget, filters) {
  const h = crypto.createHash('sha1');
  h.update(widget.type);
  h.update(JSON.stringify(filters));
  h.update(JSON.stringify(widget.props || {}));
  return h.digest('hex');
}

export async function hydrateLayout({ template, generation }) {
  const baseFilters = generation.filters || {};
  const templateDefaults = template.filters_default || {};

  const cache = new Map();
  const ctx = { clientIds: generation.client_ids };

  const tasks = [];
  for (const page of template.layout.pages || []) {
    for (const widget of page.widgets || []) {
      const filters = mergeFilters({
        generationFilters: baseFilters,
        templateDefaults,
        widgetOverride: widget.props?.filter_override || null,
      });
      const key = widgetCacheKey(widget, filters);
      tasks.push(async () => {
        if (cache.has(key)) {
          widget.__data = cache.get(key);
          return;
        }
        const fetcher = getWidgetFetcher(widget.type);
        if (!fetcher) {
          widget.__data = { error: `Unknown widget type: ${widget.type}` };
          return;
        }
        try {
          const data = await fetcher({ config: widget.props || {}, filters, clientIds: ctx.clientIds, ctx });
          cache.set(key, data);
          widget.__data = data;
        } catch (err) {
          console.error(`[reports] widget ${widget.type} failed:`, err);
          widget.__data = { error: err.message || String(err) };
        }
      });
    }
  }

  await Promise.all(tasks.map((t) => t()));

  return {
    template_id: template.id,
    template_name: template.name,
    template_version: generation.template_version,
    client_ids: generation.client_ids,
    filters: { ...templateDefaults, ...baseFilters },
    page_chrome: template.layout.page_chrome || null,
    page_size: template.layout.page_size || 'letter_portrait',
    page_dimensions_px: template.layout.page_dimensions_px || { w: 816, h: 1056 },
    page_margin_px: template.layout.page_margin_px ?? 32,
    pages: template.layout.pages,
  };
}

export async function persistHydratedPayload(generationId, payload) {
  await pool.query(
    `UPDATE report_generations SET hydrated_payload = $1::jsonb, status = 'running' WHERE id = $2`,
    [JSON.stringify(payload), generationId]
  );
}

export async function markGenerationComplete(generationId, pdfFileId) {
  await pool.query(
    `UPDATE report_generations SET pdf_file_id = $1, status = 'complete', completed_at = NOW() WHERE id = $2`,
    [pdfFileId, generationId]
  );
}

export async function markGenerationFailed(generationId, errorMessage) {
  await pool.query(
    `UPDATE report_generations SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
    [errorMessage, generationId]
  );
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/reportRenderer.js
git commit -m "feat(reports): orchestrate widget data hydration with per-run cache"
```

---

### Task B8: Add `routes/reports.js` scaffold (CRUD endpoints)

**Files:**
- Create: `server/routes/reports.js`

- [ ] **Step 1: Write the routes**

```js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isStaff } from '../middleware/roles.js';
import {
  listTemplates, getTemplate, createTemplate, updateTemplate,
  archiveTemplate, duplicateTemplate, listVersions, getVersion,
} from '../services/reports/templateStore.js';

const router = express.Router();

router.use(requireAuth, isStaff);

router.get('/templates', async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const rows = await listTemplates({ includeArchived });
    res.json(rows);
  } catch (err) {
    console.error('[reports] list templates:', err);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.get('/templates/:id', async (req, res) => {
  try {
    const tmpl = await getTemplate(req.params.id);
    if (!tmpl) return res.status(404).json({ error: 'Not found' });
    res.json(tmpl);
  } catch (err) {
    console.error('[reports] get template:', err);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, description, layout, filters_default, default_client_id, schedule } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    if (!layout || !Array.isArray(layout.pages)) return res.status(400).json({ error: 'layout.pages required' });
    const tmpl = await createTemplate({
      name, description,
      layout,
      filtersDefault: filters_default,
      defaultClientId: default_client_id,
      schedule,
      createdBy: req.user.id,
    });
    res.status(201).json(tmpl);
  } catch (err) {
    console.error('[reports] create template:', err);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

router.patch('/templates/:id', async (req, res) => {
  try {
    const tmpl = await updateTemplate(req.params.id, req.body || {}, req.user.id);
    res.json(tmpl);
  } catch (err) {
    console.error('[reports] update template:', err);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    await archiveTemplate(req.params.id);
    res.status(204).end();
  } catch (err) {
    console.error('[reports] archive template:', err);
    res.status(500).json({ error: 'Failed to archive template' });
  }
});

router.post('/templates/:id/duplicate', async (req, res) => {
  try {
    const dup = await duplicateTemplate(req.params.id, req.user.id);
    res.status(201).json(dup);
  } catch (err) {
    console.error('[reports] duplicate template:', err);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

router.get('/templates/:id/versions', async (req, res) => {
  try {
    const versions = await listVersions(req.params.id);
    res.json(versions);
  } catch (err) {
    console.error('[reports] list versions:', err);
    res.status(500).json({ error: 'Failed to list versions' });
  }
});

router.get('/templates/:id/versions/:version', async (req, res) => {
  try {
    const v = await getVersion(req.params.id, parseInt(req.params.version, 10));
    if (!v) return res.status(404).json({ error: 'Version not found' });
    res.json(v);
  } catch (err) {
    console.error('[reports] get version:', err);
    res.status(500).json({ error: 'Failed to get version' });
  }
});

export default router;
```

- [ ] **Step 2: Mount in `server/index.js`**

In `server/index.js`, find where other routes are mounted (e.g. `app.use('/api/hub', hubRouter)`). Add:

```js
import reportsRouter from './routes/reports.js';
// ...
app.use('/api/reports', reportsRouter);
```

- [ ] **Step 3: Verify**

```bash
yarn build
lsof -ti:4000 | xargs kill -9 2>/dev/null
yarn server
```

In a second terminal:
```bash
curl -s -H "Authorization: Bearer <admin-jwt>" http://localhost:4000/api/reports/templates
```
Expected: `[]`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/reports.js server/index.js
git commit -m "feat(reports): mount /api/reports CRUD endpoints"
```

---

### Task B9: Add generation endpoints to `routes/reports.js`

**Files:**
- Modify: `server/routes/reports.js`

- [ ] **Step 1: Append generation handlers**

Add these imports at the top of `routes/reports.js`:

```js
import { pool } from '../db.js';
import { hydrateLayout, persistHydratedPayload, markGenerationComplete, markGenerationFailed } from '../services/reports/reportRenderer.js';
import { enqueueGenerationJob } from '../services/reports/queue.js';
import { renderPdf } from '../services/reports/pdfRenderer.js';
```

Append before `export default router`:

```js
router.post('/generations', async (req, res) => {
  try {
    const { template_id, client_ids, filters } = req.body || {};
    if (!template_id) return res.status(400).json({ error: 'template_id required' });
    if (!Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({ error: 'client_ids must be a non-empty array' });
    }

    const tmplRes = await pool.query(`SELECT * FROM report_templates WHERE id = $1`, [template_id]);
    const template = tmplRes.rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const versionRes = await pool.query(
      `SELECT MAX(version) AS v FROM report_template_versions WHERE template_id = $1`,
      [template_id]
    );
    const version = versionRes.rows[0]?.v || 1;

    const { rows } = await pool.query(
      `INSERT INTO report_generations
         (template_id, template_version, client_ids, filters, generated_by, generation_source, status)
       VALUES ($1, $2, $3::uuid[], $4::jsonb, $5, 'manual', 'pending')
       RETURNING id, status`,
      [template_id, version, client_ids, JSON.stringify(filters || {}), req.user.id]
    );
    const gen = rows[0];

    enqueueGenerationJob(async () => {
      try {
        const generation = {
          id: gen.id,
          template_version: version,
          client_ids,
          filters: filters || {},
        };
        const payload = await hydrateLayout({ template, generation });
        await persistHydratedPayload(gen.id, payload);
        const pdfFileId = await renderPdf({ generationId: gen.id, payload, generatedBy: req.user.id });
        await markGenerationComplete(gen.id, pdfFileId);
      } catch (err) {
        console.error('[reports] generation failed:', err);
        await markGenerationFailed(gen.id, err.message || String(err));
      }
    });

    res.status(202).json({ id: gen.id, status: 'pending' });
  } catch (err) {
    console.error('[reports] create generation:', err);
    res.status(500).json({ error: 'Failed to create generation' });
  }
});

router.get('/generations', async (req, res) => {
  try {
    const { template_id, limit = 50 } = req.query;
    const args = [];
    const where = [];
    if (template_id) { args.push(template_id); where.push(`template_id = $${args.length}`); }
    const sql = `
      SELECT g.id, g.template_id, g.template_version, g.client_ids, g.status,
             g.error_message, g.description, g.pdf_file_id, g.generated_by,
             g.generation_source, g.generated_at, g.completed_at, t.name AS template_name
      FROM report_generations g
      LEFT JOIN report_templates t ON t.id = g.template_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY g.generated_at DESC
      LIMIT ${parseInt(limit, 10) || 50}`;
    const { rows } = await pool.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error('[reports] list generations:', err);
    res.status(500).json({ error: 'Failed to list generations' });
  }
});

router.get('/generations/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM report_generations WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[reports] get generation:', err);
    res.status(500).json({ error: 'Failed to get generation' });
  }
});

router.get('/generations/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.pdf_file_id, f.content, f.mime_type
       FROM report_generations g
       LEFT JOIN file_uploads f ON f.id = g.pdf_file_id
       WHERE g.id = $1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row?.pdf_file_id || !row.content) {
      return res.status(404).json({ error: 'PDF not available' });
    }
    res.setHeader('Content-Type', row.mime_type || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.id}.pdf"`);
    res.send(row.content);
  } catch (err) {
    console.error('[reports] download generation:', err);
    res.status(500).json({ error: 'Failed to download' });
  }
});
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

(Note: this references `renderPdf` which is created in Section C. Build will succeed because the import path is valid; the import will resolve once C2 lands.)

- [ ] **Step 3: Commit**

```bash
git add server/routes/reports.js
git commit -m "feat(reports): add generation create/list/get/download endpoints"
```

---

## Section C — Puppeteer + PDF rendering

### Task C1: Update Dockerfile with Chromium system libs

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Inspect current Dockerfile**

```bash
cat Dockerfile
```

- [ ] **Step 2: Add Chromium dependencies**

After the `FROM node:` line and any existing `apt-get` install (or add a fresh `apt-get` block if there isn't one), add:

```dockerfile
# Chromium runtime libraries (required by @sparticuz/chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libgbm1 \
    libgtk-3-0 \
    libxss1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Verify locally that the image still builds**

```bash
docker build -t anchor-hub-test . 2>&1 | tail -30
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "chore(reports): install Chromium runtime libs in Docker image"
```

---

### Task C2: Implement `pdfRenderer.js`

**Files:**
- Create: `server/services/reports/pdfRenderer.js`

- [ ] **Step 1: Write the renderer**

```js
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { PDFDocument } from 'pdf-lib';
import { pool } from '../db.js';
import { mintRenderToken } from './signedToken.js';

let browserPromise = null;
let activePages = 0;
let idleTimer = null;
const IDLE_MS = 5 * 60 * 1000;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
      defaultViewport: { width: 816, height: 1056 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  return browserPromise;
}

function bumpActive() {
  activePages += 1;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function dropActive() {
  activePages -= 1;
  if (activePages <= 0) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      try {
        if (browserPromise) {
          const b = await browserPromise;
          await b.close();
          browserPromise = null;
        }
      } catch (err) { console.error('[reports.pdf] browser close:', err); }
    }, IDLE_MS);
  }
}

const PAGE_DIMS = {
  letter_portrait:  { w: 816,  h: 1056 },
  letter_landscape: { w: 1056, h: 816 },
};

export async function renderPdf({ generationId, payload, generatedBy }) {
  const baseUrl = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
  const token = mintRenderToken(generationId);
  const url = `${baseUrl}/internal/report-render/${generationId}?token=${encodeURIComponent(token)}`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  bumpActive();

  try {
    const pageSize = payload.page_size || 'letter_portrait';
    const dims = PAGE_DIMS[pageSize] || PAGE_DIMS.letter_portrait;
    await page.setViewport({ width: dims.w, height: dims.h, deviceScaleFactor: 2 });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction('window.__REPORT_READY__ === true', { timeout: 30000 });

    const pageCount = (payload.pages || []).length;
    const pdfDoc = await PDFDocument.create();

    for (let idx = 0; idx < pageCount; idx++) {
      const elementHandle = await page.$(`[data-page-index="${idx}"]`);
      if (!elementHandle) continue;
      const buf = await page.pdf({
        printBackground: true,
        width: `${dims.w}px`,
        height: `${dims.h}px`,
        pageRanges: `${idx + 1}`,
      });
      const sub = await PDFDocument.load(buf);
      const copied = await pdfDoc.copyPages(sub, sub.getPageIndices());
      copied.forEach((p) => pdfDoc.addPage(p));
    }

    const finalBytes = pageCount > 0
      ? await pdfDoc.save()
      : await page.pdf({ printBackground: true, width: `${dims.w}px`, height: `${dims.h}px` });

    const fileRow = await pool.query(
      `INSERT INTO file_uploads (uploaded_by, filename, mime_type, size_bytes, content)
       VALUES ($1, $2, 'application/pdf', $3, $4)
       RETURNING id`,
      [generatedBy, `report-${generationId}.pdf`, finalBytes.length, Buffer.from(finalBytes)]
    );
    return fileRow.rows[0].id;
  } finally {
    await page.close();
    dropActive();
  }
}
```

Note: confirm the actual `file_uploads` schema columns before relying on them — adjust column names in the INSERT to match.

- [ ] **Step 2: Verify the file_uploads schema**

```bash
psql postgresql://bif@localhost:5432/anchor -c "\d file_uploads"
```

If column names differ, update the INSERT in `pdfRenderer.js` accordingly.

- [ ] **Step 3: Verify build**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/services/reports/pdfRenderer.js
git commit -m "feat(reports): Puppeteer PDF renderer with browser pool and page-by-page snapshot"
```

---

### Task C3: Implement the internal render route

**Files:**
- Create: `server/services/reports/internalRenderRoute.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write the route handler**

```js
import { pool } from '../db.js';
import { verifyRenderToken } from './signedToken.js';

export function mountInternalRenderRoute(app) {
  app.get('/internal/report-render/:id', async (req, res) => {
    const { id } = req.params;
    const token = req.query.token;
    const result = verifyRenderToken(token, id);
    if (!result.ok) {
      return res.status(401).send(`Invalid token: ${result.reason}`);
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, hydrated_payload FROM report_generations WHERE id = $1`,
        [id]
      );
      const gen = rows[0];
      if (!gen || !gen.hydrated_payload) {
        return res.status(404).send('Generation not found or not hydrated');
      }

      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Report ${id}</title>
    <link rel="stylesheet" href="/assets/index.css" />
    <style>
      html, body { margin: 0; padding: 0; background: #fff; }
      [data-page-index] { page-break-after: always; }
      [data-page-index]:last-child { page-break-after: auto; }
    </style>
  </head>
  <body>
    <div id="report-root"></div>
    <script>window.__REPORT_DATA__ = ${JSON.stringify(gen.hydrated_payload).replace(/</g, '\\u003c')};</script>
    <script type="module" src="/assets/report-renderer.js"></script>
  </body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      console.error('[reports] internal render route:', err);
      res.status(500).send('Render failed');
    }
  });
}
```

Note: the `<script src="/assets/report-renderer.js">` and `<link href="/assets/index.css">` paths need to resolve to a built React bundle. In dev (Vite), these will need to be served differently — see C5 for the dev-mode shim.

- [ ] **Step 2: Mount the route in `server/index.js`**

```js
import { mountInternalRenderRoute } from './services/reports/internalRenderRoute.js';
// ...
mountInternalRenderRoute(app);
```

Place this BEFORE other middleware that requires auth, since this route uses signed-token auth.

- [ ] **Step 3: Verify build**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/services/reports/internalRenderRoute.js server/index.js
git commit -m "feat(reports): add /internal/report-render/:id route"
```

---

### Task C4: Build the React renderer entry point

**Files:**
- Create: `src/views/admin/AdminHub/reports/ReportRendererPage.jsx`
- Create: `src/report-renderer-entry.jsx`
- Modify: `vite.config.mjs`
- Modify: `src/views/admin/AdminHub/reports/widgets/registry.js` (will be created in D2 — placeholder for now)

- [ ] **Step 1: Create a tiny placeholder registry**

Create `src/views/admin/AdminHub/reports/widgets/registry.js`:

```js
const REGISTRY = {};

export function registerWidget(spec) {
  REGISTRY[spec.type] = spec;
}

export function getWidget(type) {
  return REGISTRY[type] || null;
}

export function listWidgets() {
  return Object.values(REGISTRY);
}
```

- [ ] **Step 2: Create `ReportRendererPage.jsx`**

```jsx
import React from 'react';
import { getWidget } from './widgets/registry';

function PageChromeBand({ chrome, side, payload, pageNumber, pageCount }) {
  if (!chrome?.[side]?.enabled) return null;
  const cfg = chrome[side];
  return (
    <div style={{
      position: 'absolute',
      [side === 'header' ? 'top' : 'bottom']: 0,
      left: 0,
      right: 0,
      height: cfg.height,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 32px',
      fontSize: 11,
      color: '#666',
      borderBottom: side === 'header' ? '1px solid #eee' : 'none',
      borderTop: side === 'footer' ? '1px solid #eee' : 'none',
    }}>
      {side === 'header' ? (
        <>
          <span>{cfg.show_template_name ? payload.template_name : ''}</span>
          <span>{/* logo placeholder */}</span>
        </>
      ) : (
        <>
          <span>{cfg.show_date_range ? formatRange(payload.filters?.date_range) : ''}</span>
          <span>{cfg.show_page_numbers ? `Page ${pageNumber} of ${pageCount}` : ''}</span>
        </>
      )}
    </div>
  );
}

function formatRange(dr) {
  if (!dr) return '';
  if (dr.from && dr.to) return `${dr.from} – ${dr.to}`;
  return dr.preset || '';
}

function Widget({ widget, mode = 'pdf' }) {
  const spec = getWidget(widget.type);
  if (!spec) {
    return <div style={{ color: '#c00', padding: 8 }}>Unknown widget: {widget.type}</div>;
  }
  const Component = spec.Component;
  return (
    <div style={{
      position: 'absolute',
      left: widget.x, top: widget.y, width: widget.w, height: widget.h,
      overflow: 'hidden',
    }}>
      <Component data={widget.__data} config={widget.props} mode={mode} />
    </div>
  );
}

export default function ReportRendererPage({ payload }) {
  const dims = payload.page_dimensions_px || { w: 816, h: 1056 };
  const pageCount = (payload.pages || []).length;
  React.useEffect(() => {
    const t = setTimeout(() => { window.__REPORT_READY__ = true; }, 200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div>
      {(payload.pages || []).map((p, idx) => (
        <div key={p.id || idx}
             data-page-index={idx}
             style={{
               position: 'relative',
               width: dims.w,
               height: dims.h,
               background: p.background_color || '#fff',
               margin: '0 auto',
             }}>
          <PageChromeBand chrome={payload.page_chrome} side="header" payload={payload} pageNumber={idx + 1} pageCount={pageCount} />
          {(p.widgets || []).map((w) => (
            <Widget key={w.id} widget={w} mode="pdf" />
          ))}
          <PageChromeBand chrome={payload.page_chrome} side="footer" payload={payload} pageNumber={idx + 1} pageCount={pageCount} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create the renderer bundle entry**

Create `src/report-renderer-entry.jsx`:

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import ReportRendererPage from './views/admin/AdminHub/reports/ReportRendererPage';

const payload = window.__REPORT_DATA__;
const root = ReactDOM.createRoot(document.getElementById('report-root'));
root.render(<ReportRendererPage payload={payload} />);
```

- [ ] **Step 4: Add a separate Vite build entry for the renderer bundle**

In `vite.config.mjs`, add a new `rollupOptions.input` entry. Find the existing `build` config and add:

```js
build: {
  rollupOptions: {
    input: {
      main: 'index.html',
      'report-renderer': 'src/report-renderer-entry.jsx',
    },
    output: {
      entryFileNames: (chunk) =>
        chunk.name === 'report-renderer'
          ? 'assets/report-renderer.js'
          : 'assets/[name]-[hash].js',
    },
  },
}
```

(Adapt to whatever the existing config looks like — preserve all existing options.)

- [ ] **Step 5: Verify build**

```bash
yarn build
ls -la dist/assets/report-renderer.js
```

Expected: file exists.

- [ ] **Step 6: Commit**

```bash
git add src/views/admin/AdminHub/reports/ReportRendererPage.jsx src/report-renderer-entry.jsx src/views/admin/AdminHub/reports/widgets/registry.js vite.config.mjs
git commit -m "feat(reports): React renderer entry point and bundle config"
```

---

### Task C5: Serve the report-renderer bundle from Express

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add static-file route for the renderer assets**

Find where other static-file middleware is mounted (e.g. `app.use('/assets', express.static(...))`). Add or extend so `/assets/report-renderer.js` and `/assets/index.css` are served from the build output:

```js
import path from 'path';
// ...
const distAssets = path.join(__dirname, '..', 'dist', 'assets');
app.use('/assets', express.static(distAssets));
```

If a static-mount already exists, ensure it covers the dist/assets folder. In dev, you'll run via `yarn build` first to generate the renderer bundle.

- [ ] **Step 2: Verify**

```bash
yarn build
lsof -ti:4000 | xargs kill -9 2>/dev/null
yarn server &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/assets/report-renderer.js
```

Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(reports): serve report renderer bundle from /assets"
```

---

## Section D — First widget end-to-end (kpi_tile)

### Task D1: Implement `kpiTileFetcher` (real)

**Files:**
- Modify: `server/services/reports/widgetDataFetchers/kpiTile.js`

- [ ] **Step 1: Replace stub with real implementation**

```js
import { pool } from '../../../db.js';
import { fetchUnifiedAnalytics } from '../../analytics/index.js';

const LEAD_METRICS = ['total_leads', 'qualified_leads', 'qualification_rate', 'total_calls', 'total_forms', 'total_sms', 'total_emails'];
const ANALYTICS_METRICS = ['total_spend', 'total_clicks', 'total_impressions', 'ga4_sessions', 'ga4_users', 'cpl', 'roas'];

export async function kpiTileFetcher({ config, filters, clientIds }) {
  const metric = config.metric;
  if (!metric) return { error: 'No metric configured' };

  if (LEAD_METRICS.includes(metric)) {
    return computeLeadMetric(metric, filters, clientIds);
  }
  if (ANALYTICS_METRICS.includes(metric)) {
    return computeAnalyticsMetric(metric, filters, clientIds);
  }
  return { error: `Unknown metric: ${metric}` };
}

async function computeLeadMetric(metric, filters, clientIds) {
  const { resolved_from, resolved_to, lead_sources } = filters;
  const sources = lead_sources && lead_sources.length ? lead_sources : ['call', 'sms', 'form', 'email', 'other'];

  const args = [clientIds, resolved_from, resolved_to, sources];
  const baseWhere = `
    user_id = ANY($1::uuid[])
    AND created_at >= $2::date
    AND created_at < ($3::date + INTERVAL '1 day')
    AND activity_type = ANY($4::text[])
    AND hidden_at IS NULL`;

  if (metric === 'total_leads') {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS v FROM call_logs WHERE ${baseWhere}`, args);
    return { value: rows[0].v };
  }
  if (metric === 'qualified_leads') {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS v FROM call_logs
       WHERE ${baseWhere} AND COALESCE((meta->>'qualified')::boolean, false) = true`,
      args
    );
    return { value: rows[0].v };
  }
  if (metric === 'qualification_rate') {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE((meta->>'qualified')::boolean, false))::float
         / NULLIF(COUNT(*)::float, 0) AS v
       FROM call_logs WHERE ${baseWhere}`,
      args
    );
    return { value: rows[0].v ?? 0, format: 'percent' };
  }
  if (metric === 'total_calls') return countByActivity('call', baseWhere, args);
  if (metric === 'total_forms') return countByActivity('form', baseWhere, args);
  if (metric === 'total_sms')   return countByActivity('sms',  baseWhere, args);
  if (metric === 'total_emails')return countByActivity('email',baseWhere, args);
  return { error: `Unhandled lead metric: ${metric}` };
}

async function countByActivity(activity, baseWhere, args) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS v FROM call_logs WHERE ${baseWhere} AND activity_type = $5`,
    [...args, activity]
  );
  return { value: rows[0].v };
}

async function computeAnalyticsMetric(metric, filters, clientIds) {
  if (clientIds.length !== 1) {
    return { error: 'Analytics metrics require single-client mode' };
  }
  try {
    const data = await fetchUnifiedAnalytics({
      clientId: clientIds[0],
      from: filters.resolved_from,
      to: filters.resolved_to,
    });
    const map = {
      total_spend:       data?.summary?.spend,
      total_clicks:      data?.summary?.clicks,
      total_impressions: data?.summary?.impressions,
      ga4_sessions:      data?.ga4?.sessions,
      ga4_users:         data?.ga4?.users,
      cpl:               data?.summary?.cpl,
      roas:              data?.summary?.roas,
    };
    const v = map[metric];
    if (typeof v !== 'number') return { error: `${metric} unavailable for this period` };
    const format = (metric === 'total_spend' || metric === 'cpl') ? 'currency'
      : metric === 'roas' ? 'ratio' : 'number';
    return { value: v, format };
  } catch (err) {
    return { error: err.message || 'Analytics fetch failed' };
  }
}
```

Note: confirm the actual API of `fetchUnifiedAnalytics` and the shape of `data.summary` — adjust if the existing service returns different field names.

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/widgetDataFetchers/kpiTile.js
git commit -m "feat(reports): implement kpi_tile fetcher"
```

---

### Task D2: Frontend widget files for `kpi_tile`

**Files:**
- Create: `src/views/admin/AdminHub/reports/widgets/kpiTile/KpiTile.jsx`
- Create: `src/views/admin/AdminHub/reports/widgets/kpiTile/KpiTilePropsForm.jsx`
- Create: `src/views/admin/AdminHub/reports/widgets/kpiTile/index.js`

- [ ] **Step 1: Write `KpiTile.jsx`**

```jsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const FORMATTERS = {
  number: (v) => Number(v).toLocaleString(),
  currency: (v) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  percent: (v) => `${(Number(v) * 100).toFixed(1)}%`,
  ratio: (v) => `${Number(v).toFixed(2)}×`,
};

export default function KpiTile({ data, config, mode }) {
  if (mode === 'builder' && (!data || data.__stub)) {
    return (
      <Tile label={config?.label || 'KPI'} value="1,234" placeholder />
    );
  }
  if (data?.error) {
    return <Tile label={config?.label || 'KPI'} value="—" error={data.error} />;
  }
  const fmt = FORMATTERS[data?.format || 'number'] || FORMATTERS.number;
  return <Tile label={config?.label || 'KPI'} value={fmt(data?.value ?? 0)} />;
}

function Tile({ label, value, placeholder, error }) {
  return (
    <Box sx={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      border: placeholder ? '1px dashed #ccc' : '1px solid #e5e5e5',
      borderRadius: 1, p: 1.5, opacity: placeholder ? 0.6 : 1,
    }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', fontSize: 10 }}>
        {label}
      </Typography>
      <Typography variant="h3" sx={{ fontWeight: 600, mt: 0.5 }}>
        {value}
      </Typography>
      {error && <Typography variant="caption" sx={{ color: 'error.main', mt: 0.5 }}>{error}</Typography>}
    </Box>
  );
}
```

- [ ] **Step 2: Write `KpiTilePropsForm.jsx`**

```jsx
import React from 'react';
import { Stack, TextField } from '@mui/material';
import SelectField from 'ui-component/extended/SelectField';

const METRIC_OPTIONS = [
  { value: 'total_leads', label: 'Total Leads' },
  { value: 'qualified_leads', label: 'Qualified Leads' },
  { value: 'qualification_rate', label: 'Qualification Rate' },
  { value: 'total_calls', label: 'Total Calls' },
  { value: 'total_forms', label: 'Total Forms' },
  { value: 'total_sms', label: 'Total SMS' },
  { value: 'total_emails', label: 'Total Emails' },
  { value: 'total_spend', label: 'Total Ad Spend' },
  { value: 'total_clicks', label: 'Total Clicks' },
  { value: 'total_impressions', label: 'Total Impressions' },
  { value: 'ga4_sessions', label: 'GA4 Sessions' },
  { value: 'ga4_users', label: 'GA4 Users' },
  { value: 'cpl', label: 'Cost Per Lead' },
  { value: 'roas', label: 'ROAS' },
];

export default function KpiTilePropsForm({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <Stack spacing={2}>
      <SelectField
        label="Metric"
        value={value.metric || 'total_leads'}
        onChange={(v) => set('metric', v)}
        options={METRIC_OPTIONS}
        required
        fullWidth
      />
      <TextField
        label="Label"
        value={value.label || ''}
        onChange={(e) => set('label', e.target.value)}
        fullWidth
        size="small"
      />
    </Stack>
  );
}
```

- [ ] **Step 3: Write `index.js`**

```js
import KpiTile from './KpiTile';
import KpiTilePropsForm from './KpiTilePropsForm';
import { registerWidget } from '../registry';

registerWidget({
  type: 'kpi_tile',
  label: 'KPI Tile',
  category: 'Metrics',
  defaultSize: { w: 240, h: 120 },
  minSize: { w: 160, h: 80 },
  maxSize: { w: 800, h: 320 },
  defaultProps: { metric: 'total_leads', label: 'Total Leads', filter_override: null },
  Component: KpiTile,
  PropsForm: KpiTilePropsForm,
});

export default true;
```

- [ ] **Step 4: Wire registration into the renderer entry and main app**

Modify `src/report-renderer-entry.jsx` — add an import to register the widget:

```jsx
import './views/admin/AdminHub/reports/widgets/kpiTile';
```

(Place it before the `ReactDOM.createRoot` call.)

- [ ] **Step 5: Verify build**

```bash
yarn build
```

- [ ] **Step 6: Commit**

```bash
git add src/views/admin/AdminHub/reports/widgets/kpiTile/ src/report-renderer-entry.jsx
git commit -m "feat(reports): kpi_tile widget (Component, PropsForm, registration)"
```

---

### Task D3: End-to-end smoke: API-create a template, generate a PDF, download it

**Files:** none

- [ ] **Step 1: Restart server**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
yarn build && yarn server &
sleep 4
```

- [ ] **Step 2: Get an admin JWT**

Using your existing login flow, log in as `jmartin@anchorcorps.com` and copy the JWT from the `/api/auth/login` response. Save it to `$T`:

```bash
T="<paste-jwt>"
```

- [ ] **Step 3: Pick a real client UUID**

```bash
psql postgresql://bif@localhost:5432/anchor -c "SELECT id, name FROM client_profiles LIMIT 3"
```

Save one to `$C`.

- [ ] **Step 4: Create a template**

```bash
curl -s -X POST http://localhost:4000/api/reports/templates \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{
    "name": "Smoke Test Template",
    "layout": {
      "version": 1,
      "page_size": "letter_portrait",
      "page_dimensions_px": {"w": 816, "h": 1056},
      "page_margin_px": 32,
      "page_chrome": {"header": {"enabled": true, "height": 48, "show_template_name": true}, "footer": {"enabled": true, "height": 32, "show_page_numbers": true, "show_date_range": true}},
      "pages": [
        {
          "id": "page-1",
          "background_color": "#FFFFFF",
          "widgets": [
            {"id": "w1", "type": "kpi_tile", "x": 32, "y": 80, "w": 240, "h": 120, "z": 1,
             "props": {"metric": "total_leads", "label": "Total Leads"}}
          ]
        }
      ]
    },
    "filters_default": {"date_range": {"preset": "last_30_days"}, "lead_sources": ["call","sms","form","email","other"]}
  }'
```

Save the returned `id` to `$TID`.

- [ ] **Step 5: Generate a report**

```bash
curl -s -X POST http://localhost:4000/api/reports/generations \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"template_id\":\"$TID\",\"client_ids\":[\"$C\"],\"filters\":{}}"
```

Save returned `id` to `$GID`.

- [ ] **Step 6: Poll for completion**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  S=$(curl -s -H "Authorization: Bearer $T" http://localhost:4000/api/reports/generations/$GID | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")
  echo "$i: $S"
  [ "$S" = "complete" ] && break
  [ "$S" = "failed" ] && break
  sleep 2
done
```

Expected: ends with `complete`.

- [ ] **Step 7: Download the PDF**

```bash
curl -s -o /tmp/report.pdf -H "Authorization: Bearer $T" http://localhost:4000/api/reports/generations/$GID/download
file /tmp/report.pdf
open /tmp/report.pdf
```

Expected: opens a PDF showing the KPI tile with a real number for total leads.

- [ ] **Step 8: If anything failed, debug**

Common failure modes:
- Migration didn't run → check `psql ... \d report_templates`
- Build didn't include renderer bundle → check `dist/assets/report-renderer.js`
- Token rejected → check `REPORT_RENDER_SECRET` is set in `.env`
- Puppeteer can't find Chromium → expected on macOS; install Chrome locally and override `executablePath` for local dev (this is a platform-specific concern; document the workaround in the task).

- [ ] **Step 9: Commit a note in plan progress (no code change)**

End-to-end works. Architecture proven.

---

## Section E — Builder UI

### Task E1: Frontend API client

**Files:**
- Create: `src/api/reports.js`

- [ ] **Step 1: Write the client**

```js
import axios from 'utils/axios';

export const reportsApi = {
  listTemplates: async () => (await axios.get('/api/reports/templates')).data,
  getTemplate: async (id) => (await axios.get(`/api/reports/templates/${id}`)).data,
  createTemplate: async (body) => (await axios.post('/api/reports/templates', body)).data,
  updateTemplate: async (id, patch) => (await axios.patch(`/api/reports/templates/${id}`, patch)).data,
  archiveTemplate: async (id) => (await axios.delete(`/api/reports/templates/${id}`)).data,
  duplicateTemplate: async (id) => (await axios.post(`/api/reports/templates/${id}/duplicate`)).data,
  listVersions: async (id) => (await axios.get(`/api/reports/templates/${id}/versions`)).data,
  getVersion: async (id, version) => (await axios.get(`/api/reports/templates/${id}/versions/${version}`)).data,

  createGeneration: async (body) => (await axios.post('/api/reports/generations', body)).data,
  listGenerations: async (params) => (await axios.get('/api/reports/generations', { params })).data,
  getGeneration: async (id) => (await axios.get(`/api/reports/generations/${id}`)).data,
  downloadGeneration: async (id) => {
    const res = await axios.get(`/api/reports/generations/${id}/download`, { responseType: 'blob' });
    return res.data;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/reports.js
git commit -m "feat(reports): frontend axios client"
```

---

### Task E2: Routes for builder list / builder

**Files:**
- Modify: `src/routes/MainRoutes.jsx`

- [ ] **Step 1: Add routes**

Find the existing AdminHub routes. Add:

```jsx
const ReportsList = Loadable(lazy(() => import('views/admin/AdminHub/reports/ReportsList')));
const ReportBuilder = Loadable(lazy(() => import('views/admin/AdminHub/reports/ReportBuilder')));
```

In the routes array (under the AdminRoute wrapper), add:

```jsx
{ path: 'admin/reports', element: <ReportsList /> },
{ path: 'admin/reports/new', element: <ReportBuilder /> },
{ path: 'admin/reports/:id', element: <ReportBuilder /> },
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/MainRoutes.jsx
git commit -m "feat(reports): add /admin/reports routes"
```

---

### Task E3: ReportsList view

**Files:**
- Create: `src/views/admin/AdminHub/reports/ReportsList.jsx`

- [ ] **Step 1: Write the list view**

```jsx
import React, { useEffect, useState } from 'react';
import { Box, Button, Stack, Chip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import MainCard from 'ui-component/cards/MainCard';
import DataTable from 'ui-component/extended/DataTable';
import LoadingButton from 'ui-component/extended/LoadingButton';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { reportsApi } from 'api/reports';
import MigrationBanner from './MigrationBanner';

export default function ReportsList() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [templates, setTemplates] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [t, g] = await Promise.all([reportsApi.listTemplates(), reportsApi.listGenerations({ limit: 50 })]);
      setTemplates(t);
      setGenerations(g);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to load reports', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleArchive = async (id) => {
    try {
      await reportsApi.archiveTemplate(id);
      showToast('Template archived', 'success');
      refresh();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to archive', 'error');
    }
  };

  const handleDuplicate = async (id) => {
    try {
      const dup = await reportsApi.duplicateTemplate(id);
      showToast('Template duplicated', 'success');
      navigate(`/admin/reports/${dup.id}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to duplicate', 'error');
    }
  };

  const handleDownload = async (id) => {
    try {
      const blob = await reportsApi.downloadGeneration(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `report-${id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast('Download failed', 'error');
    }
  };

  return (
    <Stack spacing={3}>
      <MigrationBanner />
      <MainCard
        title="Report Templates"
        secondary={
          <Button variant="contained" onClick={() => navigate('/admin/reports/new')}>
            New Template
          </Button>
        }
      >
        {templates.length === 0 && !loading ? (
          <EmptyState
            title="No templates yet"
            message="Create a report template to get started."
            action={<Button variant="contained" onClick={() => navigate('/admin/reports/new')}>New Template</Button>}
          />
        ) : (
          <DataTable
            rowKey="id"
            loading={loading}
            rows={templates}
            columns={[
              { id: 'name', label: 'Name' },
              { id: 'updated_at', label: 'Last Modified', render: (r) => new Date(r.updated_at).toLocaleString() },
              { id: 'schedule', label: 'Schedule', render: (r) => r.schedule ? <Chip size="small" label={r.schedule.freq} /> : <Chip size="small" label="On-demand" variant="outlined" /> },
              { id: 'actions', label: '', render: (r) => (
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => navigate(`/admin/reports/${r.id}`)}>Edit</Button>
                  <Button size="small" onClick={() => handleDuplicate(r.id)}>Duplicate</Button>
                  <Button size="small" color="error" onClick={() => handleArchive(r.id)}>Archive</Button>
                </Stack>
              )},
            ]}
            onRowClick={(r) => navigate(`/admin/reports/${r.id}`)}
          />
        )}
      </MainCard>

      <MainCard title="Recent Generations">
        {generations.length === 0 && !loading ? (
          <EmptyState title="No reports generated yet" message="Generate a report from a template to see it here." />
        ) : (
          <DataTable
            rowKey="id"
            loading={loading}
            rows={generations}
            columns={[
              { id: 'template_name', label: 'Template' },
              { id: 'client_ids', label: 'Clients', render: (r) => r.client_ids?.length || 0 },
              { id: 'generated_at', label: 'Generated', render: (r) => new Date(r.generated_at).toLocaleString() },
              { id: 'status', label: 'Status', render: (r) => <StatusChip status={r.status} /> },
              { id: 'actions', label: '', render: (r) => (
                r.status === 'complete' && r.pdf_file_id ? (
                  <Button size="small" onClick={() => handleDownload(r.id)}>Download</Button>
                ) : null
              )},
            ]}
          />
        )}
      </MainCard>
    </Stack>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/reports/ReportsList.jsx
git commit -m "feat(reports): admin reports list view"
```

---

### Task E4: MigrationBanner component (placeholder)

**Files:**
- Create: `src/views/admin/AdminHub/reports/MigrationBanner.jsx`

- [ ] **Step 1: Write the banner**

```jsx
import React, { useState } from 'react';
import { Alert, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const STORAGE_KEY = 'reports_migration_banner_dismissed_v1';

export default function MigrationBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');
  if (dismissed) return null;
  const close = () => { localStorage.setItem(STORAGE_KEY, '1'); setDismissed(true); };
  return (
    <Alert
      severity="info"
      action={
        <IconButton size="small" onClick={close}><CloseIcon fontSize="small" /></IconButton>
      }
    >
      We rebuilt Reports. Your templates have been migrated — please review them and adjust layouts as needed.
    </Alert>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/AdminHub/reports/MigrationBanner.jsx
git commit -m "feat(reports): migration banner with dismiss"
```

---

### Task E5: Layout and undo/redo hooks

**Files:**
- Create: `src/views/admin/AdminHub/reports/utils/layoutHelpers.js`
- Create: `src/views/admin/AdminHub/reports/hooks/useUndoRedo.js`
- Create: `src/views/admin/AdminHub/reports/hooks/useReportDraft.js`

- [ ] **Step 1: Write `layoutHelpers.js`**

```js
import { nanoid } from 'nanoid';

export const PAGE_DIMS = {
  letter_portrait:  { w: 816, h: 1056 },
  letter_landscape: { w: 1056, h: 816 },
};

export const GRID = 8;

export function snap(v) { return Math.round(v / GRID) * GRID; }

export function emptyLayout() {
  return {
    version: 1,
    page_size: 'letter_portrait',
    page_dimensions_px: PAGE_DIMS.letter_portrait,
    page_margin_px: 32,
    page_chrome: {
      header: { enabled: true, height: 48, show_logo: true, show_template_name: true },
      footer: { enabled: true, height: 32, show_page_numbers: true, show_date_range: true },
    },
    pages: [{ id: nanoid(), background_color: '#FFFFFF', widgets: [] }],
  };
}

export function newWidget(spec) {
  return {
    id: nanoid(),
    type: spec.type,
    x: 32, y: 80,
    w: spec.defaultSize.w, h: spec.defaultSize.h,
    z: 1,
    props: { ...(spec.defaultProps || {}) },
  };
}

export function clampToPage(widget, dims, margin) {
  const maxX = dims.w - widget.w - margin;
  const maxY = dims.h - widget.h - margin;
  return {
    ...widget,
    x: Math.max(margin, Math.min(widget.x, maxX)),
    y: Math.max(margin, Math.min(widget.y, maxY)),
  };
}
```

- [ ] **Step 2: Write `useUndoRedo.js`**

```js
import { useCallback, useReducer } from 'react';

const LIMIT = 50;

function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return {
        past: [...state.past.slice(-LIMIT), state.present].filter(Boolean),
        present: action.value,
        future: [],
      };
    case 'undo': {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future] };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest };
    }
    case 'reset':
      return { past: [], present: action.value, future: [] };
    default:
      return state;
  }
}

export function useUndoRedo(initial) {
  const [state, dispatch] = useReducer(reducer, { past: [], present: initial, future: [] });
  const set = useCallback((v) => dispatch({ type: 'set', value: typeof v === 'function' ? v(state.present) : v }), [state.present]);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((v) => dispatch({ type: 'reset', value: v }), []);
  return {
    value: state.present,
    set, undo, redo, reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
```

- [ ] **Step 3: Write `useReportDraft.js`**

```js
import { useEffect, useRef } from 'react';

const KEY = (id) => `report_template_draft_${id || 'new'}`;
const INTERVAL = 5000;

export function useReportDraft(id, draft) {
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    const t = setInterval(() => {
      try {
        localStorage.setItem(KEY(id), JSON.stringify({ at: Date.now(), draft: latest.current }));
      } catch (_) { /* quota / private mode — silent */ }
    }, INTERVAL);
    return () => clearInterval(t);
  }, [id]);
}

export function loadDraft(id) {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.draft || null;
  } catch (_) { return null; }
}

export function clearDraft(id) {
  try { localStorage.removeItem(KEY(id)); } catch (_) {}
}
```

- [ ] **Step 4: Commit**

```bash
git add src/views/admin/AdminHub/reports/utils/ src/views/admin/AdminHub/reports/hooks/
git commit -m "feat(reports): layout helpers + undo/redo + draft autosave hooks"
```

---

### Task E6: Canvas + WidgetWrapper + PageNavigator

**Files:**
- Create: `src/views/admin/AdminHub/reports/canvas/Canvas.jsx`
- Create: `src/views/admin/AdminHub/reports/canvas/WidgetWrapper.jsx`
- Create: `src/views/admin/AdminHub/reports/canvas/PageNavigator.jsx`

- [ ] **Step 1: Write `WidgetWrapper.jsx`**

```jsx
import React from 'react';
import { Rnd } from 'react-rnd';
import { Box } from '@mui/material';
import { getWidget } from '../widgets/registry';
import { snap, GRID } from '../utils/layoutHelpers';

export default function WidgetWrapper({ widget, selected, onChange, onSelect }) {
  const spec = getWidget(widget.type);
  if (!spec) return null;
  const Component = spec.Component;
  return (
    <Rnd
      size={{ width: widget.w, height: widget.h }}
      position={{ x: widget.x, y: widget.y }}
      bounds="parent"
      dragGrid={[GRID, GRID]}
      resizeGrid={[GRID, GRID]}
      minWidth={spec.minSize.w}
      minHeight={spec.minSize.h}
      maxWidth={spec.maxSize.w}
      maxHeight={spec.maxSize.h}
      onDragStop={(_, d) => onChange({ ...widget, x: snap(d.x), y: snap(d.y) })}
      onResizeStop={(_, __, ref, ___, pos) => onChange({
        ...widget,
        x: snap(pos.x), y: snap(pos.y),
        w: snap(parseInt(ref.style.width, 10)),
        h: snap(parseInt(ref.style.height, 10)),
      })}
      onMouseDown={(e) => { e.stopPropagation(); onSelect(widget.id); }}
      style={{ outline: selected ? '2px solid #1976d2' : '1px dashed transparent', zIndex: widget.z || 1 }}
    >
      <Box sx={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <Component data={null} config={widget.props} mode="builder" />
      </Box>
    </Rnd>
  );
}
```

- [ ] **Step 2: Write `Canvas.jsx`**

```jsx
import React from 'react';
import { Box } from '@mui/material';
import WidgetWrapper from './WidgetWrapper';

export default function Canvas({ page, dims, zoom = 1, selectedId, onChangeWidget, onSelectWidget, onClickEmpty }) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: dims.w,
        height: dims.h,
        background: page.background_color || '#fff',
        boxShadow: 3,
        margin: '0 auto',
        transform: `scale(${zoom})`,
        transformOrigin: 'top center',
        backgroundImage: 'linear-gradient(#f3f3f3 1px, transparent 1px), linear-gradient(90deg, #f3f3f3 1px, transparent 1px)',
        backgroundSize: '8px 8px',
      }}
      onMouseDown={() => onClickEmpty?.()}
    >
      {(page.widgets || []).map((w) => (
        <WidgetWrapper
          key={w.id}
          widget={w}
          selected={selectedId === w.id}
          onChange={onChangeWidget}
          onSelect={onSelectWidget}
        />
      ))}
    </Box>
  );
}
```

- [ ] **Step 3: Write `PageNavigator.jsx`**

```jsx
import React from 'react';
import { Box, Button, Stack, Tooltip, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

export default function PageNavigator({ pages, currentIndex, onSelect, onAdd, onDelete }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, justifyContent: 'center' }}>
      {pages.map((p, i) => (
        <Box
          key={p.id}
          onClick={() => onSelect(i)}
          sx={{
            cursor: 'pointer',
            p: 0.5, px: 1.5,
            border: i === currentIndex ? '2px solid #1976d2' : '1px solid #ccc',
            borderRadius: 1,
            fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 1,
          }}
        >
          Page {i + 1}
          {pages.length > 1 && (
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(i); }}>
              <DeleteIcon fontSize="inherit" />
            </IconButton>
          )}
        </Box>
      ))}
      <Tooltip title="Add page">
        <Button startIcon={<AddIcon />} size="small" onClick={onAdd}>Add Page</Button>
      </Tooltip>
    </Stack>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/views/admin/AdminHub/reports/canvas/
git commit -m "feat(reports): canvas, draggable widget wrapper, page navigator"
```

---

### Task E7: Palette

**Files:**
- Create: `src/views/admin/AdminHub/reports/Palette.jsx`

- [ ] **Step 1: Write the palette**

```jsx
import React from 'react';
import { Box, Typography, Button, Stack, Divider } from '@mui/material';
import { listWidgets } from './widgets/registry';

export default function Palette({ onAdd }) {
  const widgets = listWidgets();
  const grouped = widgets.reduce((acc, w) => {
    (acc[w.category] ||= []).push(w);
    return acc;
  }, {});
  const order = ['Metrics', 'Leads', 'Paid Ads', 'Narrative', 'Layout'];
  return (
    <Box sx={{ width: 240, p: 2, borderRight: '1px solid #eee', height: '100%', overflowY: 'auto' }}>
      <Typography variant="overline">Widgets</Typography>
      {order.filter((c) => grouped[c]?.length).map((cat) => (
        <Box key={cat} sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{cat}</Typography>
          <Stack spacing={0.5}>
            {grouped[cat].map((w) => (
              <Button
                key={w.type}
                variant="outlined"
                size="small"
                fullWidth
                onClick={() => onAdd(w)}
                sx={{ justifyContent: 'flex-start' }}
              >
                {w.label}
              </Button>
            ))}
          </Stack>
        </Box>
      ))}
      <Divider sx={{ mt: 2 }} />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        Click a widget to add it to the current page.
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/AdminHub/reports/Palette.jsx
git commit -m "feat(reports): widget palette grouped by category"
```

---

### Task E8: PropertiesPanel

**Files:**
- Create: `src/views/admin/AdminHub/reports/PropertiesPanel.jsx`

- [ ] **Step 1: Write the panel**

```jsx
import React from 'react';
import { Box, Stack, Typography, TextField, Button, Switch, FormControlLabel, Divider } from '@mui/material';
import SelectField from 'ui-component/extended/SelectField';
import { getWidget } from './widgets/registry';

const PRESETS = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
];
const PAGE_SIZES = [
  { value: 'letter_portrait', label: 'Letter — Portrait' },
  { value: 'letter_landscape', label: 'Letter — Landscape' },
];

export default function PropertiesPanel({
  template, draft, selectedWidget,
  onUpdateTemplate, onUpdateLayout, onUpdateWidget, onDuplicate, onDelete,
}) {
  if (selectedWidget) {
    return <WidgetPanel widget={selectedWidget} onUpdate={onUpdateWidget} onDuplicate={onDuplicate} onDelete={onDelete} />;
  }
  return <TemplatePanel template={template} draft={draft} onUpdateTemplate={onUpdateTemplate} onUpdateLayout={onUpdateLayout} />;
}

function WidgetPanel({ widget, onUpdate, onDuplicate, onDelete }) {
  const spec = getWidget(widget.type);
  if (!spec) return null;
  const PropsForm = spec.PropsForm;
  return (
    <Box sx={{ width: 320, p: 2, borderLeft: '1px solid #eee', height: '100%', overflowY: 'auto' }}>
      <Typography variant="overline">{spec.label}</Typography>
      <Stack spacing={2} sx={{ mt: 2 }}>
        <PropsForm value={widget.props || {}} onChange={(props) => onUpdate({ ...widget, props })} />
        <Divider />
        <Typography variant="caption" color="text.secondary">Position</Typography>
        <Stack direction="row" spacing={1}>
          <TextField label="X" size="small" type="number" value={widget.x}
            onChange={(e) => onUpdate({ ...widget, x: parseInt(e.target.value, 10) || 0 })} />
          <TextField label="Y" size="small" type="number" value={widget.y}
            onChange={(e) => onUpdate({ ...widget, y: parseInt(e.target.value, 10) || 0 })} />
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField label="W" size="small" type="number" value={widget.w}
            onChange={(e) => onUpdate({ ...widget, w: parseInt(e.target.value, 10) || 0 })} />
          <TextField label="H" size="small" type="number" value={widget.h}
            onChange={(e) => onUpdate({ ...widget, h: parseInt(e.target.value, 10) || 0 })} />
        </Stack>
        <Divider />
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={onDuplicate}>Duplicate</Button>
          <Button size="small" color="error" onClick={onDelete}>Delete</Button>
        </Stack>
      </Stack>
    </Box>
  );
}

function TemplatePanel({ template, draft, onUpdateTemplate, onUpdateLayout }) {
  return (
    <Box sx={{ width: 320, p: 2, borderLeft: '1px solid #eee', height: '100%', overflowY: 'auto' }}>
      <Typography variant="overline">Template</Typography>
      <Stack spacing={2} sx={{ mt: 2 }}>
        <TextField label="Name" size="small" value={template.name || ''}
          onChange={(e) => onUpdateTemplate({ ...template, name: e.target.value })} />
        <TextField label="Description" size="small" multiline minRows={2} value={template.description || ''}
          onChange={(e) => onUpdateTemplate({ ...template, description: e.target.value })} />
        <SelectField
          label="Page Size"
          value={draft.page_size}
          onChange={(v) => onUpdateLayout({ ...draft, page_size: v, page_dimensions_px: v === 'letter_landscape' ? { w: 1056, h: 816 } : { w: 816, h: 1056 } })}
          options={PAGE_SIZES}
          fullWidth size="small"
        />
        <SelectField
          label="Default Date Range"
          value={template.filters_default?.date_range?.preset || 'last_30_days'}
          onChange={(v) => onUpdateTemplate({
            ...template,
            filters_default: { ...(template.filters_default || {}), date_range: { preset: v } },
          })}
          options={PRESETS}
          fullWidth size="small"
        />
        <FormControlLabel
          control={<Switch checked={!!draft.page_chrome?.header?.enabled}
            onChange={(e) => onUpdateLayout({
              ...draft,
              page_chrome: {
                ...(draft.page_chrome || {}),
                header: { ...(draft.page_chrome?.header || {}), enabled: e.target.checked },
              },
            })}
          />}
          label="Page header"
        />
        <FormControlLabel
          control={<Switch checked={!!draft.page_chrome?.footer?.enabled}
            onChange={(e) => onUpdateLayout({
              ...draft,
              page_chrome: {
                ...(draft.page_chrome || {}),
                footer: { ...(draft.page_chrome?.footer || {}), enabled: e.target.checked },
              },
            })}
          />}
          label="Page footer"
        />
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/AdminHub/reports/PropertiesPanel.jsx
git commit -m "feat(reports): properties panel for template + selected widget"
```

---

### Task E9: GenerateDialog

**Files:**
- Create: `src/views/admin/AdminHub/reports/GenerateDialog.jsx`

- [ ] **Step 1: Write the dialog**

```jsx
import React, { useEffect, useState } from 'react';
import { Stack, Autocomplete, TextField, Chip } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { reportsApi } from 'api/reports';
import axios from 'utils/axios';

const PRESETS = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
];
const SOURCES = ['call', 'sms', 'form', 'email', 'other'];

export default function GenerateDialog({ open, template, onClose, onCreated }) {
  const { showToast } = useToast();
  const [clients, setClients] = useState([]);
  const [selectedClients, setSelectedClients] = useState([]);
  const [preset, setPreset] = useState(template?.filters_default?.date_range?.preset || 'last_30_days');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sources, setSources] = useState(template?.filters_default?.lead_sources || SOURCES);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await axios.get('/api/hub/clients');
        setClients(res.data || []);
      } catch (err) {
        showToast('Failed to load clients', 'error');
      }
    })();
  }, [open, showToast]);

  const submit = async () => {
    if (selectedClients.length === 0) { showToast('Select at least one client', 'warning'); return; }
    const dateRange = preset === 'custom'
      ? (from && to ? { from, to } : null)
      : { preset };
    if (!dateRange) { showToast('Custom range needs from/to', 'warning'); return; }

    setLoading(true);
    try {
      const gen = await reportsApi.createGeneration({
        template_id: template.id,
        client_ids: selectedClients.map((c) => c.id),
        filters: { date_range: dateRange, lead_sources: sources },
      });
      showToast('Report queued — you will be notified when it is ready', 'success');
      onCreated?.(gen);
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Generation failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormDialog
      open={open} title="Generate Report"
      onClose={onClose} onSubmit={submit}
      submitLabel="Generate" loading={loading}
    >
      <Stack spacing={2}>
        <Autocomplete
          multiple
          options={clients}
          value={selectedClients}
          onChange={(_, v) => setSelectedClients(v)}
          getOptionLabel={(c) => c.name || c.email || c.id}
          renderInput={(params) => <TextField {...params} label="Clients" size="small" />}
          renderTags={(value, getTagProps) =>
            value.map((c, i) => <Chip {...getTagProps({ index: i })} label={c.name || c.id} key={c.id} />)
          }
        />
        <SelectField label="Date Range" value={preset} onChange={setPreset} options={PRESETS} fullWidth size="small" />
        {preset === 'custom' && (
          <Stack direction="row" spacing={1}>
            <TextField label="From" type="date" size="small" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="To" type="date" size="small" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
          </Stack>
        )}
        <Autocomplete
          multiple options={SOURCES} value={sources}
          onChange={(_, v) => setSources(v)}
          renderInput={(params) => <TextField {...params} label="Lead Sources" size="small" />}
          renderTags={(value, getTagProps) => value.map((s, i) => <Chip {...getTagProps({ index: i })} label={s} key={s} size="small" />)}
        />
      </Stack>
    </FormDialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/AdminHub/reports/GenerateDialog.jsx
git commit -m "feat(reports): generate-report dialog with client/date/source pickers"
```

---

### Task E10: ReportBuilder shell

**Files:**
- Create: `src/views/admin/AdminHub/reports/ReportBuilder.jsx`

- [ ] **Step 1: Write the builder shell**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Typography, Button, IconButton } from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import SaveIcon from '@mui/icons-material/Save';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from 'contexts/ToastContext';
import LoadingButton from 'ui-component/extended/LoadingButton';
import Palette from './Palette';
import PropertiesPanel from './PropertiesPanel';
import Canvas from './canvas/Canvas';
import PageNavigator from './canvas/PageNavigator';
import GenerateDialog from './GenerateDialog';
import { reportsApi } from 'api/reports';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useReportDraft } from './hooks/useReportDraft';
import { emptyLayout, newWidget, PAGE_DIMS } from './utils/layoutHelpers';
import { nanoid } from 'nanoid';

import './widgets/kpiTile';
// More widget registrations imported in Section F

export default function ReportBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [template, setTemplate] = useState({ name: '', description: '', filters_default: {} });
  const layoutState = useUndoRedo(emptyLayout());
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  useReportDraft(id || 'new', { template, layout: layoutState.value });

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const t = await reportsApi.getTemplate(id);
        setTemplate({ id: t.id, name: t.name, description: t.description, filters_default: t.filters_default || {}, schedule: t.schedule });
        layoutState.reset(t.layout);
      } catch (err) {
        showToast(err.response?.data?.error || 'Failed to load template', 'error');
      }
    })();
  }, [id]);

  const dims = layoutState.value.page_dimensions_px || PAGE_DIMS.letter_portrait;
  const currentPage = layoutState.value.pages[pageIndex] || layoutState.value.pages[0];
  const selectedWidget = useMemo(() => currentPage?.widgets.find((w) => w.id === selectedId), [currentPage, selectedId]);

  const updateLayout = (newLayout) => layoutState.set(newLayout);

  const updatePage = (mutator) => {
    const layout = layoutState.value;
    const next = {
      ...layout,
      pages: layout.pages.map((p, i) => (i === pageIndex ? mutator(p) : p)),
    };
    layoutState.set(next);
  };

  const addWidget = (spec) => {
    updatePage((p) => ({ ...p, widgets: [...p.widgets, newWidget(spec)] }));
  };

  const updateWidget = (next) => {
    updatePage((p) => ({ ...p, widgets: p.widgets.map((w) => (w.id === next.id ? next : w)) }));
  };

  const duplicateWidget = () => {
    if (!selectedWidget) return;
    const dup = { ...selectedWidget, id: nanoid(), x: selectedWidget.x + 16, y: selectedWidget.y + 16 };
    updatePage((p) => ({ ...p, widgets: [...p.widgets, dup] }));
    setSelectedId(dup.id);
  };

  const deleteWidget = () => {
    if (!selectedWidget) return;
    updatePage((p) => ({ ...p, widgets: p.widgets.filter((w) => w.id !== selectedWidget.id) }));
    setSelectedId(null);
  };

  const addPage = () => {
    const layout = layoutState.value;
    const next = { ...layout, pages: [...layout.pages, { id: nanoid(), background_color: '#FFFFFF', widgets: [] }] };
    layoutState.set(next);
    setPageIndex(layout.pages.length);
  };

  const deletePage = (i) => {
    const layout = layoutState.value;
    if (layout.pages.length <= 1) return;
    const next = { ...layout, pages: layout.pages.filter((_, idx) => idx !== i) };
    layoutState.set(next);
    setPageIndex(Math.min(pageIndex, next.pages.length - 1));
  };

  const save = async () => {
    if (!template.name) { showToast('Name required', 'warning'); return; }
    setSaving(true);
    try {
      const body = {
        name: template.name,
        description: template.description,
        layout: layoutState.value,
        filters_default: template.filters_default,
        default_client_id: template.default_client_id,
        schedule: template.schedule,
      };
      let saved;
      if (id) {
        saved = await reportsApi.updateTemplate(id, body);
      } else {
        saved = await reportsApi.createTemplate(body);
        navigate(`/admin/reports/${saved.id}`, { replace: true });
      }
      showToast('Saved', 'success');
      setTemplate((t) => ({ ...t, ...saved }));
    } catch (err) {
      showToast(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); layoutState.undo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); layoutState.redo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
      else if (e.key === 'Delete' && selectedWidget) { deleteWidget(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Box sx={{ height: 'calc(100vh - 88px)', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ p: 1, borderBottom: '1px solid #eee' }}>
        <Button onClick={() => navigate('/admin/reports')}>◀ Back</Button>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>{template.name || 'Untitled Template'}</Typography>
        <IconButton onClick={layoutState.undo} disabled={!layoutState.canUndo}><UndoIcon /></IconButton>
        <IconButton onClick={layoutState.redo} disabled={!layoutState.canRedo}><RedoIcon /></IconButton>
        <LoadingButton variant="contained" loading={saving} onClick={save} startIcon={<SaveIcon />}>Save</LoadingButton>
        {id && <Button onClick={() => setGenerateOpen(true)}>Generate…</Button>}
      </Stack>
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Palette onAdd={addWidget} />
        <Box sx={{ flexGrow: 1, overflow: 'auto', p: 4, background: '#f8f8f8' }}>
          <Canvas
            page={currentPage}
            dims={dims}
            selectedId={selectedId}
            onSelectWidget={setSelectedId}
            onChangeWidget={updateWidget}
            onClickEmpty={() => setSelectedId(null)}
          />
          <PageNavigator
            pages={layoutState.value.pages}
            currentIndex={pageIndex}
            onSelect={setPageIndex}
            onAdd={addPage}
            onDelete={deletePage}
          />
        </Box>
        <PropertiesPanel
          template={template} draft={layoutState.value}
          selectedWidget={selectedWidget}
          onUpdateTemplate={setTemplate}
          onUpdateLayout={updateLayout}
          onUpdateWidget={updateWidget}
          onDuplicate={duplicateWidget}
          onDelete={deleteWidget}
        />
      </Box>
      <GenerateDialog open={generateOpen} template={{ ...template, id }} onClose={() => setGenerateOpen(false)} />
    </Box>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Smoke test in browser**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
yarn server &
yarn start
```

Navigate to `http://localhost:3000/admin/reports`. Verify:
- List view loads with empty state
- "New Template" → builder loads with empty page
- Add KPI Tile from palette → appears on canvas
- Drag/resize works, snaps to grid
- Properties panel shows widget metric/label
- Save → returns to list, template appears
- Open template again → state persists

- [ ] **Step 4: Commit**

```bash
git add src/views/admin/AdminHub/reports/ReportBuilder.jsx
git commit -m "feat(reports): builder shell with palette, canvas, properties, undo/redo, save"
```

---

### Task E11: Add Reports tab to AnalyticsDashboard

**Files:**
- Modify: `src/views/admin/AnalyticsDashboard/index.jsx`

- [ ] **Step 1: Replace the legacy ReportsTab import with a redirect**

In `src/views/admin/AnalyticsDashboard/index.jsx`, find the existing import of `ReportsTab` and the tab list. Replace the Reports tab's content with a navigation link or a thin component that redirects to `/admin/reports`.

```jsx
import { useNavigate } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';

function ReportsRedirect() {
  const navigate = useNavigate();
  React.useEffect(() => { navigate('/admin/reports', { replace: true }); }, [navigate]);
  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography>Redirecting to Reports…</Typography>
    </Box>
  );
}
```

Replace the tab body's `<ReportsTab />` with `<ReportsRedirect />`. Remove the `import ReportsTab from './ReportsTab'` line.

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/index.jsx
git commit -m "feat(reports): retarget AnalyticsDashboard Reports tab to /admin/reports"
```

---

## Section F — Remaining 7 widgets

Each task in this section follows the same pattern: replace the stub fetcher and create three frontend files. The widget-component code is similar in shape; only data and rendering differ.

### Task F1: `lead_source_breakdown`

**Files:**
- Modify: `server/services/reports/widgetDataFetchers/leadSourceBreakdown.js`
- Create: `src/views/admin/AdminHub/reports/widgets/leadSourceBreakdown/{LeadSourceBreakdown.jsx, LeadSourceBreakdownPropsForm.jsx, index.js}`

- [ ] **Step 1: Implement backend fetcher**

```js
// leadSourceBreakdown.js
import { pool } from '../../../db.js';

export async function leadSourceBreakdownFetcher({ filters, clientIds }) {
  const { resolved_from, resolved_to, lead_sources } = filters;
  const sources = lead_sources && lead_sources.length ? lead_sources : ['call','sms','form','email','other'];
  const { rows } = await pool.query(
    `SELECT activity_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE((meta->>'qualified')::boolean, false))::int AS qualified
     FROM call_logs
     WHERE user_id = ANY($1::uuid[])
       AND created_at >= $2::date
       AND created_at < ($3::date + INTERVAL '1 day')
       AND activity_type = ANY($4::text[])
       AND hidden_at IS NULL
     GROUP BY activity_type
     ORDER BY total DESC`,
    [clientIds, resolved_from, resolved_to, sources]
  );
  return {
    rows: rows.map((r) => ({
      source: r.activity_type,
      total: r.total,
      qualified: r.qualified,
      qualified_rate: r.total > 0 ? r.qualified / r.total : 0,
    })),
  };
}
```

- [ ] **Step 2: Frontend component**

```jsx
// LeadSourceBreakdown.jsx
import React from 'react';
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

const STUB = { rows: [
  { source: 'call', total: 87, qualified: 41, qualified_rate: 0.471 },
  { source: 'form', total: 54, qualified: 22, qualified_rate: 0.407 },
  { source: 'sms', total: 12, qualified: 7, qualified_rate: 0.583 },
]};

export default function LeadSourceBreakdown({ data, config, mode }) {
  const view = mode === 'builder' ? STUB : (data || { rows: [] });
  if (data?.error) return <Box sx={{ p: 1, color: 'error.main' }}>{data.error}</Box>;
  return (
    <Box sx={{ height: '100%', overflow: 'hidden' }}>
      <Typography variant="overline" sx={{ display: 'block', px: 1, pt: 0.5 }}>Lead Sources</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Source</TableCell><TableCell align="right">Total</TableCell>
            <TableCell align="right">Qualified</TableCell>
            {config?.show_qualified_rate !== false && <TableCell align="right">Qual %</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {view.rows.map((r) => (
            <TableRow key={r.source}>
              <TableCell sx={{ textTransform: 'capitalize' }}>{r.source}</TableCell>
              <TableCell align="right">{r.total}</TableCell>
              <TableCell align="right">{r.qualified}</TableCell>
              {config?.show_qualified_rate !== false && (
                <TableCell align="right">{(r.qualified_rate * 100).toFixed(1)}%</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
```

- [ ] **Step 3: PropsForm**

```jsx
// LeadSourceBreakdownPropsForm.jsx
import React from 'react';
import { Stack, FormControlLabel, Switch } from '@mui/material';

export default function LeadSourceBreakdownPropsForm({ value, onChange }) {
  return (
    <Stack spacing={1}>
      <FormControlLabel
        control={<Switch checked={value.show_qualified_rate !== false}
          onChange={(e) => onChange({ ...value, show_qualified_rate: e.target.checked })} />}
        label="Show qualification rate"
      />
    </Stack>
  );
}
```

- [ ] **Step 4: index.js (registration)**

```js
import LeadSourceBreakdown from './LeadSourceBreakdown';
import LeadSourceBreakdownPropsForm from './LeadSourceBreakdownPropsForm';
import { registerWidget } from '../registry';

registerWidget({
  type: 'lead_source_breakdown',
  label: 'Lead Source Breakdown',
  category: 'Leads',
  defaultSize: { w: 480, h: 240 },
  minSize: { w: 320, h: 160 },
  maxSize: { w: 760, h: 480 },
  defaultProps: { show_qualified_rate: true, filter_override: null },
  Component: LeadSourceBreakdown,
  PropsForm: LeadSourceBreakdownPropsForm,
});

export default true;
```

- [ ] **Step 5: Add registration imports to `ReportBuilder.jsx` and `report-renderer-entry.jsx`**

Append `import './widgets/leadSourceBreakdown';` (relative path adjusted) to both files.

- [ ] **Step 6: Verify and commit**

```bash
yarn build
git add server/services/reports/widgetDataFetchers/leadSourceBreakdown.js src/views/admin/AdminHub/reports/widgets/leadSourceBreakdown/ src/views/admin/AdminHub/reports/ReportBuilder.jsx src/report-renderer-entry.jsx
git commit -m "feat(reports): lead_source_breakdown widget"
```

---

### Task F2: `lead_activity_table`

Same pattern as F1. Backend fetcher pulls recent N rows from `call_logs` with denormalized fields:

```js
// leadActivityTable.js
import { pool } from '../../../db.js';

export async function leadActivityTableFetcher({ config, filters, clientIds }) {
  const limit = Math.min(parseInt(config.limit, 10) || 25, 200);
  const { resolved_from, resolved_to, lead_sources } = filters;
  const sources = lead_sources && lead_sources.length ? lead_sources : ['call','sms','form','email','other'];
  const { rows } = await pool.query(
    `SELECT id, caller_name, caller_phone, activity_type, created_at,
            meta->>'category' AS category,
            (meta->>'star_rating')::int AS star_rating,
            COALESCE((meta->>'qualified')::boolean, false) AS qualified
     FROM call_logs
     WHERE user_id = ANY($1::uuid[])
       AND created_at >= $2::date
       AND created_at < ($3::date + INTERVAL '1 day')
       AND activity_type = ANY($4::text[])
       AND hidden_at IS NULL
     ORDER BY created_at DESC
     LIMIT $5`,
    [clientIds, resolved_from, resolved_to, sources, limit]
  );
  return { rows };
}
```

Frontend component renders a small table; PropsForm exposes `limit`. **Same 6 steps as F1** — implement, register, import in builder + renderer entry, verify, commit.

- [ ] Implement backend fetcher (above)
- [ ] Implement `LeadActivityTable.jsx` (small MUI table: Caller / Source / Date / Category / Stars / Qualified)
- [ ] Implement `LeadActivityTablePropsForm.jsx` (one TextField for `limit`, default 25)
- [ ] Implement `index.js` registering `type: 'lead_activity_table'`, category 'Leads', defaultSize `{ w: 760, h: 320 }`
- [ ] Add imports to `ReportBuilder.jsx` and `report-renderer-entry.jsx`
- [ ] `yarn build` + commit `feat(reports): lead_activity_table widget`

---

### Task F3: `google_ads_campaigns`

Backend fetcher reuses existing `googleAdsAdapter`:

```js
// googleAdsCampaigns.js
import { fetchGoogleAdsCampaigns } from '../../analytics/googleAdsAdapter.js';

export async function googleAdsCampaignsFetcher({ filters, clientIds }) {
  if (clientIds.length !== 1) return { error: 'Single-client only' };
  try {
    const data = await fetchGoogleAdsCampaigns({
      clientId: clientIds[0],
      from: filters.resolved_from,
      to: filters.resolved_to,
    });
    return { rows: data?.campaigns || [] };
  } catch (err) {
    return { error: err.message || 'Google Ads fetch failed' };
  }
}
```

Confirm the actual function name in `googleAdsAdapter.js` and adjust the import. Frontend renders a table: Campaign / Impressions / Clicks / Cost / Conversions / CPL.

- [ ] Implement backend fetcher (above; confirm import name from existing adapter)
- [ ] Implement `GoogleAdsCampaigns.jsx` (small MUI table)
- [ ] Implement `GoogleAdsCampaignsPropsForm.jsx` (one Switch: "Show cost per lead")
- [ ] Implement `index.js` registering `type: 'google_ads_campaigns'`, category 'Paid Ads', defaultSize `{ w: 760, h: 320 }`
- [ ] Add imports to `ReportBuilder.jsx` and `report-renderer-entry.jsx`
- [ ] `yarn build` + commit `feat(reports): google_ads_campaigns widget`

---

### Task F4: `meta_campaigns`

Same pattern as F3, using existing `metaAdapter.js`. Frontend renders Campaign / Impressions / Clicks / Spend / Results / Cost-per-Result.

- [ ] Implement backend fetcher (mirror F3, swap to `fetchMetaCampaigns` or actual export name)
- [ ] Implement frontend component, PropsForm, index.js
- [ ] Add imports
- [ ] `yarn build` + commit `feat(reports): meta_campaigns widget`

---

### Task F5: `ai_insights_text`

Backend fetcher reuses existing AI insights service:

```js
// aiInsightsText.js
import { generateInsights } from '../../analytics/insights.js';

export async function aiInsightsTextFetcher({ config, filters, clientIds }) {
  try {
    const text = await generateInsights({
      clientIds,
      from: filters.resolved_from,
      to: filters.resolved_to,
      tone: config.tone || 'executive',
      length: config.length || 'medium',
    });
    return { text };
  } catch (err) {
    return { error: err.message || 'Insights unavailable' };
  }
}
```

Confirm the actual function name in `insights.js`. Frontend renders the text inside a `<Typography>` block. PropsForm exposes `tone` and `length` selects.

- [ ] Implement backend fetcher (confirm import/export shape)
- [ ] Implement `AiInsightsText.jsx` (Typography body2, whitespace pre-wrap)
- [ ] Implement `AiInsightsTextPropsForm.jsx` (two SelectFields: tone, length)
- [ ] Implement `index.js` (`category: 'Narrative'`, defaultSize `{ w: 760, h: 280 }`)
- [ ] Add imports
- [ ] `yarn build` + commit `feat(reports): ai_insights_text widget`

---

### Task F6: `static_text_block`

No backend data fetch. Fetcher just returns config:

```js
// staticTextBlock.js
export async function staticTextBlockFetcher({ config }) {
  return { title: config.title || '', body: config.body || '' };
}
```

Frontend renders the title (h6) + body (body2). PropsForm has a TextField for title and a multiline TextField for body.

- [ ] Implement fetcher
- [ ] Implement `StaticTextBlock.jsx`
- [ ] Implement `StaticTextBlockPropsForm.jsx`
- [ ] Implement `index.js` (`category: 'Narrative'`, defaultSize `{ w: 480, h: 200 }`)
- [ ] Add imports
- [ ] `yarn build` + commit `feat(reports): static_text_block widget`

---

### Task F7: `page_chrome`

This widget is special — it's not draggable, it's configured at template level (page_chrome JSON in the layout). The widget registry entry exists for completeness but the palette should hide it.

- [ ] **Step 1: Backend fetcher returns config**

```js
// pageChrome.js
export async function pageChromeFetcher({ config }) {
  return { ...config };
}
```

- [ ] **Step 2: Frontend Component (no-op render — handled by ReportRendererPage)**

```jsx
// PageChrome.jsx
export default function PageChrome() { return null; }
```

- [ ] **Step 3: PropsForm**

```jsx
// PageChromePropsForm.jsx
import React from 'react';
import { Stack, Typography } from '@mui/material';
export default function PageChromePropsForm() {
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        Page chrome is configured at the template level (left panel when no widget is selected).
      </Typography>
    </Stack>
  );
}
```

- [ ] **Step 4: index.js — mark `hidden: true` so palette skips it**

```js
import PageChrome from './PageChrome';
import PageChromePropsForm from './PageChromePropsForm';
import { registerWidget } from '../registry';

registerWidget({
  type: 'page_chrome',
  label: 'Page Chrome',
  category: 'Layout',
  hidden: true,
  defaultSize: { w: 0, h: 0 },
  minSize: { w: 0, h: 0 },
  maxSize: { w: 0, h: 0 },
  defaultProps: {},
  Component: PageChrome,
  PropsForm: PageChromePropsForm,
});

export default true;
```

- [ ] **Step 5: Update Palette to filter `hidden: true` widgets**

In `Palette.jsx`, change `const widgets = listWidgets();` to `const widgets = listWidgets().filter((w) => !w.hidden);`.

- [ ] **Step 6: Add imports + verify + commit**

```bash
yarn build
git add server/services/reports/widgetDataFetchers/pageChrome.js src/views/admin/AdminHub/reports/widgets/pageChrome/ src/views/admin/AdminHub/reports/Palette.jsx src/views/admin/AdminHub/reports/ReportBuilder.jsx src/report-renderer-entry.jsx
git commit -m "feat(reports): page_chrome widget (template-level config, palette-hidden)"
```

---

## Section G — Migration, scheduling, cutover

### Task G1: Implement `legacyMigration.js`

**Files:**
- Create: `server/services/reports/legacyMigration.js`

- [ ] **Step 1: Write the translator**

```js
import { pool } from '../../db.js';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';

const MARGIN = 32;
const PAGE = { w: 816, h: 1056 };

const SECTION_TO_WIDGETS = {
  executive_summary: () => ([
    widget('static_text_block', { title: 'Executive Summary', body: '' }, { h: 60 }),
    widget('ai_insights_text', { tone: 'executive', length: 'medium' }, { h: 220 }),
  ]),
  calls_leads: () => ([
    widget('lead_source_breakdown', { show_qualified_rate: true }, { h: 240 }),
    widget('lead_activity_table', { limit: 25 }, { h: 320 }),
    widget('kpi_tile', { metric: 'total_leads', label: 'Total Leads' }, { w: 180, h: 100, sideBySide: 0 }),
    widget('kpi_tile', { metric: 'qualified_leads', label: 'Qualified' },{ w: 180, h: 100, sideBySide: 1 }),
    widget('kpi_tile', { metric: 'total_calls', label: 'Calls' },        { w: 180, h: 100, sideBySide: 2 }),
    widget('kpi_tile', { metric: 'total_forms', label: 'Forms' },        { w: 180, h: 100, sideBySide: 3 }),
  ]),
  meta_ads: () => ([widget('meta_campaigns', {}, { h: 320 })]),
  google_ads: () => ([widget('google_ads_campaigns', {}, { h: 320 })]),
  traffic: () => ([widget('static_text_block', { title: 'Traffic', body: 'GA4 traffic widget coming soon' }, { h: 100 })]),
  insights: () => ([widget('ai_insights_text', { tone: 'analyst', length: 'medium' }, { h: 220 })]),
  comparison: () => [],
};

function widget(type, props, sizeHint = {}) {
  return {
    id: nanoid(),
    type,
    x: MARGIN, y: 0,
    w: sizeHint.w || PAGE.w - MARGIN * 2,
    h: sizeHint.h || 200,
    z: 1,
    props: { ...props, filter_override: null },
    __sideBySide: sizeHint.sideBySide,
  };
}

function layoutSections(sections) {
  const widgets = [];
  let cursorY = 80;
  for (const section of sections) {
    const builder = SECTION_TO_WIDGETS[section];
    if (!builder) continue;
    const built = builder();
    let sideBySideRow = -1;
    let sideBySideX = MARGIN;
    for (const w of built) {
      if (typeof w.__sideBySide === 'number') {
        if (sideBySideRow !== cursorY) { sideBySideRow = cursorY; sideBySideX = MARGIN; }
        widgets.push({ ...w, x: sideBySideX, y: cursorY });
        sideBySideX += w.w + 8;
        if (w.__sideBySide === 3) { cursorY += w.h + 16; sideBySideRow = -1; }
      } else {
        widgets.push({ ...w, y: cursorY });
        cursorY += w.h + 16;
      }
      delete w.__sideBySide;
    }
  }
  return widgets;
}

export async function migrateLegacyTemplates() {
  const { rows: existing } = await pool.query(`SELECT 1 FROM report_templates LIMIT 1`);
  if (existing.length > 0) return { skipped: true };

  const { rows: legacy } = await pool.query(
    `SELECT id, created_by, name, description, config, schedule_frequency, schedule_paused, created_at
     FROM analytics_report_templates`
  );
  let migrated = 0;
  for (const row of legacy) {
    const cfg = row.config || {};
    const sections = Array.isArray(cfg.sections) ? cfg.sections : [];
    const widgets = layoutSections(sections);

    let hasComparison = sections.includes('comparison');
    const description = `${hasComparison ? 'Note: comparison sections from the legacy report were removed in the migration.\n\n' : ''}[Migrated from legacy] ${row.description || ''}`.trim();

    const layout = {
      version: 1,
      page_size: 'letter_portrait',
      page_dimensions_px: PAGE,
      page_margin_px: MARGIN,
      page_chrome: {
        header: { enabled: true, height: 48, show_logo: true, show_template_name: true },
        footer: { enabled: true, height: 32, show_page_numbers: true, show_date_range: true },
      },
      pages: [{ id: nanoid(), background_color: '#FFFFFF', widgets }],
    };

    const filtersDefault = {
      date_range: cfg.date_range || { preset: 'last_30_days' },
      lead_sources: ['call', 'sms', 'form', 'email', 'other'],
    };

    const schedule = row.schedule_frequency && !row.schedule_paused
      ? { freq: row.schedule_frequency, hour: 9, recipients: [] }
      : null;

    const ins = await pool.query(
      `INSERT INTO report_templates
         (name, description, layout, filters_default, default_client_id, schedule, legacy_template_id, created_by, created_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7, $8, $9)
       RETURNING id`,
      [row.name, description, JSON.stringify(layout), JSON.stringify(filtersDefault),
       cfg.client_id || null, schedule ? JSON.stringify(schedule) : null,
       row.id, row.created_by, row.created_at]
    );
    await pool.query(
      `INSERT INTO report_template_versions (template_id, version, layout, filters_default, saved_by)
       VALUES ($1, 1, $2::jsonb, $3::jsonb, $4)`,
      [ins.rows[0].id, JSON.stringify(layout), JSON.stringify(filtersDefault), row.created_by]
    );
    migrated += 1;
  }
  return { migrated };
}

export async function migrateLegacyGenerations(generatedReportsDir) {
  const { rows: legacy } = await pool.query(
    `SELECT g.id, g.template_id, g.format, g.file_path, g.created_at,
            g.client_id, t_new.id AS new_template_id
     FROM analytics_generated_reports g
     LEFT JOIN report_templates t_new ON t_new.legacy_template_id = g.template_id`
  );
  let migrated = 0;
  for (const row of legacy) {
    let pdfFileId = null;
    let description = null;
    try {
      const buf = await fs.readFile(path.join(generatedReportsDir, path.basename(row.file_path)));
      const ins = await pool.query(
        `INSERT INTO file_uploads (uploaded_by, filename, mime_type, size_bytes, content)
         VALUES (NULL, $1, 'application/pdf', $2, $3)
         RETURNING id`,
        [`legacy-report-${row.id}.pdf`, buf.length, buf]
      );
      pdfFileId = ins.rows[0].id;
    } catch (_) {
      description = 'PDF unavailable (legacy file lost during deploy)';
    }
    await pool.query(
      `INSERT INTO report_generations
         (id, template_id, template_version, client_ids, filters, status, description, pdf_file_id, generated_by, generation_source, generated_at, completed_at)
       VALUES ($1, $2, 1, ARRAY[$3]::uuid[], '{}'::jsonb, 'complete', $4, $5, NULL, 'manual', $6, $6)
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.new_template_id, row.client_id, description, pdfFileId, row.created_at]
    );
    migrated += 1;
  }
  return { migrated };
}
```

Adjust column names in the legacy SELECTs to match the actual `analytics_report_templates` / `analytics_generated_reports` schemas — verify with `psql ... \d <table>` first.

- [ ] **Step 2: Wire from `server/index.js`**

Add a runner near the other migrations:

```js
async function maybeRunReportLegacyMigration() {
  try {
    const { migrateLegacyTemplates, migrateLegacyGenerations } = await import('./services/reports/legacyMigration.js');
    const tplResult = await migrateLegacyTemplates();
    if (!tplResult.skipped) {
      console.warn(`[migrations] migrated ${tplResult.migrated} legacy report templates`);
    }
    const genResult = await migrateLegacyGenerations(path.join(__dirname, 'generated-reports'));
    console.warn(`[migrations] migrated ${genResult.migrated} legacy generations`);
  } catch (err) {
    console.error('[migrations] report legacy migration failed:', err);
  }
}
```

Append `await maybeRunReportLegacyMigration();` to the migration chain after `maybeRunReportBuilderMigration`.

- [ ] **Step 3: Verify on a copy of prod or in staging**

(Run locally — confirm migration is idempotent: running twice should not double-write, because the templates check uses "no existing rows".)

- [ ] **Step 4: Commit**

```bash
git add server/services/reports/legacyMigration.js server/index.js
git commit -m "feat(reports): translate legacy templates and PDFs into new schema"
```

---

### Task G2: Implement `scheduler.js`

**Files:**
- Create: `server/services/reports/scheduler.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write the scheduler**

```js
import { pool } from '../../db.js';
import { enqueueGenerationJob } from './queue.js';
import { hydrateLayout, persistHydratedPayload, markGenerationComplete, markGenerationFailed } from './reportRenderer.js';
import { renderPdf } from './pdfRenderer.js';
import { sendEmail } from '../mailgun.js';

function nextRunAt(schedule, fromDate = new Date()) {
  const d = new Date(fromDate);
  const hour = schedule.hour ?? 9;
  d.setHours(hour, 0, 0, 0);
  if (schedule.freq === 'daily') {
    if (d <= fromDate) d.setDate(d.getDate() + 1);
    return d;
  }
  if (schedule.freq === 'weekly') {
    const day = schedule.day_of_week ?? 1; // 0=Sun, 1=Mon
    while (d.getDay() !== day || d <= fromDate) d.setDate(d.getDate() + 1);
    return d;
  }
  if (schedule.freq === 'monthly') {
    const dom = schedule.day_of_month ?? 1;
    d.setDate(dom);
    if (d <= fromDate) d.setMonth(d.getMonth() + 1);
    return d;
  }
  return null;
}

export async function tickScheduler() {
  const { rows } = await pool.query(
    `SELECT * FROM report_templates
     WHERE schedule IS NOT NULL AND is_archived = false
       AND (next_run_at IS NULL OR next_run_at <= NOW())`
  );
  for (const tmpl of rows) {
    try {
      const schedule = tmpl.schedule;
      const recipients = schedule?.recipients || [];
      const clientIds = tmpl.default_client_id ? [tmpl.default_client_id] : [];
      if (clientIds.length === 0) {
        console.warn(`[reports.scheduler] template ${tmpl.id} has no default_client_id; skipping`);
        await pool.query(`UPDATE report_templates SET next_run_at = $1 WHERE id = $2`, [nextRunAt(schedule), tmpl.id]);
        continue;
      }

      const versionRes = await pool.query(`SELECT MAX(version) AS v FROM report_template_versions WHERE template_id = $1`, [tmpl.id]);
      const version = versionRes.rows[0]?.v || 1;

      const ins = await pool.query(
        `INSERT INTO report_generations
           (template_id, template_version, client_ids, filters, generated_by, generation_source, status)
         VALUES ($1, $2, $3::uuid[], $4::jsonb, NULL, 'scheduled', 'pending')
         RETURNING id`,
        [tmpl.id, version, clientIds, JSON.stringify({})]
      );
      const generationId = ins.rows[0].id;

      enqueueGenerationJob(async () => {
        try {
          const generation = { id: generationId, template_version: version, client_ids: clientIds, filters: {} };
          const payload = await hydrateLayout({ template: tmpl, generation });
          await persistHydratedPayload(generationId, payload);
          const pdfFileId = await renderPdf({ generationId, payload, generatedBy: null });
          await markGenerationComplete(generationId, pdfFileId);

          if (recipients.length) {
            const { rows: fileRows } = await pool.query(`SELECT content FROM file_uploads WHERE id = $1`, [pdfFileId]);
            const buffer = fileRows[0]?.content;
            for (const email of recipients) {
              try {
                await sendEmail({
                  to: email,
                  subject: `Report: ${tmpl.name}`,
                  text: `Your scheduled report "${tmpl.name}" is attached.`,
                  attachment: { filename: `${tmpl.name}.pdf`, data: buffer },
                });
              } catch (mailErr) {
                console.error(`[reports.scheduler] mail to ${email} failed:`, mailErr);
              }
            }
          }
        } catch (err) {
          await markGenerationFailed(generationId, err.message);
        }
      });

      await pool.query(`UPDATE report_templates SET next_run_at = $1 WHERE id = $2`, [nextRunAt(schedule), tmpl.id]);
    } catch (err) {
      console.error(`[reports.scheduler] template ${tmpl.id}:`, err);
    }
  }
}
```

Note: confirm the actual export shape of `services/mailgun.js` — adjust the `sendEmail` import to match.

- [ ] **Step 2: Wire cron entry into `server/index.js`**

Find existing `cron.schedule(...)` calls and add:

```js
import { tickScheduler } from './services/reports/scheduler.js';
// ...
cron.schedule('*/15 * * * *', async () => {
  try { await tickScheduler(); } catch (err) { console.error('[reports.scheduler] tick failed:', err); }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/services/reports/scheduler.js server/index.js
git commit -m "feat(reports): scheduled report cron with email delivery"
```

---

### Task G3: Remove legacy report code

**Files to delete:**
- `server/services/analytics/reportGenerator.js`
- `src/views/admin/AnalyticsDashboard/ReportsTab.jsx`
- `server/generated-reports/` (entire directory)

**Files to modify:**
- `server/index.js` — remove import + cron entry for old `reportGenerator`
- `server/routes/analytics.js` — remove `/reports/*` route handlers
- `src/api/analytics.js` — remove old report-related functions

- [ ] **Step 1: Find all references to legacy code**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"
grep -rn "reportGenerator\|ReportsTab\|generated-reports\|/api/analytics/reports" --include="*.js" --include="*.jsx" .
```

- [ ] **Step 2: Remove imports and old cron entries from `server/index.js`**

Find any line referencing `services/analytics/reportGenerator.js` or any cron entry that calls into it; remove them.

- [ ] **Step 3: Remove old report endpoints from `server/routes/analytics.js`**

Open `server/routes/analytics.js` and find all `/reports/*` route handlers (router.get/post/patch/delete). Delete those handlers and any helper functions only they used.

- [ ] **Step 4: Remove old report API client methods from `src/api/analytics.js`**

Find any methods like `listReports`, `createReport`, `generateReport`, etc. Remove them.

- [ ] **Step 5: Delete the legacy files and directory**

```bash
rm server/services/analytics/reportGenerator.js
rm src/views/admin/AnalyticsDashboard/ReportsTab.jsx
rm -rf server/generated-reports/
```

- [ ] **Step 6: Verify build, lint, and run**

```bash
yarn build && yarn lint
lsof -ti:4000 | xargs kill -9 2>/dev/null
yarn server &
sleep 4
curl -s http://localhost:4000/api/reports/templates -H "Authorization: Bearer $T" | head -c 200
```

Expected: build passes, lint passes, new endpoints work.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(reports): remove legacy report engine, routes, UI, and orphan PDFs"
```

---

### Task G4: Add `audit_log` entry for `report_generated`

**Files:**
- Modify: `server/routes/reports.js` (in the generation success path)

- [ ] **Step 1: Add audit logging on completion**

In `server/routes/reports.js`, the queue handler already calls `markGenerationComplete`. Wrap that call (or add immediately after) so an audit log row is written:

```js
await markGenerationComplete(gen.id, pdfFileId);
await pool.query(
  `INSERT INTO audit_log (event_type, user_id, metadata)
   VALUES ('report_generated', $1, $2::jsonb)`,
  [req.user.id, JSON.stringify({ template_id, client_ids, generation_id: gen.id })]
);
```

If `audit_log` has different column names, adjust accordingly. Confirm with `psql ... \d audit_log`.

- [ ] **Step 2: Verify build + commit**

```bash
yarn build
git add server/routes/reports.js
git commit -m "feat(reports): log report_generated to audit_log"
```

---

## Section H — Final verification

### Task H1: Verify build and lint

- [ ] **Step 1: Run both gates**

```bash
yarn build && yarn lint
```

Expected: both pass with no errors.

- [ ] **Step 2: If lint warns about something added in this plan, resolve it by editing the offending file (commonly: unused imports, missing keys in lists, no-undef from missing imports).**

---

### Task H2: Manual smoke test plan

- [ ] **Step 1: Start servers**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
yarn build && yarn server &
yarn start &
```

- [ ] **Step 2: Run each smoke check, confirm result**

| # | Check | Expected |
|---|-------|----------|
| 1 | Navigate to `/admin/reports` | List view loads, empty state for templates |
| 2 | Click "New Template" | Builder loads with single empty page |
| 3 | Drop a `kpi_tile` from palette | Tile appears at default position with stub "1,234" |
| 4 | Drag and resize the tile | Snaps to 8-px grid; stays within page bounds |
| 5 | Open properties panel | Shows metric and label fields; X/Y/W/H numeric inputs |
| 6 | Set tile metric to "qualified_leads" | Updates immediately |
| 7 | Add a second page; reorder pages | Both pages selectable; switching swaps canvas content |
| 8 | Press `Cmd+Z` / `Cmd+Shift+Z` | Undo/redo each action |
| 9 | Press `Cmd+S` | Saves; toast confirms; URL updates with template ID |
| 10 | Reload the page | Layout persists |
| 11 | Click "Generate" | Dialog opens; pick a client; default 30-day range |
| 12 | Submit dialog | Toast: "Report queued"; back to builder |
| 13 | Navigate to list | Recent Generations shows the new row, status flips from pending → running → complete |
| 14 | Click "Download" on the completed row | PDF downloads, opens with the KPI tile populated and page header/footer rendered |
| 15 | Add 3 widgets, change page size to landscape | Confirm modal appears; on confirm, widgets reposition within new bounds |
| 16 | Schedule a template (set `schedule.freq=daily, hour=<current+1>`) | Within the next 15-min cron tick, a new generation appears |
| 17 | Try to generate with 0 clients selected | UI rejects with toast |
| 18 | Migration banner | Shows on first load; dismiss persists across reloads (localStorage) |

- [ ] **Step 3: Address any failures by going back to the relevant task**

---

### Task H3: Final commit and clean

- [ ] **Step 1: Confirm all changes are committed**

```bash
git status
```

Expected: clean working tree.

- [ ] **Step 2: Verify the legacy tables are still present (safety net)**

```bash
psql postgresql://bif@localhost:5432/anchor -c "\dt analytics_report_*"
```

Expected: `analytics_report_templates`, `analytics_report_snapshots`, `analytics_generated_reports` still exist (will be dropped in a follow-up after one release cycle, per spec §7 step 6).

- [ ] **Step 3: Push (do not force, do not push to main without review)**

```bash
git push -u origin <branch>
```

Phase 1 complete.

---

## Self-review notes (post-write)

- **Spec coverage:** Every section in the spec maps to a task. §2 architecture → A/B/C/D/E layout; §3 data model → A2; §4 widget framework → B3, D2, F1–F7; §5 builder UX → E1–E11; §6 generation pipeline → B6–B9, C1–C5; §7 migration → G1, G3; §8 phasing — Phase 1 only (Phase 2 is a follow-up plan); §9 security → B1 (signed token), C3 (auth bypass at internal route), G4 (audit log); §10 testing → H1, H2; §11 edge cases — covered in builder (page-size confirm, empty-client validation, error widgets render in error box); §12 out of scope honored (no charts, no comparison, no client portal).

- **Type consistency:** `mintRenderToken` / `verifyRenderToken` consistent. `enqueueGenerationJob` consistent across queue and routes. `hydrateLayout`, `persistHydratedPayload`, `markGenerationComplete`, `markGenerationFailed` consistent across reportRenderer, queue handler, scheduler. `registerWidget` / `getWidget` / `listWidgets` consistent across registry, palette, canvas, renderer page.

- **Adjustments engineer must confirm at runtime:**
  - Actual columns of `file_uploads` table (Task C2 step 2)
  - Actual exported function name from `googleAdsAdapter.js`, `metaAdapter.js`, `insights.js`, `mailgun.js` (Task F3, F4, F5, G2)
  - Actual columns of `audit_log` table (Task G4)
  - Actual columns of `analytics_report_templates`, `analytics_generated_reports` (Task G1) — schema may differ from migrate_analytics_reports.sql snapshot
