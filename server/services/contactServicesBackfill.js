// Contacts Master List — Phase 2 backfill.
//
// One-time, idempotent population of the contact_services append-only ledger from
// existing data:
//   - client_services  (via active_clients.contact_id)        → source='active_client'
//   - client_journeys.service_id (via client_journeys.contact_id) → source='journey'
//
// Idempotency comes from the NOT EXISTS guards keyed on
// (contact_id, service_id, source, source_ref_id) — contact_services has no unique
// constraint (it's an append log), so re-runs must self-guard. Snapshots service_name
// from the CURRENT catalog, which is acceptable for a one-time historical backfill.
//
// LOGIC module: takes a query executor so it can run against a local pool in tests; the
// CLI wrapper (scripts/backfill-contact-services.js) wires the real pool and is the
// prod-gated entry point.

import { query as poolQuery } from '../db.js';

// Shared FROM/WHERE bodies so the INSERT and the dry-run COUNT stay in lockstep.
const ACTIVE_CLIENT_BODY = `
  FROM client_services cs
  JOIN active_clients ac ON ac.id = cs.active_client_id
  LEFT JOIN services s ON s.id = cs.service_id
 WHERE ac.contact_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM contact_services x
      WHERE x.contact_id = ac.contact_id AND x.service_id = cs.service_id
        AND x.source = 'active_client' AND x.source_ref_id = ac.id
   )`;

const JOURNEY_BODY = `
  FROM client_journeys cj
  LEFT JOIN services s ON s.id = cj.service_id
 WHERE cj.contact_id IS NOT NULL AND cj.service_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM contact_services x
      WHERE x.contact_id = cj.contact_id AND x.service_id = cj.service_id
        AND x.source = 'journey' AND x.source_ref_id = cj.id
   )`;

const ACTIVE_CLIENT_INSERT = `
  INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source, source_ref_id)
  SELECT ac.contact_id, ac.owner_user_id, cs.service_id, s.name, 'active_client', ac.id
  ${ACTIVE_CLIENT_BODY}`;

const JOURNEY_INSERT = `
  INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source, source_ref_id)
  SELECT cj.contact_id, cj.owner_user_id, cj.service_id, s.name, 'journey', cj.id
  ${JOURNEY_BODY}`;

const ACTIVE_CLIENT_COUNT = `SELECT count(*) AS n ${ACTIVE_CLIENT_BODY}`;
const JOURNEY_COUNT = `SELECT count(*) AS n ${JOURNEY_BODY}`;

/**
 * Backfill the contact_services ledger from existing client_services + client_journeys.
 *
 * @param {object} opts
 * @param {(t:string,p?:any[])=>Promise<{rows:any[],rowCount:number}>} [opts.exec] query executor (pool by default)
 * @param {boolean} [opts.dryRun] count rows that WOULD be inserted; insert nothing
 * @returns {Promise<{dryRun:boolean, activeClient:number, journey:number}>}
 */
export async function runContactServicesBackfill({ exec = poolQuery, dryRun = false } = {}) {
  if (dryRun) {
    const [a, j] = await Promise.all([exec(ACTIVE_CLIENT_COUNT), exec(JOURNEY_COUNT)]);
    return { dryRun: true, activeClient: Number(a.rows[0]?.n || 0), journey: Number(j.rows[0]?.n || 0) };
  }
  const a = await exec(ACTIVE_CLIENT_INSERT);
  const j = await exec(JOURNEY_INSERT);
  return { dryRun: false, activeClient: a.rowCount, journey: j.rowCount };
}
