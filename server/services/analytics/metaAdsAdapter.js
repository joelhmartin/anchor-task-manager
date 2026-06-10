const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

// Sentinel id used to build a deny-all filter when a caller passes an
// explicitly empty allowedCampaignIds array. Meta treats campaign.id IN
// ['__none__'] as "no campaigns match", returning no rows.
const DENY_ALL_CAMPAIGN_ID = '__no_campaigns_matched__';

function findActionValue(actions = [], actionTypes = []) {
  const match = actions.find((item) => actionTypes.includes(item.action_type));
  return parseInt(match?.value) || 0;
}

/**
 * Normalize a Meta ad `creative{...}` object into the shape the frontend
 * preview/mockup expects. Shared by every ad-fetching path so image and video
 * creatives parse identically.
 *
 * Video creatives differ from link/image creatives in two ways that bit us:
 *   - The poster lives in `object_story_spec.video_data.image_url`
 *     (link_data uses `picture`; video_data has no `picture`), so a video ad
 *     would fall through to the tiny 64x64 `thumbnail_url`.
 *   - The published top-level `creative.video_id` can be a Reel whose video
 *     object returns no `source`. The playable file is the inner
 *     `video_data.video_id`, so we prefer that for `videoId`.
 */
function parseCreative(c = {}) {
  const story = c.object_story_spec?.link_data || c.object_story_spec?.video_data || {};
  const assetVideo = c.asset_feed_spec?.videos?.[0] || null;
  const imageHash = c.asset_feed_spec?.images?.[0]?.hash || story.image_hash || null;
  const videoId = story.video_id || assetVideo?.video_id || c.video_id || null;

  return {
    id: c.id,
    imageUrl: c.image_url || story.picture || story.image_url || null,
    imageHash,
    thumbnailUrl: c.thumbnail_url || assetVideo?.thumbnail_url || null,
    headline: c.title || story.name || story.title || null,
    body: c.body || story.message || null,
    callToAction: c.call_to_action_type || story.call_to_action?.type || null,
    linkUrl: story.link || story.call_to_action?.value?.link || null,
    isVideo: !!videoId,
    videoId,
    videoSrc: null
  };
}

/**
 * Resolve full-size image URLs for dynamic/Advantage+ creatives that only
 * carried an image hash (no direct image_url). Mutates ads in place.
 */
async function resolveImageHashes(accessToken, accountId, ads) {
  const hashesNeeded = [
    ...new Set(ads.filter((ad) => !ad.creative.imageUrl && ad.creative.imageHash).map((ad) => ad.creative.imageHash))
  ];
  if (hashesNeeded.length === 0) return;

  try {
    const hashParam = encodeURIComponent(JSON.stringify(hashesNeeded));
    const imgRes = await fetchMeta(`${accountId}/adimages?hashes=${hashParam}&fields=hash,url,url_128&access_token=${accessToken}`);
    const hashToUrl = new Map((imgRes.data || []).map((img) => [img.hash, img.url || img.url_128]));
    for (const ad of ads) {
      if (!ad.creative.imageUrl && ad.creative.imageHash) {
        ad.creative.imageUrl = hashToUrl.get(ad.creative.imageHash) || null;
      }
    }
  } catch (err) {
    console.error('[analytics] Failed to resolve image hashes:', err.message);
  }
}

/**
 * Fetch the playable source + permalink for a single Meta video object.
 * Returns null only when no videoId is supplied; upstream Graph errors
 * (rate limit, auth, 5xx) propagate so callers can distinguish a genuinely
 * missing/unplayable video from a retryable backend failure.
 * @param {string} accessToken
 * @param {string} videoId
 * @returns {Promise<{source: string|null, picture: string|null, permalinkUrl: string|null}|null>}
 */
export async function fetchVideoSource(accessToken, videoId) {
  if (!videoId) return null;
  const res = await fetchMeta(`${videoId}?fields=source,picture,permalink_url&access_token=${accessToken}`);
  return {
    source: res.source || null,
    picture: res.picture || null,
    permalinkUrl: res.permalink_url || null
  };
}

/**
 * Resolve the playable video source for a Meta ad, scoped to the client's own
 * ad account. We fetch the ad node (which carries `account_id`) and reject it
 * if it does not belong to `adAccountId` — this prevents a caller authorized
 * for one client from dereferencing arbitrary video objects elsewhere in the
 * agency's shared system-token inventory. The playable inner
 * `video_data.video_id` is resolved server-side rather than trusted from the
 * client.
 * @param {string} accessToken
 * @param {string} adAccountId - The client's configured Meta account (with/without 'act_')
 * @param {string} adId - Numeric ad id supplied by the caller
 * @returns {Promise<{source, picture, permalinkUrl}|null>}
 * @throws {Error} with statusCode 403 when the ad is outside the client's account
 */
export async function fetchAdVideoSource(accessToken, adAccountId, adId) {
  const expectedAccount = String(adAccountId).replace(/^act_/, '');
  const ad = await fetchMeta(
    `${adId}?fields=account_id,creative{video_id,object_story_spec,asset_feed_spec}&access_token=${accessToken}`
  );

  if (String(ad.account_id || '') !== expectedAccount) {
    const err = new Error('Ad does not belong to this client account');
    err.statusCode = 403;
    throw err;
  }

  const { videoId } = parseCreative(ad.creative);
  if (!videoId) return null;
  return fetchVideoSource(accessToken, videoId);
}

function buildCampaignIdClause(allowedCampaignIds) {
  if (!Array.isArray(allowedCampaignIds)) return null;
  const ids = allowedCampaignIds.length > 0 ? allowedCampaignIds : [DENY_ALL_CAMPAIGN_ID];
  return { field: 'campaign.id', operator: 'IN', value: ids };
}

function buildCampaignFilter(allowedCampaignIds) {
  const clause = buildCampaignIdClause(allowedCampaignIds);
  if (!clause) return '';
  return `&filtering=${encodeURIComponent(JSON.stringify([clause]))}`;
}

/**
 * Fetch Meta Ads analytics for an ad account within a date range.
 * @param {string} accessToken - Decrypted Facebook OAuth access token
 * @param {string} adAccountId - Meta ad account ID (with or without 'act_' prefix)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {object} { spend, reach, impressions, clicks, ctr, cpc, cpm, landingPageViews, conversions, costPerConversion, campaigns, timeSeries }
 */
export async function fetchMetaAdsAnalytics(accessToken, adAccountId, startDate, endDate, options = {}) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  const insightsFields = 'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type';
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  // Build optional campaign-id filter.
  // Semantics: option absent (undefined) = no filter. Option is an array but
  // empty = deny-all (sentinel id that matches nothing). Array with ids = use
  // them. This guards against a caller-side "I have no claims, so pass []"
  // bug silently expanding into full-account data.
  const campaignFilter = buildCampaignFilter(options.allowedCampaignIds);

  // Fetch account currency (lightweight, separate call)
  let currency = null;
  try {
    const accountMeta = await fetchMeta(`${accountId}?fields=currency&access_token=${accessToken}`);
    currency = accountMeta.currency || null;
  } catch {
    // currency unavailable — fall through
  }

  const [accountRes, campaignsRes, timeSeriesRes] = await Promise.all([
    fetchMeta(`${accountId}/insights?fields=${insightsFields}&time_range=${timeRange}${campaignFilter}&access_token=${accessToken}`),
    fetchMeta(
      `${accountId}/insights?fields=campaign_name,${insightsFields}&time_range=${timeRange}&level=campaign&limit=50${campaignFilter}&access_token=${accessToken}`
    ),
    fetchMeta(
      `${accountId}/insights?fields=spend,impressions,clicks,actions&time_range=${timeRange}&time_increment=1${campaignFilter}&access_token=${accessToken}`
    )
  ]);

  const summary = accountRes.data?.[0] || {};
  const leadActions = (summary.actions || []).find(
    (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
  );
  const leadCost = (summary.cost_per_action_type || []).find((a) => a.action_type === leadActions?.action_type);
  const landingPageViews = findActionValue(summary.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content']);

  return {
    currency,
    spend: parseFloat(summary.spend) || 0,
    reach: parseInt(summary.reach) || 0,
    impressions: parseInt(summary.impressions) || 0,
    clicks: parseInt(summary.clicks) || 0,
    ctr: parseFloat(summary.ctr) || 0,
    cpc: parseFloat(summary.cpc) || 0,
    cpm: parseFloat(summary.cpm) || 0,
    landingPageViews,
    conversions: parseInt(leadActions?.value) || 0,
    costPerConversion: parseFloat(leadCost?.value) || 0,
    campaigns: (campaignsRes.data || []).map((c) => {
      const cLeadActions = (c.actions || []).find(
        (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
      );
      return {
        name: c.campaign_name,
        spend: parseFloat(c.spend) || 0,
        impressions: parseInt(c.impressions) || 0,
        clicks: parseInt(c.clicks) || 0,
        landingPageViews: findActionValue(c.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content']),
        conversions: parseInt(cLeadActions?.value) || 0
      };
    }),
    timeSeries: (timeSeriesRes.data || []).map((d) => ({
      date: d.date_start,
      spend: parseFloat(d.spend) || 0,
      impressions: parseInt(d.impressions) || 0,
      clicks: parseInt(d.clicks) || 0,
      landingPageViews: findActionValue(d.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content'])
    }))
  };
}

/**
 * Fetch ad accounts for the authenticated user.
 * @param {string} accessToken
 * @returns {Array<{id: string, name: string}>}
 */
export async function fetchAdAccounts(accessToken) {
  const accounts = [];
  let path = `me/adaccounts?fields=id,name,account_status&limit=200&access_token=${accessToken}`;
  while (path) {
    const res = await fetchMeta(path);
    if (Array.isArray(res.data)) accounts.push(...res.data);
    const nextUrl = res.paging?.next;
    path = nextUrl ? nextUrl.replace(`${META_GRAPH_URL}/`, '') : null;
  }
  return accounts.filter((a) => a.account_status === 1).map((a) => ({ id: a.id, name: a.name }));
}

/**
 * Fetch pixels (ad pixels) for a Meta ad account.
 * @param {string} accessToken
 * @param {string} adAccountId - With or without 'act_' prefix
 * @returns {Array<{id: string, name: string}>}
 */
export async function fetchPixels(accessToken, adAccountId) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const res = await fetchMeta(`${accountId}/adspixels?fields=id,name&access_token=${accessToken}`);
  return (res.data || []).map((p) => ({ id: p.id, name: p.name }));
}

/**
 * Fetch ads with creative details for a given campaign.
 * @param {string} accessToken
 * @param {string} campaignId - Campaign ID (numeric string)
 * @returns {Array<{id, name, status, creative}>}
 */
export async function fetchAdCreatives(accessToken, campaignId) {
  const res = await fetchMeta(
    `${campaignId}/ads?fields=id,name,status,creative{id,name,title,body,image_url,thumbnail_url,video_id,call_to_action_type,object_story_spec,asset_feed_spec}&limit=50&access_token=${accessToken}`
  );

  return (res.data || []).map((ad) => ({
    id: ad.id,
    name: ad.name,
    status: ad.status,
    creative: { ...parseCreative(ad.creative), adId: ad.id }
  }));
}

/**
 * Fetch all campaigns with insights and ad creatives for an ad account.
 * @param {string} accessToken
 * @param {string} adAccountId - With or without 'act_' prefix
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} [statusFilter] - 'ACTIVE', 'PAUSED', or null for all
 * @returns {object} { campaigns: [...] }
 */
export async function fetchCampaignsWithCreatives(accessToken, adAccountId, startDate, endDate, statusFilter, options = {}) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  const allowedIds = Array.isArray(options.allowedCampaignIds) ? options.allowedCampaignIds : null;
  const hasAllowlist = allowedIds !== null;
  if (hasAllowlist && allowedIds.length === 0) {
    // Explicit empty allowlist = deny-all (see buildCampaignFilter semantics).
    return { campaigns: [] };
  }

  // Step 1: Determine the campaign set + metadata.
  //
  // With an allowlist we lead with /campaigns so paused / zero-activity
  // campaigns still appear (insights only returns rows for periods with
  // actual delivery — a paused claim with no spend in the window would
  // otherwise disappear silently).
  //
  // Without an allowlist we keep the original insights-first flow to avoid
  // pulling every campaign on the account when the caller just wants "what
  // ran in this window".
  let campaignIds;
  let campaignMetaMap;
  let preloadedInsights = null;

  if (hasAllowlist) {
    const metaFilters = [{ field: 'id', operator: 'IN', value: allowedIds }];
    if (statusFilter) {
      metaFilters.push({ field: 'effective_status', operator: 'IN', value: [statusFilter] });
    }
    const metaFilterParam = `&filtering=${encodeURIComponent(JSON.stringify(metaFilters))}`;
    const metadataRes = await fetchMeta(
      `${accountId}/campaigns?fields=id,name,status,objective,start_time,stop_time,effective_status&limit=200${metaFilterParam}&access_token=${accessToken}`
    );
    const metadata = metadataRes.data || [];
    campaignIds = metadata.map((c) => c.id);
    campaignMetaMap = new Map(metadata.map((c) => [c.id, c]));
  } else {
    const filterClauses = [];
    if (statusFilter) {
      filterClauses.push({ field: 'campaign.effective_status', operator: 'IN', value: [statusFilter] });
    }
    const filterParam = filterClauses.length > 0
      ? `&filtering=${encodeURIComponent(JSON.stringify(filterClauses))}`
      : '';
    const campaignsRes = await fetchMeta(
      `${accountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type&time_range=${timeRange}&level=campaign&limit=50${filterParam}&access_token=${accessToken}`
    );
    const campaignRows = campaignsRes.data || [];
    campaignIds = [...new Set(campaignRows.map((r) => r.campaign_id))];
    preloadedInsights = new Map(campaignRows.map((r) => [r.campaign_id, r]));

    const campaignMetaRes =
      campaignIds.length > 0
        ? await fetchMeta(
            `${accountId}/campaigns?fields=id,name,status,objective,start_time,stop_time&filtering=[{"field":"id","operator":"IN","value":[${campaignIds.map((id) => `"${id}"`).join(',')}]}]&limit=50&access_token=${accessToken}`
          )
        : { data: [] };
    campaignMetaMap = new Map((campaignMetaRes.data || []).map((c) => [c.id, c]));
  }

  if (campaignIds.length === 0) return { campaigns: [] };

  // Step 1b: Insights. Allowlist path fetches them now (some may be missing
  // for zero-activity campaigns — that's fine, we zero them in the merge).
  // Non-allowlist path already has them from the insights-first fetch.
  let insightsMap = preloadedInsights;
  if (hasAllowlist) {
    const insightsFilter = encodeURIComponent(JSON.stringify([
      { field: 'campaign.id', operator: 'IN', value: campaignIds }
    ]));
    const insightsRes = await fetchMeta(
      `${accountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type&time_range=${timeRange}&level=campaign&limit=500&filtering=${insightsFilter}&access_token=${accessToken}`
    );
    insightsMap = new Map((insightsRes.data || []).map((r) => [r.campaign_id, r]));
  }

  // Fetch creatives for each campaign in parallel
  const creativeResults = await Promise.allSettled(campaignIds.map((id) => fetchAdCreatives(accessToken, id)));

  const creativeMap = new Map();
  campaignIds.forEach((id, i) => {
    creativeMap.set(id, creativeResults[i].status === 'fulfilled' ? creativeResults[i].value : []);
  });

  // Step 3: Resolve image hashes for dynamic/Advantage+ creatives missing image_url
  const allAds = [...creativeMap.values()].flat();
  await resolveImageHashes(accessToken, accountId, allAds);

  // Step 4: Merge everything. Iterate the metadata-driven id set so
  // zero-activity campaigns (common for paused claims) still appear with
  // zero metrics instead of being dropped.
  const campaigns = campaignIds.map((id) => {
    const meta = campaignMetaMap.get(id) || {};
    const row = insightsMap?.get(id) || {};
    const leadActions = (row.actions || []).find(
      (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
    );
    const leadCost = (row.cost_per_action_type || []).find((a) => a.action_type === leadActions?.action_type);

    return {
      id,
      name: meta.name || row.campaign_name || 'Unknown',
      status: meta.status || 'UNKNOWN',
      effective_status: meta.effective_status || meta.status || 'UNKNOWN',
      objective: meta.objective || null,
      startTime: meta.start_time || null,
      stopTime: meta.stop_time || null,
      insights: {
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        ctr: parseFloat(row.ctr) || 0,
        cpc: parseFloat(row.cpc) || 0,
        cpm: parseFloat(row.cpm) || 0,
        reach: parseInt(row.reach) || 0,
        landingPageViews: findActionValue(row.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content']),
        conversions: parseInt(leadActions?.value) || 0,
        costPerConversion: parseFloat(leadCost?.value) || 0
      },
      ads: creativeMap.get(id) || []
    };
  });

  // Sort by spend descending (highest spend first)
  campaigns.sort((a, b) => b.insights.spend - a.insights.spend);

  return { campaigns };
}

/**
 * Fetch ad sets with insights for a given campaign.
 * @param {string} accessToken - Decrypted Facebook system user token
 * @param {string} campaignId - Campaign ID (numeric string)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{id, name, status, insights}>}
 */
export async function fetchAdSets(accessToken, adAccountId, campaignId, startDate, endDate) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  const campaignLookup = await fetchMeta(
    `${accountId}/campaigns?fields=id&filtering=[{"field":"id","operator":"IN","value":["${campaignId}"]}]&limit=1&access_token=${accessToken}`
  );
  const campaignExists = (campaignLookup.data || []).some((campaign) => String(campaign.id) === String(campaignId));

  if (!campaignExists) {
    throw new Error('Campaign not found for this ad account');
  }

  // Fetch ad set metadata and insights in parallel
  const [adSetsRes, insightsRes] = await Promise.all([
    fetchMeta(`${campaignId}/adsets?fields=id,name,status&limit=50&access_token=${accessToken}`),
    fetchMeta(
      `${campaignId}/insights?fields=adset_id,adset_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type&time_range=${timeRange}&level=adset&limit=50&access_token=${accessToken}`
    )
  ]);

  // Build insights map by adset_id
  const insightsMap = new Map();
  for (const row of insightsRes.data || []) {
    insightsMap.set(row.adset_id, row);
  }

  // Merge metadata + insights
  const adSets = (adSetsRes.data || []).map((adSet) => {
    const row = insightsMap.get(adSet.id) || {};
    const leadActions = (row.actions || []).find(
      (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
    );
    const leadCost = (row.cost_per_action_type || []).find((a) => a.action_type === leadActions?.action_type);

    return {
      id: adSet.id,
      name: adSet.name,
      status: adSet.status,
      insights: {
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        ctr: parseFloat(row.ctr) || 0,
        cpc: parseFloat(row.cpc) || 0,
        cpm: parseFloat(row.cpm) || 0,
        reach: parseInt(row.reach) || 0,
        landingPageViews: findActionValue(row.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content']),
        conversions: parseInt(leadActions?.value) || 0,
        costPerConversion: parseFloat(leadCost?.value) || 0
      }
    };
  });

  // Sort by spend descending
  adSets.sort((a, b) => b.insights.spend - a.insights.spend);

  return adSets;
}

/**
 * Fetch ads with creatives and insights for a given ad set.
 * @param {string} accessToken - Decrypted Facebook system user token
 * @param {string} adAccountId - Meta ad account ID (with or without 'act_' prefix)
 * @param {string} adSetId - Ad set ID (numeric string)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{id, name, status, creative, insights}>}
 */
export async function fetchAdsForAdSet(accessToken, adAccountId, adSetId, startDate, endDate) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  // Fetch ads with creatives and ad-level insights in parallel
  const [adsRes, insightsRes] = await Promise.all([
    fetchMeta(
      `${adSetId}/ads?fields=id,name,status,creative{id,name,title,body,image_url,thumbnail_url,video_id,call_to_action_type,object_story_spec,asset_feed_spec}&limit=50&access_token=${accessToken}`
    ),
    fetchMeta(
      `${adSetId}/insights?fields=ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,actions&time_range=${timeRange}&level=ad&limit=50&access_token=${accessToken}`
    )
  ]);

  // Build insights map by ad_id
  const insightsMap = new Map();
  for (const row of insightsRes.data || []) {
    insightsMap.set(row.ad_id, row);
  }

  // Parse creatives using the shared normalizer (same shape as fetchAdCreatives)
  const ads = (adsRes.data || []).map((ad) => {
    const row = insightsMap.get(ad.id) || {};
    const leadActions = (row.actions || []).find(
      (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
    );

    return {
      id: ad.id,
      name: ad.name,
      status: ad.status,
      creative: { ...parseCreative(ad.creative), adId: ad.id },
      insights: {
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        ctr: parseFloat(row.ctr) || 0,
        cpc: parseFloat(row.cpc) || 0,
        reach: parseInt(row.reach) || 0,
        landingPageViews: findActionValue(row.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content']),
        conversions: parseInt(leadActions?.value) || 0
      }
    };
  });

  // Resolve image hashes for dynamic/Advantage+ creatives missing image_url
  await resolveImageHashes(accessToken, accountId, ads);

  // Sort by spend descending
  ads.sort((a, b) => b.insights.spend - a.insights.spend);

  return ads;
}

/**
 * Fetch campaigns on an ad account with basic metadata + last-30d spend,
 * without fetching per-campaign creatives. Used for the per-client
 * allowlist checklist in the Tracking Wizard.
 *
 * @param {string} accessToken - Meta system user token
 * @param {string} adAccountId - e.g. 'act_2851894194985503' or '2851894194985503'
 * @param {object} [options]
 * @param {string[]} [options.statuses] - Meta effective_status values to include
 *   (e.g. ['ACTIVE', 'PAUSED']). Defaults to active + paused.
 * @returns {Promise<Array<{id, name, status, objective, start_time, stop_time, spend_last_30d}>>}
 */
export async function fetchMetaCampaignsList(accessToken, adAccountId, options = {}) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const statuses = options.statuses && options.statuses.length > 0
    ? options.statuses
    : ['ACTIVE', 'PAUSED'];

  const statusFilter = `&filtering=${encodeURIComponent(
    JSON.stringify([{ field: 'effective_status', operator: 'IN', value: statuses }])
  )}`;

  // Last-30d window for spend_last_30d
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since: fmt(thirtyDaysAgo), until: fmt(today) }));

  // 1. Campaign metadata (name, status, objective, dates)
  const metaRes = await fetchMeta(
    `${accountId}/campaigns?fields=id,name,effective_status,objective,start_time,stop_time&limit=200${statusFilter}&access_token=${accessToken}`
  );
  const campaigns = metaRes.data || [];

  if (campaigns.length === 0) return [];

  // 2. Last-30d spend per campaign
  const campaignIds = campaigns.map((c) => c.id);
  const idFilter = encodeURIComponent(
    JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }])
  );
  const spendRes = await fetchMeta(
    `${accountId}/insights?fields=campaign_id,spend&level=campaign&time_range=${timeRange}&limit=500&filtering=${idFilter}&access_token=${accessToken}`
  );
  const spendByCampaign = new Map(
    (spendRes.data || []).map((r) => [r.campaign_id, parseFloat(r.spend) || 0])
  );

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.effective_status,
    objective: c.objective || null,
    start_time: c.start_time || null,
    stop_time: c.stop_time || null,
    spend_last_30d: spendByCampaign.get(c.id) || 0
  }));
}

async function fetchMeta(path) {
  const url = `${META_GRAPH_URL}/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Meta API error: ${err.error?.message || response.statusText}`);
  }
  return response.json();
}
