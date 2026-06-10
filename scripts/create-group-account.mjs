import pg from 'pg';
import argon2 from 'argon2';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://bif@localhost:5432/anchor' });

const EMAIL = 'group-owner@local.test';
const PASSWORD = 'TestPass123!';

async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clean previous if exists
    const existing = await client.query('SELECT id FROM users WHERE email=$1', [EMAIL]);
    if (existing.rows.length) {
      console.log(`Removing existing test user ${EMAIL}…`);
      await client.query('DELETE FROM users WHERE email=$1', [EMAIL]);
    }
    await client.query(`DELETE FROM client_groups WHERE name='Local Test Group'`);

    // 1) Create user (client role)
    const passwordHash = await hashPassword(PASSWORD);
    const userRes = await client.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, email_verified_at, password_changed_at)
       VALUES ('Group', 'Owner', $1, $2, 'client', NOW(), NOW())
       RETURNING id`,
      [EMAIL, passwordHash]
    );
    const userId = userRes.rows[0].id;
    console.log('User:', userId);

    // 2) Create group
    const groupRes = await client.query(
      `INSERT INTO client_groups (name, description, color)
       VALUES ('Local Test Group', 'Local dev — repro for group-owner regression', '#1976d2')
       RETURNING id`
    );
    const groupId = groupRes.rows[0].id;
    console.log('Group:', groupId);

    // 3) Brand assets (required for the legacy backfill inner check)
    await client.query(
      `INSERT INTO brand_assets (user_id, business_name)
       VALUES ($1, 'Local Test Business')
       ON CONFLICT (user_id) DO UPDATE SET business_name=EXCLUDED.business_name`,
      [userId]
    );

    // 4) client_profiles row tied to the group
    await client.query(
      `INSERT INTO client_profiles (user_id, client_group_id, client_identifier_value, client_type)
       VALUES ($1, $2, 'local-test', 'medical')
       ON CONFLICT (user_id) DO UPDATE SET client_group_id=EXCLUDED.client_group_id`,
      [userId, groupId]
    );

    // 5) Membership in the group as 'admin' so the user has BOTH a direct ownership stake
    //    AND a group membership — exactly the case that broke after commit 728fb55.
    await client.query(
      `INSERT INTO client_group_members (client_group_id, member_user_id, role, status, accepted_at)
       VALUES ($1, $2, 'admin', 'active', NOW())
       ON CONFLICT (client_group_id, member_user_id) DO NOTHING`,
      [groupId, userId]
    );

    // 6) DELIBERATELY do NOT insert client_account_members self-owner row.
    //    The fix should backfill it on first listClientAccountsForUser call.

    await client.query('COMMIT');
    console.log('\n=== Login details ===');
    console.log(`Email:    ${EMAIL}`);
    console.log(`Password: ${PASSWORD}`);
    console.log(`URL:      http://localhost:3000`);
    console.log(`\nGroup account: 'Local Test Business' (in group 'Local Test Group').`);
    console.log(`Self-owner client_account_members row intentionally OMITTED so the backfill fix is exercised.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
