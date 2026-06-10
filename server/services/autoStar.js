// Pure auto-star decision logic. NO db/ai imports so it stays unit-testable
// and side-effect free. Imported (and getAutoStarRating re-exported) by ctm.js.

/**
 * Maps an AI category to the auto-star rating.
 * Never returns 4 or 5 (those are manual only).
 * 1 = spam, 2 = real person but not a fit, 3 = solid lead, 0 = not scored.
 */
export function getAutoStarRating(category) {
  switch (category) {
    case 'spam':
      return 1;
    case 'not_a_fit':
    case 'applicant':
      return 2;
    case 'warm':
    case 'very_good':
    case 'needs_attention':
      return 3;
    case 'active_client':
    case 'returning_customer':
      return 0; // Existing clients don't get auto-scored as leads
    case 'voicemail':
    case 'unanswered':
    case 'neutral':
    case 'unreviewed':
    default:
      return 0;
  }
}

/**
 * Decide whether to auto-apply a star to a row, decoupled from the
 * classification cycle. Pure: same inputs → same output, no side effects.
 *
 * @param {object} p
 * @param {string} p.category          - semantic category
 * @param {number} p.existingScore     - current score (CTM-authoritative under syncRatings)
 * @param {boolean} p.hasCtmRating     - CTM already holds a rating (>0)
 * @param {object} p.enrichment        - { callerType, recentlyQualified, lookupFailed }
 * @param {string} p.categorySource    - 'client' means a human override; never overwrite
 * @param {boolean} p.alreadyApplied   - reflects meta.auto_star_applied_at, which is stamped when
 *                                     auto-star fires during a sync AND when a human manually sets
 *                                     a star via POST /score. Broadly means "a star decision is
 *                                     locked for this row" — prevents auto-star from fighting a
 *                                     deliberate manual choice. (The manual clear path uses
 *                                     category_source='client' instead of this marker.)
 * @returns {{ score: number, apply: boolean, reason: string }}
 */
export function computeAutoStar({
  category,
  existingScore = 0,
  hasCtmRating = false,
  enrichment = {},
  categorySource = 'ai',
  alreadyApplied = false
} = {}) {
  const score = Number(existingScore) || 0;
  const star = getAutoStarRating(category);

  if (String(categorySource).toLowerCase() === 'client') {
    return { score, apply: false, reason: 'client_override' };
  }
  if (hasCtmRating || score > 0) {
    return { score, apply: false, reason: 'existing_rating' };
  }
  if (enrichment?.callerType === 'active_client') {
    return { score: 0, apply: false, reason: 'active_client' };
  }
  // Mirror ctm.js gate: only suppress on recentlyQualified when the lookup did NOT fail.
  if (enrichment?.recentlyQualified && !enrichment?.lookupFailed) {
    return { score: 0, apply: false, reason: 'recently_qualified' };
  }
  if (alreadyApplied) {
    return { score, apply: false, reason: 'already_applied' };
  }
  if (star <= 0) {
    return { score, apply: false, reason: 'non_scoring_category' };
  }
  return { score: star, apply: true, reason: 'auto_star' };
}
