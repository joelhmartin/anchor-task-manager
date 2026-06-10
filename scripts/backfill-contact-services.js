#!/usr/bin/env node
/*
 * Contacts Master List — Phase 2 backfill CLI.
 *
 * One-time, idempotent population of the contact_services append-only ledger from
 * existing client_services (source='active_client') and client_journeys.service_id
 * (source='journey'). Idempotent via NOT EXISTS guards — safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-contact-services.js [--dry-run]
 * Options:
 *   --dry-run   Count rows that WOULD be inserted; insert nothing.
 *
 * Reads DATABASE_URL from .env via the project's loadEnv path.
 *
 * ⚠️  PROD-GATED: in this repo .env points at the production database, and this backfill
 *     is gated on Phase 1's contact_services table being deployed to prod first. ALWAYS
 *     run with --dry-run and review counts before applying. Intended to run as a Cloud Run
 *     Job off the deployed image (native prod DB + creds) rather than from a laptop.
 */

import '../server/loadEnv.js';
import { runContactServicesBackfill } from '../server/services/contactServicesBackfill.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`[backfill-contact-services] start dryRun=${dryRun}`);
  const res = await runContactServicesBackfill({ dryRun });
  // No PHI — counts only.
  console.log(`[backfill-contact-services] ${dryRun ? 'DRY-RUN' : 'APPLIED'} active_client=${res.activeClient} journey=${res.journey}`);
  if (dryRun) console.log('[backfill-contact-services] DRY RUN — nothing was written.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Log stable metadata only — never err.message (can echo SQL params = PHI).
    console.error('[backfill-contact-services] FAILED', { code: err?.code || 'UNKNOWN' });
    process.exit(1);
  });
