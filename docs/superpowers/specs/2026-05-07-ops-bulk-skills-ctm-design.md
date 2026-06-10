# Operations: Bulk Runs, Prompt-Driven Skills, and CTM Umbrella

**Date:** 2026-05-07
**Status:** Spec — pending implementation plan
**Owner:** jmartin@anchorcorps.com

## Summary

Three coupled changes to the Operations subsystem, plus one parallel cleanup:

1. **Add CTM as a 4th umbrella** alongside `website`, `google_ads`, and `meta`, with collectors for tracking-number health, AI classification quality, form submission flow, and webhook/API integration sync.
2. **Pivot from JSON/code-driven checks to prompt-driven "skills"** — markdown prompts the AI supervisor executes, with the existing code handlers retained as deterministic collectors the skills call as tools. Skills are versioned, viewable, and editable in the UI. The agent proposes skill edits (or new skills) as suggestions; a human reviews and approves before they go live.
3. **Promote Bulk to a top-level Operations tab** that fans the same skill bundles out across all active clients (resolved via each client's designated platform connections), on user-defined schedules. Bulk runs produce a results table that mirrors the existing per-client Runs tab.
4. **(Parallel)** Standardize all tabular views in the app to use the shared `DataTable` component unless a row genuinely cannot be expressed by it.

This is an additive layer on the existing ops architecture. The check registry, run executor, run queue, schedule fanout, budget guard, cost tracker, correlator, and report renderer all remain. Skills are a new orchestration primitive on top of them.

## Goals & Non-Goals

**Goals**
- One mental model — "skills" — for what gets monitored. The user edits a markdown doc; the agent runs it.
- Bulk runs target the agency's active-client roster, not a raw list of every Kinsta site / GA property / Ad account.
- A skill's evolution is auditable: every version, every edit, every agent-suggested change, who approved it.
- CTM is a first-class citizen in ops, not a side integration.
- Reuse existing collectors and execution infra; do not rewrite Phase 1–7 work.

**Non-goals**
- Tag- or segment-based client targeting for bulk runs. All bulk runs target all active clients with the required connection wired up.
- Auto-applied skill edits. The agent never modifies a live skill — only proposes.
- Replacing existing code-handler checks. They remain as collectors.
- Hourly bulk cadences. Daily, weekly (with day-of-week), and monthly (with day-of-month) only.
- Per-run client picker. There is no UI to narrow a bulk run to a subset of clients.

## Architecture

### Information architecture (Operations top-level tabs)

Current: `Command Center · Discoveries · Clients · Agent · Connections`.
New: `Command Center · Discoveries · Clients · Agent · Connections · Bulk`.

The legacy `?tab=bulk` URL alias (currently routes into Connections > bulk section) is repointed to the new top-level Bulk tab. The Kinsta-only `BulkActionsTab.jsx` is retired; if any of its functionality is still wanted (Kinsta bulk actions specifically), it lands inside `Connections > sites` as a contextual action bar, not as a tab.

### Skills — data model

Three new tables (idempotent migration):

```sql
CREATE TABLE ops_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,                 -- 'website.daily_essentials'
  umbrella TEXT NOT NULL,                    -- 'website' | 'google_ads' | 'meta' | 'ctm'
  title TEXT NOT NULL,
  prompt_md TEXT NOT NULL,
  collectors_json JSONB NOT NULL DEFAULT '[]'::jsonb,  -- check_ids allowed as tools
  cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ops_skill_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES ops_skills(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  prompt_md TEXT NOT NULL,
  collectors_json JSONB NOT NULL,
  edited_by_user_id UUID REFERENCES users(id),  -- null when edited_by_agent = true
  edited_by_agent BOOLEAN NOT NULL DEFAULT FALSE,
  edit_reason TEXT,
  approved_from_suggestion_id UUID,             -- traceability
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version_number)
);

CREATE TABLE ops_skill_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID REFERENCES ops_skills(id) ON DELETE CASCADE,  -- null = new-skill proposal
  run_id UUID REFERENCES ops_runs(id) ON DELETE SET NULL,
  proposed_slug TEXT,                            -- only for new-skill proposals
  proposed_umbrella TEXT,
  proposed_title TEXT,
  proposed_prompt_md TEXT NOT NULL,
  proposed_collectors_json JSONB NOT NULL,
  rationale TEXT NOT NULL,                       -- why the agent thinks this is needed
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | rejected
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Skills — seed content and on-startup sync

A new directory `server/services/ops/skills/seed/<umbrella>/<slug>.md` holds canonical prompts, committed to the repo. Each file has a small YAML front matter:

```markdown
---
slug: website.daily_essentials
umbrella: website
title: Website daily essentials
collectors: [web.psi, web.ssl, web.uptime, web.kinsta.drift]
cost_estimate_cents: 4
---

# What to check
- PageSpeed Insights mobile score: flag if < 70 or 5+ point drop vs prior 7-day median
- SSL: warn if expiry < 30 days, fail if < 7 days
- Uptime: flag any 5xx or downtime within last 24h
- Kinsta drift: flag any new high/critical findings since last run

# How to interpret
A finding is "critical" only if user-facing. Internal-only deltas roll up as "info".
Always include the affected URL(s) in the finding payload.
```

Server startup runs a `syncSeedSkills()` migration helper: for each seed file, if no row in `ops_skills` exists with that slug, insert it (and version 1). If a row exists, leave it untouched (user edits win).

### Skills — execution

When a run executes a skill (whether per-client or as a child of a bulk run):

1. The supervisor loads the latest version of the skill (`prompt_md` + `collectors_json`).
2. It resolves the client's designated connection for the umbrella from `client_platform_credentials`.
3. It hands the prompt to Vertex Gemini with the listed collectors exposed as tools (each tool wraps an existing check handler from the registry — no new collector code unless the skill genuinely needs one).
4. The agent calls collectors, gathers data, evaluates against the rubric in the prompt, and emits structured findings + a summary, written to `ops_findings` (existing table) tagged with the skill_id and skill_version_number.
5. The agent may also emit `ops_skill_suggestions` rows: e.g. "I noticed PSI was flaky for 3 consecutive runs on this domain — recommend adding a retry-and-median collector to this skill." The live skill is not modified.

### Bulk runs — data model and fanout

```sql
CREATE TABLE ops_bulk_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  skill_ids UUID[] NOT NULL,                  -- one or more skills
  cadence TEXT NOT NULL,                      -- 'daily' | 'weekly' | 'monthly'
  day_of_week SMALLINT,                       -- 0-6, when cadence='weekly'
  day_of_month SMALLINT,                      -- 1-28, when cadence='monthly'
  hour_local SMALLINT NOT NULL DEFAULT 8,     -- 0-23, agency timezone
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ops_bulk_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_schedule_id UUID REFERENCES ops_bulk_schedules(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL,                      -- 'schedule' | 'manual'
  triggered_by_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL,                       -- 'queued' | 'running' | 'complete' | 'failed' | 'partial'
  client_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,   -- clients without required connection
  findings_count INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb -- e.g. skipped client list w/ reasons
);

ALTER TABLE ops_runs ADD COLUMN IF NOT EXISTS bulk_run_id UUID REFERENCES ops_bulk_runs(id) ON DELETE SET NULL;
ALTER TABLE ops_runs ADD COLUMN IF NOT EXISTS skill_id UUID REFERENCES ops_skills(id);
ALTER TABLE ops_runs ADD COLUMN IF NOT EXISTS skill_version_number INTEGER;
```

`scheduleFanout.js` gains a `fanOutBulkSchedule(scheduleId)` path:
- Enumerate `active_clients` rows where `archived_at IS NULL`.
- For each skill in the schedule, look up the umbrella → required platform credential.
- Filter active clients to those with the required credential present.
- Enqueue one child `ops_runs` row per (client, skill) pair, with `bulk_run_id` set.
- Skipped clients are recorded in `ops_bulk_runs.metadata.skipped[]` with a reason ("no GA property linked", etc.).

The existing `runExecutor.js` consumes child runs unchanged. Cost and finding counts roll up into the parent `ops_bulk_runs` row at child completion (trigger function or post-run hook in the executor — implementation choice belongs to the plan).

A scheduler tick (existing cron in `server/index.js` ops loop) reads `ops_bulk_schedules` where `enabled = true AND next_run_at <= now()`, calls `fanOutBulkSchedule`, then computes the next `next_run_at` from cadence.

### CTM umbrella

Add `'ctm'` to `VALID_UMBRELLAS` in `server/services/ops/checks/registry.js`. Create `server/services/ops/checks/ctm/` with one collector module per check:

| check_id | What it gathers |
|---|---|
| `ctm.tracking_number_health` | Pulls the client's CTM numbers, flags `disabled`, `error`, or zero-call counts over the last N days |
| `ctm.classification_quality` | Counts `pending_review`, `unreviewed`, autostar mix, and spam %; flags drops vs prior median |
| `ctm.form_flow` | Verifies CTM forms are receiving submissions, autoresponders fired, reply-to + PDF settings present |
| `ctm.webhook_sync` | Checks last successful webhook delivery time, error rate, API auth status |

A new `subAgents/ctmAgent.js` subclass of the supervisor sub-agent base, mirroring `websiteAgent.js`, exposes these collectors as tools.

CTM credentials use the same `client_platform_credentials` pattern with `platform = 'ctm'`. Today CTM creds are agency-level env vars (`CTM_ACCESS_KEY` / `CTM_SECRET_KEY`), so the credential row uses `credentials_source = 'env_var'` and `account_id` carries the per-client CTM account ID. Schemas don't change — this is just a new platform value.

### Bulk tab — UX

Three sub-views inside the Bulk top-level tab, switched via pill nav (URL param `?tab=bulk&section=schedules|runs|skills`):

**Schedules**
- `DataTable` of `ops_bulk_schedules`. Columns: name, skills (chips), cadence, last run, next run, enabled toggle, actions (Edit / Run now / Delete).
- "New schedule" → `FormDialog` with: name, multi-select skills (grouped by umbrella), cadence picker (daily / weekly+DOW / monthly+DOM), hour-of-day, enabled toggle.
- Row click → drawer with same form, plus "Recent runs" mini-list.

**Runs**
- `DataTable` of `ops_bulk_runs`. Columns: schedule name (or "Manual"), started, status (`StatusChip`), # clients, # skipped, # findings, cost.
- Row click → drawer ("Bulk run detail") with: per-client breakdown table (`DataTable` again), each row showing client name, status, # findings, cost. Client row click → reuses the existing per-run `RunDetail` component on the child `ops_runs` row.

**Skills**
- Sectioned by umbrella (Website / Google Ads / Meta / CTM).
- Each section is a `DataTable` of skills: title, slug, current version, last edited, # pending suggestions.
- Skill row click → drawer with three tabs: Editor (markdown textarea + collector multi-select + "Save as new version" button), History (version list + diff viewer), Suggestions (pending agent proposals with diff + Approve/Reject).

### API surface (under `/api/ops`)

```
GET    /skills                          — list (filter by umbrella)
GET    /skills/:id                      — single skill + latest version
GET    /skills/:id/versions             — version history
PUT    /skills/:id                      — save new version (admin only)
POST   /skills                          — create skill (admin only)
DELETE /skills/:id                      — archive

GET    /skills/:id/suggestions          — pending suggestions
POST   /skills/:id/suggestions/:sid/approve
POST   /skills/:id/suggestions/:sid/reject

GET    /bulk/schedules
POST   /bulk/schedules
PUT    /bulk/schedules/:id
DELETE /bulk/schedules/:id
POST   /bulk/schedules/:id/run-now      — manual trigger

GET    /bulk/runs                       — paginated list
GET    /bulk/runs/:id                   — detail incl. children + skipped reasons
```

All routes are admin-only (`requireAuth + isStaff` + role check for `superadmin` on destructive ops). Audit-logged.

### DataTable standardization audit

Parallel cleanup. Process:

1. `grep -rn "<Table\\b\\|<TableContainer\\b\\|DataGrid" src/views` → inventory.
2. For each hit, classify: (a) candidate for migration to `ui-component/extended/DataTable`, (b) genuine special case (drag-drop board, nested expandable rows beyond DataTable's reach), or (c) already migrated.
3. Migrate (a) cases. Each migration is a single small commit. Where columns/sort/filter logic can be shared, lift them into the consuming view, not into DataTable itself.
4. Document (b) cases with a one-line comment explaining why.

Output for the plan: a checklist of files migrated vs left, included as the final phase so it can be verified independently.

## Data flow — example

A user creates a bulk schedule "Daily essentials, all platforms":
- skills: `website.daily_essentials`, `google_ads.daily_essentials`, `meta.daily_essentials`, `ctm.daily_essentials`
- cadence: daily, hour 8 America/Chicago

At 08:00 CT each day:
1. Scheduler tick fires `fanOutBulkSchedule`.
2. Function loads 47 active clients. For each (client, skill) pair, checks credential presence:
   - 47 have website connection → 47 child runs queued with `website.daily_essentials`.
   - 31 have GA + Ads → 31 with `google_ads.daily_essentials`.
   - 18 have Meta → 18 with `meta.daily_essentials`.
   - 22 have CTM → 22 with `ctm.daily_essentials`.
3. Skipped pairs logged in parent `ops_bulk_runs.metadata.skipped`.
4. `runExecutor` drains the queue at the configured concurrency. Each child run loads its skill, the agent calls collectors, writes findings + cost.
5. As each child completes, `ops_bulk_runs.findings_count` and `cost_cents` increment.
6. When all children terminal, parent moves to `complete` (or `partial` if any child failed).
7. The agent on one of the runs notices recurring PSI flakiness and emits an `ops_skill_suggestions` row. It appears in the Skills > Website > website.daily_essentials > Suggestions tab next time the user opens it.

## Error handling

- Missing credential at fanout time → child run is not enqueued; recorded in skipped list with a reason. The user sees this in the bulk run detail.
- Credential present but invalid at execution time → child run finalizes with status `failed`, the existing `last_validation_error` field on the credential row gets updated by `runExecutor`, finding emitted: "credential validation failed".
- Skill prompt malformed (e.g. references unknown collector) → child run fails with status `failed_setup`, no agent call is made (saves cost). UI shows a fix-it banner on the skill.
- Bulk schedule with no remaining valid skills (all archived) → fanout no-ops and logs a warning; schedule remains enabled but `next_run_at` advances normally.
- Agent suggestion contains a collector not in the registry → suggestion is still saved but flagged in the UI as "references unknown collector" and cannot be approved until edited.

## Security & compliance

- HIPAA gate on Meta is unchanged — `ctm.daily_essentials` and other CTM checks have no Meta dispatch.
- Skill prompts are admin-authored; treat them as code. Rendering of `prompt_md` in the UI uses an existing markdown renderer that does not execute scripts. The agent receives the raw markdown as a system prompt — no user-supplied input is interpolated.
- Suggestions from the agent are reviewed before they go live. Versions are append-only; rollback = save an older version's content as a new version.
- All `/api/ops/skills*` and `/api/ops/bulk*` routes are admin-only and audit-logged via the existing `audit_log` mechanism.
- Cost guard: bulk runs respect existing `budgetGuard` per-client caps. The parent `ops_bulk_runs.cost_cents` is informational only — the per-child cap is the enforcement point.
- No PHI flows through skill prompts or findings (continues current pattern — findings carry URLs, account IDs, metric values, never patient data).

## Verification

No automated test suite. Verification per `verify-without-tests` skill:
- `yarn build` and `yarn lint` clean.
- Migration runs idempotently (re-run on a primed DB is a no-op).
- Seed sync: delete a seed skill row → restart → it's re-inserted. Edit a seed skill → restart → user edits preserved.
- Manually trigger a bulk schedule with one skill, confirm child runs fan out, findings appear in the bulk run drawer.
- Confirm the skipped list reflects clients without the required credential.
- Confirm a skill suggestion can be approved → live skill version increments.
- Confirm `ops_bulk_runs.cost_cents` matches the sum of child `ops_runs.cost_cents`.
- Visual check of the new Bulk tab on desktop + narrow viewport.

## Open implementation choices (deferred to plan)

- Cost rollup mechanism: trigger function vs application-level hook in `runExecutor`. Both work; trade-off is migration complexity vs locality of logic.
- Markdown editor component: reuse what the journeys/blog editor uses, or pull in a focused diff-aware editor for the Suggestions tab.
- Whether `ops_skills` carries a `default_for_tier` flag so the legacy tier-based scheduler still has a "what to run" bridge during the transition.

## Out of scope

- Per-client skill overrides. A skill is the same content for every client it runs against. Client-specific tuning belongs in the agent's findings, not in skill forks.
- Tag/segment-based bulk targeting.
- Skill marketplace or sharing across agencies.
- Multiple skill bundles on the same schedule with different cadences.
- Hourly cadences.
- A per-run client picker UI.
