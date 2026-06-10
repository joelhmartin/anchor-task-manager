// Hub Meta App Review route: a superadmin-only endpoint that exercises each
// Facebook/Instagram Graph API permission so Meta App Review can detect real
// usage. Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`; the
// handler retains its inline requireAuth/requireSuperadmin guards verbatim.
import express from 'express';

import { query } from '../../db.js';
import { logSecurityEvent, SecurityEventTypes, SecurityEventCategories, decrypt } from '../../services/security/index.js';
import {
  refreshFacebookAccessToken,
  fetchFacebookPages,
  testFetchPageEngagement,
  testFetchLeadgenForms,
  testFetchInstagramBasic
} from '../../services/oauthIntegration.js';
import { requireAuth, requireSuperadmin } from '../../middleware/auth.js';

const router = express.Router();

// ============================================================================
// Meta App Review — Permission Test Endpoint
// ============================================================================

/**
 * POST /hub/meta/test-permissions
 * Superadmin-only. Exercises each Facebook/Instagram Graph API permission
 * so Meta App Review can detect real usage and approve the scopes.
 *
 * Body (optional): { connectionId: "uuid" }
 *   If omitted, auto-finds the first active Facebook connection.
 */
router.post('/meta/test-permissions', requireAuth, requireSuperadmin, async (req, res) => {
  const start = Date.now();
  try {
    const { connectionId: requestedId, accessToken: rawToken, pageId: requestedPageId } = req.body || {};

    let accessToken;
    let connectionId = requestedId || null;

    if (rawToken) {
      // Direct token mode — for Meta App Review when no OAuth connection exists yet.
      // Use a token from Graph API Explorer (developers.facebook.com/tools/explorer/).
      accessToken = rawToken;
      console.log('[meta:test-permissions] Using direct access token (Graph API Explorer mode)');
    } else {
      // Lookup from oauth_connections table
      let connQuery;
      if (requestedId) {
        connQuery = await query(
          `SELECT id, access_token, expires_at, client_id
           FROM oauth_connections
           WHERE id = $1 AND provider = 'facebook' AND is_connected = true`,
          [requestedId]
        );
      } else {
        connQuery = await query(
          `SELECT id, access_token, expires_at, client_id
           FROM oauth_connections
           WHERE provider = 'facebook' AND is_connected = true
           ORDER BY created_at DESC LIMIT 1`
        );
      }

      if (!connQuery.rows.length) {
        return res.status(404).json({
          message: 'No active Facebook connection found. You can pass an accessToken from Graph API Explorer instead.',
          hint: 'Go to developers.facebook.com/tools/explorer/, generate a token with the required scopes, and pass it as { "accessToken": "..." }'
        });
      }

      const conn = connQuery.rows[0];
      connectionId = conn.id;
      accessToken = decrypt(conn.access_token) || conn.access_token;

      // Refresh if expired
      if (conn.expires_at && new Date(conn.expires_at) < new Date()) {
        console.log('[meta:test-permissions] Token expired, refreshing...');
        accessToken = await refreshFacebookAccessToken(conn.id);
      }
    }

    const permissions = {};
    let pages = [];

    // 1. pages_show_list — reuse existing helper
    try {
      pages = await fetchFacebookPages(accessToken);
      permissions.pages_show_list = {
        endpoint: 'GET /me/accounts',
        status: 200,
        success: true,
        dataCount: pages.length
      };
    } catch (err) {
      permissions.pages_show_list = {
        endpoint: 'GET /me/accounts',
        success: false,
        error: err.message
      };
    }

    // We need a page access token + page ID for the remaining tests.
    // If a specific pageId was requested, find that page; otherwise use the first one.
    let targetPage = null;
    if (requestedPageId && pages.length > 0) {
      targetPage = pages.find(p => p.id === requestedPageId) || null;
      if (!targetPage) {
        console.log(`[meta:test-permissions] Requested pageId ${requestedPageId} not in /me/accounts results (${pages.map(p => p.id).join(', ')}). Falling back to user token for page-level calls.`);
      }
    } else if (pages.length > 0) {
      targetPage = pages[0];
    }

    // If we have a target page, use its page access token. Otherwise, if a pageId was
    // provided with a direct user token, try using the user token directly against that page.
    const pageToken = targetPage?.accessToken || (requestedPageId && rawToken ? rawToken : null);
    const pageId = targetPage?.id || requestedPageId || null;

    // 2. pages_read_engagement
    if (pageToken && pageId) {
      try {
        permissions.pages_read_engagement = await testFetchPageEngagement(pageToken, pageId);
      } catch (err) {
        permissions.pages_read_engagement = {
          endpoint: `GET /${pageId}/ratings`,
          success: false,
          error: err.message
        };
      }
    } else {
      permissions.pages_read_engagement = {
        skipped: true,
        reason: 'No pages available to test against'
      };
    }

    // 3. leads_retrieval
    if (pageToken && pageId) {
      try {
        permissions.leads_retrieval = await testFetchLeadgenForms(pageToken, pageId);
      } catch (err) {
        permissions.leads_retrieval = {
          forms: { success: false, error: err.message },
          leads: null
        };
      }
    } else {
      permissions.leads_retrieval = {
        skipped: true,
        reason: 'No pages available to test against'
      };
    }

    // 4. instagram_basic
    if (pageToken && pageId) {
      try {
        permissions.instagram_basic = await testFetchInstagramBasic(pageToken, pageId);
      } catch (err) {
        permissions.instagram_basic = {
          endpoint: `GET /${pageId}?fields=instagram_business_account`,
          success: false,
          error: err.message
        };
      }
    } else {
      permissions.instagram_basic = {
        skipped: true,
        reason: 'No pages available to test against'
      };
    }

    // 5. ads_read — fetch ad accounts to verify the permission
    if (accessToken) {
      try {
        const adsUrl = `https://graph.facebook.com/v18.0/me/adaccounts?fields=id,name,account_status&limit=5&access_token=${accessToken}`;
        const adsRes = await fetch(adsUrl);
        const adsData = adsRes.ok ? await adsRes.json() : null;
        permissions.ads_read = {
          endpoint: 'GET /me/adaccounts',
          status: adsRes.status,
          success: adsRes.ok,
          dataCount: adsData?.data?.length ?? 0
        };
      } catch (err) {
        permissions.ads_read = {
          endpoint: 'GET /me/adaccounts',
          success: false,
          error: err.message
        };
      }
    } else {
      permissions.ads_read = {
        skipped: true,
        reason: 'No access token available to test ads_read'
      };
    }

    // Build summary
    // leads_retrieval has nested shape { forms, leads } — derive success from forms.success
    const entries = Object.entries(permissions).map(([key, val]) => {
      if (key === 'leads_retrieval' && val.forms) {
        return { ...val, success: val.forms.success };
      }
      return val;
    });
    const passed = entries.filter(p => p.success === true).length;
    const failed = entries.filter(p => p.success === false).length;
    const skipped = entries.filter(p => p.skipped === true).length;

    const durationMs = Date.now() - start;

    // Audit trail
    logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: {
        action: 'meta_permission_test',
        connectionId: connectionId || 'direct_token',
        mode: rawToken ? 'graph_api_explorer' : 'oauth_connection',
        summary: { passed, failed, skipped }
      }
    });

    res.json({
      testedAt: new Date().toISOString(),
      connectionId: connectionId || 'direct_token',
      permissions,
      summary: { total: entries.length, passed, failed, skipped },
      durationMs
    });
  } catch (err) {
    console.error('[meta:test-permissions]', err);
    res.status(500).json({ message: 'Failed to run Meta permission tests' });
  }
});

export default router;
