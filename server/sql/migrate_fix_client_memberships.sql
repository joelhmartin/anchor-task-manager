-- Fix client account membership issues
-- Problem: Team members invited to a client account get auto-created self-owner
-- membership rows (from the middleware fallback). The middleware query then picks
-- the self-owner row instead of the real team membership, so they see their own
-- empty account instead of the team owner's data.
--
-- Fix 1: Preserve self-owner rows. Multi-account users can legitimately own one
--         account while participating in others, so self-owner rows are no
--         longer treated as invalid by default.
-- Fix 2: Normalize users.role to 'client' for users who are members of a
--         client account but somehow got a non-client, non-staff role.

-- Step 1: Intentionally no-op. Account selection now supports users who belong
-- to multiple client accounts, including their own.
SELECT 1;

-- Step 2: Ensure any user who is a member of a client account (but not Anchor
-- staff) has users.role = 'client'.
UPDATE users
SET role = 'client', updated_at = NOW()
WHERE id IN (
  SELECT DISTINCT cam.member_user_id
  FROM client_account_members cam
  WHERE cam.status = 'active'
    AND cam.client_owner_id != cam.member_user_id
)
AND role NOT IN ('superadmin', 'admin', 'team')
AND role != 'client';

-- Step 3: Backfill self-owner membership rows for existing clients who don't
-- have one — but ONLY for actual account owners, not pure team members.
-- Team members get client_profiles rows during invite acceptance but should
-- never get self-owner rows (they appear as top-level accounts in admin list).
--
-- The gate requires a positive owner signal (brand_assets, a business name, or
-- already owning an active account) and MUST mirror init.sql's backfill and
-- ensureLegacyOwnerMembership(). Do NOT re-add an "OR not an active member
-- elsewhere" branch: it mints phantom self-owner rows for members removed from
-- all their accounts, recreated on every startup (the recurring "team member
-- shows up as its own client account" bug).
INSERT INTO client_account_members (client_owner_id, member_user_id, role, status, accepted_at)
SELECT u.id, u.id, 'owner', 'active', NOW()
FROM users u
JOIN client_profiles cp ON cp.user_id = u.id
WHERE u.role IN ('client', 'editor')
  AND u.id NOT IN (
    SELECT cam.member_user_id FROM client_account_members cam
    WHERE cam.client_owner_id = cam.member_user_id
  )
  AND (
    EXISTS (SELECT 1 FROM brand_assets ba WHERE ba.user_id = u.id)
    OR cp.client_identifier_value IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM client_account_members cam_owner
      WHERE cam_owner.client_owner_id = u.id
        AND cam_owner.status = 'active'
    )
  )
ON CONFLICT (client_owner_id, member_user_id) DO NOTHING;

-- Step 4: Clean up spurious self-owner rows created by previous versions of
-- Step 3. Delete self-owner rows for users who are purely team members
-- (no brand_assets, no client_identifier_value) but who were ever invited as a
-- non-owner member/admin of another account. We deliberately match memberships
-- of ANY status (active, removed, pending): a member removed from all their
-- real accounts is the exact case the loose Step-3 gate used to mis-promote.
DELETE FROM client_account_members
WHERE client_owner_id = member_user_id
  AND role = 'owner'
  AND member_user_id NOT IN (
    SELECT ba.user_id FROM brand_assets ba
  )
  AND member_user_id NOT IN (
    SELECT cp.user_id FROM client_profiles cp WHERE cp.client_identifier_value IS NOT NULL
  )
  AND member_user_id NOT IN (
    SELECT cam_owner.client_owner_id FROM client_account_members cam_owner
    WHERE cam_owner.status = 'active'
      AND cam_owner.client_owner_id != cam_owner.member_user_id
  )
  -- This historical cleanup deliberately differs from the runtime
  -- maybeRunTeamMemberCleanup() in server/index.js: it keys off
  -- client_owner_id != member_user_id (rather than role IN ('member','admin'))
  -- and does not inspect client_group_members. That's intentional — owner rows
  -- in client_account_members are the cleanup target here, and group-only
  -- memberships are out of scope for this one-shot account-membership migration.
  AND member_user_id IN (
    SELECT cam2.member_user_id FROM client_account_members cam2
    WHERE cam2.client_owner_id != cam2.member_user_id
  );
