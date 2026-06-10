import { hashPassword } from '../server/services/security/passwordPolicy.js';
import { query } from '../server/db.js';

const GROUP_NAME = 'Local Test Group';
const PASSWORD = 'TestPass123!';

const accounts = [
  { email: 'acme-dental@local.test', first: 'Acme', last: 'Dental', business: 'Acme Dental', identifier: 'acme-dental', type: 'medical' },
  { email: 'beta-orthodontics@local.test', first: 'Beta', last: 'Ortho', business: 'Beta Orthodontics', identifier: 'beta-ortho', type: 'medical' },
  { email: 'cedar-clinic@local.test', first: 'Cedar', last: 'Clinic', business: 'Cedar Clinic', identifier: 'cedar-clinic', type: 'medical' }
];

const groupRow = await query(`SELECT id FROM client_groups WHERE name=$1`, [GROUP_NAME]);
if (!groupRow.rows.length) {
  console.error(`Group "${GROUP_NAME}" not found. Run scripts/create-group-account.mjs first.`);
  process.exit(1);
}
const groupId = groupRow.rows[0].id;
console.log('Group:', groupId);

// Find the group admin (existing group-owner@local.test) so we can also add them
// as a direct admin member of every new account, so they show up in their Active Clients list.
const adminRow = await query(`SELECT id FROM users WHERE email='group-owner@local.test'`);
const adminId = adminRow.rows[0]?.id;

const hash = await hashPassword(PASSWORD);

for (const a of accounts) {
  await query(`DELETE FROM users WHERE email=$1`, [a.email]);
  const userRes = await query(
    `INSERT INTO users (first_name, last_name, email, password_hash, role, email_verified_at, password_changed_at)
     VALUES ($1, $2, $3, $4, 'client', NOW(), NOW())
     RETURNING id`,
    [a.first, a.last, a.email, hash]
  );
  const userId = userRes.rows[0].id;

  await query(
    `INSERT INTO brand_assets (user_id, business_name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET business_name=EXCLUDED.business_name`,
    [userId, a.business]
  );

  await query(
    `INSERT INTO client_profiles (user_id, client_group_id, client_identifier_value, client_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET client_group_id=EXCLUDED.client_group_id, client_identifier_value=EXCLUDED.client_identifier_value`,
    [userId, groupId, a.identifier, a.type]
  );

  // Self-owner row so they can log in directly too.
  await query(
    `INSERT INTO client_account_members (client_owner_id, member_user_id, role, status, accepted_at)
     VALUES ($1, $1, 'owner', 'active', NOW())
     ON CONFLICT (client_owner_id, member_user_id) DO NOTHING`,
    [userId]
  );

  console.log(`Created ${a.email} (${userId}) → ${a.business}`);
}

console.log('\n=== All accounts in "Local Test Group" ===');
console.log(`Group admin (sees all of these via group access):`);
console.log(`  group-owner@local.test / ${PASSWORD}`);
console.log(`Member accounts (each can also log in as themselves):`);
for (const a of accounts) console.log(`  ${a.email} / ${PASSWORD}  (${a.business})`);

process.exit(0);
