# Ownership Transfer for Client Accounts — Design

**Date:** 2026-05-07
**Status:** Approved (pending spec review)
**Scope:** Single-account ownership transfer. Multi-account ownership (one human owns multiple clients) is explicitly out of scope.

## Problem

Today a client account has exactly one owner, and that owner IS the user record that defines the client's identity (`client_profiles.user_id`). There's no way to:

- Promote an existing team member to owner
- Promote a pending invitation to owner
- Relinquish ownership to a brand-new email
- Edit the role on a pending invitation in the team tab

The agency needs all of these. The schema already supports the underlying concept — `client_account_members` has a `role` column with values `'owner' | 'admin' | 'member'`, and ownership semantics can be entirely encoded there. We just don't expose the operations.

## Non-goals

- Multi-account ownership (one human as owner of multiple distinct clients). The `users.email` UNIQUE constraint still binds. Tracked separately.
- Client-side self-relinquish (the owning client can't initiate a transfer themselves). Agency staff only in v1.
- Editing the email on a sent invitation. Email is locked once an invite is dispatched; if you need a different email you revoke the invite and send a new one.

## Data model

No new tables, no FK reshuffles. The `client_owner_id` foreign key (the user_id that defines the client identity) **never changes**. Ownership is entirely a function of `client_account_members.role`.

One additive convention: when an invite is dispatched as part of a transfer flow, we stamp its `metadata` jsonb:

```json
{
  "pending_owner_transfer": true,
  "displaced_owner_user_id": "<uuid of current owner>",
  "on_accept_action": "boot" | "demote",
  "queued_at": "2026-05-07T12:34:56Z",
  "queued_by_user_id": "<uuid of admin who queued>"
}
```

Existing invite metadata fields (`self_invite`, `existing_client`, `regenerated`, etc.) are unaffected. The acceptance handler reads `pending_owner_transfer` and acts on it after creating the new member.

### "Ghost user" rationale

The first user created with a client account is the `client_owner_id`. If that user is later booted from the team, their `users.id` row is still the canonical client identity but no human accesses anything via it. That's intentional and harmless because:

- Auth/login goes through `users.id` for the human, then resolves accessible clients via `client_account_members` (and `client_groups`). The ghost is never authenticated against.
- Data FKs (`call_logs.owner_user_id`, `client_profiles.user_id`, etc.) reference the stable id; they don't care whether a human is associated.
- The ghost can later be "rehydrated" if the same account ID is needed for some new owner — though the typical path is: keep the ghost, give the new owner their own `users` row.

## Endpoints

### NEW `PATCH /api/hub/clients/:id/team/invite/:inviteId`

Edit an in-flight invite's role or first name. Email is immutable.

**Request:**
```json
{ "role": "admin" | "member" | "owner", "first_name": "..." }
```

**Behavior:**
- If `role: 'owner'` → returns 409 with `code: 'USE_TRANSFER_OWNERSHIP'`. Client must call the transfer-ownership endpoint.
- Otherwise updates `invite_role` and/or `invite_first_name` on the matching `client_user_invite_tokens` row. Token, hash, expiration, and email are unchanged.
- Permission: `isAdminOrEditor`.

**Response:** updated invite snapshot.

### NEW `POST /api/hub/clients/:id/team/transfer-ownership`

Single endpoint orchestrating all three transfer flavors.

**Request:**
```jsonc
{
  "target": {
    "kind": "member" | "invite" | "email",
    // exactly one of:
    "memberId": "<client_account_members.id>",        // when kind='member'
    "inviteId": "<client_user_invite_tokens.id>",     // when kind='invite'
    "email": "newowner@example.com",                  // when kind='email'
    "firstName": "Jane"                               // optional, only with kind='email'
  },
  "currentOwnerAction": "boot" | "demote"
}
```

**Behavior:**

#### `kind: 'member'` (immediate transfer)
1. Validate target is an `active` member of this client and is not already the owner.
2. In a transaction:
   - Set target's row `role='owner'` (status stays `active`).
   - Apply `currentOwnerAction` to the displaced owner's row:
     - `boot` → `status='removed'`, `role` unchanged (audit only).
     - `demote` → `role='admin'`, `status='active'`.
3. Log `OWNERSHIP_TRANSFERRED` activity event.
4. Return updated team snapshot.

#### `kind: 'invite'` (queued transfer; applies on acceptance)
1. Validate the invite is unconsumed, unrevoked, unexpired, and belongs to this client.
2. In a transaction:
   - Update the invite: `invite_role='owner'` (if not already), and merge metadata with the `pending_owner_transfer` block.
   - Do NOT touch any membership row yet. Current owner keeps full ownership.
3. Log `OWNERSHIP_TRANSFER_QUEUED` activity event.
4. Return invite snapshot.

#### `kind: 'email'` (new invite + queued transfer)
1. Validate the email is not already an active member or pending invitee on this client (409 if it is — caller should use `kind:'member'` or `kind:'invite'` instead).
2. Validate the email is not the displaced owner's own email (would be a no-op).
3. In a transaction:
   - Create a new `client_user_invite_tokens` row with `invite_role='owner'`, `invite_email`, optional `invite_first_name`, hash + value, expiration via `INVITE_NEVER_EXPIRES_AT`, and metadata containing the `pending_owner_transfer` block.
   - Send the invitation email (existing mailgun helper).
4. Log `OWNERSHIP_TRANSFER_QUEUED` activity event.
5. Return `{ invite, inviteUrl }`.

**Permission:** `isAdminOrEditor`. (Owner-self relinquish is mediated through the same endpoint when a future client-side UI ships; for v1 agency staff drives it.)

**Errors:**
- 400 if `target` is malformed, both kind+id mismatch, or `currentOwnerAction` not in {boot, demote}.
- 404 if member/invite/client not found.
- 409 if target is the current owner (no-op), or email already exists on the team.

### CHANGED behavior on existing endpoints

#### `PATCH /api/hub/clients/:id/team/members/:memberId`
- Adds same 409 guard: rejects `role: 'owner'` with `code: 'USE_TRANSFER_OWNERSHIP'`. All other roles edit normally.

#### `DELETE /api/hub/clients/:id/team/invite/:inviteId`
- Unchanged behavior. If the invite carried a `pending_owner_transfer` block, the queued transfer is implicitly canceled (no separate action needed; metadata becomes moot once the token is revoked).

## Acceptance flow change

The invite-acceptance handler currently in `server/routes/clientInvite.js` does roughly:
1. Look up token, validate.
2. Either create a new user (if no existing account for this email) or attach to existing user.
3. Insert/update `client_account_members` row with the invite's role and `status='active'`.
4. Mark invite consumed.

We add one step **after** step 3, before marking consumed:

```
if (invite.metadata.pending_owner_transfer) {
  const { displaced_owner_user_id, on_accept_action } = invite.metadata;
  if (on_accept_action === 'boot') {
    await query(`UPDATE client_account_members
                 SET status='removed', updated_at=NOW()
                 WHERE client_owner_id=$1 AND member_user_id=$2`,
                [invite.client_owner_id, displaced_owner_user_id]);
  } else if (on_accept_action === 'demote') {
    await query(`UPDATE client_account_members
                 SET role='admin', status='active', updated_at=NOW()
                 WHERE client_owner_id=$1 AND member_user_id=$2`,
                [invite.client_owner_id, displaced_owner_user_id]);
  }
  // Audit log: OWNERSHIP_TRANSFER_COMPLETED
}
```

Both the new owner row and the displaced owner row are mutated in the same transaction as the membership creation, so partial state is impossible.

If by the time the invite is accepted the displaced owner has already been removed by some other action (admin manually edited memberships in between), the UPDATE simply hits 0 rows and we log a `OWNERSHIP_TRANSFER_COMPLETED_DISPLACED_GONE` warning to the audit trail. The new owner still becomes owner.

## UX (team tab)

The team tab already shows active members + pending invites in a unified list. Changes:

1. **Per-row role selector.** Active members have an editable role select today (calls existing PATCH). Add same control to pending-invite rows; calls the new invite-PATCH. Email column on invite rows is rendered as plain text with a small "locked" hint.

2. **Setting role to 'owner' triggers a dialog.** When the user changes any row's role to 'owner' in the dropdown, intercept the change locally and open a `TransferOwnershipDialog` showing:
   - "Transfer ownership to [Jane Doe]?"
   - Radio: ○ Demote current owner to admin (recommended) ○ Remove current owner from this account
   - Cancel | Transfer
   On confirm, calls `POST /transfer-ownership` with the right `kind`. On cancel, the role select snaps back to the previous value.

3. **Top-level "Relinquish Ownership" button.** Visible to agency staff (not yet to client owners). Opens `RelinquishOwnershipDialog`:
   - Email input (required)
   - Optional first name
   - Radio: demote vs remove current owner
   - Cancel | Send invite
   On confirm, calls `POST /transfer-ownership` with `kind:'email'`. Returns invite URL on success and shows a copy/share dialog.

4. **Pending-transfer badge.** When a pending invite has `metadata.pending_owner_transfer`, show a chip on its row: "Pending owner transfer — current owner will be [removed | demoted to admin] when accepted." Cancel = revoke invite (existing DELETE button).

## Activity log events

New `ActivityEventTypes`:
- `OWNERSHIP_TRANSFERRED` — immediate transfer to active member.
- `OWNERSHIP_TRANSFER_QUEUED` — invite-based or email-based transfer initiated.
- `OWNERSHIP_TRANSFER_COMPLETED` — queued transfer applied at invite acceptance.
- `OWNERSHIP_TRANSFER_COMPLETED_DISPLACED_GONE` — queued transfer applied but the displaced owner was already gone.
- `OWNERSHIP_TRANSFER_CANCELED` — implicit when the underlying invite is revoked while still pending.

Each event records `{ displaced_owner_user_id, new_owner_user_id_or_invite_id, on_accept_action }` in details.

## Edge cases & invariants

- **Invariant:** at most one membership row with `role='owner'` and `status='active'` per `client_owner_id`. Guarded by the transfer endpoint never setting two owners simultaneously, and acceptance handler always demoting/removing the displaced owner in the same tx as the new-owner promotion.
- **Transfer to current owner:** 409 no-op.
- **Transfer when there is no current owner** (e.g. the previous owner was already booted manually): allowed. New owner is promoted; the boot/demote branch hits 0 rows but we still log success.
- **Multiple queued transfers in flight:** if two `pending_owner_transfer` invites exist simultaneously and both get accepted, the first acceptance demotes/removes the original owner; the second acceptance demotes/removes whoever is currently `role='owner'` — which may now be the first acceptee. This is the user's responsibility to manage; we don't try to be cleverer than that. Auditable via the queued/completed events.
- **Boot then re-add:** if a booted user is later re-invited to the same client, that's just a new invite + new membership row; current `UNIQUE (client_owner_id, member_user_id)` constraint means we update the existing row's status back to `pending`/`active` rather than creating a duplicate. Existing invite/acceptance code handles this.
- **Permission to be a transfer target:** any user is eligible. The new owner doesn't need to have any pre-existing global role — invite acceptance creates a `users` row with `role='client'` if none exists.

## Files touched

- `server/routes/hub.js` — add `PATCH /clients/:id/team/invite/:inviteId` + `POST /clients/:id/team/transfer-ownership`; tighten existing `PATCH /clients/:id/team/members/:memberId` to reject `role:'owner'`.
- `server/routes/clientInvite.js` — extend the acceptance handler to honor `pending_owner_transfer` metadata.
- `server/services/activityLog.js` — add the five new entries to `ActivityEventTypes`.
- `src/views/admin/AdminHub/TeamTab.jsx` — add `TransferOwnershipDialog` and `RelinquishOwnershipDialog` (new sibling files); wire role-select interception, "Relinquish ownership" button, and pending-transfer chip on invite rows.
- `src/api/clientTeam.js` — add `patchInviteRole(clientId, inviteId, body)` and `transferOwnership(clientId, body)` methods.
- `docs/API_REFERENCE.md` — document the two new endpoints and the new 409 guard on `PATCH /team/members/:memberId`.

No migrations required.

## Test plan (manual; no automated tests in this repo)

For each of the three target kinds:

1. **Member kind:** Create a client. Add an active admin via existing invite flow. Use new endpoint to transfer ownership to that admin with `boot`. Verify in DB: original owner's row `status='removed'`, target's row `role='owner', status='active'`. Repeat with `demote`: verify original is `role='admin', status='active'`.

2. **Invite kind:** Same setup, send a pending invite for `role='admin'`. Use new endpoint to transfer ownership to that invite. Verify the invite row now has `invite_role='owner'` and `metadata.pending_owner_transfer`. Original owner unchanged. Accept the invite using its URL. Verify the new user is created, gets `role='owner'`, and the original owner is booted/demoted per the queued action.

3. **Email kind:** Issue transfer to brand-new email. Verify a new invite is created with the right metadata and email is sent (or the URL is returned). Accept it. Verify same outcome as above.

4. **Edit-role guards:** Try `PATCH members` with `role:'owner'` — expect 409. Try `PATCH invite` with `role:'owner'` — expect 409. Try transfer to current owner — expect 409.

5. **Cancel pending transfer:** Queue an `email`-kind transfer. Revoke the invite via existing DELETE. Verify the original owner is unchanged and the invite is consumed/revoked.

6. **No-current-owner edge:** Manually set the current owner's `status='removed'`. Then transfer to a member with `boot`. Expect success (the displaced-owner UPDATE is a no-op but the new owner is promoted).

## Rollout

Behind no flag. Server endpoints are additive (the changed-behavior PATCH members guard is a hardening; if any client UI is currently sending `role:'owner'` through that endpoint, it will start getting a 409 with a clear code — that's actually desirable, surfaces a hidden contract violation). UI changes ship together with server changes.

Deploy via existing `gdeploy.sh` after merging to main.
