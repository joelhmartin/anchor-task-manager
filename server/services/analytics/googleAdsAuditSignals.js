import { GoogleAdsApi } from 'google-ads-api';

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN || null;
const MANAGER_CUSTOMER_ID = process.env.GOOGLE_ADS_MANAGER_ID || '6996750299';
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || null;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || null;

let adsClient = null;

function isConfigured() {
  return Boolean(DEVELOPER_TOKEN && REFRESH_TOKEN && CLIENT_ID && CLIENT_SECRET);
}

function getClient() {
  if (!adsClient) {
    adsClient = new GoogleAdsApi({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      developer_token: DEVELOPER_TOKEN
    });
  }
  return adsClient;
}

function getCustomer(customerId) {
  return getClient().Customer({
    customer_id: String(customerId || '').replace(/-/g, ''),
    refresh_token: REFRESH_TOKEN,
    login_customer_id: MANAGER_CUSTOMER_ID
  });
}

export async function fetchCampaignDeliverySignals(customerId, startDate, endDate) {
  if (!isConfigured() || !customerId) return null;

  const customer = getCustomer(customerId);
  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `);

  return rows.map((row) => ({
    id: String(row.campaign?.id || ''),
    name: row.campaign?.name || '',
    status: row.campaign?.status || 'UNKNOWN',
    spend: Math.round(((Number(row.metrics?.cost_micros || 0) / 1_000_000) || 0) * 100) / 100,
    searchImpressionShare: Number(row.metrics?.search_impression_share || 0),
    budgetLostImpressionShare: Number(row.metrics?.search_budget_lost_impression_share || 0),
    rankLostImpressionShare: Number(row.metrics?.search_rank_lost_impression_share || 0)
  }));
}

export async function fetchKeywordQualitySummary(customerId, startDate, endDate) {
  if (!isConfigured() || !customerId) return null;

  const customer = getCustomer(customerId);
  const rows = await customer.query(`
    SELECT
      ad_group_criterion.quality_info.quality_score,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions
    FROM keyword_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 1000
  `);

  const distribution = new Map();
  let lowQualityKeywordCount = 0;
  let lowQualitySpend = 0;
  let totalKeywordCount = 0;
  let totalKeywordSpend = 0;

  for (const row of rows) {
    const qualityScore = row.ad_group_criterion?.quality_info?.quality_score;
    const spend = Number(row.metrics?.cost_micros || 0) / 1_000_000;
    if (qualityScore == null) continue;
    totalKeywordCount += 1;
    totalKeywordSpend += spend;
    distribution.set(qualityScore, (distribution.get(qualityScore) || 0) + 1);
    if (Number(qualityScore) <= 5) {
      lowQualityKeywordCount += 1;
      lowQualitySpend += spend;
    }
  }

  return {
    totalKeywordCount,
    totalKeywordSpend: Math.round(totalKeywordSpend * 100) / 100,
    lowQualityKeywordCount,
    lowQualitySpend: Math.round(lowQualitySpend * 100) / 100,
    lowQualityRate: totalKeywordCount > 0 ? lowQualityKeywordCount / totalKeywordCount : 0,
    lowQualitySpendRate: totalKeywordSpend > 0 ? lowQualitySpend / totalKeywordSpend : 0,
    distribution: Array.from(distribution.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([qualityScore, count]) => ({ qualityScore: Number(qualityScore), count }))
  };
}

export async function fetchHighSpendSearchTerms(customerId, startDate, endDate) {
  if (!isConfigured() || !customerId) return null;

  const customer = getCustomer(customerId);
  const rows = await customer.query(`
    SELECT
      search_term_view.search_term,
      campaign.id,
      campaign.name,
      segments.keyword.info.text,
      segments.keyword.info.match_type,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `);

  return rows.map((row) => {
    const spend = Number(row.metrics?.cost_micros || 0) / 1_000_000;
    const impressions = Number(row.metrics?.impressions || 0);
    const clicks = Number(row.metrics?.clicks || 0);
    return {
      searchTerm: row.search_term_view?.search_term || '',
      campaignId: String(row.campaign?.id || ''),
      campaignName: row.campaign?.name || '',
      keyword: row.segments?.keyword?.info?.text || '',
      matchType: row.segments?.keyword?.info?.match_type || '',
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      conversions: Number(row.metrics?.conversions || 0)
    };
  });
}
