// Logical task key -> default engine. Override per-call (overrides arg) or per-env
// (AI_ROUTE_<taskKey>=provider:model). Gemini/Vertex is the default everywhere.
export const GLOBAL_DEFAULT = { provider: 'vertex', model: 'gemini-2.5-flash' };

const DEFAULT_ROUTES = {
  task_item_summary: { provider: 'vertex' },
  task_daily_overview: { provider: 'vertex' }
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

// For a vertex route with no explicit model, honor VERTEX_MODEL (matches the
// DEFAULT_MODEL fallback in server/services/ai.js) so a configured model isn't
// silently overridden. Read from the passed env for deterministic checks.
function modelForRoute(route, env) {
  if (route.model) return route.model;
  if (route.provider === GLOBAL_DEFAULT.provider) return env.VERTEX_MODEL || GLOBAL_DEFAULT.model;
  return GLOBAL_DEFAULT.model;
}

export function resolveRoute(taskKey, overrides = null, env = process.env) {
  if (overrides && overrides.provider && overrides.model) {
    return { provider: overrides.provider, model: overrides.model };
  }
  const envRoute = parseRouteString(env[`AI_ROUTE_${taskKey}`]);
  if (envRoute) return envRoute;
  // For GLOBAL_DEFAULT fall-through, strip the model so modelForRoute checks VERTEX_MODEL first.
  const base = DEFAULT_ROUTES[taskKey] || { provider: GLOBAL_DEFAULT.provider };
  return { provider: base.provider, model: modelForRoute(base, env) };
}
