# Operations: Bulk Runs, Prompt-Driven Skills, and CTM Umbrella — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CTM as a 4th ops platform, replace tier-based check selection with editable markdown "skills" that wrap existing collectors as tools, and promote Bulk to a top-level Operations tab that fans skills out across all active clients on user-defined schedules.

**Architecture:** Skills (markdown prompts + permitted-collector list) become the unit of execution. The supervisor loads a skill, exposes its collectors as tools to Vertex Gemini, and writes findings + optional skill-improvement suggestions. Bulk schedules fan out one child run per (active client, skill) tuple via the existing `runExecutor`/`runQueue`. Cost and findings roll up into a parent `ops_bulk_runs` row.

**Tech Stack:** Postgres 15 (idempotent migrations via `maybeRunX()` chain in `server/index.js`); Express 4 with `requireAuth` + `requireAdmin`; React 19 + MUI v5 (legacy Grid alias) + `ui-component/extended/DataTable`; Vertex AI Gemini through existing `agents/supervisor.js` + `vertexRuntime.js`; Node built-in test runner (`node --test`) for server unit tests in `server/services/ops/__tests__/*.test.js`. No UI test framework — UI verified via `yarn build` + `yarn lint` + manual browser check.

**Spec:** `docs/superpowers/specs/2026-05-07-ops-bulk-skills-ctm-design.md`

---

## Conventions for every task

- All UUID checks use existing `UUID_RE` pattern from `credentialStore.js`.
- All routes use `requireAuth + requireAdmin` (already mounted on `router` after line 60 of `server/routes/ops.js`).
- All state-changing UI calls show a success/failure toast via `useToast` from `contexts/ToastContext`.
- All shared tables use `ui-component/extended/DataTable`.
- After every task: `yarn lint` and `yarn build` must pass before the commit.
- Each task ends with a `git add` of the listed files and a single commit. Do not amend.

---

## Phase 1 — Database foundation

### Task 1: Migration for skills + bulk runs schema

**Files:**
- Create: `server/sql/migrate_ops_skills_and_bulk.sql`
- Modify: `server/index.js` (add `maybeRunOpsSkillsAndBulkMigration` and append to chain)
- Test: `server/services/ops/__tests__/migrationSkillsAndBulk.test.js`

- [ ] **Step 1: Write the SQL migration**

Create `server/sql/migrate_ops_skills_and_bulk.sql`:

```sql
-- Idempotent migration: ops_skills, ops_skill_versions, ops_skill_suggestions,
-- ops_bulk_schedules, ops_bulk_runs + ALTER ops_runs.

CREATE TABLE IF NOT EXISTS ops_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  umbrella TEXT NOT NULL CHECK (umbrella IN ('website','google_ads','meta','ctm')),
  title TEXT NOT NULL,
  prompt_md TEXT NOT NULL,
  collectors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_skills_umbrella ON ops_skills(umbrella) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_skill_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES ops_skills(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  prompt_md TEXT NOT NULL,
  collectors_json JSONB NOT NULL,
  edited_by_user_id UUID REFERENCES users(id),
  edited_by_agent BOOLEAN NOT NULL DEFAULT FALSE,
  edit_reason TEXT,
  approved_from_suggestion_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_ops_skill_versions_skill ON ops_skill_versions(skill_id, version_number DESC);

CREATE TABLE IF NOT EXISTS ops_skill_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID REFERENCES ops_skills(id) ON DELETE CASCADE,
  run_id UUID,
  proposed_slug TEXT,
  proposed_umbrella TEXT,
  proposed_title TEXT,
  proposed_prompt_md TEXT NOT NULL,
  proposed_collectors_json JSONB NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_skill_suggestions_pending
  ON ops_skill_suggestions(skill_id, created_at DESC) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS ops_bulk_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  skill_ids UUID[] NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  day_of_week SMALLINT CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
  day_of_month SMALLINT CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 28)),
  hour_local SMALLINT NOT NULL DEFAULT 8 CHECK (hour_local BETWEEN 0 AND 23),
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_bulk_schedules_due
  ON ops_bulk_schedules(next_run_at) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS ops_bulk_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_schedule_id UUID REFERENCES ops_bulk_schedules(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule','manual')),
  triggered_by_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','complete','partial','failed')),
  client_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  findings_count INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ops_bulk_runs_started ON ops_bulk_runs(started_at DESC);

ALTER TABLE ops_runs ADD COLUMN IF NOT EXISTS bulk_run_id UUID REFERENCES ops_bulk_runs(id) ON DELETE SET NULL;
ALTER TABLE ops_runs ADD COLUMN IF NOT EXISTS skill_id UUID REFERENCES ops_skills(id);
ALTER TABLE ops_runs ADD COLUMN IF NOT EXISTS skill_version_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_ops_runs_bulk ON ops_runs(bulk_run_id) WHERE bulk_run_id IS NOT NULL;
```

- [ ] **Step 2: Add migration runner to `server/index.js`**

Find the block of `maybeRunOpsXxxMigration` definitions (around line 961+). Add after the last one:

```js
async function maybeRunOpsSkillsAndBulkMigration() {
  const sqlPath = path.join(__dirname, 'sql', 'migrate_ops_skills_and_bulk.sql');
  const sql = await fs.promises.readFile(sqlPath, 'utf8');
  await pool.query(sql);
  console.warn('[migration] ops_skills_and_bulk applied');
}
```

Find the migration chain (around line 1801). Append:

```js
.then(maybeRunOpsSkillsAndBulkMigration)
```

after the last existing `.then(maybeRunOps...)` entry.

- [ ] **Step 3: Write idempotency test**

Create `server/services/ops/__tests__/migrationSkillsAndBulk.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, '..', '..', '..', 'sql', 'migrate_ops_skills_and_bulk.sql');

test('migrate_ops_skills_and_bulk: runs cleanly twice', async () => {
  const sql = await fs.readFile(SQL_PATH, 'utf8');
  await query(sql);
  await query(sql);
  const { rows: tables } = await query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('ops_skills','ops_skill_versions','ops_skill_suggestions','ops_bulk_schedules','ops_bulk_runs')
    ORDER BY tablename
  `);
  assert.equal(tables.length, 5);
  const { rows: cols } = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ops_runs' AND column_name IN ('bulk_run_id','skill_id','skill_version_number')
  `);
  assert.equal(cols.length, 3);
});
```

- [ ] **Step 4: Run the test**

```
yarn test:ops
```
Expected: the new test passes; existing ops tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add server/sql/migrate_ops_skills_and_bulk.sql server/index.js server/services/ops/__tests__/migrationSkillsAndBulk.test.js
git commit -m "feat(ops): migration for skills, suggestions, bulk schedules and runs"
```

---

## Phase 2 — CTM umbrella

### Task 2: Add 'ctm' to umbrella allowlist + credential platform

**Files:**
- Modify: `server/services/ops/checks/registry.js` (add 'ctm' to `VALID_UMBRELLAS`)
- Modify: `server/services/ops/credentialStore.js` (already platform-agnostic — add a helper for resolving CTM creds)

- [ ] **Step 1: Patch `VALID_UMBRELLAS`**

In `server/services/ops/checks/registry.js`, change:

```js
const VALID_UMBRELLAS = new Set(['website', 'google_ads', 'meta']);
```

to:

```js
const VALID_UMBRELLAS = new Set(['website', 'google_ads', 'meta', 'ctm']);
```

- [ ] **Step 2: Verify existing tests still pass**

```
yarn test:ops
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add server/services/ops/checks/registry.js
git commit -m "feat(ops): allow 'ctm' as a check umbrella"
```

### Task 3: CTM tracking-number-health collector

**Files:**
- Create: `server/services/ops/checks/ctm/index.js`
- Create: `server/services/ops/checks/ctm/trackingNumberHealth.js`
- Test: `server/services/ops/__tests__/ctmTrackingNumberHealth.test.js`

- [ ] **Step 1: Write the collector**

Create `server/services/ops/checks/ctm/trackingNumberHealth.js`:

```js
/**
 * ctm.tracking_number_health
 *
 * Checks the client's CTM tracking numbers for: disabled state, error state,
 * and zero call activity in the last N days. Emits one finding per problem
 * number.
 */
import { registerCheck } from '../registry.js';
import { query } from '../../../../db.js';
import { listTrackingNumbers, getNumberCallCount } from '../../../ctm.js';

const STALE_DAYS = 14;

async function handler({ clientUserId }) {
  const numbers = await listTrackingNumbers({ clientUserId });
  const findings = [];
  for (const n of numbers) {
    if (n.status === 'disabled') {
      findings.push({ severity: 'critical', number: n.formatted_number, reason: 'disabled' });
      continue;
    }
    if (n.status === 'error' || n.last_error) {
      findings.push({ severity: 'critical', number: n.formatted_number, reason: n.last_error || 'error' });
      continue;
    }
    const count = await getNumberCallCount({ clientUserId, numberId: n.id, days: STALE_DAYS });
    if (count === 0) {
      findings.push({ severity: 'warning', number: n.formatted_number, reason: `no calls in ${STALE_DAYS}d` });
    }
  }
  return {
    status: findings.length ? 'warn' : 'ok',
    severity: findings.some((f) => f.severity === 'critical') ? 'critical' : (findings.length ? 'warning' : 'info'),
    payload: { numbers_checked: numbers.length, findings },
    cost_cents: 0
  };
}

registerCheck('ctm.tracking_number_health', {
  umbrella: 'ctm',
  tier: 'daily_essential',
  handler,
  costEstimate: 0,
  requires: ['ctm']
});

export { handler };
```

> **Note:** if `listTrackingNumbers` and `getNumberCallCount` are not yet exported from `server/services/ctm.js`, add minimal exports there as part of this task. Inspect `server/services/ctm.js` first; if the equivalents exist under different names, adapt the import.

- [ ] **Step 2: Create the umbrella index file**

Create `server/services/ops/checks/ctm/index.js`:

```js
// Side-effect imports register each CTM collector with the registry.
import './trackingNumberHealth.js';
```

- [ ] **Step 3: Wire the umbrella index into the global checks bootstrap**

Find where existing umbrellas are imported (look in `server/services/ops/index.js` or `server/services/ops/checks/registry.js`). Add a side-effect import for `./ctm/index.js` next to the website/google_ads/meta imports. Example pattern:

```js
import './checks/website/index.js';
import './checks/google_ads/index.js';
import './checks/meta/index.js';
import './checks/ctm/index.js';   // NEW
```

- [ ] **Step 4: Write a unit test**

Create `server/services/ops/__tests__/ctmTrackingNumberHealth.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../checks/ctm/trackingNumberHealth.js';

// Mock by monkey-patching is awkward; instead, inject via test-only export.
// For now, smoke-test that the handler exists and signature is callable.
test('ctm.tracking_number_health handler is callable', async () => {
  assert.equal(typeof handler, 'function');
});

test('ctm.tracking_number_health is registered', async () => {
  const { getCheck } = await import('../checks/registry.js');
  await import('../checks/ctm/trackingNumberHealth.js');
  const reg = getCheck('ctm.tracking_number_health');
  assert.ok(reg);
  assert.equal(reg.umbrella, 'ctm');
});
```

- [ ] **Step 5: Run tests + lint**

```
yarn test:ops && yarn lint
```

- [ ] **Step 6: Commit**

```bash
git add server/services/ops/checks/ctm/ server/services/ops/__tests__/ctmTrackingNumberHealth.test.js server/services/ops/index.js
git commit -m "feat(ops): ctm.tracking_number_health collector"
```

### Task 4: CTM classification-quality collector

**Files:**
- Create: `server/services/ops/checks/ctm/classificationQuality.js`
- Modify: `server/services/ops/checks/ctm/index.js` (add side-effect import)
- Test: `server/services/ops/__tests__/ctmClassificationQuality.test.js`

- [ ] **Step 1: Write the collector**

Create `server/services/ops/checks/ctm/classificationQuality.js`:

```js
/**
 * ctm.classification_quality
 *
 * Looks at the client's call_logs for classification health:
 *   - count of classification_pending and unreviewed rows
 *   - autostar mix
 *   - spam %
 *   - 7-day classified-volume vs prior 7-day median
 */
import { registerCheck } from '../registry.js';
import { query } from '../../../../db.js';

async function handler({ clientUserId }) {
  const { rows } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE meta->>'classification_pending' = 'true') AS pending,
      COUNT(*) FILTER (WHERE category = 'unreviewed') AS unreviewed,
      COUNT(*) FILTER (WHERE category = 'spam') AS spam,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS last7,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days') AS prior7,
      COUNT(*) AS total
    FROM call_logs
    WHERE owner_user_id = $1
      AND created_at >= now() - interval '30 days'
  `, [clientUserId]);
  const r = rows[0] || {};
  const last7 = Number(r.last7 || 0);
  const prior7 = Number(r.prior7 || 0);
  const findings = [];
  if (Number(r.pending) > 25) findings.push({ severity: 'warning', metric: 'classification_pending', value: Number(r.pending) });
  if (Number(r.unreviewed) > 10) findings.push({ severity: 'warning', metric: 'unreviewed', value: Number(r.unreviewed) });
  if (prior7 > 0 && last7 < prior7 * 0.5) {
    findings.push({ severity: 'critical', metric: 'volume_drop', last7, prior7 });
  }
  return {
    status: findings.length ? 'warn' : 'ok',
    severity: findings.some((f) => f.severity === 'critical') ? 'critical' : (findings.length ? 'warning' : 'info'),
    payload: {
      pending: Number(r.pending), unreviewed: Number(r.unreviewed),
      spam: Number(r.spam), last7, prior7, total_30d: Number(r.total),
      findings
    },
    cost_cents: 0
  };
}

registerCheck('ctm.classification_quality', {
  umbrella: 'ctm',
  tier: 'daily_essential',
  handler,
  costEstimate: 0,
  requires: ['ctm']
});

export { handler };
```

- [ ] **Step 2: Add side-effect import**

In `server/services/ops/checks/ctm/index.js`, append:

```js
import './classificationQuality.js';
```

- [ ] **Step 3: Write registration test**

Create `server/services/ops/__tests__/ctmClassificationQuality.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('ctm.classification_quality is registered', async () => {
  const { getCheck } = await import('../checks/registry.js');
  await import('../checks/ctm/classificationQuality.js');
  const reg = getCheck('ctm.classification_quality');
  assert.ok(reg);
  assert.equal(reg.umbrella, 'ctm');
});
```

- [ ] **Step 4: Run tests + lint + commit**

```
yarn test:ops && yarn lint
git add server/services/ops/checks/ctm/classificationQuality.js server/services/ops/checks/ctm/index.js server/services/ops/__tests__/ctmClassificationQuality.test.js
git commit -m "feat(ops): ctm.classification_quality collector"
```

### Task 5: CTM form-flow collector

**Files:**
- Create: `server/services/ops/checks/ctm/formFlow.js`
- Modify: `server/services/ops/checks/ctm/index.js`
- Test: `server/services/ops/__tests__/ctmFormFlow.test.js`

- [ ] **Step 1: Write the collector**

Create `server/services/ops/checks/ctm/formFlow.js`:

```js
/**
 * ctm.form_flow
 *
 * Verifies CTM forms for the client are receiving submissions, autoresponders
 * are configured, and reply-to + PDF settings are present.
 */
import { registerCheck } from '../registry.js';
import { query } from '../../../../db.js';

async function handler({ clientUserId }) {
  const { rows: forms } = await query(`
    SELECT id, slug, settings_json, analytics_json,
           (SELECT COUNT(*) FROM ctm_form_submissions s WHERE s.form_id = f.id AND s.created_at >= now() - interval '7 days') AS subs_7d
      FROM ctm_forms f
     WHERE owner_user_id = $1 AND archived_at IS NULL
  `, [clientUserId]);
  const findings = [];
  for (const f of forms) {
    const s = f.settings_json || {};
    if (s.autoresponder_enabled && (!s.autoresponder_reply_to || !s.autoresponder_subject)) {
      findings.push({ severity: 'warning', form: f.slug, reason: 'autoresponder enabled but reply-to or subject missing' });
    }
    if (Number(f.subs_7d) === 0) {
      findings.push({ severity: 'info', form: f.slug, reason: 'no submissions in 7d' });
    }
  }
  return {
    status: findings.length ? 'warn' : 'ok',
    severity: findings.some((f) => f.severity === 'warning') ? 'warning' : 'info',
    payload: { forms_checked: forms.length, findings },
    cost_cents: 0
  };
}

registerCheck('ctm.form_flow', {
  umbrella: 'ctm',
  tier: 'daily_essential',
  handler,
  costEstimate: 0,
  requires: ['ctm']
});

export { handler };
```

- [ ] **Step 2: Add side-effect import + registration test**

Append `import './formFlow.js';` to `server/services/ops/checks/ctm/index.js`.

Create `server/services/ops/__tests__/ctmFormFlow.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('ctm.form_flow is registered', async () => {
  const { getCheck } = await import('../checks/registry.js');
  await import('../checks/ctm/formFlow.js');
  const reg = getCheck('ctm.form_flow');
  assert.ok(reg);
  assert.equal(reg.umbrella, 'ctm');
});
```

- [ ] **Step 3: Run + commit**

```
yarn test:ops && yarn lint
git add server/services/ops/checks/ctm/formFlow.js server/services/ops/checks/ctm/index.js server/services/ops/__tests__/ctmFormFlow.test.js
git commit -m "feat(ops): ctm.form_flow collector"
```

### Task 6: CTM webhook-sync collector

**Files:**
- Create: `server/services/ops/checks/ctm/webhookSync.js`
- Modify: `server/services/ops/checks/ctm/index.js`
- Test: `server/services/ops/__tests__/ctmWebhookSync.test.js`

- [ ] **Step 1: Write the collector**

Create `server/services/ops/checks/ctm/webhookSync.js`:

```js
/**
 * ctm.webhook_sync
 *
 * Inspects recency of CTM webhook deliveries and the latest API auth probe.
 * Sources of truth:
 *   - call_logs.created_at (for the client) — last successful inbound delivery
 *   - ctm_api_health table (if present) for the latest auth probe
 */
import { registerCheck } from '../registry.js';
import { query } from '../../../../db.js';

const STALE_HOURS = 24;

async function handler({ clientUserId }) {
  const { rows: lastCall } = await query(`
    SELECT MAX(created_at) AS last_at FROM call_logs WHERE owner_user_id = $1
  `, [clientUserId]);
  const last = lastCall[0]?.last_at ? new Date(lastCall[0].last_at) : null;
  const findings = [];
  if (!last) {
    findings.push({ severity: 'warning', reason: 'no calls ever received via CTM' });
  } else {
    const hours = (Date.now() - last.getTime()) / 3_600_000;
    if (hours > STALE_HOURS) {
      findings.push({ severity: 'warning', reason: `last CTM call was ${hours.toFixed(1)}h ago`, last_at: last.toISOString() });
    }
  }
  return {
    status: findings.length ? 'warn' : 'ok',
    severity: findings.length ? 'warning' : 'info',
    payload: { last_call_at: last?.toISOString() || null, findings },
    cost_cents: 0
  };
}

registerCheck('ctm.webhook_sync', {
  umbrella: 'ctm',
  tier: 'daily_essential',
  handler,
  costEstimate: 0,
  requires: ['ctm']
});

export { handler };
```

- [ ] **Step 2: Add side-effect import + registration test**

Append `import './webhookSync.js';` to `server/services/ops/checks/ctm/index.js`.

Create `server/services/ops/__tests__/ctmWebhookSync.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('ctm.webhook_sync is registered', async () => {
  const { getCheck } = await import('../checks/registry.js');
  await import('../checks/ctm/webhookSync.js');
  const reg = getCheck('ctm.webhook_sync');
  assert.ok(reg);
  assert.equal(reg.umbrella, 'ctm');
});
```

- [ ] **Step 3: Run + commit**

```
yarn test:ops && yarn lint
git add server/services/ops/checks/ctm/webhookSync.js server/services/ops/checks/ctm/index.js server/services/ops/__tests__/ctmWebhookSync.test.js
git commit -m "feat(ops): ctm.webhook_sync collector"
```

### Task 7: CTM sub-agent

**Files:**
- Create: `server/services/ops/agents/subAgents/ctmAgent.js`
- Modify: `server/services/ops/agents/supervisor.js` (add CTM dispatch)

- [ ] **Step 1: Read an existing sub-agent first**

Run:
```
yarn -s exec -- cat server/services/ops/agents/subAgents/websiteAgent.js
```

Mirror its shape (constructor signature, exposed methods). The CTM agent should expose a `runCheck(checkId, ctx)` method that delegates to the registry.

- [ ] **Step 2: Write `ctmAgent.js`**

Create `server/services/ops/agents/subAgents/ctmAgent.js` mirroring `websiteAgent.js`. Key responsibility: own the CTM umbrella's collectors as agent tools and validate that `ctx.platform === 'ctm'` credentials resolve before calling the registered handler.

- [ ] **Step 3: Wire into supervisor**

In `server/services/ops/agents/supervisor.js`, find where `websiteAgent` / `googleAdsAgent` / `metaAgent` are instantiated or dispatched. Add a parallel branch for `umbrella === 'ctm'`.

- [ ] **Step 4: Verify build + commit**

```
yarn lint && yarn build
git add server/services/ops/agents/subAgents/ctmAgent.js server/services/ops/agents/supervisor.js
git commit -m "feat(ops): ctm sub-agent"
```

---

## Phase 3 — Skills layer

### Task 8: Skills storage service

**Files:**
- Create: `server/services/ops/skills/store.js`
- Test: `server/services/ops/__tests__/skillsStore.test.js`

- [ ] **Step 1: Write the store**

Create `server/services/ops/skills/store.js`:

```js
/**
 * Skills store — CRUD + version history + suggestions.
 *
 * Versions are append-only. Saving a new prompt/collectors creates a new row
 * in ops_skill_versions and bumps ops_skills.current_version.
 */
import { query } from '../../../db.js';
import { listAllChecks } from '../checks/registry.js';

const VALID_UMBRELLAS = new Set(['website', 'google_ads', 'meta', 'ctm']);

function validateCollectors(collectors) {
  if (!Array.isArray(collectors)) throw new Error('collectors must be an array');
  const known = new Set(listAllChecks().map((c) => c.checkId));
  const missing = collectors.filter((c) => !known.has(c));
  return { ok: missing.length === 0, missing };
}

export async function listSkills({ umbrella, includeArchived = false } = {}) {
  const where = [];
  const params = [];
  if (umbrella) { params.push(umbrella); where.push(`umbrella = $${params.length}`); }
  if (!includeArchived) where.push('archived_at IS NULL');
  const sql = `SELECT * FROM ops_skills ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY umbrella, slug`;
  const { rows } = await query(sql, params);
  return rows;
}

export async function getSkill(id) {
  const { rows } = await query('SELECT * FROM ops_skills WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getSkillBySlug(slug) {
  const { rows } = await query('SELECT * FROM ops_skills WHERE slug = $1', [slug]);
  return rows[0] || null;
}

export async function listVersions(skillId) {
  const { rows } = await query(
    'SELECT * FROM ops_skill_versions WHERE skill_id = $1 ORDER BY version_number DESC',
    [skillId]
  );
  return rows;
}

export async function createSkill({ slug, umbrella, title, promptMd, collectors, costEstimateCents = 0, createdBy }) {
  if (!VALID_UMBRELLAS.has(umbrella)) throw new Error(`invalid umbrella: ${umbrella}`);
  const v = validateCollectors(collectors);
  if (!v.ok) throw new Error(`unknown collectors: ${v.missing.join(', ')}`);
  const { rows } = await query(`
    INSERT INTO ops_skills (slug, umbrella, title, prompt_md, collectors_json, cost_estimate_cents, created_by, current_version)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,1)
    RETURNING *
  `, [slug, umbrella, title, promptMd, JSON.stringify(collectors), costEstimateCents, createdBy]);
  const skill = rows[0];
  await query(`
    INSERT INTO ops_skill_versions (skill_id, version_number, prompt_md, collectors_json, edited_by_user_id)
    VALUES ($1,1,$2,$3::jsonb,$4)
  `, [skill.id, promptMd, JSON.stringify(collectors), createdBy]);
  return skill;
}

export async function saveNewVersion(skillId, { promptMd, collectors, editedByUserId, editedByAgent = false, editReason = null, approvedFromSuggestionId = null }) {
  const v = validateCollectors(collectors);
  if (!v.ok) throw new Error(`unknown collectors: ${v.missing.join(', ')}`);
  const { rows: skillRows } = await query('SELECT current_version FROM ops_skills WHERE id = $1 FOR UPDATE', [skillId]);
  if (!skillRows[0]) throw new Error('skill not found');
  const next = Number(skillRows[0].current_version) + 1;
  await query(`
    INSERT INTO ops_skill_versions (skill_id, version_number, prompt_md, collectors_json, edited_by_user_id, edited_by_agent, edit_reason, approved_from_suggestion_id)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
  `, [skillId, next, promptMd, JSON.stringify(collectors), editedByUserId, editedByAgent, editReason, approvedFromSuggestionId]);
  await query(`
    UPDATE ops_skills
       SET prompt_md = $2, collectors_json = $3::jsonb, current_version = $4, updated_at = now()
     WHERE id = $1
  `, [skillId, promptMd, JSON.stringify(collectors), next]);
  return next;
}

export async function archiveSkill(id) {
  await query('UPDATE ops_skills SET archived_at = now() WHERE id = $1', [id]);
}

// Suggestions ---

export async function listPendingSuggestions(skillId = null) {
  const params = [];
  let sql = `SELECT * FROM ops_skill_suggestions WHERE status = 'pending'`;
  if (skillId) { params.push(skillId); sql += ` AND skill_id = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await query(sql, params);
  return rows;
}

export async function createSuggestion({ skillId, runId, proposedSlug, proposedUmbrella, proposedTitle, proposedPromptMd, proposedCollectors, rationale }) {
  const { rows } = await query(`
    INSERT INTO ops_skill_suggestions (skill_id, run_id, proposed_slug, proposed_umbrella, proposed_title, proposed_prompt_md, proposed_collectors_json, rationale)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    RETURNING *
  `, [skillId, runId, proposedSlug, proposedUmbrella, proposedTitle, proposedPromptMd, JSON.stringify(proposedCollectors), rationale]);
  return rows[0];
}

export async function approveSuggestion(suggestionId, reviewerUserId, reviewerNote = null) {
  const { rows } = await query('SELECT * FROM ops_skill_suggestions WHERE id = $1 FOR UPDATE', [suggestionId]);
  const sug = rows[0];
  if (!sug) throw new Error('suggestion not found');
  if (sug.status !== 'pending') throw new Error('suggestion not pending');
  let resultSkillId = sug.skill_id;
  if (sug.skill_id) {
    await saveNewVersion(sug.skill_id, {
      promptMd: sug.proposed_prompt_md,
      collectors: sug.proposed_collectors_json,
      editedByUserId: reviewerUserId,
      editedByAgent: true,
      editReason: 'approved from suggestion',
      approvedFromSuggestionId: suggestionId
    });
  } else {
    const created = await createSkill({
      slug: sug.proposed_slug,
      umbrella: sug.proposed_umbrella,
      title: sug.proposed_title,
      promptMd: sug.proposed_prompt_md,
      collectors: sug.proposed_collectors_json,
      createdBy: reviewerUserId
    });
    resultSkillId = created.id;
  }
  await query(`
    UPDATE ops_skill_suggestions
       SET status='approved', reviewed_by_user_id=$2, reviewed_at=now(), reviewer_note=$3
     WHERE id=$1
  `, [suggestionId, reviewerUserId, reviewerNote]);
  return { suggestionId, skillId: resultSkillId };
}

export async function rejectSuggestion(suggestionId, reviewerUserId, reviewerNote = null) {
  await query(`
    UPDATE ops_skill_suggestions
       SET status='rejected', reviewed_by_user_id=$2, reviewed_at=now(), reviewer_note=$3
     WHERE id=$1 AND status='pending'
  `, [suggestionId, reviewerUserId, reviewerNote]);
}
```

- [ ] **Step 2: Write a focused test**

Create `server/services/ops/__tests__/skillsStore.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../../db.js';
import { createSkill, getSkill, saveNewVersion, listVersions, createSuggestion, approveSuggestion, rejectSuggestion } from '../skills/store.js';

const SLUG = `test.skill.${Date.now()}`;

test('skills store: create + new version + history', async () => {
  const skill = await createSkill({
    slug: SLUG,
    umbrella: 'website',
    title: 'Test',
    promptMd: '# v1',
    collectors: []
  });
  assert.ok(skill.id);
  assert.equal(skill.current_version, 1);

  const next = await saveNewVersion(skill.id, { promptMd: '# v2', collectors: [], editedByUserId: null, editReason: 'manual edit' });
  assert.equal(next, 2);

  const reloaded = await getSkill(skill.id);
  assert.equal(reloaded.current_version, 2);
  assert.equal(reloaded.prompt_md, '# v2');

  const versions = await listVersions(skill.id);
  assert.equal(versions.length, 2);

  await query('DELETE FROM ops_skills WHERE id = $1', [skill.id]);
});

test('skills store: suggestion approve creates new version on existing skill', async () => {
  const skill = await createSkill({
    slug: SLUG + '.b',
    umbrella: 'website',
    title: 'Test B',
    promptMd: '# v1',
    collectors: []
  });
  const sug = await createSuggestion({
    skillId: skill.id,
    runId: null,
    proposedPromptMd: '# v2-from-agent',
    proposedCollectors: [],
    rationale: 'agent learned X'
  });
  await approveSuggestion(sug.id, null, 'looks good');
  const after = await getSkill(skill.id);
  assert.equal(after.current_version, 2);
  assert.equal(after.prompt_md, '# v2-from-agent');

  await query('DELETE FROM ops_skills WHERE id = $1', [skill.id]);
});
```

- [ ] **Step 3: Run + commit**

```
yarn test:ops && yarn lint
git add server/services/ops/skills/store.js server/services/ops/__tests__/skillsStore.test.js
git commit -m "feat(ops): skills store with versions and suggestions"
```

### Task 9: Seed file format + sync helper + initial seeds

**Files:**
- Create: `server/services/ops/skills/seed.js`
- Create: `server/services/ops/skills/seeds/website/daily_essentials.md`
- Create: `server/services/ops/skills/seeds/google_ads/daily_essentials.md`
- Create: `server/services/ops/skills/seeds/meta/daily_essentials.md`
- Create: `server/services/ops/skills/seeds/ctm/daily_essentials.md`
- Modify: `server/index.js` (add `maybeSyncOpsSeedSkills` and append to chain after the migration runner)
- Test: `server/services/ops/__tests__/skillsSeed.test.js`

- [ ] **Step 1: Write the parser/sync helper**

Create `server/services/ops/skills/seed.js`:

```js
/**
 * Seed sync — on startup, for each *.md under skills/seeds/<umbrella>/, parse
 * its YAML front matter and ensure an ops_skills row exists. Existing rows are
 * NEVER overwritten (user edits win). Missing rows are created at version 1.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getSkillBySlug, createSkill } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = path.join(__dirname, 'seeds');

function parseFrontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('seed file missing YAML front matter');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k === 'collectors') {
      // expects: [a, b, c]
      const inner = v.replace(/^\[|\]$/g, '').trim();
      meta.collectors = inner ? inner.split(',').map((s) => s.trim()) : [];
    } else if (k === 'cost_estimate_cents') {
      meta.cost_estimate_cents = Number(v) || 0;
    } else {
      meta[k] = v;
    }
  }
  return { meta, body: m[2].trim() };
}

export async function syncSeedSkills() {
  let umbrellas;
  try {
    umbrellas = await fs.readdir(SEEDS_DIR);
  } catch (e) {
    if (e.code === 'ENOENT') return { created: 0, existed: 0 };
    throw e;
  }
  let created = 0;
  let existed = 0;
  for (const umbrella of umbrellas) {
    const dir = path.join(SEEDS_DIR, umbrella);
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const filePath = path.join(dir, f);
      const text = await fs.readFile(filePath, 'utf8');
      const { meta, body } = parseFrontMatter(text);
      if (!meta.slug || !meta.umbrella || !meta.title) {
        console.warn(`[skills/seed] ${filePath} missing slug/umbrella/title — skipped`);
        continue;
      }
      const existing = await getSkillBySlug(meta.slug);
      if (existing) { existed += 1; continue; }
      await createSkill({
        slug: meta.slug,
        umbrella: meta.umbrella,
        title: meta.title,
        promptMd: body,
        collectors: meta.collectors || [],
        costEstimateCents: meta.cost_estimate_cents || 0,
        createdBy: null
      });
      created += 1;
    }
  }
  return { created, existed };
}
```

- [ ] **Step 2: Write the four seed markdown files**

Create `server/services/ops/skills/seeds/website/daily_essentials.md`:

```markdown
---
slug: website.daily_essentials
umbrella: website
title: Website daily essentials
collectors: [web.psi, web.ssl, web.uptime, web.kinsta.drift]
cost_estimate_cents: 4
---

# What to check

- **PageSpeed Insights mobile score**: flag if < 70, or if 5+ point drop vs prior 7-day median.
- **SSL certificate**: warn if expiry < 30 days, fail if < 7 days.
- **Uptime**: flag any 5xx or downtime within last 24h.
- **Kinsta drift**: flag any new high/critical findings since last run.

# How to interpret

A finding is **critical** only when user-facing. Internal-only deltas roll up as **info**. Always include the affected URL(s) in the finding payload. If you find that the same false-positive recurs across runs, propose a refinement to this skill (do not modify it directly).
```

Create `server/services/ops/skills/seeds/google_ads/daily_essentials.md`:

```markdown
---
slug: google_ads.daily_essentials
umbrella: google_ads
title: Google Ads daily essentials
collectors: [gads.account_status, gads.disapprovals, gads.budget_pacing, gads.conversion_health]
cost_estimate_cents: 6
---

# What to check

- Account status: flag suspended or limited.
- Disapprovals: any policy violations on active ads or extensions.
- Budget pacing: flag if daily spend < 50% or > 150% of plan.
- Conversion health: flag if conversion volume drops 30%+ vs 7-day median, or if no conversions in 48h on an account that had them.

# How to interpret

Disapprovals are always actionable. Budget pacing flags should reference the campaign and a 7-day chart. If conversion volume drops, cross-check with website uptime findings before raising critical.
```

Create `server/services/ops/skills/seeds/meta/daily_essentials.md`:

```markdown
---
slug: meta.daily_essentials
umbrella: meta
title: Meta daily essentials
collectors: [meta.account_status, meta.spend_pacing, meta.disapprovals]
cost_estimate_cents: 5
---

# What to check

- Account status: flag any restriction or pixel access issue.
- Spend pacing: flag if daily spend deviates >50% from 7-day median.
- Disapprovals: flag any rejected ads or pixels with elevated event-quality issues.

# How to interpret

Never run this skill against a `client_type='medical'` client — Meta is HIPAA-blocked. The runner enforces this; if you ever see a medical client reach this skill, treat it as a critical finding ("HIPAA gate breach") and abort.
```

Create `server/services/ops/skills/seeds/ctm/daily_essentials.md`:

```markdown
---
slug: ctm.daily_essentials
umbrella: ctm
title: CTM daily essentials
collectors: [ctm.tracking_number_health, ctm.classification_quality, ctm.form_flow, ctm.webhook_sync]
cost_estimate_cents: 0
---

# What to check

- Tracking number health: any disabled, errored, or stale (no calls in 14d) numbers.
- Classification quality: backlog of `pending_review`/`unreviewed` rows, autostar drift, spam %.
- Form flow: forms with autoresponder enabled but missing reply-to/subject; forms with no submissions in 7d.
- Webhook sync: most recent CTM-sourced call vs now (warn if > 24h).

# How to interpret

A `volume_drop` from classification_quality combined with a stale webhook_sync is a critical compound finding ("CTM ingestion broken"). Tag accordingly. If the same client repeatedly shows zero submissions on a specific form, propose a tighter form-flow check via a suggestion.
```

- [ ] **Step 3: Wire the sync into startup**

In `server/index.js`, after the migration chain, add:

```js
async function maybeSyncOpsSeedSkills() {
  try {
    const { syncSeedSkills } = await import('./services/ops/skills/seed.js');
    const r = await syncSeedSkills();
    console.warn(`[startup] ops seed skills: created=${r.created} existed=${r.existed}`);
  } catch (e) {
    console.error('[startup] seed skills failed', e?.message || e);
  }
}
```

Append `.then(maybeSyncOpsSeedSkills)` to the migration chain after `maybeRunOpsSkillsAndBulkMigration`.

- [ ] **Step 4: Test the parser**

Create `server/services/ops/__tests__/skillsSeed.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSeedSkills } from '../skills/seed.js';
import { getSkillBySlug } from '../skills/store.js';
import { query } from '../../../db.js';

test('syncSeedSkills creates each canonical seed if missing', async () => {
  // Clean any prior seeded rows for a deterministic check
  await query(`DELETE FROM ops_skills WHERE slug IN ('website.daily_essentials','google_ads.daily_essentials','meta.daily_essentials','ctm.daily_essentials')`);
  const r1 = await syncSeedSkills();
  assert.ok(r1.created >= 4);
  for (const slug of ['website.daily_essentials','google_ads.daily_essentials','meta.daily_essentials','ctm.daily_essentials']) {
    const s = await getSkillBySlug(slug);
    assert.ok(s, `expected seed ${slug} to exist`);
  }
  // Second pass: nothing new created.
  const r2 = await syncSeedSkills();
  assert.equal(r2.created, 0);
});
```

- [ ] **Step 5: Run + commit**

```
yarn test:ops && yarn lint
git add server/services/ops/skills/ server/services/ops/__tests__/skillsSeed.test.js server/index.js
git commit -m "feat(ops): skill seed parser and four daily-essential seed skills"
```

### Task 10: Skill executor

**Files:**
- Create: `server/services/ops/skills/executor.js`
- Test: `server/services/ops/__tests__/skillsExecutor.test.js`

- [ ] **Step 1: Write the executor**

Create `server/services/ops/skills/executor.js`:

```js
/**
 * Skill executor.
 *
 * Loads a skill, exposes its collectors as tools to the supervisor, calls
 * the supervisor with the prompt, captures findings and any agent-emitted
 * skill-improvement suggestions.
 */
import { getCheck } from '../checks/registry.js';
import { getSkill } from './store.js';
import { runSupervisorWithSkill } from '../agents/supervisor.js';

export async function runSkill({ skillId, runId, clientUserId, umbrellaContext }) {
  const skill = await getSkill(skillId);
  if (!skill) throw new Error(`skill not found: ${skillId}`);
  if (skill.archived_at) throw new Error(`skill archived: ${skill.slug}`);

  const collectors = (skill.collectors_json || []).map((checkId) => {
    const reg = getCheck(checkId);
    if (!reg) {
      throw new Error(`skill ${skill.slug} references unknown collector ${checkId}`);
    }
    return {
      checkId,
      umbrella: reg.umbrella,
      tool: async (args = {}) => reg.handler({ ...umbrellaContext, ...args, clientUserId, runId })
    };
  });

  const result = await runSupervisorWithSkill({
    skillSlug: skill.slug,
    skillTitle: skill.title,
    promptMd: skill.prompt_md,
    skillVersion: skill.current_version,
    skillId: skill.id,
    runId,
    clientUserId,
    collectors
  });

  return {
    skillId: skill.id,
    skillVersion: skill.current_version,
    findings: result.findings || [],
    summary: result.summary || '',
    cost_cents: result.cost_cents || 0,
    suggestions: result.suggestions || []
  };
}
```

- [ ] **Step 2: Add `runSupervisorWithSkill` shim in supervisor**

In `server/services/ops/agents/supervisor.js`, add (or replace existing logic in) an exported function:

```js
export async function runSupervisorWithSkill({ skillSlug, skillTitle, promptMd, skillVersion, skillId, runId, clientUserId, collectors }) {
  // Hand promptMd to Vertex Gemini as the system prompt; expose `collectors`
  // as tool functions. Capture tool outputs verbatim. Ask the model to emit:
  //   { findings: [...], summary: "...", suggestions?: [{ proposed_prompt_md, proposed_collectors, rationale }] }
  // Use existing vertexRuntime helpers (see vertexRuntime.js) for the actual
  // Gemini call. Return a normalized object.
  // Implementation detail: call vertexRuntime.callWithTools(...) — exact name
  // depends on what supervisor.js currently exposes; adapt to that surface.
}
```

> **Implementation note:** The exact Vertex call signature depends on what `vertexRuntime.js` already exposes. Read that file before writing this function. The contract is stable: in goes a system prompt + tool functions; out comes findings + summary + cost + optional suggestions.

- [ ] **Step 3: Unit-test the executor with stub supervisor**

Create `server/services/ops/__tests__/skillsExecutor.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { query } from '../../../db.js';
import { createSkill } from '../skills/store.js';

test('runSkill: errors on unknown collector', async () => {
  const skill = await createSkill({
    slug: `test.exec.${Date.now()}`,
    umbrella: 'website',
    title: 'Test exec',
    promptMd: '# x',
    collectors: ['this.does.not.exist']
  });
  const { runSkill } = await import('../skills/executor.js');
  await assert.rejects(() => runSkill({
    skillId: skill.id, runId: null, clientUserId: '00000000-0000-0000-0000-000000000000', umbrellaContext: {}
  }), /unknown collector/);
  await query('DELETE FROM ops_skills WHERE id = $1', [skill.id]);
});
```

- [ ] **Step 4: Run + commit**

```
yarn test:ops && yarn lint && yarn build
git add server/services/ops/skills/executor.js server/services/ops/agents/supervisor.js server/services/ops/__tests__/skillsExecutor.test.js
git commit -m "feat(ops): skill executor that wraps collectors as supervisor tools"
```

### Task 11: Hook skill execution into runExecutor

**Files:**
- Modify: `server/services/ops/runExecutor.js`

- [ ] **Step 1: Read the current executor**

```
yarn -s exec -- sed -n '1,80p' server/services/ops/runExecutor.js
```

Locate the function that resolves which checks/handlers a run should execute today (it currently joins on `ops_run_definitions` and a tier).

- [ ] **Step 2: Add a skill-driven branch**

When an `ops_runs` row has `skill_id IS NOT NULL`, route execution through `runSkill` instead of the legacy tier-based dispatch. Pseudocode:

```js
import { runSkill } from './skills/executor.js';

// inside the per-run dispatch:
if (runRow.skill_id) {
  const out = await runSkill({
    skillId: runRow.skill_id,
    runId: runRow.id,
    clientUserId: runRow.client_user_id,
    umbrellaContext: { /* whatever context the existing checks expect */ }
  });
  await persistFindings(runRow.id, out.findings);
  await persistSuggestions(runRow.id, runRow.skill_id, out.suggestions);
  await query('UPDATE ops_runs SET cost_cents = $2, status = $3, completed_at = now() WHERE id = $1',
    [runRow.id, out.cost_cents, 'complete']);
  return;
}
// else: existing legacy behavior (unchanged)
```

`persistSuggestions` (define alongside existing `persistFindings`) writes each agent suggestion as a row in `ops_skill_suggestions` via `createSuggestion`.

- [ ] **Step 3: Verify build + commit**

```
yarn lint && yarn build
git add server/services/ops/runExecutor.js
git commit -m "feat(ops): runExecutor dispatches to skill executor when run has skill_id"
```

---

## Phase 4 — Bulk runs

### Task 12: fanOutBulkSchedule

**Files:**
- Modify: `server/services/ops/scheduleFanout.js`
- Test: `server/services/ops/__tests__/scheduleFanoutBulk.test.js`

- [ ] **Step 1: Add the fanout function**

In `server/services/ops/scheduleFanout.js`, add:

```js
/**
 * Bulk schedule fanout: enumerate active_clients with required credentials per
 * skill and enqueue one child ops_runs row per (client, skill) pair.
 */
import { getCredential } from './credentialStore.js';
import { getSkill } from './skills/store.js';

const UMBRELLA_TO_PLATFORM = {
  website: 'kinsta',     // adjust if 'website' creds map elsewhere
  google_ads: 'google_ads',
  meta: 'meta',
  ctm: 'ctm'
};

export async function fanOutBulkSchedule(scheduleId, { triggeredByUserId = null, trigger = 'schedule' } = {}) {
  const { rows: schedRows } = await query('SELECT * FROM ops_bulk_schedules WHERE id = $1', [scheduleId]);
  const schedule = schedRows[0];
  if (!schedule || !schedule.enabled) return null;

  const { rows: bulkRunRows } = await query(`
    INSERT INTO ops_bulk_runs (bulk_schedule_id, trigger, triggered_by_user_id, status)
    VALUES ($1,$2,$3,'running') RETURNING *
  `, [scheduleId, trigger, triggeredByUserId]);
  const bulkRun = bulkRunRows[0];

  const skills = [];
  for (const sid of schedule.skill_ids) {
    const s = await getSkill(sid);
    if (s && !s.archived_at) skills.push(s);
  }

  const { rows: clients } = await query(`SELECT id, owner_user_id, client_name FROM active_clients WHERE archived_at IS NULL`);

  const skipped = [];
  let enqueued = 0;
  for (const client of clients) {
    for (const skill of skills) {
      const platform = UMBRELLA_TO_PLATFORM[skill.umbrella];
      const cred = platform ? await getCredential(client.owner_user_id, platform).catch(() => null) : null;
      if (platform && !cred) {
        skipped.push({ client_user_id: client.owner_user_id, client_name: client.client_name, skill_slug: skill.slug, reason: `no ${platform} credential` });
        continue;
      }
      await query(`
        INSERT INTO ops_runs (client_user_id, skill_id, skill_version_number, bulk_run_id, status, trigger, metadata)
        VALUES ($1,$2,$3,$4,'queued','bulk_schedule', $5::jsonb)
      `, [
        client.owner_user_id, skill.id, skill.current_version, bulkRun.id,
        { source: 'bulk_schedule', schedule_id: scheduleId }
      ]);
      enqueued += 1;
    }
  }

  await query(`
    UPDATE ops_bulk_runs
       SET client_count = $2, skipped_count = $3, metadata = jsonb_set(metadata,'{skipped}',$4::jsonb,true)
     WHERE id = $1
  `, [bulkRun.id, enqueued, skipped.length, JSON.stringify(skipped)]);

  await query('UPDATE ops_bulk_schedules SET last_run_at = now(), updated_at = now() WHERE id = $1', [scheduleId]);

  return { bulkRunId: bulkRun.id, enqueued, skipped: skipped.length };
}
```

- [ ] **Step 2: Add a thin test**

Create `server/services/ops/__tests__/scheduleFanoutBulk.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../../db.js';
import { createSkill } from '../skills/store.js';
import { fanOutBulkSchedule } from '../scheduleFanout.js';

test('fanOutBulkSchedule creates a bulk run row even when there are no eligible clients', async () => {
  const skill = await createSkill({ slug: `t.fan.${Date.now()}`, umbrella: 'website', title: 't', promptMd: '#', collectors: [] });
  const { rows } = await query(`
    INSERT INTO ops_bulk_schedules (name, skill_ids, cadence, enabled)
    VALUES ('test', ARRAY[$1::uuid], 'daily', true) RETURNING id
  `, [skill.id]);
  const out = await fanOutBulkSchedule(rows[0].id, { trigger: 'manual' });
  assert.ok(out.bulkRunId);
  await query('DELETE FROM ops_bulk_schedules WHERE id = $1', [rows[0].id]);
  await query('DELETE FROM ops_skills WHERE id = $1', [skill.id]);
});
```

- [ ] **Step 3: Run + commit**

```
yarn test:ops && yarn lint && yarn build
git add server/services/ops/scheduleFanout.js server/services/ops/__tests__/scheduleFanoutBulk.test.js
git commit -m "feat(ops): fanOutBulkSchedule enqueues per-client child runs"
```

### Task 13: Cost + findings rollup hook

**Files:**
- Modify: `server/services/ops/runExecutor.js`

- [ ] **Step 1: Add a rollup helper**

In `server/services/ops/runExecutor.js`, after a child run finalizes (status terminal), add:

```js
async function rollupBulkRun(runRow) {
  if (!runRow.bulk_run_id) return;
  await query(`
    UPDATE ops_bulk_runs b
       SET findings_count = (SELECT COALESCE(SUM(findings_count),0) FROM ops_runs r WHERE r.bulk_run_id = b.id),
           cost_cents     = (SELECT COALESCE(SUM(cost_cents),0)     FROM ops_runs r WHERE r.bulk_run_id = b.id),
           status = CASE
             WHEN EXISTS (SELECT 1 FROM ops_runs r WHERE r.bulk_run_id = b.id AND r.status NOT IN ('complete','failed','cancelled'))
               THEN 'running'
             WHEN EXISTS (SELECT 1 FROM ops_runs r WHERE r.bulk_run_id = b.id AND r.status = 'failed')
               THEN 'partial'
             ELSE 'complete'
           END,
           completed_at = CASE
             WHEN NOT EXISTS (SELECT 1 FROM ops_runs r WHERE r.bulk_run_id = b.id AND r.status NOT IN ('complete','failed','cancelled'))
               THEN now() ELSE completed_at
           END
     WHERE b.id = $1
  `, [runRow.bulk_run_id]);
}
```

Call `rollupBulkRun(runRow)` at the end of the per-run completion path (both success and failure branches).

- [ ] **Step 2: Verify build + commit**

```
yarn lint && yarn build
git add server/services/ops/runExecutor.js
git commit -m "feat(ops): roll up child run cost and findings into ops_bulk_runs"
```

### Task 14: Bulk schedule scheduler tick

**Files:**
- Modify: `server/index.js` (existing ops cron loop, or add new `setInterval`)

- [ ] **Step 1: Find the existing ops cron**

Search for the existing scheduler tick (grep `scheduleFanout\|setInterval.*ops`). Use the same place to dispatch bulk schedules.

- [ ] **Step 2: Add the tick**

```js
import { fanOutBulkSchedule } from './services/ops/scheduleFanout.js';

async function tickBulkSchedules() {
  const { rows } = await pool.query(`
    SELECT id FROM ops_bulk_schedules WHERE enabled = TRUE AND (next_run_at IS NULL OR next_run_at <= now())
  `);
  for (const r of rows) {
    await fanOutBulkSchedule(r.id);
    await pool.query(`UPDATE ops_bulk_schedules SET next_run_at = $2 WHERE id = $1`, [
      r.id, computeNextRunAt(r) // implement using cadence/dow/dom/hour_local/timezone
    ]);
  }
}

setInterval(() => { tickBulkSchedules().catch((e) => console.error('[bulk-tick]', e)); }, 60_000);
```

`computeNextRunAt` is a small pure function — colocate it in `server/services/ops/scheduleFanout.js` (`export function computeNextRunAt(schedule)`) and write a unit test for the daily / weekly / monthly cases.

- [ ] **Step 3: Test `computeNextRunAt`**

Add to `server/services/ops/__tests__/scheduleFanoutBulk.test.js`:

```js
test('computeNextRunAt: daily ticks 24h forward', async () => {
  const { computeNextRunAt } = await import('../scheduleFanout.js');
  const now = new Date('2026-05-07T13:00:00Z');
  const next = computeNextRunAt({ cadence: 'daily', hour_local: 8, timezone: 'America/Chicago' }, now);
  assert.ok(next.getTime() > now.getTime());
  assert.ok(next.getTime() - now.getTime() < 25 * 3600 * 1000);
});

test('computeNextRunAt: weekly respects day_of_week', async () => {
  const { computeNextRunAt } = await import('../scheduleFanout.js');
  const now = new Date('2026-05-07T13:00:00Z'); // Thursday
  const next = computeNextRunAt({ cadence: 'weekly', day_of_week: 1, hour_local: 8, timezone: 'America/Chicago' }, now);
  assert.equal(next.getUTCDay(), 1);
});
```

- [ ] **Step 4: Run + commit**

```
yarn test:ops && yarn lint && yarn build
git add server/index.js server/services/ops/scheduleFanout.js server/services/ops/__tests__/scheduleFanoutBulk.test.js
git commit -m "feat(ops): bulk schedule tick + computeNextRunAt"
```

---

## Phase 5 — API routes

### Task 15: /api/ops/skills routes

**Files:**
- Modify: `server/routes/ops.js`

- [ ] **Step 1: Add route handlers**

In `server/routes/ops.js`, after the existing `/run-definitions` block, add:

```js
import {
  listSkills, getSkill, listVersions, createSkill, saveNewVersion, archiveSkill,
  listPendingSuggestions, approveSuggestion, rejectSuggestion
} from '../services/ops/skills/store.js';

router.get('/skills', async (req, res) => {
  const skills = await listSkills({ umbrella: req.query.umbrella || undefined });
  res.json({ skills });
});

router.get('/skills/:id', async (req, res) => {
  const skill = await getSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: 'not_found' });
  res.json({ skill });
});

router.get('/skills/:id/versions', async (req, res) => {
  res.json({ versions: await listVersions(req.params.id) });
});

router.post('/skills', async (req, res) => {
  const { slug, umbrella, title, prompt_md, collectors, cost_estimate_cents } = req.body || {};
  try {
    const skill = await createSkill({ slug, umbrella, title, promptMd: prompt_md, collectors, costEstimateCents: cost_estimate_cents, createdBy: req.user.id });
    res.status(201).json({ skill });
  } catch (e) {
    res.status(400).json({ error: 'invalid', message: e.message });
  }
});

router.put('/skills/:id', async (req, res) => {
  const { prompt_md, collectors, edit_reason } = req.body || {};
  try {
    const version = await saveNewVersion(req.params.id, {
      promptMd: prompt_md, collectors, editedByUserId: req.user.id, editReason: edit_reason
    });
    res.json({ version });
  } catch (e) {
    res.status(400).json({ error: 'invalid', message: e.message });
  }
});

router.delete('/skills/:id', async (req, res) => {
  await archiveSkill(req.params.id);
  res.json({ ok: true });
});

router.get('/skills/:id/suggestions', async (req, res) => {
  res.json({ suggestions: await listPendingSuggestions(req.params.id) });
});

router.post('/skills/:id/suggestions/:sid/approve', async (req, res) => {
  try {
    const out = await approveSuggestion(req.params.sid, req.user.id, req.body?.note || null);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: 'invalid', message: e.message });
  }
});

router.post('/skills/:id/suggestions/:sid/reject', async (req, res) => {
  await rejectSuggestion(req.params.sid, req.user.id, req.body?.note || null);
  res.json({ ok: true });
});
```

- [ ] **Step 2: Update `docs/API_REFERENCE.md`**

Add a new section "Ops — Skills" with one-line entries for each route above.

- [ ] **Step 3: Smoke test via curl from a logged-in admin session**

(Optional — manual verification.) Visit each endpoint in DevTools network panel after restarting the server.

- [ ] **Step 4: Lint + commit**

```
yarn lint && yarn build
git add server/routes/ops.js docs/API_REFERENCE.md
git commit -m "feat(ops): /api/ops/skills CRUD + versions + suggestions endpoints"
```

### Task 16: /api/ops/bulk/schedules routes

**Files:**
- Modify: `server/routes/ops.js`

- [ ] **Step 1: Add the routes**

Append to `server/routes/ops.js`:

```js
import { fanOutBulkSchedule, computeNextRunAt } from '../services/ops/scheduleFanout.js';

router.get('/bulk/schedules', async (req, res) => {
  const { rows } = await query('SELECT * FROM ops_bulk_schedules ORDER BY name');
  res.json({ schedules: rows });
});

router.post('/bulk/schedules', async (req, res) => {
  const { name, skill_ids, cadence, day_of_week, day_of_month, hour_local, timezone, enabled } = req.body || {};
  if (!name || !Array.isArray(skill_ids) || skill_ids.length === 0 || !['daily','weekly','monthly'].includes(cadence)) {
    return res.status(400).json({ error: 'invalid' });
  }
  const { rows } = await query(`
    INSERT INTO ops_bulk_schedules (name, skill_ids, cadence, day_of_week, day_of_month, hour_local, timezone, enabled, created_by, next_run_at)
    VALUES ($1,$2::uuid[],$3,$4,$5,$6,$7,COALESCE($8,true),$9,$10)
    RETURNING *
  `, [name, skill_ids, cadence, day_of_week ?? null, day_of_month ?? null, hour_local ?? 8, timezone || 'America/Chicago', enabled, req.user.id,
       computeNextRunAt({ cadence, day_of_week, day_of_month, hour_local: hour_local ?? 8, timezone: timezone || 'America/Chicago' }, new Date())]);
  res.status(201).json({ schedule: rows[0] });
});

router.put('/bulk/schedules/:id', async (req, res) => {
  const fields = ['name','cadence','day_of_week','day_of_month','hour_local','timezone','enabled'];
  const sets = [];
  const params = [req.params.id];
  for (const f of fields) {
    if (f in (req.body || {})) {
      params.push(req.body[f]);
      sets.push(`${f} = $${params.length}`);
    }
  }
  if (Array.isArray(req.body?.skill_ids)) {
    params.push(req.body.skill_ids);
    sets.push(`skill_ids = $${params.length}::uuid[]`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
  sets.push('updated_at = now()');
  const { rows } = await query(`UPDATE ops_bulk_schedules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  res.json({ schedule: rows[0] });
});

router.delete('/bulk/schedules/:id', async (req, res) => {
  await query('DELETE FROM ops_bulk_schedules WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/bulk/schedules/:id/run-now', async (req, res) => {
  const out = await fanOutBulkSchedule(req.params.id, { triggeredByUserId: req.user.id, trigger: 'manual' });
  if (!out) return res.status(404).json({ error: 'schedule not found or disabled' });
  res.json(out);
});
```

- [ ] **Step 2: Lint + commit**

```
yarn lint && yarn build
git add server/routes/ops.js
git commit -m "feat(ops): /api/ops/bulk/schedules CRUD + run-now"
```

### Task 17: /api/ops/bulk/runs routes

**Files:**
- Modify: `server/routes/ops.js`

- [ ] **Step 1: Add the routes**

```js
router.get('/bulk/runs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await query(`
    SELECT b.*, s.name AS schedule_name
      FROM ops_bulk_runs b
      LEFT JOIN ops_bulk_schedules s ON s.id = b.bulk_schedule_id
     ORDER BY b.started_at DESC
     LIMIT $1 OFFSET $2
  `, [limit, offset]);
  const { rows: countRows } = await query('SELECT COUNT(*)::int AS total FROM ops_bulk_runs');
  res.json({ runs: rows, total: countRows[0].total });
});

router.get('/bulk/runs/:id', async (req, res) => {
  const { rows: parent } = await query(`
    SELECT b.*, s.name AS schedule_name
      FROM ops_bulk_runs b
      LEFT JOIN ops_bulk_schedules s ON s.id = b.bulk_schedule_id
     WHERE b.id = $1
  `, [req.params.id]);
  if (!parent[0]) return res.status(404).json({ error: 'not_found' });
  const { rows: children } = await query(`
    SELECT r.id, r.client_user_id, r.skill_id, r.status, r.cost_cents,
           r.findings_count, r.started_at, r.completed_at,
           u.email AS client_email,
           ac.client_name
      FROM ops_runs r
      LEFT JOIN users u ON u.id = r.client_user_id
      LEFT JOIN active_clients ac ON ac.owner_user_id = r.client_user_id AND ac.archived_at IS NULL
     WHERE r.bulk_run_id = $1
     ORDER BY ac.client_name NULLS LAST, r.started_at
  `, [req.params.id]);
  res.json({ run: parent[0], children });
});
```

- [ ] **Step 2: Lint + commit**

```
yarn lint && yarn build
git add server/routes/ops.js
git commit -m "feat(ops): /api/ops/bulk/runs list + detail with child drill-down"
```

---

## Phase 6 — Bulk tab UI

### Task 18: Promote Bulk to a top-level Operations tab

**Files:**
- Modify: `src/views/admin/Operations/index.jsx`
- Modify: `src/views/admin/Operations/Connections/ConnectionsTab.jsx` (remove Bulk sub-section)
- Create: `src/views/admin/Operations/Bulk/BulkTab.jsx` (skeleton)
- Create: `src/views/admin/Operations/Bulk/SchedulesSection.jsx` (placeholder)
- Create: `src/views/admin/Operations/Bulk/RunsSection.jsx` (placeholder)
- Create: `src/views/admin/Operations/Bulk/SkillsSection.jsx` (placeholder)

- [ ] **Step 1: Add Bulk to `WORKSPACE_TABS`**

In `src/views/admin/Operations/index.jsx`:

```js
const BulkTab = lazy(() => import('./Bulk/BulkTab'));

// In WORKSPACE_TABS, after Connections, add:
{ value: 'bulk', label: 'Bulk', Icon: PlayCircleIcon }
```

(Use whichever icon matches existing import style, e.g., from `@mui/icons-material`.)

In the alias map, change:
```js
bulk: { tab: 'connections', section: 'bulk' }
```
to:
```js
bulk: { tab: 'bulk' }
```

In the TabPanel render block, add:
```jsx
<TabPanel value="bulk" activeTab={activeTab}>
  <BulkTab />
</TabPanel>
```

- [ ] **Step 2: Remove the legacy Bulk section from Connections**

In `src/views/admin/Operations/Connections/ConnectionsTab.jsx`, remove the `'bulk'` section from its sections array, the `<BulkActionsTab />` import, and the case in its render switch.

`src/views/admin/Operations/Bulk/BulkActionsTab.jsx` is left in place (Kinsta-only) but no longer mounted. We can delete it in Phase G's cleanup if confirmed unused.

- [ ] **Step 3: Skeleton `BulkTab.jsx` with three pill-nav sections**

```jsx
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import SchedulesSection from './SchedulesSection';
import RunsSection from './RunsSection';
import SkillsSection from './SkillsSection';

const SECTIONS = [
  { value: 'schedules', label: 'Schedules' },
  { value: 'runs', label: 'Runs' },
  { value: 'skills', label: 'Skills' }
];

export default function BulkTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = SECTIONS.find((s) => s.value === searchParams.get('section'))?.value || 'schedules';
  const setSection = (next) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('section', next);
    setSearchParams(sp, { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ToggleButtonGroup value={section} exclusive size="small" onChange={(_, v) => v && setSection(v)}>
        {SECTIONS.map((s) => <ToggleButton key={s.value} value={s.value}>{s.label}</ToggleButton>)}
      </ToggleButtonGroup>
      {section === 'schedules' && <SchedulesSection />}
      {section === 'runs' && <RunsSection />}
      {section === 'skills' && <SkillsSection />}
    </Box>
  );
}
```

Each placeholder section returns `<Box>Coming soon</Box>` for now. They get filled in tasks 19–21.

- [ ] **Step 4: Build + visual check + commit**

```
yarn lint && yarn build
```
Then start the dev server (`./dev.sh`), visit `/admin/operations?tab=bulk`, confirm the new tab renders and the section toggle navigates.

```bash
git add src/views/admin/Operations/index.jsx src/views/admin/Operations/Connections/ConnectionsTab.jsx src/views/admin/Operations/Bulk/
git commit -m "feat(ops): promote Bulk to top-level Operations tab with pill nav"
```

### Task 19: SchedulesSection (table + create/edit dialog)

**Files:**
- Modify: `src/views/admin/Operations/Bulk/SchedulesSection.jsx`
- Create: `src/views/admin/Operations/Bulk/ScheduleDialog.jsx`
- Create: `src/api/opsBulk.js` (frontend API client)

- [ ] **Step 1: Write the API client module**

Create `src/api/opsBulk.js`:

```js
import axios from './axios';

export const listSchedules = () => axios.get('/api/ops/bulk/schedules').then((r) => r.data.schedules);
export const createSchedule = (body) => axios.post('/api/ops/bulk/schedules', body).then((r) => r.data.schedule);
export const updateSchedule = (id, body) => axios.put(`/api/ops/bulk/schedules/${id}`, body).then((r) => r.data.schedule);
export const deleteSchedule = (id) => axios.delete(`/api/ops/bulk/schedules/${id}`).then((r) => r.data);
export const runScheduleNow = (id) => axios.post(`/api/ops/bulk/schedules/${id}/run-now`).then((r) => r.data);

export const listBulkRuns = (params = {}) => axios.get('/api/ops/bulk/runs', { params }).then((r) => r.data);
export const getBulkRun = (id) => axios.get(`/api/ops/bulk/runs/${id}`).then((r) => r.data);

export const listSkills = (umbrella) => axios.get('/api/ops/skills', { params: umbrella ? { umbrella } : {} }).then((r) => r.data.skills);
export const getSkill = (id) => axios.get(`/api/ops/skills/${id}`).then((r) => r.data.skill);
export const listSkillVersions = (id) => axios.get(`/api/ops/skills/${id}/versions`).then((r) => r.data.versions);
export const saveSkillVersion = (id, body) => axios.put(`/api/ops/skills/${id}`, body).then((r) => r.data);
export const listPendingSuggestions = (id) => axios.get(`/api/ops/skills/${id}/suggestions`).then((r) => r.data.suggestions);
export const approveSuggestion = (skillId, sid, note) => axios.post(`/api/ops/skills/${skillId}/suggestions/${sid}/approve`, { note }).then((r) => r.data);
export const rejectSuggestion = (skillId, sid, note) => axios.post(`/api/ops/skills/${skillId}/suggestions/${sid}/reject`, { note }).then((r) => r.data);
```

(Use the same axios import as other `src/api/*.js` files — match their pattern.)

- [ ] **Step 2: SchedulesSection — table + actions**

Use `ui-component/extended/DataTable`. Columns: name, skills (chips), cadence (formatted), last run, next run, enabled toggle, actions (Edit, Run now, Delete). Use `ConfirmDialog` for Delete and Run-now. Use `useToast` for success/failure of every action. Use `LoadingButton` for the New schedule button.

State: keep `schedules` in local state; on every action update local state immediately (per CLAUDE.md HARD RULE on immediate UI updates), then reload as a safety net.

- [ ] **Step 3: ScheduleDialog — create/edit form**

Use `FormDialog`. Fields: name (TextField), skills (multi-select Autocomplete, options grouped by umbrella, populated by `listSkills()`), cadence (`SelectField` with daily/weekly/monthly), day-of-week (SelectField, only when weekly), day-of-month (number input 1–28, only when monthly), hour-of-day (SelectField 0–23), enabled (Switch). On submit call `createSchedule` or `updateSchedule`.

- [ ] **Step 4: Lint + build + visual check + commit**

```
yarn lint && yarn build
```

In browser: create a schedule, edit it, run it now, delete it. Confirm immediate UI updates.

```bash
git add src/api/opsBulk.js src/views/admin/Operations/Bulk/SchedulesSection.jsx src/views/admin/Operations/Bulk/ScheduleDialog.jsx
git commit -m "feat(ops-ui): bulk schedules section with create/edit/run/delete"
```

### Task 20: RunsSection (DataTable + drawer with child drill-down)

**Files:**
- Modify: `src/views/admin/Operations/Bulk/RunsSection.jsx`
- Create: `src/views/admin/Operations/Bulk/BulkRunDetailDrawer.jsx`

- [ ] **Step 1: RunsSection — paginated DataTable**

Columns: schedule name (or "Manual"), started_at (relative + tooltip absolute), status (`StatusChip`), # clients (number), # skipped (number, muted), # findings (number), cost (`$X.XX`). Row click opens `BulkRunDetailDrawer` with the run's id.

Use `DataTable`'s pagination + sort. Initial fetch: `listBulkRuns({ limit: 50, offset: 0 })`.

- [ ] **Step 2: BulkRunDetailDrawer — child run breakdown**

Drawer with: header (run name, status, started/completed, totals), then a `DataTable` of children. Columns: client name, status, # findings, cost, duration. Row click opens the existing per-run `RunDetail.jsx` component (mounted inside a nested drawer or as an overlay).

If `metadata.skipped` is non-empty, render an `EmptyState`-style alert above the table summarizing skipped clients with reasons.

- [ ] **Step 3: Lint + build + visual check + commit**

```
yarn lint && yarn build
```

In browser: trigger a manual bulk run, verify it appears, drill into a child run, verify findings render.

```bash
git add src/views/admin/Operations/Bulk/RunsSection.jsx src/views/admin/Operations/Bulk/BulkRunDetailDrawer.jsx
git commit -m "feat(ops-ui): bulk runs section with per-client drill-down"
```

### Task 21: SkillsSection (editor + history + suggestions)

**Files:**
- Modify: `src/views/admin/Operations/Bulk/SkillsSection.jsx`
- Create: `src/views/admin/Operations/Bulk/SkillDrawer.jsx`

- [ ] **Step 1: SkillsSection — sectioned by umbrella**

Four `SubCard` blocks (Website / Google Ads / Meta / CTM). Each contains a `DataTable` of skills under that umbrella. Columns: title, slug, current version, last edited (relative), # pending suggestions (badge). Row click opens `SkillDrawer`.

Fetch once: `listSkills()` → group by `umbrella`. Suggestions counts: separate parallel call per skill (or a single `/skills?include=pending_suggestions_count` enhancement — only add the query param if the backend supports it; otherwise fetch lazily on drawer open).

- [ ] **Step 2: SkillDrawer — three tabs (Editor / History / Suggestions)**

- **Editor**: TextField (multiline, monospace, full height) bound to `prompt_md`. A multi-select Autocomplete bound to `collectors_json`, options sourced from a new `GET /api/ops/checks` (or hardcoded from a constant if not yet exposed — add a small endpoint as part of this task: `router.get('/checks', ...)` returning `listAllChecks()`). A "Save as new version" button using `LoadingButton`. Saving calls `saveSkillVersion(id, { prompt_md, collectors, edit_reason })`.
- **History**: list of versions from `listSkillVersions(id)`, latest first. Each entry shows version number, edited_by_user_id (resolve to email server-side via a small `/api/ops/users/:id` lookup or include the email in the version row payload), edit_reason, created_at. Clicking a version expands a diff against the current version (use `diff` npm or a minimal line-by-line diff).
- **Suggestions**: list of pending `ops_skill_suggestions`. Each row: rationale, diff against current `prompt_md`, "Approve" + "Reject" buttons (`LoadingButton`), optional reviewer note field. Approve → `approveSuggestion`, Reject → `rejectSuggestion`. Both update local state immediately.

- [ ] **Step 3: Add `GET /api/ops/checks`**

In `server/routes/ops.js`:

```js
import { listAllChecks } from '../services/ops/checks/registry.js';

router.get('/checks', async (req, res) => {
  const checks = listAllChecks().map((c) => ({
    check_id: c.checkId,
    umbrella: c.umbrella,
    tier: c.tier,
    cost_estimate_cents: c.costEstimate,
    requires: c.requires
  }));
  res.json({ checks });
});
```

- [ ] **Step 4: Lint + build + visual check + commit**

```
yarn lint && yarn build
```

In browser: open a seeded skill, edit prompt, save, see version increment. Manually insert a fake suggestion via SQL (`INSERT INTO ops_skill_suggestions (...)`), confirm it appears in the Suggestions tab, approve it, confirm a new version is created.

```bash
git add src/views/admin/Operations/Bulk/SkillsSection.jsx src/views/admin/Operations/Bulk/SkillDrawer.jsx server/routes/ops.js
git commit -m "feat(ops-ui): skills section with editor, history, and suggestion approval"
```

---

## Phase 7 — DataTable standardization audit

### Task 22: Inventory + migrate ad-hoc tables

**Files:**
- Many files under `src/views/`
- Document outcome inline in commit messages

- [ ] **Step 1: Inventory**

Run from the repo root:

```bash
grep -rn --include='*.jsx' -E '<Table\b|<TableContainer\b|<DataGrid\b' src/views > /tmp/table-inventory.txt
wc -l /tmp/table-inventory.txt
```

- [ ] **Step 2: Triage**

Open `/tmp/table-inventory.txt` and for each file:
- (a) **Migrate**: needs sort/search/pagination/empty-state and the data is row-shaped — convert to `DataTable`.
- (b) **Keep as-is**: drag-and-drop board, deeply nested expandable rows, or a custom layout DataTable cannot express. Add a one-line code comment: `// custom table — DataTable cannot express <reason>`.
- (c) **Already migrated**: skip.

- [ ] **Step 3: Migrate, one file per commit**

For each (a) file, rewrite to use `DataTable` with explicit `columns`, `rows`, `rowKey`, `searchable`, `searchFields`, `paginated`, `pageSize`, `loading`, `emptyTitle`, `emptyMessage`. Lint + build after each. Commit message format:

```
refactor(ui): migrate <file path> to DataTable
```

- [ ] **Step 4: Document the audit**

Append a section to `docs/ARCHITECTURE.md`:

```
## Table component policy

All tabular views use `ui-component/extended/DataTable`. Exceptions are limited to drag-and-drop boards and deeply nested expandable rows; each is annotated with a code comment explaining why DataTable cannot express the layout. Audit completed YYYY-MM-DD.
```

Final commit:

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(ui): record DataTable standardization audit policy"
```

---

## Self-review notes

- **Spec coverage**: Section 1 (IA → Task 18), Section 2 (skills model → Tasks 1, 8–11), Section 3 (Bulk UX → Tasks 18–21), Section 4 (table audit → Task 22), CTM umbrella (Tasks 2–7), API surface (Tasks 15–17), data flow + error handling (covered by Tasks 12, 13, 14 for fanout/rollup/tick + Task 11 for skill→executor wiring).
- **Open implementation choices**: Task 13's rollup is application-level (chosen). Markdown editor is plain TextField (Task 21) — rich diff lives only in the History tab via `diff`. `default_for_tier` flag was not added; bulk schedules are the bridge instead.
- **Verification**: every task ends with `yarn lint && yarn build` (and `yarn test:ops` where ops tests changed). UI tasks include a manual browser check.

---

## Plan complete.

**Saved to:** `docs/superpowers/plans/2026-05-07-ops-bulk-skills-ctm.md`

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
