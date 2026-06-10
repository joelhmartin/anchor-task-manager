// One-time recovery: star qualified CALL leads that are frozen at score 0
// because the auto-star missed its single classify-cycle window. Posts the
// corrected score to CTM (authoritative under syncRatings) so it sticks.
// Does NOT re-fire the conversion relay (conversions already fired on category).
//
// Run from a cwd WITHOUT a .env so loadEnv.js can't override DB creds:
//   DRY_RUN=1 LIMIT=50 DATABASE_URL=... PGPASSWORD=... node scripts/backfill-frozen-autostar.mjs
// DRY_RUN defaults to 1 (prints only). Set DRY_RUN=0 to write + post to CTM.
//
// Candidate filter: activity_type='call', score 0/NULL, category in QUALIFIED
//   (warm/very_good/needs_attention — 3-star tiers only), category_source != 'client',
//   caller_type != 'active_client', auto_star_applied_at IS NULL.
// Per row: real enrichCallerType is called to compute recentlyQualified / callerType
//   accurately — this is a one-time run with no sync follow-up for old rows, so the
//   enrichment must be exact. Rows where enrichCallerType fails are SKIPPED (not starred)
//   to avoid over-starring on lookup failure.

import { query } from '../server/db.js';
import { computeAutoStar } from '../server/services/autoStar.js';
import {
  enrichCallerType,
  resolveCtmCreds,
  postSaleToCTM
} from '../server/services/ctm.js';

const DRY_RUN = process.env.DRY_RUN !== '0';
const _rawLimit = parseInt(process.env.LIMIT, 10);
const LIMIT = Number.isFinite(_rawLimit) && _rawLimit > 0 ? _rawLimit : null;

// Only 3-star qualified tiers. Starring old spam/not_a_fit would post spurious
// CTM conversions and change nothing visible in the leads board.
const QUALIFIED = ['warm', 'very_good', 'needs_attention'];

async function main() {
  console.error(`[recover] mode=${DRY_RUN ? 'DRY_RUN' : 'WRITE'} limit=${LIMIT ?? 'none'}`);

  // Frozen = call, unrated, qualified category, AI-sourced (not a client override),
  // not an active-client caller, no once-marker yet.
  const { rows } = await query(
    `SELECT call_id,
            COALESCE(owner_user_id, user_id) AS client_id,
            score,
            from_number,
            contact_id,
            caller_type,
            meta
       FROM call_logs
      WHERE activity_type = 'call'
        AND COALESCE(score, 0) = 0
        AND meta->>'category' = ANY($1)
        AND COALESCE(meta->>'category_source', 'ai') <> 'client'
        AND COALESCE(caller_type, 'new') <> 'active_client'
        AND meta->>'auto_star_applied_at' IS NULL
      ORDER BY started_at DESC NULLS LAST
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
    [QUALIFIED]
  );
  console.error(`[recover] candidate rows: ${rows.length}`);

  const credCache = new Map();
  async function creds(clientId) {
    if (credCache.has(clientId)) return credCache.get(clientId);
    const r = await query(
      'SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id=$1 LIMIT 1',
      [clientId]
    );
    const c = resolveCtmCreds(r.rows[0] || null);
    credCache.set(clientId, c);
    return c;
  }

  let updated = 0, skipped = 0, posted = 0, racedSkipped = 0, noCreds = 0, dbErrors = 0, ctmErrors = 0;

  for (const row of rows) {
    const meta = row.meta || {};
    const category = meta.category;

    // Compute REAL per-row enrichment so recentlyQualified is accurate.
    // The WHERE already guarantees auto_star_applied_at IS NULL so alreadyApplied=false.
    // On lookup failure, skip rather than risk over-starring.
    let enr;
    try {
      enr = await enrichCallerType(query, row.client_id, row.from_number, row.call_id, row.contact_id);
    } catch (enrichErr) {
      skipped += 1;
      console.error('[recover] enrichCallerType failed — skipping', row.call_id, enrichErr?.message || enrichErr);
      continue;
    }

    const autoStar = computeAutoStar({
      category,
      existingScore: row.score || 0,
      hasCtmRating: false,
      enrichment: enr,
      categorySource: meta.category_source || 'ai',
      alreadyApplied: false
    });

    if (!autoStar.apply) {
      skipped += 1;
      continue;
    }

    // No PHI in logs — print only structural identifiers and score outcome.
    if (DRY_RUN) {
      console.log(JSON.stringify({
        callId: row.call_id,
        clientId: row.client_id,
        category,
        scoreAfter: autoStar.score
      }));
      updated += 1;
      continue;
    }

    try {
      // Claim the row locally FIRST, guarded so we never clobber a concurrent/human score.
      const claim = await query(
        `UPDATE call_logs SET score=$1
           WHERE call_id=$2 AND (owner_user_id=$3 OR user_id=$3) AND COALESCE(score, 0) = 0`,
        [autoStar.score, row.call_id, row.client_id]
      );
      if (!claim.rowCount) { racedSkipped += 1; continue; } // already scored/raced — leave it; no CTM post

      // We hold the claim (local score set, CTM still 0). Make it durable, else revert so it stays recoverable.
      const c = await creds(row.client_id);
      if (!(c?.accountId && c.apiKey && c.apiSecret)) {
        await query(
          `UPDATE call_logs SET score=0 WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2) AND score=$3`,
          [row.call_id, row.client_id, autoStar.score]
        );
        noCreds += 1; continue;
      }
      try {
        // conversion:0 → set the star rating only; do NOT fire/mark a CTM conversion for an old recovered lead.
        await postSaleToCTM(c, row.call_id, { score: autoStar.score, conversion: 0, value: 0 });
      } catch (ctmErr) {
        await query(
          `UPDATE call_logs SET score=0 WHERE call_id=$1 AND (owner_user_id=$2 OR user_id=$2) AND score=$3`,
          [row.call_id, row.client_id, autoStar.score]
        );
        ctmErrors += 1;
        console.error('[recover] ctm-post failed (reverted)', row.call_id, ctmErr?.message);
        continue;
      }
      posted += 1;

      // CTM accepted — now stamp the once-marker (jsonb merge, owner-scoped).
      await query(
        `UPDATE call_logs SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('auto_star_applied_at', to_jsonb($2::text))
           WHERE call_id=$1 AND (owner_user_id=$3 OR user_id=$3)`,
        [row.call_id, new Date().toISOString(), row.client_id]
      );
      updated += 1;
      await new Promise((resolve) => setTimeout(resolve, 150)); // throttle
    } catch (err) {
      dbErrors += 1;
      console.error('[recover] error', row.call_id, err?.message || err);
    }
  }

  console.error(`[recover] done. ${DRY_RUN ? 'would-update' : 'updated'}=${updated} posted=${posted} racedSkipped=${racedSkipped} skipped=${skipped} noCreds=${noCreds} dbErrors=${dbErrors} ctmErrors=${ctmErrors}`);
  process.exit(0);
}

main().catch((e) => { console.error('[recover] fatal', e); process.exit(1); });
