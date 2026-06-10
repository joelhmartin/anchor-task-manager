// Hub account-management routes: client groups (organizational grouping for the admin view) + their team access/invites. Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';
import crypto from 'crypto';
import fsPromises from 'fs/promises';

import { query, getClient } from '../../db.js';
import { notRevoked } from '../../services/queryHelpers.js';
import { isAdminOrEditor } from '../../middleware/roles.js';
import { storeFile, deleteFile } from '../../services/fileStorage.js';
import { fetchClientGroup, listGroupTeamMembers } from '../../services/clientAccounts.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from '../../services/mailgun.js';
import { logEvent } from '../../services/hubUtils.js';
import {
  uploadGroupIcon,
  publicUrl,
  INVITE_NEVER_EXPIRES_AT,
  hashInviteToken,
  resolveAdminBaseUrl,
  getInviteRecipientAccountState,
  getInviteNextStepCopy,
  ensureActiveClientArchiveColumn
} from './_shared.js';
import { ensureJourneyTables } from './_journeys.js';

const router = express.Router();

router.get('/client-groups', isAdminOrEditor, async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM client_groups ORDER BY sort_order ASC, name ASC');
    res.json({ groups: rows });
  } catch (err) {
    console.error('[client-groups:list]', err);
    res.status(500).json({ message: 'Unable to fetch client groups' });
  }
});

router.post('/client-groups', isAdminOrEditor, async (req, res) => {
  try {
    const { name, description, color, icon, icon_url } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ message: 'Group name is required' });

    // Get max sort_order to add new group at the end
    const { rows: maxRows } = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM client_groups');
    const nextOrder = maxRows[0]?.next_order || 1;

    const { rows } = await query(
      `INSERT INTO client_groups (name, description, color, icon, icon_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name.trim(), description?.trim() || null, color || null, icon || null, icon_url || null, nextOrder]
    );
    res.status(201).json({ group: rows[0] });
  } catch (err) {
    console.error('[client-groups:create]', err);
    res.status(500).json({ message: 'Unable to create client group' });
  }
});

// Upload custom icon for a client group (stored in database for persistence)
router.post('/client-groups/:id/icon', isAdminOrEditor, uploadGroupIcon.single('icon'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Check if group exists
    const { rows: existing } = await query('SELECT id FROM client_groups WHERE id = $1', [id]);
    if (!existing.length) {
      if (req.file?.path) await fsPromises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ message: 'Client group not found' });
    }

    // Try to store in database (persistent), fall back to filesystem if migration hasn't run
    let iconUrl;
    let fileId = null;
    try {
      const result = await storeFile(req.file, {
        category: 'group-icon',
        ownerId: id,
        ownerType: 'client_group'
      });
      fileId = result.id;
      iconUrl = result.url;
    } catch (storeErr) {
      // Migration hasn't run yet - fall back to filesystem (temporary)
      console.warn('[client-groups:upload-icon] Database storage failed, using filesystem:', storeErr.message);
      iconUrl = publicUrl(req.file.path);
    }

    // Update group - use conditional SQL to handle missing icon_file_id column
    let rows;
    try {
      const result = await query(
        `UPDATE client_groups SET icon_url = $1, icon_file_id = $2, icon = NULL, updated_at = NOW() WHERE id = $3 RETURNING *`,
        [iconUrl, fileId, id]
      );
      rows = result.rows;
    } catch (updateErr) {
      // icon_file_id column doesn't exist yet - update without it
      if (updateErr.message?.includes('icon_file_id')) {
        const result = await query(
          `UPDATE client_groups SET icon_url = $1, icon = NULL, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [iconUrl, id]
        );
        rows = result.rows;
      } else {
        throw updateErr;
      }
    }

    res.json({ group: rows[0] });
  } catch (err) {
    console.error('[client-groups:upload-icon]', err);
    if (req.file?.path) await fsPromises.unlink(req.file.path).catch(() => {});
    res.status(500).json({ message: 'Unable to upload group icon' });
  }
});

// Delete custom icon for a client group
router.delete('/client-groups/:id/icon', isAdminOrEditor, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: existing } = await query('SELECT id FROM client_groups WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Client group not found' });

    // Try to get and delete old file from database
    try {
      const { rows: fileRows } = await query('SELECT icon_file_id FROM client_groups WHERE id = $1', [id]);
      if (fileRows[0]?.icon_file_id) {
        await deleteFile(fileRows[0].icon_file_id).catch(() => {});
      }
    } catch (e) {
      // icon_file_id column doesn't exist yet - ignore
    }

    // Update group - use conditional SQL to handle missing icon_file_id column
    let rows;
    try {
      const result = await query(
        `UPDATE client_groups SET icon_url = NULL, icon_file_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      );
      rows = result.rows;
    } catch (updateErr) {
      if (updateErr.message?.includes('icon_file_id')) {
        const result = await query(
          `UPDATE client_groups SET icon_url = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
          [id]
        );
        rows = result.rows;
      } else {
        throw updateErr;
      }
    }

    res.json({ group: rows[0] });
  } catch (err) {
    console.error('[client-groups:delete-icon]', err);
    res.status(500).json({ message: 'Unable to delete group icon' });
  }
});

router.put('/client-groups/:id', isAdminOrEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon, icon_url, sort_order } = req.body || {};

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description?.trim() || null);
    }
    if (color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      params.push(color || null);
    }
    if (icon !== undefined) {
      updates.push(`icon = $${paramIndex++}`);
      params.push(icon || null);
      // When setting a preset icon, clear the custom icon_url
      if (icon) {
        updates.push(`icon_url = $${paramIndex++}`);
        params.push(null);
      }
    }
    if (icon_url !== undefined) {
      updates.push(`icon_url = $${paramIndex++}`);
      params.push(icon_url || null);
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${paramIndex++}`);
      params.push(sort_order);
    }

    if (!updates.length) return res.status(400).json({ message: 'No fields to update' });

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await query(
      `UPDATE client_groups SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!rows.length) return res.status(404).json({ message: 'Client group not found' });
    res.json({ group: rows[0] });
  } catch (err) {
    console.error('[client-groups:update]', err);
    res.status(500).json({ message: 'Unable to update client group' });
  }
});

router.delete('/client-groups/:id', isAdminOrEditor, async (req, res) => {
  try {
    const { id } = req.params;
    // Unassign all clients from this group first (set to null)
    await query('UPDATE client_profiles SET client_group_id = NULL WHERE client_group_id = $1', [id]);
    const { rowCount } = await query('DELETE FROM client_groups WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ message: 'Client group not found' });
    res.json({ message: 'Client group deleted' });
  } catch (err) {
    console.error('[client-groups:delete]', err);
    res.status(500).json({ message: 'Unable to delete client group' });
  }
});

router.get('/client-groups/:id/team', isAdminOrEditor, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await fetchClientGroup(groupId);
    if (!group) return res.status(404).json({ message: 'Client group not found' });

    const [members, invitesRes, accountCountRes] = await Promise.all([
      listGroupTeamMembers(groupId),
      query(
        `SELECT
           cgit.id,
           cgit.invite_email,
           cgit.invite_first_name,
           cgit.invite_role,
           cgit.created_at,
           cgit.expires_at,
           cgit.token_value,
           inviter.first_name AS invited_by_first_name,
           inviter.last_name AS invited_by_last_name
         FROM client_group_invite_tokens cgit
         LEFT JOIN users inviter ON inviter.id = cgit.invited_by
         WHERE cgit.client_group_id = $1
           AND cgit.consumed_at IS NULL
           AND ${notRevoked('cgit')}
           AND cgit.expires_at > NOW()
         ORDER BY cgit.created_at DESC`,
        [groupId]
      ),
      query(`SELECT COUNT(*)::int AS account_count FROM client_profiles WHERE client_group_id = $1`, [groupId])
    ]);

    res.json({
      group,
      members,
      invites: invitesRes.rows,
      accountCount: accountCountRes.rows[0]?.account_count || 0
    });
  } catch (err) {
    console.error('[client-groups:team:list]', err);
    res.status(500).json({ message: 'Unable to fetch group access data' });
  }
});

router.post('/client-groups/:id/team/invite', isAdminOrEditor, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await fetchClientGroup(groupId);
    if (!group) return res.status(404).json({ message: 'Client group not found' });

    const { email, firstName, role = 'member' } = req.body || {};
    if (!email) return res.status(400).json({ message: 'Email is required' });
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be member or admin.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { rows: existingMember } = await query(
      `SELECT cgm.id
       FROM client_group_members cgm
       JOIN users u ON u.id = cgm.member_user_id
       WHERE cgm.client_group_id = $1
         AND cgm.status = 'active'
         AND u.email = $2`,
      [groupId, normalizedEmail]
    );
    if (existingMember.length > 0) {
      return res.status(400).json({ message: 'This email already has group access' });
    }

    const { rows: existingInvite } = await query(
      `SELECT id
       FROM client_group_invite_tokens
       WHERE client_group_id = $1
         AND invite_email = $2
         AND consumed_at IS NULL
         AND ${notRevoked()}
         AND expires_at > NOW()`,
      [groupId, normalizedEmail]
    );
    if (existingInvite.length > 0) {
      return res.status(400).json({ message: 'There is already a pending invite for this email' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = INVITE_NEVER_EXPIRES_AT;

    const { rows: inviteRows } = await query(
      `INSERT INTO client_group_invite_tokens
       (client_group_id, token_hash, token_value, invite_email, invite_first_name, invite_role, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [groupId, tokenHash, rawToken, normalizedEmail, firstName || null, role, req.user.id, expiresAt]
    );

    const inviteId = inviteRows[0].id;
    const inviterName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email;
    const baseUrl = resolveAdminBaseUrl(req);
    const inviteUrl = `${baseUrl}/accept-invite/${rawToken}`;
    const groupName = group.name || 'this client group';
    const recipientState = await getInviteRecipientAccountState(normalizedEmail);
    const nextStepCopy = getInviteNextStepCopy(recipientState);

    if (isMailgunConfigured()) {
      try {
        await sendMailgunMessageWithLogging(
          {
            to: [normalizedEmail],
            subject: `You've been invited to access ${groupName} on Anchor`,
            text: `Hello${firstName ? ` ${firstName}` : ''},

${inviterName} has invited you to access every client account in the ${groupName} group on Anchor Dashboard.

${nextStepCopy}
${inviteUrl}

If you didn't expect this invitation, you can safely ignore this email.

— Anchor`,
            html: `<p>Hello${firstName ? ` ${firstName}` : ''},</p>
<p><strong>${inviterName}</strong> has invited you to access every client account in the <strong>${groupName}</strong> group on Anchor Dashboard.</p>
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
            emailType: 'client_group_invite',
            recipientName: firstName,
            triggeredById: req.user.id,
            metadata: { invite_id: inviteId, group_id: groupId, role }
          }
        );
      } catch (emailErr) {
        console.error('[client-groups:team:invite:email]', emailErr);
      }
    }

    res.json({
      success: true,
      inviteId,
      inviteUrl,
      message: isMailgunConfigured() ? 'Invitation sent' : 'Invitation created (email not configured)'
    });
  } catch (err) {
    console.error('[client-groups:team:invite]', err);
    res.status(500).json({ message: 'Unable to send group invitation' });
  }
});

router.post('/client-groups/:id/team/invite/:inviteId/resend', isAdminOrEditor, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await fetchClientGroup(groupId);
    if (!group) return res.status(404).json({ message: 'Client group not found' });

    const inviteId = req.params.inviteId;
    const { rows: inviteRows } = await query(
      `SELECT *
       FROM client_group_invite_tokens
       WHERE id = $1
         AND client_group_id = $2
         AND consumed_at IS NULL
         AND ${notRevoked()}`,
      [inviteId, groupId]
    );
    if (inviteRows.length === 0) return res.status(404).json({ message: 'Invite not found' });

    const invite = inviteRows[0];
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = INVITE_NEVER_EXPIRES_AT;

    await query(
      `UPDATE client_group_invite_tokens
       SET token_hash = $1, token_value = $2, expires_at = $3
       WHERE id = $4`,
      [tokenHash, rawToken, expiresAt, inviteId]
    );

    const inviterName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email;
    const baseUrl = resolveAdminBaseUrl(req);
    const inviteUrl = `${baseUrl}/accept-invite/${rawToken}`;
    const groupName = group.name || 'this client group';
    const recipientState = await getInviteRecipientAccountState(invite.invite_email);
    const nextStepCopy = getInviteNextStepCopy(recipientState);

    if (isMailgunConfigured()) {
      try {
        await sendMailgunMessageWithLogging(
          {
            to: [invite.invite_email],
            subject: `Reminder: You've been invited to access ${groupName} on Anchor`,
            text: `Hello${invite.invite_first_name ? ` ${invite.invite_first_name}` : ''},

This is a reminder that ${inviterName} invited you to access every client account in the ${groupName} group on Anchor Dashboard.

${nextStepCopy}
${inviteUrl}

— Anchor`,
            html: `<p>Hello${invite.invite_first_name ? ` ${invite.invite_first_name}` : ''},</p>
<p>This is a reminder that <strong>${inviterName}</strong> invited you to access every client account in the <strong>${groupName}</strong> group on Anchor Dashboard.</p>
<p>${nextStepCopy.replace(':', '.')}</p>
<p style="margin: 24px 0;">
  <a href="${inviteUrl}" style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
    Accept Invitation
  </a>
</p>
<p>Or copy and paste this link into your browser:</p>
<p><a href="${inviteUrl}">${inviteUrl}</a></p>
<hr />
<p><i>— Anchor</i></p>`
          },
          {
            emailType: 'client_group_invite_resend',
            recipientName: invite.invite_first_name,
            triggeredById: req.user.id,
            metadata: { invite_id: inviteId, group_id: groupId, role: invite.invite_role }
          }
        );
      } catch (emailErr) {
        console.error('[client-groups:team:resend:email]', emailErr);
      }
    }

    res.json({
      success: true,
      inviteUrl,
      message: isMailgunConfigured() ? 'Invitation resent' : 'Invitation updated (email not configured)'
    });
  } catch (err) {
    console.error('[client-groups:team:resend]', err);
    res.status(500).json({ message: 'Unable to resend group invitation' });
  }
});

router.delete('/client-groups/:id/team/invite/:inviteId', isAdminOrEditor, async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE client_group_invite_tokens
       SET revoked_at = NOW(), token_value = NULL
       WHERE id = $1
         AND client_group_id = $2
         AND consumed_at IS NULL
         AND ${notRevoked()}`,
      [req.params.inviteId, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ message: 'Invite not found or already revoked' });
    res.json({ success: true, message: 'Invitation revoked' });
  } catch (err) {
    console.error('[client-groups:team:revoke]', err);
    res.status(500).json({ message: 'Unable to revoke group invitation' });
  }
});

router.patch('/client-groups/:id/team/members/:memberId', isAdminOrEditor, async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Role must be admin or member' });
    }

    const { rowCount } = await query(
      `UPDATE client_group_members
       SET role = $1, updated_at = NOW()
       WHERE id = $2
         AND client_group_id = $3
         AND status = 'active'`,
      [role, req.params.memberId, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ message: 'Member not found' });
    res.json({ success: true, message: 'Role updated' });
  } catch (err) {
    console.error('[client-groups:team:update-role]', err);
    res.status(500).json({ message: 'Unable to update group role' });
  }
});

router.delete('/client-groups/:id/team/members/:memberId', isAdminOrEditor, async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE client_group_members
       SET status = 'removed', updated_at = NOW()
       WHERE id = $1
         AND client_group_id = $2
         AND status = 'active'`,
      [req.params.memberId, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ message: 'Member not found' });
    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    console.error('[client-groups:team:remove]', err);
    res.status(500).json({ message: 'Unable to remove group member' });
  }
});


// ============================================================================
// Active clients (user customers) — extracted verbatim from hub.js
// ============================================================================

router.get('/active-clients', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  try {
    await ensureJourneyTables();
    await ensureActiveClientArchiveColumn();
    const showArchived = req.query.status === 'archived';
    const archiveClause = showArchived ? 'ac.archived_at IS NOT NULL' : 'ac.archived_at IS NULL';
    const { rows } = await query(
      `
      SELECT 
        ac.*,
        journey.id AS journey_id,
        journey.status AS journey_status,
        journey.paused AS journey_paused,
        journey.symptoms AS journey_symptoms,
        journey.next_action_at AS journey_next_action_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', cs.id,
              'service_id', cs.service_id,
              'service_name', s.name,
              'agreed_price', cs.agreed_price,
              'agreed_date', cs.agreed_date,
              'redacted_at', cs.redacted_at
            )
            ORDER BY cs.agreed_date DESC
          ) FILTER (WHERE cs.id IS NOT NULL),
          '[]'
        ) as services
      FROM active_clients ac
      LEFT JOIN LATERAL (
        SELECT id, status, paused, symptoms, next_action_at
        FROM client_journeys
        WHERE active_client_id = ac.id
        ORDER BY created_at DESC
        LIMIT 1
      ) journey ON true
      LEFT JOIN client_services cs ON ac.id = cs.active_client_id
      LEFT JOIN services s ON cs.service_id = s.id
      WHERE ac.owner_user_id = $1
        AND ${archiveClause}
      GROUP BY ac.id, journey.id, journey.status, journey.paused, journey.symptoms, journey.next_action_at
      ORDER BY ac.created_at DESC
    `,
      [userId]
    );
    res.json({ active_clients: rows });
  } catch (err) {
    logEvent('active-clients:list', 'Error fetching active clients', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to fetch active clients' });
  }
});

router.post('/active-clients/:id/archive', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    await ensureActiveClientArchiveColumn();
    const result = await query(
      `UPDATE active_clients
       SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING id`,
      [id, userId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ message: 'Active client not found' });
    }
    await query(
      `UPDATE client_journeys
       SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
       WHERE active_client_id = $1 AND owner_user_id = $2`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    logEvent('active-clients:archive', 'Error archiving client', { error: err.message, userId, id });
    res.status(500).json({ message: 'Unable to archive client' });
  }
});

router.post('/active-clients/:id/unarchive', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    await ensureActiveClientArchiveColumn();
    const result = await query(
      `UPDATE active_clients
       SET archived_at = NULL, updated_at = NOW()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING id`,
      [id, userId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ message: 'Active client not found' });
    }
    await query(
      `UPDATE client_journeys
       SET archived_at = NULL, updated_at = NOW()
       WHERE active_client_id = $1 AND owner_user_id = $2`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    logEvent('active-clients:unarchive', 'Error restoring client', { error: err.message, userId, id });
    res.status(500).json({ message: 'Unable to restore client' });
  }
});

// Fetch one active client with its services + journey summary, matching the
// shape returned by GET /active-clients. Used after mutations so callers can
// merge the fresh row into local state without a full list refetch.
async function fetchActiveClientWithServices(ownerUserId, activeClientId) {
  const { rows } = await query(
    `
    SELECT
      ac.*,
      journey.id AS journey_id,
      journey.status AS journey_status,
      journey.paused AS journey_paused,
      journey.symptoms AS journey_symptoms,
      journey.next_action_at AS journey_next_action_at,
      COALESCE(
        json_agg(
          json_build_object(
            'id', cs.id,
            'service_id', cs.service_id,
            'service_name', s.name,
            'agreed_price', cs.agreed_price,
            'agreed_date', cs.agreed_date,
            'redacted_at', cs.redacted_at
          )
          ORDER BY cs.agreed_date DESC
        ) FILTER (WHERE cs.id IS NOT NULL),
        '[]'
      ) as services
    FROM active_clients ac
    LEFT JOIN LATERAL (
      SELECT id, status, paused, symptoms, next_action_at
      FROM client_journeys
      WHERE active_client_id = ac.id
      ORDER BY created_at DESC
      LIMIT 1
    ) journey ON true
    LEFT JOIN client_services cs ON ac.id = cs.active_client_id
    LEFT JOIN services s ON cs.service_id = s.id
    WHERE ac.id = $1 AND ac.owner_user_id = $2
    GROUP BY ac.id, journey.id, journey.status, journey.paused, journey.symptoms, journey.next_action_at
    LIMIT 1
  `,
    [activeClientId, ownerUserId]
  );
  return rows[0] || null;
}

// Append services to an existing active client. Intentionally narrower than
// /clients/:leadId/agree-to-service (which handles the lead→client conversion
// flow with CTM attribution, journey linking, and 5-star posting). Here the
// client already exists, so we just validate ownership of the active_client
// AND of each service_id, then insert.
router.post('/active-clients/:id/services', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { services } = req.body || {};
  if (!Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ message: 'At least one service must be selected' });
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const normalizedServices = services
    .map((entry) => ({
      service_id: typeof entry?.service_id === 'string' ? entry.service_id.trim() : '',
      agreed_price: entry?.agreed_price
    }))
    .filter((entry) => entry.service_id.length > 0);
  if (!normalizedServices.length) {
    return res.status(400).json({ message: 'At least one valid service must be selected' });
  }
  if (normalizedServices.some((entry) => !uuidRe.test(entry.service_id))) {
    return res.status(400).json({ message: 'One or more selected services are invalid' });
  }
  const requestedServiceIds = Array.from(new Set(normalizedServices.map((entry) => entry.service_id)));

  try {
    await ensureActiveClientArchiveColumn();

    // Verify the active client belongs to the requester and is not archived.
    const ownership = await query(
      `SELECT id FROM active_clients
        WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL
        LIMIT 1`,
      [id, userId]
    );
    if (!ownership.rowCount) {
      return res.status(404).json({ message: 'Active client not found' });
    }

    // Verify every requested service belongs to the same owner.
    const { rows: ownedServices } = await query(
      'SELECT id FROM services WHERE user_id = $1 AND id = ANY($2::uuid[])',
      [userId, requestedServiceIds]
    );
    if (ownedServices.length !== requestedServiceIds.length) {
      return res.status(400).json({ message: 'One or more selected services are invalid for this client account' });
    }

    const dbClient = await getClient();
    try {
      await dbClient.query('BEGIN');
      for (const entry of normalizedServices) {
        const price = entry?.agreed_price;
        const safePrice =
          price === null || price === undefined || price === ''
            ? null
            : Number.isFinite(Number(price))
              ? Number(price)
              : null;
        await dbClient.query(
          `INSERT INTO client_services (active_client_id, service_id, agreed_price)
           VALUES ($1, $2, $3)`,
          [id, entry.service_id, safePrice]
        );
      }
      await dbClient.query(
        `UPDATE active_clients SET updated_at = NOW() WHERE id = $1 AND owner_user_id = $2`,
        [id, userId]
      );
      await dbClient.query('COMMIT');
    } catch (err) {
      await dbClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      dbClient.release();
    }

    const fresh = await fetchActiveClientWithServices(userId, id);
    res.json({ active_client: fresh });
  } catch (err) {
    logEvent('active-clients:add-services', 'Error adding services', { error: err.message, userId, id });
    res.status(500).json({ message: 'Unable to add services' });
  }
});

router.post('/active-clients/redact-services', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  try {
    // Only redact services for this user's active clients
    const { rows } = await query(
      `
      UPDATE client_services 
      SET redacted_at = NOW()
      WHERE redacted_at IS NULL 
        AND agreed_date < NOW() - INTERVAL '90 days'
        AND active_client_id IN (
          SELECT id FROM active_clients WHERE owner_user_id = $1
        )
      RETURNING id
    `,
      [userId]
    );
    const { rowCount: journeyRedacted } = await query(
      `UPDATE client_journeys
       SET symptoms = '[]'::jsonb,
           symptoms_redacted = TRUE,
           updated_at = NOW()
       WHERE symptoms_redacted = FALSE
         AND created_at < NOW() - INTERVAL '90 days'
         AND owner_user_id = $1`,
      [userId]
    );
    logEvent('active-clients:redact', 'Services redacted', { count: rows.length, userId });
    res.json({ success: true, services_redacted: rows.length, journeys_redacted: journeyRedacted });
  } catch (err) {
    logEvent('active-clients:redact', 'Error redacting services', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to redact services' });
  }
});

export default router;
