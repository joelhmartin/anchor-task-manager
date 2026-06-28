import assert from 'node:assert/strict';
import { getProvider } from '../providers/index.js';
import { resolveRoute } from '../index.js';

// registry: known + unknown
assert.equal(getProvider('vertex').name, 'vertex');
assert.equal(getProvider('anthropic').name, 'anthropic');
assert.throws(() => getProvider('nope'), /Unknown AI provider/);

// runAi re-exports resolveRoute and routes correctly
assert.deepEqual(resolveRoute('task_item_summary', null, {}), { provider: 'vertex', model: 'gemini-2.5-flash' });

console.log('runai.check.mjs OK');
