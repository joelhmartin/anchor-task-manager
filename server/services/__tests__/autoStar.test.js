import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoStar, getAutoStarRating } from '../autoStar.js';

test('frozen new very_good lead heals (applies 3)', () => {
  const r = computeAutoStar({
    category: 'very_good', existingScore: 0, hasCtmRating: false,
    enrichment: { callerType: 'new', recentlyQualified: false }, categorySource: 'ai', alreadyApplied: false
  });
  assert.deepEqual(r, { score: 3, apply: true, reason: 'auto_star' });
});

test('respects a deliberate manual 0 via the once-marker', () => {
  const r = computeAutoStar({
    category: 'very_good', existingScore: 0, enrichment: { callerType: 'new' }, alreadyApplied: true
  });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'already_applied');
});

test('client override is never overwritten', () => {
  const r = computeAutoStar({ category: 'very_good', existingScore: 0, categorySource: 'client' });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'client_override');
});

test('existing CTM rating is preserved', () => {
  const r = computeAutoStar({ category: 'very_good', existingScore: 0, hasCtmRating: true });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'existing_rating');
});

test('active_client caller is suppressed', () => {
  const r = computeAutoStar({ category: 'very_good', enrichment: { callerType: 'active_client' } });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'active_client');
});

test('recentlyQualified suppresses, but NOT when the lookup failed', () => {
  const suppressed = computeAutoStar({ category: 'very_good', enrichment: { recentlyQualified: true, lookupFailed: false } });
  assert.equal(suppressed.apply, false);
  assert.equal(suppressed.reason, 'recently_qualified');
  const healed = computeAutoStar({ category: 'very_good', enrichment: { recentlyQualified: true, lookupFailed: true } });
  assert.equal(healed.apply, true);
});

test('non-scoring category does not apply', () => {
  const r = computeAutoStar({ category: 'neutral', enrichment: { callerType: 'new' } });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'non_scoring_category');
});

test('manual existing score (score>0, no CTM rating) is preserved', () => {
  const r = computeAutoStar({ category: 'very_good', existingScore: 5, hasCtmRating: false });
  assert.equal(r.apply, false);
  assert.equal(r.reason, 'existing_rating');
  assert.equal(r.score, 5);
});

test('getAutoStarRating mapping unchanged', () => {
  assert.equal(getAutoStarRating('very_good'), 3);
  assert.equal(getAutoStarRating('warm'), 3);
  assert.equal(getAutoStarRating('needs_attention'), 3);
  assert.equal(getAutoStarRating('not_a_fit'), 2);
  assert.equal(getAutoStarRating('applicant'), 2);
  assert.equal(getAutoStarRating('spam'), 1);
  assert.equal(getAutoStarRating('neutral'), 0);
  assert.equal(getAutoStarRating('active_client'), 0);
});
