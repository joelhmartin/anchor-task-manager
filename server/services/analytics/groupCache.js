/**
 * In-memory TTL cache for group analytics responses.
 * 60-second TTL — long enough to survive tab switches but short
 * enough that data stays reasonably fresh.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map();

function makeKey(prefix, selection, start, end, scopeKey = 'global') {
  const sel = JSON.stringify({
    m: selection.mode,
    u: selection.userId || null,
    g: selection.groupId || null,
    i: [...(selection.includedUserIds || [])].sort(),
    x: [...(selection.excludedUserIds || [])].sort()
  });
  return `${prefix}|${scopeKey}|${sel}|${start}|${end}`;
}

export function getCached(prefix, selection, start, end, scopeKey = 'global') {
  const key = makeKey(prefix, selection, start, end, scopeKey);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCached(prefix, selection, start, end, value, scopeKey = 'global') {
  const key = makeKey(prefix, selection, start, end, scopeKey);
  cache.set(key, { value, storedAt: Date.now() });
  // Simple size cap — if cache gets too big, drop oldest
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

export function clearCache() {
  cache.clear();
}
