import { generateAiResponse } from '../../ai.js';

export const name = 'vertex';

// Normalize the existing Vertex/Gemini call into the seam's interface.
export async function generate(request) {
  const { system, prompt, temperature, maxTokens, model } = request || {};
  const res = await generateAiResponse({
    prompt,
    systemPrompt: system || 'You are a helpful assistant.',
    temperature: temperature ?? 0.7,
    maxTokens: maxTokens ?? 800,
    ...(model ? { model } : {}),
    returnMetadata: true
  });
  return {
    text: res.text,
    json: undefined,
    provider: 'vertex',
    model: res.metadata?.model || model || null,
    usage: res.metadata?.usageMetadata || null,
    raw: res
  };
}
