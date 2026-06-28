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
