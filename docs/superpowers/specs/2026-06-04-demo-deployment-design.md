# Demo Deployment — Design Spec

**Date:** 2026-06-04
**Status:** Approved (design) — implementation plan not yet written
**Author:** brainstorming session (jmartin)

## Goal

Give Anchor staff a safe, shareable **demo environment** so coworkers can explore
the **client portal** functionality and UI without any risk of exposing real
client data (PHI). One polished demo client, reachable at a dedicated URL,
always current with `main`.

## Scope

**In scope**
- A dedicated, isolated demo deployment of the existing app (separate Cloud Run
  service + separate empty database).
- Reusing and polishing the existing demo client (`demo@anchorcorps.com` →
  "Bright Smiles Family Dentistry").
- Defense-in-depth so no outbound side-effects (email/SMS/relay) can ever leave
  the demo environment.
- Auto-tracking `main` so the demo always reflects production code.

**Out of scope**
- Demoing the **admin/agency side** (the AdminHub lists all real clients). This
  demo is **client-portal only**.
- Multiple demo clients / multiple verticals / per-coworker logins. One solid
  demo client is sufficient (decided during brainstorming).
- A custom `demo.*` domain. The Cloud Run default URL is acceptable.

## Background — what already exists

The codebase already has a substantial demo system; this design **builds on it**,
it does not replace it.

- **One demo account:** `demo@anchorcorps.com` / `DemoAccount2024!`, role
  `client`, business "Bright Smiles Family Dentistry" (a `medical`/`dental`
  client). Fixed UUID `00000000-0000-4000-a000-000000000001`.
- **Seed:** `server/sql/seed_demo.sql` (~92 KB) populates CRM clients, journeys,
  services, active clients, calls + form submissions with full caller
  enrichment, Twilio tracking numbers, attribution sessions/rows, CTM forms,
  reviews, notifications, documents, and a Tasks workspace/board. It is fully
  idempotent (fixed UUIDs, `ON CONFLICT DO UPDATE`, delete-then-insert where no
  unique constraint exists).
- **Runner:** `server/services/demoSeed.js` → `maybeSeedDemoAccount()`, invoked
  unconditionally during startup (`server/index.js:2296`). It hashes the demo
  password, substitutes the `__DEMO_PASSWORD_HASH__` placeholder, and runs the
  whole seed in one transaction on a single connection. Failures are non-fatal.
- **No external credentials** on the demo account, so CTM/Mailgun/OAuth/etc.
  calls naturally short-circuit via existing credential checks (the original
  "global guard").
- **UI affordances:** `is_demo` flag on `users`; `DemoBanner` (rendered in
  `src/layout/MainLayout/index.jsx`) and `DemoChip` (used in `AdminHub.jsx`).

Because a `client` only ever sees their own portal, the existing demo already
hides real data when logged in as the demo client. What's missing is a **safe,
separate place to point coworkers at** — which is what this design adds.

## Existing infra (verified)

- **Cloud Run services:** `anchor-hub` (the app), `anchor-sites`.
- **Cloud SQL instance** `anchor-hub-480305:us-central1:anchor` with databases:
  `postgres`, `anchor` (prod), `anchor_sites_prod`.
- **Precedent:** `anchor-sites` is a separate Cloud Run service backed by its own
  `anchor_sites_prod` database on the *same* instance. The design below mirrors
  this established pattern.
- **Deploy:** auto Cloud Build on push to `main` via an **inline trigger in the
  GCP console**. The repo `cloudbuild.yaml` is orphaned/dead (exits non-zero if
  invoked) — do not edit it expecting deploy changes. `scripts/gdeploy.sh` is
  also dead (stale Artifact Registry repo).

## Chosen approach (Approach A)

Separate Cloud Run service + separate empty demo database on the existing
instance. Selected over:
- **B (separate service, real prod DB):** rejected — isolation would depend on
  app-level client scoping being perfect rather than the real data simply not
  existing in the DB.
- **C (separate Cloud SQL instance / GCP project):** rejected — adds standing
  instance cost (~$10–50/mo) and setup for no benefit over A for a portal demo.

A gives the strongest "can't leak real data" guarantee (real PHI physically
never lands in the demo DB), near-zero idle cost (Cloud Run scales to zero, no
new SQL instance), and follows the `anchor-sites` pattern.

## Design

### 1. Infrastructure topology

| Component | Value |
|-----------|-------|
| Cloud Run service | `anchor-hub-demo` (project `anchor-hub-480305`, region `us-central1`) |
| Image | identical to prod `anchor-hub` (same Docker build) |
| Database | new `anchor_demo` on the existing `anchor` Cloud SQL instance |
| Cloud SQL connection | `anchor-hub-480305:us-central1:anchor` (same instance, attached to the demo service) |
| URL | auto-generated `anchor-hub-demo-…-uc.a.run.app` |

On first boot against the empty `anchor_demo` database, the existing startup
migration chain (`init.sql` + ~45 migrations) builds the full schema, then
`maybeSeedDemoAccount()` populates the demo client. No code path needs to know
it's "the demo DB" — it's just an empty database the app initializes normally.

### 2. Environment & isolation (defense-in-depth)

The demo service runs with a **deliberately minimal environment**:

- `DATABASE_URL` → `anchor_demo`
- its **own** `JWT_SECRET` / session + encryption secrets (independent sessions
  from prod; the empty demo DB holds no real encrypted data, so a fresh
  encryption key is fine)
- `DEMO_MODE=true`
- **No third-party API credentials** — omit CTM (`CTM_ACCESS_KEY`/`CTM_SECRET_KEY`),
  Twilio (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`), Mailgun, Google
  (Ads/GA4/GTM/Vertex), Meta. With no creds, outbound integrations cannot reach
  a real external service.

> **Per project rule:** these are set on the **Cloud Run service config**, never
> in `.env` (`.env` is production-canonical and must not be modified).

`DEMO_MODE=true` adds a code-level second layer (belt-and-suspenders on top of
"no creds"):

- **Global outbound kill-switch** — when `DEMO_MODE` is set, short-circuit all
  outbound dispatch regardless of whether creds happen to be present:
  - Mailgun email send
  - Twilio voice/SMS and tracking-number config writes
  - outbound webhooks
  - the server-side tracking relay (GA4 Measurement Protocol, Meta CAPI, Google
    Ads offline conversions)
- **Force the demo banner** on for **every** session (not just per-user
  `is_demo`), since on this deployment all sessions are demo sessions.
- **Skip cron jobs** (CTM polling, social publishing, any scheduled sync). They
  would no-op without creds, but skipping avoids wasted compute and log noise.

Implementation note: introduce a single `isDemoMode()` helper (reads
`process.env.DEMO_MODE === 'true'`) and gate the above at the existing dispatch
boundaries, rather than scattering `process.env` checks.

### 3. Demo data ("solid")

Reuse `seed_demo.sql` as-is architecturally. The "make it solid" work is a
**verification + enrichment pass**, not a rewrite:

1. Boot the app locally against a fresh DB, log in as the demo client.
2. Walk every client-portal tab (Leads, Reviews, Reports, Journeys, and any
   others surfaced via `src/menu-items/portal.js` / `ClientPortal.jsx`
   `SECTION_CONFIG`).
3. For any tab that looks empty or thin, add representative rows to
   `seed_demo.sql` (keeping it idempotent with fixed UUIDs).

All seeded contact data must remain obviously fake (`.example` domains,
fictional names) — consistent with the current seed.

### 4. Auto-track-main deploy

Add a **deploy-to-demo step to the existing live Cloud Build trigger** (in the
GCP console — not the dead repo `cloudbuild.yaml`). After the trigger builds the
image and deploys prod `anchor-hub`, it deploys the **same image** to
`anchor-hub-demo` with the demo env vars:

```
gcloud run deploy anchor-hub-demo \
  --image <same-image-just-built> \
  --region us-central1 \
  --add-cloudsql-instances anchor-hub-480305:us-central1:anchor \
  --set-env-vars DEMO_MODE=true,DATABASE_URL=<anchor_demo url>,... \
  --no-allow-unauthenticated=false   # public, like prod
```

One build, two deploys, same image → the demo always matches prod. Re-seed on
each boot keeps the demo fresh and resets any coworker tinkering (desirable).

> If editing the prod trigger is undesirable, the fallback is a **second Cloud
> Build trigger** on `main` that only deploys the latest image to
> `anchor-hub-demo`. Decide at implementation time; the single-trigger
> two-deploy approach is preferred (guarantees identical image, one build).

### 5. Security considerations (resolve during implementation)

- **Seeded superadmin password.** The empty demo DB runs `init.sql`, which may
  seed a superadmin (`jmartin`). On a public demo URL that is an admin login.
  Since this demo is client-portal-only, set a **strong random password** for any
  admin/superadmin seeded into `anchor_demo` (or skip seeding it) so coworkers
  cannot reach the admin side. Document where this password lives.
- **Fresh-DB migration ordering.** Project history shows the full migration chain
  can have first-apply ordering bugs that a re-run local DB masks (composite FKs
  needing their referenced UNIQUE created earlier, etc.). Before the demo service
  boots, build the entire chain against a **throwaway scratch database** to catch
  any ordering break. Any migration that rethrows kills the rest of the startup
  chain, so verify the chain completes cleanly end-to-end.
- **Compliance.** This touches auth, data storage, environment config, and
  outbound dispatch → run a **compliance-auditor** pass before merge. The design
  is compliance-positive (real PHI never enters the demo DB; outbound is
  hard-disabled), but the review confirms no regression.

## Data flow

```
push to main
   │
   ▼
Cloud Build trigger (console)
   ├─ build image
   ├─ deploy anchor-hub        (prod env, real DB anchor)
   └─ deploy anchor-hub-demo   (DEMO_MODE=true, DB anchor_demo, no 3p creds)
                                   │ on boot
                                   ├─ run migration chain → schema in anchor_demo
                                   ├─ maybeSeedDemoAccount() → Bright Smiles data
                                   └─ DEMO_MODE: banner on, crons off, outbound off
                                   │
coworker → anchor-hub-demo-…-uc.a.run.app
         → log in as demo@anchorcorps.com / DemoAccount2024!
         → client portal, fully populated, zero real data, zero outbound
```

## Success criteria

- A coworker can open the demo URL, log in with the demo client credentials, and
  browse a fully populated client portal where no tab looks empty.
- The demo DB contains only seeded demo data — no real client rows, ever.
- No action in the demo (send email, connect integration, trigger relay) reaches
  any real external service.
- A push to `main` updates the demo automatically with the same image as prod.
- Idle cost is effectively zero (Cloud Run scales to zero; no new SQL instance).

## Open items for the implementation plan

- Exact env-var list for the demo service (minimal set) and where secrets live.
- Whether to skip or strong-password the seeded superadmin in `anchor_demo`.
- Single-trigger-two-deploys vs. a dedicated second trigger.
- The `isDemoMode()` guard points (enumerate the dispatch boundaries:
  `mailgun.js`, `twilio.js`, `trackingRelay.js`, webhook senders, cron
  registration in `server/index.js`).
- Seed enrichment list (which portal tabs need more rows).
