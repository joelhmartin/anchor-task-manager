# Route Table

> **Authoritative router → file → purpose map.** This replaces the stale route table in `docs/ARCHITECTURE.md` (which lists only 6 routers — don't cite it). For full per-endpoint docs see `docs/API_REFERENCE.md`.

All routes mount under `/api`. Authentication middleware is applied per-router (not listed here — see `server/middleware/`).

| Mount | Router File | Purpose |
|-------|-------------|---------|
| `/api/auth` | `server/auth.js` | Login, MFA, refresh tokens, sessions, device management, impersonation |
| `/api/hub` | `server/routes/hub.js` (aggregator) + `server/routes/hub/*.js` | CRM core: clients, calls, journeys, docs, OAuth, etc. `hub.js` is now a ~55-line aggregator mounting 22 domain sub-routers (`hub/clients.js`, `hub/calls.js`, `hub/journeys.js`, `hub/contacts.js`, `hub/leads.js`, `hub/oauth.js`, `hub/profile.js`, `hub/accounts.js`, `hub/documents.js`, `hub/portal.js`, …) + shared helper modules (`hub/_shared.js`, `hub/_journeys.js`, `hub/_callHelpers.js`, `hub/_clientProfile.js`). `publicRouter` (avatar + OAuth callbacks) mounts BEFORE the `requireAuth` gate; all others after. |
| `/api/hub/tracking` | `server/routes/tracking.js` | GTM wizard, account listing (GA4/Ads/Meta), form analytics context |
| `/api/onboarding` | `server/routes/onboarding.js` | Token-based + authenticated onboarding wizard, PDFs |
| `/api/tasks` | `server/routes/tasks.js` | Full task platform: workspaces, boards, items, automations, dashboards, billing |
| `/api/reviews` | `server/routes/reviews.js` | GBP review fetch, automation rules, response generation |
| `/api/analytics` | `server/routes/analytics.js` | Unified analytics aggregator (GA4 + Ads + Meta + CTM) |
| `/api/ctm-forms` | `server/routes/ctmForms.js` | CTM Forms: CRUD, embed endpoint, submissions, analytics |
| `/api/forms` | `server/routes/forms.js` | **DECOMMISSIONED** — still mounted, do not add endpoints here |
| `/api/webhooks` | `server/routes/webhooks.js` | Mailgun inbound (public, signature-verified) |
| `/api/twilio` | `server/routes/twilio.js` | Twilio voice/recording/transcription/status webhooks (public) |
| `/api/client-team` | `server/routes/clientTeam.js` | Client-side team member management and invites |
| `/api/client-invite` | `server/routes/clientInvite.js` | Public invite-acceptance flow |
| `/api/tutorials` | `server/routes/tutorials.js` | User tutorial completion tracking |
| `/api/ops` | `server/routes/ops.js` | **Operations command center** (post-rebuild): runs, findings, run definitions, client subscriptions, credentials, AI supervisor chat, cost summary, overview KPIs |
| `/api/operations` | `server/routes/operations.js` | Kinsta site management: sites, envs, SSH terminal (`/ws/ssh`), workspace, bulk actions. **`/findings*` endpoints deprecated** in favor of `/api/ops/findings`; legacy `/assistant/chat` returns 410 — use `/api/ops/chat` |

Full endpoint docs: `docs/API_REFERENCE.md`
