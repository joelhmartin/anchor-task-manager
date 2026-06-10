import { query } from '../../db.js';
import { fetchCTMApiAnalytics } from './ctmApiAdapter.js';
import { fetchGA4Analytics } from './ga4Adapter.js';
import { fetchMetaAdsAnalytics } from './metaAdsAdapter.js';
import { fetchGoogleAdsAnalytics } from './googleAdsAdapter.js';

// Agency-level Meta System User token (never expires, no OAuth needed)
const META_SYSTEM_TOKEN = process.env.FACEBOOK_SYSTEM_USER_TOKEN || null;

/**
 * Fetch unified analytics for a client across all platforms.
 * Uses agency-level credentials:
 *   - GA4: Service account key file (no token needed)
 *   - Meta: System user token from env var
 *   - Google Ads: Stub (pending developer token)
 *   - CTM: CTM calls API + local form submissions
 *
 * @param {string} userId - Client user ID (UUID)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {object} [overrides] - Optional hardcoded IDs for test mode
 * @returns {object} Unified analytics response
 */
export async function fetchUnifiedAnalytics(userId, startDate, endDate, overrides = {}) {
  const errors = [];

  // Load tracking config for this client
  const configRes = await query('SELECT * FROM tracking_configs WHERE user_id = $1', [userId]);
  const config = configRes.rows[0] || {};
  const clientType = config.client_type || null;
  const metaConversionsEnabled = clientType !== 'medical';

  // Resolve platform IDs (overrides for test mode, config for production)
  const ga4PropertyId = overrides.ga4PropertyId || config.ga4_property_id;
  const metaAdAccountId = overrides.metaAdAccountId || config.meta_ad_account_id;

  // Resolve the client's Meta campaign allowlist.
  // When a meta_ad_account_id is configured but zero campaigns are claimed,
  // short-circuit the Meta fetch (returns null) rather than leaking full-account data.
  // A DB failure here degrades to "Meta null" (not "everything broken").
  let allowedMetaCampaignIds = [];
  let claimsResolutionFailed = false;
  if (metaAdAccountId) {
    try {
      const claimsRes = await query(
        `SELECT campaign_id FROM tracking_campaign_claims
         WHERE user_id = $1 AND platform = 'meta' AND ad_account_id = $2`,
        [userId, metaAdAccountId.startsWith('act_') ? metaAdAccountId : `act_${metaAdAccountId}`]
      );
      allowedMetaCampaignIds = claimsRes.rows.map((r) => r.campaign_id);
    } catch (err) {
      console.error('[analytics] claim resolution failed:', err.message);
      errors.push({ scope: 'metaAds', message: 'Failed to resolve campaign allowlist' });
      claimsResolutionFailed = true;
    }
  }
  const metaAllowlistEmpty = !!metaAdAccountId && (claimsResolutionFailed || allowedMetaCampaignIds.length === 0);

  const googleAdsCustomerId = overrides.googleAdsCustomerId || config.google_ads_customer_id;

  const metaToken = META_SYSTEM_TOKEN;

  // Run all adapters in parallel — only call each if the client has that platform configured
  const [ctm, ga4, metaAds, googleAds] = await Promise.allSettled([
    fetchCTMApiAnalytics(userId, startDate, endDate),
    ga4PropertyId
      ? fetchGA4Analytics(ga4PropertyId, startDate, endDate)
      : Promise.resolve(null),
    metaToken && metaAdAccountId && !metaAllowlistEmpty
      ? fetchMetaAdsData(metaToken, metaAdAccountId, startDate, endDate, { allowedCampaignIds: allowedMetaCampaignIds })
      : Promise.resolve(null),
    googleAdsCustomerId
      ? fetchGoogleAdsAnalytics(googleAdsCustomerId, startDate, endDate)
      : Promise.resolve(null)
  ]);

  // Unwrap results, logging errors for failed adapters
  const ctmData = unwrapResult(ctm, 'ctm', errors);
  const ga4Data = unwrapResult(ga4, 'ga4', errors);
  const metaData = unwrapResult(metaAds, 'metaAds', errors);
  const googleAdsData = unwrapResult(googleAds, 'googleAds', errors);

  // Compute blended KPIs
  // Source of truth: CTM qualified leads (calls + forms with score >= 3).
  // Ad platform "conversions" are NOT added — they often double-count the same
  // leads via server-side relay (offline conversion import). They're shown
  // separately as "Platform-Reported Conversions" in Paid Ads.
  const totalLeads = ctmData?.qualifiedCalls || 0;
  const totalSpend = (metaData?.spend || 0) + (googleAdsData?.spend || 0);
  const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const totalSessions = ga4Data?.sessions || 0;
  const totalEngagedSessions = ga4Data?.engagedSessions || 0;
  const conversionRate = totalEngagedSessions > 0 ? (totalLeads / totalEngagedSessions) * 100 : 0;

  // Merge time series from all platforms
  const timeSeries = mergeTimeSeries(startDate, endDate, {
    ctm: ctmData?.timeSeries || [],
    ga4: ga4Data?.timeSeries || [],
    metaAds: metaData?.timeSeries || [],
    googleAds: googleAdsData?.timeSeries || []
  });

  return {
    dateRange: { start: startDate, end: endDate },
    clientContext: {
      clientType,
      metaConversionsEnabled
    },
    kpis: {
      totalLeads,
      totalSpend: Math.round(totalSpend * 100) / 100,
      costPerLead: Math.round(costPerLead * 100) / 100,
      totalSessions,
      totalEngagedSessions,
      conversionRate: Math.round(conversionRate * 100) / 100
    },
    byPlatform: {
      ga4: ga4Data,
      googleAds: googleAdsData,
      metaAds: metaData
        ? (ctmData
            ? applyCtmMetaConversions(metaData, ctmData, metaConversionsEnabled)
            : { ...metaData, metaConversionsEnabled })
        : metaData,
      ctm: ctmData
    },
    timeSeries,
    errors
  };
}

/**
 * Fetch Meta Ads data for a specific ad account, or try to find the right one.
 */
async function fetchMetaAdsData(accessToken, adAccountId, startDate, endDate, options = {}) {
  if (!adAccountId) return null;
  const id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  return fetchMetaAdsAnalytics(accessToken, id, startDate, endDate, options);
}

// Replace Meta Pixel-reported conversions with CTM-derived counts:
//   leads        = CTM calls with last_location matching the Meta-paid regex and score >= 3
//   conversions  = same set, but score === 5
// The original Pixel value is preserved under `pixelConversions` for transparency.
//
// When metaConversionsEnabled is false (e.g., medical clients — HIPAA gate
// applies because we can't ship CTM-derived counts back to Meta CAPI either),
// pass Meta data through unchanged with just the flag attached.
function applyCtmMetaConversions(metaData, ctmData, metaConversionsEnabled) {
  if (!metaConversionsEnabled) {
    return { ...metaData, metaConversionsEnabled };
  }
  const leads = ctmData?.metaPaidLeads ?? 0;
  const conversions = ctmData?.metaPaidConversions ?? 0;
  const spend = metaData.spend || 0;
  return {
    ...metaData,
    pixelConversions: metaData.conversions || 0,
    leads,
    conversions,
    costPerConversion: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
    metaConversionsEnabled
  };
}

function unwrapResult(settled, name, errors) {
  if (settled.status === 'fulfilled') return settled.value;
  console.error(`[analytics] ${name} adapter failed:`, settled.reason?.message || settled.reason);
  errors.push({ scope: name, message: settled.reason?.message || 'Unknown error' });
  return null;
}

/**
 * Merge time series from different platforms into a single array keyed by date.
 * Fills in missing dates with zeros.
 */
function mergeTimeSeries(startDate, endDate, sources) {
  const dateMap = new Map();

  // Create entries for every date in range
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0];
    dateMap.set(key, { date: key, sessions: 0, leads: 0, spend: 0, calls: 0 });
  }

  // Merge GA4
  for (const row of sources.ga4) {
    const entry = dateMap.get(row.date);
    if (entry) {
      entry.sessions = row.sessions || 0;
    }
  }

  // Merge CTM
  for (const row of sources.ctm) {
    const entry = dateMap.get(row.date);
    if (entry) {
      entry.calls = row.calls || 0;
      entry.leads += row.qualified || 0;
    }
  }

  // Merge Meta Ads
  for (const row of sources.metaAds) {
    const entry = dateMap.get(row.date);
    if (entry) {
      entry.spend += row.spend || 0;
    }
  }

  // Merge Google Ads
  for (const row of sources.googleAds) {
    const entry = dateMap.get(row.date);
    if (entry) {
      entry.spend += row.spend || 0;
    }
  }

  return Array.from(dateMap.values());
}
