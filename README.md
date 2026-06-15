# Anchor Task Manager

Standalone task-manager app extracted from the Anchor Client Dashboard monolith.
Boards, items, subitems, groups, automations, recurrence, time tracking, dashboards
and an audit log — for internal staff.

It is a **single container**: an Express API that also serves the built React (Vite) SPA.

## Architecture

- **Shared database, scoped access.** This app runs **inside the main app's
  database** (`anchor` on Cloud SQL `anchor-hub-480305:us-central1:anchor`) so it
  shares one `users` table with the Hub. It connects as the `tasks_app` role, which
  is locked down to **`SELECT` on `users`** and **read/write on the `task_*` tables**
  (+ `notifications`, `user_activity_logs`, `security_audit_log`, `email_logs`) — and
  is **denied all PHI tables** (client_profiles, call_logs, contacts, …). The task
  tables already exist in that database; this app does **not** run migrations against
  it (`RUN_MIGRATIONS_ON_START=false`).
- **SSO, stateless.** Login lives in the main app (anchor-hub). This app only
  *verifies* the shared access-token JWT (signed with the same `JWT_SECRET` /
  Secret Manager secret) and looks the user up in the shared `users` table. There is
  no shared session store and no local user provisioning. See `server/middleware/auth.js`.
- **One cross-app link.** Client labels for boards can be fetched read-only from the
  main app — see `server/services/mainApp.js`. Degrades to no-op when `MAIN_APP_URL`
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
  --set-env-vars=NODE_ENV=production,RUN_MIGRATIONS_ON_START=false,DEV_LOGIN=false,GOOGLE_CLOUD_PROJECT=anchor-hub-480305,GOOGLE_CLOUD_REGION=us-central1
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
