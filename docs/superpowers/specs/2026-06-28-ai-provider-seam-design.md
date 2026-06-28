# AI Provider Seam — Design Spec

**Date:** 2026-06-28
**Status:** Approved design — ready for implementation plan
**Repo:** `anchor-task-manager`
**Author:** brainstormed with Claude Code

---

## 1. Background & decision

We explored powering this app's AI features off self-hosted **Claude Code instances** on a
machine we own (subscription usage instead of metered API), reached over a job queue. After
weighing it, we **deferred that** — the actual workload (a few routines, daily summaries,
scheduled content) is light enough that pay-as-you-go API billing, especially with prompt
caching, is cheaper than running a dedicated box 24/7. The Claude Code worker remains a
**documented escape hatch** for if/when volume climbs.

The only thing we build now is the **insurance that makes switching easy**: a thin provider
seam so the AI engine behind each call is a **config choice, selectable per routine / chat /
feature**, not a rewrite.

### Decisions locked
- **Gemini (Vertex) stays the default.** No behavior change by default.
- The engine is **selectable per call** via a logical task key → `{ provider, model }` registry.
- An **Anthropic adapter** is built but ships **dark** (inert without `ANTHROPIC_API_KEY`).
- The **Claude Code worker is NOT built** — the interface only leaves room for it.
- Internal-only usage; no PHI flows through these endpoints (task summaries are internal
  project-management text). Revisit provider terms only if a PHI feature is ever routed here.

---

## 2. Scope

### In scope
- A normalized provider interface in `server/services/ai/`.
- `vertexProvider` (refactor of today's `ai.js` Gemini logic) — the default.
- `anthropicProvider` (Anthropic Messages API; prompt caching + model routing supported;
  inert without an API key).
- A routing registry mapping logical task keys → `{ provider, model }`, overridable by env
  var with zero redeploy.
- Wire the app's **two** existing AI call sites through the registry:
  - `POST /api/tasks/items/:itemId/ai-summary/refresh` (prose summary)
  - `GET /api/tasks/ai/daily-overview` (JSON overview)
- Preserve all existing fallback/graceful-degradation behavior.

### Out of scope (YAGNI)
- The Claude Code worker / job queue (deferred; escape hatch documented in §7).
- Changing the default off Gemini.
- A DB-backed or UI-driven routing editor (env/code map is sufficient now).
- The other two apps (`anchor-hub`, `anchor-ops`) — the interface is reusable later but we
  don't touch them.
- Routing classification or any synchronous/real-time feature (none exist in this repo).

---

## 3. The interface

A single normalized function every engine implements:

```js
// generate(request) -> result
request = {
  system,            // string | undefined — system prompt
  prompt,            // string — user prompt (or)
  messages,          // [{ role, content }] — multi-turn (optional)
  schema,            // JSON schema for structured output (optional)
  json,              // boolean — force JSON output (optional)
  maxTokens,         // optional
  temperature,       // optional
}
result = {
  text,              // string — primary text output
  json,              // parsed object when schema/json requested (else undefined)
  provider,          // 'vertex' | 'anthropic'
  model,             // resolved model id
  usage,             // { inputTokens, outputTokens, cacheReadTokens? } when available
  raw,               // provider-native response, for debugging
}
```

Adapters live in `server/services/ai/`:

| File | Role |
|---|---|
| `index.js` | Public entry: `runAi(taskKey, request, overrides?)` — resolves engine, calls adapter, handles fallback. |
| `routing.js` | The task-key → `{ provider, model }` map + env override parsing. |
| `providers/vertex.js` | Default. Wraps existing Gemini logic from `ai.js`. |
| `providers/anthropic.js` | Anthropic Messages API. Inert without `ANTHROPIC_API_KEY`. |
| `providers/index.js` | Registry: `getProvider(name)`. |

`server/services/ai.js` keeps exporting `generateAiResponse` as a **thin shim** over
`runAi('legacy', …)` so any other importer keeps working unchanged.

---

## 4. Routing registry

`server/services/ai/routing.js` exports a default map:

```js
const DEFAULT_ROUTES = {
  task_item_summary:   { provider: 'vertex', model: 'gemini-2.5-flash' },
  task_daily_overview: { provider: 'vertex', model: 'gemini-2.5-flash' },
  // future, illustrative:
  // 'routine:health-check': { provider: 'anthropic', model: 'claude-haiku-4-5' },
};
```

**Resolution order for a given task key:**
1. Per-call `overrides` argument (if a caller explicitly passes `{ provider, model }`).
2. Env override: `AI_ROUTE_<taskKey>` parsed as `provider:model`
   (e.g. `AI_ROUTE_task_item_summary=anthropic:claude-sonnet-4-6`). Enables switching a
   routine's engine without a redeploy.
3. `DEFAULT_ROUTES[taskKey]`.
4. Global default `{ provider: 'vertex', model: 'gemini-2.5-flash' }`.

Unknown provider name or unconfigured provider → treated as a provider error → fallback (§5).

---

## 5. Fallback (no regression)

`runAi` preserves today's graceful degradation:

1. Resolve engine, call its adapter.
2. On adapter error (network, not-configured, rate-limit, JSON parse failure for schema calls):
   - If the selected provider was **not** the default, retry once with the **default**
     provider (`vertex`).
   - If the default also fails, throw — and the **call site** applies its existing local
     fallback exactly as it does today (`localSummarizeUpdates`, last-cached overview, etc.).
3. Structured calls (`schema`/`json`) validate the parsed output; a parse/validation miss is
   treated as a provider error so the fallback chain runs rather than returning garbage.

Net effect: with no env overrides and no Anthropic key, behavior is **identical** to today.

---

## 6. Call-site changes

Both are minimal — swap the direct `generateAiResponse` call for `runAi(taskKey, …)`:

- **`ai-summary/refresh`** → `runAi('task_item_summary', { system, prompt })`. Prose; no schema.
  Writes `task_item_ai_summaries` exactly as now, recording `provider` + `model` from the result.
- **`ai/daily-overview`** → `runAi('task_daily_overview', { system, prompt, schema })`. JSON;
  validates against the existing overview shape. Writes `task_ai_daily_overviews` as now.

No DB schema change required (existing `provider` / `model` columns already capture engine
identity). If a column is missing, add it as an idempotent migration following the repo's
migration convention.

---

## 7. Escape hatch (documented, not built)

If API costs climb past expectations, the seam graduates cleanly:

- Add `providers/claudeCode.js` implementing the same interface, backed by a worker on an
  owned box (DB-backed job table + token-authed claim API + outbound-polling worker running
  Claude Code via the Agent SDK / `claude -p`, with Vertex as the automatic backstop).
- Point selected task keys at it via the routing registry / env overrides — **no call-site
  changes**.

That full worker architecture was designed and intentionally deferred; this spec is the seam
that makes adopting it a config change.

---

## 8. Anthropic adapter notes (for when it's switched on)

- Auth: `ANTHROPIC_API_KEY` (env / Secret Manager). Absent → adapter reports "not configured"
  and the fallback chain runs.
- Supports **prompt caching** (mark stable system/context blocks as cacheable) — the main cost
  lever for repetitive routines.
- Model routing via the registry: Haiku for mechanical work, Sonnet for content, Opus for
  heavy reasoning.
- Current model ids (for reference, validate at build time): `claude-haiku-4-5`,
  `claude-sonnet-4-6`, `claude-opus-4-8`.
- JSON output via tool-use or strict prompting + validation, normalized into `result.json`.

---

## 9. Verification (no test suite)

- `yarn build` + `yarn lint` clean.
- Default path unchanged: both endpoints return Gemini-backed results with no env overrides.
- Set `AI_ROUTE_task_item_summary=anthropic:claude-haiku-4-5` **without** a key → endpoint
  still returns a summary via Vertex fallback (proves dark-ship + fallback).
- With a key set, the same override returns an Anthropic-backed summary; `provider`/`model`
  persisted correctly.
