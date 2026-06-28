export const name = 'anthropic';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5';

export class AiProviderNotConfigured extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiProviderNotConfigured';
  }
}

export function isConfigured(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

// Calls the Anthropic Messages API directly via fetch (no SDK dependency).
// Inert without ANTHROPIC_API_KEY: throws AiProviderNotConfigured before any network call.
export async function generate(request, env = process.env) {
  if (!isConfigured(env)) {
    throw new AiProviderNotConfigured('Anthropic provider not configured (ANTHROPIC_API_KEY missing)');
  }
  const { system, prompt, temperature, maxTokens, model } = request || {};
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens ?? 1024,
    temperature: temperature ?? 0.7,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }]
  };

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error('Anthropic returned a non-JSON response');
  }
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('Anthropic response was empty');

  return {
    text,
    json: undefined,
    provider: 'anthropic',
    model: data.model || body.model,
    usage: data.usage || null,
    raw: data
  };
}
