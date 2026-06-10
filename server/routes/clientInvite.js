/**
 * Client Invite Acceptance Routes
 *
 * Public routes for accepting account-scoped and group-scoped client invitations.
 */

import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { query, getClient } from '../db.js';
import { notRevoked } from '../services/queryHelpers.js';
import {
  createAuthenticatedSession,
  trustDevice,
  extractDeviceInfo,
  maskEmail,
  verifyAccessToken,
  logSecurityEvent,
  SecurityEventTypes,
  SecurityEventCategories
} from '../services/security/index.js';
import { logClientActivity, ActivityEventTypes } from '../services/activityLog.js';
import { getClientIp } from '../middleware/rateLimit.js';

const router = express.Router();

const ANCHOR_STAFF_ROLES = new Set(['superadmin', 'admin', 'team']);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isOwnerActivationInvite(record) {
  return record?.invite_scope === 'account' && record?.invite_role === 'owner';
}

function inviteRequiresPasswordSetup(record, existingAccount) {
  return isOwnerActivationInvite(record) || !existingAccount || !existingAccount.password_hash;
}

function inviteRequiresProfileDetails(record, existingAccount) {
  return !existingAccount && !isOwnerActivationInvite(record);
}

async function getInviteTokenRecord(token) {
  const tokenHash = hashToken(token);

  const { rows: accountRows } = await query(
    `SELECT
       cuit.*,
       'account'::text AS invite_scope,
       ba.business_name AS invite_label,
       inviter.first_name AS inviter_first_name,
       inviter.last_name AS inviter_last_name,
       inviter.email AS inviter_email
     FROM client_user_invite_tokens cuit
     LEFT JOIN brand_assets ba ON ba.user_id = cuit.client_owner_id
     LEFT JOIN users inviter ON inviter.id = cuit.invited_by
     WHERE cuit.token_hash = $1
       AND cuit.consumed_at IS NULL
       AND ${notRevoked('cuit')}
       AND cuit.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (accountRows.length > 0) return accountRows[0];

  const { rows: groupRows } = await query(
    `SELECT
       cgit.*,
       'group'::text AS invite_scope,
       cg.name AS invite_label,
       inviter.first_name AS inviter_first_name,
       inviter.last_name AS inviter_last_name,
       inviter.email AS inviter_email
     FROM client_group_invite_tokens cgit
     JOIN client_groups cg ON cg.id = cgit.client_group_id
     LEFT JOIN users inviter ON inviter.id = cgit.invited_by
     WHERE cgit.token_hash = $1
       AND cgit.consumed_at IS NULL
       AND ${notRevoked('cgit')}
       AND cgit.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return groupRows[0] || null;
}

async function getLockedInviteTokenRecord(dbClient, token) {
  const tokenHash = hashToken(token);

  const { rows: accountRows } = await dbClient.query(
    `SELECT
       cuit.*,
       'account'::text AS invite_scope,
       ba.business_name AS invite_label,
       inviter.first_name AS inviter_first_name,
       inviter.last_name AS inviter_last_name,
       inviter.email AS inviter_email
     FROM client_user_invite_tokens cuit
     LEFT JOIN brand_assets ba ON ba.user_id = cuit.client_owner_id
     LEFT JOIN users inviter ON inviter.id = cuit.invited_by
     WHERE cuit.token_hash = $1
       AND cuit.consumed_at IS NULL
       AND ${notRevoked('cuit')}
       AND cuit.expires_at > NOW()
     LIMIT 1
     FOR UPDATE OF cuit SKIP LOCKED`,
    [tokenHash]
  );
  if (accountRows.length > 0) return accountRows[0];

  const { rows: groupRows } = await dbClient.query(
    `SELECT
       cgit.*,
       'group'::text AS invite_scope,
       cg.name AS invite_label,
       inviter.first_name AS inviter_first_name,
       inviter.last_name AS inviter_last_name,
       inviter.email AS inviter_email
     FROM client_group_invite_tokens cgit
     JOIN client_groups cg ON cg.id = cgit.client_group_id
     LEFT JOIN users inviter ON inviter.id = cgit.invited_by
     WHERE cgit.token_hash = $1
       AND cgit.consumed_at IS NULL
       AND ${notRevoked('cgit')}
       AND cgit.expires_at > NOW()
     LIMIT 1
     FOR UPDATE OF cgit SKIP LOCKED`,
    [tokenHash]
  );

  return groupRows[0] || null;
}

async function ensureInviteUser(dbClient, record, { firstName, lastName, password }) {
  const { rows: existingUserRows } = await dbClient.query(
    `SELECT id, email, first_name, last_name, role, password_hash
     FROM users
     WHERE email = $1`,
    [record.invite_email]
  );

  let user;
  let userId;

  if (existingUserRows.length > 0) {
    user = existingUserRows[0];
    userId = user.id;

    const normalizedRole = ANCHOR_STAFF_ROLES.has(user.role) ? user.role : 'client';
    const requiresPasswordSetup = inviteRequiresPasswordSetup(record, user);
    if (requiresPasswordSetup && (!password || String(password).length < 8)) {
      throw new Error('Password must be at least 8 characters long');
    }
    const shouldUpdatePassword = requiresPasswordSetup && password && String(password).length >= 8;
    const updateFirstName = user.first_name || firstName || record.invite_first_name || '';
    const updateLastName = user.last_name || lastName || '';

    await dbClient.query(
      `UPDATE users SET
         password_hash = COALESCE($1, password_hash),
         first_name = $2,
         last_name = $3,
         role = $5,
         email_verified_at = COALESCE(email_verified_at, NOW()),
         updated_at = NOW()
       WHERE id = $4`,
      [shouldUpdatePassword ? await bcrypt.hash(String(password), 12) : null, updateFirstName, updateLastName, userId, normalizedRole]
    );

    const { rows: updatedRows } = await dbClient.query(
      `SELECT id, email, first_name, last_name, role, avatar_url
       FROM users
       WHERE id = $1`,
      [userId]
    );
    user = updatedRows[0];
  } else {
    if (!password || String(password).length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    const finalFirstName = firstName || record.invite_first_name || '';
    const finalLastName = lastName || '';
    const passwordHash = await bcrypt.hash(String(password), 12);

    const { rows: newUserRows } = await dbClient.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, $4, 'client', NOW())
       RETURNING id, email, first_name, last_name, role, avatar_url`,
      [finalFirstName, finalLastName, record.invite_email, passwordHash]
    );

    user = newUserRows[0];
    userId = user.id;
  }

  return { user, userId };
}

async function activateInviteMembership(dbClient, record, userId) {
  if (record.invite_scope === 'group') {
    await dbClient.query(
      // Re-accepting an existing membership preserves the current role —
      // role changes must go through the team management UI, not a re-invite.
      `INSERT INTO client_group_members
       (client_group_id, member_user_id, role, invited_by, status, accepted_at)
       VALUES ($1, $2, $3, $4, 'active', NOW())
       ON CONFLICT (client_group_id, member_user_id)
       DO UPDATE SET
         status = 'active',
         accepted_at = COALESCE(client_group_members.accepted_at, NOW()),
         updated_at = NOW()`,
      [record.client_group_id, userId, record.invite_role, record.invited_by]
    );

    await dbClient.query(
      `UPDATE client_group_invite_tokens
       SET consumed_at = NOW(), resulting_user_id = $1, token_value = NULL
       WHERE id = $2`,
      [userId, record.id]
    );
    return { transferOutcome: null, transferContext: null };
  }

  await dbClient.query(
    // Re-accepting an existing membership preserves the current role —
    // role changes must go through the team management UI, not a re-invite.
    `INSERT INTO client_account_members
     (client_owner_id, member_user_id, role, invited_by, status, accepted_at)
     VALUES ($1, $2, $3, $4, 'active', NOW())
     ON CONFLICT (client_owner_id, member_user_id)
     DO UPDATE SET
       status = 'active',
       accepted_at = COALESCE(client_account_members.accepted_at, NOW()),
       updated_at = NOW()`,
    [record.client_owner_id, userId, record.invite_role, record.invited_by]
  );

  await dbClient.query(
    `INSERT INTO client_profiles (user_id, onboarding_completed_at, activated_at)
     VALUES ($1, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       onboarding_completed_at = COALESCE(client_profiles.onboarding_completed_at, NOW()),
       activated_at = COALESCE(client_profiles.activated_at, NOW())`,
    [userId]
  );

  // Honor a queued ownership transfer stamped on the invite metadata.
  // We only act on owner-role invites that carry the pending_owner_transfer flag
  // — other invites are normal team-member invites and don't displace anyone.
  // The audit log entries for the transfer outcome are written by the CALLER
  // post-COMMIT (see the route handler) so they don't survive a rollback.
  const meta = record.metadata || {};
  let transferOutcome = null;
  if (record.invite_role === 'owner' && meta.pending_owner_transfer) {
    // Always force the new owner's membership to role='owner', status='active'.
    // The earlier UPSERT preserves role on conflict (intentional for normal team
    // re-invites). For an owner transfer we must explicitly promote here even
    // when there's no displaced owner to update — otherwise an invitee with a
    // dormant membership would be reactivated with their old role and the
    // account would end up with no active owner.
    const promoted = await dbClient.query(
      `UPDATE client_account_members
          SET role = 'owner', status = 'active', updated_at = NOW()
        WHERE client_owner_id = $1 AND member_user_id = $2
        RETURNING id`,
      [record.client_owner_id, userId]
    );
    if (promoted.rowCount === 0) {
      // Should never happen — the upsert above just inserted/updated this row.
      // Fail loud rather than silently leave the account ownerless.
      throw new Error('Ownership transfer aborted: failed to promote new owner');
    }

    // Displace the prior owner only when one was captured at queue time. If
    // displaced_owner_user_id is null the transfer was queued against an
    // already-ownerless account — promotion alone is the whole transfer.
    if (meta.displaced_owner_user_id) {
      const action = meta.on_accept_action === 'boot' ? 'boot' : 'demote';
      let displacedUpdate;
      // Both boot and demote downgrade role from 'owner' to 'admin' so a future
      // re-invite (which preserves role on conflict-upsert) cannot accidentally
      // restore owner privileges. Only status differs between the two actions.
      if (action === 'boot') {
        displacedUpdate = await dbClient.query(
          `UPDATE client_account_members
              SET role = 'admin', status = 'removed', updated_at = NOW()
            WHERE client_owner_id = $1 AND member_user_id = $2`,
          [record.client_owner_id, meta.displaced_owner_user_id]
        );
      } else {
        displacedUpdate = await dbClient.query(
          `UPDATE client_account_members
              SET role = 'admin', status = 'active', updated_at = NOW()
            WHERE client_owner_id = $1 AND member_user_id = $2`,
          [record.client_owner_id, meta.displaced_owner_user_id]
        );
      }
      transferOutcome = displacedUpdate.rowCount > 0 ? 'completed' : 'displaced_gone';
    } else {
      // No displaced owner — promotion-only transfer.
      transferOutcome = 'completed';
    }
  }

  await dbClient.query(
    `UPDATE client_user_invite_tokens
     SET consumed_at = NOW(), resulting_user_id = $1, token_value = NULL
     WHERE id = $2`,
    [userId, record.id]
  );

  return {
    transferOutcome,
    transferContext: transferOutcome
      ? {
          inviteId: record.id,
          clientOwnerId: record.client_owner_id,
          newOwnerUserId: userId,
          displacedOwnerUserId: meta.displaced_owner_user_id || null,
          onAcceptAction: meta.on_accept_action || null
        }
      : null
  };
}

function inviteLabel(record) {
  return record.invite_label || (record.invite_scope === 'group' ? 'this group' : 'this account');
}

router.get('/:token', async (req, res) => {
  try {
    const record = await getInviteTokenRecord(req.params.token);

    if (!record) {
      return res.status(404).json({
        message: 'This invitation link is invalid or has expired',
        code: 'INVITE_INVALID'
      });
    }

    const { rows: existingUser } = await query(
      `SELECT id, email, first_name, last_name, password_hash
       FROM users
       WHERE email = $1`,
      [record.invite_email]
    );

    const existingAccount = existingUser[0] || null;
    const requiresPasswordSetup = inviteRequiresPasswordSetup(record, existingAccount);
    const requiresProfileDetails = inviteRequiresProfileDetails(record, existingAccount);

    res.json({
      valid: true,
      inviteScope: record.invite_scope,
      email: record.invite_email,
      firstName: record.invite_first_name,
      role: record.invite_role,
      businessName: inviteLabel(record),
      inviterName: [record.inviter_first_name, record.inviter_last_name].filter(Boolean).join(' ') || record.inviter_email || 'Someone',
      expiresAt: record.expires_at,
      hasExistingAccount: Boolean(existingAccount),
      existingAccountHasPassword: existingAccount ? Boolean(existingAccount.password_hash) : false,
      requiresPasswordSetup,
      requiresProfileDetails
    });
  } catch (err) {
    console.error('[client-invite:validate]', err);
    res.status(500).json({ message: 'Unable to validate invitation' });
  }
});

router.post('/:token/accept', async (req, res) => {
  let dbClient;
  try {
    dbClient = await getClient();
    await dbClient.query('BEGIN');

    const record = await getLockedInviteTokenRecord(dbClient, req.params.token);
    if (!record) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({
        message: 'This invitation link is invalid or has expired',
        code: 'INVITE_INVALID'
      });
    }

    // If the request carries a valid session for a different user, block the
    // accept rather than silently swapping the session cookie out from under
    // them. A missing/invalid/expired token is fine — proceed normally.
    const bearerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const sessionToken = bearerToken || req.cookies?.session || null;
    if (sessionToken) {
      const payload = verifyAccessToken(sessionToken);
      if (payload?.userId) {
        const { rows: currentUserRows } = await dbClient.query(
          'SELECT email FROM users WHERE id = $1',
          [payload.userId]
        );
        const currentEmail = currentUserRows[0]?.email;
        if (currentEmail && currentEmail.toLowerCase() !== String(record.invite_email).toLowerCase()) {
          await dbClient.query('ROLLBACK');
          return res.status(409).json({
            message: `You're signed in as ${maskEmail(currentEmail)}. Sign out before accepting this invitation for ${maskEmail(record.invite_email)}.`,
            code: 'INVITE_SESSION_MISMATCH'
          });
        }
      }
    }

    const { firstName, lastName, password } = req.body;
    const { user, userId } = await ensureInviteUser(dbClient, record, { firstName, lastName, password });

    const { transferOutcome, transferContext } = await activateInviteMembership(dbClient, record, userId);
    await dbClient.query('COMMIT');

    // Audit logs for ownership transfer fire AFTER commit so a rolled-back tx
    // can never leave behind a record of a transfer that didn't happen.
    // Privilege change → write to BOTH the activity log (30-day visibility)
    // and the immutable security audit trail (HIPAA/SOC2 compliance).
    if (transferOutcome && transferContext) {
      const ipAddress = getClientIp(req);
      const userAgent = req.headers['user-agent'] || null;
      const activityType =
        transferOutcome === 'completed'
          ? ActivityEventTypes.OWNERSHIP_TRANSFER_COMPLETED
          : ActivityEventTypes.OWNERSHIP_TRANSFER_COMPLETED_DISPLACED_GONE;

      logClientActivity({
        userId: transferContext.newOwnerUserId,
        actionType: activityType,
        targetUserId: transferContext.clientOwnerId,
        ipAddress,
        userAgent,
        details: {
          invite_id: transferContext.inviteId,
          new_owner_user_id: transferContext.newOwnerUserId,
          displaced_owner_user_id: transferContext.displacedOwnerUserId,
          on_accept_action: transferContext.onAcceptAction,
          outcome: transferOutcome
        }
      }).catch((logErr) => console.error('[client-invite:activity-log]', logErr?.message));

      logSecurityEvent({
        userId: transferContext.newOwnerUserId,
        eventType: SecurityEventTypes.OWNERSHIP_TRANSFER_COMPLETED,
        eventCategory: SecurityEventCategories.ACCESS,
        ipAddress,
        userAgent,
        success: true,
        details: {
          client_owner_id: transferContext.clientOwnerId,
          invite_id: transferContext.inviteId,
          new_owner_user_id: transferContext.newOwnerUserId,
          displaced_owner_user_id: transferContext.displacedOwnerUserId,
          on_accept_action: transferContext.onAcceptAction,
          outcome: transferOutcome
        }
      }).catch((logErr) => console.error('[client-invite:security-audit]', logErr?.message));
    }

    try {
      const deviceInfo = extractDeviceInfo(req);
      const ipAddress = getClientIp(req);
      const sessionUser = {
        ...user,
        onboarding_completed_at: new Date().toISOString(),
        activated_at: new Date().toISOString()
      };

      const session = await createAuthenticatedSession(sessionUser, deviceInfo, {
        trustDevice: true,
        ipAddress,
        userAgent: req.headers['user-agent']
      });

      await trustDevice(userId, deviceInfo, { ipAddress, userAgent: req.headers['user-agent'] });

      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('refresh_token', session.refreshToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      });

      console.log(
        `[client-invite:accept] User ${maskEmail(user.email)} accepted ${record.invite_scope} invite ${
          record.invite_scope === 'group' ? `for group ${record.client_group_id}` : `to client account ${record.client_owner_id}`
        }`
      );

      res.json({
        success: true,
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        businessName: inviteLabel(record)
      });
    } catch (postCommitErr) {
      console.error('[client-invite:accept] Post-commit session creation failed:', postCommitErr);
      res.json({
        success: true,
        businessName: inviteLabel(record),
        redirectToLogin: true
      });
    }
  } catch (err) {
    await dbClient?.query('ROLLBACK').catch(() => {});
    console.error('[client-invite:accept]', err);
    const statusCode = err.message === 'Password must be at least 8 characters long' ? 400 : 500;
    res.status(statusCode).json({ message: err.message || 'Unable to accept invitation' });
  } finally {
    dbClient?.release();
  }
});

export default router;
