import axios from 'axios';
import { generateAiResponse } from './ai.js';
import { decrypt } from './security/encryption.js';
import { logSecurityEvent } from './security/index.js';
import { logAiClassificationEvent } from './aiClassificationLog.js';
import { query as _dbQuery } from '../db.js';
import { resolveContact } from './contacts.js';
import { getAutoStarRating, computeAutoStar } from './autoStar.js';

const CTM_BASE = process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com';
const AI_CLASSIFICATION_DEBUG = /^(1|true|yes|on)$/i.test(String(process.env.AI_CLASSIFICATION_DEBUG || '').trim());

function buildClassificationResponseInstruction() {
  return 'Respond ONLY with JSON: {"category":"<category>","summary":"One sentence summary","reasoning":"Short reason for the classification"}';
}

// Canonical category definitions for CALLS - ALWAYS appended to any prompt during classification
// This ensures consistent categories regardless of custom business prompts
// NOTE: "converted" is NOT in this list - it's assigned manually when user marks 5 stars
export const CATEGORY_DEFINITIONS = `
CATEGORIES (use exactly these values):
- very_hot: Ready to book/buy now, high intent, explicitly interested
- warm: Promising lead interested in services, needs follow-up
- needs_attention: Voicemail where the caller left real content suggesting they want service (must not be forgotten), OR any call with urgent/severe-pain concerns requiring an immediate callback
- not_a_fit: ONLY use when the caller clearly reached the wrong office, needs a service this business does not provide, is outside the practice scope/area, or is otherwise explicitly disqualified. Do NOT use this for insurance questions, cost questions, needing time to think, wanting a callback later, or anyone who may still convert with follow-up.
- spam: Telemarketer, robocall, wrong number, or irrelevant sales call
- neutral: General inquiry or administrative call with no booking intent. Use this for existing patients handling administrative business (rescheduling, records requests, billing questions, confirming an appointment they already have) — lifecycle state is tracked separately from category.
- applicant: ONLY use if caller explicitly asks about jobs, careers, employment, or applying for a position at the company. Do NOT use for service inquiries.

IMPORTANT: Do NOT use "converted", "active_client", "returning_customer", "voicemail", or "unanswered". Those are system-managed states (converted = manual 5-star rating; active_client = present in the account's active-clients list and applied as a tag; returning_customer = derived from call history; voicemail/unanswered = no caller content). You will only be asked to classify activities that have real caller content.
Your job is triage only: classify what kind of inbound this is, not who the caller is in the system. An existing customer can still produce a "warm" or "needs_attention" call if they're asking about a new service or have an emergency — but the active-client status is applied separately as a tag, never as the category.
Voicemail-specific rule: if the caller left real content and wants service, use "needs_attention" (voicemails can be forgotten — they must be flagged as urgent). Only use "warm" for voicemails where the caller is interested but not explicitly requesting a callback.
Spam must be reserved for clear junk: telemarketers, robocalls, scam calls, obvious service sellers, or nonsense/gibberish.
Calls from doctors, dentists, orthodontists, pharmacies, labs, or other offices about patients, referrals, records, treatment, or care coordination are legitimate business calls and should never be marked as spam.

${buildClassificationResponseInstruction()}
`.trim();

// Category definitions for FORM SUBMISSIONS - excludes call-specific categories
export const FORM_CATEGORY_DEFINITIONS = `
CATEGORIES (use exactly these values for form submissions):
- very_hot: Ready to book/buy now, high intent, explicitly interested, wants to schedule
- warm: Promising lead interested in services, needs follow-up
- needs_attention: Requires immediate attention or follow-up (urgent request, time-sensitive, emergency)
- not_a_fit: ONLY use when the person clearly wants a service the business does not provide, reached the wrong office, is outside the practice scope/area, or is otherwise explicitly disqualified. Do NOT use this for insurance questions, cost questions, needing time to think, wanting a callback later, or anyone who may still convert with follow-up.
- spam: Spam submission, test message, gibberish, or irrelevant content
- neutral: General inquiry or administrative submission from an existing customer (paperwork questions, billing, records) with no new booking intent.
- applicant: ONLY use if person explicitly asks about jobs, careers, employment, or applying for a position at the company. Do NOT use for service inquiries.
IMPORTANT RULES FOR FORM SUBMISSIONS:
- NEVER use "voicemail" or "unanswered" - those are for phone calls only
- Even short or vague messages should be categorized as "neutral" or "warm", not voicemail
- Assume the person wants to be contacted unless they say otherwise
- Do NOT use "converted", "active_client", or "returning_customer" - lifecycle states are applied separately (converted via 5-star rating; active_client/returning_customer via tags driven by the active-clients list and call history).

${buildClassificationResponseInstruction()}
`.trim();

export const DEFAULT_AI_PROMPT =
  process.env.DEFAULT_AI_PROMPT ||
  'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation and determine the caller intent.';

const MAX_CALLS = Number(process.env.CTM_MAX_CALLS || 200);
const CLASSIFY_LIMIT = Number(process.env.CTM_CLASSIFY_LIMIT || 40);

// Auto-generated placeholder summaries written when a call had NO usable conversation
// at classification time (transcript not yet available — CTM transcribes async). These
// are NOT real AI summaries: if a transcript later arrives, they must NOT block
// re-classification, otherwise an answered call stays stuck as "unanswered" forever
// (the transcript shows in the drawer but the category never updates). See the
// hasConversation branch below.
const NO_CONVERSATION_STUB_SUMMARIES = new Set([
  'Call was unanswered with no voicemail.',
  'Call reached voicemail with no actionable caller content.',
  'Call logged from CTM metadata.'
]);
export function isNoConversationStubSummary(summary = '') {
  return NO_CONVERSATION_STUB_SUMMARIES.has(String(summary || '').replace(/\s+/g, ' ').trim());
}

// Canonical set of categories that may be persisted. Any AI-produced value
// outside this set is coerced to 'unreviewed' so a corrupt/truncated response
// can never silently hide a lead (see the Bell Road incident: truncated
// Vertex JSON wrote categories like `{`, `{_"category` which fell outside
// every dashboard filter bucket).
// Note: 'converted' is NOT included below because AI is never allowed to
// produce it. It is assigned exclusively via the manual 5-star rating path
// (getCategoryFromRating). 'active_client' and 'returning_customer' are
// likewise not categories — they're tags/state derived from the active-clients
// list and call history, applied outside of classification.
const CALL_CATEGORY_VALUES = [
  'very_hot',
  'very_good',
  'warm',
  'needs_attention',
  'unanswered',
  'not_a_fit',
  'spam',
  'neutral',
  'applicant',
  'unreviewed'
];
const FORM_CATEGORY_VALUES = [
  'very_hot',
  'very_good',
  'warm',
  'needs_attention',
  'not_a_fit',
  'spam',
  'neutral',
  'applicant',
  'unreviewed'
];
const CALL_CATEGORY_SET = new Set(CALL_CATEGORY_VALUES);
const FORM_CATEGORY_SET = new Set(FORM_CATEGORY_VALUES);

const CATEGORY_MAP = {
  converted: 'converted', // Only from manual 5-star rating
  warm: 'warm',
  very_hot: 'very_good',
  'very-hot': 'very_good',
  hot: 'very_good',
  needs_attention: 'needs_attention',
  applicant: 'applicant',
  voicemail: 'voicemail',
  unanswered: 'unanswered',
  not_a_fit: 'not_a_fit',
  spam: 'spam',
  neutral: 'neutral',
  active_client: 'active_client', // Existing customer calling about their account
  returning_customer: 'returning_customer' // Past client calling back
};

const CALLBACK_LEAD_CATEGORIES = new Set(['warm', 'very_good', 'needs_attention']);

// getAutoStarRating now lives in ./autoStar.js (pure, testable). Re-exported
// here so existing importers (hub.js, backfill scripts) need no change.
export { getAutoStarRating };

export function isCallbackLeadCategory(category) {
  return CALLBACK_LEAD_CATEGORIES.has(mapCategory(category));
}

export function shouldRequireCallback({ isVoicemail = false, category, hasExistingCtmRating = false } = {}) {
  return Boolean(isVoicemail && !hasExistingCtmRating && isCallbackLeadCategory(category));
}

/**
 * Maps star rating (from CTM) to category for display/organization
 * This is the reverse of getAutoStarRating - used when leads already have ratings
 * 1 = Spam
 * 2 = Not a fit
 * 3 = Solid lead (very_good)
 * 4 = Great lead (very_good)
 * 5 = Converted (agreed to service)
 */
export function getCategoryFromRating(score) {
  switch (score) {
    case 1:
      return 'spam';
    case 2:
      return 'not_a_fit';
    case 3:
      return 'very_good';
    case 4:
      return 'very_good';
    case 5:
      return 'converted';
    default:
      return null; // No rating - use AI classification
  }
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function formatDate(ms) {
  try {
    return dateFormatter.format(new Date(ms));
  } catch {
    return '';
  }
}

function sanitizeSourceKey(value = '') {
  const trimmed = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return trimmed || 'unknown';
}

function isFormSubmission(call = {}) {
  if (!call || typeof call !== 'object') return false;
  return Boolean(
    call.form_submission ||
      call.form_data ||
      call.form ||
      call.form_name ||
      String(call.direction || '').toLowerCase().includes('form')
  );
}

function getFormName(call = {}) {
  return call.form?.form_name || call.form_name || call.form_submission?.form_name || call.form_data?.form_name || '';
}

function determineActivityType(input = '') {
  if (input && typeof input === 'object') {
    if (isFormSubmission(input)) return 'form';
    const dir = String(input.direction || input.type || input.channel || '').toLowerCase();
    if (dir.includes('msg') || dir.includes('sms')) return 'sms';
    if (dir.includes('email')) return 'email';
    if (dir.includes('inbound') || dir.includes('outbound')) return 'call';
    return 'other';
  }
  const dir = String(input || '').toLowerCase();
  if (dir.includes('msg') || dir.includes('sms')) return 'sms';
  if (dir.includes('form')) return 'form';
  if (dir.includes('email')) return 'email';
  if (dir.includes('inbound') || dir.includes('outbound')) return 'call';
  return 'other';
}

function inferFormCategory(formName = '') {
  const normalized = String(formName || '').trim().toLowerCase();
  if (!normalized) return 'neutral';
  if (/(quiz|assessment|screening|evaluation|consultation|pain|sleep|tmj|symptom|new patient)/i.test(normalized)) {
    return 'warm';
  }
  return 'neutral';
}

function buildFormFallbackSummary(formName = '') {
  const trimmed = String(formName || '').trim();
  return trimmed ? `${trimmed} submitted and needs review.` : 'Form submission received and needs review.';
}

function formatFormPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => formatFormPayload(entry))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof payload === 'object') {
    const parts = [];
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (typeof value === 'object') {
        parts.push(`${key}: ${formatFormPayload(value)}`);
      } else {
        parts.push(`${key}: ${value}`);
      }
    });
    return parts.join('\n');
  }
  return '';
}

function buildMessage(call) {
  if (call.message_body) return String(call.message_body);
  if (call.notes) return String(call.notes);
  if (call.form_submission) return formatFormPayload(call.form_submission);
  if (call.form_data) return formatFormPayload(call.form_data);
  if (call.form?.custom) return formatFormPayload(call.form.custom);
  if (call.form) return formatFormPayload(call.form);
  return '';
}

function getTranscript(call) {
  if (call.transcription?.text) return String(call.transcription.text);
  if (call.transcription_text) return String(call.transcription_text);
  if (call.transcript) return String(call.transcript);
  return '';
}

function buildRegion(call) {
  const caller = call.caller || {};
  const address = caller.address || {};
  const city = caller.city || address.city || call.city || call.caller_city || '';
  const state = caller.state || address.state || call.state || call.caller_state || '';
  const country = caller.country || address.country || call.country || '';
  return [city, state, country].filter(Boolean).join(', ');
}

function getSource(call) {
  return call.tracking_number_name || call.source || call.campaign_name || call.tracking_label || call.campaign_source || 'Calls';
}

function getCallerName(call) {
  return call.caller?.name || call.name || call.caller_name || '';
}

function getCallerNumber(call) {
  return call.caller?.number || call.contact_number || call.caller_number || call.phone_number || call.from_number || '';
}

// CTM exposes a contact's email inconsistently: sometimes on the caller/contact
// object, sometimes only inside the form payload. Forms always collect an email
// (required field), so we also scan the form fields — with an email-regex
// fallback that works regardless of the exact field key or payload shape.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function findEmailInPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') {
    const m = payload.match(EMAIL_RE);
    return m ? m[0] : '';
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = findEmailInPayload(entry);
      if (found) return found;
    }
    return '';
  }
  if (typeof payload === 'object') {
    // Prefer a key that looks like an email field.
    for (const [key, value] of Object.entries(payload)) {
      if (/e-?mail/i.test(key) && typeof value === 'string') {
        const m = value.match(EMAIL_RE);
        if (m) return m[0];
      }
    }
    // Fallback: any value that contains an email address.
    for (const value of Object.values(payload)) {
      const found = findEmailInPayload(value);
      if (found) return found;
    }
  }
  return '';
}

export function getCallerEmail(call) {
  if (!call || typeof call !== 'object') return '';
  return (
    call.caller?.email ||
    call.contact?.email ||
    call.email ||
    call.caller_email ||
    findEmailInPayload(call.form_submission) ||
    findEmailInPayload(call.form_data) ||
    findEmailInPayload(call.form?.custom) ||
    findEmailInPayload(call.form) ||
    ''
  );
}

function getToNumber(call) {
  return call.tracking_number || call.to_number || call.dialed_number || call.number_dialed || '';
}

function getDuration(call) {
  return call.duration || call.duration_sec || call.duration_seconds || call.talk_time || call.call_duration || null;
}

function parseTimestamp(call) {
  const unixCandidate = call.unix_time || call.unixTime || call.unix_timestamp;
  let timestampMs = null;
  let unixTime = null;
  if (unixCandidate) {
    const numeric = Number(unixCandidate);
    if (!Number.isNaN(numeric) && numeric > 0) {
      unixTime = numeric;
      timestampMs = numeric * 1000;
    }
  }
  if (!timestampMs) {
    const candidates = [call.start_time, call.started_at, call.call_time, call.called_at, call.created_at, call.timestamp];
    for (const entry of candidates) {
      if (!entry) continue;
      let numeric = null;
      if (typeof entry === 'number') {
        numeric = entry > 1e12 ? entry : entry * 1000;
      } else {
        const parsed = Date.parse(entry);
        if (!Number.isNaN(parsed)) numeric = parsed;
      }
      if (numeric) {
        timestampMs = numeric;
        unixTime = Math.floor(numeric / 1000);
        break;
      }
    }
  }
  // Last resort: CTM should always provide a timestamp, but if every field
  // parses as null we fall back to "now" so the row doesn't sink to the
  // bottom of the list (ORDER BY started_at DESC NULLS LAST). Log loudly
  // so we can investigate real cases.
  if (!timestampMs) {
    console.warn('[ctm:parseTimestamp] no parseable timestamp on call, using now()', {
      callId: call.id || call.call_id,
      fields: {
        unix_time: call.unix_time,
        start_time: call.start_time,
        called_at: call.called_at,
        created_at: call.created_at
      }
    });
    timestampMs = Date.now();
    unixTime = Math.floor(timestampMs / 1000);
  }
  return {
    timestampMs,
    unixTime,
    startedAtIso: timestampMs ? new Date(timestampMs).toISOString() : null
  };
}

function buildTranscriptUrl(unixTime) {
  if (!unixTime) return '';
  const after = Buffer.from(String(unixTime)).toString('base64');
  return `https://calltrackingapp.com/calls#after=${encodeURIComponent(after)}&callNav=caller_transcription`;
}

function extractAssets(call) {
  const assets = [];
  if (Array.isArray(call.recordings)) {
    call.recordings.forEach((rec, index) => {
      const url = rec.public_url || rec.url;
      if (!url) return;
      assets.push({
        id: rec.id || rec.uuid || `${call.id || call.call_id || 'rec'}-${index}`,
        name: rec.name || 'Recording',
        url,
        created_at: rec.created_at || null
      });
    });
  } else if (call.recording_url) {
    assets.push({
      id: `recording_${call.id || call.call_id || 'call'}`,
      name: 'Recording',
      url: call.recording_url,
      created_at: call.started_at || null
    });
  }
  return assets;
}

function mapCategory(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return CATEGORY_MAP[slug] || slug || 'unreviewed';
}

const CATEGORY_PATTERNS = [
  { key: 'converted', phrases: ['converted', 'agreed to service', 'booked', 'scheduled appointment', 'signed up'] },
  { key: 'needs_attention', phrases: ['needs_attention', 'needs attention', 'attention needed'] },
  { key: 'very_hot', phrases: ['very hot', 'ready to book', 'ready to schedule'] },
  { key: 'warm', phrases: ['warm', 'interested lead', 'promising lead'] },
  { key: 'voicemail', phrases: ['voicemail', 'voice mail'] },
  { key: 'unanswered', phrases: ['unanswered', 'no answer', 'no response'] },
  {
    key: 'not_a_fit',
    phrases: [
      'not a fit',
      'wrong number',
      'wrong office',
      'wrong clinic',
      'wrong practice',
      'don’t offer that',
      "don't offer that",
      'do not offer that',
      'service not offered',
      'outside service area',
      'out of area',
      'not a candidate'
    ]
  },
  { key: 'spam', phrases: ['spam', 'telemarketer', 'scam', 'robocall'] },
  { key: 'neutral', phrases: ['neutral', 'general inquiry', 'info request'] },
  // Only match job-related phrases that are unambiguous (not "apply for service" etc)
  {
    key: 'applicant',
    phrases: [
      'job opening',
      'job inquiry',
      'career opportunity',
      'employment inquiry',
      'hiring',
      'looking for work',
      'seeking employment',
      'job applicant',
      'resume',
      'cv submission'
    ]
  }
];

function inferCategoryFromText(text = '') {
  const lower = text.toLowerCase();
  for (const entry of CATEGORY_PATTERNS) {
    if (entry.phrases.some((phrase) => lower.includes(phrase))) {
      return entry.key;
    }
  }
  return null;
}

export function isReferralContext(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return false;
  const phrases = [
    'mutual patient',
    'regarding patient',
    'patient treatment',
    'treatment plan',
    'care coordination',
    'referring office',
    'referral',
    'orthodont',
    "doctor's office",
    'doctor office',
    'dental office',
    'dentist office',
    'physician office',
    'pharmacy',
    'lab results',
    'medical records',
    'fax number',
    'provider line'
  ];
  return phrases.some((phrase) => normalized.includes(phrase));
}

function looksLikeSoftLead(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return false;
  const phrases = [
    'insurance',
    'coverage',
    'benefits',
    'out of network',
    'in network',
    'financing',
    'payment plan',
    'care credit',
    'cost',
    'price',
    'pricing',
    'quote',
    'need to think',
    'think about it',
    'call back',
    'follow up',
    'follow-up',
    'later this week',
    'not ready yet',
    'more information',
    'more info',
    'questions about treatment',
    'questions about service',
    'wants to schedule later',
    'schedule later',
    'speak with spouse',
    'check calendar',
    'check work schedule'
  ];
  return phrases.some((phrase) => normalized.includes(phrase));
}

function looksLikeHighIntentPatientLead(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return false;

  const intentSignals = [
    'interested in getting',
    'interested in scheduling',
    'would like to transfer my care',
    'transfer my care',
    'transfer care',
    'diagnostic imaging',
    'diagnosed with',
    'severe pain',
    'ear pain',
    'pricing estimate',
    'insurance',
    'oral appliance',
    'splint',
    'first office visit',
    'consultation',
    'new patient'
  ];

  const firstPersonSignals = [' i ', ' my ', ' me ', ' i am ', ' i have ', ' i would like '];
  const matchedIntentCount = intentSignals.filter((phrase) => normalized.includes(phrase)).length;
  const isFirstPersonPatientInquiry = firstPersonSignals.some((phrase) => ` ${normalized} `.includes(phrase));

  return isFirstPersonPatientInquiry && matchedIntentCount >= 2;
}

export function buildSystemTags({ semanticCategory = '', isReferral = false, categorySource = '', enrichment = {} } = {}) {
  const tags = [];
  if (isReferral) {
    tags.push({ key: 'referral', label: 'Referral', color: '#0f766e' });
  }
  if (mapCategory(semanticCategory) === 'applicant') {
    tags.push({ key: 'applicant', label: 'Applicant', color: '#92400e' });
  }
  if (String(categorySource || '').toLowerCase() === 'client') {
    tags.push({ key: 'client_provided', label: 'Client Provided', color: '#1d4ed8' });
  }
  return tags;
}

function buildFallbackSummary(category, isForm = false) {
  const subject = isForm ? 'Form submission' : 'Caller';
  switch (category) {
    case 'very_good':
      return `${subject} showed strong interest and should be followed up promptly.`;
    case 'warm':
      return `${subject} appears interested in services and needs follow-up.`;
    case 'needs_attention':
      return `${subject} needs prompt follow-up.`;
    case 'not_a_fit':
      return `${subject} does not appear to be a fit for the business.`;
    case 'applicant':
      return `${subject} appears to be asking about a job rather than services.`;
    case 'spam':
      return `${subject} appears to be spam or an irrelevant solicitation.`;
    case 'neutral':
      return `${subject} made a general inquiry with unclear intent.`;
    case 'voicemail':
      return `${subject} left a message without enough detail to score.`;
    case 'unanswered':
      return 'No conversation occurred.';
    default:
      return isForm ? 'Form submission received.' : 'Call received.';
  }
}

function looksLikeBrokenSummary(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return true;
  if (normalized === '{' || normalized === '[') return true;
  if (/^```/.test(normalized)) return true;
  if (/^\{/.test(normalized)) return true;
  if (/^"category"/i.test(normalized)) return true;
  if (/^okay,\s*i'?m ready to classify/i.test(normalized)) return true;
  if (/^i need the actual message content/i.test(normalized)) return true;
  if (/once you provide the message/i.test(normalized)) return true;
  return false;
}

export function isUsableClassificationSummary(summary = '') {
  const normalized = String(summary || '').replace(/\s+/g, ' ').trim();
  if (looksLikeBrokenSummary(normalized)) return false;
  return normalized.length >= 8;
}

function sanitizeClassificationSummary(summary, { category = 'unreviewed', isForm = false } = {}) {
  const normalized = String(summary || '').replace(/\s+/g, ' ').trim();
  if (!isUsableClassificationSummary(normalized)) {
    return buildFallbackSummary(category, isForm);
  }
  return normalized;
}

function sanitizeClassificationReasoning(reasoning = '', summary = '') {
  const normalized = String(reasoning || '').replace(/\s+/g, ' ').trim();
  if (looksLikeBrokenSummary(normalized)) return '';
  if (normalized.length >= 8) return normalized;
  const summaryFallback = String(summary || '').replace(/\s+/g, ' ').trim();
  return looksLikeBrokenSummary(summaryFallback) ? '' : summaryFallback;
}

export function logAiClassificationDebug(stage, payload = {}) {
  if (!AI_CLASSIFICATION_DEBUG) return;
  console.log('[ai:classify:debug]', JSON.stringify({
    stage,
    timestamp: new Date().toISOString(),
    ...payload
  }, null, 2));
}

/**
 * Classify content (call transcript or form message) using AI
 * @param {string} prompt - Custom AI prompt (optional)
 * @param {string} transcript - Call transcript (if from a call)
 * @param {string} message - Form message content (if from a form)
 * @param {Object} options - Additional options
 * @param {string} options.source - 'call' or 'form' (defaults to detecting from params)
 * @returns {Promise<Object>} - { classification, summary, category }
 */
export async function classifyContent(prompt, transcript, message, options = {}) {
  const content = transcript || message;
  if (!content) {
    logAiClassificationDebug('classifier:no_content', {
      source: options.source || (transcript ? 'call' : 'form'),
      classification: 'unreviewed',
      summary: 'No transcript or message available.',
      reasoning: 'No input content was available for classification.'
    });
    return {
      classification: 'unreviewed',
      summary: 'No transcript or message available.',
      category: 'unreviewed',
      reasoning: 'No input content was available for classification.',
      debug: {
        source: options.source || (transcript ? 'call' : 'form'),
        rawResponse: '',
        parsedCategory: 'unreviewed',
        finalCategory: 'unreviewed',
        adjustments: ['no_content'],
        prompt: prompt || DEFAULT_AI_PROMPT,
        model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
        inputLength: 0
      }
    };
  }
  const payloadPreview = content.slice(0, 500);

  // Determine source type - forms use different category definitions (no voicemail/unanswered)
  const isForm = options.source === 'form' || (!transcript && message);
  const categoryDefs = isForm ? FORM_CATEGORY_DEFINITIONS : CATEGORY_DEFINITIONS;

  // Guardrail for Twilio/voice transcripts that only captured an automated
  // office menu or voicemail greeting. These should never be sent to AI and
  // should always surface as unanswered.
  if (!isForm && transcript && looksLikeAutomatedMenuOnlyTranscript(transcript)) {
    logAiClassificationDebug('classifier:menu_only', {
      source: 'call',
      input: content,
      inputLength: content.length,
      classification: 'unanswered',
      summary: 'Call reached an automated office menu or voicemail with no actionable caller content.',
      reasoning: 'Menu-only transcript matched automated voicemail heuristics before AI classification.'
    });
    return {
      classification: 'unanswered',
      summary: 'Call reached an automated office menu or voicemail with no actionable caller content.',
      category: 'unanswered',
      reasoning: 'Menu-only transcript matched automated voicemail heuristics before AI classification.',
      debug: {
        source: 'call',
        rawResponse: '',
        parsedCategory: 'unanswered',
        finalCategory: 'unanswered',
        adjustments: ['automated_menu_short_circuit'],
        prompt: prompt || DEFAULT_AI_PROMPT,
        model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
        inputLength: content.length
      }
    };
  }

  // Build the system prompt: custom business context + canonical category definitions
  const businessContext = prompt || DEFAULT_AI_PROMPT;
  const systemPrompt = `${businessContext}\n\n${categoryDefs}`;

  // Content type prefix for the AI
  const contentPrefix = isForm
    ? 'Form submission message:\n'
    : 'Caller transcript:\n';

  // Build an enum-constrained JSON schema so Vertex returns structured output.
  // This eliminates the truncation/parse-failure class of bugs that produced
  // corrupt categories like `{` and `{_"category` in the DB.
  const allowedEnum = isForm ? FORM_CATEGORY_VALUES : CALL_CATEGORY_VALUES;
  const allowedSet = isForm ? FORM_CATEGORY_SET : CALL_CATEGORY_SET;
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', enum: allowedEnum },
      summary: { type: 'STRING' },
      reasoning: { type: 'STRING' }
    },
    required: ['category', 'summary']
  };

  // Retry 429s with exponential backoff. If multiple calls/forms classify
  // concurrently and hit Vertex's quota, back off and try again instead of
  // silently returning garbage.
  async function callWithRetry() {
    const delays = [0, 1000, 2500, 6000]; // 4 attempts, last gap ~6s
    let lastErr = null;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
      try {
        return await generateAiResponse({
          prompt: `${contentPrefix}${content.slice(0, 6000)}`,
          systemPrompt,
          temperature: 0.2,
          maxTokens: 800,
          responseMimeType: 'application/json',
          responseSchema,
          model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || undefined
        });
      } catch (err) {
        lastErr = err;
        const msg = err?.response?.data ? JSON.stringify(err.response.data) : err?.message || '';
        const is429 = /429|RESOURCE_EXHAUSTED|Too Many Requests/i.test(msg);
        if (!is429) throw err;
        console.warn(`[ctm:classify] 429 on attempt ${attempt + 1}, retrying`);
      }
    }
    throw lastErr;
  }

  try {
    const raw = await callWithRetry();
    const trimmedRaw = String(raw || '').trim();
    let classification = '';
    let summary = '';
    let reasoning = '';
    const adjustments = [];
    try {
      const parsed = JSON.parse(trimmedRaw);
      classification = String(parsed.category || '').trim();
      summary = String(parsed.summary || '').trim();
      reasoning = String(parsed.reasoning || '').trim();
    } catch {
      // Fallback only: the model ignored schema and returned freeform text.
      // Try the regex extractors one last time.
      const categoryMatch = trimmedRaw.match(/"category"\s*:\s*"([^"]+)"/i);
      if (categoryMatch) classification = categoryMatch[1];
      const summaryMatch = trimmedRaw.match(/"summary"\s*:\s*"([^"]+)"/i);
      if (summaryMatch) summary = summaryMatch[1];
      const reasoningMatch = trimmedRaw.match(/"reasoning"\s*:\s*"([^"]+)"/i);
      if (reasoningMatch) reasoning = reasoningMatch[1];
      if (!classification) {
        const inferred = inferCategoryFromText(trimmedRaw);
        if (inferred) {
          classification = inferred;
          adjustments.push(`category_inferred_from_raw_text:${inferred}`);
        }
      }
    }

    const mappedCategory = mapCategory(classification);
    let finalCategory = mappedCategory;
    if (!mappedCategory || mappedCategory === 'unreviewed') {
      const inferredFromSummary = inferCategoryFromText(summary);
      if (inferredFromSummary) {
        finalCategory = mapCategory(inferredFromSummary);
        classification = inferredFromSummary;
        adjustments.push(`category_inferred_from_summary:${inferredFromSummary}`);
      }
    }
    // Hard allowlist guard — if anything unexpected slipped through, snap
    // to 'unreviewed' so the lead still appears in the dashboard inbox.
    if (!allowedSet.has(finalCategory)) {
      console.warn('[ctm:classify] unknown category coerced to unreviewed', {
        raw: String(classification || '').slice(0, 60),
        mapped: finalCategory,
        isForm
      });
      finalCategory = 'unreviewed';
      classification = 'unreviewed';
      adjustments.push('unknown_category_coerced_to_unreviewed');
    } else {
      classification = finalCategory;
    }

    const combinedContext = `${content}\n${summary}`;
    if (isReferralContext(combinedContext) && ['spam', 'not_a_fit', 'applicant'].includes(finalCategory)) {
      finalCategory = 'warm';
      classification = 'warm';
      adjustments.push('referral_context_promoted_to_warm');
    } else if (isForm && looksLikeHighIntentPatientLead(combinedContext) && ['neutral', 'unreviewed', 'not_a_fit', 'applicant'].includes(finalCategory)) {
      finalCategory = 'very_good';
      classification = 'very_good';
      adjustments.push('high_intent_patient_form_promoted_to_very_good');
    } else if (finalCategory === 'not_a_fit' && looksLikeSoftLead(combinedContext)) {
      finalCategory = 'warm';
      classification = 'warm';
      adjustments.push('not_a_fit_softened_to_warm');
    }

    summary = sanitizeClassificationSummary(summary, { category: finalCategory || classification, isForm });
    reasoning = sanitizeClassificationReasoning(reasoning, summary);
    if (!classification || !summary) {
      console.warn('[ctm:classify] Empty classification or summary', {
        classification,
        summary,
        category: finalCategory,
        preview: payloadPreview
      });
    }

    // Safety check: For forms, remap any call-specific categories to appropriate alternatives
    // This catches cases where AI might still return voicemail/unanswered despite instructions
    if (isForm && (finalCategory === 'voicemail' || finalCategory === 'unanswered')) {
      console.log(`[ctm:classify] Remapping call-specific category "${finalCategory}" to "neutral" for form submission`);
      finalCategory = 'neutral';
      classification = 'neutral';
      adjustments.push('form_call_only_category_remapped_to_neutral');
      // Also update summary if it mentions voicemail
      if (summary && summary.toLowerCase().includes('voicemail')) {
        summary = summary.replace(/voicemail/gi, 'message').replace(/left a message/gi, 'submitted a message');
      }
    }

    logAiClassificationDebug('classifier:result', {
      source: isForm ? 'form' : 'call',
      input: content,
      inputLength: content.length,
      prompt: businessContext,
      model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
      rawResponse: trimmedRaw,
      parsedCategory: mappedCategory || classification || 'unreviewed',
      finalCategory: finalCategory || classification || 'unreviewed',
      summary,
      reasoning,
      adjustments
    });

    return {
      classification,
      summary,
      category: finalCategory || classification || 'unreviewed',
      reasoning,
      debug: {
        source: isForm ? 'form' : 'call',
        rawResponse: trimmedRaw,
        parsedCategory: mappedCategory || classification || 'unreviewed',
        finalCategory: finalCategory || classification || 'unreviewed',
        adjustments,
        prompt: businessContext,
        model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
        inputLength: content.length
      }
    };
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('[ctm:classify]', {
      error: details,
      preview: payloadPreview
    });
    logAiClassificationDebug('classifier:error', {
      source: isForm ? 'form' : 'call',
      input: content,
      inputLength: content.length,
      prompt: businessContext,
      model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
      error: details,
      classification: 'unreviewed',
      summary: 'AI classification failed.',
      reasoning: 'The AI classification request failed before a valid result could be parsed.'
    });
    return {
      classification: 'unreviewed',
      summary: 'AI classification failed.',
      category: 'unreviewed',
      reasoning: 'The AI classification request failed before a valid result could be parsed.',
      debug: {
        source: isForm ? 'form' : 'call',
        rawResponse: '',
        parsedCategory: 'unreviewed',
        finalCategory: 'unreviewed',
        adjustments: ['ai_request_failed'],
        prompt: businessContext,
        model: process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
        inputLength: content.length,
        error: typeof details === 'string' ? details : JSON.stringify(details)
      }
    };
  }
}

/**
 * Normalize phone number for consistent comparison
 * Strips all non-digit characters except leading +
 */
export function normalizePhoneNumber(phone) {
  if (!phone) return '';
  const str = String(phone).trim();
  // Keep leading + if present, strip everything else non-numeric
  if (str.startsWith('+')) {
    return '+' + str.slice(1).replace(/\D/g, '');
  }
  return str.replace(/\D/g, '');
}

/**
 * Fetch calls from CTM API with pagination support
 * @param {Object} credentials - CTM API credentials
 * @param {Object} options - Fetch options
 * @param {Date|string} options.sinceTimestamp - Only fetch calls after this timestamp (incremental sync)
 * @param {number} options.perPage - Results per page (default 100)
 * @param {number} options.maxPages - Max pages to fetch, 0 = unlimited (default 0 for full sync)
 * @param {boolean} options.fullSync - If true, ignores sinceTimestamp and fetches all available data
 * @param {Object} options.extraParams - Additional CTM API params
 */
async function fetchCtmCalls({ accountId, apiKey, apiSecret }, options = {}) {
  const {
    sinceTimestamp = null,
    perPage = 100,
    maxPages = 0, // 0 = unlimited
    fullSync = false,
    extraParams = {}
  } = options;

  if (!accountId || !apiKey || !apiSecret) {
    throw new Error('CallTrackingMetrics credentials not configured.');
  }

  // CTM date filters are day-based; include tomorrow to ensure "today" is fully captured across timezones
  const now = Date.now();
  const endDate = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // For incremental sync, use sinceTimestamp; for full sync, go back 1 year by default
  let startDate;
  if (fullSync || !sinceTimestamp) {
    // Full sync: fetch up to 1 year of history (CTM may have its own limits)
    const defaultLookback = Number(process.env.CTM_FULL_SYNC_DAYS || 365);
    startDate = new Date(now - defaultLookback * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  } else {
    // Incremental sync: start from last sync cursor
    const cursorDate = new Date(sinceTimestamp);
    // Go back 1 day from cursor to catch any edge cases with timezone/timing
    cursorDate.setDate(cursorDate.getDate() - 1);
    startDate = cursorDate.toISOString().slice(0, 10);
  }

  const calls = [];
  let page = 1;
  let latestTimestamp = null;
  const pageLimit = maxPages > 0 ? maxPages : 1000; // Safety limit

  while (page <= pageLimit) {
    const resp = await axios.get(`${CTM_BASE}/api/v1/accounts/${accountId}/calls`, {
      params: {
        per_page: perPage,
        page,
        order: 'desc',
        start_date: startDate,
        end_date: endDate,
        ...extraParams
      },
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        Accept: 'application/json'
      },
      timeout: 30000
    });

    const payload = Array.isArray(resp.data?.data?.calls)
      ? resp.data.data.calls
      : Array.isArray(resp.data?.calls)
        ? resp.data.calls
        : Array.isArray(resp.data?.data)
          ? resp.data.data
          : [];

    if (!payload.length) break;

    // Track the latest timestamp for cursor update
    for (const call of payload) {
      const { timestampMs } = parseTimestamp(call);
      if (timestampMs && (!latestTimestamp || timestampMs > latestTimestamp)) {
        latestTimestamp = timestampMs;
      }
    }

    calls.push(...payload);

    // Stop if we got fewer results than requested (last page)
    if (payload.length < perPage) break;

    page += 1;
  }

  return {
    calls,
    latestTimestamp,
    pagesProcessed: page,
    startDate,
    endDate
  };
}

export async function fetchCtmActivityDetails({ accountId, apiKey, apiSecret }, callId) {
  if (!accountId || !apiKey || !apiSecret) {
    throw new Error('CallTrackingMetrics credentials not configured.');
  }
  if (!callId) {
    throw new Error('CallTrackingMetrics call ID is required.');
  }

  const resp = await axios.get(`${CTM_BASE}/api/v1/accounts/${accountId}/calls/${encodeURIComponent(callId)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      Accept: 'application/json'
    },
    timeout: 30000
  });

  return resp.data?.data || resp.data || null;
}

export async function pullCallsFromCtm({
  ownerUserId = null,
  credentials,
  prompt = DEFAULT_AI_PROMPT,
  existingRows = [],
  autoStarEnabled = false,
  syncRatings = false,
  sinceTimestamp = null,
  fullSync = false,
  classifyOnlyAfter = null,
  enrichmentLookup = null,
  // Optional fallback lookup for call_ids not present in the page-scoped `existingRows`.
  // Without this, sync clobbers manual scores / category overrides on off-page rows
  // (the page-scoped existingRows only covers the calls the GET /calls handler
  // returned for display). hub.js / ctmAutoSync pass a DB-backed callback.
  findExistingByCallId = null
}) {
  const existingMap = new Map();
  existingRows.forEach((row) => {
    if (row && row.call_id) existingMap.set(row.call_id, row);
  });

  const fetchResult = await fetchCtmCalls(credentials, {
    sinceTimestamp,
    fullSync,
    perPage: 100,
    maxPages: 0 // Unlimited for full pagination
  });

  const rawCalls = fetchResult.calls || [];
  const limited = rawCalls.slice(0, MAX_CALLS);
  const results = [];
  let classified = 0;
  for (const raw of limited) {
    const callId = raw.id || raw.call_id || raw.sid || raw.uuid || raw.callSid || raw.callSid || raw.call_uuid || raw.callId;
    if (!callId) continue;
    // First-import 30-day classification window: when classifyOnlyAfter is set,
    // calls older than the cutoff get persisted (for analytics) but skip AI
    // classification — they fall through to the classification_pending=true branch.
    const rawStartedAt = raw.called_at || raw.start_time || raw.created_at || raw.timestamp || null;
    const startedAtDate = rawStartedAt ? new Date(rawStartedAt) : null;
    const isOutsideClassificationWindow = !!(
      classifyOnlyAfter &&
      startedAtDate &&
      !Number.isNaN(startedAtDate.getTime()) &&
      startedAtDate < classifyOnlyAfter
    );
    // Skip CTM's outbound staff-notification SMSes ("New Call from: +...").
    // They are system notifications, not lead activity, and were previously
    // being mis-classified as unanswered calls.
    const directionStr = String(raw.direction || '').toLowerCase();
    if (directionStr === 'msg_outbound' || directionStr.includes('outbound_msg') || directionStr.includes('outbound_sms')) {
      continue;
    }
    const stringId = String(callId);
    let existing = existingMap.get(stringId);
    if (!existing && findExistingByCallId) {
      try {
        const dbRow = await findExistingByCallId(stringId);
        if (dbRow) {
          existing = dbRow;
          existingMap.set(stringId, dbRow);
        } else {
          existingMap.set(stringId, null);
        }
      } catch (err) {
        console.error('[ctm:pullCalls] findExistingByCallId failed', { callId: stringId, err: err.message });
      }
    }
    const prevMeta = existing?.meta || {};

    // First-touch / existing-client enrichment lookup. Provided by hub.js so
    // pullCallsFromCtm doesn't need to import enrichCallerType directly.
    const lookupCallerNumber = getCallerNumber(raw);
    // Contact Entity Phase 2: resolve the contact FIRST so enrichment is contact-aware.
    // resolveContact never throws (returns null on failure). Runs on the pool.
    let contactId = null;
    try {
      contactId = await resolveContact({
        ownerUserId,
        phone: lookupCallerNumber,
        email: getCallerEmail(raw),
        name: getCallerName(raw),
        // Reactivate an archived contact only for a genuinely NEW call. `existing` means this
        // call_id was already imported, so re-syncing it must NOT un-archive (the poll re-runs
        // resolveContact over the whole window every cycle).
        reactivateArchived: !existing
      });
    } catch (e) {
      console.error('[ctm:pullCalls] resolveContact failed; contact_id=NULL', { code: e?.code });
    }
    let enrichment = null;
    if (enrichmentLookup && (lookupCallerNumber || contactId)) {
      try {
        enrichment = await enrichmentLookup({
          ownerUserId,
          callerNumber: lookupCallerNumber,
          callId: stringId,
          contactId
        });
      } catch (lookupErr) {
        console.error('[ctm:pullCalls] enrichmentLookup failed (conservative suppress)', { callId: stringId, err: lookupErr.message });
        // Treat as a returning caller for safety — over-suppress autostar + relay
        // rather than risk double-firing conversion events on a transient DB hiccup.
        // Manual review can adjust if needed.
        enrichment = { callerType: 'unknown', priorStarred: true, priorEngaged: true, recentlyQualified: true, firstStarredAt: null, lookupFailed: true };
      }
    }

    // Get score from CTM (this is the authoritative source for two-way sync)
    const ctmScore = raw.sale?.score || raw.score || 0;
    const dbScore = existing?.score || 0;

    // Check if CTM rating changed (for two-way sync)
    const ratingChangedInCtm = syncRatings && existing && ctmScore !== dbScore && ctmScore > 0;
    // Check if rating was removed (had rating before, now 0)
    const ratingWasRemoved = syncRatings && existing && dbScore > 0 && ctmScore === 0;

    // Use CTM score as authoritative when syncing ratings
    const existingScore = syncRatings ? ctmScore : dbScore || ctmScore;

    const transcript = getTranscript(raw);
    const message = buildMessage(raw);
    const isForm = isFormSubmission(raw);
    const formName = getFormName(raw);
    const stubMessage = isCtmStubMessage(message);
    const hasConversation = Boolean((transcript && transcript.trim()) || (!stubMessage && message && message.trim().length > 10));
    const unansweredLikely = isLikelyUnanswered(raw);
    const voicemailFlag = isVoicemail(raw);
    const hasClientCategoryOverride =
      String(prevMeta.category_source || '').toLowerCase() === 'client' && Boolean(prevMeta.semantic_category || prevMeta.category);
    let classification = prevMeta.classification || '';
    let summary = isUsableClassificationSummary(prevMeta.classification_summary) ? prevMeta.classification_summary : '';
    let reasoning = String(prevMeta.classification_reasoning || '').trim();
    let classificationDebug = null;
    let category = (hasClientCategoryOverride ? prevMeta.semantic_category || prevMeta.category : '') || prevMeta.semantic_category || prevMeta.category || 'unreviewed';
    let shouldAutoStar = false;

    // Check if lead already has a rating from CTM
    const hasExistingCtmRating = ctmScore > 0;
    const categoryFromRating = getCategoryFromRating(ctmScore);

    // Preserve semantic category separately from score. Only fall back to rating if this is a legacy row
    // with no usable semantic category yet.
    if ((!category || category === 'unreviewed') && hasExistingCtmRating && categoryFromRating) {
      category = categoryFromRating;
    } else if (ratingWasRemoved && (!category || category === 'unreviewed')) {
      category = 'unreviewed';
    }

    // Now handle classification and summary (AI analysis)
    if (isForm && !hasConversation) {
      const fallbackCategory = inferFormCategory(formName);
      classification = fallbackCategory;
      summary = summary || buildFormFallbackSummary(formName);
      if (!hasExistingCtmRating && !hasClientCategoryOverride) {
        category = fallbackCategory;
      }
    } else if (voicemailFlag && !voicemailHasMeaningfulContent(transcript)) {
      // Voicemail whose transcript is empty or contains only office menu audio
      // (caller hung up without speaking). No lead to classify — mark unanswered
      // so it lands in the right dashboard bucket without burning an AI call.
      classification = 'unanswered';
      summary = summary || 'Call reached voicemail with no actionable caller content.';
      if (!hasExistingCtmRating && !hasClientCategoryOverride) {
        category = 'unanswered';
      }
    } else if (unansweredLikely && !hasConversation) {
      classification = 'unanswered';
      summary = summary || 'Call was unanswered with no voicemail.';
      // Only set category if no CTM rating
      if (!hasExistingCtmRating && !hasClientCategoryOverride) {
        category = 'unanswered';
      }
    } else if (stubMessage && !transcript) {
      classification = 'neutral';
      summary = summary || 'Call logged from CTM metadata.';
      // Only set category if no CTM rating
      if (!hasExistingCtmRating && !hasClientCategoryOverride) {
        category = 'neutral';
      }
    } else if (hasConversation) {
      // Run AI classification if we don't have a REAL summary yet. A no-conversation stub
      // (set when this call was classified before its transcript arrived) must not block
      // re-classification now that a transcript exists — otherwise answered calls stay
      // mislabeled "unanswered." Treat such stubs as "no summary" so the AI re-runs.
      if ((!summary || isNoConversationStubSummary(summary)) && classified < CLASSIFY_LIMIT && !isOutsideClassificationWindow) {
        const ai = await classifyContent(prompt, transcript, message, { source: isForm ? 'form' : 'call' });
        classification = ai.classification;
        summary = ai.summary;
        reasoning = ai.reasoning || reasoning;
        classificationDebug = ai.debug || classificationDebug;
        if (!hasClientCategoryOverride) {
          category = ai.category;
        }
        if (!hasExistingCtmRating && !hasClientCategoryOverride) {
          shouldAutoStar = true; // Only eligible for auto-star if no existing rating
        }
        classified += 1;
      } else if (!classification) {
        classification = 'unreviewed';
        category = category || 'unreviewed';
        // No fake summary — leave blank so the row is genuinely "pending classification."
        // Tracked via meta.classification_pending so the UI can render "Pending Review"
        // and a backfill job can resume processing.
      }
    }

    // A row is "pending classification" whenever it landed at category=unreviewed
    // without a usable summary. Previously this only triggered when classification
    // was literally 'unreviewed', which missed the no-content fall-through (a row
    // that doesn't match any branch keeps classification='' and category='unreviewed'
    // — pending in spirit, but invisible to the backfill drain). Keying off the
    // final category instead captures both cap-overflow and fall-through cases.
    const classificationPending = (category === 'unreviewed' || !category) && !summary;

    // Voicemails where the caller left real content expressing interest in the
    // business should always surface as needs_attention — they can be forgotten
    // easily if buried in the lead/warm bucket alongside answered calls.
    if (!hasClientCategoryOverride && voicemailFlag && hasConversation && !hasExistingCtmRating && (category === 'warm' || category === 'very_good' || category === 'very_hot')) {
      category = 'needs_attention';
    }

    const semanticCategory = category;
    const ratingCategory = hasExistingCtmRating ? categoryFromRating : null;
    const categorySource = hasClientCategoryOverride ? 'client' : 'ai';
    const categorySourceDetail = hasClientCategoryOverride ? prevMeta.category_source_detail || 'dashboard_manual' : 'ctm_sync';
    const isReferral = isReferralContext(`${transcript}\n${message}\n${summary}`);
    const systemTags = buildSystemTags({ semanticCategory, isReferral, categorySource, enrichment });

    // Track voicemail callbacks separately even when the category already reflects urgency.
    const requiresCallback = shouldRequireCallback({ isVoicemail: voicemailFlag, category, hasExistingCtmRating });

    // Determine final score — NEVER overwrite existing CTM ratings. Decoupled
    // from the classify cycle: computeAutoStar runs every sync so a qualified,
    // unrated, non-suppressed call heals even when its summary is already real.
    const autoStar = computeAutoStar({
      category,
      existingScore,
      hasCtmRating: hasExistingCtmRating,
      enrichment: enrichment || {},
      categorySource: hasClientCategoryOverride ? 'client' : 'ai',
      alreadyApplied: Boolean(prevMeta.auto_star_applied_at)
    });
    let finalScore = existingScore;
    let autoStarAppliedAt = prevMeta.auto_star_applied_at || null;
    if (autoStarEnabled && autoStar.apply) {
      finalScore = autoStar.score;
      // NOTE: autoStarAppliedAt is intentionally NOT stamped here.
      // The marker is written only after a successful CTM post (in the sync
      // callers), so a transient CTM failure leaves the row un-marked and the
      // next sync self-heals by re-applying the score and retrying the post.
    }
    if (autoStarEnabled && !autoStar.apply && (autoStar.reason === 'active_client' || autoStar.reason === 'recently_qualified')) {
      logAiClassificationDebug('autostar:suppressed_first_touch', {
        callId: stringId,
        callerNumber: lookupCallerNumber || null,
        callerType: enrichment?.callerType,
        reason: autoStar.reason,
        firstStarredAt: enrichment?.firstStarredAt
      });
    }

    const { timestampMs, unixTime, startedAtIso } = parseTimestamp(raw);
    const source = getSource(raw);
    const assets = extractAssets(raw);
    const callData = {
      id: stringId,
      name: getCallerName(raw) || `Call ${stringId}`,
      source,
      source_key: sanitizeSourceKey(source),
      call_time: timestampMs ? formatDate(timestampMs) : '',
      timestamp: timestampMs || null,
      unix_time: unixTime || null,
      caller_name: getCallerName(raw),
      caller_number: getCallerNumber(raw),
      caller_email: getCallerEmail(raw),
      to_number: getToNumber(raw),
      region: buildRegion(raw),
      transcript,
      message,
      transcript_url: buildTranscriptUrl(unixTime),
      recording_url: assets[0]?.url || raw.recording_url || '',
      direction: (raw.direction || '').toLowerCase(),
      activity_type: determineActivityType(raw),
      classification,
      classification_summary: summary || '',
      classification_reasoning: reasoning || '',
      classification_pending: classificationPending,
      category: semanticCategory,
      semantic_category: semanticCategory,
      rating_category: ratingCategory,
      category_source: categorySource,
      category_source_detail: categorySourceDetail,
      is_voicemail: voicemailFlag,
      requires_callback: requiresCallback,
      is_referral: isReferral,
      system_tags: systemTags,
      assets,
      duration_sec: getDuration(raw),
      started_at: startedAtIso,
      score: finalScore,
      auto_star_applied_at: autoStarAppliedAt,
      form_name: formName || null
    };
    logAiClassificationDebug('ctm_sync:decision', {
      callId: stringId,
      sourceType: isForm ? 'form' : 'call',
      source,
      semanticCategory,
      classification,
      summary,
      reasoning,
      score: finalScore,
      hasExistingCtmRating,
      voicemailFlag,
      requiresCallback,
      isReferral,
      systemTags
    });
    if (ownerUserId) {
      await logAiClassificationEvent({
        ownerUserId,
        callId: stringId,
        stage: 'ctm_sync',
        sourceType: isForm ? 'form' : 'call',
        activityType: determineActivityType(raw),
        provider: 'ctm',
        model: classified > 0 ? (process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null) : null,
        finalCategory: semanticCategory,
        classification,
        score: finalScore,
        isReferral,
        requiresCallback,
        systemTags,
        adjustments: Array.isArray(classificationDebug?.adjustments) ? classificationDebug.adjustments : [],
        input: transcript || message || '',
        prompt: classificationDebug?.prompt || prompt,
        rawResponse: classificationDebug?.rawResponse || '',
        summary,
        reasoning,
        metadata: {
          source,
          hasExistingCtmRating,
          voicemailFlag,
          categorySource,
          categorySourceDetail,
          startedAt: startedAtIso,
          inputLength: classificationDebug?.inputLength || (transcript || message || '').length,
          parsedCategory: classificationDebug?.parsedCategory || classification,
          debugSource: classificationDebug?.source || (isForm ? 'form' : 'call')
        }
      });
    }
    results.push({
      call: callData,
      meta: { ...callData },
      // Post to CTM when computeAutoStar decided to apply (implies no existing rating,
      // not suppressed, and once-marker not yet set). autoStarEnabled gates the feature.
      shouldPostScore: autoStarEnabled && autoStar.apply && finalScore > 0,
      notifyNeedsAttention: requiresCallback && shouldAutoStar,
      isRatingUpdate: ratingChangedInCtm,
      isNew: !existing,
      hadExistingRating: hasExistingCtmRating,
      // Pass enrichment through so callers (hub.js sync paths) can reuse it
      // instead of calling enrichCallerType a second time per row.
      _enrichment: enrichment ?? null,
      _contactId: contactId ?? null
    });
  }

  return {
    results,
    syncMeta: {
      latestTimestamp: fetchResult.latestTimestamp,
      pagesProcessed: fetchResult.pagesProcessed,
      startDate: fetchResult.startDate,
      endDate: fetchResult.endDate,
      totalFetched: rawCalls.length,
      processedCount: results.length
    }
  };
}

function isLikelyUnanswered(raw = {}) {
  if (isFormSubmission(raw)) return false;
  // 'unanswered' is a call-only concept. Skip for SMS/email/other activities —
  // they're always duration=0 and would otherwise all be mis-tagged unanswered.
  const directionStr = String(raw.direction || raw.type || raw.channel || '').toLowerCase();
  if (directionStr.includes('msg') || directionStr.includes('sms') || directionStr.includes('email')) {
    return false;
  }
  const duration = Number(raw.duration) || Number(raw.duration_sec) || Number(raw.talk_time) || Number(raw.time_on_phone) || 0;
  const statusString = [raw.status, raw.result, raw.call_status, raw.callResult].filter(Boolean).join(' ').toLowerCase();
  if (duration === 0 && statusString.includes('voicemail')) {
    return false;
  }
  if (
    duration === 0 ||
    statusString.includes('missed') ||
    statusString.includes('unanswered') ||
    statusString.includes('no answer') ||
    statusString.includes('busy')
  ) {
    return true;
  }
  if (Array.isArray(raw.actions)) {
    return raw.actions.some((action) => {
      const value = `${action?.event || ''} ${action?.name || ''}`.toLowerCase();
      return value.includes('missed') || value.includes('unanswered') || value.includes('no answer');
    });
  }
  return false;
}

function isVoicemail(raw = {}) {
  const statusString = [raw.status, raw.result, raw.call_status, raw.callResult, raw.direction].filter(Boolean).join(' ').toLowerCase();
  if (statusString.includes('voicemail') || statusString.includes('voice mail')) return true;
  if (Array.isArray(raw.actions)) {
    return raw.actions.some((action) => {
      const value = `${action?.event || ''} ${action?.name || ''}`.toLowerCase();
      return value.includes('voicemail') || value.includes('voice mail');
    });
  }
  return false;
}

function isCtmStubMessage(text = '') {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith('new call from:') ||
    normalized.startsWith('repeat call from:') ||
    normalized.startsWith('caller transcript:') ||
    normalized.startsWith('call from:') ||
    normalized.startsWith('website visitor') ||
    normalized === 'website'
  );
}

// Extracts meaningful caller speech from a CTM transcript, stripping office/menu
// lines. Transcript format is typically "<speaker>: <text>" with one line per
// utterance. Office lines prefix with the practice phone number (e.g.
// "+16022078832: Thank you for calling..."), caller lines prefix with a name.
//
// When a caller dials in, sits through the automated menu, and hangs up without
// speaking, the transcript captures the full menu audio but has no actual
// caller content. Those voicemails should be treated as "unanswered" — there
// is no real lead to classify.
export function extractMeaningfulCallerContent(transcript = '') {
  if (!transcript) return '';
  const lines = String(transcript).split('\n').map((l) => l.trim()).filter(Boolean);
  const callerParts = [];
  for (const line of lines) {
    // Office/system lines start with + followed by phone-number digits.
    if (/^\+\d{7,}/.test(line)) continue;
    // Strip "SPEAKER:" prefix to get the raw speech.
    const match = line.match(/^[^:]{1,60}:\s*(.*)$/);
    const text = (match ? match[1] : line).trim();
    if (text) callerParts.push(text);
  }
  const joined = callerParts.join(' ');
  // Remove common menu/system echoes that occasionally appear on caller lines
  // (e.g. when Twilio's ASR misattributes the menu prompt).
  const cleaned = joined
    .replace(/thank you for calling[^.!?\n]*/gi, '')
    .replace(/our office is currently closed[^.!?\n]*/gi, '')
    .replace(/our office is (?:now )?closed[^.!?\n]*/gi, '')
    .replace(/our business hours[^.!?\n]*/gi, '')
    .replace(/our hours(?: of operation)?[^.!?\n]*/gi, '')
    .replace(/for (?:our )?hours (?:and|or) location[^.!?\n]*/gi, '')
    .replace(/for hours and location[^.!?\n]*/gi, '')
    .replace(/for location and hours[^.!?\n]*/gi, '')
    .replace(/please leave a (?:general )?(?:message|name and number)[^.!?\n]*/gi, '')
    .replace(/if you would like to leave[^.!?\n]*/gi, '')
    .replace(/patient care coordinator[^.!?\n]*/gi, '')
    .replace(/return your call during regular business hours[^.!?\n]*/gi, '')
    .replace(/during regular business hours[^.!?\n]*/gi, '')
    .replace(/if you are a patient of record[^.!?\n]*/gi, '')
    .replace(/if this is (?:a )?(?:medical|dental) emergency[^.!?\n]*/gi, '')
    .replace(/if you are experiencing[^.!?\n]*emergency[^.!?\n]*/gi, '')
    .replace(/you will be connected to our doctor on call[^.!?\n]*/gi, '')
    .replace(/doctor on call[^.!?\n]*/gi, '')
    .replace(/please listen carefully[^.!?\n]*/gi, '')
    .replace(/to repeat this menu[^.!?\n]*/gi, '')
    .replace(/dial (?:by )?(?:name|extension)[^.!?\n]*/gi, '')
    .replace(/record your message at the tone[^.!?\n]*/gi, '')
    .replace(/press \d[^.!?\n]*/gi, '')
    .replace(/your call has been forwarded[^.!?\n]*/gi, '')
    .replace(/we appreciate your patience[^.!?\n]*/gi, '')
    .replace(/an associate will be with you[^.!?\n]*/gi, '')
    .replace(/\bhello\??(\s+hello\??)*\b/gi, '')
    .replace(/[.?!,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

// Returns true when a voicemail transcript contains enough real caller speech
// to be worth classifying. Menu-only transcripts fall below this bar.
function voicemailHasMeaningfulContent(transcript = '') {
  return extractMeaningfulCallerContent(transcript).length >= 25;
}

const AUTOMATED_MENU_PATTERNS = [
  /thank you for calling/i,
  /our office is (?:currently |now )?closed/i,
  /our (?:business )?hours/i,
  /hours (?:and|or) location/i,
  /\bpress\s+\d\b/i,
  /leave a (?:general )?message/i,
  /patient care coordinator/i,
  /regular business hours/i,
  /patient of record/i,
  /(?:medical|dental) emergency/i,
  /doctor on call/i,
  /please listen carefully/i,
  /repeat this menu/i,
  /dial (?:by )?(?:name|extension)/i
];

function looksLikeAutomatedMenuOnlyTranscript(transcript = '') {
  const normalized = String(transcript || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;

  const cleanedCallerContent = extractMeaningfulCallerContent(transcript);
  const cleanedWordCount = cleanedCallerContent ? (cleanedCallerContent.match(/[a-z0-9']+/gi) || []).length : 0;
  const menuHits = AUTOMATED_MENU_PATTERNS.reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);

  return menuHits >= 3 && cleanedWordCount < 5;
}

export function buildCallsFromCache(rows = []) {
  return rows
    .map((row) => {
      if (!row.call_id) return null;
      const meta = row.meta || {};
      const durationSec = row.duration_sec || meta.duration_sec || 0;
      const direction = row.direction || meta.direction || 'inbound';
      const startedAt = row.started_at || meta.started_at;

      // Format duration as human-readable string
      const formatDuration = (seconds) => {
        if (!seconds || seconds < 1) return '0s';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
      };

      // Calculate time ago for relative timestamps
      const getTimeAgo = (timestamp) => {
        if (!timestamp) return null;
        const now = Date.now();
        const then = new Date(timestamp).getTime();
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
        return `${Math.floor(diffDays / 30)}mo ago`;
      };

      return {
        ...meta,
        id: row.call_id,
        row_id: row.id,
        provider: row.provider || meta.provider || 'ctm',
        hidden_at: row.hidden_at || null,
        rating: row.score || 0,
        caller_type: row.caller_type || meta.callerType || 'new',
        active_client_id: row.active_client_id || meta.activeClientId || null,
        contact_id: row.contact_id || null,
        call_sequence: row.call_sequence || meta.callSequence || 1,
        active_client: meta.activeClient || null,
        previous_calls: meta.previousCalls || [],
        duration_sec: durationSec,
        duration_formatted: formatDuration(durationSec),
        direction: direction,
        is_inbound: direction === 'inbound' || direction === 'in',
        started_at: startedAt,
        time_ago: getTimeAgo(startedAt),
        from_number: row.from_number || meta.caller_number || null,
        to_number: row.to_number || meta.to_number || null,
        transcript: meta.transcript_encrypted ? decrypt(meta.transcript_encrypted) : (meta.transcript || null),
        transcript_url: meta.transcript_url || null,
        recording_url: meta.recording_url || meta.assets?.[0]?.url || null,
        message: meta.message || null,
        form_name: meta.form_name || row.form_name || null,
        has_previous_journey: row.has_previous_journey === true || row.has_previous_journey === 't'
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * Posts a sale/score to CallTrackingMetrics for a specific call
 * This marks the call as starred/scored in the CTM dashboard
 *
 * @param {Object} credentials - CTM API credentials { accountId, apiKey, apiSecret }
 * @param {string} callId - The CTM call ID
 * @param {Object} saleData - Sale data to post { score, conversion, value, sale_date }
 * @returns {Promise<Object>} Response from CTM API
 */
export async function postSaleToCTM(credentials, callId, saleData = {}) {
  const { accountId, apiKey, apiSecret } = credentials;

  if (!accountId || !apiKey || !apiSecret) {
    throw new Error('CallTrackingMetrics credentials not configured.');
  }

  if (!callId) {
    throw new Error('Missing call ID for CTM sale posting.');
  }

  const url = `${CTM_BASE}/api/v1/accounts/${encodeURIComponent(accountId)}/calls/${encodeURIComponent(callId)}/sale`;

  const payload = {
    score: saleData.score || 5,
    conversion: saleData.conversion !== undefined ? saleData.conversion : 1,
    value: saleData.value || 0,
    sale_date: saleData.sale_date || new Date().toISOString().slice(0, 10)
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
      },
      timeout: 20000
    });

    return response.data;
  } catch (err) {
    const status = err.response?.status || 500;
    const errorData = err.response?.data;
    const message = errorData?.message || errorData?.error || err.message || 'Failed to update CallTrackingMetrics sale';

    console.error('[ctm:postSale] Failed to post sale to CTM', {
      callId,
      status,
      error: message,
      payload
    });

    // Re-throw with more context
    const error = new Error(`CTM API Error (${status}): ${message}`);
    error.status = status;
    error.data = errorData;
    throw error;
  }
}

export async function fetchPhoneInteractionSources(credentials, phoneNumber, perPage = 100, maxPages = 5) {
  const { accountId, apiKey, apiSecret } = credentials || {};
  if (!accountId || !apiKey || !apiSecret || !phoneNumber) return [];
  const normalized = String(phoneNumber).replace(/[^\d+]/g, '');
  const sources = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const resp = await axios.get(`${CTM_BASE}/api/v1/accounts/${encodeURIComponent(accountId)}/calls`, {
      params: {
        per_page: perPage,
        page,
        order: 'desc',
        caller_number: normalized
      },
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        Accept: 'application/json'
      },
      timeout: 20000
    });
    const payload = Array.isArray(resp.data?.data?.calls)
      ? resp.data.data.calls
      : Array.isArray(resp.data?.calls)
        ? resp.data.calls
        : Array.isArray(resp.data?.data)
          ? resp.data.data
          : [];
    if (!payload.length) break;
    payload.forEach((entry) => {
      const src = getSource(entry);
      if (src) sources.add(src);
    });
    if (payload.length < perPage) break;
  }
  return Array.from(sources);
}

/**
 * Enrich a call with caller type based on phone number
 * Determines if caller is: new, repeat, or returning_customer
 * @param {Object} db - Database query function
 * @param {string} userId - Owner user ID
 * @param {string} phoneNumber - Caller's phone number
 * @param {string} currentCallId - Current call's ID (to exclude from count)
 * @returns {Object} { callerType, activeClientId, callSequence, previousCalls }
 */
export async function enrichCallerType(query, userId, phoneNumber, currentCallId = null, contactId = null) {
  const normalized = phoneNumber ? normalizePhoneNumber(phoneNumber) : null;
  const phoneUsable = !!(normalized && normalized.length >= 7);
  // Need at least one identity key. Contact-only rows (no usable phone) still match by contact.
  if (!phoneUsable && !contactId) {
    return { callerType: 'new', activeClientId: null, journeyId: null, callSequence: 1, previousCalls: [], priorStarred: false, priorEngaged: false, recentlyQualified: false, firstStarredAt: null };
  }

  // contactCol must be qualified when the query joins another table that also has a
  // contact_id (e.g. the journey lookup joins active_clients) — otherwise Postgres errors
  // with "column reference contact_id is ambiguous" and the whole enrichment falls back.
  const matchSql = (phoneCol, contactCol = 'contact_id') => {
    const parts = [];
    if (phoneUsable) parts.push(`REGEXP_REPLACE(${phoneCol}, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')`);
    if (contactId) parts.push(`${contactCol} = $3`);
    return parts.join(' OR ');
  };

  // 1. Check active_clients for exact phone match or contact_id match (active clients = current customers)
  const clientResult = await query(
    `SELECT id, client_name, client_email, status
     FROM active_clients
     WHERE owner_user_id = $1 AND (${matchSql('client_phone')})
     ORDER BY archived_at NULLS FIRST, created_at DESC
     LIMIT 1`,
    [userId, normalized, contactId]
  );

  // 2. Check client_journeys for phone or contact_id match (both active and archived journeys)
  const journeyResult = await query(
    `SELECT cj.id, cj.client_name, cj.client_phone, cj.status, cj.archived_at,
            ac.id as active_client_id, ac.client_name as active_client_name
     FROM client_journeys cj
     LEFT JOIN active_clients ac ON cj.active_client_id = ac.id
     WHERE cj.owner_user_id = $1 AND (${matchSql('cj.client_phone', 'cj.contact_id')})
     ORDER BY cj.archived_at NULLS FIRST, cj.created_at DESC
     LIMIT 1`,
    [userId, normalized, contactId]
  );

  // Previous activity under this owner, matched by contact_id OR phone. Reused by the
  // preview list and the first-touch stats so callSequence/priorStarred/priorEngaged
  // are computed across ALL of the contact's numbers.
  const idMatch = [];
  if (phoneUsable) idMatch.push(`REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')`);
  if (contactId) idMatch.push(`contact_id = $3`);
  let callFilter = `owner_user_id = $1 AND (${idMatch.join(' OR ')})`;
  const params = [userId, normalized, contactId];

  if (currentCallId) {
    callFilter += ` AND call_id != $${params.length + 1}`;
    params.push(currentCallId);
  }

  const previousCallsResult = await query(
    `SELECT call_id, started_at, score, meta->>'classification' as classification,
            meta->>'category' as category,
            meta->>'classification_summary' as summary
     FROM call_logs
     WHERE ${callFilter}
     ORDER BY started_at DESC
     LIMIT 10`,
    params
  );

  // First-touch attribution signals must inspect the full caller history under
  // the owner, not just the 10-row preview list we return for the UI.
  const ENGAGED_PRIOR_CATEGORIES = ['warm', 'very_good', 'good', 'hot', 'very_hot', 'needs_attention', 'converted'];
  // recently_qualified: caller has a prior 3★+ activity within the last 6 months.
  // This is the gate for autostar + ad-platform relay suppression. Earlier rules
  // also tripped on any score>1 (incl. 2★ not_a_fit/applicant/spam) — too loose.
  // Now: previously-spam / not-a-fit callers who come back qualified CAN auto-star.
  const previousCallStatsResult = await query(
    `SELECT
        COUNT(*)::int AS total_previous_calls,
        BOOL_OR(COALESCE(score, 0) > 1) AS prior_starred,
        BOOL_OR(COALESCE(meta->>'category', meta->>'classification') = ANY($${params.length + 1}::text[])) AS prior_engaged,
        BOOL_OR(COALESCE(score, 0) >= 3 AND started_at >= NOW() - INTERVAL '6 months') AS recently_qualified,
        MIN(started_at) FILTER (WHERE COALESCE(score, 0) > 1 AND started_at IS NOT NULL) AS first_starred_at
     FROM call_logs
     WHERE ${callFilter}`,
    [...params, ENGAGED_PRIOR_CATEGORIES]
  );

  const previousCalls = previousCallsResult?.rows || [];
  const priorStats = previousCallStatsResult?.rows?.[0] || {};
  const callSequence = Number(priorStats.total_previous_calls || 0) + 1;
  const priorStarred = Boolean(priorStats.prior_starred);
  const priorEngaged = Boolean(priorStats.prior_engaged);
  const recentlyQualified = Boolean(priorStats.recently_qualified);
  const firstStarredAt = priorStats.first_starred_at ? new Date(priorStats.first_starred_at) : null;

  // 4. Determine caller type based on matches
  const activeClient = clientResult?.rows?.[0];
  const journey = journeyResult?.rows?.[0];

  // Active client takes priority (they're a current customer)
  if (activeClient && !activeClient.archived_at) {
    return {
      callerType: 'active_client',
      activeClientId: activeClient.id,
      activeClient,
      journeyId: journey?.id || null,
      callSequence,
      previousCalls,
      priorStarred,
      priorEngaged,
      recentlyQualified,
      firstStarredAt
    };
  }

  // Has a journey (active or archived) = returning customer
  if (journey) {
    return {
      callerType: journey.archived_at ? 'returning_customer' : 'active_client',
      activeClientId: journey.active_client_id || activeClient?.id || null,
      activeClient: activeClient || null,
      journeyId: journey.id,
      journey,
      callSequence,
      previousCalls,
      priorStarred,
      priorEngaged,
      recentlyQualified,
      firstStarredAt
    };
  }

  // Archived active client = returning customer
  if (activeClient?.archived_at) {
    return {
      callerType: 'returning_customer',
      activeClientId: activeClient.id,
      activeClient,
      journeyId: null,
      callSequence,
      previousCalls,
      priorStarred,
      priorEngaged,
      recentlyQualified,
      firstStarredAt
    };
  }

  // Has previous calls but no journey/client = repeat caller
  if (previousCalls.length > 0) {
    return {
      callerType: 'repeat',
      activeClientId: null,
      journeyId: null,
      callSequence,
      previousCalls,
      priorStarred,
      priorEngaged,
      recentlyQualified,
      firstStarredAt
    };
  }

  return {
    callerType: 'new',
    activeClientId: null,
    journeyId: null,
    callSequence: 1,
    previousCalls: [],
    priorStarred: false,
    priorEngaged: false,
    recentlyQualified: false,
    firstStarredAt: null
  };
}

/**
 * Get all journeys for an active client
 * @param {Function} query - Database query function
 * @param {string} activeClientId - Active client UUID
 * @returns {Array} List of journeys with service info
 */
export async function getClientJourneys(query, activeClientId) {
  if (!activeClientId) return [];

  const result = await query(
    `SELECT cj.*, s.name as service_name, s.description as service_description
     FROM client_journeys cj
     LEFT JOIN services s ON cj.service_id = s.id
     WHERE cj.active_client_id = $1 
       AND (cj.archived_at IS NULL OR cj.archived_at > NOW())
     ORDER BY cj.created_at DESC`,
    [activeClientId]
  );

  return result?.rows || [];
}

/**
 * Resolve CTM credentials from a client_profiles DB row.
 * Agency-level env vars are the primary credential source
 * (CTM_API_KEY / CTM_API_SECRET) so clients only need ctm_account_number set.
 * Per-client keys are treated as a legacy fallback when the agency pair
 * is unavailable.
 *
 * Returns { accountId, apiKey, apiSecret } or null if no credentials available.
 */
export function resolveCtmCreds(row) {
  const agencyApiKey = process.env.CTM_API_KEY || null;
  const agencyApiSecret = process.env.CTM_API_SECRET || null;

  if (agencyApiKey && agencyApiSecret) {
    if (!row?.ctm_account_number) {
      console.warn('[ctm:creds] Agency keys in use but no ctm_account_number set — CTM calls will lack account isolation');
    }
    return { accountId: row?.ctm_account_number || null, apiKey: agencyApiKey, apiSecret: agencyApiSecret };
  }

  // Legacy fallback: if the agency pair is unavailable, try the stored
  // per-client pair. Both fields must decrypt successfully or we abort.
  let apiKey = null;
  let apiSecret = null;
  let decryptedKey = null;
  let decryptedSecret = null;

  if (row?.ctm_api_key) {
    decryptedKey = decrypt(row.ctm_api_key);
    if (!decryptedKey) {
      console.warn('[ctm:creds] Per-client ctm_api_key decryption failed. Account:', row.ctm_account_number || 'unknown');
      logSecurityEvent({
        eventType: 'ctm_credential_decryption_failure',
        eventCategory: 'integration',
        success: false,
        failureReason: 'ctm_api_key decryption returned null',
        details: { account: row.ctm_account_number ? `***${String(row.ctm_account_number).slice(-4)}` : 'unknown', field: 'ctm_api_key' }
      }).catch(() => {});
    }
  }
  if (row?.ctm_api_secret) {
    decryptedSecret = decrypt(row.ctm_api_secret);
    if (!decryptedSecret) {
      console.warn('[ctm:creds] Per-client ctm_api_secret decryption failed. Account:', row.ctm_account_number || 'unknown');
      logSecurityEvent({
        eventType: 'ctm_credential_decryption_failure',
        eventCategory: 'integration',
        success: false,
        failureReason: 'ctm_api_secret decryption returned null',
        details: { account: row.ctm_account_number ? `***${String(row.ctm_account_number).slice(-4)}` : 'unknown', field: 'ctm_api_secret' }
      }).catch(() => {});
    }
  }

  // Use the per-client pair only if BOTH decrypted successfully.
  if (decryptedKey && decryptedSecret) {
    apiKey = decryptedKey;
    apiSecret = decryptedSecret;
  }

  if (!apiKey || !apiSecret) return null;

  return { accountId: row?.ctm_account_number || null, apiKey, apiSecret };
}

// ---------------------------------------------------------------------------
// Ops collector helpers — DB-backed, no PHI in return values
// ---------------------------------------------------------------------------

/**
 * List a client's Twilio tracking numbers from the local DB.
 *
 * Returns rows with at minimum: id, formatted_number (derived from phone_number),
 * status ('active' | 'inactive'), last_error (always null — not stored).
 *
 * Note: The app stores tracking numbers in `twilio_tracking_numbers`, not a
 * CTM-specific table.  `is_active` maps to status; there is no last_error column.
 */
export async function listTrackingNumbers({ clientUserId }) {
  const result = await _dbQuery(
    `SELECT id, phone_number, friendly_name, is_active, source_type, campaign_name
     FROM twilio_tracking_numbers
     WHERE client_user_id = $1
     ORDER BY created_at ASC`,
    [clientUserId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    formatted_number: r.friendly_name || r.phone_number,
    phone_number: r.phone_number,
    status: r.is_active ? 'active' : 'inactive',
    last_error: null
  }));
}

/**
 * Count call_logs rows linked to a specific tracking number in the last N days.
 *
 * Uses tracking_number_id FK when available; falls back to matching to_number
 * (phone_number) for calls imported before the FK was added.
 */
export async function getNumberCallCount({ clientUserId, numberId, days }) {
  // First resolve the phone_number for the fallback join path.
  const numRow = await _dbQuery(
    `SELECT phone_number FROM twilio_tracking_numbers WHERE id = $1 AND client_user_id = $2`,
    [numberId, clientUserId]
  );
  if (!numRow.rows.length) return 0;
  const phoneNumber = numRow.rows[0].phone_number;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await _dbQuery(
    `SELECT COUNT(*) AS cnt
     FROM call_logs
     WHERE owner_user_id = $1
       AND started_at >= $2
       AND (tracking_number_id = $3 OR to_number = $4)`,
    [clientUserId, since, numberId, phoneNumber]
  );
  return parseInt(result.rows[0]?.cnt || '0', 10);
}

/**
 * Liveness probe for the agency CTM API key. Cheap account list; validates the
 * agency Basic-auth credential without touching any client sub-account data.
 * Returns { ok, status }. Throws on network error; non-2xx surfaces via status.
 */
export async function pingCtm() {
  // Agency-level CTM creds — same vars the real sync uses (see agencyApiKey above).
  const apiKey = process.env.CTM_API_KEY;
  const apiSecret = process.env.CTM_API_SECRET;
  if (!apiKey || !apiSecret) return { ok: false, status: 0, reason: 'CTM creds not configured' };
  const resp = await axios.get(`${CTM_BASE}/api/v1/accounts`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      Accept: 'application/json'
    },
    params: { per_page: 1 },
    timeout: 15000,
    validateStatus: () => true
  });
  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status };
}
