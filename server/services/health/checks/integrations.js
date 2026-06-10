import { registerHealthCheck } from '../registry.js';
import { listGoogleAdsAccounts } from '../../analytics/googleAdsAdapter.js';
import { listGA4Properties } from '../../analytics/ga4Adapter.js';
import { fetchAdAccounts } from '../../analytics/metaAdsAdapter.js';
import { pingCtm } from '../../ctm.js';
import { pingMailgun } from '../../mailgun.js';

// 'fail' = a required cred is broken. 'warn' = an optional integration is simply
// not configured (don't nag about features the agency doesn't use).
function ok(detail, metrics) { return { status: 'ok', detail, metrics }; }
function fail(detail, error, metrics) { return { status: 'fail', detail, error, metrics }; }
function warnUnconfigured(detail) { return { status: 'warn', detail, metrics: { configured: false } }; }

registerHealthCheck('integ.google_ads', {
  label: 'Google Ads API (MCC OAuth)',
  category: 'integration',
  run: async () => {
    // listGoogleAdsAccounts() returns [] when EITHER the developer token or the
    // refresh token is missing — treat both as "unconfigured" (warn), not a hard fail.
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN || !process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      return warnUnconfigured('Google Ads credentials not fully configured.');
    }
    const accounts = await listGoogleAdsAccounts();
    const n = Array.isArray(accounts) ? accounts.length : 0;
    return n > 0
      ? ok(`MCC OAuth valid — ${n} accessible account(s).`, { count: n })
      : fail('Google Ads returned zero accessible accounts.', 'no accessible customers', { count: 0 });
  }
});

registerHealthCheck('integ.meta', {
  label: 'Meta Graph API (system-user token)',
  category: 'integration',
  run: async () => {
    const token = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!token) return warnUnconfigured('Meta system-user token not configured.');
    // An invalid/expired token throws (→ caught upstream → fail). A valid token that
    // can still see at least one ad account is healthy; zero visible accounts means
    // the token silently lost Business Manager access → fail.
    const accounts = await fetchAdAccounts(token);
    const n = Array.isArray(accounts) ? accounts.length : 0;
    return n > 0
      ? ok(`System-user token valid — ${n} ad account(s) visible.`, { count: n })
      : fail('Meta token valid but zero ad accounts visible.', 'token lost Business Manager access', { count: n });
  }
});

registerHealthCheck('integ.ctm', {
  label: 'CallTrackingMetrics API (agency key)',
  category: 'integration',
  run: async () => {
    const { ok: live, status, reason } = await pingCtm();
    if (reason) return warnUnconfigured(reason);
    return live
      ? ok(`CTM agency key valid (HTTP ${status}).`, { status })
      : fail(`CTM API returned HTTP ${status}.`, `unexpected status ${status}`, { status });
  }
});

registerHealthCheck('integ.mailgun', {
  label: 'Mailgun (transactional email)',
  category: 'integration',
  run: async () => {
    const { ok: live, configured } = await pingMailgun();
    if (!configured) return warnUnconfigured('Mailgun not configured.');
    return live ? ok('Mailgun auth valid.') : fail('Mailgun auth failed.', 'domains.list failed');
  }
});

registerHealthCheck('integ.ga4', {
  label: 'Google Analytics 4 (service account)',
  category: 'integration',
  // listGA4Properties() is an N+1 over 37+ properties (a dataStreams.list per
  // property), so it can run several seconds — give it more headroom than the 15s
  // default to avoid a latency-driven false fail on a slow Admin API day.
  timeoutMs: 30000,
  run: async () => {
    const properties = await listGA4Properties();
    const n = Array.isArray(properties) ? properties.length : 0;
    return n > 0
      ? ok(`GA4 service account valid — ${n} propert(ies) visible.`, { count: n })
      : fail('GA4 returned zero properties.', 'no properties or auth failure', { count: 0 });
  }
});
