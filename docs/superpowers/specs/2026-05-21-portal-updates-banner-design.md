# Client Portal Updates Banner — Design

**Date:** 2026-05-21
**Branch:** `feature/portal-updates-banner`
**Status:** Approved design

## Problem / goal

The agency needs to announce product/structural changes to clients inside the portal. Clients should see undismissed updates as a **dismissible banner** at the top of the portal (same treatment as the existing "You are currently viewing the portal as a client" `<Alert>`), and once a user dismisses an update it never shows again **for that user**. Broadcast to all clients; typed with a colored chip. No tab, no history view.

Plus: a CLAUDE.md workflow so that when making a big structural change to the client portal, I proactively ask whether to post a client-facing update.

## Decisions (confirmed)

1. **Banner, not a tab.** Undismissed updates render as dismissible `<Alert>`-style cards in the top `<Stack>` of `ClientPortal.jsx` (alongside the impersonation alert, ~line 268). Dismiss → permanent for that user; no history.
2. **Broadcast** to all client users; dismissal per user (the logged-in account, `req.user.id`).
3. **Typed with chips:** `feature` (New Feature), `improvement` (Improvement), `notice` (Notice), `maintenance` (Maintenance), each a colored chip. Body is short text; optional "Learn more" link.
4. **Admin authoring UI** so staff can post/manage updates (mirrors the blog-post CRUD with shared components).
5. **CLAUDE.md**: on big client-portal structural changes, ask whether to post an Update; if yes, draft + create via the admin endpoint.

## Data model (mirrors `user_tutorial_completions`)

`migrate_portal_updates.sql` (idempotent):

```sql
CREATE TABLE IF NOT EXISTS portal_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'notice',            -- feature|improvement|notice|maintenance
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',            -- draft|published|archived
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_updates_status_published
  ON portal_updates (status, published_at DESC);

CREATE TABLE IF NOT EXISTS user_update_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  update_id UUID NOT NULL REFERENCES portal_updates(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, update_id)
);
```

Register `maybeRunPortalUpdatesMigration()` in `server/index.js` (after `maybeRunTutorialsMigration`, mirroring its shape) and add it to the `.then()` chain.

## Backend — `server/routes/portalUpdates.js`, mounted `app.use('/api/portal-updates', portalUpdatesRouter)`

**Validation:** `type ∈ {feature,improvement,notice,maintenance}`, `status ∈ {draft,published,archived}`, `title` non-empty ≤ 200, `body` ≤ 2000, `link_url` optional ≤ 500 and must start with `http://`/`https://` (or be empty). Parameterized queries only.

Client-facing (`requireAuth`):
- `GET /` → active updates for me: `status='published' AND id NOT IN (my dismissals)`, newest `published_at` first. Returns `{ updates: [...] }`.
- `POST /:id/dismiss` → idempotent insert into `user_update_dismissals` (`ON CONFLICT DO NOTHING`), keyed to `req.user.id`. Returns `{ ok: true }`.

Admin (`requireAuth, requireAdmin`):
- `GET /admin` → all updates (any status), newest first, with a dismissal count.
- `POST /admin` → create (defaults `status='draft'`). `created_by = req.user.id`.
- `PUT /admin/:id` → partial update (type/title/body/link_url/status). Setting `status='published'` stamps `published_at = NOW()` if not already set.
- `DELETE /admin/:id` → hard delete (cascades dismissals).

> Dismissal keys on `req.user.id` (the logged-in account), matching "per user account." Edge: an admin impersonating a client would dismiss for their own admin account, not the client's — harmless, noted.

## Frontend — client banner

- `src/api/portalUpdates.js`: `fetchActiveUpdates()`, `dismissUpdate(id)`, plus admin `fetchAllUpdates()`, `createUpdate()`, `updateUpdate()`, `deleteUpdate()`.
- `src/views/client/ClientPortal/UpdatesBanner.jsx`: on mount, `fetchActiveUpdates()`; render each as a dismissible `<Alert severity="info">`-style card with a **type chip** (color per type), title (bold), body, optional "Learn more" link, and the built-in `onClose` ✕. On dismiss: optimistically remove from local state, call `dismissUpdate(id)`, reconcile + toast on error. Stacks newest-first.
- Wire into `ClientPortal.jsx`: render `<UpdatesBanner />` in the top `<Stack>` just below the impersonation `<Alert>` (so it shows on every tab). It self-fetches; no portal-wide state needed.

Type chip colors (via existing chip styling): feature = primary/blue, improvement = success/green, notice = info/grey-blue, maintenance = warning/amber.

## Frontend — admin authoring UI

Minimal manager mirroring blog CRUD with shared components (`DataTable`, `FormDialog`, `SelectField`, `StatusChip`, `LoadingButton`, `useToast`, `ConfirmDialog`):
- `src/views/admin/PortalUpdatesManager.jsx`: `DataTable` of updates (type chip, title, status chip, published date, dismissal count) + "New update" button → `FormDialog` (type `SelectField`, title, body multiline, link_url, status select). Row actions: edit, publish/unpublish, delete (`ConfirmDialog`). Immediate state updates from server responses (per CLAUDE.md).
- Mount: add a lazy admin route `/admin/portal-updates` (mirror an existing admin route in `src/routes/`), guarded by the admin route wrapper. (If AdminHub has a clean tab slot, a tab is fine too — implementer picks the lower-risk integration and notes it.)

## CLAUDE.md

Add under the client-portal guidance: *"When making a big structural change to the client portal (new/removed tabs, major layout or workflow changes clients will notice), ask the user whether to post a client-facing Update via the Updates banner (`portal_updates`). If yes, draft type/title/body and create it (admin endpoint `POST /api/portal-updates/admin`, or insert directly in dev)."* Also note the feature exists in the "Where to Look for X" map.

## Docs

- `SKILLS.md`: add `portal_updates` + `user_update_dismissals` to the schema map.
- `docs/API_REFERENCE.md`: document the `/api/portal-updates` endpoints.

## Compliance

No PHI (updates are agency→client announcements, not user data). Parameterized queries. `link_url` scheme-validated to avoid `javascript:` URIs. Admin endpoints gated by `requireAdmin`; client endpoints by `requireAuth` and keyed to `req.user.id`. Body rendered as text (no `dangerouslySetInnerHTML`) to avoid XSS.

## Verification

`node --check` (routes/index), `npx eslint` clean on changed files, `yarn build`, migration runs locally (tables exist), and a manual API round-trip (create→publish→GET active→dismiss→GET active shows it gone). Browser visual check is user-run.
