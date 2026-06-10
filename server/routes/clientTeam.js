/**
 * Client Team Management Routes
 *
 * Enables clients to invite additional users to manage their client account.
 * Invited users receive an email with a link to accept their invitation.
 */

import express from 'express';
import crypto from 'crypto';

import { query } from '../db.js';
import { notRevoked } from '../services/queryHelpers.js';
import { requireAuth } from '../middleware/auth.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from '../services/mailgun.js';
import { logUserActivity, ActivityEventTypes, ActivityCategories } from '../services/activityLog.js';
import { listAccountTeamMembers, resolveClientAccountAccess } from '../services/clientAccounts.js';

const router = express.Router();

// Invite links never expire. Revocation (`revoked_at`) and consumption
// (`consumed_at`) still gate acceptance; resending reissues the token in place.
// Mirrors the onboarding pattern of a far-future `expires_at` since the column is NOT NULL.
const INVITE_NEVER_EXPIRES_AT = new Date('9999-12-31T23:59:59Z');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeBase(value) {
  if (!value) return null;
  let base = String(value).trim();
  if (!/^https?:\/\//i.test(base)) {
    const isLocal = base.startsWith('localhost') || base.startsWith('127.0.0.1');
    base = `${isLocal ? 'http' : 'https'}://${base}`;
  }
  return base.replace(/\/$/, '');
}

function resolveBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const isLocalHost = host && (host.includes('localhost') || host.includes('127.0.0.1'));

  const localOverride = normalizeBase(process.env.LOCAL_APP_BASE_URL);
  if (isLocalHost && localOverride) return localOverride;

  if (isLocalHost && process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }

  const fromEnv = normalizeBase(process.env.APP_BASE_URL || process.env.CLIENT_APP_URL);
  if (fromEnv) return fromEnv;

  if (host) return normalizeBase(`${proto}://${host}`);

  return 'http://localhost:3000';
}

async function getInviteRecipientAccountState(email) {
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

function getInviteNextStepCopy(recipientState) {
  return recipientState?.existingAccountHasPassword
    ? 'Click the link below to accept this invitation:'
    : 'Click the link below to accept this invitation and create your password:';
}

/**
 * Get the user's role in the client account
 */
async function getDirectMemberRole(clientOwnerId, userId) {
  const { rows } = await query(
    `SELECT role FROM client_account_members
     WHERE client_owner_id = $1 AND member_user_id = $2 AND status = 'active'`,
    [clientOwnerId, userId]
  );
  return rows[0]?.role || null;
}

/**
 * Check if user can manage team (owner or admin)
 */
function canManageTeam(role) {
  return role === 'owner' || role === 'admin';
}

/**
 * Check if user can invite others (owner or admin)
 */
function canInvite(role) {
  return role === 'owner' || role === 'admin';
}

/**
 * Check if user can remove a member
 * - Owner can remove anyone except themselves
 * - Admin can remove members only (not other admins or owner)
 */
function canRemoveMember(userRole, targetRole) {
  if (userRole === 'owner') {
    return targetRole !== 'owner'; // Can't remove self
  }
  if (userRole === 'admin') {
    return targetRole === 'member';
  }
  return false;
}

// Admins/superadmins acting as a client (impersonation via x-acting-user) have
// no client_account_members row for the impersonated owner. Treat them as
// 'owner' so they can do everything the owner could.
function effectiveAccountRole(req, membershipRole) {
  if (req.user?.role === 'superadmin' || req.user?.role === 'admin') return 'owner';
  return membershipRole || null;
}

// GET /api/client-team - List account members
router.get('/', requireAuth, async (req, res) => {
  try {
    const clientOwnerId = req.portalUserId || null;
    if (!clientOwnerId) {
      return res.status(403).json({ message: 'Not associated with a client account' });
    }

    const accountAccess = await resolveClientAccountAccess(req.user.id, clientOwnerId, { userRole: req.user.role });
    const [directRole, members] = await Promise.all([getDirectMemberRole(clientOwnerId, req.user.id), listAccountTeamMembers(clientOwnerId)]);
    const userRole = effectiveAccountRole(req, accountAccess?.membershipRole);

    // Get business name for display
    const { rows: brandRows } = await query(`SELECT business_name FROM brand_assets WHERE user_id = $1 LIMIT 1`, [clientOwnerId]);
    const businessName = brandRows[0]?.business_name || null;

    res.json({
      members,
      businessName,
      userRole,
      accessScope: accountAccess?.accessScope || null,
      canInvite: canInvite(userRole),
      canManage: canManageTeam(userRole),
      canLeave: Boolean(directRole && directRole !== 'owner')
    });
  } catch (err) {
    console.error('[client-team:list]', err);
    res.status(500).json({ message: 'Unable to fetch team members' });
  }
});

// GET /api/client-team/invites - List pending invites
router.get('/invites', requireAuth, async (req, res) => {
  try {
    const clientOwnerId = req.portalUserId || null;
    if (!clientOwnerId) {
      return res.status(403).json({ message: 'Not associated with a client account' });
    }

    const accountAccess = await resolveClientAccountAccess(req.user.id, clientOwnerId, { userRole: req.user.role });
    const userRole = effectiveAccountRole(req, accountAccess?.membershipRole);
    if (!canManageTeam(userRole)) {
      return res.status(403).json({ message: 'Not authorized to view invites' });
    }

    const { rows: invites } = await query(
      `SELECT
        cuit.id,
        cuit.invite_email,
        cuit.invite_first_name,
        cuit.invite_role,
        cuit.created_at,
        cuit.expires_at,
        cuit.token_value,
        inviter.first_name as invited_by_first_name,
        inviter.last_name as invited_by_last_name
      FROM client_user_invite_tokens cuit
      LEFT JOIN users inviter ON inviter.id = cuit.invited_by
      WHERE cuit.client_owner_id = $1
        AND cuit.consumed_at IS NULL
        AND ${notRevoked('cuit')}
        AND cuit.expires_at > NOW()
      ORDER BY cuit.created_at DESC`,
      [clientOwnerId]
    );

    res.json({ invites });
  } catch (err) {
    console.error('[client-team:invites]', err);
    res.status(500).json({ message: 'Unable to fetch pending invites' });
  }
});

// POST /api/client-team/invite - Send invite email
router.post('/invite', requireAuth, async (req, res) => {
  try {
    const clientOwnerId = req.portalUserId || null;
    if (!clientOwnerId) {
      return res.status(403).json({ message: 'Not associated with a client account' });
    }

    const accountAccess = await resolveClientAccountAccess(req.user.id, clientOwnerId, { userRole: req.user.role });
    const userRole = effectiveAccountRole(req, accountAccess?.membershipRole);
    if (!canInvite(userRole)) {
      return res.status(403).json({ message: 'Not authorized to invite team members' });
    }

    const { email, firstName, role = 'member' } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate role
    const allowedRoles = ['member', 'admin'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be member or admin.' });
    }

    // Check if email already exists as active member
    const { rows: existingMember } = await query(
      `SELECT cam.id FROM client_account_members cam
       JOIN users u ON u.id = cam.member_user_id
       WHERE cam.client_owner_id = $1 AND u.email = $2 AND cam.status = 'active'`,
      [clientOwnerId, normalizedEmail]
    );

    if (existingMember.length > 0) {
      return res.status(400).json({ message: 'This email is already a team member' });
    }

    // Check if there's a pending invite for this email
    const { rows: existingInvite } = await query(
      `SELECT id FROM client_user_invite_tokens
       WHERE client_owner_id = $1
         AND invite_email = $2
         AND consumed_at IS NULL
         AND ${notRevoked()}
         AND expires_at > NOW()`,
      [clientOwnerId, normalizedEmail]
    );

    if (existingInvite.length > 0) {
      return res.status(400).json({ message: 'There is already a pending invite for this email' });
    }

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = INVITE_NEVER_EXPIRES_AT;

    // Create invite record
    const { rows: inviteRows } = await query(
      `INSERT INTO client_user_invite_tokens
       (client_owner_id, token_hash, token_value, invite_email, invite_first_name, invite_role, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [clientOwnerId, tokenHash, rawToken, normalizedEmail, firstName || null, role, req.user.id, expiresAt]
    );

    const inviteId = inviteRows[0].id;

    // Get business name and inviter info for email
    const { rows: brandRows } = await query(`SELECT business_name FROM brand_assets WHERE user_id = $1 LIMIT 1`, [clientOwnerId]);
    const businessName = brandRows[0]?.business_name || 'your team';

    const inviterName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email;
    const baseUrl = resolveBaseUrl(req);
    const inviteUrl = `${baseUrl}/accept-invite/${rawToken}`;
    const recipientState = await getInviteRecipientAccountState(normalizedEmail);
    const nextStepCopy = getInviteNextStepCopy(recipientState);

    // Send invite email
    if (isMailgunConfigured()) {
      try {
        await sendMailgunMessageWithLogging(
          {
            to: [normalizedEmail],
            subject: `You've been invited to join ${businessName} on Anchor`,
            text: `Hello${firstName ? ` ${firstName}` : ''},

${inviterName} has invited you to join ${businessName} on Anchor Dashboard.

${nextStepCopy}
${inviteUrl}

If you didn't expect this invitation, you can safely ignore this email.

— Anchor`,
            html: `<p>Hello${firstName ? ` ${firstName}` : ''},</p>
<p><strong>${inviterName}</strong> has invited you to join <strong>${businessName}</strong> on Anchor Dashboard.</p>
<p>${nextStepCopy.replace(':', '.')}</p>
<p style="margin: 24px 0;">
  <a href="${inviteUrl}" style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
    Accept Invitation
  </a>
</p>
<p>Or copy and paste this link into your browser:</p>
<p><a href="${inviteUrl}">${inviteUrl}</a></p>
<hr />
<p><small>If you didn't expect this invitation, you can safely ignore this email.</small></p>
<p><i>— Anchor</i></p>`
          },
          {
            emailType: 'client_team_invite',
            recipientName: firstName,
            triggeredById: req.user.id,
            clientId: clientOwnerId,
            metadata: { invite_id: inviteId, role }
          }
        );
      } catch (emailErr) {
        console.error('[client-team:invite:email]', emailErr);
        // Continue - invite was created, just email failed
      }
    }

    logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.INVITE_TEAM_MEMBER,
      actionCategory: ActivityCategories.TEAM,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { inviteeEmail: normalizedEmail, role }
    }).catch(() => {});

    res.json({
      success: true,
      inviteId,
      inviteUrl, // Return URL so it can be copied
      message: isMailgunConfigured() ? 'Invitation sent' : 'Invitation created (email not configured)'
    });
  } catch (err) {
    console.error('[client-team:invite]', err);
    res.status(500).json({ message: 'Unable to send invitation' });
  }
});

// POST /api/client-team/invite/:id/resend - Resend invite
router.post('/invite/:id/resend', requireAuth, async (req, res) => {
  try {
    const clientOwnerId = req.portalUserId || null;
    if (!clientOwnerId) {
      return res.status(403).json({ message: 'Not associated with a client account' });
    }

    const accountAccess = await resolveClientAccountAccess(req.user.id, clientOwnerId, { userRole: req.user.role });
    const userRole = effectiveAccountRole(req, accountAccess?.membershipRole);
    if (!canInvite(userRole)) {
      return res.status(403).json({ message: 'Not authorized to resend invites' });
    }

    const { id } = req.params;

    // Get existing invite
    const { rows: inviteRows } = await query(
      `SELECT * FROM client_user_invite_tokens
       WHERE id = $1 AND client_owner_id = $2 AND consumed_at IS NULL AND ${notRevoked()}`,
      [id, clientOwnerId]
    );

    if (inviteRows.length === 0) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    const invite = inviteRows[0];

    // Generate new token and extend expiry
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = INVITE_NEVER_EXPIRES_AT;

    await query(
      `UPDATE client_user_invite_tokens
       SET token_hash = $1, token_value = $2, expires_at = $3
       WHERE id = $4`,
      [tokenHash, rawToken, expiresAt, id]
    );

    // Get business name for email
    const { rows: brandRows } = await query(`SELECT business_name FROM brand_assets WHERE user_id = $1 LIMIT 1`, [clientOwnerId]);
    const businessName = brandRows[0]?.business_name || 'your team';

    const inviterName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email;
    const baseUrl = resolveBaseUrl(req);
    const inviteUrl = `${baseUrl}/accept-invite/${rawToken}`;
    const recipientState = await getInviteRecipientAccountState(invite.invite_email);
    const nextStepCopy = getInviteNextStepCopy(recipientState);

    // Resend email
    if (isMailgunConfigured()) {
      try {
        await sendMailgunMessageWithLogging(
          {
            to: [invite.invite_email],
            subject: `Reminder: You've been invited to join ${businessName} on Anchor`,
            text: `Hello${invite.invite_first_name ? ` ${invite.invite_first_name}` : ''},

This is a reminder that ${inviterName} has invited you to join ${businessName} on Anchor Dashboard.

${nextStepCopy}
${inviteUrl}

If you didn't expect this invitation, you can safely ignore this email.

— Anchor`,
            html: `<p>Hello${invite.invite_first_name ? ` ${invite.invite_first_name}` : ''},</p>
<p>This is a reminder that <strong>${inviterName}</strong> has invited you to join <strong>${businessName}</strong> on Anchor Dashboard.</p>
<p>${nextStepCopy.replace(':', '.')}</p>
<p style="margin: 24px 0;">
  <a href="${inviteUrl}" style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
    Accept Invitation
  </a>
</p>
<p>Or copy and paste this link into your browser:</p>
<p><a href="${inviteUrl}">${inviteUrl}</a></p>
<hr />
<p><small>If you didn't expect this invitation, you can safely ignore this email.</small></p>
<p><i>— Anchor</i></p>`
          },
          {
            emailType: 'client_team_invite_resend',
            recipientName: invite.invite_first_name,
            triggeredById: req.user.id,
            clientId: clientOwnerId,
            metadata: { invite_id: id, role: invite.invite_role }
          }
        );
      } catch (emailErr) {
        console.error('[client-team:resend:email]', emailErr);
      }
    }

    res.json({
      success: true,
      inviteUrl,
      message: isMailgunConfigured() ? 'Invitation resent' : 'Invitation updated (email not configured)'
    });
  } catch (err) {
    console.error('[client-team:resend]', err);
    res.status(500).json({ message: 'Unable to resend invitation' });
  }
});

// DELETE /api/client-team/invite/:id - Revoke invite
router.delete('/invite/:id', requireAuth, async (req, res) => {
  try {
    const clientOwnerId = req.portalUserId || null;
    if (!clientOwnerId) {
      return res.status(403).json({ message: 'Not associated with a client account' });
    }

    const accountAccess = await resolveClientAccountAccess(req.user.id, clientOwnerId, { userRole: req.user.role });
    const userRole = effectiveAccountRole(req, accountAccess?.membershipRole);
    if (!canManageTeam(userRole)) {
      return res.status(403).json({ message: 'Not authorized to revoke invites' });
    }

    const { id } = req.params;

    const { rowCount } = await query(
      `UPDATE client_user_invite_tokens
       SET revoked_at = NOW(), token_value = NULL
       WHERE id = $1 AND client_owner_id = $2 AND consumed_at IS NULL AND ${notRevoked()}`,
      [id, clientOwnerId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: 'Invite not found or already revoked' });
    }

    logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.INVITE_TEAM_MEMBER,
      actionCategory: ActivityCategories.TEAM,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { action: 'revoked', inviteId: id }
    }).catch(() => {});

    res.json({ success: true, message: 'Invitation revoked' });
  } catch (err) {
    console.error('[client-team:revoke]', err);
    res.status(500).json({ message: 'Unable to revoke invitation' });
  }
});

// DELETE /api/client-team/members/:id - Remove member
router.delete('/members/:id', requireAuth, async (req, res) => {
  try {
    const clientOwnerId = req.portalUserId || null;
    if (!clientOwnerId) {
      return res.status(403).json({ message: 'Not associated with a client account' });
    }

    const accountAccess = await resolveClientAccountAccess(req.user.id, clientOwnerId, { userRole: req.user.role });
    const userRole = effectiveAccountRole(req, accountAccess?.membershipRole);
    if (!canManageTeam(userRole)) {
      return res.status(403).json({ message: 'Not authorized to remove members' });
    }

    const { id } = req.params;

    // Get target member's role
    const { rows: targetRows } = await query(
      `SELECT member_user_id, role FROM client_account_members WHERE id = $1 AND client_owner_id = $2`,
      [id, clientOwnerId]
    );

    if (targetRows.length === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }

    const target = targetRows[0];

    // Check permission to remove
    if (!canRemoveMember(userRole, target.role)) {
      return res.status(403).json({
        message: target.role === 'owner' ? 'Cannot remove the account owner' : 'Not authorized to remove this member'
      });
    }

    // Mark as removed (soft delete)
    await query(
      `UPDATE client_account_members
       SET status = 'removed', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.REMOVE_TEAM_MEMBER,
      actionCategory: ActivityCategories.TEAM,
      targetUserId: target.member_user_id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { removedMemberId: target.member_user_id, role: target.role }
    }).catch(() => {});

    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    console.error('[client-team:remove]', err);
    res.status(500).json({ message: 'Unable to remove member' });
  }
});

// POST /api/client-team/leave - Leave the team (for non-owners)
router.post('/leave', requireAuth, async (req, res) => {
  try {
    const clientOwnerId = req.portalUserId || null;
    if (!clientOwnerId) {
      return res.status(403).json({ message: 'Not associated with a client account' });
    }

    const userRole = await getDirectMemberRole(clientOwnerId, req.user.id);

    if (!userRole) {
      return res.status(403).json({ message: 'Leaving a group-derived account must be handled from group management' });
    }

    if (userRole === 'owner') {
      return res.status(403).json({ message: 'Account owner cannot leave the team' });
    }

    // Mark as removed
    await query(
      `UPDATE client_account_members
       SET status = 'removed', updated_at = NOW()
       WHERE client_owner_id = $1 AND member_user_id = $2`,
      [clientOwnerId, req.user.id]
    );

    logUserActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.LEAVE_TEAM,
      actionCategory: ActivityCategories.TEAM,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { clientOwnerId }
    }).catch(() => {});

    res.json({ success: true, message: 'You have left the team' });
  } catch (err) {
    console.error('[client-team:leave]', err);
    res.status(500).json({ message: 'Unable to leave team' });
  }
});

export default router;
