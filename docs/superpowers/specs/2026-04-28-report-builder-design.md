# Report Builder Design

**Date:** 2026-04-28
**Status:** Spec approved, awaiting implementation plan
**Replaces:** Existing analytics report engine (`services/analytics/reportGenerator.js`, `views/admin/AnalyticsDashboard/ReportsTab.jsx`, `analytics_report_templates`, `analytics_generated_reports`)

---

## 1. Overview

Replace the current fixed-section analytics report engine with a unified, widget-based report builder. Admins design report templates on a fixed-page canvas with absolute positioning, save them as reusable assets, and generate per-client PDFs that exactly match the on-screen layout.

The new builder serves all reporting needs in a single tool — lead reports (calls / SMS / forms / emails / other), paid-ad reports, traffic reports, and full mixed reports — with no parallel systems.

### Goals

- Interactive widget-based builder with absolute positioning, drag/resize, multi-page support
- Reusable templates that apply to any client (templates are client-agnostic; client is selected at generation time)
- Single-source-of-truth rendering: dashboard view and PDF are the same React render
- Lead segregation by `activity_type` (call / sms / form / email / other) at template, generation, or per-widget level
- Standard date-range presets and custom ranges
- Replace the existing report engine cleanly with a hard cut and 1:1 migration

### Non-goals

- Comparison widgets (period-over-period). Removed from the new system; existing comparison sections drop during migration.
- Charts in PDFs. Per requirements, no chart visualizations anywhere — all "trend" data renders as tables.
- In-dashboard PDF preview. PDFs download; the live dashboard view is the interactive equivalent.
- Client-side report builder. Admins/staff only. (Client-portal viewing is a possible v2.)
- Dual-rendering widgets (chart in browser, table in PDF). Single rendering codebase only.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend (React, src/views/admin/AdminHub/reports/)                 │
│                                                                     │
│  ReportTemplatesList ── ReportBuilder ── ReportViewer               │
│        │                  │                  │                      │
│        │                  │ react-rnd canvas │                      │
│        │                  │ widget palette   │                      │
│        │                  │ props panel      │                      │
│        ▼                  ▼                  ▼                      │
│  src/api/reports.js (axios client)                                  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Backend (server/routes/reports.js  +  server/services/reports/)     │
│                                                                     │
│  routes/reports.js          ─►  CRUD on templates                   │
│                             ─►  POST /generate                      │
│                             ─►  POST /preview-data                  │
│                                                                     │
│  services/reports/                                                  │
│    ├─ templateStore.js      (DB CRUD, JSON validation)              │
│    ├─ widgetRegistry.js     (widget type → data fetcher)            │
│    ├─ widgetDataFetchers/   (one per widget type)                   │
│    ├─ reportRenderer.js     (orchestrates: fetch widget data,       │
│    │                         hydrate JSON, return single payload)   │
│    ├─ pdfRenderer.js        (Puppeteer pool, screenshots → PDF)     │
│    ├─ queue.js              (in-process FIFO, max concurrency 2)    │
│    └─ scheduler.js          (cron, replaces old scheduler)          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                          │
│                                                                     │
│  report_templates           (NEW)                                   │
│  report_generations         (NEW)                                   │
│  report_template_versions   (NEW)                                   │
│  call_logs, ctm_forms, …    (existing data sources, untouched)      │
│  file_uploads               (PDFs stored as BYTEA)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Architectural principles

1. **The template is just JSON.** Builder, dashboard view, and PDF renderer all consume the same hydrated JSON. Widgets never know about PDF vs dashboard — only the renderer does.
2. **Widgets are self-contained.** A widget = `{ React component, server data fetcher, JSON schema for props, default size }`. Adding a widget = one server file + one client file, auto-registered.
3. **PDF renderer is a thin shell.** `pdfRenderer.js` does not know about widgets. It opens an internal URL, waits for `window.__REPORT_READY__`, and screenshots each page.
4. **Data hydration is server-side, once.** All widget fetchers run in parallel server-side; results attach to the template JSON; one hydrated payload renders to both dashboard and PDF.
5. **Scheduling reuses existing cron infrastructure** in `server/index.js`.
6. **Reports tab placement.** New code lives at `src/views/admin/AdminHub/reports/`. The navigation tab stays inside the AnalyticsDashboard (replacing the existing Reports tab there) for admin muscle memory. The legacy `src/views/admin/AnalyticsDashboard/ReportsTab.jsx` is deleted; the AnalyticsDashboard tab list points at the new location.

### Rendering pipeline choice — Puppeteer (headless browser snapshot)

Rejected alternatives:
- **`@react-pdf/renderer`**: requires every widget written twice (browser + PDF variants); high drift risk over time.
- **`pdfkit` (status quo extended)**: even worse — pdfkit is a low-level drawing API, every widget is hand-coded geometry.

Chosen: **Puppeteer with `@sparticuz/chromium`** for the rendering pipeline.
- Single rendering codebase.
- WYSIWYG by construction.
- Each widget is one React component, no PDF variant.
- Compressed Chromium ~50 MB; image bloat is acceptable.
- Cold-start PDF latency ~3–6 sec, warm ~1–2 sec. Cloud Run min memory bumps to 1 GiB.
- Sandbox flags: `--no-sandbox --disable-dev-shm-usage --disable-gpu --single-process` (required for Cloud Run gVisor).

---

## 3. Data model

### Tables (new)

```sql
CREATE TABLE report_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT,
  layout          JSONB NOT NULL,
  filters_default JSONB NOT NULL DEFAULT '{}',
  default_client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  schedule        JSONB,
  legacy_template_id UUID,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_report_templates_active ON report_templates (is_archived, updated_at DESC);

CREATE TABLE report_template_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id     UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  layout          JSONB NOT NULL,
  filters_default JSONB NOT NULL,
  saved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version)
);

CREATE TABLE report_generations (
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
CREATE INDEX idx_report_generations_template ON report_generations (template_id, generated_at DESC);
CREATE INDEX idx_report_generations_status   ON report_generations (status, generated_at)
  WHERE status IN ('pending','running');
```

PDFs go into existing `file_uploads` (BYTEA), per CLAUDE.md gotcha #6 (Cloud Run filesystem ephemeral). Replaces the broken `server/generated-reports/` disk path.

### `layout` JSON schema

```jsonc
{
  "version": 1,
  "page_size": "letter_portrait",
  "page_dimensions_px": { "w": 816, "h": 1056 },
  "page_margin_px": 32,
  "page_chrome": {
    "header": { "enabled": true, "height": 48, "show_logo": true, "show_template_name": true },
    "footer": { "enabled": true, "height": 32, "show_page_numbers": true, "show_date_range": true }
  },
  "pages": [
    {
      "id": "page-1",
      "background_color": "#FFFFFF",
      "widgets": [
        {
          "id": "w-uuid",
          "type": "kpi_tile",
          "x": 32, "y": 32, "w": 240, "h": 120,
          "z": 1,
          "props": {
            "metric": "total_leads",
            "label": "Total Leads",
            "filter_override": null
          }
        }
      ]
    }
  ]
}
```

### `filters_default` shape

```jsonc
{
  "date_range": { "preset": "last_30_days" },
  // OR { "from": "2026-01-01", "to": "2026-01-31" }
  "lead_sources": ["call", "sms", "form", "email", "other"],
  "include_archived_clients": false
}
```

### Filter inheritance order

```
report_generation.filters       ← highest priority (set at gen time)
template.filters_default        ← if no override at gen time
widget.props.filter_override    ← per-widget override on top of either
```

### Why JSONB and not relational widget rows

Layout reads/writes are atomic; we never query "find templates containing widget type X"; versioning is trivial; consistent with existing system patterns.

---

## 4. Widget framework + v1 catalog

### Widget contract

Three artifacts per widget:

```
src/views/admin/AdminHub/reports/widgets/<type>/
  ├─ <Component>.jsx          (props: { data, config, mode })
  ├─ <Component>PropsForm.jsx (MUI form for builder properties panel)
  └─ index.js                 (exports type, defaultSize, propsSchema, defaultProps, propsForm)

server/services/reports/widgetDataFetchers/
  └─ <type>.js                (async (config, filters, clientIds, ctx) => data)
```

Both sides import from a registry:
- `src/views/admin/AdminHub/reports/widgets/registry.js` (frontend)
- `server/services/reports/widgetRegistry.js` (backend)

Registry entry:
```js
{
  type: 'kpi_tile',
  label: 'KPI Tile',
  category: 'Metrics',
  defaultSize: { w: 240, h: 120 },
  minSize: { w: 160, h: 80 },
  maxSize: { w: 800, h: 320 },
  propsSchema: { /* JSON Schema */ },
  defaultProps: { metric: 'total_leads', label: 'Total Leads', filter_override: null }
}
```

### `mode` prop

Widgets receive `mode: 'builder' | 'dashboard' | 'pdf'`. Default render is identical across modes. The prop allows narrow customizations:
- `builder` — empty-state placeholder, dashed border
- `dashboard` — interactive, hover styles
- `pdf` — same as dashboard, but disable interactivity, force inline styles (Puppeteer freezes computed CSS)

### v1 catalog

**Phase 1 — Core 8** (ships together as the new builder's first usable release):

| # | Type | Category | Data source |
|---|------|----------|-------------|
| 1 | `kpi_tile` | Metrics | All — picks a metric from a fixed enum |
| 2 | `lead_source_breakdown` | Leads | `call_logs` grouped by `activity_type` |
| 3 | `lead_activity_table` | Leads | `call_logs` recent N rows |
| 4 | `google_ads_campaigns` | Paid Ads | existing `googleAdsAdapter` |
| 5 | `meta_campaigns` | Paid Ads | existing `metaAdapter` |
| 6 | `ai_insights_text` | Narrative | existing insights service |
| 7 | `static_text_block` | Narrative | n/a |
| 8 | `page_chrome` | Layout | n/a (template-level config; renders on every page) |

KPI tile metric enum: `total_leads`, `qualified_leads`, `qualification_rate`, `total_calls`, `total_forms`, `total_sms`, `total_emails`, `total_spend`, `total_clicks`, `total_impressions`, `ga4_sessions`, `ga4_users`, `cpl`, `roas`.

**Phase 2 — Follow-up 5** (ships 2–3 weeks later, additive):

| # | Type | Category | Data source |
|---|------|----------|-------------|
| 9 | `leads_by_day_table` | Leads | `call_logs` grouped by date |
| 10 | `utm_sources_table` | Attribution | `call_logs.meta` UTM aggregates |
| 11 | `ga4_traffic_summary` | Traffic | existing GA4 adapter |
| 12 | `image` | Layout | uploaded image (`file_uploads`) |
| 13 | `date_range_header` | Layout | n/a |

### Data fetcher composition

Most fetchers are thin wrappers around existing services:
- Lead widgets → `services/analytics/ctmAdapter.js` (`fetchBySource`, `fetchActivity`)
- Ads widgets → `services/analytics/googleAdsAdapter.js`, `services/analytics/metaAdapter.js`
- AI insights → `services/analytics/insights.js`
- GA4 widgets → `services/analytics/ga4Adapter.js`

Most new code is composition, not new data plumbing.

---

## 5. Builder UX

### Layout

Three panes:
- **Left palette (240 px)** — categorized widget list (Metrics / Leads / Paid Ads / Narrative / Layout). Drag into canvas or click to add at top-left.
- **Center canvas** — `react-rnd` absolute-positioning surface at fixed page dimensions (816×1056 px portrait, 1056×816 px landscape). Light 8-px background grid. Zoom 50/75/100/125%. Page navigator below: thumbnail strip + Add Page + drag-to-reorder.
- **Right properties panel (320 px)** — context-aware:
  - Nothing selected → template-level controls (name, description, page size, default filters, page chrome on/off, schedule)
  - Single widget selected → that widget's `propsForm` + position/size numeric inputs + filter override toggle
  - Multi-select → align/distribute controls (left/right/top/bottom, distribute evenly, match width/height)

### Interactions

- Drag widgets freely; snap to 8-px grid (toggle `Cmd+'`)
- Resize via 8 handles; respects registry `minSize`/`maxSize`
- Snap-to-edge guides at 4 px alignment with neighbors and page margins
- Multi-select: `Shift+click` or marquee drag
- Keyboard: arrow nudge 1 px (Shift+arrow = 8 px), `Cmd+D` duplicate, `Delete` remove, `Cmd+Z`/`Cmd+Shift+Z` undo/redo, `Cmd+S` save, `Cmd+G` toggle grid
- Live preview with stub data — every widget renders with sample data so the canvas always looks like a real report

### Save / version flow

- Auto-save to `localStorage` every 5 sec (key: `report_template_draft_<id>`)
- Manual `[Save]` writes to DB and creates a new `report_template_versions` row
- "Last saved" indicator next to title
- Version history drawer accessible from top bar; click a version to load it (read-only, "Restore" button)
- "Discard draft" button reverts to the last saved server version

### Generate dialog

Three controls only:
1. Client(s) — single or multi-select autocomplete (multi enables rollup)
2. Date range — preset dropdown OR custom range (defaults to template's `filters_default`)
3. Lead sources — chip selector (defaults to template default)

`[Generate]` posts to `/api/reports/generations`, closes, shows toast: "Report queued — you'll be notified when it's ready" with a link to the Generations list.

### List view (Reports tab entry point)

Two stacked DataTables:
- **Templates** — name, last modified, schedule status, sections count, [Edit] [Generate] [Duplicate] [Archive]
- **Recent Generations** — template name, client(s), date range, status, generated at, generated by, [View] [Download]

`[+ New Template]` opens the builder with a blank canvas. `[Duplicate]` clones a template.

### Live preview button

`POST /api/reports/preview-data` runs the same `reportRenderer.js` data-fetch path with the current draft layout + filters + a single client; returns the hydrated payload. Builder swaps stub data for real data, no PDF generation, no DB write.

---

## 6. Generation pipeline

### End-to-end flow

```
USER → POST /api/reports/generations → INSERT report_generations (status=pending)
     → enqueue (in-process FIFO, max concurrency 2)
     → reportRenderer.js: parallel widget fetches, per-run cache by (type, hash(filters))
     → INSERT hydrated_payload, status=running
     → pdfRenderer.js:
         mint signed token (HMAC-SHA256, 5-min TTL, REPORT_RENDER_SECRET)
         launch (or reuse pooled) Puppeteer browser
         goto /internal/report-render/:generationId?token=<jwt>
         wait for window.__REPORT_READY__
         per page: setViewport(816,1056) + pdf({ printBackground: true })
         merge per-page PDFs (pdf-lib)
     → INSERT into file_uploads (BYTEA, mime application/pdf)
     → UPDATE generation: pdf_file_id, status=complete, completed_at
     → toast/notification → user; email if recipients defined
```

### Puppeteer setup

- `@sparticuz/chromium` (~50 MB) + `puppeteer-core`
- Dockerfile: `apt-get install -y libnss3 libatk1.0-0 libcups2 libgbm1 …`
- Browser pool: one browser per server process, max 2 concurrent pages, idle browser closes after 5 min
- Memory: ~80–120 MB per idle page; bump Cloud Run min memory to 1 GiB
- Sandbox flags: `--no-sandbox --disable-dev-shm-usage --disable-gpu --single-process`

### Internal render route

```
GET /internal/report-render/:generationId?token=<hmac>
```

- Auth: signed token only (HMAC-SHA256 of `{generationId, exp}`, 5-min TTL, `REPORT_RENDER_SECRET` env var). Not user JWT.
- Serves a stripped-down React shell (no AdminHub layout, no nav, no auth context). Single `<ReportRenderer/>` component with hydrated payload inlined as `<script>window.__REPORT_DATA__=…</script>`.
- All pages stacked vertically with `data-page-index` attributes. PDF renderer screenshots each one by viewport-clipping.
- Sets `window.__REPORT_READY__ = true` once mounted (deterministic — no spinners; all data is in payload).

### Storage

- PDFs into `file_uploads` (BYTEA). `/api/reports/generations/:id/download` validates `isStaff` + role and returns bytes.
- Old `server/generated-reports/` directory is deleted (filesystem ephemeral on Cloud Run).
- Retention: indefinite for v1. v2 candidate: nightly job to prune `report_generations` older than 1 year.

### Scheduling

- Replaces existing scheduled-report cron in `server/index.js`
- One cron entry every 15 min: `SELECT FROM report_templates WHERE schedule IS NOT NULL AND next_run_at <= NOW()`
- On match: enqueue a generation per `client_ids` group, update `next_run_at` from `freq` + `time`
- Email delivery: when generation completes and `schedule.recipients` is non-empty, Mailgun emails the PDF as attachment via `services/mailgun.js`. Per-recipient send (not BCC), templated body.

### Failure modes

| Failure | Handling |
|---------|----------|
| Widget fetcher throws | Catch in `reportRenderer.js`, attach `{error: 'message'}` to widget data, render as small error box. Other widgets succeed. Generation succeeds. |
| All widget fetchers fail | Generation status=failed, error_message stored, no PDF written. User sees in list, can retry. |
| Puppeteer page crashes | Catch in `pdfRenderer.js`, status=failed. Browser instance recycled. |
| Token expired/forged | Internal route returns 401, Puppeteer page errors out, generation marked failed. |
| Cloud Run timeout | Per-request timeout 10 min on `/api/reports/generations` and cron job. Typical render 10–30 sec; 20× safety margin. |

---

## 7. Migration plan

### What exists today

- `analytics_report_templates` — N rows with fixed-section config
- `analytics_generated_reports` — historical PDFs, `file_path` may be broken (Cloud Run ephemeral FS)
- `analytics_report_snapshots` — section data caches
- `services/analytics/reportGenerator.js`, `views/admin/AnalyticsDashboard/ReportsTab.jsx`, `/api/analytics/reports/*` routes, scheduled-report cron entry

### Migration steps (idempotent, run on server boot per existing pattern)

**Step 1 — Create new tables.** `server/sql/migrate_report_builder.sql`. Idempotent (`CREATE TABLE IF NOT EXISTS`).

**Step 2 — Translate legacy templates.** `maybeRunLegacyReportMigration()` in `server/index.js`, guarded by presence check on `report_templates`.

For each `analytics_report_templates` row, build a single-page layout:
- `executive_summary` → `static_text_block` (heading) + `ai_insights_text` below
- `calls_leads` → `lead_source_breakdown` + `lead_activity_table` + 4-tile KPI row (total_leads, qualified_leads, total_calls, total_forms)
- `meta_ads` → `meta_campaigns` widget
- `google_ads` → `google_ads_campaigns` widget
- `traffic` → `static_text_block` placeholder ("GA4 traffic widget coming soon") until Phase 2 ships
- `comparison` → **dropped** with a note in template description: "Note: comparison sections from the legacy report were removed in the migration."
- `insights` → `ai_insights_text` widget

Layout: top-to-bottom column, 8-px grid increments, full-width minus margins.

Translate `config.date_range` → `filters_default.date_range`. Copy `config.client_id` → `default_client_id` (auto-fills Generate dialog). Copy `config.schedule` → `schedule` JSONB. Insert `report_templates` row preserving `created_by` and `created_at`. Description prefixed `[Migrated from legacy]`. Insert `report_template_versions` v1. Store legacy id on `report_templates.legacy_template_id`.

**Step 3 — Preserve generated PDF history.** For each `analytics_generated_reports` row: insert `report_generations` (status=complete, original `generated_at`, `client_ids=[legacy.client_id]`, `template_id` = new migrated template). Read legacy `file_path`: if exists, write to `file_uploads`, set `pdf_file_id`. If missing, set `pdf_file_id=NULL` and `description="PDF unavailable (legacy file lost during deploy)"`. List view shows these as historical records without download.

**Step 4 — Cut over routes and UI.** `routes/reports.js` mounts at `/api/reports`. Old `/api/analytics/reports/*` endpoints removed (not 410'd — fully removed). `src/views/admin/AdminHub/reports/` replaces `ReportsTab.jsx`. The AnalyticsDashboard tab list keeps a "Reports" tab in the same position; it now points at the new component. Old cron entry replaced by `services/reports/scheduler.js`.

**Step 5 — Delete legacy code.** Same PR:
- Delete `server/services/analytics/reportGenerator.js`
- Delete `src/views/admin/AnalyticsDashboard/ReportsTab.jsx`
- Delete `/api/analytics/reports/*` route handlers
- Delete `server/generated-reports/` directory
- Keep `analytics_report_templates`, `analytics_generated_reports`, `analytics_report_snapshots` for one release as safety net; mark deprecated in `init.sql` comments.

**Step 6 — One release later.** New migration `migrate_drop_legacy_report_tables.sql` drops the three legacy tables. Separate deploy after admins confirm everything works.

### Schedule disruption

Scheduled legacy reports fire once on the legacy engine before deploy, then never again. Migrated templates begin firing on the new engine at their next scheduled time.

### Admin-visible changes

- Reports tab leads to new list view
- Top banner (auto-dismiss): "We rebuilt Reports. Your templates have been migrated — please review them and adjust layouts as needed."
- Each migrated template's name preserved; description prefixed `[Migrated from legacy]`
- Generation history shows historical reports with dates intact; surviving PDFs downloadable, lost ones marked unavailable

---

## 8. Phasing

### Phase 1 — Framework + 8 core widgets

Deliverables:
- New DB tables + legacy template migration
- `routes/reports.js`, `services/reports/{templateStore, widgetRegistry, reportRenderer, pdfRenderer, queue, scheduler}.js`
- Puppeteer + Chromium in Cloud Run (Dockerfile + memory bump)
- 8 core widgets
- Builder UX: palette, react-rnd canvas, properties panel, multi-page, version history, undo/redo, generation dialog, list view
- `/internal/report-render/:id` route + signed token
- Migration banner + cutover
- Email delivery for scheduled reports

After Phase 1: legacy is gone, new builder is live.

### Phase 2 — Follow-up 5 widgets

2–3 weeks after Phase 1. Deliverables:
- 5 follow-up widgets (leads_by_day_table, utm_sources_table, ga4_traffic_summary, image, date_range_header)
- Image upload UI (uses existing `file_uploads`)
- Replace "GA4 traffic widget coming soon" placeholders inserted during legacy migration

Phase 2 is purely additive; each widget is a self-contained PR.

---

## 9. Security

| Concern | Mitigation |
|---------|-----------|
| `/internal/report-render/:id` accessible without user JWT | Signed token (HMAC-SHA256, 5-min TTL, server-only mint) |
| Generation contains data from clients the user shouldn't see | Access checked at `/api/reports/generations` POST (`isStaff` + role) |
| PDF download exposes generations to wrong users | `/api/reports/generations/:id/download` checks `isStaff` and role; reports are admin-scope |
| Legacy PDFs in repo | Deleted in migration Step 5 |
| HMAC secret | New `REPORT_RENDER_SECRET` env var (32-byte hex). Set in Cloud Run secrets. Documented in `.env.example`. **Per CLAUDE.md, do not modify `.env` directly.** |
| PHI in widget data → PDF | Same data dashboard already shows. No new PHI surface. Generation events logged to `audit_log` (`event_type: 'report_generated'`, includes template_id, client_ids, user_id) |
| Puppeteer with `--no-sandbox` | Mitigated by: only visits internal route, fully server-controlled HTML, single-tenant per request, browser closed after idle |

---

## 10. Testing strategy

Per CLAUDE.md, no automated test suite exists. Verification = `yarn build` + `yarn lint` + manual smoke testing.

### Build/lint gates (every commit)

- `yarn build` must pass — catches missing imports, JSX errors, registry mis-wirings
- `yarn lint` must pass — catches unused imports, syntax errors

### Manual smoke test plan (in implementation plan)

- Create template from scratch with each widget type
- Drag/resize/multi-select/keyboard nudge
- Save, reload, verify layout persisted
- Version history: save twice, restore version 1
- Generate single-client report → verify PDF matches dashboard
- Generate multi-client rollup → verify each client's data appears
- Schedule a report 2 min in the future → verify email arrives
- Migrate test: load snapshot of `analytics_report_templates`, verify entries appear in new list with correct layouts and prefix
- Failure path: introduce a fetch error in one widget, verify PDF still renders with that widget's error box and others succeed

---

## 11. Edge cases

1. **Empty client portfolio.** 0 client_ids at generation → 400 reject. Multi-client mode requires ≥1; single-client requires exactly 1.
2. **Date range with no data.** KPIs render "0", tables show "No data in this range" empty state. Not an error.
3. **Widget references a missing data source** (e.g., GA4 property deleted). Widget renders error box ("Data source unavailable"); rest of report still generates. Logged server-side.
4. **Long tables overflowing widget bounds.** CSS `overflow: hidden` + "N more rows…" footer if truncated. Users resize the widget to see more. Tables do NOT auto-extend across pages.
5. **Template with many filter overrides.** Per-run cache keyed by `(widget_type, hash(filters))` deduplicates fetches. Generation should remain under 30 sec.
6. **User edits a template that's mid-generation.** Edit allowed (different version). Running generation uses snapshot version; user's edits become a new version, don't affect in-flight render.
7. **Two admins editing simultaneously.** Last-write-wins. No locking. Each save creates a new version; loser's work is recoverable from version history.
8. **Page size change after widgets placed.** Confirmation modal: "Switching page size — widgets outside new bounds will be repositioned. Continue?" On confirm, clamp `x`, `y`, `w`, `h` to fit.

---

## 12. Out of scope

- Comparison widgets (period-over-period)
- Charts of any kind
- In-dashboard PDF preview
- Client-side report builder
- Dual-rendering widgets (chart in browser, table in PDF)
- Exporting to formats other than PDF (no CSV in v1; can be added as a fast-follow if requested)
- Real-time collaborative editing
- Drag-and-drop file upload of background images for canvas (only `image` widget supports uploads in Phase 2)

---

## 13. References

- CLAUDE.md project instructions (HIPAA compliance, gotchas, conventions)
- `server/services/analytics/ctmAdapter.js` — existing lead-data fetch (`fetchBySource`, `fetchActivity`)
- `server/services/analytics/googleAdsAdapter.js`, `metaAdapter.js`, `ga4Adapter.js` — existing ads/traffic adapters
- `server/services/analytics/insights.js` — existing AI insights service
- `server/services/analytics/reportGenerator.js` — legacy engine being replaced
- `src/views/admin/AnalyticsDashboard/ReportsTab.jsx` — legacy UI being replaced
- Cloud Run service config — Phase 1 requires raising the `anchor-hub` Cloud Run service min memory to 1 GiB to accommodate Chromium. Deployment update goes through `scripts/gdeploy.sh` and the GCP Cloud Run console.
