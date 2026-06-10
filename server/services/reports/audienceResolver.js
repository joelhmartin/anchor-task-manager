/**
 * audienceResolver.js — resolves an audience_filter descriptor into a concrete
 * list of client user UUIDs.
 *
 * Supported filter shapes:
 *   { mode: 'all' }
 *   { mode: 'package', client_package: 'Growth Essentials', include_inactive: false }
 *   { mode: 'manual', client_ids: ['uuid', ...] }
 *
 * `include_inactive: true` skips the demo/inactive filter (includes demo accounts).
 */

import { query } from '../../db.js';

export async function resolveAudience(audienceFilter) {
  const f = audienceFilter || { mode: 'all' };

  if (f.mode === 'manual') {
    const ids = Array.from(new Set(f.client_ids || []));
    if (!ids.length) return [];
    const { rows } = await query(
      `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role = 'client'`,
      [ids]
    );
    if (rows.length !== ids.length) {
      throw new Error('Manual audience contains non-client or unknown users');
    }
    return rows.map((r) => r.id);
  }

  const where = [`u.role = 'client'`];
  const params = [];

  if (!f.include_inactive) {
    where.push(`(NOT u.is_demo OR u.is_demo IS NULL)`);
  }

  if (f.mode === 'package') {
    params.push(f.client_package);
    where.push(`cp.client_package = $${params.length}`);
  }

  const { rows } = await query(
    `SELECT u.id
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
      WHERE ${where.join(' AND ')}`,
    params
  );

  return rows.map((r) => r.id);
}
