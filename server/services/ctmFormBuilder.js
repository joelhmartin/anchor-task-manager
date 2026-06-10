/**
 * CTM Form Builder Service
 *
 * Mirrors the WordPress plugin's PHP logic:
 * - Config → HTML renderer (render_config_to_html / render_fields_html)
 * - FormReactor creation (build_reactor_fields / create_form_reactor)
 * - Custom field sync (sync_custom_fields_to_account)
 * - Field name sanitization
 */

import crypto from 'crypto';
import axios from 'axios';

const CTM_BASE = process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com';

// ---------------------------------------------------------------------------
// Core CTM field names — these are NOT custom fields
// ---------------------------------------------------------------------------

const CORE_FIELDS = ['caller_name', 'email', 'phone_number', 'phone', 'country_code'];

// Type aliases: palette types → real HTML types
const TYPE_ALIASES = { fullname: 'text', message: 'textarea' };

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function authHeaders(credentials) {
  return {
    Authorization: `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

// ---------------------------------------------------------------------------
// Field name sanitization — MUST match plugin exactly
// ---------------------------------------------------------------------------

/**
 * Sanitize a field name to a safe machine identifier.
 * Matches the PHP: sanitize_field_name()
 */
export function sanitizeFieldName(name) {
  if (!name) return '';
  let s = name.replace(/[^a-zA-Z0-9_\s-]/g, '');
  s = s.trim().toLowerCase();
  s = s.replace(/[\s-]+/g, '_');
  s = s.replace(/_+/g, '_');
  s = s.replace(/^_|_$/g, '');
  return s;
}

/**
 * Check if a field name is a core CTM field.
 */
export function isCoreField(name) {
  return CORE_FIELDS.includes(name);
}

// ---------------------------------------------------------------------------
// Config → HTML Renderer
// Mirrors: render_config_to_html() + render_fields_html()
// ---------------------------------------------------------------------------

/**
 * Render a form config (settings + fields) to HTML.
 * This produces the same HTML structure as the WordPress plugin.
 */
export function renderConfigToHtml(config) {
  const settings = config.settings || {};
  const fields = config.fields || [];
  if (!fields.length) return '';

  const labelStyle = settings.labelStyle || 'above';
  const submitText = settings.submitText || 'Submit';
  const isMulti = !!settings.multiStep;
  const scoring = settings.scoring || {};
  const scoringOn = !!scoring.enabled;

  // Group fields by step
  const steps = {};
  if (isMulti) {
    for (const f of fields) {
      const s = parseInt(f.step) || 0;
      if (!steps[s]) steps[s] = [];
      steps[s].push(f);
    }
  } else {
    steps[0] = fields;
  }

  const stepKeys = Object.keys(steps).sort((a, b) => a - b);

  let html = '';
  if (scoringOn) {
    html = `<form id="ctmForm" novalidate data-scoring='${JSON.stringify({ enabled: true })}'>\n`;
  } else {
    html = '<form id="ctmForm" novalidate>\n';
  }

  for (const stepIdx of stepKeys) {
    if (isMulti) html += '  <div class="ctm-multi-step-item">\n';
    html += renderFieldsHtml(steps[stepIdx], labelStyle, scoringOn);
    if (stepIdx === stepKeys[stepKeys.length - 1]) {
      html += `    <button type="submit">${escapeHtml(submitText)}</button>\n`;
    }
    if (isMulti) html += '  </div>\n';
  }

  html += '</form>';
  return html;
}

/**
 * Render an array of field configs into HTML.
 * Mirrors: render_fields_html()
 */
function renderFieldsHtml(fields, globalLabelStyle, scoringOn) {
  let html = '';
  let rowOpen = false;

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    let type = f.type || 'text';
    type = TYPE_ALIASES[type] || type;
    const label = f.label || '';
    let name = f.name || '';
    const placeholder = f.placeholder || '';
    const helpText = f.helpText || '';
    const defaultVal = f.defaultValue || '';
    const required = !!f.required;

    // Sanitize custom field names
    if (!CORE_FIELDS.includes(name)) {
      name = sanitizeFieldName(name);
    }

    const isCore = CORE_FIELDS.includes(name);
    const isCustom = !isCore;
    const width = f.width || 'full';
    const cssClass = f.cssClass || '';
    const fieldId = f.id || '';

    // Per-field label style
    const ls = (f.labelStyle || 'inherit') === 'inherit' ? globalLabelStyle : f.labelStyle;

    // Conditions
    const conditions = f.conditions || [];
    const condLogic = f.conditionLogic || 'all';
    const hasConds = conditions.length > 0 && (conditions[0]?.field || conditions[0]?.fieldId);

    let condAttrs = '';
    if (hasConds) {
      condAttrs += ` data-conditions="${escapeAttr(JSON.stringify(conditions))}"`;
      condAttrs += ` data-condition-logic="${escapeAttr(condLogic)}"`;
      condAttrs += ' style="display:none;"';
    }

    const fidAttr = fieldId ? ` data-field-id="${escapeAttr(fieldId)}"` : '';
    const widthClass = `ctm-col-${width}`;

    // Column layout
    if (width !== 'full') {
      if (!rowOpen) { html += '    <div class="ctm-row">\n'; rowOpen = true; }
    } else {
      if (rowOpen) { html += '    </div>\n'; rowOpen = false; }
    }

    let wrapperClass = widthClass;
    if (cssClass) wrapperClass += ' ' + cssClass;

    // Layout elements
    if (type === 'heading') {
      html += `    <div class="${wrapperClass}"${fidAttr}${condAttrs}><h3>${escapeHtml(label)}</h3></div>\n`;
      continue;
    }
    if (type === 'paragraph') {
      html += `    <div class="${wrapperClass}"${fidAttr}${condAttrs}><p>${escapeHtml(label)}</p></div>\n`;
      continue;
    }
    if (type === 'divider') {
      html += `    <div class="${wrapperClass}"${fidAttr}${condAttrs}><hr /></div>\n`;
      continue;
    }
    if (type === 'score_display') {
      const scoreLabel = escapeHtml(label || 'Your Score');
      const scoreName = escapeAttr(name || 'custom_total_score');
      html += `    <div class="${wrapperClass}"${fidAttr}${condAttrs}>\n`;
      html += `      <div class="ctm-score-wrap">\n`;
      html += `        <span class="ctm-score-label">${scoreLabel}:</span>\n`;
      html += `        <span class="ctm-score-display">0</span>\n`;
      html += `      </div>\n`;
      html += `      <input type="hidden" name="${scoreName}" class="ctm-custom ctm-score-input" value="0" />\n`;
      html += `    </div>\n`;
      continue;
    }

    // Hidden field
    if (type === 'hidden') {
      const cls = isCustom ? ' class="ctm-custom"' : '';
      html += `    <input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(defaultVal)}"${cls}${fidAttr} />\n`;
      continue;
    }

    // Consent field
    if (type === 'consent') {
      const cls = isCustom ? ' ctm-custom' : '';
      const reqAttr = required ? ' required' : '';
      const consentTxt = f.consentText || '';
      html += `    <div class="${wrapperClass} ctm-consent-wrap"${fidAttr}${condAttrs}>\n`;
      html += `      <label class="ctm-consent-label">\n`;
      html += `        <input type="checkbox" name="${escapeAttr(name)}" value="Yes" class="ctm-consent-checkbox${cls}"${reqAttr} />\n`;
      html += `        <span class="ctm-consent-text">${sanitizeInlineHtml(consentTxt)}</span>\n`;
      html += `      </label>\n`;
      if (helpText) html += `      <small class="ctm-help-text">${escapeHtml(helpText)}</small>\n`;
      html += `    </div>\n`;
      continue;
    }

    const reqAttr = required ? ' required' : '';
    const phAttr = placeholder ? ` placeholder="${escapeAttr(placeholder)}"` : '';
    const valAttr = defaultVal !== '' ? ` value="${escapeAttr(defaultVal)}"` : '';
    const useFloating = ls === 'floating' && ['text', 'email', 'tel', 'number', 'url', 'textarea'].includes(type);
    const hideLabel = ls === 'hidden';
    const options = f.options || [];

    html += `    <div class="${wrapperClass}"${fidAttr}${condAttrs}>\n`;

    if (useFloating) {
      const inputCls = isCustom ? 'ctm-custom input-field' : 'input-field';
      html += '      <div class="input">\n';
      if (type === 'textarea') {
        html += `        <textarea name="${escapeAttr(name)}" class="${inputCls}"${reqAttr}${phAttr}>${escapeHtml(defaultVal)}</textarea>\n`;
      } else {
        const numAttrs = buildNumberAttrs(f, type);
        html += `        <input class="${inputCls}" type="${escapeAttr(type)}" name="${escapeAttr(name)}"${reqAttr}${phAttr}${valAttr}${numAttrs} />\n`;
      }
      html += `        <label class="input-label">${escapeHtml(label)}</label>\n`;
      html += '      </div>\n';
    } else if (type === 'select') {
      const cls = isCustom ? ' class="ctm-custom"' : '';
      if (!hideLabel) html += `      <label>${escapeHtml(label)}\n`;
      html += `      <select name="${escapeAttr(name)}"${cls}${reqAttr}>\n`;
      html += '        <option value="">&mdash; Select &mdash;</option>\n';
      for (const opt of options) {
        const scoreAttr = scoringOn && opt.score ? ` data-score="${escapeAttr(String(opt.score))}"` : '';
        html += `        <option value="${escapeAttr(opt.value || '')}"${scoreAttr}>${escapeHtml(opt.label || '')}</option>\n`;
      }
      html += '      </select>\n';
      if (!hideLabel) html += '      </label>\n';
    } else if (type === 'checkbox') {
      const cls = isCustom ? ' class="ctm-custom"' : '';
      html += '      <fieldset>\n';
      if (!hideLabel) html += `        <legend>${escapeHtml(label)}</legend>\n`;
      for (const opt of options) {
        const scoreAttr = scoringOn && opt.score ? ` data-score="${escapeAttr(String(opt.score))}"` : '';
        html += `        <label><input type="checkbox" name="${escapeAttr(name)}[]" value="${escapeAttr(opt.value || '')}"${cls}${scoreAttr} /> ${escapeHtml(opt.label || '')}</label>\n`;
      }
      html += '      </fieldset>\n';
    } else if (type === 'radio') {
      const cls = isCustom ? ' class="ctm-custom"' : '';
      html += '      <fieldset>\n';
      if (!hideLabel) html += `        <legend>${escapeHtml(label)}</legend>\n`;
      for (const opt of options) {
        const scoreAttr = scoringOn && opt.score ? ` data-score="${escapeAttr(String(opt.score))}"` : '';
        html += `        <label><input type="radio" name="${escapeAttr(name)}" value="${escapeAttr(opt.value || '')}"${cls}${reqAttr}${scoreAttr} /> ${escapeHtml(opt.label || '')}</label>\n`;
      }
      html += '      </fieldset>\n';
    } else if (type === 'textarea') {
      const cls = isCustom ? ' class="ctm-custom"' : '';
      if (!hideLabel) html += `      <label>${escapeHtml(label)}\n`;
      html += `      <textarea name="${escapeAttr(name)}"${cls}${reqAttr}${phAttr}>${escapeHtml(defaultVal)}</textarea>\n`;
      if (!hideLabel) html += '      </label>\n';
    } else {
      // text, email, tel, number, url
      const cls = isCustom ? ' class="ctm-custom"' : '';
      const numAttrs = buildNumberAttrs(f, type);
      if (!hideLabel) html += `      <label>${escapeHtml(label)}\n`;
      html += `      <input type="${escapeAttr(type)}" name="${escapeAttr(name)}"${cls}${reqAttr}${phAttr}${valAttr}${numAttrs} />\n`;
      if (!hideLabel) html += '      </label>\n';
    }

    if (helpText) html += `      <small class="ctm-help-text">${escapeHtml(helpText)}</small>\n`;
    html += '    </div>\n';

    // Close row if next field is full width or end
    const next = fields[i + 1];
    if (rowOpen && (!next || (next.width || 'full') === 'full')) {
      html += '    </div>\n';
      rowOpen = false;
    }
  }

  if (rowOpen) html += '    </div>\n';
  return html;
}

function buildNumberAttrs(f, type) {
  if (type === 'tel') return ' minlength="7" maxlength="20"';
  if (type !== 'number') return '';
  let s = '';
  if (f.min != null && f.min !== '') s += ` min="${escapeAttr(String(f.min))}"`;
  if (f.max != null && f.max !== '') s += ` max="${escapeAttr(String(f.max))}"`;
  if (f.numStep != null && f.numStep !== '') s += ` step="${escapeAttr(String(f.numStep))}"`;
  return s;
}

// ---------------------------------------------------------------------------
// FormReactor Management
// ---------------------------------------------------------------------------

/**
 * Build reactor fields from builder config.
 * Mirrors: build_reactor_fields()
 */
export function buildReactorFields(config) {
  const fields = config.fields || [];
  let includeName = false, nameRequired = false;
  let includeEmail = false, emailRequired = false;
  const customFields = [];

  for (const f of fields) {
    let fname = f.name || '';
    let ftype = f.type || 'text';
    ftype = TYPE_ALIASES[ftype] || ftype;

    if (!CORE_FIELDS.includes(fname)) {
      fname = sanitizeFieldName(fname);
    }

    if (['heading', 'paragraph', 'divider'].includes(ftype)) continue;

    if (fname === 'caller_name') {
      includeName = true;
      nameRequired = !!f.required;
    } else if (fname === 'email') {
      includeEmail = true;
      emailRequired = !!f.required;
    } else if (['phone_number', 'phone', 'country_code'].includes(fname)) {
      continue;
    } else {
      // CTM type mapping
      const ctmTypeMap = {
        email: 'text', tel: 'text', number: 'text', url: 'text',
        hidden: 'text', consent: 'text',
        radio: 'list', select: 'list', checkbox: 'checklist'
      };
      const ctmType = ctmTypeMap[ftype] || ftype;

      const cf = {
        name: fname,
        label: f.displayName || f.label || fname.charAt(0).toUpperCase() + fname.slice(1),
        type: ctmType,
        required: !!f.required
      };

      // Options as newline-separated items string
      if (f.options && Array.isArray(f.options) && f.options.length > 0) {
        const labels = f.options.map(opt => opt.label || opt.value || '').filter(Boolean);
        cf.items = labels.join('\n');
      }

      cf.log_visible = f.logVisible !== false;
      customFields.push(cf);
    }
  }

  return { include_name: includeName, name_required: nameRequired, include_email: includeEmail, email_required: emailRequired, custom_fields: customFields };
}

/**
 * Create a FormReactor in CTM.
 * Mirrors: create_form_reactor() — auto-picks website/default tracking number.
 */
export async function createFormReactor(credentials, formName, config) {
  const headers = authHeaders(credentials);

  // Fetch tracking numbers
  const numResp = await axios.get(
    `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/numbers.json`,
    { headers, timeout: 20000 }
  );
  const numData = numResp.data;
  const numbers = numData.numbers || numData.tracking_numbers || numData || [];

  if (!Array.isArray(numbers) || numbers.length === 0) {
    throw new Error('No tracking numbers found in CTM account. Add at least one number in your CTM dashboard.');
  }

  // Pick website/default tracking number
  let chosen = numbers[numbers.length - 1];
  for (const n of numbers) {
    const label = (n.source?.name || n.tracking_source_name || n.name || '').toLowerCase();
    if (label.includes('website') || label.includes('default') || label.includes('direct')) {
      chosen = n;
      break;
    }
  }

  const reactorFields = buildReactorFields(config);
  const body = {
    name: formName,
    virtual_phone_number_id: chosen.id,
    dynamic_sources: true,        // required for visitor session linking (Visitor Detail in CTM)
    log_form_entry_only: true,    // log the form entry without triggering an auto-callback
    include_name: reactorFields.include_name,
    name_required: reactorFields.name_required,
    include_email: reactorFields.include_email,
    email_required: reactorFields.email_required
  };

  if (reactorFields.custom_fields.length > 0) {
    body.custom_fields = reactorFields.custom_fields;
  }

  const resp = await axios.post(
    `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/form_reactors`,
    body,
    { headers, timeout: 30000 }
  );

  const reactorId = resp.data?.form_reactor?.id || resp.data?.id;
  if (!reactorId) {
    throw new Error('CTM API did not return a reactor ID. Response: ' + JSON.stringify(resp.data).substring(0, 300));
  }

  return String(reactorId);
}

/**
 * Delete a FormReactor in CTM.
 */
export async function deleteFormReactor(credentials, reactorId) {
  const headers = authHeaders(credentials);
  try {
    await axios.delete(
      `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/form_reactors/${encodeURIComponent(reactorId)}`,
      { headers, timeout: 15000 }
    );
  } catch (err) {
    console.error('[ctmFormBuilder] Failed to delete reactor:', err.message);
  }
}

/**
 * Submit form data to CTM FormReactor.
 * Mirrors: send_submission_to_ctm()
 *
 * IMPORTANT: Submission endpoint is /api/v1/formreactor/{id} (singular, no account_id)
 */
export async function submitToCtm(credentials, reactorId, core, custom, attribution) {
  const headers = authHeaders(credentials);

  // Build flat body
  const body = { ...core };

  // Custom fields with custom_ prefix
  for (const [key, value] of Object.entries(custom)) {
    const prefixed = key.startsWith('custom_') ? key : `custom_${key}`;
    body[prefixed] = Array.isArray(value) ? value.join(', ') : value;
  }

  // Attribution as top-level keys
  const attrKeys = ['visitor_sid', 'referring_url', 'page_url', 'visitor_ip', 'user_agent',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'msclkid'];
  for (const key of attrKeys) {
    if (attribution[key]) body[key] = attribution[key];
  }

  const reactorUrl = `${CTM_BASE}/api/v1/formreactor/${encodeURIComponent(reactorId)}`;

  const resp = await axios.post(
    reactorUrl,
    body,
    { headers, timeout: 20000 }
  );

  // Check for CTM error in 200 response
  if (resp.data?.status === 'error') {
    throw new Error(resp.data.text || resp.data.message || 'Unknown CTM error');
  }

  return resp.data?.trackback_id || null;
}

/**
 * Post-submission: set account-level custom fields on the call via /modify.json.
 * Mirrors: set_call_custom_fields()
 */
export async function setCallCustomFields(credentials, trackbackId, cfValues) {
  if (!trackbackId || !cfValues || Object.keys(cfValues).length === 0) return;

  const headers = authHeaders(credentials);
  const searchUrl = `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/calls.json?search=${encodeURIComponent(trackbackId)}&per_page=1`;

  let callId = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await axios.get(searchUrl, { headers, timeout: 10000 });
      const calls = resp.data?.calls || [];
      if (calls.length > 0 && calls[0].sid === trackbackId) {
        callId = calls[0].id;
        break;
      }
    } catch (err) {
      // Retry
    }
    if (attempt < 4) await new Promise(r => setTimeout(r, 1000));
  }

  if (!callId) {
    console.error(`[ctmFormBuilder] Could not find call for trackback ${trackbackId} after 5 attempts`);
    return;
  }

  try {
    await axios.post(
      `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/calls/${callId}/modify.json`,
      { custom_fields: cfValues },
      { headers, timeout: 10000 }
    );
  } catch (err) {
    console.error('[ctmFormBuilder] Failed to set custom fields:', err.message);
  }
}

/**
 * Sync custom fields to CTM account level.
 * Mirrors: sync_custom_fields_to_account()
 */
export async function syncCustomFieldsToAccount(credentials, config) {
  const fields = config.fields || [];
  const registerNames = {};

  for (const f of fields) {
    if (!f.registerField) continue;
    let fname = f.name || '';
    if (!CORE_FIELDS.includes(fname)) fname = sanitizeFieldName(fname);
    if (fname) registerNames[fname] = true;
  }

  if (Object.keys(registerNames).length === 0) return;

  const reactorFields = buildReactorFields(config);
  const formCustom = (reactorFields.custom_fields || [])
    .filter(cf => registerNames[sanitizeFieldName(cf.name || '')]);

  if (formCustom.length === 0) return;

  const headers = authHeaders(credentials);

  // Fetch existing account-level custom fields
  let existingNames = {};
  try {
    const resp = await axios.get(
      `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/custom_fields.json?all=true`,
      { headers, timeout: 20000 }
    );
    for (const ef of (resp.data?.custom_fields || [])) {
      if (ef.api_name) existingNames[ef.api_name] = true;
    }
  } catch (err) {
    console.error('[ctmFormBuilder] Failed to fetch existing custom fields:', err.message);
    return;
  }

  // Create missing fields
  const typeMap = { list: 'text', checklist: 'text', select: 'text', checkbox: 'text', radio: 'text', consent: 'text' };

  for (const cf of formCustom) {
    const baseName = sanitizeFieldName(cf.name || '');
    const apiName = baseName ? `cf_${baseName}` : '';
    if (!apiName || existingNames[apiName]) continue;

    try {
      await axios.post(
        `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/custom_fields.json`,
        {
          custom_field: {
            name: cf.label || baseName.charAt(0).toUpperCase() + baseName.slice(1),
            api_name: apiName,
            field_type: typeMap[cf.type] || cf.type || 'text',
            object_type: 'Call',
            panel: 'contact',
            required: false,
            log_visible: cf.log_visible !== false,
            should_redact: true,
            multipicker: false
          }
        },
        { headers, timeout: 20000 }
      );
      existingNames[apiName] = true;
    } catch (err) {
      console.error(`[ctmFormBuilder] Failed to create custom field "${baseName}":`, err.message);
    }
  }
}

/**
 * Hash field config for change detection.
 */
export function hashFieldConfig(config) {
  const fields = (config.fields || []).map(f => ({
    name: f.name, type: f.type, required: f.required, isCustom: f.isCustom,
    options: f.options, logVisible: f.logVisible, registerField: f.registerField
  }));
  return crypto.createHash('md5').update(JSON.stringify(fields)).digest('hex');
}

/**
 * Fetch FormReactors list from CTM.
 */
export async function fetchReactorsList(credentials) {
  const headers = authHeaders(credentials);
  try {
    const resp = await axios.get(
      `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/form_reactors`,
      { headers, timeout: 20000 }
    );
    const items = resp.data?.forms || resp.data?.form_reactors || resp.data || [];
    return (Array.isArray(items) ? items : []).map(r => ({
      id: String(r.id || ''),
      name: String(r.name || r.title || r.id || '')
    })).filter(r => r.id);
  } catch (err) {
    console.error('[ctmFormBuilder] Failed to fetch reactors:', err.message);
    return [];
  }
}

/**
 * Fetch reactor detail for starter form generation.
 */
export async function fetchReactorDetail(credentials, reactorId) {
  const headers = authHeaders(credentials);
  try {
    const resp = await axios.get(
      `${CTM_BASE}/api/v1/accounts/${credentials.accountId}/form_reactors/${encodeURIComponent(reactorId)}`,
      { headers, timeout: 20000 }
    );
    return resp.data || {};
  } catch (err) {
    return {};
  }
}

// ---------------------------------------------------------------------------
// HTML escaping helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitize HTML for consent text — allows safe inline tags (a, strong, em, b, i, u, br, span)
 * while escaping everything else. Preserves &nbsp; entities.
 */
function sanitizeInlineHtml(str) {
  if (!str) return '';
  const s = String(str);
  // Allowed tags with their permitted attributes
  const allowedTags = {
    a: ['href', 'target', 'rel', 'title'],
    strong: [], b: [], em: [], i: [], u: [], br: [], span: ['class', 'style']
  };
  const tagNames = Object.keys(allowedTags).join('|');
  // Match HTML tags
  return s.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)?\/?>/gi, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!allowedTags[lower]) return escapeHtml(match); // not allowed → escape
    if (!attrs || match.startsWith('</')) return match; // closing tag or no attrs → pass through
    // Filter attributes to only allowed ones
    const permitted = allowedTags[lower];
    const cleanAttrs = [];
    const attrRegex = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let m;
    while ((m = attrRegex.exec(attrs)) !== null) {
      if (permitted.includes(m[1].toLowerCase())) {
        cleanAttrs.push(`${m[1]}="${m[2] || m[3] || ''}"`);
      }
    }
    return `<${lower}${cleanAttrs.length ? ' ' + cleanAttrs.join(' ') : ''}>`;
  });
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
