# Tracking Wizard — Design Spec

**Date:** 2026-04-06
**Goal:** Replace the manual-entry TrackingTab with a stepped wizard that lets staff select GA4 properties, Google Ads accounts, and Meta ad accounts from searchable dropdowns, auto-provision a GTM container, and configure conversion event mappings — all without typing IDs manually.

---

## Overview

The current TrackingTab requires staff to manually enter property IDs, measurement IDs, customer IDs, pixel IDs, and API secrets. This redesign replaces all manual text fields with API-backed searchable dropdowns (same Autocomplete pattern as the Monday.com board selector in AdminHub). Selecting accounts auto-populates all necessary IDs. The GTM container is provisioned automatically with the right tags based on selected accounts. Conversion events are pulled from Google Ads and mapped to internal event types.

**Key principle:** Staff picks client type, picks three accounts, and is essentially done. Everything else flows from those selections.

---

## Architecture

### Auth Model (No Per-Client Tokens)

| Platform | Auth Method | Scope |
|----------|------------|-------|
| GA4 | Service account (`anchor-hub@anchor-hub-480305.iam.gserviceaccount.com`) | All properties the SA is added to |
| Google Ads | OAuth refresh token via MCC (manager ID `6996750299`) | All 51 accounts under MCC |
| Meta | System user token (`FACEBOOK_SYSTEM_USER_TOKEN`) — permanent, 26 scopes | All 20 ad accounts under BM |
| GTM | Same service account as GA4 | Anchor Corps account (ID `6246584794`) |

No per-client CAPI tokens. The system user token handles Meta CAPI server-side, scoped by the pixel ID in each API call. No per-client GA4 API secrets needed for the relay — the service account handles it.

### Phone Call Conversion — Dual Path

Two separate conversion signals for phone calls:

1. **Browser-side (GTM tag):** Google Ads call conversion tag fires when CTM-swapped number is displayed/called. Counts all calls from Google Ads visitors. This works via the CTM script + GTM tag on the page — no AI involved.
2. **Server-side (relay):** When the AI tool classifies a call as a qualified lead, the relay fires an offline conversion to Google Ads (higher-value signal). Google Ads can optimize bidding against this instead of the 60-second threshold.

Both paths coexist. The GTM container includes the browser-side call tracking tag. The relay handles the server-side qualified call conversion.

---

## Wizard Steps

### Step 1: Client Type

Single selection: **Medical** vs **Non-Medical**.

- Medical: strict allowlist scrubbing for HIPAA (only event_name, event_time, domain, value, currency, event_id sent via relay)
- Non-Medical: blocklist scrubbing with SHA-256 hashed PII (email, phone)

Saved immediately on selection. Changing it later triggers a re-provision warning.

### Step 2: Account Selection

Three searchable `<Autocomplete>` dropdowns (MUI), identical pattern to the Monday.com board selector:

**GA4 Property:**
- Source: `GET /api/hub/tracking/accounts/ga4` → Analytics Admin API `accountSummaries.list()`
- Display: `"Account Name > Property Name"` (e.g., "ADC > Chandler Dentistry")
- On select: auto-populates `ga4_property_id` and `ga4_measurement_id` (measurement ID fetched from property metadata via Data Streams API). Also auto-creates a Measurement Protocol API secret if one doesn't exist (requires `acknowledgeUserDataCollection` call first, then `measurementProtocolSecrets.create`). The secret is stored encrypted in `ga4_api_secret`.
- Search: client-side filter (full list is small, <50 properties)

**Google Ads Account:**
- Source: `GET /api/hub/tracking/accounts/google-ads` → `listGoogleAdsAccounts()` (existing, gRPC)
- Display: account name + formatted ID (e.g., "ADC | Chandler Dentistry — 713-826-6180")
- Filter: excludes manager accounts, shows only client accounts
- On select: auto-populates `google_ads_customer_id`
- Search: client-side filter

**Meta Ad Account:**
- Source: `GET /api/hub/tracking/accounts/meta` → `fetchAdAccounts()` (existing)
- Display: account name + ID (e.g., "TMJ Utah — act_1537787229778897")
- On select: auto-populates `meta_ad_account_id`, then auto-fetches pixels via `GET /api/hub/tracking/accounts/meta/:adAccountId/pixels`
- If one pixel: auto-selects it, populates `meta_pixel_id`
- If multiple pixels: shows a second dropdown to pick one
- If no pixels: shows info message ("No pixels found — create one in Meta Events Manager")

All three dropdowns load their full option lists on step mount. `onInputChange` filters client-side (no server-side search needed — account lists are small enough).

### Step 3: GTM Container

**Dropdown** of existing containers in the Anchor Corps GTM account + a **"+ Create New Container"** sentinel option.

- Source: `GET /api/hub/tracking/accounts/gtm` → GTM API `accounts.containers.list()`
- Display: container name + public ID (e.g., "Bell Road (GTM-TRZTH252)")
- Selecting "Create New" reveals a `TextField` for the container name

**Provision button** (`LoadingButton`):
- If existing container selected: creates a workspace, applies templates (GA4 tag, Google Ads remarketing, Meta Pixel if enabled, consent defaults), creates a version
- If "Create New": creates the container first via GTM API `accounts.containers.create()`, then provisions
- Tags/triggers/variables are populated from the `standard_web_v1` template with placeholder values substituted from the accounts selected in Step 2
- On success: shows the GTM install snippet (head + body) with copy-to-clipboard button
- Saves `gtm_account_id`, `gtm_container_id`, `gtm_container_public_id`, `gtm_workspace_id`, `install_snippet` to the tracking config

**Publish button** (appears after provisioning):
- Publishes the GTM container version so it goes live
- Updates `provisioning_status` from `provisioned` → `published`

### Step 4: Conversion Events

Auto-fetches conversion actions from the selected Google Ads account.

- Source: `GET /api/hub/tracking/accounts/google-ads/:customerId/conversions` → GAQL query on `conversion_action` resource
- Returns: `[{ id, name, type, status }]` — e.g., `{ id: "123456", name: "Website Lead", type: "WEBPAGE", status: "ENABLED" }`

**UI:** `DataTable` with columns:
| Enabled (checkbox) | Conversion Action Name | Type | Map To (dropdown) |
|---|---|---|---|

"Map To" dropdown options: `form_submitted`, `qualified_call`, `new_client`, `appointment_request`, `unmapped`

**Auto-matching:** On initial load, the system pre-selects reasonable defaults:
- Action names containing "lead", "form", "submit" → `form_submitted`
- Action names containing "call", "phone" → `qualified_call`
- Action names containing "client", "customer", "sale" → `new_client`
- Action names containing "appointment", "booking", "schedule" → `appointment_request`
- Everything else → `unmapped`

**Refresh button:** Re-fetches conversion actions from Google Ads, preserves existing mappings, adds new ones as `unmapped`.

**Save:** Writes to `tracking_configs.conversion_mappings` (new JSONB column):
```json
{
  "form_submitted": { "conversion_action_id": "123456", "name": "Website Lead" },
  "qualified_call": { "conversion_action_id": "789012", "name": "Qualified Phone Lead" }
}
```

**Empty state:** If no conversion actions exist in the Google Ads account, show `EmptyState` with guidance: "No conversion actions found. Create them in Google Ads → Goals → Conversions."

### Step 5: Install & Status

Summary view showing:
- **GTM Snippet** — head and body code blocks with copy buttons
- **Provisioning status** — `StatusChip` showing draft/provisioned/published with timestamps
- **Relay toggle** — switch to enable/disable server-side event forwarding
- **Re-provision button** — for when accounts or events change. Updates the GTM container with current config.
- **Account summary** — which GA4, Google Ads, and Meta accounts are linked (read-only display)

---

## Backend Changes

### New API Endpoints

All under `/api/hub/tracking/`, admin-only:

| Method | Path | Purpose | Source |
|--------|------|---------|--------|
| GET | `/accounts/ga4` | List GA4 properties with measurement IDs | Analytics Admin API via service account |
| GET | `/accounts/google-ads` | List Google Ads client accounts | `listGoogleAdsAccounts()` (existing) |
| GET | `/accounts/meta` | List Meta ad accounts | `fetchAdAccounts()` with system user token |
| GET | `/accounts/meta/:adAccountId/pixels` | List pixels under an ad account | Graph API `/{adAccountId}/adspixels` |
| GET | `/accounts/gtm` | List GTM containers | GTM API `accounts.containers.list()` |
| POST | `/accounts/gtm` | Create new GTM container | GTM API `accounts.containers.create()` |
| GET | `/accounts/google-ads/:customerId/conversions` | List conversion actions | GAQL `SELECT FROM conversion_action` |
| PUT | `/:id/conversion-mappings` | Save event-to-conversion mappings | DB write |

### New Adapter Functions

**ga4Adapter.js** — add `listGA4Properties()`:
- Uses Analytics Admin API `accountSummaries.list()` (same service account)
- For each property, fetches data streams via `properties.dataStreams.list()` to get the measurement ID (G-xxx)
- Returns: `[{ propertyId, measurementId, propertyName, accountName }]`

**metaAdsAdapter.js** — add `fetchPixels(accessToken, adAccountId)`:
- Graph API: `GET /{adAccountId}/adspixels?fields=id,name&access_token=...`
- Returns: `[{ id, name }]`

**googleAdsAdapter.js** — add `listConversionActions(customerId)`:
- GAQL: `SELECT conversion_action.id, conversion_action.name, conversion_action.type, conversion_action.status FROM conversion_action WHERE conversion_action.status = 'ENABLED'`
- Returns: `[{ id, name, type, status }]`

### Database Changes

Migration `migrate_tracking_v3.sql`:

```sql
-- Add Meta ad account ID (separate from pixel)
ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT;

-- Add conversion event mappings
ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS conversion_mappings JSONB NOT NULL DEFAULT '{}'::jsonb;
```

Existing columns `google_ads_conversion_id` and `google_ads_conversion_label` are superseded by `conversion_mappings` but left in place.

The `ga4_api_secret` column is still used — it stores the auto-generated Measurement Protocol API secret (encrypted). The wizard creates this automatically when a GA4 property is selected.

The `meta_capi_token` column is no longer needed (system user token used directly), but left in place for backward compat.

### Relay Changes

**trackingRelay.js:**
- When relaying to Meta CAPI: use `process.env.FACEBOOK_SYSTEM_USER_TOKEN` directly instead of decrypting per-client `meta_capi_token`. Still scoped by `meta_pixel_id` from the tracking config.
- When relaying to Google Ads: NEW — look up the matching conversion action from `conversion_mappings` for the event type, then upload an offline conversion via Google Ads API (`ConversionUploadService`).
- The relay already handles GA4 Measurement Protocol — no changes needed there (uses `ga4_measurement_id` from config).

---

## Frontend Changes

### Component Structure

```
TrackingTab.jsx (rewritten — wizard shell)
├── TrackingWizard.jsx (MUI Stepper + step navigation)
│   ├── ClientTypeStep.jsx — radio group
│   ├── AccountSelectionStep.jsx — 3 Autocomplete dropdowns + conditional pixel sub-dropdown
│   ├── GtmContainerStep.jsx — Autocomplete + "Create New" + name field + Provision/Publish buttons + snippet display
│   ├── ConversionEventsStep.jsx — DataTable with toggles + mapping dropdowns + Refresh button
│   └── InstallStatusStep.jsx — snippet, relay toggle, status, re-provision
```

### New Frontend API Functions

In `src/api/tracking.js`:

```javascript
export const getGA4Accounts = () => client.get('/hub/tracking/accounts/ga4').then(r => r.data);
export const getGoogleAdsAccounts = () => client.get('/hub/tracking/accounts/google-ads').then(r => r.data);
export const getMetaAdAccounts = () => client.get('/hub/tracking/accounts/meta').then(r => r.data);
export const getMetaPixels = (adAccountId) => client.get(`/hub/tracking/accounts/meta/${adAccountId}/pixels`).then(r => r.data);
export const getGtmContainers = () => client.get('/hub/tracking/accounts/gtm').then(r => r.data);
export const createGtmContainer = (name) => client.post('/hub/tracking/accounts/gtm', { name }).then(r => r.data);
export const getConversionActions = (customerId) => client.get(`/hub/tracking/accounts/google-ads/${customerId}/conversions`).then(r => r.data);
export const saveConversionMappings = (configId, mappings) => client.put(`/hub/tracking/${configId}/conversion-mappings`, { mappings }).then(r => r.data);
```

### Shared Components Used

| Component | Where | Purpose |
|-----------|-------|---------|
| `LoadingButton` | Steps 3, 4, 5 | Provision, Publish, Refresh, Re-provision |
| `EmptyState` | Step 4 | No conversion actions found |
| `StatusChip` | Step 5 | Provisioning status |
| `DataTable` | Step 4 | Conversion events list |
| `SelectField` | Step 4 | "Map To" dropdown in each row |

No new shared components needed.

---

## Prerequisites

Before this feature works end-to-end:

1. **GTM service account access** — ✅ Done. `anchor-hub@anchor-hub-480305.iam.gserviceaccount.com` added as Admin to Anchor Corps GTM account (ID `6246584794`).
2. **Tag Manager API** — ✅ Enabled in GCP project `anchor-hub-480305`.
3. **Google Ads API** — ✅ Working via `google-ads-api` npm package (gRPC).
4. **Meta system user** — ✅ Token in env (`FACEBOOK_SYSTEM_USER_TOKEN`), 20 ad accounts accessible.
5. **GA4 service account** — ✅ 9 properties accessible.
6. **`GOOGLE_APPLICATION_CREDENTIALS`** — ✅ Set in `.env` for local dev. Cloud Run uses default credentials.
7. **Secrets in Secret Manager** — ✅ All 6 new secrets created and bound to Cloud Run `anchor-hub` service.

---

## Environment Variables

| Env Var | Where | Purpose |
|---------|-------|---------|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Secret Manager + `.env` | Google Ads API auth |
| `GOOGLE_ADS_REFRESH_TOKEN` | Secret Manager + `.env` | Google Ads OAuth |
| `GOOGLE_ADS_MANAGER_ID` | Secret Manager + `.env` | MCC parent account |
| `GOOGLE_ADS_CLIENT_ID` | Secret Manager + `.env` | OAuth client |
| `GOOGLE_ADS_CLIENT_SECRET` | Secret Manager + `.env` | OAuth client |
| `FACEBOOK_SYSTEM_USER_TOKEN` | Secret Manager + `.env` | Meta API (CAPI + ad accounts) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `.env` only (local) | Service account for GTM + GA4 locally |

---

## What This Replaces

The current TrackingTab has manual text fields for:
- GTM Container ID → replaced by dropdown + "Create New"
- GA4 Property ID, Measurement ID → replaced by single dropdown (auto-populates both)
- GA4 API Secret → eliminated (service account handles auth)
- Google Ads Customer ID, Conversion ID, Conversion Label → replaced by dropdown + auto-pulled conversion mappings
- Meta Pixel ID → replaced by account dropdown → pixel sub-dropdown
- Meta CAPI Token → eliminated (system user token used directly)
- Bing UET Tag ID, TikTok Pixel ID → kept as manual fields in a future "Additional Platforms" step (out of scope for this spec)

---

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| GTM Account ID | `6246584794` | Anchor Corps GTM account — all client containers live here. Stored as env var `GTM_ACCOUNT_ID` (not hardcoded in code). |
| GTM Account Path | `accounts/6246584794` | Used in GTM API calls. Derived from account ID. |

## Out of Scope

- Bing Ads / TikTok pixel configuration (future step in wizard)
- GTM consent mode v2 advanced configuration
- Multi-GTM-account support (currently Anchor Corps only)
- Automatic GA4 property creation (properties must already exist)
