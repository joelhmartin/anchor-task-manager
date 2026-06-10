// One-off, idempotent backfill: encrypt any WordPress oauth_connections.access_token
// rows still stored as plaintext base64 (pre-dating the encrypt-at-rest fix in
// server/routes/hub/wordpress.js). New connects already encrypt on write; this
// heals existing rows. Safe to re-run — rows already encrypted are skipped.
//
// Run post-deploy against the target DB (e.g. via cloud-sql-proxy with the prod
// DATABASE_URL), like the other scripts/backfill-*.mjs jobs:
//   node scripts/backfill-wordpress-token-encryption.mjs
import { query } from '../server/db.js';
import { encrypt, isEncrypted } from '../server/services/security/index.js';

async function main() {
  // Scope strictly to the self-hosted Application-Password rows created by the
  // /hub/wordpress/connect route (token_type = 'Basic') — those are the only
  // rows the encrypt-on-write / decrypt-on-read path in routes/hub/wordpress.js
  // handles. WordPress.com OAuth rows are ALSO provider='wordpress' but are
  // Bearer tokens read raw (no decrypt) by routes/hub/oauth.js's wordpress-sites
  // handler; encrypting those would make it send ciphertext and break.
  const { rows } = await query(
    `SELECT id, access_token FROM oauth_connections
     WHERE provider = 'wordpress' AND token_type = 'Basic' AND access_token IS NOT NULL`
  );

  let encrypted = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    if (isEncrypted(row.access_token)) {
      skipped += 1;
      continue;
    }
    const ciphertext = encrypt(row.access_token);
    // encrypt() returns null when encryption is unavailable (no ENCRYPTION_KEY)
    // or fails. NEVER write that — it would permanently clear the credential.
    if (!ciphertext) {
      failed += 1;
      console.error(`[backfill-wp-token-encryption] encryption FAILED for connection ${row.id} — leaving row untouched`);
      continue;
    }
    await query('UPDATE oauth_connections SET access_token = $1 WHERE id = $2', [ciphertext, row.id]);
    encrypted += 1;
  }

  console.error(
    `[backfill-wp-token-encryption] total=${rows.length} encrypted=${encrypted} already-encrypted=${skipped} failed=${failed}`
  );

  // If any row could not be encrypted, exit non-zero so the operator notices
  // (likely a missing ENCRYPTION_KEY in the run environment).
  if (failed > 0) {
    throw new Error(`${failed} row(s) could not be encrypted — encryption unavailable in this environment`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-wp-token-encryption] FAILED', err);
    process.exit(1);
  });
