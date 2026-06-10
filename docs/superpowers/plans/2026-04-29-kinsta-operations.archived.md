# Kinsta Operations — Ultra Plan

**Branch:** `feature/operations-tab`
**Started:** 2026-04-28
**Day 1 commit:** `6f2b86e` (2026-04-29)
**Status:** Phase 0/1 backend foundation shipped. Phase 2+ pending.

> **2026-05-05 update (ops-rebuild Phase 0 §2.9):** Portfolio, Client Detail, and the top-level Assistant tab were excised from `OperationsWorkspace/index.jsx`. Those views now live under Analytics only; Operations renders just Sites + Bulk while the new domain model is being built.

This document is the canonical hand-off plan. A new agent should read **§1
(Quick start)** and **§4 (Status)** first, then jump to whichever phase
section matches the next ticket. Every phase includes concrete file paths,
code skeletons, validation steps, and rollback notes so the next agent does
not need to re-explore the codebase.

---

## 1. Quick start (read this first)

You are picking up a multi-week project that ports
`/Volumes/G-DRIVE SSD/DEVELOPER/wp-client-hub` (a Next.js Kinsta SSH manager)
into the Anchor Client Dashboard's `/operations` tab. The integration is the
new "Operations" surface for managing all Kinsta sites + AI agents that act
on them via WP-CLI.

**Do this before writing any code:**

1. `git checkout feature/operations-tab && git pull --rebase`
2. Confirm local Postgres has the import:
   ```bash
   psql "postgresql://bif@localhost:5432/anchor" -c \
     "SELECT count(*) sites, (SELECT count(*) FROM kinsta_environments) envs, (SELECT count(*) FROM kinsta_environments WHERE ssh_password_encrypted IS NOT NULL) with_pwd FROM kinsta_sites;"
   ```
   Expect `132 / 199 / 198`. If empty, run the importer (§4.2).
3. Read **§3 (Architectural decisions)** — these are settled, do not relitigate.
4. Find the next un-checked ticket in **§5 (Phase plan)**, jump to its section.

**What lives where (high-level):**

| Concern | Path |
|---|---|
| Migration | `server/sql/migrate_kinsta_operations.sql` |
| Kinsta API client | `server/services/operations/kinstaApi.js` |
| ssh2 wrapper (shell + exec + sftp) | `server/services/operations/sshClient.js` |
| One-shot importer from wp-client-hub | `scripts/import-wp-client-hub.mjs` |
| Express routes (TBD Phase 2) | `server/routes/operations.js` |
| WebSocket terminal (TBD Phase 2) | `server/ws/operationsTerminal.js` |
| React UI (TBD Phase 3) | `src/views/admin/Operations/` |
| Frontend API client (TBD Phase 3) | `src/api/operations.js` |
| Encryption (already in repo) | `server/services/security/encryption.js` |
| Audit log helper (already in repo) | `server/services/security/audit.js` |

**Do NOT touch (other agent's work):**
`server/routes/reports.js`, `server/services/reports/*`, `src/api/reports.js`,
`src/views/admin/AdminHub/reports/*`, `server/sql/migrate_report_csv_export.sql`.

---

## 2. Goal & non-goals

### Goal
Make `/operations` a unified site management surface that:
1. Lists every Kinsta site (132 today) with main + staging environments —
   regardless of whether a `client_profile` exists in Anchor.
2. Connects to any environment via SSH (xterm) and SFTP (file ops) in the
   browser, with full audit logging.
3. Lets admins associate 0..N Kinsta sites to each Anchor client through the
   admin hub client drawer (one-to-many).
4. Stores per-site `CLAUDE.md` + scan metadata so AI doesn't re-discover the
   site every session.
5. Hosts AI agents (general / Divi / security / SEO) with function-calling
   tools that **execute** WP-CLI over SSH and return results — not just advise.
6. Inherits Anchor's auth/audit/compliance fabric (admin-only, JWT,
   immutable `audit_log`, AES-256-GCM at rest).

### Non-goals (v1)
- Mu-plugin deployment (deferred — revisit after build per user instruction)
- Divi-safe mu-plugin auto-install (deferred)
- Cloud Run egress IP allowlist for Kinsta SSH (defer until it actually breaks)
- Porting the wp-client-hub SEO engine — Anchor has its own analytics stack
- Porting Claude CLI subprocess — we use Vertex Gemini via `services/ai.js`

---

## 3. Architectural decisions (settled — do not relitigate)

| Decision | Rationale |
|---|---|
| **`ssh2` npm lib, not sshpass+node-pty** | Cloud Run has no homebrew. ssh2 is pure JS, includes SFTP, accepts password via config (no env-var-in-spawn dance). |
| **Postgres, not SQLite** | Anchor uses Cloud SQL Postgres. SQLite is local-only. |
| **DB-backed CLAUDE.md / scan_json**, not filesystem | Cloud Run filesystem is ephemeral. Stored in `kinsta_site_workspaces.claude_md` and `.scan_json`. |
| **`ENCRYPTION_KEY`** (Anchor's existing key, colon-format) for at-rest | Anchor's `services/security/encryption.js` already standard. wp-client-hub's `DB_ENCRYPTION_KEY` (concatenated-base64 format) is one-shot for import only. |
| **Admin-only end-to-end** | `requireAuth` + `req.user.role in ('superadmin','admin')`. Every SSH command writes `kinsta_ssh_command_log` + `audit_log`. |
| **One Express server hosts WebSocket** | `/ws/ssh` upgrade on the same port as `/api/*`. No sidecar process. JWT in query string for the upgrade handshake. |
| **Vertex Gemini, not Claude CLI** | Anchor already has `services/ai.js` + audit assistant pattern. Agents are system-prompt + function-calling tool definitions, not subprocesses. |
| **Mutations require explicit confirm** | Every AI tool that mutates (wp post update, plugin update, file write) returns a *proposal*; UI shows a `ConfirmDialog` with the exact command before executing. |
| **Operations tab restructure (Phase 3)** | Today: Portfolio / Client Detail / Assistant. After: Sites (new, primary) / Audits (existing) / Bulk / Assistant. Refactor `OperationsWorkspace/index.jsx` (1,197 lines) into per-tab files. |
| **Single branch** | All work on `feature/operations-tab`. No phase sub-branches. |

---

## 4. Status

### 4.1 What's shipped (commit `6f2b86e`)

- [x] **Schema** — `server/sql/migrate_kinsta_operations.sql` (idempotent, 6 tables)
- [x] **Migration wired** — appended to `.then()` chain in `server/index.js`
- [x] **`server/services/operations/kinstaApi.js`** — axios-based, env-driven; `listAllSites`, `getEnvironmentDetail`, `getSshPassword` (429/5xx exponential backoff), `pushEnvironment`, `getOperationStatus`
- [x] **`server/services/operations/sshClient.js`** — ssh2; `execCommand`, `openShellChannel`, `withSftp`, `wpcli`. Lazy password resolution + cache. Every call writes `kinsta_ssh_command_log`.
- [x] **`scripts/import-wp-client-hub.mjs`** — `--dry-run`, default emits portable SQL, `--apply` direct PG. Idempotent.
- [x] **Local DB loaded** — 132 sites / 199 envs / **198 passwords decrypted, 0 failures** / 17 workspaces. Round-trip verified through Anchor's `decrypt()`.
- [x] **Cloud Run secrets** — `KINSTA_API_KEY`, `KINSTA_USER`, `KINSTA_USER_PASSWORD`, `KINSTA_AGENCY_ID` created, accessor IAM granted to compute SA, bound as env vars on revision `anchor-hub-00434-qll`.
- [x] **Build + lint clean** — no new lint errors from this work
- [x] **Pushed to GitHub** — `feature/operations-tab @ 6f2b86e`

### 4.2 How to repeat the import (idempotent — safe to re-run)

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"

# Required env vars (already in your local .env — never to Secret Manager):
#   DB_ENCRYPTION_KEY  (wp-client-hub's key, hex)
#   ENCRYPTION_KEY     (Anchor's key, hex)

# Local PG:
node scripts/import-wp-client-hub.mjs --apply --dsn="postgresql://bif@localhost:5432/anchor"

# Generate a portable SQL file (gitignored) for prod application:
node scripts/import-wp-client-hub.mjs   # writes data/kinsta-import.sql

# Apply to prod via Cloud SQL Proxy (NOT YET RUN):
cloud-sql-proxy anchor-hub-480305:us-central1:anchor &
node scripts/import-wp-client-hub.mjs --apply --dsn="postgresql://USER:PWD@127.0.0.1:5432/anchor"
```

**Cloud Run note:** The migration auto-runs on next deploy of this branch
because it's in the `maybeRun` chain. The import data only lands when an
admin explicitly runs `--apply` against the proxy DSN.

### 4.3 Open questions / deferred decisions

- Cloud Run → Kinsta SSH egress (port 22). User: "I never had to add any IP for my local dev use." Defer until first connection fails on prod.
- Whether to ship a `divi-safe` mu-plugin globally. Deferred until Phase 6.
- Whether tracking-presence verification should run as a daily drift scan or on-demand. Likely both — see Phase 8.

---

## 5. Phase plan

Each phase has: **scope**, **tickets** (concrete files/changes), **validation**,
**rollback**.

### Phase 2 — Express routes + WebSocket SSH terminal (Day 2)

**Scope:** Backend-only. Expose the data + ssh2 client through HTTP routes
and a WebSocket. No UI yet.

**Tickets:**

- [ ] **2.1** `server/routes/operations.js` — admin-gated Express router.
  Endpoints (all under `/api/operations`):
  ```
  GET    /sites                              list (joined env counts, latest scan, linked clients)
  GET    /sites/:siteId                      detail (envs, workspace, linked clients)
  POST   /sites/sync                         trigger Kinsta API pull-and-upsert
  GET    /sites/:siteId/workspace            read claude_md + scan_json
  PUT    /sites/:siteId/workspace            save claude_md (audit log entry)
  POST   /sites/:siteId/scan                 enqueue discovery scan (Phase 4)
  POST   /sites/:siteId/clients              link client_user_id { relationship, notes }
  DELETE /sites/:siteId/clients/:linkId      unlink
  GET    /environments/:envId                env detail
  POST   /environments/:envId/credentials/refresh   re-pull from Kinsta API
  POST   /environments/:envId/exec           one-shot wpcli (admin, audited)
  GET    /environments/:envId/commands       paginated kinsta_ssh_command_log for env
  ```
  Pattern to follow: `server/routes/analytics.js` for shape; `server/middleware/requireAuth.js` for auth + role gate.

- [ ] **2.2** Mount router in `server/index.js`:
  ```js
  import operationsRouter from './routes/operations.js';
  // ...
  app.use('/api/operations', operationsRouter);
  ```
  Insert after `app.use('/api/analytics', analyticsRouter);`.

- [ ] **2.3** `server/ws/operationsTerminal.js` — WebSocket server.
  - Use `ws` package (already a transitive dep via `ssh2`? add explicit if not).
  - Attach to existing HTTP server: `server.on('upgrade', ...)`.
  - Path: `/ws/ssh`. Query params: `envId`, `token` (JWT).
  - Validate JWT → fetch user → check admin role → look up env → `openShellChannel`.
  - Message types (JSON):
    - Client→server: `{type:'input', data}`, `{type:'resize', rows, cols}`
    - Server→client: `{type:'output', data}`, `{type:'exit', code}`, `{type:'error', message}`
  - Idle timeout: 30 min (reset on input). Hard cap: 4h.
  - On close: write `kinsta_ssh_command_log` row with channel='shell', command_summary = last 200 chars of input buffer (sanitized), exit_code, duration_ms.
  - On disconnect: call `shellHandle.end()`.

- [ ] **2.4** Wire WS upgrade into `server/index.js` after `app.listen(...)`. Pattern:
  ```js
  const httpServer = app.listen(PORT, () => { /* … */ });
  attachOperationsWebSocket(httpServer);   // from ws/operationsTerminal.js
  ```

- [ ] **2.5** `server/middleware/requireAdmin.js` (if not already) or inline check:
  ```js
  function requireAdmin(req, res, next) {
    const role = req.user?.effective_role || req.user?.role;
    if (role !== 'admin' && role !== 'superadmin') {
      return res.status(403).json({ message: 'Admins only' });
    }
    next();
  }
  ```
  Check: maybe already exists in another router (`analytics.js` has `requireAdmin`). Reuse.

**Validation:**
1. `yarn server` boots without error.
2. `curl -H "Authorization: Bearer $JWT" http://localhost:4000/api/operations/sites` returns 132 sites.
3. WebSocket smoke test: write a tiny Node script that connects to `ws://localhost:4000/ws/ssh?envId=<uuid>&token=<jwt>`, sends `{type:'input', data:'whoami\n'}`, expects an `{type:'output', data:'<username>\n'}` reply within 5s.
4. After WS close, `SELECT * FROM kinsta_ssh_command_log ORDER BY created_at DESC LIMIT 1` shows the row.
5. `yarn build` + `yarn lint` clean.

**Rollback:** Comment out the router mount + WS attach. The migration tables can stay; they're inert until the routes use them.

---

### Phase 3 — React Operations tab (Sites + Drawer + Terminal) (Day 3–4)

**Scope:** First-class clickable UI. Refactor `OperationsWorkspace/index.jsx`.

**Tickets:**

- [ ] **3.1** Create directory `src/views/admin/Operations/`. Move and split
  the existing `src/views/admin/OperationsWorkspace/index.jsx` (1,197 lines)
  into:
  ```
  src/views/admin/Operations/
    index.jsx                        tab shell, ~150 lines
    constants.js                     LOOKBACK_OPTIONS, MODEL_OPTIONS, TIMEZONE_OPTIONS, RUN_STATUS_MAP — kill duplicates
    helpers.js                       buildClientLabel, formatDateTime, etc
    Sites/
      SitesTab.jsx                   primary tab (NEW)
      SitesGrid.jsx                  DataTable: name | envs | last scan | linked clients | credential health | actions
      SiteDrawer.jsx                 sub-tab shell: Overview | Terminal | SFTP | Workspace | Linked Clients | History
      SiteOverview.jsx
      SiteTerminal.jsx               xterm + WS hook
      SftpBrowser.jsx                file tree + upload/download
      SiteWorkspaceEditor.jsx        Monaco textarea for claude_md + read-only scan_json
      SiteClientLinks.jsx            manage kinsta_site_clients rows
      SiteCommandHistory.jsx         paginated kinsta_ssh_command_log
    Audits/
      AuditsTab.jsx                  move existing PortfolioPanel + ClientDetail logic here (keep AuditsTab.jsx component)
    Assistant/
      AssistantTab.jsx               re-skin OperationsAssistantPanel; scope-aware (run/site/portfolio)
    Bulk/
      BulkActionsTab.jsx             stub for Phase 7 — render "Coming soon" until then
  ```

- [ ] **3.2** Update route entry in `src/routes/MainRoutes.jsx`:
  ```js
  const OperationsWorkspace = Loadable(lazy(() => import('views/admin/Operations')));
  // path stays /operations
  ```

- [ ] **3.3** `src/api/operations.js` — frontend client matching the §2.1 endpoints. Pattern: `src/api/analytics.js`.
  ```js
  import client from './client';
  export const fetchOperationsSites = () => client.get('/operations/sites').then(r => r.data);
  export const fetchOperationsSite = (id) => client.get(`/operations/sites/${id}`).then(r => r.data);
  export const syncOperationsSites = () => client.post('/operations/sites/sync').then(r => r.data);
  export const fetchSiteWorkspace = (id) => client.get(`/operations/sites/${id}/workspace`).then(r => r.data);
  export const saveSiteWorkspace = (id, body) => client.put(`/operations/sites/${id}/workspace`, body).then(r => r.data);
  export const refreshEnvCredentials = (envId) => client.post(`/operations/environments/${envId}/credentials/refresh`).then(r => r.data);
  export const linkSiteToClient = (id, body) => client.post(`/operations/sites/${id}/clients`, body).then(r => r.data);
  export const unlinkSiteClient = (id, linkId) => client.delete(`/operations/sites/${id}/clients/${linkId}`).then(r => r.data);
  export const fetchEnvCommands = (envId, params) => client.get(`/operations/environments/${envId}/commands`, { params }).then(r => r.data);
  ```

- [ ] **3.4** `src/hooks/useOperationsTerminal.js` — xterm + WS hook.
  - Wraps `xterm.js` + `@xterm/addon-fit` + `@xterm/addon-web-links` (add to deps).
  - Connect to `ws://<host>/ws/ssh?envId=<id>&token=<jwt>`.
  - Handle `output | exit | error` messages.
  - Send `input` on user keypress, `resize` on container resize.
  - Reconnect on close with exponential backoff (cap 4 attempts).

- [ ] **3.5** URL state for `Operations`:
  - `/operations?tab=sites&site=<id>&panel=terminal&env=<envId>`
  - Use existing `useSearchParams` pattern from `OperationsWorkspace/index.jsx`.

- [ ] **3.6** `SitesGrid` columns:
  - Site name + display_name
  - Primary domain (env=live)
  - Env count (`live + 2 staging`)
  - Last scan age (relative time)
  - Linked clients (chip strip)
  - Credential health (green if pwd present + fetched < 30d ago; yellow > 30d; red if null)
  - Actions: Open Drawer, Open Terminal (live env), Trigger Scan
  - `searchable` prop — search by name + domain

**Validation:**
1. `yarn build` succeeds.
2. Navigate `/operations` → Sites tab is default → see 132 rows.
3. Click a site → drawer opens → Terminal sub-tab → xterm boots → type `whoami\n` → see WP user reply.
4. Edit `claude_md` in Workspace tab → save → reload → persists.
5. Link a Kinsta site to a client (from drawer) → confirm row in `kinsta_site_clients`.

**Rollback:** Restore `OperationsWorkspace/index.jsx` from `git show fa859e7:src/views/admin/OperationsWorkspace/index.jsx`. Tables and routes can stay.

---

### Phase 4 — Discovery scan (WP-CLI site introspection) (Day 4)

**Scope:** Per-site WP-CLI scanner that populates `scan_json` + auto-generates
`claude_md` so AI agents have context.

**Tickets:**

- [ ] **4.1** `server/services/operations/siteScanner.js`. Port from
  `/Volumes/G-DRIVE SSD/DEVELOPER/wp-client-hub/src/lib/discovery/scanner.ts`.
  - Run via `wpcli(envId, '...')` from `sshClient.js`:
    - `core version --extra` → WP version, multisite
    - `theme list --status=active --format=json`
    - `plugin list --format=json`
    - `post-type list --format=json`
    - `option get siteurl`
    - `eval 'echo defined("WP_DEBUG") && WP_DEBUG ? 1 : 0;'`
  - Detect Divi: any active theme/parent named like `Divi` → `metadata.is_divi: true`.
  - Compose `scan_json = { wp_version, php_version, multisite, theme, plugins, post_types, debug_flags, scanned_at }`.
  - UPSERT into `kinsta_site_workspaces`, set `last_scan_at = NOW()`, `last_scan_status = 'success'`.

- [ ] **4.2** `server/services/operations/claudeMdTemplate.js`. Port from
  `wp-client-hub/src/lib/discovery/claude-md-template.ts` + `merge.ts`.
  - Render scan results as a markdown CLAUDE.md.
  - Merge: preserve user-edited sections (delimited by `<!-- USER-EDITED -->` markers from previous saves) on regen.

- [ ] **4.3** Wire into route `POST /api/operations/sites/:siteId/scan` from §2.1.
  - Run scan against the live env (`is_live=true`) for the site.
  - Return scan_json + new claude_md.

- [ ] **4.4** Auto-trigger after `POST /api/operations/sites/sync`:
  - For any newly created env where `is_live=true`, queue a scan with
    `setImmediate(() => scanSite(...))`. Errors logged, non-blocking.

- [ ] **4.5** `SiteWorkspaceEditor.jsx` UI:
  - Monaco editor (`@monaco-editor/react` already in deps) for claude_md, language=markdown
  - Read-only collapsed JSON viewer for scan_json
  - "Re-scan" button → calls `POST /scan` → toast on result
  - Show `last_scan_at`, `last_scan_status`, `last_scan_error`

**Validation:**
1. Click "Re-scan" on a known site → toast "Scan complete" within ~10s.
2. Workspace shows non-empty claude_md with site URL, plugin list, theme.
3. Edit claude_md, save, re-scan → user edits preserved.

**Rollback:** Disable the route handler. Existing `claude_md` stays.

---

### Phase 5 — Admin Hub client drawer "Sites" tab (Day 4–5)

**Scope:** Surface Kinsta sites inside a client's admin drawer + provide
linkage UI.

**Tickets:**

- [ ] **5.1** Backend already covered by §2.1 (`POST /sites/:siteId/clients`).
  Add a mirror-route under client API for convenience:
  ```
  GET    /api/hub/clients/:clientId/sites
  POST   /api/hub/clients/:clientId/sites      { siteId, relationship, notes }
  DELETE /api/hub/clients/:clientId/sites/:linkId
  ```
  These can live in `server/routes/hub.js` or in `operations.js` — pick one.
  Recommendation: in `operations.js` to keep all Kinsta logic in one place,
  proxy from `hub.js` via redirect or thin wrapper.

- [ ] **5.2** Add Tab 9 to `AdminHub.jsx` drawer (`src/views/admin/AdminHub.jsx:2248`):
  ```jsx
  <Tab label="Sites" icon={<LanguageIcon />} iconPosition="start" />
  // ...
  {activeTab === 9 && <ClientSitesTab clientId={editing.id} />}
  ```

- [ ] **5.3** `src/views/admin/AdminHub/ClientSitesTab.jsx`:
  - Header: "Connected Kinsta sites for {client name}"
  - Linked sites list with relationship chips ('primary' | 'staging' | 'microsite') + Unlink buttons
  - Autocomplete "Link a Kinsta site" — typeahead from `GET /api/operations/sites?q=…&available=true`
  - Each row: "Open in Operations" → `/operations?tab=sites&site=<id>`

- [ ] **5.4** Extend `fetchClientDetail` in `src/api/clients.js` (or wherever
  it lives) to include `sites: [{ id, name, primary_domain, relationship }]`
  so the Details tab can render a chip strip.

- [ ] **5.5** Server-side tutorial step: add to `tutorials` table if needed
  (admin tutorial walkthrough already exists per `data-tutorial="admin-drawer-tabs"`).

**Validation:**
1. Open a client drawer → Sites tab → empty state.
2. Use autocomplete to link 1 site → row appears with 'primary' chip.
3. Refresh page → row persists.
4. Click "Open in Operations" → deep link works → site drawer is open in Operations.

**Rollback:** Remove the `<Tab>` and conditional render. Backing rows in
`kinsta_site_clients` are fine to leave.

---

### Phase 6 — AI agents with function calling (Day 5–7)

**Scope:** Make the assistant *act* on sites, not just describe them.

**Tickets:**

- [ ] **6.1** Move agent prompts into `server/services/operations/agentPrompts.js`
  as exported strings. Source: `wp-client-hub/data/agent-prompts/{base,divi-expert,wordpress-security,seo-expert}.md`.
  Add an Anchor compliance preface (no PHI in scans, admin-only context, etc.).

- [ ] **6.2** `server/services/operations/opsAssistant.js`. Vertex Gemini chat
  with tools. Pattern: `server/services/analytics/auditAssistant.js`.
  ```js
  const tools = [
    { name: 'wpcli', schema: { command: 'string', env_id: 'uuid' } },
    { name: 'sftp_read', schema: { path: 'string', env_id: 'uuid' } },
    { name: 'sftp_write', schema: { path: 'string', content_b64: 'string', env_id: 'uuid' } },
    { name: 'plugin_list', schema: { env_id: 'uuid' } },
    { name: 'plugin_update', schema: { slug: 'string', env_id: 'uuid', dry_run: 'boolean' } },
    { name: 'list_recent_posts', schema: { env_id: 'uuid', limit: 'integer' } },
    { name: 'verify_tracking_install', schema: { env_id: 'uuid' } },  // tied to user's stated goal
    { name: 'divi_safe_update', schema: { post_id: 'integer', content: 'string', env_id: 'uuid' } },
    { name: 'propose_mutations', schema: { findings: 'array' } }
  ];
  ```
  - Tool execution uses `req.user.id` as the `kinsta_ssh_command_log.user_id` so audit trail attaches to a real human (not the AI).
  - Each tool: `triggered_by = 'agent:<agentType>'`.

- [ ] **6.3** Site context payload (~30KB cap):
  - `claude_md` + `scan_json` from `kinsta_site_workspaces`
  - Last 5 `kinsta_ssh_command_log` entries (sanitized)
  - Current open findings (Phase 8)

- [ ] **6.4** Divi guard middleware `services/operations/diviGuard.js`:
  - For tool `wpcli`, regex-match `wp post update <ID> --post_content=`
  - If the post has `_et_pb_use_builder` meta → refuse + force `divi_safe_update`
  - For now, this means the `divi-safe` mu-plugin *needs* to be present (deferred to Phase 7.4); until then, the guard just refuses without an alternative. Document that.

- [ ] **6.5** `OperationsAssistant.jsx` rebuild (replace existing
  `OperationsAssistantPanel`):
  - Scope dropdown: `run | site | portfolio`
  - When `scope=site`: agent type dropdown (general / Divi / security / SEO)
  - Tool-call rendering: each tool call shows up as an inline card with
    `proposed | running | done | error` status
  - **Mutation approval gate:** any tool that mutates returns
    `{ requires_confirmation: true, command, diff_preview }`. UI shows
    `ConfirmDialog` from `ui-component/extended/ConfirmDialog`. No silent mutations.

- [ ] **6.6** Add a hand-tooled `verify_tracking_install` tool — user explicitly
  called this out as a top-priority use case. It should:
  - SSH-list `wp-content/mu-plugins/`
  - `wp option get blogname`, `wp option get home`
  - Fetch `<head>` of the homepage via curl from inside the server
  - Look for GTM container ID matching `tracking_configs.gtm_container_id`
  - Look for GA4 measurement ID `tracking_configs.ga4_measurement_id`
  - Return `{ gtm_present, ga4_present, fb_pixel_present, evidence: [...] }`

**Validation:**
1. Open Assistant tab, scope=site, agent=general.
2. Ask "list the active plugins on this site" → tool call `plugin_list` runs → returns JSON → rendered as a list.
3. Ask "update Yoast SEO" → tool call `plugin_update` returns proposal → ConfirmDialog → click Apply → `kinsta_ssh_command_log` shows row with `triggered_by='agent:general'` and `user_id` of the admin.
4. Ask "is GTM installed?" on a site you know has it → `verify_tracking_install` returns `gtm_present: true`.
5. Audit log smoke: `SELECT * FROM audit_log WHERE event_type LIKE 'operations%' LIMIT 10` → entries present.

**Rollback:** Revert assistant rebuild; old `OperationsAssistantPanel` is
still in `OperationsWorkspace/index.jsx` history.

---

### Phase 7 — Bulk actions (Day 7–8)

**Scope:** Multi-site WP-CLI runner with progress tracking.

**Tickets:**

- [ ] **7.1** `server/services/operations/bulkRunner.js`. Port action set from
  `wp-client-hub/src/app/api/bulk/route.ts`:
  - `update_plugins`, `install_plugin`, `add_user`, `update_password`,
    `delete_user`, `update_user_role`, `deploy_mu_plugin`, `remove_mu_plugin`,
    `custom_wpcli`
  - Job lifecycle: insert into `kinsta_bulk_operations` (status='queued') →
    background runner picks up via `setImmediate` or a cron tick.
  - Concurrency: 10 parallel `execCommand` calls (matches wp-client-hub).
  - Per-target result row appended to `result_json.targets[envId] = {status, stdout_tail, stderr_tail, exit_code}`.
  - Update `completed_targets` after each finish.

- [ ] **7.2** Routes (`server/routes/operations.js`):
  ```
  POST /bulk                   { action, params, env_ids } → returns job_id
  GET  /bulk/:jobId            polling endpoint
  POST /bulk/:jobId/cancel     mark queued targets as skipped
  ```

- [ ] **7.3** UI `Bulk/BulkActionsTab.jsx`:
  - Action picker (dropdown of supported actions)
  - Param form (varies per action — `add_user` shows username/email/role; `install_plugin` shows slug)
  - Site selector: multi-select grouped by Anchor client (with "Select all unlinked" checkbox)
  - Submit → starts polling job → live progress bar + per-target row table

- [ ] **7.4** First production-relevant bulk action: **"Verify tracking install
  across portfolio"** — runs the Phase 6.6 verifier on every site in parallel,
  produces a CSV/table of `{site, gtm_present, ga4_present, fb_pixel_present}`.
  This was user's stated headline use case.

**Validation:**
1. Start a bulk `plugin_list` (read-only) across 5 envs → progress bar fills → results show stdout per env.
2. Start a `update_plugins --dry-run` across 3 envs → no actual mutations, dry-run results returned.
3. Cancel a queued job → status flips to 'cancelled', no new commands run.

**Rollback:** Drop the routes; the table can stay.

---

### Phase 8 — Drift scanner + findings (Day 8–9)

**Scope:** Daily background job that detects state changes per site,
surfaces them as findings.

**Tickets:**

- [ ] **8.1** Migration `migrate_kinsta_findings.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS kinsta_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES kinsta_sites(id) ON DELETE CASCADE,
    environment_id UUID REFERENCES kinsta_environments(id),
    severity TEXT NOT NULL,    -- 'critical' | 'warning' | 'info'
    category TEXT NOT NULL,    -- 'wp_version_drift' | 'plugin_removed' | 'siteurl_changed' | 'debug_enabled' | 'tracking_missing' | ...
    summary TEXT NOT NULL,
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    acknowledged_by UUID,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_kfind_site_open ON kinsta_findings(site_id) WHERE resolved_at IS NULL;
  ```

- [ ] **8.2** `server/cron/operationsDriftScan.js`. Cron pattern matches
  existing crons in `server/index.js` (look for `cron.schedule(...)` examples).
  - Daily at e.g. `06:00` America/Chicago
  - For each live env: lightweight scan (`core version`, `plugin list`,
    `option get siteurl`, debug flags)
  - Diff vs `scan_json`. If WP major version jumped / a plugin disappeared /
    siteurl changed / DEBUG flag flipped on → INSERT a `kinsta_findings` row
  - Also runs `verify_tracking_install` for every site → if regressed, finding

- [ ] **8.3** Surface in UI:
  - `SitesGrid` row gets an "X open" chip if `kinsta_findings` has unresolved rows
  - `SiteOverview.jsx` shows the open findings inline (severity-colored)
  - Acknowledge / resolve actions write `acknowledged_at` / `resolved_at`

- [ ] **8.4** Top KPI strip on `/operations` shows total open findings across
  the portfolio (replace the current "High Risk Runs" tile).

- [ ] **8.5** Email digest: extend the existing audit-schedule email to
  optionally include site findings (`include_site_findings: bool` on the
  schedule config).

**Validation:**
1. Manually flip a site's `option update WP_DEBUG 1` → run drift scan → finding row created.
2. Acknowledge it → chip count drops.

**Rollback:** Disable the cron; findings stay.

---

### Phase 9 — Polish + observability (Day 9–10)

- [ ] **9.1** Surface `kinsta_ssh_command_log` in the existing `ActivityLogsTab`
  (`src/views/admin/AdminHub/ActivityLogsTab.jsx`).
- [ ] **9.2** Per-environment "Recent commands" drawer panel in `SiteDrawer`.
- [ ] **9.3** Cost meter — Vertex token usage per assistant turn rolled up
  daily on `/operations` index (extend `audit_runs.debug_json.usage`).
- [ ] **9.4** Read-only env toggle: `kinsta_environments.metadata.read_only=true`
  blocks any non-`exec` `wp` command that isn't `list|get|search|status`. Belt
  + suspenders for sensitive sites.
- [ ] **9.5** Docs:
  - `CLAUDE.md` (project) — add Operations subsystem to Where-To-Look table
  - `docs/INTEGRATIONS.md` — add Kinsta section
  - `docs/ARCHITECTURE.md` — add Operations subsystem
  - `SKILLS.md` — append the 7 new tables (kinsta_*)
  - `.claude/skills/operations-runbook/` — new skill explaining how an admin
    runs scans, runs bulk actions, links sites to clients

**Validation:** Build clean; docs render in editor.

---

## 6. Schema reference (canonical)

Source: `server/sql/migrate_kinsta_operations.sql` (already shipped).

```
kinsta_sites
  id (uuid, pk)                       — Anchor's internal id
  kinsta_site_id (text, unique)        — Kinsta's site UUID
  site_name (text)
  display_name (text, nullable)        — admin-editable override
  archived_at (timestamptz, nullable)
  metadata (jsonb)                     — free-form (e.g. {is_divi: true})
  created_at, updated_at

kinsta_environments
  id (uuid, pk)
  site_id (uuid, fk → kinsta_sites)
  kinsta_environment_id (text, unique)
  environment_name (text)              — 'live' | 'staging' | etc
  is_live (bool)
  primary_domain (text, nullable)
  ssh_host, ssh_ip (text)
  ssh_port (int)
  ssh_username (text)
  ssh_password_encrypted (text)        — Anchor encrypt() format: iv:tag:ciphertext (base64)
  ssh_password_fetched_at (timestamptz)
  metadata (jsonb)                     — e.g. {read_only: true}
  created_at, updated_at
  INDEX (site_id), INDEX (is_live) WHERE is_live = TRUE

kinsta_site_workspaces
  site_id (uuid, pk, fk → kinsta_sites)
  claude_md (text)
  scan_json (jsonb)
  agent_prefs (jsonb)                  — e.g. {divi_safe_mode: true}
  last_scan_at (timestamptz)
  last_scan_status (text)              — 'success' | 'failed' | 'pending'
  last_scan_error (text)
  updated_at

kinsta_site_clients
  id (uuid, pk)
  site_id (uuid, fk → kinsta_sites)
  client_user_id (uuid)                — → users.id
  relationship (text)                  — 'primary' | 'staging' | 'microsite'
  notes (text)
  created_by (uuid)                    — admin user_id
  created_at
  UNIQUE (site_id, client_user_id, relationship)

kinsta_ssh_command_log
  id (uuid, pk)
  environment_id (uuid, fk → kinsta_environments)
  user_id (uuid)                       — admin user_id
  channel (text)                       — 'shell' | 'exec' | 'sftp' | 'bulk' | 'agent'
  command_summary (text)               — first/last 200 chars, sanitized
  exit_code (int)
  duration_ms (int)
  triggered_by (text)                  — 'manual' | 'agent:divi' | 'bulk:update_plugins' | 'cron:drift_scan'
  created_at

kinsta_bulk_operations
  id (uuid, pk)
  user_id (uuid)
  action (text)
  params_json (jsonb)
  status (text)                        — 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  total_targets (int)
  completed_targets (int)
  result_json (jsonb)                  — { targets: { [envId]: {status, stdout_tail, stderr_tail, exit_code} } }
  created_at, finished_at

(Phase 8) kinsta_findings — see §5 Phase 8.1
```

---

## 7. Compliance & security checklist

Re-verify before every PR merge:

- [ ] `requireAuth` + admin role gate on every `/api/operations/*` route
- [ ] Every SSH command (shell, exec, sftp, bulk, agent) → row in `kinsta_ssh_command_log`
- [ ] Every state-changing action → row in `audit_log` (use existing `services/security/audit.js`)
- [ ] No decrypted passwords in logs, errors, API responses
- [ ] `command_summary` truncated to 200 chars, sanitized of any `password=…` or `token=…` substrings
- [ ] All SQL parameterized — no string concat
- [ ] Frontend never receives `ssh_password_encrypted` (strip in route serializer)
- [ ] `data/kinsta-import.sql` in `.gitignore` (already done)
- [ ] WS handshake validates JWT freshness (not just signature) — reject expired tokens
- [ ] WS idle timeout 30 min, hard cap 4h
- [ ] No PHI prompts to AI: scan_json filtered before going into Vertex (no
      `wp-content/uploads/**` listings in claude_md)
- [ ] Encryption uses `services/security/encryption.js` only — no new crypto
- [ ] Cloud Run secrets bound via Secret Manager, never plain env values

---

## 8. Reference — wp-client-hub source paths

For ports during Phases 4–7. Read these, don't copy them blindly.

| Anchor target | wp-client-hub source |
|---|---|
| `services/operations/siteScanner.js` (Phase 4) | `src/lib/discovery/scanner.ts`, `src/lib/discovery/wp-commands.ts` |
| `services/operations/claudeMdTemplate.js` (Phase 4) | `src/lib/discovery/claude-md-template.ts`, `src/lib/discovery/merge.ts` |
| `services/operations/agentPrompts.js` (Phase 6) | `data/agent-prompts/{base,divi-expert,wordpress-security,seo-expert}.md` |
| `services/operations/opsAssistant.js` (Phase 6) | conceptually adapted from their Claude CLI subprocess pattern; use Vertex instead |
| `services/operations/bulkRunner.js` (Phase 7) | `src/app/api/bulk/route.ts` |
| `services/operations/diviGuard.js` (Phase 6) | implicit in their `data/agent-prompts/divi-expert.md` + WP mu-plugin (deferred) |

---

## 9. Working agreements

- **Branch:** all work on `feature/operations-tab`. Never on `main`. Never on `feature/report-builder-phase1`.
- **Files NOT to touch** (other agent's work):
  - `server/routes/reports.js`
  - `server/services/reports/reportRenderer.js`
  - `server/services/reports/scheduler.js`
  - `server/services/reports/csvRenderer.js`
  - `src/api/reports.js`
  - `src/views/admin/AdminHub/reports/{GenerateDialog,ReportsList}.jsx`
  - `server/sql/migrate_report_csv_export.sql`
- **Commit style:** `feat(operations): <verb> <noun>` / `fix(operations): …`. Co-authored-by line per project rule.
- **Per-phase:** commit + push to `origin/feature/operations-tab` before starting next phase.
- **Verify before commit:** `yarn build` + `yarn lint` (project lint is loose; only fail on NEW errors from your files).
- **Memory:** update `project_kinsta_operations.md` after every phase with the commit SHA, what shipped, and what's next.
- **No prod mutations** without explicit user instruction. Migration auto-runs on deploy, but the data import (`--apply` against Cloud SQL Proxy) is a deliberate manual step.

---

## 10. Done definition

The Operations × Kinsta integration is "done" when:

1. An admin can open `/operations` and see all Kinsta sites in a grid.
2. An admin can click any site, open a terminal, run `whoami`, and see results.
3. An admin can SFTP-upload a file to any environment.
4. An admin can edit per-site `claude_md` and have the AI assistant use it.
5. An admin can ask the assistant "verify tracking install on this site" and
   get a yes/no answer with evidence.
6. An admin can ask the assistant to update a plugin and approve via
   `ConfirmDialog`.
7. The drift scanner runs daily and surfaces findings on the Sites grid.
8. Each Kinsta site can be associated with 0..N Anchor clients in the admin
   drawer.
9. Every shell/exec/sftp/agent action lands in `kinsta_ssh_command_log` and
   `audit_log`.
10. `yarn build` and `yarn lint` pass with no new errors.

---

*Last updated: 2026-04-30 (replaces inline session notes).*
