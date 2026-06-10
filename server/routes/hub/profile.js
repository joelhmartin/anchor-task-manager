// Hub sub-router: /profile + /brand routes — self-profile, client profile,
// brand assets, and the email-safe display logo. Extracted verbatim from
// hub.js with no behavior change. Mounted by hub.js after requireAuth.

import express from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import fsPromises from "fs/promises";
import bcrypt from "bcryptjs";

import { query } from "../../db.js";
import { isValidTimeZone } from "../../services/util/timezone.js";
import { logSecurityEvent, SecurityEventTypes, SecurityEventCategories } from "../../services/security/index.js";
import { logClientActivity } from "../../services/activityLog.js";
import { registerDomain } from "../../services/recaptcha.js";
import { storeFile, deleteFile, getFileUrl } from "../../services/fileStorage.js";
import { isAdminOrEditor } from "../../middleware/roles.js";
import { canWriteAccount, uploadBrand, uploadAvatar, publicUrl } from "./_shared.js";
import { resyncActiveJourneysForOwner } from "./_journeys.js";

const router = express.Router();

async function upsertUserAvatarFromUpload({ userId, file }) {
  if (!userId) throw new Error('Missing userId');
  if (!file?.path) throw new Error('Missing uploaded file path');
  const bytes = await fsPromises.readFile(file.path);
  const contentType = String(file.mimetype || 'image/jpeg');
  await query(
    `INSERT INTO user_avatars (user_id, content_type, bytes, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, updated_at = NOW()`,
    [userId, contentType, bytes]
  );
  // Best effort cleanup of ephemeral disk file.
  await fsPromises.unlink(file.path).catch(() => {});
  // Store a stable URL; include cache-busting version.
  const url = `/api/hub/users/${userId}/avatar?v=${Date.now()}`;
  await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [url, userId]);
  return url;
}

function serializeHubProfileUser(row, { includeClientProfile }) {
  if (!row) return null;

  const user = {
    id: row.id,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    email: row.email ?? null,
    role: row.role ?? null,
    avatar_url: row.avatar_url ?? null,
    is_demo: row.is_demo || false,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };

  // Only expose client/onboarding-specific fields for client accounts.
  if (includeClientProfile) {
    user.monthly_revenue_goal = row.monthly_revenue_goal ?? null;
    user.client_type = row.client_type ?? null;
    user.client_subtype = row.client_subtype ?? null;
    user.client_package = row.client_package ?? null;

    user.website_access_provided = row.website_access_provided ?? false;
    user.website_access_understood = row.website_access_understood ?? false;
    user.ga4_access_provided = row.ga4_access_provided ?? false;
    user.ga4_access_understood = row.ga4_access_understood ?? false;
    user.google_ads_access_provided = row.google_ads_access_provided ?? false;
    user.google_ads_access_understood = row.google_ads_access_understood ?? false;
    user.meta_access_provided = row.meta_access_provided ?? false;
    user.meta_access_understood = row.meta_access_understood ?? false;
    user.website_forms_details_provided = row.website_forms_details_provided ?? false;
    user.website_forms_details_understood = row.website_forms_details_understood ?? false;
    user.website_forms_uses_third_party = row.website_forms_uses_third_party ?? false;
    user.website_forms_uses_hipaa = row.website_forms_uses_hipaa ?? false;
    user.website_forms_connected_crm = row.website_forms_connected_crm ?? false;
    user.website_forms_custom = row.website_forms_custom ?? false;
    user.website_forms_notes = row.website_forms_notes ?? '';
    user.form_notification_emails = row.form_notification_emails || [];
    user.timezone = row.timezone ?? 'America/New_York';
  }

  return user;
}

// GET /hub/profile/me — always returns the logged-in user's own profile,
// regardless of which client account is active. Use this for "Profile Settings"
// where a group/invited member needs to edit *their* account, not the client owner's.
router.get('/profile/me', async (req, res) => {
  const userId = req.user.id;
  const { rows } = await query(
    `SELECT u.*, cp.monthly_revenue_goal, cp.client_type, cp.client_subtype, cp.client_package, cp.timezone
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0] || req.user || null;
  const includeClientProfile = (row?.role || req.user?.role) === 'client';
  res.json({ user: serializeHubProfileUser(row, { includeClientProfile }) });
});

// PUT /hub/profile/me — updates the logged-in user's own account fields
// (name, email, password) plus their own monthly_revenue_goal when they are a client.
// Does NOT touch the active client account's record.
router.put('/profile/me', async (req, res) => {
  const userId = req.user.id;
  const { first_name, last_name, email, password, new_password, monthly_revenue_goal, timezone } = req.body || {};

  const updates = [];
  const params = [];
  if (first_name !== undefined) { updates.push('first_name = $' + (params.length + 1)); params.push(first_name); }
  if (last_name !== undefined)  { updates.push('last_name = $'  + (params.length + 1)); params.push(last_name); }
  if (email !== undefined)      { updates.push('email = $'      + (params.length + 1)); params.push(email); }

  const hasRevenueGoalUpdate = monthly_revenue_goal !== undefined;
  const hasTimezoneUpdate = timezone !== undefined;

  if (hasTimezoneUpdate && !isValidTimeZone(timezone)) {
    return res.status(400).json({ message: 'Invalid timezone' });
  }

  if (!updates.length && !new_password && !hasRevenueGoalUpdate && !hasTimezoneUpdate) {
    return res.status(400).json({ message: 'No changes provided' });
  }

  try {
    if (new_password) {
      if (!password) return res.status(400).json({ message: 'Current password required' });
      const { rows: pwRows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      const hash = pwRows[0]?.password_hash;
      const valid = hash && (await bcrypt.compare(password, hash));
      if (!valid) return res.status(400).json({ message: 'Current password incorrect' });
      updates.push('password_hash = $' + (params.length + 1));
      params.push(await bcrypt.hash(new_password, 12));
    }

    if (updates.length) {
      params.push(userId);
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    }

    if (new_password) {
      await logSecurityEvent({
        userId,
        eventType: SecurityEventTypes.PASSWORD_CHANGED,
        eventCategory: SecurityEventCategories.ACCOUNT,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        success: true,
        details: { changedBy: userId, changedViaSelfService: true }
      });
    }

    // Revenue goal is a client-only field and only meaningful on the user's own client_profile.
    if (hasRevenueGoalUpdate && req.user.role === 'client') {
      await query(
        `INSERT INTO client_profiles (user_id, monthly_revenue_goal)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET monthly_revenue_goal = EXCLUDED.monthly_revenue_goal,
               updated_at = NOW()`,
        [userId, monthly_revenue_goal || null]
      );
    }

    // Timezone (client-only): the business's local TZ — used by the call-volume heat map
    // and journey email send-time. When it changes, recompute pending journey steps.
    let timezoneChanged = false;
    if (hasTimezoneUpdate && req.user.role === 'client') {
      const { rows: prevRows } = await query('SELECT timezone FROM client_profiles WHERE user_id = $1', [userId]);
      const previousTz = prevRows[0]?.timezone || null;
      await query(
        `INSERT INTO client_profiles (user_id, timezone)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET timezone = EXCLUDED.timezone,
               updated_at = NOW()`,
        [userId, timezone]
      );
      timezoneChanged = previousTz !== timezone;
    }
    if (timezoneChanged) {
      await resyncActiveJourneysForOwner(userId);
    }

    const refreshed = await query(
      `SELECT u.*, cp.monthly_revenue_goal, cp.client_type, cp.client_subtype, cp.client_package
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const row = refreshed.rows[0] || null;
    const includeClientProfile = row?.role === 'client';
    res.json({ user: serializeHubProfileUser(row, { includeClientProfile }) });
  } catch (err) {
    console.error('[profile:me:update]', err.message || err, err.stack);
    res.status(500).json({ message: err.message || 'Unable to update profile' });
  }
});

router.post('/profile/me/avatar', uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  try {
    const url = await upsertUserAvatarFromUpload({ userId: req.user.id, file: req.file });
    res.json({ avatar_url: url });
  } catch (err) {
    console.error('[hub:profile:me:avatar]', err);
    res.status(500).json({ message: 'Unable to upload avatar' });
  }
});

router.get('/profile', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { rows } = await query(
    `SELECT u.*, cp.monthly_revenue_goal, cp.client_type, cp.client_subtype, cp.client_package,
            cp.website_access_provided, cp.website_access_understood,
            cp.ga4_access_provided, cp.ga4_access_understood,
            cp.google_ads_access_provided, cp.google_ads_access_understood,
            cp.meta_access_provided, cp.meta_access_understood,
            cp.website_forms_details_provided, cp.website_forms_details_understood,
            cp.website_forms_uses_third_party, cp.website_forms_uses_hipaa, cp.website_forms_connected_crm, cp.website_forms_custom,
            cp.website_forms_notes, cp.form_notification_emails
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0] || null;
  const fallback = req.user || null;
  const portalRole = row?.role || (fallback && (req.portalUserId === req.user.id ? req.user.role : null)) || null;
  const includeClientProfile = portalRole === 'client';

  res.json({ user: serializeHubProfileUser(row || fallback, { includeClientProfile }) });
});

router.put('/profile', async (req, res) => {
  const profileUserId = req.portalUserId || req.user.id;
  const identityUserId = req.user.id;
  const isSelfUpdate = req.user.id === profileUserId;
  const canOverridePassword = !isSelfUpdate && req.user.role === 'admin';
  const {
    first_name,
    last_name,
    email,
    password,
    new_password,
    monthly_revenue_goal,
    website_access_provided,
    website_access_understood,
    ga4_access_provided,
    ga4_access_understood,
    google_ads_access_provided,
    google_ads_access_understood,
    meta_access_provided,
    meta_access_understood,
    website_forms_details_provided,
    website_forms_details_understood,
    website_forms_uses_third_party,
    website_forms_uses_hipaa,
    website_forms_connected_crm,
    website_forms_custom,
    website_forms_notes
  } = req.body || {};
  const updates = [];
  const params = [];
  if (first_name) {
    updates.push('first_name = $' + (params.length + 1));
    params.push(first_name);
  }
  if (last_name) {
    updates.push('last_name = $' + (params.length + 1));
    params.push(last_name);
  }
  if (email) {
    updates.push('email = $' + (params.length + 1));
    params.push(email);
  }
  const hasClientProfileUpdate =
    monthly_revenue_goal !== undefined ||
    website_access_provided !== undefined ||
    website_access_understood !== undefined ||
    ga4_access_provided !== undefined ||
    ga4_access_understood !== undefined ||
    google_ads_access_provided !== undefined ||
    google_ads_access_understood !== undefined ||
    meta_access_provided !== undefined ||
    meta_access_understood !== undefined ||
    website_forms_details_provided !== undefined ||
    website_forms_details_understood !== undefined ||
    website_forms_uses_third_party !== undefined ||
    website_forms_uses_hipaa !== undefined ||
    website_forms_connected_crm !== undefined ||
    website_forms_custom !== undefined ||
    website_forms_notes !== undefined;

  // Never allow staff accounts (superadmin/admin/team) to view/update client-only profile fields on themselves.
  // Client profile fields are only valid for actual client accounts (or when acting as a client).
  const isPortalClient = Boolean(req.actingClient) || req.user.role === 'client';
  if (hasClientProfileUpdate && !isPortalClient) {
    return res.status(403).json({ message: 'Client profile fields can only be updated for client accounts.' });
  }

  // Members of a client_account (role='member') get read-only access to account-wide
  // profile data. Only owner/admin (or anchor staff) can mutate client_profiles.
  if (hasClientProfileUpdate && !canWriteAccount(req)) {
    return res.status(403).json({ message: 'You don\'t have permission to update account profile settings', code: 'FORBIDDEN' });
  }

  if (!updates.length && !new_password && !hasClientProfileUpdate) {
    return res.status(400).json({ message: 'No changes provided' });
  }
  try {
    if (new_password) {
      if (!canOverridePassword) {
        if (!password) return res.status(400).json({ message: 'Current password required' });
        const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [identityUserId]);
        const hash = rows[0]?.password_hash;
        const valid = hash && (await bcrypt.compare(password, hash));
        if (!valid) return res.status(400).json({ message: 'Current password incorrect' });
      }
      updates.push('password_hash = $' + (params.length + 1));
      params.push(await bcrypt.hash(new_password, 12));
    }
    if (updates.length) {
      params.push(identityUserId);
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    }

    if (new_password) {
      await logSecurityEvent({
        userId: identityUserId,
        eventType: SecurityEventTypes.PASSWORD_CHANGED,
        eventCategory: SecurityEventCategories.ACCOUNT,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        success: true,
        details: {
          changedBy: req.user.id,
          changedViaSelfService: req.user.id === identityUserId
        }
      });
    }

    // Update client_profiles fields (monthly goal + onboarding access confirmations)
    if (hasClientProfileUpdate) {
      await query(
        `INSERT INTO client_profiles (
           user_id,
           monthly_revenue_goal,
           website_access_provided,
           website_access_understood,
           ga4_access_provided,
           ga4_access_understood,
           google_ads_access_provided,
           google_ads_access_understood,
           meta_access_provided,
           meta_access_understood,
           website_forms_details_provided,
           website_forms_details_understood,
           website_forms_uses_third_party,
           website_forms_uses_hipaa,
           website_forms_connected_crm,
           website_forms_custom,
           website_forms_notes
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (user_id) DO UPDATE SET
           monthly_revenue_goal = COALESCE(EXCLUDED.monthly_revenue_goal, client_profiles.monthly_revenue_goal),
           website_access_provided = COALESCE(EXCLUDED.website_access_provided, client_profiles.website_access_provided),
           website_access_understood = COALESCE(EXCLUDED.website_access_understood, client_profiles.website_access_understood),
           ga4_access_provided = COALESCE(EXCLUDED.ga4_access_provided, client_profiles.ga4_access_provided),
           ga4_access_understood = COALESCE(EXCLUDED.ga4_access_understood, client_profiles.ga4_access_understood),
           google_ads_access_provided = COALESCE(EXCLUDED.google_ads_access_provided, client_profiles.google_ads_access_provided),
           google_ads_access_understood = COALESCE(EXCLUDED.google_ads_access_understood, client_profiles.google_ads_access_understood),
           meta_access_provided = COALESCE(EXCLUDED.meta_access_provided, client_profiles.meta_access_provided),
           meta_access_understood = COALESCE(EXCLUDED.meta_access_understood, client_profiles.meta_access_understood),
           website_forms_details_provided = COALESCE(EXCLUDED.website_forms_details_provided, client_profiles.website_forms_details_provided),
           website_forms_details_understood = COALESCE(EXCLUDED.website_forms_details_understood, client_profiles.website_forms_details_understood),
           website_forms_uses_third_party = COALESCE(EXCLUDED.website_forms_uses_third_party, client_profiles.website_forms_uses_third_party),
           website_forms_uses_hipaa = COALESCE(EXCLUDED.website_forms_uses_hipaa, client_profiles.website_forms_uses_hipaa),
           website_forms_connected_crm = COALESCE(EXCLUDED.website_forms_connected_crm, client_profiles.website_forms_connected_crm),
           website_forms_custom = COALESCE(EXCLUDED.website_forms_custom, client_profiles.website_forms_custom),
           website_forms_notes = COALESCE(EXCLUDED.website_forms_notes, client_profiles.website_forms_notes),
           updated_at = NOW()`,
        [
          profileUserId,
          monthly_revenue_goal === undefined ? null : monthly_revenue_goal || null,
          website_access_provided === undefined ? null : Boolean(website_access_provided),
          website_access_understood === undefined ? null : Boolean(website_access_understood),
          ga4_access_provided === undefined ? null : Boolean(ga4_access_provided),
          ga4_access_understood === undefined ? null : Boolean(ga4_access_understood),
          google_ads_access_provided === undefined ? null : Boolean(google_ads_access_provided),
          google_ads_access_understood === undefined ? null : Boolean(google_ads_access_understood),
          meta_access_provided === undefined ? null : Boolean(meta_access_provided),
          meta_access_understood === undefined ? null : Boolean(meta_access_understood),
          website_forms_details_provided === undefined ? null : Boolean(website_forms_details_provided),
          website_forms_details_understood === undefined ? null : Boolean(website_forms_details_understood),
          website_forms_uses_third_party === undefined ? null : Boolean(website_forms_uses_third_party),
          website_forms_uses_hipaa === undefined ? null : Boolean(website_forms_uses_hipaa),
          website_forms_connected_crm === undefined ? null : Boolean(website_forms_connected_crm),
          website_forms_custom === undefined ? null : Boolean(website_forms_custom),
          website_forms_notes === undefined ? null : String(website_forms_notes || '')
        ]
      );
    }

    const refreshed = await query(
      `SELECT u.*, cp.monthly_revenue_goal, cp.client_type, cp.client_subtype, cp.client_package,
              cp.website_access_provided, cp.website_access_understood,
              cp.ga4_access_provided, cp.ga4_access_understood,
              cp.google_ads_access_provided, cp.google_ads_access_understood,
              cp.meta_access_provided, cp.meta_access_understood,
              cp.website_forms_details_provided, cp.website_forms_details_understood,
              cp.website_forms_uses_third_party, cp.website_forms_uses_hipaa, cp.website_forms_connected_crm, cp.website_forms_custom,
              cp.website_forms_notes
       FROM users u 
       LEFT JOIN client_profiles cp ON cp.user_id = u.id 
       WHERE u.id = $1`,
      [identityUserId]
    );
    const row = refreshed.rows[0] || null;
    if (!row) return res.status(404).json({ message: 'User not found after update' });
    const includeClientProfile = (row?.role || (isPortalClient ? 'client' : null)) === 'client';
    res.json({ user: serializeHubProfileUser(row, { includeClientProfile }) });
  } catch (err) {
    console.error('[profile:update]', err.message || err, err.stack);
    res.status(500).json({ message: err.message || 'Unable to update profile' });
  }
});

// PUT /hub/profile/notifications — client-facing notification settings
router.put('/profile/notifications', async (req, res) => {
  try {
    if (!canWriteAccount(req)) {
      return res.status(403).json({ message: 'You don\'t have permission to change notification settings', code: 'FORBIDDEN' });
    }
    const userId = req.portalUserId || req.user.id;
    const { form_notification_emails } = req.body;

    // Normalize emails: accept comma-separated string or array
    let emails = [];
    if (Array.isArray(form_notification_emails)) {
      emails = form_notification_emails.map((e) => e.trim()).filter(Boolean);
    } else if (typeof form_notification_emails === 'string') {
      emails = form_notification_emails.split(',').map((e) => e.trim()).filter(Boolean);
    }

    // Basic email format validation
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid = emails.filter((e) => !emailRe.test(e));
    if (invalid.length) {
      return res.status(400).json({ message: `Invalid email address(es): ${invalid.join(', ')}` });
    }

    await query(
      `INSERT INTO client_profiles (user_id, form_notification_emails, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET form_notification_emails = EXCLUDED.form_notification_emails,
             updated_at = NOW()`,
      [userId, emails]
    );

    await logClientActivity({
      userId: req.user.id,
      actionType: 'update_notification_settings',
      targetUserId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { recipientCount: emails.length }
    });

    res.json({ success: true, form_notification_emails: emails });
  } catch (err) {
    console.error('[profile:notifications:update]', err.message);
    res.status(500).json({ message: 'Failed to update notification settings' });
  }
});

router.post('/profile/avatar', uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  if (!canWriteAccount(req)) {
    return res.status(403).json({ message: 'You don\'t have permission to change the account avatar', code: 'FORBIDDEN' });
  }
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const url = await upsertUserAvatarFromUpload({ userId: targetUserId, file: req.file });
    res.json({ avatar_url: url });
  } catch (err) {
    console.error('[hub:profile:avatar]', err);
    res.status(500).json({ message: 'Unable to upload avatar' });
  }
});

function attachDisplayLogo(brand) {
  if (brand && brand.display_logo_file_id) {
    brand.display_logo = {
      file_id: brand.display_logo_file_id,
      url: getFileUrl(brand.display_logo_file_id)
    };
  } else if (brand) {
    brand.display_logo = null;
  }
  return brand;
}

router.get('/brand', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { rows } = await query('SELECT * FROM brand_assets WHERE user_id = $1 LIMIT 1', [targetUserId]);
  const brand = rows[0] || {
    business_name: '',
    business_description: '',
    logos: [],
    style_guides: [],
    brand_notes: '',
    website_url: '',
    display_logo_file_id: null
  };
  res.json({ brand: attachDisplayLogo(brand) });
});

router.get('/brand/admin/:userId', isAdminOrEditor, async (req, res) => {
  const target = req.params.userId;
  const { rows } = await query('SELECT * FROM brand_assets WHERE user_id = $1 LIMIT 1', [target]);
  const brand = rows[0] || {
    logos: [],
    style_guides: [],
    business_name: '',
    business_description: '',
    brand_notes: '',
    website_url: '',
    display_logo_file_id: null
  };
  res.json({ brand: attachDisplayLogo(brand) });
});

router.put('/brand/admin/:userId', uploadBrand.none(), isAdminOrEditor, async (req, res) => {
  const target = req.params.userId;
  try {
    const { rows } = await query('SELECT * FROM brand_assets WHERE user_id = $1 LIMIT 1', [target]);
    const existing = rows[0] || {
      logos: [],
      style_guides: []
    };

    const payload = {
      logos: existing.logos || [],
      style_guides: existing.style_guides || [],
      business_name: req.body.business_name ?? existing.business_name ?? '',
      business_description: req.body.business_description ?? existing.business_description ?? '',
      brand_notes: req.body.brand_notes ?? existing.brand_notes ?? '',
      website_url: req.body.website_url ?? existing.website_url ?? ''
    };

    if (rows[0]) {
      await query(
        `UPDATE brand_assets
         SET logos=$1, style_guides=$2, brand_notes=$3, website_url=$4, business_name=$5, business_description=$6, updated_at=NOW()
         WHERE user_id=$7`,
        [JSON.stringify(payload.logos), JSON.stringify(payload.style_guides), payload.brand_notes, payload.website_url, payload.business_name, payload.business_description, target]
      );
    } else {
      await query(
        `INSERT INTO brand_assets (user_id, logos, style_guides, brand_notes, website_url, business_name, business_description)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [target, JSON.stringify(payload.logos), JSON.stringify(payload.style_guides), payload.brand_notes, payload.website_url, payload.business_name, payload.business_description]
      );
    }

    if (payload.website_url) registerDomain(payload.website_url);
    res.json({ brand: payload });
  } catch (err) {
    console.error('[brand admin]', err);
    res.status(500).json({ message: 'Unable to save brand profile' });
  }
});
router.put(
  '/brand',
  uploadBrand.fields([
    { name: 'logos', maxCount: 10 },
    { name: 'style_guide', maxCount: 10 }
  ]),
  async (req, res) => {
    try {
      if (!canWriteAccount(req)) {
        return res.status(403).json({ message: 'You don\'t have permission to update brand settings', code: 'FORBIDDEN' });
      }
      const targetUserId = req.portalUserId || req.user.id;
      const { rows } = await query('SELECT * FROM brand_assets WHERE user_id = $1 LIMIT 1', [targetUserId]);
      const existing = rows[0] || {
        logos: [],
        style_guides: []
      };
      const logos = Array.isArray(existing.logos) ? [...existing.logos] : [];
      const styleGuides = Array.isArray(existing.style_guides) ? [...existing.style_guides] : [];

      (req.files?.logos || []).forEach((file) => {
        logos.push({
          id: uuidv4(),
          name: file.originalname,
          url: publicUrl(file.path)
        });
      });
      (req.files?.style_guide || []).forEach((file) => {
        styleGuides.push({
          id: uuidv4(),
          name: file.originalname,
          url: publicUrl(file.path)
        });
      });

      let deletions = [];
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'deletions')) {
        const raw = req.body.deletions;
        if (typeof raw !== 'string' || raw.trim() === '') {
          return res.status(400).json({ message: 'Invalid deletions format' });
        }
        try { deletions = JSON.parse(raw); } catch { return res.status(400).json({ message: 'Invalid deletions format' }); }
        if (!Array.isArray(deletions)) return res.status(400).json({ message: 'deletions must be an array' });
      }
      deletions.forEach((id) => {
        const remove = (arr) => arr.filter((f) => f.id !== id);
        const before = logos.length;
        const beforeSG = styleGuides.length;
        logos.splice(0, logos.length, ...remove(logos));
        styleGuides.splice(0, styleGuides.length, ...remove(styleGuides));
        if (logos.length !== before || styleGuides.length !== beforeSG) {
          // best effort cleanup of files
        }
      });

      const payload = {
        business_name: req.body.business_name || existing.business_name || '',
        business_description: req.body.business_description || existing.business_description || '',
        logos,
        style_guides: styleGuides,
        brand_notes: req.body.brand_notes || existing.brand_notes || '',
        website_url: req.body.website_url || existing.website_url || ''
      };

      if (rows[0]) {
        await query(
          `UPDATE brand_assets
           SET business_name=$1, business_description=$2, logos=$3, style_guides=$4, brand_notes=$5, website_url=$6, updated_at=NOW()
           WHERE user_id=$7`,
          [
            payload.business_name,
            payload.business_description,
            JSON.stringify(payload.logos),
            JSON.stringify(payload.style_guides),
            payload.brand_notes,
            payload.website_url,
            targetUserId
          ]
        );
      } else {
        await query(
          `INSERT INTO brand_assets (user_id, business_name, business_description, logos, style_guides, brand_notes, website_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            targetUserId,
            payload.business_name,
            payload.business_description,
            JSON.stringify(payload.logos),
            JSON.stringify(payload.style_guides),
            payload.brand_notes,
            payload.website_url
          ]
        );
      }

      if (payload.website_url) registerDomain(payload.website_url);
      res.json({ brand: payload });
    } catch (err) {
      console.error('[brand]', err);
      res.status(500).json({ message: 'Unable to save brand profile' });
    }
  }
);

// Single email-safe display logo (PNG/JPG), stored in file_uploads.
// Distinct from the multi-file `logos` JSONB array above.
const uploadDisplayLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype);
    if (!ok) return cb(new Error('Only PNG or JPG files are allowed'));
    cb(null, true);
  }
});

async function setDisplayLogo(req, targetUserId, file, res) {
  let stored = null;
  try {
    const { rows } = await query(
      `SELECT id, display_logo_file_id FROM brand_assets
        WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [targetUserId]
    );
    stored = await storeFile(file, {
      category: 'brand-display-logo',
      ownerId: targetUserId,
      ownerType: 'user'
    });
    if (rows[0]) {
      await query(
        'UPDATE brand_assets SET display_logo_file_id = $1, updated_at = NOW() WHERE id = $2',
        [stored.id, rows[0].id]
      );
      if (rows[0].display_logo_file_id && rows[0].display_logo_file_id !== stored.id) {
        await deleteFile(rows[0].display_logo_file_id).catch(() => {});
      }
    } else {
      await query(
        'INSERT INTO brand_assets (user_id, display_logo_file_id) VALUES ($1, $2)',
        [targetUserId, stored.id]
      );
    }
    logSecurityEvent({
      userId: req.user?.id || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: true,
      details: { action: 'brand.display_logo.upload', targetUserId, fileId: stored.id }
    }).catch(() => {});
    res.json({ display_logo: { file_id: stored.id, url: stored.url } });
  } catch (err) {
    console.error('[brand:display-logo:upload]', err);
    if (stored?.id) {
      await deleteFile(stored.id).catch(() => {});
    }
    logSecurityEvent({
      userId: req.user?.id || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: false,
      failureReason: err.message || 'upload_failed',
      details: { action: 'brand.display_logo.upload', targetUserId }
    }).catch(() => {});
    res.status(500).json({ message: 'Unable to upload logo' });
  }
}

async function clearDisplayLogo(req, targetUserId, res) {
  try {
    const { rows } = await query(
      `SELECT id, display_logo_file_id FROM brand_assets
        WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [targetUserId]
    );
    const existing = rows[0]?.display_logo_file_id;
    if (existing) {
      await query(
        'UPDATE brand_assets SET display_logo_file_id = NULL, updated_at = NOW() WHERE id = $1',
        [rows[0].id]
      );
      await deleteFile(existing).catch(() => {});
    }
    logSecurityEvent({
      userId: req.user?.id || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: true,
      details: { action: 'brand.display_logo.delete', targetUserId, removedFileId: existing || null }
    }).catch(() => {});
    res.json({ display_logo: null });
  } catch (err) {
    console.error('[brand:display-logo:delete]', err);
    logSecurityEvent({
      userId: req.user?.id || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: false,
      failureReason: err.message || 'delete_failed',
      details: { action: 'brand.display_logo.delete', targetUserId }
    }).catch(() => {});
    res.status(500).json({ message: 'Unable to remove logo' });
  }
}

function uploadDisplayLogoSingle(req, res, next) {
  uploadDisplayLogo.single('logo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 2 MB' : err.message;
      return res.status(400).json({ message });
    }
    next();
  });
}

router.post('/brand/display-logo', uploadDisplayLogoSingle, async (req, res) => {
  if (!canWriteAccount(req)) {
    return res.status(403).json({ message: "You don't have permission to update brand settings", code: 'FORBIDDEN' });
  }
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const targetUserId = req.portalUserId || req.user.id;
  await setDisplayLogo(req, targetUserId, req.file, res);
});

router.delete('/brand/display-logo', async (req, res) => {
  if (!canWriteAccount(req)) {
    return res.status(403).json({ message: "You don't have permission to update brand settings", code: 'FORBIDDEN' });
  }
  const targetUserId = req.portalUserId || req.user.id;
  await clearDisplayLogo(req, targetUserId, res);
});

router.post('/brand/admin/:userId/display-logo', isAdminOrEditor, uploadDisplayLogoSingle, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  await setDisplayLogo(req, req.params.userId, req.file, res);
});

router.delete('/brand/admin/:userId/display-logo', isAdminOrEditor, async (req, res) => {
  await clearDisplayLogo(req, req.params.userId, res);
});

export default router;
