import { generateAiResponse } from '../ai.js';
import { DEFAULT_AUDIT_PRESET_ID, assertAuditPresetConfigured, resolveAuditModel } from './auditPresets.js';
import { getAuditRun, listAuditRuns } from './auditScheduler.js';

const CHAT_SYSTEM_PROMPT = `You are an admin operations assistant for paid media and connected-platform audits.
Use only the supplied audit context.
Do not invent metrics, integrations, actions taken, or platform access.
If the context is missing something, say so directly.
Keep answers concise, operational, and specific.`;

function summarizeRun(run) {
  return {
    id: run.id,
    createdAt: run.created_at,
    platform: run.platform,
    status: run.status,
    headline: run.summary_json?.headline || '',
    executiveSummary: run.summary_json?.executiveSummary || '',
    overallRisk: run.summary_json?.overallRisk || '',
    severityCounts: run.summary_json?.severityCounts || {},
    findings: run.result_json?.findings || [],
    facts: run.result_json?.facts || {}
  };
}

async function resolveContextRun(userId, runId = null) {
  if (runId) {
    const run = await getAuditRun(runId);
    if (!run) {
      throw new Error('Audit run not found');
    }
    return run;
  }

  const runs = await listAuditRuns({ userId, limit: 10 });
  const run = runs.find((candidate) => candidate.status === 'success' && candidate.summary_json?.headline) || runs[0] || null;
  if (!run) {
    throw new Error('Run an audit first so the assistant has context to work from');
  }
  return run;
}

export async function answerAuditChat({ userId, prompt, runId = null, modelId = null, providerPreset = DEFAULT_AUDIT_PRESET_ID }) {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) {
    throw new Error('Prompt is required');
  }

  assertAuditPresetConfigured(providerPreset);
  const contextRun = await resolveContextRun(userId, runId);
  if (contextRun.user_id !== userId) {
    throw new Error('Audit run does not belong to the selected client');
  }

  if (contextRun.status !== 'success' || !contextRun.result_json || !contextRun.summary_json) {
    throw new Error('The selected audit run does not contain usable context yet');
  }

  const resolvedModel = resolveAuditModel(providerPreset, modelId);
  const contextPayload = summarizeRun(contextRun);
  const response = await generateAiResponse({
    model: resolvedModel,
    systemPrompt: CHAT_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 1200,
    prompt: `Audit context JSON:\n${JSON.stringify(contextPayload, null, 2)}\n\nUser question:\n${trimmedPrompt}`
  });

  return {
    message: response,
    model: resolvedModel,
    run: {
      id: contextRun.id,
      createdAt: contextRun.created_at,
      headline: contextRun.summary_json?.headline || 'Audit run'
    }
  };
}
