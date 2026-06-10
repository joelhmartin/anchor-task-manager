import { query } from '../../db.js';
import { clientLabelSelect, clientLabelExpression, clientLabelJoins } from '../clientLabel.js';
import { formatClientLabel } from '../userFormatters.js';
import { executeAudit, resolveAuditDateRange } from './auditExecutor.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from '../mailgun.js';
import { DEFAULT_AUDIT_PRESET_ID, getAuditPreset, listAuditPresets, normalizeAuditModelId } from './auditPresets.js';
import { assertTimeZone } from '../util/timezone.js';

const APP_BASE_URL = process.env.APP_BASE_URL || process.env.CLIENT_APP_URL || 'http://localhost:3000';
const DEFAULT_PLATFORM = 'google_ads';
const DEFAULT_LOOKBACK_DAYS = 30;

function buildNextRunAtSql(timePlaceholder, timezonePlaceholder) {
  return `CASE
    WHEN ((date_trunc('day', NOW() AT TIME ZONE ${timezonePlaceholder}) + ${timePlaceholder}::time) AT TIME ZONE ${timezonePlaceholder}) > NOW()
      THEN ((date_trunc('day', NOW() AT TIME ZONE ${timezonePlaceholder}) + ${timePlaceholder}::time) AT TIME ZONE ${timezonePlaceholder})
    ELSE ((date_trunc('day', NOW() AT TIME ZONE ${timezonePlaceholder}) + interval '1 day' + ${timePlaceholder}::time) AT TIME ZONE ${timezonePlaceholder})
  END`;
}

function normalizeRecipientEmails(recipientEmails = []) {
  const input = Array.isArray(recipientEmails)
    ? recipientEmails
    : String(recipientEmails || '')
        .split(',')
        .map((item) => item.trim());

  return [
    ...new Set(
      input
        .map((email) =>
          String(email || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ];
}

function assertEmailList(recipientEmails) {
  if (!recipientEmails.length) {
    throw new Error('At least one recipient email is required');
  }
}

function assertDailyTimeLocal(value) {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(value || ''))) {
    throw new Error('Daily time must be in HH:MM or HH:MM:SS format');
  }
}

function getLookbackDays(configJson = {}) {
  const lookbackDays = Number(configJson.lookbackDays || DEFAULT_LOOKBACK_DAYS);
  return Number.isFinite(lookbackDays) ? Math.max(1, Math.min(90, lookbackDays)) : DEFAULT_LOOKBACK_DAYS;
}

async function ensureGoogleAdsConfigured(userId) {
  const { rows } = await query('SELECT google_ads_customer_id FROM tracking_configs WHERE user_id = $1 LIMIT 1', [userId]);
  if (!rows[0]?.google_ads_customer_id) {
    throw new Error('Google Ads account is not configured for this client');
  }
}

function normalizeUserIds(userIds = []) {
  return [...new Set((Array.isArray(userIds) ? userIds : [userIds]).map((id) => String(id || '').trim()).filter(Boolean))];
}

export async function listGoogleAdsAuditTargets({ userIds = null } = {}) {
  const scopedUserIds = userIds ? normalizeUserIds(userIds) : [];
  const params = [];
  let whereClause = `
    WHERE tc.google_ads_customer_id IS NOT NULL
      AND NULLIF(TRIM(tc.google_ads_customer_id), '') IS NOT NULL
  `;

  if (scopedUserIds.length > 0) {
    params.push(scopedUserIds);
    whereClause += ` AND tc.user_id = ANY($${params.length}::uuid[])`;
  }

  const { rows } = await query(
    `SELECT tc.user_id,
            u.first_name,
            u.last_name,
            u.email,
            ba.business_name,
            ${clientLabelSelect()},
            tc.google_ads_customer_id
     FROM tracking_configs tc
     JOIN users u ON u.id = tc.user_id
     ${clientLabelJoins('tc.user_id')}
     ${whereClause}
     ORDER BY ${clientLabelExpression()}`,
    params
  );

  return rows;
}

function sanitizeConfigJson(configJson = {}) {
  const normalizedModelId = normalizeAuditModelId(configJson.modelId, '');
  return {
    lookbackDays: getLookbackDays(configJson),
    ...(normalizedModelId ? { modelId: normalizedModelId } : {})
  };
}

async function updateRunWithResults(runId, status, payload = {}) {
  const fields = ['status = $2', 'updated_at = NOW()'];
  const values = [runId, status];
  let index = 3;

  for (const [column, value] of [
    ['summary_json', payload.summary ? JSON.stringify(payload.summary) : undefined],
    ['result_json', payload.result ? JSON.stringify(payload.result) : undefined],
    ['debug_json', payload.debug ? JSON.stringify(payload.debug) : undefined],
    ['error_message', payload.errorMessage],
    ['email_status', payload.emailStatus],
    ['started_at', payload.startedAt],
    ['completed_at', payload.completedAt]
  ]) {
    if (value !== undefined) {
      fields.push(`${column} = $${index}`);
      values.push(value);
      index += 1;
    }
  }

  const { rows } = await query(
    `UPDATE analytics_audit_runs
     SET ${fields.join(', ')}
     WHERE id = $1
     RETURNING *`,
    values
  );
  return rows[0];
}

async function loadScheduleById(scheduleId) {
  const { rows } = await query(
    `SELECT s.*,
            creator.first_name AS creator_first_name,
            creator.last_name AS creator_last_name,
            subject.first_name AS client_first_name,
            subject.last_name AS client_last_name,
            subject.email AS client_email
     FROM analytics_audit_schedules s
     JOIN users creator ON creator.id = s.created_by
     JOIN users subject ON subject.id = s.user_id
     WHERE s.id = $1`,
    [scheduleId]
  );
  return rows[0] || null;
}

export async function getAuditScheduleById(scheduleId) {
  return loadScheduleById(scheduleId);
}

async function loadRunByIdInternal(runId) {
  const { rows } = await query(
    `SELECT r.*,
            s.name AS schedule_name,
            s.recipient_emails,
            s.timezone,
            s.daily_time_local,
            s.config_json AS schedule_config_json,
            ba.business_name AS client_business_name,
            subject.first_name AS client_first_name,
            subject.last_name AS client_last_name,
            subject.email AS client_email,
            ${clientLabelSelect({ alias: 'client_label', u: 'subject' })}
     FROM analytics_audit_runs r
     LEFT JOIN analytics_audit_schedules s ON s.id = r.schedule_id
     JOIN users subject ON subject.id = r.user_id
     ${clientLabelJoins('r.user_id')}
     WHERE r.id = $1`,
    [runId]
  );
  return rows[0] || null;
}

function buildAuditEmail(run) {
  const summary = run.summary_json || {};
  const result = run.result_json || {};
  const findings = (result.findings || []).slice(0, 5);
  const runUrl = `${APP_BASE_URL.replace(/\/$/, '')}/operations?client=${run.user_id}&run=${run.id}`;
  const clientName = formatClientLabel(
    {
      client_label: run.client_label,
      business_name: run.client_business_name,
      first_name: run.client_first_name,
      last_name: run.client_last_name,
      email: run.client_email
    },
    'Client'
  );
  const severityCounts = summary.severityCounts || {};
  const severityLine = `Critical: ${severityCounts.critical || 0} | Warning: ${severityCounts.warning || 0} | Info: ${severityCounts.info || 0}`;
  const findingsLines = findings.length
    ? findings.map((finding) => `- [${String(finding.severity || '').toUpperCase()}] ${finding.title}`).join('\n')
    : '- No material red flags were detected.';
  const recommendationLines = (summary.topRecommendations || [])
    .slice(0, 3)
    .map((item) => `- ${item}`)
    .join('\n');

  return {
    subject: `Morning audit: ${clientName}`,
    text: `${summary.headline || 'Google Ads audit complete'}\n\n${summary.executiveSummary || ''}\n\n${severityLine}\n\nTop findings:\n${findingsLines}\n\nTop recommendations:\n${recommendationLines || '- No additional recommendations.'}\n\nOpen the full audit: ${runUrl}`,
    html: `
      <h2>${summary.headline || 'Google Ads audit complete'}</h2>
      <p>${summary.executiveSummary || ''}</p>
      <p><strong>${severityLine}</strong></p>
      <h3>Top findings</h3>
      <ul>
        ${
          findings.length
            ? findings
                .map((finding) => `<li><strong>${String(finding.severity || '').toUpperCase()}</strong>: ${finding.title}</li>`)
                .join('')
            : '<li>No material red flags were detected.</li>'
        }
      </ul>
      <h3>Top recommendations</h3>
      <ul>
        ${
          (summary.topRecommendations || []).slice(0, 3).length
            ? (summary.topRecommendations || [])
                .slice(0, 3)
                .map((item) => `<li>${item}</li>`)
                .join('')
            : '<li>No additional recommendations.</li>'
        }
      </ul>
      <p><a href="${runUrl}" target="_blank" rel="noopener">Open the full audit in Analytics</a></p>
    `
  };
}

async function sendScheduledAuditEmail(run) {
  if (!run.schedule_id) return 'skipped';
  if (!isMailgunConfigured()) return 'failed';

  const recipients = normalizeRecipientEmails(run.recipient_emails || []);
  if (!recipients.length) return 'failed';

  const email = buildAuditEmail(run);
  await sendMailgunMessageWithLogging(
    {
      to: recipients,
      subject: email.subject,
      text: email.text,
      html: email.html
    },
    {
      emailType: 'analytics_audit_digest',
      clientId: run.user_id,
      metadata: {
        auditRunId: run.id,
        auditScheduleId: run.schedule_id,
        providerPreset: run.provider_preset
      }
    }
  );

  return 'sent';
}

export function listAvailableAuditPresets() {
  return listAuditPresets();
}

export async function listAuditSchedules(userId) {
  const params = [];
  const filters = [];
  if (userId) {
    params.push(userId);
    filters.push(`s.user_id = $${params.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT s.*,
            ba.business_name AS client_business_name,
            subject.first_name AS client_first_name,
            subject.last_name AS client_last_name,
            subject.email AS client_email,
            ${clientLabelSelect({ alias: 'client_label', u: 'subject' })},
            last_run.id AS last_run_id,
            last_run.status AS last_run_status,
            last_run.created_at AS last_run_created_at,
            last_run.summary_json AS last_run_summary_json
     FROM analytics_audit_schedules s
     JOIN users subject ON subject.id = s.user_id
     ${clientLabelJoins('s.user_id')}
     LEFT JOIN LATERAL (
       SELECT r.id, r.status, r.created_at, r.summary_json
       FROM analytics_audit_runs r
       WHERE r.schedule_id = s.id
       ORDER BY r.created_at DESC
       LIMIT 1
     ) last_run ON TRUE
     ${whereClause}
     ORDER BY s.updated_at DESC`,
    params
  );

  return rows;
}

export async function createAuditSchedule({
  createdBy,
  userId,
  name,
  providerPreset,
  recipientEmails,
  dailyTimeLocal,
  timezone,
  paused,
  configJson
}) {
  if (!name || !String(name).trim()) throw new Error('Schedule name is required');
  const resolvedProviderPreset = providerPreset || DEFAULT_AUDIT_PRESET_ID;
  getAuditPreset(resolvedProviderPreset);
  assertTimeZone(timezone);
  assertDailyTimeLocal(dailyTimeLocal);

  const emails = normalizeRecipientEmails(recipientEmails);
  assertEmailList(emails);
  await ensureGoogleAdsConfigured(userId);

  const safeConfig = sanitizeConfigJson(configJson);
  const { rows } = await query(
    `INSERT INTO analytics_audit_schedules (
       created_by,
       user_id,
       name,
       platform,
       provider_preset,
       recipient_emails,
       daily_time_local,
       timezone,
       paused,
       next_run_at,
       config_json
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7::time, $8, $9,
       ${buildNextRunAtSql('$7', '$8')},
       $10
     )
     RETURNING *`,
    [
      createdBy,
      userId,
      String(name).trim(),
      DEFAULT_PLATFORM,
      resolvedProviderPreset,
      emails,
      dailyTimeLocal,
      timezone,
      Boolean(paused),
      JSON.stringify(safeConfig)
    ]
  );
  return rows[0];
}

export async function upsertBulkGoogleAdsAuditSchedules({
  createdBy,
  userIds = null,
  name,
  providerPreset,
  recipientEmails,
  dailyTimeLocal,
  timezone,
  paused,
  configJson
}) {
  if (!name || !String(name).trim()) throw new Error('Schedule name is required');

  const targets = await listGoogleAdsAuditTargets({ userIds });
  const results = {
    targetCount: targets.length,
    created: 0,
    updated: 0,
    failed: 0,
    schedules: [],
    failures: []
  };

  for (const target of targets) {
    try {
      const existing = await query(
        `SELECT id
         FROM analytics_audit_schedules
         WHERE user_id = $1
           AND platform = $2
           AND LOWER(name) = LOWER($3)
         ORDER BY updated_at DESC
         LIMIT 1`,
        [target.user_id, DEFAULT_PLATFORM, String(name).trim()]
      );

      if (existing.rows[0]?.id) {
        const schedule = await updateAuditSchedule(existing.rows[0].id, {
          name,
          providerPreset,
          recipientEmails,
          dailyTimeLocal,
          timezone,
          paused,
          configJson
        });
        results.updated += 1;
        results.schedules.push(schedule);
      } else {
        const schedule = await createAuditSchedule({
          createdBy,
          userId: target.user_id,
          name,
          providerPreset,
          recipientEmails,
          dailyTimeLocal,
          timezone,
          paused,
          configJson
        });
        results.created += 1;
        results.schedules.push(schedule);
      }
    } catch (err) {
      results.failed += 1;
      results.failures.push({
        userId: target.user_id,
        clientName: formatClientLabel(target),
        message: err.message || 'Failed to save schedule'
      });
    }
  }

  return results;
}

export async function updateAuditSchedule(scheduleId, updates = {}) {
  const existing = await loadScheduleById(scheduleId);
  if (!existing) throw new Error('Audit schedule not found');

  const next = {
    name: updates.name !== undefined ? updates.name : existing.name,
    providerPreset: updates.providerPreset !== undefined ? updates.providerPreset : existing.provider_preset || DEFAULT_AUDIT_PRESET_ID,
    recipientEmails: updates.recipientEmails !== undefined ? updates.recipientEmails : existing.recipient_emails,
    dailyTimeLocal: updates.dailyTimeLocal !== undefined ? updates.dailyTimeLocal : existing.daily_time_local,
    timezone: updates.timezone !== undefined ? updates.timezone : existing.timezone,
    paused: updates.paused !== undefined ? Boolean(updates.paused) : existing.paused,
    configJson: updates.configJson !== undefined ? updates.configJson : existing.config_json
  };

  if (!next.name || !String(next.name).trim()) throw new Error('Schedule name is required');
  getAuditPreset(next.providerPreset);
  assertTimeZone(next.timezone);
  assertDailyTimeLocal(next.dailyTimeLocal);
  const emails = normalizeRecipientEmails(next.recipientEmails);
  assertEmailList(emails);
  await ensureGoogleAdsConfigured(existing.user_id);

  const safeConfig = sanitizeConfigJson(next.configJson);
  const { rows } = await query(
    `UPDATE analytics_audit_schedules
     SET name = $2,
         provider_preset = $3,
         recipient_emails = $4,
         daily_time_local = $5::time,
         timezone = $6,
         paused = $7,
         next_run_at = ${buildNextRunAtSql('$5', '$6')},
         config_json = $8,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      scheduleId,
      String(next.name).trim(),
      next.providerPreset,
      emails,
      next.dailyTimeLocal,
      next.timezone,
      next.paused,
      JSON.stringify(safeConfig)
    ]
  );

  return rows[0];
}

export async function deleteAuditSchedule(scheduleId) {
  const { rowCount } = await query('DELETE FROM analytics_audit_schedules WHERE id = $1', [scheduleId]);
  return rowCount > 0;
}

export async function listAuditRuns({ userId = null, scheduleId = null, limit = 50 } = {}) {
  const params = [];
  const filters = [];
  if (userId) {
    params.push(userId);
    filters.push(`r.user_id = $${params.length}`);
  }
  if (scheduleId) {
    params.push(scheduleId);
    filters.push(`r.schedule_id = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(200, Number(limit) || 50)));

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT r.*,
            s.name AS schedule_name,
            ba.business_name AS client_business_name,
            subject.first_name AS client_first_name,
            subject.last_name AS client_last_name,
            subject.email AS client_email,
            ${clientLabelSelect({ alias: 'client_label', u: 'subject' })}
     FROM analytics_audit_runs r
     LEFT JOIN analytics_audit_schedules s ON s.id = r.schedule_id
     JOIN users subject ON subject.id = r.user_id
     ${clientLabelJoins('r.user_id')}
     ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getAuditRun(runId) {
  return loadRunByIdInternal(runId);
}

export async function executePersistedAuditRun(runId) {
  const run = await loadRunByIdInternal(runId);
  if (!run) throw new Error('Audit run not found');

  const configJson = run.schedule_config_json || run.debug_json?.requestConfig || {};
  const lookbackDays = getLookbackDays(configJson);
  const modelId = String(configJson.modelId || '').trim() || null;

  await updateRunWithResults(runId, 'running', {
    startedAt: new Date().toISOString(),
    errorMessage: null
  });

  try {
    const audit = await executeAudit({
      userId: run.user_id,
      providerPreset: run.provider_preset,
      lookbackDays,
      platform: run.platform,
      modelId
    });

    const completedRun = await updateRunWithResults(runId, 'success', {
      summary: audit.summary,
      result: audit.result,
      debug: audit.debug,
      emailStatus: run.trigger_type === 'scheduled' ? 'not_sent' : 'skipped',
      completedAt: new Date().toISOString()
    });

    if (run.trigger_type === 'scheduled') {
      try {
        const emailStatus = await sendScheduledAuditEmail({ ...run, ...completedRun });
        return await updateRunWithResults(runId, 'success', {
          emailStatus
        });
      } catch (emailErr) {
        console.error('[analytics:audits:email]', emailErr);
        return await updateRunWithResults(runId, 'success', {
          emailStatus: 'failed'
        });
      }
    }

    return completedRun;
  } catch (err) {
    console.error('[analytics:audits:run]', err);
    return updateRunWithResults(runId, 'error', {
      errorMessage: err.message || 'Audit execution failed',
      emailStatus: run.trigger_type === 'scheduled' ? 'failed' : 'skipped',
      completedAt: new Date().toISOString()
    });
  }
}

export async function runAuditScheduleNow(scheduleId) {
  const schedule = await loadScheduleById(scheduleId);
  if (!schedule) throw new Error('Audit schedule not found');
  await ensureGoogleAdsConfigured(schedule.user_id);

  const configJson = schedule.config_json || {};
  const lookbackDays = getLookbackDays(configJson);
  const dateRange = resolveAuditDateRange(lookbackDays);

  const { rows } = await query(
    `INSERT INTO analytics_audit_runs (
       schedule_id,
       trigger_type,
       status,
       user_id,
       platform,
       provider_preset,
       date_range_start,
       date_range_end,
       email_status,
       started_at
     )
     VALUES ($1, 'manual', 'running', $2, $3, $4, $5, $6, 'skipped', NOW())
     RETURNING *`,
    [schedule.id, schedule.user_id, schedule.platform, schedule.provider_preset, dateRange.startDate, dateRange.endDate]
  );

  return executePersistedAuditRun(rows[0].id);
}

export async function runAuditNow({ userId, providerPreset, configJson = {}, platform = DEFAULT_PLATFORM }) {
  if (platform !== DEFAULT_PLATFORM) {
    throw new Error('Only Google Ads audits are supported in v1');
  }

  await ensureGoogleAdsConfigured(userId);
  const resolvedProviderPreset = providerPreset || DEFAULT_AUDIT_PRESET_ID;
  getAuditPreset(resolvedProviderPreset);

  const safeConfig = sanitizeConfigJson(configJson);
  const dateRange = resolveAuditDateRange(getLookbackDays(safeConfig));

  const { rows } = await query(
    `INSERT INTO analytics_audit_runs (
       schedule_id,
       trigger_type,
       status,
       user_id,
       platform,
       provider_preset,
       date_range_start,
       date_range_end,
       email_status,
       started_at,
       debug_json
     )
     VALUES ($1, 'manual', 'running', $2, $3, $4, $5, $6, 'skipped', NOW(), $7)
     RETURNING *`,
    [null, userId, platform, resolvedProviderPreset, dateRange.startDate, dateRange.endDate, JSON.stringify({ requestConfig: safeConfig })]
  );

  return executePersistedAuditRun(rows[0].id);
}

export async function queueAuditRun({ userId, providerPreset, configJson = {}, platform = DEFAULT_PLATFORM }) {
  if (platform !== DEFAULT_PLATFORM) {
    throw new Error('Only Google Ads audits are supported in v1');
  }

  await ensureGoogleAdsConfigured(userId);
  const resolvedProviderPreset = providerPreset || DEFAULT_AUDIT_PRESET_ID;
  getAuditPreset(resolvedProviderPreset);

  const safeConfig = sanitizeConfigJson(configJson);
  const dateRange = resolveAuditDateRange(getLookbackDays(safeConfig));

  const { rows } = await query(
    `INSERT INTO analytics_audit_runs (
       schedule_id,
       trigger_type,
       status,
       user_id,
       platform,
       provider_preset,
       date_range_start,
       date_range_end,
       email_status,
       debug_json
     )
     VALUES ($1, 'manual', 'queued', $2, $3, $4, $5, $6, 'skipped', $7)
     RETURNING *`,
    [null, userId, platform, resolvedProviderPreset, dateRange.startDate, dateRange.endDate, JSON.stringify({ requestConfig: safeConfig })]
  );

  return rows[0];
}

export async function queueBulkGoogleAdsAuditRuns({ userIds = null, providerPreset, configJson = {}, platform = DEFAULT_PLATFORM }) {
  const targets = await listGoogleAdsAuditTargets({ userIds });
  const results = {
    targetCount: targets.length,
    queued: 0,
    failed: 0,
    runs: [],
    failures: []
  };

  for (const target of targets) {
    try {
      const run = await queueAuditRun({
        userId: target.user_id,
        providerPreset,
        configJson,
        platform
      });
      results.queued += 1;
      results.runs.push(run);
    } catch (err) {
      results.failed += 1;
      results.failures.push({
        userId: target.user_id,
        clientName: formatClientLabel(target),
        message: err.message || 'Failed to queue audit'
      });
    }
  }

  return results;
}

async function queueDueScheduledRuns(limit = 10) {
  const { rows: dueSchedules } = await query(
    `WITH due AS (
       SELECT id
       FROM analytics_audit_schedules
       WHERE platform = $1
         AND paused = false
         AND next_run_at IS NOT NULL
         AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE analytics_audit_schedules s
     SET next_run_at = ${buildNextRunAtSql('s.daily_time_local', 's.timezone')},
         updated_at = NOW()
     FROM due
     WHERE s.id = due.id
     RETURNING s.*`,
    [DEFAULT_PLATFORM, limit]
  );

  const queuedRunIds = [];
  for (const schedule of dueSchedules) {
    const lookbackDays = getLookbackDays(schedule.config_json || {});
    const dateRange = resolveAuditDateRange(lookbackDays);
    const { rows } = await query(
      `INSERT INTO analytics_audit_runs (
         schedule_id,
         trigger_type,
         status,
         user_id,
         platform,
         provider_preset,
         date_range_start,
         date_range_end,
         email_status
       )
       VALUES ($1, 'scheduled', 'queued', $2, $3, $4, $5, $6, 'not_sent')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [schedule.id, schedule.user_id, schedule.platform, schedule.provider_preset, dateRange.startDate, dateRange.endDate]
    );
    if (rows[0]?.id) {
      queuedRunIds.push(rows[0].id);
    }
  }

  return {
    claimedSchedules: dueSchedules.length,
    queuedRunIds
  };
}

async function claimQueuedRuns(limit = 10) {
  const { rows } = await query(
    `WITH claimed AS (
       SELECT id
       FROM analytics_audit_runs
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE analytics_audit_runs r
     SET status = 'running',
         started_at = COALESCE(r.started_at, NOW()),
         updated_at = NOW()
     FROM claimed
     WHERE r.id = claimed.id
     RETURNING r.id`,
    [limit]
  );

  return rows.map((row) => row.id);
}

export async function processDueAuditSchedules(limit = 10) {
  const queued = await queueDueScheduledRuns(limit);
  const claimedRunIds = await claimQueuedRuns(limit);
  const processed = [];

  for (const runId of claimedRunIds) {
    const completed = await executePersistedAuditRun(runId);
    processed.push(completed.id);
  }

  return {
    claimedSchedules: queued.claimedSchedules,
    queuedRuns: queued.queuedRunIds.length,
    processedRuns: processed.length,
    processedRunIds: processed
  };
}
