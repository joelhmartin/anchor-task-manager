# Tracking Provisioning System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal tracking provisioning system in AdminHub that lets staff configure GTM containers per client, return a single install snippet for WordPress, and relay server-side conversion events to GA4/Meta with HIPAA-safe scrubbing for medical clients.

**Architecture:** New "Tracking" tab in AdminHub per client. Express backend handles GTM API provisioning (tags/triggers/variables) and runtime event relay to GA4 Measurement Protocol + Meta CAPI. Medical clients use allowlist-only field scrubbing; non-medical use permissive blocklist. No sGTM, no per-client Cloud Run, no first-party subdomains.

**Tech Stack:** React 19 + MUI v5 (frontend), Express.js (backend), PostgreSQL (data), Google Tag Manager API via `googleapis` package, GA4 Measurement Protocol, Meta Conversions API.

**Spec:** `docs/superpowers/specs/2026-03-31-tracking-provisioning-design.md`

**Verification:** This project has no test suite. Each task verifies via `yarn build` (no errors) + `yarn lint` (clean) + visual check where applicable.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `server/sql/migrate_tracking.sql` | Database migration — 4 new tables |
| `server/routes/tracking.js` | API endpoints for tracking CRUD, provisioning, relay |
| `server/services/trackingProvisioning.js` | GTM API integration — create workspace, apply templates, create version |
| `server/services/trackingRelay.js` | Runtime event relay — scrub, format, send to GA4/Meta |
| `server/services/trackingTemplates.js` | Template loading, placeholder substitution |
| `src/api/tracking.js` | Frontend API client |
| `src/views/admin/AdminHub/TrackingTab.jsx` | AdminHub tab — form, status, snippet, relay log |

### Modified Files

| File | Change |
|------|--------|
| `server/index.js` | Add migration function + chain, mount tracking routes |
| `server/services/forms.js` | Hook relay after form submission (~line 534) |
| `server/services/ctm.js` | Hook relay after call classification (~line 706) |
| `server/routes/hub.js` | Hook relay after active client creation (~line 6833) |
| `src/views/admin/AdminHub.jsx` | Add Tracking tab (index 9), import TrackingTab |
| `package.json` | Add `googleapis` dependency |

---

## Phase 1: Foundation

### Task 1: Database Migration

**Files:**
- Create: `server/sql/migrate_tracking.sql`
- Modify: `server/index.js` (add migration function + chain it)

- [ ] **Step 1: Create the migration SQL file**

```sql
-- migrate_tracking.sql
-- Tracking provisioning system tables

-- 1. Tracking templates (reusable GTM tag/trigger/variable definitions)
CREATE TABLE IF NOT EXISTS tracking_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'web_container',
  description TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, version)
);

-- 2. Tracking configs (one per client — source of truth)
CREATE TABLE IF NOT EXISTS tracking_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL CHECK (client_type IN ('medical', 'non_medical')),
  website_domain TEXT NOT NULL,
  gtm_account_id TEXT,
  gtm_container_id TEXT,
  gtm_container_public_id TEXT,
  gtm_workspace_id TEXT,
  ga4_property_id TEXT,
  ga4_measurement_id TEXT,
  ga4_api_secret TEXT,
  google_ads_customer_id TEXT,
  google_ads_conversion_id TEXT,
  google_ads_conversion_label TEXT,
  meta_pixel_id TEXT,
  meta_capi_token TEXT,
  meta_test_event_code TEXT,
  allowed_events JSONB NOT NULL DEFAULT '["lead_submitted","qualified_call","new_client","appointment_request"]'::jsonb,
  blocked_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  browser_meta_pixel_enabled BOOLEAN NOT NULL DEFAULT false,
  relay_enabled BOOLEAN NOT NULL DEFAULT false,
  provisioning_status TEXT NOT NULL DEFAULT 'draft',
  gtm_version_id TEXT,
  install_snippet TEXT,
  config_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provisioned_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_configs_user ON tracking_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_tracking_configs_status ON tracking_configs(provisioning_status);

-- 3. Tracking provisioning jobs (audit of each provisioning run)
CREATE TABLE IF NOT EXISTS tracking_provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_config_id UUID NOT NULL REFERENCES tracking_configs(id) ON DELETE CASCADE,
  triggered_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tracking_jobs_config ON tracking_provisioning_jobs(tracking_config_id, created_at DESC);

-- 4. Tracking event log (audit trail for relay events)
CREATE TABLE IF NOT EXISTS tracking_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_config_id UUID NOT NULL REFERENCES tracking_configs(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  source_type TEXT,
  source_id UUID,
  payload_sent JSONB,
  response_status INT,
  response_body TEXT,
  success BOOLEAN,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_config ON tracking_event_log(tracking_config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_failed ON tracking_event_log(success) WHERE success = false;

-- 5. Seed the standard web container template v1
INSERT INTO tracking_templates (name, template_type, description, tags, triggers, variables, version, is_active)
VALUES (
  'standard_web_v1',
  'web_container',
  'Standard web container template with GA4, Google Ads remarketing, and optional Meta Pixel',
  '[
    {
      "name": "GA4 Configuration",
      "type": "gaawc",
      "parameter": [
        {"type": "template", "key": "measurementId", "value": "{{ga4_measurement_id}}"}
      ],
      "firingTriggerId": ["__ALL_PAGES"]
    },
    {
      "name": "Google Ads Remarketing",
      "type": "awct",
      "parameter": [
        {"type": "template", "key": "conversionId", "value": "{{google_ads_conversion_id}}"},
        {"type": "template", "key": "conversionLabel", "value": "{{google_ads_conversion_label}}"}
      ],
      "firingTriggerId": ["__ALL_PAGES"]
    },
    {
      "name": "Meta Pixel - PageView",
      "type": "html",
      "parameter": [
        {
          "type": "template",
          "key": "html",
          "value": "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version=\"2.0\";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,\"script\",\"https://connect.facebook.net/en_US/fbevents.js\");fbq(\"init\",\"{{meta_pixel_id}}\");fbq(\"track\",\"PageView\");</script>"
        }
      ],
      "firingTriggerId": ["__ALL_PAGES"],
      "meta": {"conditional": "browser_meta_pixel_enabled"}
    }
  ]'::jsonb,
  '[
    {
      "name": "CTA Click",
      "type": "click",
      "filter": [
        {"type": "cssSelector", "parameter": [{"type": "template", "key": "value", "value": ".cta, [data-cta], a[href^=\"tel:\"]"}]}
      ]
    },
    {
      "name": "Scroll Depth",
      "type": "scrollDepth",
      "parameter": [
        {"type": "template", "key": "verticalThresholdsPercent", "value": "25,50,75,90"}
      ]
    },
    {
      "name": "Form Embed View",
      "type": "elementVisibility",
      "parameter": [
        {"type": "template", "key": "elementSelector", "value": ".anchor-form-embed, [data-anchor-form]"},
        {"type": "template", "key": "firingFrequency", "value": "ONCE_PER_PAGE"}
      ]
    }
  ]'::jsonb,
  '[
    {
      "name": "GA4 Measurement ID",
      "type": "constant",
      "parameter": [{"type": "template", "key": "value", "value": "{{ga4_measurement_id}}"}]
    },
    {
      "name": "Google Ads Conversion ID",
      "type": "constant",
      "parameter": [{"type": "template", "key": "value", "value": "{{google_ads_conversion_id}}"}]
    },
    {
      "name": "Google Ads Conversion Label",
      "type": "constant",
      "parameter": [{"type": "template", "key": "value", "value": "{{google_ads_conversion_label}}"}]
    },
    {
      "name": "Meta Pixel ID",
      "type": "constant",
      "parameter": [{"type": "template", "key": "value", "value": "{{meta_pixel_id}}"}]
    }
  ]'::jsonb,
  1,
  true
)
ON CONFLICT (name, version) DO NOTHING;
```

- [ ] **Step 2: Add migration function to server/index.js**

Find the last `maybeRun*Migration` function definition in `server/index.js` and add after it:

```javascript
async function maybeRunTrackingMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_tracking.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}
```

Then find the migration chain (the `.then()` chain ending with `registerTaskEventSubscribers()`) and add `.then(maybeRunTrackingMigration)` before the final `.then(() => { ... registerTaskEventSubscribers(); })`.

- [ ] **Step 3: Verify migration runs**

Start the server and check logs:
```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn server
```
Expected: `[migrations] ran migrate_tracking.sql` in output.

Then verify tables exist:
```bash
psql postgresql://bif@localhost:5432/anchor -c "\dt tracking_*"
```
Expected: 4 tables listed (tracking_configs, tracking_provisioning_jobs, tracking_event_log, tracking_templates).

Verify template seed:
```bash
psql postgresql://bif@localhost:5432/anchor -c "SELECT name, template_type, version FROM tracking_templates"
```
Expected: One row: `standard_web_v1 | web_container | 1`.

- [ ] **Step 4: Commit**

```bash
git add server/sql/migrate_tracking.sql server/index.js
git commit -m "feat(tracking): add database migration for tracking provisioning tables"
```

---

### Task 2: Backend API — CRUD Routes

**Files:**
- Create: `server/routes/tracking.js`
- Modify: `server/index.js` (mount routes)

- [ ] **Step 1: Create the tracking routes file**

```javascript
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../middleware/roles.js';
import { query } from '../db.js';
import { encrypt, decrypt } from '../services/security/encryption.js';

const router = express.Router();

// All routes require admin auth
router.use(requireAuth, isAdmin);

// Encrypted field names for tracking_configs
const ENCRYPTED_FIELDS = ['ga4_api_secret', 'meta_capi_token'];

function decryptConfig(row) {
  if (!row) return row;
  for (const field of ENCRYPTED_FIELDS) {
    if (row[field]) row[field] = decrypt(row[field]);
  }
  return row;
}

function maskSecret(value) {
  if (!value || value.length < 8) return value ? '••••••••' : null;
  return '••••' + value.slice(-4);
}

function toPublicConfig(row) {
  if (!row) return row;
  return {
    ...row,
    ga4_api_secret: maskSecret(row.ga4_api_secret),
    meta_capi_token: maskSecret(row.meta_capi_token),
  };
}

// GET /api/hub/tracking/:userId — get tracking config for a client
router.get('/:userId', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT tc.*, u.first_name, u.last_name, u.email
       FROM tracking_configs tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.user_id = $1`,
      [req.params.userId]
    );
    if (rows.length === 0) {
      return res.json({ config: null });
    }
    const config = decryptConfig(rows[0]);
    res.json({ config: toPublicConfig(config) });
  } catch (err) {
    console.error('[tracking:get]', err);
    res.status(500).json({ message: 'Failed to load tracking config' });
  }
});

// POST /api/hub/tracking — create tracking config
router.post('/', async (req, res) => {
  try {
    const {
      user_id, client_type, website_domain, gtm_account_id, gtm_container_id,
      gtm_container_public_id, ga4_property_id, ga4_measurement_id, ga4_api_secret,
      google_ads_customer_id, google_ads_conversion_id, google_ads_conversion_label,
      meta_pixel_id, meta_capi_token, meta_test_event_code,
      allowed_events, blocked_fields, consent_defaults,
      browser_meta_pixel_enabled
    } = req.body;

    if (!user_id || !client_type || !website_domain) {
      return res.status(400).json({ message: 'user_id, client_type, and website_domain are required' });
    }
    if (!['medical', 'non_medical'].includes(client_type)) {
      return res.status(400).json({ message: 'client_type must be medical or non_medical' });
    }

    const { rows } = await query(
      `INSERT INTO tracking_configs (
        user_id, client_type, website_domain, gtm_account_id, gtm_container_id,
        gtm_container_public_id, ga4_property_id, ga4_measurement_id, ga4_api_secret,
        google_ads_customer_id, google_ads_conversion_id, google_ads_conversion_label,
        meta_pixel_id, meta_capi_token, meta_test_event_code,
        allowed_events, blocked_fields, consent_defaults,
        browser_meta_pixel_enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`,
      [
        user_id, client_type, website_domain, gtm_account_id || null, gtm_container_id || null,
        gtm_container_public_id || null, ga4_property_id || null, ga4_measurement_id || null,
        ga4_api_secret ? encrypt(ga4_api_secret) : null,
        google_ads_customer_id || null, google_ads_conversion_id || null, google_ads_conversion_label || null,
        meta_pixel_id || null, meta_capi_token ? encrypt(meta_capi_token) : null,
        meta_test_event_code || null,
        JSON.stringify(allowed_events || ['lead_submitted', 'qualified_call', 'new_client', 'appointment_request']),
        JSON.stringify(blocked_fields || []),
        JSON.stringify(consent_defaults || {}),
        browser_meta_pixel_enabled || false
      ]
    );
    const config = decryptConfig(rows[0]);
    res.status(201).json({ config: toPublicConfig(config) });
  } catch (err) {
    if (err.code === '23505' && err.constraint?.includes('user_id')) {
      return res.status(409).json({ message: 'Tracking config already exists for this client' });
    }
    console.error('[tracking:create]', err);
    res.status(500).json({ message: 'Failed to create tracking config' });
  }
});

// PUT /api/hub/tracking/:id — update tracking config
router.put('/:id', async (req, res) => {
  try {
    const {
      client_type, website_domain, gtm_account_id, gtm_container_id,
      gtm_container_public_id, ga4_property_id, ga4_measurement_id, ga4_api_secret,
      google_ads_customer_id, google_ads_conversion_id, google_ads_conversion_label,
      meta_pixel_id, meta_capi_token, meta_test_event_code,
      allowed_events, blocked_fields, consent_defaults,
      browser_meta_pixel_enabled
    } = req.body;

    // Fetch current to preserve encrypted fields if not being updated
    const { rows: existing } = await query(
      `SELECT * FROM tracking_configs WHERE id = $1`,
      [req.params.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Tracking config not found' });
    }

    const current = existing[0];

    // Only re-encrypt if a new value was provided (not the masked version)
    const newApiSecret = ga4_api_secret && !ga4_api_secret.startsWith('••••')
      ? encrypt(ga4_api_secret) : current.ga4_api_secret;
    const newCapiToken = meta_capi_token && !meta_capi_token.startsWith('••••')
      ? encrypt(meta_capi_token) : current.meta_capi_token;

    const { rows } = await query(
      `UPDATE tracking_configs SET
        client_type = COALESCE($1, client_type),
        website_domain = COALESCE($2, website_domain),
        gtm_account_id = COALESCE($3, gtm_account_id),
        gtm_container_id = COALESCE($4, gtm_container_id),
        gtm_container_public_id = COALESCE($5, gtm_container_public_id),
        ga4_property_id = COALESCE($6, ga4_property_id),
        ga4_measurement_id = COALESCE($7, ga4_measurement_id),
        ga4_api_secret = $8,
        google_ads_customer_id = COALESCE($9, google_ads_customer_id),
        google_ads_conversion_id = COALESCE($10, google_ads_conversion_id),
        google_ads_conversion_label = COALESCE($11, google_ads_conversion_label),
        meta_pixel_id = COALESCE($12, meta_pixel_id),
        meta_capi_token = $13,
        meta_test_event_code = COALESCE($14, meta_test_event_code),
        allowed_events = COALESCE($15, allowed_events),
        blocked_fields = COALESCE($16, blocked_fields),
        consent_defaults = COALESCE($17, consent_defaults),
        browser_meta_pixel_enabled = COALESCE($18, browser_meta_pixel_enabled),
        updated_at = NOW()
      WHERE id = $19
      RETURNING *`,
      [
        client_type, website_domain, gtm_account_id, gtm_container_id,
        gtm_container_public_id, ga4_property_id, ga4_measurement_id, newApiSecret,
        google_ads_customer_id, google_ads_conversion_id, google_ads_conversion_label,
        meta_pixel_id, newCapiToken, meta_test_event_code,
        allowed_events ? JSON.stringify(allowed_events) : null,
        blocked_fields ? JSON.stringify(blocked_fields) : null,
        consent_defaults ? JSON.stringify(consent_defaults) : null,
        browser_meta_pixel_enabled,
        req.params.id
      ]
    );
    const config = decryptConfig(rows[0]);
    res.json({ config: toPublicConfig(config) });
  } catch (err) {
    console.error('[tracking:update]', err);
    res.status(500).json({ message: 'Failed to update tracking config' });
  }
});

// GET /api/hub/tracking/:id/jobs — provisioning job history
router.get('/:id/jobs', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT j.*, u.first_name, u.last_name
       FROM tracking_provisioning_jobs j
       JOIN users u ON u.id = j.triggered_by
       WHERE j.tracking_config_id = $1
       ORDER BY j.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );
    res.json({ jobs: rows });
  } catch (err) {
    console.error('[tracking:jobs]', err);
    res.status(500).json({ message: 'Failed to load provisioning jobs' });
  }
});

// GET /api/hub/tracking/:id/events — event relay log
router.get('/:id/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const { rows } = await query(
      `SELECT * FROM tracking_event_log
       WHERE tracking_config_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json({ events: rows });
  } catch (err) {
    console.error('[tracking:events]', err);
    res.status(500).json({ message: 'Failed to load event log' });
  }
});

// POST /api/hub/tracking/:id/relay-toggle — enable/disable relay
router.post('/:id/relay-toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const { rows } = await query(
      `UPDATE tracking_configs SET relay_enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [!!enabled, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Tracking config not found' });
    }
    res.json({ relay_enabled: rows[0].relay_enabled });
  } catch (err) {
    console.error('[tracking:relay-toggle]', err);
    res.status(500).json({ message: 'Failed to toggle relay' });
  }
});

// GET /api/hub/tracking/templates/list — available templates
router.get('/templates/list', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, template_type, description, version, is_active, created_at
       FROM tracking_templates
       WHERE is_active = true
       ORDER BY name, version DESC`
    );
    res.json({ templates: rows });
  } catch (err) {
    console.error('[tracking:templates]', err);
    res.status(500).json({ message: 'Failed to load templates' });
  }
});

export default router;
```

- [ ] **Step 2: Mount routes in server/index.js**

Find the route mounting section in `server/index.js` (near lines where other routers are imported and mounted). Add:

Import at top with other route imports:
```javascript
import trackingRouter from './routes/tracking.js';
```

Mount after other `/api/hub/` routes:
```javascript
app.use('/api/hub/tracking', trackingRouter);
```

**Important:** The `/api/hub/tracking/templates/list` route must be mounted BEFORE the `/:userId` route to avoid `templates` being treated as a userId param. In the routes file, the `templates/list` route is already defined after `/:id/events`, but Express matches top-down. Move the templates route above the `/:userId` route:

Actually, looking at the route file again — the templates route uses path `/templates/list` which won't conflict with `/:userId` because `templates` is a static segment before `list`. But `/:id/jobs` and `/:id/events` will work fine because they have the sub-path. The only issue is `/:userId` vs `/templates/list` — Express will try to match `templates` as a userId first. Fix this by reordering: put the `/templates/list` route BEFORE `/:userId` in the file.

- [ ] **Step 3: Run build to verify no errors**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Test API with curl**

Start the server, then test:
```bash
# Get config for a user (should return null)
curl -s http://localhost:4000/api/hub/tracking/SOME_USER_UUID \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .

# List templates (should return the seed template)
curl -s http://localhost:4000/api/hub/tracking/templates/list \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/tracking.js server/index.js
git commit -m "feat(tracking): add CRUD API routes for tracking configs"
```

---

### Task 3: Frontend API Client

**Files:**
- Create: `src/api/tracking.js`

- [ ] **Step 1: Create the API client module**

```javascript
import client from './client';

// -- Config CRUD --

export function getTrackingConfig(userId) {
  return client.get(`/hub/tracking/${userId}`).then((res) => res.data);
}

export function createTrackingConfig(data) {
  return client.post('/hub/tracking', data).then((res) => res.data);
}

export function updateTrackingConfig(id, data) {
  return client.put(`/hub/tracking/${id}`, data).then((res) => res.data);
}

// -- Provisioning --

export function runProvisioning(configId) {
  return client.post(`/hub/tracking/${configId}/provision`).then((res) => res.data);
}

export function publishGtm(configId) {
  return client.post(`/hub/tracking/${configId}/publish`).then((res) => res.data);
}

export function getProvisioningJobs(configId) {
  return client.get(`/hub/tracking/${configId}/jobs`).then((res) => res.data);
}

// -- Event Relay --

export function getEventLog(configId, { limit = 50, offset = 0 } = {}) {
  return client.get(`/hub/tracking/${configId}/events`, { params: { limit, offset } }).then((res) => res.data);
}

export function toggleRelay(configId, enabled) {
  return client.post(`/hub/tracking/${configId}/relay-toggle`, { enabled }).then((res) => res.data);
}

// -- Templates --

export function getTemplates() {
  return client.get('/hub/tracking/templates/list').then((res) => res.data);
}
```

- [ ] **Step 2: Run build to verify**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/api/tracking.js
git commit -m "feat(tracking): add frontend API client for tracking endpoints"
```

---

### Task 4: AdminHub TrackingTab — Setup Form

**Files:**
- Create: `src/views/admin/AdminHub/TrackingTab.jsx`
- Modify: `src/views/admin/AdminHub.jsx` (add tab)

- [ ] **Step 1: Create TrackingTab component**

```jsx
import { useState, useEffect, useCallback } from 'react';
import {
  Box, Stack, TextField, Typography, Switch, FormControlLabel,
  Divider, Chip, Checkbox, FormGroup, Alert, CircularProgress,
  IconButton, Tooltip, InputAdornment
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  RocketLaunch as ProvisionIcon,
  Publish as PublishIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import SubCard from 'ui-component/cards/SubCard';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import StatusChip from 'ui-component/extended/StatusChip';
import DataTable from 'ui-component/extended/DataTable';
import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errorUtils';
import {
  getTrackingConfig, createTrackingConfig, updateTrackingConfig,
  runProvisioning, publishGtm, getProvisioningJobs, getEventLog, toggleRelay
} from 'api/tracking';

const SERVER_EVENTS = [
  { value: 'lead_submitted', label: 'Lead Submitted' },
  { value: 'qualified_call', label: 'Qualified Call' },
  { value: 'new_client', label: 'New Client' },
  { value: 'appointment_request', label: 'Appointment Request' },
];

const DEFAULT_ALLOWED_EVENTS = SERVER_EVENTS.map((e) => e.value);

export default function TrackingTab({ clientId }) {
  const { showToast } = useToast();

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showSecrets, setShowSecrets] = useState({});
  const [provisioning, setProvisioning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Load config
  const loadConfig = useCallback(async () => {
    try {
      const data = await getTrackingConfig(clientId);
      setConfig(data.config);
      if (data.config) {
        setForm({ ...data.config });
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load tracking config'), 'error');
    } finally {
      setLoading(false);
    }
  }, [clientId, showToast]);

  // Load jobs
  const loadJobs = useCallback(async (configId) => {
    try {
      const data = await getProvisioningJobs(configId);
      setJobs(data.jobs || []);
    } catch (err) {
      // silent — non-critical
    }
  }, []);

  // Load events
  const loadEvents = useCallback(async (configId) => {
    setEventsLoading(true);
    try {
      const data = await getEventLog(configId);
      setEvents(data.events || []);
    } catch (err) {
      // silent — non-critical
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config?.id) {
      loadJobs(config.id);
      loadEvents(config.id);
    }
  }, [config?.id, loadJobs, loadEvents]);

  // Handlers
  const handleChange = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEventToggle = (eventName) => {
    setForm((prev) => {
      const current = prev.allowed_events || [];
      const next = current.includes(eventName)
        ? current.filter((e) => e !== eventName)
        : [...current, eventName];
      return { ...prev, allowed_events: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (config) {
        const data = await updateTrackingConfig(config.id, form);
        setConfig(data.config);
        setForm({ ...data.config });
        setEditing(false);
        showToast('Tracking config updated', 'success');
      } else {
        const data = await createTrackingConfig({ ...form, user_id: clientId });
        setConfig(data.config);
        setForm({ ...data.config });
        setEditing(false);
        showToast('Tracking config created', 'success');
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save tracking config'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleProvision = async () => {
    setProvisioning(true);
    try {
      const data = await runProvisioning(config.id);
      setConfig(data.config);
      setForm({ ...data.config });
      loadJobs(config.id);
      showToast('GTM provisioning complete', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Provisioning failed'), 'error');
      loadJobs(config.id);
    } finally {
      setProvisioning(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const data = await publishGtm(config.id);
      setConfig(data.config);
      setForm({ ...data.config });
      showToast('GTM container published', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Publish failed'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleRelayToggle = async () => {
    try {
      const data = await toggleRelay(config.id, !config.relay_enabled);
      setConfig((prev) => ({ ...prev, relay_enabled: data.relay_enabled }));
      showToast(data.relay_enabled ? 'Event relay enabled' : 'Event relay disabled', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to toggle relay'), 'error');
    }
  };

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(config.install_snippet);
    showToast('Snippet copied to clipboard', 'success');
  };

  const toggleSecret = (field) => {
    setShowSecrets((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  // Render helpers
  const secretField = (label, field) => (
    <TextField
      label={label}
      value={form?.[field] || ''}
      onChange={handleChange(field)}
      disabled={!editing && !!config}
      fullWidth
      size="small"
      type={showSecrets[field] ? 'text' : 'password'}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => toggleSecret(field)}>
              {showSecrets[field] ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );

  // Loading
  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  }

  // Empty state — no config yet
  if (!config && !form) {
    return (
      <EmptyState
        title="No tracking setup yet"
        message="Set up GTM-based tracking for this client to get a single install snippet for their website."
        action={
          <LoadingButton
            variant="contained"
            onClick={() => {
              setForm({
                client_type: 'medical',
                website_domain: '',
                gtm_account_id: '',
                gtm_container_id: '',
                ga4_measurement_id: '',
                ga4_api_secret: '',
                google_ads_conversion_id: '',
                google_ads_conversion_label: '',
                meta_pixel_id: '',
                meta_capi_token: '',
                allowed_events: DEFAULT_ALLOWED_EVENTS,
                browser_meta_pixel_enabled: false,
              });
              setEditing(true);
            }}
          >
            Set Up Tracking
          </LoadingButton>
        }
      />
    );
  }

  const isEditing = editing || !config;
  const canProvision = config && config.gtm_container_id && config.provisioning_status !== 'published';
  const canPublish = config && config.provisioning_status === 'provisioned';

  return (
    <Stack spacing={2}>
      {/* Status Bar */}
      {config && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2">Status:</Typography>
          <StatusChip status={config.provisioning_status} />
          {config.provisioned_at && (
            <Typography variant="caption" color="text.secondary">
              Provisioned: {new Date(config.provisioned_at).toLocaleDateString()}
            </Typography>
          )}
          {config.published_at && (
            <Typography variant="caption" color="text.secondary">
              Published: {new Date(config.published_at).toLocaleDateString()}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {!isEditing && (
            <LoadingButton variant="outlined" size="small" onClick={() => setEditing(true)}>
              Edit
            </LoadingButton>
          )}
        </Box>
      )}

      {/* Client Type & Website */}
      <SubCard title="Client & Website">
        <Stack spacing={2}>
          <SelectField
            label="Client Type"
            value={form?.client_type || 'medical'}
            onChange={handleChange('client_type')}
            disabled={!isEditing}
            options={[
              { value: 'medical', label: 'Medical (HIPAA)' },
              { value: 'non_medical', label: 'Non-Medical' },
            ]}
            required
          />
          {form?.client_type === 'medical' && (
            <Alert severity="info" variant="outlined">
              Medical clients use allowlist-only scrubbing. Server-side events will only include event name, timestamp, source URL (domain only), and conversion value. All other fields are dropped.
            </Alert>
          )}
          <TextField
            label="Website Domain"
            value={form?.website_domain || ''}
            onChange={handleChange('website_domain')}
            disabled={!isEditing}
            fullWidth
            size="small"
            placeholder="https://example.com"
            required
          />
        </Stack>
      </SubCard>

      {/* GTM */}
      <SubCard title="Google Tag Manager">
        <Stack spacing={2}>
          <TextField
            label="GTM Account ID"
            value={form?.gtm_account_id || ''}
            onChange={handleChange('gtm_account_id')}
            disabled={!isEditing}
            fullWidth
            size="small"
            placeholder="123456789"
          />
          <TextField
            label="GTM Container ID"
            value={form?.gtm_container_id || ''}
            onChange={handleChange('gtm_container_id')}
            disabled={!isEditing}
            fullWidth
            size="small"
            placeholder="Container ID (from Google Tag Manager)"
            helperText="Create the container in Google Tag Manager, then enter its ID here"
          />
          {config?.gtm_container_public_id && (
            <TextField
              label="GTM Public ID"
              value={config.gtm_container_public_id}
              disabled
              fullWidth
              size="small"
            />
          )}
        </Stack>
      </SubCard>

      {/* GA4 */}
      <SubCard title="Google Analytics 4">
        <Stack spacing={2}>
          <TextField
            label="GA4 Property ID"
            value={form?.ga4_property_id || ''}
            onChange={handleChange('ga4_property_id')}
            disabled={!isEditing}
            fullWidth
            size="small"
          />
          <TextField
            label="GA4 Measurement ID"
            value={form?.ga4_measurement_id || ''}
            onChange={handleChange('ga4_measurement_id')}
            disabled={!isEditing}
            fullWidth
            size="small"
            placeholder="G-XXXXXXXXXX"
          />
          {secretField('GA4 API Secret (Measurement Protocol)', 'ga4_api_secret')}
        </Stack>
      </SubCard>

      {/* Google Ads */}
      <SubCard title="Google Ads">
        <Stack spacing={2}>
          <TextField
            label="Customer ID"
            value={form?.google_ads_customer_id || ''}
            onChange={handleChange('google_ads_customer_id')}
            disabled={!isEditing}
            fullWidth
            size="small"
            placeholder="123-456-7890"
          />
          <TextField
            label="Conversion ID"
            value={form?.google_ads_conversion_id || ''}
            onChange={handleChange('google_ads_conversion_id')}
            disabled={!isEditing}
            fullWidth
            size="small"
          />
          <TextField
            label="Conversion Label"
            value={form?.google_ads_conversion_label || ''}
            onChange={handleChange('google_ads_conversion_label')}
            disabled={!isEditing}
            fullWidth
            size="small"
          />
        </Stack>
      </SubCard>

      {/* Meta */}
      <SubCard title="Meta (Facebook)">
        <Stack spacing={2}>
          <TextField
            label="Pixel ID"
            value={form?.meta_pixel_id || ''}
            onChange={handleChange('meta_pixel_id')}
            disabled={!isEditing}
            fullWidth
            size="small"
          />
          {secretField('CAPI Access Token', 'meta_capi_token')}
          <TextField
            label="Test Event Code"
            value={form?.meta_test_event_code || ''}
            onChange={handleChange('meta_test_event_code')}
            disabled={!isEditing}
            fullWidth
            size="small"
            helperText="Optional — used for testing CAPI events in Meta Events Manager"
          />
          <FormControlLabel
            control={
              <Switch
                checked={form?.browser_meta_pixel_enabled || false}
                onChange={handleChange('browser_meta_pixel_enabled')}
                disabled={!isEditing}
              />
            }
            label="Enable browser-side Meta Pixel (PageView)"
          />
        </Stack>
      </SubCard>

      {/* Event Policy */}
      <SubCard title="Server-Side Event Policy">
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Select which conversion events the relay will send to GA4 and Meta:
          </Typography>
          <FormGroup>
            {SERVER_EVENTS.map((evt) => (
              <FormControlLabel
                key={evt.value}
                control={
                  <Checkbox
                    checked={(form?.allowed_events || []).includes(evt.value)}
                    onChange={() => handleEventToggle(evt.value)}
                    disabled={!isEditing}
                  />
                }
                label={evt.label}
              />
            ))}
          </FormGroup>
        </Stack>
      </SubCard>

      {/* Save / Cancel */}
      {isEditing && (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          {config && (
            <LoadingButton
              variant="outlined"
              onClick={() => { setForm({ ...config }); setEditing(false); }}
            >
              Cancel
            </LoadingButton>
          )}
          <LoadingButton
            variant="contained"
            loading={saving}
            loadingLabel="Saving..."
            onClick={handleSave}
          >
            {config ? 'Save Changes' : 'Create Config'}
          </LoadingButton>
        </Box>
      )}

      {/* Provisioning Controls */}
      {config && !isEditing && (
        <SubCard title="Provisioning">
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <LoadingButton
                variant="contained"
                startIcon={<ProvisionIcon />}
                loading={provisioning}
                loadingLabel="Provisioning..."
                onClick={handleProvision}
                disabled={!canProvision}
              >
                {config.provisioning_status === 'draft' ? 'Provision GTM' : 'Re-provision'}
              </LoadingButton>
              <LoadingButton
                variant="contained"
                color="success"
                startIcon={<PublishIcon />}
                loading={publishing}
                loadingLabel="Publishing..."
                onClick={handlePublish}
                disabled={!canPublish}
              >
                Publish
              </LoadingButton>
            </Box>

            {/* Job History */}
            {jobs.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Recent Provisioning Jobs</Typography>
                {jobs.slice(0, 3).map((job) => (
                  <Box key={job.id} sx={{ mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <StatusChip status={job.status} size="small" />
                      <Typography variant="caption">
                        {job.first_name} {job.last_name} — {new Date(job.created_at).toLocaleString()}
                      </Typography>
                    </Box>
                    {job.error_message && (
                      <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                        {job.error_message}
                      </Typography>
                    )}
                    {job.steps && job.steps.length > 0 && (
                      <Stack spacing={0.5} sx={{ mt: 1 }}>
                        {job.steps.map((step, i) => (
                          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Chip
                              label={step.status}
                              size="small"
                              color={step.status === 'completed' ? 'success' : step.status === 'failed' ? 'error' : 'default'}
                              variant="outlined"
                              sx={{ minWidth: 80 }}
                            />
                            <Typography variant="caption">{step.step}</Typography>
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        </SubCard>
      )}

      {/* Install Snippet */}
      {config?.install_snippet && (
        <SubCard
          title="Install Snippet"
          secondary={
            <Tooltip title="Copy to clipboard">
              <IconButton size="small" onClick={handleCopySnippet}>
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        >
          <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>
            Install this single snippet in the WordPress site header. It replaces all separate GA4, Google Ads, and Meta Pixel scripts.
          </Alert>
          <Box
            component="pre"
            sx={{
              p: 2, bgcolor: 'grey.900', color: 'grey.100', borderRadius: 1,
              overflow: 'auto', fontSize: '0.75rem', lineHeight: 1.5,
            }}
          >
            {config.install_snippet}
          </Box>
        </SubCard>
      )}

      {/* Event Relay */}
      {config && !isEditing && (
        <SubCard
          title="Event Relay"
          secondary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption">{config.relay_enabled ? 'Active' : 'Inactive'}</Typography>
              <Switch checked={config.relay_enabled || false} onChange={handleRelayToggle} size="small" />
              <IconButton size="small" onClick={() => loadEvents(config.id)}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Box>
          }
        >
          <DataTable
            columns={[
              { id: 'event_name', label: 'Event', sortable: true },
              { id: 'destination', label: 'Destination', sortable: true },
              {
                id: 'success',
                label: 'Status',
                render: (row) => <StatusChip status={row.success ? 'success' : 'failed'} size="small" />,
              },
              {
                id: 'created_at',
                label: 'Time',
                sortable: true,
                render: (row) => new Date(row.created_at).toLocaleString(),
              },
            ]}
            rows={events}
            loading={eventsLoading}
            emptyTitle="No relay events yet"
            emptyMessage={config.relay_enabled ? 'Events will appear here when conversions are relayed.' : 'Enable the relay to start sending events.'}
            size="small"
            paginated
            pageSize={10}
          />
        </SubCard>
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: Add Tracking tab to AdminHub.jsx**

First, add the import. Find the import block around line 91-100 (where CallTrackingTab, FormsTab, etc. are imported) and add:

```javascript
import TrackingTab from './AdminHub/TrackingTab';
```

Then find the `<Tabs>` component (around line 2077) and add after the last `<Tab>`:

```jsx
<Tab label="Tracking" />
```

Then find the tab content rendering section (around line 2089-2105) and add after the last `{activeTab === 8 && ...}` block:

```jsx
{activeTab === 9 && <TrackingTab clientId={editing.id} />}
```

- [ ] **Step 3: Run build to verify**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Visual verification**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn start
```

Open the admin portal, go to Client Hub, select a client. Verify:
- "Tracking" tab appears as the last tab
- Clicking it shows the EmptyState with "Set Up Tracking" button
- Clicking "Set Up Tracking" shows the form with all sections
- Medical/Non-Medical toggle shows the HIPAA alert for medical
- Secret fields show/hide toggle works
- Form validates and saves (create new config)
- After save, edit/cancel workflow works
- Provisioning controls appear (Provision GTM button disabled until GTM container ID is entered)

- [ ] **Step 5: Commit**

```bash
git add src/views/admin/AdminHub/TrackingTab.jsx src/views/admin/AdminHub.jsx
git commit -m "feat(tracking): add TrackingTab UI to AdminHub with setup form"
```

---

## Phase 2: GTM Provisioning

### Task 5: Install googleapis Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add googleapis package**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn add googleapis
```

- [ ] **Step 2: Verify build still works**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add googleapis dependency for GTM API integration"
```

---

### Task 6: Template Service

**Files:**
- Create: `server/services/trackingTemplates.js`

- [ ] **Step 1: Create the template service**

```javascript
import { query } from '../db.js';

/**
 * Load the active template by name.
 * Returns { tags, triggers, variables } with raw placeholder syntax.
 */
export async function loadTemplate(name = 'standard_web_v1') {
  const { rows } = await query(
    `SELECT * FROM tracking_templates WHERE name = $1 AND is_active = true ORDER BY version DESC LIMIT 1`,
    [name]
  );
  if (rows.length === 0) {
    throw new Error(`Template not found: ${name}`);
  }
  return rows[0];
}

/**
 * Substitute placeholders in template definitions with client-specific values.
 * Placeholders use {{key}} syntax.
 *
 * @param {Array} items - Array of tag/trigger/variable definitions (JSONB)
 * @param {Object} values - Key-value map: { ga4_measurement_id: 'G-XXXX', ... }
 * @returns {Array} - Items with placeholders replaced
 */
export function substituteValues(items, values) {
  const json = JSON.stringify(items);
  const substituted = json.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return values[key] !== undefined && values[key] !== null ? values[key] : '';
  });
  return JSON.parse(substituted);
}

/**
 * Build the placeholder values map from a tracking_configs row.
 */
export function buildValuesMap(config) {
  return {
    ga4_measurement_id: config.ga4_measurement_id || '',
    google_ads_conversion_id: config.google_ads_conversion_id || '',
    google_ads_conversion_label: config.google_ads_conversion_label || '',
    meta_pixel_id: config.meta_pixel_id || '',
  };
}

/**
 * Filter tags based on conditional metadata and config flags.
 * Tags with meta.conditional are only included if the config flag is truthy.
 */
export function filterConditionalTags(tags, config) {
  return tags.filter((tag) => {
    if (tag.meta?.conditional) {
      return !!config[tag.meta.conditional];
    }
    return true;
  });
}
```

- [ ] **Step 2: Run build to verify**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/trackingTemplates.js
git commit -m "feat(tracking): add template loading and placeholder substitution service"
```

---

### Task 7: Provisioning Service (GTM API)

**Files:**
- Create: `server/services/trackingProvisioning.js`

- [ ] **Step 1: Create the provisioning service**

```javascript
import { google } from 'googleapis';
import { query } from '../db.js';
import { loadTemplate, substituteValues, buildValuesMap, filterConditionalTags } from './trackingTemplates.js';

const tagmanager = google.tagmanager('v2');

/**
 * Get authenticated GTM API client using the default service account.
 * On Cloud Run, this uses the attached service account automatically.
 * Locally, it uses GOOGLE_APPLICATION_CREDENTIALS.
 */
async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/tagmanager.edit.containers',
             'https://www.googleapis.com/auth/tagmanager.publish'],
  });
  return auth.getClient();
}

/**
 * Update a provisioning job's step status.
 */
async function updateJobStep(jobId, stepName, status, message = '') {
  const { rows } = await query(
    `SELECT steps FROM tracking_provisioning_jobs WHERE id = $1`,
    [jobId]
  );
  const steps = rows[0]?.steps || [];
  steps.push({ step: stepName, status, message, timestamp: new Date().toISOString() });
  await query(
    `UPDATE tracking_provisioning_jobs SET steps = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(steps), jobId]
  );
}

/**
 * Run the full provisioning sequence for a tracking config.
 *
 * Steps:
 * 1. Validate config
 * 2. Create GTM workspace
 * 3. Apply variables from template
 * 4. Apply triggers from template
 * 5. Apply tags from template
 * 6. Create container version
 * 7. Generate install snippet
 * 8. Save results
 */
export async function provision(configId, triggeredBy) {
  // Create job record
  const { rows: jobRows } = await query(
    `INSERT INTO tracking_provisioning_jobs (tracking_config_id, triggered_by, status)
     VALUES ($1, $2, 'running') RETURNING id`,
    [configId, triggeredBy]
  );
  const jobId = jobRows[0].id;

  try {
    // Load config
    const { rows: configRows } = await query(
      `SELECT * FROM tracking_configs WHERE id = $1`,
      [configId]
    );
    if (configRows.length === 0) throw new Error('Config not found');
    const config = configRows[0];

    // Step 1: Validate
    if (!config.gtm_account_id || !config.gtm_container_id) {
      throw new Error('GTM account ID and container ID are required');
    }
    await updateJobStep(jobId, 'validate', 'completed', 'Config validated');

    const authClient = await getAuthClient();
    google.options({ auth: authClient });

    const containerPath = `accounts/${config.gtm_account_id}/containers/${config.gtm_container_id}`;

    // Step 2: Create workspace
    let workspace;
    try {
      const wsResponse = await tagmanager.accounts.containers.workspaces.create({
        parent: containerPath,
        requestBody: {
          name: `Anchor Provisioning ${new Date().toISOString().slice(0, 10)}`,
          description: 'Auto-provisioned by Anchor Client Dashboard',
        },
      });
      workspace = wsResponse.data;
      await updateJobStep(jobId, 'create_workspace', 'completed', `Workspace: ${workspace.workspaceId}`);
    } catch (err) {
      await updateJobStep(jobId, 'create_workspace', 'failed', err.message);
      throw err;
    }

    const workspacePath = `${containerPath}/workspaces/${workspace.workspaceId}`;

    // Load and prepare template
    const template = await loadTemplate('standard_web_v1');
    const values = buildValuesMap(config);

    // Step 3: Apply variables
    try {
      const variables = substituteValues(template.variables, values);
      for (const variable of variables) {
        await tagmanager.accounts.containers.workspaces.variables.create({
          parent: workspacePath,
          requestBody: {
            name: variable.name,
            type: variable.type,
            parameter: variable.parameter,
          },
        });
      }
      await updateJobStep(jobId, 'apply_variables', 'completed', `${variables.length} variables created`);
    } catch (err) {
      await updateJobStep(jobId, 'apply_variables', 'failed', err.message);
      throw err;
    }

    // Step 4: Apply triggers
    const triggerIdMap = {}; // maps template trigger name → created trigger ID
    try {
      const triggers = substituteValues(template.triggers, values);
      for (const trigger of triggers) {
        const resp = await tagmanager.accounts.containers.workspaces.triggers.create({
          parent: workspacePath,
          requestBody: {
            name: trigger.name,
            type: trigger.type,
            filter: trigger.filter,
            parameter: trigger.parameter,
          },
        });
        triggerIdMap[trigger.name] = resp.data.triggerId;
      }
      await updateJobStep(jobId, 'apply_triggers', 'completed', `${triggers.length} triggers created`);
    } catch (err) {
      await updateJobStep(jobId, 'apply_triggers', 'failed', err.message);
      throw err;
    }

    // Step 5: Apply tags
    try {
      let tags = substituteValues(template.tags, values);
      tags = filterConditionalTags(tags, config);

      for (const tag of tags) {
        // Resolve firing trigger IDs
        const firingTriggerId = (tag.firingTriggerId || []).map((tid) => {
          if (tid === '__ALL_PAGES') return tid; // built-in
          return triggerIdMap[tid] || tid;
        });

        const requestBody = {
          name: tag.name,
          type: tag.type,
          parameter: tag.parameter,
          firingTriggerId,
        };

        // For custom HTML tags, set the type properly
        if (tag.type === 'html') {
          requestBody.type = 'html';
        }

        await tagmanager.accounts.containers.workspaces.tags.create({
          parent: workspacePath,
          requestBody,
        });
      }
      await updateJobStep(jobId, 'apply_tags', 'completed', `${tags.length} tags created`);
    } catch (err) {
      await updateJobStep(jobId, 'apply_tags', 'failed', err.message);
      throw err;
    }

    // Step 6: Create version
    let version;
    try {
      const versionResponse = await tagmanager.accounts.containers.workspaces.create_version({
        path: workspacePath,
        requestBody: {
          name: `Anchor v${Date.now()}`,
          notes: 'Auto-provisioned by Anchor Client Dashboard',
        },
      });
      version = versionResponse.data.containerVersion;
      await updateJobStep(jobId, 'create_version', 'completed', `Version: ${version?.containerVersionId}`);
    } catch (err) {
      await updateJobStep(jobId, 'create_version', 'failed', err.message);
      throw err;
    }

    // Step 7: Generate snippet
    // The GTM public ID is on the container itself — fetch it if we don't have it
    let publicId = config.gtm_container_public_id;
    if (!publicId) {
      const containerResponse = await tagmanager.accounts.containers.get({
        path: containerPath,
      });
      publicId = containerResponse.data.publicId; // e.g., "GTM-XXXXXX"
    }

    const snippet = generateGtmSnippet(publicId);
    await updateJobStep(jobId, 'generate_snippet', 'completed', 'Snippet generated');

    // Step 8: Save results
    await query(
      `UPDATE tracking_configs SET
        gtm_container_public_id = $1,
        gtm_workspace_id = $2,
        gtm_version_id = $3,
        install_snippet = $4,
        provisioning_status = 'provisioned',
        provisioned_at = NOW(),
        updated_at = NOW()
      WHERE id = $5`,
      [publicId, workspace.workspaceId, version?.containerVersionId, snippet, configId]
    );

    // Mark job complete
    await query(
      `UPDATE tracking_provisioning_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [jobId]
    );

    // Return updated config
    const { rows: updated } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [configId]);
    return updated[0];
  } catch (err) {
    // Mark job failed
    await query(
      `UPDATE tracking_provisioning_jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, jobId]
    );
    throw err;
  }
}

/**
 * Publish the latest version of a GTM container.
 */
export async function publishVersion(configId) {
  const { rows } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [configId]);
  if (rows.length === 0) throw new Error('Config not found');
  const config = rows[0];

  if (!config.gtm_version_id) {
    throw new Error('No version to publish — run provisioning first');
  }

  const authClient = await getAuthClient();
  google.options({ auth: authClient });

  const versionPath = `accounts/${config.gtm_account_id}/containers/${config.gtm_container_id}/versions/${config.gtm_version_id}`;

  await tagmanager.accounts.containers.versions.publish({
    path: versionPath,
  });

  await query(
    `UPDATE tracking_configs SET
      provisioning_status = 'published',
      published_at = NOW(),
      updated_at = NOW()
    WHERE id = $1`,
    [configId]
  );

  const { rows: updated } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [configId]);
  return updated[0];
}

/**
 * Generate the GTM install snippet HTML.
 */
function generateGtmSnippet(publicId) {
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${publicId}');</script>
<!-- End Google Tag Manager -->

<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${publicId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;
}
```

- [ ] **Step 2: Add provision and publish routes to tracking.js**

Add these routes to `server/routes/tracking.js`, after the existing routes and before `export default router`:

```javascript
import { provision, publishVersion } from '../services/trackingProvisioning.js';

// POST /api/hub/tracking/:id/provision — run provisioning
router.post('/:id/provision', async (req, res) => {
  try {
    const config = await provision(req.params.id, req.user.id);
    res.json({ config: toPublicConfig(decryptConfig(config)) });
  } catch (err) {
    console.error('[tracking:provision]', err);
    res.status(500).json({ message: err.message || 'Provisioning failed' });
  }
});

// POST /api/hub/tracking/:id/publish — publish GTM version
router.post('/:id/publish', async (req, res) => {
  try {
    const config = await publishVersion(req.params.id);
    res.json({ config: toPublicConfig(decryptConfig(config)) });
  } catch (err) {
    console.error('[tracking:publish]', err);
    res.status(500).json({ message: err.message || 'Publish failed' });
  }
});
```

Note: Add the import statement at the top of the file with the other imports.

- [ ] **Step 3: Run build to verify**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/services/trackingProvisioning.js server/routes/tracking.js
git commit -m "feat(tracking): add GTM provisioning service with template-based tag creation"
```

---

## Phase 3: Event Relay

### Task 8: Event Relay Service

**Files:**
- Create: `server/services/trackingRelay.js`

- [ ] **Step 1: Create the relay service**

```javascript
import { query } from '../db.js';
import { decrypt } from './security/encryption.js';
import crypto from 'crypto';

// -- Policy Constants --

const MEDICAL_ALLOWED_FIELDS = new Set([
  'event_name', 'event_time', 'event_source_url',
  'action_source', 'value', 'currency', 'event_id',
]);

const NON_MEDICAL_BLOCKED_FIELDS = new Set([
  'ssn', 'date_of_birth', 'dob', 'password',
]);

// Internal event → GA4 event name
const GA4_EVENT_MAP = {
  lead_submitted: 'generate_lead',
  qualified_call: 'qualified_call',
  new_client: 'new_client',
  appointment_request: 'appointment_request',
};

// Internal event → Meta event name
const META_EVENT_MAP = {
  lead_submitted: 'Lead',
  qualified_call: 'Lead',
  new_client: 'Purchase',
  appointment_request: 'Schedule',
};

/**
 * Main entry point. Call this from form submission, call processing, or journey flows.
 *
 * @param {string} userId - The client's user_id (owner of the tracking config)
 * @param {string} eventName - Internal event name (lead_submitted, qualified_call, etc.)
 * @param {string} sourceType - 'form_submission', 'call_log', or 'journey'
 * @param {string} sourceId - UUID of the source record
 * @param {Object} eventData - Raw event data (will be scrubbed based on policy)
 */
export async function sendEvent(userId, eventName, sourceType, sourceId, eventData = {}) {
  // Look up tracking config
  const { rows } = await query(
    `SELECT * FROM tracking_configs WHERE user_id = $1`,
    [userId]
  );
  if (rows.length === 0) return; // No tracking config — silently skip
  const config = rows[0];

  // Check relay enabled
  if (!config.relay_enabled) return;

  // Check event is allowed
  const allowedEvents = config.allowed_events || [];
  if (!allowedEvents.includes(eventName)) return;

  // Apply scrubbing policy
  const scrubbedData = config.client_type === 'medical'
    ? scrubMedical(eventData, config)
    : scrubNonMedical(eventData, config);

  // Send to each destination in parallel
  const destinations = [];

  if (config.ga4_measurement_id && config.ga4_api_secret) {
    destinations.push(
      sendToGA4(config, eventName, scrubbedData, sourceType, sourceId)
    );
  }

  if (config.meta_pixel_id && config.meta_capi_token) {
    destinations.push(
      sendToMetaCAPI(config, eventName, scrubbedData, sourceType, sourceId)
    );
  }

  await Promise.allSettled(destinations);
}

/**
 * Medical scrubbing: ALLOWLIST only.
 * Only fields explicitly listed pass through. Everything else is dropped.
 */
function scrubMedical(eventData, config) {
  const scrubbed = {};
  for (const key of MEDICAL_ALLOWED_FIELDS) {
    if (eventData[key] !== undefined) {
      scrubbed[key] = eventData[key];
    }
  }
  // Sanitize URL to domain only (strip path which could reveal condition)
  if (scrubbed.event_source_url) {
    try {
      const url = new URL(scrubbed.event_source_url);
      scrubbed.event_source_url = url.origin;
    } catch {
      delete scrubbed.event_source_url;
    }
  }
  return scrubbed;
}

/**
 * Non-medical scrubbing: BLOCKLIST.
 * More permissive — allows hashed PII for Enhanced Conversions.
 */
function scrubNonMedical(eventData, config) {
  const scrubbed = { ...eventData };
  const customBlocked = config.blocked_fields || [];
  const allBlocked = new Set([...NON_MEDICAL_BLOCKED_FIELDS, ...customBlocked]);
  for (const field of allBlocked) {
    delete scrubbed[field];
  }
  // Hash PII fields for Enhanced Conversions
  if (scrubbed.email) {
    scrubbed.hashed_email = sha256(scrubbed.email.toLowerCase().trim());
    delete scrubbed.email;
  }
  if (scrubbed.phone) {
    scrubbed.hashed_phone = sha256(scrubbed.phone.replace(/\D/g, ''));
    delete scrubbed.phone;
  }
  if (scrubbed.first_name) {
    scrubbed.hashed_first_name = sha256(scrubbed.first_name.toLowerCase().trim());
    delete scrubbed.first_name;
  }
  if (scrubbed.last_name) {
    scrubbed.hashed_last_name = sha256(scrubbed.last_name.toLowerCase().trim());
    delete scrubbed.last_name;
  }
  return scrubbed;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Send event to GA4 Measurement Protocol.
 */
async function sendToGA4(config, eventName, scrubbedData, sourceType, sourceId) {
  const apiSecret = decrypt(config.ga4_api_secret);
  if (!apiSecret) return;

  const ga4EventName = GA4_EVENT_MAP[eventName] || eventName;
  const payload = {
    client_id: `anchor_${config.user_id}`,
    events: [{
      name: ga4EventName,
      params: {
        value: scrubbedData.value || 1,
        currency: scrubbedData.currency || 'USD',
        event_source: 'anchor_dashboard',
      },
    }],
  };

  // Add user data for non-medical Enhanced Conversions
  if (config.client_type === 'non_medical') {
    const userData = {};
    if (scrubbedData.hashed_email) userData.sha256_email_address = scrubbedData.hashed_email;
    if (scrubbedData.hashed_phone) userData.sha256_phone_number = scrubbedData.hashed_phone;
    if (Object.keys(userData).length > 0) {
      payload.user_data = userData;
    }
  }

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${config.ga4_measurement_id}&api_secret=${apiSecret}`;

  await sendWithRetry(
    url, payload, 'ga4', config.id, eventName, sourceType, sourceId
  );
}

/**
 * Send event to Meta Conversions API (CAPI).
 */
async function sendToMetaCAPI(config, eventName, scrubbedData, sourceType, sourceId) {
  const accessToken = decrypt(config.meta_capi_token);
  if (!accessToken) return;

  const metaEventName = META_EVENT_MAP[eventName] || eventName;
  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `anchor_${sourceType}_${sourceId}`;

  const eventPayload = {
    event_name: metaEventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: scrubbedData.event_source_url || config.website_domain,
    user_data: {},
    custom_data: {
      value: scrubbedData.value || 1,
      currency: scrubbedData.currency || 'USD',
    },
  };

  // Add hashed user data for non-medical clients
  if (config.client_type === 'non_medical') {
    if (scrubbedData.hashed_email) eventPayload.user_data.em = [scrubbedData.hashed_email];
    if (scrubbedData.hashed_phone) eventPayload.user_data.ph = [scrubbedData.hashed_phone];
    if (scrubbedData.hashed_first_name) eventPayload.user_data.fn = [scrubbedData.hashed_first_name];
    if (scrubbedData.hashed_last_name) eventPayload.user_data.ln = [scrubbedData.hashed_last_name];
  }

  const body = {
    data: [eventPayload],
  };
  if (config.meta_test_event_code) {
    body.test_event_code = config.meta_test_event_code;
  }

  const url = `https://graph.facebook.com/v18.0/${config.meta_pixel_id}/events?access_token=${accessToken}`;

  await sendWithRetry(
    url, body, 'meta_capi', config.id, eventName, sourceType, sourceId
  );
}

/**
 * Send HTTP request with retry logic (up to 3 attempts).
 * Logs each attempt to tracking_event_log.
 */
async function sendWithRetry(url, payload, destination, configId, eventName, sourceType, sourceId) {
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.text();
      const success = response.ok;

      // Log the attempt
      await query(
        `INSERT INTO tracking_event_log
          (tracking_config_id, event_name, destination, source_type, source_id,
           payload_sent, response_status, response_body, success, retry_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [configId, eventName, destination, sourceType, sourceId,
         JSON.stringify(payload), response.status, responseBody, success, attempt]
      );

      if (success) return;

      // Don't retry 4xx errors (client errors won't be fixed by retrying)
      if (response.status >= 400 && response.status < 500) return;

      lastError = new Error(`HTTP ${response.status}: ${responseBody}`);
    } catch (err) {
      lastError = err;
      // Log failed attempt
      await query(
        `INSERT INTO tracking_event_log
          (tracking_config_id, event_name, destination, source_type, source_id,
           payload_sent, response_status, response_body, success, retry_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [configId, eventName, destination, sourceType, sourceId,
         JSON.stringify(payload), null, err.message, false, attempt]
      );
    }

    // Exponential backoff before retry
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }

  console.error(`[tracking:relay] Failed after ${maxRetries} attempts to ${destination} for ${eventName}:`, lastError?.message);
}
```

- [ ] **Step 2: Run build to verify**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/trackingRelay.js
git commit -m "feat(tracking): add event relay service with medical allowlist and Meta CAPI + GA4 MP"
```

---

### Task 9: Hook Relay Into Existing Flows

**Files:**
- Modify: `server/services/forms.js` (~line 534)
- Modify: `server/services/ctm.js` (~line 706)
- Modify: `server/routes/hub.js` (~line 6833)

- [ ] **Step 1: Hook into form submissions**

Open `server/services/forms.js`. Find the form submission processing — after the INSERT into `form_submissions` returns and the `leadEntry` is created (around line 534-537). Add the relay call after the existing post-submission logic (after CTM submission and notifications, but inside the same try block):

Add import at top of file:
```javascript
import { sendEvent as sendTrackingEvent } from './trackingRelay.js';
```

Then after the existing post-submission work (around line 620, after the form audit logging), add:

```javascript
    // Relay to tracking destinations (GA4 / Meta CAPI)
    try {
      const ownerUserId = form.org_id; // The client who owns this form
      await sendTrackingEvent(ownerUserId, 'lead_submitted', 'form_submission', submission.id, {
        event_source_url: submission.referrer || submission.embed_domain || '',
        value: 1,
        currency: 'USD',
        email: fields?.email,
        phone: fields?.phone,
        first_name: fields?.first_name || fields?.name,
      });
    } catch (relayErr) {
      console.error('[forms:relay]', relayErr.message);
    }
```

Note: The relay service handles all policy checks internally (is relay enabled, is event allowed, scrub based on medical/non-medical). If the client has no tracking config or relay is disabled, this is a no-op.

- [ ] **Step 2: Hook into call classification**

Open `server/services/ctm.js`. Find the call classification result processing (around line 706 where the call_logs UPDATE happens with classification data). Add the relay call after the successful classification update.

Add import at top of file:
```javascript
import { sendEvent as sendTrackingEvent } from './trackingRelay.js';
```

After the call_logs UPDATE with classification (around line 712), add:

```javascript
      // Relay qualified calls to tracking destinations
      if (category === 'lead' || category === 'converted') {
        try {
          await sendTrackingEvent(ownerUserId, 'qualified_call', 'call_log', callId, {
            event_source_url: '',
            value: 1,
            currency: 'USD',
          });
        } catch (relayErr) {
          console.error('[ctm:relay]', relayErr.message);
        }
      }
```

Note: `ownerUserId` and `callId` should already be in scope from the existing processing function. Verify the variable names match the surrounding code when implementing.

- [ ] **Step 3: Hook into active client creation**

Open `server/routes/hub.js`. Find the active client INSERT (around line 6833). After the successful INSERT and journey UPDATE (around line 6920), add the relay call.

Add import at top of file with other service imports:
```javascript
import { sendEvent as sendTrackingEvent } from '../services/trackingRelay.js';
```

After the journey status UPDATE to `active_client` completes:

```javascript
        // Relay new client conversion to tracking destinations
        try {
          await sendTrackingEvent(userId, 'new_client', 'journey', activeClientId, {
            event_source_url: '',
            value: 1,
            currency: 'USD',
          });
        } catch (relayErr) {
          console.error('[hub:relay]', relayErr.message);
        }
```

Note: `userId` here refers to the admin/owner user ID (the one who owns the tracking config). Verify this is the correct variable — in hub.js routes, the owner is typically `req.user.id`.

- [ ] **Step 4: Run build to verify**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 5: Commit**

```bash
git add server/services/forms.js server/services/ctm.js server/routes/hub.js
git commit -m "feat(tracking): hook event relay into form submissions, call classification, and client conversion"
```

---

## Phase 4: Polish & Operational Safeguards

### Task 10: Event Log Retention Cron Job

**Files:**
- Modify: `server/index.js` (add cron job)

- [ ] **Step 1: Add retention cron job**

Find the cron job section in `server/index.js` (around line 777-894, after the existing cron.schedule calls). Add:

```javascript
  // Purge old tracking event logs (30 days retention)
  cron.schedule('30 3 * * *', async () => {
    try {
      const retentionDays = parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 30;
      const { rowCount } = await query(
        `DELETE FROM tracking_event_log WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
        [retentionDays]
      );
      if (rowCount > 0) console.log(`[cron] Purged ${rowCount} old tracking event log entries`);
    } catch (err) {
      console.error('[cron] tracking event log cleanup error:', err.message);
    }
  }, { timezone: 'America/New_York' });
```

- [ ] **Step 2: Run build to verify**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(tracking): add 30-day retention cron job for tracking event logs"
```

---

### Task 11: Documentation Updates

**Files:**
- Modify: `docs/API_REFERENCE.md`
- Modify: `docs/INTEGRATIONS.md`
- Modify: `SKILLS.md` (database schema section)

- [ ] **Step 1: Add tracking endpoints to API_REFERENCE.md**

Add a new section to `docs/API_REFERENCE.md`:

```markdown
## Tracking Provisioning

All endpoints require admin authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hub/tracking/:userId` | Get tracking config for a client |
| POST | `/api/hub/tracking` | Create tracking config |
| PUT | `/api/hub/tracking/:id` | Update tracking config |
| POST | `/api/hub/tracking/:id/provision` | Run GTM provisioning |
| POST | `/api/hub/tracking/:id/publish` | Publish GTM container version |
| GET | `/api/hub/tracking/:id/jobs` | Get provisioning job history |
| GET | `/api/hub/tracking/:id/events` | Get event relay log |
| POST | `/api/hub/tracking/:id/relay-toggle` | Enable/disable event relay |
| GET | `/api/hub/tracking/templates/list` | List available GTM templates |
```

- [ ] **Step 2: Add tracking integration to INTEGRATIONS.md**

Add a new section to `docs/INTEGRATIONS.md`:

```markdown
## Tracking Provisioning (GTM + GA4 + Meta CAPI)

### Overview
Internal system for provisioning GTM-based tracking per client. Creates tags, triggers, and variables in GTM containers via the Tag Manager API, and relays server-side conversion events to GA4 Measurement Protocol and Meta Conversions API.

### External APIs Used
- **Google Tag Manager API v2** — container/workspace/tag/trigger/variable CRUD, version creation, publishing
- **GA4 Measurement Protocol** — server-side event forwarding
- **Meta Conversions API (CAPI)** — server-side event forwarding

### Authentication
- GTM API: GCP service account (`anchor-client-hub@anchor-hub-480305.iam.gserviceaccount.com`)
- GA4 MP: Per-client API secret (stored encrypted in `tracking_configs.ga4_api_secret`)
- Meta CAPI: Per-client access token (stored encrypted in `tracking_configs.meta_capi_token`)

### HIPAA Compliance
- Medical clients: allowlist-only field scrubbing (only event name, timestamp, domain, value)
- Non-medical clients: blocklist scrubbing with hashed PII for Enhanced Conversions
- Event relay logs store post-scrubbing payloads only (no PHI)
```

- [ ] **Step 3: Add tables to SKILLS.md database schema**

Find the Database Schema Map section in `SKILLS.md` and add the 4 new tables:

```markdown
### Tracking Provisioning

- **tracking_templates** — Reusable GTM tag/trigger/variable definitions (name, template_type, tags JSONB, triggers JSONB, variables JSONB, version)
- **tracking_configs** — Per-client tracking setup (user_id → users, client_type, GTM/GA4/Google Ads/Meta IDs, allowed_events JSONB, relay_enabled, provisioning_status, install_snippet)
- **tracking_provisioning_jobs** — Provisioning run audit trail (tracking_config_id, triggered_by, status, steps JSONB)
- **tracking_event_log** — Event relay audit trail (tracking_config_id, event_name, destination, payload_sent JSONB, success, retry_count). 30-day retention.
```

- [ ] **Step 4: Commit**

```bash
git add docs/API_REFERENCE.md docs/INTEGRATIONS.md SKILLS.md
git commit -m "docs: add tracking provisioning system to API reference, integrations, and schema docs"
```

---

### Task 12: Final Build Verification

- [ ] **Step 1: Full build check**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Lint check**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn lint
```
Expected: No errors (warnings acceptable).

- [ ] **Step 3: Server startup check**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn server
```
Expected: Server starts, migration runs, no errors.

- [ ] **Step 4: Verify tables and seed data**

```bash
psql postgresql://bif@localhost:5432/anchor -c "SELECT COUNT(*) FROM tracking_templates WHERE is_active = true"
```
Expected: 1 row.

- [ ] **Step 5: Visual end-to-end verification**

Start both frontend and backend, then verify:
1. Open admin portal → Client Hub → select a client → Tracking tab
2. Click "Set Up Tracking" → fill form → save as draft
3. Verify config persists after page refresh
4. Edit config → save changes → verify update
5. Provision GTM (requires valid GTM container ID + service account permissions)
6. Copy install snippet
7. Toggle event relay on/off
8. Check event log table appears

---

## Summary of All Files Changed

### New Files (7)
- `server/sql/migrate_tracking.sql`
- `server/routes/tracking.js`
- `server/services/trackingProvisioning.js`
- `server/services/trackingRelay.js`
- `server/services/trackingTemplates.js`
- `src/api/tracking.js`
- `src/views/admin/AdminHub/TrackingTab.jsx`

### Modified Files (7)
- `server/index.js` (migration + route mount + cron job)
- `server/services/forms.js` (relay hook)
- `server/services/ctm.js` (relay hook)
- `server/routes/hub.js` (relay hook)
- `src/views/admin/AdminHub.jsx` (add tab)
- `docs/API_REFERENCE.md`
- `docs/INTEGRATIONS.md`
- `SKILLS.md`
- `package.json` + `yarn.lock` (googleapis)
