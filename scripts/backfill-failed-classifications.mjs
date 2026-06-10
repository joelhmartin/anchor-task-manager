// One-off recovery: re-classify call_logs rows that fell back to
// "AI classification failed." during the gemini-2.0-flash 404 outage
// (2026-06-02 → 2026-06-05). Mirrors the meta-only update logic of
// POST /api/hub/clients/:id/reclassify-leads (hub.js) so behavior is faithful:
// it does NOT pull CTM, start journeys, or fire the tracking relay.
//
// Run from a cwd WITHOUT a .env so loadEnv.js can't override our model/DB/location.
// Required env: DATABASE_URL (prod via cloud-sql-proxy), PGPASSWORD,
//   GOOGLE_CLOUD_PROJECT, VERTEX_PROJECT_ID, VERTEX_LOCATION=us-central1,
//   VERTEX_MODEL=gemini-2.5-flash, VERTEX_CLASSIFIER_MODEL=gemini-2.5-flash
// Toggles: DRY_RUN=1 (default) prints without writing; LIMIT caps rows.

import { query } from '../server/db.js';
import {
  classifyContent,
  DEFAULT_AI_PROMPT,
  getCategoryFromRating,
  buildSystemTags,
  isReferralContext,
  shouldRequireCallback
} from '../server/services/ctm.js';

const DRY_RUN = process.env.DRY_RUN !== '0';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null;
const SINCE = '2026-06-02 17:00:00+00';

function pickContent(meta) {
  const transcript =
    meta?.transcript || meta?.transcription_text || meta?.transcription?.text || meta?.transcript_text || '';
  const message = meta?.message || meta?.notes || '';
  return { transcript, message };
}

async function main() {
  console.error(`[backfill] mode=${DRY_RUN ? 'DRY_RUN' : 'WRITE'} model=${process.env.VERTEX_CLASSIFIER_MODEL} location=${process.env.VERTEX_LOCATION} limit=${LIMIT ?? 'none'}`);

  const { rows } = await query(
    `SELECT call_id, COALESCE(owner_user_id, user_id) AS client_id, score, activity_type, meta
       FROM call_logs
      WHERE created_at >= $1
        AND meta->>'classification_summary' ILIKE '%classification failed%'
      ORDER BY created_at ASC
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
    [SINCE]
  );
  console.error(`[backfill] candidate rows: ${rows.length}`);

  const promptCache = new Map();
  async function getPrompt(clientId) {
    if (promptCache.has(clientId)) return promptCache.get(clientId);
    const r = await query('SELECT ai_prompt FROM client_profiles WHERE user_id=$1 LIMIT 1', [clientId]);
    const p = r.rows[0]?.ai_prompt || DEFAULT_AI_PROMPT;
    promptCache.set(clientId, p);
    return p;
  }

  let updated = 0, skippedNoContent = 0, errors = 0;

  for (const row of rows) {
    const callId = row.call_id;
    const clientId = row.client_id;
    const meta = row.meta || {};
    const { transcript, message } = pickContent(meta);
    const hasContent = Boolean(String(transcript || message).trim());
    const formName = String(meta?.form_name || '').trim();
    const isFormActivity = row.activity_type === 'form' || Boolean(formName);

    try {
      let ai;
      if (!hasContent) {
        if (meta?.is_voicemail === true) {
          ai = { classification: 'unanswered', summary: 'Voicemail contained no actionable details.', category: 'unanswered' };
        } else if (formName) {
          const fallbackCategory = /(quiz|assessment|screening|evaluation|consultation|pain|sleep|tmj|symptom|new patient)/i.test(formName) ? 'warm' : 'neutral';
          ai = { classification: fallbackCategory, summary: `${formName} submitted and needs review.`, category: fallbackCategory };
        } else {
          skippedNoContent += 1;
          continue;
        }
      } else {
        const prompt = await getPrompt(clientId);
        ai = await classifyContent(prompt, transcript, message, { source: formName ? 'form' : 'call' });
      }

      const score = Number(row.score || 0);
      const ratingCategory = score > 0 ? getCategoryFromRating(score) : null;
      const hasClientCategoryOverride =
        String(meta?.category_source || '').toLowerCase() === 'client' && Boolean(meta?.semantic_category || meta?.category);
      let finalCategory = hasClientCategoryOverride
        ? meta?.semantic_category || meta?.category
        : ai.category || ai.classification || meta?.semantic_category || meta?.category || 'unreviewed';
      if (!hasClientCategoryOverride && meta?.is_voicemail === true && hasContent && (finalCategory === 'warm' || finalCategory === 'very_good')) {
        finalCategory = 'needs_attention';
      }
      const categorySource = hasClientCategoryOverride ? 'client' : 'ai';
      const categorySourceDetail = hasClientCategoryOverride ? meta?.category_source_detail || 'dashboard_manual' : 'backfill_reclassify';
      const isReferral = isReferralContext(`${transcript}\n${message}\n${ai.summary || meta?.classification_summary || ''}`);
      const systemTags = buildSystemTags({ semanticCategory: finalCategory, isReferral, categorySource });
      const requiresCallback = shouldRequireCallback({
        isVoicemail: meta?.is_voicemail === true,
        category: finalCategory,
        hasExistingCtmRating: false
      });
      // Category/summary recovery only — starring is owned by the live sync +
      // backfill-frozen-autostar.mjs (which post to CTM). Do NOT stamp
      // auto_star_applied_at here or it would block those durable heals.
      const nextScore = score;

      const nextMeta = {
        ...meta,
        category: finalCategory,
        semantic_category: finalCategory,
        rating_category: ratingCategory,
        category_source: categorySource,
        category_source_detail: categorySourceDetail,
        classification: ai.classification || meta.classification,
        classification_summary: ai.summary || meta.classification_summary,
        classification_reasoning: ai.reasoning || meta.classification_reasoning || ai.summary || meta.classification_summary,
        requires_callback: requiresCallback,
        is_referral: isReferral,
        system_tags: systemTags,
        reclassified_at: new Date().toISOString()
      };

      if (DRY_RUN) {
        console.log(JSON.stringify({
          callId, clientId, before: meta.category, after: finalCategory,
          scoreBefore: score, scoreAfter: nextScore
        }));
      } else {
        await query(
          `UPDATE call_logs SET meta=$1::jsonb, score=$2 WHERE call_id=$3 AND (owner_user_id=$4 OR user_id=$4)`,
          [JSON.stringify(nextMeta), nextScore, callId, clientId]
        );
      }
      updated += 1;
    } catch (err) {
      errors += 1;
      console.error('[backfill] error', callId, err?.message || err);
    }
  }

  console.error(`[backfill] done. ${DRY_RUN ? 'would-update' : 'updated'}=${updated} skippedNoContent=${skippedNoContent} errors=${errors}`);
  process.exit(0);
}

main().catch((e) => { console.error('[backfill] fatal', e); process.exit(1); });
