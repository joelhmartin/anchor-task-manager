import { GoogleAdsApi } from 'google-ads-api';

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN || null;
const MANAGER_CUSTOMER_ID = process.env.GOOGLE_ADS_MANAGER_ID || '6996750299';

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || null;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || null;

// Google Ads API returns status as numeric enums
const STATUS_MAP = { 0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'ENABLED', 3: 'PAUSED', 4: 'REMOVED' };
function resolveStatus(val) {
  if (typeof val === 'string') return val;
  return STATUS_MAP[val] || 'UNKNOWN';
}

let adsClient = null;

function getClient() {
  if (!adsClient) {
    adsClient = new GoogleAdsApi({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      developer_token: DEVELOPER_TOKEN,
    });
  }
  return adsClient;
}

function getCustomer(customerId) {
  return getClient().Customer({
    customer_id: customerId,
    refresh_token: REFRESH_TOKEN,
    login_customer_id: MANAGER_CUSTOMER_ID,
  });
}

/**
 * Fetch Google Ads analytics for a customer account.
 * @param {string} customerId - Google Ads customer ID (e.g. '179-2914-4196' or '1792914196')
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {object|null}
 */
export async function fetchGoogleAdsAnalytics(customerId, startDate, endDate) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) {
    // Google Ads API requires a developer token with Basic Access (not Test Account).
    // Apply at: Google Ads Manager → Tools & Settings → API Center
    return null;
  }

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);

  const summaryQuery = `
    SELECT
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;

  const campaignQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const timeSeriesQuery = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY segments.date
  `;

  const [summaryRes, campaignsRes, timeSeriesRes] = await Promise.all([
    customer.query(summaryQuery),
    customer.query(campaignQuery),
    customer.query(timeSeriesQuery)
  ]);

  // Parse summary
  const summaryRow = summaryRes[0]?.metrics || {};
  const spend = (Number(summaryRow.cost_micros || 0)) / 1_000_000;
  const clicks = Number(summaryRow.clicks || 0);
  const impressions = Number(summaryRow.impressions || 0);
  const conversions = parseFloat(summaryRow.conversions || 0);
  const cpc = spend > 0 && clicks > 0 ? spend / clicks : 0;
  const costPerConversion = conversions > 0 ? spend / conversions : 0;

  return {
    spend: Math.round(spend * 100) / 100,
    clicks,
    impressions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: Math.round(cpc * 100) / 100,
    conversions: Math.round(conversions),
    costPerConversion: Math.round(costPerConversion * 100) / 100,
    campaigns: campaignsRes.map((row) => {
      const m = row.metrics || {};
      const campSpend = (Number(m.cost_micros || 0)) / 1_000_000;
      return {
        id: String(row.campaign?.id || ''),
        name: row.campaign?.name || 'Unknown',
        status: resolveStatus(row.campaign?.status),
        spend: Math.round(campSpend * 100) / 100,
        impressions: Number(m.impressions || 0),
        clicks: Number(m.clicks || 0),
        conversions: Math.round(parseFloat(m.conversions || 0))
      };
    }),
    timeSeries: timeSeriesRes.map((row) => {
      const m = row.metrics || {};
      const daySpend = (Number(m.cost_micros || 0)) / 1_000_000;
      return {
        date: row.segments?.date || '',
        spend: Math.round(daySpend * 100) / 100,
        clicks: Number(m.clicks || 0),
        impressions: Number(m.impressions || 0)
      };
    })
  };
}

/**
 * List all client accounts under the MCC manager account.
 * @returns {Array<{id: string, name: string, isManager: boolean}>}
 */
export async function listGoogleAdsAccounts() {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return [];

  const customer = getCustomer(MANAGER_CUSTOMER_ID);
  const results = await customer.query(`
    SELECT
      customer_client.id,
      customer_client.descriptive_name,
      customer_client.manager,
      customer_client.status
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'
  `);

  return results.map((r) => ({
    id: String(r.customer_client.id),
    name: r.customer_client.descriptive_name || '',
    isManager: !!r.customer_client.manager
  }));
}

/**
 * List enabled conversion actions for a Google Ads customer account.
 * @param {string} customerId - Google Ads customer ID (with or without dashes)
 * @returns {Array<{id: string, name: string, type: string, status: string}>}
 */
export async function listConversionActions(customerId) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return [];

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);
  const results = await customer.query(`
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.type,
      conversion_action.status,
      conversion_action.tag_snippets
    FROM conversion_action
    WHERE conversion_action.status = 'ENABLED'
  `);

  return results.map((r) => {
    // Parse conversionId and conversionLabel from tag_snippets event_snippet.
    // The send_to format is: AW-{conversionId}/{conversionLabel}
    let conversionId = '';
    let conversionLabel = '';
    const snippets = r.conversion_action.tag_snippets || [];
    for (const snippet of snippets) {
      if (snippet.event_snippet) {
        const match = snippet.event_snippet.match(/send_to['":\s]+['"]AW-([^/'"]+)\/([^'"]+)['"]/);
        if (match) {
          conversionId = match[1];
          conversionLabel = match[2];
          break;
        }
      }
    }

    return {
      id: String(r.conversion_action.id),
      name: r.conversion_action.name || '',
      type: r.conversion_action.type || '',
      status: r.conversion_action.status || '',
      conversionId,
      conversionLabel,
    };
  });
}

export async function getConversionActionDetails(customerId, actionId) {
  if (!customerId || !actionId) return null;
  const actions = await listConversionActions(customerId);
  return actions.find((action) => String(action.id) === String(actionId)) || null;
}

/**
 * Fetch ad groups for a campaign with performance metrics.
 * @param {string} customerId - Google Ads customer ID (with or without dashes)
 * @param {string|number} campaignId - Campaign ID to filter by
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array|null}
 */
export async function fetchAdGroups(customerId, campaignId, startDate, endDate) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return null;

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);

  const query = `
    SELECT
      ad_group.id, ad_group.name, ad_group.status,
      metrics.cost_micros, metrics.clicks, metrics.impressions,
      metrics.ctr, metrics.conversions, metrics.cost_per_conversion
    FROM ad_group
    WHERE campaign.id = ${campaignId}
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const results = await customer.query(query);

  return results.map((row) => {
    const m = row.metrics || {};
    const clicks = Number(m.clicks || 0);
    const impressions = Number(m.impressions || 0);
    const spend = Number(m.cost_micros || 0) / 1_000_000;
    const conversions = Math.round(parseFloat(m.conversions || 0));
    const costPerConversion = conversions > 0 ? spend / conversions : 0;

    return {
      id: String(row.ad_group?.id || ''),
      name: row.ad_group?.name || '',
      status: resolveStatus(row.ad_group?.status),
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      conversions,
      costPerConversion: Math.round(costPerConversion * 100) / 100,
    };
  });
}

/**
 * Fetch ads within an ad group with performance metrics.
 * @param {string} customerId - Google Ads customer ID (with or without dashes)
 * @param {string|number} adGroupId - Ad group ID to filter by
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array|null}
 */
export async function fetchAdsForAdGroup(customerId, adGroupId, startDate, endDate) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return null;

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);

  const query = `
    SELECT
      ad_group_ad.ad.id, ad_group_ad.ad.name,
      ad_group_ad.ad.type, ad_group_ad.status,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.path1,
      ad_group_ad.ad.responsive_search_ad.path2,
      ad_group_ad.ad.final_urls,
      metrics.cost_micros, metrics.clicks, metrics.impressions,
      metrics.ctr, metrics.conversions
    FROM ad_group_ad
    WHERE ad_group.id = ${adGroupId}
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND ad_group_ad.status = 'ENABLED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const results = await customer.query(query);

  return results.map((row) => {
    const m = row.metrics || {};
    const ad = row.ad_group_ad?.ad || {};
    const clicks = Number(m.clicks || 0);
    const impressions = Number(m.impressions || 0);
    const spend = Number(m.cost_micros || 0) / 1_000_000;

    const rsa = ad.responsive_search_ad || {};
    const headlinesList = (rsa.headlines || []).map((h) => h.text).filter(Boolean);
    const descriptionsList = (rsa.descriptions || []).map((d) => d.text).filter(Boolean);
    const finalUrls = ad.final_urls || [];
    const displayDomain = deriveDisplayDomain(finalUrls[0]);

    return {
      id: String(ad.id || ''),
      name: ad.name || '',
      type: ad.type || '',
      status: resolveStatus(row.ad_group_ad?.status),
      headlines: headlinesList.join(' | '),
      descriptions: descriptionsList.join(' | '),
      headlinesList,
      descriptionsList,
      displayDomain,
      path1: rsa.path1 || '',
      path2: rsa.path2 || '',
      finalUrls,
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      conversions: Math.round(parseFloat(m.conversions || 0)),
    };
  });
}

function deriveDisplayDomain(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Fetch keyword performance for an ad group.
 * @param {string} customerId - Google Ads customer ID (with or without dashes)
 * @param {string|number} adGroupId - Ad group ID to filter by
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array|null}
 */
export async function fetchKeywords(customerId, adGroupId, startDate, endDate) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return null;

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);

  const query = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.quality_info.quality_score,
      metrics.cost_micros, metrics.clicks, metrics.impressions,
      metrics.ctr, metrics.conversions, metrics.cost_per_conversion
    FROM keyword_view
    WHERE ad_group.id = ${adGroupId}
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `;

  const results = await customer.query(query);

  return results.map((row) => {
    const m = row.metrics || {};
    const kw = row.ad_group_criterion?.keyword || {};
    const qi = row.ad_group_criterion?.quality_info || {};
    const clicks = Number(m.clicks || 0);
    const impressions = Number(m.impressions || 0);
    const spend = Number(m.cost_micros || 0) / 1_000_000;
    const conversions = Math.round(parseFloat(m.conversions || 0));
    const costPerConversion = conversions > 0 ? spend / conversions : 0;

    return {
      keyword: kw.text || '',
      matchType: kw.match_type || '',
      qualityScore: qi.quality_score != null ? Number(qi.quality_score) : null,
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      conversions,
      costPerConversion: Math.round(costPerConversion * 100) / 100,
    };
  });
}

/**
 * Fetch search term report (actual queries that triggered ads).
 * @param {string} customerId - Google Ads customer ID (with or without dashes)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string|number|null} campaignId - Optional campaign ID filter
 * @returns {Array|null}
 */
export async function fetchSearchTerms(customerId, startDate, endDate, campaignId = null) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return null;

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);

  const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : '';

  const query = `
    SELECT
      search_term_view.search_term,
      segments.keyword.info.text,
      segments.keyword.info.match_type,
      metrics.cost_micros, metrics.clicks, metrics.impressions,
      metrics.ctr, metrics.conversions
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      ${campaignFilter}
    ORDER BY metrics.impressions DESC
    LIMIT 200
  `;

  const results = await customer.query(query);

  return results.map((row) => {
    const m = row.metrics || {};
    const clicks = Number(m.clicks || 0);
    const impressions = Number(m.impressions || 0);
    const spend = Number(m.cost_micros || 0) / 1_000_000;

    return {
      searchTerm: row.search_term_view?.search_term || '',
      keyword: row.segments?.keyword?.info?.text || '',
      matchType: row.segments?.keyword?.info?.match_type || '',
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      conversions: Math.round(parseFloat(m.conversions || 0)),
    };
  });
}
