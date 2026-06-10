/**
 * Demo Account Seed Runner
 *
 * Seeds a fully-populated demo client account on startup if it doesn't exist.
 * The demo account has NO external service credentials, so all external API
 * calls (CTM, Monday.com, Mailgun, etc.) naturally short-circuit via existing
 * credential checks. No per-action "is_demo" guards needed.
 *
 * Password: DemoAccount2024!
 * Email: demo@anchorcorps.com
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, getClient } from '../db.js';
import { hashPassword } from './security/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_USER_ID = '00000000-0000-4000-a000-000000000001';
const DEMO_PASSWORD = 'DemoAccount2024!';

export async function maybeSeedDemoAccount() {
  try {
    // The SQL is fully idempotent (ON CONFLICT DO UPDATE everywhere, plus
    // DELETE-then-INSERT for tables without unique constraints). Re-running on
    // every boot keeps the demo data fresh (timestamps, enrichment, new
    // sections) without requiring a teardown step.
    const { rows } = await query(
      'SELECT id FROM users WHERE id = $1 LIMIT 1',
      [DEMO_USER_ID]
    );
    const isUpdate = rows.length > 0;

    console.log(`[demo-seed] ${isUpdate ? 'Refreshing' : 'Seeding'} demo account...`);

    // Hash the demo password
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    // Read seed SQL and substitute the password hash placeholder.
    // We use string replacement instead of session variables (set_config)
    // because pool.query() doesn't guarantee the same connection, and
    // set_config is session-scoped.
    const seedPath = path.join(__dirname, '..', 'sql', 'seed_demo.sql');
    let seedSql = fs.readFileSync(seedPath, 'utf8');
    seedSql = seedSql.replace(/__DEMO_PASSWORD_HASH__/g, passwordHash.replace(/'/g, "''"));

    // Run the entire seed on a single dedicated connection inside a transaction
    // so all statements share the same session and partial failures roll back.
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(seedSql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log(`[demo-seed] Demo account ${isUpdate ? 'refreshed' : 'seeded'}`);
  } catch (err) {
    console.error('[demo-seed] Failed to seed demo account:', err.message);
    // Non-fatal — don't crash the server
  }
}
