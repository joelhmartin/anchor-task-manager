import assert from 'node:assert/strict';
import { runWithFallback } from '../fallback.js';

// primary succeeds -> returns primary result, fallback never called
let fallbackCalled = false;
const a = await runWithFallback({
  primaryName: 'p',
  primary: async () => 'primary-result',
  fallbackName: 'f',
  fallback: async () => { fallbackCalled = true; return 'fallback-result'; }
});
assert.equal(a, 'primary-result');
assert.equal(fallbackCalled, false);

// primary throws -> fallback result returned
const b = await runWithFallback({
  primaryName: 'p',
  primary: async () => { throw new Error('boom'); },
  fallbackName: 'f',
  fallback: async () => 'fallback-result'
});
assert.equal(b, 'fallback-result');

// no fallback provided -> primary error propagates
await assert.rejects(
  runWithFallback({ primaryName: 'p', primary: async () => { throw new Error('only'); }, fallbackName: null, fallback: null }),
  /only/
);

// both throw -> combined error carries both
try {
  await runWithFallback({
    primaryName: 'p',
    primary: async () => { throw new Error('e1'); },
    fallbackName: 'f',
    fallback: async () => { throw new Error('e2'); }
  });
  assert.fail('should have thrown');
} catch (err) {
  assert.match(err.message, /e1/);
  assert.match(err.message, /e2/);
  assert.equal(err.primaryError.message, 'e1');
  assert.equal(err.fallbackError.message, 'e2');
}

console.log('fallback.check.mjs OK');
