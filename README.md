# Anchor Task Manager

Standalone task-manager app extracted from the Anchor Client Dashboard monolith.
Boards, items, subitems, groups, automations, recurrence, time tracking, dashboards
and an audit log — for internal staff.

It is a **single container**: an Express API that also serves the built React (Vite) SPA.

## Architecture

- **Own database.** The app owns a Postgres database (`anchor_tasks`) on the shared
  Cloud SQL instance (`anchor-hub-480305:us-central1:anchor`), connected as the
  `tasks_app` role. Schema = `server/sql/init.sql` + `migrate_security.sql` +
  `migrate_activity_logs.sql` + the 12 `task-*.sql` incrementals, run on boot when
  `RUN_MIGRATIONS_ON_START=true`.
- **SSO, stateless.** Login lives in the main app (anchor-hub). This app only
  *verifies* the shared access-token JWT (signed with the same `JWT_SECRET` /
  Secret Manager secret) and **JIT-provisions** the user row so `task_*` foreign
  keys to `users(id)` resolve. There is no shared session store. See
  `server/middleware/auth.js`.
- **One cross-app link.** Display names for SSO users and (optionally) client
  labels for boards are fetched read-only from the main app — see
  `server/services/mainApp.js`. Degrades to local-only data when `MAIN_APP_URL`
  is unset.

## Local development

```bash
cp .env.example .env          # fill in DATABASE_URL + JWT_SECRET
yarn install
# point DATABASE_URL at a local/Cloud-SQL-proxied Postgres, then:
RUN_MIGRATIONS_ON_START=true yarn server   # creates schema
yarn dev                                   # backend (4000) + vite (3000)
```

With `DEV_LOGIN=true` (default outside production) the login page offers a
local email sign-in shim that mints a token — no main app required.

## Environment

See `.env.example`. The essentials:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | This app's own Postgres (the `tasks_app` role). |
| `JWT_SECRET` | **Must equal the main app's** so its logins are accepted (SSO). |
| `DEV_LOGIN` | Local login shim. **Set `false` in production.** |
| `MAIN_APP_URL` / `MAIN_APP_SERVICE_TOKEN` | Cross-app profile/roster API. |
| `RUN_MIGRATIONS_ON_START` | Run schema migrations on boot (idempotent). |

## Deploy (Cloud Run)

```bash
gcloud run deploy anchor-tasks --source . --region=us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances=anchor-hub-480305:us-central1:anchor \
  --set-secrets=DATABASE_URL=anchor-db-url-tasks:latest,JWT_SECRET=JWT_SECRET:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest \
  --set-env-vars=NODE_ENV=production,RUN_MIGRATIONS_ON_START=true,DEV_LOGIN=false,GOOGLE_CLOUD_PROJECT=anchor-hub-480305,GOOGLE_CLOUD_REGION=us-central1
```

## Cross-app contract (what the main app must provide)

For full SSO + label resolution, the main app (a separate repo) should:

1. **Share `JWT_SECRET`** — already done (same Secret Manager secret is mounted here).
2. **Deliver an access token to this app's browser.** Options: a shared-domain cookie
   set with `Domain=.<parent-domain>`, or a token handoff on first navigation. Until
   then, `DEV_LOGIN=true` lets staff sign in locally.
3. **(Optional) Expose read-only endpoints** for enrichment:
   - `GET /api/internal/users/:id` → `{ id, email, first_name, last_name, role }`
   - `GET /api/hub/client-roster` → `[{ user_id, client_label, … }]`

See `anchor-three-app-integration-plan.md` (§4) for the full plan.
