# Production Health Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable health-check framework that actively probes our production agents and integrations daily and emails the super-admin only when something is broken.

**Architecture:** A small self-contained registry under `server/services/health/`. Each check is an active probe returning `{status, detail, error?, metrics?}`. A runner executes all checks, persists each result to a new `system_health_checks` table, and (from the daily 8am cron) emails super-admins when any check is not OK. Two superadmin endpoints expose manual run + latest results.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL (`pg`), `node-cron`, Mailgun, Vertex AI (`@google-cloud/vertexai`), `google-ads-api` (gRPC).

**Testing note:** This repo has **no automated test suite** (see `.claude/skills/verify-without-tests/`). "Tests" in this plan are small standalone smoke scripts run with `node`, plus `yarn build` + `yarn lint`. Each smoke script is deleted after use (it is not committed).

**Spec:** `docs/superpowers/specs/2026-06-05-production-health-checks-design.md`

---

## File Structure

- Create `server/sql/<NN>_system_health_checks.sql` — table migration.
- Modify `server/index.js` — register migration in chain; mount router; add 8am cron.
- Create `server/services/health/registry.js` — `registerHealthCheck` / `getHealthChecks`.
- Create `server/services/health/runner.js` — `runAllHealthChecks`, `runDailyHealthCheck`, prune.
- Create `server/services/health/healthEmail.js` — compose + send failure email.
- Create `server/services/health/checks/index.js` — imports every check (registration side-effects).
- Create `server/services/health/checks/aiClassification.js` — `ai.classification`.
- Create `server/services/health/checks/opsSupervisor.js` — `ops.supervisor`.
- Create `server/services/health/checks/integrations.js` — `integ.google_ads|meta|ctm|mailgun|ga4`.
- Modify `server/services/ops/agents/vertexRuntime.js` — add `pingVertex()`.
- Modify `server/services/ctm.js` — add `pingCtm()`.
- Modify `server/services/mailgun.js` — add `pingMailgun()`.
- Create `server/routes/health.js` — `POST /run`, `GET /latest`.
- Modify `docs/API_REFERENCE.md`, `SKILLS.md` — document endpoints + table.

---

## Task 1: Database migration — `system_health_checks`

**Files:**
- Create: `server/sql/060_system_health_checks.sql` (use the next free number; verify with `ls server/sql | sort | tail -3`)
- Modify: `server/index.js` (migration chain)

- [ ] **Step 1: Verify the next migration number**

Run: `ls server/sql | grep -E '^[0-9]' | sort | tail -5`
Pick the next integer; this plan assumes `060`. If taken, use the real next number consistently below.

- [ ] **Step 2: Write the SQL file**

Create `server/sql/060_system_health_checks.sql`:

```sql
-- Production health-check run history. Append-only telemetry (NOT audit data).
-- One row per check per run. 30-day retention pruned by the daily job.
CREATE TABLE IF NOT EXISTS system_health_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL,
  check_id     text NOT NULL,
  label        text NOT NULL,
  category     text NOT NULL,            -- 'agent' | 'integration' | 'job'
  status       text NOT NULL,            -- 'ok' | 'warn' | 'fail'
  detail       text,
  error        text,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms  integer,
  trigger      text NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_health_checks_run    ON system_health_checks (run_id);
CREATE INDEX IF NOT EXISTS idx_system_health_checks_recent ON system_health_checks (check_id, created_at DESC);
```

- [ ] **Step 3: Add the migration runner in `server/index.js`**

Find an existing `maybeRunXMigration` function to copy the shape from (search `async function maybeRunAiClassificationLogsMigration`). Add near the other `maybeRun*` definitions:

```js
async function maybeRunSystemHealthChecksMigration() {
  try {
    const sql = await readFile(
      path.join(__dirname, 'sql', '060_system_health_checks.sql'),
      'utf8'
    );
    await query(sql);
    console.log('[migration] system_health_checks ready');
  } catch (err) {
    // Append-only chain: never rethrow (see CLAUDE.md gotcha #3 / migration-chain-break-risk).
    console.error('[migration] system_health_checks failed:', err?.message);
  }
}
```

(If `readFile`/`path`/`__dirname` aren't already imported in `index.js`, reuse whatever the existing `maybeRun*` functions use — copy their exact file-reading approach instead of introducing a new one.)

- [ ] **Step 4: Append to the migration `.then()` chain**

Find the `.then(maybeRun...)` chain after `httpServer = app.listen(...)`. Append at the TAIL:

```js
    .then(maybeRunSystemHealthChecksMigration)
```

- [ ] **Step 5: Verify it applies locally**

Run: `lsof -ti:4000 | xargs kill -9 2>/dev/null; yarn server` (let it boot ~5s, then Ctrl-C)
Then: `psql postgresql://bif@localhost:5432/anchor -c "\d system_health_checks"`
Expected: table prints with the 12 columns above.

- [ ] **Step 6: Commit**

```bash
git add server/sql/060_system_health_checks.sql server/index.js
git commit -m "feat(health): system_health_checks table + migration"
```

---

## Task 2: The registry

**Files:**
- Create: `server/services/health/registry.js`

- [ ] **Step 1: Write the registry**

Create `server/services/health/registry.js`:

```js
/**
 * Production health-check registry. Each check registers itself at module load.
 * A check handler returns { status, detail?, error?, metrics? } and should never
 * include PHI in any field (probes use synthetic data; integration probes store
 * only liveness booleans / ids).
 */

const REGISTRY = new Map();
const VALID_CATEGORIES = new Set(['agent', 'integration', 'job']);
const DEFAULT_TIMEOUT_MS = 15000;

export function registerHealthCheck(checkId, definition = {}) {
  if (typeof checkId !== 'string' || !checkId) {
    throw new Error('registerHealthCheck: checkId must be a non-empty string');
  }
  const { label, category, run, timeoutMs = DEFAULT_TIMEOUT_MS } = definition;
  if (typeof label !== 'string' || !label) {
    throw new Error(`registerHealthCheck(${checkId}): label required`);
  }
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`registerHealthCheck(${checkId}): invalid category "${category}"`);
  }
  if (typeof run !== 'function') {
    throw new Error(`registerHealthCheck(${checkId}): run must be a function`);
  }
  if (REGISTRY.has(checkId)) {
    console.warn(`[health/registry] check_id already registered: ${checkId} — overwriting`);
  }
  REGISTRY.set(checkId, { checkId, label, category, run, timeoutMs });
}

export function getHealthChecks() {
  return Array.from(REGISTRY.values());
}

export function clearHealthChecksForTest() {
  REGISTRY.clear();
}
```

- [ ] **Step 2: Smoke test**

Create `/tmp/t-registry.mjs`:

```js
import { registerHealthCheck, getHealthChecks } from '/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/health/registry.js';
registerHealthCheck('x.demo', { label: 'Demo', category: 'agent', run: async () => ({ status: 'ok' }) });
const checks = getHealthChecks();
console.log(JSON.stringify(checks.map(c => ({ id: c.checkId, label: c.label, cat: c.category, t: c.timeoutMs }))));
try { registerHealthCheck('bad', { label: 'B', category: 'nope', run: async () => {} }); console.log('FAIL: bad category accepted'); }
catch (e) { console.log('OK rejected bad category:', e.message); }
```

Run: `node /tmp/t-registry.mjs`
Expected: prints the demo check with `t:15000`, then `OK rejected bad category: ...`.
Then: `rm /tmp/t-registry.mjs`

- [ ] **Step 3: Commit**

```bash
git add server/services/health/registry.js
git commit -m "feat(health): check registry"
```

---

## Task 3: Probe helpers on existing services

Add small, cheap, non-PHI liveness helpers where no existing cheap call fits.

**Files:**
- Modify: `server/services/ops/agents/vertexRuntime.js`
- Modify: `server/services/ctm.js`
- Modify: `server/services/mailgun.js`

- [ ] **Step 1: `pingVertex()` in `vertexRuntime.js`**

`ensureVertex()` is already exported and `DEFAULT_MODEL` exists in this module. Add at the end of the file:

```js
/**
 * Liveness probe for the Ops supervisor's Vertex path. Minimal generation,
 * no tools, no cost tracker. Returns { ok, model }. Throws on transport/auth/model error.
 */
export async function pingVertex() {
  const v = ensureVertex();
  const factory =
    typeof v.preview?.getGenerativeModel === 'function'
      ? v.preview.getGenerativeModel.bind(v.preview)
      : v.getGenerativeModel.bind(v);
  const model = factory({ model: DEFAULT_MODEL });
  const res = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
    generationConfig: { maxOutputTokens: 16, temperature: 0 }
  });
  const text = res?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  return { ok: Boolean(text), model: DEFAULT_MODEL };
}
```

(If `DEFAULT_MODEL` is not a module-level const in this file, search it: `grep -n "DEFAULT_MODEL" server/services/ops/agents/vertexRuntime.js` and use the exact identifier.)

- [ ] **Step 2: `pingCtm()` in `ctm.js`**

`axios` and `CTM_BASE` already exist at the top of `ctm.js`. Add near the other exported CTM fetchers:

```js
/**
 * Liveness probe for the agency CTM API key. Cheap account list; validates the
 * agency Basic-auth credential without touching any client sub-account data.
 * Returns { ok, status }. Throws on network error; non-2xx surfaces via status.
 */
export async function pingCtm() {
  const apiKey = process.env.CTM_ACCESS_KEY;
  const apiSecret = process.env.CTM_SECRET_KEY;
  if (!apiKey || !apiSecret) return { ok: false, status: 0, reason: 'CTM creds not configured' };
  const resp = await axios.get(`${CTM_BASE}/api/v1/accounts`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      Accept: 'application/json'
    },
    params: { per_page: 1 },
    timeout: 15000,
    validateStatus: () => true
  });
  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status };
}
```

- [ ] **Step 3: `pingMailgun()` in `mailgun.js`**

The module-private `client` and `resolvedDomain` already exist. Add after `isMailgunConfigured`:

```js
/**
 * Liveness probe for Mailgun auth. Lists domains (cheap, authenticated, sends
 * nothing). Returns { ok, configured }. Throws on auth/transport error.
 */
export async function pingMailgun() {
  if (!isMailgunConfigured()) return { ok: false, configured: false };
  await client.domains.list({ limit: 1 });
  return { ok: true, configured: true };
}
```

- [ ] **Step 4: Verify imports resolve (build)**

Run: `yarn build`
Expected: build succeeds (these are additive exports).

- [ ] **Step 5: Commit**

```bash
git add server/services/ops/agents/vertexRuntime.js server/services/ctm.js server/services/mailgun.js
git commit -m "feat(health): add pingVertex/pingCtm/pingMailgun liveness probes"
```

---

## Task 4: The checks

**Files:**
- Create: `server/services/health/checks/aiClassification.js`
- Create: `server/services/health/checks/opsSupervisor.js`
- Create: `server/services/health/checks/integrations.js`
- Create: `server/services/health/checks/index.js`

- [ ] **Step 1: `aiClassification.js`**

```js
import { registerHealthCheck } from '../registry.js';
import { classifyContent, DEFAULT_AI_PROMPT } from '../../ctm.js';

// Hard-coded, obviously-synthetic transcript. NO real PHI. An unambiguous lead so
// a healthy classifier returns a real, non-'unreviewed' category with a real summary.
const SYNTHETIC_TRANSCRIPT =
  "Hi, this is a test call. I'm a brand new patient and I'd like to book a dental " +
  'cleaning and a consultation for teeth whitening. Do you accept new patients this week?';

registerHealthCheck('ai.classification', {
  label: 'AI lead classification (Vertex)',
  category: 'agent',
  timeoutMs: 25000,
  run: async () => {
    const ai = await classifyContent(DEFAULT_AI_PROMPT, SYNTHETIC_TRANSCRIPT, '', { source: 'call' });
    const failed =
      !ai ||
      ai.summary === 'AI classification failed.' ||
      ai.category === 'unreviewed' ||
      !ai.category;
    return {
      status: failed ? 'fail' : 'ok',
      detail: failed
        ? 'Synthetic classify returned the failure fallback — Vertex classification is down.'
        : `Synthetic lead classified as "${ai.category}".`,
      error: failed ? (ai?.reasoning || 'classification fell back to unreviewed') : undefined,
      metrics: { category: ai?.category || null, model: ai?.debug?.model || null }
    };
  }
});
```

- [ ] **Step 2: `opsSupervisor.js`**

```js
import { registerHealthCheck } from '../registry.js';
import { pingVertex } from '../../ops/agents/vertexRuntime.js';

registerHealthCheck('ops.supervisor', {
  label: 'Operations AI supervisor (Vertex runtime)',
  category: 'agent',
  timeoutMs: 25000,
  run: async () => {
    const { ok, model } = await pingVertex();
    return {
      status: ok ? 'ok' : 'fail',
      detail: ok ? `Supervisor Vertex runtime responded (${model}).` : 'Supervisor Vertex runtime returned no text.',
      error: ok ? undefined : 'empty response from Vertex',
      metrics: { model: model || null }
    };
  }
});
```

- [ ] **Step 3: `integrations.js`**

```js
import { registerHealthCheck } from '../registry.js';
import { listGoogleAdsAccounts } from '../../analytics/googleAdsAdapter.js';
import { listGA4Properties } from '../../analytics/ga4Adapter.js';
import { fetchAdAccounts } from '../../analytics/metaAdsAdapter.js';
import { pingCtm } from '../../ctm.js';
import { pingMailgun } from '../../mailgun.js';

// 'fail' = a required cred is broken. 'warn' = an optional integration is simply
// not configured (don't nag about features the agency doesn't use).
function ok(detail, metrics) { return { status: 'ok', detail, metrics }; }
function fail(detail, error, metrics) { return { status: 'fail', detail, error, metrics }; }
function warnUnconfigured(detail) { return { status: 'warn', detail, metrics: { configured: false } }; }

registerHealthCheck('integ.google_ads', {
  label: 'Google Ads API (MCC OAuth)',
  category: 'integration',
  run: async () => {
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) return warnUnconfigured('Google Ads refresh token not configured.');
    const accounts = await listGoogleAdsAccounts();
    const n = Array.isArray(accounts) ? accounts.length : 0;
    return n > 0
      ? ok(`MCC OAuth valid — ${n} accessible account(s).`, { count: n })
      : fail('Google Ads returned zero accessible accounts.', 'no accessible customers', { count: 0 });
  }
});

registerHealthCheck('integ.meta', {
  label: 'Meta Graph API (system-user token)',
  category: 'integration',
  run: async () => {
    const token = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!token) return warnUnconfigured('Meta system-user token not configured.');
    const accounts = await fetchAdAccounts(token);
    const n = Array.isArray(accounts) ? accounts.length : 0;
    return n >= 0 && accounts
      ? ok(`System-user token valid — ${n} ad account(s) visible.`, { count: n })
      : fail('Meta token returned no ad accounts.', 'token invalid or no accounts', { count: n });
  }
});

registerHealthCheck('integ.ctm', {
  label: 'CallTrackingMetrics API (agency key)',
  category: 'integration',
  run: async () => {
    const { ok: live, status, reason } = await pingCtm();
    if (reason) return warnUnconfigured(reason);
    return live
      ? ok(`CTM agency key valid (HTTP ${status}).`, { status })
      : fail(`CTM API returned HTTP ${status}.`, `unexpected status ${status}`, { status });
  }
});

registerHealthCheck('integ.mailgun', {
  label: 'Mailgun (transactional email)',
  category: 'integration',
  run: async () => {
    const { ok: live, configured } = await pingMailgun();
    if (!configured) return warnUnconfigured('Mailgun not configured.');
    return live ? ok('Mailgun auth valid.') : fail('Mailgun auth failed.', 'domains.list failed');
  }
});

registerHealthCheck('integ.ga4', {
  label: 'Google Analytics 4 (service account)',
  category: 'integration',
  run: async () => {
    const properties = await listGA4Properties();
    const n = Array.isArray(properties) ? properties.length : 0;
    return n > 0
      ? ok(`GA4 service account valid — ${n} propert(ies) visible.`, { count: n })
      : fail('GA4 returned zero properties.', 'no properties or auth failure', { count: 0 });
  }
});
```

(Before writing, confirm the four imported function names exist exactly:
`grep -n "export async function listGoogleAdsAccounts\|export async function listGA4Properties\|export async function fetchAdAccounts" server/services/analytics/*.js`. If any differ, use the real name.)

- [ ] **Step 4: `checks/index.js`**

```js
// Importing this module registers every health check via side-effects.
import './aiClassification.js';
import './opsSupervisor.js';
import './integrations.js';
```

- [ ] **Step 5: Smoke test the AI + ops probes against prod creds**

This reuses the cloud-sql-proxy-free path: probes only need Vertex (ADC) + the model env. Create `/tmp/t-checks.mjs`:

```js
process.env.VERTEX_MODEL = 'gemini-2.5-flash';
process.env.VERTEX_CLASSIFIER_MODEL = 'gemini-2.5-flash';
process.env.VERTEX_LOCATION = 'us-central1';
process.env.GOOGLE_CLOUD_PROJECT = 'anchor-hub-480305';
process.env.VERTEX_PROJECT_ID = 'anchor-hub-480305';
await import('/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/health/checks/index.js');
const { getHealthChecks } = await import('/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/health/registry.js');
for (const c of getHealthChecks().filter((c) => c.checkId === 'ai.classification' || c.checkId === 'ops.supervisor')) {
  try { console.log(c.checkId, JSON.stringify(await c.run({}))); }
  catch (e) { console.log(c.checkId, 'THREW', e.message); }
}
process.exit(0);
```

Run from a `.env`-free cwd so `loadEnv` can't override the model:
`cd /tmp && node /tmp/t-checks.mjs`
Expected: `ai.classification {"status":"ok",...}` and `ops.supervisor {"status":"ok",...}`.
Then: `rm /tmp/t-checks.mjs`

(Integration checks need live agency creds from `.env`; they're exercised end-to-end in Task 7's manual run. Don't block this step on them.)

- [ ] **Step 6: Commit**

```bash
git add server/services/health/checks/
git commit -m "feat(health): ai.classification, ops.supervisor, and integration checks"
```

---

## Task 5: The runner

**Files:**
- Create: `server/services/health/runner.js`

- [ ] **Step 1: Write the runner**

```js
import { randomUUID } from 'crypto';
import { query } from '../../db.js';
import { getHealthChecks } from './registry.js';
import './checks/index.js'; // ensure checks are registered

const RETENTION_DAYS = 30;

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * Run every registered health check sequentially, persist one row each.
 * @param {{ trigger?: 'cron'|'manual' }} opts
 * @returns {Promise<{ run_id, results, failing }>}
 */
export async function runAllHealthChecks({ trigger = 'manual' } = {}) {
  const runId = randomUUID();
  const checks = getHealthChecks();
  const results = [];

  for (const check of checks) {
    const startedAt = Date.now();
    let result;
    try {
      const raw = await withTimeout(Promise.resolve(check.run({})), check.timeoutMs, check.checkId);
      result = {
        status: raw?.status || 'fail',
        detail: raw?.detail || null,
        error: raw?.error || null,
        metrics: raw?.metrics || {}
      };
    } catch (err) {
      result = { status: 'fail', detail: null, error: err?.message || String(err), metrics: {} };
    }
    const durationMs = Date.now() - startedAt;
    const row = {
      run_id: runId,
      check_id: check.checkId,
      label: check.label,
      category: check.category,
      status: result.status,
      detail: result.detail,
      error: result.error,
      metrics: result.metrics,
      duration_ms: durationMs
    };
    results.push(row);
    try {
      await query(
        `INSERT INTO system_health_checks
           (run_id, check_id, label, category, status, detail, error, metrics, duration_ms, trigger)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [runId, check.checkId, check.label, check.category, result.status,
         result.detail, result.error, JSON.stringify(result.metrics || {}), durationMs, trigger]
      );
    } catch (err) {
      console.error('[health/runner] persist failed for', check.checkId, err?.message);
    }
  }

  const failing = results.filter((r) => r.status !== 'ok');
  return { run_id: runId, results, failing };
}

export async function pruneOldHealthChecks() {
  try {
    await query(
      `DELETE FROM system_health_checks WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(RETENTION_DAYS)]
    );
  } catch (err) {
    console.error('[health/runner] prune failed:', err?.message);
  }
}
```

- [ ] **Step 2: Build check**

Run: `yarn build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add server/services/health/runner.js
git commit -m "feat(health): runner — execute, time, persist, prune"
```

---

## Task 6: The failure email

**Files:**
- Create: `server/services/health/healthEmail.js`

- [ ] **Step 1: Write the emailer**

```js
import { query } from '../../db.js';
import { sendMailgunMessageWithLogging } from '../mailgun.js';

function statusBadge(status) {
  if (status === 'fail') return '🔴 FAIL';
  if (status === 'warn') return '🟡 WARN';
  return '🟢 OK';
}

function buildHtml(failing, passingCount) {
  const rows = failing
    .map(
      (f) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>${f.label}</strong><br>
          <span style="color:#888;font-size:12px;">${f.category} · ${f.check_id}</span></td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;">${statusBadge(f.status)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${f.detail || ''}${
          f.error ? `<br><span style="color:#b00;font-size:12px;">${f.error}</span>` : ''
        }</td>
      </tr>`
    )
    .join('');
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:680px;">
    <h2 style="margin:0 0 4px;">Heads up — a production check needs attention</h2>
    <p style="color:#555;margin:0 0 16px;">${failing.length} check(s) not healthy${
      passingCount ? `, ${passingCount} passing` : ''
    }. This is the daily Anchor Hub health sweep.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">${rows}</table>
    <p style="color:#999;font-size:12px;margin-top:16px;">You're getting this because you're a super-admin. Silence means all checks passed.</p>
  </div>`;
}

function buildText(failing, passingCount) {
  const lines = failing.map((f) => `- [${f.status.toUpperCase()}] ${f.label} (${f.check_id}): ${f.detail || ''}${f.error ? ` — ${f.error}` : ''}`);
  return `Anchor Hub daily health sweep — ${failing.length} check(s) need attention${passingCount ? `, ${passingCount} passing` : ''}.\n\n${lines.join('\n')}\n`;
}

/**
 * Email super-admins about failing checks. No-op when nothing is failing.
 * @param {{ failing: Array, results: Array }} summary
 */
export async function sendHealthFailureEmail({ failing, results }) {
  if (!failing || failing.length === 0) return { sent: false, reason: 'all green' };
  const { rows } = await query(
    "SELECT email FROM users WHERE role = 'superadmin' AND email IS NOT NULL"
  );
  const recipients = rows.map((r) => r.email).filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no superadmin recipients' };

  const passingCount = (results?.length || 0) - failing.length;
  const subject = `⚠️ Anchor Hub health: ${failing.length} check(s) need attention`;
  await sendMailgunMessageWithLogging(
    { to: recipients, subject, html: buildHtml(failing, passingCount), text: buildText(failing, passingCount) },
    { category: 'system_health' }
  );
  return { sent: true, recipients: recipients.length };
}
```

(Confirm `sendMailgunMessageWithLogging`'s signature before finalizing the call:
`sed -n '177,200p' server/services/mailgun.js`. Match its actual parameter shape — adjust the second arg / options object to whatever it expects. If its logging-metadata arg differs, pass the equivalent.)

- [ ] **Step 2: Build check**

Run: `yarn build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add server/services/health/healthEmail.js
git commit -m "feat(health): super-admin failure email (errors-only)"
```

---

## Task 7: Daily orchestration + cron + manual endpoints

**Files:**
- Modify: `server/services/health/runner.js` (add `runDailyHealthCheck`)
- Create: `server/routes/health.js`
- Modify: `server/index.js` (import router, mount, cron)

- [ ] **Step 1: Add `runDailyHealthCheck` to `runner.js`**

Append to `server/services/health/runner.js`:

```js
import { sendHealthFailureEmail } from './healthEmail.js';

/**
 * Cron entrypoint: run all checks, prune old rows, email super-admins on any failure.
 */
export async function runDailyHealthCheck() {
  const summary = await runAllHealthChecks({ trigger: 'cron' });
  await pruneOldHealthChecks();
  if (summary.failing.length > 0) {
    try { await sendHealthFailureEmail(summary); }
    catch (err) { console.error('[health] email failed:', err?.message); }
  }
  return summary;
}
```

(Place the `import` at the TOP of the file with the other imports, not mid-file.)

- [ ] **Step 2: Write the router `server/routes/health.js`**

```js
/**
 * Production health checks — manual run + latest results. Superadmin only.
 */
import express from 'express';
import { query } from '../db.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { runAllHealthChecks } from '../services/health/runner.js';

const router = express.Router();

// Run all checks now (does NOT email — manual runs are interactive).
router.post('/run', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const summary = await runAllHealthChecks({ trigger: 'manual' });
    res.json(summary);
  } catch (err) {
    console.error('[health/run]', err?.message);
    res.status(500).json({ message: 'Health run failed' });
  }
});

// Latest run's results, grouped by run_id (most recent run).
router.get('/latest', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM system_health_checks
        WHERE run_id = (SELECT run_id FROM system_health_checks ORDER BY created_at DESC LIMIT 1)
        ORDER BY category, check_id`
    );
    res.json({ run_id: rows[0]?.run_id || null, results: rows });
  } catch (err) {
    console.error('[health/latest]', err?.message);
    res.status(500).json({ message: 'Failed to load latest health run' });
  }
});

export default router;
```

- [ ] **Step 3: Mount the router in `server/index.js`**

Near the other router imports (e.g. by `import opsRouter from './routes/ops.js';`):

```js
import healthRouter from './routes/health.js';
```

Near the other `app.use('/api/...')` mounts (e.g. by `app.use('/api/ops', opsRouter);`):

```js
app.use('/api/health', healthRouter);
```

- [ ] **Step 4: Add the 8am cron in `server/index.js`**

Near the other `cron.schedule(...)` calls:

```js
// Daily production health sweep — emails super-admins only on failure.
cron.schedule('0 8 * * *', async () => {
  if (process.env.DEMO_MODE === 'true') return;
  try {
    const { runDailyHealthCheck } = await import('./services/health/runner.js');
    const summary = await runDailyHealthCheck();
    console.log(`[cron:health] ${summary.failing.length} failing of ${summary.results.length}`);
  } catch (e) {
    console.error('[cron:health]', e?.message);
  }
}, { timezone: 'America/New_York' });
```

- [ ] **Step 5: Build + lint**

Run: `yarn build && yarn lint`
Expected: both pass.

- [ ] **Step 6: End-to-end manual run against the real server**

Start the backend (it loads `.env`, so all integration creds are live):
Run: `lsof -ti:4000 | xargs kill -9 2>/dev/null; yarn server` (leave running in one shell)

Get a superadmin token by logging in as `jmartin` (use the app, or an existing session). Then:
```bash
curl -s -X POST http://localhost:4000/api/health/run \
  -H "Authorization: Bearer <SUPERADMIN_JWT>" | python3 -m json.tool
```
Expected: JSON with `results` array; `ai.classification` and `ops.supervisor` `status:"ok"`.
Note any integration that reports `fail` vs `warn` and confirm it matches reality (e.g. a genuinely unconfigured optional integration should be `warn`, not `fail`).

Then verify persistence:
`psql postgresql://bif@localhost:5432/anchor -c "SELECT check_id,status,duration_ms FROM system_health_checks ORDER BY created_at DESC LIMIT 10;"`

**Note:** local `.env` pins `VERTEX_MODEL=gemini-2.0-flash` (the retired model). Locally `ai.classification` may therefore report `fail` — that is correct behavior and actually proves the check works. Production (Cloud Run) now uses `gemini-2.5-flash`, so it will pass there. Confirm the *check logic* is right; don't "fix" it by editing `.env`.

- [ ] **Step 7: Verify the email path (forced failure)**

Create `/tmp/t-email.mjs` to exercise `runDailyHealthCheck` once (this WILL send a real email to super-admins if anything is failing — acceptable for a one-time test, or temporarily point `sendHealthFailureEmail` recipients at yourself):

```js
const { runDailyHealthCheck } = await import('/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/health/runner.js');
const s = await runDailyHealthCheck();
console.log('failing:', s.failing.map((f) => f.check_id));
process.exit(0);
```
Run: `node /tmp/t-email.mjs` (from the repo root so `.env` loads creds).
Expected: logs failing check ids; if non-empty, a formatted email arrives at the super-admin inbox.
Then: `rm /tmp/t-email.mjs`

- [ ] **Step 8: Commit**

```bash
git add server/services/health/runner.js server/routes/health.js server/index.js
git commit -m "feat(health): daily 8am cron, manual run/latest endpoints, email on failure"
```

---

## Task 8: Documentation

**Files:**
- Modify: `docs/API_REFERENCE.md`
- Modify: `SKILLS.md`

- [ ] **Step 1: Document the endpoints in `docs/API_REFERENCE.md`**

Add under an appropriate section:

```markdown
### Health Checks (`/api/health`) — superadmin only
- `POST /api/health/run` — run all production health checks now; returns `{ run_id, results, failing }`. Does not email.
- `GET /api/health/latest` — most recent run's results grouped by `run_id`.
Backed by the `system_health_checks` table; the daily 8am (ET) cron runs the same checks and emails super-admins only when a check is not OK.
```

- [ ] **Step 2: Document the table in `SKILLS.md`**

Add `system_health_checks` to the Database Schema Map (columns from Task 1), noting it is monitoring telemetry with 30-day retention, no PHI.

- [ ] **Step 3: Commit**

```bash
git add docs/API_REFERENCE.md SKILLS.md
git commit -m "docs(health): API reference + schema for health checks"
```

---

## Task 9: Final verification + finish branch

- [ ] **Step 1: Full build + lint**

Run: `yarn build && yarn lint`
Expected: both pass clean.

- [ ] **Step 2: Confirm the green path is silent**

With all checks passing (run on an environment where the model env is correct, or stub), confirm `sendHealthFailureEmail` returns `{ sent: false, reason: 'all green' }` and no email is sent. (Inspect by calling `runAllHealthChecks` and asserting `failing.length === 0` → email skipped.)

- [ ] **Step 3: Invoke the finishing-a-development-branch skill**

Use `superpowers:finishing-a-development-branch` to decide merge/PR. **Per the user's standing rule, do NOT merge to `main` (= prod auto-deploy) without explicit human sign-off.** Open a PR for review.

---

## Self-Review (completed by plan author)

- **Spec coverage:** registry (T2), active-probe checks for ai/ops/integrations (T3–T4), persistence table (T1), runner+prune (T5), errors-only email (T6), 8am cron gated on DEMO_MODE (T7), manual endpoints (T7), docs (T8), verification (T9). All spec sections mapped. ✓
- **Placeholder scan:** no TBD/"add error handling"/"write tests" placeholders; every code step shows full code. ✓
- **Type consistency:** check handlers return `{status, detail, error?, metrics?}` everywhere; runner reads those exact keys; email reads `label/category/check_id/status/detail/error` which match the persisted row columns and the runner's `results` rows. `runAllHealthChecks`/`runDailyHealthCheck`/`pruneOldHealthChecks`/`sendHealthFailureEmail`/`pingVertex`/`pingCtm`/`pingMailgun` names used consistently across tasks. ✓
- **Known external-name checks:** plan instructs verifying `listGoogleAdsAccounts`, `listGA4Properties`, `fetchAdAccounts`, `sendMailgunMessageWithLogging`, `DEFAULT_MODEL`, `requireSuperadmin` against the real source before finalizing each — they were grepped during planning and exist, but the verify step guards drift. ✓
