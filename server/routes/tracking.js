import axios from 'axios';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../middleware/roles.js';
import { query, getClient } from '../db.js';
import { clientLabelSelect, clientLabelJoins } from '../services/clientLabel.js';
import { encrypt, decrypt } from '../services/security/encryption.js';
import { logSecurityEvent } from '../services/security/index.js';
import { provision, publishVersion, listContainers, createContainer, deleteContainer } from '../services/trackingProvisioning.js';
import { listGA4Properties, createMPSecret } from '../services/analytics/ga4Adapter.js';
import { listGoogleAdsAccounts, listConversionActions, getConversionActionDetails } from '../services/analytics/googleAdsAdapter.js';
import { fetchAdAccounts, fetchPixels, fetchMetaCampaignsList } from '../services/analytics/metaAdsAdapter.js';

const router = express.Router();

router.use(requireAuth, isAdmin);

const CTM_BASE = process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com';
const ENCRYPTED_FIELDS = ['ga4_api_secret', 'meta_capi_token'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPAIGN_NAME_MAX = 128;

function normalizeMetaAccountId(raw) {
  if (!raw) return null;
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

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
    meta_capi_token: maskSecret(row.meta_capi_token)
  };
}

function getLeadSubmittedMapping(conversionMappings = {}) {
  return conversionMappings?.lead_submitted || conversionMappings?.form_submitted || null;
}

function getBrowserGoogleAdsSendTo(config) {
  if (!config) return null;

  const conversionId = config.google_ads_conversion_id || '';
  const conversionLabel = config.google_ads_conversion_label || '';
  if (conversionId && conversionLabel) {
    return `AW-${conversionId}/${conversionLabel}`;
  }

  const mapping = getLeadSubmittedMapping(config.conversion_mappings);
  if (mapping?.conversionId && mapping?.conversionLabel) {
    return `AW-${mapping.conversionId}/${mapping.conversionLabel}`;
  }

  return null;
}

function getCtmAuthHeaders() {
  const apiKey = process.env.CTM_API_KEY;
  const apiSecret = process.env.CTM_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

// -- Account listing endpoints (for wizard dropdowns) --

router.get('/accounts/ga4', async (req, res) => {
  try {
    const properties = await listGA4Properties();
    res.json({ properties });
  } catch (err) {
    console.error('[tracking] list GA4 properties error:', err.message);
    res.status(500).json({ message: 'Failed to list GA4 properties' });
  }
});

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

router.get('/accounts/google-ads/:customerId/conversions', async (req, res) => {
  try {
    const actions = await listConversionActions(req.params.customerId);
    res.json({ actions });
  } catch (err) {
    console.error('[tracking] list conversion actions error:', err.message);
    res.status(500).json({ message: 'Failed to list conversion actions' });
  }
});

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

router.get('/accounts/ctm', async (_req, res) => {
  try {
    const headers = getCtmAuthHeaders();
    if (!headers) {
      return res.status(500).json({ message: 'CTM agency API credentials are not configured' });
    }

    const response = await axios.get(`${CTM_BASE}/api/v1/accounts.json`, {
      params: { names: 1, all: 1 },
      headers,
      timeout: 15000
    });
    const accounts = Array.isArray(response.data?.accounts) ? response.data.accounts : [];
    res.json({ accounts });
  } catch (err) {
    console.error('[tracking] list CTM accounts error:', err.message);
    res.status(500).json({ message: 'Failed to list CTM accounts' });
  }
});

router.get('/accounts/gtm', async (req, res) => {
  try {
    const containers = await listContainers();
    res.json({ containers });
  } catch (err) {
    console.error('[tracking] list GTM containers error:', err.message);
    res.status(500).json({ message: 'Failed to list GTM containers' });
  }
});

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

// DELETE /accounts/gtm/:containerId — delete a GTM container
router.delete('/accounts/gtm/:containerId', async (req, res) => {
  try {
    await deleteContainer(req.params.containerId);
    res.json({ success: true });
  } catch (err) {
    console.error('[tracking] delete GTM container error:', err.message);
    res.status(500).json({ message: 'Failed to delete container' });
  }
});

router.post('/accounts/ga4/:propertyId/mp-secret', async (req, res) => {
  try {
    const result = await createMPSecret(req.params.propertyId);
    res.json(result);
  } catch (err) {
    console.error('[tracking] create MP secret error:', err.message);
    res.status(500).json({ message: 'Failed to create Measurement Protocol secret' });
  }
});

// GET /templates/list — MUST be before /:userId
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

// GET /form-analytics-context/:userId — tracking summary + available conversion actions for form builder UI
router.get('/form-analytics-context/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { rows: tc } = await query(
      `SELECT ga4_measurement_id, meta_pixel_id, google_ads_customer_id,
              google_ads_conversion_id, google_ads_conversion_label,
              conversion_mappings, client_type, relay_enabled
       FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const config = tc[0] || null;

    let conversionActions = [];
    if (config?.google_ads_customer_id) {
      try {
        conversionActions = await listConversionActions(config.google_ads_customer_id);
      } catch (err) {
        console.error('[tracking:form-analytics-context] Failed to load conversions:', err.message);
      }
    }

    const leadSubmittedMapping = getLeadSubmittedMapping(config?.conversion_mappings);

    res.json({
      configured: {
        ga4: !!config?.ga4_measurement_id,
        meta: !!config?.meta_pixel_id,
        googleAds: !!config?.google_ads_customer_id,
        relay: !!config?.relay_enabled,
        clientType: config?.client_type || null
      },
      defaults: {
        ga4_event: config?.ga4_measurement_id ? 'generate_lead' : null,
        fb_event: config?.meta_pixel_id && config?.client_type !== 'medical' ? 'Lead' : null,
        gads_browser_conversion: getBrowserGoogleAdsSendTo(config),
        gads_conversion_action: leadSubmittedMapping || null
      },
      conversionActions,
      conversionMappings: config?.conversion_mappings || {}
    });
  } catch (err) {
    console.error('[tracking:form-analytics-context]', err.message);
    res.status(500).json({ message: 'Failed to load analytics context' });
  }
});

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

router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      client_type,
      website_domain,
      gtm_account_id,
      gtm_container_id,
      gtm_container_public_id,
      ga4_property_id,
      ga4_measurement_id,
      ga4_api_secret,
      google_ads_customer_id,
      google_ads_conversion_id,
      google_ads_conversion_label,
      meta_ad_account_id,
      meta_pixel_id,
      meta_capi_token,
      meta_test_event_code,
      allowed_events,
      blocked_fields,
      consent_defaults,
      browser_meta_pixel_enabled,
      bing_uet_id,
      tiktok_pixel_id,
      browser_bing_enabled,
      browser_tiktok_enabled
    } = req.body;

    if (!user_id || !client_type) {
      return res.status(400).json({ message: 'user_id and client_type are required' });
    }
    if (!['medical', 'non_medical'].includes(client_type)) {
      return res.status(400).json({ message: 'client_type must be medical or non_medical' });
    }

    const { rows } = await query(
      `INSERT INTO tracking_configs (
        user_id, client_type, website_domain, gtm_account_id, gtm_container_id,
        gtm_container_public_id, ga4_property_id, ga4_measurement_id, ga4_api_secret,
        google_ads_customer_id, google_ads_conversion_id, google_ads_conversion_label,
        meta_ad_account_id, meta_pixel_id, meta_capi_token, meta_test_event_code,
        allowed_events, blocked_fields, consent_defaults,
        browser_meta_pixel_enabled,
        bing_uet_id, tiktok_pixel_id, browser_bing_enabled, browser_tiktok_enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *`,
      [
        user_id,
        client_type,
        website_domain || '',
        gtm_account_id || null,
        gtm_container_id || null,
        gtm_container_public_id || null,
        ga4_property_id || null,
        ga4_measurement_id || null,
        ga4_api_secret ? encrypt(ga4_api_secret) : null,
        google_ads_customer_id || null,
        google_ads_conversion_id || null,
        google_ads_conversion_label || null,
        meta_ad_account_id || null,
        meta_pixel_id || null,
        meta_capi_token ? encrypt(meta_capi_token) : null,
        meta_test_event_code || null,
        JSON.stringify(allowed_events || ['lead_submitted', 'qualified_call', 'new_client', 'appointment_request']),
        JSON.stringify(blocked_fields || []),
        JSON.stringify(consent_defaults || {}),
        browser_meta_pixel_enabled || false,
        bing_uet_id || null,
        tiktok_pixel_id || null,
        browser_bing_enabled || false,
        browser_tiktok_enabled || false
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

router.put('/:id', async (req, res) => {
  try {
    const {
      client_type,
      website_domain,
      gtm_account_id,
      gtm_container_id,
      gtm_container_public_id,
      ga4_property_id,
      ga4_measurement_id,
      ga4_api_secret,
      google_ads_customer_id,
      google_ads_conversion_id,
      google_ads_conversion_label,
      meta_ad_account_id,
      meta_pixel_id,
      meta_capi_token,
      meta_test_event_code,
      allowed_events,
      blocked_fields,
      consent_defaults,
      browser_meta_pixel_enabled,
      bing_uet_id,
      tiktok_pixel_id,
      browser_bing_enabled,
      browser_tiktok_enabled
    } = req.body;
    const hasField = (key) => Object.prototype.hasOwnProperty.call(req.body || {}, key);

    const { rows: existing } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Tracking config not found' });
    }
    const current = existing[0];

    const oldMetaAccount = normalizeMetaAccountId(current.meta_ad_account_id);
    if (hasField('client_type') && client_type && !['medical', 'non_medical'].includes(client_type)) {
      return res.status(400).json({ message: 'client_type must be medical or non_medical' });
    }

    const newMetaAccount = hasField('meta_ad_account_id') ? normalizeMetaAccountId(meta_ad_account_id) : oldMetaAccount;
    // Detect a meaningful switch or explicit clear. Leaving the field undefined
    // in the body preserves the current value and does not touch claims.
    const metaAccountChanged =
      hasField('meta_ad_account_id') && newMetaAccount !== oldMetaAccount && oldMetaAccount !== null;

    const newApiSecret = hasField('ga4_api_secret')
      ? (ga4_api_secret
        ? (ga4_api_secret.startsWith('••••') ? current.ga4_api_secret : encrypt(ga4_api_secret))
        : null)
      : current.ga4_api_secret;
    const newCapiToken = hasField('meta_capi_token')
      ? (meta_capi_token
        ? (meta_capi_token.startsWith('••••') ? current.meta_capi_token : encrypt(meta_capi_token))
        : null)
      : current.meta_capi_token;

    // Wrap the UPDATE + (optional) claim cleanup + audit log in a single
    // transaction so they succeed or fail together. Audit integrity matters
    // here: a config change that silently failed to clear stale claims would
    // leave cross-account claims that quietly leak data in analytics.
    const dbClient = await getClient();
    let updatedRow;
    let claimsRemoved = 0;
    try {
      await dbClient.query('BEGIN');

      const updates = [];
      const values = [];
      const pushUpdate = (column, value) => {
        values.push(value);
        updates.push(`${column} = $${values.length}`);
      };
      const nullIfEmpty = (value) => (value === '' || value === undefined ? null : value);

      if (hasField('client_type')) pushUpdate('client_type', client_type || null);
      if (hasField('website_domain')) pushUpdate('website_domain', nullIfEmpty(website_domain));
      if (hasField('gtm_account_id')) pushUpdate('gtm_account_id', nullIfEmpty(gtm_account_id));
      if (hasField('gtm_container_id')) pushUpdate('gtm_container_id', nullIfEmpty(gtm_container_id));
      if (hasField('gtm_container_public_id')) pushUpdate('gtm_container_public_id', nullIfEmpty(gtm_container_public_id));
      if (hasField('ga4_property_id')) pushUpdate('ga4_property_id', nullIfEmpty(ga4_property_id));
      if (hasField('ga4_measurement_id')) pushUpdate('ga4_measurement_id', nullIfEmpty(ga4_measurement_id));
      if (hasField('ga4_api_secret')) pushUpdate('ga4_api_secret', newApiSecret);
      if (hasField('google_ads_customer_id')) pushUpdate('google_ads_customer_id', nullIfEmpty(google_ads_customer_id));
      if (hasField('google_ads_conversion_id')) pushUpdate('google_ads_conversion_id', nullIfEmpty(google_ads_conversion_id));
      if (hasField('google_ads_conversion_label')) pushUpdate('google_ads_conversion_label', nullIfEmpty(google_ads_conversion_label));
      if (hasField('meta_ad_account_id')) pushUpdate('meta_ad_account_id', newMetaAccount);
      if (hasField('meta_pixel_id')) pushUpdate('meta_pixel_id', nullIfEmpty(meta_pixel_id));
      if (hasField('meta_capi_token')) pushUpdate('meta_capi_token', newCapiToken);
      if (hasField('meta_test_event_code')) pushUpdate('meta_test_event_code', nullIfEmpty(meta_test_event_code));
      if (hasField('allowed_events')) pushUpdate('allowed_events', JSON.stringify(allowed_events || []));
      if (hasField('blocked_fields')) pushUpdate('blocked_fields', JSON.stringify(blocked_fields || []));
      if (hasField('consent_defaults')) pushUpdate('consent_defaults', JSON.stringify(consent_defaults || {}));
      if (hasField('browser_meta_pixel_enabled')) pushUpdate('browser_meta_pixel_enabled', !!browser_meta_pixel_enabled);
      if (hasField('bing_uet_id')) pushUpdate('bing_uet_id', nullIfEmpty(bing_uet_id));
      if (hasField('tiktok_pixel_id')) pushUpdate('tiktok_pixel_id', nullIfEmpty(tiktok_pixel_id));
      if (hasField('browser_bing_enabled')) pushUpdate('browser_bing_enabled', !!browser_bing_enabled);
      if (hasField('browser_tiktok_enabled')) pushUpdate('browser_tiktok_enabled', !!browser_tiktok_enabled);

      if (updates.length > 0) {
        const updateRes = await dbClient.query(
          `UPDATE tracking_configs SET
            ${updates.join(', ')},
            updated_at = NOW()
          WHERE id = $${values.length + 1}
          RETURNING *`,
          [...values, req.params.id]
        );
        updatedRow = updateRes.rows[0];
      } else {
        updatedRow = current;
      }

      if (metaAccountChanged) {
        const delRes = await dbClient.query(
          `DELETE FROM tracking_campaign_claims
             WHERE user_id = $1 AND platform = 'meta' AND ad_account_id = $2`,
          [current.user_id, oldMetaAccount]
        );
        claimsRemoved = delRes.rowCount || 0;
      }

      await dbClient.query('COMMIT');
    } catch (txErr) {
      await dbClient.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      dbClient.release();
    }

    // Audit log is outside the transaction so a logging failure doesn't roll
    // back the config change; we emit after commit succeeds.
    if (metaAccountChanged) {
      await logSecurityEvent({
        userId: req.user?.id || null,
        eventCategory: 'tracking',
        eventType: 'campaign_claims_cleared',
        success: true,
        details: {
          target_user_id: current.user_id,
          old_ad_account_id: oldMetaAccount,
          new_ad_account_id: newMetaAccount,
          claims_removed: claimsRemoved
        }
      });
    }

    const config = decryptConfig(updatedRow);
    res.json({ config: toPublicConfig(config) });
  } catch (err) {
    console.error('[tracking:update]', err);
    res.status(500).json({ message: 'Failed to update tracking config' });
  }
});

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

router.post('/:id/relay-toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const { rows } = await query(`UPDATE tracking_configs SET relay_enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [
      !!enabled,
      req.params.id
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Tracking config not found' });
    }
    res.json({ relay_enabled: rows[0].relay_enabled });
  } catch (err) {
    console.error('[tracking:relay-toggle]', err);
    res.status(500).json({ message: 'Failed to toggle relay' });
  }
});

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

router.put('/:id/conversion-mappings', async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!mappings || typeof mappings !== 'object') {
      return res.status(400).json({ message: 'mappings object is required' });
    }

    const { rows: configRows } = await query(`SELECT google_ads_customer_id FROM tracking_configs WHERE id = $1`, [req.params.id]);
    if (configRows.length === 0) return res.status(404).json({ message: 'Config not found' });

    const customerId = configRows[0].google_ads_customer_id;
    const enrichedMappings = { ...mappings };
    if (customerId) {
      for (const [eventKey, mapping] of Object.entries(enrichedMappings)) {
        if (!mapping?.conversion_action_id) continue;
        if (mapping.conversionId && mapping.conversionLabel) continue;
        const details = await getConversionActionDetails(customerId, mapping.conversion_action_id).catch(() => null);
        if (details?.conversionId && details?.conversionLabel) {
          enrichedMappings[eventKey] = {
            ...mapping,
            conversionId: details.conversionId,
            conversionLabel: details.conversionLabel
          };
        }
      }
    }

    const result = await query(`UPDATE tracking_configs SET conversion_mappings = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [
      JSON.stringify(enrichedMappings),
      req.params.id
    ]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Config not found' });

    // Extract browser conversion IDs from the lead_submitted mapping's tag snippet values.
    // These populate the legacy google_ads_conversion_id/label fields that the GTM template
    // uses for the browser-side Google Ads conversion tag (AW-{conversionId}/{conversionLabel}).
    const leadMapping = enrichedMappings?.lead_submitted || enrichedMappings?.form_submitted;
    if (leadMapping?.conversionId && leadMapping?.conversionLabel) {
      await query(
        `UPDATE tracking_configs
         SET google_ads_conversion_id = $1, google_ads_conversion_label = $2, updated_at = NOW()
         WHERE id = $3`,
        [leadMapping.conversionId, leadMapping.conversionLabel, req.params.id]
      );
    }

    res.json({ config: toPublicConfig(decryptConfig(result.rows[0])) });
  } catch (err) {
    console.error('[tracking] save conversion mappings error:', err.message);
    res.status(500).json({ message: 'Failed to save conversion mappings' });
  }
});

/**
 * GET /hub/tracking/:userId/meta-campaigns
 * List campaigns on this client's Meta ad account, annotated with claim state.
 * Query params:
 *   status=active,paused,archived (default: active,paused; value "all" = no filter)
 */
router.get('/:userId/meta-campaigns', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }
    const statusParam = (req.query.status || 'active,paused').toString().toLowerCase();

    // Load client's ad account
    const configRes = await query(
      `SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const adAccountIdRaw = configRes.rows[0]?.meta_ad_account_id;
    if (!adAccountIdRaw) {
      return res.status(400).json({ error: 'no_meta_ad_account_configured' });
    }
    const adAccountId = normalizeMetaAccountId(adAccountIdRaw);

    const token = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'meta_token_not_configured' });
    }

    // Resolve statuses — intersect against allowlist to prevent unbounded input
    const VALID_STATUSES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'WITH_ISSUES']);
    let statuses;
    if (statusParam === 'all') {
      statuses = [...VALID_STATUSES];
    } else {
      statuses = statusParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => VALID_STATUSES.has(s));
    }
    if (statuses.length === 0) {
      return res.status(400).json({ error: 'invalid_status', message: 'No valid statuses provided' });
    }

    const campaigns = await fetchMetaCampaignsList(token, adAccountId, { statuses });

    // Join with claims across all clients on this ad account.
    const claimsRes = await query(
      `SELECT c.campaign_id,
              c.user_id,
              ${clientLabelSelect('display_name')}
         FROM tracking_campaign_claims c
         LEFT JOIN users u ON u.id = c.user_id
         ${clientLabelJoins('c.user_id')}
         WHERE c.platform = 'meta' AND c.ad_account_id = $1`,
      [adAccountId]
    );
    const claimMap = new Map(
      claimsRes.rows.map((r) => [
        r.campaign_id,
        { user_id: r.user_id, name: r.display_name || 'Unknown' }
      ])
    );

    const annotated = campaigns.map((c) => {
      const claim = claimMap.get(c.id) || null;
      return {
        ...c,
        claimed_by: claim
          ? { ...claim, is_current_client: claim.user_id === userId }
          : null
      };
    });

    res.json({ ad_account_id: adAccountId, campaigns: annotated });
  } catch (err) {
    console.error('[tracking:meta-campaigns]', err);
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to load Meta campaigns' });
  }
});

/**
 * POST /hub/tracking/:userId/meta-campaigns/claims
 * Body: { campaign_id, campaign_name }
 * Responses:
 *   201 created
 *   200 if the same user already claimed this campaign (idempotent)
 *   409 if another client owns it (body includes claimed_by.name)
 */
router.post('/:userId/meta-campaigns/claims', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }
    const { campaign_id: campaignIdRaw, campaign_name: campaignNameRaw } = req.body || {};
    const campaignId = typeof campaignIdRaw === 'string' ? campaignIdRaw.trim() : '';
    if (!campaignId) {
      return res.status(400).json({ error: 'missing_campaign_id' });
    }
    const campaignName = typeof campaignNameRaw === 'string'
      ? campaignNameRaw.trim().slice(0, CAMPAIGN_NAME_MAX)
      : null;

    // Resolve client's ad account
    const cfgRes = await query(
      `SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const adAccountId = normalizeMetaAccountId(cfgRes.rows[0]?.meta_ad_account_id);
    if (!adAccountId) {
      return res.status(400).json({ error: 'no_meta_ad_account_configured' });
    }

    // Attempt insert; catch unique-constraint violation for 409
    try {
      const ins = await query(
        `INSERT INTO tracking_campaign_claims
           (user_id, platform, ad_account_id, campaign_id, campaign_name, claimed_by)
         VALUES ($1, 'meta', $2, $3, $4, $5)
         RETURNING id, user_id, campaign_id, campaign_name, claimed_at`,
        [userId, adAccountId, campaignId, campaignName || null, req.user?.id || null]
      );

      await logSecurityEvent({
        userId: req.user?.id || null,
        eventCategory: 'tracking',
        eventType: 'campaign_claim_created',
        success: true,
        details: { target_user_id: userId, ad_account_id: adAccountId, campaign_id: campaignId }
      });

      return res.status(201).json({ claim: ins.rows[0] });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        // Unique constraint — someone else owns it (or same user idempotent)
        const existing = await query(
          `SELECT c.user_id,
                  ${clientLabelSelect('display_name')}
             FROM tracking_campaign_claims c
             LEFT JOIN users u ON u.id = c.user_id
             ${clientLabelJoins('c.user_id')}
             WHERE c.platform = 'meta' AND c.ad_account_id = $1 AND c.campaign_id = $2`,
          [adAccountId, campaignId]
        );
        const row = existing.rows[0];
        if (row?.user_id === userId) {
          // Same user already claims it — treat as idempotent 200
          const current = await query(
            `SELECT id, user_id, campaign_id, campaign_name, claimed_at
               FROM tracking_campaign_claims
               WHERE platform = 'meta' AND ad_account_id = $1 AND campaign_id = $2`,
            [adAccountId, campaignId]
          );
          return res.status(200).json({ claim: current.rows[0] });
        }
        await logSecurityEvent({
          userId: req.user?.id || null,
          eventCategory: 'tracking',
          eventType: 'campaign_claim_denied',
          success: false,
          failureReason: 'campaign_already_claimed',
          details: {
            target_user_id: userId,
            ad_account_id: adAccountId,
            campaign_id: campaignId,
            claimed_by_user_id: row?.user_id || null
          }
        });
        return res.status(409).json({
          error: 'campaign_already_claimed',
          claimed_by: row
            ? { user_id: row.user_id, name: row.display_name || 'Unknown' }
            : null
        });
      }
      throw dbErr;
    }
  } catch (err) {
    console.error('[tracking:claim]', err);
    res.status(500).json({ error: 'claim_failed', message: 'Failed to claim campaign' });
  }
});

/**
 * DELETE /hub/tracking/:userId/meta-campaigns/claims/:campaignId
 * Idempotent — returns 204 whether or not the claim existed.
 */
router.delete('/:userId/meta-campaigns/claims/:campaignId', async (req, res) => {
  try {
    const { userId, campaignId } = req.params;
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }

    // Scope the delete by ad_account_id so it can't remove claims on an
    // unrelated account. If the client has no configured account, the delete
    // is a no-op (still 204 — idempotent).
    const cfgRes = await query(
      `SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const adAccountId = normalizeMetaAccountId(cfgRes.rows[0]?.meta_ad_account_id);

    if (adAccountId) {
      await query(
        `DELETE FROM tracking_campaign_claims
           WHERE user_id = $1 AND platform = 'meta' AND ad_account_id = $2 AND campaign_id = $3`,
        [userId, adAccountId, campaignId]
      );
    }
    await logSecurityEvent({
      userId: req.user?.id || null,
      eventCategory: 'tracking',
      eventType: 'campaign_claim_deleted',
      success: true,
      details: { target_user_id: userId, ad_account_id: adAccountId, campaign_id: campaignId }
    });
    res.status(204).end();
  } catch (err) {
    console.error('[tracking:unclaim]', err);
    res.status(500).json({ error: 'unclaim_failed', message: 'Failed to remove claim' });
  }
});

export default router;
