# Demo Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an isolated, always-current demo of the client portal at a dedicated URL (`anchor-hub-demo`), backed by a separate empty database seeded with one polished demo client, where no action can reach a real external service.

**Architecture:** A second Cloud Run service running the *same image* as prod, pointed at a new empty `anchor_demo` database on the existing Cloud SQL instance (mirrors the established `anchor-sites` pattern). On first boot the normal migration chain builds the schema and `maybeSeedDemoAccount()` seeds the demo client. Isolation is primarily "no real data + no third-party credentials," backed by a `DEMO_MODE` code-level kill-switch at outbound choke points.

**Tech Stack:** Node 20 / Express (ESM), PostgreSQL 15, Cloud Run, Cloud SQL, Cloud Build (console trigger), React/Vite frontend (unchanged).

> **Implementation note (how this actually shipped — supersedes the per-task details below where they differ):**
> - **Access is gated by Cloud Run IAP** (Google sign-in restricted to `domain:anchorcorps.com`), *not* left open. The `--allow-unauthenticated` flag in Task 10 is fronted by IAP — IAP intercepts all browser traffic (verified: a request 302-redirects to Google), so the service is **not** publicly reachable. Native Cloud Run IAP (`gcloud beta run services update --iap`) is used; no load balancer.
> - **No in-app login:** behind IAP, the app **auto-logs-in as the demo client** (a `DEMO_MODE`-gated branch in `POST /api/auth/refresh` mints the demo session), so there's no second login screen. MFA + email-verification are bypassed only in `DEMO_MODE` for `is_demo` accounts.
> - **First deploy builds from the feature branch**, not the prod image (the prod image lacks the demo plumbing + fresh-DB fixes). Ongoing updates come from a `staging`-branch Cloud Build trigger.
> - Service config also set at deploy: `--memory=2Gi` (argon2 needs it), `CORS_ORIGINS`/`APP_BASE_URL` = the demo origin (Vite's `crossorigin` asset tags require it), and the three `anchor-demo-*` secrets.

---

## Verification model (no automated test suite)

This project has **no test runner** (CLAUDE.md). "Tests" in this plan are the project's real verification gates:
- `node --check <file>` for server syntax
- small `node -e` assertions for pure helpers
- `yarn build` + `npx eslint <file>` for frontend
- **boot smoke:** start the server with env set and confirm logged behavior
- **manual:** click-through in the browser

Per CLAUDE.md: **never modify `.env`** — all demo config lives on the Cloud Run service. `server/` is **not** linted; use `node --check`. The frontend lints `src/**` only.

---

## File structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `server/services/demoMode.js` | Single `isDemoMode()` helper | **Create** |
| `server/services/mailgun.js` | Gate `sendMailgunMessage` | Modify |
| `server/services/trackingRelay.js` | Gate `sendEvent` (relay entry) | Modify |
| `server/services/twilio.js` | Gate outbound/mutation fns | Modify |
| `server/services/taskAutomations.js` | Gate `send_webhook` action | Modify |
| `server/index.js` | `registerCron` wrapper + setInterval guard | Modify |
| `server/sql/seed_demo.sql` | Enrich thin portal tabs | Modify |
| `docs/INTEGRATIONS.md` | Document the demo service + env | Modify |

Infra (no repo files): a new `anchor_demo` Cloud SQL database, a new `anchor-hub-demo` Cloud Run service, and one Cloud Build trigger edit (console).

---

## Task 0: Branch

**Files:** none (git only)

- [ ] **Step 1: Create a dedicated branch off the current `main`**

The demo work is unrelated to the leads board; it gets its own branch off `main` (not `feat/leads-board-phase5`).

```bash
git fetch origin
git switch -c feat/demo-deployment origin/main
```

- [ ] **Step 2: Bring the spec + plan docs onto this branch**

The design spec and this plan were committed on `feat/leads-board-phase5`, not on `main`, so they aren't on disk after the switch. Pull just those two files over and commit them:

```bash
git checkout feat/leads-board-phase5 -- \
  docs/superpowers/specs/2026-06-04-demo-deployment-design.md \
  docs/superpowers/plans/2026-06-04-demo-deployment.md
git add docs/superpowers/specs/2026-06-04-demo-deployment-design.md docs/superpowers/plans/2026-06-04-demo-deployment.md
git commit -m "docs(demo): bring demo spec + plan onto feat/demo-deployment"
```

- [ ] **Step 3: Confirm clean starting point**

Run: `git status --short && git rev-parse --abbrev-ref HEAD`
Expected: empty status, branch `feat/demo-deployment`, both docs present on disk.

---

## Task 1: `isDemoMode()` helper

**Files:**
- Create: `server/services/demoMode.js`

- [ ] **Step 1: Create the helper**

```javascript
// server/services/demoMode.js
//
// Single source of truth for "is this process the demo deployment?".
// Driven by the DEMO_MODE env var, set ONLY on the anchor-hub-demo Cloud Run
// service (never in .env, never on prod). Used as a defense-in-depth kill-switch
// at outbound dispatch boundaries — the PRIMARY guard is that the demo service
// ships with no third-party credentials, so this is belt-and-suspenders.
export function isDemoMode() {
  return process.env.DEMO_MODE === 'true';
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/services/demoMode.js`
Expected: no output (exit 0).

- [ ] **Step 3: Assert behavior both ways**

Run:
```bash
node -e "process.env.DEMO_MODE='true'; const m=await import('./server/services/demoMode.js'); if(m.isDemoMode()!==true) throw new Error('expected true'); console.log('demo true OK');"
node -e "delete process.env.DEMO_MODE; const m=await import('./server/services/demoMode.js'); if(m.isDemoMode()!==false) throw new Error('expected false'); console.log('non-demo false OK');"
```
Expected: `demo true OK` then `non-demo false OK`.

- [ ] **Step 4: Commit**

```bash
git add server/services/demoMode.js
git commit -m "feat(demo): add isDemoMode() helper (DEMO_MODE kill-switch source of truth)"
```

---

## Task 2: Gate Mailgun sends

**Files:**
- Modify: `server/services/mailgun.js` (function `sendMailgunMessage`, ~line 161)

`sendMailgunMessage` is the single choke point every email send funnels through (`sendMailgunMessageWithLogging` calls it).

- [ ] **Step 1: Add the demo guard at the top of `sendMailgunMessage`**

Add the import at the top of the file (with the other imports):
```javascript
import { isDemoMode } from './demoMode.js';
```

At the very start of the `sendMailgunMessage` function body, before any Mailgun API work:
```javascript
  if (isDemoMode()) {
    console.warn('[demo] Mailgun send suppressed (DEMO_MODE).');
    // Mimic a successful send so callers/logging paths don't error.
    return { id: 'demo-suppressed', message: 'Queued. (demo mode — not sent)' };
  }
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/services/mailgun.js`
Expected: exit 0.

- [ ] **Step 3: Confirm the return shape matches real success**

Read `sendMailgunMessage`'s real return (the Mailgun client returns an object with `id`/`message`). Confirm callers only read `.id`/`.message`. Run:
`grep -n "sendMailgunMessage(" server/ -r | head`
Expected: callers don't destructure fields beyond `id`/`message`.

- [ ] **Step 4: Commit**

```bash
git add server/services/mailgun.js
git commit -m "feat(demo): suppress Mailgun sends in DEMO_MODE"
```

---

## Task 3: Gate the tracking relay

**Files:**
- Modify: `server/services/trackingRelay.js` (function `sendEvent`, ~line 47)

`sendEvent` is the single entry for all server-side conversion relay (GA4 MP, Meta CAPI, Google Ads offline).

- [ ] **Step 1: Add the demo guard at the top of `sendEvent`**

Import at top:
```javascript
import { isDemoMode } from './demoMode.js';
```

First lines of the `sendEvent` body:
```javascript
  if (isDemoMode()) {
    console.warn(`[demo] Tracking relay suppressed (DEMO_MODE) for event "${eventName}".`);
    return { suppressed: true, reason: 'demo_mode' };
  }
```

- [ ] **Step 2: Verify syntax**

Run: `node --check server/services/trackingRelay.js`
Expected: exit 0.

- [ ] **Step 3: Confirm callers tolerate the early return**

Run: `grep -rn "sendEvent(" server/services server/routes | head`
Expected: callers `await sendEvent(...)` for side effects and don't depend on a specific success object (relay is fire-and-forget).

- [ ] **Step 4: Commit**

```bash
git add server/services/trackingRelay.js
git commit -m "feat(demo): suppress server-side tracking relay in DEMO_MODE"
```

---

## Task 4: Gate Twilio outbound + config writes

**Files:**
- Modify: `server/services/twilio.js` (functions `purchasePhoneNumber` ~96, `releasePhoneNumber` ~212, `updateTrackingNumber` ~250, `configureTracking` ~337, `reconfigureAllWebhooks` ~369)

These are the functions that mutate real Twilio resources or place outbound calls/SMS. Inbound webhook handlers are not gated (the demo owns no real numbers, so they never fire).

- [ ] **Step 1: Import the helper**

At top of `server/services/twilio.js`:
```javascript
import { isDemoMode } from './demoMode.js';
```

- [ ] **Step 2: Guard `purchasePhoneNumber`**

First lines of the body:
```javascript
  if (isDemoMode()) {
    throw new Error('Twilio number purchase is disabled in the demo environment.');
  }
```

- [ ] **Step 3: Guard `releasePhoneNumber`, `updateTrackingNumber`, `configureTracking`**

At the top of each function body:
```javascript
  if (isDemoMode()) {
    console.warn('[demo] Twilio mutation suppressed (DEMO_MODE).');
    return { suppressed: true, reason: 'demo_mode' };
  }
```

- [ ] **Step 4: Guard `reconfigureAllWebhooks`**

At the top of its body:
```javascript
  if (isDemoMode()) {
    console.warn('[demo] reconfigureAllWebhooks skipped (DEMO_MODE).');
    return { updated: 0, skipped: true };
  }
```

- [ ] **Step 5: Verify syntax**

Run: `node --check server/services/twilio.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/services/twilio.js
git commit -m "feat(demo): disable Twilio outbound + config writes in DEMO_MODE"
```

---

## Task 5: Gate the task-automation webhook action

**Files:**
- Modify: `server/services/taskAutomations.js` (the `send_webhook` action handler, ~line 353)

- [ ] **Step 1: Import the helper**

At top of `server/services/taskAutomations.js`:
```javascript
import { isDemoMode } from './demoMode.js';
```

- [ ] **Step 2: Guard the `send_webhook` branch**

Immediately inside `if (actionType === 'send_webhook') {`, before the `action.url` check:
```javascript
    if (isDemoMode()) {
      console.warn('[demo] send_webhook action suppressed (DEMO_MODE).');
      return { ok: true, skipped: 'demo_mode' };
    }
```

- [ ] **Step 3: Verify syntax**

Run: `node --check server/services/taskAutomations.js`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/services/taskAutomations.js
git commit -m "feat(demo): suppress send_webhook automation action in DEMO_MODE"
```

---

## Task 6: Skip cron jobs in demo

**Files:**
- Modify: `server/index.js` (cron registrations ~lines 1930–2216; setInterval ~2328)

There are ~16 `cron.schedule(...)` calls plus one `setInterval`. A wrapper avoids per-callback guards and keeps the scheduler from waking at all.

- [ ] **Step 1: Add the import and wrapper near the top of `server/index.js`**

With the other imports:
```javascript
import { isDemoMode } from './services/demoMode.js';
```

Just after `import cron from 'node-cron';` usage is set up (top-level, before the first `cron.schedule`):
```javascript
// In the demo deployment, skip ALL scheduled jobs (CTM polling, social publish,
// syncs, cleanups). They would no-op without credentials, but skipping avoids
// wasted compute and log noise. registerCron is a drop-in for cron.schedule.
function registerCron(...args) {
  if (isDemoMode()) {
    return null;
  }
  return cron.schedule(...args);
}
```

- [ ] **Step 2: Replace every `cron.schedule(` call site with `registerCron(`**

Run:
```bash
# Replace only the scheduling call sites, not the import or the wrapper definition.
grep -n "cron.schedule(" server/index.js
```
Edit each scheduling call site `cron.schedule(` → `registerCron(`. The ONLY `cron.schedule(` that must remain is the one **inside the wrapper body** (`return cron.schedule(...args)`).

Verify after replacing:
```bash
grep -n "cron.schedule(" server/index.js   # expect exactly ONE line — the wrapper's return
grep -c "registerCron(" server/index.js     # expect: (number of former call sites) + 1 for the wrapper definition
```
Note: do NOT rewrite the wrapper's own `return cron.schedule(...args)`.

- [ ] **Step 3: Guard the `setInterval` (~line 2328)**

Find `setInterval(() => { tickBulkSchedules()...` and wrap its registration:
```javascript
      if (!isDemoMode()) {
        setInterval(() => { tickBulkSchedules().catch(() => {}); }, 60_000);
      }
```

- [ ] **Step 4: Verify syntax**

Run: `node --check server/index.js`
Expected: exit 0.

- [ ] **Step 5: Boot smoke — demo mode skips crons**

Run (local, against the dev DB; this only checks startup logging, then kill it):
```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null; DEMO_MODE=true yarn server > /tmp/demo-boot.log 2>&1 &
sleep 8; grep -iE "cron|schedule|migrations] All migrations" /tmp/demo-boot.log | head; lsof -ti:4000 | xargs kill -9
```
Expected: server boots, migrations complete, no cron tick logs. (If the dev DB lacks `DEMO_MODE` creds it still boots — we're only checking cron skip + clean startup.)

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat(demo): skip all cron jobs + bulk-schedule interval in DEMO_MODE"
```

---

## Task 7: Security verification — no admin login on a fresh demo DB

**Files:** none (verification + documentation only)

Confirms the public demo URL exposes no admin/superadmin account. `init.sql` seeds no users; `migrate_roles_superadmin.sql` only `UPDATE`s roles; `seed_demo.sql` seeds only `client`-role accounts.

- [ ] **Step 1: Create a throwaway scratch DB and run the full chain**

```bash
dropdb anchor_demo_scratch 2>/dev/null; createdb anchor_demo_scratch
DATABASE_URL="postgresql://bif@localhost:5432/anchor_demo_scratch" DEMO_MODE=true yarn server > /tmp/demo-scratch.log 2>&1 &
sleep 25; grep -iE "migrations] All migrations completed|demo-seed|error" /tmp/demo-scratch.log | head -30
lsof -ti:4000 | xargs kill -9
```
Expected: `[migrations] All migrations completed successfully` AND a demo-seed success line, with **no** migration error. (This doubles as the fresh-DB migration-ordering check the spec requires — see memory: first-apply ordering bugs are masked by re-run dev DBs.)

- [ ] **Step 2: Assert the scratch DB has zero admin/superadmin users**

```bash
psql "postgresql://bif@localhost:5432/anchor_demo_scratch" -c "SELECT email, role, is_demo FROM users ORDER BY role;"
```
Expected: only `client`-role rows (the demo client + seeded team member), all `is_demo = t`. **Zero** `admin`/`superadmin` rows. If any appear, STOP and add a `DELETE FROM users WHERE role IN ('admin','superadmin')` / gate to the seed before proceeding.

- [ ] **Step 3: Drop the scratch DB**

```bash
dropdb anchor_demo_scratch
```

- [ ] **Step 4: Document the finding**

Add a short "Demo deployment" subsection to `docs/INTEGRATIONS.md` noting: separate `anchor_demo` DB, no third-party creds, `DEMO_MODE` kill-switch, client-only (no admin login), banner via `is_demo`.

- [ ] **Step 5: Commit**

```bash
git add docs/INTEGRATIONS.md
git commit -m "docs(demo): document demo deployment isolation + verified no-admin-login on fresh DB"
```

---

## Task 8: Seed enrichment — make the one demo client "solid"

**Files:**
- Modify: `server/sql/seed_demo.sql`

Because `maybeSeedDemoAccount()` runs on every deployment's startup, enriching the seed updates the demo client in **both** prod (`anchor`) and the demo deployment (`anchor_demo`). Keep every addition idempotent (fixed UUIDs / `ON CONFLICT` / delete-then-insert) and obviously fake (`.example` domains, fictional names).

- [ ] **Step 1: Boot locally against a fresh demo DB and log in as the demo client**

```bash
dropdb anchor_demo_scratch 2>/dev/null; createdb anchor_demo_scratch
DATABASE_URL="postgresql://bif@localhost:5432/anchor_demo_scratch" yarn server > /tmp/demo-walk.log 2>&1 &
sleep 25
# In another terminal: yarn start, then log in at localhost:3000 as demo@anchorcorps.com / DemoAccount2024!
```

- [ ] **Step 2: Walk every client-portal tab and record thin/empty ones**

Enumerate the portal tabs from `src/menu-items/portal.js` and `ClientPortal.jsx` `SECTION_CONFIG`. For each (Leads board incl. the new touch columns, Reviews, Reports, Journeys/Pipeline, Documents, Brand, Analytics, Activity log, Contacts, Team), note which look empty or thin.

Run to list the tabs to check:
```bash
grep -n "id:\|label:\|path:" src/menu-items/portal.js | head -40
```

- [ ] **Step 3: Add representative rows for thin tabs to `seed_demo.sql`**

For each thin tab, append idempotent inserts to the matching section of `seed_demo.sql` (it already has labelled sections for clients, journeys, services, active clients, calls, forms, reviews, notifications, documents, tasks). Match existing patterns exactly (fixed UUID vars, `.example` data). Specifically confirm the **new leads board** looks full: New Activity feed, journeys spread across First→Fourth Touch + Awaiting Decision, and a couple of Existing-Client / Repeat examples so the status-tag hierarchy + colors are visible.

- [ ] **Step 4: Re-seed the scratch DB and verify idempotency (run twice)**

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null
psql "postgresql://bif@localhost:5432/anchor_demo_scratch" -f server/sql/seed_demo.sql > /tmp/seed1.log 2>&1
psql "postgresql://bif@localhost:5432/anchor_demo_scratch" -f server/sql/seed_demo.sql > /tmp/seed2.log 2>&1
grep -iE "error|duplicate key|constraint" /tmp/seed2.log | head
```
Expected: second run produces **no** errors / duplicate-key violations (idempotent).

- [ ] **Step 5: Visual confirm, then drop scratch DB**

Re-walk the tabs in the browser — no tab should look empty. Then:
```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null; dropdb anchor_demo_scratch
```

- [ ] **Step 6: Commit**

```bash
git add server/sql/seed_demo.sql
git commit -m "feat(demo): enrich seed so every client-portal tab is populated for the demo client"
```

---

## Task 9: Provision the `anchor_demo` database

**Files:** none (gcloud). Requires an authenticated `gcloud` (project `anchor-hub-480305`). These are operational commands — run by the operator (or via the gcloud MCP tool) and paste output back.

- [ ] **Step 1: Create the empty database on the existing instance**

```bash
gcloud sql databases create anchor_demo \
  --instance=anchor \
  --project=anchor-hub-480305
```
Expected: `Created database [anchor_demo].`

- [ ] **Step 2: Confirm it exists and is empty**

```bash
gcloud sql databases list --instance=anchor --project=anchor-hub-480305 | grep anchor_demo
```
Expected: `anchor_demo` row present. (It has no tables yet — the demo service's first boot builds them.)

---

## Task 10: Deploy the `anchor-hub-demo` Cloud Run service

**Files:** none (gcloud). Reuses the latest prod image so the demo matches prod exactly.

- [ ] **Step 1: Find the image currently running on prod**

```bash
gcloud run services describe anchor-hub --region=us-central1 --project=anchor-hub-480305 \
  --format='value(spec.template.spec.containers[0].image)'
```
Record the image ref as `<PROD_IMAGE>`.

- [ ] **Step 2: Assemble the minimal demo env**

Required:
- `DEMO_MODE=true`
- `NODE_ENV=production`
- `DATABASE_URL` → the `anchor_demo` DB on the same instance via the Cloud SQL unix socket, reusing the same DB user/password as prod (same instance), changing only the database name:
  `postgresql://<DB_USER>:<DB_PASS>@/anchor_demo?host=/cloudsql/anchor-hub-480305:us-central1:anchor`
  (Get `<DB_USER>`/`<DB_PASS>` from prod's `DATABASE_URL`:
  `gcloud run services describe anchor-hub --region=us-central1 --format='value(spec.template.spec.containers[0].env)'` — do NOT print secrets into shared logs.)
- Fresh secrets (independent sessions; empty DB holds no real encrypted data, and seed data is plaintext so a new key is safe):
  `JWT_SECRET=<openssl rand -hex 32>`, plus whatever session/encryption secret names prod uses (read the prod env key names from the describe above and generate fresh values for each).

**Omit entirely** (this is the primary isolation): `CTM_ACCESS_KEY`, `CTM_SECRET_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, all Mailgun keys, all Google keys (`GOOGLE_*`, Ads/GA4/GTM/Vertex), `FACEBOOK_SYSTEM_USER_TOKEN`, reCAPTCHA keys.

- [ ] **Step 3: Deploy**

```bash
gcloud run deploy anchor-hub-demo \
  --image=<PROD_IMAGE> \
  --region=us-central1 \
  --project=anchor-hub-480305 \
  --add-cloudsql-instances=anchor-hub-480305:us-central1:anchor \
  --allow-unauthenticated \
  --set-env-vars=DEMO_MODE=true,NODE_ENV=production \
  --set-env-vars=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@/anchor_demo?host=/cloudsql/anchor-hub-480305:us-central1:anchor" \
  --set-env-vars=JWT_SECRET=<fresh>,<other-session/encryption secrets>=<fresh>
```
Expected: deploy succeeds and prints a `Service URL: https://anchor-hub-demo-…-uc.a.run.app`.

- [ ] **Step 4: Watch first-boot logs (schema build + seed)**

```bash
gcloud run services logs read anchor-hub-demo --region=us-central1 --project=anchor-hub-480305 --limit=200 \
  | grep -iE "migrations] All migrations completed|demo-seed|error|listening"
```
Expected: migrations complete, demo-seed success, server listening, no fatal errors. If a migration error appears, fix it on the branch (it would also affect prod's chain) and redeploy.

- [ ] **Step 5: Smoke the URL**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://anchor-hub-demo-…-uc.a.run.app/api/hub/leads-board
```
Expected: `401` (auth required) — proves the app is up and routing. Then in a browser: open the URL, log in as `demo@anchorcorps.com` / `DemoAccount2024!`, confirm the populated portal + the demo banner, and confirm there is **no** admin login.

---

## Task 11: Auto-track main — Cloud Build trigger

**Files:** none (GCP console). The repo `cloudbuild.yaml` is dead — do NOT edit it. The live build is an **inline trigger in the GCP console**.

> **DECISION (confirm with jmartin):** single trigger, two deploys (preferred — guarantees the demo runs the *identical* image as prod) vs. a second standalone trigger. Plan documents the preferred path; the fallback is noted.

- [ ] **Step 1 (preferred): Add a deploy-demo step to the existing prod trigger**

In the console Cloud Build trigger that builds + deploys `anchor-hub` on push to `main`, append a step that deploys the **same built image** to the demo service:

```bash
gcloud run deploy anchor-hub-demo \
  --image=$_IMAGE \
  --region=us-central1 \
  --add-cloudsql-instances=anchor-hub-480305:us-central1:anchor \
  --allow-unauthenticated
```
(Env vars persist across deploys, so they don't need re-specifying once set in Task 10. Use the same image variable the prod deploy step uses.)

- [ ] **Step 2 (fallback only): dedicated second trigger**

If editing the prod trigger is undesirable, create a second `main` trigger that deploys the latest `anchor-hub` image to `anchor-hub-demo`. Accept that it may rebuild rather than reuse the exact bytes.

- [ ] **Step 3: Verify auto-track end-to-end**

Push a trivial commit to `main` (or re-run the trigger). Confirm both `anchor-hub` and `anchor-hub-demo` show a new revision:
```bash
gcloud run revisions list --service=anchor-hub-demo --region=us-central1 --project=anchor-hub-480305 --limit=3
```
Expected: a new revision timestamped after the push.

---

## Task 12: Compliance pass + final verification

**Files:** none

- [ ] **Step 1: Run the compliance-auditor agent on the branch diff**

This touches auth, data storage, environment config, and outbound dispatch. Dispatch `compliance-auditor` over the `feat/demo-deployment` diff. Expected: confirms no PHI path into the demo DB, outbound hard-disabled, no admin login, no secrets in logs.

- [ ] **Step 2: Full build + lint gate**

Run:
```bash
yarn build && npx eslint src/ --quiet
node --check server/index.js && node --check server/services/demoMode.js
```
Expected: build succeeds; lint clean for files we touched (ignore pre-existing unrelated lint errors per the handoff).

- [ ] **Step 3: Confirm prod is unaffected**

The only shared artifact changed is `seed_demo.sql` (enrichment) and the `DEMO_MODE`-gated code (no-ops when `DEMO_MODE` is unset, which is always true on prod). Confirm prod env has no `DEMO_MODE`:
```bash
gcloud run services describe anchor-hub --region=us-central1 --format='value(spec.template.spec.containers[0].env)' | grep -i demo_mode || echo "DEMO_MODE not set on prod (correct)"
```
Expected: `DEMO_MODE not set on prod (correct)`.

- [ ] **Step 4: Open a PR (do not auto-merge)**

```bash
git push -u origin feat/demo-deployment
gh pr create --title "Demo deployment: isolated anchor-hub-demo client-portal demo" --body "<summary + link to docs/superpowers/specs/2026-06-04-demo-deployment-design.md>"
```
Per project rule: human sign-off before merging to `main` (= auto-deploy). After merge, the trigger from Task 11 deploys the demo automatically.

---

## Self-review notes

- **Spec coverage:** topology (T9–T10), env/isolation + `isDemoMode()` kill-switch (T1–T6), "solid" demo data (T8), auto-track-main (T11), seeded-superadmin security (T7 — verified none exists), fresh-DB migration ordering (T7 step 1 + T10 step 4), compliance pass (T12). The spec's "force banner every session" is intentionally dropped (YAGNI — the only login is the `is_demo` demo client, banner already shows).
- **Open items resolved:** env-var set (T10 step 2); superadmin (T7 — none seeded, nothing to do); guard points (T2–T6); seed enrichment (T8). **Still needs your call:** single-vs-dual Cloud Build trigger (T11) — flagged as a DECISION.
- **Type/name consistency:** `isDemoMode()` is the only new symbol, imported identically everywhere; `registerCron` defined once in `server/index.js`.
