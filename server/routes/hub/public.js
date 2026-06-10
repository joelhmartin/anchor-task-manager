// Public (pre-`requireAuth`) hub routes: the user avatar image endpoint and the
// four OAuth provider callbacks. These MUST stay reachable without auth, so the
// aggregator (hub.js) mounts this router BEFORE `router.use(requireAuth)`.
import express from 'express';

import { query } from '../../db.js';
import { logSecurityEvent, SecurityEventTypes, SecurityEventCategories } from '../../services/security/index.js';
import {
  // Google
  getGoogleBusinessOAuthConfig,
  exchangeCodeForTokens,
  fetchGoogleProfile,
  // Facebook/Instagram
  getFacebookOAuthConfig,
  exchangeFacebookCodeForTokens,
  fetchFacebookProfile,
  // TikTok
  getTikTokOAuthConfig,
  exchangeTikTokCodeForTokens,
  fetchTikTokProfile,
  // WordPress
  getWordPressOAuthConfig,
  exchangeWordPressCodeForTokens,
  fetchWordPressProfile,
  // Shared
  getOAuthCookies,
  clearOAuthCookies,
  saveOAuthConnection
} from '../../services/oauthIntegration.js';
import { resolveBaseUrl } from '../../services/hubUtils.js';

const router = express.Router();

// Avatar GET endpoint is PUBLIC (before requireAuth) so avatars load during onboarding
// and in any context where the image needs to be displayed. Avatars are not sensitive data.
router.get('/users/:id/avatar', async (req, res) => {
  try {
    const targetUserId = String(req.params.id || '').trim();
    if (!targetUserId) return res.status(400).send('Missing user id');

    const { rows } = await query('SELECT content_type, bytes FROM user_avatars WHERE user_id = $1 LIMIT 1', [targetUserId]);
    if (!rows.length) return res.status(404).send('Not found');

    const row = rows[0];
    res.setHeader('Content-Type', row.content_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Public cache since avatars are public
    res.send(row.bytes);
  } catch (err) {
    console.error('[hub:avatar:get]', err);
    res.status(500).send('Failed to load avatar');
  }
});

// ============================================================================
// OAuth Callbacks (Public - No Auth Required)
// These routes receive redirects from OAuth providers after user authorization
// They must be defined BEFORE router.use(requireAuth)
// ============================================================================

/**
 * GET /hub/oauth/google/callback
 * Handle Google OAuth callback from Google after user authorization
 */
router.get('/oauth/google/callback', async (req, res) => {
  const baseUrl = resolveBaseUrl(req);
  const adminHubUrl = `${baseUrl}/client-hub`;

  try {
    const { code, state, error } = req.query;

    if (error) {
      console.log(`[oauth:google:callback] OAuth error: ${error}`);
      clearOAuthCookies(res, 'google');
      return res.redirect(`${adminHubUrl}?oauth=error&message=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      console.log('[oauth:google:callback] Missing code or state');
      clearOAuthCookies(res, 'google');
      return res.redirect(`${adminHubUrl}?oauth=error&message=missing_code`);
    }

    if (typeof code !== 'string' || code.length > 512 || typeof state !== 'string' || state.length > 128) {
      console.log('[oauth:google:callback] Invalid code or state format');
      clearOAuthCookies(res, 'google');
      return res.redirect(`${adminHubUrl}?oauth=error&message=invalid_request`);
    }

    const cookies = getOAuthCookies(req, 'google');

    if (!cookies.state || cookies.state !== state) {
      console.log('[oauth:google:callback] State mismatch');
      clearOAuthCookies(res, 'google');
      return res.redirect(`${adminHubUrl}?oauth=error&message=state_mismatch`);
    }

    if (!cookies.verifier || !cookies.clientId) {
      console.log('[oauth:google:callback] Missing verifier or clientId in cookies');
      clearOAuthCookies(res, 'google');
      return res.redirect(`${adminHubUrl}?oauth=error&message=session_expired`);
    }

    const clientId = cookies.clientId;
    clearOAuthCookies(res, 'google');

    const redirectUri = `${baseUrl}/api/hub/oauth/google/callback`;
    const config = getGoogleBusinessOAuthConfig(redirectUri);

    console.log('[oauth:google:callback] Exchanging code for tokens...');
    const tokens = await exchangeCodeForTokens(config, code, cookies.verifier);

    console.log('[oauth:google:callback] Fetching Google profile...');
    const profile = await fetchGoogleProfile(tokens.access_token);

    console.log('[oauth:google:callback] Profile fetched successfully');

    const connection = await saveOAuthConnection(clientId, 'google', tokens, profile);
    console.log('[oauth:google:callback] Connection saved successfully');

    logSecurityEvent({
      userId: clientId,
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { provider: 'google', connectionId: connection.id }
    });

    res.redirect(`${adminHubUrl}?oauth=success&provider=google&clientId=${clientId}`);
  } catch (err) {
    console.error('[oauth:google:callback]', err);
    clearOAuthCookies(res, 'google');

    logSecurityEvent({
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      failureReason: err.message
    });

    res.redirect(`${adminHubUrl}?oauth=error&message=connection_failed`);
  }
});

/**
 * GET /hub/oauth/facebook/callback
 * Handle Facebook OAuth callback
 */
router.get('/oauth/facebook/callback', async (req, res) => {
  const baseUrl = resolveBaseUrl(req);
  const adminHubUrl = `${baseUrl}/client-hub`;

  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.log(`[oauth:facebook:callback] OAuth error: ${error} - ${error_description}`);
      clearOAuthCookies(res, 'facebook');
      return res.redirect(`${adminHubUrl}?oauth=error&message=${encodeURIComponent(error_description || error)}`);
    }

    if (!code || !state) {
      console.log('[oauth:facebook:callback] Missing code or state');
      clearOAuthCookies(res, 'facebook');
      return res.redirect(`${adminHubUrl}?oauth=error&message=missing_code`);
    }

    if (typeof code !== 'string' || code.length > 512 || typeof state !== 'string' || state.length > 128) {
      console.log('[oauth:facebook:callback] Invalid code or state format');
      clearOAuthCookies(res, 'facebook');
      return res.redirect(`${adminHubUrl}?oauth=error&message=invalid_request`);
    }

    const cookies = getOAuthCookies(req, 'facebook');

    if (!cookies.state || cookies.state !== state) {
      console.log('[oauth:facebook:callback] State mismatch');
      clearOAuthCookies(res, 'facebook');
      return res.redirect(`${adminHubUrl}?oauth=error&message=state_mismatch`);
    }

    if (!cookies.clientId) {
      console.log('[oauth:facebook:callback] Missing clientId in cookies');
      clearOAuthCookies(res, 'facebook');
      return res.redirect(`${adminHubUrl}?oauth=error&message=session_expired`);
    }

    const clientId = cookies.clientId;
    clearOAuthCookies(res, 'facebook');

    const redirectUri = `${baseUrl}/api/hub/oauth/facebook/callback`;
    const config = getFacebookOAuthConfig(redirectUri);

    console.log('[oauth:facebook:callback] Exchanging code for tokens...');
    const tokens = await exchangeFacebookCodeForTokens(config, code);

    console.log('[oauth:facebook:callback] Fetching Facebook profile...');
    const profile = await fetchFacebookProfile(tokens.access_token);

    console.log('[oauth:facebook:callback] Profile fetched successfully');

    const connection = await saveOAuthConnection(clientId, 'facebook', tokens, profile);
    console.log('[oauth:facebook:callback] Connection saved successfully');

    logSecurityEvent({
      userId: clientId,
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { provider: 'facebook', connectionId: connection.id }
    });

    res.redirect(`${adminHubUrl}?oauth=success&provider=facebook&clientId=${clientId}`);
  } catch (err) {
    console.error('[oauth:facebook:callback]', err);
    clearOAuthCookies(res, 'facebook');

    logSecurityEvent({
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      failureReason: err.message
    });

    res.redirect(`${adminHubUrl}?oauth=error&message=connection_failed`);
  }
});

/**
 * GET /hub/oauth/tiktok/callback
 * Handle TikTok OAuth callback
 */
router.get('/oauth/tiktok/callback', async (req, res) => {
  const baseUrl = resolveBaseUrl(req);
  const adminHubUrl = `${baseUrl}/client-hub`;

  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.log(`[oauth:tiktok:callback] OAuth error: ${error} - ${error_description}`);
      clearOAuthCookies(res, 'tiktok');
      return res.redirect(`${adminHubUrl}?oauth=error&message=${encodeURIComponent(error_description || error)}`);
    }

    if (!code || !state) {
      console.log('[oauth:tiktok:callback] Missing code or state');
      clearOAuthCookies(res, 'tiktok');
      return res.redirect(`${adminHubUrl}?oauth=error&message=missing_code`);
    }

    if (typeof code !== 'string' || code.length > 512 || typeof state !== 'string' || state.length > 128) {
      console.log('[oauth:tiktok:callback] Invalid code or state format');
      clearOAuthCookies(res, 'tiktok');
      return res.redirect(`${adminHubUrl}?oauth=error&message=invalid_request`);
    }

    const cookies = getOAuthCookies(req, 'tiktok');

    if (!cookies.state || cookies.state !== state) {
      console.log('[oauth:tiktok:callback] State mismatch');
      clearOAuthCookies(res, 'tiktok');
      return res.redirect(`${adminHubUrl}?oauth=error&message=state_mismatch`);
    }

    if (!cookies.verifier || !cookies.clientId) {
      console.log('[oauth:tiktok:callback] Missing verifier or clientId in cookies');
      clearOAuthCookies(res, 'tiktok');
      return res.redirect(`${adminHubUrl}?oauth=error&message=session_expired`);
    }

    const clientId = cookies.clientId;
    clearOAuthCookies(res, 'tiktok');

    const redirectUri = `${baseUrl}/api/hub/oauth/tiktok/callback`;
    const config = getTikTokOAuthConfig(redirectUri);

    console.log('[oauth:tiktok:callback] Exchanging code for tokens...');
    const tokens = await exchangeTikTokCodeForTokens(config, code, cookies.verifier);

    console.log('[oauth:tiktok:callback] Fetching TikTok profile...');
    const profile = await fetchTikTokProfile(tokens.access_token);

    console.log('[oauth:tiktok:callback] Profile fetched successfully');

    const connection = await saveOAuthConnection(clientId, 'tiktok', tokens, profile);
    console.log('[oauth:tiktok:callback] Connection saved successfully');

    logSecurityEvent({
      userId: clientId,
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { provider: 'tiktok', connectionId: connection.id }
    });

    res.redirect(`${adminHubUrl}?oauth=success&provider=tiktok&clientId=${clientId}`);
  } catch (err) {
    console.error('[oauth:tiktok:callback]', err);
    clearOAuthCookies(res, 'tiktok');

    logSecurityEvent({
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      failureReason: err.message
    });

    res.redirect(`${adminHubUrl}?oauth=error&message=connection_failed`);
  }
});

/**
 * GET /hub/oauth/wordpress/callback
 * Handle WordPress OAuth callback
 */
router.get('/oauth/wordpress/callback', async (req, res) => {
  const baseUrl = resolveBaseUrl(req);
  const adminHubUrl = `${baseUrl}/client-hub`;

  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.log(`[oauth:wordpress:callback] OAuth error: ${error} - ${error_description}`);
      clearOAuthCookies(res, 'wordpress');
      return res.redirect(`${adminHubUrl}?oauth=error&message=${encodeURIComponent(error_description || error)}`);
    }

    if (!code || !state) {
      console.log('[oauth:wordpress:callback] Missing code or state');
      clearOAuthCookies(res, 'wordpress');
      return res.redirect(`${adminHubUrl}?oauth=error&message=missing_code`);
    }

    if (typeof code !== 'string' || code.length > 512 || typeof state !== 'string' || state.length > 128) {
      console.log('[oauth:wordpress:callback] Invalid code or state format');
      clearOAuthCookies(res, 'wordpress');
      return res.redirect(`${adminHubUrl}?oauth=error&message=invalid_request`);
    }

    const cookies = getOAuthCookies(req, 'wordpress');

    if (!cookies.state || cookies.state !== state) {
      console.log('[oauth:wordpress:callback] State mismatch');
      clearOAuthCookies(res, 'wordpress');
      return res.redirect(`${adminHubUrl}?oauth=error&message=state_mismatch`);
    }

    if (!cookies.clientId) {
      console.log('[oauth:wordpress:callback] Missing clientId in cookies');
      clearOAuthCookies(res, 'wordpress');
      return res.redirect(`${adminHubUrl}?oauth=error&message=session_expired`);
    }

    const clientId = cookies.clientId;
    clearOAuthCookies(res, 'wordpress');

    const redirectUri = `${baseUrl}/api/hub/oauth/wordpress/callback`;
    const config = getWordPressOAuthConfig(redirectUri);

    console.log('[oauth:wordpress:callback] Exchanging code for tokens...');
    const tokens = await exchangeWordPressCodeForTokens(config, code);

    console.log('[oauth:wordpress:callback] Fetching WordPress profile...');
    const profile = await fetchWordPressProfile(tokens.access_token, tokens);

    console.log('[oauth:wordpress:callback] Profile fetched successfully');

    const connection = await saveOAuthConnection(clientId, 'wordpress', tokens, profile);
    console.log('[oauth:wordpress:callback] Connection saved successfully');

    logSecurityEvent({
      userId: clientId,
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { provider: 'wordpress', connectionId: connection.id }
    });

    res.redirect(`${adminHubUrl}?oauth=success&provider=wordpress&clientId=${clientId}`);
  } catch (err) {
    console.error('[oauth:wordpress:callback]', err);
    clearOAuthCookies(res, 'wordpress');

    logSecurityEvent({
      eventType: SecurityEventTypes.OAUTH_CONNECTED,
      eventCategory: SecurityEventCategories.OAUTH,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      failureReason: err.message
    });

    res.redirect(`${adminHubUrl}?oauth=error&message=connection_failed`);
  }
});

export default router;
