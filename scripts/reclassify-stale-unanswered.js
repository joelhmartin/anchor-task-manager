#!/usr/bin/env node
// One-off: re-classify calls that were stuck as "unanswered"/no-conversation because they
// were classified BEFORE their CTM transcript arrived, then never re-classified (the stub
// summary blocked re-classification). The transcript is now stored in meta.transcript, so
// we re-run classifyContent on the STORED transcript — no CTM re-fetch needed.
//
// Targets rows whose classification_summary is one of the no-conversation stubs AND that
// now have a substantive stored transcript. Mirrors backfill-pending-classifications.js.
//
// Usage:
//   DATABASE_URL=... node scripts/reclassify-stale-unanswered.js [--limit N] [--batch N] [--sleep ms] [--dry-run]
import pg from 'pg';
import { classifyContent, getAutoStarRating, isNoConversationStubSummary, DEFAULT_AI_PROMPT } from '../server/services/ctm.js';

// Own pool from RECLASSIFY_DB_URL so the app's .env loader (which overrides DATABASE_URL to
// localhost) can't redirect this off the intended (prod, via proxy) database.
const pool = new pg.Pool({ connectionString: process.env.RECLASSIFY_DB_URL || process.env.DATABASE_URL });
const query = (text, params) => pool.query(text, params);

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (name) => args.includes(`--${name}`);
const parsePositiveInt = (value, fallback) => {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const limit = parsePositiveInt(getArg('limit', '1000'), 1000);
const batchSize = parsePositiveInt(getArg('batch', '25'), 25);
const sleepMs = parsePositiveInt(getArg('sleep', '500'), 500);
const dryRun = hasFlag('dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // No-conversation stubs + a substantive stored transcript = mislabeled (answered but
  // categorized unanswered). length>40 skips menu-only/empty transcripts (classifyContent
  // also re-confirms unanswered for those, so it's safe either way).
  const sel = await query(
    `SELECT cl.id, cl.owner_user_id, cl.score, cl.meta, cp.ai_prompt
       FROM call_logs cl
       LEFT JOIN client_profiles cp ON cp.user_id = cl.owner_user_id
      WHERE COALESCE(cl.meta->>'classification_summary','') IN (
              'Call was unanswered with no voicemail.',
              'Call reached voicemail with no actionable caller content.',
              'Call logged from CTM metadata.')
        AND cl.meta->>'transcript' IS NOT NULL
        AND length(trim(cl.meta->>'transcript')) > 40
      ORDER BY cl.started_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  console.log(`[reclassify] found ${sel.rows.length} stale-stub rows with a transcript (limit=${limit}${dryRun ? ', DRY-RUN' : ''})`);

  let processed = 0, changed = 0, stillUnanswered = 0, failed = 0;
  for (const row of sel.rows) {
    const m = row.meta || {};
    const transcript = m.transcript || m.transcription || '';
    const message = m.message || '';
    // Guard: only touch rows whose stored summary is still a no-conversation stub.
    if (!isNoConversationStubSummary(m.classification_summary)) continue;
    try {
      const ai = await classifyContent(row.ai_prompt || DEFAULT_AI_PROMPT, transcript, message, { source: 'call' });
      const newCategory = ai.category || 'unreviewed';
      // Preserve ANY existing non-zero score (don't clobber a human's 1-5★); these rows
      // were stuck as unanswered=0★, so the common case is 0 → auto-star the new category.
      const newScore = (row.score || 0) > 0 ? row.score : (getAutoStarRating(newCategory) || 0);
      const newMeta = {
        ...m,
        category: newCategory,
        semantic_category: newCategory,
        classification: ai.classification,
        classification_summary: ai.summary,
        classification_reasoning: ai.reasoning || '',
        classification_pending: false,
        category_source: 'ai',
        category_source_detail: 'reclassify_stale_unanswered_2026_06'
      };
      if (newCategory !== (m.category || 'unreviewed')) changed += 1;
      if (newCategory === 'unanswered') stillUnanswered += 1;
      if (dryRun) {
        console.log(`[reclassify] DRY id=${row.id} ${m.category || 'unreviewed'} -> ${newCategory} score=${row.score}->${newScore} sum="${(ai.summary || '').slice(0, 60)}"`);
      } else {
        await query(`UPDATE call_logs SET meta = $2::jsonb, score = $3 WHERE id = $1`, [row.id, JSON.stringify(newMeta), newScore]);
      }
      processed += 1;
      if (processed % batchSize === 0) { console.log(`[reclassify] ${processed}/${sel.rows.length} (changed=${changed})`); await sleep(sleepMs); }
    } catch (err) {
      failed += 1;
      console.error(`[reclassify] row ${row.id} failed:`, err.message);
    }
  }
  console.log(`[reclassify] done — processed=${processed} changed=${changed} still_unanswered=${stillUnanswered} failed=${failed}`);
  process.exit(0);
}
main().catch((e) => { console.error('[reclassify] fatal:', e); process.exit(1); });
