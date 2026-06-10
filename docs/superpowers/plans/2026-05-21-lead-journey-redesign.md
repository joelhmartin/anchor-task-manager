# Lead Journey Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile timed-template lead journey with a fixed-stage, human-driven pipeline (First→Fourth Touch → Awaiting Decision), a per-touch activity log, per-client reusable email templates, manual (optionally scheduled) sends, a gated SMS path, durable action attribution, and a safe carry-over migration.

**Architecture:** Evolve `client_journeys` in place. Add `stage` + `created_by`; add `client_journey_activities` (the timeline) and `journey_email_templates` (per-client library); add `active_clients.converted_by`. Retire the timed-step machinery (`client_journey_steps` math, `journey_template:*`, `apply-template`, `seedJourneySteps`/`syncJourneySchedule`) and replace the template-timeline cron with a lean "send what's due" processor. Every touch row carries `created_by` (the real acting user), which natively satisfies the absorbed lead-action-attribution work. Frontend gains a two-tab Journeys page (Pipeline Kanban + Email Templates), a redesigned per-lead drawer, and a Stage column + Previous-Journey badge on the leads list.

**Tech Stack:** Express 4 / Node 20 ESM, PostgreSQL 15 (`uuid_generate_v4()`, JSONB), `node-cron`, Mailgun (`sendMailgunMessageWithLogging`), React 19 + MUI 7 (Grid aliased to GridLegacy), Axios client (`src/api/client`), shared components in `src/ui-component/extended/`.

**Spec:** `docs/superpowers/specs/2026-05-21-lead-journey-redesign-design.md` (supersedes `2026-05-20-lead-action-attribution-design.md`).

**No test suite.** Verification per task = `yarn build` + `yarn lint` + the task's explicit SQL/curl/visual check, then commit. See `.claude/skills/verify-without-tests`.

**Conventions to honor (from CLAUDE.md):**
- `client_profiles.client_identifier_value` is the canonical client display name.
- Parameterized queries only; no PHI in logs/`details`/API responses.
- Owner = `req.portalUserId || req.user.id`; **actor = `req.user.id`** (real user, even under impersonation).
- Toast on every state change; update local state from the server response immediately (no refetch-only).
- Imports resolve from `src/` (no deep relative paths for shared components).
- `console.log` is stripped in prod (client) / nulled (server) — use `console.error`/`console.warn` for anything that must survive in Cloud Run.

---

## File Structure

**Backend — create:**
- `server/sql/migrate_lead_journey_redesign.sql` — schema + safe one-time data carry-over.
- `server/services/journeyScheduledSends.js` — lean due-row email processor (replaces `journeyEmailScheduler.js`).
- `server/services/journeyActivities.js` — small shared module: stage constants, `advanceStage()`, `recordActivity()`, `sendJourneyEmailNow()`, activity fetch/shape. Keeps `hub.js` from growing further and is reused by the cron.

**Backend — modify:**
- `server/services/activityLog.js` — new event types + `lead` category + `deriveCategory()`.
- `server/routes/hub.js` — rebuild the journey endpoint block (`8044`–`8826`), add `converted_by` to `agree-to-service` (~`9262`), add `add_lead_note` log (`7440`), add Previous-Journey flag to the leads list query.
- `server/index.js` — register migration in the chain (after `maybeRunBrandAssetsDedupUniqueMigration`, line `2056`); swap the journey-emails cron (lines `1753`–`1772`) + import (line `43`).

**Frontend — modify/create:**
- `src/api/journeys.js` — rewrite to the new endpoint surface.
- `src/api/journeyTemplates.js` *(create)* — per-client template CRUD client.
- `src/views/client/ClientPortal/leads/PipelineBoard.jsx` *(create)* — Kanban board.
- `src/views/client/ClientPortal/JourneyTab.jsx` — redesigned drawer (activity timeline + action bar + dialogs).
- `src/views/client/ClientPortal/leads/SendEmailDialog.jsx` *(create)* — template/custom + now/schedule.
- `src/views/client/ClientPortal/leads/EmailTemplatesPane.jsx` *(create)* — templates tab.
- `src/views/client/ClientPortal/LeadsTab.jsx` — Stage column + Previous-Journey badge + tab host.
- `src/views/client/ClientPortal/leads/journeyHelpers.js` — stage labels/order/colors.
- `src/hooks/useJourneys.js`, `src/hooks/useJourneyDrawer.jsx` — adapt to new shape (remove step logic).

**Docs — modify (final task):** `docs/API_REFERENCE.md`, `SKILLS.md` (schema), `CLAUDE.md` "Where to Look" if needed.

---

## Phase 0 — Branch & docs

### Task 0: Cut the implementation branch and commit the design + plan

**Files:** none (git only)

- [ ] **Step 1: Create a clean branch from main**

The current branch `feature/priority-section-headers` has an unrelated active session. Cut the implementation branch from `main` so the two don't entangle. The uncommitted spec/plan docs travel with the checkout.

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"
git stash list   # confirm nothing to clobber; do NOT stash (repo has long-lived stashes)
git checkout main
git pull --ff-only
git checkout -b feature/lead-journey-redesign
```

- [ ] **Step 2: Commit the design + plan docs**

```bash
git add docs/superpowers/specs/2026-05-21-lead-journey-redesign-design.md \
        docs/superpowers/specs/2026-05-20-lead-action-attribution-design.md \
        docs/superpowers/plans/2026-05-21-lead-journey-redesign.md
git commit -m "docs: lead journey redesign design + implementation plan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Expected: clean commit on `feature/lead-journey-redesign`.

---

## Phase 1 — Database migration (foundation)

### Task 1: Write the migration SQL

**Files:**
- Create: `server/sql/migrate_lead_journey_redesign.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Lead Journey Redesign — schema + safe one-time carry-over.
-- Idempotent: schema parts use IF NOT EXISTS; the data block self-guards on an
-- app_settings sentinel so it runs exactly once even across reboots/replicas.

-- ── Schema (idempotent) ───────────────────────────────────────────────
ALTER TABLE client_journeys
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE active_clients
  ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS journey_email_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  subject       TEXT,
  body          TEXT,
  body_format   TEXT NOT NULL DEFAULT 'html' CHECK (body_format IN ('html','text')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_journey_email_templates_owner
  ON journey_email_templates(owner_user_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS client_journey_activities (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id    UUID NOT NULL REFERENCES client_journeys(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('email','call','text','note','stage_change')),
  stage_at      TEXT,
  to_stage      TEXT,
  subject       TEXT,
  body          TEXT,
  body_format   TEXT DEFAULT 'text',
  template_id   UUID REFERENCES journey_email_templates(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,
  email_status  TEXT,            -- scheduled | sent | failed | canceled | skipped
  email_error   TEXT,
  send_attempts INTEGER NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_journey_activities_journey
  ON client_journey_activities(journey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_activities_due
  ON client_journey_activities(scheduled_for)
  WHERE email_status = 'scheduled';

-- ── Data carry-over (runs exactly once; sentinel-guarded, transactional) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'migration:lead_journey_redesign_v1') THEN
    RETURN;
  END IF;

  -- (a) Map each existing journey to the new stage/status.
  WITH progress AS (
    SELECT j.id AS journey_id,
           COUNT(s.id) FILTER (WHERE s.completed_at IS NOT NULL) AS completed_steps
    FROM client_journeys j
    LEFT JOIN client_journey_steps s ON s.journey_id = j.id
    GROUP BY j.id
  )
  UPDATE client_journeys j
  SET
    status = CASE
      WHEN j.archived_at IS NOT NULL                                            THEN 'archived'
      WHEN j.active_client_id IS NOT NULL OR j.status IN ('active_client','won') THEN 'converted'
      WHEN j.status = 'lost'                                                    THEN 'archived'
      ELSE 'active'
    END,
    stage = CASE
      WHEN j.archived_at IS NOT NULL
        OR j.active_client_id IS NOT NULL
        OR j.status IN ('active_client','won','lost')                          THEN NULL
      ELSE (ARRAY['first_touch','second_touch','third_touch','fourth_touch','awaiting_decision'])
             [LEAST(p.completed_steps, 4) + 1]
    END,
    archived_at = CASE WHEN j.status = 'lost' AND j.archived_at IS NULL THEN NOW() ELSE j.archived_at END,
    next_action_at = NULL
  FROM progress p
  WHERE p.journey_id = j.id;

  -- (b) Copy history into activities with removable provenance.
  INSERT INTO client_journey_activities (journey_id, owner_user_id, type, body, created_by, created_at, metadata)
  SELECT n.journey_id, j.owner_user_id, 'note', n.body, n.author_id, n.created_at,
         '{"source":"journey_redesign_migration"}'::jsonb
  FROM client_journey_notes n JOIN client_journeys j ON j.id = n.journey_id;

  INSERT INTO client_journey_activities (journey_id, owner_user_id, type, subject, body, body_format, email_status, created_at, metadata)
  SELECT s.journey_id, j.owner_user_id, 'email', s.email_subject, s.email_body,
         COALESCE(s.email_body_format,'text'), 'sent', s.email_sent_at,
         '{"source":"journey_redesign_migration"}'::jsonb
  FROM client_journey_steps s JOIN client_journeys j ON j.id = s.journey_id
  WHERE s.email_sent_at IS NOT NULL;

  INSERT INTO client_journey_activities (journey_id, owner_user_id, type, body, created_at, metadata)
  SELECT s.journey_id, j.owner_user_id, 'note', s.notes, s.created_at,
         '{"source":"journey_redesign_migration"}'::jsonb
  FROM client_journey_steps s JOIN client_journeys j ON j.id = s.journey_id
  WHERE s.notes IS NOT NULL AND btrim(s.notes) <> '';

  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('migration:lead_journey_redesign_v1', 'true'::jsonb, NOW())
  ON CONFLICT (key) DO NOTHING;
END $$;
```

- [ ] **Step 2: Verify it parses (no app changes yet)**

Run: `psql "postgresql://bif@localhost:5432/anchor" -f server/sql/migrate_lead_journey_redesign.sql`
Expected: `ALTER TABLE`, `CREATE TABLE`/`CREATE INDEX`, and `DO` all succeed with no error. Re-run the same command — expected: identical success, and the data block is skipped (sentinel present).

- [ ] **Step 3: Confirm the sentinel and a clean shape**

Run:
```bash
psql "postgresql://bif@localhost:5432/anchor" -c \
"SELECT value FROM app_settings WHERE key='migration:lead_journey_redesign_v1';
 SELECT status, stage, count(*) FROM client_journeys GROUP BY 1,2 ORDER BY 1,2;
 SELECT type, count(*) FROM client_journey_activities GROUP BY 1;"
```
Expected: sentinel = `true`; every `active` journey has a non-NULL stage; every `archived`/`converted` journey has `stage = NULL`; activity counts ≥ source note/email counts.

- [ ] **Step 4: Commit**

```bash
git add server/sql/migrate_lead_journey_redesign.sql
git commit -m "feat(journeys): redesign migration — stage/activities/templates + safe carry-over"
```

### Task 2: Register the migration in the startup chain

**Files:**
- Modify: `server/index.js` (helper near line `640`; chain at line `2056`)

- [ ] **Step 1: Add the migration runner** (place it next to `maybeRunBrandAssetsDedupUniqueMigration`, ~line `668`)

```js
async function maybeRunLeadJourneyRedesignMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_lead_journey_redesign.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_lead_journey_redesign.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}
```

- [ ] **Step 2: Append to the chain** — change line `2056`:

```js
    .then(maybeRunBrandAssetsDedupUniqueMigration)
    .then(maybeRunLeadJourneyRedesignMigration)
    .then(auditDuplicateLifecycleRecords)
```

- [ ] **Step 3: Restart the server and verify the migration logs**

Run: `lsof -ti:4000 | xargs kill -9 2>/dev/null; yarn server` (watch startup)
Expected: line `[migrations] ran migrate_lead_journey_redesign.sql` and `[migrations] All migrations completed successfully`. No crash.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(journeys): register redesign migration in startup chain"
```

---

## Phase 2 — Activity log event types

### Task 3: Add lead/journey event types + `lead` category

**Files:**
- Modify: `server/services/activityLog.js` (`ActivityEventTypes` ~`83`, `ActivityCategories` ~`98`, `deriveCategory` ~`162`)

- [ ] **Step 1: Add event types** — after the `UNHIDE_CALL: 'unhide_call'` line (no trailing comma issue — add a comma after it):

```js
  HIDE_CALL: 'hide_call',
  HIDE_CALL_SINGLE: 'hide_call_single',
  UNHIDE_CALL: 'unhide_call',

  // Lead journey lifecycle
  START_JOURNEY: 'start_journey',
  ADVANCE_JOURNEY_STAGE: 'advance_journey_stage',
  SEND_JOURNEY_EMAIL: 'send_journey_email',
  LOG_JOURNEY_CALL: 'log_journey_call',
  ADD_JOURNEY_NOTE: 'add_journey_note',
  ADD_LEAD_NOTE: 'add_lead_note',
  ARCHIVE_JOURNEY: 'archive_journey',
  CONVERT_TO_CLIENT: 'convert_to_client'
```

- [ ] **Step 2: Add the `LEAD` category** — in `ActivityCategories`, add after `NAVIGATION: 'navigation'` (add comma):

```js
  NAVIGATION: 'navigation',
  LEAD: 'lead'
```

- [ ] **Step 3: Map categories in `deriveCategory()`** — add before the `if (actionType.includes('client'))` check (so `convert_to_client` still resolves to client, but the journey/lead events resolve to `lead`):

```js
  if (actionType === 'convert_to_client') {
    return ActivityCategories.CLIENT; // it creates a client
  }
  if (actionType.includes('journey') || actionType === 'add_lead_note') {
    return ActivityCategories.LEAD;
  }
```

- [ ] **Step 4: Verify lint + build**

Run: `yarn lint && yarn build`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/activityLog.js
git commit -m "feat(activity-log): add lead journey event types + lead category"
```

---

## Phase 3 — Backend shared journey module

### Task 4: Create `journeyActivities.js` (stage constants + activity helpers)

**Files:**
- Create: `server/services/journeyActivities.js`

This module is the single source of truth for stages and for writing activity rows + advancing. Both `hub.js` and the cron import it (DRY).

- [ ] **Step 1: Create the module**

```js
/**
 * Journey activity + stage helpers (redesigned lead journey).
 * Single source of truth for the fixed stage order and for recording touches.
 * No PHI in logs. All callers pass the real acting user as createdBy.
 */
import { query } from '../db.js';

export const JOURNEY_STAGES = ['first_touch', 'second_touch', 'third_touch', 'fourth_touch', 'awaiting_decision'];
export const JOURNEY_STAGE_LABELS = {
  first_touch: 'First Touch',
  second_touch: 'Second Touch',
  third_touch: 'Third Touch',
  fourth_touch: 'Fourth Touch',
  awaiting_decision: 'Awaiting Decision'
};
export const ACTIVITY_TYPES = ['email', 'call', 'text', 'note', 'stage_change'];

/** Next stage after a completed touch; clamps at awaiting_decision. */
export function nextStage(stage) {
  const i = JOURNEY_STAGES.indexOf(stage);
  if (i < 0) return 'first_touch';
  return JOURNEY_STAGES[Math.min(i + 1, JOURNEY_STAGES.length - 1)];
}

export function isValidStage(stage) {
  return JOURNEY_STAGES.includes(stage);
}

/**
 * Insert one activity row. Returns the created row (shaped, with author_name).
 * runQuery lets callers pass a transaction client.
 */
export async function recordActivity(
  { journeyId, ownerId, type, stageAt = null, toStage = null, subject = null, body = null,
    bodyFormat = 'text', templateId = null, scheduledFor = null, emailStatus = null,
    createdBy = null, metadata = {} },
  runQuery = query
) {
  const { rows } = await runQuery(
    `INSERT INTO client_journey_activities
       (journey_id, owner_user_id, type, stage_at, to_stage, subject, body, body_format,
        template_id, scheduled_for, email_status, created_by, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [journeyId, ownerId, type, stageAt, toStage, subject, body, bodyFormat,
     templateId, scheduledFor, emailStatus, createdBy, JSON.stringify(metadata || {})]
  );
  return rows[0];
}

/** Move a journey to a stage (used by manual moves and by touch advancement). */
export async function setJourneyStage(journeyId, ownerId, stage, runQuery = query) {
  await runQuery(
    `UPDATE client_journeys SET stage = $3, updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2`,
    [journeyId, ownerId, stage]
  );
}

/** Fetch + shape the activity timeline for one journey (newest first). */
export async function fetchJourneyActivities(journeyId, runQuery = query) {
  const { rows } = await runQuery(
    `SELECT a.*, u.first_name, u.last_name, u.email
       FROM client_journey_activities a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.journey_id = $1
      ORDER BY a.created_at DESC`,
    [journeyId]
  );
  return rows.map(shapeActivity);
}

export function shapeActivity(a) {
  const authorName =
    [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || a.email || null;
  return {
    id: a.id,
    type: a.type,
    stage_at: a.stage_at,
    to_stage: a.to_stage,
    subject: a.subject || '',
    body: a.body || '',
    body_format: a.body_format || 'text',
    template_id: a.template_id,
    scheduled_for: a.scheduled_for,
    email_status: a.email_status,
    email_error: a.email_error,
    created_by: a.created_by,
    author_name: authorName,
    created_at: a.created_at,
    metadata: a.metadata || {}
  };
}

/** Cancel a journey's pending scheduled sends (used by cancel endpoint + convert/archive). */
export async function cancelPendingSends(journeyId, runQuery = query) {
  await runQuery(
    `UPDATE client_journey_activities
        SET email_status = 'canceled'
      WHERE journey_id = $1 AND email_status = 'scheduled'`,
    [journeyId]
  );
}
```

- [ ] **Step 2: Lint + build**

Run: `yarn lint && yarn build`
Expected: pass (module is imported in later tasks).

- [ ] **Step 3: Commit**

```bash
git add server/services/journeyActivities.js
git commit -m "feat(journeys): shared stage + activity helpers module"
```

### Task 5: Add the shared email-send helper

**Files:**
- Modify: `server/services/journeyActivities.js`

Reuse the proven branding/Mailgun path from the old scheduler, but keyed to a journey + activity row instead of a step.

- [ ] **Step 1: Add imports at the top of `journeyActivities.js`**

```js
import { sendMailgunMessageWithLogging, isMailgunConfigured, getMailgunFromAddress } from './mailgun.js';
import { wrapClientEmailHtml, plainTextToParagraphs } from './emailTemplate.js';
import { renderTemplate } from './ctmFormNotifications.js';
```

- [ ] **Step 2: Add helpers (append to the module)**

```js
const isValidEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const firstNameOf = (full) => (full ? String(full).trim().split(/\s+/)[0] || '' : '');

async function resolveClientBranding(ownerUserId) {
  let businessName = '', logoUrl = '';
  try {
    const { rows } = await query(
      `SELECT business_name, logos FROM brand_assets WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`, [ownerUserId]);
    businessName = rows[0]?.business_name || '';
    let logos = rows[0]?.logos;
    if (typeof logos === 'string') { try { logos = JSON.parse(logos); } catch { logos = []; } }
    if (Array.isArray(logos) && logos.length) {
      const first = logos.find((l) => l?.url && String(l.url).trim());
      if (first) logoUrl = String(first.url).trim();
    }
  } catch (_) {}
  return { businessName, logoUrl };
}

/**
 * Render + send one journey email immediately. Throws on failure.
 * Tokens are non-PHI only (client_name/first_name/email/phone). skipBodyLogging forced on.
 * `journey` must include owner_user_id, client_name, client_email, client_phone.
 */
export async function sendJourneyEmailNow({ journey, subject, body, bodyFormat = 'html', activityId }) {
  if (!isMailgunConfigured()) throw new Error('Mailgun is not configured');
  if (!journey.client_email || !isValidEmail(journey.client_email)) {
    throw new Error('Lead has no valid email address');
  }
  const tokens = {
    client_name: journey.client_name || '',
    first_name: firstNameOf(journey.client_name || ''),
    client_email: journey.client_email || '',
    client_phone: journey.client_phone || ''
  };
  const renderedSubject = renderTemplate(subject || '', tokens);
  if (!renderedSubject.trim()) throw new Error('Email subject is empty');
  const bodyHtml = bodyFormat === 'html'
    ? renderTemplate(body || '', tokens)
    : renderTemplate(plainTextToParagraphs(body || ''), tokens);

  const { businessName, logoUrl } = await resolveClientBranding(journey.owner_user_id);
  const fromName = (businessName || 'Anchor').replace(/[<>"\r\n]/g, '').trim();
  const fromAddress = process.env.MAILGUN_DEFAULT_FROM_ADDRESS || getMailgunFromAddress();
  if (!fromAddress) throw new Error('Mailgun From address is not configured');

  const htmlEmail = wrapClientEmailHtml({
    subject: renderedSubject,
    preheader: renderedSubject,
    bodyHtml: bodyHtml || '<p style="margin:0;">.</p>',
    logoUrl: logoUrl || null
  });

  await sendMailgunMessageWithLogging(
    { to: [journey.client_email], subject: renderedSubject, html: htmlEmail, from: `${fromName} <${fromAddress}>` },
    { emailType: 'journey_touch_email', recipientName: journey.client_name || undefined,
      clientId: journey.owner_user_id,
      metadata: { journey_id: journey.id, activity_id: activityId }, skipBodyLogging: true }
  );
}
```

- [ ] **Step 3: Lint + build, then commit**

Run: `yarn lint && yarn build` → pass.
```bash
git add server/services/journeyActivities.js
git commit -m "feat(journeys): shared journey email send helper (branding + non-PHI tokens)"
```

---

## Phase 4 — Backend journey endpoints

> All endpoint edits are in `server/routes/hub.js`. Add this import near the other service imports at the top of the file:
> ```js
> import {
>   JOURNEY_STAGES, isValidStage, nextStage, recordActivity, setJourneyStage,
>   fetchJourneyActivities, cancelPendingSends, sendJourneyEmailNow
> } from '../services/journeyActivities.js';
> import { logUserActivity, ActivityEventTypes, ActivityCategories } from '../services/activityLog.js';
> ```
> (Check whether `logUserActivity` is already imported — if so, just add the missing names.)

### Task 6: Rebuild `fetchJourneysForOwner` to return stage + activities

**Files:**
- Modify: `server/routes/hub.js:769`–`938`

- [ ] **Step 1: Replace the steps/notes shaping with activities + created_by_name**

Replace the body from the `stepsRes` query (line `828`) through the end of the `shaped` map (line `937`) with:

```js
  const journeyIds = rows.map((row) => row.id);

  // created_by display name (one query, batched)
  const { rows: creatorRows } = await query(
    `SELECT cj.id AS journey_id, u.first_name, u.last_name, u.email
       FROM client_journeys cj LEFT JOIN users u ON u.id = cj.created_by
      WHERE cj.id = ANY($1::uuid[])`, [journeyIds]);
  const creatorMap = new Map(creatorRows.map((r) => [
    r.journey_id,
    [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email || null
  ]));

  // activity timelines, batched
  const { rows: actRows } = await query(
    `SELECT a.*, u.first_name, u.last_name, u.email
       FROM client_journey_activities a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.journey_id = ANY($1::uuid[])
      ORDER BY a.created_at DESC`, [journeyIds]);
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

// Local shaper (kept here so hub.js owns its response shape).
function shapeActivityRow(a) {
  const authorName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || a.email || null;
  return {
    id: a.id, type: a.type, stage_at: a.stage_at, to_stage: a.to_stage,
    subject: a.subject || '', body: a.body || '', body_format: a.body_format || 'text',
    template_id: a.template_id, scheduled_for: a.scheduled_for,
    email_status: a.email_status, email_error: a.email_error,
    created_by: a.created_by, author_name: authorName, created_at: a.created_at,
    metadata: a.metadata || {}
  };
}
```

> Note: the `service_name`/`service_description`/`parent_journey` SELECT joins at lines `792`–`817` stay as-is. Remove the `ownerTimezone` lookup (lines `823`–`827`) and the `deriveJourneyStepSchedule`/`deriveJourneyNextActionAt`/`normalizeJourneyStatus` calls — those helpers are retired in Task 16.

- [ ] **Step 2: Restart server, verify list loads**

Run: `lsof -ti:4000 | xargs kill -9; yarn server` then in another shell, after logging in via the UI, hit the endpoint through the proxy or check the server starts clean.
Expected: server boots, no reference errors. (Functional check happens in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): shape journeys with stage + activity timeline + created_by"
```

### Task 7: `POST /journeys` — start at first_touch, stamp created_by, log

**Files:**
- Modify: `server/routes/hub.js:8110`–`8278`

- [ ] **Step 1: Add `created_by` + `stage` to the INSERT** (lines `8214`–`8250`). Add the two columns and values, and set status default to `'active'`:

```js
      const insert = await client.query(
        `INSERT INTO client_journeys (
           owner_user_id, lead_call_id, lead_call_key, active_client_id,
           client_name, client_phone, client_email, symptoms,
           status, stage, paused, next_action_at, notes_summary,
           service_id, parent_journey_id, created_by
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','first_touch',false,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          ownerId, leadCallUuid, leadCallKey, active_client_id || null,
          client_name || null, client_phone || null, client_email || null, symptomsJsonPayload,
          nextActionAt, notes_summary || null, service_id || null, parent_journey_id || null,
          req.user.id
        ]
      );
```

- [ ] **Step 2: Replace the `seedJourneySteps`/`syncJourneySchedule` block** (lines `8252`–`8256`) with the start-journey activity log (only on new):

```js
    if (newlyCreatedJourneyId) {
      await recordActivity({
        journeyId: newlyCreatedJourneyId, ownerId, type: 'stage_change',
        toStage: 'first_touch', stageAt: null, createdBy: req.user.id,
        metadata: { event: 'started' }
      }, client.query.bind(client));
    }
    await client.query('COMMIT');
    if (newlyCreatedJourneyId) {
      logUserActivity({
        userId: req.user.id, actionType: ActivityEventTypes.START_JOURNEY,
        actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
        targetEntityType: 'journey', targetEntityId: newlyCreatedJourneyId,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        details: { journeyId: newlyCreatedJourneyId }
      }).catch(() => {});
    }
```

> Keep the existing `findExisting` dedupe and the update-existing branch (do not log on update). Update the `findExisting` SQL status filter (line `8163`) to the new terminal set: `NOT IN ('converted','archived')`.

- [ ] **Step 3: Restart + functional check**

Run: start a journey from the UI leads list (or `curl` the endpoint with a valid session cookie). 
Expected: response journey has `stage: "first_touch"`, `status: "active"`, `created_by_name` set, `activities` contains the `stage_change` "started" row.
SQL check: `psql ... -c "SELECT stage,status,created_by FROM client_journeys ORDER BY created_at DESC LIMIT 1;"`

- [ ] **Step 4: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): start journeys at first_touch with created_by + activity log"
```

### Task 8: `PATCH /journeys/:id/stage` — manual move

**Files:**
- Modify: `server/routes/hub.js` (add after the `PUT /journeys/:id` handler, ~line `8358`)

- [ ] **Step 1: Add the endpoint**

```js
router.patch('/journeys/:id/stage', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { stage } = req.body || {};
  if (!isValidStage(stage)) {
    return res.status(400).json({ message: 'Invalid stage' });
  }
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT stage FROM client_journeys
        WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    const fromStage = rows[0].stage;
    await setJourneyStage(id, ownerId, stage);
    await recordActivity({
      journeyId: id, ownerId, type: 'stage_change',
      stageAt: fromStage, toStage: stage, createdBy: req.user.id
    });
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ADVANCE_JOURNEY_STAGE,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      details: { from: fromStage, to: stage }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:stage]', err);
    res.status(500).json({ message: 'Unable to move journey' });
  }
});
```

- [ ] **Step 2: Restart + check** — move a journey via `curl`/UI; expected `journey.stage` updated and a `stage_change` activity present.
- [ ] **Step 3: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): manual stage move endpoint with stage_change activity"
```

### Task 9: `POST /journeys/:id/email` — send now or schedule (auto-advance on send)

**Files:**
- Modify: `server/routes/hub.js` (add after the stage endpoint)

- [ ] **Step 1: Add the endpoint**

```js
router.post('/journeys/:id/email', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { template_id = null, subject = '', body = '', body_format = 'html', scheduled_for = null } = req.body || {};
  if (!subject.trim() && !body.trim()) {
    return res.status(400).json({ message: 'Email needs a subject or body' });
  }
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT * FROM client_journeys WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`,
      [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    const journey = rows[0];

    if (scheduled_for) {
      const when = new Date(scheduled_for);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Schedule time must be in the future' });
      }
      await cancelPendingSends(id); // one pending touch at a time → replace
      await recordActivity({
        journeyId: id, ownerId, type: 'email', stageAt: journey.stage,
        subject, body, bodyFormat: body_format, templateId: template_id,
        scheduledFor: when.toISOString(), emailStatus: 'scheduled', createdBy: req.user.id
      });
      logUserActivity({
        userId: req.user.id, actionType: ActivityEventTypes.SEND_JOURNEY_EMAIL,
        actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
        targetEntityType: 'journey', targetEntityId: id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        details: { scheduled: true, templateId: template_id || null }
      }).catch(() => {});
    } else {
      const activity = await recordActivity({
        journeyId: id, ownerId, type: 'email', stageAt: journey.stage,
        subject, body, bodyFormat: body_format, templateId: template_id,
        emailStatus: 'sent', createdBy: req.user.id
      });
      try {
        await sendJourneyEmailNow({ journey, subject, body, bodyFormat: body_format, activityId: activity.id });
      } catch (sendErr) {
        await query(`UPDATE client_journey_activities SET email_status='failed', email_error=$2 WHERE id=$1`,
          [activity.id, String(sendErr.message || sendErr).slice(0, 500)]);
        return res.status(502).json({ message: `Email failed to send: ${sendErr.message}` });
      }
      await setJourneyStage(id, ownerId, nextStage(journey.stage)); // advance on send
      logUserActivity({
        userId: req.user.id, actionType: ActivityEventTypes.SEND_JOURNEY_EMAIL,
        actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
        targetEntityType: 'journey', targetEntityId: id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        details: { scheduled: false, templateId: template_id || null }
      }).catch(() => {});
    }
    const journeyOut = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey: journeyOut });
  } catch (err) {
    console.error('[journeys:email]', err);
    res.status(500).json({ message: 'Unable to send email' });
  }
});
```

- [ ] **Step 2: Restart + check** — send-now from `curl` to a journey whose lead has a valid email; expected: a `sent` email activity, stage advanced one step, and (if Mailgun configured) the email arrives. Schedule variant: expected a `scheduled` activity, **no stage change**.
- [ ] **Step 3: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): send/schedule journey email, advance stage on send"
```

### Task 10: `POST /journeys/:id/call` — log a call, advance

**Files:** Modify: `server/routes/hub.js`

- [ ] **Step 1: Add the endpoint**

```js
router.post('/journeys/:id/call', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { body = '' } = req.body || {};
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT stage FROM client_journeys WHERE id=$1 AND owner_user_id=$2 AND status='active'`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    await recordActivity({ journeyId: id, ownerId, type: 'call', stageAt: rows[0].stage,
      body: body || null, createdBy: req.user.id });
    await setJourneyStage(id, ownerId, nextStage(rows[0].stage));
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.LOG_JOURNEY_CALL,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { from: rows[0].stage }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:call]', err);
    res.status(500).json({ message: 'Unable to log call' });
  }
});
```

- [ ] **Step 2: Check + commit** — log a call; expected `call` activity + advanced stage.

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): log call activity and advance stage"
```

### Task 11: `POST /journeys/:id/note` — note, no advance

**Files:** Modify: `server/routes/hub.js`

- [ ] **Step 1: Add the endpoint**

```js
router.post('/journeys/:id/note', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { body = '' } = req.body || {};
  if (!body.trim()) return res.status(400).json({ message: 'Note body is required' });
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT stage FROM client_journeys WHERE id=$1 AND owner_user_id=$2`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    await recordActivity({ journeyId: id, ownerId, type: 'note', stageAt: rows[0].stage,
      body, createdBy: req.user.id });
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ADD_JOURNEY_NOTE,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { journeyId: id }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:note]', err);
    res.status(500).json({ message: 'Unable to add note' });
  }
});
```

- [ ] **Step 2: Check + commit** — add a note; expected `note` activity, stage unchanged.

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): add journey note activity (no advance)"
```

### Task 12: `POST /journeys/:id/text` — gated SMS stub

**Files:** Modify: `server/routes/hub.js`

- [ ] **Step 1: Add the endpoint (no dispatch)**

```js
router.post('/journeys/:id/text', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const enabled = process.env.JOURNEY_SMS_ENABLED === 'true';
  const { body = '', scheduled_for = null } = req.body || {};
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT stage FROM client_journeys WHERE id=$1 AND owner_user_id=$2 AND status='active'`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    if (!enabled) {
      // Record intent for visibility, but never dispatch.
      await recordActivity({ journeyId: id, ownerId, type: 'text', stageAt: rows[0].stage,
        body: body || null, scheduledFor: scheduled_for || null, emailStatus: 'skipped',
        createdBy: req.user.id, metadata: { gated: true } });
      const journey = await fetchJourneyForOwner(ownerId, id);
      return res.status(200).json({ journey, gated: true, message: 'SMS is not enabled yet' });
    }
    // When enabled later: dispatch via Twilio here, then advance like email.
    return res.status(501).json({ message: 'SMS dispatch not implemented' });
  } catch (err) {
    console.error('[journeys:text]', err);
    res.status(500).json({ message: 'Unable to record text' });
  }
});
```

- [ ] **Step 2: Check + commit** — POST text; expected `gated: true`, a `skipped` text activity, no SMS, no stage change.

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): gated SMS endpoint (records intent, never dispatches)"
```

### Task 13: `POST /journeys/:id/schedule/cancel`

**Files:** Modify: `server/routes/hub.js`

- [ ] **Step 1: Add the endpoint**

```js
router.post('/journeys/:id/schedule/cancel', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    await ensureJourneyTables();
    const { rows } = await query(
      `SELECT id FROM client_journeys WHERE id=$1 AND owner_user_id=$2`, [id, ownerId]);
    if (!rows.length) return res.status(404).json({ message: 'Journey not found' });
    await cancelPendingSends(id);
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:schedule-cancel]', err);
    res.status(500).json({ message: 'Unable to cancel scheduled send' });
  }
});
```

- [ ] **Step 2: Check + commit** — schedule then cancel; expected pending send flips to `canceled`.

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): cancel pending scheduled send endpoint"
```

### Task 14: Rework archive / unarchive (cancel pending, set stage/status, log)

**Files:** Modify: `server/routes/hub.js:8360`–`8419`

- [ ] **Step 1: Replace the archive handler**

```js
router.post('/journeys/:id/archive', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    await ensureJourneyTables();
    const result = await query(
      `UPDATE client_journeys
          SET status='archived', stage=NULL, archived_at=COALESCE(archived_at,NOW()),
              next_action_at=NULL, updated_at=NOW()
        WHERE id=$1 AND owner_user_id=$2 RETURNING id`, [id, ownerId]);
    if (!result.rowCount) return res.status(404).json({ message: 'Journey not found' });
    await cancelPendingSends(id);
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ARCHIVE_JOURNEY,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { journeyId: id }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:archive]', err);
    res.status(500).json({ message: 'Unable to archive journey' });
  }
});
```

- [ ] **Step 2: Replace the unarchive handler**

```js
router.post('/journeys/:id/unarchive', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    await ensureJourneyTables();
    const result = await query(
      `UPDATE client_journeys
          SET status='active', stage=COALESCE(stage,'first_touch'), archived_at=NULL, updated_at=NOW()
        WHERE id=$1 AND owner_user_id=$2 RETURNING id`, [id, ownerId]);
    if (!result.rowCount) return res.status(404).json({ message: 'Journey not found' });
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:unarchive]', err);
    res.status(500).json({ message: 'Unable to restore journey' });
  }
});
```

- [ ] **Step 3: Check + commit** — archive a journey with a pending send; expected status=archived, stage NULL, pending send canceled. Unarchive; expected active + stage restored.

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): archive/unarchive set stage+status, cancel pending sends, log"
```

### Task 15: Convert — `converted_by` + `/journeys/:id/convert`

**Files:** Modify: `server/routes/hub.js` (agree-to-service ~`9262`; add convert endpoint)

- [ ] **Step 1: Stamp `converted_by` on the `active_clients` INSERT**

Locate the `active_clients` INSERT inside `agree-to-service` (search `INSERT INTO active_clients` between lines `9262`–`9340`). Add `converted_by` to the column list and `req.user.id` to the values. If the INSERT uses a column/value list, add `converted_by` and the matching `$n` param. (The exact column list varies; add the one column + value without disturbing the others.)

- [ ] **Step 2: Add a thin convert endpoint** (closes the journey; the client row itself is created by the existing agree-to-service flow the UI already calls)

```js
router.post('/journeys/:id/convert', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { active_client_id = null } = req.body || {};
  try {
    await ensureJourneyTables();
    const result = await query(
      `UPDATE client_journeys
          SET status='converted', stage=NULL, next_action_at=NULL,
              active_client_id=COALESCE($3, active_client_id), updated_at=NOW()
        WHERE id=$1 AND owner_user_id=$2 RETURNING id`, [id, ownerId, active_client_id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Journey not found' });
    await cancelPendingSends(id);
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.CONVERT_TO_CLIENT,
      actionCategory: ActivityCategories.CLIENT, targetUserId: ownerId,
      targetEntityType: 'journey', targetEntityId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { journeyId: id }
    }).catch(() => {});
    const journey = await fetchJourneyForOwner(ownerId, id);
    res.json({ journey });
  } catch (err) {
    console.error('[journeys:convert]', err);
    res.status(500).json({ message: 'Unable to convert journey' });
  }
});
```

- [ ] **Step 3: Check + commit** — convert a journey; expected status=converted, stage NULL, `convert_to_client` logged, `converted_by` set on the new active_clients row.

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): convert endpoint + converted_by attribution"
```

### Task 16: Email templates CRUD

**Files:** Modify: `server/routes/hub.js` (add a templates block; replace the retired `journey-template` GET/PUT at `8044`–`8067`)

- [ ] **Step 1: Replace the old `journey-template` endpoints (8044–8067) with per-client CRUD**

```js
// Per-client reusable email templates (replaces the old single journey-template).
router.get('/journey-email-templates', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  try {
    const { rows } = await query(
      `SELECT id, name, subject, body, body_format, created_at, updated_at
         FROM journey_email_templates
        WHERE owner_user_id = $1 AND archived_at IS NULL
        ORDER BY updated_at DESC`, [ownerId]);
    res.json({ templates: rows });
  } catch (err) {
    console.error('[journey-templates:list]', err);
    res.status(500).json({ message: 'Unable to load templates' });
  }
});

router.post('/journey-email-templates', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { name = '', subject = '', body = '', body_format = 'html' } = req.body || {};
  if (!name.trim()) return res.status(400).json({ message: 'Template name is required' });
  if (!['html', 'text'].includes(body_format)) return res.status(400).json({ message: 'Invalid format' });
  try {
    const { rows } = await query(
      `INSERT INTO journey_email_templates (owner_user_id, name, subject, body, body_format, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, subject, body, body_format, created_at, updated_at`,
      [ownerId, name.trim(), subject, body, body_format, req.user.id]);
    res.json({ template: rows[0] });
  } catch (err) {
    console.error('[journey-templates:create]', err);
    res.status(500).json({ message: 'Unable to create template' });
  }
});

router.put('/journey-email-templates/:templateId', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { templateId } = req.params;
  const { name, subject, body, body_format } = req.body || {};
  if (body_format && !['html', 'text'].includes(body_format)) {
    return res.status(400).json({ message: 'Invalid format' });
  }
  try {
    const { rows } = await query(
      `UPDATE journey_email_templates
          SET name = COALESCE($3,name), subject = COALESCE($4,subject),
              body = COALESCE($5,body), body_format = COALESCE($6,body_format), updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL
        RETURNING id, name, subject, body, body_format, created_at, updated_at`,
      [templateId, ownerId, name ?? null, subject ?? null, body ?? null, body_format ?? null]);
    if (!rows.length) return res.status(404).json({ message: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    console.error('[journey-templates:update]', err);
    res.status(500).json({ message: 'Unable to update template' });
  }
});

router.delete('/journey-email-templates/:templateId', async (req, res) => {
  const ownerId = req.portalUserId || req.user.id;
  const { templateId } = req.params;
  try {
    const { rowCount } = await query(
      `UPDATE journey_email_templates SET archived_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL`, [templateId, ownerId]);
    if (!rowCount) return res.status(404).json({ message: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[journey-templates:delete]', err);
    res.status(500).json({ message: 'Unable to delete template' });
  }
});
```

- [ ] **Step 2: Check + commit** — CRUD a template via `curl`; expected create/list/update/soft-delete all owner-scoped.

```bash
git add server/routes/hub.js
git commit -m "feat(journeys): per-client email template CRUD"
```

### Task 17: Remove retired endpoints + helpers; `add_lead_note` log

**Files:** Modify: `server/routes/hub.js`

- [ ] **Step 1: Delete the retired step + template endpoints**

Remove these handlers entirely: `POST /journeys/:id/steps` (`8427`), `PUT /journeys/:id/steps/:stepId` (`8517`), `DELETE /journeys/:id/steps/:stepId` (`8738`), `POST /journeys/:id/notes` (`8772` — superseded by `/note`), `POST /journeys/:id/apply-template` (`8795`).

- [ ] **Step 2: Delete the retired helper functions**

Remove `getJourneyTemplate` (`592`), `saveJourneyTemplate` (`605`), `seedJourneySteps` (`677`), `syncJourneySchedule` (`631`), `deriveJourneyStepSchedule`, `deriveJourneyNextActionAt`, and the `JOURNEY_TEMPLATE_KEY_PREFIX`/`DEFAULT_JOURNEY_TEMPLATE`/schedule-migration constants if now unused. **Before deleting, grep each name** to confirm zero remaining references:

```bash
for f in getJourneyTemplate saveJourneyTemplate seedJourneySteps syncJourneySchedule deriveJourneyStepSchedule deriveJourneyNextActionAt normalizeJourneyStatus; do
  echo "== $f =="; grep -n "$f" server/routes/hub.js
done
```
Delete only those with no remaining call sites after the endpoint removals. (Leave `ensureJourneyTables`, `resolveLeadCallLink`, `sanitizeSymptomList`, `buildNormalizedPhoneMatchSql`, `activeOnly`, `parseDateValue` — still used.)

- [ ] **Step 3: Add `add_lead_note` logging** to `POST /leads/:callId/notes` (line `7440`)

Inside that handler, after the existing successful note INSERT (it already stamps `author_id`), add before the response:

```js
    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ADD_LEAD_NOTE,
      actionCategory: ActivityCategories.LEAD, targetUserId: ownerId,
      targetEntityType: 'lead', targetEntityId: req.params.callId,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { callId: req.params.callId }
    }).catch(() => {});
```
(Use the handler's existing `ownerId` variable; if it's named differently, match it.)

- [ ] **Step 4: Lint + build** (this is where dangling references surface)

Run: `yarn lint && yarn build`
Expected: pass. Fix any "is not defined" from leftover references to deleted helpers.

- [ ] **Step 5: Restart + smoke** — server boots; list/start/advance still work.
- [ ] **Step 6: Commit**

```bash
git add server/routes/hub.js
git commit -m "refactor(journeys): remove timed-step + template machinery; log add_lead_note"
```

---

## Phase 5 — Scheduled-send processor

### Task 18: Create `journeyScheduledSends.js`

**Files:**
- Create: `server/services/journeyScheduledSends.js`

- [ ] **Step 1: Create the processor**

```js
/**
 * Lean scheduled-send processor (replaces journeyEmailScheduler.js).
 * Sends activity rows where email_status='scheduled' AND scheduled_for<=NOW(),
 * for journeys that are still active. Atomic claim per row guards against
 * double-send across Cloud Run replicas. Email advances the stage on send.
 * SMS rows stay skipped while JOURNEY_SMS_ENABLED is off.
 */
import { query } from './db.js';
import { isMailgunConfigured } from './mailgun.js';
import { sendJourneyEmailNow, nextStage, setJourneyStage } from './journeyActivities.js';

const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 25;

async function claim(activityId) {
  const { rows } = await query(
    `UPDATE client_journey_activities
        SET send_attempts = send_attempts + 1
      WHERE id = $1 AND email_status = 'scheduled' AND send_attempts < $2
      RETURNING id`, [activityId, MAX_ATTEMPTS]);
  return rows.length > 0;
}

export async function processDueJourneySends() {
  if (!isMailgunConfigured()) return { sent: 0, failed: 0, skipped: 0 };

  const { rows } = await query(
    `SELECT a.id AS activity_id, a.type, a.subject, a.body, a.body_format,
            j.id AS journey_id, j.stage, j.owner_user_id, j.client_name, j.client_email, j.client_phone
       FROM client_journey_activities a
       JOIN client_journeys j ON j.id = a.journey_id
      WHERE a.email_status = 'scheduled'
        AND a.scheduled_for IS NOT NULL
        AND a.scheduled_for <= NOW()
        AND a.send_attempts < $1
        AND j.status = 'active'
      ORDER BY a.scheduled_for ASC
      LIMIT $2`, [MAX_ATTEMPTS, BATCH_LIMIT]);

  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    if (row.type === 'text') { // gated SMS: never dispatch from cron
      await query(`UPDATE client_journey_activities SET email_status='skipped' WHERE id=$1`, [row.activity_id]);
      skipped += 1; continue;
    }
    const claimed = await claim(row.activity_id).catch(() => false);
    if (!claimed) { skipped += 1; continue; }
    try {
      await sendJourneyEmailNow({
        journey: { id: row.journey_id, owner_user_id: row.owner_user_id,
          client_name: row.client_name, client_email: row.client_email, client_phone: row.client_phone },
        subject: row.subject, body: row.body, bodyFormat: row.body_format || 'html', activityId: row.activity_id });
      await query(`UPDATE client_journey_activities SET email_status='sent', email_error=NULL WHERE id=$1`, [row.activity_id]);
      await setJourneyStage(row.journey_id, row.owner_user_id, nextStage(row.stage));
      sent += 1;
    } catch (err) {
      await query(`UPDATE client_journey_activities SET email_status='failed', email_error=$2 WHERE id=$1`,
        [row.activity_id, String(err?.message || err).slice(0, 500)]).catch(() => {});
      failed += 1;
      console.error('[journeyScheduledSends] send failed', { activity_id: row.activity_id, error: err?.message });
    }
  }
  return { sent, failed, skipped };
}
```

- [ ] **Step 2: Lint + build → commit**

```bash
git add server/services/journeyScheduledSends.js
git commit -m "feat(journeys): lean scheduled-send processor"
```

### Task 19: Swap the cron + import in `index.js`

**Files:** Modify: `server/index.js` (import line `43`; cron lines `1753`–`1772`)

- [ ] **Step 1: Replace the import** (line `43`)

```js
import { processDueJourneySends } from './services/journeyScheduledSends.js';
```

- [ ] **Step 2: Replace the cron block** (lines `1753`–`1772`)

```js
// Send due scheduled journey emails every 5 minutes. Each send was scheduled
// explicitly by a human; the cron is just the dispatcher.
cron.schedule(
  '*/5 * * * *',
  async () => {
    try {
      const result = await processDueJourneySends();
      if (result?.sent || result?.failed) {
        console.log(`[cron:journey-sends] sent=${result.sent || 0} failed=${result.failed || 0} skipped=${result.skipped || 0}`);
      }
    } catch (err) {
      console.error('[cron:journey-sends] failed', err?.message || err);
    }
  },
  { timezone: 'America/New_York' }
);
```

- [ ] **Step 3: Delete the old scheduler file**

```bash
git rm server/services/journeyEmailScheduler.js
```

- [ ] **Step 4: Lint + build + restart**

Run: `yarn lint && yarn build` then restart server.
Expected: pass, boots clean, no import of the deleted file remains (`grep -rn journeyEmailScheduler server/` → empty).

- [ ] **Step 5: Functional check** — schedule an email with `scheduled_for` a few seconds in the future; wait for the cron (or temporarily call `processDueJourneySends()` from a one-off script); expected the activity flips `scheduled → sent` and stage advances.

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat(journeys): replace template-timeline cron with scheduled-send dispatcher"
```

---

## Phase 6 — Previous-Journey flag on the leads list

### Task 20: Add the computed Previous-Journey flag

**Files:** Modify: `server/routes/hub.js` (the leads list query)

- [ ] **Step 1: Find the leads list shaping query**

```bash
grep -n "FROM call_logs" server/routes/hub.js | head -40
```
Identify the handler that returns the leads/activity list consumed by `LeadsTab.jsx` (the main `GET` that returns `call_logs` rows with category/score). Confirm by checking which route `src/api/` leads client calls.

- [ ] **Step 2: Add a correlated EXISTS to the SELECT**

In that query's column list, add (using the row's owner column — typically `cl.owner_user_id` — and the contact phone/email columns present on `call_logs`, commonly `from_number`/`contact_email`; adjust names to the actual columns in that query):

```sql
       , EXISTS (
           SELECT 1 FROM client_journeys pj
            WHERE pj.owner_user_id = cl.owner_user_id
              AND pj.status = 'archived'
              AND (
                regexp_replace(COALESCE(pj.client_phone,''), '\D', '', 'g')
                  = right(regexp_replace(COALESCE(cl.from_number,''), '\D', '', 'g'), 10)
                OR (pj.client_email IS NOT NULL AND pj.client_email = cl.contact_email)
              )
         ) AS has_previous_journey
```

> If the leads query already aliases the phone column differently (e.g. `caller_number`) or normalizes phones via a helper, reuse that helper instead of inlining `regexp_replace`. The result column must be named `has_previous_journey`.

- [ ] **Step 3: Ensure the row passes through** — confirm the handler returns the full row (most use `SELECT cl.*, ...`), so `has_previous_journey` reaches the client. If the handler maps explicit fields, add `has_previous_journey` to the mapped object.

- [ ] **Step 4: Check + commit** — archive a journey for a contact, then confirm a fresh lead for the same phone returns `has_previous_journey: true` (verify via the network response in the browser devtools or a `curl`).

```bash
git add server/routes/hub.js
git commit -m "feat(leads): computed has_previous_journey flag from archived journeys"
```

---

## Phase 7 — Frontend API client

### Task 21: Rewrite `src/api/journeys.js` + add templates client

**Files:**
- Modify: `src/api/journeys.js`
- Create: `src/api/journeyTemplates.js`

- [ ] **Step 1: Replace `src/api/journeys.js`**

```js
import client from './client';

export function fetchJourneys(params = {}) {
  return client.get('/hub/journeys', { params }).then((res) => res.data.journeys || []);
}
export function fetchJourney(id) {
  return client.get(`/hub/journeys/${id}`).then((res) => res.data.journey);
}
export function createJourney(payload) {
  return client.post('/hub/journeys', payload).then((res) => res.data.journey);
}
export function updateJourney(id, payload) {
  return client.put(`/hub/journeys/${id}`, payload).then((res) => res.data.journey);
}
export function moveJourneyStage(id, stage) {
  return client.patch(`/hub/journeys/${id}/stage`, { stage }).then((res) => res.data.journey);
}
export function sendJourneyEmail(id, payload) {
  // payload: { template_id?, subject, body, body_format, scheduled_for? }
  return client.post(`/hub/journeys/${id}/email`, payload).then((res) => res.data.journey);
}
export function logJourneyCall(id, body) {
  return client.post(`/hub/journeys/${id}/call`, { body }).then((res) => res.data.journey);
}
export function addJourneyNote(id, body) {
  return client.post(`/hub/journeys/${id}/note`, { body }).then((res) => res.data.journey);
}
export function sendJourneyText(id, payload) {
  return client.post(`/hub/journeys/${id}/text`, payload).then((res) => res.data);
}
export function cancelScheduledSend(id) {
  return client.post(`/hub/journeys/${id}/schedule/cancel`).then((res) => res.data.journey);
}
export function convertJourney(id, payload = {}) {
  return client.post(`/hub/journeys/${id}/convert`, payload).then((res) => res.data.journey);
}
export function archiveJourney(id) {
  return client.post(`/hub/journeys/${id}/archive`).then((res) => res.data.journey);
}
export function restoreJourney(id) {
  return client.post(`/hub/journeys/${id}/unarchive`).then((res) => res.data.journey);
}
```

- [ ] **Step 2: Create `src/api/journeyTemplates.js`**

```js
import client from './client';

export function fetchEmailTemplates() {
  return client.get('/hub/journey-email-templates').then((res) => res.data.templates || []);
}
export function createEmailTemplate(payload) {
  return client.post('/hub/journey-email-templates', payload).then((res) => res.data.template);
}
export function updateEmailTemplate(id, payload) {
  return client.put(`/hub/journey-email-templates/${id}`, payload).then((res) => res.data.template);
}
export function deleteEmailTemplate(id) {
  return client.delete(`/hub/journey-email-templates/${id}`).then((res) => res.data);
}
```

- [ ] **Step 3: Build** — `yarn build` (will fail later if old exports are referenced; those callers are fixed in Phase 8). For now confirm the files compile.
- [ ] **Step 4: Commit**

```bash
git add src/api/journeys.js src/api/journeyTemplates.js
git commit -m "feat(journeys): frontend API client for redesigned journey surface"
```

---

## Phase 8 — Frontend UI

> Establish shared stage metadata first, then build leaf components, then wire the page. Each task ends with `yarn build` + `yarn lint` + a visual check at http://localhost:3000.

### Task 22: Stage metadata helper

**Files:** Modify: `src/views/client/ClientPortal/leads/journeyHelpers.js`

- [ ] **Step 1: Replace the file's exports with stage metadata** (keep any still-referenced helpers; remove step/offset helpers)

```js
export const JOURNEY_STAGES = ['first_touch', 'second_touch', 'third_touch', 'fourth_touch', 'awaiting_decision'];

export const STAGE_LABELS = {
  first_touch: 'First Touch',
  second_touch: 'Second Touch',
  third_touch: 'Third Touch',
  fourth_touch: 'Fourth Touch',
  awaiting_decision: 'Awaiting Decision'
};

export const STAGE_COLORS = {
  first_touch: '#1976d2',
  second_touch: '#0288d1',
  third_touch: '#7b1fa2',
  fourth_touch: '#ed6c02',
  awaiting_decision: '#2e7d32'
};

export const ACTIVITY_ICON_LABEL = {
  email: 'Email', call: 'Call', text: 'Text', note: 'Note', stage_change: 'Stage'
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || '—';
}
```

- [ ] **Step 2: Build + lint + commit**

```bash
git add src/views/client/ClientPortal/leads/journeyHelpers.js
git commit -m "feat(journeys): stage label/color metadata"
```

### Task 23: `SendEmailDialog` (template/custom + now/schedule)

**Files:** Create: `src/views/client/ClientPortal/leads/SendEmailDialog.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useEffect, useState } from 'react';
import { Box, Stack, TextField, MenuItem, ToggleButtonGroup, ToggleButton, Typography } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { fetchEmailTemplates } from 'api/journeyTemplates';

const DEFAULT_OFFSET_DAYS = 7;
function defaultScheduleLocal() {
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_OFFSET_DAYS);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // for <input type=datetime-local>
}

export default function SendEmailDialog({ open, onClose, onSubmit, smsEnabled = false }) {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [timing, setTiming] = useState('now'); // now | schedule
  const [when, setWhen] = useState(defaultScheduleLocal());
  const [channel, setChannel] = useState('email'); // email | both
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchEmailTemplates().then(setTemplates).catch(() => setTemplates([]));
    setTemplateId(''); setSubject(''); setBody(''); setTiming('now'); setWhen(defaultScheduleLocal()); setChannel('email');
  }, [open]);

  const applyTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) { setSubject(t.subject || ''); setBody(t.body || ''); }
  };

  const handleSubmit = async () => {
    if (!subject.trim() && !body.trim()) { toast.error('Add a subject or body first.'); return; }
    setSaving(true);
    try {
      await onSubmit({
        template_id: templateId || null,
        subject, body, body_format: 'html',
        scheduled_for: timing === 'schedule' ? new Date(when).toISOString() : null,
        channel
      });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not send the email.');
    } finally { setSaving(false); }
  };

  return (
    <FormDialog open={open} onClose={onClose} onSubmit={handleSubmit} title="Send email"
      submitLabel={timing === 'schedule' ? 'Schedule' : 'Send now'} loading={saving} maxWidth="sm">
      <Stack spacing={2} sx={{ pt: 1 }}>
        <SelectField label="Template (optional)" value={templateId} onChange={(e) => applyTemplate(e.target.value)}
          options={[{ value: '', label: 'Custom email' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} fullWidth />
        <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} fullWidth />
        <TextField label="Body" value={body} onChange={(e) => setBody(e.target.value)} fullWidth multiline minRows={6} />
        <Box>
          <Typography variant="caption" color="text.secondary">When</Typography>
          <ToggleButtonGroup exclusive size="small" value={timing} onChange={(_, v) => v && setTiming(v)} sx={{ ml: 1 }}>
            <ToggleButton value="now">Send now</ToggleButton>
            <ToggleButton value="schedule">Schedule</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {timing === 'schedule' && (
          <TextField type="datetime-local" label="Scheduled for" value={when}
            onChange={(e) => setWhen(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
        )}
        <Box>
          <Typography variant="caption" color="text.secondary">Channel</Typography>
          <ToggleButtonGroup exclusive size="small" value={channel} onChange={(_, v) => v && setChannel(v)} sx={{ ml: 1 }}>
            <ToggleButton value="email">Email</ToggleButton>
            <ToggleButton value="both" disabled={!smsEnabled}>Email + Text{!smsEnabled ? ' (soon)' : ''}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Stack>
    </FormDialog>
  );
}
```

- [ ] **Step 2: Build + lint + commit**

```bash
git add src/views/client/ClientPortal/leads/SendEmailDialog.jsx
git commit -m "feat(journeys): send-email dialog (template/custom, now/schedule)"
```

### Task 24: Redesign the journey drawer (`JourneyTab.jsx` / `useJourneyDrawer.jsx`)

**Files:** Modify: `src/views/client/ClientPortal/JourneyTab.jsx`, `src/hooks/useJourneyDrawer.jsx`

- [ ] **Step 1: Replace the drawer body with header + timeline + action bar**

Render (using the journey shape from the API: `stage`, `status`, `created_by_name`, `activities[]`, `pending_send`):

```jsx
import { Box, Stack, Typography, Button, TextField, Divider, Chip } from '@mui/material';
import StatusChip from 'ui-component/extended/StatusChip';
import LoadingButton from 'ui-component/extended/LoadingButton';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { stageLabel, STAGE_COLORS, ACTIVITY_ICON_LABEL } from './leads/journeyHelpers';
import SendEmailDialog from './leads/SendEmailDialog';
import {
  sendJourneyEmail, logJourneyCall, addJourneyNote, cancelScheduledSend,
  archiveJourney, convertJourney, sendJourneyText
} from 'api/journeys';

// Inside the drawer component, given `journey` and `onJourneyUpdate(updated)`:
// - Header: client name + <Chip label={stageLabel(journey.stage)} sx={{ bgcolor: STAGE_COLORS[journey.stage] }} />
//   + "Started by {journey.created_by_name} · {date}" (omit when null)
//   + Convert / Archive buttons.
// - pending_send banner: "📅 Email scheduled for {date}" + Cancel (calls cancelScheduledSend).
// - Activity timeline: journey.activities.map(a => row with ACTIVITY_ICON_LABEL[a.type], a.author_name, date, subject/body;
//   stage_change rows render `Moved to ${stageLabel(a.to_stage)}`).
// - Action bar: Send Email (opens SendEmailDialog), Log Call (inline notes field), Send Text (disabled tooltip),
//   Add Note (inline field).
// Every handler awaits the API (which returns the full updated journey), then calls onJourneyUpdate(updated)
// and toasts. Example:
const handleSendEmail = async (payload) => {
  if (payload.channel === 'both') { await sendJourneyText(journey.id, payload).catch(() => {}); }
  const updated = await sendJourneyEmail(journey.id, payload);
  onJourneyUpdate(updated);
  toast.success(payload.scheduled_for ? 'Email scheduled.' : 'Email sent.');
};
const handleLogCall = async (notes) => { const u = await logJourneyCall(journey.id, notes); onJourneyUpdate(u); toast.success('Call logged.'); };
const handleAddNote = async (text) => { const u = await addJourneyNote(journey.id, text); onJourneyUpdate(u); toast.success('Note added.'); };
const handleCancelSchedule = async () => { const u = await cancelScheduledSend(journey.id); onJourneyUpdate(u); toast.info('Scheduled send canceled.'); };
const handleArchive = async () => { const u = await archiveJourney(journey.id); onJourneyUpdate(u); toast.success('Journey archived.'); };
const handleConvert = async () => { const u = await convertJourney(journey.id); onJourneyUpdate(u); toast.success('Converted to client.'); };
```

- [ ] **Step 2: Delete step/template UI** — remove from `useJourneyDrawer.jsx` and `JourneyTab.jsx` all step editing (`offset_days`, `email_enabled`, `email_send_hour`, `applyJourneyTemplate`, `addJourneyStep`, `updateJourneyStep`, `deleteJourneyStep`, the template editor modal). Grep to confirm none remain:

```bash
grep -rn "addJourneyStep\|updateJourneyStep\|deleteJourneyStep\|applyJourneyTemplate\|saveJourneyTemplate\|fetchJourneyTemplate\|offset_days\|email_send_hour" src/
```
Expected after edits: empty.

- [ ] **Step 3: Build + lint + visual check** — open a journey drawer: stage chip, timeline, and action bar render; sending an email/logging a call/adding a note updates the drawer immediately and toasts.
- [ ] **Step 4: Commit**

```bash
git add src/views/client/ClientPortal/JourneyTab.jsx src/hooks/useJourneyDrawer.jsx
git commit -m "feat(journeys): redesigned drawer (timeline + action bar + send dialog)"
```

### Task 25: Pipeline Kanban board

**Files:** Create: `src/views/client/ClientPortal/leads/PipelineBoard.jsx`

- [ ] **Step 1: Create the board** (columns by stage; click a card to open the drawer; a per-card "Move to…" menu — drag is a later enhancement)

```jsx
import { Box, Paper, Stack, Typography, Chip, Menu, MenuItem, IconButton } from '@mui/material';
import { useState } from 'react';
import { JOURNEY_STAGES, stageLabel, STAGE_COLORS } from './journeyHelpers';
import { moveJourneyStage } from 'api/journeys';
import { useToast } from 'contexts/ToastContext';

export default function PipelineBoard({ journeys, onOpen, onJourneyUpdate }) {
  const toast = useToast();
  const [menu, setMenu] = useState({ anchor: null, journey: null });
  const active = journeys.filter((j) => j.status === 'active');
  const byStage = (stage) => active.filter((j) => j.stage === stage);

  const move = async (journey, stage) => {
    setMenu({ anchor: null, journey: null });
    try { const u = await moveJourneyStage(journey.id, stage); onJourneyUpdate(u); toast.success(`Moved to ${stageLabel(stage)}.`); }
    catch (e) { toast.error('Could not move the lead.'); }
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1 }}>
      {JOURNEY_STAGES.map((stage) => (
        <Paper key={stage} variant="outlined" sx={{ minWidth: 260, flex: '0 0 260px', p: 1, bgcolor: 'grey.50' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ color: STAGE_COLORS[stage] }}>{stageLabel(stage)}</Typography>
            <Chip size="small" label={byStage(stage).length} />
          </Stack>
          <Stack spacing={1}>
            {byStage(stage).map((j) => (
              <Paper key={j.id} sx={{ p: 1, cursor: 'pointer' }} onClick={() => onOpen(j)}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{j.client_name || 'Unknown'}</Typography>
                    <Typography variant="caption" color="text.secondary">{j.client_phone || j.client_email || ''}</Typography>
                  </Box>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, journey: j }); }}>⋮</IconButton>
                </Stack>
                {j.pending_send && <Chip size="small" sx={{ mt: 0.5 }} label="📅 scheduled" color="warning" variant="outlined" />}
              </Paper>
            ))}
          </Stack>
        </Paper>
      ))}
      <Menu anchorEl={menu.anchor} open={Boolean(menu.anchor)} onClose={() => setMenu({ anchor: null, journey: null })}>
        {JOURNEY_STAGES.map((s) => (
          <MenuItem key={s} disabled={menu.journey?.stage === s} onClick={() => move(menu.journey, s)}>Move to {stageLabel(s)}</MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
```

- [ ] **Step 2: Build + lint + visual check + commit**

```bash
git add src/views/client/ClientPortal/leads/PipelineBoard.jsx
git commit -m "feat(journeys): pipeline kanban board grouped by stage"
```

### Task 26: Email Templates pane

**Files:** Create: `src/views/client/ClientPortal/leads/EmailTemplatesPane.jsx`

- [ ] **Step 1: Create the pane** (DataTable + FormDialog + ConfirmDialog, per CLAUDE.md shared components)

```jsx
import { useEffect, useState } from 'react';
import { Box, Button, Stack, TextField } from '@mui/material';
import DataTable from 'ui-component/extended/DataTable';
import FormDialog from 'ui-component/extended/FormDialog';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import { useToast } from 'contexts/ToastContext';
import { fetchEmailTemplates, createEmailTemplate, updateEmailTemplate, deleteEmailTemplate } from 'api/journeyTemplates';

export default function EmailTemplatesPane() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null=closed, {}=new, {id}=edit
  const [form, setForm] = useState({ name: '', subject: '', body: '' });
  const [confirmDel, setConfirmDel] = useState(null);

  const load = () => { setLoading(true); fetchEmailTemplates().then(setRows).finally(() => setLoading(false)); };
  useEffect(load, []);

  const openNew = () => { setForm({ name: '', subject: '', body: '' }); setEditing({}); };
  const openEdit = (r) => { setForm({ name: r.name, subject: r.subject || '', body: r.body || '' }); setEditing(r); };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Template needs a name.'); return; }
    try {
      if (editing?.id) {
        const t = await updateEmailTemplate(editing.id, { ...form, body_format: 'html' });
        setRows((p) => p.map((x) => (x.id === t.id ? t : x)));
        toast.success('Template updated.');
      } else {
        const t = await createEmailTemplate({ ...form, body_format: 'html' });
        setRows((p) => [t, ...p]);
        toast.success('Template created.');
      }
      setEditing(null);
    } catch (e) { toast.error('Could not save the template.'); }
  };

  const doDelete = async () => {
    try { await deleteEmailTemplate(confirmDel.id); setRows((p) => p.filter((x) => x.id !== confirmDel.id)); toast.success('Template deleted.'); }
    catch (e) { toast.error('Could not delete the template.'); }
    finally { setConfirmDel(null); }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" onClick={openNew}>New template</Button>
      </Stack>
      <DataTable rowKey="id" loading={loading} rows={rows}
        columns={[
          { field: 'name', headerName: 'Name' },
          { field: 'subject', headerName: 'Subject' },
          { field: 'actions', headerName: '', render: (r) => (
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => openEdit(r)}>Edit</Button>
              <Button size="small" color="error" onClick={() => setConfirmDel(r)}>Delete</Button>
            </Stack>) }
        ]}
        emptyTitle="No templates yet" emptyMessage="Save wording you reuse — like an implants or cosmetic intro." />

      <FormDialog open={editing !== null} onClose={() => setEditing(null)} onSubmit={save}
        title={editing?.id ? 'Edit template' : 'New template'} maxWidth="sm" submitLabel="Save">
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
          <TextField label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} fullWidth />
          <TextField label="Body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} fullWidth multiline minRows={6} />
        </Stack>
      </FormDialog>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={doDelete}
        title="Delete template?" message={`Delete "${confirmDel?.name}"? This can't be undone.`} confirmColor="error" confirmLabel="Delete" />
    </Box>
  );
}
```

- [ ] **Step 2: Build + lint + visual check + commit**

```bash
git add src/views/client/ClientPortal/leads/EmailTemplatesPane.jsx
git commit -m "feat(journeys): per-client email templates pane"
```

### Task 27: Wire the Journeys page tabs + leads list Stage column / badge

**Files:** Modify: `src/views/client/ClientPortal/LeadsTab.jsx`, `src/hooks/useJourneys.js`

- [ ] **Step 1: Adapt `useJourneys.js`** — it should expose `journeys`, `loading`, `reload`, and an `applyJourneyUpdate(updated)` that merges one updated journey into local state (so drawer/board actions reflect immediately):

```js
const applyJourneyUpdate = (updated) => {
  if (!updated) return;
  setJourneys((prev) => {
    const exists = prev.some((j) => j.id === updated.id);
    return exists ? prev.map((j) => (j.id === updated.id ? updated : j)) : [updated, ...prev];
  });
};
```
Remove any step/template fetching from this hook.

- [ ] **Step 2: In `LeadsTab.jsx`, render the journey views** — replace the old `JourneyGroupedView` usage with a tabbed region: **Pipeline** (`<PipelineBoard journeys={journeys} onOpen={openDrawer} onJourneyUpdate={applyJourneyUpdate} />`) and **Email Templates** (`<EmailTemplatesPane />`). Pass `applyJourneyUpdate` into the drawer's `onJourneyUpdate`.

- [ ] **Step 3: Add the Stage column + Previous-Journey badge to the leads list** — in the leads table, for a lead with an attached journey show `<Chip label={stageLabel(journey.stage)} />`; when `lead.has_previous_journey` is true show a `<Chip label="Previous Journey" color="info" variant="outlined" />` (clicking opens that contact's archived journey history — reuse the drawer in read-only mode or link to it).

- [ ] **Step 4: Delete the obsolete `JourneyGroupedView.jsx`** if no longer referenced:

```bash
grep -rn "JourneyGroupedView" src/    # if empty:
git rm src/views/client/ClientPortal/leads/JourneyGroupedView.jsx
```

- [ ] **Step 5: Build + lint + full visual pass** — pipeline board renders, drawer opens from a card, leads list shows stage + previous-journey badge, templates tab works.
- [ ] **Step 6: Commit**

```bash
git add src/views/client/ClientPortal/LeadsTab.jsx src/hooks/useJourneys.js
git commit -m "feat(journeys): journeys page tabs + leads stage column + previous-journey badge"
```

---

## Phase 9 — Verify & document

### Task 28: End-to-end verification + docs

**Files:** Modify: `docs/API_REFERENCE.md`, `SKILLS.md`

- [ ] **Step 1: Full build + lint**

Run: `yarn build && yarn lint`
Expected: both pass clean.

- [ ] **Step 2: Run the spec's verification checklist** (from `2026-05-21-...-design.md` §Verification), end to end in the browser at http://localhost:3000:
  - Migration dry-run distribution looked sane; post-migration sanity checks pass; re-running adds zero rows.
  - Start journey → First Touch + "Started by"; activity-log row under `lead`.
  - Send template email → sends, advances, byline, toast, no reopen.
  - Schedule email (+7d default, edit date) → pending pin, no advance; backdate + run cron → sends + advances.
  - Cancel pending; archive with pending → canceled, never fires.
  - Log call → advances. Send Text → disabled; endpoint returns `gated`, dispatches nothing.
  - Drag/Move backward → stage_change recorded.
  - Convert → "Converted by"; `convert_to_client` logged; status converted.
  - Archive → leaves board; re-submit same contact → Previous Journey badge.
  - No PHI in `user_activity_logs.details`; client users can't reach the activity-log feed.

- [ ] **Step 3: Update docs** — in `docs/API_REFERENCE.md` add the new `/hub/journeys/*` and `/hub/journey-email-templates` endpoints and remove the retired step/template ones; in `SKILLS.md` add `client_journey_activities` + `journey_email_templates` and the new `client_journeys.stage`/`created_by`, `active_clients.converted_by` columns.

- [ ] **Step 4: Commit + open PR**

```bash
git add docs/API_REFERENCE.md SKILLS.md
git commit -m "docs: journey redesign API + schema"
git push -u origin feature/lead-journey-redesign
gh pr create --title "Lead journey redesign: fixed-stage pipeline + activity log" \
  --body "Implements docs/superpowers/specs/2026-05-21-lead-journey-redesign-design.md. Supersedes the 2026-05-20 attribution spec.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 5: After marking ready, trigger CodeRabbit** — comment `@coderabbitai review` on the PR and wait for the review before merging (per project workflow for draft PRs).

---

## Self-Review (completed by plan author)

**Spec coverage:** stage model (Tasks 1,4,8) ✓ · activity log/timeline (Tasks 4,6) ✓ · per-client templates (Tasks 16,21,26) ✓ · send now + schedule + cron (Tasks 9,18,19) ✓ · advance rules (Tasks 9,10) ✓ · gated SMS (Tasks 12,18) ✓ · cancel/convert/archive + cancel-on-terminal (Tasks 13,14,15) ✓ · attribution: created_by/converted_by + actor identity + event types + admin-only feed (Tasks 1,3,7,15) ✓ · Previous-Journey flag (Task 20,27) ✓ · safe carry-over migration + sentinel + provenance + dry-run (Tasks 1,2) ✓ · retire timed machinery (Tasks 17,19) ✓ · docs (Task 28) ✓.

**Type/name consistency:** `recordActivity`, `setJourneyStage`, `nextStage`, `cancelPendingSends`, `sendJourneyEmailNow`, `fetchJourneyForOwner`, `applyJourneyUpdate`, `has_previous_journey`, `pending_send`, `created_by_name`, stage strings, and the `{ journey }` / `{ journeys }` / `{ template(s) }` response shapes are used identically across backend and frontend tasks.

**Known integration points to confirm during execution (flagged, not placeholders):** exact `active_clients` INSERT column list (Task 15 Step 1) and the precise leads-list query + its phone/email column names (Task 20) — both include the exact code to add and a grep to locate the site.
