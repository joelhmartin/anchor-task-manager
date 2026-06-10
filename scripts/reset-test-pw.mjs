import { hashPassword } from '../server/services/security/passwordPolicy.js';
import { query } from '../server/db.js';

const EMAIL = 'group-owner@local.test';
const PASSWORD = 'TestPass123!';

const hash = await hashPassword(PASSWORD);
const r = await query(
  `UPDATE users SET password_hash=$1, password_changed_at=NOW(), failed_login_count=0, locked_until=NULL WHERE email=$2 RETURNING id`,
  [hash, EMAIL]
);
console.log('updated:', r.rowCount, 'id:', r.rows[0]?.id);
process.exit(0);
