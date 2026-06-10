// One-time, idempotent backfill: archive contacts whose journeys are all DEAD
// (archived/lost) and which have nothing else keeping them live. Heals the
// existing backlog created before the live cascade shipped, where a contact
// could keep showing on the Contacts board as LIVE while its only journey was
// already dead (staff re-contacting finished people).
//
// This mirrors the live cascade exactly — see
//   server/routes/hub/journeys.js → maybeArchiveContactForDeadJourney()
// Owner-scoped, parameterized, dead-terminal = ('archived','lost'); a contact
// is kept live by ANY non-terminal journey or ANY non-archived active_clients row.
//
// DELIBERATELY EXCLUDES won/converted/active_client contacts — those need a
// separate active-client reflection fix and are only COUNTED here as an FYI.
//
// Usage (LOCAL dev only for this run). Run from a cwd WITHOUT a .env so
// server/loadEnv.js can't override DB creds (this script does NOT import loadEnv,
// it reads process.env.DATABASE_URL directly):
//   DATABASE_URL='postgresql://bif@localhost:5432/anchor' node scripts/backfill-dead-journey-contacts.mjs
//   ... --owner <uuid>     scope to a single owner_user_id (safe testing)
//   ... --apply            actually archive (default is DRY-RUN, prints only)
//
// Idempotent: re-running archives nothing new (guarded by archived_at IS NULL).

import pg from 'pg';

const { Pool } = pg;

// ---- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
let ownerFilter = null;
const ownerIdx = argv.indexOf('--owner');
if (ownerIdx !== -1) {
  ownerFilter = argv[ownerIdx + 1] || null;
  if (!ownerFilter) {
    console.error('[backfill] --owner requires a uuid argument');
    process.exit(2);
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[backfill] DATABASE_URL is not set');
  process.exit(2);
}

const pool = new Pool({ connectionString });

const BATCH_SIZE = 500;

// The heal set: non-archived contacts whose journeys are all dead and which
// have nothing keeping them live. Mirrors maybeArchiveContactForDeadJourney,
// plus the "at least one dead-terminal journey" trigger (so we only touch
// contacts that actually went dead, not brand-new contacts with no journey).
const SELECT_HEAL_SET = `
  SELECT c.id, c.owner_user_id
    FROM contacts c
   WHERE c.archived_at IS NULL
     AND ($1::uuid IS NULL OR c.owner_user_id = $1)
     AND NOT EXISTS (
       SELECT 1 FROM client_journeys j
        WHERE j.contact_id = c.id
          AND j.owner_user_id = c.owner_user_id
          AND COALESCE(j.status, 'in_progress') NOT IN
              ('active_client','won','lost','archived','converted'))
     AND NOT EXISTS (
       SELECT 1 FROM active_clients ac
        WHERE ac.contact_id = c.id
          AND ac.owner_user_id = c.owner_user_id
          AND ac.archived_at IS NULL)
     AND EXISTS (
       SELECT 1 FROM client_journeys j
        WHERE j.contact_id = c.id
          AND j.owner_user_id = c.owner_user_id
          AND j.status IN ('archived','lost'))
   ORDER BY c.owner_user_id, c.id`;

// FYI-only: won/converted contacts that have NO non-archived active_clients row.
// These are NOT archived here — they need a separate active-client reflection fix.
const COUNT_WON_NO_ACTIVE = `
  SELECT COUNT(*)::int AS n
    FROM contacts c
   WHERE c.archived_at IS NULL
     AND ($1::uuid IS NULL OR c.owner_user_id = $1)
     AND EXISTS (
       SELECT 1 FROM client_journeys j
        WHERE j.contact_id = c.id
          AND j.owner_user_id = c.owner_user_id
          AND j.status IN ('won','converted','active_client'))
     AND NOT EXISTS (
       SELECT 1 FROM active_clients ac
        WHERE ac.contact_id = c.id
          AND ac.owner_user_id = c.owner_user_id
          AND ac.archived_at IS NULL)`;

async function main() {
  console.error(
    `[backfill] mode=${APPLY ? 'APPLY' : 'DRY_RUN'} owner=${ownerFilter || 'ALL'}`
  );

  const { rows } = await pool.query(SELECT_HEAL_SET, [ownerFilter]);

  // Group counts per owner; collect ids for apply.
  const perOwner = new Map();
  const ids = [];
  for (const r of rows) {
    ids.push(r.id);
    perOwner.set(r.owner_user_id, (perOwner.get(r.owner_user_id) || 0) + 1);
  }

  console.error('[backfill] contacts that WOULD be archived, by owner_user_id:');
  for (const [owner, count] of perOwner) {
    console.error(`  ${owner}: ${count}`);
  }
  console.error(`[backfill] grand total: ${ids.length}`);

  // Example ids only — NO PHI (no names/phones/emails).
  if (ids.length) {
    console.error(`[backfill] example contact ids: ${ids.slice(0, 5).join(', ')}`);
  }

  // FYI count — not handled here.
  const fyi = await pool.query(COUNT_WON_NO_ACTIVE, [ownerFilter]);
  const wonNoActive = fyi.rows[0]?.n ?? 0;
  console.error(
    `[backfill] FYI: ${wonNoActive} won/converted contacts have no active_clients row — ` +
    `needs separate active-client reflection, NOT handled here.`
  );

  if (!APPLY) {
    console.error('[backfill] DRY_RUN — no changes made. Pass --apply to archive.');
    return;
  }

  if (!ids.length) {
    console.error('[backfill] nothing to archive.');
    return;
  }

  const client = await pool.connect();
  let changed = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const res = await client.query(
        `UPDATE contacts
            SET archived_at = NOW(), updated_at = NOW()
          WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
        [batch]
      );
      changed += res.rowCount || 0;
      console.error(
        `[backfill] batch ${i / BATCH_SIZE + 1}: ${res.rowCount || 0} archived ` +
        `(running total ${changed})`
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.error(`[backfill] APPLY done. rows archived=${changed}`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('[backfill] fatal', e?.message || e);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
