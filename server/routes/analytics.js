import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { query } from '../db.js';
import { fetchUnifiedAnalytics } from '../services/analytics/index.js';
import { fetchGA4Analytics, fetchGA4Sources, fetchGA4LandingPages, fetchGA4DeviceBreakdown, fetchGA4TrafficSummary } from '../services/analytics/ga4Adapter.js';
import {
  fetchCTMApiAnalytics,
  fetchApiByRating,
  fetchApiByCategory,
  fetchApiBySource,
  fetchApiVolumeTimeSeries,
  fetchApiDurationDistribution
} from '../services/analytics/ctmApiAdapter.js';
import { fetchCampaignsWithCreatives, fetchAdSets, fetchAdsForAdSet, fetchAdVideoSource } from '../services/analytics/metaAdsAdapter.js';
import {
  fetchGoogleAdsAnalytics,
  fetchAdGroups,
  fetchAdsForAdGroup,
  fetchKeywords,
  fetchSearchTerms
} from '../services/analytics/googleAdsAdapter.js';
import { evaluateRules } from '../services/analytics/insightRules.js';
import { generateAiResponse } from '../services/ai.js';
import { fetchGroupAnalytics, fetchGroupTraffic, fetchGroupCallsLeads } from '../services/analytics/groupAnalytics.js';
import { AnalyticsAccessError, SelectionError, resolveAnalyticsSelection } from '../services/analytics/selectionResolver.js';
import { canAccessAnalyticsUser, resolveAnalyticsAccessScope } from '../services/analytics/accessScope.js';
import { activeOnly } from '../services/queryHelpers.js';
import { clientLabelSelect, clientLabelJoins } from '../services/clientLabel.js';
import { resolveTimeZone, DEFAULT_TZ } from '../services/util/timezone.js';
import {
  createAuditSchedule,
  deleteAuditSchedule,
  getAuditRun,
  getAuditScheduleById,
  listAuditRuns,
  listAuditSchedules,
  listAvailableAuditPresets,
  processDueAuditSchedules,
  queueBulkGoogleAdsAuditRuns,
  runAuditNow,
  runAuditScheduleNow,
  upsertBulkGoogleAdsAuditSchedules,
  updateAuditSchedule
} from '../services/analytics/auditScheduler.js';
import { answerAuditChat } from '../services/analytics/auditAssistant.js';

const router = express.Router();

function requireAuditRunnerSecret(req, res, next) {
  const configuredSecret = process.env.ANALYTICS_AUDIT_RUNNER_SECRET;
  if (!configuredSecret) {
    return res.status(500).json({ message: 'ANALYTICS_AUDIT_RUNNER_SECRET is not configured' });
  }

  const providedSecret = req.headers['x-audit-runner-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!providedSecret || providedSecret !== configuredSecret) {
    return res.status(401).json({ message: 'Invalid audit runner secret' });
  }

  return next();
}

router.post('/audits/internal/process-due', requireAuditRunnerSecret, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.body?.limit) || 10));
    const result = await processDueAuditSchedules(limit);
    return res.json(result);
  } catch (err) {
    console.error('[analytics] process due audits error:', err);
    return res.status(500).json({ message: 'Failed to process due audits' });
  }
});

router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    req.analyticsAccessScope = await resolveAnalyticsAccessScope(req, {
      includeSelectionOptions: req.path === '/selection-options'
    });
    next();
  } catch (err) {
    console.error('[analytics] access-scope error:', err);
    res.status(500).json({ message: 'Failed to resolve analytics access' });
  }
});

/** Parse start/end from query params, defaulting to last 30 days */
function parseDateRange(req) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return {
    startDate: req.query.start || thirtyDaysAgo.toISOString().split('T')[0],
    endDate: req.query.end || now.toISOString().split('T')[0]
  };
}

/** Whitelist for campaign status filter */
const VALID_CAMPAIGN_STATUSES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED']);

function handleSelectionRouteError(res, err, fallbackMessage) {
  if (err instanceof AnalyticsAccessError || err.name === 'AnalyticsAccessError' || err.statusCode === 403) {
    return res.status(403).json({ message: err.message || 'Access denied' });
  }
  if (err instanceof SelectionError || err.name === 'SelectionError' || err.statusCode === 400) {
    return res.status(400).json({ message: err.message });
  }
  console.error(fallbackMessage, err);
  return res.status(500).json({ message: 'Failed to fetch analytics data' });
}

function requireAnalyticsUserAccess(req, res, next) {
  if (canAccessAnalyticsUser(req.analyticsAccessScope, req.params.userId)) {
    return next();
  }
  return res.status(403).json({ message: 'Access denied' });
}

// ─── Analytics Endpoints ────────────────────────────────────────

// GET /clients — List clients that have tracking configs OR CTM credentials (for the client dropdown)
router.get('/clients', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.id AS user_id,
             u.first_name, u.last_name, u.email,
             cp.client_identifier_value,
             ba.business_name,
             ${clientLabelSelect()},
             tc.ga4_property_id IS NOT NULL AS has_ga4,
             tc.meta_ad_account_id IS NOT NULL AS has_meta,
             tc.google_ads_customer_id IS NOT NULL AS has_google_ads,
             cp.ctm_account_number IS NOT NULL AS has_ctm
      FROM users u
      ${clientLabelJoins()}
      LEFT JOIN tracking_configs tc ON tc.user_id = u.id
      WHERE tc.user_id IS NOT NULL
         OR cp.ctm_account_number IS NOT NULL
      ORDER BY client_label
    `);
    res.json({ clients: rows });
  } catch (err) {
    console.error('[analytics] clients list error:', err);
    res.status(500).json({ message: 'Failed to fetch analytics clients' });
  }
});

// GET /test/overview — Hardcoded test endpoint (must be before :userId route)
router.get('/test/overview', requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = parseDateRange(req);

    // Find the user_id for the test client by their tracking config
    const configRes = await query("SELECT user_id FROM tracking_configs WHERE ga4_property_id = '527437284' LIMIT 1");

    if (!configRes.rows.length) {
      return res
        .status(404)
        .json({ message: 'Test client tracking config not found. Create a tracking config with ga4_property_id=527437284.' });
    }

    const userId = configRes.rows[0].user_id;

    const data = await fetchUnifiedAnalytics(userId, startDate, endDate, {
      ga4PropertyId: '527437284',
      metaAdAccountId: 'act_5060545420680641',
      googleAdsCustomerId: '179-2914-4196'
    });

    res.json(data);
  } catch (err) {
    console.error('[analytics] test overview error:', err);
    res.status(500).json({ message: 'Failed to fetch test analytics' });
  }
});

// GET /test/meta-campaigns — Test endpoint for Facebook campaigns with creatives
router.get('/test/meta-campaigns', requireAdmin, async (req, res) => {
  try {
    const metaToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });

    const { startDate, endDate } = parseDateRange(req);

    const rawStatus = req.query.status || null;
    const status = VALID_CAMPAIGN_STATUSES.has(rawStatus) ? rawStatus : null;

    const data = await fetchCampaignsWithCreatives(metaToken, 'act_5060545420680641', startDate, endDate, status);
    res.json(data);
  } catch (err) {
    console.error('[analytics] test meta-campaigns error:', err);
    res.status(500).json({ message: 'Failed to fetch campaign data' });
  }
});

// ─── Audit Schedules & Runs ────────────────────────────────────

router.get('/audits/schedules', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.query;
    if (userId && !canAccessAnalyticsUser(req.analyticsAccessScope, userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const schedules = await listAuditSchedules(userId || null);
    return res.json({
      schedules,
      presets: listAvailableAuditPresets()
    });
  } catch (err) {
    console.error('[analytics] list audit schedules error:', err);
    return res.status(500).json({ message: 'Failed to load audit schedules' });
  }
});

router.post('/audits/schedules/bulk', requireAdmin, async (req, res) => {
  try {
    const { userIds = null, name, providerPreset, recipientEmails, dailyTimeLocal, timezone, paused, configJson } = req.body || {};
    const scopedUserIds = Array.isArray(userIds) ? userIds.filter(Boolean) : null;

    if (scopedUserIds?.some((userId) => !canAccessAnalyticsUser(req.analyticsAccessScope, userId))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await upsertBulkGoogleAdsAuditSchedules({
      createdBy: req.user.id,
      userIds: scopedUserIds,
      name,
      providerPreset,
      recipientEmails,
      dailyTimeLocal,
      timezone,
      paused,
      configJson
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[analytics] bulk audit schedule error:', err);
    return res.status(400).json({ message: err.message || 'Failed to save bulk audit schedules' });
  }
});

router.post('/audits/schedules', requireAdmin, async (req, res) => {
  try {
    const { userId, name, providerPreset, recipientEmails, dailyTimeLocal, timezone, paused, configJson } = req.body || {};

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }
    if (!canAccessAnalyticsUser(req.analyticsAccessScope, userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const schedule = await createAuditSchedule({
      createdBy: req.user.id,
      userId,
      name,
      providerPreset,
      recipientEmails,
      dailyTimeLocal,
      timezone,
      paused,
      configJson
    });

    return res.status(201).json(schedule);
  } catch (err) {
    console.error('[analytics] create audit schedule error:', err);
    return res.status(400).json({ message: err.message || 'Failed to create audit schedule' });
  }
});

router.patch('/audits/schedules/:scheduleId', requireAdmin, async (req, res) => {
  try {
    const schedule = await getAuditScheduleById(req.params.scheduleId);
    if (!schedule) {
      return res.status(404).json({ message: 'Audit schedule not found' });
    }
    if (!canAccessAnalyticsUser(req.analyticsAccessScope, schedule.user_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updated = await updateAuditSchedule(req.params.scheduleId, {
      name: req.body?.name,
      providerPreset: req.body?.providerPreset,
      recipientEmails: req.body?.recipientEmails,
      dailyTimeLocal: req.body?.dailyTimeLocal,
      timezone: req.body?.timezone,
      paused: req.body?.paused,
      configJson: req.body?.configJson
    });

    return res.json(updated);
  } catch (err) {
    console.error('[analytics] update audit schedule error:', err);
    return res.status(400).json({ message: err.message || 'Failed to update audit schedule' });
  }
});

router.delete('/audits/schedules/:scheduleId', requireAdmin, async (req, res) => {
  try {
    const schedule = await getAuditScheduleById(req.params.scheduleId);
    if (!schedule) {
      return res.status(404).json({ message: 'Audit schedule not found' });
    }
    if (!canAccessAnalyticsUser(req.analyticsAccessScope, schedule.user_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await deleteAuditSchedule(req.params.scheduleId);
    return res.json({ message: 'Audit schedule deleted' });
  } catch (err) {
    console.error('[analytics] delete audit schedule error:', err);
    return res.status(500).json({ message: 'Failed to delete audit schedule' });
  }
});

router.post('/audits/schedules/:scheduleId/run', requireAdmin, async (req, res) => {
  try {
    const schedule = await getAuditScheduleById(req.params.scheduleId);
    if (!schedule) {
      return res.status(404).json({ message: 'Audit schedule not found' });
    }
    if (!canAccessAnalyticsUser(req.analyticsAccessScope, schedule.user_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const run = await runAuditScheduleNow(req.params.scheduleId);
    return res.json({ run });
  } catch (err) {
    console.error('[analytics] run audit schedule now error:', err);
    return res.status(400).json({ message: err.message || 'Failed to run audit schedule' });
  }
});

router.post('/audits/runs', requireAdmin, async (req, res) => {
  try {
    const { userId, providerPreset, configJson, platform } = req.body || {};
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }
    if (!canAccessAnalyticsUser(req.analyticsAccessScope, userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const run = await runAuditNow({
      userId,
      providerPreset,
      configJson,
      platform
    });

    return res.status(201).json({ run });
  } catch (err) {
    console.error('[analytics] run audit now error:', err);
    return res.status(400).json({ message: err.message || 'Failed to run audit' });
  }
});

router.get('/audits/runs', requireAdmin, async (req, res) => {
  try {
    const { userId, scheduleId, limit } = req.query;
    if (userId && !canAccessAnalyticsUser(req.analyticsAccessScope, userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const runs = await listAuditRuns({
      userId: userId || null,
      scheduleId: scheduleId || null,
      limit
    });
    return res.json({ runs });
  } catch (err) {
    console.error('[analytics] list audit runs error:', err);
    return res.status(500).json({ message: 'Failed to load audit runs' });
  }
});

router.post('/audits/runs/bulk', requireAdmin, async (req, res) => {
  try {
    const { userIds = null, providerPreset, configJson, platform } = req.body || {};
    const scopedUserIds = Array.isArray(userIds) ? userIds.filter(Boolean) : null;

    if (scopedUserIds?.some((userId) => !canAccessAnalyticsUser(req.analyticsAccessScope, userId))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await queueBulkGoogleAdsAuditRuns({
      userIds: scopedUserIds,
      providerPreset,
      configJson,
      platform
    });

    return res.status(202).json(result);
  } catch (err) {
    console.error('[analytics] bulk run audit error:', err);
    return res.status(400).json({ message: err.message || 'Failed to queue bulk audit runs' });
  }
});

router.get('/audits/runs/:runId', requireAdmin, async (req, res) => {
  try {
    const run = await getAuditRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ message: 'Audit run not found' });
    }
    if (!canAccessAnalyticsUser(req.analyticsAccessScope, run.user_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    return res.json({ run });
  } catch (err) {
    console.error('[analytics] get audit run error:', err);
    return res.status(500).json({ message: 'Failed to load audit run' });
  }
});

router.post('/audits/chat', requireAdmin, async (req, res) => {
  try {
    const { userId, prompt, runId = null, modelId = null, providerPreset } = req.body || {};
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }
    if (!canAccessAnalyticsUser(req.analyticsAccessScope, userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await answerAuditChat({
      userId,
      prompt,
      runId,
      modelId,
      providerPreset
    });

    return res.json(result);
  } catch (err) {
    console.error('[analytics] audit chat error:', err);
    return res.status(400).json({ message: err.message || 'Failed to generate audit assistant response' });
  }
});

// GET /selection-options — Clients with platform flags + client groups (for group analytics picker)
router.get('/selection-options', async (req, res) => {
  try {
    res.json({
      clients: req.analyticsAccessScope?.clients || [],
      groups: req.analyticsAccessScope?.groups || []
    });
  } catch (err) {
    console.error('[analytics] selection-options error:', err);
    res.status(500).json({ message: 'Failed to fetch selection options' });
  }
});

// POST /overview — selection-based analytics (for group/custom modes)
router.post('/overview', async (req, res) => {
  try {
    const { selection, start, end } = req.body;
    if (!selection?.mode) return res.status(400).json({ message: 'selection.mode is required' });

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = end || now.toISOString().split('T')[0];

    const data = await fetchGroupAnalytics(selection, startDate, endDate, { accessScope: req.analyticsAccessScope });
    res.json(data);
  } catch (err) {
    return handleSelectionRouteError(res, err, '[analytics] group overview error:');
  }
});

// POST /traffic — selection-based GA4 traffic aggregation (group/custom modes)
router.post('/traffic', async (req, res) => {
  try {
    const { selection, start, end } = req.body;
    if (!selection?.mode) return res.status(400).json({ message: 'selection.mode is required' });

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = end || now.toISOString().split('T')[0];

    const data = await fetchGroupTraffic(selection, startDate, endDate, { accessScope: req.analyticsAccessScope });
    res.json(data);
  } catch (err) {
    return handleSelectionRouteError(res, err, '[analytics] group traffic error:');
  }
});

// POST /calls-leads — selection-based calls/leads aggregation (group/custom modes)
router.post('/calls-leads', async (req, res) => {
  try {
    const { selection, start, end } = req.body;
    if (!selection?.mode) return res.status(400).json({ message: 'selection.mode is required' });

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = end || now.toISOString().split('T')[0];

    const data = await fetchGroupCallsLeads(selection, startDate, endDate, { accessScope: req.analyticsAccessScope });
    res.json(data);
  } catch (err) {
    return handleSelectionRouteError(res, err, '[analytics] group calls-leads error:');
  }
});

// POST /calls-leads/heatmap — selection-based call heatmap (day-of-week × hour)
router.post('/calls-leads/heatmap', async (req, res) => {
  try {
    const { selection, start, end } = req.body;
    if (!selection?.mode) return res.status(400).json({ message: 'selection.mode is required' });

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = end || now.toISOString().split('T')[0];

    const resolved = await resolveAnalyticsSelection(selection, { accessScope: req.analyticsAccessScope });
    const { userIds } = resolved;
    if (userIds.length === 0) return res.json({ heatmap: [], timezone: resolveTimeZone(req.body?.tz) });

    let singleClientTz = null;
    if (userIds.length === 1) {
      const { rows: tzRows } = await query(
        `SELECT timezone FROM client_profiles WHERE user_id = $1 LIMIT 1`,
        [userIds[0]]
      );
      singleClientTz = tzRows[0]?.timezone || null;
    }
    const tz = resolveTimeZone(singleClientTz, req.body?.tz, DEFAULT_TZ);

    const { rows } = await query(
      `
      SELECT
        EXTRACT(DOW FROM (started_at AT TIME ZONE $4)) AS dow,
        EXTRACT(HOUR FROM (started_at AT TIME ZONE $4)) AS hour,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE score >= 3) AS qualified
      FROM call_logs
      WHERE user_id = ANY($1::uuid[])
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')
        AND (activity_type = 'call' OR activity_type IS NULL)
      GROUP BY dow, hour
      ORDER BY dow, hour
      `,
      [userIds, startDate, endDate, tz]
    );

    res.json({
      heatmap: rows.map((r) => ({
        dow: parseInt(r.dow),
        hour: parseInt(r.hour),
        count: parseInt(r.count),
        qualified: parseInt(r.qualified)
      })),
      userCount: userIds.length,
      timezone: tz
    });
  } catch (err) {
    return handleSelectionRouteError(res, err, '[analytics] group heatmap error:');
  }
});

router.use('/:userId', requireAnalyticsUserAccess);

// ─── Traffic & Attribution Endpoints ────────────────────────────

// GET /:userId/traffic/sources — GA4 traffic sources for a client
router.get('/:userId/traffic/sources', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getTrackingConfig(userId);
    const propertyId = config?.ga4_property_id;
    if (!propertyId) return res.status(404).json({ message: 'No GA4 property configured for this client' });

    const { startDate, endDate } = parseDateRange(req);
    const sources = await fetchGA4Sources(propertyId, startDate, endDate, parseInt(req.query.limit) || 50);
    res.json({ sources });
  } catch (err) {
    console.error('[analytics] traffic sources error:', err);
    res.status(500).json({ message: 'Failed to fetch traffic sources' });
  }
});

// GET /:userId/traffic/landing-pages — GA4 landing pages for a client
router.get('/:userId/traffic/landing-pages', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getTrackingConfig(userId);
    const propertyId = config?.ga4_property_id;
    if (!propertyId) return res.status(404).json({ message: 'No GA4 property configured for this client' });

    const { startDate, endDate } = parseDateRange(req);
    const pages = await fetchGA4LandingPages(propertyId, startDate, endDate, parseInt(req.query.limit) || 50);
    res.json({ pages });
  } catch (err) {
    console.error('[analytics] traffic landing-pages error:', err);
    res.status(500).json({ message: 'Failed to fetch landing pages' });
  }
});

// GET /:userId/traffic/devices — GA4 device breakdown for a client
router.get('/:userId/traffic/devices', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getTrackingConfig(userId);
    const propertyId = config?.ga4_property_id;
    if (!propertyId) return res.status(404).json({ message: 'No GA4 property configured for this client' });

    const { startDate, endDate } = parseDateRange(req);
    const devices = await fetchGA4DeviceBreakdown(propertyId, startDate, endDate);
    res.json({ devices });
  } catch (err) {
    console.error('[analytics] traffic devices error:', err);
    res.status(500).json({ message: 'Failed to fetch device breakdown' });
  }
});

// GET /:userId/traffic/summary — GA4 traffic KPI summary (activeUsers, newUsers, avgSessionDuration, engagedSessions)
router.get('/:userId/traffic/summary', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getTrackingConfig(userId);
    const propertyId = config?.ga4_property_id;
    if (!propertyId) return res.status(404).json({ message: 'No GA4 property configured for this client' });

    const { startDate, endDate } = parseDateRange(req);
    const summary = await fetchGA4TrafficSummary(propertyId, startDate, endDate);
    res.json(summary);
  } catch (err) {
    console.error('[analytics] traffic summary error:', err);
    res.status(500).json({ message: 'Failed to fetch traffic summary' });
  }
});

// ─── Calls & Leads Endpoints ────────────────────────────────────

// GET /:userId/calls-leads/summary — Call/lead summary metrics (via CTM API)
router.get('/:userId/calls-leads/summary', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const summary = await fetchCTMApiAnalytics(userId, startDate, endDate);
    if (!summary) return res.status(404).json({ message: 'CTM not configured for this client' });
    res.json(summary);
  } catch (err) {
    console.error('[analytics] calls-leads summary error:', err);
    res.status(500).json({ message: 'Failed to fetch calls/leads summary' });
  }
});

// GET /:userId/calls-leads/by-rating — Leads grouped by star rating (via CTM API)
router.get('/:userId/calls-leads/by-rating', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const ratings = await fetchApiByRating(userId, startDate, endDate);
    if (!ratings) return res.status(404).json({ message: 'CTM not configured for this client' });
    res.json({ ratings });
  } catch (err) {
    console.error('[analytics] calls-leads by-rating error:', err);
    res.status(500).json({ message: 'Failed to fetch rating breakdown' });
  }
});

// GET /:userId/calls-leads/by-category — Leads grouped by call characteristics (via CTM API)
router.get('/:userId/calls-leads/by-category', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const categories = await fetchApiByCategory(userId, startDate, endDate);
    if (!categories) return res.status(404).json({ message: 'CTM not configured for this client' });
    res.json({ categories });
  } catch (err) {
    console.error('[analytics] calls-leads by-category error:', err);
    res.status(500).json({ message: 'Failed to fetch category breakdown' });
  }
});

// GET /:userId/calls-leads/by-source — Leads grouped by tracking source (via CTM API)
router.get('/:userId/calls-leads/by-source', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const sources = await fetchApiBySource(userId, startDate, endDate);
    if (!sources) return res.status(404).json({ message: 'CTM not configured for this client' });
    res.json({ sources });
  } catch (err) {
    console.error('[analytics] calls-leads by-source error:', err);
    res.status(500).json({ message: 'Failed to fetch source breakdown' });
  }
});

// GET /:userId/calls-leads/volume — Call/lead volume over time (via CTM API)
router.get('/:userId/calls-leads/volume', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const timeSeries = await fetchApiVolumeTimeSeries(userId, startDate, endDate);
    if (!timeSeries) return res.status(404).json({ message: 'CTM not configured for this client' });
    res.json({ timeSeries });
  } catch (err) {
    console.error('[analytics] calls-leads volume error:', err);
    res.status(500).json({ message: 'Failed to fetch volume time series' });
  }
});

// GET /:userId/calls-leads/duration — Call duration distribution (via CTM API)
router.get('/:userId/calls-leads/duration', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const distribution = await fetchApiDurationDistribution(userId, startDate, endDate);
    if (!distribution) return res.status(404).json({ message: 'CTM not configured for this client' });
    res.json({ distribution });
  } catch (err) {
    console.error('[analytics] calls-leads duration error:', err);
    res.status(500).json({ message: 'Failed to fetch duration distribution' });
  }
});

// GET /:userId/connections — Platform connection status for a client
router.get('/:userId/connections', async (req, res) => {
  try {
    const { userId } = req.params;

    // Check tracking config for GA4, Ads, Meta
    const configRes = await query(
      `SELECT ga4_property_id, google_ads_customer_id, meta_ad_account_id
       FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const config = configRes.rows[0] || {};

    // Check for CTM credentials in client_profiles (not call_logs — a client can have CTM configured but no calls yet)
    const ctmRes = await query('SELECT ctm_account_number FROM client_profiles WHERE user_id = $1 LIMIT 1', [userId]);
    const hasCTM = Boolean(ctmRes.rows[0]?.ctm_account_number);

    res.json({
      ga4: !!config.ga4_property_id,
      googleAds: !!config.google_ads_customer_id,
      meta: !!config.meta_ad_account_id,
      ctm: hasCTM ? { accountNumber: ctmRes.rows[0].ctm_account_number } : null
    });
  } catch (err) {
    console.error('[analytics] connections error:', err);
    res.status(500).json({ message: 'Failed to fetch connection status' });
  }
});

// GET /:userId/meta-campaigns — Facebook campaigns with creatives for a client
router.get('/:userId/meta-campaigns', async (req, res) => {
  try {
    const metaToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });

    const { userId } = req.params;
    const configRes = await query('SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1', [userId]);
    const adAccountIdRaw = configRes.rows[0]?.meta_ad_account_id;
    if (!adAccountIdRaw) return res.status(404).json({ message: 'No Meta ad account configured for this client' });
    const adAccountId = adAccountIdRaw.startsWith('act_') ? adAccountIdRaw : `act_${adAccountIdRaw}`;

    const { startDate, endDate } = parseDateRange(req);

    const rawStatus = req.query.status || null;
    const status = VALID_CAMPAIGN_STATUSES.has(rawStatus) ? rawStatus : null;

    // Scope to this client's claimed campaigns. Zero claims ⇒ empty response
    // (matches the unified analytics pipeline; do not leak shared-account data).
    const claimsRes = await query(
      `SELECT campaign_id FROM tracking_campaign_claims
        WHERE user_id = $1 AND platform = 'meta' AND ad_account_id = $2`,
      [userId, adAccountId]
    );
    const allowedCampaignIds = claimsRes.rows.map((r) => r.campaign_id);
    if (allowedCampaignIds.length === 0) {
      return res.json({ campaigns: [] });
    }

    const data = await fetchCampaignsWithCreatives(metaToken, adAccountId, startDate, endDate, status, { allowedCampaignIds });
    res.json(data);
  } catch (err) {
    console.error('[analytics] meta-campaigns error:', err);
    res.status(500).json({ message: 'Failed to fetch campaign data' });
  }
});

// ─── Funnel & Heatmap Endpoints ────────────────────────────────

// GET /:userId/funnel — Conversion funnel (Sessions → Engaged → Leads → Qualified → Clients)
router.get('/:userId/funnel', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const config = await getTrackingConfig(userId);

    const [ga4, ctm, clientsRes] = await Promise.allSettled([
      config?.ga4_property_id ? fetchGA4Analytics(config.ga4_property_id, startDate, endDate) : null,
      fetchCTMApiAnalytics(userId, startDate, endDate),
      query(
        `SELECT COUNT(*)::int AS count FROM active_clients WHERE owner_user_id = $1 AND created_at >= $2::date AND created_at <= ($3::date + interval '1 day') AND ${activeOnly()}`,
        [userId, startDate, endDate]
      )
    ]);

    const ga4Data = ga4?.status === 'fulfilled' ? ga4.value : null;
    const ctmData = ctm?.status === 'fulfilled' ? ctm.value : null;
    const newClients = clientsRes?.status === 'fulfilled' ? clientsRes.value?.rows?.[0]?.count || 0 : 0;

    const sessions = ga4Data?.sessions || 0;
    const engagedSessions = ga4Data?.engagedSessions ?? Math.round(sessions * (1 - (ga4Data?.bounceRate || 0)));
    const totalLeads = ctmData?.totalLeads || ctmData?.totalCalls || 0;
    const qualifiedLeads = ctmData?.qualifiedCalls || 0;

    res.json({
      funnel: [
        { stage: 'Sessions', value: sessions },
        { stage: 'Engaged', value: engagedSessions },
        { stage: 'Leads', value: totalLeads },
        { stage: 'Qualified', value: qualifiedLeads },
        { stage: 'Clients', value: newClients }
      ]
    });
  } catch (err) {
    console.error('[analytics] funnel error:', err);
    res.status(500).json({ message: 'Failed to build funnel' });
  }
});

// GET /:userId/calls-leads/heatmap — Call volume by day-of-week and hour
router.get('/:userId/calls-leads/heatmap', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);

    const { rows: tzRows } = await query(
      `SELECT timezone FROM client_profiles WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const tz = resolveTimeZone(tzRows[0]?.timezone, req.query?.tz, DEFAULT_TZ);

    const { rows } = await query(
      `
      SELECT
        EXTRACT(DOW FROM (started_at AT TIME ZONE $4)) AS dow,
        EXTRACT(HOUR FROM (started_at AT TIME ZONE $4)) AS hour,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE score >= 3) AS qualified
      FROM call_logs
      WHERE user_id = $1
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')
        AND (activity_type = 'call' OR activity_type IS NULL)
      GROUP BY dow, hour
      ORDER BY dow, hour
    `,
      [userId, startDate, endDate, tz]
    );

    res.json({
      heatmap: rows.map((r) => ({
        dow: parseInt(r.dow),
        hour: parseInt(r.hour),
        count: parseInt(r.count),
        qualified: parseInt(r.qualified)
      })),
      timezone: tz
    });
  } catch (err) {
    console.error('[analytics] heatmap error:', err);
    res.status(500).json({ message: 'Failed to fetch heatmap data' });
  }
});

// ─── Helper ─────────────────────────────────────────────────────
async function getTrackingConfig(userId) {
  const res = await query('SELECT meta_ad_account_id, google_ads_customer_id, ga4_property_id FROM tracking_configs WHERE user_id = $1', [
    userId
  ]);
  return res.rows[0] || null;
}

// ─── Meta Drill-Down Endpoints ──────────────────────────────────

// GET /:userId/meta/adsets/:campaignId — Ad sets for a Meta campaign
router.get('/:userId/meta/adsets/:campaignId', async (req, res) => {
  try {
    const metaToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });

    const { userId, campaignId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const config = await getTrackingConfig(userId);
    const adAccountId = config?.meta_ad_account_id;
    if (!adAccountId) return res.status(404).json({ message: 'No Meta ad account configured for this client' });

    const adsets = await fetchAdSets(metaToken, adAccountId, campaignId, startDate, endDate);
    res.json({ adsets });
  } catch (err) {
    console.error('[analytics] meta adsets error:', err);
    res.status(500).json({ message: 'Failed to fetch ad sets' });
  }
});

// GET /:userId/meta/ads/:adSetId — Ads for a Meta ad set
router.get('/:userId/meta/ads/:adSetId', async (req, res) => {
  try {
    const metaToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });

    const { userId, adSetId } = req.params;
    const config = await getTrackingConfig(userId);
    const adAccountId = config?.meta_ad_account_id;
    if (!adAccountId) return res.status(404).json({ message: 'No Meta ad account configured for this client' });

    const { startDate, endDate } = parseDateRange(req);

    const ads = await fetchAdsForAdSet(metaToken, adAccountId, adSetId, startDate, endDate);
    res.json({ ads });
  } catch (err) {
    console.error('[analytics] meta ads error:', err);
    res.status(500).json({ message: 'Failed to fetch ads' });
  }
});

// GET /:userId/meta/ad-video/:adId — Playable source + permalink for a Meta ad's
// video creative. Fetched lazily when a video ad's preview lightbox is opened so
// the list endpoints stay fast and the (expiring) source URL is fresh on demand.
// The ad is verified to belong to the client's own Meta account before the asset
// is returned, so a caller authorized for one client can't dereference video
// objects elsewhere in the agency's shared system-token inventory.
router.get('/:userId/meta/ad-video/:adId', requireAnalyticsUserAccess, async (req, res) => {
  try {
    const metaToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });

    const { userId, adId } = req.params;
    if (!/^\d+$/.test(adId)) return res.status(400).json({ message: 'Invalid ad id' });

    const config = await getTrackingConfig(userId);
    const adAccountId = config?.meta_ad_account_id;
    if (!adAccountId) return res.status(404).json({ message: 'No Meta ad account configured for this client' });

    const video = await fetchAdVideoSource(metaToken, adAccountId, adId);
    if (!video) return res.status(404).json({ message: 'Video source unavailable' });

    res.json({ source: video.source, permalinkUrl: video.permalinkUrl });
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: 'Access denied' });
    console.error('[analytics] meta video error:', err);
    res.status(500).json({ message: 'Failed to fetch video source' });
  }
});

// ─── Google Ads Drill-Down Endpoints ────────────────────────────

// GET /:userId/google-ads/campaigns — Google Ads campaigns for a client
router.get('/:userId/google-ads/campaigns', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getTrackingConfig(userId);
    const customerId = config?.google_ads_customer_id;
    if (!customerId) return res.status(404).json({ message: 'No Google Ads account configured for this client' });

    const { startDate, endDate } = parseDateRange(req);

    const data = await fetchGoogleAdsAnalytics(customerId, startDate, endDate);
    if (!data) return res.status(501).json({ message: 'Google Ads API tokens not configured' });

    res.json(data);
  } catch (err) {
    console.error('[analytics] google-ads campaigns error:', err);
    res.status(500).json({ message: 'Failed to fetch Google Ads campaigns' });
  }
});

// GET /:userId/google-ads/ad-groups/:campaignId — Ad groups for a Google Ads campaign
router.get('/:userId/google-ads/ad-groups/:campaignId', async (req, res) => {
  try {
    const { userId, campaignId } = req.params;
    const config = await getTrackingConfig(userId);
    const customerId = config?.google_ads_customer_id;
    if (!customerId) return res.status(404).json({ message: 'No Google Ads account configured for this client' });

    const { startDate, endDate } = parseDateRange(req);

    const adGroups = await fetchAdGroups(customerId, campaignId, startDate, endDate);
    if (!adGroups) return res.status(501).json({ message: 'Google Ads API tokens not configured' });

    res.json({ adGroups });
  } catch (err) {
    console.error('[analytics] google-ads ad-groups error:', err);
    res.status(500).json({ message: 'Failed to fetch ad groups' });
  }
});

// GET /:userId/google-ads/ads/:adGroupId — Ads for a Google Ads ad group
router.get('/:userId/google-ads/ads/:adGroupId', async (req, res) => {
  try {
    const { userId, adGroupId } = req.params;
    const config = await getTrackingConfig(userId);
    const customerId = config?.google_ads_customer_id;
    if (!customerId) return res.status(404).json({ message: 'No Google Ads account configured for this client' });

    const { startDate, endDate } = parseDateRange(req);

    const ads = await fetchAdsForAdGroup(customerId, adGroupId, startDate, endDate);
    if (!ads) return res.status(501).json({ message: 'Google Ads API tokens not configured' });

    res.json({ ads });
  } catch (err) {
    console.error('[analytics] google-ads ads error:', err);
    res.status(500).json({ message: 'Failed to fetch ads' });
  }
});

// GET /:userId/google-ads/keywords/:adGroupId — Keywords for a Google Ads ad group
router.get('/:userId/google-ads/keywords/:adGroupId', async (req, res) => {
  try {
    const { userId, adGroupId } = req.params;
    const config = await getTrackingConfig(userId);
    const customerId = config?.google_ads_customer_id;
    if (!customerId) return res.status(404).json({ message: 'No Google Ads account configured for this client' });

    const { startDate, endDate } = parseDateRange(req);

    const keywords = await fetchKeywords(customerId, adGroupId, startDate, endDate);
    if (!keywords) return res.status(501).json({ message: 'Google Ads API tokens not configured' });

    res.json({ keywords });
  } catch (err) {
    console.error('[analytics] google-ads keywords error:', err);
    res.status(500).json({ message: 'Failed to fetch keywords' });
  }
});

// GET /:userId/google-ads/search-terms — Search terms for a Google Ads client (optionally filtered by campaign)
router.get('/:userId/google-ads/search-terms', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getTrackingConfig(userId);
    const customerId = config?.google_ads_customer_id;
    if (!customerId) return res.status(404).json({ message: 'No Google Ads account configured for this client' });

    const { startDate, endDate } = parseDateRange(req);

    const searchTerms = await fetchSearchTerms(customerId, startDate, endDate, req.query.campaignId || null);
    if (!searchTerms) return res.status(501).json({ message: 'Google Ads API tokens not configured' });

    res.json({ searchTerms });
  } catch (err) {
    console.error('[analytics] google-ads search-terms error:', err);
    res.status(500).json({ message: 'Failed to fetch search terms' });
  }
});

// GET /:userId/insights — Rule-based alerts + optional AI narrative
router.get('/:userId/insights', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);

    const current = await fetchUnifiedAnalytics(userId, startDate, endDate);

    let comparison = null;
    if (req.query.compareStart && req.query.compareEnd) {
      comparison = await fetchUnifiedAnalytics(userId, req.query.compareStart, req.query.compareEnd);
    }

    const alerts = evaluateRules(current, comparison);

    let aiInsights = null;
    if (req.query.ai === 'true') {
      try {
        const kpis = current.kpis || {};
        const meta = current.byPlatform?.metaAds || {};
        const gads = current.byPlatform?.googleAds || {};
        const ctm = current.byPlatform?.ctm || {};
        const ga4 = current.byPlatform?.ga4 || {};

        // Build campaign-level sections (only if data exists)
        const metaCampaigns = (meta.campaigns || []).sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5);
        const gadsCampaigns = (gads.campaigns || []).sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5);
        const ctmSources = (ctm.topSources || []).slice(0, 5);
        const topPages = (ga4.topPages || []).slice(0, 5);
        const trafficSources = (ga4.topSources || []).slice(0, 5);

        // Call metrics
        const totalCalls = ctm.totalCalls || 0;
        const missedCalls = ctm.missedCalls || 0;
        const qualifiedCalls = ctm.qualifiedCalls || 0;
        const missedRate = totalCalls > 0 ? ((missedCalls / totalCalls) * 100).toFixed(1) : '0';
        const qualifiedRate = totalCalls > 0 ? ((qualifiedCalls / totalCalls) * 100).toFixed(1) : '0';

        // Comparison section
        let comparisonSection = '';
        if (comparison) {
          const compKpis = comparison.kpis || {};
          const pctChange = (curr, prev) => (prev > 0 ? ((curr - prev) / prev) * 100 : null);
          const deltaLeads = pctChange(kpis.totalLeads || 0, compKpis.totalLeads || 0);
          const deltaSpend = pctChange(kpis.totalSpend || 0, compKpis.totalSpend || 0);
          const deltaCPL = pctChange(kpis.costPerLead || 0, compKpis.costPerLead || 0);
          const deltaSessions = pctChange(kpis.totalSessions || 0, compKpis.totalSessions || 0);
          const fmt = (v) => (v !== null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : 'N/A');
          comparisonSection = `\nPERIOD COMPARISON:
- Leads: ${fmt(deltaLeads)}
- Spend: ${fmt(deltaSpend)}
- CPL: ${fmt(deltaCPL)}
- Sessions: ${fmt(deltaSessions)}`;
        }

        // Build prompt sections conditionally
        const sections = [];

        sections.push(`Analyze this healthcare client's marketing performance for ${startDate} to ${endDate}.

EXECUTIVE SUMMARY:
- Qualified Leads: ${kpis.totalLeads || 0} (CTM verified, score >= 3)
- Ad Spend: $${(kpis.totalSpend || 0).toFixed(2)} (Meta + Google combined)
- Cost per Qualified Lead: $${(kpis.costPerLead || 0).toFixed(2)}
- Website Sessions: ${kpis.totalSessions || 0} (GA4)
- Conversion Rate: ${(kpis.conversionRate || 0).toFixed(2)}%`);

        if (metaCampaigns.length > 0) {
          sections.push(
            `META ADS CAMPAIGNS (top by spend):\n${metaCampaigns.map((c) => `- ${c.name}: $${(c.spend || 0).toFixed(2)}, ${c.clicks || 0} clicks, ${c.landingPageViews || 0} landing page views`).join('\n')}`
          );
        }

        if (gadsCampaigns.length > 0) {
          sections.push(
            `GOOGLE ADS CAMPAIGNS (top by spend):\n${gadsCampaigns.map((c) => `- ${c.name}: $${(c.spend || 0).toFixed(2)}, ${c.clicks || 0} clicks, ${c.conversions || 0} conversions`).join('\n')}`
          );
        }

        if (ctmSources.length > 0) {
          sections.push(`LEAD SOURCES (CTM):\n${ctmSources.map((s) => `- ${s.source}: ${s.count} leads`).join('\n')}`);
        }

        if (topPages.length > 0) {
          sections.push(
            `TOP LANDING PAGES:\n${topPages.map((p) => `- ${p.page}: ${p.sessions} sessions, ${p.engagedSessions || 0} engaged sessions, ${((p.engagementRate || 0) * 100).toFixed(0)}% engagement`).join('\n')}`
          );
        }

        if (trafficSources.length > 0) {
          sections.push(`TRAFFIC SOURCES:\n${trafficSources.map((s) => `- ${s.source}/${s.medium}: ${s.sessions} sessions`).join('\n')}`);
        }

        if (totalCalls > 0) {
          sections.push(`CALL METRICS:
- Total Calls: ${totalCalls}, Missed: ${missedCalls} (${missedRate}%)
- Qualified: ${qualifiedCalls} (${qualifiedRate}%)`);
        }

        if (comparisonSection) {
          sections.push(comparisonSection.trim());
        }

        sections.push(`Provide 5 specific, actionable insights. Reference actual campaign names, sources, and pages where available. Include:
1. What's working well and should be scaled
2. What's underperforming and needs attention
3. Budget reallocation recommendations
4. Landing page or ad creative suggestions
5. Operational improvements (missed calls, scheduling)`);

        const prompt = sections.join('\n\n');

        aiInsights = await generateAiResponse({
          prompt,
          systemPrompt:
            'You are a digital marketing analytics expert for a healthcare marketing agency. Provide 5 actionable insights grounded in the data provided. Reference specific campaign names, sources, and pages. Be specific and practical. Format as numbered list.',
          temperature: 0.5,
          maxTokens: 1500
        });
      } catch (aiErr) {
        console.error('[analytics] AI insights error:', aiErr);
        aiInsights = null;
      }
    }

    res.json({ alerts, aiInsights });
  } catch (err) {
    console.error('[analytics] insights error:', err);
    res.status(500).json({ message: 'Failed to generate insights' });
  }
});

// GET /:userId/overview — Unified analytics for a client
router.get('/:userId/overview', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);

    const data = await fetchUnifiedAnalytics(userId, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('[analytics] overview error:', err);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
});

export default router;
