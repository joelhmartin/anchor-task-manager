/**
 * CTM Forms API Routes
 *
 * Dedicated routes for the CTM Forms module.
 * Separate from the generic forms system.
 */

import { Router } from 'express';
import crypto from 'crypto';
import cors from 'cors';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isAdminOrEditor } from '../middleware/roles.js';
import {
  renderConfigToHtml,
  createFormReactor,
  deleteFormReactor,
  submitToCtm,
  setCallCustomFields,
  syncCustomFieldsToAccount,
  hashFieldConfig,
  fetchReactorsList,
  fetchReactorDetail,
  sanitizeFieldName
} from '../services/ctmFormBuilder.js';
import { sendSubmissionNotification, sendTestNotification, sendAutoresponderEmail } from '../services/ctmFormNotifications.js';
import { sendEvent as sendTrackingEvent } from '../services/trackingRelay.js';
import { generateAiResponse } from '../services/ai.js';
import { assessToken, getSiteKey } from '../services/recaptcha.js';
import { resolveCtmCreds } from '../services/ctm.js';
import {
  decideRecaptchaAction,
  resolveRecaptchaMode,
  SUBMISSION_STATUS,
  BLOCK_REASONS
} from '../services/ctmFormOutcome.js';
import { enqueueCtmRetry, forwardSubmissionToCtm } from '../services/ctmRetryQueue.js';
import { createRateLimiter, getClientIp } from '../middleware/rateLimit.js';
import { logSecurityEvent, SecurityEventCategories, encrypt, decrypt } from '../services/security/index.js';
import { logFormActivity, ActivityEventTypes } from '../services/activityLog.js';

const router = Router();

// Rate limiters for public embed endpoints (no auth)
const embedLoadRateLimiter = createRateLimiter('ctm_embed_load_ip', (req) => getClientIp(req));
const embedSubmitRateLimiter = createRateLimiter('ctm_embed_submit_ip', (req) => getClientIp(req));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateEmbedToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Browser Google Ads conversions require AW-{conversionId}/{conversionLabel} from the
// Google Ads tag snippet — NOT the customer_id/conversion_action_id used by the offline API.
// When present, the tracking config stores those browser values directly. For older configs,
// derive them from the saved lead_submitted/form_submitted conversion mapping.

/**
 * AI spam classifier — returns true if the submission looks like spam.
 * Uses the client's own ai_prompt (business type, services, specialty) as context
 * so "spam" is judged relative to what a legitimate inquiry looks like for that business.
 * Fails open (returns false) on errors or timeouts.
 */
// Passphrase bypass — any mention of "Anchor Corps" or "Anchor Test" (case-insensitive).
function hasTestPassphrase(fields) {
  const text = Object.values(fields).join(' ').toLowerCase();
  return /anchor\s*(corps|test)/.test(text);
}

function getBrowserGoogleAdsSendTo(config) {
  if (!config) return null;

  if (config.google_ads_conversion_id && config.google_ads_conversion_label) {
    return `AW-${config.google_ads_conversion_id}/${config.google_ads_conversion_label}`;
  }

  const mapping = config.conversion_mappings?.lead_submitted || config.conversion_mappings?.form_submitted;
  if (mapping?.conversionId && mapping?.conversionLabel) {
    return `AW-${mapping.conversionId}/${mapping.conversionLabel}`;
  }

  return null;
}

/**
 * Fast heuristic pre-filter — catches obvious spam without an AI call.
 * Returns true if the submission is almost certainly spam based on hard signals.
 */
function isObviousSpam(fields) {
  const text = Object.values(fields).join(' ');

  // URLs in the message body (legitimate patients/clients don't paste links)
  const messageFields = ['message', 'comments', 'notes', 'details', 'question'];
  const messageText = Object.entries(fields)
    .filter(([k]) => messageFields.some(mf => k.toLowerCase().includes(mf)))
    .map(([, v]) => v)
    .join(' ');

  if (messageText) {
    // Count URLs — one might be a reference, but 2+ is almost always solicitation
    const urls = messageText.match(/https?:\/\/[^\s)<]+/gi) || [];
    if (urls.length >= 2) return 'multiple URLs in message body';

    // Single URL that isn't the client's own site (we don't know their domain here,
    // but scheduling/booking links are a dead giveaway for sales pitches)
    if (urls.length === 1 && /\b(calendly|getdandy|hubspot|bit\.ly|goo\.gl|tinyurl|schedule|booking|demo)\b/i.test(messageText)) {
      return 'scheduling/solicitation link in message';
    }
  }

  // Known spam email domains (B2B service solicitation)
  const email = (fields.email || '').toLowerCase();
  if (/(getdandy|webfx|hibu|yext|birdeye|podium|thryv|scorpion|cardinaldigital|patientpop|solutionreach)\.(com|io)/.test(email)) {
    return 'known solicitation domain';
  }

  // Message is excessively long for a contact form (>800 chars is unusual for real inquiries)
  if (messageText && messageText.length > 800) {
    // Long messages with sales keywords are spam
    const salesSignals = (messageText.match(/\b(ROI|return|revenue|booking|consultation|demo|schedule|activate|payroll|CRM|dashboard|AI agent|results)\b/gi) || []).length;
    if (salesSignals >= 4) return 'long message with multiple sales keywords';
  }

  return false;
}

async function classifySpam(fields, orgId) {
  try {
    // Passphrase bypass — lets Anchor Corps staff run analytics/submission tests
    if (hasTestPassphrase(fields)) return false;

    // Fast heuristic check — no AI call needed for obvious spam
    const heuristicResult = isObviousSpam(fields);
    if (heuristicResult) {
      console.log(`[spam-filter] Blocked by heuristic: ${heuristicResult}`);
      return true;
    }

    const text = Object.entries(fields)
      .filter(([k]) => !['phone_number', 'country_code', 'visitor_ip', 'user_agent', 'caller_name', 'email'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    if (!text.trim()) return false;

    // Fetch the client's business context (same prompt used by the lead classifier)
    let businessContext = '';
    if (orgId) {
      const { rows } = await query(`SELECT ai_prompt FROM client_profiles WHERE user_id = $1 LIMIT 1`, [orgId]).catch(() => ({ rows: [] }));
      businessContext = rows[0]?.ai_prompt || '';
    }

    const systemPrompt =
      (businessContext ? `${businessContext}\n\n` : '') +
      'You are a spam filter for this business\'s contact form. ' +
      'Reply with exactly one word: SPAM or LEGIT. ' +
      'Mark SPAM if the submission is: selling services, soliciting business, offering SEO/marketing/web/IT/leads/staffing, ' +
      'contains external URLs or promotional links, is a recruitment pitch, or is clearly not from someone seeking the services this business offers. ' +
      'Mark LEGIT if it is from a potential customer, patient, or client genuinely inquiring about the services this business provides.';

    const result = await Promise.race([
      generateAiResponse({
        model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || 'gemini-2.5-flash',
        maxTokens: 5,
        temperature: 0,
        systemPrompt,
        prompt: text
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('spam-timeout')), 8000))
    ]);

    const verdict = typeof result === 'string' && result.trim().toUpperCase().startsWith('SPAM');
    console.log(`[spam-filter] AI verdict: ${result?.trim()} → ${verdict ? 'BLOCKED' : 'passed'}`);
    return verdict;
  } catch (err) {
    console.warn(`[spam-filter] Failed (${err.message}), allowing submission through`);
    return false; // fail open — don't block legitimate submissions
  }
}

async function getCtmCredentials(orgId) {
  const { rows } = await query(
    `SELECT ctm_account_number, ctm_api_key, ctm_api_secret FROM client_profiles WHERE user_id = $1`,
    [orgId]
  );
  return resolveCtmCreds(rows[0] || null);
}

async function getOwnedFormOr404(req, res, select = 'id') {
  const actingOrgId = req.portalUserId && req.portalUserId !== req.user.id ? req.portalUserId : null;
  const params = [req.params.id];
  let where = 'WHERE id = $1';
  if (actingOrgId) {
    params.push(actingOrgId);
    where += ' AND org_id = $2';
  }
  const { rows } = await query(`SELECT ${select} FROM ctm_forms ${where}`, params);
  if (!rows[0]) {
    res.status(404).json({ error: 'Form not found' });
    return null;
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Encryption helpers for field_data (Finding 1)
// ---------------------------------------------------------------------------

/**
 * Serialize and encrypt field data for storage.
 * Stores as {"_enc":true,"v":"<encrypted>"} JSONB so the column stays valid JSON.
 * Falls back to unencrypted JSON if encryption is unavailable.
 * TODO: backfill migration needed for existing unencrypted rows.
 */
/**
 * Hash a phone number for duplicate detection on encrypted rows.
 * Normalizes to last 10 digits, then SHA256.
 */
function hashPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  if (digits.length < 7) return null; // too short to be a real phone
  return crypto.createHash('sha256').update(digits).digest('hex');
}

function encryptFieldData(fields) {
  const json = JSON.stringify(fields);
  const encrypted = encrypt(json);
  if (encrypted) {
    return JSON.stringify({ _enc: true, v: encrypted });
  }
  // Encryption unavailable (should not happen in production) — store plaintext
  return json;
}

/**
 * Decrypt field_data from a submission row.
 * Handles both encrypted {"_enc":true,"v":"..."} and legacy plaintext JSONB.
 */
function decryptFieldData(fieldData) {
  if (!fieldData) return fieldData;
  if (fieldData._enc === true && fieldData.v) {
    const decrypted = decrypt(fieldData.v);
    if (decrypted) {
      try { return JSON.parse(decrypted); } catch { return fieldData; }
    }
  }
  // Legacy unencrypted row — return as-is
  return fieldData;
}

/**
 * Record a conversion-funnel event for a form (fire-and-forget telemetry).
 * Backs the "loaded → submitted → blocked → sent" diagnostics in the analytics pane.
 * Never throws — telemetry must not break a submission.
 */
async function recordFunnel(formId, event, meta) {
  if (!formId || !event) return;
  try {
    await query(
      `INSERT INTO ctm_form_funnel_events (form_id, event, meta) VALUES ($1, $2, $3::jsonb)`,
      [formId, String(event).slice(0, 64), meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error('[ctmForms:funnel]', err.message);
  }
}

// Funnel events the embed widget is allowed to report (allowlist — it's a public endpoint).
const CLIENT_FUNNEL_EVENTS = new Set([
  'rendered', 'submit_click', 'validation_failed', 'recaptcha_missing',
  'post_start', 'post_failed', 'post_success', 'duplicate_shown', 'blocked_shown'
]);

const LAYOUT_FIELD_TYPES = new Set(['heading', 'paragraph', 'divider', 'score_display', 'hidden']);

function normalizeSubmissionValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : item))
      .filter((item) => item !== '' && item !== null && item !== undefined);
  }
  return typeof value === 'string' ? value.trim() : value;
}

function isEmptySubmissionValue(field, value) {
  const normalized = normalizeSubmissionValue(value);

  if (field?.type === 'checkbox') {
    return !Array.isArray(normalized) || normalized.length === 0;
  }

  if (field?.type === 'consent') {
    const consent = String(normalized || '').toLowerCase();
    return !['yes', 'true', '1', 'on'].includes(consent);
  }

  if (Array.isArray(normalized)) {
    return normalized.length === 0;
  }

  return normalized === '' || normalized === null || normalized === undefined;
}

function evaluateSubmissionCondition(rule, values) {
  const raw = values?.[rule?.field] ?? values?.[rule?.fieldId];
  const normalized = normalizeSubmissionValue(raw);
  const target = String(rule?.value ?? '');

  switch (rule?.operator) {
    case 'equals':
      return Array.isArray(normalized) ? normalized.map(String).includes(target) : String(normalized ?? '') === target;
    case 'not_equals':
      return Array.isArray(normalized) ? !normalized.map(String).includes(target) : String(normalized ?? '') !== target;
    case 'contains':
      return Array.isArray(normalized) ? normalized.map(String).includes(target) : String(normalized ?? '').includes(target);
    case 'not_contains':
      return Array.isArray(normalized) ? !normalized.map(String).includes(target) : !String(normalized ?? '').includes(target);
    case 'is_empty':
      return isEmptySubmissionValue(null, normalized);
    case 'is_not_empty':
      return !isEmptySubmissionValue(null, normalized);
    case 'greater_than':
      return parseFloat(Array.isArray(normalized) ? normalized[0] : normalized) > parseFloat(target);
    case 'less_than':
      return parseFloat(Array.isArray(normalized) ? normalized[0] : normalized) < parseFloat(target);
    default:
      return true;
  }
}

function shouldValidateField(field, values) {
  const conditions = Array.isArray(field?.conditions) ? field.conditions : [];
  if (!conditions.length) return true;
  const logic = field.conditionLogic === 'any' ? 'any' : 'all';
  return logic === 'any'
    ? conditions.some((rule) => evaluateSubmissionCondition(rule, values))
    : conditions.every((rule) => evaluateSubmissionCondition(rule, values));
}

function validateRequiredFields(fields, submittedValues) {
  for (const field of fields) {
    if (!field?.required || LAYOUT_FIELD_TYPES.has(field.type)) continue;
    if (!shouldValidateField(field, submittedValues)) continue;

    const key = sanitizeFieldName(field.name || '');
    const value = submittedValues[key] ?? submittedValues[field.id];
    if (isEmptySubmissionValue(field, value)) {
      throw new Error(`${field.label || field.name || 'This field'} is required`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public Embed Endpoints (no auth, CORS enabled)
// ---------------------------------------------------------------------------

const embedCors = cors({ origin: true, methods: ['GET', 'POST', 'OPTIONS'], credentials: false });

router.options('/embed/:token', embedCors);
router.options('/embed/:token/analytics-log', embedCors);

// GET /api/ctm-forms/embed/:token — load form config for embedding
router.get('/embed/:token', embedCors, embedLoadRateLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM ctm_forms WHERE embed_token = $1 AND status = 'published'`,
      [req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });

    const form = rows[0];
    const config = form.config_json || { settings: {}, fields: [] };

    // Fetch the CTM account number and client analytics defaults
    let ctmAccountNumber = null;
    let clientAnalyticsDefaults = {};
    try {
      const { rows: cp } = await query(
        `SELECT ctm_account_number, analytics_defaults FROM client_profiles WHERE user_id = $1`,
        [form.org_id]
      );
      ctmAccountNumber = cp[0]?.ctm_account_number || null;
      clientAnalyticsDefaults = cp[0]?.analytics_defaults || {};
    } catch {}

    // Auto-derive analytics defaults from tracking_configs (if configured).
    let trackingDerivedDefaults = {};
    let isMedicalClient = false;
    try {
      const { rows: tc } = await query(
        `SELECT ga4_measurement_id, meta_pixel_id, google_ads_conversion_id,
                google_ads_conversion_label, conversion_mappings, client_type
         FROM tracking_configs WHERE user_id = $1`,
        [form.org_id]
      );
      if (tc[0]) {
        const t = tc[0];
        isMedicalClient = t.client_type === 'medical';
        if (t.ga4_measurement_id) trackingDerivedDefaults.ga4_event = 'generate_lead';
        if (t.meta_pixel_id && !isMedicalClient) trackingDerivedDefaults.fb_event = 'Lead';
        const browserSendTo = getBrowserGoogleAdsSendTo(t);
        if (browserSendTo) {
          trackingDerivedDefaults.gads_conversion = browserSendTo;
        }
      }
    } catch {}

    // Trickle-down: system → tracking-derived → client defaults → form-level (last wins).
    // System default: ga4_event = 'form_submit' so GA4 fires without per-client config
    const SYSTEM_ANALYTICS_DEFAULTS = { ga4_event: 'form_submit' };
    const resolvedAnalytics = form.analytics_override
      ? (form.analytics_json || {})
      : { ...SYSTEM_ANALYTICS_DEFAULTS, ...trackingDerivedDefaults, ...clientAnalyticsDefaults, ...(form.analytics_json || {}) };

    // HIPAA: Never send Meta pixel config to the browser for medical clients.
    // Meta does not sign BAAs — browser-side pixel fires would send visitor data to Meta.
    if (isMedicalClient) {
      delete resolvedAnalytics.fb_event;
      delete resolvedAnalytics.meta_pixel_id;
    }

    res.json({
      formId: form.id,
      name: form.name,
      html: renderConfigToHtml(config),
      config,
      settings: {
        submitAction: form.submit_action,
        successMessage: form.success_message,
        redirectUrl: form.redirect_url,
        thankyouHtml: form.thankyou_html,
        dupePhone: form.dupe_phone,
        dupePhoneHref: form.dupe_phone_href,
        multiStep: form.multi_step,
        autoAdvance: form.auto_advance,
        titlePage: form.title_page,
        titleHeading: form.title_heading,
        titleDesc: form.title_desc,
        startText: form.start_text,
        analyticsOverride: form.analytics_override,
        analytics: resolvedAnalytics
      },
      reactorId: form.ctm_reactor_id,
      ctmAccountNumber,
      recaptchaSiteKey: getSiteKey()
    });
  } catch (err) {
    console.error('[ctmForms:embed:load]', err.message);
    res.status(500).json({ error: 'Failed to load form' });
  }
});

// POST /api/ctm-forms/embed/:token — submit form
router.post('/embed/:token', embedCors, embedSubmitRateLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM ctm_forms WHERE embed_token = $1 AND status = 'published'`,
      [req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });

    const form = rows[0];
    const { core_json, custom_json, attribution_json, recaptcha_token } = req.body;

    // reCAPTCHA assessment — evaluated up front but NOT a hard gate. A failure no longer
    // drops the submission: privacy browsers / tracker-blockers (e.g. Edge Tracking
    // Prevention) can suppress the token for real people, which previously caused a silent
    // 400 with nothing stored. Instead we store the submission flagged + the full assessment
    // detail (see the blocked-store branch below) and just don't forward it.
    const recaptcha = await assessToken(recaptcha_token, 'ctm_form_submit');

    const core = core_json || {};
    const custom = custom_json || {};
    const attribution = attribution_json || {};

    // Normalize
    if (core.phone && !core.phone_number) { core.phone_number = core.phone; delete core.phone; }
    if (core.name && !core.caller_name) { core.caller_name = core.name; delete core.name; }
    if (!core.country_code) core.country_code = '1';
    if (core.phone_number) {
      core.phone_number = core.phone_number.replace(/\D+/g, '');
      // Strip leading country code digit so CTM receives the local number only
      // (CTM takes country_code separately; sending +1 in both fields = "invalid phone")
      if (core.country_code === '1' && core.phone_number.length === 11 && core.phone_number.startsWith('1')) {
        core.phone_number = core.phone_number.slice(1);
      }
    }

    // Phone requirement is form-configurable. CTM's formreactor needs a phone, so when a
    // form is set to allow email-only leads (require_phone_for_ctm === false) we still accept
    // and store + notify, but skip CTM forwarding for phone-less submissions.
    const requirePhone = (form.config_json?.settings?.require_phone_for_ctm) !== false;
    if (!core.phone_number) {
      if (requirePhone) {
        return res.status(400).json({ error: 'Phone number is required' });
      }
    } else {
      // Validate phone number digit count (already stripped to digits above)
      if (core.phone_number.length < 7 || core.phone_number.length > 15) {
        return res.status(400).json({ error: 'Phone number must contain 7–15 digits' });
      }
      // Reject obviously fake repeating patterns (e.g. 7777777, 0000000, 1234567...)
      if (/^(\d)\1{6,}$/.test(core.phone_number) || /^1234567/.test(core.phone_number) || /^0{7,}$/.test(core.phone_number)) {
        return res.status(400).json({ error: 'Please provide a valid phone number' });
      }
    }

    // Finding 7: Server-side consent enforcement
    const formConfig = form.config_json || {};
    const formFields = formConfig.fields || [];
    const consentField = formFields.find(f => f.type === 'consent' && f.required === true);
    if (consentField) {
      const consentFieldName = sanitizeFieldName(consentField.name || '');
      const consentValue = (custom[consentFieldName] || core[consentFieldName] || '').toString().toLowerCase();
      if (consentValue !== 'yes') {
        return res.status(422).json({ error: 'Consent is required to submit this form.' });
      }
    }

    // Merge all fields early so we can check the test passphrase before the dupe gate
    const allFields = { ...core };
    for (const [k, v] of Object.entries(custom)) {
      allFields[k] = v;
    }
    const validationFields = { ...allFields };
    for (const field of formFields) {
      const key = sanitizeFieldName(field.name || '');
      if (field.id && key && validationFields[key] !== undefined && validationFields[field.id] === undefined) {
        validationFields[field.id] = validationFields[key];
      }
    }

    validateRequiredFields(formFields, validationFields);
    const isTestSubmission = hasTestPassphrase(allFields);

    // Duplicate check — block same phone number submitting the same form within 15 minutes.
    // Uses hashed_phone column (SHA256 of normalized last-10-digits) for encrypted rows,
    // with fallback to legacy JSONB extraction for old plaintext rows.
    // Test passphrase bypasses the dupe check so staff can submit repeatedly.
    // Only consider successfully-received (non-spam, non-held) prior submissions. A previous
    // attempt that was spam-held (e.g. a missing reCAPTCHA token) must NOT blockade a clean
    // retry — otherwise a real person fixing a privacy-blocked first attempt gets silenced.
    const phoneHash = hashPhone(core.phone_number);
    if (!isTestSubmission && phoneHash) {
      const { rows: recent } = await query(
        `SELECT id, spam FROM ctm_form_submissions
         WHERE form_id = $1
           AND created_at > NOW() - INTERVAL '15 minutes'
           AND spam IS NOT TRUE
           AND (hashed_phone = $2 OR field_data->>'phone_number' = $3)
         LIMIT 1`,
        [form.id, phoneHash, core.phone_number]
      );
      if (recent[0]) {
        const phone = form.dupe_phone || '';
        const phoneHref = form.dupe_phone_href || '';
        const callPart = phone
          ? ` If you need immediate help, call us at ${phoneHref ? `<a href="tel:${phoneHref}">${phone}</a>` : phone}.`
          : '';
        return res.json({
          duplicate: true,
          message: `We've received your submission. Please allow us 24 hours to respond.${callPart}`
        });
      }
    }

    // Server-side attribution
    attribution.visitor_ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    if (req.headers['user-agent']) attribution.user_agent = req.headers['user-agent'];

    // Spam / bot gating — store-and-flag, never silently drop, and never silently bury a real
    // lead. A missing reCAPTCHA token is NOT proof of a bot (privacy browsers, tracker
    // blockers, corporate networks, CSP, and reCAPTCHA outages all suppress it for real
    // people). So the policy (per-form via config_json.settings.recaptcha_mode) separates a
    // "soft" no-proof failure from a "hard" positive bot signal:
    //   - hold   → stored spam=TRUE, NOT forwarded to CTM, no email, generic message
    //   - review → stored + forwarded + notified normally, but status='review' so staff can
    //              eyeball it (soft reCAPTCHA fails under the default mode land here)
    //   - continue → normal lead
    // The full reCAPTCHA assessment is persisted in recaptcha_json and the granular cause in
    // block_reason so the submissions panel can show exactly WHY.
    const recaptchaMode = resolveRecaptchaMode(form);
    const recaptchaDecision = decideRecaptchaAction(recaptcha, recaptchaMode);
    // AI spam runs unless reCAPTCHA already holds (don't pay for the AI call on a sure block).
    let blockReason = recaptchaDecision.blockReason;
    let aiSpam = false;
    if (recaptchaDecision.action !== 'hold') {
      aiSpam = await classifySpam(allFields, form.org_id);
      if (aiSpam) blockReason = BLOCK_REASONS.AI_SPAM;
    }
    const isHeld = recaptchaDecision.action === 'hold' || aiSpam;

    if (isHeld) {
      const { rows: spamRows } = await query(
        `INSERT INTO ctm_form_submissions (form_id, field_data, attribution_json, ctm_reactor_id, ip_address, user_agent, spam, status, block_reason, hashed_phone, recaptcha_json)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, TRUE, $7, $8, $9, $10::jsonb) RETURNING id`,
        [form.id, encryptFieldData(allFields), JSON.stringify(attribution), form.ctm_reactor_id, attribution.visitor_ip, attribution.user_agent, SUBMISSION_STATUS.HELD, blockReason, phoneHash, JSON.stringify(recaptcha)]
      );
      logSecurityEvent({
        eventType: 'ctm_form_submission_spam_blocked',
        eventCategory: SecurityEventCategories.ACCESS,
        success: true,
        details: { submissionId: spamRows[0]?.id, formId: form.id, blockReason, recaptchaScore: recaptcha.score }
      }).catch(() => {});
      recordFunnel(form.id, 'held', { blockReason }).catch(() => {});
      return res.json({ blocked: true, message: 'Thank you. We\'ve received your message. We will be in touch.' });
    }

    // Not held. Soft reCAPTCHA fails under review mode are accepted but flagged for a human.
    const triageStatus = recaptchaDecision.action === 'review' ? SUBMISSION_STATUS.REVIEW : SUBMISSION_STATUS.RECEIVED;

    // Store submission locally (field_data AES-256-GCM encrypted at rest)
    const { rows: subs } = await query(
      `INSERT INTO ctm_form_submissions (form_id, field_data, attribution_json, ctm_reactor_id, ip_address, user_agent, status, block_reason, hashed_phone, recaptcha_json)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
      [form.id, encryptFieldData(allFields), JSON.stringify(attribution), form.ctm_reactor_id, attribution.visitor_ip, attribution.user_agent, triageStatus, blockReason, phoneHash, JSON.stringify(recaptcha)]
    );
    const submissionId = subs[0].id;
    recordFunnel(form.id, 'received', { status: triageStatus, blockReason }).catch(() => {});

    // Record consent timestamp if a required consent field was submitted
    if (consentField) {
      const consentFieldName = sanitizeFieldName(consentField.name || '');
      query(
        `UPDATE ctm_form_submissions SET consent_recorded_at = NOW(), consent_field_name = $1 WHERE id = $2`,
        [consentFieldName, submissionId]
      ).catch(() => {});
    }

    // Audit: form submission received
    logSecurityEvent({
      eventType: 'ctm_form_submission_received',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { submissionId, formId: form.id, spam: false }
    }).catch(() => {});

    // Submit to CTM (non-blocking on error). CTM's formreactor requires a phone, so a
    // phone-less email-only lead (require_phone_for_ctm === false) is stored + notified but
    // not forwarded.
    let trackbackId = null;
    if (form.ctm_reactor_id && core.phone_number) {
      try {
        const credentials = await getCtmCredentials(form.org_id);
        if (credentials) {
          trackbackId = await submitToCtm(credentials, form.ctm_reactor_id, core, custom, attribution);
          await query(
            `UPDATE ctm_form_submissions SET ctm_sent = true, ctm_trackback_id = $1 WHERE id = $2`,
            [trackbackId, submissionId]
          );

          // Post-submission: set registered custom fields via /modify.json
          if (trackbackId && Object.keys(custom).length > 0) {
            const config = form.config_json || {};
            const fields = config.fields || [];
            const coreNames = ['caller_name', 'email', 'phone_number', 'phone', 'country_code'];
            const cfValues = {};
            for (const f of fields) {
              if (!f.registerField) continue;
              const fname = sanitizeFieldName(f.name || '');
              if (coreNames.includes(fname)) continue;
              if (fname && custom[fname] !== undefined) {
                cfValues[`cf_${fname}`] = Array.isArray(custom[fname]) ? custom[fname].join(', ') : custom[fname];
              }
            }
            if (Object.keys(cfValues).length > 0) {
              setCallCustomFields(credentials, trackbackId, cfValues).catch(err => {
                console.error('[ctmForms:submit] modify.json failed:', err.message);
              });
            }
          }
        }
      } catch (ctmErr) {
        console.error('[ctmForms:submit] CTM submission failed:', ctmErr.message);
        await query(`UPDATE ctm_form_submissions SET ctm_error = $1 WHERE id = $2`, [ctmErr.message, submissionId]).catch(() => {});
        // Transient CTM outage — queue a retry so the lead isn't permanently stranded.
        enqueueCtmRetry(submissionId).catch(() => {});
      }
    }

    // Send email notification (non-blocking)
    // Test passphrase submissions only notify webforms@anchorcorps.com
    if (isTestSubmission) {
      sendTestNotification(form, submissionId).catch(err => {
        console.error('[ctmForms:submit] Test email failed:', err.message);
      });
    } else {
      sendSubmissionNotification(form, allFields, submissionId).catch(err => {
        console.error('[ctmForms:submit] Email failed:', err.message);
      });
      sendAutoresponderEmail(form, allFields, submissionId, false).catch(err => {
        console.error('[ctmForms:submit] Autoresponder failed:', err.message);
      });
    }

    // Server-side tracking relay (GA4 MP, Meta CAPI, Google Ads offline conversions)
    // Non-blocking — errors logged by trackingRelay, don't fail the submission.
    // Test passphrase submissions must NOT fire real conversion events.
    if (!isTestSubmission) {
      const formAnalytics = form.analytics_json || {};
      sendTrackingEvent(form.org_id, 'lead_submitted', 'ctm_form_submission', submissionId, {
        event_source_url: attribution.referring_url || attribution.referrer || attribution.page_url || '',
        value: 1,
        currency: 'USD',
        email: core.email,
        phone: core.phone_number,
        first_name: core.caller_name,
        gclid: attribution.gclid,
        gbraid: attribution.gbraid,
        wbraid: attribution.wbraid,
        _gads_override_action_id: formAnalytics.gads_conversion_action_id || null,
      }).catch(err => {
        console.error('[ctmForms:submit] Tracking relay failed:', err.message);
      });
    }

    res.json({ success: true, submissionId });
  } catch (err) {
    console.error('[ctmForms:embed:submit]', err.message);
    res.status(500).json({ error: 'Submission failed' });
  }
});

// POST /api/ctm-forms/embed/:token/analytics-log — receive client-side analytics diagnostics
router.post('/embed/:token/analytics-log', embedCors, async (req, res) => {
  try {
    const { submissionId, log } = req.body;
    if (!submissionId || !log) return res.status(400).json({ error: 'Missing fields' });
    await query(
      `UPDATE ctm_form_submissions SET analytics_log = $1 WHERE id = $2`,
      [JSON.stringify(log), submissionId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[ctmForms:analytics-log]', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/ctm-forms/embed/:token/funnel — lightweight client-side funnel telemetry.
// Distinguishes "user clicked but request never reached backend" from "backend received but
// blocked". Public + best-effort: never authenticated, never echoes data, accepts a beacon.
router.options('/embed/:token/funnel', embedCors);
router.post('/embed/:token/funnel', embedCors, async (req, res) => {
  try {
    const { event, meta } = req.body || {};
    if (!event || !CLIENT_FUNNEL_EVENTS.has(event)) {
      return res.status(204).end(); // ignore unknown events silently
    }
    const { rows } = await query(
      `SELECT id FROM ctm_forms WHERE embed_token = $1 AND status = 'published'`,
      [req.params.token]
    );
    if (rows[0]) {
      // Only persist non-PII metadata (counts/flags). Never store field values here.
      const safeMeta = meta && typeof meta === 'object'
        ? { reason: typeof meta.reason === 'string' ? meta.reason.slice(0, 64) : undefined,
            httpStatus: Number.isInteger(meta.httpStatus) ? meta.httpStatus : undefined }
        : null;
      await recordFunnel(rows[0].id, event, safeMeta);
    }
    res.status(204).end();
  } catch {
    res.status(204).end();
  }
});

// ---------------------------------------------------------------------------
// Authenticated Routes
// ---------------------------------------------------------------------------

router.use(requireAuth);

// GET /api/ctm-forms — list forms
router.get('/', async (req, res) => {
  try {
    const { clientId, status } = req.query;
    const isAdmin = ['superadmin', 'admin', 'editor'].includes(req.user.role);
    const ownerId = clientId && isAdmin ? clientId : isAdmin ? null : (req.portalUserId || req.user.id);

    let sql = `SELECT cf.*, u.email as owner_email,
               cp.form_notification_emails AS client_notification_emails,
               cp.client_identifier_value AS client_label,
               (SELECT COUNT(*) FROM ctm_form_submissions s WHERE s.form_id = cf.id AND s.spam IS NOT TRUE) as submission_count
               FROM ctm_forms cf
               LEFT JOIN users u ON cf.org_id = u.id
               LEFT JOIN client_profiles cp ON cp.user_id = cf.org_id`;
    const params = [];
    const where = [];

    if (ownerId) { params.push(ownerId); where.push(`cf.org_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`cf.status = $${params.length}`); }
    else { where.push(`cf.status != 'archived'`); }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY cf.updated_at DESC';

    const { rows } = await query(sql, params);
    res.json({ forms: rows });
  } catch (err) {
    console.error('[ctmForms:list]', err.message);
    res.status(500).json({ error: 'Failed to list forms' });
  }
});

// GET /api/ctm-forms/client/:clientId/submissions — all submissions across a client's forms
router.get('/client/:clientId/submissions', isAdminOrEditor, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.form_id, s.field_data, s.attribution_json, s.ctm_reactor_id, s.ctm_trackback_id,
              s.ctm_sent, s.ctm_error, s.email_sent, s.spam, s.status, s.block_reason, s.released_at, s.ctm_retry_count, s.recaptcha_json, s.analytics_log, s.created_at,
              cf.name as form_name,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', el.id, 'recipient_email', el.recipient_email, 'status', el.status,
                  'sent_at', el.sent_at, 'delivered_at', el.delivered_at,
                  'opened_at', el.opened_at, 'bounced_at', el.bounced_at
                ) ORDER BY el.created_at)
                FROM email_logs el
                WHERE el.email_type IN ('ctm_form_submission', 'ctm_form_submission_test')
                  AND el.metadata->>'submissionId' = s.id::text
              ), '[]'::json) as notification_emails
       FROM ctm_form_submissions s
       JOIN ctm_forms cf ON cf.id = s.form_id
       WHERE cf.org_id = $1
       ORDER BY s.created_at DESC LIMIT 500`,
      [req.params.clientId]
    );

    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_submissions_accessed',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { clientId: req.params.clientId, userId: req.user.id }
    }).catch(() => {});

    const decryptedRows = rows.map(row => ({
      ...row,
      field_data: decryptFieldData(row.field_data)
    }));

    res.json({ submissions: decryptedRows });
  } catch (err) {
    console.error('[ctmForms:client:submissions]', err.message);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// POST /api/ctm-forms — create form
router.post('/', isAdminOrEditor, async (req, res) => {
  try {
    const { clientId, name, formMode } = req.body;
    if (!clientId || !name?.trim()) return res.status(400).json({ error: 'clientId and name required' });

    const embedToken = generateEmbedToken();
    const { rows } = await query(
      `INSERT INTO ctm_forms (org_id, name, form_mode, embed_token) VALUES ($1, $2, $3, $4) RETURNING *`,
      [clientId, name.trim(), formMode || 'builder', embedToken]
    );
    logFormActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.CREATE_FORM,
      formId: rows[0].id,
      formName: name.trim(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { formName: name.trim() }
    }).catch(() => {});

    res.json({ form: rows[0] });
  } catch (err) {
    console.error('[ctmForms:create]', err.message);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// GET /api/ctm-forms/:id — get form
router.get('/:id', async (req, res) => {
  try {
    const isStaff = ['superadmin', 'admin', 'editor'].includes(req.user.role);
    const params = [req.params.id];
    const ownerClause = isStaff ? '' : ' AND org_id = $2';
    if (!isStaff) params.push(req.portalUserId || req.user.id);

    const { rows } = await query(
      `SELECT cf.*, cp.form_notification_emails AS client_notification_emails,
              cp.client_identifier_value AS client_label
         FROM ctm_forms cf
         LEFT JOIN client_profiles cp ON cp.user_id = cf.org_id
        WHERE cf.id = $1${ownerClause.replace(/org_id/g, 'cf.org_id')}`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });
    res.json({ form: rows[0] });
  } catch (err) {
    console.error('[ctmForms:get]', err.message);
    res.status(500).json({ error: 'Failed to get form' });
  }
});

// PUT /api/ctm-forms/:id — update form
router.put('/:id', isAdminOrEditor, async (req, res) => {
  try {
    const updates = req.body;
    const setClauses = [];
    const params = [];
    let idx = 1;

    const allowedFields = [
      'name', 'form_mode', 'config_json', 'rendered_html', 'reactor_html',
      'submit_action', 'success_message', 'redirect_url', 'thankyou_html',
      'dupe_phone', 'dupe_phone_href', 'analytics_override', 'analytics_json',
      'multi_step', 'title_page', 'title_heading', 'title_desc', 'start_text', 'auto_advance',
      'notification_enabled', 'notification_emails', 'notification_cc',
      'notification_subject_template', 'notification_body_template',
      'autoresponder_enabled', 'autoresponder_from_name', 'autoresponder_subject',
      'autoresponder_preheader', 'autoresponder_body', 'autoresponder_body_format',
      'autoresponder_attachments', 'autoresponder_reply_to'
    ];

    const jsonFields = new Set(['config_json', 'analytics_json', 'autoresponder_attachments']);
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        params.push(jsonFields.has(field) ? JSON.stringify(updates[field]) : updates[field]);
        setClauses.push(`${field} = $${idx}`);
        idx++;
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    setClauses.push('updated_at = NOW()');
    params.push(req.params.id);
    let whereClause = `WHERE id = $${idx}`;

    // When staff is impersonating a specific client, restrict mutations to that org
    // so a typo or wrong form id can't cross-update another client's form.
    const actingOrgId = req.portalUserId && req.portalUserId !== req.user.id ? req.portalUserId : null;
    if (actingOrgId) {
      idx++;
      params.push(actingOrgId);
      whereClause += ` AND org_id = $${idx}`;
    }

    const { rows } = await query(
      `UPDATE ctm_forms SET ${setClauses.join(', ')} ${whereClause} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });

    logFormActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.EDIT_FORM,
      formId: req.params.id,
      formName: rows[0].name,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { formName: rows[0].name }
    }).catch(() => {});

    res.json({ form: rows[0] });
  } catch (err) {
    console.error('[ctmForms:update]', err.message);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// PUT /api/ctm-forms/:id/config — save config + re-render HTML
router.put('/:id/config', isAdminOrEditor, async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config is required' });

    const html = renderConfigToHtml(config);
    const actingOrgId = req.portalUserId && req.portalUserId !== req.user.id ? req.portalUserId : null;
    const params = [JSON.stringify(config), html, req.params.id];
    let whereClause = 'WHERE id = $3';
    if (actingOrgId) {
      params.push(actingOrgId);
      whereClause += ' AND org_id = $4';
    }
    const { rows } = await query(
      `UPDATE ctm_forms SET config_json = $1, rendered_html = $2, updated_at = NOW() ${whereClause} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });

    res.json({ form: rows[0], html });
  } catch (err) {
    console.error('[ctmForms:saveConfig]', err.message);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// POST /api/ctm-forms/:id/publish — publish form (create/update reactor)
router.post('/:id/publish', isAdminOrEditor, async (req, res) => {
  try {
    const actingOrgId = req.portalUserId && req.portalUserId !== req.user.id ? req.portalUserId : null;
    const lookupParams = [req.params.id];
    let lookupClause = 'WHERE id = $1';
    if (actingOrgId) {
      lookupParams.push(actingOrgId);
      lookupClause += ' AND org_id = $2';
    }
    const { rows } = await query(`SELECT * FROM ctm_forms ${lookupClause}`, lookupParams);
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });

    const form = rows[0];
    const config = form.config_json || { settings: {}, fields: [] };

    // Re-render HTML
    const html = renderConfigToHtml(config);
    const newHash = hashFieldConfig(config);

    let reactorId = form.ctm_reactor_id;
    let reactorError = null;

    // Only create/recreate reactor if fields changed (or no reactor exists)
    if (form.form_mode === 'builder' && (!reactorId || newHash !== form.ctm_reactor_fields_hash)) {
      const credentials = await getCtmCredentials(form.org_id);
      if (credentials) {
        try {
          // Delete old reactor if exists and fields changed
          if (reactorId && newHash !== form.ctm_reactor_fields_hash) {
            await deleteFormReactor(credentials, reactorId);
          }
          reactorId = await createFormReactor(credentials, form.name, config);

          // Sync custom fields to account
          await syncCustomFieldsToAccount(credentials, config);
        } catch (err) {
          reactorError = err.message;
          console.error('[ctmForms:publish] Reactor creation failed:', err.message);
        }
      } else {
        reactorError = 'CTM credentials not configured for this client';
      }
    }

    // For reactor mode, use the manually selected reactor_id (stored in ctm_reactor_id already)

    // Sync config_json settings to flat DB columns so the embed endpoint reads them
    const settings = config.settings || {};
    const { rows: updated } = await query(
      `UPDATE ctm_forms SET
        status = 'published',
        rendered_html = $1,
        ctm_reactor_id = COALESCE($2, ctm_reactor_id),
        ctm_reactor_fields_hash = $3,
        multi_step = $5,
        auto_advance = $6,
        title_page = $7,
        title_heading = $8,
        title_desc = $9,
        start_text = $10,
        updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [
        html, reactorId, newHash, req.params.id,
        Boolean(settings.multiStep),
        Boolean(settings.autoAdvance),
        Boolean(settings.titlePage?.enabled),
        settings.titlePage?.heading || '',
        settings.titlePage?.description || '',
        settings.titlePage?.buttonText || 'Get Started'
      ]
    );

    // Audit: form published
    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_published',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { formId: req.params.id }
    }).catch(() => {});

    logFormActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.PUBLISH_FORM,
      formId: req.params.id,
      formName: form.name,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { formName: form.name }
    }).catch(() => {});

    res.json({
      form: updated[0],
      reactorId,
      reactorError
    });
  } catch (err) {
    console.error('[ctmForms:publish]', err.message);
    res.status(500).json({ error: 'Failed to publish form' });
  }
});

// DELETE /api/ctm-forms/:id — archive form
router.delete('/:id', isAdminOrEditor, async (req, res) => {
  try {
    const actingOrgId = req.portalUserId && req.portalUserId !== req.user.id ? req.portalUserId : null;
    const params = [req.params.id];
    let whereClause = 'WHERE id = $1';
    if (actingOrgId) {
      params.push(actingOrgId);
      whereClause += ' AND org_id = $2';
    }
    const { rowCount } = await query(
      `UPDATE ctm_forms SET status = 'archived', updated_at = NOW() ${whereClause}`,
      params
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Form not found' });

    // Audit: form archived
    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_archived',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { formId: req.params.id }
    }).catch(() => {});

    logFormActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.ARCHIVE_FORM,
      formId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { formId: req.params.id }
    }).catch(() => {});

    res.json({ message: 'Form archived' });
  } catch (err) {
    console.error('[ctmForms:archive]', err.message);
    res.status(500).json({ error: 'Failed to archive form' });
  }
});

// GET /api/ctm-forms/:id/preview — get rendered HTML preview
router.get('/:id/preview', async (req, res) => {
  try {
    const isStaff = ['superadmin', 'admin', 'editor'].includes(req.user.role);
    const params = [req.params.id];
    const ownerClause = isStaff ? '' : ' AND org_id = $2';
    if (!isStaff) params.push(req.portalUserId || req.user.id);

    const { rows } = await query(`SELECT config_json FROM ctm_forms WHERE id = $1${ownerClause}`, params);
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });

    const html = renderConfigToHtml(rows[0].config_json || { settings: {}, fields: [] });
    const config = rows[0].config_json || {};
    const colorScheme = config.settings?.colorScheme || 'light';
    const colors = config.settings?.colors || {};

    res.json({ html, colorScheme, colors });
  } catch (err) {
    console.error('[ctmForms:preview]', err.message);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

// GET /api/ctm-forms/:id/analytics — per-form submission stats
router.get('/:id/analytics', isAdminOrEditor, async (req, res) => {
  try {
    const form = await getOwnedFormOr404(req, res);
    if (!form) return;

    const { rows: [summary] } = await query(
      `SELECT
         COUNT(*)                                        AS total,
         COUNT(*) FILTER (WHERE ctm_sent)               AS ctm_sent,
         COUNT(*) FILTER (WHERE NOT ctm_sent AND ctm_error IS NOT NULL) AS ctm_failed,
         COUNT(*) FILTER (WHERE email_sent)             AS email_sent,
         COUNT(*) FILTER (WHERE status = 'held' OR spam IS TRUE) AS held,
         COUNT(*) FILTER (WHERE status = 'review')      AS review,
         COUNT(*) FILTER (WHERE status = 'released')    AS released,
         COUNT(*) FILTER (WHERE attribution_json->>'visitor_sid' IS NOT NULL
                            AND attribution_json->>'visitor_sid' <> '') AS with_visitor_sid,
         MIN(created_at)                                AS first_at,
         MAX(created_at)                                AS last_at
       FROM ctm_form_submissions WHERE form_id = $1`,
      [req.params.id]
    );

    const { rows: daily } = await query(
      `SELECT
         to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
         COUNT(*) AS count
       FROM ctm_form_submissions
       WHERE form_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day`,
      [req.params.id]
    );

    // Why submissions were held/flagged (last 30 days) — drives conversion-loss diagnosis.
    const { rows: blockReasons } = await query(
      `SELECT block_reason AS reason, COUNT(*) AS count
       FROM ctm_form_submissions
       WHERE form_id = $1 AND block_reason IS NOT NULL
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY block_reason ORDER BY count DESC`,
      [req.params.id]
    );

    // Client-side conversion funnel (last 30 days): loaded → clicked → posted → blocked/sent.
    const { rows: funnelRows } = await query(
      `SELECT event, COUNT(*) AS count
       FROM ctm_form_funnel_events
       WHERE form_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY event`,
      [req.params.id]
    );
    const funnel = {};
    for (const r of funnelRows) funnel[r.event] = Number(r.count);

    res.json({ summary, daily, blockReasons, funnel });
  } catch (err) {
    console.error('[ctmForms:analytics]', err.message);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

// DELETE /api/ctm-forms/submissions/:submissionId — GDPR erasure (anonymize, not hard-delete)
router.delete('/submissions/:submissionId', isAdminOrEditor, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { rows } = await query(
      `UPDATE ctm_form_submissions
       SET field_data = '{"anonymized": true}'::jsonb,
           attribution_json = NULL,
           anonymized_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [submissionId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Submission not found' });

    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_submission_erased',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { submissionId, requestedBy: req.user.id }
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[ctmForms:erase]', err.message);
    res.status(500).json({ error: 'Failed to erase submission' });
  }
});

// POST /api/ctm-forms/submissions/:submissionId/resend-email — resend notification emails
router.post('/submissions/:submissionId/resend-email', isAdminOrEditor, async (req, res) => {
  try {
    const { submissionId } = req.params;

    const { rows } = await query(
      `SELECT s.*, f.name as form_name, f.notification_enabled, f.notification_emails,
              f.notification_cc, f.org_id, f.config_json
       FROM ctm_form_submissions s
       JOIN ctm_forms f ON f.id = s.form_id
       WHERE s.id = $1`,
      [submissionId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Submission not found' });

    const sub = rows[0];
    const allFields = decryptFieldData(sub.field_data);
    if (!allFields || allFields.anonymized) {
      return res.status(400).json({ error: 'Submission data has been erased' });
    }

    // Build a form-like object for sendSubmissionNotification
    const form = {
      id: sub.form_id,
      name: sub.form_name,
      org_id: sub.org_id,
      notification_enabled: true, // Force enabled for resend
      notification_emails: sub.notification_emails,
      notification_cc: sub.notification_cc,
      config_json: sub.config_json
    };

    await sendSubmissionNotification(form, allFields, submissionId);

    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_submission_email_resent',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { submissionId }
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[ctmForms:resend-email]', err.message);
    res.status(500).json({ error: err.message || 'Failed to resend notification' });
  }
});

// POST /api/ctm-forms/submissions/:submissionId/retry-ctm — retry failed CTM submission
router.post('/submissions/:submissionId/retry-ctm', isAdminOrEditor, async (req, res) => {
  try {
    const { submissionId } = req.params;

    // Fetch the submission
    const { rows } = await query(
      `SELECT s.*, f.config_json, f.org_id
       FROM ctm_form_submissions s
       JOIN ctm_forms f ON f.id = s.form_id
       WHERE s.id = $1`,
      [submissionId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Submission not found' });

    const sub = rows[0];
    if (sub.ctm_sent) return res.status(400).json({ error: 'Already sent to CTM' });
    if (!sub.ctm_reactor_id) return res.status(400).json({ error: 'No CTM reactor configured for this form' });

    // Decrypt and split fields back into core vs custom
    const allFields = decryptFieldData(sub.field_data);
    if (!allFields || allFields.anonymized) {
      return res.status(400).json({ error: 'Submission data has been erased' });
    }

    const coreNames = ['caller_name', 'email', 'phone_number', 'phone', 'country_code'];
    const core = {};
    const custom = {};
    for (const [k, v] of Object.entries(allFields)) {
      if (coreNames.includes(k)) core[k] = v;
      else custom[k] = v;
    }

    const attribution = sub.attribution_json || {};

    // Get CTM credentials
    const credentials = await getCtmCredentials(sub.org_id);
    if (!credentials) return res.status(400).json({ error: 'CTM credentials not configured for this client' });

    // Submit to CTM
    const trackbackId = await submitToCtm(credentials, sub.ctm_reactor_id, core, custom, attribution);
    await query(
      `UPDATE ctm_form_submissions SET ctm_sent = true, ctm_trackback_id = $1, ctm_error = NULL WHERE id = $2`,
      [trackbackId, submissionId]
    );

    // Post-submission: set registered custom fields via /modify.json
    if (trackbackId && Object.keys(custom).length > 0) {
      const config = sub.config_json || {};
      const fields = config.fields || [];
      const cfValues = {};
      for (const f of fields) {
        if (!f.registerField) continue;
        const fname = sanitizeFieldName(f.name || '');
        if (coreNames.includes(fname)) continue;
        if (fname && custom[fname] !== undefined) {
          cfValues[`cf_${fname}`] = Array.isArray(custom[fname]) ? custom[fname].join(', ') : custom[fname];
        }
      }
      if (Object.keys(cfValues).length > 0) {
        setCallCustomFields(credentials, trackbackId, cfValues).catch(err => {
          console.error('[ctmForms:retry] modify.json failed:', err.message);
        });
      }
    }

    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_submission_retried',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { submissionId, trackbackId }
    }).catch(() => {});

    res.json({ success: true, trackbackId });
  } catch (err) {
    console.error('[ctmForms:retry]', err.message);

    // Update error message on the submission
    await query(
      `UPDATE ctm_form_submissions SET ctm_error = $1 WHERE id = $2`,
      [err.message, req.params.submissionId]
    ).catch(() => {});

    res.status(500).json({ error: err.message || 'CTM retry failed' });
  }
});

// POST /api/ctm-forms/submissions/:submissionId/release — release a spam-held submission:
// mark it legitimate, forward to CTM, and send the team notification it never got while held.
router.post('/submissions/:submissionId/release', isAdminOrEditor, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { rows } = await query(
      `SELECT s.*, f.name AS form_name, f.notification_emails, f.notification_cc, f.org_id, f.config_json
       FROM ctm_form_submissions s
       JOIN ctm_forms f ON f.id = s.form_id
       WHERE s.id = $1`,
      [submissionId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Submission not found' });
    const sub = rows[0];

    const allFields = decryptFieldData(sub.field_data);
    if (!allFields || allFields.anonymized) {
      return res.status(400).json({ error: 'Submission data has been erased' });
    }

    // Clear the hold so it's treated as a normal lead from here on.
    await query(
      `UPDATE ctm_form_submissions
       SET spam = FALSE, status = $1, released_at = NOW(), released_by = $2
       WHERE id = $3`,
      [SUBMISSION_STATUS.RELEASED, req.user.id, submissionId]
    );

    // Forward to CTM (best-effort; queue a retry on a transient failure). CTM's formreactor
    // requires a phone, so an email-only lead (require_phone_for_ctm === false) is released +
    // notified but never forwarded — mirroring the live submit path. Avoids posting an invalid
    // phone-less payload and queuing retries that can never succeed.
    let ctm = { ok: false };
    const hasPhone = !!(allFields.phone_number || allFields.phone);
    if (sub.ctm_sent) {
      ctm = { ok: true, skipped: true };
    } else if (sub.ctm_reactor_id && hasPhone) {
      ctm = await forwardSubmissionToCtm({ ...sub, ctm_sent: false });
      if (!ctm.ok && ctm.retriable) enqueueCtmRetry(submissionId).catch(() => {});
    } else {
      ctm = { ok: false, skipped: true, error: sub.ctm_reactor_id ? 'no phone number (email-only lead)' : 'no CTM reactor' };
    }

    // Send the team notification this lead never got while it was held.
    const form = {
      id: sub.form_id, name: sub.form_name, org_id: sub.org_id,
      notification_enabled: true, notification_emails: sub.notification_emails,
      notification_cc: sub.notification_cc, config_json: sub.config_json
    };
    sendSubmissionNotification(form, allFields, submissionId).catch((err) => {
      console.error('[ctmForms:release] notification failed:', err.message);
    });

    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_submission_released',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { submissionId, ctmForwarded: ctm.ok, releasedBy: req.user.id }
    }).catch(() => {});

    res.json({ success: true, ctmForwarded: ctm.ok, ctmError: ctm.ok ? null : (ctm.error || null) });
  } catch (err) {
    console.error('[ctmForms:release]', err.message);
    res.status(500).json({ error: err.message || 'Failed to release submission' });
  }
});

// GET /api/ctm-forms/:id/health — CTM configuration health for a published form.
router.get('/:id/health', isAdminOrEditor, async (req, res) => {
  try {
    const form = await getOwnedFormOr404(req, res, '*');
    if (!form) return;

    const credentials = await getCtmCredentials(form.org_id);
    const { rows: cp } = await query(
      `SELECT ctm_account_number FROM client_profiles WHERE user_id = $1`,
      [form.org_id]
    );

    const { rows: [stats] } = await query(
      `SELECT
         MAX(created_at) FILTER (WHERE ctm_sent) AS last_ctm_sent_at,
         (SELECT ctm_error FROM ctm_form_submissions
            WHERE form_id = $1 AND ctm_error IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS last_ctm_error,
         COUNT(*) FILTER (WHERE NOT ctm_sent AND ctm_error IS NOT NULL AND status <> 'held') AS ctm_failed
       FROM ctm_form_submissions WHERE form_id = $1`,
      [req.params.id]
    );
    const { rows: [jobStats] } = await query(
      `SELECT COUNT(*) AS pending_retries
       FROM ctm_form_submission_jobs j
       JOIN ctm_form_submissions s ON s.id = j.submission_id
       WHERE s.form_id = $1 AND j.status IN ('pending', 'processing')`,
      [req.params.id]
    );

    res.json({
      published: form.status === 'published',
      embedToken: !!form.embed_token,
      hasReactor: !!form.ctm_reactor_id,
      reactorId: form.ctm_reactor_id || null,
      credentialsOk: !!credentials,
      ctmAccountNumber: cp[0]?.ctm_account_number || null,
      lastCtmSentAt: stats?.last_ctm_sent_at || null,
      lastCtmError: stats?.last_ctm_error || null,
      ctmFailed: Number(stats?.ctm_failed || 0),
      pendingRetries: Number(jobStats?.pending_retries || 0)
    });
  } catch (err) {
    console.error('[ctmForms:health]', err.message);
    res.status(500).json({ error: 'Failed to load form health' });
  }
});

router.get('/:id/submissions', isAdminOrEditor, async (req, res) => {
  try {
    const form = await getOwnedFormOr404(req, res);
    if (!form) return;

    const { rows } = await query(
      `SELECT s.id, s.form_id, s.field_data, s.attribution_json, s.ctm_reactor_id, s.ctm_trackback_id,
              s.ctm_sent, s.ctm_error, s.email_sent, s.spam, s.status, s.block_reason, s.released_at, s.ctm_retry_count, s.recaptcha_json, s.analytics_log, s.created_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', el.id, 'recipient_email', el.recipient_email, 'status', el.status,
                  'sent_at', el.sent_at, 'delivered_at', el.delivered_at,
                  'opened_at', el.opened_at, 'bounced_at', el.bounced_at
                ) ORDER BY el.created_at)
                FROM email_logs el
                WHERE el.email_type IN ('ctm_form_submission', 'ctm_form_submission_test')
                  AND el.metadata->>'submissionId' = s.id::text
              ), '[]'::json) as notification_emails
       FROM ctm_form_submissions s WHERE s.form_id = $1 ORDER BY s.created_at DESC LIMIT 100`,
      [req.params.id]
    );

    logSecurityEvent({
      userId: req.user.id,
      eventType: 'ctm_form_submissions_accessed',
      eventCategory: SecurityEventCategories.ACCESS,
      success: true,
      details: { formId: req.params.id, userId: req.user.id }
    }).catch(() => {});

    const decryptedRows = rows.map(row => ({
      ...row,
      field_data: decryptFieldData(row.field_data)
    }));

    res.json({ submissions: decryptedRows });
  } catch (err) {
    console.error('[ctmForms:submissions]', err.message);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// ---------------------------------------------------------------------------
// CTM Proxy
// ---------------------------------------------------------------------------

router.get('/:id/ctm/reactors', isAdminOrEditor, async (req, res) => {
  try {
    const form = await getOwnedFormOr404(req, res, 'org_id');
    if (!form) return;
    const credentials = await getCtmCredentials(form.org_id);
    if (!credentials) return res.status(400).json({ error: 'CTM not configured' });
    const reactors = await fetchReactorsList(credentials);
    res.json({ reactors });
  } catch (err) {
    console.error('[ctmForms:ctm:reactors]', err.message);
    res.status(500).json({ error: 'Failed to list reactors' });
  }
});

router.get('/:id/ctm/reactor-detail/:reactorId', isAdminOrEditor, async (req, res) => {
  try {
    const form = await getOwnedFormOr404(req, res, 'org_id');
    if (!form) return;
    const credentials = await getCtmCredentials(form.org_id);
    if (!credentials) return res.status(400).json({ error: 'CTM not configured' });
    const detail = await fetchReactorDetail(credentials, req.params.reactorId);
    res.json({ detail });
  } catch (err) {
    console.error('[ctmForms:ctm:reactor-detail]', err.message);
    res.status(500).json({ error: 'Failed to get reactor detail' });
  }
});

// Link reactor (reactor mode)
router.post('/:id/ctm/link-reactor', isAdminOrEditor, async (req, res) => {
  try {
    const { reactorId } = req.body;
    if (!reactorId) return res.status(400).json({ error: 'reactorId required' });
    const actingOrgId = req.portalUserId && req.portalUserId !== req.user.id ? req.portalUserId : null;
    const params = [reactorId, req.params.id];
    let whereClause = 'WHERE id = $2';
    if (actingOrgId) {
      params.push(actingOrgId);
      whereClause += ' AND org_id = $3';
    }
    const { rowCount } = await query(`UPDATE ctm_forms SET ctm_reactor_id = $1, updated_at = NOW() ${whereClause}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Form not found' });
    res.json({ message: 'Reactor linked' });
  } catch (err) {
    console.error('[ctmForms:ctm:link]', err.message);
    res.status(500).json({ error: 'Failed to link reactor' });
  }
});

// Generate starter HTML from reactor detail
router.post('/:id/ctm/generate-starter', isAdminOrEditor, async (req, res) => {
  try {
    const { reactorId, floatingLabels } = req.body;
    if (!reactorId) return res.status(400).json({ error: 'reactorId required' });

    const form = await getOwnedFormOr404(req, res, 'org_id');
    if (!form) return;

    const credentials = await getCtmCredentials(form.org_id);
    if (!credentials) return res.status(400).json({ error: 'CTM not configured' });

    const detail = await fetchReactorDetail(credentials, reactorId);
    if (!detail || Object.keys(detail).length === 0) {
      return res.status(400).json({ error: 'Could not load reactor details' });
    }

    // Build starter fields from reactor detail (mirrors plugin's build_starter_html_from_detail)
    const fields = [];
    if (detail.include_name) {
      fields.push({ name: 'caller_name', type: 'text', label: 'Name', required: !!detail.name_required });
    }
    if (detail.include_email) {
      fields.push({ name: 'email', type: 'email', label: 'Email', required: !!detail.email_required });
    }
    fields.push({ name: 'phone_number', type: 'tel', label: 'Phone', required: true });

    if (detail.custom_fields && Array.isArray(detail.custom_fields)) {
      for (const cf of detail.custom_fields) {
        if (!cf.name) continue;
        let type = (cf.type || 'text').toLowerCase();
        const allowed = ['textarea', 'email', 'tel', 'text', 'number', 'url', 'select', 'checkbox', 'radio', 'consent'];
        if (!allowed.includes(type)) type = 'text';

        const field = { name: cf.name, type, label: cf.label || cf.name, required: !!cf.required, custom: true };
        if (['select', 'checkbox', 'radio'].includes(type) && cf.options) {
          const raw = typeof cf.options === 'string' ? cf.options.split(/[\n,]+/) : cf.options;
          field.options = (Array.isArray(raw) ? raw : []).map(o => {
            if (typeof o === 'object') return { value: o.value || o.name || o.label || '', label: o.label || o.name || o.value || '' };
            const s = String(o).trim();
            return s ? { value: s, label: s } : null;
          }).filter(Boolean);
        }
        fields.push(field);
      }
    }

    const config = {
      settings: { labelStyle: floatingLabels ? 'floating' : 'above', submitText: 'Submit' },
      fields: fields.map((f, i) => ({
        id: `f_${crypto.randomBytes(4).toString('hex')}`,
        ...f,
        isCustom: !['caller_name', 'email', 'phone_number', 'phone', 'country_code'].includes(f.name),
        width: 'full',
        placeholder: '',
        helpText: '',
        defaultValue: '',
        labelStyle: 'inherit',
        cssClass: '',
        step: 0,
        conditions: [],
        conditionLogic: 'all',
        logVisible: true,
        registerField: false
      }))
    };

    const html = renderConfigToHtml(config);
    res.json({ html, config });
  } catch (err) {
    console.error('[ctmForms:ctm:generate-starter]', err.message);
    res.status(500).json({ error: 'Failed to generate starter form' });
  }
});

// ---------------------------------------------------------------------------
// AI Form Assistant
// ---------------------------------------------------------------------------

router.post('/ai/assist', isAdminOrEditor, async (req, res) => {
  try {
    const { instruction, config } = req.body;
    if (!instruction?.trim()) return res.status(400).json({ error: 'Instruction is required' });

    const systemPrompt = buildAiSystemPrompt();
    const currentConfig = config || { settings: {}, fields: [] };
    // Send compact JSON to minimize input tokens — large forms with pretty-print can exceed limits
    const userMessage = `Current form config:\n${JSON.stringify(currentConfig)}\n\nInstruction: ${instruction}`;

    const result = await generateAiResponse({
      prompt: userMessage,
      systemPrompt,
      temperature: 0,
      maxTokens: 8192
    });

    // Strip markdown fences
    let cleaned = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const newConfig = JSON.parse(cleaned);

    if (!newConfig?.settings || !newConfig?.fields) {
      return res.status(400).json({ error: 'AI returned invalid config. Try rephrasing.' });
    }

    res.json({ config: newConfig });
  } catch (err) {
    console.error('[ctmForms:ai]', err.message);
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// GET /api/ctm-forms/templates — list all templates
router.get('/templates/list', isAdminOrEditor, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, description, category, form_mode, multi_step, auto_advance,
              is_system, created_at, updated_at,
              jsonb_array_length(COALESCE(config_json->'fields', '[]'::jsonb)) AS field_count
       FROM ctm_form_templates
       ORDER BY is_system DESC, name ASC`
    );
    res.json({ templates: rows });
  } catch (err) {
    console.error('[ctmForms:templates:list]', err.message);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// POST /api/ctm-forms/templates — save a form as a template
router.post('/templates', isAdminOrEditor, async (req, res) => {
  try {
    const { formId, name, description, category } = req.body;
    if (!formId) return res.status(400).json({ error: 'formId is required' });
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const { rows: formRows } = await query(`SELECT * FROM ctm_forms WHERE id = $1`, [formId]);
    if (!formRows[0]) return res.status(404).json({ error: 'Form not found' });
    const f = formRows[0];

    // Sanitize config_json: strip any client-specific field IDs so templates get fresh IDs on use
    const config = f.config_json || { settings: {}, fields: [] };

    const { rows } = await query(
      `INSERT INTO ctm_form_templates
       (name, description, category, config_json, form_mode, submit_action,
        success_message, redirect_url, thankyou_html, multi_step, auto_advance,
        title_page, title_heading, title_desc, start_text, created_by, source_form_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        name.trim(), description || '', category || null,
        JSON.stringify(config), f.form_mode || 'builder',
        f.submit_action || 'message', f.success_message || '',
        f.redirect_url || '', f.thankyou_html || '',
        Boolean(f.multi_step), Boolean(f.auto_advance),
        Boolean(f.title_page), f.title_heading || '',
        f.title_desc || '', f.start_text || 'Get Started',
        req.user.id, formId
      ]
    );

    res.json({ template: rows[0] });
  } catch (err) {
    console.error('[ctmForms:templates:create]', err.message);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// POST /api/ctm-forms/templates/:id/use — create a new form from a template
router.post('/templates/:id/use', isAdminOrEditor, async (req, res) => {
  try {
    const { clientId, name } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });

    const { rows: tplRows } = await query(
      `SELECT * FROM ctm_form_templates WHERE id = $1`, [req.params.id]
    );
    if (!tplRows[0]) return res.status(404).json({ error: 'Template not found' });
    const t = tplRows[0];

    // Deep-copy config and regenerate field IDs to avoid collisions
    const config = JSON.parse(JSON.stringify(t.config_json || { settings: {}, fields: [] }));
    if (Array.isArray(config.fields)) {
      // Build old→new ID mapping
      const idMap = {};
      config.fields = config.fields.map(field => {
        const newId = 'f_' + Math.random().toString(36).substr(2, 8);
        if (field.id) idMap[field.id] = newId;
        return { ...field, id: newId };
      });
      // Update condition references to use new IDs
      config.fields.forEach(field => {
        if (Array.isArray(field.conditions)) {
          field.conditions.forEach(cond => {
            if (cond.field && idMap[cond.field]) cond.field = idMap[cond.field];
            if (cond.fieldId && idMap[cond.fieldId]) cond.fieldId = idMap[cond.fieldId];
          });
        }
      });
    }

    const embedToken = generateEmbedToken();
    const formName = name?.trim() || t.name;

    const { rows } = await query(
      `INSERT INTO ctm_forms
       (org_id, name, form_mode, config_json, submit_action, success_message,
        redirect_url, thankyou_html, multi_step, auto_advance,
        title_page, title_heading, title_desc, start_text, embed_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        clientId, formName, t.form_mode || 'builder',
        JSON.stringify(config),
        t.submit_action || 'message', t.success_message || '',
        t.redirect_url || '', t.thankyou_html || '',
        Boolean(t.multi_step), Boolean(t.auto_advance),
        Boolean(t.title_page), t.title_heading || '',
        t.title_desc || '', t.start_text || 'Get Started',
        embedToken
      ]
    );

    res.json({ form: rows[0] });
  } catch (err) {
    console.error('[ctmForms:templates:use]', err.message);
    res.status(500).json({ error: 'Failed to create form from template' });
  }
});

// DELETE /api/ctm-forms/templates/:id — delete a template
router.delete('/templates/:id', isAdminOrEditor, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT is_system FROM ctm_form_templates WHERE id = $1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    if (rows[0].is_system) return res.status(403).json({ error: 'Cannot delete system templates' });

    await query(`DELETE FROM ctm_form_templates WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[ctmForms:templates:delete]', err.message);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ---------------------------------------------------------------------------
// Import / Export / Duplicate
// ---------------------------------------------------------------------------

router.get('/:id/export', isAdminOrEditor, async (req, res) => {
  try {
    const f = await getOwnedFormOr404(req, res, '*');
    if (!f) return;

    const payload = {
      anchor_ctm_form_export: 1,
      version: '2.0',
      title: f.name,
      config_json: f.config_json,
      form_mode: f.form_mode,
      submit_action: f.submit_action,
      success_message: f.success_message,
      redirect_url: f.redirect_url,
      thankyou_html: f.thankyou_html,
      dupe_phone: f.dupe_phone,
      dupe_phone_href: f.dupe_phone_href,
      analytics_override: f.analytics_override,
      analytics_json: f.analytics_json,
      multi_step: f.multi_step,
      title_page: f.title_page,
      title_heading: f.title_heading,
      title_desc: f.title_desc,
      start_text: f.start_text,
      auto_advance: f.auto_advance
    };

    res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/[^a-z0-9]/gi, '_')}_export.json"`);
    res.json(payload);
  } catch (err) {
    console.error('[ctmForms:export]', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.post('/import', isAdminOrEditor, async (req, res) => {
  try {
    const { clientId, formData } = req.body;
    if (!clientId || !formData) return res.status(400).json({ error: 'clientId and formData required' });
    if (!formData.anchor_ctm_form_export) return res.status(400).json({ error: 'Not a valid CTM form export' });

    const embedToken = generateEmbedToken();
    const { rows } = await query(
      `INSERT INTO ctm_forms (org_id, name, form_mode, config_json, submit_action, success_message,
        redirect_url, thankyou_html, dupe_phone, dupe_phone_href, analytics_override, analytics_json,
        multi_step, title_page, title_heading, title_desc, start_text, auto_advance, embed_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        clientId, (formData.title || 'Imported Form') + ' (Imported)', formData.form_mode || 'builder',
        JSON.stringify(formData.config_json || { settings: {}, fields: [] }),
        formData.submit_action || 'message', formData.success_message || '',
        formData.redirect_url || '', formData.thankyou_html || '',
        formData.dupe_phone || '', formData.dupe_phone_href || '',
        formData.analytics_override || false, formData.analytics_json ? JSON.stringify(formData.analytics_json) : null,
        formData.multi_step || false, formData.title_page || false,
        formData.title_heading || '', formData.title_desc || '',
        formData.start_text || 'Get Started', formData.auto_advance || false, embedToken
      ]
    );

    res.json({ form: rows[0] });
  } catch (err) {
    console.error('[ctmForms:import]', err.message);
    res.status(500).json({ error: 'Import failed' });
  }
});

router.post('/:id/duplicate', isAdminOrEditor, async (req, res) => {
  try {
    const actingOrgId = req.portalUserId && req.portalUserId !== req.user.id ? req.portalUserId : null;
    const lookupParams = [req.params.id];
    let lookupClause = 'WHERE id = $1';
    if (actingOrgId) {
      lookupParams.push(actingOrgId);
      lookupClause += ' AND org_id = $2';
    }
    const { rows: source } = await query(`SELECT * FROM ctm_forms ${lookupClause}`, lookupParams);
    if (!source[0]) return res.status(404).json({ error: 'Form not found' });
    const f = source[0];
    const targetClient = req.body.clientId || f.org_id;
    const embedToken = generateEmbedToken();

    const { rows } = await query(
      `INSERT INTO ctm_forms (org_id, name, form_mode, config_json, submit_action, success_message,
        redirect_url, thankyou_html, dupe_phone, dupe_phone_href, analytics_override, analytics_json,
        multi_step, title_page, title_heading, title_desc, start_text, auto_advance,
        notification_enabled, notification_emails, notification_cc,
        notification_subject_template, notification_body_template, embed_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       RETURNING *`,
      [
        targetClient, f.name + ' (Copy)', f.form_mode, JSON.stringify(f.config_json),
        f.submit_action, f.success_message, f.redirect_url, f.thankyou_html,
        f.dupe_phone, f.dupe_phone_href, f.analytics_override,
        f.analytics_json ? JSON.stringify(f.analytics_json) : null,
        f.multi_step, f.title_page, f.title_heading, f.title_desc, f.start_text, f.auto_advance,
        f.notification_enabled, f.notification_emails, f.notification_cc,
        f.notification_subject_template, f.notification_body_template, embedToken
      ]
    );

    logFormActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.DUPLICATE_FORM,
      formId: rows[0].id,
      formName: rows[0].name,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { formName: rows[0].name, sourceFormId: req.params.id }
    }).catch(() => {});

    res.json({ form: rows[0] });
  } catch (err) {
    console.error('[ctmForms:duplicate]', err.message);
    res.status(500).json({ error: 'Duplicate failed' });
  }
});

// ---------------------------------------------------------------------------
// AI System Prompt (matches plugin's build_ai_system_prompt exactly)
// ---------------------------------------------------------------------------

function buildAiSystemPrompt() {
  return `You are an expert AI form-building assistant for a form builder that submits to CallTrackingMetrics (CTM) FormReactors. You receive the current form configuration as JSON and a natural-language instruction. You return an updated JSON configuration.

## OUTPUT RULES
1. Return ONLY valid JSON — no markdown fences, no explanations, no commentary. Use compact JSON (no extra whitespace or newlines) to stay within output limits.
2. Never truncate — include ALL fields in the response, even unchanged ones.
3. Preserve existing field IDs when modifying forms.
4. Only modify what the instruction asks for (unless building from scratch).
5. When building from scratch (empty fields array), generate the complete form in one response.

## CONFIG STRUCTURE
{
  "settings": {
    "labelStyle": "above"|"floating"|"hidden",
    "submitText": "Submit",
    "successMessage": "Thanks! We'll be in touch shortly.",
    "colorScheme": "light"|"dark",
    "colors": { "bg": "#fff", "text": "#333", "label": "#555", "inputBg": "#fff", "inputBorder": "#d0d0d0", "inputText": "#333", "focus": "#007bff", "btnBg": "#007bff", "btnText": "#fff" },
    "multiStep": false,
    "progressBar": true,
    "autoAdvance": false,
    "titlePage": { "enabled": false, "heading": "", "description": "", "buttonText": "Get Started" },
    "scoring": { "enabled": false, "showTotal": false, "totalLabel": "Your Score", "sendAs": "custom_total_score" }
  },
  "fields": [ ... ]
}

## FIELD TYPES
Input: text, email, tel, number, url, textarea, select, checkbox, radio, hidden, consent
Layout: heading, paragraph, divider, score_display

## FIELD PROPERTIES
Every field MUST have: id, type, label, name, displayName, placeholder, helpText, defaultValue, required (bool), isCustom (bool), width ("full"|"half"|"third"|"quarter"), labelStyle ("inherit"|"above"|"floating"|"hidden"), cssClass, step (0-indexed int), conditions (array), conditionLogic ("all"|"any"), logVisible (bool), registerField (bool).

Type-specific extras:
- select, checkbox, radio → options: [{ label, value, score }]
- number → min, max, numStep
- consent → consentText (string)
- heading, paragraph → use the label property for content text

## CORE CTM FIELD NAMES (CRITICAL)
These three fields MUST have isCustom: false:
- caller_name — contact name (type "text")
- email — email address (type "email")
- phone_number — phone number (type "tel", ALWAYS required)

ALL other fields MUST have isCustom: true.

## FIELD NAME RULES
- Lowercase snake_case only (no spaces, hyphens, or special chars)
- label = human-readable text, name = machine identifier
- CORRECT: service_type, new_patient, teeth_grinding
- WRONG: "Are You New?", "Service-Type"

## FIELD ID FORMAT
Generate IDs as f_ followed by 8 random alphanumeric characters (e.g. f_a1b2c3d4).

## MULTI-STEP FORMS
Fields are assigned to steps via the \`step\` property (0-indexed integer: step 0, step 1, step 2, etc.).

Settings:
- settings.multiStep: true — enables multi-step mode
- settings.progressBar: true — shows a progress bar at the top
- settings.autoAdvance: true — automatically advances to the next step when a radio or select option is chosen (ideal for one-question-per-step quizzes)

The renderer automatically generates:
- Step counter at top ("Step X of Y")
- Back button on every step after step 0
- Continue button on every step except the last
- Submit button on the last step only

Layout fields (heading, paragraph) can be placed on any step as headers or descriptions — they do not submit data.

Title Page (optional intro screen before step 0):
- settings.titlePage.enabled: true — shows a landing page before the form
- settings.titlePage.heading — main heading text
- settings.titlePage.description — sub-text
- settings.titlePage.buttonText — start button label (default "Get Started")

## SCORING
When settings.scoring.enabled: true, option-based fields (radio, select, checkbox) use the score property on each option to calculate totals.
- settings.scoring.showTotal: true — shows the user their score
- settings.scoring.totalLabel — label shown above score
- settings.scoring.sendAs — CTM custom field name for the total score (default "custom_total_score")
- Add a score_display field to show the live score

## GENERATION PATTERNS

**Quiz / Assessment Forms** (like symptom screeners, self-assessments):
- Set multiStep: true, autoAdvance: true, progressBar: true
- One question per step using radio fields, each with descriptive options
- All question fields: required: true
- Use a heading field on each step for the question text, and a radio field below for the options (or use the radio field label as the question)
- Final step: contact info fields (caller_name, email, phone_number) — all required
- If scoring is needed, assign score values to each option

**Contact Forms** (standard lead capture):
- Single step (all fields step: 0), multiStep: false
- Include: caller_name, email, phone_number, message (textarea)
- phone_number always required

**Multi-Step Lead Forms** (service selection + details + contact):
- Group related fields by step
- Step 0: service/category selection
- Middle steps: detail fields related to selected service
- Final step: contact info (caller_name, email, phone_number)

## FIELD DEFAULTS FOR NEW FIELDS
required: false, width: "full", labelStyle: "inherit", step: 0, logVisible: true, registerField: false, isCustom: true, conditions: [], conditionLogic: "all"`;
}

export default router;
