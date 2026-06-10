#!/usr/bin/env node
// One-off script: drain classification_pending=true rows in batches.
//
// Usage:
//   node scripts/backfill-pending-classifications.js [options]
//
// Options:
//   --owner <userId>   Restrict to a single owner_user_id
//   --limit <N>        Max rows to process this run (default: 200)
//   --batch <N>        Sleep every N classifications (default: 25)
//   --sleep <ms>       Sleep duration between batches in ms (default: 500)
//   --dry-run          Don't write to DB; just print what would change
//
// Reads DATABASE_URL from .env via the project's normal loadEnv path.

import { query } from '../server/db.js';
import {
  classifyContent,
  getAutoStarRating,
  DEFAULT_AI_PROMPT
} from '../server/services/ctm.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const ownerFilter = getArg('owner', null);
const limit = parseInt(getArg('limit', '200'), 10);
const batchSize = parseInt(getArg('batch', '25'), 10);
const sleepMs = parseInt(getArg('sleep', '500'), 10);
const dryRun = hasFlag('dry-run');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const params = [];
  let where = `WHERE meta->>'classification_pending' = 'true'`;
  if (ownerFilter) {
    params.push(ownerFilter);
    where += ` AND owner_user_id = $${params.length}`;
  }

  const sel = await query(
    `SELECT cl.id, cl.owner_user_id, cl.score, cl.meta, cp.ai_prompt
     FROM call_logs cl
     LEFT JOIN client_profiles cp ON cp.user_id = cl.owner_user_id
     ${where}
     ORDER BY cl.started_at DESC NULLS LAST
     LIMIT ${limit}`,
    params
  );

  console.log(
    `[backfill] found ${sel.rows.length} pending rows ` +
      `(owner=${ownerFilter || 'all'}, limit=${limit}, batch=${batchSize}, sleep=${sleepMs}ms` +
      `${dryRun ? ', DRY-RUN' : ''})`
  );

  let processed = 0;
  let skippedNoContent = 0;
  let failed = 0;

  for (const row of sel.rows) {
    const m = row.meta || {};
    const transcript = m.transcription || m.transcript || '';
    const message = m.message || '';
    if (!transcript && !message) {
      skippedNoContent += 1;
      continue;
    }
    const sourceType = m.activity_type === 'form' ? 'form' : 'call';
    try {
      const ai = await classifyContent(
        row.ai_prompt || DEFAULT_AI_PROMPT,
        transcript,
        message,
        { source: sourceType }
      );
      const newCategory = ai.category || 'unreviewed';
      // Manual-score protection: any score > 2 is presumed human-set (auto-star
      // only ever assigns 0/1/2/3 from getAutoStarRating, and the live path stops
      // auto-starring once any rating exists). Preserve those.
      const isManualScore = (row.score || 0) > 2;
      const autoStarValue = getAutoStarRating(newCategory);
      const newScore = isManualScore ? row.score : (autoStarValue || 0);
      const newMeta = {
        ...m,
        category: newCategory,
        classification: ai.classification,
        classification_summary: ai.summary,
        classification_reasoning: ai.reasoning || '',
        classification_pending: false,
        category_source: 'ai',
        category_source_detail: 'pending_backfill_2026_04'
      };
      if (dryRun) {
        console.log(
          `[backfill] DRY id=${row.id} ${m.category || 'unreviewed'}->${newCategory} ` +
            `score=${row.score}->${newScore} summary_len=${(ai.summary || '').length}`
        );
      } else {
        await query(
          `UPDATE call_logs SET meta = $2::jsonb, score = $3 WHERE id = $1`,
          [row.id, JSON.stringify(newMeta), newScore]
        );
      }
      processed += 1;
      if (processed % batchSize === 0) {
        console.log(`[backfill] ${processed}/${sel.rows.length} processed, sleeping ${sleepMs}ms`);
        await sleep(sleepMs);
      }
    } catch (err) {
      failed += 1;
      console.error(`[backfill] row ${row.id} failed:`, err.message);
    }
  }

  console.log(
    `[backfill] done — processed=${processed}, skipped_no_content=${skippedNoContent}, failed=${failed}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
