import { query as poolQuery } from '../db.js';

/**
 * Append one ledger row per service to contact_services. Best-effort + never-throws —
 * propagation failures must not roll back the originating conversion/journey (Phase-2
 * backfill is the safety net). `services` is an array of { service_id, service_name? }.
 * Missing names are snapshotted from the services catalog at append time.
 * Returns the number of rows appended (0 on any failure / empty input).
 */
export async function appendContactServices({ contactId, ownerUserId, services = [], source, sourceRefId = null }, exec = poolQuery) {
  if (!contactId || !ownerUserId || !source || !Array.isArray(services) || !services.length) return 0;
  // Per-service isolation: a failed lookup/insert for one service logs and continues
  // rather than aborting the batch, so partial success is recorded and returned.
  let appended = 0;
  for (const s of services) {
    const serviceId = s?.service_id || null;
    if (!serviceId) continue;
    try {
      // Enforce tenant isolation: only record a service this owner actually owns. A
      // missing row means a cross-tenant / stale service_id — skip it rather than
      // stamping it onto this owner's ledger. (Catalog row is present at append time;
      // the service_name snapshot keeps history meaningful if it's later removed.)
      const r = await exec('SELECT name FROM services WHERE id = $1 AND user_id = $2', [serviceId, ownerUserId]);
      if (!r?.rows?.length) continue;
      const name = s?.service_name || r.rows[0].name || null;
      await exec(
        `INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source, source_ref_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [contactId, ownerUserId, serviceId, name, source, sourceRefId]
      );
      appended += 1;
    } catch (err) {
      console.error('[contactServices:append]', { code: err?.code });
    }
  }
  return appended;
}
