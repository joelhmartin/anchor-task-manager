import assert from 'node:assert/strict';
import { resolveRoute, parseRouteString, GLOBAL_DEFAULT } from '../routing.js';

// parseRouteString
assert.deepEqual(parseRouteString('anthropic:claude-haiku-4-5'), { provider: 'anthropic', model: 'claude-haiku-4-5' });
assert.equal(parseRouteString(''), null);
assert.equal(parseRouteString('novalue'), null);
assert.equal(parseRouteString(null), null);

// default route for a known key
assert.deepEqual(resolveRoute('task_item_summary', null, {}), { provider: 'vertex', model: 'gemini-2.5-flash' });

// unknown key falls back to global default
assert.deepEqual(resolveRoute('does_not_exist', null, {}), GLOBAL_DEFAULT);

// per-call override wins over everything
assert.deepEqual(
  resolveRoute('task_item_summary', { provider: 'anthropic', model: 'claude-opus-4-8' }, { AI_ROUTE_task_item_summary: 'vertex:gemini-2.5-flash' }),
  { provider: 'anthropic', model: 'claude-opus-4-8' }
);

// env override wins over code default
assert.deepEqual(
  resolveRoute('task_item_summary', null, { AI_ROUTE_task_item_summary: 'anthropic:claude-sonnet-4-6' }),
  { provider: 'anthropic', model: 'claude-sonnet-4-6' }
);

console.log('routing.check.mjs OK');
