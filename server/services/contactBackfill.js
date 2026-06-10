// Contact Entity — Phase 2 backfill.
//
// Replays historical lead rows (call_logs, active_clients, client_journeys) through
// the SAME resolveContact() chokepoint used by live ingest, then stamps the resulting
// contact_id back onto each row. Reusing resolveContact means the backfill clusters,
// dedups, links multi-identifier people, and enqueues conflicts EXACTLY like forward
// ingest — one source of truth, no parallel clustering logic to drift.
//
// Idempotent: only rows WHERE contact_id IS NULL are processed, and resolveContact()
// itself is idempotent, so re-running is safe and simply drains the next batch.
//
// Ordering: per owner we process the richest source first (active_clients → journeys →
// call_logs), most-recent first, so display_name / primary_* get seeded from the best
// available source (resolveContact only fills display_name when empty and never moves a
// primary backwards).
//
// This is the LOGIC module — it takes a query executor so it can be unit-run against a
// local pool. The CLI wrapper (scripts/backfill-contacts.js) wires the real pool; that
// is the prod-gated entry point.

import { query as poolQuery } from '../db.js';
import { resolveContact, setContactsSchemaReady } from './contacts.js';

const SOURCES = [
  {
    table: 'active_clients',
    select: `SELECT id, client_phone AS phone, client_email AS email, client_name AS name
             FROM active_clients
             WHERE owner_user_id = $1 AND contact_id IS NULL
             ORDER BY created_at DESC NULLS LAST
             LIMIT $2`
  },
  {
    table: 'client_journeys',
    select: `SELECT id, client_phone AS phone, client_email AS email, client_name AS name
             FROM client_journeys
             WHERE owner_user_id = $1 AND contact_id IS NULL
             ORDER BY created_at DESC NULLS LAST
             LIMIT $2`
  },
  {
    table: 'call_logs',
    select: `SELECT id, from_number AS phone,
                    meta->>'caller_email' AS email,
                    meta->>'caller_name'  AS name
             FROM call_logs
             WHERE owner_user_id = $1 AND contact_id IS NULL
             ORDER BY started_at DESC NULLS LAST
             LIMIT $2`
  }
];

/**
 * Backfill contacts for one owner or all owners.
 *
 * @param {object} opts
 * @param {(t:string,p:any[])=>Promise<{rows:any[]}>} [opts.exec] query executor (pool by default)
 * @param {string|null} [opts.ownerUserId] restrict to one owner
 * @param {number} [opts.perTableLimit] max rows per (owner, table) per run (default 5000)
 * @param {boolean} [opts.dryRun] count eligible rows only; create/stamp nothing
 * @param {(msg:string)=>void} [opts.log]
 * @returns {Promise<{owners:number, processed:number, stamped:number, skipped:number, eligible:object}>}
 */
export async function backfillContacts({
  exec = poolQuery,
  ownerUserId = null,
  perTableLimit = 5000,
  dryRun = false,
  log = () => {}
} = {}) {
  const stats = { owners: 0, processed: 0, stamped: 0, skipped: 0, eligible: {} };

  const owners = ownerUserId
    ? [ownerUserId]
    : (
        await exec(
          `SELECT DISTINCT owner_user_id FROM (
             SELECT owner_user_id FROM call_logs WHERE contact_id IS NULL
             UNION SELECT owner_user_id FROM active_clients WHERE contact_id IS NULL
             UNION SELECT owner_user_id FROM client_journeys WHERE contact_id IS NULL
           ) u WHERE owner_user_id IS NOT NULL`
        )
      ).rows.map((r) => r.owner_user_id);

  for (const owner of owners) {
    stats.owners += 1;
    for (const src of SOURCES) {
      const { rows } = await exec(src.select, [owner, perTableLimit]);
      stats.eligible[src.table] = (stats.eligible[src.table] || 0) + rows.length;
      for (const row of rows) {
        if (!row.phone && !row.email) {
          stats.skipped += 1;
          continue;
        }
        stats.processed += 1;
        if (dryRun) continue;
        // Pass `exec` so resolveContact runs on the SAME connection/pool as the backfill
        // (critical: without it, resolveContact would fall back to its default pool).
        const contactId = await resolveContact(
          // reactivateArchived stays false: the backfill replays HISTORICAL rows, so it must
          // never un-archive a contact the user intentionally archived.
          { ownerUserId: owner, phone: row.phone, email: row.email, name: row.name, reactivateArchived: false },
          exec
        );
        if (contactId) {
          // src.table is from the fixed SOURCES list — not user input. Keep the NULL
          // predicate so a concurrent ingest/worker that already stamped this row isn't
          // clobbered (TOCTOU), and only count rows we actually changed.
          const upd = await exec(
            `UPDATE ${src.table} SET contact_id = $1 WHERE id = $2 AND contact_id IS NULL`,
            [contactId, row.id]
          );
          if (upd.rowCount > 0) stats.stamped += 1;
        }
      }
      log(`[backfill] owner=${owner} ${src.table}: eligible=${rows.length}`);
    }
  }
  return stats;
}

// Convenience for the CLI: the schema necessarily exists when backfilling, so flip the
// readiness flag up-front (skips resolveContact's probe round-trip).
export function markSchemaReadyForBackfill() {
  setContactsSchemaReady(true);
}
