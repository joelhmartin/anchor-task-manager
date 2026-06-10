import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

import { query, getClient } from '../db.js';
import { notRevoked } from '../services/queryHelpers.js';
import { requireAuth } from '../middleware/auth.js';
import { getClientIp } from '../middleware/rateLimit.js';
import { createNotificationsForAdmins, notifyAdminsByEmail } from '../services/notifications.js';
import { isMailgunConfigured, sendMailgunMessageWithLogging } from '../services/mailgun.js';
import { generateClientOnboardingPdf } from '../services/onboardingPdf.js';
import { storeFile, deleteFile, getFileUrl } from '../services/fileStorage.js';
import { logSecurityEvent, SecurityEventTypes, SecurityEventCategories } from '../services/security/index.js';
import { createAuthenticatedSession, trustDevice, extractDeviceInfo, maskEmail, validatePassword, hashPassword } from '../services/security/index.js';

const router = express.Router();

function normalizeBase(value) {
  if (!value) return null;
  let base = String(value).trim();
  if (!/^https?:\/\//i.test(base)) {
    const isLocal = base.startsWith('localhost') || base.startsWith('127.0.0.1');
    base = `${isLocal ? 'http' : 'https'}://${base}`;
  }
  return base.replace(/\/$/, '');
}

function resolveBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const isLocalHost = host && (host.includes('localhost') || host.includes('127.0.0.1'));

  const localOverride = normalizeBase(process.env.LOCAL_APP_BASE_URL);
  if (isLocalHost && localOverride) return localOverride;

  if (isLocalHost && process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }

  const fromEnv = normalizeBase(process.env.APP_BASE_URL || process.env.CLIENT_APP_URL);
  if (fromEnv) return fromEnv;

  if (host) return normalizeBase(`${proto}://${host}`);

  return 'http://localhost:3000';
}

const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
const avatarDir = path.join(uploadRoot, 'avatars');
const brandDir = path.join(uploadRoot, 'brand');
[uploadRoot, avatarDir, brandDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function storage(dir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname?.replace?.(/[^\w.-]+/g, '_') || 'upload';
      cb(null, `${Date.now()}_${safeName}`);
    }
  });
}

const uploadAvatar = multer({ storage: storage(avatarDir) });

const BRAND_UPLOAD_MAX_BYTES = parseInt(process.env.ONBOARDING_BRAND_UPLOAD_MAX_BYTES || String(25 * 1024 * 1024), 10); // 25MB
const BRAND_ALLOWED_MIME_TYPES = new Set([
  // images
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/jfif',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/svg+xml',
  // docs
  'application/pdf',
  'text/plain',
  'text/rtf',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // archives (common for brand asset bundles)
  'application/zip',
  'application/x-zip-compressed'
]);

const BRAND_ALLOWED_EXTENSIONS = new Set([
  // images
  '.png',
  '.jpg',
  '.jpeg',
  '.jfif',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.svg',
  // docs
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.rtf',
  // archives
  '.zip'
]);

const uploadBrandAsset = multer({
  storage: storage(brandDir),
  limits: { fileSize: BRAND_UPLOAD_MAX_BYTES, files: 15 },
  fileFilter: (_req, file, cb) => {
    // Some browsers/clients send odd or empty mimetypes. Fall back to extension allowlist.
    const type = String(file.mimetype || '')
      .toLowerCase()
      .trim();
    const ext = path.extname(String(file.originalname || '')).toLowerCase();

    const typeAllowed = !type || BRAND_ALLOWED_MIME_TYPES.has(type) || type === 'application/octet-stream';
    const extAllowed = !ext || BRAND_ALLOWED_EXTENSIONS.has(ext);

    if (!typeAllowed || !extAllowed) {
      return cb(new Error(`Unsupported file type. mime=${type || '(none)'} ext=${ext || '(none)'}`));
    }
    return cb(null, true);
  }
});

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function upsertBrandAssetsLogos({ userId, nextLogos }) {
  // brand_assets does not guarantee UNIQUE(user_id) in older DBs.
  // Avoid `ON CONFLICT (user_id)` and instead update the newest row for the user (or insert).
  const existing = await query('SELECT id FROM brand_assets WHERE user_id = $1 ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1', [
    userId
  ]);
  const rowId = existing.rows[0]?.id;
  const json = JSON.stringify(Array.isArray(nextLogos) ? nextLogos : []);

  if (rowId) {
    await query('UPDATE brand_assets SET logos = $1, updated_at = NOW() WHERE id = $2', [json, rowId]);
    return;
  }

  await query('INSERT INTO brand_assets (user_id, logos, updated_at) VALUES ($1, $2, NOW())', [userId, json]);
}

async function getTokenRecord(token, dbClientOrNull) {
  const tokenHash = hashToken(token);
  const runner = dbClientOrNull || { query: (sql, params) => query(sql, params) };
  const { rows } = await runner.query(
    `SELECT t.*
     FROM client_onboarding_tokens t
     LEFT JOIN client_profiles cp ON cp.user_id = t.user_id
     WHERE t.token_hash = $1
       AND t.consumed_at IS NULL
       AND ${notRevoked('t')}
       AND (t.expires_at IS NULL OR t.expires_at > NOW())
       AND cp.onboarding_completed_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function getLockedTokenRecord(dbClient, token) {
  const tokenHash = hashToken(token);
  const { rows } = await dbClient.query(
    `SELECT t.*
     FROM client_onboarding_tokens t
     LEFT JOIN client_profiles cp ON cp.user_id = t.user_id
     WHERE t.token_hash = $1
       AND t.consumed_at IS NULL
       AND ${notRevoked('t')}
       AND (t.expires_at IS NULL OR t.expires_at > NOW())
       AND cp.onboarding_completed_at IS NULL
     LIMIT 1
     FOR UPDATE OF t SKIP LOCKED`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function getOnboardingPayloadForUser(userId) {
  const [{ rows: userRows }, { rows: brandRows }, { rows: servicesRows }] = await Promise.all([
    query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.avatar_url, u.password_hash,
              cp.*, COALESCE(cp.client_identifier_value, '') AS client_identifier_value
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    ),
    query('SELECT * FROM brand_assets WHERE user_id = $1 LIMIT 1', [userId]),
    query('SELECT id, name, description, base_price, active FROM services WHERE user_id = $1 ORDER BY name ASC', [userId])
  ]);

  if (!userRows.length) return null;

  // Normalize JSON columns that may come back as strings in some pg setups.
  const normalizeJson = (v) => {
    if (!v) return v;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  };

  const brandRow = brandRows[0] || null;
  const brand = brandRow
    ? {
        ...brandRow,
        logos: Array.isArray(normalizeJson(brandRow.logos)) ? normalizeJson(brandRow.logos) : [],
        display_logo: brandRow.display_logo_file_id
          ? { file_id: brandRow.display_logo_file_id, url: getFileUrl(brandRow.display_logo_file_id) }
          : null
      }
    : null;

  const profile = userRows[0] || {};

  return {
    user: {
      id: profile.id,
      email: profile.email,
      first_name: profile.first_name,
      last_name: profile.last_name,
      avatar_url: profile.avatar_url || null,
      has_password: Boolean(profile.password_hash)
    },
    profile: {
      monthly_revenue_goal: profile.monthly_revenue_goal || '',
      client_identifier_value: profile.client_identifier_value || '',
      requires_website_access: profile.requires_website_access !== false,
      requires_ga4_access: profile.requires_ga4_access !== false,
      requires_google_ads_access: profile.requires_google_ads_access !== false,
      requires_meta_access: profile.requires_meta_access !== false,
      requires_forms_step: profile.requires_forms_step !== false,
      call_tracking_main_number: profile.call_tracking_main_number || '',
      front_desk_emails: profile.front_desk_emails || '',
      office_admin_name: profile.office_admin_name || '',
      office_admin_email: profile.office_admin_email || '',
      office_admin_phone: profile.office_admin_phone || '',
      form_email_recipients: profile.form_email_recipients || '',
      website_access_status: profile.website_access_status || '',
      ga4_access_status: profile.ga4_access_status || '',
      google_ads_access_status: profile.google_ads_access_status || '',
      google_ads_account_id: profile.google_ads_account_id || '',
      meta_access_status: profile.meta_access_status || '',
      website_forms_details_status: profile.website_forms_details_status || '',
      ai_prompt: profile.ai_prompt || '',
      website_access_provided: profile.website_access_provided || false,
      website_access_understood: profile.website_access_understood || false,
      ga4_access_provided: profile.ga4_access_provided || false,
      ga4_access_understood: profile.ga4_access_understood || false,
      google_ads_access_provided: profile.google_ads_access_provided || false,
      google_ads_access_understood: profile.google_ads_access_understood || false,
      meta_access_provided: profile.meta_access_provided || false,
      meta_access_understood: profile.meta_access_understood || false,
      website_forms_details_provided: profile.website_forms_details_provided || false,
      website_forms_details_understood: profile.website_forms_details_understood || false,
      website_forms_uses_third_party: profile.website_forms_uses_third_party || false,
      website_forms_uses_hipaa: profile.website_forms_uses_hipaa || false,
      website_forms_connected_crm: profile.website_forms_connected_crm || false,
      website_forms_custom: profile.website_forms_custom || false,
      website_forms_notes: profile.website_forms_notes || '',
      onboarding_completed_at: profile.onboarding_completed_at || null,
      onboarding_draft_json: normalizeJson(profile.onboarding_draft_json) || null,
      onboarding_draft_saved_at: profile.onboarding_draft_saved_at || null,
      client_type: profile.client_type || null,
      client_subtype: profile.client_subtype || null,
      onboarding_questionnaire: normalizeJson(profile.onboarding_questionnaire) || {}
    },
    brand,
    services: servicesRows
  };
}

async function saveOnboardingDraftForUser(userId, draftJson) {
  await query(
    `INSERT INTO client_profiles (user_id, onboarding_draft_json, onboarding_draft_saved_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET onboarding_draft_json = EXCLUDED.onboarding_draft_json, onboarding_draft_saved_at = NOW(), updated_at = NOW()`,
    [userId, draftJson || null]
  );
}

async function getAdminNotificationEmails() {
  // Prefer superadmins; if none exist, fall back to admins.
  let rows = (await query("SELECT email FROM users WHERE role = 'superadmin' AND email IS NOT NULL")).rows;
  if (!rows.length) {
    rows = (await query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL")).rows;
  }
  const recipients = rows.map((r) => r.email).filter(Boolean);
  if (!recipients.length && process.env.ADMIN_NOTIFICATION_EMAIL) {
    recipients.push(process.env.ADMIN_NOTIFICATION_EMAIL);
  }
  // de-dupe
  return Array.from(new Set(recipients));
}

// =========================
// AUTHENTICATED ONBOARDING
// =========================

// GET /api/onboarding/me - resume onboarding as logged-in client
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.portalUserId;
    const payload = await getOnboardingPayloadForUser(userId);
    if (!payload) return res.status(404).json({ message: 'Client not found for onboarding' });
    res.json(payload);
  } catch (err) {
    console.error('[onboarding:me:get]', err);
    res.status(500).json({ message: 'Unable to load onboarding data' });
  }
});

// POST /api/onboarding/me/draft - save draft state (no completion side effects)
router.post('/me/draft', requireAuth, async (req, res) => {
  try {
    const userId = req.portalUserId;
    const { draft } = req.body || {};
    await saveOnboardingDraftForUser(userId, draft || null);
    res.json({ success: true });
  } catch (err) {
    console.error('[onboarding:me:draft]', err);
    res.status(500).json({ message: 'Unable to save onboarding draft' });
  }
});

// POST /api/onboarding/me/submit - finalize onboarding (sends notifications, marks completed)
router.post('/me/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.portalUserId;
    const {
      display_name,
      password,
      monthly_revenue_goal,
      brand = {},
      services = [],
      client_identifier_value,
      call_tracking_main_number,
      front_desk_emails,
      office_admin_name,
      office_admin_email,
      office_admin_phone,
      form_email_recipients,
      website_access_status,
      ga4_access_status,
      google_ads_access_status,
      google_ads_account_id,
      meta_access_status,
      website_forms_details_status,
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
      website_forms_notes,
      onboarding_questionnaire
    } = req.body || {};

    if (!display_name) return res.status(400).json({ message: 'Display name is required' });
    if (password) {
      const pwResult = validatePassword(password);
      if (!pwResult.valid) {
        return res.status(400).json({ message: pwResult.errors[0] || 'Password does not meet requirements' });
      }
    }

    const nameParts = display_name.trim().split(' ').filter(Boolean);
    const firstName = nameParts.shift() || display_name.trim();
    const lastName = nameParts.join(' ');
    const updates = [];
    const params = [];
    if (firstName) {
      updates.push('first_name = $' + (params.length + 1));
      params.push(firstName);
    }
    updates.push('last_name = $' + (params.length + 1));
    params.push(lastName);
    if (password) {
      updates.push('password_hash = $' + (params.length + 1));
      params.push(await hashPassword(password));
    }
    if (updates.length) {
      params.push(userId);
      await query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
    }

    if (
      monthly_revenue_goal !== undefined ||
      client_identifier_value !== undefined ||
      call_tracking_main_number !== undefined ||
      front_desk_emails !== undefined ||
      office_admin_name !== undefined ||
      office_admin_email !== undefined ||
      office_admin_phone !== undefined ||
      form_email_recipients !== undefined ||
      website_access_status !== undefined ||
      ga4_access_status !== undefined ||
      google_ads_access_status !== undefined ||
      google_ads_account_id !== undefined ||
      meta_access_status !== undefined ||
      website_forms_details_status !== undefined ||
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
      website_forms_notes !== undefined ||
      onboarding_questionnaire !== undefined
    ) {
      await query(
        `INSERT INTO client_profiles (
           user_id,
           monthly_revenue_goal,
           client_identifier_value,
           call_tracking_main_number,
           front_desk_emails,
           office_admin_name,
           office_admin_email,
           office_admin_phone,
           form_email_recipients,
           website_access_status,
           ga4_access_status,
           google_ads_access_status,
           google_ads_account_id,
           meta_access_status,
           website_forms_details_status,
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
           website_forms_notes,
           onboarding_questionnaire
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         ON CONFLICT (user_id) DO UPDATE SET
           monthly_revenue_goal = EXCLUDED.monthly_revenue_goal,
           client_identifier_value = EXCLUDED.client_identifier_value,
           call_tracking_main_number = EXCLUDED.call_tracking_main_number,
           front_desk_emails = EXCLUDED.front_desk_emails,
           office_admin_name = EXCLUDED.office_admin_name,
           office_admin_email = EXCLUDED.office_admin_email,
           office_admin_phone = EXCLUDED.office_admin_phone,
           form_email_recipients = EXCLUDED.form_email_recipients,
           website_access_status = EXCLUDED.website_access_status,
           ga4_access_status = EXCLUDED.ga4_access_status,
           google_ads_access_status = EXCLUDED.google_ads_access_status,
           google_ads_account_id = EXCLUDED.google_ads_account_id,
           meta_access_status = EXCLUDED.meta_access_status,
           website_forms_details_status = EXCLUDED.website_forms_details_status,
           website_access_provided = EXCLUDED.website_access_provided,
           website_access_understood = EXCLUDED.website_access_understood,
           ga4_access_provided = EXCLUDED.ga4_access_provided,
           ga4_access_understood = EXCLUDED.ga4_access_understood,
           google_ads_access_provided = EXCLUDED.google_ads_access_provided,
           google_ads_access_understood = EXCLUDED.google_ads_access_understood,
           meta_access_provided = EXCLUDED.meta_access_provided,
           meta_access_understood = EXCLUDED.meta_access_understood,
           website_forms_details_provided = EXCLUDED.website_forms_details_provided,
           website_forms_details_understood = EXCLUDED.website_forms_details_understood,
           website_forms_uses_third_party = EXCLUDED.website_forms_uses_third_party,
           website_forms_uses_hipaa = EXCLUDED.website_forms_uses_hipaa,
           website_forms_connected_crm = EXCLUDED.website_forms_connected_crm,
           website_forms_custom = EXCLUDED.website_forms_custom,
           website_forms_notes = EXCLUDED.website_forms_notes,
           onboarding_questionnaire = EXCLUDED.onboarding_questionnaire,
           updated_at = NOW()`,
        [
          userId,
          monthly_revenue_goal || null,
          client_identifier_value || null,
          call_tracking_main_number ? String(call_tracking_main_number) : null,
          front_desk_emails ? String(front_desk_emails) : null,
          office_admin_name ? String(office_admin_name) : null,
          office_admin_email ? String(office_admin_email) : null,
          office_admin_phone ? String(office_admin_phone) : null,
          form_email_recipients ? String(form_email_recipients) : null,
          website_access_status ? String(website_access_status) : null,
          ga4_access_status ? String(ga4_access_status) : null,
          google_ads_access_status ? String(google_ads_access_status) : null,
          google_ads_account_id ? String(google_ads_account_id) : null,
          meta_access_status ? String(meta_access_status) : null,
          website_forms_details_status ? String(website_forms_details_status) : null,
          Boolean(website_access_provided),
          Boolean(website_access_understood),
          Boolean(ga4_access_provided),
          Boolean(ga4_access_understood),
          Boolean(google_ads_access_provided),
          Boolean(google_ads_access_understood),
          Boolean(meta_access_provided),
          Boolean(meta_access_understood),
          Boolean(website_forms_details_provided),
          Boolean(website_forms_details_understood),
          Boolean(website_forms_uses_third_party),
          Boolean(website_forms_uses_hipaa),
          Boolean(website_forms_connected_crm),
          Boolean(website_forms_custom),
          website_forms_notes ? String(website_forms_notes) : null,
          onboarding_questionnaire ? JSON.stringify(onboarding_questionnaire) : '{}'
        ]
      );
    }

    if (brand && Object.keys(brand).length) {
      const existing = await query('SELECT * FROM brand_assets WHERE user_id = $1 LIMIT 1', [userId]);
      const payload = {
        business_name: brand.business_name || existing.rows[0]?.business_name || '',
        business_description: brand.business_description || existing.rows[0]?.business_description || '',
        primary_brand_colors: brand.primary_brand_colors || existing.rows[0]?.primary_brand_colors || '',
        brand_notes: brand.brand_notes || existing.rows[0]?.brand_notes || '',
        website_url: brand.website_url || existing.rows[0]?.website_url || ''
      };

      if (existing.rows.length) {
        await query(
          `UPDATE brand_assets
           SET business_name=$1, business_description=$2, primary_brand_colors=$3, brand_notes=$4, website_url=$5, updated_at=NOW()
           WHERE user_id=$6`,
          [
            payload.business_name,
            payload.business_description,
            payload.primary_brand_colors,
            payload.brand_notes,
            payload.website_url,
            userId
          ]
        );
      } else {
        await query(
          `INSERT INTO brand_assets (user_id, business_name, business_description, primary_brand_colors, brand_notes, website_url)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            userId,
            payload.business_name,
            payload.business_description,
            payload.primary_brand_colors,
            payload.brand_notes,
            payload.website_url
          ]
        );
      }
    }

    if (Array.isArray(services)) {
      // Deduplicate by lowercase name — last entry wins (matches admin endpoint pattern)
      const seen = new Map();
      for (const service of services) {
        const name = (service?.name || '').trim();
        if (!name) continue;
        seen.set(name.toLowerCase(), {
          name,
          description: service.description || '',
          base_price: service.base_price !== undefined && service.base_price !== null ? service.base_price : 0,
          active: service.active !== false
        });
      }
      await query('DELETE FROM services WHERE user_id = $1', [userId]);
      for (const service of seen.values()) {
        await query(
          `INSERT INTO services (user_id, name, description, base_price, active)
           VALUES ($1,$2,$3,$4,$5)`,
          [userId, service.name, service.description, service.base_price, service.active]
        );
      }
    }

    // Mark onboarding as completed, clear draft, revoke any outstanding tokens.
    await query(
      `INSERT INTO client_profiles (user_id, onboarding_completed_at, onboarding_draft_json, onboarding_draft_saved_at)
       VALUES ($1, NOW(), NULL, NULL)
       ON CONFLICT (user_id) DO UPDATE SET onboarding_completed_at = NOW(), onboarding_draft_json = NULL, onboarding_draft_saved_at = NULL, updated_at = NOW()`,
      [userId]
    );
    await query(`UPDATE client_onboarding_tokens SET revoked_at = NOW() WHERE user_id = $1 AND ${notRevoked()}`, [userId]);

    const { rows: userInfoRows } = await query('SELECT email, first_name, last_name FROM users WHERE id = $1', [userId]);
    const onboardedUser = userInfoRows[0] || {};

    await createNotificationsForAdmins({
      title: 'Client onboarding completed',
      body: `${display_name || onboardedUser.email || 'Client'} just finished onboarding.`,
      linkUrl: '/client-hub',
      meta: { client_id: userId }
    });

    const baseUrl = resolveBaseUrl(req);
    await notifyAdminsByEmail({
      subject: `Client onboarding completed: ${display_name || 'New Client'}`,
      text: `${display_name || onboardedUser.email || 'A client'} finished onboarding.\n\nView details: ${baseUrl}/client-hub`,
      html: `<p>${display_name || onboardedUser.email || 'A client'} finished onboarding.</p><p><a href="${baseUrl}/client-hub" target="_blank" rel="noopener">Open the Admin Hub</a></p>`
    });

    // Generate onboarding PDF and save to documents
    let pdfBuffer = null;
    let pdfFilename = null;
    try {
      const payload = await getOnboardingPayloadForUser(userId);
      const { buffer, filename } = await generateClientOnboardingPdf({ payload });
      pdfBuffer = buffer;
      pdfFilename = filename;

      // Save PDF to database-backed file storage (persists across Cloud Run deploys)
      const { url: docUrl } = await storeFile(
        { buffer, mimetype: 'application/pdf', originalname: filename },
        { category: 'onboarding-pdf', ownerId: userId, ownerType: 'user' }
      );

      // Insert document record so it appears in client's Documents tab
      await query(
        `INSERT INTO documents (user_id, label, name, url, origin, type, review_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, 'Onboarding Summary', filename, docUrl, 'system', 'onboarding', 'none']
      );
    } catch (pdfErr) {
      console.error('[onboarding:me:submit:pdf-save]', pdfErr);
    }

    // Client-facing confirmation email with PDF attachment
    try {
      if (isMailgunConfigured() && onboardedUser.email && pdfBuffer) {
        const bccAdmins = await getAdminNotificationEmails();
        await sendMailgunMessageWithLogging(
          {
            to: [onboardedUser.email],
            cc: ['jvenner@anchorcorps.com', 'jdowning@anchorcorps.com', 'scapece@anchorcorps.com'],
            bcc: bccAdmins,
            subject: 'Anchor Corps — Onboarding Complete',
            text: `Hello,

Thank you for completing your onboarding. We've received your information and your account is ready for the next steps.

A PDF copy of your completed onboarding is attached for your records.

If you have any questions, reply to your onboarding email or reach out to us directly.

Thank you,
— Anchor Corps`,
            html: `<p>Hello,</p>
<p>Thank you for completing your onboarding. We've received your information and your account is ready for the next steps.</p>
<p>We will begin building your account shortly and will reach out when it's ready.</p>
<p>A PDF copy of your completed onboarding is attached for your records.</p>
<hr />
<p>If you have any questions, reply to your onboarding email or reach out to us directly.</p>
<p><i>Thank you,</i></p>
<p><strong>— Anchor Corps</strong></p>`,
            attachments: [{ data: pdfBuffer, filename: pdfFilename, contentType: 'application/pdf' }]
          },
          {
            emailType: 'onboarding_complete',
            recipientName: display_name,
            clientId: userId,
            metadata: { has_pdf_attachment: true }
          }
        );
      }
    } catch (emailErr) {
      console.error('[onboarding:me:submit:email]', emailErr);
    }

    res.json({ message: 'Onboarding information saved', user_id: userId });
  } catch (err) {
    console.error('[onboarding:me:submit]', err);
    res.status(500).json({ message: err.message || 'Unable to save onboarding information' });
  }
});

// =========================
// TOKEN-BASED ONBOARDING
// =========================

// POST /api/onboarding/:token/draft - save draft state while using a link (still pending)
router.post('/:token/draft', async (req, res) => {
  try {
    const record = await getTokenRecord(req.params.token);
    if (!record) return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
    const { draft } = req.body || {};
    await saveOnboardingDraftForUser(record.user_id, draft || null);
    res.json({ success: true });
  } catch (err) {
    console.error('[onboarding:token:draft]', err);
    res.status(500).json({ message: 'Unable to save onboarding draft' });
  }
});

// POST /api/onboarding/:token/activate - step 1 completion: set password + revoke all links (no completion email/notifications)
// This endpoint returns session tokens directly, bypassing MFA, since the onboarding token itself serves as verification.
router.post('/:token/activate', async (req, res) => {
  const { display_name, password, email } = req.body || {};
  if (!display_name) return res.status(400).json({ message: 'Display name is required' });
  if (!password) return res.status(400).json({ message: 'Password is required' });
  const pwResult = validatePassword(String(password));
  if (!pwResult.valid) return res.status(400).json({ message: pwResult.errors[0] || 'Password does not meet requirements' });
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  let dbClient;
  try {
    dbClient = await getClient();
    await dbClient.query('BEGIN');

    // Atomically lock the token to prevent double-activation race condition.
    // FOR UPDATE SKIP LOCKED ensures a concurrent request returns zero rows instead of blocking.
    const tokenHash = hashToken(req.params.token);
    const { rows: tokenRows } = await dbClient.query(
      `SELECT t.*
       FROM client_onboarding_tokens t
       LEFT JOIN client_profiles cp ON cp.user_id = t.user_id
       WHERE t.token_hash = $1
         AND t.consumed_at IS NULL
         AND ${notRevoked('t')}
         AND (t.expires_at IS NULL OR t.expires_at > NOW())
         AND cp.onboarding_completed_at IS NULL
       LIMIT 1
       FOR UPDATE OF t SKIP LOCKED`,
      [tokenHash]
    );
    const record = tokenRows[0] || null;
    if (!record) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email is already in use by another user
    const { rows: existingEmail } = await dbClient.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [normalizedEmail, record.user_id]
    );
    if (existingEmail.length > 0) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ message: 'This email is already in use by another account' });
    }

    const nameParts = String(display_name).trim().split(' ').filter(Boolean);
    const firstName = nameParts.shift() || String(display_name).trim();
    const lastName = nameParts.join(' ');

    // Update user with email, name, and password
    // Also set email_verified_at since they came through a secure token link
    await dbClient.query(
      `UPDATE users SET email = $1, first_name = $2, last_name = $3, password_hash = $4, email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW() WHERE id = $5`,
      [normalizedEmail, firstName, lastName, await hashPassword(String(password)), record.user_id]
    );

    // Mark this specific token as consumed (within the same transaction)
    // Note: We do NOT revoke all tokens here - that happens when onboarding is fully completed.
    await dbClient.query('UPDATE client_onboarding_tokens SET consumed_at = NOW() WHERE id = $1', [record.id]);

    // Fetch the updated user for session creation
    const { rows: userRows } = await dbClient.query(
      'SELECT id, email, first_name, last_name, role, avatar_url FROM users WHERE id = $1',
      [record.user_id]
    );
    const user = userRows[0];
    if (!user) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found after activation' });
    }

    await dbClient.query('COMMIT');

    // Session creation happens outside the transaction — it doesn't need atomicity
    try {
      const deviceInfo = extractDeviceInfo(req);
      const ipAddress = getClientIp(req);

      const session = await createAuthenticatedSession(user, deviceInfo, {
        trustDevice: true,
        ipAddress,
        userAgent: req.headers['user-agent'],
      });

      // Trust the device for future logins
      await trustDevice(user.id, deviceInfo, { ipAddress, userAgent: req.headers['user-agent'] });

      // Set refresh token cookie
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('refresh_token', session.refreshToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/'
      });

      console.log(`[onboarding:activate] User ${maskEmail(user.email)} activated and logged in via onboarding token`);

      res.json({
        success: true,
        user_id: record.user_id,
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn
      });
    } catch (postCommitErr) {
      // Account was activated (committed) but session creation failed — do NOT rollback.
      console.error('[onboarding:activate] Post-commit session creation failed:', postCommitErr);
      res.json({ success: true, message: 'Account activated; please log in' });
    }
  } catch (err) {
    await dbClient?.query('ROLLBACK').catch(() => {});
    console.error('[onboarding:activate]', err);
    res.status(500).json({ message: err.message || 'Unable to activate account' });
  } finally {
    dbClient?.release();
  }
});

router.get('/:token', async (req, res) => {
  try {
    const record = await getTokenRecord(req.params.token);
    if (!record) return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
    const payload = await getOnboardingPayloadForUser(record.user_id);
    if (!payload) return res.status(404).json({ message: 'Client not found for onboarding' });
    res.json(payload);
  } catch (err) {
    console.error('[onboarding:get]', err);
    res.status(500).json({ message: 'Unable to load onboarding data' });
  }
});

router.post('/:token', async (req, res) => {
  let dbClient;
  try {
    const {
      display_name,
      password,
      monthly_revenue_goal,
      brand = {},
      services = [],
      client_identifier_value,
      call_tracking_main_number,
      front_desk_emails,
      office_admin_name,
      office_admin_email,
      office_admin_phone,
      form_email_recipients,
      website_access_status,
      ga4_access_status,
      google_ads_access_status,
      google_ads_account_id,
      meta_access_status,
      website_forms_details_status,
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
      website_forms_notes,
      onboarding_questionnaire
    } = req.body || {};

    if (!display_name) return res.status(400).json({ message: 'Display name is required' });
    if (password) {
      const pwResult = validatePassword(password);
      if (!pwResult.valid) {
        return res.status(400).json({ message: pwResult.errors[0] || 'Password does not meet requirements' });
      }
    }

    // Acquire a transactional lock and consume the token AFTER validation passes,
    // so a correctable validation error above doesn't burn the onboarding link.
    // SKIP LOCKED makes a concurrent submission immediately return 404 rather than block.
    dbClient = await getClient();
    await dbClient.query('BEGIN');
    const record = await getLockedTokenRecord(dbClient, req.params.token);
    if (!record) {
      await dbClient.query('ROLLBACK');
      dbClient.release();
      dbClient = null;
      return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
    }
    // Consume the token inside the lock to prevent double-processing.
    await dbClient.query('UPDATE client_onboarding_tokens SET consumed_at = NOW() WHERE id = $1', [record.id]);
    await dbClient.query(
      `UPDATE client_onboarding_tokens SET revoked_at = NOW() WHERE user_id = $1 AND id <> $2 AND consumed_at IS NULL AND ${notRevoked()}`,
      [record.user_id, record.id]
    );
    await dbClient.query('COMMIT');
    dbClient.release();
    dbClient = null;

    const nameParts = display_name.trim().split(' ').filter(Boolean);
    const firstName = nameParts.shift() || display_name.trim();
    const lastName = nameParts.join(' ');
    const updates = [];
    const params = [];
    if (firstName) {
      updates.push('first_name = $' + (params.length + 1));
      params.push(firstName);
    }
    updates.push('last_name = $' + (params.length + 1));
    params.push(lastName);
    if (password) {
      updates.push('password_hash = $' + (params.length + 1));
      params.push(await hashPassword(password));
    }
    if (updates.length) {
      params.push(record.user_id);
      await query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
    }

    if (
      monthly_revenue_goal !== undefined ||
      client_identifier_value !== undefined ||
      call_tracking_main_number !== undefined ||
      front_desk_emails !== undefined ||
      office_admin_name !== undefined ||
      office_admin_email !== undefined ||
      office_admin_phone !== undefined ||
      form_email_recipients !== undefined ||
      website_access_status !== undefined ||
      ga4_access_status !== undefined ||
      google_ads_access_status !== undefined ||
      google_ads_account_id !== undefined ||
      meta_access_status !== undefined ||
      website_forms_details_status !== undefined ||
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
      website_forms_notes !== undefined ||
      onboarding_questionnaire !== undefined
    ) {
      await query(
        `INSERT INTO client_profiles (
           user_id,
           monthly_revenue_goal,
           client_identifier_value,
           call_tracking_main_number,
           front_desk_emails,
           office_admin_name,
           office_admin_email,
           office_admin_phone,
           form_email_recipients,
           website_access_status,
           ga4_access_status,
           google_ads_access_status,
           google_ads_account_id,
           meta_access_status,
           website_forms_details_status,
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
           website_forms_notes,
           onboarding_questionnaire
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         ON CONFLICT (user_id) DO UPDATE SET
           monthly_revenue_goal = EXCLUDED.monthly_revenue_goal,
           client_identifier_value = EXCLUDED.client_identifier_value,
           call_tracking_main_number = EXCLUDED.call_tracking_main_number,
           front_desk_emails = EXCLUDED.front_desk_emails,
           office_admin_name = EXCLUDED.office_admin_name,
           office_admin_email = EXCLUDED.office_admin_email,
           office_admin_phone = EXCLUDED.office_admin_phone,
           form_email_recipients = EXCLUDED.form_email_recipients,
           website_access_status = EXCLUDED.website_access_status,
           ga4_access_status = EXCLUDED.ga4_access_status,
           google_ads_access_status = EXCLUDED.google_ads_access_status,
           google_ads_account_id = EXCLUDED.google_ads_account_id,
           meta_access_status = EXCLUDED.meta_access_status,
           website_forms_details_status = EXCLUDED.website_forms_details_status,
           website_access_provided = EXCLUDED.website_access_provided,
           website_access_understood = EXCLUDED.website_access_understood,
           ga4_access_provided = EXCLUDED.ga4_access_provided,
           ga4_access_understood = EXCLUDED.ga4_access_understood,
           google_ads_access_provided = EXCLUDED.google_ads_access_provided,
           google_ads_access_understood = EXCLUDED.google_ads_access_understood,
           meta_access_provided = EXCLUDED.meta_access_provided,
           meta_access_understood = EXCLUDED.meta_access_understood,
           website_forms_details_provided = EXCLUDED.website_forms_details_provided,
           website_forms_details_understood = EXCLUDED.website_forms_details_understood,
           website_forms_uses_third_party = EXCLUDED.website_forms_uses_third_party,
           website_forms_uses_hipaa = EXCLUDED.website_forms_uses_hipaa,
           website_forms_connected_crm = EXCLUDED.website_forms_connected_crm,
           website_forms_custom = EXCLUDED.website_forms_custom,
           website_forms_notes = EXCLUDED.website_forms_notes,
           onboarding_questionnaire = EXCLUDED.onboarding_questionnaire,
           updated_at = NOW()`,
        [
          record.user_id,
          monthly_revenue_goal || null,
          client_identifier_value || null,
          call_tracking_main_number ? String(call_tracking_main_number) : null,
          front_desk_emails ? String(front_desk_emails) : null,
          office_admin_name ? String(office_admin_name) : null,
          office_admin_email ? String(office_admin_email) : null,
          office_admin_phone ? String(office_admin_phone) : null,
          form_email_recipients ? String(form_email_recipients) : null,
          website_access_status ? String(website_access_status) : null,
          ga4_access_status ? String(ga4_access_status) : null,
          google_ads_access_status ? String(google_ads_access_status) : null,
          google_ads_account_id ? String(google_ads_account_id) : null,
          meta_access_status ? String(meta_access_status) : null,
          website_forms_details_status ? String(website_forms_details_status) : null,
          Boolean(website_access_provided),
          Boolean(website_access_understood),
          Boolean(ga4_access_provided),
          Boolean(ga4_access_understood),
          Boolean(google_ads_access_provided),
          Boolean(google_ads_access_understood),
          Boolean(meta_access_provided),
          Boolean(meta_access_understood),
          Boolean(website_forms_details_provided),
          Boolean(website_forms_details_understood),
          Boolean(website_forms_uses_third_party),
          Boolean(website_forms_uses_hipaa),
          Boolean(website_forms_connected_crm),
          Boolean(website_forms_custom),
          website_forms_notes ? String(website_forms_notes) : null,
          onboarding_questionnaire ? JSON.stringify(onboarding_questionnaire) : '{}'
        ]
      );
    }

    if (brand && Object.keys(brand).length) {
      const existing = await query('SELECT * FROM brand_assets WHERE user_id = $1 LIMIT 1', [record.user_id]);
      const payload = {
        business_name: brand.business_name || existing.rows[0]?.business_name || '',
        business_description: brand.business_description || existing.rows[0]?.business_description || '',
        primary_brand_colors: brand.primary_brand_colors || existing.rows[0]?.primary_brand_colors || '',
        brand_notes: brand.brand_notes || existing.rows[0]?.brand_notes || '',
        website_url: brand.website_url || existing.rows[0]?.website_url || ''
      };

      if (existing.rows.length) {
        await query(
          `UPDATE brand_assets
           SET business_name=$1, business_description=$2, primary_brand_colors=$3, brand_notes=$4, website_url=$5, updated_at=NOW()
           WHERE user_id=$6`,
          [
            payload.business_name,
            payload.business_description,
            payload.primary_brand_colors,
            payload.brand_notes,
            payload.website_url,
            record.user_id
          ]
        );
      } else {
        await query(
          `INSERT INTO brand_assets (user_id, business_name, business_description, primary_brand_colors, brand_notes, website_url)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            record.user_id,
            payload.business_name,
            payload.business_description,
            payload.primary_brand_colors,
            payload.brand_notes,
            payload.website_url
          ]
        );
      }
    }

    if (Array.isArray(services)) {
      await query('DELETE FROM services WHERE user_id = $1', [record.user_id]);
      for (const service of services) {
        if (!service?.name) continue;
        await query(
          `INSERT INTO services (user_id, name, description, base_price, active)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            record.user_id,
            service.name.trim(),
            service.description || '',
            service.base_price !== undefined && service.base_price !== null ? service.base_price : 0,
            service.active !== false
          ]
        );
      }
    }

    // Token was already consumed inside the transactional lock above.

    // Mark onboarding as completed (drives "Send onboarding email" button visibility).
    await query(
      `INSERT INTO client_profiles (user_id, onboarding_completed_at, onboarding_draft_json, onboarding_draft_saved_at)
       VALUES ($1, NOW(), NULL, NULL)
       ON CONFLICT (user_id) DO UPDATE SET onboarding_completed_at = NOW(), onboarding_draft_json = NULL, onboarding_draft_saved_at = NULL, updated_at = NOW()`,
      [record.user_id]
    );

    const { rows: userInfoRows } = await query('SELECT email, first_name, last_name FROM users WHERE id = $1', [record.user_id]);
    const onboardedUser = userInfoRows[0] || {};

    await createNotificationsForAdmins({
      title: 'Client onboarding completed',
      body: `${display_name || onboardedUser.email || 'Client'} just finished onboarding.`,
      linkUrl: '/client-hub',
      meta: { client_id: record.user_id }
    });

    const baseUrl = resolveBaseUrl(req);
    await notifyAdminsByEmail({
      subject: `Client onboarding completed: ${display_name || 'New Client'}`,
      text: `${display_name || onboardedUser.email || 'A client'} finished onboarding.\n\nView details: ${baseUrl}/client-hub`,
      html: `<p>${display_name || onboardedUser.email || 'A client'} finished onboarding.</p><p><a href="${baseUrl}/client-hub" target="_blank" rel="noopener">Open the Admin Hub</a></p>`
    });

    // Generate onboarding PDF and save to documents
    try {
      const payload = await getOnboardingPayloadForUser(record.user_id);
      const { buffer, filename } = await generateClientOnboardingPdf({ payload });

      // Save PDF to database-backed file storage (persists across Cloud Run deploys)
      const { url: docUrl } = await storeFile(
        { buffer, mimetype: 'application/pdf', originalname: filename },
        { category: 'onboarding-pdf', ownerId: record.user_id, ownerType: 'user' }
      );

      // Insert document record so it appears in client's Documents tab
      await query(
        `INSERT INTO documents (user_id, label, name, url, origin, type, review_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [record.user_id, 'Onboarding Summary', filename, docUrl, 'system', 'onboarding', 'none']
      );

      // Send email with PDF attachment
      if (isMailgunConfigured() && onboardedUser.email) {
        const bccAdmins = await getAdminNotificationEmails();
        await sendMailgunMessageWithLogging(
          {
            to: [onboardedUser.email],
            cc: ['jvenner@anchorcorps.com', 'jdowning@anchorcorps.com', 'scapece@anchorcorps.com'],
            bcc: bccAdmins,
            subject: 'Anchor Corps — Onboarding Complete',
            text: `Hello,

Thank you for completing your onboarding. We've received your information and your account is ready for the next steps.

A PDF copy of your completed onboarding is attached for your records.

If you have any questions, reply to your onboarding email or reach out to us directly.

Thank you,
— Anchor Corps`,
            html: `<p>Hello,</p>
<p>Thank you for completing your onboarding. We've received your information and your account is ready for the next steps.</p>
<p>We will begin building your account shortly and will reach out when it's ready.</p>
<p>A PDF copy of your completed onboarding is attached for your records.</p>
<hr />
<p>If you have any questions, reply to your onboarding email or reach out to us directly.</p>
<p><i>Thank you,</i></p>
<p><strong>— Anchor Corps</strong></p>`,
            attachments: [{ data: buffer, filename, contentType: 'application/pdf' }]
          },
          {
            emailType: 'onboarding_complete',
            recipientName: display_name,
            clientId: record.user_id,
            metadata: { has_pdf_attachment: true }
          }
        );
      }
    } catch (pdfErr) {
      console.error('[onboarding:submit:pdf-save]', pdfErr);
    }

    res.json({ message: 'Onboarding information saved', user_id: record.user_id });
  } catch (err) {
    if (dbClient) {
      await dbClient.query('ROLLBACK').catch(() => {});
      dbClient.release();
    }
    console.error('[onboarding:submit]', err);
    res.status(500).json({ message: err.message || 'Unable to save onboarding information' });
  }
});

// POST /api/onboarding/me/avatar - upload avatar for authenticated onboarding flow
// NOTE: /me/... routes MUST come before /:token/... routes so Express doesn't treat "me" as a token parameter.
router.post('/me/avatar', requireAuth, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    const userId = req.portalUserId;
    if (!req.file) return res.status(400).json({ message: 'Avatar file is required' });
    const bytes = await fsPromises.readFile(req.file.path);
    const contentType = String(req.file.mimetype || 'image/jpeg');
    await query(
      `INSERT INTO user_avatars (user_id, content_type, bytes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, updated_at = NOW()`,
      [userId, contentType, bytes]
    );
    await fsPromises.unlink(req.file.path).catch(() => {});
    const url = `/api/hub/users/${userId}/avatar?v=${Date.now()}`;
    await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [url, userId]);
    res.json({ avatar_url: url });
  } catch (err) {
    console.error('[onboarding:me:avatar]', err);
    res.status(500).json({ message: 'Unable to upload avatar' });
  }
});

router.post('/:token/avatar', uploadAvatar.single('avatar'), async (req, res) => {
  try {
    const record = await getTokenRecord(req.params.token);
    if (!record) return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
    if (!req.file) return res.status(400).json({ message: 'Avatar file is required' });
    const bytes = await fsPromises.readFile(req.file.path);
    const contentType = String(req.file.mimetype || 'image/jpeg');
    await query(
      `INSERT INTO user_avatars (user_id, content_type, bytes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, updated_at = NOW()`,
      [record.user_id, contentType, bytes]
    );
    await fsPromises.unlink(req.file.path).catch(() => {});
    const url = `/api/hub/users/${record.user_id}/avatar?v=${Date.now()}`;
    await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [url, record.user_id]);
    res.json({ avatar_url: url });
  } catch (err) {
    console.error('[onboarding:avatar]', err);
    res.status(500).json({ message: 'Unable to upload avatar' });
  }
});

router.post(
  '/me/brand-assets',
  requireAuth,
  uploadBrandAsset.fields([
    { name: 'brand_assets', maxCount: 15 },
    { name: 'brand_asset', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const userId = req.portalUserId;
      const kindRaw = String(req.body?.asset_kind || '').trim();
      const kind = kindRaw === 'style_guide' ? 'style_guide' : 'logo';

      const files = [...((req.files && req.files.brand_assets) || []), ...((req.files && req.files.brand_asset) || [])];
      if (!files.length) return res.status(400).json({ message: 'Brand file is required' });

      const newAssets = files.map((f) => ({
        id: uuidv4(),
        kind,
        name: f.originalname || f.filename,
        url: `/uploads/brand/${f.filename}`,
        mime: f.mimetype || '',
        size: f.size || null,
        uploaded_at: new Date().toISOString()
      }));
      const existing = await query('SELECT logos FROM brand_assets WHERE user_id = $1 LIMIT 1', [userId]);
      let logos = existing.rows[0]?.logos || [];
      if (typeof logos === 'string') {
        try {
          logos = JSON.parse(logos);
        } catch {
          logos = [];
        }
      }
      const nextLogos = Array.isArray(logos) ? [...logos, ...newAssets] : [...newAssets];
      await upsertBrandAssetsLogos({ userId, nextLogos });
      res.json({ logos: nextLogos, assets: nextLogos });
    } catch (err) {
      console.error('[onboarding:me:brand-asset]', err);
      res.status(500).json({ message: err.message || 'Unable to upload brand asset' });
    }
  }
);

router.post(
  '/:token/brand-assets',
  uploadBrandAsset.fields([
    { name: 'brand_assets', maxCount: 15 },
    // legacy single-file field
    { name: 'brand_asset', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const record = await getTokenRecord(req.params.token);
      if (!record) return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
      const kindRaw = String(req.body?.asset_kind || '').trim();
      const kind = kindRaw === 'style_guide' ? 'style_guide' : 'logo';

      const files = [...((req.files && req.files.brand_assets) || []), ...((req.files && req.files.brand_asset) || [])];
      if (!files.length) return res.status(400).json({ message: 'Brand file is required' });

      const newAssets = files.map((f) => ({
        id: uuidv4(),
        kind,
        name: f.originalname || f.filename,
        url: `/uploads/brand/${f.filename}`,
        mime: f.mimetype || '',
        size: f.size || null,
        uploaded_at: new Date().toISOString()
      }));
      const existing = await query('SELECT logos FROM brand_assets WHERE user_id = $1 LIMIT 1', [record.user_id]);
      let logos = existing.rows[0]?.logos || [];
      if (typeof logos === 'string') {
        try {
          logos = JSON.parse(logos);
        } catch {
          logos = [];
        }
      }
      const nextLogos = Array.isArray(logos) ? [...logos, ...newAssets] : [...newAssets];
      await upsertBrandAssetsLogos({ userId: record.user_id, nextLogos });
      // Keep backwards compatible response shape
      res.json({ logos: nextLogos, assets: nextLogos });
    } catch (err) {
      console.error('[onboarding:brand-asset]', err);
      res.status(500).json({ message: err.message || 'Unable to upload brand asset' });
    }
  }
);

router.delete('/me/brand-assets/:assetId([0-9a-f-]{36})', requireAuth, async (req, res) => {
  try {
    const userId = req.portalUserId;
    const { assetId } = req.params;
    const existing = await query('SELECT logos FROM brand_assets WHERE user_id = $1 LIMIT 1', [userId]);
    let logos = existing.rows[0]?.logos || [];
    if (typeof logos === 'string') {
      try {
        logos = JSON.parse(logos);
      } catch {
        logos = [];
      }
    }
    const list = Array.isArray(logos) ? logos : [];
    const next = list.filter((asset) => asset?.id !== assetId);
    await upsertBrandAssetsLogos({ userId, nextLogos: next });
    res.json({ logos: next, assets: next });
  } catch (err) {
    console.error('[onboarding:me:brand-asset:delete]', err);
    res.status(500).json({ message: err.message || 'Unable to delete brand asset' });
  }
});

router.delete('/:token/brand-assets/:assetId([0-9a-f-]{36})', async (req, res) => {
  try {
    const record = await getTokenRecord(req.params.token);
    if (!record) return res.status(404).json({ message: 'Onboarding link is invalid or expired' });

    const { assetId } = req.params;
    const existing = await query('SELECT logos FROM brand_assets WHERE user_id = $1 LIMIT 1', [record.user_id]);
    let logos = existing.rows[0]?.logos || [];
    if (typeof logos === 'string') {
      try {
        logos = JSON.parse(logos);
      } catch {
        logos = [];
      }
    }
    const list = Array.isArray(logos) ? logos : [];
    const target = list.find((a) => a?.id === assetId);
    const next = list.filter((a) => a?.id !== assetId);

    await upsertBrandAssetsLogos({ userId: record.user_id, nextLogos: next });

    // Best-effort: delete the underlying file from disk.
    const url = String(target?.url || '');
    const filename = url ? path.basename(url) : '';
    if (filename) {
      try {
        fs.unlinkSync(path.join(brandDir, filename));
      } catch {
        // ignore
      }
    }

    res.json({ logos: next, assets: next });
  } catch (err) {
    console.error('[onboarding:brand-asset-delete]', err);
    res.status(500).json({ message: err.message || 'Unable to delete brand asset' });
  }
});

// Single email-safe display logo (PNG/JPG), stored in file_uploads. Distinct
// from the multi-file `logos` JSONB array.
const uploadDisplayLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype);
    if (!ok) return cb(new Error('Only PNG or JPG files are allowed'));
    cb(null, true);
  }
});

function uploadDisplayLogoSingle(req, res, next) {
  uploadDisplayLogo.single('logo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 2 MB' : err.message;
      return res.status(400).json({ message });
    }
    next();
  });
}

async function setOnboardingDisplayLogo(actorUserId, userId, file, res) {
  let stored = null;
  try {
    const { rows } = await query(
      `SELECT id, display_logo_file_id FROM brand_assets
        WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [userId]
    );
    stored = await storeFile(file, {
      category: 'brand-display-logo',
      ownerId: userId,
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
        [userId, stored.id]
      );
    }
    logSecurityEvent({
      userId: actorUserId || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: true,
      details: { action: 'brand.display_logo.upload', targetUserId: userId, fileId: stored.id, source: 'onboarding' }
    }).catch(() => {});
    res.json({ display_logo: { file_id: stored.id, url: stored.url } });
  } catch (err) {
    if (stored?.id) await deleteFile(stored.id).catch(() => {});
    logSecurityEvent({
      userId: actorUserId || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: false,
      failureReason: err.message || 'upload_failed',
      details: { action: 'brand.display_logo.upload', targetUserId: userId, source: 'onboarding' }
    }).catch(() => {});
    throw err;
  }
}

async function clearOnboardingDisplayLogo(actorUserId, userId, res) {
  try {
    const { rows } = await query(
      `SELECT id, display_logo_file_id FROM brand_assets
        WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [userId]
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
      userId: actorUserId || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: true,
      details: { action: 'brand.display_logo.delete', targetUserId: userId, removedFileId: existing || null, source: 'onboarding' }
    }).catch(() => {});
    res.json({ display_logo: null });
  } catch (err) {
    logSecurityEvent({
      userId: actorUserId || null,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCOUNT,
      success: false,
      failureReason: err.message || 'delete_failed',
      details: { action: 'brand.display_logo.delete', targetUserId: userId, source: 'onboarding' }
    }).catch(() => {});
    throw err;
  }
}

router.post('/me/brand-assets/display-logo', requireAuth, uploadDisplayLogoSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    await setOnboardingDisplayLogo(req.user?.id, req.portalUserId, req.file, res);
  } catch (err) {
    console.error('[onboarding:me:display-logo:upload]', err);
    res.status(500).json({ message: err.message || 'Unable to upload logo' });
  }
});

router.delete('/me/brand-assets/display-logo', requireAuth, async (req, res) => {
  try {
    await clearOnboardingDisplayLogo(req.user?.id, req.portalUserId, res);
  } catch (err) {
    console.error('[onboarding:me:display-logo:delete]', err);
    res.status(500).json({ message: err.message || 'Unable to remove logo' });
  }
});

router.post('/:token/brand-assets/display-logo', uploadDisplayLogoSingle, async (req, res) => {
  try {
    const record = await getTokenRecord(req.params.token);
    if (!record) return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    // Token-auth path: actor is the same as the target (the onboarding user).
    await setOnboardingDisplayLogo(record.user_id, record.user_id, req.file, res);
  } catch (err) {
    console.error('[onboarding:token:display-logo:upload]', err);
    res.status(500).json({ message: err.message || 'Unable to upload logo' });
  }
});

router.delete('/:token/brand-assets/display-logo', async (req, res) => {
  try {
    const record = await getTokenRecord(req.params.token);
    if (!record) return res.status(404).json({ message: 'Onboarding link is invalid or expired' });
    await clearOnboardingDisplayLogo(record.user_id, record.user_id, res);
  } catch (err) {
    console.error('[onboarding:token:display-logo:delete]', err);
    res.status(500).json({ message: err.message || 'Unable to remove logo' });
  }
});

export default router;
