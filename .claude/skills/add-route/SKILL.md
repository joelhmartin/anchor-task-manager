---
name: add-route
description: Use when adding a new API endpoint to the Anchor Client Dashboard Express backend. Covers router selection, auth middleware, input validation, parameterized queries, and doc update.
---

# Add a New API Route

## 1. Pick the right router

| What you're building | Router file |
|---------------------|-------------|
| CRM: clients, calls, journeys, docs, blog | `server/routes/hub.js` |
| Task system | `server/routes/tasks.js` |
| Tracking / GTM wizard | `server/routes/tracking.js` |
| Analytics dashboard | `server/routes/analytics.js` |
| CTM Forms | `server/routes/ctmForms.js` |
| Reviews | `server/routes/reviews.js` |
| Onboarding | `server/routes/onboarding.js` |
| Auth | `server/auth.js` |
| New distinct domain | Create `server/routes/<domain>.js` and mount in `server/index.js` |

**Do not add to `server/routes/forms.js`** — that module is decommissioned.

## 2. Apply auth middleware

Most routers apply `requireAuth` globally at the top of the file. Check if your router already has it. For routes that also need staff access: `isStaff`. For client-portal routes: `isClient`.

Public endpoints (embeds, webhooks) skip auth but must be explicitly designed as such — add a comment explaining why, and ensure CORS is handled.

## 3. Validate input

Validate all user-supplied data at the route boundary before it touches business logic or the database:
- Check required fields are present and correct type
- Sanitize strings (strip unexpected characters if needed)
- Return `400` with a descriptive message for invalid input — never let bad input reach a SQL query

## 4. Write parameterized queries

**Never concatenate user input into SQL.** Use `$1, $2, ...` placeholders:

```js
const result = await pool.query(
  'SELECT * FROM client_profiles WHERE id = $1 AND owner_id = $2',
  [clientId, req.user.id]
);
```

## 5. Check access control server-side

Role checks must happen in server code, not just in the UI. Use `req.user.role`, `req.user.id`, `req.activeClientAccountId`, and `req.portalUserId` as appropriate. Never trust a client-supplied user ID as authorization proof.

## 6. Log security events for sensitive actions

For actions like permission changes, data exports, or admin operations, call `logSecurityEvent()` from `server/services/security/audit.js`. Pass `eventCategory` (string) and `eventType` (string — not undefined).

## 7. Update documentation

Add the new endpoint to `docs/API_REFERENCE.md`:
- Method + path
- Auth requirement
- Request body / query params
- Response shape
- Error cases

## Key reminders

- `hub.js` is ~7400 lines — read it with `offset` to avoid loading the whole file.
- PHI must never appear in logs or error responses (no names, DOB, contact info in 4xx/5xx messages).
- For endpoints that fire tracking events, see `.claude/skills/wire-tracking-event/`.
