/**
 * reCAPTCHA Enterprise service
 *
 * - assessToken(token, action) — verifies a frontend token and returns risk score
 * - getSiteKey()               — public site key for embedding in forms
 *
 * Requires:
 *   RECAPTCHA_SITE_KEY env var
 *   GOOGLE_CLOUD_PROJECT env var
 *   Google Application Default Credentials with roles/recaptchaenterprise.agent
 */

import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';

const PROJECT     = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
const SITE_KEY    = process.env.RECAPTCHA_SITE_KEY;
const THRESHOLD   = 0.5;
const IS_CONFIGURED = !!(SITE_KEY && PROJECT);

let _auth;
function auth() {
  if (!_auth) _auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  return _auth;
}

async function accessToken() {
  const client = await auth().getClient();
  const tok    = await client.getAccessToken();
  return tok.token;
}

/**
 * Assess a reCAPTCHA Enterprise token.
 * Returns { passed, score, valid } — always resolves (never rejects).
 * Fails open (passed: true) if the service is misconfigured or unreachable.
 */
export async function assessToken(token, action = 'submit') {
  // Fail open only on misconfiguration — never on absent client proof
  if (!SITE_KEY || !PROJECT) return { passed: true, score: 1, valid: true, reason: 'unconfigured' };
  // No token reached us (commonly: a privacy browser / tracker-blocker suppressed
  // the reCAPTCHA script, so the widget submitted an empty token).
  if (!token) return { passed: false, score: 0, valid: false, reason: 'missing_token' };
  try {
    const bearer = await accessToken();
    const { data } = await axios.post(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT}/assessments`,
      { event: { token, siteKey: SITE_KEY, expectedAction: action } },
      { headers: { Authorization: `Bearer ${bearer}` }, timeout: 5000 }
    );
    const score       = data.riskAnalysis?.score ?? 0;
    const valid       = data.tokenProperties?.valid ?? false;
    const tokenAction = data.tokenProperties?.action || null;
    const actionMatch = !tokenAction || tokenAction === action;
    const passed      = valid && actionMatch && score >= THRESHOLD;
    // Google Enterprise risk reasons (e.g. AUTOMATION, LOW_CONFIDENCE_SCORE) + the
    // token-invalid reason when applicable — surfaced so staff can see WHY it failed.
    const reasons     = Array.isArray(data.riskAnalysis?.reasons) ? data.riskAnalysis.reasons : [];
    const reason      = passed ? 'ok'
      : !valid ? `invalid_token:${data.tokenProperties?.invalidReason || 'unknown'}`
      : !actionMatch ? 'action_mismatch'
      : 'low_score';
    return { passed, score, valid, action: tokenAction, reason, reasons };
  } catch (err) {
    console.error('[recaptcha:assess]', err.message);
    if (IS_CONFIGURED) {
      // Fail closed in production — a misconfigured or unreachable service must not let requests through
      return { passed: false, score: 0, valid: false, reason: 'service_unavailable', error: 'recaptcha_service_unavailable' };
    }
    // Fail open only when unconfigured (local dev without reCAPTCHA keys)
    return { passed: true, score: 1, valid: true, reason: 'unconfigured_error' };
  }
}

export function getSiteKey() {
  return SITE_KEY || null;
}

/**
 * Register a client's website domain with reCAPTCHA Enterprise.
 * Extracts the hostname from a full URL and adds it to the key's allowed domains.
 * No-op if RECAPTCHA_SITE_KEY is not configured or the key uses allowAllDomains.
 * Always resolves — failures are logged but never bubble up.
 */
export async function registerDomain(websiteUrl) {
  if (!SITE_KEY || !PROJECT || !websiteUrl) return;
  let hostname;
  try {
    hostname = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).hostname;
  } catch {
    return; // unparseable URL — skip
  }
  if (!hostname) return;
  try {
    const bearer = await accessToken();
    const keyName = `projects/${PROJECT}/keys/${SITE_KEY}`;

    // Fetch current key config
    const { data: key } = await axios.get(
      `https://recaptchaenterprise.googleapis.com/v1/${keyName}`,
      { headers: { Authorization: `Bearer ${bearer}` }, timeout: 5000 }
    );

    // If allowAllDomains is already true, no domain list to manage
    if (key.webSettings?.allowAllDomains) return;

    const existing = key.webSettings?.allowedDomains || [];
    if (existing.includes(hostname)) return; // already registered

    await axios.patch(
      `https://recaptchaenterprise.googleapis.com/v1/${keyName}?updateMask=webSettings`,
      { webSettings: { ...key.webSettings, allowedDomains: [...existing, hostname] } },
      { headers: { Authorization: `Bearer ${bearer}` }, timeout: 5000 }
    );
    console.log('[recaptcha] registered domain:', hostname);
  } catch (err) {
    console.error('[recaptcha:registerDomain]', err.message);
  }
}
