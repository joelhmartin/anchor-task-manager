/**
 * Authentication Middleware (Task Manager — SSO consumer)
 *
 * The Task Manager does NOT own login. Identity is established by the main app
 * (anchor-hub), which mints short-lived access-token JWTs signed with the shared
 * `JWT_SECRET` (Secret Manager: anchor-jwt-signing-secret).
 *
 * This middleware therefore validates tokens STATELESSLY (signature + expiry only)
 * — there is no shared session store in the Task Manager's own database. The user
 * row is provisioned just-in-time on first sighting so task_* foreign keys to
 * users(id) resolve; display name/email are backfilled from the main app's client
 * roster API (see services/mainApp.js) when available.
 */

import { query } from '../db.js';
import { getEffectiveRole } from '../utils/roles.js';
import { verifyAccessToken } from '../services/security/index.js';

const USER_COLUMNS = 'id, first_name, last_name, email, role, created_at, avatar_url';

/**
 * Resolve (and JIT-provision) the local user row for a verified token payload.
 * @param {{ userId: string, role?: string }} payload
 */
async function resolveUser(payload) {
  const existing = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [payload.userId]);
  if (existing.rows[0]) return existing.rows[0];

  // First time we've seen this SSO user — provision a minimal row. Names/email are
  // placeholders until backfilled from the main app roster; role comes from the token.
  const placeholderEmail = `${payload.userId}@sso.anchor.local`;
  const inserted = await query(
    `INSERT INTO users (id, first_name, last_name, email, password_hash, role)
     VALUES ($1, '', '', $2, '!sso', $3)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role
     RETURNING ${USER_COLUMNS}`,
    [payload.userId, placeholderEmail, payload.role || 'team']
  );
  return inserted.rows[0];
}

function readToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
  if (req.cookies?.session) return req.cookies.session;
  return null;
}

/**
 * Require authentication via the shared access-token JWT.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    const payload = token ? verifyAccessToken(token) : null;
    if (!payload) {
      return res.status(401).json({ message: 'Authentication required', code: 'TOKEN_EXPIRED_OR_INVALID' });
    }

    const user = await resolveUser(payload);
    if (!user) {
      return res.status(401).json({ message: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const effectiveRole = await getEffectiveRole(user.role);
    req.user = { ...user, effective_role: effectiveRole };
    req.sessionId = payload.sessionId || null;
    req.portalUserId = user.id;
    // Task Manager is a staff tool; no client-account "act as" scoping.
    req.actingClient = null;
    req.activeClientAccountId = null;
    req.clientAccountRole = null;

    next();
  } catch (err) {
    console.error('[requireAuth]', err);
    return res.status(401).json({ message: 'Authentication failed', code: 'AUTH_ERROR' });
  }
}

/**
 * Optional authentication — never fails; populates req.user when a valid token is present.
 */
export async function optionalAuth(req, res, next) {
  try {
    const token = readToken(req);
    const payload = token ? verifyAccessToken(token) : null;
    if (!payload) {
      req.user = null;
      return next();
    }
    const user = await resolveUser(payload);
    if (!user) {
      req.user = null;
      return next();
    }
    const effectiveRole = await getEffectiveRole(user.role);
    req.user = { ...user, effective_role: effectiveRole };
    req.sessionId = payload.sessionId || null;
    req.portalUserId = user.id;
    next();
  } catch {
    req.user = null;
    next();
  }
}

/**
 * Require admin or superadmin role.
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Login required', code: 'NOT_AUTHENTICATED' });
  }
  const userRole = req.user.effective_role || req.user.role;
  if (userRole !== 'superadmin' && userRole !== 'admin') {
    return res.status(403).json({ message: 'Admin access required', code: 'FORBIDDEN' });
  }
  next();
}

/**
 * Require superadmin role.
 */
export function requireSuperadmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Login required', code: 'NOT_AUTHENTICATED' });
  }
  const userRole = req.user.effective_role || req.user.role;
  if (userRole !== 'superadmin') {
    return res.status(403).json({ message: 'Superadmin only', code: 'FORBIDDEN' });
  }
  next();
}

/**
 * Require any of the specified roles.
 */
export function requireAnyRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Login required', code: 'NOT_AUTHENTICATED' });
    }
    const userRole = req.user.effective_role || req.user.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        message: `Access denied. Required roles: ${roles.join(', ')}`,
        code: 'FORBIDDEN'
      });
    }
    next();
  };
}
