# API Reference

> **MAINTENANCE DIRECTIVE**: Update this file when:
> - New API endpoints are added to any router in `server/routes/`
> - Existing endpoint request/response schemas change
> - Authentication requirements change for endpoints
> - New query parameters or filters are added
> - Error response codes change
> - New route files are created

Complete documentation of all REST API endpoints in the Anchor Client Dashboard.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication Routes](#authentication-routes-apiauth)
3. [Hub Routes](#hub-routes-apihub)
4. [Onboarding Routes](#onboarding-routes-apionboarding)
5. [Tasks Routes](#tasks-routes-apitasks)
6. [Reviews Routes](#reviews-routes-apireviews)
7. [Webhooks Routes](#webhooks-routes-apiwebhooks)
8. [Twilio Routes](#twilio-routes-apitwilio)
9. [Forms Routes](#forms-routes-apiforms)
10. [Public Routes](#public-routes-embed)
11. [Tracking Provisioning Routes](#tracking-provisioning-routes-apihubtracking)
12. [Reports Routes](#reports-routes-apireports)

---

## Overview

### Base URL

- **Development**: `http://localhost:4000/api`
- **Production**: `https://your-domain.com/api`

### Authentication

Most endpoints require authentication via JWT Bearer token:

```
Authorization: Bearer <access_token>
```

Access tokens are short-lived (15 minutes). Use the refresh endpoint to obtain new tokens.

### Response Format

All responses are JSON. Two shapes are currently in use:

**1. Canonical envelope (new endpoints + endpoints being migrated):**

```json
// Success (200/201)
{
  "data": { ... },               // or array, or null for "no body" mutations
  "meta": { "limit": 50, "offset": 0, "total": 137 }  // optional
}

// Failure (>=400)
{
  "error": { "code": "not_found", "message": "Workspace not found" }
}
```

`error.code` is a stable, machine-readable string
(`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
`validation_error`, `rate_limited`, `internal_error`). The frontend
should branch on `error.code` rather than parsing the user-facing
message.

Use `respondOk` / `respondCreated` / `respondError` from
`server/services/responseEnvelope.js` to emit this shape. The frontend
shim `unwrapData(res, { legacyKey })` in
`src/api/responseEnvelope.js` reads both this envelope and the legacy
named-key shape below, so individual endpoints can migrate without
coordinating a frontend release.

**2. Legacy named-key (most existing endpoints — migration in progress):**

```json
{ "workspaces": [ ... ] }   // list
{ "workspace": { ... } }    // single
{ "ok": true }              // mutation success
{ "success": true }         // mutation success (other variant)
{ "message": "..." }        // error or info
```

The task-manager surface is being migrated to the canonical envelope
endpoint-by-endpoint as part of the `phase-1-response-shape` polish
pass. See `.routines/task-manager-state.md` `known_issues` for the
list of endpoints still on the legacy shape.

### Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

### Role Requirements

| Role | Access Level |
|------|--------------|
| `superadmin` | Full access |
| `admin` | Client management, act-as-client |
| `team` | Tasks, limited admin |
| `editor` | Content editing |
| `client` | Own data only |

---

## Authentication Routes (`/api/auth`)

### POST `/api/auth/login`

Authenticate user with email and password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "deviceId": "optional-device-id",
  "deviceFingerprint": "optional-fingerprint",
  "trustDevice": false
}
```

**Response (Success):**
```json
{
  "accessToken": "eyJ...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "admin",
    "avatar_url": "/uploads/avatars/...",
    "onboarding_completed_at": "2024-01-15T...",
    "effective_role": "admin"
  }
}
```

**Response (MFA Required):**
```json
{
  "requiresMfa": true,
  "challengeId": "uuid",
  "mfaType": "email_otp",
  "maskedEmail": "u***@example.com"
}
```

---

### POST `/api/auth/verify-mfa`

Verify MFA code after login challenge.

**Request:**
```json
{
  "challengeId": "uuid",
  "code": "123456",
  "trustDevice": true
}
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "user": { ... }
}
```

---

### POST `/api/auth/refresh`

Refresh access token using refresh token cookie.

**Request:** None (uses HTTP-only cookie)

**Response:**
```json
{
  "accessToken": "eyJ...",
  "user": { ... }
}
```

---

### POST `/api/auth/logout`

End current session.

**Auth Required:** Yes

**Response:**
```json
{
  "message": "Logged out"
}
```

---

### POST `/api/auth/register`

Register new user (typically disabled in production).

**Request:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

---

### POST `/api/auth/password-reset/request`

Request password reset email.

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "message": "If that email exists, a reset link was sent."
}
```

---

### POST `/api/auth/password-reset`

Reset password with token.

**Request:**
```json
{
  "token": "reset-token-from-email",
  "password": "NewSecurePass123!"
}
```

---

### GET `/api/auth/me`

Get current authenticated user.

**Auth Required:** Yes

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "admin",
    "effective_role": "admin",
    "avatar_url": "...",
    "onboarding_completed_at": "...",
    "activated_at": "..."
  },
  "impersonator": null
}
```

---

### POST `/api/auth/impersonate/:userId`

Admin impersonates a client.

**Auth Required:** Admin+

**Response:**
```json
{
  "accessToken": "eyJ...",
  "user": { ... },
  "impersonator": { ... }
}
```

---

### POST `/api/auth/stop-impersonation`

Return to original admin account.

**Auth Required:** Yes (while impersonating)

---

### GET `/api/auth/sessions`

List user's active sessions.

**Auth Required:** Yes

---

### DELETE `/api/auth/sessions/:sessionId`

Revoke a specific session.

**Auth Required:** Yes

---

## Hub Routes (`/api/hub`)

Main CRM operations. All require authentication.

### Contacts (Contact Entity — merge/split, staff-only)

Resolves the `contact_merge_candidates` queue that `resolveContact()` fills on phone↔email conflicts. All staff-only (`requireAuth` + `isStaff`); merges are transactional and audit-logged.

#### GET `/api/hub/contacts/merge-candidates?status=pending`
Lists merge candidates (`pending` | `merged` | `dismissed`) with both contacts' display name/phone/email.

#### POST `/api/hub/contacts/merge`
Body `{ keepId, mergeId, candidateId? }`. Folds `mergeId` into `keepId`: moves non-duplicate phones/emails, reassigns `call_logs`/`client_journeys`/`active_clients.contact_id`, backfills the keeper's display fields, deletes the loser, resolves the candidate. Returns `{ ok, keepId, mergedFrom, moved }`. 400 if ids missing/equal, 404 if not found, 409 if cross-owner.

#### POST `/api/hub/contacts/merge-candidates/:id/dismiss`
Marks a pending candidate `dismissed`.

#### GET `/api/hub/contacts/by-tag/:tagId`
Segmentation: all contacts carrying that tag (id, name, phone, email, consent flags, tag source).

#### GET / POST / DELETE `/api/hub/contacts/:id/tags`
List a contact's tags; apply a user tag; remove (`/:tagId`). POST accepts either `{ tagId }` (an existing owner tag) or `{ tagName, tagColor? }` (create-or-get a free-form tag on the fly, mirroring the Leads "add a tag" UX) and returns the resolved `{ tag }`. Reuses the `lead_tags` catalog; audit-logged. Note: adding a tag to an activity via `POST /api/hub/calls/:id/tags` also rolls the tag up onto that call's linked contact.

#### PATCH `/api/hub/contacts/:id/consent`
Set `sms_opted_out` and/or `email_opted_out` (boolean) for bulk-SMS/email suppression; stamps `email_unsubscribed_at`. Audit-logged.

#### Contacts list — derived `disposition`
`GET /api/hub/contacts` (and `…/export.csv`) returns a derived **`disposition`** per row alongside `lifecycle`: the highest-precedence category across **all** of the contact's activities (`qualified` › `needs_attention` › `unanswered` › `not_a_fit` › `spam` › `pending_review`). Derived in SQL, never stored; mirrors the `category` filter's predicates. The frontend Status column leads with disposition and layers the `lifecycle` (In Journey / Active Client) as a secondary badge.

**Reserved tag names:** category/lifecycle words (e.g. `qualified`, `spam`, `unanswered`, `priority`, `in journey`, `active client`) are reserved — those states are rendered from derived disposition/lifecycle, not tags. `GET /api/hub/contacts/tag-options` filters them out, and the tag-create endpoints (`POST /lead-tags`, `POST /calls/:id/tags`, `POST /contacts/:id/tags`) reject them with a 400.

### Clients

#### GET `/api/hub/clients`

List all clients (admin only).

**Auth Required:** Admin+

**Query Params:**
- `search` - Filter by name/email
- `status` - Filter by status

**Response:**
```json
{
  "clients": [
    {
      "id": "uuid",
      "email": "client@example.com",
      "first_name": "Client",
      "last_name": "User",
      "role": "client",
      "business_name": "Acme Corp",
      "display_name": "Client User",
      "onboarding_completed_at": "...",
      "activated_at": "..."
    }
  ]
}
```

---

#### GET `/api/hub/clients/:id`

Get single client details.

**Auth Required:** Admin+

---

#### POST `/api/hub/clients`

Create new client.

**Auth Required:** Admin+

**Request:**
```json
{
  "email": "newclient@example.com",
  "first_name": "New",
  "last_name": "Client",
  "client_type": "medical",
  "client_subtype": "dental",
  "send_email": true
}
```

---

#### PUT `/api/hub/clients/:id`

Update client profile.

**Auth Required:** Admin+

---

#### DELETE `/api/hub/clients/:id`

Delete client (soft delete).

**Auth Required:** Admin+

---

#### GET `/api/hub/clients/:id/onboarding-link`

Generate new onboarding link for client.

**Auth Required:** Admin+

**Response:**
```json
{
  "url": "https://domain.com/onboarding?token=...",
  "expiresAt": "2024-01-20T..."
}
```

---

#### POST `/api/hub/clients/:id/reclassify-leads`

Re-run AI classification on client's leads.

**Auth Required:** Admin+

**Request:**
```json
{
  "limit": 200,
  "force": true
}
```

---

#### POST `/api/hub/clients/:leadId/agree-to-service`

Convert a lead (call log) into an active client.

**Auth Required:** Yes

**Request:**
```json
{
  "services": [
    {
      "service_id": "uuid",
      "agreed_price": 250.00,
      "agreed_date": "2024-01-15"
    }
  ],
  "source": "CTM Call",
  "patient_type": "new",
  "journey_id": "uuid",
  "funnel_data": {
    "caller_name": "Jane Smith",
    "caller_number": "+15551234567",
    "email": "jane@example.com"
  }
}
```

- `services` (array, required): One or more services to attach. Each item requires `service_id`; `agreed_price` and `agreed_date` are optional.
- `patient_type` (string, optional): `"new"` or `"existing"`. `"new"` stamps the originating lead 5★, fires the `new_client` conversion relay (GA4 / Meta CAPI / Google Ads offline), and posts the 5★ conversion to CTM. `"existing"` (the default when omitted or invalid) adds the client to the list with no star and no conversion event.
- `journey_id` (string, optional): Associate the new active-client record with an existing journey.
- `funnel_data` (object, optional): Caller metadata used to populate the client record (`caller_name`, `caller_number`, `email`).

---

### Calls / Leads

#### GET `/api/hub/calls`

Get call logs for client.

**Auth Required:** Yes

**Query Params:**
- `search` - Search transcripts, names
- `category` - Filter by classification. Accepts the visible tab values `qualified`, `returning`, `needs_attention`, `unanswered`, `not_a_fit`, `spam`, `pending_review`, as well as the legacy value `lead` (resolves to the full ungated lead bucket). `qualified` = lead-bucket forms/SMS plus calls scored ≥ 3★; `returning` = lead-bucket calls scored < 3★ (lukewarm + suppressed re-engagement callbacks). The legacy `lead` value still resolves to the full ungated bucket.
- `caller_type` - `new`, `repeat`, `returning_customer`
- `date_from`, `date_to` - Date range
- `page`, `limit` - Pagination

**Response:**
```json
{
  "calls": [
    {
      "id": "uuid",
      "call_id": "ctm-call-id",
      "from_number": "+15551234567",
      "started_at": "2024-01-15T...",
      "duration_sec": 120,
      "score": 4,
      "caller_type": "new",
      "has_previous_journey": false,
      "meta": {
        "category": "warm",
        "classification_summary": "Interested in dental cleaning",
        "caller_name": "Sample Caller",
        "transcript": "..."
      }
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 25,
  "categoryCounts": {
    "qualified": 12,
    "returning": 5,
    "needs_attention": 3,
    "unanswered": 8,
    "not_a_fit": 2,
    "spam": 1,
    "pending_review": 0
  }
}
```

---

#### POST `/api/hub/calls/sync`

Sync calls from CTM (incremental).

**Auth Required:** Yes

---

#### POST `/api/hub/calls/full-sync`

Full historical sync from CTM.

**Auth Required:** Admin+

---

#### POST `/api/hub/calls/:id/score`

Set star rating on call.

**Auth Required:** Yes

**Request:**
```json
{
  "score": 4
}
```

---

#### DELETE `/api/hub/calls/:id/score`

Remove star rating from call.

**Auth Required:** Yes

---

#### PUT `/api/hub/calls/:id/category`

Update call classification.

**Auth Required:** Yes

**Request:**
```json
{
  "category": "warm"
}
```

---

#### POST `/api/hub/calls/:id/link-client`

Link call to active client.

**Auth Required:** Yes

**Request:**
```json
{
  "activeClientId": "uuid"
}
```

---

#### DELETE `/api/hub/calls/:id/link-client`

Unlink call from active client.

**Auth Required:** Yes

---

#### GET `/api/hub/calls/:id/history`

Get call history for phone number.

**Auth Required:** Yes

---

### Tags

#### GET `/api/hub/tags`

Get all lead tags.

**Auth Required:** Yes

---

#### POST `/api/hub/tags`

Create new tag.

**Auth Required:** Yes

**Request:**
```json
{
  "name": "Hot Lead",
  "color": "#FF5733"
}
```

---

#### POST `/api/hub/calls/:callId/tags`

Add tag to call.

**Auth Required:** Yes

**Request:**
```json
{
  "tagId": "uuid"
}
```

---

#### DELETE `/api/hub/calls/:callId/tags/:tagId`

Remove tag from call.

**Auth Required:** Yes

---

### Journeys

#### GET `/api/hub/journeys`

List journeys for the owner, grouped by stage.

**Auth Required:** Yes

**Query Params:**
- `status` - Filter by status (`active`, `converted`, `archived`)
- `archived` - `true` to include archived journeys (equivalent to `status=archived`)

**Response:**
```json
{
  "journeys": [
    {
      "id": "uuid",
      "stage": "second_touch",
      "status": "active",
      "client_name": "Sample Client",
      "client_phone": "+15551234567",
      "has_previous_journey": false
    }
  ]
}
```

---

#### POST `/api/hub/journeys`

Create a new journey. Starts at `first_touch` stage.

**Auth Required:** Yes

**Request:**
```json
{
  "lead_call_id": "uuid",
  "client_name": "Sample Client",
  "client_phone": "+15551234567",
  "symptoms": ["Consultation"],
  "service_id": "uuid"
}
```

---

#### GET `/api/hub/journeys/:id`

Get journey details including activity timeline.

**Auth Required:** Yes

---

#### PUT `/api/hub/journeys/:id`

Update journey fields (name, phone, email, symptoms, status, paused, next_action_at, notes_summary).

**Auth Required:** Yes

---

#### PATCH `/api/hub/journeys/:id/stage`

Advance or set the journey stage.

**Auth Required:** Yes

**Request:**
```json
{
  "stage": "third_touch"
}
```

Valid values: `first_touch`, `second_touch`, `third_touch`, `fourth_touch`, `awaiting_decision`.

---

#### POST `/api/hub/journeys/:id/email`

Send or schedule an email touch for this journey. Advances stage on send.

**Auth Required:** Yes

**Request:**
```json
{
  "template_id": "uuid (optional)",
  "subject": "Following up",
  "preheader": "Just wanted to circle back on your inquiry",
  "body": "<p>Hi, just checking in...</p>",
  "body_format": "html",
  "attachment_file_ids": ["uuid-of-file-1", "uuid-of-file-2"],
  "scheduled_for": "2024-02-01T09:00:00Z (optional — omit to send immediately)"
}
```

Field notes:
- `attachment_file_ids` — string[] of file UUIDs from the `file_uploads` table; files are attached to the outgoing email.
- `preheader` — preview text shown in email client inbox summary (before the message is opened).
- `scheduled_for` — ISO datetime; omit to send immediately.

---

#### POST `/api/hub/journeys/:id/call`

Log a call touch on the journey.

**Auth Required:** Yes

**Request:**
```json
{
  "notes": "Left voicemail"
}
```

---

#### POST `/api/hub/journeys/:id/note`

Add a note to the journey timeline.

**Auth Required:** Yes

**Request:**
```json
{
  "body": "Client asked to follow up next week"
}
```

---

#### POST `/api/hub/journeys/:id/text`

Log a text/SMS touch on the journey. Gated by `JOURNEY_SMS_ENABLED` env flag; returns 503 while disabled — never dispatches while off.

**Auth Required:** Yes

**Request:**
```json
{
  "body": "Hi, just following up on your inquiry."
}
```

---

#### POST `/api/hub/journeys/:id/schedule/cancel`

Cancel a pending scheduled email for this journey.

**Auth Required:** Yes

---

#### POST `/api/hub/journeys/:id/convert`

Convert the journey to an active client.

**Auth Required:** Yes

**Request:**
```json
{
  "source": "CTM Call",
  "services": [
    { "service_id": "uuid", "agreed_price": 250.00, "agreed_date": "2024-01-15" }
  ]
}
```

---

#### POST `/api/hub/journeys/:id/archive`

Archive the journey.

**Auth Required:** Yes

---

#### POST `/api/hub/journeys/:id/unarchive`

Restore an archived journey.

**Auth Required:** Yes

---

#### GET `/api/hub/journey-email-templates`

List email templates for the owner.

**Auth Required:** Yes

---

#### POST `/api/hub/journey-email-templates`

Create a reusable email template.

**Auth Required:** Yes

**Request:**
```json
{
  "name": "First Touch",
  "subject": "Thanks for reaching out",
  "preheader": "We'd love to help — here's a quick note",
  "body": "<p>Hi, thank you for contacting us...</p>",
  "body_format": "html",
  "attachments": [
    { "file_id": "uuid-of-file", "name": "Consultation Guide.pdf" }
  ],
  "sms_use_email_body": false,
  "sms_body": "Hi, thanks for reaching out! We'll be in touch shortly.",
  "sms_opt_out": "Reply STOP to unsubscribe"
}
```

Field notes:
- `preheader` — preview text shown in email client inbox summary.
- `attachments` — array of `{ file_id: string (UUID), name: string }`; files attached by default when using this template.
- `sms_use_email_body` — when `true` (default), the SMS touch reuses the email body; set `false` to provide a custom `sms_body`.
- `sms_body` — custom SMS message body (used when `sms_use_email_body` is `false`).
- `sms_opt_out` — opt-out footer appended to outbound SMS messages.

---

#### PUT `/api/hub/journey-email-templates/:templateId`

Update an email template. Accepts the same fields as `POST` above.

**Auth Required:** Yes

---

#### DELETE `/api/hub/journey-email-templates/:templateId`

Archive (soft-delete) an email template.

**Auth Required:** Yes

---

#### POST `/api/hub/journey-email-templates/test`

Send a **test** of the current email draft (subject/body/preview/attachments) through the exact same render+send path as a real journey touch. Uses synthetic sample lead tokens (e.g. `first_name: "Jane"`) and a `[Test]` subject prefix; the account's real branding (business name, phone, email, logo) still resolves. Does **not** create a journey activity or advance any stage.

**Body:** `{ subject, body, body_format = 'html', preheader?, attachment_file_ids?: string[], recipients: string[] }`
- `recipients` — 1–10 email addresses (de-duped; each validated). Attachments must be owned by the account (`file_uploads`, `owner_type='user'`).

**Returns:** `{ sent, failed }` (one message sent per recipient — no cross-exposure). `502` if all sends fail.

**Auth Required:** Yes (owner-scoped; `canWriteAccount`).

---

> **Retired endpoints (pre-redesign):** `POST /journeys/:id/steps`, `PUT /journeys/:journeyId/steps/:stepId`, `DELETE /journeys/:journeyId/steps/:stepId`, `POST /journeys/:id/notes` (replaced by `/note`), `POST /journeys/:id/apply-template`, `GET /journey-template`, `PUT /journey-template`. These are no longer active.

---

### Active Clients

#### GET `/api/hub/active-clients`

Get all active clients.

**Auth Required:** Yes

---

#### POST `/api/hub/active-clients`

Create active client (convert from journey).

**Auth Required:** Yes

**Request:**
```json
{
  "client_name": "John Smith",
  "client_phone": "+15551234567",
  "client_email": "john@example.com",
  "source": "CTM Call",
  "services": [
    {
      "service_id": "uuid",
      "agreed_price": 250.00,
      "agreed_date": "2024-01-15"
    }
  ]
}
```

---

#### PUT `/api/hub/active-clients/:id`

Update active client.

**Auth Required:** Yes

---

### Services

#### GET `/api/hub/services`

Get available services.

**Auth Required:** Yes

---

#### POST `/api/hub/services`

Create service.

**Auth Required:** Admin+

---

#### PUT `/api/hub/services/:id`

Update service.

**Auth Required:** Admin+

---

#### DELETE `/api/hub/services/:id`

Delete service.

**Auth Required:** Admin+

---

### Profile & Brand

#### GET `/api/hub/profileMe`

Get authenticated user's profile.

**Auth Required:** Yes

---

#### PUT `/api/hub/profileMe`

Update authenticated user's profile.

**Auth Required:** Yes

---

#### POST `/api/hub/avatarMe`

Upload avatar (multipart/form-data).

**Auth Required:** Yes

---

#### GET `/api/hub/brandMe`

Get brand assets.

**Auth Required:** Yes

---

#### PUT `/api/hub/brandMe`

Update brand assets.

**Auth Required:** Yes

---

### Documents

#### GET `/api/hub/documentsMe`

Get user's documents.

**Auth Required:** Yes

---

#### POST `/api/hub/documentsMe`

Upload document (multipart/form-data).

**Auth Required:** Yes

---

#### DELETE `/api/hub/documentsMe/:id`

Delete document.

**Auth Required:** Yes

---

### Email Logs

#### GET `/api/hub/email-logs`

Get email logs (admin only).

**Auth Required:** Admin+

**Query Params:**
- `page`, `limit` - Pagination
- `search` - Search recipient
- `email_type` - Filter by type
- `status` - Filter by status

---

#### GET `/api/hub/email-logs/stats`

Get email statistics (30-day summary).

**Auth Required:** Admin+

---

#### GET `/api/hub/email-logs/:id`

Get single email log with full content.

**Auth Required:** Admin+

---

### Client Portal — Activity Log (self-scoped)

Client-facing, read-only counterparts of the admin activity/email-log endpoints. All routes run under
the default `requireAuth` and **self-scope to `req.portalUserId`** (never a client-supplied id):
activity = account owner + active team members (excludes `admin`-category and agency actions; hides
`ip_address`/`user_agent`); email = rows where `client_id = req.portalUserId`. Exports are audited
(`logSecurityEvent`) and capped at 10,000 rows.

#### GET `/api/hub/portal/activity-logs`

Paginated activity for the client's own account team.

**Auth Required:** Any authenticated portal user

**Query Params:** `page`, `limit` (≤100), `search`, `category`, `from`, `to`

---

#### GET `/api/hub/portal/activity-logs/export.csv`

CSV export of activity. Audited. Columns selectable via `columns` (keys: `date`, `actor`, `action`,
`category`, `entity`, `details`).

**Auth Required:** Any authenticated portal user

**Query Params:** `columns` (CSV of keys), `from`, `to`

---

#### GET `/api/hub/portal/email-logs`

Paginated emails about this client (metadata + delivery status only; no body, no agency identity).

**Auth Required:** Any authenticated portal user

**Query Params:** `page`, `limit` (≤100), `email_type`, `status`, `search`, `from`, `to`

---

#### GET `/api/hub/portal/email-logs/export.csv`

CSV export of emails. Audited. Columns selectable via `columns`; `recipient_name` and `text_body`
(PHI-flagged) are opt-in / off by default.

**Auth Required:** Any authenticated portal user

**Query Params:** `columns` (CSV of keys), `from`, `to`

---

#### GET `/api/hub/portal/email-logs/:id`

Single email **with body** (`text_body`/`html_body`). Returns 404 unless `client_id === req.portalUserId`.

Body retention: journey email bodies are stored **only for non-medical clients** (medical clients are
never stored — body shows `[redacted - PHI]`), and are auto-redacted to the same sentinel after **30
days** by the `[cron:redact-email-bodies]` sweep in `server/index.js`. CTM form-notification emails are
logged without a `client_id`, so they never appear in the portal.

**Auth Required:** Any authenticated portal user

---

### OAuth Providers (Admin)

#### GET `/api/hub/oauth-providers`

List OAuth providers.

**Auth Required:** Admin+

---

#### POST `/api/hub/oauth-providers`

Create OAuth provider.

**Auth Required:** Admin+

---

#### PUT `/api/hub/oauth-providers/:id`

Update OAuth provider.

**Auth Required:** Admin+

---

#### DELETE `/api/hub/oauth-providers/:id`

Delete OAuth provider.

**Auth Required:** Admin+

---

### OAuth Connections (Per Client)

#### GET `/api/hub/clients/:clientId/oauth-connections`

Get client's OAuth connections.

**Auth Required:** Admin+

---

#### POST `/api/hub/clients/:clientId/oauth-connections`

Create OAuth connection.

**Auth Required:** Admin+

---

#### POST `/api/hub/oauth-connections/:id/revoke`

Revoke OAuth connection.

**Auth Required:** Admin+

---

### Client Team Management

Endpoints for inviting, role-managing, and removing team members on a client account, plus orchestrating ownership transfer. All routes require `isAdminOrEditor` (agency staff).

#### PATCH `/api/hub/clients/:id/team/invite/:inviteId`

Edit role or first name on a pending invite. Email is immutable.

**Body:** `{ role?: 'admin' | 'member', first_name?: string }`

Setting `role: 'owner'` returns **409** with `code: 'USE_TRANSFER_OWNERSHIP'` — use `POST .../transfer-ownership` instead.

**Response:** `{ success: true, invite: { id, invite_email, invite_first_name, invite_role, expires_at, metadata } }`

**Auth Required:** Admin or Editor (`isAdminOrEditor`)

---

#### POST `/api/hub/clients/:id/team/transfer-ownership`

Orchestrate ownership transfer. Three target kinds:

| Kind | Behavior |
|------|----------|
| `member` | Immediate transfer to an existing active member. |
| `invite` | Updates an existing pending invite to `invite_role='owner'` and stamps `pending_owner_transfer` metadata. Transfer applies on acceptance. |
| `email`  | Creates a new owner-role invite for the email, with `pending_owner_transfer` metadata. Transfer applies on acceptance. |

**Body:**
```jsonc
{
  "target": {
    "kind": "member" | "invite" | "email",
    "memberId": "<uuid>",   // when kind=member
    "inviteId": "<uuid>",   // when kind=invite
    "email": "...",         // when kind=email
    "firstName": "..."      // optional, kind=email
  },
  "currentOwnerAction": "boot" | "demote"
}
```

`currentOwnerAction` is applied immediately for `member` kind, and at invite acceptance for `invite` / `email` kinds. `boot` removes the displaced owner's membership (`status='removed'`); `demote` keeps them as `role='admin', status='active'`.

**Response (member kind):** `{ success: true, kind: 'member', applied: 'immediate' }`
**Response (invite kind):** `{ success: true, kind: 'invite', applied: 'on_accept', inviteId }`
**Response (email kind):** `{ success: true, kind: 'email', applied: 'on_accept', inviteId, inviteUrl }`

**Errors:** 400 (malformed target / bad `currentOwnerAction`), 404 (member/invite not found), 409 with one of:
- `code: 'OWNER_INVITE_ALREADY_PENDING'` — a pending owner invite already exists for this client (either a queued transfer or the original self-claim invite). Revoke it before starting a new transfer. Response includes `existingInviteId`, `existingInviteEmail`, and `existingInviteKind` (`'transfer'` or `'self_claim'`).
- `code: 'TARGET_IS_MEMBER'` — `kind=email` but the email is already an active team member; use `kind=member` instead.
- `code: 'TARGET_HAS_PENDING_INVITE'` — `kind=email` but a pending invite already exists for this email; use `kind=invite` instead.
- "Target is already the owner" — `kind=member` with target == current owner.

**Auth Required:** Admin or Editor (`isAdminOrEditor`)

---

#### Behavior change on `PATCH /api/hub/clients/:id/team/members/:memberId`

As of 2026-05-07, this endpoint returns **409** with `code: 'USE_TRANSFER_OWNERSHIP'` when the request body sets `role: 'owner'`. All other roles continue to update via this endpoint as before. Use `POST .../transfer-ownership` to make a member the owner.

---

### Notifications

#### GET `/api/hub/notifications`

Get user's notifications.

**Auth Required:** Yes

---

#### PUT `/api/hub/notifications/:id/read`

Mark notification as read.

**Auth Required:** Yes

---

#### PUT `/api/hub/notifications/read-all`

Mark all notifications as read.

**Auth Required:** Yes

---

## Onboarding Routes (`/api/onboarding`)

Client onboarding wizard endpoints.

### GET `/api/onboarding/:token`

Validate onboarding token and get state.

**Response:**
```json
{
  "valid": true,
  "userId": "uuid",
  "email": "client@example.com",
  "profile": { ... },
  "draftJson": { ... }
}
```

---

### POST `/api/onboarding/:token/activate`

Complete step 1 (set password).

**Request:**
```json
{
  "display_name": "John Doe",
  "password": "SecurePass123!"
}
```

**Response:**
```json
{
  "success": true,
  "accessToken": "eyJ...",
  "user": { ... }
}
```

---

### POST `/api/onboarding/:token/draft`

Save draft progress (token-based).

**Request:**
```json
{
  "draftJson": {
    "currentStep": 2,
    "profile": { ... },
    "services": [ ... ]
  }
}
```

---

### POST `/api/onboarding/me/draft`

Save draft progress (authenticated).

**Auth Required:** Yes

---

### POST `/api/onboarding/me/complete`

Complete onboarding.

**Auth Required:** Yes

---

### POST `/api/onboarding/:token/upload/avatar`

Upload avatar (token-based, multipart/form-data).

---

### POST `/api/onboarding/:token/upload/brand`

Upload brand asset (token-based, multipart/form-data).

---

### POST `/api/onboarding/me/upload/brand`

Upload brand asset (authenticated, multipart/form-data).

**Auth Required:** Yes

---

## Tasks Routes (`/api/tasks`)

Task management system. Requires `team` role or higher.

### Workspaces

#### GET `/api/tasks/workspaces`

List workspaces user has access to.

**Response:** Canonical envelope — `{ "data": [ {workspace}, ... ] }`.

---

#### POST `/api/tasks/workspaces`

Create workspace.

**Request:**
```json
{
  "name": "My Workspace"
}
```

**Response (201):** Canonical envelope — `{ "data": {workspace} }`.

---

#### DELETE `/api/tasks/workspaces/:workspaceId`

Delete a workspace (cascades boards/groups/items).

**Response:** Canonical envelope — `{ "data": null }`.

---

### Boards

#### GET `/api/tasks/workspaces/:workspaceId/boards`

List boards in workspace.

---

#### POST `/api/tasks/workspaces/:workspaceId/boards`

Create board.

**Request:**
```json
{
  "name": "Project Board",
  "description": "Main project tasks"
}
```

---

#### PUT `/api/tasks/boards/:boardId`

Update board.

---

#### DELETE `/api/tasks/boards/:boardId`

Delete board.

---

### Groups

#### GET `/api/tasks/boards/:boardId/groups`

List groups in board.

---

#### POST `/api/tasks/boards/:boardId/groups`

Create group.

**Request:**
```json
{
  "name": "In Progress",
  "order_index": 1
}
```

---

### Items

#### GET `/api/tasks/groups/:groupId/items`

List items in group.

---

#### POST `/api/tasks/groups/:groupId/items`

Create item.

**Request:**
```json
{
  "name": "Implement feature X",
  "status": "Working",
  "due_date": "2024-02-01"
}
```

---

#### PUT `/api/tasks/items/:itemId`

Update item.

---

#### DELETE `/api/tasks/items/:itemId`

Delete item.

---

#### POST `/api/tasks/items/:itemId/archive`

Archive item.

---

### Subitems

#### GET `/api/tasks/items/:itemId/subitems`

List subitems.

---

#### POST `/api/tasks/items/:itemId/subitems`

Create subitem.

---

### Updates (Comments)

#### GET `/api/tasks/items/:itemId/updates`

List updates on item.

---

#### POST `/api/tasks/items/:itemId/updates`

Create update.

**Request:**
```json
{
  "content": "Started working on this task"
}
```

---

### Time Entries

#### GET `/api/tasks/items/:itemId/time-entries`

List time entries.

---

#### POST `/api/tasks/items/:itemId/time-entries`

Create time entry.

**Request:**
```json
{
  "time_spent_minutes": 90,
  "description": "Research and planning",
  "is_billable": true
}
```

---

### Automations

#### GET `/api/tasks/boards/:boardId/automations`

List board automations.

---

#### POST `/api/tasks/boards/:boardId/automations`

Create automation.

**Request:**
```json
{
  "name": "Notify on completion",
  "trigger_type": "status_change",
  "trigger_config": { "to_status": "Done" },
  "action_type": "notify_assignees",
  "action_config": {}
}
```

---

### Status Labels

#### GET `/api/tasks/boards/:boardId/status-labels`

List board status labels.

---

#### POST `/api/tasks/boards/:boardId/status-labels`

Create status label.

---

#### DELETE `/api/tasks/status-labels/:labelId`

Delete a status label (admins only).

**Response:** Canonical envelope — `{ "data": null }`.

---

### AI Features

#### POST `/api/tasks/items/:itemId/ai-summary`

Generate AI summary for item.

---

#### GET `/api/tasks/daily-overview`

Get AI daily overview.

---

## Reviews Routes (`/api/reviews`)

Google Business Profile review management.

### GET `/api/reviews`

List reviews.

**Query Params:**
- `rating` - Filter by star rating
- `response_status` - `pending`, `responded`
- `priority` - `low`, `normal`, `high`, `urgent`

---

### GET `/api/reviews/:id`

Get review details.

---

### POST `/api/reviews/:id/draft`

Generate AI draft response.

**Request:**
```json
{
  "tone": "professional"
}
```

---

### POST `/api/reviews/:id/respond`

Post response to Google.

**Request:**
```json
{
  "response": "Thank you for your feedback..."
}
```

---

### PUT `/api/reviews/:id/priority`

Set review priority.

---

### PUT `/api/reviews/:id/flag`

Flag review for attention.

---

### POST `/api/reviews/:id/notes`

Add internal note.

---

## Webhooks Routes (`/api/webhooks`)

External webhook handlers.

### POST `/api/webhooks/mailgun`

Mailgun event webhook (delivery, open, click, bounce, etc.).

**Note:** Authenticated via Mailgun signature verification.

---

## Public Routes (`/embed`)

Public form embed endpoints (no auth required).

### GET `/embed/:formId`

Get form embed script.

---

### GET `/embed/:formId/json`

Get form schema as JSON.

---

### POST `/embed/:formId/submit`

Submit form data.

**Request:**
```json
{
  "fields": {
    "name": "John",
    "email": "john@example.com",
    "message": "Hello..."
  },
  "metadata": {
    "page_url": "https://example.com/contact",
    "referrer": "https://google.com"
  }
}
```

---

## Twilio Routes (`/api/twilio`)

Twilio webhook endpoints for call tracking. These endpoints are called by Twilio, not by the frontend.

### POST `/voice`

**Public** - Incoming call webhook (returns TwiML).

Called by Twilio when a call comes in to a tracking number.

**Request** (Twilio webhook payload):
```json
{
  "CallSid": "CA...",
  "From": "+15551234567",
  "To": "+15559876543",
  "Direction": "inbound"
}
```

**Response**: TwiML XML for call handling

---

### POST `/status`

**Public** - Call status update webhook.

Called by Twilio when call status changes (initiated, ringing, answered, completed).

**Request** (Twilio webhook payload):
```json
{
  "CallSid": "CA...",
  "CallStatus": "completed",
  "CallDuration": "45"
}
```

---

### POST `/recording`

**Public** - Recording completed webhook.

Called by Twilio when call recording is ready.

**Request** (Twilio webhook payload):
```json
{
  "CallSid": "CA...",
  "RecordingUrl": "https://api.twilio.com/...",
  "RecordingDuration": "45"
}
```

---

### POST `/transcription`

**Public** - Transcription completed webhook (Twilio Intelligence).

Called by Twilio when transcription is ready.

**Request** (Twilio webhook payload):
```json
{
  "CallSid": "CA...",
  "TranscriptionText": "...",
  "TranscriptionUrl": "https://api.twilio.com/..."
}
```

---

### POST `/attribution`

**Public** - Website attribution tracking endpoint.

Called by the tracking script on client websites to store visitor attribution data.

**Request:**
```json
{
  "clientId": "uuid",
  "sessionId": "uuid",
  "gclid": "Cj0KCQiA...",
  "fbclid": "IwAR3...",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "brand",
  "landing_page": "https://example.com/services",
  "referrer": "https://google.com",
  "event": "phone_click",
  "phone": "+15551234567"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid"
}
```

---

## Twilio Management Routes (`/api/hub/twilio`)

Admin endpoints for managing Twilio configuration and tracking numbers. All require admin authentication.

### GET `/config`

Get Twilio configuration status for a client.

**Query Parameters:**
- `clientId` (optional) - Client UUID (admin viewing another client)

**Response:**
```json
{
  "configured": true,
  "isActive": true,
  "accountSidLast4": "1234",
  "numberCount": 3
}
```

---

### POST `/config`

Save Twilio credentials for a client.

**Request:**
```json
{
  "clientId": "uuid",
  "accountSid": "AC...",
  "authToken": "...",
  "twimlAppSid": "AP...",
  "webhookSecret": "..."
}
```

**Response:**
```json
{
  "success": true,
  "configId": "uuid"
}
```

---

### POST `/switch-provider`

Switch call tracking provider for a client.

**Request:**
```json
{
  "clientId": "uuid",
  "provider": "twilio"
}
```

**Response:**
```json
{
  "success": true,
  "provider": "twilio"
}
```

---

### GET `/numbers`

List tracking numbers for a client.

**Query Parameters:**
- `clientId` (optional) - Client UUID
- `includeInactive` (optional) - Include inactive numbers

**Response:**
```json
{
  "numbers": [
    {
      "id": "uuid",
      "phoneNumber": "+15551234567",
      "friendlyName": "Google Ads - Main",
      "forwardToNumber": "+15559876543",
      "sourceType": "google_ads",
      "campaignName": "brand",
      "recordingEnabled": true,
      "transcriptionEnabled": true,
      "isActive": true
    }
  ]
}
```

---

### POST `/numbers/purchase`

Purchase a new tracking number.

**Request:**
```json
{
  "clientId": "uuid",
  "areaCode": "555",
  "contains": "",
  "friendlyName": "Google Ads - Main",
  "forwardTo": "+15559876543",
  "sourceType": "google_ads",
  "campaignName": "brand"
}
```

**Response:**
```json
{
  "success": true,
  "number": {
    "id": "uuid",
    "phoneNumber": "+15551234567",
    "friendlyName": "Google Ads - Main"
  }
}
```

---

### PUT `/numbers/:id`

Update a tracking number's configuration.

**Request:**
```json
{
  "friendlyName": "New Name",
  "forwardToNumber": "+15551111111",
  "recordingEnabled": false
}
```

**Response:**
```json
{
  "success": true,
  "number": { ... }
}
```

---

### DELETE `/numbers/:id`

Release a tracking number back to Twilio.

**Response:**
```json
{
  "success": true
}
```

---

### GET `/tracking-script`

Get the tracking script code for a client.

**Query Parameters:**
- `clientId` (optional) - Client UUID

**Response:**
```json
{
  "script": "<!-- Anchor Universal Tracking -->\\n<script src=..."
}
```

---

## CTM Forms — Submission Outcome, reCAPTCHA Policy & Retry (`/api/ctm-forms`)

The active forms system. The embedded-form reliability model below ensures real leads are
never silently buried as spam and that transient CTM outages don't strand them.

### Submission triage model

Every submission carries:
- `status` — `received` (clean) · `review` (accepted but flagged for a human) · `held`
  (spam-held, not forwarded) · `released` (was held, then released by staff).
- `block_reason` — granular cause when `review`/`held`: `recaptcha_missing_token`,
  `recaptcha_low_score`, `recaptcha_invalid_token`, `recaptcha_action_mismatch`,
  `recaptcha_service_unavailable`, `recaptcha_failed`, `ai_spam`, `heuristic_spam`.

### reCAPTCHA policy (per-form `config_json.settings.recaptcha_mode`)

A missing reCAPTCHA token is **not** proof of a bot (privacy browsers, blockers, CSP,
corporate networks, and reCAPTCHA outages all suppress it for real people). The policy
separates a *soft* no-proof failure from a *hard* positive bot signal (low score / invalid
token):

| mode | soft (missing / unavailable) | hard (low score / invalid) |
|------|------------------------------|----------------------------|
| `observe_only` | continue | continue |
| `review_missing_token` (**default**) | accept + flag `review` (forwarded) | hold |
| `block_low_score` | continue | hold |
| `strict_block` | hold | hold |

### Per-form settings (`config_json.settings`)

- `recaptcha_mode` — one of the modes above.
- `require_phone_for_ctm` (default `true`) — when `false`, email-only leads are accepted +
  notified, but not forwarded to CTM (CTM's formreactor requires a phone).

### Endpoints

- `POST /api/ctm-forms/submissions/:id/release` (staff) — mark a held submission legitimate:
  clears the hold, forwards to CTM (queues a retry on transient failure), and sends the team
  notification it never got while held. Returns `{ success, ctmForwarded, ctmError }`.
- `GET /api/ctm-forms/:id/health` (staff) — CTM configuration health: `{ published,
  embedToken, hasReactor, reactorId, credentialsOk, ctmAccountNumber, lastCtmSentAt,
  lastCtmError, ctmFailed, pendingRetries }`.
- `GET /api/ctm-forms/:id/analytics` (staff) — now also returns `blockReasons` (held-reason
  breakdown), `funnel` (client-side loaded→clicked→sent→accepted counts), and held/review/
  visitor_sid counts in `summary`.
- `POST /api/ctm-forms/embed/:token/funnel` (public) — lightweight, non-PII funnel telemetry
  from the embed widget. Allowlisted events only; returns `204`.

### Retry queue

CTM forwarding failures enqueue a job in `ctm_form_submission_jobs`; a cron (`*/2 * * * *`)
retries with exponential backoff (cap 60 min, max 5 attempts). Held submissions are never
auto-forwarded — they must be released first.

---

## Forms Routes (`/api/forms`)

Form management and submission endpoints.

### GET `/`

List forms for a client.

**Query Parameters:**
- `clientId` (optional) - Client UUID (admin viewing another client)
- `status` (optional) - Filter by status: `draft`, `published`, `archived`

**Response:**
```json
{
  "forms": [
    {
      "id": "uuid",
      "name": "Contact Form",
      "description": "Main website contact form",
      "formType": "conversion",
      "status": "published",
      "embedToken": "abc123",
      "submissionCount": 42,
      "createdAt": "2026-01-15T..."
    }
  ]
}
```

---

### POST `/`

Create a new form.

**Request:**
```json
{
  "clientId": "uuid",
  "name": "Contact Form",
  "description": "Main website contact form",
  "formType": "conversion",
  "presetId": "uuid",
  "schemaJson": { ... },
  "settings": { ... }
}
```

**Response:**
```json
{
  "form": {
    "id": "uuid",
    "name": "Contact Form",
    "embedToken": "abc123"
  }
}
```

---

### GET `/:id`

Get form details.

**Response:**
```json
{
  "form": {
    "id": "uuid",
    "name": "Contact Form",
    "description": "...",
    "formType": "conversion",
    "status": "published",
    "embedToken": "abc123",
    "settingsJson": { ... },
    "currentVersion": {
      "version": 2,
      "schemaJson": { ... },
      "reactCode": "...",
      "cssCode": "..."
    }
  }
}
```

---

### PUT `/:id`

Update form details.

**Request:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "settings_json": { ... }
}
```

**Response:**
```json
{
  "form": { ... }
}
```

---

### DELETE `/:id`

Archive a form.

**Response:**
```json
{
  "success": true
}
```

---

### POST `/:id/publish`

Publish a new form version.

**Request:**
```json
{
  "schemaJson": { ... },
  "reactCode": "...",
  "cssCode": "..."
}
```

**Response:**
```json
{
  "success": true,
  "version": 3
}
```

---

### GET `/:id/versions`

Get form version history.

**Response:**
```json
{
  "versions": [
    {
      "version": 2,
      "publishedAt": "2026-01-20T...",
      "publishedBy": "uuid"
    }
  ]
}
```

---

### GET `/:id/submissions`

List submissions for a form.

**Query Parameters:**
- `limit` (optional) - Max results (default 50)
- `offset` (optional) - Pagination offset
- `dateFrom` (optional) - Filter by date
- `dateTo` (optional) - Filter by date

**Response:**
```json
{
  "submissions": [
    {
      "id": "uuid",
      "payloadJson": { "name": "John", "email": "john@example.com" },
      "attributionJson": { "utm_source": "google" },
      "createdAt": "2026-01-25T..."
    }
  ]
}
```

---

### GET `/submissions/:id`

Get submission detail (includes decrypted PHI for authorized users).

**Response:**
```json
{
  "submission": {
    "id": "uuid",
    "formId": "uuid",
    "formName": "Patient Intake",
    "payloadJson": { ... },
    "decryptedPayload": { ... },
    "attributionJson": { ... },
    "createdAt": "2026-01-25T..."
  }
}
```

---

### GET `/presets`

List all form presets.

**Query Parameters:**
- `category` (optional) - Filter by category
- `formType` (optional) - Filter by form type

**Response:**
```json
{
  "presets": [
    {
      "id": "uuid",
      "name": "Contact Form",
      "description": "Basic contact form",
      "category": "contact",
      "formType": "conversion",
      "isSystem": true
    }
  ]
}
```

---

### POST `/presets`

Create a new form preset (admin only).

**Request:**
```json
{
  "name": "Custom Intake",
  "description": "Custom patient intake form",
  "category": "intake",
  "formType": "intake",
  "schemaJson": { ... },
  "reactCode": "...",
  "cssCode": "..."
}
```

**Response:**
```json
{
  "preset": {
    "id": "uuid",
    "name": "Custom Intake"
  }
}
```

---

### PUT `/presets/:id`

Update a form preset (admin only, non-system presets).

**Request:**
```json
{
  "name": "Updated Name",
  "schemaJson": { ... }
}
```

**Response:**
```json
{
  "preset": { ... }
}
```

---

### DELETE `/presets/:id`

Delete a form preset (admin only, non-system presets).

**Response:**
```json
{
  "success": true
}
```

---

### GET `/embed/:token`

**Public** - Get embeddable form data.

**Response:**
```json
{
  "formId": "uuid",
  "formName": "Contact Form",
  "formType": "conversion",
  "clientId": "uuid",
  "schema": { ... },
  "css": "..."
}
```

---

### POST `/embed/:token`

**Public** - Submit form data.

**Request:**
```json
{
  "fields": {
    "name": "John",
    "email": "john@example.com",
    "message": "Hello..."
  },
  "attribution": {
    "gclid": "Cj0KCQ...",
    "utm_source": "google"
  },
  "sessionId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "submissionId": "uuid"
}
```

---

## Tracking Provisioning Routes (`/api/hub/tracking`)

Tracking provisioning for GTM, GA4, and Meta CAPI. All endpoints require admin authentication (`requireAuth` + `isAdmin`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hub/tracking/templates/list` | List available GTM templates |
| GET | `/api/hub/tracking/:userId` | Get tracking config for a client |
| POST | `/api/hub/tracking` | Create tracking config |
| PUT | `/api/hub/tracking/:id` | Update tracking config |
| POST | `/api/hub/tracking/:id/provision` | Run GTM provisioning (creates workspace, tags, triggers, variables, version) |
| POST | `/api/hub/tracking/:id/publish` | Publish GTM container version |
| GET | `/api/hub/tracking/:id/jobs` | Get provisioning job history (last 20) |
| GET | `/api/hub/tracking/:id/events` | Get event relay log (paginated, max 200) |
| POST | `/api/hub/tracking/:id/relay-toggle` | Enable/disable event relay |

---

### Meta Campaign Allowlist

Per-client allowlist of Meta Ads campaigns. Each campaign can be claimed by at most one client (enforced by `UNIQUE(platform, ad_account_id, campaign_id)` on `tracking_campaign_claims`). The analytics pipeline filters Meta data per-client by claim; zero claims ⇒ empty Meta block. All endpoints require admin auth.

#### `GET /api/hub/tracking/:userId/meta-campaigns`

List campaigns on the client's configured Meta ad account, annotated with claim state across all clients sharing the account.

**Query params:**
- `status` — comma-separated values from `active, paused, archived, deleted, in_process, with_issues`, or the keyword `all`. Default: `active,paused`.

**Response 200:**
```json
{
  "ad_account_id": "act_2851894194985503",
  "campaigns": [
    {
      "id": "120241241212810780",
      "name": "ANC_ADCAnthem_Meta_Social_...",
      "status": "ACTIVE",
      "objective": "OUTCOME_AWARENESS",
      "start_time": "2026-03-01T00:00:00-0400",
      "stop_time": null,
      "spend_last_30d": 432.10,
      "claimed_by": {
        "user_id": "uuid",
        "name": "Anthem Dentistry",
        "is_current_client": true
      }
    }
  ]
}
```

**Errors:** 400 `no_meta_ad_account_configured`, 400 `invalid_status`, 500 `fetch_failed`, 500 `meta_token_not_configured`.

#### `POST /api/hub/tracking/:userId/meta-campaigns/claims`

Claim a campaign for the given client.

**Body:** `{ "campaign_id": "...", "campaign_name": "..." }`

**Responses:**
- `201` `{ claim: {...} }` — new claim created
- `200` `{ claim: {...} }` — same user already owned this campaign (idempotent)
- `409` `{ error: "campaign_already_claimed", claimed_by: { user_id, name } }` — another client owns it
- `400` `{ error: "missing_campaign_id" }` / `"no_meta_ad_account_configured"`
- `500` `{ error: "claim_failed" }`

Emits `campaign_claim_created` (success) or `campaign_claim_denied` (409, success=false) audit events.

#### `DELETE /api/hub/tracking/:userId/meta-campaigns/claims/:campaignId`

Release a claim. Always returns `204` regardless of whether the claim existed (idempotent).

Emits `campaign_claim_deleted` audit event.

#### Account change side effect

When `PUT /api/hub/tracking/:id` changes `meta_ad_account_id` to a different value, all existing Meta claims for that user tied to the OLD account are deleted. The config update and claim cleanup run inside a single DB transaction — either both succeed or both roll back. The `campaign_claims_cleared` audit event is emitted after commit succeeds and includes the removal count.

---

## Reports Routes (`/api/reports`)

Report Builder — Phase 1. All endpoints require `requireAuth + isStaff` middleware (admin/team/superadmin only; no client access).

### Non-obvious behavior

- **Filter inheritance**: When a generation runs, filters are resolved in this order of precedence — generation-level filters override template `filters_default`, which override any per-widget defaults. The merged filter set is stored on the `report_generations` row.
- **Per-run widget data cache**: All widget data is fetched once per generation and stored in `hydrated_payload` (JSONB) for the duration of the render. The cache is not reused across generations.
- **Lazy Puppeteer import**: `pdfRenderer` is imported lazily on first use. The dev server can boot and serve all report endpoints without Chromium launching until the first `POST /api/reports/generations` is processed.

---

### Templates

#### `GET /api/reports/templates`

List all report templates visible to the authenticated user.

**Query Parameters:**
- `includeArchived` (optional) — set to `true` to include soft-deleted templates

**Response 200:**
```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "Monthly Performance Report",
      "description": "GA4 + Ads KPIs for the prior month",
      "is_archived": false,
      "default_client_id": "uuid | null",
      "schedule": { "frequency": "monthly", "day": 1 },
      "version": 3,
      "created_by": "uuid",
      "created_at": "2026-04-01T00:00:00Z",
      "updated_at": "2026-04-28T12:00:00Z"
    }
  ]
}
```

---

#### `GET /api/reports/templates/:id`

Get a single report template.

**Response 200:**
```json
{
  "template": {
    "id": "uuid",
    "name": "Monthly Performance Report",
    "description": "...",
    "layout": { "pages": [ { "widgets": [ { "type": "kpi", "metric": "sessions" } ] } ] },
    "filters_default": { "date_range": "last_30_days" },
    "default_client_id": "uuid | null",
    "schedule": { "frequency": "monthly", "day": 1 },
    "is_archived": false,
    "version": 3,
    "created_by": "uuid",
    "created_at": "2026-04-01T00:00:00Z",
    "updated_at": "2026-04-28T12:00:00Z"
  }
}
```

**Errors:** 404 if template not found.

---

#### `POST /api/reports/templates`

Create a new report template.

**Request:**
```json
{
  "name": "Monthly Performance Report",
  "description": "GA4 + Ads KPIs for the prior month",
  "layout": { "pages": [ { "widgets": [ { "type": "kpi", "metric": "sessions" } ] } ] },
  "filters_default": { "date_range": "last_30_days" },
  "default_client_id": "uuid | null",
  "schedule": { "frequency": "monthly", "day": 1 }
}
```

**Response 201:**
```json
{
  "template": { "id": "uuid", "version": 1, ... }
}
```

---

#### `PATCH /api/reports/templates/:id`

Update an existing template. Any subset of allowed fields may be provided: `name`, `description`, `is_archived`, `default_client_id`, `layout`, `filters_default`, `schedule`.

Changes to `layout` or `filters_default` automatically snapshot a new version row in `report_template_versions` before applying the update. The template's `version` counter is incremented.

**Request:**
```json
{
  "name": "Updated Report Name",
  "layout": { "pages": [ ... ] }
}
```

**Response 200:**
```json
{
  "template": { "id": "uuid", "version": 4, ... }
}
```

**Errors:** 404 if template not found.

---

#### `DELETE /api/reports/templates/:id`

Soft-delete (archive) a template. Sets `is_archived = true`; the template remains queryable with `?includeArchived=true`. No data is destroyed.

**Response 204** (no body).

**Errors:** 404 if template not found.

---

#### `POST /api/reports/templates/:id/duplicate`

Clone a template. The new template gets `"(Copy)"` appended to its name, resets `version` to 1, and copies the current `layout`, `filters_default`, `schedule`, and `default_client_id`.

**Response 201:**
```json
{
  "template": { "id": "uuid-new", "name": "Monthly Performance Report (Copy)", "version": 1, ... }
}
```

**Errors:** 404 if source template not found.

---

#### `GET /api/reports/templates/:id/versions`

List the version history for a template. Returns newest-first.

**Response 200:**
```json
{
  "versions": [
    {
      "version": 3,
      "layout": { ... },
      "filters_default": { ... },
      "created_by": "uuid",
      "created_at": "2026-04-20T00:00:00Z"
    }
  ]
}
```

**Errors:** 404 if template not found.

---

#### `GET /api/reports/templates/:id/versions/:version`

Get a single version snapshot.

**Response 200:**
```json
{
  "version": {
    "version": 2,
    "layout": { ... },
    "filters_default": { ... },
    "created_by": "uuid",
    "created_at": "2026-04-15T00:00:00Z"
  }
}
```

**Errors:** 404 if template or version not found.

---

### Generations

#### `POST /api/reports/generations`

Queue a new report generation. The generation is created with `status: 'pending'` and processed asynchronously. The `hydrated_payload` (containing PHI for the duration of the render) is never returned by the API — it exists only to drive the PDF render pipeline.

**Request:**
```json
{
  "template_id": "uuid",
  "client_ids": ["uuid-1", "uuid-2"],
  "filters": { "date_range": "last_30_days", "compare_period": "prior_period" }
}
```

**Response 202:**
```json
{
  "id": "uuid",
  "status": "pending"
}
```

**Errors:** 400 if `template_id` or `client_ids` is missing/invalid; 404 if template not found.

---

#### `GET /api/reports/generations`

List report generations. Excludes `hydrated_payload` (PHI) from all rows.

**Query Parameters:**
- `template_id` (optional) — filter by template UUID
- `limit` (optional) — max rows to return (default: 20)

**Response 200:**
```json
{
  "generations": [
    {
      "id": "uuid",
      "template_id": "uuid",
      "client_ids": ["uuid-1"],
      "filters": { "date_range": "last_30_days" },
      "status": "complete",
      "generation_source": "manual",
      "generated_by": "uuid",
      "generated_at": "2026-04-28T10:00:00Z",
      "completed_at": "2026-04-28T10:01:05Z",
      "pdf_file_id": "uuid"
    }
  ]
}
```

---

#### `GET /api/reports/generations/:id`

Get the status of a single generation. `hydrated_payload` is always excluded from the response.

**Response 200:**
```json
{
  "generation": {
    "id": "uuid",
    "template_id": "uuid",
    "client_ids": ["uuid-1"],
    "filters": { "date_range": "last_30_days" },
    "status": "complete",
    "generation_source": "manual",
    "generated_by": "uuid",
    "generated_at": "2026-04-28T10:00:00Z",
    "completed_at": "2026-04-28T10:01:05Z",
    "pdf_file_id": "uuid"
  }
}
```

**Possible `status` values:** `pending`, `running`, `complete`, `failed`.

**Errors:** 404 if generation not found.

---

#### `GET /api/reports/generations/:id/download`

Stream the rendered PDF as binary bytes. Requires the generation to be in `complete` status with a valid `pdf_file_id`.

**Response 200:**
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="report-<id>.pdf"`
- Body: raw PDF bytes (sourced from the `file_uploads` table)

**Errors:** 404 if generation not found; 409 if status is not `complete`; 500 if the PDF file is missing.

---

### AI Web Reports (`/api/reports/ai-templates`, `/api/reports/runs`, etc.)

The AI web-report engine generates per-client immutable HTML report snapshots driven by approved AI template versions. Reports surface in each client's Documents tab and render via `/portal/reports/:itemId`.

All endpoints below require `requireAuth + isStaff` **except** `/api/reports/portal/items/:id`, which only requires `requireAuth` (clients view their own snapshots).

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/reports/ai-templates` | List AI templates (`?archived=1` to include archived). |
| `GET`  | `/api/reports/ai-templates/:id` | Get one template. |
| `POST` | `/api/reports/ai-templates` | Create a draft (`{name, description?, prompt?, dataScope?, styleRecipe?, defaultClientId?}`). |
| `PATCH`| `/api/reports/ai-templates/:id` | Update draft (any of: `name, description, prompt, dataScope, styleRecipe, defaultClientId, schedule`). |
| `POST` | `/api/reports/ai-templates/:id/test-run` | Run the draft against one client (`{clientId, dateRange:{from,to}}`). Returns the run; poll for completion. Test runs do NOT publish to Documents. |
| `POST` | `/api/reports/ai-templates/:id/approve` | Snapshot the current draft as a new approved version. Sets `approved_version_id` and `status='approved'`. |
| `POST` | `/api/reports/runs` | Start a manual run (`{templateId, audienceFilter, dateRange:{from,to}}`). Requires `approved_version_id`. Returns 202 + the run. |
| `GET`  | `/api/reports/runs/:id` | Run header + per-client items. |
| `GET`  | `/api/reports/run-items/:id` | Single item, including the `rendered_payload` snapshot. |
| `GET`  | `/api/reports/client/:clientId/items` | List a client's completed report items (admin). |
| `GET`  | `/api/reports/portal/items/:id` | Client-facing snapshot fetch. Requires the requesting user own the item (matches `req.portalUserId`) or be staff. Returns 409 if `status !== 'complete'`. |

**Audience filter** shapes (used in `POST /runs` and `report_templates.schedule.audience_filter`):
- `{mode: 'all'}` — all client-role users (excludes demos by default).
- `{mode: 'package', client_package: 'Growth Essentials'}` — filter by `client_profiles.client_package`.
- `{mode: 'manual', client_ids: [...]}` — explicit list of user UUIDs.

**Scheduled runs:** Set `schedule: {freq, hour, day_of_month?, day_of_week?, audience_filter?, date_range?}` on an approved template. The cron at `server/index.js` ticks `tickScheduler()` every 15 minutes; AI templates are routed through `aiRunExecutor.startRun({source:'scheduled'})`. Default `date_range` is the previous calendar month.

**Output snapshot** (`report_run_items.rendered_payload`) is a frozen JSON document of:
```jsonc
{
  "schema_version": 1,
  "title": "April 2026 Executive Report",
  "summary": "...",
  "period": { "from": "...", "to": "...", "comparison_from": "...", "comparison_to": "..." },
  "client": { "id": "...", "business_name": "...", ... },
  "sections": [
    { "type": "kpi_grid", "title": "...", "items": [...] },
    { "type": "chart",    "title": "...", "chart_type": "bar|line|donut|area", "data": [...] },
    { "type": "narrative","title": "...", "markdown": "..." },
    { "type": "table",    "title": "...", "columns": [...], "rows": [[...]] },
    { "type": "callout",  "tone": "info|success|warning", "body": "..." }
  ]
}
```

**HIPAA:** `dataPackage.js` is the single boundary that decides what data the AI sees. It excludes individual lead rows and redacts review reviewer names. For medical clients (`client_type='medical'`), per-lead PHI must never enter the snapshot.

---

## /api/ops/skills — Skills CRUD + Versions + Suggestions

All routes require `requireAuth + requireAdmin`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ops/skills` | List all skills; optional `?umbrella=` filter |
| `GET` | `/api/ops/skills/:id` | Get a single skill by ID |
| `GET` | `/api/ops/skills/:id/versions` | List all versions for a skill |
| `POST` | `/api/ops/skills` | Create a new skill (`slug`, `umbrella`, `title`, `prompt_md` required) |
| `PUT` | `/api/ops/skills/:id` | Save a new version of a skill (`prompt_md`, `collectors`, optional `edit_reason`) |
| `DELETE` | `/api/ops/skills/:id` | Archive a skill (soft delete) |
| `GET` | `/api/ops/skills/:id/suggestions` | List pending suggestions for a skill |
| `POST` | `/api/ops/skills/:id/suggestions/:sid/approve` | Approve a suggestion (optional `note`) |
| `POST` | `/api/ops/skills/:id/suggestions/:sid/reject` | Reject a suggestion (optional `note`) |

---

## Social Publishing (`/api/social`)

Internal Facebook Page + Instagram Business publishing workflow. All routes require `requireAuth + isStaff` **except** `GET /api/social/media/:token`, which is a public HMAC-signed media URL fetched by Meta's servers at publish time.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/social/media/:token` | Public (HMAC) | Streams a stored image to Meta's servers. Used internally by the publisher when resolving upload-source media. 403 on invalid/expired/revoked token. 404 if file deleted. |
| `GET` | `/api/social/pages` | Staff | Lists Facebook Pages accessible via the system user token, with linked Instagram account if present. Returns `[{ fbPageId, fbPageName, fbPageToken, igUserId, igUsername, picture }]`. |
| `GET` | `/api/social/links` | Staff | All non-archived `meta_page_links` joined with `users` for client name/email. |
| `POST` | `/api/social/links` | Staff | Body: `{ clientId, fbPageId }`. Links a client to a FB Page (and its IG if available). Encrypts and stores the page-specific access token. Audited as `social.link_create`. |
| `PATCH` | `/api/social/links/:id` | Staff | Body: `{ scheduling_enabled: boolean }`. 400 if not a boolean. 404 if link missing. Audited as `social.link_update`. |
| `DELETE` | `/api/social/links/:id` | Staff | Sets `archived_at`. Audited as `social.link_archive`. |
| `POST` | `/api/social/links/:id/health-check` | Staff | Calls Graph API to verify the page is still accessible. Updates `last_health_*` columns. Returns `{ ok, status?, error? }`. |
| `POST` | `/api/social/media` | Staff | Multipart upload (field name `file`, max 30 MB). Stores in `file_uploads` with `category='social'`. Returns `{ fileUploadId }`. Public URL is NOT returned — the publisher generates a tokenized URL at publish time. |
| `GET` | `/api/social/posts` | Staff | Query: `clientId`, `status`, `from`, `to`. Returns up to 500 posts ordered by `COALESCE(scheduled_for, published_at, created_at) DESC`. |
| `POST` | `/api/social/posts` | Staff | Body: `{ clientId, pageLinkId, platforms[], content, linkUrl?, media[], scheduledFor?, action, idempotencyKey }`. `action` is `draft \| schedule \| publish_now`. Idempotency key (also accepted as `Idempotency-Key` header) prevents double-submit. `publish_now` blocks until the dispatch completes. Audited as `social.post_<action>`. |
| `POST` | `/api/social/posts/:id/cancel` | Staff | Transitions `scheduled`, `draft`, `failed` → `cancelled`. Returns 409 if not in a cancellable state. Audited as `social.post_cancel`. |

**Post lifecycle states:**
- `draft` — saved without scheduling
- `scheduled` — awaiting cron pickup
- `publishing` — claimed by a worker
- `published` — all platforms succeeded
- `partially_published` — at least one platform succeeded, at least one failed
- `failed` — all attempted platforms failed (retried up to 3× with 15-min cooldown)
- `cancelled` — staff cancelled before publish

See [INTEGRATIONS.md](INTEGRATIONS.md#social-publishing-facebook--instagram) for auth model, cron mechanics, and env vars.

---

## Portal Updates Routes (`/api/portal-updates`)

Agency announcements shown as a dismissible banner at the top of the client portal. Broadcast to all client users; dismissal is per user account and permanent.

**Client-facing** (`requireAuth`):

- `GET /api/portal-updates` — published updates the current user hasn't dismissed, newest first. Returns `{ updates: [{ id, type, title, body, link_url, published_at }] }`.
- `POST /api/portal-updates/:id/dismiss` — dismiss for the current user (idempotent). Returns `{ ok: true }`.

**Admin authoring** (`requireAuth` + `requireAdmin`):

- `GET /api/portal-updates/admin` — all updates (any status) with `dismiss_count`.
- `POST /api/portal-updates/admin` — create. Body: `type` (`feature|improvement|notice|maintenance`), `title` (≤200, required), `body` (≤2000), `link_url` (http/https, ≤500), `status` (`draft|published|archived`, default `draft`). Returns `{ update }`.
- `PUT /api/portal-updates/admin/:id` — partial update; setting `status='published'` stamps `published_at`. Returns `{ update }`.
- `DELETE /api/portal-updates/admin/:id` — hard delete (cascades dismissals).

---

## Health Checks (`/api/system-health`) — superadmin only

Active probes of production agents and integrations (AI lead classification, Ops supervisor Vertex runtime, Google Ads, Meta, CTM, Mailgun, GA4). Each probe uses synthetic data only — no PHI is stored. (Distinct from the public `GET /api/health` liveness probe.)

- `POST /api/system-health/run` — run all production health checks now; returns `{ run_id, results, failing }`. Does not email (manual runs are interactive).
- `GET /api/system-health/latest` — most recent run's results grouped by `run_id`. Returns `{ run_id, results }`.

Backed by the `system_health_checks` table (30-day retention). The daily 8am (ET) cron runs the same checks and emails super-admins only when a check is not OK; a green sweep is silent.

---

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [DATA_FLOWS.md](DATA_FLOWS.md) - Business workflows
- [SECURITY.md](SECURITY.md) - Authentication details
- [INTEGRATIONS.md](INTEGRATIONS.md) - Third-party services
- [SKILLS.md](../SKILLS.md) - Database schema

---

*Last updated: June 2026*

