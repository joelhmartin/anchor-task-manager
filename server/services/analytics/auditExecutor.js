import { query } from '../../db.js';
import { generateAiResponse } from '../ai.js';
import { fetchUnifiedAnalytics } from './index.js';
import { evaluateRules } from './insightRules.js';
import { fetchSearchTerms } from './googleAdsAdapter.js';
import { fetchCampaignDeliverySignals, fetchHighSpendSearchTerms, fetchKeywordQualitySummary } from './googleAdsAuditSignals.js';
import { assertAuditPresetConfigured, getAuditSystemPrompt, resolveAuditModel } from './auditPresets.js';

const AUDIT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    executiveSummary: { type: 'STRING' },
    overallRisk: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    prioritizedFindingIds: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    topRecommendations: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    }
  },
  required: ['headline', 'executiveSummary', 'overallRisk']
};

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

export function resolveAuditDateRange(lookbackDays = 30, referenceDate = new Date()) {
  const safeLookbackDays = Number.isFinite(Number(lookbackDays)) ? Math.max(1, Math.min(90, Number(lookbackDays))) : 30;
  const end = new Date(referenceDate);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - 1);

  const start = new Date(end);
  start.setDate(start.getDate() - (safeLookbackDays - 1));

  const comparisonEnd = new Date(start);
  comparisonEnd.setDate(comparisonEnd.getDate() - 1);

  const comparisonStart = new Date(comparisonEnd);
  comparisonStart.setDate(comparisonStart.getDate() - (safeLookbackDays - 1));

  return {
    lookbackDays: safeLookbackDays,
    startDate: formatDate(start),
    endDate: formatDate(end),
    comparisonStartDate: formatDate(comparisonStart),
    comparisonEndDate: formatDate(comparisonEnd)
  };
}

function toCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function percentDelta(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function buildRuleFindings(current, comparison) {
  return evaluateRules(current, comparison).map((alert, index) => ({
    id: `rule-${index + 1}`,
    category: 'rule_engine',
    severity: alert.severity === 'error' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info',
    title: alert.title,
    summary: alert.description,
    recommendation: alert.recommendation,
    evidence: []
  }));
}

function buildSpendZeroConversionFindings(current) {
  const campaigns = current.byPlatform?.googleAds?.campaigns || [];
  return campaigns
    .filter((campaign) => (campaign.spend || 0) >= 50 && Number(campaign.conversions || 0) === 0)
    .slice(0, 8)
    .map((campaign) => ({
      id: `zero-conv-${campaign.id}`,
      category: 'spend_zero_conversions',
      severity: campaign.spend >= 150 ? 'critical' : 'warning',
      title: `${campaign.name} spent ${toCurrency(campaign.spend)} with zero conversions`,
      summary: `Campaign recorded ${campaign.clicks || 0} clicks and ${campaign.impressions || 0} impressions without a tracked conversion in the audit window.`,
      recommendation: 'Review targeting, search terms, and landing page alignment before allowing more spend.',
      evidence: [
        { label: 'Spend', value: toCurrency(campaign.spend) },
        { label: 'Clicks', value: String(campaign.clicks || 0) },
        { label: 'Impressions', value: String(campaign.impressions || 0) }
      ]
    }));
}

function buildEfficiencyFindings(current, comparison) {
  const findings = [];
  const currentCpc = current.byPlatform?.googleAds?.cpc || 0;
  const previousCpc = comparison?.byPlatform?.googleAds?.cpc || 0;
  const cpcChange = percentDelta(currentCpc, previousCpc);
  if (cpcChange !== null && cpcChange >= 20) {
    findings.push({
      id: 'cpc-deterioration',
      category: 'cpc_deterioration',
      severity: cpcChange >= 35 ? 'critical' : 'warning',
      title: `Google Ads CPC increased ${Math.round(cpcChange)}%`,
      summary: `Average CPC moved from ${toCurrency(previousCpc)} to ${toCurrency(currentCpc)} across the selected window.`,
      recommendation: 'Inspect auction pressure, broad-match waste, and ad relevance before increasing budgets.',
      evidence: [
        { label: 'Previous CPC', value: toCurrency(previousCpc) },
        { label: 'Current CPC', value: toCurrency(currentCpc) }
      ]
    });
  }

  const currentCpql = current.kpis?.costPerLead || 0;
  const previousCpql = comparison?.kpis?.costPerLead || 0;
  const cpqlChange = percentDelta(currentCpql, previousCpql);
  if (cpqlChange !== null && cpqlChange >= 20) {
    findings.push({
      id: 'cpql-deterioration',
      category: 'cpql_deterioration',
      severity: cpqlChange >= 35 ? 'critical' : 'warning',
      title: `Cost per qualified lead increased ${Math.round(cpqlChange)}%`,
      summary: `Overall CPQL moved from ${toCurrency(previousCpql)} to ${toCurrency(currentCpql)} while CTM-qualified lead volume softened.`,
      recommendation: 'Prioritize the campaigns and search terms driving spend without qualified leads.',
      evidence: [
        { label: 'Previous CPQL', value: toCurrency(previousCpql) },
        { label: 'Current CPQL', value: toCurrency(currentCpql) }
      ]
    });
  }

  return findings;
}

function buildSearchTermFindings(searchTerms = []) {
  const wastedTerms = searchTerms
    .filter((term) => (term.spend || 0) >= 25 && Number(term.conversions || 0) === 0)
    .slice(0, 5);

  if (!wastedTerms.length) return [];

  const totalWastedSpend = wastedTerms.reduce((sum, term) => sum + Number(term.spend || 0), 0);
  return [
    {
      id: 'search-term-waste',
      category: 'search_term_waste',
      severity: totalWastedSpend >= 150 ? 'critical' : 'warning',
      title: `${wastedTerms.length} search terms consumed ${toCurrency(totalWastedSpend)} without conversions`,
      summary: wastedTerms.map((term) => `${term.searchTerm} (${toCurrency(term.spend)})`).join('; '),
      recommendation: 'Review these terms for negatives, tighter match types, or campaign exclusions.',
      evidence: wastedTerms.map((term) => ({
        label: term.searchTerm,
        value: `${toCurrency(term.spend)} | ${term.clicks || 0} clicks`
      }))
    }
  ];
}

function buildQualityScoreFindings(keywordSummary) {
  if (!keywordSummary || !keywordSummary.lowQualityKeywordCount) return [];
  if (keywordSummary.lowQualityKeywordCount < 3) return [];
  if (keywordSummary.lowQualityRate < 0.25 && keywordSummary.lowQualitySpend < 100) return [];

  return [
    {
      id: 'quality-score-concentration',
      category: 'low_quality_score',
      severity: keywordSummary.lowQualityRate >= 0.4 ? 'critical' : 'warning',
      title: `${keywordSummary.lowQualityKeywordCount} keywords are scoring 5 or lower`,
      summary: `${Math.round(keywordSummary.lowQualityRate * 100)}% of sampled keywords fall into low quality score territory, representing ${toCurrency(keywordSummary.lowQualitySpend)} in spend.`,
      recommendation: 'Audit ad relevance, landing page match, and keyword intent before scaling those ad groups.',
      evidence: [
        { label: 'Low-QS keywords', value: String(keywordSummary.lowQualityKeywordCount) },
        { label: 'Low-QS spend', value: toCurrency(keywordSummary.lowQualitySpend) }
      ]
    }
  ];
}

function buildDeliveryFindings(campaignSignals = []) {
  const constrained = campaignSignals
    .filter((campaign) => (campaign.budgetLostImpressionShare || 0) >= 0.2 || (campaign.rankLostImpressionShare || 0) >= 0.25)
    .slice(0, 4);

  if (!constrained.length) return [];

  return [
    {
      id: 'delivery-constraints',
      category: 'delivery_constraints',
      severity: 'warning',
      title: `${constrained.length} campaigns show notable delivery loss`,
      summary: constrained
        .map(
          (campaign) =>
            `${campaign.name} (budget lost ${(campaign.budgetLostImpressionShare * 100).toFixed(0)}%, rank lost ${(campaign.rankLostImpressionShare * 100).toFixed(0)}%)`
        )
        .join('; '),
      recommendation: 'Review whether impression share loss is a deliberate budget cap or a ranking issue caused by weak quality/ad rank.',
      evidence: constrained.map((campaign) => ({
        label: campaign.name,
        value: `Budget lost ${(campaign.budgetLostImpressionShare * 100).toFixed(0)}% | Rank lost ${(campaign.rankLostImpressionShare * 100).toFixed(0)}%`
      }))
    }
  ];
}

function buildTrackingGapFindings(current, connections) {
  const findings = [];
  const errors = current.errors || [];
  if (errors.length) {
    findings.push({
      id: 'analytics-errors',
      category: 'tracking_gap',
      severity: 'warning',
      title: 'Some analytics sources failed during the audit',
      summary: errors.map((error) => `${error.scope}: ${error.message}`).join('; '),
      recommendation: 'Resolve upstream API/auth issues before trusting trend analysis.',
      evidence: errors.map((error) => ({ label: error.scope, value: error.message }))
    });
  }

  if (!connections?.ga4) {
    findings.push({
      id: 'missing-ga4',
      category: 'tracking_gap',
      severity: 'info',
      title: 'GA4 is not connected for this client',
      summary: 'Traffic and session-side context is incomplete without GA4 data.',
      recommendation: 'Complete the analytics connection so traffic drops can be validated alongside ad performance.',
      evidence: []
    });
  }

  return findings;
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    if (seen.has(finding.id)) return false;
    seen.add(finding.id);
    return true;
  });
}

function countSeverities(findings) {
  return findings.reduce(
    (acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] || 0) + 1;
      return acc;
    },
    { critical: 0, warning: 0, info: 0 }
  );
}

function orderFindings(findings, prioritizedFindingIds = []) {
  if (!prioritizedFindingIds.length) return findings;
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const ordered = prioritizedFindingIds.map((id) => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(ordered.map((finding) => finding.id));
  return [...ordered, ...findings.filter((finding) => !orderedIds.has(finding.id))];
}

function parseAuditModelOutput(rawResponse) {
  const rawText = String(rawResponse || '').trim();
  const parsed = JSON.parse(rawText);

  return {
    headline: String(parsed.headline || '').trim(),
    executiveSummary: String(parsed.executiveSummary || '').trim(),
    overallRisk: ['low', 'medium', 'high'].includes(parsed.overallRisk) ? parsed.overallRisk : 'medium',
    prioritizedFindingIds: Array.isArray(parsed.prioritizedFindingIds)
      ? parsed.prioritizedFindingIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    topRecommendations: Array.isArray(parsed.topRecommendations)
      ? parsed.topRecommendations.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
      : []
  };
}

async function loadClientConnections(userId) {
  const trackingConfigRes = await query(
    `SELECT ga4_property_id, google_ads_customer_id, meta_ad_account_id
     FROM tracking_configs
     WHERE user_id = $1`,
    [userId]
  );
  const trackingConfig = trackingConfigRes.rows[0] || {};
  const ctmRes = await query('SELECT ctm_account_number FROM client_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  const hasCtm = Boolean(ctmRes.rows[0]?.ctm_account_number);

  return {
    ga4: Boolean(trackingConfig.ga4_property_id),
    googleAds: Boolean(trackingConfig.google_ads_customer_id),
    meta: Boolean(trackingConfig.meta_ad_account_id),
    ctm: hasCtm
  };
}

export async function executeAudit({ userId, providerPreset, lookbackDays = 30, platform = 'google_ads', modelId = null }) {
  if (platform !== 'google_ads') {
    throw new Error('Only Google Ads audits are supported in v1');
  }

  const preset = assertAuditPresetConfigured(providerPreset);
  const resolvedModel = resolveAuditModel(providerPreset, modelId);
  const dateRange = resolveAuditDateRange(lookbackDays);

  const trackingConfigRes = await query(
    'SELECT google_ads_customer_id FROM tracking_configs WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  const googleAdsCustomerId = trackingConfigRes.rows[0]?.google_ads_customer_id;
  if (!googleAdsCustomerId) {
    throw new Error('Google Ads account is not configured for this client');
  }

  const [
    current,
    comparison,
    connections,
    baselineSearchTerms,
    auditSearchTerms,
    keywordSummary,
    campaignSignals
  ] = await Promise.all([
    fetchUnifiedAnalytics(userId, dateRange.startDate, dateRange.endDate),
    fetchUnifiedAnalytics(userId, dateRange.comparisonStartDate, dateRange.comparisonEndDate),
    loadClientConnections(userId),
    fetchSearchTerms(googleAdsCustomerId, dateRange.startDate, dateRange.endDate).catch(() => []),
    fetchHighSpendSearchTerms(googleAdsCustomerId, dateRange.startDate, dateRange.endDate).catch(() => []),
    fetchKeywordQualitySummary(googleAdsCustomerId, dateRange.startDate, dateRange.endDate).catch(() => null),
    fetchCampaignDeliverySignals(googleAdsCustomerId, dateRange.startDate, dateRange.endDate).catch(() => [])
  ]);

  const safeBaselineSearchTerms = baselineSearchTerms || [];
  const safeAuditSearchTerms = auditSearchTerms || [];
  const safeCampaignSignals = campaignSignals || [];

  const candidateFindings = dedupeFindings([
    ...buildRuleFindings(current, comparison),
    ...buildSpendZeroConversionFindings(current),
    ...buildEfficiencyFindings(current, comparison),
    ...buildSearchTermFindings(safeAuditSearchTerms.length ? safeAuditSearchTerms : safeBaselineSearchTerms),
    ...buildQualityScoreFindings(keywordSummary),
    ...buildDeliveryFindings(safeCampaignSignals),
    ...buildTrackingGapFindings(current, connections)
  ]).slice(0, 12);

  const candidateSeverityCounts = countSeverities(candidateFindings);
  const promptPayload = {
    auditWindow: {
      start: dateRange.startDate,
      end: dateRange.endDate,
      comparisonStart: dateRange.comparisonStartDate,
      comparisonEnd: dateRange.comparisonEndDate
    },
    topLineKpis: current.kpis || {},
    googleAdsSummary: current.byPlatform?.googleAds || {},
    connections,
    candidateFindings
  };

  const rawModelOutput = await generateAiResponse({
    model: resolvedModel,
    systemPrompt: getAuditSystemPrompt(),
    temperature: 0.2,
    maxTokens: 1200,
    responseMimeType: 'application/json',
    responseSchema: AUDIT_RESPONSE_SCHEMA,
    prompt: `Rank and summarize this Google Ads audit payload. Use only the provided JSON.\n\n${JSON.stringify(promptPayload, null, 2)}`
  });

  const aiOutput = parseAuditModelOutput(rawModelOutput);
  const orderedFindings = orderFindings(candidateFindings, aiOutput.prioritizedFindingIds || []);
  const severityCounts = countSeverities(orderedFindings);

  return {
    dateRange,
    summary: {
      headline: aiOutput.headline,
      executiveSummary: aiOutput.executiveSummary,
      overallRisk: aiOutput.overallRisk,
      topRecommendations: aiOutput.topRecommendations || [],
      severityCounts,
      candidateSeverityCounts
    },
    result: {
      platform,
      providerPreset,
      findings: orderedFindings,
      topRecommendations: aiOutput.topRecommendations || [],
      facts: {
        kpis: current.kpis || {},
        googleAds: {
          spend: current.byPlatform?.googleAds?.spend || 0,
          clicks: current.byPlatform?.googleAds?.clicks || 0,
          conversions: current.byPlatform?.googleAds?.conversions || 0,
          cpc: current.byPlatform?.googleAds?.cpc || 0
        },
        comparisonKpis: comparison.kpis || {},
        keywordSummary,
        campaignSignals: safeCampaignSignals,
        sampleSearchTerms: (safeAuditSearchTerms.length ? safeAuditSearchTerms : safeBaselineSearchTerms).slice(0, 10),
        connections,
        errors: current.errors || []
      }
    },
    debug: {
      provider: preset.provider,
      model: resolvedModel,
      promptPayload,
      usage: null,
      response: null
    }
  };
}
