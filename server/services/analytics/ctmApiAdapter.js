import axios from 'axios';
import { query } from '../../db.js';
import { resolveCtmCreds } from '../ctm.js';

const CTM_BASE = process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com';

/**
 * Load CTM credentials for a client.
 * Queries client_profiles and uses resolveCtmCreds (handles decryption + agency fallback).
 * @param {string} userId
 * @returns {{ accountId: string, apiKey: string, apiSecret: string } | null}
 */
async function getCtmCredentials(userId) {
  const res = await query(
    'SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  if (!res.rows.length) return null;
  return resolveCtmCreds(res.rows[0]);
}

/**
 * Paginate through the CTM calls API.
 * @param {{ accountId: string, apiKey: string, apiSecret: string }} creds
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {number} maxPages - safety cap (default 10 = ~1000 calls)
 * @returns {Array<object>} raw call objects from CTM
 */
async function fetchCtmApiCalls(creds, startDate, endDate, maxPages = 10) {
  const { accountId, apiKey, apiSecret } = creds;
  if (!accountId) return [];

  const perPage = 100;
  const allCalls = [];
  let page = 1;

  while (page <= maxPages) {
    const resp = await axios.get(`${CTM_BASE}/api/v1/accounts/${encodeURIComponent(accountId)}/calls`, {
      params: {
        per_page: perPage,
        page,
        order: 'desc',
        start_date: startDate,
        end_date: endDate
      },
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        Accept: 'application/json'
      },
      timeout: 30000
    });

    // Normalize the varying CTM response shapes
    const payload = Array.isArray(resp.data?.data?.calls)
      ? resp.data.data.calls
      : Array.isArray(resp.data?.calls)
        ? resp.data.calls
        : Array.isArray(resp.data?.data)
          ? resp.data.data
          : [];

    if (!payload.length) break;
    allCalls.push(...payload);

    // Last page if fewer results than requested
    if (payload.length < perPage) break;
    page += 1;
  }

  return allCalls;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Extract a YYYY-MM-DD date string from a CTM call object */
function callDate(call) {
  const raw = call.called_at || call.created_at || call.started_at;
  if (!raw) return null;
  return new Date(raw).toISOString().split('T')[0];
}

/** Get the star rating from a CTM call (sale.score or top-level score) */
function callScore(call) {
  if (call.sale && typeof call.sale.score === 'number') return call.sale.score;
  if (typeof call.score === 'number') return call.score;
  return 0;
}

// Landing URLs from Meta-paid traffic carry utm_source ∈ {fb,ig,facebook,instagram,meta}
// AND utm_medium ∈ {cpc,ppc,paid}. Regex (not URL parsing) is correct here:
// call.last_location is CTM's recorded landing page URL — not a redirect chain
// — so the "nested redirect" false-positive scenario doesn't apply. Regex also
// matches schemeless or relative URLs that `new URL()` would reject. Word
// boundaries (\b) prevent substring false positives like fbpaid matching fb.
const META_PAID_LANDING_REGEX =
  /(?=.*[?&]utm_source=(?:fb|ig|facebook|instagram|meta)\b)(?=.*[?&]utm_medium=(?:cpc|ppc|paid)\b)/i;

function isMetaPaidCall(call) {
  const url = call.last_location;
  if (!url || typeof url !== 'string') return false;
  return META_PAID_LANDING_REGEX.test(url);
}

/** Duration in seconds (already numeric from CTM API) */
function callDuration(call) {
  return typeof call.duration === 'number' ? call.duration : (typeof call.duration_sec === 'number' ? call.duration_sec : 0);
}

/** Whether a call counts as "missed" (zero duration or missed-like status) */
function isMissed(call) {
  if (call._isForm) return false;
  const dur = callDuration(call);
  if (dur === 0) return true;
  const status = (call.dial_status || call.status || '').toLowerCase();
  return status === 'no-answer' || status === 'missed' || status === 'voicemail';
}

/**
 * Fetch form submissions from local DB.
 * Forms come through our form reactor system, not the CTM /calls API,
 * so we must query them from call_logs directly.
 */
async function fetchLocalForms(userId, startDate, endDate) {
  const res = await query(
    `SELECT call_id, started_at, score, duration_sec,
            meta->>'source' AS source, meta->>'form_name' AS form_name
     FROM call_logs
     WHERE user_id = $1
       AND activity_type = 'form'
       AND started_at >= $2::date
       AND started_at < ($3::date + interval '1 day')
     ORDER BY started_at DESC`,
    [userId, startDate, endDate]
  );
  return res.rows.map((r) => ({
    id: r.call_id,
    started_at: r.started_at,
    score: r.score || 0,
    duration_sec: 0,
    source: r.source || 'Unknown',
    form_name: r.form_name || 'Form',
    _isForm: true
  }));
}

/**
 * Combine CTM API calls with local DB form submissions into a unified list.
 * CTM API = live call data, local DB = form submissions (they don't exist in CTM API).
 */
async function fetchUnifiedCalls(userId, startDate, endDate, maxPages = 10) {
  const creds = await getCtmCredentials(userId);

  const [apiCalls, forms] = await Promise.all([
    creds ? fetchCtmApiCalls(creds, startDate, endDate, maxPages) : [],
    fetchLocalForms(userId, startDate, endDate)
  ]);

  // Only include inbound calls for intake analytics (outbound = follow-ups, not leads)
  const normalizedCalls = apiCalls
    .filter((c) => c.direction === 'inbound')
    .map((c) => ({ ...c, _isForm: false }));

  return [...normalizedCalls, ...forms];
}

function enumerateDateRange(startDate, endDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

// ── Exported analytics functions ───────────────────────────────────

/**
 * Fetch CTM analytics summary — hybrid: calls from CTM API + forms from local DB.
 */
export async function fetchCTMApiAnalytics(userId, startDate, endDate) {
  const all = await fetchUnifiedCalls(userId, startDate, endDate);
  if (!all.length) {
    return {
      totalLeads: 0,
      totalCalls: 0,
      totalForms: 0,
      qualifiedCalls: 0,
      missedCalls: 0,
      metaPaidLeads: 0,
      metaPaidConversions: 0,
      avgDuration: 0,
      topSources: [],
      timeSeries: []
    };
  }

  let totalCalls = 0;
  let totalForms = 0;
  let qualifiedCalls = 0;
  let missedCalls = 0;
  let metaPaidLeads = 0;
  let metaPaidConversions = 0;
  let durationSum = 0;
  let durationCount = 0;
  const sourceMap = {};
  const dateMap = {};

  for (const call of all) {
    if (call._isForm) totalForms++;
    else totalCalls++;

    const score = callScore(call);
    if (score >= 3) qualifiedCalls++;
    if (isMissed(call)) missedCalls++;

    if (!call._isForm && isMetaPaidCall(call)) {
      if (score >= 3) metaPaidLeads++;
      if (score === 5) metaPaidConversions++;
    }

    const dur = callDuration(call);
    if (dur > 0) { durationSum += dur; durationCount++; }

    const src = call.source || 'Unknown';
    sourceMap[src] = (sourceMap[src] || 0) + 1;

    const d = callDate(call);
    if (d) {
      if (!dateMap[d]) dateMap[d] = { calls: 0, qualified: 0 };
      dateMap[d].calls++;
      if (score >= 3) dateMap[d].qualified++;
    }
  }

  return {
    totalLeads: totalCalls + totalForms,
    totalCalls,
    totalForms,
    qualifiedCalls,
    missedCalls,
    metaPaidLeads,
    metaPaidConversions,
    avgDuration: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    topSources: Object.entries(sourceMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([source, count]) => ({ source, count })),
    timeSeries: Object.entries(dateMap).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, calls: v.calls, qualified: v.qualified }))
  };
}

/**
 * Group by star rating — hybrid.
 */
export async function fetchApiByRating(userId, startDate, endDate) {
  const all = await fetchUnifiedCalls(userId, startDate, endDate);
  const ratingMap = {};
  for (const call of all) {
    const score = callScore(call);
    if (score > 0) ratingMap[score] = (ratingMap[score] || 0) + 1;
  }
  return Object.entries(ratingMap).sort((a, b) => Number(a[0]) - Number(b[0])).map(([rating, count]) => ({ rating: Number(rating), count }));
}

/**
 * Group by lead type — hybrid.
 * Note: This shows lead channel breakdown (call vs form, new vs repeat),
 * NOT AI semantic categories (those live in the local DB only).
 */
export async function fetchApiByCategory(userId, startDate, endDate) {
  const all = await fetchUnifiedCalls(userId, startDate, endDate);
  const catMap = {};
  for (const call of all) {
    let category;
    if (call._isForm) {
      category = 'Form Submission';
    } else if (isMissed(call)) {
      category = 'Missed / No Answer';
    } else if (call.is_new_caller || call.first_call === true) {
      category = 'New Caller';
    } else {
      category = 'Returning Caller';
    }
    catMap[category] = (catMap[category] || 0) + 1;
  }
  return Object.entries(catMap).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
}

/**
 * Group by source with call/form/qualified breakdown — hybrid.
 */
export async function fetchApiBySource(userId, startDate, endDate) {
  const all = await fetchUnifiedCalls(userId, startDate, endDate);
  const sourceMap = {};
  for (const call of all) {
    const src = call.source || 'Unknown';
    if (!sourceMap[src]) sourceMap[src] = { total: 0, calls: 0, forms: 0, qualified: 0 };
    sourceMap[src].total++;
    if (call._isForm) sourceMap[src].forms++;
    else sourceMap[src].calls++;
    if (callScore(call) >= 3) sourceMap[src].qualified++;
  }
  return Object.entries(sourceMap).sort((a, b) => b[1].total - a[1].total).map(([source, v]) => ({
    source, total: v.total, calls: v.calls, forms: v.forms, qualified: v.qualified,
    qualifiedRate: v.total > 0 ? Math.round((v.qualified / v.total) * 1000) / 10 : 0
  }));
}

/**
 * Daily call/form volume time series — hybrid.
 */
export async function fetchApiVolumeTimeSeries(userId, startDate, endDate) {
  const all = await fetchUnifiedCalls(userId, startDate, endDate);
  const dateMap = {};
  for (const call of all) {
    const d = callDate(call);
    if (!d) continue;
    if (!dateMap[d]) dateMap[d] = { calls: 0, forms: 0 };
    if (call._isForm) dateMap[d].forms++;
    else dateMap[d].calls++;
  }
  return enumerateDateRange(startDate, endDate).map((date) => ({
    date,
    calls: dateMap[date]?.calls || 0,
    forms: dateMap[date]?.forms || 0
  }));
}

/**
 * Call duration distribution — hybrid (forms excluded from duration bucketing).
 */
export async function fetchApiDurationDistribution(userId, startDate, endDate) {
  const all = await fetchUnifiedCalls(userId, startDate, endDate);
  const BUCKET_ORDER = ['missed', 'under_30s', '30s_to_1m', '1m_to_3m', '3m_to_5m', '5m_to_10m', 'over_10m'];
  const buckets = {};
  for (const b of BUCKET_ORDER) buckets[b] = 0;

  for (const call of all) {
    if (call._isForm) continue; // forms have no duration
    const dur = callDuration(call);
    let bucket;
    if (isMissed(call)) bucket = 'missed';
    else if (dur < 30) bucket = 'under_30s';
    else if (dur < 60) bucket = '30s_to_1m';
    else if (dur < 180) bucket = '1m_to_3m';
    else if (dur < 300) bucket = '3m_to_5m';
    else if (dur < 600) bucket = '5m_to_10m';
    else bucket = 'over_10m';
    buckets[bucket]++;
  }

  return BUCKET_ORDER.map((bucket) => ({ bucket, count: buckets[bucket] }));
}
