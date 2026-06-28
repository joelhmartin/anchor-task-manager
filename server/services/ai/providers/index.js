import * as vertex from './vertex.js';
import * as anthropic from './anthropic.js';

const PROVIDERS = {
  [vertex.name]: vertex,
  [anthropic.name]: anthropic
};

export function getProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown AI provider: ${providerName}`);
  return provider;
}
