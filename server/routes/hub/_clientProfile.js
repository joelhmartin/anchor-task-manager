// Shared client/profile patch helpers extracted from hub.js.
//
// These power the section-based PATCH /api/hub/clients[/:id] endpoints (which
// stay in hub.js for now and will move into a dedicated clients router next),
// and are the canonical home for "patch a client's user/profile/brand/tracking"
// logic so future sub-routers can import them without reaching back into
// hub.js. Bodies are byte-identical to the originals — no behavior change.
//
// Sections: user, profile, brand, tracking. Each is optional; undefined fields
// are untouched. Callers run these inside a single transaction per client.

import { isValidTimeZone } from '../../services/util/timezone.js';
import { encrypt, isEncrypted } from '../../services/security/index.js';
import { registerDomain } from '../../services/recaptcha.js';
import { clientLabelSelect, clientLabelJoins } from '../../services/clientLabel.js';

export const CLIENT_PACKAGE_OPTIONS = ['Essentials', 'Growth', 'Accelerate', 'Custom'];

export const PATCH_PROFILE_FIELDS = [
  'looker_url','monday_board_id','monday_group_id','monday_active_group_id','monday_completed_group_id',
  'client_identifier_value','task_workspace_id','board_prefix','account_manager_person_id',
  'ai_prompt','ctm_account_number','auto_star_enabled','client_type','client_subtype','client_package','timezone',
  'requires_website_access','requires_ga4_access','requires_google_ads_access','requires_meta_access','requires_forms_step',
  'website_access_provided','website_access_understood',
  'ga4_access_provided','ga4_access_understood',
  'google_ads_access_provided','google_ads_access_understood',
  'meta_access_provided','meta_access_understood',
  'website_forms_details_provided','website_forms_details_understood',
  'website_forms_uses_third_party','website_forms_uses_hipaa','website_forms_connected_crm','website_forms_custom',
  'website_forms_notes','call_tracking_main_number','front_desk_emails','client_group_id',
  'analytics_defaults','account_manager_user_id'
];

export const PATCH_TRACKING_FIELDS = [
  'website_domain','gtm_account_id','gtm_container_id','gtm_container_public_id',
  'ga4_property_id','ga4_measurement_id',
  'google_ads_customer_id','google_ads_conversion_id','google_ads_conversion_label',
  'meta_ad_account_id','meta_pixel_id','meta_test_event_code','browser_meta_pixel_enabled',
  'bing_uet_id','tiktok_pixel_id','browser_bing_enabled','browser_tiktok_enabled'
];

export const PATCH_TRACKING_JSON_FIELDS = ['allowed_events','blocked_fields','consent_defaults'];

export function normalizeTrackingClientType(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).toLowerCase();
  if (s === 'medical') return 'medical';
  if (s === 'non-medical' || s === 'non_medical' || s === 'nonmedical') return 'non_medical';
  return undefined;
}

export async function applyUserPatch(db, clientId, userPatch, requesterRole) {
  if (!userPatch || typeof userPatch !== 'object') return;
  const { display_name, email, role } = userPatch;
  if (display_name !== undefined) {
    const parts = String(display_name).trim().split(' ').filter(Boolean);
    const first = parts.shift() || '';
    const last = parts.join(' ');
    await db.query('UPDATE users SET first_name=$1, last_name=$2 WHERE id=$3',
      [first || String(display_name).trim(), last, clientId]);
  }
  if (email !== undefined && email !== null && String(email).trim()) {
    const newEmail = String(email).toLowerCase().trim();
    const { rows: [currentUser] } = await db.query('SELECT email FROM users WHERE id=$1', [clientId]);
    const wasPlaceholder = (currentUser?.email || '').includes('@placeholder.anchor');
    const isRealEmail = !newEmail.includes('@placeholder.anchor');
    if (wasPlaceholder && isRealEmail) {
      await db.query('UPDATE users SET email=$1, email_verified_at=NOW() WHERE id=$2', [newEmail, clientId]);
      await db.query(`UPDATE client_profiles SET activated_at = COALESCE(activated_at, NOW())
                      WHERE user_id=$1 AND onboarding_completed_at IS NOT NULL`, [clientId]);
    } else {
      await db.query('UPDATE users SET email=$1 WHERE id=$2', [newEmail, clientId]);
    }
  }
  if (role !== undefined && requesterRole === 'superadmin') {
    const allowed = ['client','editor','admin','team'];
    const next = allowed.includes(role) ? role : null;
    if (next) await db.query('UPDATE users SET role=$1 WHERE id=$2', [next, clientId]);
  }
}

export async function applyProfilePatch(db, clientId, profilePatch) {
  if (!profilePatch || typeof profilePatch !== 'object') return { timezoneChanged: false };
  const sets = [];
  const params = [];
  const push = (sql, val) => { params.push(val); sets.push(`${sql}=$${params.length}`); };

  // Validate timezone up-front so an invalid IANA ID can't reach the DB,
  // and snapshot the previous value so the caller can decide whether to
  // resync pending journey steps. Mirrors the PUT /clients/:id behavior.
  let timezoneChanged = false;
  if ('timezone' in profilePatch) {
    const tz = profilePatch.timezone;
    if (tz !== null && tz !== '' && tz !== undefined && !isValidTimeZone(tz)) {
      throw Object.assign(new Error('Invalid timezone'), { httpStatus: 400 });
    }
    const { rows: prev } = await db.query('SELECT timezone FROM client_profiles WHERE user_id=$1', [clientId]);
    const previousTz = prev[0]?.timezone || null;
    const nextTz = tz === '' ? null : tz;
    if (previousTz !== nextTz && nextTz !== null && nextTz !== undefined) {
      timezoneChanged = true;
    }
  }

  for (const f of PATCH_PROFILE_FIELDS) {
    if (!(f in profilePatch)) continue;
    let v = profilePatch[f];
    if (f === 'analytics_defaults') v = v == null ? null : JSON.stringify(v);
    if (f === 'client_package') v = CLIENT_PACKAGE_OPTIONS.includes(v) ? v : null;
    if (f === 'client_group_id' || f === 'account_manager_user_id' || f === 'task_workspace_id') {
      v = v || null;
    }
    push(f, v === '' ? null : v);
  }
  // CTM secrets — encrypt
  if ('ctm_api_key' in profilePatch) {
    const v = profilePatch.ctm_api_key;
    const enc = v ? (isEncrypted(v) ? v : encrypt(v) || v) : null;
    push('ctm_api_key', enc);
  }
  if ('ctm_api_secret' in profilePatch) {
    const v = profilePatch.ctm_api_secret;
    const enc = v ? (isEncrypted(v) ? v : encrypt(v) || v) : null;
    push('ctm_api_secret', enc);
  }
  if (!sets.length) return { timezoneChanged };

  const exists = await db.query('SELECT user_id FROM client_profiles WHERE user_id=$1', [clientId]);
  if (exists.rows.length) {
    params.push(clientId);
    await db.query(
      `UPDATE client_profiles SET ${sets.join(', ')}, updated_at=NOW()
       WHERE user_id=$${params.length}`,
      params
    );
  } else {
    const cols = sets.map((s) => s.split('=')[0]);
    cols.push('user_id');
    params.push(clientId);
    const placeholders = params.map((_, i) => `$${i + 1}`).join(',');
    await db.query(
      `INSERT INTO client_profiles (${cols.join(',')}) VALUES (${placeholders})`,
      params
    );
  }
  return { timezoneChanged };
}

export async function applyBrandPatch(db, clientId, brandPatch) {
  if (!brandPatch || typeof brandPatch !== 'object') return;
  if (!('website_url' in brandPatch) && !('business_name' in brandPatch)) return;

  const { rows: existing } = await db.query('SELECT user_id FROM brand_assets WHERE user_id=$1', [clientId]);
  if (existing.length) {
    const sets = [];
    const params = [];
    if ('website_url' in brandPatch) {
      params.push(brandPatch.website_url || null);
      sets.push(`website_url=$${params.length}`);
    }
    if ('business_name' in brandPatch) {
      params.push(brandPatch.business_name || null);
      sets.push(`business_name=$${params.length}`);
    }
    params.push(clientId);
    await db.query(
      `UPDATE brand_assets SET ${sets.join(', ')}, updated_at=NOW() WHERE user_id=$${params.length}`,
      params
    );
  } else {
    await db.query(
      'INSERT INTO brand_assets (user_id, website_url, business_name) VALUES ($1,$2,$3)',
      [clientId, brandPatch.website_url || null, brandPatch.business_name || null]
    );
  }
  if (brandPatch.website_url) registerDomain(brandPatch.website_url);
}

export async function applyTrackingPatch(db, clientId, trackingPatch) {
  if (!trackingPatch || typeof trackingPatch !== 'object' || !Object.keys(trackingPatch).length) return;

  const normType = normalizeTrackingClientType(trackingPatch.client_type);
  const { rows: existing } = await db.query('SELECT * FROM tracking_configs WHERE user_id=$1', [clientId]);

  if (existing.length === 0) {
    // INSERT path — client_type is required at creation
    if (!normType) {
      throw Object.assign(new Error('tracking.client_type required (medical | non-medical) when creating tracking config'), { httpStatus: 400 });
    }
    const cols = ['user_id', 'client_type'];
    const vals = [clientId, normType];
    for (const f of PATCH_TRACKING_FIELDS) {
      if (!(f in trackingPatch)) continue;
      cols.push(f);
      vals.push(trackingPatch[f] === '' ? null : (trackingPatch[f] ?? null));
    }
    if ('ga4_api_secret' in trackingPatch) {
      cols.push('ga4_api_secret');
      vals.push(trackingPatch.ga4_api_secret ? encrypt(trackingPatch.ga4_api_secret) : null);
    }
    if ('meta_capi_token' in trackingPatch) {
      cols.push('meta_capi_token');
      vals.push(trackingPatch.meta_capi_token ? encrypt(trackingPatch.meta_capi_token) : null);
    }
    for (const f of PATCH_TRACKING_JSON_FIELDS) {
      if (!(f in trackingPatch)) continue;
      cols.push(f);
      vals.push(JSON.stringify(trackingPatch[f] || (f === 'consent_defaults' ? {} : [])));
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    await db.query(
      `INSERT INTO tracking_configs (${cols.join(',')}) VALUES (${placeholders})`,
      vals
    );
    return;
  }

  // UPDATE path
  if ('client_type' in trackingPatch && !normType) {
    throw Object.assign(new Error('tracking.client_type must be medical | non-medical when provided'), { httpStatus: 400 });
  }
  const sets = [];
  const params = [];
  const push = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
  if (normType) push('client_type', normType);
  for (const f of PATCH_TRACKING_FIELDS) {
    if (!(f in trackingPatch)) continue;
    push(f, trackingPatch[f] === '' ? null : (trackingPatch[f] ?? null));
  }
  if ('ga4_api_secret' in trackingPatch) {
    push('ga4_api_secret', trackingPatch.ga4_api_secret ? encrypt(trackingPatch.ga4_api_secret) : null);
  }
  if ('meta_capi_token' in trackingPatch) {
    push('meta_capi_token', trackingPatch.meta_capi_token ? encrypt(trackingPatch.meta_capi_token) : null);
  }
  for (const f of PATCH_TRACKING_JSON_FIELDS) {
    if (!(f in trackingPatch)) continue;
    push(f, JSON.stringify(trackingPatch[f] || (f === 'consent_defaults' ? {} : [])));
  }
  if (!sets.length) return;
  params.push(clientId);
  await db.query(
    `UPDATE tracking_configs SET ${sets.join(', ')}, updated_at=NOW() WHERE user_id=$${params.length}`,
    params
  );
}

export async function getClientSnapshot(db, clientId) {
  const { rows } = await db.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.role, cp.*,
            tc.id AS tracking_config_id,
            tc.client_type AS tracking_client_type,
            tc.website_domain,
            tc.ga4_property_id, tc.ga4_measurement_id,
            tc.google_ads_customer_id, tc.meta_ad_account_id, tc.meta_pixel_id,
            tc.browser_meta_pixel_enabled,
            ba.website_url, ba.business_name,
            ${clientLabelSelect()}
       FROM users u
       ${clientLabelJoins()}
       LEFT JOIN tracking_configs tc ON tc.user_id=u.id
      WHERE u.id=$1`,
    [clientId]
  );
  return rows[0] || null;
}

export async function applyClientPatchTx(db, clientId, patch, requesterRole) {
  await applyUserPatch(db, clientId, patch.user, requesterRole);
  const profileResult = await applyProfilePatch(db, clientId, patch.profile);
  await applyBrandPatch(db, clientId, patch.brand);
  await applyTrackingPatch(db, clientId, patch.tracking);
  return { timezoneChanged: Boolean(profileResult?.timezoneChanged) };
}
