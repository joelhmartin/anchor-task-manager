# Tracking Provisioning System — Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Author:** Joel Martin + Claude

---

## 1. Overview

An internal tracking provisioning system inside the Anchor Client Dashboard admin portal. Staff users open a client's profile in AdminHub, fill out a structured tracking setup form, run a deterministic provisioning workflow, and receive a single GTM install snippet for the client's WordPress site.

The system supports both medical (HIPAA-sensitive) and non-medical clients. Medical clients get strict allowlist-based field scrubbing on all server-side conversion events. Non-medical clients use a more permissive blocklist model.

### What This Replaces

Currently, staff manually installs separate GA4, Google Ads, and Meta Pixel scripts on each client's WordPress site. This system replaces that with a single GTM snippet per client, configured programmatically through the dashboard.

### What This Does NOT Include (v1)

- No server-side GTM (sGTM) infrastructure — the dashboard backend IS the server-side relay
- No per-client Cloud Run deployments
- No first-party tagging subdomains
- No automated GTM container creation — staff creates containers manually in Google, enters the ID in the form
- No AI-driven provisioning decisions — all logic is deterministic and template-based

---

## 2. Architecture

Three components, all inside the existing monolith (Express backend + React frontend on Cloud Run):

```
┌─────────────────────────────────────────────────────┐
│  Admin Portal (React)                                │
│  ┌───────────────────────────────────────────────┐  │
│  │  AdminHub → Tracking Tab (per client)          │  │
│  │  • Setup form (enter IDs/config)               │  │
│  │  • Provisioning status + step progress         │  │
│  │  • GTM snippet output + copy button            │  │
│  │  • Event relay policy settings                 │  │
│  │  • Event relay log                             │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │ /api/hub/tracking/*
┌──────────────────────▼──────────────────────────────┐
│  Express Backend (existing Cloud Run)                │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Provisioning     │  │ Event Relay Service       │  │
│  │ Service          │  │                           │  │
│  │ • GTM API calls  │  │ • Hooks into existing     │  │
│  │ • Apply templates│  │   form + call flows       │  │
│  │ • Save config    │  │ • Applies policy (med/    │  │
│  │ • Return snippet │  │   non-med scrubbing)      │  │
│  │                  │  │ • Forwards to GA4 MP +    │  │
│  └────────┬─────────┘  │   Meta CAPI + Google Ads  │  │
│           │             └────────────┬──────────────┘  │
│  ┌────────▼─────────────────────────▼───────────┐   │
│  │  PostgreSQL (existing)                        │   │
│  │  • tracking_configs                           │   │
│  │  • tracking_provisioning_jobs                 │   │
│  │  • tracking_event_log                         │   │
│  │  • tracking_templates                         │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
  Google Tag Manager API     GA4 Measurement Protocol
  (configure tags/triggers/  Meta Conversions API
   variables, publish)       Google Ads Offline Conv.
```

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| GCP project | Existing `anchor-hub-480305` | No new infrastructure |
| Google API auth | Service account | Machine-to-machine, no token refresh |
| GTM account structure | One agency account, one container per client | Standard agency pattern |
| Server-side events | Event relay from Express backend | Dashboard IS the server side; no sGTM needed |
| GTM container creation | Hybrid — staff creates manually, enters ID | Ships faster; tag configuration is the automated part |
| UI location | Tab inside AdminHub per client | Per-client config belongs in client context |
| Provisioning vs relay | Separate concerns | Provisioning = setup time. Relay = runtime. Different code paths. |

### External Account Structure (Pre-existing)

- **One GA4 account** → one property per client (already exists)
- **One Google Ads MCC** → client accounts underneath (already exists)
- **One Meta Business Manager** → multiple accounts/pixels (already exists)
- **One GTM account** (agency-level, to be created once) → one container per client

---

## 3. Data Model

Four new tables following existing patterns (UUID PKs, JSONB, timestamps).

### 3.1 `tracking_configs`

One row per client. Source of truth for a client's tracking setup.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| user_id | UUID FK → users | The client this config belongs to |
| client_type | TEXT NOT NULL | `medical` or `non_medical` |
| website_domain | TEXT NOT NULL | Primary website URL |
| gtm_account_id | TEXT | Agency GTM account ID |
| gtm_container_id | TEXT | GTM container ID (staff enters) |
| gtm_container_public_id | TEXT | `GTM-XXXXXX` for the snippet |
| gtm_workspace_id | TEXT | Active workspace ID after provisioning |
| ga4_property_id | TEXT | GA4 property ID |
| ga4_measurement_id | TEXT | `G-XXXXXX` measurement ID |
| ga4_api_secret | TEXT (encrypted) | For Measurement Protocol |
| google_ads_customer_id | TEXT | Google Ads account ID |
| google_ads_conversion_id | TEXT | Conversion action ID |
| google_ads_conversion_label | TEXT | Conversion label |
| meta_pixel_id | TEXT | Meta Pixel ID |
| meta_capi_token | TEXT (encrypted) | Conversions API access token |
| meta_test_event_code | TEXT | For testing CAPI events |
| allowed_events | JSONB | Array of approved server-side event names |
| blocked_fields | JSONB | Non-medical blocklist (medical uses allowlist) |
| consent_defaults | JSONB | Default consent state config |
| browser_meta_pixel_enabled | BOOLEAN DEFAULT false | Whether Meta Pixel fires client-side |
| relay_enabled | BOOLEAN DEFAULT false | Whether event relay is active |
| provisioning_status | TEXT DEFAULT 'draft' | `draft`, `provisioned`, `published`, `error` |
| gtm_version_id | TEXT | Current published GTM version |
| install_snippet | TEXT | Generated GTM snippet HTML |
| config_metadata | JSONB | Overflow/future fields |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ DEFAULT NOW() | |
| provisioned_at | TIMESTAMPTZ | When GTM was last configured |
| published_at | TIMESTAMPTZ | When GTM was last published |

**Constraints:** UNIQUE on user_id (one config per client). Index on provisioning_status.

### 3.2 `tracking_provisioning_jobs`

Step-by-step audit of each provisioning run.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| tracking_config_id | UUID FK → tracking_configs | |
| triggered_by | UUID FK → users | Staff user who ran it |
| status | TEXT DEFAULT 'pending' | `pending`, `running`, `completed`, `failed` |
| steps | JSONB | Array of `{step, status, message, timestamp}` |
| error_message | TEXT | If failed |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |
| completed_at | TIMESTAMPTZ | |

**Index:** On tracking_config_id + created_at DESC for latest job lookup.

### 3.3 `tracking_event_log`

Audit trail for every server-side event the relay sends.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| tracking_config_id | UUID FK → tracking_configs | |
| event_name | TEXT NOT NULL | e.g. `lead_submitted` |
| destination | TEXT NOT NULL | `ga4`, `meta_capi`, `google_ads` |
| source_type | TEXT | `form_submission`, `call_log`, `journey` |
| source_id | UUID | FK to the source record |
| payload_sent | JSONB | What was actually sent (post-scrubbing) |
| response_status | INT | HTTP status from destination |
| response_body | TEXT | Response from destination |
| success | BOOLEAN | |
| retry_count | INT DEFAULT 0 | |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |

**Retention:** 30 days (same as activity logs). Cron job purges older rows.
**Index:** On tracking_config_id + created_at DESC. On success for failed event retry queries.

### 3.4 `tracking_templates`

Reusable GTM tag/trigger/variable definitions.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| name | TEXT NOT NULL | e.g. `standard_web_v1` |
| template_type | TEXT NOT NULL | `web_container` |
| description | TEXT | |
| tags | JSONB | Array of GTM tag definitions with `{{placeholders}}` |
| triggers | JSONB | Array of GTM trigger definitions |
| variables | JSONB | Array of GTM variable definitions |
| version | INT DEFAULT 1 | Template version number |
| is_active | BOOLEAN DEFAULT true | Current default template |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ DEFAULT NOW() | |

**Constraints:** UNIQUE on (name, version).

---

## 4. Admin Portal UI

### 4.1 Location

New **"Tracking"** tab inside AdminHub's client detail view, alongside existing tabs (Call Tracking, Forms, OAuth Integrations, etc.).

### 4.2 States

**Empty state:** Client has no tracking config → EmptyState component with "Set Up Tracking" button.

**Draft state:** Config saved but not provisioned → shows form with edit capability, "Provision GTM" button.

**Provisioned state:** GTM configured but not published → shows config (read-only), provisioning step log, "Publish" button, preview snippet.

**Published state:** Live → shows config, install snippet with copy button, event relay controls, event log.

**Error state:** Provisioning failed → shows error message, step log with failure point, "Retry" button.

### 4.3 Form Fields

**Client & Type Section:**
- Client type: `medical` / `non_medical` toggle (required)
- Website domain (required)

**GTM Section:**
- GTM account ID (required — agency's account, could be pre-filled)
- GTM container ID (required — staff creates in Google, enters here)

**GA4 Section:**
- GA4 property ID
- GA4 measurement ID (`G-XXXXXX`)
- GA4 API secret (masked input, for Measurement Protocol)

**Google Ads Section:**
- Customer ID
- Conversion ID
- Conversion label

**Meta Section:**
- Pixel ID
- CAPI access token (masked input)
- Test event code
- Browser-side Meta Pixel enabled (toggle)

**Event Policy Section:**
- Allowed conversion events (multi-select checkboxes):
  - `lead_submitted`
  - `qualified_call`
  - `new_client`
  - `appointment_request`
- For medical clients: info box explaining allowlist-only scrubbing (no editable blocked fields — it's all-or-nothing)
- For non-medical clients: optional blocked fields override

**Consent Section:**
- Consent defaults (JSON editor or structured fields, TBD in implementation)

### 4.4 Provisioning Controls

- **"Provision GTM"** button — calls provisioning service, shows step-by-step progress
- **"Publish"** button — publishes the GTM container version (separate from provisioning so staff can review first)
- **"Re-provision"** button — re-runs provisioning (for config changes)
- Step log shows: `create_workspace → apply_variables → apply_triggers → apply_tags → create_version` with status per step

### 4.5 Install Snippet Output

After provisioning, displays the GTM install snippet:

```html
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-XXXXXX');</script>
<!-- End Google Tag Manager -->

<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXX" ...></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
```

Copy-to-clipboard button. This is the ONLY thing that gets installed on WordPress.

### 4.6 Event Relay Section

- Relay enabled/disabled toggle
- Recent events table (DataTable) showing: event name, destination, success/fail, timestamp
- Expandable rows for payload and response details

---

## 5. Provisioning Service

### 5.1 Location

`server/services/trackingProvisioning.js`

### 5.2 Provisioning Sequence

When staff clicks "Provision GTM":

1. **Validate config** — all required IDs present, container ID valid
2. **Create workspace** — GTM API: create a workspace in the container (isolates changes from any live version)
3. **Apply variables** — Create GTM variables from template, substituting client-specific values (measurement ID, pixel ID, conversion IDs, etc.)
4. **Apply triggers** — Create GTM triggers from template (page view, click, scroll, form view — all browser-safe)
5. **Apply tags** — Create GTM tags from template:
   - GA4 Configuration tag (measurement ID)
   - Google Ads Remarketing tag (conversion ID)
   - Google Ads Conversion Tracking tag (conversion ID + label) — fires on browser-safe events only
   - Meta Pixel base code tag (pixel ID)
   - Consent initialization tag
6. **Create version** — GTM API: create a container version from the workspace
7. **Generate snippet** — Construct the GTM install snippet from the container's public ID
8. **Save results** — Update `tracking_configs` with workspace ID, version ID, snippet, status = `provisioned`
9. **Log job** — Record all steps in `tracking_provisioning_jobs`

Each step updates the job's `steps` JSONB array in real-time so the UI can show progress.

### 5.3 Publish (Separate Action)

When staff clicks "Publish":

1. Publish the version via GTM API
2. Update `tracking_configs`: status = `published`, published_at = now
3. Log the publish action

### 5.4 Re-provisioning

If config changes after initial provisioning:

1. Create a new workspace
2. Re-apply templates with updated values
3. Create new version
4. Staff reviews and publishes

### 5.5 GTM API Authentication

Uses the existing GCP service account (`anchor-client-hub@anchor-hub-480305.iam.gserviceaccount.com`). The service account needs to be added as a user on the agency's GTM account with "Publish" permission. This is a one-time manual setup.

### 5.6 Standard Web Container Template (v1)

The initial `tracking_templates` row for `standard_web_v1` defines:

**Variables:**
- `GA4 Measurement ID` → constant: `{{ga4_measurement_id}}`
- `Google Ads Conversion ID` → constant: `{{google_ads_conversion_id}}`
- `Google Ads Conversion Label` → constant: `{{google_ads_conversion_label}}`
- `Meta Pixel ID` → constant: `{{meta_pixel_id}}`

**Triggers:**
- `All Pages` → page view trigger (fires on all pages)
- `CTA Click` → click trigger on elements matching `.cta, [data-cta], a[href^="tel:"]`
- `Scroll Depth` → scroll trigger at 25%, 50%, 75%, 90%
- `Form Embed View` → element visibility trigger for embedded form containers

**Tags:**
- `GA4 Configuration` → GA4 config tag using measurement ID variable, fires on All Pages
- `Google Ads Remarketing` → remarketing tag using conversion ID, fires on All Pages
- `Meta Pixel - PageView` → custom HTML tag with Meta Pixel base code + `fbq('track', 'PageView')`, fires on All Pages (conditional on `browser_meta_pixel_enabled`)
- `Consent Initialization` → consent default tag based on consent_defaults config

All browser-safe. No conversion tags fire from the website. Conversions come from the event relay.

---

## 6. Event Relay Service

### 6.1 Location

`server/services/trackingRelay.js`

### 6.2 How It Triggers

The relay is called from existing code paths — not a separate server or webhook:

| Event Source | Trigger Point | Event Name |
|---|---|---|
| Form submission (conversion type) | After INSERT in ctmForms/forms routes | `lead_submitted` |
| Call completed + qualified | After call classification in CTM/Twilio processing | `qualified_call` |
| Journey stage → active client | After client_journeys status change | `new_client` |
| Appointment request form | After form submission with category=appointment | `appointment_request` |

### 6.3 Relay Flow

```
relayService.sendEvent(userId, eventName, sourceType, sourceId, eventData)
  │
  ├─ Look up tracking_configs WHERE user_id = userId
  ├─ Check: relay_enabled? Event in allowed_events?
  │    no → log skip, return
  │
  ├─ Apply scrubbing policy:
  │    medical → ALLOWLIST only (see §6.4)
  │    non_medical → BLOCKLIST (see §6.5)
  │
  ├─ Send to each configured destination (parallel):
  │    ├─ GA4 Measurement Protocol (if ga4_api_secret set)
  │    ├─ Meta CAPI (if meta_capi_token set)
  │    └─ Google Ads offline conversions (if google_ads configured)
  │
  └─ Log each attempt to tracking_event_log
       - retry on 5xx failures (up to 3 attempts, exponential backoff)
```

### 6.4 Medical Client Scrubbing (Allowlist)

For medical clients, ONLY these fields pass through. Everything else is dropped:

```javascript
const MEDICAL_ALLOWED_FIELDS = {
  event_name: true,
  event_time: true,
  event_source_url: true,  // sanitized to domain only, no path
  action_source: true,
  value: true,
  currency: true,
  event_id: true,          // dedup ID
};
```

If a field isn't on this list, it doesn't get sent. Period. New fields, mislabeled fields, unexpected form data — all silently dropped. Fail-safe by default.

### 6.5 Non-Medical Client Scrubbing (Blocklist)

More permissive. Allows hashed PII for Enhanced Conversions match quality:

```javascript
const NON_MEDICAL_BLOCKED_FIELDS = [
  'ssn', 'date_of_birth', 'dob', 'password'
];
```

Email and phone are SHA-256 hashed before sending (required format for GA4 Enhanced Conversions and Meta CAPI `user_data`).

### 6.6 Destination Payloads

**GA4 Measurement Protocol:**
```
POST https://www.google-analytics.com/mp/collect
  ?measurement_id={ga4_measurement_id}
  &api_secret={ga4_api_secret}

Body: {
  "client_id": generated_anonymous_id,
  "events": [{
    "name": "lead_submitted",
    "params": { "value": 1, "currency": "USD" }
  }]
}
```

**Meta Conversions API:**
```
POST https://graph.facebook.com/v18.0/{meta_pixel_id}/events
  ?access_token={meta_capi_token}

Body: {
  "data": [{
    "event_name": "Lead",
    "event_time": unix_timestamp,
    "event_source_url": "https://clientsite.com",
    "action_source": "website",
    "user_data": { ... },  // empty for medical, hashed for non-medical
    "custom_data": { "value": 1, "currency": "USD" }
  }],
  "test_event_code": "TEST12345"  // only in test mode
}
```

**Event name mapping** (internal → platform):

| Internal Event | GA4 Event | Meta Event |
|---|---|---|
| `lead_submitted` | `generate_lead` | `Lead` |
| `qualified_call` | `qualified_call` (custom) | `Lead` |
| `new_client` | `purchase` or `new_client` (custom) | `Purchase` |
| `appointment_request` | `appointment_request` (custom) | `Schedule` |

---

## 7. API Endpoints

All under `/api/hub/tracking/` in the existing hub routes file (or a new `server/routes/tracking.js` mounted at `/api/hub/tracking`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/hub/tracking/:userId` | Get tracking config for a client |
| POST | `/api/hub/tracking` | Create tracking config |
| PUT | `/api/hub/tracking/:id` | Update tracking config |
| POST | `/api/hub/tracking/:id/provision` | Run provisioning job |
| POST | `/api/hub/tracking/:id/publish` | Publish GTM version |
| GET | `/api/hub/tracking/:id/jobs` | Get provisioning job history |
| GET | `/api/hub/tracking/:id/events` | Get event relay log |
| POST | `/api/hub/tracking/:id/relay-toggle` | Enable/disable relay |
| GET | `/api/hub/tracking/templates` | List available templates |

All endpoints require auth + admin/superadmin role.

---

## 8. Environment Variables (New)

| Variable | Purpose |
|----------|---------|
| `GTM_ACCOUNT_ID` | Agency GTM account ID (pre-fill in form) |
| `GA4_ACCOUNT_ID` | Agency GA4 account ID (for API calls) |
| `META_BUSINESS_ID` | Business Manager ID (for CAPI) |

No new GCP credentials needed — the existing service account handles GTM API and GA4 Admin API auth.

---

## 9. File Structure (New Files)

```
server/
  routes/tracking.js              # API endpoints
  services/trackingProvisioning.js # GTM API provisioning logic
  services/trackingRelay.js        # Runtime event relay
  services/trackingTemplates.js    # Template loading + placeholder substitution
  sql/migrate_tracking.sql         # Database migration

src/
  views/admin/AdminHub/TrackingTab.jsx  # Main tracking tab component
  api/tracking.js                       # Frontend API client
  menu-items/  (update clientHub.js)    # Add tracking references if needed
```

---

## 10. Phased Delivery

### Phase 1 — Foundation
- Database migration (4 tables)
- API endpoints (CRUD for tracking_configs)
- AdminHub TrackingTab UI (form, save as draft)
- Credential storage (encrypted fields)

### Phase 2 — GTM Provisioning
- GTM API integration (service account auth)
- Template storage + placeholder substitution
- Provisioning job orchestration (workspace → variables → triggers → tags → version)
- Step-by-step status UI
- Install snippet output

### Phase 3 — Event Relay
- Relay service (GA4 Measurement Protocol + Meta CAPI)
- Medical allowlist / non-medical blocklist scrubbing
- Hook into existing form submission + call processing flows
- Event log table + UI
- Retry logic (3 attempts, exponential backoff)

### Phase 4 — Publish + Polish
- GTM publish action
- Re-provisioning flow (config changes)
- Audit log integration (security events)
- Event log retention cron job
- Error handling polish
- Documentation updates (API_REFERENCE.md, INTEGRATIONS.md, SKILLS.md)

---

## 11. Compliance Notes

- **PHI scrubbing is enforced server-side** in the relay service, not in the UI. Even if the UI sends extra fields, the relay drops them.
- **Medical allowlist is the safety net.** If a form field is mislabeled, a new field appears, or anything unexpected happens — it gets dropped for medical clients. Only explicitly approved fields pass through.
- **Event relay log does NOT store PHI.** The `payload_sent` column stores the post-scrubbing payload (what was actually sent to GA4/Meta), not the original event data.
- **Encrypted credentials** (GA4 API secret, Meta CAPI token) use existing AES-256-GCM encryption service.
- **Audit trail** via `tracking_provisioning_jobs` (who provisioned what, when) and `tracking_event_log` (what was sent where).
- **No PHI on the website.** WordPress only gets the GTM snippet. Browser events are generic (page_view, scroll, click). All conversion data flows through the dashboard backend.
