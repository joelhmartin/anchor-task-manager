#!/usr/bin/env node
/*
 * Contact Entity — Phase 2 backfill CLI.
 *
 * Groups historical call_logs / active_clients / client_journeys rows into contacts and
 * stamps contact_id back onto them, by replaying each row through the live
 * resolveContact() chokepoint (so the backfill clusters/dedups identically to ingest).
 * Idempotent — only rows with contact_id IS NULL are touched; safe to re-run to drain.
 *
 * Usage:
 *   node scripts/backfill-contacts.js [options]
 * Options:
 *   --owner <userId>   Restrict to a single owner_user_id
 *   --limit <N>        Max rows per (owner, table) per run (default 5000)
 *   --dry-run          Count eligible rows; create/stamp nothing
 *
 * Reads DATABASE_URL from .env via the project's loadEnv path.
 *
 * ⚠️  PROD-GATED: in this repo .env points at the production database. ALWAYS run with
 *     --dry-run first and review the counts. Intended to run as a Cloud Run Job off the
 *     deployed image (native prod DB + creds) rather than from a laptop.
 */

import '../server/loadEnv.js';
import { backfillContacts, markSchemaReadyForBackfill } from '../server/services/contactBackfill.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const ownerUserId = getArg('owner', null);
const perTableLimit = parseInt(getArg('limit', '5000'), 10);
if (!Number.isInteger(perTableLimit) || perTableLimit <= 0) {
  console.error(`[backfill-contacts] invalid --limit "${getArg('limit', '5000')}" — must be a positive integer`);
  process.exit(1);
}
const dryRun = hasFlag('dry-run');

async function main() {
  markSchemaReadyForBackfill();
  console.log(`[backfill-contacts] start dryRun=${dryRun} owner=${ownerUserId || 'ALL'} limit=${perTableLimit}`);
  const stats = await backfillContacts({
    ownerUserId,
    perTableLimit,
    dryRun,
    log: (m) => console.log(m)
  });
  console.log('[backfill-contacts] done:', JSON.stringify(stats, null, 2));
  if (dryRun) console.log('[backfill-contacts] DRY RUN — nothing was written.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Log stable metadata only — never err.message (can echo SQL params = PHI).
    console.error('[backfill-contacts] FAILED', { code: err?.code || 'UNKNOWN' });
    process.exit(1);
  });
