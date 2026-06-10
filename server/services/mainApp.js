/**
 * Main app (anchor-hub) integration — the Task Manager's one real cross-app link.
 *
 * The Task Manager owns its own database and trusts the shared JWT for identity,
 * but two pieces of display data live in the main app and are fetched on demand:
 *   1. User profiles  — names/emails for SSO users we JIT-provisioned with placeholders.
 *   2. Client roster  — board → client labels (when boards are linked to clients).
 *
 * Both calls are READ-ONLY and degrade gracefully: if MAIN_APP_URL is unset, every
 * function resolves to null/[] and the app keeps working with local data only.
 *
 * Contract the main app must expose (shared JWT / service token auth):
 *   GET {MAIN_APP_URL}/api/internal/users/:id   -> { id, email, first_name, last_name, role }
 *   GET {MAIN_APP_URL}/api/hub/client-roster      -> [{ user_id, client_label, ... }]
 */

const MAIN_APP_URL = (process.env.MAIN_APP_URL || '').replace(/\/$/, '');
const SERVICE_TOKEN = process.env.MAIN_APP_SERVICE_TOKEN || '';
const TIMEOUT_MS = Number(process.env.MAIN_APP_TIMEOUT_MS || 5000);

export function isMainAppConfigured() {
  return Boolean(MAIN_APP_URL);
}

async function getJson(path) {
  if (!MAIN_APP_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${MAIN_APP_URL}${path}`, {
      headers: SERVICE_TOKEN ? { authorization: `Bearer ${SERVICE_TOKEN}` } : {},
      signal: controller.signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('[mainApp]', path, err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a user's profile from the main app. Returns null if unavailable.
 * @param {string} userId
 */
export async function fetchUserProfile(userId) {
  if (!userId) return null;
  const data = await getJson(`/api/internal/users/${encodeURIComponent(userId)}`);
  if (!data) return null;
  const u = data.user || data;
  if (!u?.id) return null;
  return {
    id: u.id,
    email: u.email || null,
    first_name: u.first_name || '',
    last_name: u.last_name || '',
    role: u.role || null
  };
}

let rosterCache = { at: 0, rows: [] };
const ROSTER_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch the client roster (for resolving board → client labels). Cached 5 min.
 * Returns [] if the main app isn't configured/reachable.
 */
export async function fetchClientRoster({ force = false } = {}) {
  if (!MAIN_APP_URL) return [];
  const now = Date.now();
  if (!force && now - rosterCache.at < ROSTER_TTL_MS) return rosterCache.rows;
  const data = await getJson('/api/hub/client-roster');
  const rows = Array.isArray(data) ? data : Array.isArray(data?.clients) ? data.clients : [];
  rosterCache = { at: now, rows };
  return rows;
}
