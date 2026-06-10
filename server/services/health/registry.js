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
