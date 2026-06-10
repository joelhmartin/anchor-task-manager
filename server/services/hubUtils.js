// Shared utilities for server/routes/hub.js and routes extracted from it.
// Import from here; never re-define these in individual route files.

function normalizeBase(value) {
  if (!value) return null;
  let base = String(value).trim();
  if (!/^https?:\/\//i.test(base)) {
    const isLocal = base.startsWith('localhost') || base.startsWith('127.0.0.1');
    base = `${isLocal ? 'http' : 'https'}://${base}`;
  }
  return base.replace(/\/$/, '');
}

/**
 * Resolve the app's public base URL from request headers and env vars.
 * Used to build links in emails and notifications sent from hub routes.
 */
export function resolveBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const isLocalHost = host && (host.includes('localhost') || host.includes('127.0.0.1'));

  const localOverride = normalizeBase(process.env.LOCAL_APP_BASE_URL);
  if (isLocalHost && localOverride) return localOverride;

  if (isLocalHost && process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }

  const fromEnv = normalizeBase(
    process.env.APP_BASE_URL ||
      process.env.CLIENT_APP_URL ||
      process.env.APP_URL ||
      process.env.PUBLIC_URL ||
      process.env.VITE_APP_BASE_NAME
  );
  if (fromEnv) return fromEnv;

  if (host) return normalizeBase(`${proto}://${host}`);

  return 'http://localhost:3000';
}

/**
 * Structured console.log for hub route events.
 * NOTE: console.log is nulled in production (server/index.js) — these entries
 * are development-only. Use console.error/warn for anything that must surface
 * in Cloud Run logs.
 */
export function logEvent(scope, message, payload = {}) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] [${scope}] ${message}${Object.keys(payload).length ? ` :: ${JSON.stringify(payload)}` : ''}`);
}
