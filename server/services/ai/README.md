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
```bash
node server/services/ai/__checks__/routing.check.mjs
node server/services/ai/__checks__/fallback.check.mjs
node server/services/ai/__checks__/anthropic.check.mjs
node server/services/ai/__checks__/runai.check.mjs
```
