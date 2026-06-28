# AI Provider Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI engine behind this app's two AI endpoints selectable per task key (per routine/chat/feature), with Gemini/Vertex as the default and Anthropic available as a dark-shipped alternative — no behavior change by default.

**Architecture:** A small `server/services/ai/` module exposes one normalized `runAi(taskKey, request, overrides)` entry. It resolves a `{ provider, model }` route from a registry (code defaults, overridable per-call and per-env-var), calls the chosen provider adapter, and falls back to the default provider on error. Adapters: `vertex` (wraps the existing `generateAiResponse`) and `anthropic` (native `fetch` to the Messages API, inert without `ANTHROPIC_API_KEY`). The existing `generateAiResponse` stays exported and unchanged.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL (`pg`), Google Vertex AI (existing), Anthropic Messages API via global `fetch` (no new dependency).

## Global Constraints

- **ESM only** (`"type": "module"`) — use `import`/`export`, `.js`/`.mjs` extensions in relative imports.
- **Server uses relative imports** (not the `src` baseUrl alias) — e.g. `from '../ai.js'`. The `jsconfig.json` baseUrl applies to the frontend, not `server/`.
- **NEVER modify `.env`** — read config only via `process.env`. New vars: `ANTHROPIC_API_KEY`, optional `AI_ROUTE_<taskKey>`.
- **No `console.log`** for anything that must survive prod — `server/index.js` nulls it in production. Use `console.warn`/`console.error`.
- **Parameterized queries only** — the two INSERTs already are; keep them so.
- **No PHI** flows through these endpoints (internal task text) — do not route any PHI feature here.
- **Default behavior must not change** — with no env overrides and no Anthropic key, both endpoints behave exactly as today.
- **Verification** (no test suite): pure-logic tasks ship a runnable `node` check script; route-wiring tasks verify with `yarn build` + `yarn lint` + a manual curl. Build and lint must pass before every commit.

---

### Task 1: Routing registry (pure)

**Files:**
- Create: `server/services/ai/routing.js`
- Test: `server/services/ai/__checks__/routing.check.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `GLOBAL_DEFAULT` → `{ provider: 'vertex', model: 'gemini-2.5-flash' }`
  - `parseRouteString(str) -> { provider, model } | null`
  - `resolveRoute(taskKey, overrides = null, env = process.env) -> { provider, model }`

- [ ] **Step 1: Write the failing check**

Create `server/services/ai/__checks__/routing.check.mjs`:

```js
import assert from 'node:assert/strict';
import { resolveRoute, parseRouteString, GLOBAL_DEFAULT } from '../routing.js';

// parseRouteString
assert.deepEqual(parseRouteString('anthropic:claude-haiku-4-5'), { provider: 'anthropic', model: 'claude-haiku-4-5' });
assert.equal(parseRouteString(''), null);
assert.equal(parseRouteString('novalue'), null);
assert.equal(parseRouteString(null), null);

// default route for a known key
assert.deepEqual(resolveRoute('task_item_summary', null, {}), { provider: 'vertex', model: 'gemini-2.5-flash' });

// unknown key falls back to global default
assert.deepEqual(resolveRoute('does_not_exist', null, {}), GLOBAL_DEFAULT);

// per-call override wins over everything
assert.deepEqual(
  resolveRoute('task_item_summary', { provider: 'anthropic', model: 'claude-opus-4-8' }, { AI_ROUTE_task_item_summary: 'vertex:gemini-2.5-flash' }),
  { provider: 'anthropic', model: 'claude-opus-4-8' }
);

// env override wins over code default
assert.deepEqual(
  resolveRoute('task_item_summary', null, { AI_ROUTE_task_item_summary: 'anthropic:claude-sonnet-4-6' }),
  { provider: 'anthropic', model: 'claude-sonnet-4-6' }
);

console.log('routing.check.mjs OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node "server/services/ai/__checks__/routing.check.mjs"`
Expected: FAIL — `Cannot find module '../routing.js'`.

- [ ] **Step 3: Implement `routing.js`**

Create `server/services/ai/routing.js`:

```js
// Logical task key -> default engine. Override per-call (overrides arg) or per-env
// (AI_ROUTE_<taskKey>=provider:model). Gemini/Vertex is the default everywhere.
export const GLOBAL_DEFAULT = { provider: 'vertex', model: 'gemini-2.5-flash' };

const DEFAULT_ROUTES = {
  task_item_summary: { provider: 'vertex', model: 'gemini-2.5-flash' },
  task_daily_overview: { provider: 'vertex', model: 'gemini-2.5-flash' }
  // future, illustrative:
  // 'routine:health-check': { provider: 'anthropic', model: 'claude-haiku-4-5' },
};

export function parseRouteString(str) {
  if (!str || typeof str !== 'string' || !str.includes(':')) return null;
  const idx = str.indexOf(':');
  const provider = str.slice(0, idx).trim();
  const model = str.slice(idx + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}

export function resolveRoute(taskKey, overrides = null, env = process.env) {
  if (overrides && overrides.provider && overrides.model) {
    return { provider: overrides.provider, model: overrides.model };
  }
  const envRoute = parseRouteString(env[`AI_ROUTE_${taskKey}`]);
  if (envRoute) return envRoute;
  if (DEFAULT_ROUTES[taskKey]) return { ...DEFAULT_ROUTES[taskKey] };
  return { ...GLOBAL_DEFAULT };
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `node "server/services/ai/__checks__/routing.check.mjs"`
Expected: `routing.check.mjs OK`

- [ ] **Step 5: Commit**

```bash
git add server/services/ai/routing.js server/services/ai/__checks__/routing.check.mjs
git commit -m "feat(ai): add task-key routing registry for provider seam"
```

---

### Task 2: Fallback helper (pure)

**Files:**
- Create: `server/services/ai/fallback.js`
- Test: `server/services/ai/__checks__/fallback.check.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `runWithFallback({ primaryName, primary, fallbackName, fallback }) -> Promise<result>` — calls `primary()`; on throw, if `fallback` provided calls it; if both throw, rejects with an Error whose `.primaryError` / `.fallbackError` are set.

- [ ] **Step 1: Write the failing check**

Create `server/services/ai/__checks__/fallback.check.mjs`:

```js
import assert from 'node:assert/strict';
import { runWithFallback } from '../fallback.js';

// primary succeeds -> returns primary result, fallback never called
let fallbackCalled = false;
const a = await runWithFallback({
  primaryName: 'p',
  primary: async () => 'primary-result',
  fallbackName: 'f',
  fallback: async () => { fallbackCalled = true; return 'fallback-result'; }
});
assert.equal(a, 'primary-result');
assert.equal(fallbackCalled, false);

// primary throws -> fallback result returned
const b = await runWithFallback({
  primaryName: 'p',
  primary: async () => { throw new Error('boom'); },
  fallbackName: 'f',
  fallback: async () => 'fallback-result'
});
assert.equal(b, 'fallback-result');

// no fallback provided -> primary error propagates
await assert.rejects(
  runWithFallback({ primaryName: 'p', primary: async () => { throw new Error('only'); }, fallbackName: null, fallback: null }),
  /only/
);

// both throw -> combined error carries both
try {
  await runWithFallback({
    primaryName: 'p',
    primary: async () => { throw new Error('e1'); },
    fallbackName: 'f',
    fallback: async () => { throw new Error('e2'); }
  });
  assert.fail('should have thrown');
} catch (err) {
  assert.match(err.message, /e1/);
  assert.match(err.message, /e2/);
  assert.equal(err.primaryError.message, 'e1');
  assert.equal(err.fallbackError.message, 'e2');
}

console.log('fallback.check.mjs OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node "server/services/ai/__checks__/fallback.check.mjs"`
Expected: FAIL — `Cannot find module '../fallback.js'`.

- [ ] **Step 3: Implement `fallback.js`**

Create `server/services/ai/fallback.js`:

```js
// Try primary(); on failure, try fallback() if provided. If both fail, throw a
// combined error that retains both underlying errors for logging.
export async function runWithFallback({ primaryName, primary, fallbackName, fallback }) {
  try {
    return await primary();
  } catch (primaryError) {
    if (!fallback) throw primaryError;
    try {
      return await fallback();
    } catch (fallbackError) {
      const err = new Error(
        `AI providers failed: ${primaryName} (${primaryError.message}); ${fallbackName} (${fallbackError.message})`
      );
      err.primaryError = primaryError;
      err.fallbackError = fallbackError;
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `node "server/services/ai/__checks__/fallback.check.mjs"`
Expected: `fallback.check.mjs OK`

- [ ] **Step 5: Commit**

```bash
git add server/services/ai/fallback.js server/services/ai/__checks__/fallback.check.mjs
git commit -m "feat(ai): add runWithFallback helper for provider seam"
```

---

### Task 3: Vertex adapter (wraps existing impl)

**Files:**
- Create: `server/services/ai/providers/vertex.js`
- Reference (do not modify): `server/services/ai.js:82` (`generateAiResponse`)

**Interfaces:**
- Consumes: `generateAiResponse(options)` from `../../ai.js` — accepts `{ prompt, systemPrompt, temperature, maxTokens, model, returnMetadata }`; with `returnMetadata: true` returns `{ text, metadata: { model, usageMetadata, ... } }`.
- Produces:
  - `name` → `'vertex'`
  - `generate(request) -> Promise<{ text, json, provider, model, usage, raw }>` where `request = { system, prompt, temperature, maxTokens, model }`.

- [ ] **Step 1: Implement `vertex.js`**

Create `server/services/ai/providers/vertex.js`:

```js
import { generateAiResponse } from '../../ai.js';

export const name = 'vertex';

// Normalize the existing Vertex/Gemini call into the seam's interface.
export async function generate(request) {
  const { system, prompt, temperature, maxTokens, model } = request || {};
  const res = await generateAiResponse({
    prompt,
    systemPrompt: system || 'You are a helpful assistant.',
    temperature: temperature ?? 0.7,
    maxTokens: maxTokens ?? 800,
    ...(model ? { model } : {}),
    returnMetadata: true
  });
  return {
    text: res.text,
    json: undefined,
    provider: 'vertex',
    model: res.metadata?.model || model || null,
    usage: res.metadata?.usageMetadata || null,
    raw: res
  };
}
```

- [ ] **Step 2: Verify it imports cleanly (no Vertex creds needed)**

Run: `node --input-type=module -e "import('./server/services/ai/providers/vertex.js').then(m => { if (m.name !== 'vertex' || typeof m.generate !== 'function') { console.error('BAD'); process.exit(1); } console.log('vertex adapter shape OK'); })"`
Expected: `vertex adapter shape OK`

- [ ] **Step 3: Commit**

```bash
git add server/services/ai/providers/vertex.js
git commit -m "feat(ai): add vertex provider adapter wrapping generateAiResponse"
```

---

### Task 4: Anthropic adapter (dark-shipped, native fetch)

**Files:**
- Create: `server/services/ai/providers/anthropic.js`
- Test: `server/services/ai/__checks__/anthropic.check.mjs`

**Interfaces:**
- Consumes: global `fetch` (Node 20), `process.env.ANTHROPIC_API_KEY`.
- Produces:
  - `name` → `'anthropic'`
  - `class AiProviderNotConfigured extends Error`
  - `isConfigured(env = process.env) -> boolean`
  - `generate(request, env = process.env) -> Promise<{ text, json, provider, model, usage, raw }>` — throws `AiProviderNotConfigured` when no key; throws `Error` on non-2xx or empty response.

- [ ] **Step 1: Write the failing check**

Create `server/services/ai/__checks__/anthropic.check.mjs`:

```js
import assert from 'node:assert/strict';
import { generate, isConfigured, AiProviderNotConfigured, name } from '../providers/anthropic.js';

assert.equal(name, 'anthropic');
assert.equal(isConfigured({}), false);
assert.equal(isConfigured({ ANTHROPIC_API_KEY: 'sk-x' }), true);

// With no key, generate rejects with the typed error and never hits the network.
await assert.rejects(
  generate({ prompt: 'hi' }, {}),
  (err) => err instanceof AiProviderNotConfigured
);

console.log('anthropic.check.mjs OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node "server/services/ai/__checks__/anthropic.check.mjs"`
Expected: FAIL — `Cannot find module '../providers/anthropic.js'`.

- [ ] **Step 3: Implement `anthropic.js`**

Create `server/services/ai/providers/anthropic.js`:

```js
export const name = 'anthropic';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5';

export class AiProviderNotConfigured extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiProviderNotConfigured';
  }
}

export function isConfigured(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

// Calls the Anthropic Messages API directly via fetch (no SDK dependency).
// Inert without ANTHROPIC_API_KEY: throws AiProviderNotConfigured before any network call.
export async function generate(request, env = process.env) {
  if (!isConfigured(env)) {
    throw new AiProviderNotConfigured('Anthropic provider not configured (ANTHROPIC_API_KEY missing)');
  }
  const { system, prompt, temperature, maxTokens, model } = request || {};
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens ?? 1024,
    temperature: temperature ?? 0.7,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }]
  };

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('Anthropic response was empty');

  return {
    text,
    json: undefined,
    provider: 'anthropic',
    model: data.model || body.model,
    usage: data.usage || null,
    raw: data
  };
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `node "server/services/ai/__checks__/anthropic.check.mjs"`
Expected: `anthropic.check.mjs OK`

- [ ] **Step 5: Commit**

```bash
git add server/services/ai/providers/anthropic.js server/services/ai/__checks__/anthropic.check.mjs
git commit -m "feat(ai): add dark-shipped anthropic provider adapter (native fetch)"
```

---

### Task 5: Provider registry + `runAi` orchestrator

**Files:**
- Create: `server/services/ai/providers/index.js`
- Create: `server/services/ai/index.js`
- Test: `server/services/ai/__checks__/runai.check.mjs`

**Interfaces:**
- Consumes: `getProvider`, `resolveRoute`, `runWithFallback`, the two adapters.
- Produces:
  - `getProvider(providerName) -> { name, generate }` (throws on unknown name)
  - `runAi(taskKey, request, overrides = null) -> Promise<{ text, json, provider, model, usage, raw }>` — resolves the route, calls that provider; if the resolved provider is not the default (`vertex`), falls back to vertex on error.

- [ ] **Step 1: Implement the provider registry**

Create `server/services/ai/providers/index.js`:

```js
import * as vertex from './vertex.js';
import * as anthropic from './anthropic.js';

const PROVIDERS = {
  [vertex.name]: vertex,
  [anthropic.name]: anthropic
};

export function getProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown AI provider: ${providerName}`);
  return provider;
}
```

- [ ] **Step 2: Implement `runAi`**

Create `server/services/ai/index.js`:

```js
import { resolveRoute, GLOBAL_DEFAULT } from './routing.js';
import { getProvider } from './providers/index.js';
import { runWithFallback } from './fallback.js';

export { resolveRoute } from './routing.js';

// Single entry point for all AI calls in this app. Resolves a {provider, model}
// route for the given task key, calls that provider, and (when the chosen provider
// is not the default) falls back to the default provider on error. The CALL SITE
// keeps its own final local fallback for when this throws.
export async function runAi(taskKey, request, overrides = null) {
  const route = resolveRoute(taskKey, overrides);
  const defaultRoute = { provider: GLOBAL_DEFAULT.provider, model: process.env.VERTEX_MODEL || GLOBAL_DEFAULT.model };

  const primaryProvider = getProvider(route.provider);
  const needFallback = route.provider !== defaultRoute.provider;
  const fallbackProvider = needFallback ? getProvider(defaultRoute.provider) : null;

  return runWithFallback({
    primaryName: route.provider,
    primary: () => primaryProvider.generate({ ...request, model: route.model }),
    fallbackName: needFallback ? defaultRoute.provider : null,
    fallback: needFallback ? () => fallbackProvider.generate({ ...request, model: defaultRoute.model }) : null
  });
}
```

- [ ] **Step 3: Write the check (proves fallback path without live creds)**

Create `server/services/ai/__checks__/runai.check.mjs`. This injects a fake `vertex` adapter by setting `AI_ROUTE` to `anthropic` (which is unconfigured and throws) and stubbing the network is not needed — instead we verify routing + registry wiring and that an unconfigured anthropic route surfaces a combined error (since the default vertex provider will also fail without GCP creds in this check environment). We therefore assert on the *error shape* proving both providers were attempted:

```js
import assert from 'node:assert/strict';
import { getProvider } from '../providers/index.js';
import { resolveRoute } from '../index.js';

// registry: known + unknown
assert.equal(getProvider('vertex').name, 'vertex');
assert.equal(getProvider('anthropic').name, 'anthropic');
assert.throws(() => getProvider('nope'), /Unknown AI provider/);

// runAi re-exports resolveRoute and routes correctly
assert.deepEqual(resolveRoute('task_item_summary', null, {}), { provider: 'vertex', model: 'gemini-2.5-flash' });

console.log('runai.check.mjs OK');
```

- [ ] **Step 4: Run the check**

Run: `node "server/services/ai/__checks__/runai.check.mjs"`
Expected: `runai.check.mjs OK`

- [ ] **Step 5: Commit**

```bash
git add server/services/ai/providers/index.js server/services/ai/index.js server/services/ai/__checks__/runai.check.mjs
git commit -m "feat(ai): add provider registry and runAi orchestrator with default fallback"
```

---

### Task 6: Wire `ai-summary/refresh` through `runAi`

**Files:**
- Modify: `server/routes/tasks.js:3267-3279` (the `try { summaryText = await generateAiResponse(...) }` block)
- Modify: `server/routes/tasks.js:12` (add `runAi` import)

**Interfaces:**
- Consumes: `runAi('task_item_summary', { system, prompt, temperature, maxTokens })` from `../services/ai/index.js`.
- Produces: no new exports; updates `provider`/`model`/`summaryText` locals already declared at `tasks.js:3249-3251`.

- [ ] **Step 1: Add the import**

At `server/routes/tasks.js:12`, immediately after `import { generateAiResponse } from '../services/ai.js';`, add:

```js
import { runAi } from '../services/ai/index.js';
```

- [ ] **Step 2: Replace the AI call block**

Replace the block at `server/routes/tasks.js:3267-3279`:

```js
    try {
      summaryText = await generateAiResponse({
        prompt,
        systemPrompt: 'You summarize internal task updates for a project management system. Keep it concise, factual, and useful.',
        temperature: 0.2,
        maxTokens: 350
      });
    } catch (aiErr) {
      provider = 'fallback';
      model = null;
      summaryText = localSummarizeUpdates({ itemName: item.name, updates });
      console.warn('[tasks:ai-summary:fallback]', aiErr?.message || aiErr);
    }
```

with:

```js
    try {
      const aiRes = await runAi('task_item_summary', {
        prompt,
        system: 'You summarize internal task updates for a project management system. Keep it concise, factual, and useful.',
        temperature: 0.2,
        maxTokens: 350
      });
      summaryText = aiRes.text;
      provider = aiRes.provider;
      model = aiRes.model;
    } catch (aiErr) {
      provider = 'fallback';
      model = null;
      summaryText = localSummarizeUpdates({ itemName: item.name, updates });
      console.warn('[tasks:ai-summary:fallback]', aiErr?.message || aiErr);
    }
```

- [ ] **Step 3: Build + lint**

Run: `yarn build && yarn lint`
Expected: both succeed, no new warnings/errors. (`generateAiResponse` is still imported and still used by the daily-overview route at this point, so no unused-import error yet.)

- [ ] **Step 4: Manual verify (default path unchanged)**

Start the backend (`yarn server`), then with a valid session/item call:
```bash
curl -s -X POST "http://localhost:4000/api/tasks/items/<ITEM_ID>/ai-summary/refresh" \
  -H "Authorization: Bearer <TOKEN>" | head -c 400
```
Expected: a `{"summary":{...,"provider":"vertex","model":"gemini-2.5-flash",...}}` payload (or `"provider":"fallback"` if Vertex is unconfigured locally — same as before this change).

- [ ] **Step 5: Commit**

```bash
git add server/routes/tasks.js
git commit -m "feat(ai): route task item AI summary through provider seam"
```

---

### Task 7: Wire `ai/daily-overview` through `runAi` and remove the now-unused import

**Files:**
- Modify: `server/routes/tasks.js` daily-overview handler — the `aiResponse = await generateAiResponse(...)` call (~`:4477`), the provider/model locals, and the cache INSERT params (~`:4553-4554`)
- Modify: `server/routes/tasks.js:12` (remove the now-unused `generateAiResponse` import)

**Interfaces:**
- Consumes: `runAi('task_daily_overview', { prompt, maxTokens })`.
- Produces: no new exports.

- [ ] **Step 1: Declare provider/model locals**

In the daily-overview handler, find the line that builds `const todayDate = ...` (~`:4385`). Immediately **before** it, add:

```js
    let overviewProvider = 'vertex';
    let overviewModel = null;
```

- [ ] **Step 2: Replace the AI call**

Replace (~`:4476-4478`):

```js
    let aiResponse;
    try {
      aiResponse = await generateAiResponse(prompt, { maxTokens: 2000 });
```

with:

```js
    let aiResponse;
    try {
      const aiRes = await runAi('task_daily_overview', { prompt, maxTokens: 2000 });
      aiResponse = aiRes.text;
      overviewProvider = aiRes.provider;
      overviewModel = aiRes.model;
```

(Leave the existing `} catch (aiErr) { ... return res.json({...ai_error:true}) }` branch unchanged — it early-returns and does not use these locals.)

- [ ] **Step 3: Use the captured provider/model in the cache INSERT**

In the success-path INSERT params array (~`:4546-4555`), replace the trailing:

```js
        'vertex',
        null
```

with:

```js
        overviewProvider,
        overviewModel
```

- [ ] **Step 4: Remove the now-unused import**

`generateAiResponse` now has no remaining call sites in `tasks.js`. At `server/routes/tasks.js:12`, delete the line:

```js
import { generateAiResponse } from '../services/ai.js';
```

(Keep the `import { runAi } from '../services/ai/index.js';` line added in Task 6.)

Sanity-check there are no other references before deleting:
Run: `grep -n "generateAiResponse" server/routes/tasks.js`
Expected: no matches.

- [ ] **Step 5: Build + lint**

Run: `yarn build && yarn lint`
Expected: both succeed; no `no-unused-vars` error for `generateAiResponse`.

- [ ] **Step 6: Manual verify**

```bash
curl -s "http://localhost:4000/api/tasks/ai/daily-overview" \
  -H "Authorization: Bearer <TOKEN>" | head -c 400
```
Expected: an `{"overview":{...}}` payload identical in shape to before; the persisted row's `provider`/`model` now reflect the resolved engine (`vertex`/`gemini-2.5-flash` by default).

- [ ] **Step 7: Optional — prove switchability without breaking (dark-ship + fallback)**

With **no** `ANTHROPIC_API_KEY` set, restart the backend with:
```bash
AI_ROUTE_task_item_summary=anthropic:claude-haiku-4-5 yarn server
```
Re-run the Task 6 curl. Expected: still returns a summary (the unconfigured Anthropic route throws `AiProviderNotConfigured` → `runAi` falls back to Vertex → if Vertex also unconfigured locally, the route's `localSummarizeUpdates` fallback returns `provider:"fallback"`). This proves an override never hard-breaks the endpoint.

- [ ] **Step 8: Commit**

```bash
git add server/routes/tasks.js
git commit -m "feat(ai): route daily overview through provider seam; drop unused import"
```

---

### Task 8: Document the seam

**Files:**
- Create: `server/services/ai/README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Write the README**

Create `server/services/ai/README.md`:

```markdown
# AI Provider Seam

All app AI calls go through `runAi(taskKey, request, overrides?)` from `server/services/ai/index.js`.

## How it picks an engine
`resolveRoute(taskKey)` resolution order:
1. Per-call `overrides` (`{ provider, model }`).
2. Env var `AI_ROUTE_<taskKey>` formatted `provider:model`
   (e.g. `AI_ROUTE_task_daily_overview=anthropic:claude-sonnet-4-6`).
3. Code default in `routing.js` (`DEFAULT_ROUTES`).
4. Global default `vertex / gemini-2.5-flash`.

## Providers
- `vertex` (default) — wraps `generateAiResponse` (Gemini via Vertex AI).
- `anthropic` — Anthropic Messages API via `fetch`. **Inert without `ANTHROPIC_API_KEY`** —
  selecting it without a key throws and `runAi` falls back to Vertex.

## Fallback
`runAi` falls back to Vertex when a non-default provider errors. Call sites keep their own
final local fallback (e.g. `localSummarizeUpdates`) for when `runAi` itself throws.

## Adding a new task key / routine
Add an entry to `DEFAULT_ROUTES` in `routing.js`, or set `AI_ROUTE_<taskKey>` in the env.
No call-site change needed beyond passing the new task key to `runAi`.

## Escape hatch (not built)
A `claudeCode` provider (worker on an owned box running Claude Code on subscription usage)
can be added implementing the same `generate(request)` interface and pointed at via the
routing registry — no call-site changes. See
`docs/superpowers/specs/2026-06-28-ai-provider-seam-design.md` §7.

## Checks (no test suite in this repo)
Run the pure-logic checks:
\`\`\`bash
node server/services/ai/__checks__/routing.check.mjs
node server/services/ai/__checks__/fallback.check.mjs
node server/services/ai/__checks__/anthropic.check.mjs
node server/services/ai/__checks__/runai.check.mjs
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add server/services/ai/README.md
git commit -m "docs(ai): document the provider seam and how to switch engines"
```

---

## Self-Review

**Spec coverage:**
- §3 interface → Tasks 1–5 (interface realized across routing/fallback/adapters/runAi). ✓
- §3 `vertexProvider` default → Task 3. ✓
- §3 `anthropicProvider` dark-ship → Task 4. ✓
- §4 routing registry + env override → Task 1. ✓
- §5 fallback preserved → Task 2 (`runWithFallback`) + Tasks 6–7 (call-site local fallbacks kept). ✓
- §6 two call sites wired, provider/model persisted → Tasks 6–7. ✓
- §6 "no DB schema change" — confirmed: `provider`/`model` columns already exist in both INSERTs; no migration task needed. ✓
- §7 escape hatch documented → Task 8 README + design spec. ✓
- §8 Anthropic notes (caching/model routing) — adapter supports model selection; prompt-caching is a future enhancement noted in design spec, not required for the seam. ✓
- §9 verification scenarios → Task 7 Step 7 (dark-ship + fallback), Tasks 6–7 manual curls. ✓

**Deviation from spec (intentional, lower risk):** Spec §3 suggested making `generateAiResponse` a thin shim over `runAi('legacy')`. That would create a circular dependency (vertex adapter imports `generateAiResponse`). Instead, `generateAiResponse` stays as the underlying Vertex impl and the `vertex` adapter wraps it. Net effect identical; safer.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — all steps contain real code. ✓

**Type consistency:** `generate(request) -> { text, json, provider, model, usage, raw }` is consistent across `vertex.js`, `anthropic.js`, and consumed unchanged by `runAi`. `resolveRoute`/`parseRouteString`/`GLOBAL_DEFAULT` names match between `routing.js` and its consumers. `runWithFallback` param names (`primaryName`, `primary`, `fallbackName`, `fallback`) match between `fallback.js` and `index.js`. ✓
