// Shared, score-aware split of the collapsed "lead" bucket into the two
// front-desk chips: Qualified vs Returning/Other.
//
// `baseKey` is the result of mapping a raw classifier category through the
// raw->visible map, where every lead-bucket category (warm, very_good, neutral,
// unreviewed, converted, ...) collapses to 'lead'. Only lead-bucket rows get
// split; every other visible key (needs_attention, unanswered, not_a_fit, spam,
// pending_review) passes through unchanged.
//
// Rule (mirrors the server filter in hub.js EXACTLY — both treat a missing
// activity_type as 'call' and a missing score as 0):
//   - forms / SMS / anything that isn't a call  -> Qualified (never demoted)
//   - calls with score < 3 (incl. 0 / suppressed re-engagement callbacks) -> Returning/Other
//   - calls with score >= 3                       -> Qualified
//
// Field-name note: list rows (buildCallsFromCache) expose the score as `rating`;
// caller-history rows expose it as `score`. Read both, defaulting to 0 so the
// classification matches the server's `COALESCE(score, 0)` and a row never lands
// in the Returning list while its chip reads Qualified (or vice versa).
export function splitQualifiedReturning(baseKey, call) {
  if (baseKey !== 'lead') return baseKey;
  const isCall = (call?.activity_type || 'call') === 'call';
  const score = Number(call?.rating ?? call?.score ?? 0);
  return isCall && score < 3 ? 'returning' : 'qualified';
}
