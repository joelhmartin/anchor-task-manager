import { registerHealthCheck } from '../registry.js';
import { classifyContent, DEFAULT_AI_PROMPT } from '../../ctm.js';

// Hard-coded, obviously-synthetic transcript. NO real PHI. An unambiguous lead so
// a healthy classifier returns a real, non-'unreviewed' category with a real summary.
const SYNTHETIC_TRANSCRIPT =
  "Hi, this is a test call. I'm a brand new patient and I'd like to book a dental " +
  'cleaning and a consultation for teeth whitening. Do you accept new patients this week?';

registerHealthCheck('ai.classification', {
  label: 'AI lead classification (Vertex)',
  category: 'agent',
  timeoutMs: 25000,
  run: async () => {
    const ai = await classifyContent(DEFAULT_AI_PROMPT, SYNTHETIC_TRANSCRIPT, '', { source: 'call' });
    const failed =
      !ai ||
      ai.summary === 'AI classification failed.' ||
      ai.category === 'unreviewed' ||
      !ai.category;
    return {
      status: failed ? 'fail' : 'ok',
      detail: failed
        ? 'Synthetic classify returned the failure fallback — Vertex classification is down.'
        : `Synthetic lead classified as "${ai.category}".`,
      error: failed ? (ai?.reasoning || 'classification fell back to unreviewed') : undefined,
      metrics: { category: ai?.category || null, model: ai?.debug?.model || null }
    };
  }
});
