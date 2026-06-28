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
