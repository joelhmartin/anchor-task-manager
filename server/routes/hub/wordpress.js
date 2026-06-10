// Hub WordPress integration routes: connect a self-hosted WordPress site via
// Application Passwords and test an existing connection. Mounted by the hub.js
// aggregator AFTER `router.use(requireAuth)`; the handlers retain their inline
// requireAuth/isAdminOrEditor guards.
//
// Security:
// - SSRF: the WordPress site URL is user-supplied and fetched server-side, so
//   every fetch target is validated via `assertPublicHttpUrl` (blocks private/
//   loopback/link-local/metadata hosts + non-http(s) schemes) and redirects are
//   not auto-followed (a redirect to an internal host is treated as a failure).
// - Credentials at rest: the Basic-auth credential (base64 user:app-password) is
//   encrypted with the app's AES-256-GCM `encrypt()` before storage and never
//   returned in API responses. Reads tolerate legacy plaintext rows via
//   `isEncrypted`.
import express from 'express';

import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { isAdminOrEditor } from '../../middleware/roles.js';
import { encrypt, decrypt, isEncrypted } from '../../services/security/index.js';
import { assertPublicHttpUrl, SsrfBlockedError } from '../../services/security/ssrfGuard.js';

const router = express.Router();

// Fetch a WordPress REST endpoint with SSRF protection: validate the (DNS-resolved)
// host against the private-range block-list and refuse to follow redirects so a
// public URL can't 30x into an internal host. Returns the fetch Response, or null
// if the URL is blocked / redirected (caller maps null to a 400).
async function safeWpFetch(url, auth) {
  try {
    await assertPublicHttpUrl(url);
  } catch (err) {
    if (err instanceof SsrfBlockedError) return { blocked: true };
    throw err;
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    redirect: 'manual'
  });
  // `manual` surfaces 3xx as an opaque redirect (status 0) or a 3xx status; either
  // way we refuse to chase it to a possibly-internal location.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    return { redirected: true };
  }
  return { response };
}

/**
 * POST /hub/wordpress/connect
 * Connect WordPress using Application Passwords (for self-hosted WordPress sites)
 * Body: { clientId, siteUrl, username, applicationPassword }
 */
router.post('/wordpress/connect', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const { clientId, siteUrl, username, applicationPassword } = req.body;

    if (!clientId || !siteUrl || !username || !applicationPassword) {
      return res.status(400).json({ message: 'clientId, siteUrl, username, and applicationPassword are required' });
    }

    // Normalize site URL
    let normalizedUrl = siteUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    normalizedUrl = normalizedUrl.replace(/\/$/, ''); // Remove trailing slash

    // Test the connection by making a request to the WordPress REST API
    const testUrl = `${normalizedUrl}/wp-json/wp/v2/users/me`;
    const auth = Buffer.from(`${username}:${applicationPassword}`).toString('base64');

    // console.warn (not log) so it survives prod log nulling — useful for debugging connect failures.
    console.warn(`[wordpress:connect] Testing connection to ${testUrl}`);

    const fetchResult = await safeWpFetch(testUrl, auth);
    if (fetchResult.blocked) {
      return res.status(400).json({ message: 'That site URL is not allowed. Enter a public WordPress site URL.' });
    }
    if (fetchResult.redirected) {
      return res.status(400).json({ message: 'The site redirected the request. Enter the canonical site URL (include https:// and www if applicable).' });
    }
    const testResponse = fetchResult.response;

    if (!testResponse.ok) {
      // Note: do not echo the upstream response body back to the caller — it can
      // leak internal/site details. Map known statuses to friendly guidance.
      console.error(`[wordpress:connect] Connection test failed (${testResponse.status})`);

      if (testResponse.status === 401) {
        return res.status(401).json({ message: 'Invalid username or application password. Make sure you created an Application Password in WordPress (Users → Profile → Application Passwords).' });
      }
      if (testResponse.status === 404) {
        return res.status(404).json({ message: 'WordPress REST API not found. Make sure your site has the REST API enabled and the URL is correct.' });
      }
      return res.status(400).json({ message: `Failed to connect to WordPress (HTTP ${testResponse.status}).` });
    }

    const userInfo = await testResponse.json();
    console.warn(`[wordpress:connect] Connected as user: ${userInfo.name} (${userInfo.slug})`);

    // Encrypt the Basic-auth credential at rest (AES-256-GCM). encrypt() returns
    // null if encryption is unavailable (no key) or fails — in that case refuse
    // the connect rather than persist a row with a null/unusable credential
    // (which would silently break later test/publish with no signal at connect).
    const encryptedAuth = encrypt(auth);
    if (!encryptedAuth) {
      console.error('[wordpress:connect] encryption unavailable — refusing to store credential');
      return res.status(500).json({ message: 'Server encryption is unavailable, so the WordPress credential cannot be stored securely. Please contact support.' });
    }

    // Store the connection. The "access_token" field holds the base64 Basic-auth
    // credential, encrypted at rest — never stored or returned raw.
    const { rows } = await query(
      `INSERT INTO oauth_connections
       (client_id, provider, provider_account_id, provider_account_name, access_token, token_type, scope_granted, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        clientId,
        'wordpress',
        userInfo.id.toString(),
        userInfo.name || userInfo.slug,
        encryptedAuth, // Base64-encoded credentials, encrypted at rest
        'Basic',
        JSON.stringify(['read', 'write']),
        'active',
        JSON.stringify({
          site_url: normalizedUrl,
          username: username,
          user_email: userInfo.email,
          user_roles: userInfo.roles
        })
      ]
    );

    console.warn(`[wordpress:connect] Saved connection ${rows[0].id} for client ${clientId}`);
    // Strip the credential from the response — callers never need it.
    const { access_token, ...safeConnection } = rows[0];
    res.json({
      connection: safeConnection,
      message: `Successfully connected to WordPress as ${userInfo.name}`
    });
  } catch (err) {
    console.error('[wordpress:connect]', err);
    res.status(500).json({ message: err.message || 'Failed to connect WordPress' });
  }
});

/**
 * POST /hub/wordpress/test
 * Test WordPress connection for an existing connection
 */
router.post('/wordpress/test', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({ message: 'connectionId is required' });
    }

    const { rows } = await query(
      'SELECT access_token, metadata FROM oauth_connections WHERE id = $1 AND provider = $2',
      [connectionId, 'wordpress']
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'WordPress connection not found' });
    }

    const { access_token: storedAuth, metadata } = rows[0];
    // Decrypt the credential; tolerate legacy rows stored as plaintext base64.
    const auth = isEncrypted(storedAuth) ? decrypt(storedAuth) : storedAuth;
    // decrypt() returns null if the key is unavailable or the data is corrupt.
    // Surface that as a server error rather than sending `Basic null` (which WP
    // answers with a 401 that misleadingly reads as "credentials revoked").
    if (!auth) {
      console.error('[wordpress:test] credential decryption failed — encryption key unavailable or data corrupt');
      return res.status(500).json({ message: 'Unable to decrypt the stored WordPress credentials. Please contact support.' });
    }
    const siteUrl = metadata?.site_url;

    if (!siteUrl) {
      return res.status(400).json({ message: 'Site URL not found in connection metadata' });
    }

    const testUrl = `${siteUrl}/wp-json/wp/v2/users/me`;
    const fetchResult = await safeWpFetch(testUrl, auth);
    if (fetchResult.blocked) {
      return res.status(400).json({ message: 'The stored site URL is not allowed.' });
    }
    if (fetchResult.redirected) {
      return res.status(400).json({ message: 'The site redirected the request. Re-connect with the canonical site URL.' });
    }
    const testResponse = fetchResult.response;

    if (!testResponse.ok) {
      return res.status(testResponse.status).json({ message: 'Connection test failed. The credentials may have been revoked.' });
    }

    const userInfo = await testResponse.json();
    res.json({
      success: true,
      message: `Connected as ${userInfo.name}`,
      user: { id: userInfo.id, name: userInfo.name, email: userInfo.email }
    });
  } catch (err) {
    console.error('[wordpress:test]', err);
    res.status(500).json({ message: 'Failed to test connection' });
  }
});

export default router;
