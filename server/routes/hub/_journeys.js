// Journey-scheduling engine: constants + helper functions for client journeys
// (status normalization, email-step validation, relative offset scheduling, schedule
// sync/backfill, and journey fetch/shaping). Extracted verbatim from hub.js. Shared by
// the hub.js aggregator AND the hub/journeys.js route sub-router — mirrors the _shared.js
// pattern so neither module reaches back into the other.
import { query } from '../../db.js';
import { activeOnly } from '../../services/queryHelpers.js';
import { isValidTimeZone, addDaysAtHourInTz, DEFAULT_TZ } from '../../services/util/timezone.js';
import { WEEK_IN_DAYS, parseDateValue } from './_shared.js';

export const JOURNEY_SCHEDULE_MIGRATION_KEY = 'journey_schedule_relative_v2';

export const JOURNEY_STATUS_OPTIONS = ['pending', 'in_progress', 'active_client', 'won', 'lost', 'archived'];

export function normalizeJourneyStatus(status, { activeClientId = null, archivedAt = null } = {}) {
  if (archivedAt) return 'archived';
  if (activeClientId) return 'active_client';
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (!normalized || normalized === 'pending') return 'in_progress';
  return JOURNEY_STATUS_OPTIONS.includes(normalized) ? normalized : 'in_progress';
}

export const JOURNEY_EMAIL_SUBJECT_MAX = 200;
export const JOURNEY_EMAIL_BODY_MAX = 50_000;
export const JOURNEY_EMAIL_VALID_FORMATS = new Set(['text', 'html']);
export const JOURNEY_EMAIL_VALID_EMAIL = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function sanitizeJourneyEmailReplyTo(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const v of value) {
    const t = String(v || '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    if (!JOURNEY_EMAIL_VALID_EMAIL(t)) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

// Boundary validator for a reply_to payload. Unlike sanitizeJourneyEmailReplyTo (which
// silently drops bad entries), this REJECTS malformed input so a typo'd address fails
// loudly instead of quietly falling back to a different Reply-To. Empty/whitespace-only
// entries are not errors (they let the field clear → practice default). Returns
// { value } on success or { error } on invalid input.
export function parseJourneyReplyToInput(value, { allowUndefined = false } = {}) {
  if (value === undefined) return allowUndefined ? { value: undefined } : { value: [] };
  if (value === null) return { value: [] };
  if (!Array.isArray(value)) return { error: 'reply_to must be an array of email addresses' };
  const provided = [
    ...new Set(value.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))
  ];
  const sanitized = sanitizeJourneyEmailReplyTo(value);
  if (sanitized.length !== provided.length) {
    return { error: 'One or more reply_to addresses are invalid' };
  }
  return { value: sanitized };
}

export function sanitizeJourneyStepEmailFields(step = {}) {
  const enabled = step?.email_enabled === true || step?.email_enabled === 'true';
  const subject = String(step?.email_subject || '').slice(0, JOURNEY_EMAIL_SUBJECT_MAX);
  const preheader = String(step?.email_preheader || '').slice(0, JOURNEY_EMAIL_SUBJECT_MAX);
  const bodyRaw = String(step?.email_body || '');
  const body = bodyRaw.length > JOURNEY_EMAIL_BODY_MAX ? bodyRaw.slice(0, JOURNEY_EMAIL_BODY_MAX) : bodyRaw;
  const formatRaw = String(step?.email_body_format || 'text').toLowerCase();
  const format = JOURNEY_EMAIL_VALID_FORMATS.has(formatRaw) ? formatRaw : 'text';
  const replyTo = sanitizeJourneyEmailReplyTo(step?.email_reply_to);
  const hourRaw = step?.email_send_hour;
  let sendHour = null;
  if (hourRaw !== undefined && hourRaw !== null && hourRaw !== '') {
    const n = Number(hourRaw);
    if (Number.isFinite(n)) {
      const clamped = Math.max(0, Math.min(23, Math.round(n)));
      sendHour = clamped;
    }
  }
  return {
    email_enabled: enabled,
    email_subject: subject,
    email_preheader: preheader,
    email_body: body,
    email_body_format: format,
    email_reply_to: replyTo,
    email_send_hour: sendHour
  };
}

export const DEFAULT_JOURNEY_EMAIL_SEND_HOUR = 9;

export function validateJourneyStepEmailConfig(emailFields) {
  if (!emailFields?.email_enabled) return null;
  if (!emailFields.email_subject?.trim()) return 'Email subject is required when email is enabled';
  if (!emailFields.email_body?.trim()) return 'Email body is required when email is enabled';
  return null;
}

export function normalizeJourneyOffsetDays(value, legacyWeeksValue = undefined) {
  const parsed = Number(value ?? legacyWeeksValue);
  if (!Number.isFinite(parsed)) return 0;
  if (value === undefined || value === null) {
    return Math.max(0, Math.round(parsed * WEEK_IN_DAYS));
  }
  return Math.max(0, Math.round(parsed));
}

export function validateJourneyStepOffsets(steps = []) {
  if (!Array.isArray(steps)) return null;
  let previousOffset = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const offsetDays = normalizeJourneyOffsetDays(step?.offset_days, step?.offset_weeks);
    if (index > 0 && offsetDays < previousOffset) {
      return `Step ${index + 1} cannot be scheduled before the previous step`;
    }
    previousOffset = offsetDays;
  }
  return null;
}

export function getJourneyOrderedSteps(steps = []) {
  return [...steps].sort((a, b) => {
    const aPos = Number.isFinite(Number(a?.position)) ? Number(a.position) : 0;
    const bPos = Number.isFinite(Number(b?.position)) ? Number(b.position) : 0;
    if (aPos !== bPos) return aPos - bPos;
    const aCreated = new Date(a?.created_at || 0).getTime();
    const bCreated = new Date(b?.created_at || 0).getTime();
    return aCreated - bCreated;
  });
}

export function buildJourneyStepSequence(existingSteps = [], candidateStep, targetPosition = null, replacingStepId = null) {
  const orderedSteps = getJourneyOrderedSteps(existingSteps).filter((step) => step.id !== replacingStepId);
  const insertAt = targetPosition === null ? orderedSteps.length : Math.max(0, Math.min(targetPosition, orderedSteps.length));
  const nextSteps = [...orderedSteps];
  nextSteps.splice(insertAt, 0, { ...candidateStep, position: insertAt });
  return nextSteps.map((step, index) => ({ ...step, position: index }));
}

export function deriveJourneyStepSchedule(steps = [], journeyCreatedAt, opts = {}) {
  const tz = isValidTimeZone(opts.timezone) ? opts.timezone : DEFAULT_TZ;
  const ordered = getJourneyOrderedSteps(steps);
  const journeyStart = parseDateValue(journeyCreatedAt) || new Date();
  let previousTargetDays = 0;
  let previousAnchor = journeyStart;

  return ordered.map((step, index) => {
    const targetDays = normalizeJourneyOffsetDays(step?.offset_days, step?.offset_weeks);
    const waitDays = index === 0 ? targetDays : Math.max(0, targetDays - previousTargetDays);
    const sendHourRaw = step?.email_send_hour;
    const sendHour = Number.isInteger(sendHourRaw) && sendHourRaw >= 0 && sendHourRaw <= 23
      ? sendHourRaw
      : DEFAULT_JOURNEY_EMAIL_SEND_HOUR;
    // Anchor: the previous step's completion or due time. Take its calendar
    // date in the client's TZ, add waitDays, set the wall-clock hour, and
    // resolve back to UTC. DST safe.
    const dueAt = addDaysAtHourInTz(previousAnchor, waitDays, sendHour, tz);
    const completedAt = parseDateValue(step?.completed_at);

    previousTargetDays = targetDays;
    previousAnchor = completedAt || dueAt;

    return {
      ...step,
      offset_days: targetDays,
      offset_weeks: targetDays / WEEK_IN_DAYS,
      due_at: dueAt,
      completed_at: completedAt || null
    };
  });
}

export function deriveJourneyNextActionAt(journey, steps = []) {
  const normalizedStatus = normalizeJourneyStatus(journey?.status, {
    activeClientId: journey?.active_client_id,
    archivedAt: journey?.archived_at
  });
  if (journey?.paused || ['active_client', 'won', 'lost', 'archived'].includes(normalizedStatus)) {
    return null;
  }
  return steps.find((step) => !step.completed_at)?.due_at || null;
}

export async function normalizeJourneyStepPositions(journeyId, runQuery = query) {
  await runQuery(
    `WITH ordered AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, created_at ASC) - 1 AS new_pos
       FROM client_journey_steps
       WHERE journey_id = $1
     )
     UPDATE client_journey_steps c
     SET position = ordered.new_pos
     FROM ordered
     WHERE c.id = ordered.id`,
    [journeyId]
  );
}

export async function syncJourneySchedule(journeyId, ownerId, runQuery = query) {
  const journeyRes = await runQuery(
    `SELECT j.id, j.owner_user_id, j.status, j.paused, j.active_client_id, j.archived_at, j.created_at,
            cp.timezone AS owner_timezone
       FROM client_journeys j
       LEFT JOIN client_profiles cp ON cp.user_id = j.owner_user_id
      WHERE j.id = $1 AND j.owner_user_id = $2
      LIMIT 1`,
    [journeyId, ownerId]
  );
  const journey = journeyRes.rows[0];
  if (!journey) return null;

  const stepsRes = await runQuery(
    `SELECT id, journey_id, position, label, channel, message, offset_days, offset_weeks, due_at, completed_at, notes, created_at, email_send_hour
     FROM client_journey_steps
     WHERE journey_id = $1
     ORDER BY position ASC, created_at ASC`,
    [journeyId]
  );

  const scheduledSteps = deriveJourneyStepSchedule(stepsRes.rows, journey.created_at, { timezone: journey.owner_timezone });
  for (const step of scheduledSteps) {
    await runQuery(
      `UPDATE client_journey_steps
       SET offset_days = $1,
           offset_weeks = $2,
           due_at = $3
       WHERE id = $4
         AND journey_id = $5`,
      [step.offset_days, Math.round(step.offset_days / WEEK_IN_DAYS), step.due_at, step.id, journeyId]
    );
  }

  const nextActionAt = deriveJourneyNextActionAt(journey, scheduledSteps);
  await runQuery(
    `UPDATE client_journeys
     SET next_action_at = $1
     WHERE id = $2
       AND owner_user_id = $3`,
    [nextActionAt, journeyId, ownerId]
  );

  return { nextActionAt, steps: scheduledSteps };
}

// Re-sync every active, non-archived journey for an owner. Called when the
// owner's client_profiles.timezone changes — pending steps' due_at gets
// recomputed in the new TZ; already-sent emails are immutable (the cron's
// `email_sent_at IS NULL` filter skips them).
export async function resyncActiveJourneysForOwner(ownerId) {
  const { rows } = await query(
    `SELECT id FROM client_journeys
      WHERE owner_user_id = $1
        AND ${activeOnly()}
        AND COALESCE(status, '') NOT IN ('won', 'lost', 'active_client', 'archived')
        AND paused = FALSE`,
    [ownerId]
  );
  for (const j of rows) {
    try {
      await syncJourneySchedule(j.id, ownerId);
    } catch (err) {
      console.error('[journeys:resync-on-tz-change]', j.id, err.message || err);
    }
  }
  return rows.length;
}

let hasBackfilledJourneySchedules = false;
export async function maybeBackfillJourneySchedules() {
  if (hasBackfilledJourneySchedules) return;
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [JOURNEY_SCHEDULE_MIGRATION_KEY]);
  if (rows[0]?.value?.completed_at) {
    hasBackfilledJourneySchedules = true;
    return;
  }

  const journeysRes = await query('SELECT id, owner_user_id FROM client_journeys');
  for (const journey of journeysRes.rows) {
    await syncJourneySchedule(journey.id, journey.owner_user_id);
  }

  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [JOURNEY_SCHEDULE_MIGRATION_KEY, { completed_at: new Date().toISOString() }]
  );
  hasBackfilledJourneySchedules = true;
}

export async function fetchJourneysForOwner(ownerId, filters = {}) {
  await ensureJourneyTables();
  const params = [ownerId];
  const conditions = ['cj.owner_user_id = $1'];
  const showArchivedOnly = filters.archived === true;
  const includeArchived = filters.includeArchived === true;
  if (filters.id) {
    params.push(filters.id);
    conditions.push(`cj.id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`cj.status = $${params.length}`);
  }
  if (filters.active_client_id) {
    params.push(filters.active_client_id);
    conditions.push(`cj.active_client_id = $${params.length}`);
  }
  if (showArchivedOnly) {
    conditions.push('cj.archived_at IS NOT NULL');
  } else if (!includeArchived) {
    conditions.push(activeOnly('cj'));
  }
  const sql = `SELECT cj.*,
                      s.name as service_name,
                      s.description as service_description,
                      pj.client_name as parent_journey_name,
                      (SELECT COALESCE(json_agg(json_build_object('service_id', ucs.service_id, 'service_name', ucs.service_name) ORDER BY ucs.service_name), '[]'::json)
                         FROM contact_services ucs
                        WHERE ucs.contact_id = cj.contact_id AND ucs.owner_user_id = cj.owner_user_id AND ucs.redacted_at IS NULL) AS services,
                      (
                        SELECT ARRAY(
                          SELECT DISTINCT email FROM (
                            SELECT u.email AS email FROM users u WHERE u.id = cj.owner_user_id
                            UNION ALL
                            SELECT UNNEST(COALESCE(cp_inner.form_notification_emails, ARRAY[]::TEXT[])) AS email
                              FROM client_profiles cp_inner
                              WHERE cp_inner.user_id = cj.owner_user_id
                            UNION ALL
                            SELECT UNNEST(COALESCE(f.notification_emails, ARRAY[]::TEXT[])) AS email
                              FROM ctm_forms f
                              WHERE f.org_id = cj.owner_user_id AND f.notification_emails IS NOT NULL
                          ) emails
                          WHERE email IS NOT NULL AND email <> ''
                          ORDER BY email
                        )
                      ) AS client_notification_emails,
                      -- Resolve an email associated with this contact: the journey's own
                      -- email first, else (matched by phone digits) the client record, else
                      -- the most recent form/call that captured a caller_email.
                      COALESCE(
                        NULLIF(cj.client_email, ''),
                        -- Phase 3: the contact's own primary email (contact_id stamped on
                        -- the journey). NULL pre-backfill → falls through to the phone chain.
                        (SELECT NULLIF(co.primary_email, '') FROM contacts co WHERE co.id = cj.contact_id AND co.owner_user_id = cj.owner_user_id),
                        (SELECT ac.client_email FROM active_clients ac
                           WHERE ac.owner_user_id = cj.owner_user_id
                             AND ac.client_email IS NOT NULL AND ac.client_email <> ''
                             AND cj.client_phone IS NOT NULL
                             AND LENGTH(REGEXP_REPLACE(ac.client_phone, '[^0-9]', '', 'g')) >= 10
                             AND LENGTH(REGEXP_REPLACE(cj.client_phone, '[^0-9]', '', 'g')) >= 10
                             AND RIGHT(REGEXP_REPLACE(ac.client_phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(cj.client_phone, '[^0-9]', '', 'g'), 10)
                           ORDER BY ac.archived_at NULLS FIRST, ac.created_at DESC LIMIT 1),
                        (SELECT cl.meta->>'caller_email' FROM call_logs cl
                           WHERE cl.owner_user_id = cj.owner_user_id
                             AND cl.from_number IS NOT NULL
                             AND cj.client_phone IS NOT NULL
                             AND LENGTH(REGEXP_REPLACE(cl.from_number, '[^0-9]', '', 'g')) >= 10
                             AND LENGTH(REGEXP_REPLACE(cj.client_phone, '[^0-9]', '', 'g')) >= 10
                             AND RIGHT(REGEXP_REPLACE(cl.from_number, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(cj.client_phone, '[^0-9]', '', 'g'), 10)
                             AND cl.meta->>'caller_email' IS NOT NULL AND cl.meta->>'caller_email' <> ''
                           ORDER BY cl.started_at DESC LIMIT 1)
                      ) AS resolved_email
               FROM client_journeys cj
               LEFT JOIN services s ON cj.service_id = s.id
               LEFT JOIN client_journeys pj ON cj.parent_journey_id = pj.id
               ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
               ORDER BY cj.created_at DESC`;
  const { rows } = await query(sql, params);
  if (!rows.length) {
    return filters.id ? null : [];
  }
  const journeyIds = rows.map((row) => row.id);
  // created_by display name (one query, batched)
  const { rows: creatorRows } = await query(
    `SELECT cj.id AS journey_id, u.first_name, u.last_name, u.email
       FROM client_journeys cj LEFT JOIN users u ON u.id = cj.created_by
      WHERE cj.id = ANY($1::uuid[])`,
    [journeyIds]
  );
  const creatorMap = new Map(
    creatorRows.map((r) => [
      r.journey_id,
      [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null
    ])
  );

  // activity timelines, batched
  const { rows: actRows } = await query(
    `SELECT a.*, u.first_name, u.last_name, u.email
       FROM client_journey_activities a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.journey_id = ANY($1::uuid[])
      ORDER BY a.created_at DESC`,
    [journeyIds]
  );
  const actMap = new Map();
  for (const a of actRows) {
    if (!actMap.has(a.journey_id)) actMap.set(a.journey_id, []);
    actMap.get(a.journey_id).push(shapeActivityRow(a));
  }

  const shaped = rows.map((row) => {
    const activities = actMap.get(row.id) || [];
    const pendingSend = activities.find((x) => x.email_status === 'scheduled') || null;
    return {
      ...row,
      stage: row.stage || null,
      status: row.status || 'active',
      // Prefer the phone-resolved email so phone-only journeys still surface a
      // contact email when one exists elsewhere (client record / prior form).
      client_email: row.resolved_email || row.client_email || null,
      symptoms: Array.isArray(row.symptoms) ? row.symptoms : [],
      created_by_name: creatorMap.get(row.id) || null,
      activities,
      pending_send: pendingSend,
      service: row.service_id
        ? { id: row.service_id, name: row.service_name, description: row.service_description }
        : null
    };
  });
  return filters.id ? shaped[0] || null : shaped;
}

// Local shaper (kept here so hub.js owns its journey response shape).
export function shapeActivityRow(a) {
  const authorName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || null;
  return {
    id: a.id, type: a.type, stage_at: a.stage_at, to_stage: a.to_stage,
    subject: a.subject || '', body: a.body || '', body_format: a.body_format || 'text',
    template_id: a.template_id, scheduled_for: a.scheduled_for,
    email_status: a.email_status, email_error: a.email_error,
    created_by: a.created_by, author_name: authorName, created_at: a.created_at,
    metadata: a.metadata || {}
  };
}

export async function fetchJourneyForOwner(ownerId, journeyId) {
  return fetchJourneysForOwner(ownerId, { id: journeyId, includeArchived: true });
}

export async function attachJourneyMetaToCalls(ownerId, calls = []) {
  await ensureJourneyTables();
  if (!calls?.length) return calls;
  const { rows } = await query(
    `SELECT id, lead_call_key, symptoms, status, paused, next_action_at, created_at
     FROM client_journeys
     WHERE owner_user_id = $1
       AND lead_call_key IS NOT NULL
       AND ${activeOnly()}
       AND active_client_id IS NULL
       AND COALESCE(status, 'in_progress') NOT IN ('active_client', 'won', 'lost', 'archived')
     ORDER BY created_at DESC`,
    [ownerId]
  );
  const map = new Map();
  rows.forEach((row) => {
    if (map.has(row.lead_call_key)) return;
    map.set(row.lead_call_key, {
      id: row.id,
      status: normalizeJourneyStatus(row.status),
      paused: row.paused,
      next_action_at: row.next_action_at,
      symptoms: Array.isArray(row.symptoms) ? row.symptoms : []
    });
  });
  return calls.map((call) => {
    const journey = map.get(call.id);
    if (!journey) return call;
    return { ...call, journey };
  });
}

let hasEnsuredJourneyTables = false;
export async function ensureJourneyTables() {
  if (hasEnsuredJourneyTables) return;
  const { rows } = await query(`SELECT to_regclass('public.client_journeys') AS table_name`);
  if (!rows[0]?.table_name) {
    await query(`
      CREATE TABLE IF NOT EXISTS client_journeys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lead_call_id UUID REFERENCES call_logs(id) ON DELETE SET NULL,
        lead_call_key TEXT REFERENCES call_logs(call_id) ON DELETE SET NULL,
        active_client_id UUID REFERENCES active_clients(id) ON DELETE SET NULL,
        client_name TEXT,
        client_phone TEXT,
        client_email TEXT,
        symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
        symptoms_redacted BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'in_progress',
        paused BOOLEAN NOT NULL DEFAULT FALSE,
        next_action_at TIMESTAMPTZ,
        notes_summary TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        archived_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_client_journeys_owner ON client_journeys(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_client_journeys_status ON client_journeys(status);
      CREATE INDEX IF NOT EXISTS idx_client_journeys_lead_call_key ON client_journeys(lead_call_key);
      CREATE TABLE IF NOT EXISTS client_journey_steps (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        journey_id UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        label TEXT NOT NULL,
        channel TEXT,
        message TEXT,
        offset_weeks INTEGER DEFAULT 0,
        offset_days INTEGER DEFAULT 0,
        due_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_client_journey_steps_journey ON client_journey_steps(journey_id);
      CREATE TABLE IF NOT EXISTS client_journey_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        journey_id UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_client_journey_notes_journey ON client_journey_notes(journey_id);
    `);
  } else {
    await query(`
      ALTER TABLE client_journeys
        ADD COLUMN IF NOT EXISTS lead_call_key TEXT,
        ADD COLUMN IF NOT EXISTS symptoms_redacted BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_client_journeys_lead_call_key ON client_journeys(lead_call_key);
      UPDATE client_journeys cj
      SET lead_call_key = cl.call_id
      FROM call_logs cl
      WHERE cj.lead_call_key IS NULL AND cj.lead_call_id = cl.id;
    `);
  }
  await query(`
    ALTER TABLE client_journeys
      ALTER COLUMN status SET DEFAULT 'in_progress';

    ALTER TABLE client_journey_steps
      ADD COLUMN IF NOT EXISTS offset_days INTEGER;

    UPDATE client_journey_steps
    SET offset_days = GREATEST(0, COALESCE(offset_days, offset_weeks * ${WEEK_IN_DAYS}, 0))
    WHERE offset_days IS NULL;

    UPDATE client_journeys
    SET status = 'in_progress',
        updated_at = NOW()
    WHERE COALESCE(status, 'pending') = 'pending'
      AND ${activeOnly()}
      AND active_client_id IS NULL;

    UPDATE client_journeys
    SET status = 'active_client',
        updated_at = NOW()
    WHERE active_client_id IS NOT NULL
      AND ${activeOnly()}
      AND COALESCE(status, '') <> 'active_client';

    DELETE FROM call_log_tags clt
    USING call_logs cl, lead_tags lt
    WHERE clt.call_id = cl.call_id
      AND clt.tag_id = lt.id
      AND LOWER(lt.name) = 'in journey'
      AND (lt.owner_user_id = cl.owner_user_id OR lt.owner_user_id = cl.user_id)
      AND (
        cl.active_client_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM active_clients ac
          WHERE ac.owner_user_id = lt.owner_user_id
            AND ${activeOnly('ac')}
            AND RIGHT(REGEXP_REPLACE(ac.client_phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(cl.from_number, '[^0-9]', '', 'g'), 10)
        )
      );
  `);
  hasEnsuredJourneyTables = true;
  await maybeBackfillJourneySchedules();
}
