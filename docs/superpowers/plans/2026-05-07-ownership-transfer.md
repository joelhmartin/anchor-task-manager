# Ownership Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ownership-transfer feature defined in `docs/superpowers/specs/2026-05-07-ownership-transfer-design.md` — three target kinds (active member, pending invite, new email), with a boot-or-demote choice for the displaced owner, all gated behind explicit endpoints.

**Architecture:** Pure additive change. No schema migration. Ownership lives entirely in `client_account_members.role`. Invite metadata jsonb gets a `pending_owner_transfer` block when an invite carries a queued transfer. The existing `PATCH /clients/:id/team/members/:memberId` and the existing `client-invite/:token/accept` handler get small guards / hooks.

**Tech Stack:** Node 20 + Express 4 backend, React 19 + MUI 7 frontend, PostgreSQL 15. **No automated test suite** in this repo — every "test" step is a manual smoke against `localhost:4000` with `curl`, plus `yarn build` and `yarn lint` before commit. UI tasks need a quick visual check in the running dev server.

**Spec:** `docs/superpowers/specs/2026-05-07-ownership-transfer-design.md` (merged in PR #30, on `main`).

---

## Pre-flight

Before Task 1, run from the repo root:

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"
git checkout main
git pull --ff-only
git checkout -b feat/ownership-transfer-impl
```

Confirm `git status` is clean (no uncommitted changes that aren't yours) before starting.

---

## Task 1: Add ActivityEventTypes for the transfer lifecycle

**Files:**
- Modify: `server/services/activityLog.js` (within the `ActivityEventTypes` object near line 16-77)

- [ ] **Step 1: Add five new entries to `ActivityEventTypes`**

Open `server/services/activityLog.js`. Find the existing `// Team operations` block (around line 60). Add these entries right below `LEAVE_TEAM`:

```javascript
  // Ownership transfer lifecycle
  OWNERSHIP_TRANSFERRED: 'ownership_transferred',
  OWNERSHIP_TRANSFER_QUEUED: 'ownership_transfer_queued',
  OWNERSHIP_TRANSFER_COMPLETED: 'ownership_transfer_completed',
  OWNERSHIP_TRANSFER_COMPLETED_DISPLACED_GONE: 'ownership_transfer_completed_displaced_gone',
  OWNERSHIP_TRANSFER_CANCELED: 'ownership_transfer_canceled',
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `node --check server/services/activityLog.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add server/services/activityLog.js
git commit -m "feat(activity-log): add ownership-transfer event types"
```

---

## Task 2: Tighten the existing PATCH `members/:memberId` to reject `role: 'owner'`

The existing endpoint at `server/routes/hub.js:11369` already restricts `role` to `['admin', 'member']` (so it actually rejects `'owner'` with a 400). We replace that 400 with an explicit 409 carrying a stable error code that the frontend will branch on, plus include `'owner'` in the rejection list explicitly so future readers don't have to infer the intent.

**Files:**
- Modify: `server/routes/hub.js:11369-11395`

- [ ] **Step 1: Replace the existing role validation**

Find this block in `server/routes/hub.js` (around line 11371-11374):

```javascript
    const { role } = req.body || {};
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Role must be admin or member' });
    }
```

Replace it with:

```javascript
    const { role } = req.body || {};
    if (role === 'owner') {
      return res.status(409).json({
        message: 'Use the transfer-ownership endpoint to make someone the owner.',
        code: 'USE_TRANSFER_OWNERSHIP'
      });
    }
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Role must be admin or member' });
    }
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/routes/hub.js`
Expected: exit 0.

- [ ] **Step 3: Smoke-test locally**

Start the local server:

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
node server/index.js > /tmp/server.log 2>&1 &
sleep 4
```

Hit the endpoint with `role:'owner'` (no auth — we just want to see the route registers and returns a non-500):

```bash
curl -s -X PATCH http://localhost:4000/api/hub/clients/00000000-0000-0000-0000-000000000000/team/members/00000000-0000-0000-0000-000000000000 \
  -H "Content-Type: application/json" -d '{"role":"owner"}' -w "\nHTTP:%{http_code}\n"
```

Expected: `HTTP:401` with `Authentication required` body. The 401 confirms the route exists and auth is enforced before the body is parsed; the new 409 logic only fires once authenticated, which we verify in Task 4's smoke test.

Stop the server: `lsof -ti:4000 | xargs kill -9`

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(team): PATCH members rejects role:owner with 409 USE_TRANSFER_OWNERSHIP"
```

---

## Task 3: Add `PATCH /clients/:id/team/invite/:inviteId`

A pending invite today can only be resent (`POST .../resend`) or revoked (`DELETE .../inviteId`). The team UI needs to be able to edit the role on a pending invite the way it edits the role on an active member.

**Files:**
- Modify: `server/routes/hub.js` — insert a new route immediately after the existing `DELETE /clients/:id/team/invite/:inviteId` handler (around line 11366, before the `PATCH .../team/members/...` handler)

- [ ] **Step 1: Insert the new PATCH invite route**

In `server/routes/hub.js`, find the line:

```javascript
// DELETE /api/hub/clients/:id/team/members/:memberId — admin removes member
router.patch('/clients/:id/team/members/:memberId', isAdminOrEditor, async (req, res) => {
```

Insert this **before** that block:

```javascript
// PATCH /api/hub/clients/:id/team/invite/:inviteId — edit role / first name on a pending invite.
// Email is immutable. Setting role to 'owner' is rejected here — use POST .../transfer-ownership.
router.patch('/clients/:id/team/invite/:inviteId', isAdminOrEditor, async (req, res) => {
  try {
    const { role, first_name: firstName } = req.body || {};

    if (role === 'owner') {
      return res.status(409).json({
        message: 'Use the transfer-ownership endpoint to make a pending invite the owner.',
        code: 'USE_TRANSFER_OWNERSHIP'
      });
    }
    if (role !== undefined && !['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Role must be admin or member' });
    }
    if (role === undefined && firstName === undefined) {
      return res.status(400).json({ message: 'Nothing to update — provide role and/or first_name' });
    }

    const { rows: existing } = await query(
      `SELECT id FROM client_user_invite_tokens
        WHERE id = $1 AND client_owner_id = $2
          AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
      [req.params.inviteId, req.params.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Invite not found or no longer pending' });
    }

    const sets = [];
    const params = [];
    if (role !== undefined) { params.push(role); sets.push(`invite_role = $${params.length}`); }
    if (firstName !== undefined) { params.push(firstName || null); sets.push(`invite_first_name = $${params.length}`); }
    params.push(req.params.inviteId);

    const { rows: updated } = await query(
      `UPDATE client_user_invite_tokens
          SET ${sets.join(', ')}
        WHERE id = $${params.length}
        RETURNING id, invite_email, invite_first_name, invite_role, expires_at, metadata`,
      params
    );

    res.json({ success: true, invite: updated[0] });
  } catch (err) {
    console.error('[hub:client-team:invite:patch]', err);
    res.status(500).json({ message: 'Unable to update invitation' });
  }
});

```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/routes/hub.js`
Expected: exit 0.

- [ ] **Step 3: Smoke-test the route registers**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
node server/index.js > /tmp/server.log 2>&1 &
sleep 4
curl -s -X PATCH http://localhost:4000/api/hub/clients/00000000-0000-0000-0000-000000000000/team/invite/00000000-0000-0000-0000-000000000000 \
  -H "Content-Type: application/json" -d '{"role":"admin"}' -w "\nHTTP:%{http_code}\n"
lsof -ti:4000 | xargs kill -9
```

Expected: `HTTP:401`. Auth-required confirms the route mounted.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(team): PATCH invite endpoint to edit role + first_name on pending invites"
```

---

## Task 4: `POST .../team/transfer-ownership` — `kind: 'member'` branch

This is the orchestrating endpoint. Build it incrementally: implement the `member` (immediate) branch first, get a clean smoke, then layer on `invite` and `email`.

**Files:**
- Modify: `server/routes/hub.js` — insert a new route immediately after the new PATCH invite handler from Task 3

- [ ] **Step 1: Insert the route scaffold + member branch**

In `server/routes/hub.js`, immediately after the closing `});` of the PATCH invite endpoint you just added, insert:

```javascript
// POST /api/hub/clients/:id/team/transfer-ownership — orchestrate ownership change.
// target.kind:
//   'member' — promote an existing active member; immediate.
//   'invite' — flip an existing pending invite to invite_role='owner', queue transfer for acceptance.
//   'email'  — create a new owner invite for a brand-new email, queue transfer for acceptance.
// currentOwnerAction: 'boot' | 'demote' (applied at acceptance for invite/email kinds).
router.post('/clients/:id/team/transfer-ownership', isAdminOrEditor, async (req, res) => {
  const clientId = req.params.id;
  const { target, currentOwnerAction } = req.body || {};

  if (!target || typeof target !== 'object') {
    return res.status(400).json({ message: 'target is required' });
  }
  if (!['boot', 'demote'].includes(currentOwnerAction)) {
    return res.status(400).json({ message: "currentOwnerAction must be 'boot' or 'demote'" });
  }

  const dbClient = await getClient();
  try {
    await dbClient.query('BEGIN');

    // Resolve current owner. May not exist (e.g. previously booted manually) — that's fine.
    const { rows: ownerRows } = await dbClient.query(
      `SELECT id, member_user_id FROM client_account_members
        WHERE client_owner_id = $1 AND role = 'owner' AND status = 'active'
        LIMIT 1`,
      [clientId]
    );
    const currentOwner = ownerRows[0] || null;

    if (target.kind === 'member') {
      if (!target.memberId) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ message: 'target.memberId is required when kind=member' });
      }

      const { rows: targetRows } = await dbClient.query(
        `SELECT id, member_user_id, role, status FROM client_account_members
          WHERE id = $1 AND client_owner_id = $2`,
        [target.memberId, clientId]
      );
      if (targetRows.length === 0) {
        await dbClient.query('ROLLBACK');
        return res.status(404).json({ message: 'Target member not found' });
      }
      const targetRow = targetRows[0];
      if (targetRow.status !== 'active') {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ message: 'Target member is not active' });
      }
      if (currentOwner && targetRow.id === currentOwner.id) {
        await dbClient.query('ROLLBACK');
        return res.status(409).json({ message: 'Target is already the owner' });
      }

      // Promote target.
      await dbClient.query(
        `UPDATE client_account_members
            SET role = 'owner', status = 'active', updated_at = NOW()
          WHERE id = $1`,
        [targetRow.id]
      );

      // Apply currentOwnerAction to displaced owner (if any).
      if (currentOwner) {
        if (currentOwnerAction === 'boot') {
          await dbClient.query(
            `UPDATE client_account_members
                SET status = 'removed', updated_at = NOW()
              WHERE id = $1`,
            [currentOwner.id]
          );
        } else {
          await dbClient.query(
            `UPDATE client_account_members
                SET role = 'admin', status = 'active', updated_at = NOW()
              WHERE id = $1`,
            [currentOwner.id]
          );
        }
      }

      await dbClient.query('COMMIT');

      logClientActivity({
        userId: req.user.id,
        actionType: ActivityEventTypes.OWNERSHIP_TRANSFERRED,
        targetUserId: clientId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          new_owner_member_id: targetRow.id,
          new_owner_user_id: targetRow.member_user_id,
          displaced_owner_user_id: currentOwner?.member_user_id || null,
          on_accept_action: currentOwnerAction,
          immediate: true
        }
      }).catch((logErr) => console.error('[transfer-ownership:log]', logErr?.message));

      return res.json({ success: true, kind: 'member', applied: 'immediate' });
    }

    // Other kinds added in subsequent tasks.
    await dbClient.query('ROLLBACK');
    return res.status(400).json({ message: `target.kind must be 'member' (other kinds not implemented yet)` });
  } catch (err) {
    try { await dbClient.query('ROLLBACK'); } catch (_) { /* noop */ }
    console.error('[hub:transfer-ownership]', err);
    res.status(500).json({ message: 'Unable to transfer ownership' });
  } finally {
    dbClient.release();
  }
});

```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/routes/hub.js`

- [ ] **Step 3: Smoke-test the route registers**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
node server/index.js > /tmp/server.log 2>&1 &
sleep 4
curl -s -X POST http://localhost:4000/api/hub/clients/00000000-0000-0000-0000-000000000000/team/transfer-ownership \
  -H "Content-Type: application/json" -d '{}' -w "\nHTTP:%{http_code}\n"
lsof -ti:4000 | xargs kill -9
```

Expected: `HTTP:401`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(team): transfer-ownership endpoint (member kind only)"
```

---

## Task 5: `transfer-ownership` — `kind: 'invite'` branch

Now layer on the queued-transfer flow for an existing pending invite.

**Files:**
- Modify: `server/routes/hub.js` (the route inserted in Task 4)

- [ ] **Step 1: Replace the "other kinds" stub with the invite branch**

Find this block at the end of the `try` in the transfer-ownership handler:

```javascript
    // Other kinds added in subsequent tasks.
    await dbClient.query('ROLLBACK');
    return res.status(400).json({ message: `target.kind must be 'member' (other kinds not implemented yet)` });
```

Replace it with:

```javascript
    if (target.kind === 'invite') {
      if (!target.inviteId) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ message: 'target.inviteId is required when kind=invite' });
      }

      const { rows: inviteRows } = await dbClient.query(
        `SELECT id, invite_email, invite_role, metadata
           FROM client_user_invite_tokens
          WHERE id = $1 AND client_owner_id = $2
            AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
          FOR UPDATE`,
        [target.inviteId, clientId]
      );
      if (inviteRows.length === 0) {
        await dbClient.query('ROLLBACK');
        return res.status(404).json({ message: 'Pending invite not found' });
      }
      const inviteRow = inviteRows[0];

      // Reject if the displaced owner's email matches the invite email — that
      // would mean the current owner is "transferring to themselves," a no-op.
      if (currentOwner) {
        const { rows: ownerEmail } = await dbClient.query(
          'SELECT email FROM users WHERE id = $1',
          [currentOwner.member_user_id]
        );
        if (ownerEmail[0]?.email && ownerEmail[0].email.toLowerCase() === String(inviteRow.invite_email).toLowerCase()) {
          await dbClient.query('ROLLBACK');
          return res.status(409).json({ message: 'Invite email matches the current owner' });
        }
      }

      const newMetadata = {
        ...(inviteRow.metadata || {}),
        pending_owner_transfer: true,
        displaced_owner_user_id: currentOwner?.member_user_id || null,
        on_accept_action: currentOwnerAction,
        queued_at: new Date().toISOString(),
        queued_by_user_id: req.user.id
      };

      await dbClient.query(
        `UPDATE client_user_invite_tokens
            SET invite_role = 'owner', metadata = $1::jsonb
          WHERE id = $2`,
        [JSON.stringify(newMetadata), inviteRow.id]
      );

      await dbClient.query('COMMIT');

      logClientActivity({
        userId: req.user.id,
        actionType: ActivityEventTypes.OWNERSHIP_TRANSFER_QUEUED,
        targetUserId: clientId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          via: 'invite',
          invite_id: inviteRow.id,
          invite_email: inviteRow.invite_email,
          displaced_owner_user_id: currentOwner?.member_user_id || null,
          on_accept_action: currentOwnerAction
        }
      }).catch((logErr) => console.error('[transfer-ownership:log]', logErr?.message));

      return res.json({ success: true, kind: 'invite', applied: 'on_accept', inviteId: inviteRow.id });
    }

    // 'email' kind added in next task.
    await dbClient.query('ROLLBACK');
    return res.status(400).json({ message: `target.kind must be 'member' or 'invite' (email not implemented yet)` });
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/routes/hub.js`

- [ ] **Step 3: Smoke-test**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
node server/index.js > /tmp/server.log 2>&1 &
sleep 4
curl -s -X POST http://localhost:4000/api/hub/clients/00000000-0000-0000-0000-000000000000/team/transfer-ownership \
  -H "Content-Type: application/json" -d '{"target":{"kind":"invite"},"currentOwnerAction":"demote"}' -w "\nHTTP:%{http_code}\n"
lsof -ti:4000 | xargs kill -9
```

Expected: `HTTP:401`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(team): transfer-ownership invite branch (queues transfer on existing pending invite)"
```

---

## Task 6: `transfer-ownership` — `kind: 'email'` branch

Final branch: send a brand-new owner-role invite to a new email, with the queued transfer stamped on metadata.

**Files:**
- Modify: `server/routes/hub.js` (the route from Tasks 4-5)

- [ ] **Step 1: Replace the "email not implemented" stub**

Find this block:

```javascript
    // 'email' kind added in next task.
    await dbClient.query('ROLLBACK');
    return res.status(400).json({ message: `target.kind must be 'member' or 'invite' (email not implemented yet)` });
```

Replace it with:

```javascript
    if (target.kind === 'email') {
      const rawEmail = (target.email || '').toString().trim().toLowerCase();
      const targetFirstName = (target.firstName || '').toString().trim() || null;
      if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        await dbClient.query('ROLLBACK');
        return res.status(400).json({ message: 'target.email is required and must be a valid email' });
      }

      // Block transfer to an email that's already an active member or pending invitee.
      const { rows: existingMember } = await dbClient.query(
        `SELECT cam.id FROM client_account_members cam
           JOIN users u ON u.id = cam.member_user_id
          WHERE cam.client_owner_id = $1 AND u.email = $2 AND cam.status = 'active'`,
        [clientId, rawEmail]
      );
      if (existingMember.length > 0) {
        await dbClient.query('ROLLBACK');
        return res.status(409).json({
          message: 'That email is already an active team member — use kind=member instead.',
          code: 'TARGET_IS_MEMBER'
        });
      }
      const { rows: existingInvite } = await dbClient.query(
        `SELECT id FROM client_user_invite_tokens
          WHERE client_owner_id = $1 AND invite_email = $2
            AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
        [clientId, rawEmail]
      );
      if (existingInvite.length > 0) {
        await dbClient.query('ROLLBACK');
        return res.status(409).json({
          message: 'A pending invite already exists for that email — use kind=invite instead.',
          code: 'TARGET_HAS_PENDING_INVITE'
        });
      }

      // Same-email-as-current-owner check.
      if (currentOwner) {
        const { rows: ownerEmail } = await dbClient.query(
          'SELECT email FROM users WHERE id = $1',
          [currentOwner.member_user_id]
        );
        if (ownerEmail[0]?.email && ownerEmail[0].email.toLowerCase() === rawEmail) {
          await dbClient.query('ROLLBACK');
          return res.status(409).json({ message: 'Email matches the current owner' });
        }
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashInviteToken(rawToken);
      const expiresAt = INVITE_NEVER_EXPIRES_AT;
      const metadata = {
        invited_by_admin: true,
        pending_owner_transfer: true,
        displaced_owner_user_id: currentOwner?.member_user_id || null,
        on_accept_action: currentOwnerAction,
        queued_at: new Date().toISOString(),
        queued_by_user_id: req.user.id
      };

      const { rows: inserted } = await dbClient.query(
        `INSERT INTO client_user_invite_tokens
           (client_owner_id, token_hash, token_value, invite_email, invite_first_name, invite_role, invited_by, expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, 'owner', $6, $7, $8::jsonb)
         RETURNING id`,
        [clientId, tokenHash, rawToken, rawEmail, targetFirstName, req.user.id, expiresAt, JSON.stringify(metadata)]
      );
      const newInviteId = inserted[0].id;

      await dbClient.query('COMMIT');

      const baseUrl = resolveAdminBaseUrl(req);
      const inviteUrl = `${baseUrl}/accept-invite/${rawToken}`;

      // Best-effort email send. Failures don't roll back the queued transfer.
      if (isMailgunConfigured()) {
        try {
          const { rows: brandRows } = await query(
            `SELECT business_name FROM brand_assets WHERE user_id = $1 LIMIT 1`,
            [clientId]
          );
          const businessName = brandRows[0]?.business_name || 'your team';
          const inviterName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email;
          await sendMailgunMessageWithLogging(
            {
              to: [rawEmail],
              subject: `You've been invited to take over ${businessName} on Anchor`,
              text: `Hello${targetFirstName ? ` ${targetFirstName}` : ''},

${inviterName} has invited you to take over ownership of ${businessName} on Anchor Dashboard.

Click the link below to accept this invitation and create your password:
${inviteUrl}

— Anchor`,
              html: `<p>Hello${targetFirstName ? ` ${targetFirstName}` : ''},</p>
<p><strong>${inviterName}</strong> has invited you to take over ownership of <strong>${businessName}</strong> on Anchor Dashboard.</p>
<p>Click the link below to accept this invitation and create your password:</p>
<p style="margin: 24px 0;">
  <a href="${inviteUrl}" style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
    Accept Ownership
  </a>
</p>
<p>Or copy and paste this link into your browser:</p>
<p><a href="${inviteUrl}">${inviteUrl}</a></p>
<hr />
<p><small>If you didn't expect this invitation, you can safely ignore this email.</small></p>
<p><i>— Anchor</i></p>`
            },
            {
              emailType: 'client_team_owner_transfer_invite',
              recipientName: targetFirstName,
              triggeredById: req.user.id,
              clientId,
              metadata: { invite_id: newInviteId, role: 'owner', invited_by_admin: true, pending_owner_transfer: true }
            }
          );
        } catch (emailErr) {
          console.error('[hub:transfer-ownership:email-send]', emailErr);
        }
      }

      logClientActivity({
        userId: req.user.id,
        actionType: ActivityEventTypes.OWNERSHIP_TRANSFER_QUEUED,
        targetUserId: clientId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          via: 'email',
          invite_id: newInviteId,
          invite_email: rawEmail,
          displaced_owner_user_id: currentOwner?.member_user_id || null,
          on_accept_action: currentOwnerAction
        }
      }).catch((logErr) => console.error('[transfer-ownership:log]', logErr?.message));

      return res.json({
        success: true,
        kind: 'email',
        applied: 'on_accept',
        inviteId: newInviteId,
        inviteUrl
      });
    }

    await dbClient.query('ROLLBACK');
    return res.status(400).json({ message: `target.kind must be 'member', 'invite', or 'email'` });
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/routes/hub.js`

- [ ] **Step 3: Smoke-test**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
node server/index.js > /tmp/server.log 2>&1 &
sleep 4
curl -s -X POST http://localhost:4000/api/hub/clients/00000000-0000-0000-0000-000000000000/team/transfer-ownership \
  -H "Content-Type: application/json" \
  -d '{"target":{"kind":"email","email":"newowner@example.com"},"currentOwnerAction":"demote"}' \
  -w "\nHTTP:%{http_code}\n"
lsof -ti:4000 | xargs kill -9
```

Expected: `HTTP:401`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(team): transfer-ownership email branch (new invite + queued transfer)"
```

---

## Task 7: Acceptance flow — apply queued transfer at invite acceptance

Wire the metadata-driven transfer into the existing `activateInviteMembership` helper in `clientInvite.js`. Both the new-owner promotion and the displaced-owner update must happen in the same transaction that's already open in the acceptance handler.

**Files:**
- Modify: `server/routes/clientInvite.js:217-245` (the `client_owner_id`-scoped path of `activateInviteMembership`)

- [ ] **Step 1: Read the current function**

The existing function (lines ~192-246) handles two scopes: `'group'` (returns early) and the default account scope. We append our logic to the account-scope branch only, after the existing INSERT into `client_account_members` and INSERT into `client_profiles`, and **before** the UPDATE that marks the invite consumed.

- [ ] **Step 2: Replace the account-scope branch of `activateInviteMembership`**

Find this block in `server/routes/clientInvite.js` (starts around line 217):

```javascript
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

  await dbClient.query(
    `UPDATE client_user_invite_tokens
     SET consumed_at = NOW(), resulting_user_id = $1, token_value = NULL
     WHERE id = $2`,
    [userId, record.id]
  );
}
```

Replace it with:

```javascript
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
  const meta = record.metadata || {};
  let transferOutcome = null;
  if (record.invite_role === 'owner' && meta.pending_owner_transfer && meta.displaced_owner_user_id) {
    const action = meta.on_accept_action === 'boot' ? 'boot' : 'demote';
    let displacedUpdate;
    if (action === 'boot') {
      displacedUpdate = await dbClient.query(
        `UPDATE client_account_members
            SET status = 'removed', updated_at = NOW()
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
  }

  await dbClient.query(
    `UPDATE client_user_invite_tokens
     SET consumed_at = NOW(), resulting_user_id = $1, token_value = NULL
     WHERE id = $2`,
    [userId, record.id]
  );

  // Audit log (best-effort; outside the user-visible accept flow). Lazy-import to
  // keep the activity log dependency local to this branch.
  if (transferOutcome) {
    try {
      const { logClientActivity, ActivityEventTypes } = await import('../services/activityLog.js');
      await logClientActivity({
        userId,
        actionType:
          transferOutcome === 'completed'
            ? ActivityEventTypes.OWNERSHIP_TRANSFER_COMPLETED
            : ActivityEventTypes.OWNERSHIP_TRANSFER_COMPLETED_DISPLACED_GONE,
        targetUserId: record.client_owner_id,
        details: {
          invite_id: record.id,
          new_owner_user_id: userId,
          displaced_owner_user_id: meta.displaced_owner_user_id,
          on_accept_action: meta.on_accept_action
        }
      });
    } catch (logErr) {
      console.error('[client-invite:transfer-log]', logErr?.message);
    }
  }
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check server/routes/clientInvite.js`

- [ ] **Step 4: Smoke-test the route still works**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
node server/index.js > /tmp/server.log 2>&1 &
sleep 4
curl -s "http://localhost:4000/api/client-invite/garbage-token" -w "\nHTTP:%{http_code}\n"
lsof -ti:4000 | xargs kill -9
```

Expected: `HTTP:404` with `INVITE_INVALID` body. The acceptance route still resolves; we haven't broken anything.

- [ ] **Step 5: Commit**

```bash
git add server/routes/clientInvite.js
git commit -m "feat(invite-accept): apply queued ownership transfer when invite metadata says so"
```

---

## Task 8: Frontend API client methods

**Files:**
- Modify: `src/api/clients.js` (append to the "Admin: Client Team Management" section near line 64-87)

- [ ] **Step 1: Add two new methods**

In `src/api/clients.js`, after the existing `updateClientTeamMemberRole` function (line ~85-87), append:

```javascript

export function updateClientTeamInvite(clientId, inviteId, { role, firstName }) {
  const body = {};
  if (role !== undefined) body.role = role;
  if (firstName !== undefined) body.first_name = firstName;
  return client.patch(`/hub/clients/${clientId}/team/invite/${inviteId}`, body).then((res) => res.data);
}

export function transferClientOwnership(clientId, { target, currentOwnerAction }) {
  return client
    .post(`/hub/clients/${clientId}/team/transfer-ownership`, { target, currentOwnerAction })
    .then((res) => res.data);
}
```

- [ ] **Step 2: Verify build**

Run: `yarn build 2>&1 | tail -3`
Expected: build completes (no compile errors).

- [ ] **Step 3: Commit**

```bash
git add src/api/clients.js
git commit -m "feat(api): updateClientTeamInvite + transferClientOwnership client helpers"
```

---

## Task 9: Team tab — invite role select + intercept "owner" choice

The pending-invite rows currently render the role as a static `Chip`. Replace with a `Select` (matching the member rows) that calls the new `PATCH invite` endpoint, and intercept "owner" to open the transfer dialog (added in Task 10).

**Files:**
- Modify: `src/views/admin/AdminHub/TeamTab.jsx`

- [ ] **Step 1: Update imports**

Find the import block at the top of `TeamTab.jsx` (around line 35-43) and add `updateClientTeamInvite` and `transferClientOwnership` to the imports from `'api/clients'`:

```javascript
import {
  fetchClientTeam,
  sendClientTeamInvite,
  resendClientTeamInvite,
  revokeClientTeamInvite,
  removeClientTeamMember,
  updateClientTeamMemberRole,
  updateClientTeamInvite,
  transferClientOwnership
} from 'api/clients';
```

- [ ] **Step 2: Add a handler for invite role changes and a transfer-dialog state**

After the existing `handleRoleChange` function (around line 123-132), add:

```javascript
  // State for the transfer-ownership dialog (Task 10 wires the dialog UI).
  const [transferDialog, setTransferDialog] = useState({
    open: false,
    targetKind: null, // 'member' | 'invite'
    targetId: null,
    targetLabel: '',
    previousRole: null
  });

  const handleInviteRoleChange = async (invite, newRole) => {
    if (newRole === invite.invite_role) return;
    if (newRole === 'owner') {
      setTransferDialog({
        open: true,
        targetKind: 'invite',
        targetId: invite.id,
        targetLabel: invite.invite_email,
        previousRole: invite.invite_role
      });
      return;
    }
    try {
      await updateClientTeamInvite(clientId, invite.id, { role: newRole });
      showToast('Invite role updated', 'success');
      setInvites((prev) => prev.map((i) => (i.id === invite.id ? { ...i, invite_role: newRole } : i)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };
```

- [ ] **Step 3: Replace the existing `handleRoleChange` to intercept owner**

Find the existing function:

```javascript
  const handleRoleChange = async (member, newRole) => {
    if (newRole === member.role) return;
    try {
      await updateClientTeamMemberRole(clientId, member.id, newRole);
      showToast('Role updated', 'success');
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };
```

Replace with:

```javascript
  const handleRoleChange = async (member, newRole) => {
    if (newRole === member.role) return;
    if (newRole === 'owner') {
      setTransferDialog({
        open: true,
        targetKind: 'member',
        targetId: member.id,
        targetLabel: [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email,
        previousRole: member.role
      });
      return;
    }
    try {
      await updateClientTeamMemberRole(clientId, member.id, newRole);
      showToast('Role updated', 'success');
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };
```

- [ ] **Step 4: Update the invite-row role column to use a Select**

Find the `inviteColumns` definition (around line 209-236). Replace the `id: 'role'` column entry (currently a static Chip):

```javascript
    {
      id: 'role', label: 'Role',
      render: (row) => <Chip label={ROLE_LABELS[row.invite_role] || row.invite_role} size="small" variant="outlined" color={ROLE_COLORS[row.invite_role] || 'default'} />
    },
```

with:

```javascript
    {
      id: 'role', label: 'Role',
      render: (row) => {
        const isPendingOwnerTransfer = !!row.metadata?.pending_owner_transfer;
        // If this invite already carries a queued owner-transfer (or is itself an owner invite),
        // show a chip — editing role from "owner" via this select is not how you cancel a transfer
        // (revoke the invite instead).
        if (row.invite_role === 'owner' || isPendingOwnerTransfer) {
          return (
            <Chip
              label={ROLE_LABELS[row.invite_role] || row.invite_role}
              size="small"
              variant="outlined"
              color={ROLE_COLORS[row.invite_role] || 'default'}
            />
          );
        }
        return (
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select
              value={row.invite_role}
              onChange={(e) => handleInviteRoleChange(row, e.target.value)}
              sx={{ '& .MuiSelect-select': { py: 0.5, fontSize: '0.8125rem' } }}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="member">Member</MenuItem>
              <MenuItem value="owner">Owner</MenuItem>
            </Select>
          </FormControl>
        );
      }
    },
```

- [ ] **Step 5: Add Owner option to the member-row select**

Find the `memberColumns` `id: 'role'` render block (around line 173-192). Replace this part:

```javascript
        return (
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select
              value={row.role}
              onChange={(e) => handleRoleChange(row, e.target.value)}
              sx={{ '& .MuiSelect-select': { py: 0.5, fontSize: '0.8125rem' } }}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="member">Member</MenuItem>
            </Select>
          </FormControl>
        );
```

with:

```javascript
        return (
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select
              value={row.role}
              onChange={(e) => handleRoleChange(row, e.target.value)}
              sx={{ '& .MuiSelect-select': { py: 0.5, fontSize: '0.8125rem' } }}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="member">Member</MenuItem>
              <MenuItem value="owner">Owner</MenuItem>
            </Select>
          </FormControl>
        );
```

- [ ] **Step 6: Build**

Run: `yarn build 2>&1 | tail -3`

- [ ] **Step 7: Commit**

```bash
git add src/views/admin/AdminHub/TeamTab.jsx
git commit -m "feat(team-ui): editable invite role select + intercept owner choice"
```

---

## Task 10: Team tab — TransferOwnershipDialog component

The dialog opens when the user picks `'owner'` in either the member-row or invite-row select. It asks: "Demote current owner to admin" or "Remove current owner from this account", then calls `transferClientOwnership` with the right kind.

**Files:**
- Modify: `src/views/admin/AdminHub/TeamTab.jsx`

- [ ] **Step 1: Add a Radio import**

Find the existing MUI imports near the top of `TeamTab.jsx` (lines 9-19). Add these to the imports:

```javascript
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
```

- [ ] **Step 2: Add transfer-state for the action choice**

After the existing `transferDialog` state from Task 9 (the `useState` block), add:

```javascript
  const [transferAction, setTransferAction] = useState('demote');
  const [transferLoading, setTransferLoading] = useState(false);
```

- [ ] **Step 3: Add the submit handler**

After `handleInviteRoleChange` (added in Task 9), add:

```javascript
  const handleConfirmTransfer = async () => {
    const target =
      transferDialog.targetKind === 'member'
        ? { kind: 'member', memberId: transferDialog.targetId }
        : { kind: 'invite', inviteId: transferDialog.targetId };
    try {
      setTransferLoading(true);
      await transferClientOwnership(clientId, { target, currentOwnerAction: transferAction });
      showToast(
        transferDialog.targetKind === 'member'
          ? 'Ownership transferred'
          : 'Ownership transfer queued — applies when the invite is accepted',
        'success'
      );
      setTransferDialog({ open: false, targetKind: null, targetId: null, targetLabel: '', previousRole: null });
      setTransferAction('demote');
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleCancelTransfer = () => {
    setTransferDialog({ open: false, targetKind: null, targetId: null, targetLabel: '', previousRole: null });
    setTransferAction('demote');
  };
```

- [ ] **Step 4: Render the dialog**

Find the existing `<ConfirmDialog>` near the end of the component (around line 326-339, just before the closing `</Stack>` and `}`). Add the new dialog **after** the `<ConfirmDialog>` and **before** the closing `</Stack>`:

```jsx
      {/* Transfer Ownership Dialog (member or pending invite as target) */}
      <ConfirmDialog
        open={transferDialog.open}
        onClose={handleCancelTransfer}
        onConfirm={handleConfirmTransfer}
        title="Transfer Ownership"
        confirmLabel={transferDialog.targetKind === 'member' ? 'Transfer Now' : 'Queue Transfer'}
        confirmColor="primary"
        loading={transferLoading}
        loadingLabel="Transferring..."
        message={
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Make <strong>{transferDialog.targetLabel}</strong> the owner of this account
              {transferDialog.targetKind === 'invite' ? ' once they accept their invitation' : ''}.
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>What happens to the current owner?</Typography>
            <RadioGroup value={transferAction} onChange={(e) => setTransferAction(e.target.value)}>
              <FormControlLabel
                value="demote"
                control={<Radio size="small" />}
                label="Demote to admin (keeps access)"
              />
              <FormControlLabel
                value="boot"
                control={<Radio size="small" />}
                label="Remove from this account (loses access)"
              />
            </RadioGroup>
          </>
        }
      />
```

- [ ] **Step 5: Build**

Run: `yarn build 2>&1 | tail -3`

- [ ] **Step 6: Visual smoke**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
node server/index.js > /tmp/server.log 2>&1 &
sleep 3
yarn start &
```

Open `http://localhost:3000`, log in as superadmin, open a client's drawer, switch to the Team tab. Verify:
- The role select on a member row now includes an "Owner" option.
- Picking "Owner" opens a dialog asking "Demote / Remove" with a Cancel button.
- Cancel closes the dialog without changing state.

Stop both: `lsof -ti:3000 | xargs kill -9; lsof -ti:4000 | xargs kill -9`

- [ ] **Step 7: Commit**

```bash
git add src/views/admin/AdminHub/TeamTab.jsx
git commit -m "feat(team-ui): TransferOwnershipDialog for member/invite targets"
```

---

## Task 11: Team tab — Relinquish Ownership button + dialog

Top-level button next to the existing "Invite" button. Opens a new dialog asking for email + first name + boot-or-demote, then calls `transferClientOwnership` with `kind:'email'`.

**Files:**
- Modify: `src/views/admin/AdminHub/TeamTab.jsx`

- [ ] **Step 1: Add state for the relinquish dialog**

Add this state alongside the existing `transferDialog` state:

```javascript
  const [relinquishDialog, setRelinquishDialog] = useState({ open: false });
  const [relinquishForm, setRelinquishForm] = useState({ email: '', firstName: '', action: 'demote' });
  const [relinquishLoading, setRelinquishLoading] = useState(false);
  const [relinquishInviteUrl, setRelinquishInviteUrl] = useState('');
```

- [ ] **Step 2: Add handlers**

After `handleCancelTransfer`, add:

```javascript
  const handleOpenRelinquish = () => {
    setRelinquishForm({ email: '', firstName: '', action: 'demote' });
    setRelinquishInviteUrl('');
    setRelinquishDialog({ open: true });
  };

  const handleSubmitRelinquish = async () => {
    if (!relinquishForm.email) { showToast('Email is required', 'error'); return; }
    try {
      setRelinquishLoading(true);
      const result = await transferClientOwnership(clientId, {
        target: { kind: 'email', email: relinquishForm.email, firstName: relinquishForm.firstName || undefined },
        currentOwnerAction: relinquishForm.action
      });
      setRelinquishInviteUrl(result.inviteUrl || '');
      showToast('Ownership transfer invite sent', 'success');
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRelinquishLoading(false);
    }
  };
```

- [ ] **Step 3: Add the button next to "Invite"**

Find the header row (around line 240-243):

```jsx
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={600}>Team Members ({members.length})</Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleOpenInvite}>Invite</Button>
      </Stack>
```

Replace with:

```jsx
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={600}>Team Members ({members.length})</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={handleOpenRelinquish}>
            Relinquish Ownership
          </Button>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleOpenInvite}>Invite</Button>
        </Stack>
      </Stack>
```

- [ ] **Step 4: Render the relinquish dialog**

After the TransferOwnershipDialog from Task 10 (still inside the component, before the closing `</Stack>`), add:

```jsx
      {/* Relinquish Ownership Dialog (email kind) */}
      <FormDialog
        open={relinquishDialog.open}
        onClose={() => { setRelinquishDialog({ open: false }); setRelinquishInviteUrl(''); }}
        onSubmit={relinquishInviteUrl ? undefined : handleSubmitRelinquish}
        title="Relinquish Ownership"
        loading={relinquishLoading}
        submitLabel="Send Owner Invitation"
        submitDisabled={!relinquishForm.email || !!relinquishInviteUrl}
        actions={relinquishInviteUrl ? (
          <Button onClick={() => { setRelinquishDialog({ open: false }); setRelinquishInviteUrl(''); }}>Done</Button>
        ) : undefined}
      >
        {!relinquishInviteUrl ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              An invitation will be sent. The transfer applies once the new owner accepts.
            </Typography>
            <TextField
              label="New Owner Email"
              type="email"
              fullWidth
              required
              value={relinquishForm.email}
              onChange={(e) => setRelinquishForm({ ...relinquishForm, email: e.target.value })}
              placeholder="newowner@example.com"
            />
            <TextField
              label="First Name (optional)"
              fullWidth
              value={relinquishForm.firstName}
              onChange={(e) => setRelinquishForm({ ...relinquishForm, firstName: e.target.value })}
            />
            <Typography variant="body2" sx={{ mt: 1 }}>
              When the new owner accepts, the current owner will be:
            </Typography>
            <RadioGroup
              value={relinquishForm.action}
              onChange={(e) => setRelinquishForm({ ...relinquishForm, action: e.target.value })}
            >
              <FormControlLabel value="demote" control={<Radio size="small" />} label="Demoted to admin (keeps access)" />
              <FormControlLabel value="boot" control={<Radio size="small" />} label="Removed from this account" />
            </RadioGroup>
          </>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="success.main" fontWeight={500}>Owner invitation sent!</Typography>
            <Typography variant="body2" color="text.secondary">You can also share this link directly:</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField fullWidth value={relinquishInviteUrl} size="small" InputProps={{ readOnly: true }} />
              <Tooltip title="Copy link">
                <IconButton onClick={() => { navigator.clipboard.writeText(relinquishInviteUrl); showToast('Copied!', 'success'); }}>
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        )}
      </FormDialog>
```

- [ ] **Step 5: Build**

Run: `yarn build 2>&1 | tail -3`

- [ ] **Step 6: Visual smoke**

Run server + frontend (same as Task 10 step 6). On the Team tab, verify the new "Relinquish Ownership" button opens a dialog with email/first-name inputs, two radio options, and a "Send Owner Invitation" submit. Cancel closes cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/views/admin/AdminHub/TeamTab.jsx
git commit -m "feat(team-ui): Relinquish Ownership button + dialog (kind=email)"
```

---

## Task 12: Pending-transfer chip on invite rows

When an invite carries `metadata.pending_owner_transfer`, surface that on the row so admins know revoking it cancels the transfer.

**Files:**
- Modify: `src/views/admin/AdminHub/TeamTab.jsx`

- [ ] **Step 1: Update the invite-row "Email" cell to show a chip**

Find the `id: 'email'` block in `inviteColumns` (around line 210-220) and replace its render with:

```javascript
    {
      id: 'email', label: 'Email',
      render: (row) => {
        const pendingTransfer = !!row.metadata?.pending_owner_transfer;
        const action = row.metadata?.on_accept_action;
        return (
          <Stack direction="row" alignItems="center" spacing={1}>
            <EmailIcon color="action" fontSize="small" />
            <Box>
              <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography variant="body2">{row.invite_email}</Typography>
                {pendingTransfer && (
                  <Chip
                    label={action === 'boot' ? 'Owner transfer (current owner removed)' : 'Owner transfer (current owner demoted)'}
                    size="small"
                    color="warning"
                    variant="outlined"
                  />
                )}
              </Stack>
              {row.invite_first_name && <Typography variant="caption" color="text.secondary">{row.invite_first_name}</Typography>}
            </Box>
          </Stack>
        );
      }
    },
```

- [ ] **Step 2: Build**

Run: `yarn build 2>&1 | tail -3`

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/TeamTab.jsx
git commit -m "feat(team-ui): pending-owner-transfer chip on invite rows"
```

---

## Task 13: Update API_REFERENCE.md

**Files:**
- Modify: `docs/API_REFERENCE.md`

- [ ] **Step 1: Find the team-management section**

Search for `team/invite` in `docs/API_REFERENCE.md`. Find the existing block documenting `POST /clients/:id/team/invite`, `POST /clients/:id/team/invite/:inviteId/resend`, `DELETE /clients/:id/team/invite/:inviteId`, `PATCH /clients/:id/team/members/:memberId`, etc.

- [ ] **Step 2: Append the new endpoints**

Immediately after the existing `DELETE /clients/:id/team/invite/:inviteId` documentation block, append (preserving the existing markdown style of the file — match the heading levels and table formats around it):

```markdown
### `PATCH /api/hub/clients/:id/team/invite/:inviteId`

Edit role or first-name on a pending invite. Email is immutable.

**Body:** `{ role?: 'admin'|'member', first_name?: string }`

Setting `role: 'owner'` returns 409 with `code: 'USE_TRANSFER_OWNERSHIP'` — use `POST .../transfer-ownership` instead.

**Auth:** `isAdminOrEditor`.

### `POST /api/hub/clients/:id/team/transfer-ownership`

Orchestrates ownership transfer. Three target kinds:

| Kind | Behavior |
|------|----------|
| `member` | Immediate transfer to an existing active member. |
| `invite` | Updates an existing pending invite to `invite_role='owner'` and stamps `pending_owner_transfer` metadata. Transfer applies on acceptance. |
| `email`  | Creates a new owner-role invite for the email, with `pending_owner_transfer` metadata. Transfer applies on acceptance. |

**Body:**
```jsonc
{
  "target": {
    "kind": "member" | "invite" | "email",
    "memberId": "<uuid>",   // when kind=member
    "inviteId": "<uuid>",   // when kind=invite
    "email": "...",         // when kind=email
    "firstName": "..."      // optional, kind=email
  },
  "currentOwnerAction": "boot" | "demote"
}
```

`currentOwnerAction` is applied at acceptance for `invite`/`email` kinds, and immediately for `member`.

**Auth:** `isAdminOrEditor`.

**Behavior change on `PATCH /api/hub/clients/:id/team/members/:memberId`:** as of this release, `role: 'owner'` returns 409 with `code: 'USE_TRANSFER_OWNERSHIP'`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/API_REFERENCE.md
git commit -m "docs(api): document PATCH invite + POST transfer-ownership endpoints"
```

---

## Task 14: End-to-end manual verification + push + PR

This task validates the whole feature against a real client account. Use a non-critical/test client. **Do not** test against a real production owner unless you're prepared to actually rotate them.

**Pre-condition:** local server running, logged in as superadmin in the dev UI, with a client account that has at least 2 team members (one owner + one admin).

- [ ] **Step 1: Build + lint clean**

```bash
yarn build 2>&1 | tail -5
yarn lint server/routes/hub.js server/routes/clientInvite.js server/services/activityLog.js src/api/clients.js src/views/admin/AdminHub/TeamTab.jsx 2>&1 | tail -10
```

Expected: build completes; lint shows no NEW errors introduced by these files (pre-existing warnings are fine — the file was already a soup of prettier nits before this work).

- [ ] **Step 2: Member-kind transfer E2E**

In the running UI:
1. Open a test client → Team tab.
2. Pick "Owner" from the role select on the admin row.
3. Confirm "Demote to admin" is the default; submit.
4. Verify: the admin row now says "Owner", the previous owner row says "Admin", a success toast fires.
5. Reload — same state persists.
6. Pick "Owner" on the now-Admin row again, this time choose "Remove from this account".
7. Verify: the displaced owner's row disappears (status='removed'); the new owner is there.

Restore by hand or use a fresh client — don't leave a real client without an owner.

- [ ] **Step 3: Invite-kind transfer E2E**

1. Send a regular `member`-role invite via the existing "Invite" button.
2. While that invite is pending, pick "Owner" from its role select.
3. Confirm: dialog opens, choose "Demote", submit.
4. Verify: the invite row shows the "Owner transfer (current owner demoted)" chip, role chip says "Owner", role select is hidden.
5. Open the invite link in a private window and accept it (set a password).
6. Back in the admin UI, reload Team tab. Verify: the new user appears as Owner, original owner is now Admin.

- [ ] **Step 4: Email-kind transfer E2E**

1. Click "Relinquish Ownership", enter a fresh email, choose "Boot", submit.
2. Verify: dialog flips to show the invite URL.
3. Open the URL, accept (set password) — should land in the dashboard as the new owner.
4. Back in admin, verify: original owner's row is gone (status='removed'); new owner's row is the only owner.

- [ ] **Step 5: 409 guard verification**

Try `PATCH /clients/:id/team/members/:memberId` with `role: 'owner'` via curl while authenticated:

```bash
curl -s -X PATCH http://localhost:4000/api/hub/clients/<real-client-uuid>/team/members/<real-member-uuid> \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" -d '{"role":"owner"}' -w "\nHTTP:%{http_code}\n"
```

Expected: `HTTP:409` with `code: 'USE_TRANSFER_OWNERSHIP'`.

- [ ] **Step 6: Push branch + open PR**

```bash
git push -u origin feat/ownership-transfer-impl
gh pr create --base main --head feat/ownership-transfer-impl \
  --title "feat: ownership transfer (member/invite/email)" \
  --body "$(cat <<'EOF'
## Summary

Implements the ownership-transfer spec from PR #30. Three target kinds (active member, pending invite, new email) with a boot-or-demote choice for the displaced owner.

- New `PATCH /api/hub/clients/:id/team/invite/:inviteId` for editing role/first_name on pending invites.
- New `POST /api/hub/clients/:id/team/transfer-ownership` for the orchestration.
- Existing `PATCH .../team/members/:memberId` now returns 409 `USE_TRANSFER_OWNERSHIP` for `role:'owner'`.
- Invite acceptance flow honors `metadata.pending_owner_transfer` and applies the boot/demote in the same transaction as the new-owner promotion.
- Team tab UI: editable role select on invites, "Relinquish Ownership" button, transfer dialog, pending-transfer chip.
- Five new ActivityEventTypes for the lifecycle.

No schema changes; no migrations.

## Test plan
- [x] yarn build / yarn lint clean
- [x] member-kind transfer (boot + demote)
- [x] invite-kind transfer (demote, accept, verify)
- [x] email-kind transfer (boot, accept, verify)
- [x] 409 guard on legacy PATCH members with role:owner

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Address any CodeRabbit/Codex feedback, then merge**

If automated review flags issues, fix on the same branch, push, wait for re-review, then merge.

```bash
gh pr merge --squash --delete-branch
```

---

## Self-review (already done — informational)

- **Spec coverage:** Every spec section has a task. PATCH invite (Task 3), PATCH members guard (Task 2), all three transfer kinds (Tasks 4-6), acceptance flow (Task 7), API client + UI (Tasks 8-12), docs (Task 13), verification (Task 14).
- **Placeholders:** none. Every code step shows the actual code.
- **Type/name consistency:** `transferClientOwnership` / `updateClientTeamInvite` are used identically in API client (Task 8) and UI (Tasks 9-11). `pending_owner_transfer` / `displaced_owner_user_id` / `on_accept_action` are written in Tasks 5-6 and read in Task 7.
- **One open ambiguity acknowledged in plan:** the lazy `import` of `activityLog.js` inside `clientInvite.js` (Task 7 step 2) is to keep the dependency local; the file already imports from `../db.js` so a top-level static import would work too — feel free to hoist it if you prefer.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-ownership-transfer.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for staying out of the way of the implementation while I keep eyes on the plan.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch with checkpoints for review.

Which approach?
