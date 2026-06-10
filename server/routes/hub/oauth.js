// Hub OAuth routes: app-level OAuth provider management (superadmin), per-client OAuth connection mutations, provider connect-flow initiation (Google/Facebook/TikTok/WordPress), and OAuth resource management. Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`. (The /oauth/<provider>/callback GET routes live in hub/public.js.)
import express from 'express';

import { query } from '../../db.js';
import { decrypt } from '../../services/security/index.js';
import { requireAuth, requireSuperadmin } from '../../middleware/auth.js';
import { isAdminOrEditor } from '../../middleware/roles.js';
import { resolveBaseUrl } from '../../services/hubUtils.js';
import {
  createOauthState,
  createCodeVerifier,
  createCodeChallenge,
  // Google
  getGoogleBusinessOAuthConfig,
  buildGoogleAuthUrl,
  fetchGoogleBusinessAccounts,
  fetchGoogleBusinessLocations,
  refreshGoogleAccessToken,
  // Facebook/Instagram
  getFacebookOAuthConfig,
  buildFacebookAuthUrl,
  fetchFacebookPages,
  fetchInstagramAccounts,
  refreshFacebookAccessToken,
  fetchMetaInsights,
  // TikTok
  getTikTokOAuthConfig,
  buildTikTokAuthUrl,
  fetchTikTokAccountInfo,
  refreshTikTokAccessToken,
  // WordPress
  getWordPressOAuthConfig,
  buildWordPressAuthUrl,
  fetchWordPressSites,
  refreshWordPressAccessToken,
  // Shared
  setOAuthCookies
} from '../../services/oauthIntegration.js';

const router = express.Router();

// ============================================================================
// OAuth Provider Management (App-level, Admin-only)
// ============================================================================

// List all OAuth providers
router.get('/oauth-providers', requireSuperadmin, async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM oauth_providers ORDER BY provider');
    // Don't expose client_secret in list view
    const safe = rows.map(({ client_secret, ...rest }) => ({ ...rest, has_secret: !!client_secret }));
    res.json({ providers: safe });
  } catch (err) {
    console.error('[oauth-providers:list]', err);
    res.status(500).json({ message: 'Failed to fetch OAuth providers' });
  }
});

// Get single OAuth provider (with secret for editing)
router.get('/oauth-providers/:id', requireSuperadmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM oauth_providers WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Provider not found' });
    res.json({ provider: rows[0] });
  } catch (err) {
    console.error('[oauth-providers:get]', err);
    res.status(500).json({ message: 'Failed to fetch OAuth provider' });
  }
});

// Create OAuth provider
router.post('/oauth-providers', requireSuperadmin, async (req, res) => {
  try {
    const { provider, client_id, client_secret, redirect_uri, auth_url, token_url, scopes, notes } = req.body;
    if (!provider || !client_id || !client_secret) {
      return res.status(400).json({ message: 'provider, client_id, and client_secret are required' });
    }
    const { rows } = await query(
      `INSERT INTO oauth_providers (provider, client_id, client_secret, redirect_uri, auth_url, token_url, scopes, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [provider, client_id, client_secret, redirect_uri || null, auth_url || null, token_url || null, scopes || [], notes || null]
    );
    res.json({ provider: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Provider already exists' });
    }
    console.error('[oauth-providers:create]', err);
    res.status(500).json({ message: 'Failed to create OAuth provider' });
  }
});

// Update OAuth provider
router.put('/oauth-providers/:id', requireSuperadmin, async (req, res) => {
  try {
    const { provider, client_id, client_secret, redirect_uri, auth_url, token_url, scopes, is_active, notes } = req.body;
    const { rows } = await query(
      `UPDATE oauth_providers
       SET provider = COALESCE($1, provider),
           client_id = COALESCE($2, client_id),
           client_secret = COALESCE($3, client_secret),
           redirect_uri = $4,
           auth_url = $5,
           token_url = $6,
           scopes = COALESCE($7, scopes),
           is_active = COALESCE($8, is_active),
           notes = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        provider,
        client_id,
        client_secret,
        redirect_uri || null,
        auth_url || null,
        token_url || null,
        scopes,
        is_active,
        notes || null,
        req.params.id
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Provider not found' });
    res.json({ provider: rows[0] });
  } catch (err) {
    console.error('[oauth-providers:update]', err);
    res.status(500).json({ message: 'Failed to update OAuth provider' });
  }
});

// Delete OAuth provider
router.delete('/oauth-providers/:id', requireSuperadmin, async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM oauth_providers WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Provider not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[oauth-providers:delete]', err);
    res.status(500).json({ message: 'Failed to delete OAuth provider' });
  }
});

// ============================================================================
// OAuth Connections (Per-client)
// ============================================================================

// Update OAuth connection
router.put('/oauth-connections/:id', isAdminOrEditor, async (req, res) => {
  try {
    const { provider_account_name, access_token, refresh_token, scope_granted, expires_at, is_connected, last_error, external_metadata } =
      req.body;

    const { rows } = await query(
      `UPDATE oauth_connections
       SET provider_account_name = COALESCE($1, provider_account_name),
           access_token = COALESCE($2, access_token),
           refresh_token = COALESCE($3, refresh_token),
           scope_granted = COALESCE($4, scope_granted),
           expires_at = COALESCE($5, expires_at),
           is_connected = COALESCE($6, is_connected),
           last_error = $7,
           external_metadata = COALESCE($8, external_metadata),
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        provider_account_name,
        access_token,
        refresh_token,
        scope_granted,
        expires_at,
        is_connected,
        last_error || null,
        external_metadata,
        req.params.id
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Connection not found' });
    res.json({ connection: rows[0] });
  } catch (err) {
    console.error('[oauth-connections:update]', err);
    res.status(500).json({ message: 'Failed to update OAuth connection' });
  }
});

// Revoke/disconnect OAuth connection
router.post('/oauth-connections/:id/revoke', isAdminOrEditor, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE oauth_connections
       SET is_connected = FALSE, revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Connection not found' });
    res.json({ connection: rows[0] });
  } catch (err) {
    console.error('[oauth-connections:revoke]', err);
    res.status(500).json({ message: 'Failed to revoke OAuth connection' });
  }
});

// Delete OAuth connection
router.delete('/oauth-connections/:id', isAdminOrEditor, async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM oauth_connections WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Connection not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[oauth-connections:delete]', err);
    res.status(500).json({ message: 'Failed to delete OAuth connection' });
  }
});

// ============================================================================
// OAuth Connect Flow (Google Business Profile)
// ============================================================================

/**
 * POST /hub/oauth/google/connect
 * Initiate Google Business Profile OAuth flow for a client
 * Body: { clientId } (required)
 * Returns: { authUrl } - frontend should redirect to this URL
 */
router.post('/oauth/google/connect', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({ message: 'clientId is required' });
    }

    // Verify client exists
    const clientCheck = await query('SELECT id FROM users WHERE id = $1', [clientId]);
    if (!clientCheck.rows.length) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Build redirect URI
    const baseUrl = resolveBaseUrl(req);
    const redirectUri = `${baseUrl}/api/hub/oauth/google/callback`;

    const config = getGoogleBusinessOAuthConfig(redirectUri);

    if (!config.clientId || !config.clientSecret) {
      console.error('[oauth:google:connect] Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
      return res.status(500).json({ message: 'Google OAuth not configured. Check server environment variables.' });
    }

    // Create OAuth state and PKCE verifier
    const state = createOauthState();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    // Store state in cookies
    setOAuthCookies(res, 'google', {
      state,
      verifier: codeVerifier,
      clientId
    });

    // Build Google auth URL
    const authUrl = buildGoogleAuthUrl(config, { state, codeChallenge });

    console.log(`[oauth:google:connect] Generated OAuth URL for client ${clientId}`);
    res.json({ authUrl });
  } catch (err) {
    console.error('[oauth:google:connect]', err);
    res.status(500).json({ message: 'Failed to start OAuth flow' });
  }
});

/**
 * GET /hub/oauth-connections/:id/google-accounts
 * Fetch Google Business accounts for an OAuth connection
 */
router.get('/oauth-connections/:id/google-accounts', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.id;

    // Get connection with token
    const { rows } = await query(
      'SELECT access_token, refresh_token, expires_at FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'google']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Google connection not found' });
    }

    let accessToken = rows[0].access_token;
    const refreshToken = rows[0].refresh_token;
    const expiresAt = rows[0].expires_at;

    if (!accessToken) {
      return res.status(400).json({ message: 'No access token stored for this connection' });
    }

    // Refresh token if expired
    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[oauth:google:accounts] Token expired, refreshing...`);
      if (!refreshToken) {
        return res.status(400).json({ message: 'Token expired and no refresh token available. Please reconnect.' });
      }
      try {
        accessToken = await refreshGoogleAccessToken(connectionId);
      } catch (refreshErr) {
        console.error('[oauth:google:accounts] Token refresh failed:', refreshErr);
        return res.status(401).json({ message: 'Token refresh failed. Please reconnect your Google account.' });
      }
    }

    // Fetch accounts
    const accounts = await fetchGoogleBusinessAccounts(accessToken);
    res.json({ accounts });
  } catch (err) {
    console.error('[oauth:google:accounts]', err);
    // Return the actual error message for debugging
    res.status(500).json({ message: err.message || 'Failed to fetch Google Business accounts' });
  }
});

/**
 * GET /hub/oauth-connections/:id/google-locations
 * Fetch Google Business locations for an account
 * Query params: accountName (required, format: accounts/123456789)
 */
router.get('/oauth-connections/:id/google-locations', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.id;
    const { accountName } = req.query;

    if (!accountName) {
      return res.status(400).json({ message: 'accountName is required' });
    }

    // Get connection with token
    const { rows } = await query(
      'SELECT access_token, expires_at FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'google']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Google connection not found' });
    }

    let accessToken = rows[0].access_token;
    const expiresAt = rows[0].expires_at;

    // Refresh token if expired
    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[oauth:google:locations] Token expired, refreshing...`);
      accessToken = await refreshGoogleAccessToken(connectionId);
    }

    // Fetch locations
    const locations = await fetchGoogleBusinessLocations(accessToken, accountName);
    res.json({ locations });
  } catch (err) {
    console.error('[oauth:google:locations]', err);
    res.status(500).json({ message: 'Failed to fetch Google Business locations' });
  }
});

// ============================================================================
// Facebook/Instagram OAuth Connect Flow
// ============================================================================

/**
 * GET /hub/oauth/facebook/connect
 * Initiate Facebook OAuth flow for a client (also covers Instagram)
 * Query params: clientId (required)
 */
router.post('/oauth/facebook/connect', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({ message: 'clientId is required' });
    }

    const clientCheck = await query('SELECT id FROM users WHERE id = $1', [clientId]);
    if (!clientCheck.rows.length) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const baseUrl = resolveBaseUrl(req);
    const redirectUri = `${baseUrl}/api/hub/oauth/facebook/callback`;

    const config = getFacebookOAuthConfig(redirectUri);

    if (!config.clientId || !config.clientSecret) {
      console.error('[oauth:facebook:connect] Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET');
      return res.status(500).json({ message: 'Facebook OAuth not configured. Check server environment variables.' });
    }

    const state = createOauthState();

    // Facebook doesn't use PKCE, but we still need to track state
    setOAuthCookies(res, 'facebook', {
      state,
      verifier: '', // Not used for Facebook
      clientId
    });

    const authUrl = buildFacebookAuthUrl(config, { state });

    console.log(`[oauth:facebook:connect] Generated OAuth URL for client ${clientId}`);
    res.json({ authUrl });
  } catch (err) {
    console.error('[oauth:facebook:connect]', err);
    res.status(500).json({ message: 'Failed to start OAuth flow' });
  }
});

/**
 * GET /hub/oauth-connections/:id/facebook-pages
 * Fetch Facebook Pages for an OAuth connection
 */
router.get('/oauth-connections/:id/facebook-pages', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.id;

    const { rows } = await query(
      'SELECT access_token, expires_at FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'facebook']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Facebook connection not found' });
    }

    let accessToken = rows[0].access_token;
    const expiresAt = rows[0].expires_at;

    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[oauth:facebook:pages] Token expired, refreshing...`);
      accessToken = await refreshFacebookAccessToken(connectionId);
    }

    const pages = await fetchFacebookPages(accessToken);
    res.json({ pages });
  } catch (err) {
    console.error('[oauth:facebook:pages]', err);
    res.status(500).json({ message: 'Failed to fetch Facebook Pages' });
  }
});

/**
 * GET /hub/oauth-connections/:id/instagram-accounts
 * Fetch Instagram Business Accounts linked to Facebook Pages
 */
router.get('/oauth-connections/:id/instagram-accounts', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.id;

    const { rows } = await query(
      'SELECT access_token, expires_at FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'facebook']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Facebook connection not found' });
    }

    let accessToken = rows[0].access_token;
    const expiresAt = rows[0].expires_at;

    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[oauth:instagram:accounts] Token expired, refreshing...`);
      accessToken = await refreshFacebookAccessToken(connectionId);
    }

    const accounts = await fetchInstagramAccounts(accessToken);
    res.json({ accounts });
  } catch (err) {
    console.error('[oauth:instagram:accounts]', err);
    res.status(500).json({ message: 'Failed to fetch Instagram accounts' });
  }
});

// ============================================================================
// Meta Insights — Display-ready data for CRM UI
// ============================================================================

/**
 * GET /hub/oauth-connections/:id/meta-insights
 * Fetch display-ready Meta insights for a Facebook connection.
 * Shows pages, engagement, lead forms, and Instagram accounts.
 * Admin/editor only.
 */
router.get('/oauth-connections/:id/meta-insights', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.id;

    const { rows } = await query(
      'SELECT access_token, expires_at FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'facebook']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Facebook connection not found' });
    }

    let accessToken = decrypt(rows[0].access_token) || rows[0].access_token;

    // Refresh if expired
    if (rows[0].expires_at && new Date(rows[0].expires_at) < new Date()) {
      console.log('[meta-insights] Token expired, refreshing...');
      accessToken = await refreshFacebookAccessToken(connectionId);
    }

    const opts = {};
    if (req.query.pageId) opts.pageId = req.query.pageId;

    const insights = await fetchMetaInsights(accessToken, opts);

    res.json({ insights });
  } catch (err) {
    console.error('[meta-insights]', err);
    res.status(500).json({ message: 'Failed to fetch Meta insights' });
  }
});

// ============================================================================
// TikTok OAuth Connect Flow
// ============================================================================

/**
 * GET /hub/oauth/tiktok/connect
 * Initiate TikTok OAuth flow for a client
 * Query params: clientId (required)
 */
router.post('/oauth/tiktok/connect', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({ message: 'clientId is required' });
    }

    const clientCheck = await query('SELECT id FROM users WHERE id = $1', [clientId]);
    if (!clientCheck.rows.length) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const baseUrl = resolveBaseUrl(req);
    const redirectUri = `${baseUrl}/api/hub/oauth/tiktok/callback`;

    const config = getTikTokOAuthConfig(redirectUri);

    if (!config.clientId || !config.clientSecret) {
      console.error('[oauth:tiktok:connect] Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET');
      return res.status(500).json({ message: 'TikTok OAuth not configured. Check server environment variables.' });
    }

    const state = createOauthState();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    setOAuthCookies(res, 'tiktok', {
      state,
      verifier: codeVerifier,
      clientId
    });

    const authUrl = buildTikTokAuthUrl(config, { state, codeChallenge });

    console.log(`[oauth:tiktok:connect] Generated OAuth URL for client ${clientId}`);
    res.json({ authUrl });
  } catch (err) {
    console.error('[oauth:tiktok:connect]', err);
    res.status(500).json({ message: 'Failed to start OAuth flow' });
  }
});

/**
 * GET /hub/oauth-connections/:id/tiktok-account
 * Fetch TikTok account info for an OAuth connection
 */
router.get('/oauth-connections/:id/tiktok-account', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.id;

    const { rows } = await query(
      'SELECT access_token, expires_at FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'tiktok']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'TikTok connection not found' });
    }

    let accessToken = rows[0].access_token;
    const expiresAt = rows[0].expires_at;

    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[oauth:tiktok:account] Token expired, refreshing...`);
      accessToken = await refreshTikTokAccessToken(connectionId);
    }

    const account = await fetchTikTokAccountInfo(accessToken);
    res.json({ account });
  } catch (err) {
    console.error('[oauth:tiktok:account]', err);
    res.status(500).json({ message: 'Failed to fetch TikTok account info' });
  }
});

// ============================================================================
// WordPress OAuth Connect Flow
// ============================================================================

/**
 * GET /hub/oauth/wordpress/connect
 * Initiate WordPress OAuth flow for a client
 * Query params: clientId (required)
 */
router.post('/oauth/wordpress/connect', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({ message: 'clientId is required' });
    }

    const clientCheck = await query('SELECT id FROM users WHERE id = $1', [clientId]);
    if (!clientCheck.rows.length) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const baseUrl = resolveBaseUrl(req);
    const redirectUri = `${baseUrl}/api/hub/oauth/wordpress/callback`;

    const config = getWordPressOAuthConfig(redirectUri);

    if (!config.clientId || !config.clientSecret) {
      console.error('[oauth:wordpress:connect] Missing WORDPRESS_CLIENT_ID or WORDPRESS_CLIENT_SECRET');
      return res.status(500).json({ message: 'WordPress OAuth not configured. Check server environment variables.' });
    }

    const state = createOauthState();

    // WordPress doesn't use PKCE
    setOAuthCookies(res, 'wordpress', {
      state,
      verifier: '', // Not used for WordPress
      clientId
    });

    const authUrl = buildWordPressAuthUrl(config, { state });

    console.log(`[oauth:wordpress:connect] Generated OAuth URL for client ${clientId}`);
    res.json({ authUrl });
  } catch (err) {
    console.error('[oauth:wordpress:connect]', err);
    res.status(500).json({ message: 'Failed to start OAuth flow' });
  }
});

/**
 * GET /hub/oauth-connections/:id/wordpress-sites
 * Fetch WordPress sites for an OAuth connection (for WordPress.com OAuth - kept for compatibility)
 */
router.get('/oauth-connections/:id/wordpress-sites', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.id;

    const { rows } = await query(
      'SELECT access_token, token_type, metadata, expires_at FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'wordpress']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'WordPress connection not found' });
    }

    const { access_token, token_type, metadata } = rows[0];

    // If this is a Basic auth connection (self-hosted), return the site from metadata
    if (token_type === 'Basic' && metadata?.site_url) {
      return res.json({
        sites: [{
          id: metadata.site_url,
          name: metadata.site_url.replace(/^https?:\/\//, ''),
          url: metadata.site_url
        }]
      });
    }

    // Otherwise, try WordPress.com OAuth flow
    let accessToken = access_token;
    const expiresAt = rows[0].expires_at;

    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[oauth:wordpress:sites] Token expired, refreshing...`);
      accessToken = await refreshWordPressAccessToken(connectionId);
    }

    const sites = await fetchWordPressSites(accessToken);
    res.json({ sites });
  } catch (err) {
    console.error('[oauth:wordpress:sites]', err);
    res.status(500).json({ message: 'Failed to fetch WordPress sites' });
  }
});

// ============================================================================
// OAuth Resources (Pages/Locations under a connection)
// ============================================================================

// List resources for a connection
router.get('/oauth-connections/:connectionId/resources', isAdminOrEditor, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM oauth_resources WHERE oauth_connection_id = $1 ORDER BY is_primary DESC, resource_name', [
      req.params.connectionId
    ]);
    res.json({ resources: rows });
  } catch (err) {
    console.error('[oauth-resources:list]', err);
    res.status(500).json({ message: 'Failed to fetch OAuth resources' });
  }
});

// Create OAuth resource
router.post('/oauth-connections/:connectionId/resources', isAdminOrEditor, async (req, res) => {
  try {
    const connectionId = req.params.connectionId;

    // Get connection to inherit client_id and provider
    const connResult = await query('SELECT client_id, provider FROM oauth_connections WHERE id = $1', [connectionId]);
    if (!connResult.rows.length) return res.status(404).json({ message: 'Connection not found' });
    const { client_id, provider } = connResult.rows[0];

    const { resource_type, resource_id, resource_name, resource_username, resource_url, is_primary } = req.body;

    if (!resource_type || !resource_id || !resource_name) {
      return res.status(400).json({ message: 'resource_type, resource_id, and resource_name are required' });
    }

    // If setting as primary, unset other primaries for this connection
    if (is_primary) {
      await query('UPDATE oauth_resources SET is_primary = FALSE WHERE oauth_connection_id = $1', [connectionId]);
    }

    const { rows } = await query(
      `INSERT INTO oauth_resources
       (client_id, oauth_connection_id, provider, resource_type, resource_id, resource_name, resource_username, resource_url, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        client_id,
        connectionId,
        provider,
        resource_type,
        resource_id,
        resource_name,
        resource_username || null,
        resource_url || null,
        is_primary || false
      ]
    );

    // Keep meta_page_links in sync with the canonical oauth_resources state.
    // Fire-and-log: never let a sync failure break the resource creation response.
    if (resource_type === 'facebook_page') {
      try {
        const { syncClientFacebookLinks } = await import('../../services/socialClientLinkSync.js');
        await syncClientFacebookLinks(client_id, { actorId: req.user?.id });
      } catch (syncErr) {
        console.error('[hub:oauth-resources:create] syncClientFacebookLinks failed:', syncErr?.message);
      }
    }

    res.json({ resource: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Resource already exists for this connection' });
    }
    console.error('[oauth-resources:create]', err);
    res.status(500).json({ message: 'Failed to create OAuth resource' });
  }
});

// Update OAuth resource
router.put('/oauth-resources/:id', isAdminOrEditor, async (req, res) => {
  try {
    const { resource_name, resource_username, resource_url, is_primary, is_enabled } = req.body;

    // If setting as primary, unset other primaries
    if (is_primary === true) {
      const resourceResult = await query('SELECT oauth_connection_id FROM oauth_resources WHERE id = $1', [req.params.id]);
      if (resourceResult.rows.length) {
        await query('UPDATE oauth_resources SET is_primary = FALSE WHERE oauth_connection_id = $1 AND id != $2', [
          resourceResult.rows[0].oauth_connection_id,
          req.params.id
        ]);
      }
    }

    const { rows } = await query(
      `UPDATE oauth_resources
       SET resource_name = COALESCE($1, resource_name),
           resource_username = COALESCE($2, resource_username),
           resource_url = COALESCE($3, resource_url),
           is_primary = COALESCE($4, is_primary),
           is_enabled = COALESCE($5, is_enabled),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [resource_name, resource_username, resource_url, is_primary, is_enabled, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Resource not found' });
    res.json({ resource: rows[0] });
  } catch (err) {
    console.error('[oauth-resources:update]', err);
    res.status(500).json({ message: 'Failed to update OAuth resource' });
  }
});

// Delete OAuth resource
router.delete('/oauth-resources/:id', isAdminOrEditor, async (req, res) => {
  try {
    // Capture client_id + resource_type BEFORE deletion so we can sync downstream
    // state (e.g. meta_page_links) once the row is gone.
    const preRow = await query('SELECT client_id, resource_type FROM oauth_resources WHERE id = $1', [req.params.id]);
    const { rowCount } = await query('DELETE FROM oauth_resources WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Resource not found' });

    if (preRow.rows[0]?.resource_type === 'facebook_page') {
      try {
        const { syncClientFacebookLinks } = await import('../../services/socialClientLinkSync.js');
        await syncClientFacebookLinks(preRow.rows[0].client_id, {
          actorId: req.user?.id,
          autoEnableSinglePage: false
        });
      } catch (syncErr) {
        console.error('[hub:oauth-resources:delete] syncClientFacebookLinks failed:', syncErr?.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[oauth-resources:delete]', err);
    res.status(500).json({ message: 'Failed to delete OAuth resource' });
  }
});

export default router;
