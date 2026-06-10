const FALLBACK_AUDIT_MODEL = 'gemini-2.5-flash';
export const DEFAULT_AUDIT_PRESET_ID = 'vertex_auditor';
const LEGACY_INVALID_AUDIT_MODEL_IDS = new Set(['claude', 'openai', 'codex', 'claude_auditor', 'openai_auditor', 'vertex_auditor']);

function isGeminiModelId(modelId) {
  return /^gemini-/i.test(String(modelId || '').trim());
}

function resolveDefaultAuditModel() {
  const configuredModelId = String(process.env.AUDIT_MODEL_VERTEX || '').trim();
  return isGeminiModelId(configuredModelId) ? configuredModelId : FALLBACK_AUDIT_MODEL;
}

const DEFAULT_AUDIT_MODEL = resolveDefaultAuditModel();

const AUDIT_SYSTEM_PROMPT = `You are a senior paid media auditor.
Use only the supplied facts and candidate findings.
Do not invent metrics, causes, or campaign details.
Prioritize the highest-risk issues first.
Keep recommendations concise, operational, and specific to the supplied evidence.
If the data shows no urgent issue, say so plainly.`;

const PRESETS = {
  [DEFAULT_AUDIT_PRESET_ID]: {
    id: DEFAULT_AUDIT_PRESET_ID,
    label: 'Vertex AI Auditor',
    provider: 'vertex',
    description: 'Vertex AI-backed audit summary for paid-media triage.',
    defaultModel: DEFAULT_AUDIT_MODEL
  }
};

function hasVertexConfiguration() {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT_ID);
}

export function listAuditPresets() {
  return Object.values(PRESETS);
}

export function getAuditPreset(presetId = DEFAULT_AUDIT_PRESET_ID) {
  const preset = PRESETS[presetId];
  if (!preset) {
    throw new Error(`Unsupported audit provider preset: ${presetId}`);
  }
  return preset;
}

export function assertAuditPresetConfigured(presetId = DEFAULT_AUDIT_PRESET_ID) {
  const preset = getAuditPreset(presetId);
  if (!hasVertexConfiguration()) {
    throw new Error('Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT or VERTEX_PROJECT_ID.');
  }
  return preset;
}

export function normalizeAuditModelId(modelId, fallbackModel = DEFAULT_AUDIT_MODEL) {
  const trimmedModelId = String(modelId || '').trim();
  if (!trimmedModelId) {
    return fallbackModel;
  }

  if (LEGACY_INVALID_AUDIT_MODEL_IDS.has(trimmedModelId.toLowerCase())) {
    return fallbackModel;
  }

  return trimmedModelId;
}

export function resolveAuditModel(presetId = DEFAULT_AUDIT_PRESET_ID, modelOverride = null) {
  const preset = getAuditPreset(presetId);
  return normalizeAuditModelId(modelOverride, preset.defaultModel);
}

export function getAuditSystemPrompt() {
  return AUDIT_SYSTEM_PROMPT;
}
