# Tracking Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual-entry TrackingTab with a 5-step wizard using API-backed searchable dropdowns for GA4, Google Ads, and Meta accounts, auto-provisioning GTM containers, and configuring conversion event mappings.

**Architecture:** New backend endpoints expose account lists from GA4 Admin API, Google Ads gRPC API, and Meta Graph API. The frontend TrackingTab is rewritten as a stepped wizard using MUI Stepper + Autocomplete (same pattern as Monday.com board selector). The relay is extended to use the system user token for Meta CAPI and to send offline conversions to Google Ads.

**Tech Stack:** React 19 + MUI v5 (frontend), Express.js (backend), PostgreSQL, Google Analytics Admin API, google-ads-api (gRPC), Meta Graph API v18.0, Google Tag Manager API v2.

**Spec:** `docs/superpowers/specs/2026-04-06-tracking-wizard-design.md`

**Verification:** This project has no test suite. Each task verifies via `yarn build` (no errors) + `yarn lint` (clean) + visual check where applicable.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `server/sql/migrate_tracking_v3.sql` | DB migration — add `meta_ad_account_id` and `conversion_mappings` columns |
| `src/views/admin/AdminHub/TrackingWizard.jsx` | Stepper shell + step navigation |
| `src/views/admin/AdminHub/tracking/ClientTypeStep.jsx` | Step 1 — medical vs non-medical radio |
| `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx` | Step 2 — GA4/Google Ads/Meta dropdowns |
| `src/views/admin/AdminHub/tracking/GtmContainerStep.jsx` | Step 3 — GTM container picker + provision |
| `src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx` | Step 4 — auto-pulled conversion actions + mapping |
| `src/views/admin/AdminHub/tracking/InstallStatusStep.jsx` | Step 5 — snippet, relay toggle, status |

### Modified Files

| File | Change |
|------|--------|
| `server/routes/tracking.js` | Add 8 new account-listing and conversion-mapping endpoints |
| `server/services/analytics/ga4Adapter.js` | Add `listGA4Properties()` and `createMPSecret()` |
| `server/services/analytics/metaAdsAdapter.js` | Add `fetchPixels()` |
| `server/services/analytics/googleAdsAdapter.js` | Add `listConversionActions()` |
| `server/services/trackingRelay.js` | Use system user token for Meta CAPI; add Google Ads offline conversion upload |
| `server/services/trackingProvisioning.js` | Add `createContainer()` export for new GTM containers |
| `server/index.js` | Add v3 migration function + chain it |
| `src/api/tracking.js` | Add 8 new API functions for account listing |
| `src/views/admin/AdminHub/TrackingTab.jsx` | Rewrite to render TrackingWizard |

---

## Phase 1: Backend Foundation

### Task 1: Database Migration v3

**Files:**
- Create: `server/sql/migrate_tracking_v3.sql`
- Modify: `server/index.js`

- [ ] **Step 1: Create migration file**

```sql
-- migrate_tracking_v3.sql
-- Tracking wizard: add ad account ID and conversion mappings

ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT;
ALTER TABLE tracking_configs ADD COLUMN IF NOT EXISTS conversion_mappings JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 2: Add migration function to server/index.js**

Find the existing `maybeRunTrackingV2Migration` function (around line 738) and add after it:

```javascript
async function maybeRunTrackingV3Migration() {
  try {
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking_v3.sql');
    await pool.query(fs.readFileSync(sqlPath, 'utf8'));
    console.log('[migrations] ran migrate_tracking_v3.sql');
  } catch (err) {
    console.error('[migrations] tracking v3 error:', err.message);
  }
}
```

Then chain it in the startup sequence (around line 1116), after `.then(maybeRunTrackingV2Migration)`:

```javascript
    .then(maybeRunTrackingV3Migration)
```

- [ ] **Step 3: Verify migration runs**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: 'postgresql://bif@localhost:5432/anchor' });
pool.query(fs.readFileSync('server/sql/migrate_tracking_v3.sql', 'utf8'))
  .then(() => pool.query('SELECT meta_ad_account_id, conversion_mappings FROM tracking_configs LIMIT 1'))
  .then(r => { console.log('✅ Columns exist:', Object.keys(r.rows[0])); pool.end(); })
  .catch(e => { console.error('❌', e.message); pool.end(); });
"
```

Expected: `✅ Columns exist: [ 'meta_ad_account_id', 'conversion_mappings' ]`

- [ ] **Step 4: Build check**

```bash
yarn build
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/sql/migrate_tracking_v3.sql server/index.js
git commit -m "feat(tracking): add v3 migration for meta_ad_account_id and conversion_mappings"
```

---

### Task 2: GA4 Adapter — listGA4Properties and createMPSecret

**Files:**
- Modify: `server/services/analytics/ga4Adapter.js`

- [ ] **Step 1: Add listGA4Properties function**

Add after the existing `fetchGA4Analytics` function (after line 107):

```javascript
/**
 * List all GA4 properties accessible by the service account, with measurement IDs.
 * @returns {Array<{propertyId: string, measurementId: string, propertyName: string, accountName: string}>}
 */
export async function listGA4Properties() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly']
  });

  const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth });

  // Fetch all account summaries (includes property names)
  let allSummaries = [];
  let pageToken;
  do {
    const res = await analyticsAdmin.accountSummaries.list({ pageSize: 200, pageToken });
    allSummaries.push(...(res.data.accountSummaries || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  // Flatten to property list, fetching measurement IDs from data streams
  const properties = [];
  for (const acct of allSummaries) {
    for (const prop of (acct.propertySummaries || [])) {
      const propertyId = prop.property?.replace('properties/', '');
      if (!propertyId) continue;

      let measurementId = null;
      try {
        const streamsRes = await analyticsAdmin.properties.dataStreams.list({
          parent: prop.property
        });
        const webStream = (streamsRes.data.dataStreams || []).find(
          (s) => s.type === 'WEB_DATA_STREAM'
        );
        measurementId = webStream?.webStreamData?.measurementId || null;
      } catch {
        // Property may not have a web stream
      }

      properties.push({
        propertyId,
        measurementId,
        propertyName: prop.displayName || '',
        accountName: acct.displayName || ''
      });
    }
  }

  return properties;
}
```

- [ ] **Step 2: Add createMPSecret function**

Add after `listGA4Properties`:

```javascript
const DATA_COLLECTION_ACK = 'I acknowledge that I have the necessary privacy disclosures and rights from my end users for the collection and processing of their data, including the association of such data with the visitation information Google Analytics collects from my site and/or app property.';

/**
 * Create a Measurement Protocol API secret for a GA4 property.
 * Acknowledges data collection if needed, then creates or returns existing secret.
 * @param {string} propertyId - GA4 property ID (numeric)
 * @returns {{ secretValue: string, measurementId: string }}
 */
export async function createMPSecret(propertyId) {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/analytics.edit']
  });

  const admin = google.analyticsadmin({ version: 'v1alpha', auth });
  const property = `properties/${propertyId}`;

  // Find web data stream
  const streamsRes = await admin.properties.dataStreams.list({ parent: property });
  const webStream = (streamsRes.data.dataStreams || []).find(
    (s) => s.type === 'WEB_DATA_STREAM'
  );
  if (!webStream) throw new Error('No web data stream found for property ' + propertyId);

  const measurementId = webStream.webStreamData?.measurementId;

  // Check for existing secret
  const existingRes = await admin.properties.dataStreams.measurementProtocolSecrets.list({
    parent: webStream.name
  });
  const existing = (existingRes.data.measurementProtocolSecrets || []).find(
    (s) => s.displayName === 'Anchor Dashboard Relay'
  );
  if (existing) {
    return { secretValue: existing.secretValue, measurementId };
  }

  // Acknowledge data collection (required before creating secrets)
  try {
    await admin.properties.acknowledgeUserDataCollection({
      property,
      requestBody: { acknowledgement: DATA_COLLECTION_ACK }
    });
  } catch {
    // May already be acknowledged — ignore
  }

  // Create new secret
  const createRes = await admin.properties.dataStreams.measurementProtocolSecrets.create({
    parent: webStream.name,
    requestBody: { displayName: 'Anchor Dashboard Relay' }
  });

  return { secretValue: createRes.data.secretValue, measurementId };
}
```

- [ ] **Step 3: Build check**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/services/analytics/ga4Adapter.js
git commit -m "feat(tracking): add listGA4Properties and createMPSecret to GA4 adapter"
```

---

### Task 3: Meta Adapter — fetchPixels

**Files:**
- Modify: `server/services/analytics/metaAdsAdapter.js`

- [ ] **Step 1: Add fetchPixels function**

Add after the existing `fetchAdAccounts` function (after line 66):

```javascript
/**
 * Fetch pixels (ad pixels) for a Meta ad account.
 * @param {string} accessToken
 * @param {string} adAccountId - With or without 'act_' prefix
 * @returns {Array<{id: string, name: string}>}
 */
export async function fetchPixels(accessToken, adAccountId) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const res = await fetchMeta(`${accountId}/adspixels?fields=id,name&access_token=${accessToken}`);
  return (res.data || []).map((p) => ({ id: p.id, name: p.name }));
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/analytics/metaAdsAdapter.js
git commit -m "feat(tracking): add fetchPixels to Meta adapter"
```

---

### Task 4: Google Ads Adapter — listConversionActions

**Files:**
- Modify: `server/services/analytics/googleAdsAdapter.js`

- [ ] **Step 1: Add listConversionActions function**

Add after the existing `listGoogleAdsAccounts` function (after line 157):

```javascript
/**
 * List enabled conversion actions for a Google Ads customer account.
 * @param {string} customerId - Google Ads customer ID (with or without dashes)
 * @returns {Array<{id: string, name: string, type: string, status: string}>}
 */
export async function listConversionActions(customerId) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return [];

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);
  const results = await customer.query(`
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.type,
      conversion_action.status
    FROM conversion_action
    WHERE conversion_action.status = 'ENABLED'
  `);

  return results.map((r) => ({
    id: String(r.conversion_action.id),
    name: r.conversion_action.name || '',
    type: r.conversion_action.type || '',
    status: r.conversion_action.status || ''
  }));
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/analytics/googleAdsAdapter.js
git commit -m "feat(tracking): add listConversionActions to Google Ads adapter"
```

---

### Task 5: GTM Container Creation

**Files:**
- Modify: `server/services/trackingProvisioning.js`

- [ ] **Step 1: Add createContainer export**

Read the file first to find the existing `getAuthClient` function and the `provision` function. Add `createContainer` after `getAuthClient`:

```javascript
const GTM_ACCOUNT_ID = process.env.GTM_ACCOUNT_ID || '6246584794';

/**
 * List all GTM containers in the account.
 * @returns {Array<{containerId: string, publicId: string, name: string}>}
 */
export async function listContainers() {
  const authClient = await getAuthClient();
  const tagmanager = google.tagmanager({ version: 'v2', auth: authClient });
  const res = await tagmanager.accounts.containers.list({
    parent: `accounts/${GTM_ACCOUNT_ID}`
  });
  return (res.data.container || []).map((c) => ({
    containerId: c.containerId,
    publicId: c.publicId,
    name: c.name
  }));
}

/**
 * Create a new GTM web container.
 * @param {string} name - Display name for the container
 * @returns {{containerId: string, publicId: string, name: string}}
 */
export async function createContainer(name) {
  const authClient = await getAuthClient();
  const tagmanager = google.tagmanager({ version: 'v2', auth: authClient });
  const res = await tagmanager.accounts.containers.create({
    parent: `accounts/${GTM_ACCOUNT_ID}`,
    requestBody: {
      name,
      usageContext: ['web']
    }
  });
  return {
    containerId: res.data.containerId,
    publicId: res.data.publicId,
    name: res.data.name
  };
}
```

Make sure `google` is imported from `googleapis` at the top of the file (it should be already since `provision` uses it).

- [ ] **Step 2: Update provision function to accept container from wizard**

The existing `provision` function reads `gtm_account_id` and `gtm_container_id` from the DB config. It should still work as-is since the wizard writes those fields before calling provision. No code changes needed — just verify the flow works conceptually.

- [ ] **Step 3: Build check**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/services/trackingProvisioning.js
git commit -m "feat(tracking): add listContainers and createContainer for GTM wizard"
```

---

### Task 6: Backend API Endpoints

**Files:**
- Modify: `server/routes/tracking.js`

- [ ] **Step 1: Add imports for new adapter functions**

At the top of `server/routes/tracking.js`, add to existing imports:

```javascript
import { listGA4Properties, createMPSecret } from '../services/analytics/ga4Adapter.js';
import { listGoogleAdsAccounts, listConversionActions } from '../services/analytics/googleAdsAdapter.js';
import { fetchAdAccounts, fetchPixels } from '../services/analytics/metaAdsAdapter.js';
import { listContainers, createContainer } from '../services/trackingProvisioning.js';
```

- [ ] **Step 2: Add account listing endpoints**

Add before the existing `GET /templates/list` route (before line 37). These must come before the `/:userId` and `/:id/*` routes to avoid path conflicts:

```javascript
// -- Account listing endpoints (for wizard dropdowns) --

// GET /accounts/ga4 — list GA4 properties with measurement IDs
router.get('/accounts/ga4', async (req, res) => {
  try {
    const properties = await listGA4Properties();
    res.json({ properties });
  } catch (err) {
    console.error('[tracking] list GA4 properties error:', err.message);
    res.status(500).json({ message: 'Failed to list GA4 properties' });
  }
});

// GET /accounts/google-ads — list Google Ads client accounts
router.get('/accounts/google-ads', async (req, res) => {
  try {
    const accounts = await listGoogleAdsAccounts();
    const clients = accounts.filter((a) => !a.isManager);
    res.json({ accounts: clients });
  } catch (err) {
    console.error('[tracking] list Google Ads accounts error:', err.message);
    res.status(500).json({ message: 'Failed to list Google Ads accounts' });
  }
});

// GET /accounts/google-ads/:customerId/conversions — list conversion actions
router.get('/accounts/google-ads/:customerId/conversions', async (req, res) => {
  try {
    const actions = await listConversionActions(req.params.customerId);
    res.json({ actions });
  } catch (err) {
    console.error('[tracking] list conversion actions error:', err.message);
    res.status(500).json({ message: 'Failed to list conversion actions' });
  }
});

// GET /accounts/meta — list Meta ad accounts
router.get('/accounts/meta', async (req, res) => {
  try {
    const token = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!token) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });
    const accounts = await fetchAdAccounts(token);
    res.json({ accounts });
  } catch (err) {
    console.error('[tracking] list Meta ad accounts error:', err.message);
    res.status(500).json({ message: 'Failed to list Meta ad accounts' });
  }
});

// GET /accounts/meta/:adAccountId/pixels — list pixels for an ad account
router.get('/accounts/meta/:adAccountId/pixels', async (req, res) => {
  try {
    const token = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!token) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });
    const pixels = await fetchPixels(token, req.params.adAccountId);
    res.json({ pixels });
  } catch (err) {
    console.error('[tracking] list Meta pixels error:', err.message);
    res.status(500).json({ message: 'Failed to list pixels' });
  }
});

// GET /accounts/gtm — list GTM containers
router.get('/accounts/gtm', async (req, res) => {
  try {
    const containers = await listContainers();
    res.json({ containers });
  } catch (err) {
    console.error('[tracking] list GTM containers error:', err.message);
    res.status(500).json({ message: 'Failed to list GTM containers' });
  }
});

// POST /accounts/gtm — create a new GTM container
router.post('/accounts/gtm', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Container name is required' });
    const container = await createContainer(name);
    res.json({ container });
  } catch (err) {
    console.error('[tracking] create GTM container error:', err.message);
    res.status(500).json({ message: 'Failed to create GTM container' });
  }
});

// POST /accounts/ga4/:propertyId/mp-secret — create/get MP API secret
router.post('/accounts/ga4/:propertyId/mp-secret', async (req, res) => {
  try {
    const result = await createMPSecret(req.params.propertyId);
    res.json(result);
  } catch (err) {
    console.error('[tracking] create MP secret error:', err.message);
    res.status(500).json({ message: 'Failed to create Measurement Protocol secret' });
  }
});
```

- [ ] **Step 3: Add conversion mappings endpoint**

Add after the existing `POST /:id/publish` route:

```javascript
// PUT /:id/conversion-mappings — save conversion event mappings
router.put('/:id/conversion-mappings', async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!mappings || typeof mappings !== 'object') {
      return res.status(400).json({ message: 'mappings object is required' });
    }
    const result = await query(
      `UPDATE tracking_configs SET conversion_mappings = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(mappings), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Config not found' });
    res.json({ config: decryptConfig(result.rows[0]) });
  } catch (err) {
    console.error('[tracking] save conversion mappings error:', err.message);
    res.status(500).json({ message: 'Failed to save conversion mappings' });
  }
});
```

- [ ] **Step 4: Build check**

```bash
yarn build
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/tracking.js
git commit -m "feat(tracking): add account listing and conversion mapping API endpoints"
```

---

### Task 7: Relay — Meta CAPI System Token + Google Ads Offline Conversions

**Files:**
- Modify: `server/services/trackingRelay.js`

- [ ] **Step 1: Update Meta CAPI to use system token**

In `server/services/trackingRelay.js`, find the `sendToMetaCAPI` function (around line 168). It currently decrypts `config.meta_capi_token`. Change it to prefer the system user token:

Replace the line that decrypts the token:
```javascript
const accessToken = decrypt(config.meta_capi_token);
```

With:
```javascript
const accessToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN || decrypt(config.meta_capi_token);
```

This falls back to per-client token if the system token isn't set.

- [ ] **Step 2: Add Google Ads offline conversion import**

Add at the top of the file, after existing imports:

```javascript
import { GoogleAdsApi } from 'google-ads-api';
```

Add a new function after `sendToMetaCAPI`:

```javascript
async function sendToGoogleAds(config, eventName, scrubbed) {
  if (!config.conversion_mappings || !config.google_ads_customer_id) return;

  const mapping = config.conversion_mappings[eventName];
  if (!mapping?.conversion_action_id) return;

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const managerId = process.env.GOOGLE_ADS_MANAGER_ID || '6996750299';
  if (!devToken || !refreshToken) return;

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID || null,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || null,
    developer_token: devToken,
  });

  const customer = client.Customer({
    customer_id: config.google_ads_customer_id.replace(/-/g, ''),
    refresh_token: refreshToken,
    login_customer_id: managerId,
  });

  const conversionAction = `customers/${config.google_ads_customer_id.replace(/-/g, '')}/conversionActions/${mapping.conversion_action_id}`;
  const conversionDateTime = new Date().toISOString().replace('T', ' ').replace('Z', '+00:00');

  await customer.conversionUploads.uploadClickConversions({
    customer_id: config.google_ads_customer_id.replace(/-/g, ''),
    conversions: [{
      conversion_action: conversionAction,
      conversion_date_time: conversionDateTime,
      conversion_value: scrubbed.value || 1,
      currency_code: scrubbed.currency || 'USD',
    }],
    partial_failure: true,
  });
}
```

- [ ] **Step 3: Wire Google Ads into the main sendEvent flow**

In the `sendEvent` function, find where it calls `sendToGA4` and `sendToMetaCAPI` (there should be a section that dispatches to each destination). Add a Google Ads dispatch alongside them:

```javascript
  // Send to Google Ads (offline conversion)
  if (config.google_ads_customer_id && config.conversion_mappings) {
    promises.push(
      sendWithRetry(() => sendToGoogleAds(config, eventName, scrubbed), config.id, eventName, 'google_ads', sourceId)
    );
  }
```

Add this in the same block where `sendToGA4` and `sendToMetaCAPI` are dispatched.

- [ ] **Step 4: Build check**

```bash
yarn build
```

- [ ] **Step 5: Commit**

```bash
git add server/services/trackingRelay.js
git commit -m "feat(tracking): relay uses system token for Meta CAPI, adds Google Ads offline conversions"
```

---

## Phase 2: Frontend API Layer

### Task 8: Frontend API Functions

**Files:**
- Modify: `src/api/tracking.js`

- [ ] **Step 1: Add account listing and conversion mapping API functions**

Add at the end of `src/api/tracking.js`:

```javascript
// -- Account Listing (for wizard dropdowns) --

export function getGA4Accounts() {
  return client.get('/hub/tracking/accounts/ga4').then((res) => res.data.properties || []);
}

export function getGoogleAdsAccounts() {
  return client.get('/hub/tracking/accounts/google-ads').then((res) => res.data.accounts || []);
}

export function getMetaAdAccounts() {
  return client.get('/hub/tracking/accounts/meta').then((res) => res.data.accounts || []);
}

export function getMetaPixels(adAccountId) {
  return client.get(`/hub/tracking/accounts/meta/${adAccountId}/pixels`).then((res) => res.data.pixels || []);
}

export function getGtmContainers() {
  return client.get('/hub/tracking/accounts/gtm').then((res) => res.data.containers || []);
}

export function createGtmContainer(name) {
  return client.post('/hub/tracking/accounts/gtm', { name }).then((res) => res.data.container);
}

export function getConversionActions(customerId) {
  return client.get(`/hub/tracking/accounts/google-ads/${customerId}/conversions`).then((res) => res.data.actions || []);
}

export function createMPSecret(propertyId) {
  return client.post(`/hub/tracking/accounts/ga4/${propertyId}/mp-secret`).then((res) => res.data);
}

export function saveConversionMappings(configId, mappings) {
  return client.put(`/hub/tracking/${configId}/conversion-mappings`, { mappings }).then((res) => res.data);
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/api/tracking.js
git commit -m "feat(tracking): add frontend API functions for wizard dropdowns"
```

---

## Phase 3: Frontend Wizard Components

### Task 9: TrackingWizard Shell

**Files:**
- Create: `src/views/admin/AdminHub/TrackingWizard.jsx`
- Modify: `src/views/admin/AdminHub/TrackingTab.jsx`

- [ ] **Step 1: Create TrackingWizard component**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Box, Stepper, Step, StepLabel, StepContent, Button, Stack, Typography } from '@mui/material';
import { useToast } from 'contexts/ToastContext';
import { getTrackingConfig, createTrackingConfig, updateTrackingConfig } from 'api/tracking';
import ClientTypeStep from './tracking/ClientTypeStep';
import AccountSelectionStep from './tracking/AccountSelectionStep';
import GtmContainerStep from './tracking/GtmContainerStep';
import ConversionEventsStep from './tracking/ConversionEventsStep';
import InstallStatusStep from './tracking/InstallStatusStep';

const STEPS = [
  { label: 'Client Type', description: 'Medical or non-medical' },
  { label: 'Accounts', description: 'GA4, Google Ads, Meta' },
  { label: 'GTM Container', description: 'Select or create' },
  { label: 'Conversion Events', description: 'Map events to actions' },
  { label: 'Install & Status', description: 'Snippet and relay' },
];

export default function TrackingWizard({ clientId }) {
  const { showToast } = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTrackingConfig(clientId);
      setConfig(data.config || null);
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveConfig = async (updates) => {
    try {
      if (config?.id) {
        const data = await updateTrackingConfig(config.id, updates);
        setConfig(data.config);
        return data.config;
      } else {
        const data = await createTrackingConfig({ user_id: clientId, ...updates });
        setConfig(data.config);
        return data.config;
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save', 'error');
      throw err;
    }
  };

  const handleNext = () => setActiveStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  const handleBack = () => setActiveStep((prev) => Math.max(prev - 1, 0));
  const handleStepClick = (step) => {
    if (config) setActiveStep(step);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">Loading tracking config...</Typography>
      </Box>
    );
  }

  const stepProps = { config, saveConfig, onNext: handleNext, onBack: handleBack, onReload: loadConfig, clientId };

  return (
    <Box sx={{ py: 2 }}>
      <Stepper activeStep={activeStep} orientation="vertical">
        {STEPS.map((step, index) => (
          <Step key={step.label} completed={config && index < activeStep}>
            <StepLabel
              onClick={() => handleStepClick(index)}
              sx={{ cursor: config ? 'pointer' : 'default' }}
              optional={<Typography variant="caption" color="text.secondary">{step.description}</Typography>}
            >
              {step.label}
            </StepLabel>
            <StepContent>
              {index === 0 && <ClientTypeStep {...stepProps} />}
              {index === 1 && <AccountSelectionStep {...stepProps} />}
              {index === 2 && <GtmContainerStep {...stepProps} />}
              {index === 3 && <ConversionEventsStep {...stepProps} />}
              {index === 4 && <InstallStatusStep {...stepProps} />}
            </StepContent>
          </Step>
        ))}
      </Stepper>
    </Box>
  );
}
```

- [ ] **Step 2: Rewrite TrackingTab to render the wizard**

Replace the entire contents of `src/views/admin/AdminHub/TrackingTab.jsx` with:

```jsx
import TrackingWizard from './TrackingWizard';

export default function TrackingTab({ clientId }) {
  return <TrackingWizard clientId={clientId} />;
}
```

- [ ] **Step 3: Create tracking subdirectory**

```bash
mkdir -p "src/views/admin/AdminHub/tracking"
```

- [ ] **Step 4: Build check**

Build will fail until step components exist. Create placeholder files first:

```bash
for step in ClientTypeStep AccountSelectionStep GtmContainerStep ConversionEventsStep InstallStatusStep; do
  echo "export default function ${step}() { return null; }" > "src/views/admin/AdminHub/tracking/${step}.jsx"
done
```

Then build:

```bash
yarn build
```

- [ ] **Step 5: Commit**

```bash
git add src/views/admin/AdminHub/TrackingWizard.jsx src/views/admin/AdminHub/TrackingTab.jsx src/views/admin/AdminHub/tracking/
git commit -m "feat(tracking): add wizard shell and step placeholders"
```

---

### Task 10: Step 1 — ClientTypeStep

**Files:**
- Create: `src/views/admin/AdminHub/tracking/ClientTypeStep.jsx`

- [ ] **Step 1: Implement ClientTypeStep**

```jsx
import { useState } from 'react';
import { Stack, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio, Alert, Button } from '@mui/material';
import LoadingButton from 'ui-component/extended/LoadingButton';

export default function ClientTypeStep({ config, saveConfig, onNext }) {
  const [clientType, setClientType] = useState(config?.client_type || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!clientType) return;
    setSaving(true);
    try {
      await saveConfig({ client_type: clientType, website_domain: config?.website_domain || '' });
      onNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ mt: 1, maxWidth: 500 }}>
      <FormControl>
        <FormLabel>Client Type</FormLabel>
        <RadioGroup value={clientType} onChange={(e) => setClientType(e.target.value)}>
          <FormControlLabel value="medical" control={<Radio />} label="Medical (HIPAA strict mode)" />
          <FormControlLabel value="non_medical" control={<Radio />} label="Non-Medical (standard mode)" />
        </RadioGroup>
      </FormControl>

      {clientType === 'medical' && (
        <Alert severity="info" variant="outlined">
          Medical clients use strict allowlist scrubbing — only event name, timestamp, domain, value, and currency are sent. No PII reaches GA4, Meta, or Google Ads.
        </Alert>
      )}

      <Stack direction="row" spacing={1}>
        <LoadingButton
          variant="contained"
          onClick={handleSave}
          loading={saving}
          loadingLabel="Saving..."
          disabled={!clientType}
        >
          Next
        </LoadingButton>
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/tracking/ClientTypeStep.jsx
git commit -m "feat(tracking): implement ClientTypeStep wizard component"
```

---

### Task 11: Step 2 — AccountSelectionStep

**Files:**
- Create: `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx`

- [ ] **Step 1: Implement AccountSelectionStep**

```jsx
import { useState, useEffect } from 'react';
import { Stack, Autocomplete, TextField, Typography, Button, Alert, CircularProgress } from '@mui/material';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import {
  getGA4Accounts, getGoogleAdsAccounts, getMetaAdAccounts,
  getMetaPixels, createMPSecret
} from 'api/tracking';

export default function AccountSelectionStep({ config, saveConfig, onNext, onBack }) {
  const { showToast } = useToast();

  const [ga4Options, setGa4Options] = useState([]);
  const [adsOptions, setAdsOptions] = useState([]);
  const [metaOptions, setMetaOptions] = useState([]);
  const [pixelOptions, setPixelOptions] = useState([]);

  const [ga4Value, setGa4Value] = useState(null);
  const [adsValue, setAdsValue] = useState(null);
  const [metaValue, setMetaValue] = useState(null);
  const [pixelValue, setPixelValue] = useState(null);

  const [loadingGA4, setLoadingGA4] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingPixels, setLoadingPixels] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load all account lists on mount
  useEffect(() => {
    setLoadingGA4(true);
    getGA4Accounts()
      .then((props) => {
        setGa4Options(props);
        if (config?.ga4_property_id) {
          const match = props.find((p) => p.propertyId === config.ga4_property_id);
          if (match) setGa4Value(match);
        }
      })
      .catch(() => showToast('Failed to load GA4 properties', 'error'))
      .finally(() => setLoadingGA4(false));

    setLoadingAds(true);
    getGoogleAdsAccounts()
      .then((accts) => {
        setAdsOptions(accts);
        if (config?.google_ads_customer_id) {
          const cleanId = config.google_ads_customer_id.replace(/-/g, '');
          const match = accts.find((a) => a.id === cleanId);
          if (match) setAdsValue(match);
        }
      })
      .catch(() => showToast('Failed to load Google Ads accounts', 'error'))
      .finally(() => setLoadingAds(false));

    setLoadingMeta(true);
    getMetaAdAccounts()
      .then((accts) => {
        setMetaOptions(accts);
        if (config?.meta_ad_account_id) {
          const match = accts.find((a) => a.id === config.meta_ad_account_id);
          if (match) {
            setMetaValue(match);
            loadPixels(match.id);
          }
        }
      })
      .catch(() => showToast('Failed to load Meta ad accounts', 'error'))
      .finally(() => setLoadingMeta(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPixels = async (adAccountId) => {
    setLoadingPixels(true);
    try {
      const pixels = await getMetaPixels(adAccountId);
      setPixelOptions(pixels);
      if (pixels.length === 1) setPixelValue(pixels[0]);
      else if (config?.meta_pixel_id) {
        const match = pixels.find((p) => p.id === config.meta_pixel_id);
        if (match) setPixelValue(match);
      }
    } catch {
      showToast('Failed to load pixels', 'error');
    } finally {
      setLoadingPixels(false);
    }
  };

  const handleMetaChange = (_, val) => {
    setMetaValue(val);
    setPixelValue(null);
    setPixelOptions([]);
    if (val) loadPixels(val.id);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {};

      if (ga4Value) {
        updates.ga4_property_id = ga4Value.propertyId;
        updates.ga4_measurement_id = ga4Value.measurementId;
        // Auto-create MP secret
        try {
          const mpResult = await createMPSecret(ga4Value.propertyId);
          updates.ga4_api_secret = mpResult.secretValue;
          if (mpResult.measurementId) updates.ga4_measurement_id = mpResult.measurementId;
        } catch (err) {
          console.warn('MP secret creation failed:', err);
          // Non-fatal — relay just won't work until secret is set
        }
      }

      if (adsValue) {
        const fmtId = adsValue.id.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
        updates.google_ads_customer_id = fmtId;
      }

      if (metaValue) {
        updates.meta_ad_account_id = metaValue.id;
      }
      if (pixelValue) {
        updates.meta_pixel_id = pixelValue.id;
      }

      await saveConfig(updates);
      onNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ mt: 1, maxWidth: 600 }}>
      <Autocomplete
        options={ga4Options}
        getOptionLabel={(o) => o ? `${o.accountName} > ${o.propertyName}` : ''}
        value={ga4Value}
        onChange={(_, val) => setGa4Value(val)}
        renderInput={(params) => (
          <TextField {...params} label="GA4 Property" placeholder="Search properties..." />
        )}
        loading={loadingGA4}
        isOptionEqualToValue={(o, v) => o.propertyId === v.propertyId}
      />

      <Autocomplete
        options={adsOptions}
        getOptionLabel={(o) => o ? `${o.name} — ${o.id.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3')}` : ''}
        value={adsValue}
        onChange={(_, val) => setAdsValue(val)}
        renderInput={(params) => (
          <TextField {...params} label="Google Ads Account" placeholder="Search accounts..." />
        )}
        loading={loadingAds}
        isOptionEqualToValue={(o, v) => o.id === v.id}
      />

      <Autocomplete
        options={metaOptions}
        getOptionLabel={(o) => o ? `${o.name} — ${o.id}` : ''}
        value={metaValue}
        onChange={handleMetaChange}
        renderInput={(params) => (
          <TextField {...params} label="Meta Ad Account" placeholder="Search ad accounts..." />
        )}
        loading={loadingMeta}
        isOptionEqualToValue={(o, v) => o.id === v.id}
      />

      {metaValue && pixelOptions.length > 1 && (
        <Autocomplete
          options={pixelOptions}
          getOptionLabel={(o) => o ? `${o.name} (${o.id})` : ''}
          value={pixelValue}
          onChange={(_, val) => setPixelValue(val)}
          renderInput={(params) => (
            <TextField {...params} label="Meta Pixel" placeholder="Select pixel..." />
          )}
          loading={loadingPixels}
          isOptionEqualToValue={(o, v) => o.id === v.id}
        />
      )}

      {metaValue && pixelOptions.length === 0 && !loadingPixels && (
        <Alert severity="info">No pixels found for this ad account. Create one in Meta Events Manager.</Alert>
      )}

      {metaValue && pixelOptions.length === 1 && (
        <Typography variant="body2" color="text.secondary">
          Pixel auto-selected: {pixelOptions[0].name} ({pixelOptions[0].id})
        </Typography>
      )}

      <Stack direction="row" spacing={1}>
        <Button onClick={onBack}>Back</Button>
        <LoadingButton
          variant="contained"
          onClick={handleSave}
          loading={saving}
          loadingLabel="Saving..."
        >
          Next
        </LoadingButton>
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx
git commit -m "feat(tracking): implement AccountSelectionStep with GA4/Ads/Meta dropdowns"
```

---

### Task 12: Step 3 — GtmContainerStep

**Files:**
- Create: `src/views/admin/AdminHub/tracking/GtmContainerStep.jsx`

- [ ] **Step 1: Implement GtmContainerStep**

```jsx
import { useState, useEffect } from 'react';
import { Stack, Autocomplete, TextField, Button, Typography, Box, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LoadingButton from 'ui-component/extended/LoadingButton';
import StatusChip from 'ui-component/extended/StatusChip';
import { useToast } from 'contexts/ToastContext';
import { getGtmContainers, createGtmContainer, runProvisioning, publishGtm } from 'api/tracking';

const CREATE_NEW = { containerId: '__new__', publicId: '', name: '+ Create New Container' };

export default function GtmContainerStep({ config, saveConfig, onNext, onBack, onReload }) {
  const { showToast } = useToast();

  const [containers, setContainers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    setLoading(true);
    getGtmContainers()
      .then((list) => {
        setContainers(list);
        if (config?.gtm_container_id) {
          const match = list.find((c) => c.containerId === config.gtm_container_id);
          if (match) setSelected(match);
        }
      })
      .catch(() => showToast('Failed to load GTM containers', 'error'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProvision = async () => {
    setProvisioning(true);
    try {
      let containerId = selected?.containerId;
      let containerPublicId = selected?.publicId;
      let containerName = selected?.name;

      // Create new container if needed
      if (selected?.containerId === '__new__') {
        if (!newName.trim()) { showToast('Enter a container name', 'error'); return; }
        const created = await createGtmContainer(newName.trim());
        containerId = created.containerId;
        containerPublicId = created.publicId;
        containerName = created.name;
      }

      // Save container IDs to config
      const updated = await saveConfig({
        gtm_account_id: '6246584794',
        gtm_container_id: containerId,
        gtm_container_public_id: containerPublicId,
      });

      // Run provisioning
      await runProvisioning(updated.id);
      showToast('GTM container provisioned!', 'success');
      await onReload();
    } catch (err) {
      showToast(err.response?.data?.message || 'Provisioning failed', 'error');
    } finally {
      setProvisioning(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await publishGtm(config.id);
      showToast('GTM container published!', 'success');
      await onReload();
    } catch (err) {
      showToast(err.response?.data?.message || 'Publishing failed', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const copySnippet = () => {
    if (config?.install_snippet) {
      navigator.clipboard.writeText(config.install_snippet);
      showToast('Snippet copied to clipboard', 'success');
    }
  };

  const isCreateNew = selected?.containerId === '__new__';
  const isProvisioned = config?.provisioning_status === 'provisioned' || config?.provisioning_status === 'published';

  return (
    <Stack spacing={2} sx={{ mt: 1, maxWidth: 600 }}>
      <Autocomplete
        options={[...containers, CREATE_NEW]}
        getOptionLabel={(o) => o?.containerId === '__new__' ? o.name : `${o.name} (${o.publicId})`}
        value={selected}
        onChange={(_, val) => setSelected(val)}
        renderInput={(params) => (
          <TextField {...params} label="GTM Container" placeholder="Select or create..." />
        )}
        loading={loading}
        isOptionEqualToValue={(o, v) => o.containerId === v.containerId}
      />

      {isCreateNew && (
        <TextField
          label="New Container Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g., TMJ North Texas"
          size="small"
        />
      )}

      <Stack direction="row" spacing={1} alignItems="center">
        <LoadingButton
          variant="contained"
          onClick={handleProvision}
          loading={provisioning}
          loadingLabel="Provisioning..."
          disabled={!selected}
        >
          {isProvisioned ? 'Re-Provision' : 'Provision GTM'}
        </LoadingButton>

        {isProvisioned && config?.provisioning_status !== 'published' && (
          <LoadingButton
            variant="outlined"
            onClick={handlePublish}
            loading={publishing}
            loadingLabel="Publishing..."
          >
            Publish
          </LoadingButton>
        )}

        {config?.provisioning_status && (
          <StatusChip status={config.provisioning_status} />
        )}
      </Stack>

      {config?.install_snippet && (
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2">Install Snippet</Typography>
            <Tooltip title="Copy to clipboard">
              <IconButton size="small" onClick={copySnippet}><ContentCopyIcon fontSize="small" /></IconButton>
            </Tooltip>
          </Stack>
          <Box
            component="pre"
            sx={{
              p: 1.5, bgcolor: 'grey.50', borderRadius: 1, fontSize: 12,
              overflow: 'auto', maxHeight: 200, border: '1px solid', borderColor: 'divider',
            }}
          >
            {config.install_snippet}
          </Box>
        </Box>
      )}

      <Stack direction="row" spacing={1}>
        <Button onClick={onBack}>Back</Button>
        <Button variant="contained" onClick={onNext} disabled={!isProvisioned}>
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/tracking/GtmContainerStep.jsx
git commit -m "feat(tracking): implement GtmContainerStep with create/provision/publish"
```

---

### Task 13: Step 4 — ConversionEventsStep

**Files:**
- Create: `src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx`

- [ ] **Step 1: Implement ConversionEventsStep**

```jsx
import { useState, useEffect } from 'react';
import { Stack, Button, Checkbox, MenuItem, Select, FormControl } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import LoadingButton from 'ui-component/extended/LoadingButton';
import EmptyState from 'ui-component/extended/EmptyState';
import DataTable from 'ui-component/extended/DataTable';
import { useToast } from 'contexts/ToastContext';
import { getConversionActions, saveConversionMappings } from 'api/tracking';

const INTERNAL_EVENTS = [
  { value: 'unmapped', label: 'Unmapped' },
  { value: 'form_submitted', label: 'Form Submitted' },
  { value: 'qualified_call', label: 'Qualified Call' },
  { value: 'new_client', label: 'New Client' },
  { value: 'appointment_request', label: 'Appointment Request' },
];

function autoMatch(name) {
  const lower = name.toLowerCase();
  if (/lead|form|submit/.test(lower)) return 'form_submitted';
  if (/call|phone/.test(lower)) return 'qualified_call';
  if (/client|customer|sale|purchase/.test(lower)) return 'new_client';
  if (/appointment|booking|schedule/.test(lower)) return 'appointment_request';
  return 'unmapped';
}

export default function ConversionEventsStep({ config, onNext, onBack }) {
  const { showToast } = useToast();
  const [actions, setActions] = useState([]);
  const [mappings, setMappings] = useState({});
  const [enabled, setEnabled] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const customerId = config?.google_ads_customer_id;

  const loadActions = async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const list = await getConversionActions(customerId);
      setActions(list);

      // Initialize mappings from config or auto-match
      const existingMappings = config?.conversion_mappings || {};
      const reverseMap = {};
      for (const [event, mapping] of Object.entries(existingMappings)) {
        if (mapping?.conversion_action_id) reverseMap[mapping.conversion_action_id] = event;
      }

      const newMappings = {};
      const newEnabled = {};
      for (const action of list) {
        const existing = reverseMap[action.id];
        newMappings[action.id] = existing || autoMatch(action.name);
        newEnabled[action.id] = !!existing || autoMatch(action.name) !== 'unmapped';
      }
      setMappings(newMappings);
      setEnabled(newEnabled);
    } catch {
      showToast('Failed to load conversion actions', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadActions(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      // Build mappings object: { internal_event: { conversion_action_id, name } }
      const result = {};
      for (const action of actions) {
        if (!enabled[action.id]) continue;
        const event = mappings[action.id];
        if (!event || event === 'unmapped') continue;
        result[event] = { conversion_action_id: action.id, name: action.name };
      }
      await saveConversionMappings(config.id, result);
      showToast('Conversion mappings saved', 'success');
      onNext();
    } catch {
      showToast('Failed to save mappings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!customerId) {
    return (
      <Stack spacing={2} sx={{ mt: 1 }}>
        <EmptyState
          title="No Google Ads account selected"
          message="Go back to Step 2 and select a Google Ads account to configure conversion events."
        />
        <Button onClick={onBack}>Back</Button>
      </Stack>
    );
  }

  const columns = [
    {
      id: 'enabled',
      label: '',
      width: 40,
      render: (row) => (
        <Checkbox
          checked={!!enabled[row.id]}
          onChange={(e) => setEnabled((prev) => ({ ...prev, [row.id]: e.target.checked }))}
          size="small"
        />
      ),
    },
    { id: 'name', label: 'Conversion Action', sortable: true },
    { id: 'type', label: 'Type', width: 120, sortable: true },
    {
      id: 'mapping',
      label: 'Map To',
      width: 180,
      render: (row) => (
        <FormControl size="small" fullWidth>
          <Select
            value={mappings[row.id] || 'unmapped'}
            onChange={(e) => setMappings((prev) => ({ ...prev, [row.id]: e.target.value }))}
            disabled={!enabled[row.id]}
          >
            {INTERNAL_EVENTS.map((ev) => (
              <MenuItem key={ev.value} value={ev.value}>{ev.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <LoadingButton
          variant="outlined"
          size="small"
          startIcon={<RefreshIcon />}
          onClick={loadActions}
          loading={loading}
          loadingLabel="Refreshing..."
        >
          Refresh
        </LoadingButton>
      </Stack>

      <DataTable
        columns={columns}
        rows={actions}
        rowKey="id"
        loading={loading}
        emptyTitle="No conversion actions found"
        emptyMessage="Create conversion actions in Google Ads → Goals → Conversions, then refresh."
        size="small"
      />

      <Stack direction="row" spacing={1}>
        <Button onClick={onBack}>Back</Button>
        <LoadingButton
          variant="contained"
          onClick={handleSave}
          loading={saving}
          loadingLabel="Saving..."
        >
          Next
        </LoadingButton>
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx
git commit -m "feat(tracking): implement ConversionEventsStep with auto-pull and mapping"
```

---

### Task 14: Step 5 — InstallStatusStep

**Files:**
- Create: `src/views/admin/AdminHub/tracking/InstallStatusStep.jsx`

- [ ] **Step 1: Implement InstallStatusStep**

```jsx
import { useState } from 'react';
import { Stack, Box, Typography, Switch, FormControlLabel, IconButton, Tooltip, Divider, Chip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import LoadingButton from 'ui-component/extended/LoadingButton';
import StatusChip from 'ui-component/extended/StatusChip';
import { useToast } from 'contexts/ToastContext';
import { toggleRelay, runProvisioning } from 'api/tracking';

export default function InstallStatusStep({ config, onBack, onReload }) {
  const { showToast } = useToast();
  const [togglingRelay, setTogglingRelay] = useState(false);
  const [reprovisioning, setReprovisioning] = useState(false);

  const handleRelayToggle = async (e) => {
    setTogglingRelay(true);
    try {
      await toggleRelay(config.id, e.target.checked);
      showToast(e.target.checked ? 'Event relay enabled' : 'Event relay disabled', 'success');
      await onReload();
    } catch {
      showToast('Failed to toggle relay', 'error');
    } finally {
      setTogglingRelay(false);
    }
  };

  const handleReprovision = async () => {
    setReprovisioning(true);
    try {
      await runProvisioning(config.id);
      showToast('GTM container re-provisioned', 'success');
      await onReload();
    } catch (err) {
      showToast(err.response?.data?.message || 'Re-provisioning failed', 'error');
    } finally {
      setReprovisioning(false);
    }
  };

  const copySnippet = () => {
    if (config?.install_snippet) {
      navigator.clipboard.writeText(config.install_snippet);
      showToast('Snippet copied to clipboard', 'success');
    }
  };

  return (
    <Stack spacing={3} sx={{ mt: 1, maxWidth: 700 }}>
      {/* Status */}
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="subtitle2">Status:</Typography>
        <StatusChip status={config?.provisioning_status || 'draft'} />
        {config?.updated_at && (
          <Typography variant="caption" color="text.secondary">
            Last updated: {new Date(config.updated_at).toLocaleString()}
          </Typography>
        )}
      </Stack>

      {/* Relay Toggle */}
      <FormControlLabel
        control={
          <Switch
            checked={!!config?.relay_enabled}
            onChange={handleRelayToggle}
            disabled={togglingRelay}
          />
        }
        label="Server-side event relay (GA4 + Meta CAPI + Google Ads)"
      />

      <Divider />

      {/* Account Summary */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Linked Accounts</Typography>
        <Stack spacing={0.5}>
          <Typography variant="body2">
            <strong>GA4:</strong> {config?.ga4_measurement_id || '—'} (Property {config?.ga4_property_id || '—'})
          </Typography>
          <Typography variant="body2">
            <strong>Google Ads:</strong> {config?.google_ads_customer_id || '—'}
          </Typography>
          <Typography variant="body2">
            <strong>Meta:</strong> {config?.meta_ad_account_id || '—'} / Pixel {config?.meta_pixel_id || '—'}
          </Typography>
          <Typography variant="body2">
            <strong>GTM:</strong> {config?.gtm_container_public_id || '—'}
          </Typography>
        </Stack>
      </Box>

      <Divider />

      {/* GTM Snippet */}
      {config?.install_snippet && (
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2">GTM Install Snippet</Typography>
            <Tooltip title="Copy to clipboard">
              <IconButton size="small" onClick={copySnippet}><ContentCopyIcon fontSize="small" /></IconButton>
            </Tooltip>
          </Stack>
          <Box
            component="pre"
            sx={{
              p: 1.5, bgcolor: 'grey.50', borderRadius: 1, fontSize: 12,
              overflow: 'auto', maxHeight: 200, border: '1px solid', borderColor: 'divider',
            }}
          >
            {config.install_snippet}
          </Box>
        </Box>
      )}

      {/* Actions */}
      <Stack direction="row" spacing={1}>
        <LoadingButton
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleReprovision}
          loading={reprovisioning}
          loadingLabel="Re-provisioning..."
        >
          Re-Provision GTM
        </LoadingButton>
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 2: Build check**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/tracking/InstallStatusStep.jsx
git commit -m "feat(tracking): implement InstallStatusStep with snippet, relay toggle, status"
```

---

## Phase 4: Integration & Polish

### Task 15: Add GTM_ACCOUNT_ID to Environment

**Files:**
- Modify: `.env` (local only, add comment)

- [ ] **Step 1: Add GTM_ACCOUNT_ID to .env**

Add to the `.env` file near the other Google-related vars:

```
GTM_ACCOUNT_ID=6246584794
```

- [ ] **Step 2: Add to Secret Manager and Cloud Run**

```bash
echo -n "6246584794" | gcloud secrets create GTM_ACCOUNT_ID --data-file=- 2>&1
gcloud run services update anchor-hub --region=us-central1 --update-secrets="GTM_ACCOUNT_ID=GTM_ACCOUNT_ID:latest"
```

- [ ] **Step 3: Commit**

No commit needed — `.env` is gitignored.

---

### Task 16: Full Build and Visual Verification

- [ ] **Step 1: Full build check**

```bash
yarn build
```

Expected: No errors.

- [ ] **Step 2: Lint check**

```bash
yarn lint
```

Expected: No new warnings/errors.

- [ ] **Step 3: Start server and check endpoints**

```bash
yarn server
```

In a separate terminal, test:

```bash
curl -s http://localhost:4000/api/hub/tracking/accounts/ga4 -H "Authorization: Bearer <token>" | head -200
curl -s http://localhost:4000/api/hub/tracking/accounts/google-ads -H "Authorization: Bearer <token>" | head -200
curl -s http://localhost:4000/api/hub/tracking/accounts/meta -H "Authorization: Bearer <token>" | head -200
```

Expected: JSON responses with account lists.

- [ ] **Step 4: Visual verification**

Start frontend with `yarn start`. Navigate to AdminHub → select a client → click Tracking tab.

Verify:
- Wizard stepper renders with 5 steps
- Step 1: Medical/Non-Medical radio buttons work
- Step 2: GA4, Google Ads, Meta dropdowns populate and are searchable
- Step 3: GTM container dropdown loads, "Create New" option appears
- Step 4: Conversion actions load when Google Ads account is selected
- Step 5: Shows install snippet, relay toggle, status

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(tracking): complete tracking wizard implementation"
```
