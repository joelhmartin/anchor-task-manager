/**
 * CTM FormReactor Integration Service
 *
 * Manages CTM FormReactor lifecycle: list, create, submit, and custom field sync.
 * Uses the same Basic auth pattern as the existing ctm.js service.
 */

import axios from 'axios';

const CTM_BASE = process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function authHeaders({ apiKey, apiSecret }) {
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

// ---------------------------------------------------------------------------
// FormReactor CRUD
// ---------------------------------------------------------------------------

/**
 * List all FormReactors for an account.
 */
export async function listFormReactors({ accountId, apiKey, apiSecret }) {
  const resp = await axios.get(
    `${CTM_BASE}/api/v1/accounts/${accountId}/form_reactors`,
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );
  return resp.data?.form_reactors || resp.data || [];
}

/**
 * Get a specific FormReactor by ID.
 */
export async function getFormReactor({ accountId, apiKey, apiSecret }, reactorId) {
  const resp = await axios.get(
    `${CTM_BASE}/api/v1/accounts/${accountId}/form_reactors/${reactorId}`,
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );
  return resp.data;
}

/**
 * Create a new FormReactor from form schema.
 *
 * @param {object} credentials - { accountId, apiKey, apiSecret }
 * @param {object} config - { name, trackingNumberId?, fields[], includeEmail, includeName }
 * @returns {object} Created reactor with ID
 */
export async function createFormReactor({ accountId, apiKey, apiSecret }, config) {
  const {
    name,
    trackingNumberId,
    fields = [],
    includeEmail = true,
    includeName = true,
    emailRequired = false,
    nameRequired = false
  } = config;

  // Build custom fields array from non-core fields
  const customFields = fields
    .filter((f) => !['caller_name', 'name', 'full_name', 'fullname', 'email', 'phone', 'phone_number'].includes(f.name))
    .filter((f) => !['heading', 'paragraph', 'divider', 'score_display', 'hidden'].includes(f.type))
    .map((f) => ({
      name: f.name,
      type: mapFieldTypeToCtm(f.type),
      required: f.required || false
    }));

  const body = {
    name,
    include_email: includeEmail,
    email_required: emailRequired,
    include_name: includeName,
    name_required: nameRequired,
    custom_fields: customFields
  };

  if (trackingNumberId) {
    body.tracking_number_id = trackingNumberId;
  }

  const resp = await axios.post(
    `${CTM_BASE}/api/v1/accounts/${accountId}/form_reactors`,
    body,
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );

  return resp.data;
}

/**
 * Submit form data to a CTM FormReactor.
 *
 * This is the core function that pushes form submissions into CTM.
 *
 * @param {object} credentials - { accountId, apiKey, apiSecret }
 * @param {string} reactorId - CTM FormReactor ID
 * @param {object} formData - Submission data to send
 * @returns {object} CTM response with trackback_id
 */
export async function submitToFormReactor({ accountId, apiKey, apiSecret }, reactorId, formData) {
  const {
    callerName,
    email,
    phoneNumber,
    countryCode = '1',
    customFields = {},
    attribution = {}
  } = formData;

  // Build flat payload (CTM expects top-level keys, no nesting)
  const body = {};

  if (callerName) body.caller_name = callerName;
  if (email) body.email = email;
  if (phoneNumber) body.phone_number = phoneNumber;
  if (countryCode) body.country_code = countryCode;

  // Add custom fields with custom_ prefix
  for (const [key, value] of Object.entries(customFields)) {
    const prefixedKey = key.startsWith('custom_') ? key : `custom_${key}`;
    // Flatten arrays (multi-select checkboxes)
    body[prefixedKey] = Array.isArray(value) ? value.join(', ') : value;
  }

  // Add attribution data (CTM uses these for source tracking)
  if (attribution.visitor_sid) body.visitor_sid = attribution.visitor_sid;
  if (attribution.referrer) body.referrer = attribution.referrer;
  if (attribution.landing_url) body.landing_url = attribution.landing_url;
  if (attribution.utm_source) body.utm_source = attribution.utm_source;
  if (attribution.utm_medium) body.utm_medium = attribution.utm_medium;
  if (attribution.utm_campaign) body.utm_campaign = attribution.utm_campaign;
  if (attribution.utm_term) body.utm_term = attribution.utm_term;
  if (attribution.utm_content) body.utm_content = attribution.utm_content;
  if (attribution.gclid) body.gclid = attribution.gclid;
  if (attribution.fbclid) body.fbclid = attribution.fbclid;
  if (attribution.msclkid) body.msclkid = attribution.msclkid;

  // Server-side attribution
  if (attribution.visitor_ip) body.visitor_ip = attribution.visitor_ip;
  if (attribution.user_agent) body.user_agent = attribution.user_agent;

  const resp = await axios.post(
    `${CTM_BASE}/api/v1/formreactor/${reactorId}`,
    body,
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );

  return resp.data;
}

// ---------------------------------------------------------------------------
// Custom Fields
// ---------------------------------------------------------------------------

/**
 * List account-level custom fields.
 */
export async function listCustomFields({ accountId, apiKey, apiSecret }) {
  const resp = await axios.get(
    `${CTM_BASE}/api/v1/accounts/${accountId}/custom_fields.json`,
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );
  return resp.data?.custom_fields || resp.data || [];
}

/**
 * Register a custom field at the account level (makes it searchable/filterable).
 */
export async function syncCustomField({ accountId, apiKey, apiSecret }, fieldDef) {
  const resp = await axios.post(
    `${CTM_BASE}/api/v1/accounts/${accountId}/custom_fields.json`,
    { name: fieldDef.name, field_type: fieldDef.type || 'text' },
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );
  return resp.data;
}

/**
 * Set custom field values on an existing call/submission via modify endpoint.
 */
export async function modifyCallFields({ accountId, apiKey, apiSecret }, callId, fieldValues) {
  const body = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    const prefixedKey = key.startsWith('custom_') ? key : `custom_${key}`;
    body[prefixedKey] = Array.isArray(value) ? value.join(', ') : value;
  }

  const resp = await axios.post(
    `${CTM_BASE}/api/v1/accounts/${accountId}/calls/${callId}/modify.json`,
    body,
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );
  return resp.data;
}

// ---------------------------------------------------------------------------
// Tracking Numbers
// ---------------------------------------------------------------------------

/**
 * List tracking numbers for an account (needed for FormReactor creation).
 */
export async function listTrackingNumbers({ accountId, apiKey, apiSecret }) {
  const resp = await axios.get(
    `${CTM_BASE}/api/v1/accounts/${accountId}/numbers.json`,
    { headers: authHeaders({ apiKey, apiSecret }), timeout: 15000 }
  );
  return resp.data?.numbers || resp.data || [];
}

// ---------------------------------------------------------------------------
// Field mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map a form builder field name to a CTM core field name, or null if custom.
 */
const CTM_CORE_MAP = {
  caller_name: 'caller_name',
  name: 'caller_name',
  full_name: 'caller_name',
  fullname: 'caller_name',
  first_name: 'caller_name',
  email: 'email',
  phone: 'phone_number',
  phone_number: 'phone_number',
  tel: 'phone_number'
};

export function mapToCtmCoreName(fieldName) {
  return CTM_CORE_MAP[fieldName] || null;
}

/**
 * Map form builder field type to CTM custom field type.
 */
function mapFieldTypeToCtm(type) {
  switch (type) {
    case 'text':
    case 'url':
    case 'hidden':
      return 'text';
    case 'email':
      return 'text';
    case 'phone':
      return 'text';
    case 'number':
      return 'number';
    case 'textarea':
      return 'text';
    case 'select':
    case 'radio':
      return 'select';
    case 'checkbox':
      return 'checkbox';
    case 'consent':
      return 'checkbox';
    default:
      return 'text';
  }
}

/**
 * Build CTM submission payload from form fields and schema.
 *
 * Separates core CTM fields from custom fields, normalizes data.
 *
 * @param {object} fieldValues - Raw form field values { fieldName: value }
 * @param {array} schemaFields - Form schema field definitions
 * @param {object} attribution - Attribution data from submission
 * @returns {object} { callerName, email, phoneNumber, customFields, attribution }
 */
export function buildCtmPayload(fieldValues, schemaFields = [], attribution = {}) {
  const coreFields = {};
  const customFields = {};

  for (const [key, value] of Object.entries(fieldValues)) {
    if (value === '' || value === null || value === undefined) continue;

    const coreName = mapToCtmCoreName(key);
    if (coreName) {
      // Core field: store under canonical name
      if (coreName === 'caller_name') {
        coreFields.callerName = coreFields.callerName
          ? `${coreFields.callerName} ${value}` // Concatenate first + last name
          : value;
      } else if (coreName === 'email') {
        coreFields.email = value;
      } else if (coreName === 'phone_number') {
        coreFields.phoneNumber = normalizePhone(value);
      }
    } else {
      // Check if this is a layout/display-only field — skip it
      const schemaDef = schemaFields.find((f) => f.name === key);
      if (schemaDef && ['heading', 'paragraph', 'divider', 'score_display'].includes(schemaDef.type)) {
        continue;
      }
      customFields[key] = value;
    }
  }

  return {
    ...coreFields,
    customFields,
    attribution
  };
}

/**
 * Strip non-digits from phone, preserve leading +.
 */
function normalizePhone(phone) {
  if (!phone) return '';
  const str = String(phone).trim();
  if (str.startsWith('+')) return '+' + str.slice(1).replace(/\D/g, '');
  return str.replace(/\D/g, '');
}
