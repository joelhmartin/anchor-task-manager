/**
 * AI-powered web report generator.
 *
 * The model returns a report blueprint, not widget values. KPI, chart, and table
 * blocks must point at data-package keys so rendering stays repeatable across
 * clients and scheduled runs.
 */

import { generateAiResponse } from '../ai.js';
import {
  REPORT_OUTPUT_SCHEMA,
  ReportGenerationError,
  validateReportOutput,
  resolveDataKey
} from './reportProtocol.js';

function flattenDataCatalog(value, prefix = '', out = [], depth = 0) {
  if (out.length >= 160 || depth > 5 || value == null) return out;

  if (Array.isArray(value)) {
    const sample = value.find((row) => row && typeof row === 'object' && !Array.isArray(row));
    if (sample) {
      out.push(`${prefix}: array rows with fields [${Object.keys(sample).join(', ')}]`);
    } else {
      out.push(`${prefix}: array${value.length === 0 ? ' (empty)' : ''}`);
    }
    return out;
  }

  if (typeof value !== 'object') {
    out.push(`${prefix}: ${typeof value}`);
    return out;
  }

  for (const key of Object.keys(value).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = value[key];
    if (child == null || typeof child !== 'object') {
      out.push(`${path}: ${child == null ? 'null' : typeof child}`);
    } else {
      flattenDataCatalog(child, path, out, depth + 1);
    }
  }
  return out;
}

function buildPrompt({ prompt, styleRecipe, dataPackage, validationErrors = null }) {
  const catalog = flattenDataCatalog(dataPackage).slice(0, 160);
  const validationBlock = validationErrors?.length
    ? [
        '',
        'VALIDATION ERRORS FROM PRIOR ATTEMPT:',
        ...validationErrors.map((e) => `- ${e}`),
        'Correct these errors while keeping the report useful.'
      ].join('\n')
    : '';

  return [
    'BRIEF FROM ADMIN:',
    prompt,
    '',
    'STYLE RECIPE:',
    JSON.stringify(styleRecipe || {}),
    '',
    'DATA KEY CATALOG:',
    catalog.map((line) => `- ${line}`).join('\n'),
    '',
    'DATA PACKAGE (the only facts you may cite):',
    JSON.stringify(dataPackage),
    validationBlock
  ].join('\n');
}

const SYSTEM_PROMPT = `You are a senior marketing analyst creating a reusable web-report blueprint for a marketing agency.
Return JSON only. The report must match the provided response schema.

Rules:
- Every factual claim must come from the data package.
- KPI sections must use metric_key references. Do not return KPI values.
- Chart sections must use data_key, x_key, and series[]. Do not return inline chart data.
- Table sections must use data_key and columns[]. Do not return inline rows.
- Narrative and callout sections may contain prose, but source_keys must identify the supporting data paths.
- If a requested source is unavailable or empty, use a short callout instead of inventing data.
- Use these exact package paths when available: by_platform.ga4, by_platform.google_ads, by_platform.meta_ads, by_platform.ctm, time_series, kpis, reviews, tasks.
- Do not include HTML, scripts, external URLs, lead names, caller names, phone numbers, email addresses, or patient-identifying details.`;

export { REPORT_OUTPUT_SCHEMA, ReportGenerationError };

export async function generateAiWebReport({ prompt, dataPackage, styleRecipe, modelName }) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    throw new ReportGenerationError('prompt is required');
  }
  if (!dataPackage || typeof dataPackage !== 'object') {
    throw new ReportGenerationError('dataPackage is required');
  }

  let lastMetadata = null;
  let validationErrors = null;
  let parseFailed = false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const systemPrompt = attempt === 1
      ? SYSTEM_PROMPT
      : `${SYSTEM_PROMPT}\n\nThis is a repair attempt. Return a single valid JSON object only.`;

    const userPrompt = buildPrompt({
      prompt,
      styleRecipe,
      dataPackage,
      validationErrors
    });

    let result;
    try {
      result = await generateAiResponse({
        prompt: userPrompt,
        systemPrompt,
        temperature: 0.1,
        topP: 0.8,
        candidateCount: 1,
        maxTokens: 12000,
        ...(modelName ? { model: modelName } : {}),
        responseMimeType: 'application/json',
        responseSchema: REPORT_OUTPUT_SCHEMA,
        returnMetadata: true
      });
    } catch (err) {
      throw new ReportGenerationError(`Vertex call failed: ${err.message || err}`);
    }

    lastMetadata = result.metadata;

    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch (err) {
      parseFailed = true;
      validationErrors = ['Output was not parseable JSON'];
      continue;
    }

    try {
      validateReportOutput(parsed, dataPackage);
      return parsed;
    } catch (err) {
      if (!(err instanceof ReportGenerationError)) throw err;
      validationErrors = err.details?.validationErrors || [err.message];
      parseFailed = false;
    }
  }

  console.error('[reports.aiGenerator] generation failed', {
    parseFailed,
    validationErrors,
    finishReason: lastMetadata?.finishReason,
    usage: lastMetadata?.usageMetadata,
    model: modelName || undefined
  });

  const suffix = validationErrors?.length ? ` ${validationErrors.slice(0, 4).join('; ')}` : '';
  throw new ReportGenerationError(
    parseFailed
      ? 'AI output could not be parsed as JSON after retry.'
      : `AI output did not pass report validation.${suffix}`,
    { validationErrors, metadata: lastMetadata }
  );
}

export function getDataKeyValue(dataPackage, key) {
  return resolveDataKey(dataPackage, key);
}
