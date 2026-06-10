/**
 * CTM Forms — submission outcome & reCAPTCHA policy.
 *
 * Centralizes the "what do we do with this submission" decision so the embed submit
 * handler and the staff "release" action share one source of truth.
 *
 * Background: a missing reCAPTCHA token is NOT the same as confirmed spam. Privacy
 * browsers, tracker blockers (e.g. Edge Tracking Prevention), corporate networks, CSP,
 * and reCAPTCHA outages can all suppress the token for a perfectly real patient. The old
 * behaviour buried every reCAPTCHA failure as silent spam (stored spam=TRUE, not forwarded
 * to CTM, no email) while showing the user a success-style message — i.e. real leads
 * vanished. This module separates "positive bot signal" from "no browser proof" so the two
 * can be handled differently and per-form configurable.
 */

// Per-form reCAPTCHA enforcement modes (stored in ctm_forms.config_json.settings.recaptcha_mode).
export const RECAPTCHA_MODES = Object.freeze({
  OBSERVE_ONLY: 'observe_only',           // never hold for reCAPTCHA; just record the assessment
  REVIEW_MISSING_TOKEN: 'review_missing_token', // DEFAULT: hold hard bot signals; flag soft fails for review (still forwarded)
  BLOCK_LOW_SCORE: 'block_low_score',     // hold hard bot signals; let soft fails through silently
  STRICT_BLOCK: 'strict_block'            // hold any reCAPTCHA failure (legacy behaviour)
});

export const DEFAULT_RECAPTCHA_MODE = RECAPTCHA_MODES.REVIEW_MISSING_TOKEN;

// Submission triage states (ctm_form_submissions.status).
export const SUBMISSION_STATUS = Object.freeze({
  RECEIVED: 'received',
  REVIEW: 'review',
  HELD: 'held',
  RELEASED: 'released'
});

// Granular block reasons (ctm_form_submissions.block_reason).
export const BLOCK_REASONS = Object.freeze({
  RECAPTCHA_MISSING_TOKEN: 'recaptcha_missing_token',
  RECAPTCHA_LOW_SCORE: 'recaptcha_low_score',
  RECAPTCHA_INVALID_TOKEN: 'recaptcha_invalid_token',
  RECAPTCHA_ACTION_MISMATCH: 'recaptcha_action_mismatch',
  RECAPTCHA_SERVICE_UNAVAILABLE: 'recaptcha_service_unavailable',
  RECAPTCHA_FAILED: 'recaptcha_failed',
  AI_SPAM: 'ai_spam',
  HEURISTIC_SPAM: 'heuristic_spam'
});

/**
 * Normalize a reCAPTCHA assessment (from services/recaptcha.js assessToken) into:
 *   - severity: 'pass' | 'soft' | 'hard'
 *       pass — passed; nothing to do
 *       soft — no browser proof (missing token / service outage). Ambiguous: could be a
 *              real user. NOT positive evidence of a bot.
 *       hard — a positive bot signal (low score, invalid token, action mismatch).
 *   - blockReason: normalized BLOCK_REASONS value (null when passed)
 */
export function classifyRecaptcha(recaptcha) {
  const r = recaptcha || {};
  if (r.passed) return { severity: 'pass', blockReason: null };

  const reason = String(r.reason || '');
  if (reason === 'missing_token') {
    return { severity: 'soft', blockReason: BLOCK_REASONS.RECAPTCHA_MISSING_TOKEN };
  }
  if (reason === 'service_unavailable' || reason === 'unconfigured_error') {
    return { severity: 'soft', blockReason: BLOCK_REASONS.RECAPTCHA_SERVICE_UNAVAILABLE };
  }
  if (reason === 'low_score') {
    return { severity: 'hard', blockReason: BLOCK_REASONS.RECAPTCHA_LOW_SCORE };
  }
  if (reason === 'action_mismatch') {
    return { severity: 'hard', blockReason: BLOCK_REASONS.RECAPTCHA_ACTION_MISMATCH };
  }
  if (reason.startsWith('invalid_token')) {
    return { severity: 'hard', blockReason: BLOCK_REASONS.RECAPTCHA_INVALID_TOKEN };
  }
  // Unknown failure — treat conservatively as a hard signal so it isn't ignored.
  return { severity: 'hard', blockReason: BLOCK_REASONS.RECAPTCHA_FAILED };
}

/**
 * Resolve the per-form reCAPTCHA mode from the form's config_json, falling back to default.
 */
export function resolveRecaptchaMode(form) {
  const mode = form && form.config_json && form.config_json.settings
    ? form.config_json.settings.recaptcha_mode
    : null;
  return Object.values(RECAPTCHA_MODES).includes(mode) ? mode : DEFAULT_RECAPTCHA_MODE;
}

/**
 * Decide what to do with a submission given its reCAPTCHA assessment and the form's mode.
 * Returns an action that the caller layers the AI-spam check on top of:
 *   - 'continue' — forward to CTM + notify as a normal lead
 *   - 'review'   — forward to CTM + notify, but flag (status='review') for a human
 *   - 'hold'     — store spam-held (status='held'), do NOT forward, show generic message
 *
 * Policy matrix (severity x mode):
 *
 *   mode \\ severity    pass    soft               hard
 *   observe_only        cont.   continue           continue
 *   review_missing      cont.   review (flagged)   hold      <- DEFAULT
 *   block_low_score     cont.   continue           hold
 *   strict_block        cont.   hold               hold
 */
export function decideRecaptchaAction(recaptcha, mode) {
  const { severity, blockReason } = classifyRecaptcha(recaptcha);
  if (severity === 'pass') return { action: 'continue', blockReason: null, severity };

  switch (mode) {
    case RECAPTCHA_MODES.OBSERVE_ONLY:
      return { action: 'continue', blockReason, severity };
    case RECAPTCHA_MODES.STRICT_BLOCK:
      return { action: 'hold', blockReason, severity };
    case RECAPTCHA_MODES.BLOCK_LOW_SCORE:
      return { action: severity === 'hard' ? 'hold' : 'continue', blockReason, severity };
    case RECAPTCHA_MODES.REVIEW_MISSING_TOKEN:
    default:
      return { action: severity === 'hard' ? 'hold' : 'review', blockReason, severity };
  }
}

// Human-readable labels for the dashboard (kept here so frontend + backend agree).
export const BLOCK_REASON_LABELS = Object.freeze({
  [BLOCK_REASONS.RECAPTCHA_MISSING_TOKEN]: 'reCAPTCHA: no token (privacy browser / blocker)',
  [BLOCK_REASONS.RECAPTCHA_LOW_SCORE]: 'reCAPTCHA: low score (likely bot)',
  [BLOCK_REASONS.RECAPTCHA_INVALID_TOKEN]: 'reCAPTCHA: invalid token',
  [BLOCK_REASONS.RECAPTCHA_ACTION_MISMATCH]: 'reCAPTCHA: action mismatch',
  [BLOCK_REASONS.RECAPTCHA_SERVICE_UNAVAILABLE]: 'reCAPTCHA: service unavailable',
  [BLOCK_REASONS.RECAPTCHA_FAILED]: 'reCAPTCHA: failed',
  [BLOCK_REASONS.AI_SPAM]: 'AI spam filter',
  [BLOCK_REASONS.HEURISTIC_SPAM]: 'Heuristic spam filter'
});
