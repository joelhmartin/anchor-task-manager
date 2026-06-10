import { query } from '../db.js';

const MANAGED_NAME_PREFIX = 'Anchor - ';
const LEGACY_MANAGED_NAMES = {
  tags: new Set([
    'GA4 Configuration',
    'Google Ads Remarketing',
    'Meta Pixel - PageView',
    'Google Tag (Ads)',
    'Conversion Linker',
    'gtag Bridge',
  ]),
  triggers: new Set([
    'CTA Click',
    'Scroll Depth',
    'Form Embed View',
  ]),
  variables: new Set([
    'GA4 Measurement ID',
    'Google Ads Conversion ID',
    'Google Ads Conversion Label',
    'Meta Pixel ID',
  ]),
};

function prefixManagedName(name = '') {
  if (!name) return name;
  return name.startsWith(MANAGED_NAME_PREFIX) ? name : `${MANAGED_NAME_PREFIX}${name}`;
}

export function isManagedTemplateEntity(kind, name = '') {
  if (!name) return false;
  return name.startsWith(MANAGED_NAME_PREFIX) || LEGACY_MANAGED_NAMES[kind]?.has(name) || false;
}

function normalizeStandardWebTemplate(template) {
  const next = {
    ...template,
    tags: Array.isArray(template.tags) ? [...template.tags] : [],
    triggers: Array.isArray(template.triggers) ? [...template.triggers] : [],
    variables: Array.isArray(template.variables) ? [...template.variables] : [],
  };

  const triggerNameMap = new Map();
  next.triggers = next.triggers.map((trigger) => {
    const normalizedName = prefixManagedName(trigger?.name || '');
    if (trigger?.name) {
      triggerNameMap.set(trigger.name, normalizedName);
    }
    return {
      ...trigger,
      name: normalizedName,
    };
  });

  next.variables = next.variables.map((variable) => ({
    ...variable,
    name: prefixManagedName(variable?.name || ''),
  }));

  // Replace the legacy awct all-pages conversion tag with modern googtag + Conversion Linker.
  // The awct tag fires a conversion on EVERY pageview which is wrong. Instead:
  // - googtag with AW-{conversionId} enables Google Ads to receive gtag() conversion calls
  // - Conversion Linker (gclidw) persists gclid/gbraid/wbraid across pages
  next.tags = next.tags.filter(
    (tag) => !(tag?.type === 'awct' && (tag?.name === 'Google Ads Remarketing' || tag?.name === 'Anchor - Google Ads Remarketing'))
  );

  // Add Google Tag for Ads (googtag with AW- prefix) — conditional on having a conversion ID
  const hasAdsTag = next.tags.some((t) => t.name === 'Google Tag (Ads)');
  if (!hasAdsTag) {
    next.tags.push({
      name: 'Google Tag (Ads)',
      type: 'googtag',
      parameter: [{ key: 'tagId', type: 'template', value: 'AW-{{google_ads_conversion_id}}' }],
      firingTriggerId: ['__ALL_PAGES'],
      meta: { conditional: 'google_ads_conversion_id' },
    });
  }

  // Add Conversion Linker — required for Google Ads click ID persistence
  const hasLinker = next.tags.some((t) => t.type === 'gclidw');
  if (!hasLinker) {
    next.tags.push({
      name: 'Conversion Linker',
      type: 'gclidw',
      parameter: [],
      firingTriggerId: ['__ALL_PAGES'],
      meta: { conditional: 'google_ads_conversion_id' },
    });
  }

  next.tags = next.tags.map((tag) => ({
    ...tag,
    name: prefixManagedName(tag?.name || ''),
    firingTriggerId: (tag?.firingTriggerId || []).map((triggerRef) => triggerNameMap.get(triggerRef) || triggerRef),
  }));

  return next;
}

/**
 * Load the active template by name.
 * Returns the full template row including tags, triggers, variables as JSONB.
 */
export async function loadTemplate(name = 'standard_web_v1') {
  const { rows } = await query(
    `SELECT * FROM tracking_templates WHERE name = $1 AND is_active = true ORDER BY version DESC LIMIT 1`,
    [name]
  );
  if (rows.length === 0) {
    throw new Error(`Template not found: ${name}`);
  }
  if (name === 'standard_web_v1') {
    return normalizeStandardWebTemplate(rows[0]);
  }
  return rows[0];
}

/**
 * Substitute placeholders in template definitions with client-specific values.
 * Placeholders use {{key}} syntax.
 *
 * @param {Array} items - Array of tag/trigger/variable definitions (JSONB)
 * @param {Object} values - Key-value map: { ga4_measurement_id: 'G-XXXX', ... }
 * @returns {Array} - Items with placeholders replaced
 */
export function substituteValues(items, values) {
  const json = JSON.stringify(items);
  const substituted = json.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return values[key] !== undefined && values[key] !== null ? values[key] : '';
  });
  return JSON.parse(substituted);
}

/**
 * Build the placeholder values map from a tracking_configs row.
 */
export function buildValuesMap(config) {
  return {
    ga4_measurement_id: config.ga4_measurement_id || '',
    google_ads_conversion_id: config.google_ads_conversion_id || '',
    google_ads_conversion_label: config.google_ads_conversion_label || '',
    meta_pixel_id: config.meta_pixel_id || '',
  };
}

/**
 * Filter tags based on conditional metadata and config flags.
 * Tags with meta.conditional are only included if the config flag is truthy.
 */
export function filterConditionalTags(tags, config) {
  return tags.filter((tag) => {
    if (tag.meta?.conditional) {
      return !!config[tag.meta.conditional];
    }
    return true;
  });
}
