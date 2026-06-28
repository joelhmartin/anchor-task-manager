import assert from 'node:assert/strict';
import { generate, isConfigured, AiProviderNotConfigured, name } from '../providers/anthropic.js';

assert.equal(name, 'anthropic');
assert.equal(isConfigured({}), false);
assert.equal(isConfigured({ ANTHROPIC_API_KEY: 'sk-x' }), true);

// With no key, generate rejects with the typed error and never hits the network.
await assert.rejects(
  generate({ prompt: 'hi' }, {}),
  (err) => err instanceof AiProviderNotConfigured
);

console.log('anthropic.check.mjs OK');
