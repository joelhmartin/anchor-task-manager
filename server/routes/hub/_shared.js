// Cross-cutting helpers, constants, and upload (multer) configuration shared
// across the hub/* sub-routers. This is intentionally a shared "bucket" module,
// not a single-responsibility unit — anything used by 2+ hub sub-routers lives
// here so they can import it without reaching back into the hub.js aggregator.
//
// NOTE: this module has an import-time SIDE EFFECT — it creates the upload
// directories below (mkdirSync). Importing it is not pure. Node caches modules,
// so the side effect runs once per process regardless of how many sub-routers
// import it.
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { query } from '../../db.js';

export const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const WEEK_IN_DAYS = 7;

// Generic date coercion: returns a valid Date or null. Shared by the journey-scheduling
// engine (hub/_journeys.js) and hub.js call-list/journey route handlers.
export function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Multi-account members write-permission gate. Staff (superadmin/admin/team) and
// users acting on their own data (no client_account membership) are always allowed.
// For client_account_members, only owner/admin can mutate account-wide settings —
// 'member' role gets read-only access. Hub.js endpoints that change brand, notification
// routing, or other account-wide config should call this before writing.
export function canWriteAccount(req) {
  if (!req.user) return false;
  const role = req.user.effective_role || req.user.role;
  if (['superadmin', 'admin', 'team'].includes(role)) return true;
  if (!req.clientAccountRole) return true;
  return req.clientAccountRole === 'owner' || req.clientAccountRole === 'admin';
}

// Strip plus-addressing (jmartin+tag@host -> jmartin@host) so duplicate-account
// detection treats aliased addresses as the same mailbox. Storage keeps the
// original form; this is only for collision lookups.
export function normalizeEmailForCollision(value) {
  const lower = String(value || '').trim().toLowerCase();
  const atIdx = lower.indexOf('@');
  if (atIdx === -1) return lower;
  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx);
  const baseLocal = local.split('+')[0];
  return baseLocal + domain;
}

export function buildNormalizedPhoneMatchSql(columnSql, paramRef) {
  return `RIGHT(REGEXP_REPLACE(${columnSql}, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(${paramRef}, '[^0-9]', '', 'g'), 10)`;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Shared UUID shape for the client-accessible contact routes (validate :id/:tagId at the boundary).
export const CONTACT_ROUTE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
export const brandDir = path.join(uploadRoot, 'brand');
export const docsDir = path.join(uploadRoot, 'docs');
export const avatarDir = path.join(uploadRoot, 'avatars');
export const groupIconsDir = path.join(uploadRoot, 'group-icons');

[uploadRoot, brandDir, docsDir, avatarDir, groupIconsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

export const storage = (dest) =>
  multer.diskStorage({
    destination: dest,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    }
  });

export const uploadBrand = multer({ storage: storage(brandDir) });
export const uploadDocs = multer({ storage: storage(docsDir) });
export const uploadAvatar = multer({ storage: storage(avatarDir) });
export const uploadGroupIcon = multer({
  storage: storage(groupIconsDir),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit for icons
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed'), false);
    }
  }
});

export function publicUrl(filePath) {
  const rel = path.relative(uploadRoot, filePath);
  return `/uploads/${rel}`.replace(/\\/g, '/');
}

// Invite/activation links never expire. Revocation and consumption still apply,
// and old tokens are invalidated when a new one is issued (see the revoke-then-insert
// pattern in the activation/onboarding endpoints). Mirrors the onboarding pattern
// of using a far-future `expires_at` instead of NULL (the column is NOT NULL).
export const INVITE_NEVER_EXPIRES_AT = new Date('9999-12-31T23:59:59Z');

export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function resolveAdminBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const isLocalHost = host && (host.includes('localhost') || host.includes('127.0.0.1'));

  if (isLocalHost && process.env.NODE_ENV !== 'production') {
    const localOverride = process.env.LOCAL_APP_BASE_URL;
    if (localOverride) return localOverride.replace(/\/$/, '');
    return 'http://localhost:3000';
  }

  const fromEnv = process.env.APP_BASE_URL || process.env.CLIENT_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  if (host) return `${proto}://${host}`.replace(/\/$/, '');

  return 'http://localhost:3000';
}

export async function getInviteRecipientAccountState(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return { hasExistingAccount: false, existingAccountHasPassword: false };

  const { rows } = await query(
    `SELECT password_hash
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  return {
    hasExistingAccount: rows.length > 0,
    existingAccountHasPassword: Boolean(rows[0]?.password_hash)
  };
}

export function getInviteNextStepCopy(recipientState) {
  return recipientState?.existingAccountHasPassword
    ? 'Click the link below to accept this invitation:'
    : 'Click the link below to accept this invitation and create your password:';
}

// Resolve a lead's call_logs linkage from a call_id or row UUID. Shared by hub.js
// (active-clients routes) and hub/journeys.js (journey create). Moved verbatim from hub.js.
export async function resolveLeadCallLink(ownerId, callIdentifier) {
  const key = typeof callIdentifier === 'string' ? callIdentifier.trim() : '';
  if (!key) {
    return { leadCallKey: null, leadCallUuid: null };
  }
  const { rows } = await query(
    `SELECT id, call_id
     FROM call_logs
     WHERE (owner_user_id = $1 OR user_id = $1)
       AND (call_id = $2 OR id::text = $2)
     ORDER BY CASE WHEN call_id = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [ownerId, key]
  );
  return {
    leadCallKey: rows[0]?.call_id || null,
    leadCallUuid: rows[0]?.id || null
  };
}

// Lazily ensure the active_clients.archived_at column exists. Memoized per process.
// Shared by hub.js (clients/agree-to-service) and hub/accounts.js (active-clients routes).
let hasEnsuredActiveClientArchive = false;
export async function ensureActiveClientArchiveColumn() {
  if (hasEnsuredActiveClientArchive) return;
  await query(`ALTER TABLE active_clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  hasEnsuredActiveClientArchive = true;
}
