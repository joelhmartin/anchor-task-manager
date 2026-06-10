import './loadEnv.js';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

import authRouter from './auth.js';
import { query } from './db.js';
import hubRouter from './routes/hub.js';
import blogPostsRouter from './routes/blogPosts.js';
import contactsRouter from './routes/contacts.js';
import twilioConfigRouter from './routes/twilioConfig.js';
import onboardingPdfRouter from './routes/onboardingPdfRoutes.js';
import onboardingRouter from './routes/onboarding.js';
import tasksRouter from './routes/tasks.js';
import reviewsRouter from './routes/reviews.js';
import webhooksRouter from './routes/webhooks.js';
import twilioRouter from './routes/twilio.js';
import formsRouter from './routes/forms.js';
import ctmFormsRouter from './routes/ctmForms.js';
import clientTeamRouter from './routes/clientTeam.js';
import clientInviteRouter from './routes/clientInvite.js';
import tutorialsRouter from './routes/tutorials.js';
import portalUpdatesRouter from './routes/portalUpdates.js';
import trackingRouter from './routes/tracking.js';
import analyticsRouter from './routes/analytics.js';
import reportsRouter from './routes/reports.js';
import operationsRouter from './routes/operations.js';
import opsRouter from './routes/ops.js';
import healthRouter from './routes/health.js';
import socialRouter from './routes/social.js';
import { attachOperationsWebSocket } from './ws/operationsTerminal.js';
import { tickScheduler } from './services/reports/scheduler.js';
import { runDuePosts } from './services/socialPublisher.js';
import { healthCheckPage } from './services/metaPagePosting.js';

import { purgeArchivedTasks } from './services/taskCleanup.js';
import { runDueDateAutomations } from './services/taskAutomations.js';
import { processRecurringTasks } from './services/taskRecurrence.js';
import { processDueJourneySends } from './services/journeyScheduledSends.js';
import { registerTaskEventSubscribers } from './services/taskEventSubscribers.js';
import { serveFile } from './services/fileStorage.js';
import { requireAuth, optionalFileAuth } from './middleware/auth.js';
import { processPendingFormSubmissionJobs } from './services/forms.js';
import { processPendingCtmJobs } from './services/ctmRetryQueue.js';
import { maybeSeedDemoAccount } from './services/demoSeed.js';
import { syncCallsForOwner, drainPendingClassifications } from './services/ctmAutoSync.js';
import { getZonedParts, isValidTimeZone, DEFAULT_TZ } from './services/util/timezone.js';
import { isDemoMode } from './services/demoMode.js';

const app = express();
// Cloud Run sets PORT=8080, so prioritize that over API_SERVER_PORT
const PORT = process.env.PORT || process.env.API_SERVER_PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';
// Silence verbose logging in production to reduce Cloud Logging costs.
// console.error and console.warn are preserved for operational visibility.
if (NODE_ENV === 'production') console.log = () => {};
const RUN_MIGRATIONS = process.env.RUN_MIGRATIONS_ON_START ?? (NODE_ENV === 'production' ? 'true' : 'false');
const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
const CLIENT_BUILD_DIR = path.resolve(process.cwd(), 'dist');
const EMAIL_ASSETS_DIR = path.resolve(process.cwd(), 'server', 'assets', 'email');
const TRACKING_ASSETS_DIR = path.resolve(process.cwd(), 'server', 'assets', 'tracking');
const FORMS_ASSETS_DIR = path.resolve(process.cwd(), 'server', 'assets', 'forms');
const CTM_FORMS_ASSETS_DIR = path.resolve(process.cwd(), 'server', 'assets', 'ctm-forms');

// Crash visibility: log async crashes so Cloud Run doesn’t just surface opaque 503s.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Let Cloud Run restart the container; failing fast is better than serving a broken instance.
  process.exit(1);
});

// CSP environment configuration
const CSP_FRAME_SRC = (process.env.CSP_FRAME_SRC || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CSP_IMG_SRC = (process.env.CSP_IMG_SRC || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Base CSP directives - secure by default (no unsafe-inline/eval)
// Monaco-specific routes will get a relaxed policy applied via middleware
const baseCspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
  'script-src-elem': ["'self'", 'https://cdn.jsdelivr.net'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
  'style-src-elem': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
  // Allow blob: for local previews, data: for base64, plus any additional sources from env
  'img-src': ["'self'", 'data:', 'blob:', 'https://*.fbcdn.net', 'https://*.facebook.com', ...CSP_IMG_SRC],
  // fbcdn/facebook hosts allow inline playback of Meta ad video creatives (mp4 served from video-*.fbcdn.net)
  'media-src': ["'self'", 'blob:', 'data:', 'https://*.fbcdn.net', 'https://*.facebook.com'],
  'connect-src': ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
  'worker-src': ["'self'", 'blob:', 'https://cdn.jsdelivr.net'],
  'child-src': ["'self'", 'blob:'],
  'frame-src': ["'self'", ...CSP_FRAME_SRC]
};

function normalizeOrigin(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/\/$/, '');
}

const allowedOrigins = (() => {
  // Include the server's own origin so Puppeteer (PDF renderer) can fetch
  // /assets/* from the same process without CORS rejection.
  const selfOrigin = `http://localhost:${process.env.PORT || process.env.API_SERVER_PORT || 4000}`;
  const defaults = ['http://localhost:3000', 'http://localhost:4173', selfOrigin];
  const fromEnv = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const appBase = [process.env.APP_BASE_URL, process.env.CLIENT_APP_URL].filter(Boolean);
  const all = [...defaults, ...fromEnv, ...appBase].map(normalizeOrigin).filter(Boolean);
  return new Set(all);
})();

// corsOptions defined below after public endpoint handling

// Public endpoints that allow any origin (bypass global CORS restrictions)
const publicCorsEndpoints = [
  '/api/forms/embed/',
  '/api/ctm-forms/embed/',
  '/api/twilio/webhook',
  '/api/twilio/status',
  '/api/social/media/'
];

function isPublicCorsEndpoint(path) {
  return publicCorsEndpoints.some(prefix => path.startsWith(prefix));
}

// Handle CORS for public endpoints before global CORS middleware
app.use((req, res, next) => {
  if (isPublicCorsEndpoint(req.path)) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    // Mark as handled so global CORS skips this request
    req._publicCorsHandled = true;
  }
  next();
});

// Modify corsOptions to skip public endpoints
const corsOptionsWithBypass = {
  origin: (origin, callback) => {
    // Skip CORS check for public endpoints (handled above)
    // Note: We check a header we set since we can't access req here
    // But actually we need to allow it through - the flag approach won't work
    // Instead, just allow if no origin (non-browser) or if in allowlist
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

// Apply core middleware before any routers so bodies/cookies are available
// Use a wrapper to skip CORS for public endpoints
app.use((req, res, next) => {
  if (req._publicCorsHandled) {
    return next(); // Skip global CORS for public endpoints
  }
  cors(corsOptionsWithBypass)(req, res, next);
});
app.use(express.json()); // body parser before routes
app.use(express.urlencoded({ extended: true })); // for Twilio webhooks (form-urlencoded)
app.use(cookieParser()); // cookies before routes
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: baseCspDirectives
    }
  })
);

// API routes (explicit mounts to avoid leaking through other routers)
app.use('/api/auth', authRouter);
// hubRouter must mount FIRST: it defines public routes (avatar, OAuth callbacks)
// before its own requireAuth, and falls through (next()) for any route it doesn't
// match. The extracted subrouters apply a blanket requireAuth, so mounting them
// ahead of hubRouter would 401 those public routes for unauthenticated requests.
app.use('/api/hub', hubRouter);
app.use('/api/hub', blogPostsRouter);
app.use('/api/hub', contactsRouter); // Contact Entity merge/split admin API (Phase 4)
app.use('/api/hub', twilioConfigRouter);
app.use('/api/hub', onboardingPdfRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/webhooks', webhooksRouter); // Public webhook endpoints (Mailgun, etc.)
app.use('/api/twilio', twilioRouter); // Twilio call tracking webhooks (public)
app.use('/api/forms', formsRouter); // Forms platform API (generic, decommissioned)
app.use('/api/ctm-forms', ctmFormsRouter); // CTM Forms module
app.use('/api/client-team', clientTeamRouter);
app.use('/api/client-invite', clientInviteRouter); // Public routes for invite acceptance
app.use('/api/tutorials', tutorialsRouter);
app.use('/api/portal-updates', portalUpdatesRouter); // Client portal Updates banner (broadcast announcements)
app.use('/api/hub/tracking', trackingRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/operations', operationsRouter);
app.use('/api/ops', opsRouter);
app.use('/api/system-health', healthRouter); // Production health checks (superadmin only) — NOT the public /api/health liveness probe below
app.use('/api/social', socialRouter);

// File serving endpoint (serves files stored in database for persistence on Cloud Run)
app.get('/api/files/:id', optionalFileAuth, async (req, res) => {
  await serveFile(req.params.id, res, { user: req.user, portalUserId: req.portalUserId });
});

app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/email-assets', express.static(EMAIL_ASSETS_DIR));
// Serve Vite build assets (hashed JS/CSS chunks + named bundles like report-renderer.js).
// In production this is also covered by the catch-all express.static(CLIENT_BUILD_DIR) below,
// but an explicit mount ensures /assets/* works in development too (after a local yarn build).
app.use('/assets', express.static(path.join(process.cwd(), 'dist', 'assets')));
// Public tracking/forms assets embed on client websites via stable
// (non-fingerprinted) URLs. "no-cache" here does NOT mean "don't cache" —
// it means "revalidate before using." Browsers keep the cached copy and
// send an If-None-Match header on every request; if the file hasn't
// changed, express.static returns 304 Not Modified (~200 bytes, no body).
// That cuts egress on repeat loads while letting any fix we deploy
// propagate INSTANTLY on the next pageview — critical for embed scripts.
const PUBLIC_ASSET_CACHE_CONTROL = 'public, no-cache';
app.use('/tracking', express.static(TRACKING_ASSETS_DIR, {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', PUBLIC_ASSET_CACHE_CONTROL);
  }
}));
app.use('/forms', express.static(FORMS_ASSETS_DIR, {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', PUBLIC_ASSET_CACHE_CONTROL);
  }
}));
app.use('/ctm-forms', express.static(CTM_FORMS_ASSETS_DIR, {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', PUBLIC_ASSET_CACHE_CONTROL);
  }
}));

if (NODE_ENV === 'production') {
  // IMPORTANT:
  // - `index.html` must NOT be cached; otherwise users can get a stale HTML shell that points at
  //   JS chunk files that no longer exist after a deploy, causing:
  //   "Failed to fetch dynamically imported module /assets/XYZ-<hash>.js"
  // - Hashed assets under /assets/* SHOULD be cached for a long time (immutable).
  app.use(
    express.static(CLIENT_BUILD_DIR, {
      setHeaders: (res, filePath) => {
        const normalized = String(filePath || '').replace(/\\/g, '/');

        // Never cache HTML shells
        if (normalized.endsWith('/index.html') || normalized.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
          return;
        }

        // Cache-bustable hashed assets
        if (normalized.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }

        // Default for other files (manifest, icons, etc.)
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    })
  );
}

app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.get('/api/app-config', async (req, res) => {
  // In dev: try to read the live ngrok URL from the ngrok log file.
  // In prod: APP_BASE_URL is the Cloud Run domain (not localhost), use it directly.
  // Fallback: http://localhost:<PORT>
  let appBaseUrl = null;
  try {
    const log = await readFile('/tmp/ngrok-anchor.log', 'utf8');
    const matches = log.match(/https:\/\/[a-z0-9-]+\.(ngrok-free\.app|trycloudflare\.com)/g);
    if (matches) appBaseUrl = matches[matches.length - 1];
  } catch {}
  if (!appBaseUrl) {
    const env = process.env.APP_BASE_URL || '';
    appBaseUrl = env && !env.includes('localhost') ? env : `http://localhost:${PORT}`;
  }
  res.json({ appBaseUrl });
});

if (NODE_ENV === 'production') {
  // All client routes use the secure default CSP (set by helmet)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(CLIENT_BUILD_DIR, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  console.error('[server-error]', err);
  const message = NODE_ENV === 'production' ? 'Unexpected server error' : err.message || 'Unexpected server error';
  res.status(500).json({ message });
});

async function maybeRunMigrations() {
  if (String(RUN_MIGRATIONS).toLowerCase() !== 'true') return;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sqlPath = path.join(__dirname, 'sql', 'init.sql');
  const sql = await readFile(sqlPath, 'utf8');
  await query(sql);
  // eslint-disable-next-line no-console
  console.log('[migrations] ran init.sql');
}

// Run reviews migration (idempotent, uses IF NOT EXISTS)
async function maybeRunReviewsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_reviews.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_reviews.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

// Run security migration (idempotent, uses IF NOT EXISTS)
async function maybeRunSecurityMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_security.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_security.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

// Run onboarding token value migration (idempotent, uses IF NOT EXISTS)
async function maybeRunOnboardingTokenMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_onboarding_token_value.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_onboarding_token_value.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

// Fix onboarding tokens that were incorrectly revoked (one-time fix, idempotent)
async function maybeRunOnboardingTokenFixMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_fix_onboarding_tokens.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_fix_onboarding_tokens.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

// Run Twilio integration migration (adds Twilio tables and form presets)
async function maybeRunTwilioIntegrationMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_twilio_integration.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_twilio_integration.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

// Run activity logs migration (creates user_activity_logs table)
async function maybeRunActivityLogsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_activity_logs.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_activity_logs.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

async function maybeRunAiClassificationLogsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ai_classification_logs.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ai_classification_logs.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

// Run forms platform migration (creates forms, form_submissions tables)
async function maybeRunFormsPlatformMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_forms_platform.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_forms_platform.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

// Run file storage migration (creates file_uploads table for persistent storage)
async function maybeRunFileStorageMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_file_storage.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_file_storage.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    throw err;
  }
}

// Run IP hash fix migration (changes ip_address columns from INET to TEXT)
async function maybeRunIpHashFixMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ip_hash_fix.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[migrations] ran migrate_ip_hash_fix.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return; // file not present; skip
    // Ignore if column is already TEXT (migration already ran)
    if (err.message?.includes('already exists') || err.message?.includes('cannot be cast')) return;
    throw err;
  }
}

// TM-014: Task event bus — create task_events table
async function maybeRunTaskEventsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-events.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-events.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

// TM-015v2b: Automation v2 — steps, quota, workflow runs
async function maybeRunAutomationV2Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-automation-v2.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-automation-v2.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunAutomationV3Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-automation-v3.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-automation-v3.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsV2Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms_v2.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms_v2.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

// Run tutorial completions migration (creates user_tutorial_completions table)
async function maybeRunTutorialsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tutorials.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_tutorials.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunPortalUpdatesMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_portal_updates.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_portal_updates.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsSpamMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms_spam.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms_spam.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunClientTimezoneMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_client_timezone.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_client_timezone.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunJourneyStepSendHourMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_journey_step_send_hour.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_journey_step_send_hour.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunBrandAssetsDedupUniqueMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_brand_assets_dedup_unique.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_brand_assets_dedup_unique.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunBrandAssetsDisplayLogoMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_brand_assets_display_logo.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_brand_assets_display_logo.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunLeadJourneyRedesignMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_lead_journey_redesign.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_lead_journey_redesign.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunJourneyTemplateAttachmentsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_journey_template_attachments.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_journey_template_attachments.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunJourneyTemplateEmailTextMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_journey_template_email_text.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_journey_template_email_text.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunJourneyExampleTemplateMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_journey_example_template.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_journey_example_template.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    // A seed-template re-run must never break the migration chain (which would skip every
    // migration after this one). The SQL is now ON CONFLICT DO NOTHING; treat any residual
    // unique-violation (23505) as benign rather than rethrowing.
    if (err.code === '23505') return;
    throw err;
  }
}

async function maybeRunJourneyBackfillStartedAttributionMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_journey_backfill_started_attribution.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_journey_backfill_started_attribution.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunJourneyActivityBodyFormatHtmlBackfillMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_journey_activity_body_format_html_backfill.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_journey_activity_body_format_html_backfill.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunClientAnalyticsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_client_analytics.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_client_analytics.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunFixClientNamesMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_fix_client_names.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_fix_client_names.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunAccountManagerUserMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_account_manager_user.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_account_manager_user.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsConsentMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms_consent.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms_consent.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmBaaMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_baa.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_baa.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsRetentionMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms_retention.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms_retention.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsAutoresponderMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms_autoresponder.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms_autoresponder.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsAutoresponderV2Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms_autoresponder_v2.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms_autoresponder_v2.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormsAutoresponderV3Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_forms_autoresponder_v3.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_forms_autoresponder_v3.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunJourneyStepsEmailMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_client_journey_steps_email.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_client_journey_steps_email.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunSessionGracePeriodMigration() {
  try {
    await query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS prev_refresh_token_hash TEXT`);
    console.log('[migrations] ran session grace period migration');
  } catch (err) {
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTeamMemberCleanup() {
  try {
    // Clean up non-owner account/group members who picked up client-owner
    // profile data. They may keep onboarding/activation timestamps so login
    // continues to work, but they must not retain owner metadata that can make
    // them look like standalone clients in Admin Hub or portal account
    // resolution.
    const { rowCount } = await query(`
      UPDATE client_profiles SET
        client_identifier_value = NULL,
        client_type = NULL,
        client_subtype = NULL,
        client_package = NULL,
        client_group_id = NULL,
        ai_prompt = NULL
      WHERE user_id IN (
        SELECT member_user_id
        FROM (
          SELECT cam.member_user_id
          FROM client_account_members cam
          WHERE cam.role IN ('member', 'admin') AND cam.status = 'active'

          UNION

          SELECT cgm.member_user_id
          FROM client_group_members cgm
          WHERE cgm.role IN ('member', 'admin') AND cgm.status = 'active'
        ) access_members
      )
      AND user_id NOT IN (
        SELECT DISTINCT cam_owner.client_owner_id
        FROM client_account_members cam_owner
        WHERE cam_owner.status = 'active'
      )
      AND (
        client_identifier_value IS NOT NULL
        OR client_type IS NOT NULL
        OR client_group_id IS NOT NULL
        OR client_package IS NOT NULL
        OR ai_prompt IS NOT NULL
      )
    `);
    if (rowCount > 0) console.log(`[migrations] cleaned ${rowCount} team member client_profiles rows`);

    // Also remove any brand_assets rows created for non-owner members. They
    // inherit branding from the owner account or group clients instead.
    const { rowCount: brandCount } = await query(`
      DELETE FROM brand_assets
      WHERE user_id IN (
        SELECT member_user_id
        FROM (
          SELECT cam.member_user_id
          FROM client_account_members cam
          WHERE cam.role IN ('member', 'admin') AND cam.status = 'active'

          UNION

          SELECT cgm.member_user_id
          FROM client_group_members cgm
          WHERE cgm.role IN ('member', 'admin') AND cgm.status = 'active'
        ) access_members
      )
      AND user_id NOT IN (
        SELECT DISTINCT cam_owner.client_owner_id
        FROM client_account_members cam_owner
        WHERE cam_owner.status = 'active'
      )
    `);
    if (brandCount > 0) console.log(`[migrations] removed ${brandCount} team member brand_assets rows`);

    // Remove bogus self-owner rows that may have been synthesized for invited
    // members before group-aware account resolution existed — OR by the startup
    // backfill's old "not an active member elsewhere" branch (now removed) when a
    // member was removed from all their real accounts. Match non-owner
    // memberships of ANY status (active, removed, pending): a member removed from
    // every account is the exact case that used to get mis-promoted, and the
    // owner-signal guards below still protect anyone who legitimately owns an
    // account in addition to being a member elsewhere.
    const { rowCount: ownerMembershipCount } = await query(`
      DELETE FROM client_account_members cam
      WHERE cam.client_owner_id = cam.member_user_id
        AND cam.role = 'owner'
        AND cam.status = 'active'
        AND cam.member_user_id IN (
          SELECT member_user_id
          FROM (
            SELECT cam2.member_user_id
            FROM client_account_members cam2
            WHERE cam2.role IN ('member', 'admin')

            UNION

            SELECT cgm.member_user_id
            FROM client_group_members cgm
            WHERE cgm.role IN ('member', 'admin')
          ) access_members
        )
        AND NOT EXISTS (
          SELECT 1
          FROM brand_assets ba
          WHERE ba.user_id = cam.member_user_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM client_profiles cp
          WHERE cp.user_id = cam.member_user_id
            AND (
              cp.client_identifier_value IS NOT NULL
              OR cp.client_type IS NOT NULL
              OR cp.client_subtype IS NOT NULL
              OR cp.client_package IS NOT NULL
              OR cp.client_group_id IS NOT NULL
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM client_user_invite_tokens cuit
          WHERE cuit.client_owner_id = cam.member_user_id
            AND cuit.invite_role = 'owner'
            AND cuit.consumed_at IS NULL
            AND cuit.revoked_at IS NULL
            AND cuit.expires_at > NOW()
        )
    `);
    if (ownerMembershipCount > 0) {
      console.log(`[migrations] removed ${ownerMembershipCount} bogus self-owner membership row(s)`);
    }
  } catch (err) {
    console.error('[migrations] team member cleanup failed:', err.message);
  }
}

async function maybeRunFormSubmissionsHashedPhoneMigration() {
  try {
    await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await query(`ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS hashed_phone TEXT`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ctm_form_subs_hashed_phone ON ctm_form_submissions(hashed_phone) WHERE hashed_phone IS NOT NULL`);
    console.log('[migrations] ran ctm_form_submissions hashed_phone migration');
  } catch (err) {
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCallLogsHiddenMigration() {
  try {
    await query(`ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`);
    await query(`CREATE INDEX IF NOT EXISTS idx_call_logs_hidden ON call_logs(hidden_at) WHERE hidden_at IS NOT NULL`);
    console.log('[migrations] ran call_logs hidden_at migration');
  } catch (err) {
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunJourneyTemplateReplyToMigration() {
  try {
    await query(`ALTER TABLE journey_email_templates ADD COLUMN IF NOT EXISTS reply_to TEXT[] NOT NULL DEFAULT '{}'`);
    console.log('[migrations] ran journey_email_templates reply_to migration');
  } catch (err) {
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormSubmissionRecaptchaJsonMigration() {
  try {
    await query(`ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS recaptcha_json JSONB`);
    console.log('[migrations] ran ctm_form_submissions recaptcha_json migration');
  } catch (err) {
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormTemplatesMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_form_templates.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_form_templates.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunCtmFormOutcomeMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_ctm_form_outcome.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_ctm_form_outcome.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    // Log, don't rethrow — a failure here must not abort later migrations in the chain.
    console.error('[migrations] failed migrate_ctm_form_outcome.sql:', err.message);
  }
}

async function maybeRunReportBuilderMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_report_builder.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] report_builder schema ensured');
  } catch (err) {
    console.error('[migrations] report_builder failed:', err);
  }
}

async function maybeRunReportGenerationCancelMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_report_generation_cancel.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] report_generation_cancel schema ensured');
  } catch (err) {
    console.error('[migrations] report_generation_cancel failed:', err);
  }
}

async function maybeRunKinstaOperationsMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_kinsta_operations.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] kinsta_operations schema ensured');
  } catch (err) {
    console.error('[migrations] kinsta_operations failed:', err);
  }
}

async function maybeRunKinstaFindingsMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_kinsta_findings.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] kinsta_findings schema ensured');
  } catch (err) {
    console.error('[migrations] kinsta_findings failed:', err);
  }
}

async function maybeRunOpsPhase0DriftBaselineMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_phase0_drift_baseline.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_phase0_drift_baseline schema ensured');
  } catch (err) {
    console.error('[migrations] ops_phase0_drift_baseline failed:', err);
  }
}

async function maybeRunOpsFoundationMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_foundation.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_foundation schema ensured');
  } catch (err) {
    console.error('[migrations] ops_foundation failed:', err);
  }
}

async function maybeRunOpsVulnFeedMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_vuln_feed.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_vuln_feed schema ensured');
  } catch (err) {
    console.error('[migrations] ops_vuln_feed failed:', err);
  }
}

async function maybeRunOpsSeedRunDefinitionsMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_seed_run_definitions.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_seed_run_definitions seeded');
  } catch (err) {
    console.error('[migrations] ops_seed_run_definitions failed:', err);
  }
}

async function maybeRunOpsSeedMetaRunDefinitionsMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_seed_meta_run_definitions.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_seed_meta_run_definitions seeded');
  } catch (err) {
    console.error('[migrations] ops_seed_meta_run_definitions failed:', err);
  }
}

async function maybeRunOpsKeywordHistoryMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_keyword_history.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_keyword_history schema ensured');
  } catch (err) {
    console.error('[migrations] ops_keyword_history failed:', err);
  }
}

async function maybeRunOpsSeedGadsRunDefinitionsMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_seed_gads_run_definitions.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_seed_gads_run_definitions seeded');
  } catch (err) {
    console.error('[migrations] ops_seed_gads_run_definitions failed:', err);
  }
}

async function maybeRunOpsCheckResultsTrendIndexMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_check_results_trend_index.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_check_results_trend_index ensured');
  } catch (err) {
    console.error('[migrations] ops_check_results_trend_index failed:', err);
  }
}

async function maybeRunOpsSubscriptionEmailMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_subscription_email.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_subscription_email column ensured');
  } catch (err) {
    console.error('[migrations] ops_subscription_email failed:', err);
  }
}

async function maybeRunOpsMonthlyCapMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_monthly_cap.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_monthly_cap columns ensured');
  } catch (err) {
    console.error('[migrations] ops_monthly_cap failed:', err);
  }
}

async function maybeRunOpsAuditRunsDeprecationMarkerMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_audit_runs_deprecation_marker.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops audit_runs / audit_schedules deprecation comments ensured');
  } catch (err) {
    console.error('[migrations] ops_audit_runs_deprecation_marker failed:', err);
  }
}

async function maybeRunOpsDiscoveriesUpgradeMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_discoveries_upgrade.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_discoveries_upgrade schema ensured');
  } catch (err) {
    console.error('[migrations] ops_discoveries_upgrade failed:', err);
  }
}

async function maybeRunOpsSkillsAndBulkMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_skills_and_bulk.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ops_skills_and_bulk schema ensured');
  } catch (err) {
    console.error('[migrations] ops_skills_and_bulk failed:', err);
  }
}

async function maybeSyncOpsSeedSkills() {
  try {
    const { syncSeedSkills } = await import('./services/ops/skills/seed.js');
    const r = await syncSeedSkills();
    console.warn(`[startup] ops seed skills: created=${r.created} existed=${r.existed}`);
  } catch (e) {
    console.error('[startup] seed skills failed', e?.message || e);
  }
}

async function maybeRunOpsRecipesMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_recipes.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.warn('[migration] ops_recipes applied');
  } catch (e) {
    console.error('[migration] ops_recipes failed', e?.message || e);
  }
}

async function maybeRunOpsSkillModelMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ops_skill_model.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.warn('[migration] ops_skill_model applied');
  } catch (e) {
    console.error('[migration] ops_skill_model failed', e?.message || e);
  }
}

async function maybeRunSocialPublishingMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_social_publishing.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] social_publishing schema ensured');
  } catch (err) {
    console.error('[migrations] social_publishing failed:', err);
  }
}

async function maybeRunReportCsvExportMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_report_csv_export.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] report_csv_export columns ensured');
  } catch (err) {
    console.error('[migrations] report_csv_export failed:', err);
  }
}

async function maybeRunAiWebReportsMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ai_web_reports.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ai_web_reports schema ensured');
  } catch (err) {
    console.error('[migrations] ai_web_reports failed:', err);
  }
}

async function maybeRunAiWebReportsPhiMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ai_web_reports_phi.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ai_web_reports_phi columns encrypted-TEXT ensured');
  } catch (err) {
    console.error('[migrations] ai_web_reports_phi failed:', err);
  }
}

async function maybeRunAiWebReportsEnabledMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ai_web_reports_enabled.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ai_web_reports enabled flag ensured');
  } catch (err) {
    console.error('[migrations] ai_web_reports_enabled failed:', err);
  }
}

async function maybeRunAiWebReportsApprovalFreezeMigration() {
  try {
    const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_ai_web_reports_approval_freeze.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
    console.warn('[migrations] ai_web_reports approval freeze columns ensured');
  } catch (err) {
    console.error('[migrations] ai_web_reports_approval_freeze failed:', err);
  }
}

async function maybeRunLifecycleBackfillMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_lifecycle_backfill.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_lifecycle_backfill.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    if (err.message?.includes('does not exist')) {
      console.log('[migrations] skipped migrate_lifecycle_backfill.sql (missing dependency table)');
      return;
    }
    throw err;
  }
}

async function maybeRunDedupFormSubmissionsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_dedup_form_submissions.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_dedup_form_submissions.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunFixClientMembershipsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_fix_client_memberships.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_fix_client_memberships.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunClientGroupAccessMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_client_group_access.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_client_group_access.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunUserFkCascadeMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_user_fk_cascade.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_user_fk_cascade.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunTrackingMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_tracking.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunTrackingV2Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking_v2.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_tracking_v2.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunTrackingV3Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking_v3.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_tracking_v3.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunTrackingV4Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking_v4.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_tracking_v4.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunTrackingV5Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking_v5.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_tracking_v5.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function maybeRunTaskLabelsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-labels.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-labels.sql');
    // Seed system labels for all existing workspaces
    const { seedAllWorkspaces } = await import('./services/taskLabels.js');
    await seedAllWorkspaces();
    console.log('[migrations] seeded system labels for existing workspaces');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTaskDepsRecurrenceMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-deps-recurrence.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-deps-recurrence.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTaskDashboardsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-dashboards.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-dashboards.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTaskItemLinksMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-item-links.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-item-links.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTaskMirrorColumnsMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-mirror-columns.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-mirror-columns.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTaskBaselinesMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-baselines.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-baselines.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTaskTimeTrackingV2Migration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-time-tracking-v2.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-time-tracking-v2.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunTaskWebhooksMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-webhooks.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-webhooks.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunSubitemWorkflowMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const sqlPath = path.join(__dirname, 'sql', 'task-subitem-workflow.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran task-subitem-workflow.sql');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function maybeRunAnalyticsReportsMigration() {
  try {
    const tableExists = await query("SELECT 1 FROM information_schema.tables WHERE table_name = 'analytics_report_templates'");
    if (tableExists.rows.length > 0) return;
    const sql = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_analytics_reports.sql'), 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_analytics_reports.sql');
  } catch (err) {
    console.error('[migrations] analytics reports migration failed:', err.message);
  }
}

async function maybeRunReportSnapshotsMigration() {
  try {
    const check = await query("SELECT column_name FROM information_schema.columns WHERE table_name='analytics_generated_reports' AND column_name='selection_snapshot'");
    if (check.rows.length > 0) return;
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_analytics_report_snapshots.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_analytics_report_snapshots.sql');
  } catch (err) {
    console.error('[migrations] analytics report snapshots migration failed:', err.message);
  }
}

async function maybeRunAnalyticsAuditsMigration() {
  try {
    const tableExists = await query("SELECT 1 FROM information_schema.tables WHERE table_name = 'analytics_audit_schedules'");
    if (tableExists.rows.length > 0) return;
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_analytics_audits.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_analytics_audits.sql');
  } catch (err) {
    console.error('[migrations] analytics audits migration failed:', err.message);
  }
}

async function maybeRunAnalyticsAuditsVertexMigration() {
  try {
    const tableExists = await query("SELECT 1 FROM information_schema.tables WHERE table_name = 'analytics_audit_schedules'");
    if (tableExists.rows.length === 0) return;

    const constraintCheck = await query(`
      SELECT 1
      FROM (
        SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid IN ('analytics_audit_schedules'::regclass, 'analytics_audit_runs'::regclass)
      ) constraints
      WHERE (table_name = 'analytics_audit_schedules' AND conname = 'analytics_audit_schedules_provider_preset_check' AND def ILIKE '%vertex_auditor%')
         OR (table_name = 'analytics_audit_runs' AND conname = 'analytics_audit_runs_provider_preset_check' AND def ILIKE '%vertex_auditor%')
    `);
    if (constraintCheck.rows.length === 2) return;

    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_analytics_audits_vertex.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_analytics_audits_vertex.sql');
  } catch (err) {
    console.error('[migrations] analytics audits vertex migration failed:', err.message);
  }
}

async function maybeRunClassifierSoftenerBackfill() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_classifier_softener_backfill.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_classifier_softener_backfill.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_classifier_softener_backfill.sql', err.message);
  }
}

// Deploy-safety: add the additive contact_id columns as the FIRST post-listen action.
// NOT awaited before bind (preserves the Cloud Run health-check contract — CodeRabbit
// N1). Metadata-only + idempotent, so the window in which an ingest INSERT could
// reference a not-yet-existing column shrinks to ~one fast op right after bind. No-ops
// on a fresh DB (base tables not created yet); the full migration below reconciles.
async function ensureContactIdColumnsExist() {
  try {
    await query(`
      ALTER TABLE call_logs       ADD COLUMN IF NOT EXISTS contact_id UUID;
      ALTER TABLE client_journeys ADD COLUMN IF NOT EXISTS contact_id UUID;
      ALTER TABLE active_clients  ADD COLUMN IF NOT EXISTS contact_id UUID;
    `);
  } catch (err) {
    console.error('[startup] ensureContactIdColumnsExist skipped (non-fatal):', err.code);
  }
}

// Contact Entity — Phase 1 foundation (contacts + identity tables + nullable
// contact_id FKs). Additive; resolveContact() populates contact_id going forward.
//
// Deploy-safety: migrations run AFTER the port binds (Cloud Run health-check contract),
// so ingest must tolerate the schema not existing yet. It does — ingest INSERTs omit
// the contact_id column until the schema is present (see contactIdInsert in
// services/contacts.js, gated on a cached schema probe). This migration creates the
// contacts schema and proactively flips that readiness flag on success; if migrations
// are managed out-of-process, resolveContact()'s lazy catalog probe turns it on too.
async function maybeRunContactsFoundationMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_contacts_foundation.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    // Schema (tables + indexes + FKs) is live — let resolveContact()/ingest use it.
    const { setContactsSchemaReady } = await import('./services/contacts.js');
    setContactsSchemaReady(true);
    console.log('[migrations] ran migrate_contacts_foundation.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_contacts_foundation.sql', err.message);
  }
}

// Contact Entity — Phase 6 (segmentation): contact_tags + email-consent columns.
async function maybeRunContactsSegmentationMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_contacts_segmentation.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_contacts_segmentation.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_contacts_segmentation.sql', err.message);
  }
}

// Edit Contact Name — add display_name_source column to contacts.
async function maybeRunContactsDisplayNameSourceMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_contacts_display_name_source.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_contacts_display_name_source.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_contacts_display_name_source.sql', err.message);
  }
}

// Contacts Master List — Phase 1: append-only contact_services ledger.
async function maybeRunContactServicesMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_contact_services.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_contact_services.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_contact_services.sql', err.message);
  }
}

async function maybeRunContactServicesEditableMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_contact_services_editable.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_contact_services_editable.sql');
  } catch (err) {
    // Append-only chain: never rethrow (see CLAUDE.md gotcha #3 / migration-chain-break-risk).
    console.error('[migrations] failed migrate_contact_services_editable.sql', err?.message);
  }
}

async function maybeRunPurgeReservedCategoryTagsMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_purge_reserved_category_tags.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migrations] ran migrate_purge_reserved_category_tags.sql');
  } catch (err) {
    console.error('[migrations] failed migrate_purge_reserved_category_tags.sql', err.message);
  }
}

async function maybeRunSystemHealthChecksMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_system_health_checks.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migration] system_health_checks ready');
  } catch (err) {
    // Append-only chain: never rethrow (see CLAUDE.md gotcha #3 / migration-chain-break-risk).
    console.error('[migration] system_health_checks failed:', err?.message);
  }
}

async function maybeRunLeadRemovedAtMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_lead_removed_at.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migration] call_logs.lead_removed_at ready');
  } catch (err) {
    // Append-only chain: never rethrow (see CLAUDE.md gotcha #3 / migration-chain-break-risk).
    console.error('[migration] lead_removed_at failed:', err?.message);
  }
}

async function maybeRunLeadNotesContactUnifyMigration() {
  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', 'migrate_lead_notes_contact_unify.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await query(sql);
    console.log('[migration] lead_notes.contact_id + journey notes amalgamation ready');
  } catch (err) {
    // Append-only chain: never rethrow (see CLAUDE.md gotcha #3 / migration-chain-break-risk).
    console.error('[migration] lead_notes_contact_unify failed:', err?.message);
  }
}

// Audit: log warnings for duplicate active clients or open journeys by normalized phone
async function auditDuplicateLifecycleRecords() {
  try {
    const dupClients = await query(`
      SELECT owner_user_id, RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10) as phone, COUNT(*) as cnt
      FROM active_clients
      WHERE archived_at IS NULL AND client_phone IS NOT NULL
        AND LENGTH(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g')) >= 7
      GROUP BY owner_user_id, RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10)
      HAVING COUNT(*) > 1
    `);
    if (dupClients.rows.length) {
      console.warn(`[lifecycle-audit] Found ${dupClients.rows.length} phones with duplicate active clients:`,
        dupClients.rows.map(r => `owner=${r.owner_user_id} phone=***${r.phone.slice(-4)} count=${r.cnt}`).join('; '));
    }

    const dupJourneys = await query(`
      SELECT owner_user_id, RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10) as phone, COUNT(*) as cnt
      FROM client_journeys
      WHERE archived_at IS NULL AND client_phone IS NOT NULL
        AND LENGTH(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g')) >= 7
      GROUP BY owner_user_id, RIGHT(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'), 10)
      HAVING COUNT(*) > 1
    `);
    if (dupJourneys.rows.length) {
      console.warn(`[lifecycle-audit] Found ${dupJourneys.rows.length} phones with duplicate open journeys:`,
        dupJourneys.rows.map(r => `owner=${r.owner_user_id} phone=***${r.phone.slice(-4)} count=${r.cnt}`).join('; '));
    }

    if (!dupClients.rows.length && !dupJourneys.rows.length) {
      console.log('[lifecycle-audit] No duplicate active clients or open journeys found');
    }
  } catch (err) {
    console.error('[lifecycle-audit] Audit failed:', err.message);
  }
}

// Automatic service redaction after 90 days
async function redactOldServices() {
  try {
    const { rows } = await query(`
      UPDATE client_services 
      SET redacted_at = NOW()
      WHERE redacted_at IS NULL 
        AND agreed_date < NOW() - INTERVAL '90 days'
      RETURNING id
    `);
    if (rows.length > 0) {
      console.log(`[cron:redact-services] Redacted ${rows.length} service(s) older than 90 days`);
    }
  } catch (err) {
    console.error('[cron:redact-services] Error:', err.message);
  }
}

// In the demo deployment, skip ALL scheduled jobs (CTM polling, social publish,
// syncs, cleanups). They would no-op without credentials, but skipping avoids
// wasted compute and log noise. registerCron is a drop-in for cron.schedule.
function registerCron(...args) {
  if (isDemoMode()) {
    return null;
  }
  return cron.schedule(...args);
}

// Schedule daily at 2:00 AM
registerCron(
  '0 2 * * *',
  () => {
    console.log('[cron:redact-services] Running scheduled service redaction');
    redactOldServices();
  },
  {
    timezone: 'America/New_York' // Adjust to your timezone
  }
);

// Auto-redact journey email bodies after 30 days. Bodies are stored (for non-medical clients
// only — see journeyActivities.js) so clients can review recent journey emails in the portal,
// but PHI/content retention is bounded: after 30 days the body collapses back to the sentinel
// the portal drawer already renders. Medical clients are never stored, so this only ever
// touches non-medical rows.
const REDACTABLE_EMAIL_TYPES = ['journey_touch_email', 'journey_test_email'];
async function redactOldEmailBodies() {
  try {
    const { rows } = await query(
      `UPDATE email_logs
         SET text_body = '[redacted - PHI]', html_body = '[redacted - PHI]'
       WHERE created_at < NOW() - INTERVAL '30 days'
         AND email_type = ANY($1)
         AND text_body IS DISTINCT FROM '[redacted - PHI]'
       RETURNING id`,
      [REDACTABLE_EMAIL_TYPES]
    );
    if (rows.length > 0) {
      console.log(`[cron:redact-email-bodies] Redacted ${rows.length} email body(ies) older than 30 days`);
    }
  } catch (err) {
    console.error('[cron:redact-email-bodies] Error:', err.message);
  }
}

// Schedule daily at 2:10 AM
registerCron(
  '10 2 * * *',
  () => {
    console.log('[cron:redact-email-bodies] Running scheduled email-body redaction');
    redactOldEmailBodies();
  },
  {
    timezone: 'America/New_York'
  }
);

// Purge archived task items after 30 days (daily at 2:20 AM)
registerCron(
  '20 2 * * *',
  async () => {
    const retentionDays = Number(process.env.TASK_ARCHIVE_RETENTION_DAYS || 30);
    const result = await purgeArchivedTasks({ retentionDays });
    if (result?.deleted) {
      console.log(`[cron:purge-archived-tasks] deleted ${result.deleted} archived task item(s)`);
    }
  },
  {
    timezone: 'America/New_York'
  }
);

// Evaluate due-date automations every hour
registerCron(
  '0 * * * *',
  async () => {
    try {
      const result = await runDueDateAutomations();
      if (result?.processed) {
        console.log(`[cron:task-automations] processed ${result.processed} due-date automation run(s)`);
      }
    } catch (err) {
      console.error('[cron:task-automations] failed', err?.message || err);
    }
  },
  {
    timezone: 'America/New_York'
  }
);

// Process recurring tasks every 5 minutes
registerCron(
  '*/5 * * * *',
  async () => {
    try {
      await processRecurringTasks();
    } catch (err) {
      console.error('[cron:recurring-tasks] failed', err?.message || err);
    }
  },
  {
    timezone: 'America/New_York'
  }
);

// Send due scheduled journey emails every 5 minutes. Each send was scheduled
// explicitly by a human; the cron is just the dispatcher.
registerCron(
  '*/5 * * * *',
  async () => {
    try {
      const result = await processDueJourneySends();
      if (result?.sent || result?.failed) {
        console.log(`[cron:journey-sends] sent=${result.sent || 0} failed=${result.failed || 0} skipped=${result.skipped || 0}`);
      }
    } catch (err) {
      console.error('[cron:journey-sends] failed', err?.message || err);
    }
  },
  { timezone: 'America/New_York' }
);

// Cleanup old audit logs (HIPAA/SOC2 retention policy - keep 2 years by default)
// Runs daily at 3:00 AM
registerCron(
  '0 3 * * *',
  async () => {
    try {
      const retentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS || 730); // 2 years default
      const { rows } = await query(
        `DELETE FROM security_audit_log
         WHERE created_at < NOW() - INTERVAL '1 day' * $1
         RETURNING id`,
        [retentionDays]
      );
      if (rows.length > 0) {
        console.log(`[cron:audit-cleanup] Deleted ${rows.length} audit log entries older than ${retentionDays} days`);
      }
    } catch (err) {
      console.error('[cron:audit-cleanup] Error:', err.message);
    }
  },
  {
    timezone: 'America/New_York'
  }
);

// Cleanup old user activity logs (30 days retention)
// Runs daily at 3:30 AM
registerCron(
  '30 3 * * *',
  async () => {
    try {
      const retentionDays = Number(process.env.ACTIVITY_LOG_RETENTION_DAYS || 30);
      const { rows } = await query(
        `DELETE FROM user_activity_logs
         WHERE created_at < NOW() - INTERVAL '1 day' * $1
         RETURNING id`,
        [retentionDays]
      );
      if (rows.length > 0) {
        console.log(`[cron:activity-cleanup] Deleted ${rows.length} activity log entries older than ${retentionDays} days`);
      }
    } catch (err) {
      console.error('[cron:activity-cleanup] Error:', err.message);
    }
  },
  {
    timezone: 'America/New_York'
  }
);

// Daily at 2:10 AM: anonymize form submissions older than 2 years (GDPR retention)
registerCron(
  '10 2 * * *',
  async () => {
    try {
      const result = await query(`
        UPDATE ctm_form_submissions
        SET field_data = '{"anonymized": true}'::jsonb,
            attribution_json = NULL,
            anonymized_at = NOW()
        WHERE created_at < NOW() - INTERVAL '2 years'
          AND anonymized_at IS NULL
      `);
      if (result.rowCount > 0) {
        console.log(`[retention] Anonymized ${result.rowCount} form submission(s) older than 2 years`);
      }
    } catch (err) {
      console.error('[retention] Form submission anonymization failed:', err.message);
    }
  },
  {
    timezone: 'America/New_York'
  }
);

  // CTM Forms retry queue — retry transient CTM forwarding failures with backoff.
  cron.schedule('*/2 * * * *', async () => {
    try {
      const result = await processPendingCtmJobs(10);
      if (result.processed > 0) {
        // console.log is nulled in production — use console.warn so this survives in Cloud Run.
        console.warn(`[cron:ctm-retry] processed ${result.processed} CTM retry job(s), ${result.succeeded} sent`);
      }
    } catch (err) {
      console.error('[cron:ctm-retry] failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // Purge old tracking event logs (30 days retention)
  registerCron('30 3 * * *', async () => {
    try {
      const retentionDays = parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 30;
      const { rowCount } = await query(
        `DELETE FROM tracking_event_log WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
        [retentionDays]
      );
      if (rowCount > 0) console.log(`[cron] Purged ${rowCount} old tracking event log entries`);
      // CTM form funnel telemetry — 30-day retention (non-PII counts only).
      const { rowCount: funnelPurged } = await query(
        `DELETE FROM ctm_form_funnel_events WHERE created_at < NOW() - INTERVAL '30 days'`
      );
      if (funnelPurged > 0) console.log(`[cron] Purged ${funnelPurged} old CTM funnel events`);
      // Completed/failed CTM retry jobs — 30-day retention.
      await query(
        `DELETE FROM ctm_form_submission_jobs
           WHERE status IN ('completed', 'failed')
             AND COALESCE(completed_at, created_at) < NOW() - INTERVAL '30 days'`
      ).catch(() => {});
    } catch (err) {
      console.error('[cron] tracking event log cleanup error:', err.message);
    }
  }, { timezone: 'America/New_York' });

// Retry queued form delivery jobs (email + CTM) for reliable submission processing.
registerCron('*/2 * * * *', async () => {
  try {
    const result = await processPendingFormSubmissionJobs(10);
    if (result.processed > 0) {
      console.log(`[cron:form-jobs] processed ${result.processed} queued form submission job(s)`);
    }
  } catch (err) {
    console.error('[cron:form-jobs] failed', err.message);
  }
}, { timezone: 'America/New_York' });

// Scheduled report delivery — check every 15 minutes for due templates and email PDFs.
registerCron('*/15 * * * *', async () => {
  try {
    await tickScheduler();
  } catch (err) {
    console.error('[cron:reports-scheduler] tick failed:', err.message);
  }
}, { timezone: 'America/New_York' });

// CTM auto-sync + classification drain — ticks every minute, but each client is
// polled on an adaptive cadence based on their LOCAL time (client_profiles.timezone):
//   • Daytime (default 7:30am–6:00pm local): poll every 60 seconds — so a new lead
//     lands on the dashboard (and fires its notification) within ~a minute, instead
//     of the old 15-minute worst case.
//   • Outside daytime: poll every 30 minutes — quiet hours don't need the freshness.
//
// Cost note: polling more often does NOT raise AI/Vertex spend — classification only
// runs on NEW content, and lead volume is fixed regardless of cadence. The only thing
// that scales is CTM API request volume (one cheap "anything new since cursor?" call
// per due client), which the day/night split keeps bounded.
//
// Each tick: (1) pull new calls for every DUE client (concurrency-bounded), then
// (2) drain up to 50 classification_pending rows from cached transcripts (no CTM calls).
const DAY_START_MINUTES = 7 * 60 + 30; // 7:30am local
const DAY_END_MINUTES = 18 * 60; // 6:00pm local
// Clamp all three tunables to sane positive values. `Number(x) || default` rejects
// blank/0/non-numeric (which would yield 0 → poll-every-tick, or NaN → never-poll), and
// Math.max enforces a floor so a negative env value can't poison the loop: a 0/negative
// concurrency makes the batch loop (slice(i, i+0), i += 0) spin forever, stranding
// ctmSyncTickRunning=true; a negative interval would make every owner perpetually due.
// NOTE: the effective floor is the cron tick below (1 min) — a sub-minute interval needs
// a sub-minute tick (node-cron 6-field, e.g. '*/30 * * * * *') to actually take effect.
const DAY_POLL_INTERVAL_MS = Math.max(1, Number(process.env.CTM_POLL_DAY_INTERVAL_SEC) || 60) * 1000;
const NIGHT_POLL_INTERVAL_MS = Math.max(1, Number(process.env.CTM_POLL_NIGHT_INTERVAL_SEC) || 1800) * 1000;
const CTM_SYNC_CONCURRENCY = Math.max(1, Number(process.env.CTM_SYNC_CONCURRENCY) || 6);
// owner_user_id → epoch ms of last poll attempt. In-memory: on restart everyone is due
// once (harmless — upsert is idempotent), which avoids a DB write every minute per client.
const ctmLastPolledAt = new Map();
let ctmSyncTickRunning = false;

// Poll interval for a client given their timezone and the current instant.
function ctmPollIntervalForOwner(timezone, now) {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TZ;
  const { hour, minute } = getZonedParts(now, tz);
  const localMinutes = hour * 60 + minute;
  const isDaytime = localMinutes >= DAY_START_MINUTES && localMinutes < DAY_END_MINUTES;
  return isDaytime ? DAY_POLL_INTERVAL_MS : NIGHT_POLL_INTERVAL_MS;
}

registerCron('* * * * *', async () => {
  const enabled = String(process.env.CTM_AUTO_SYNC_DISABLED || '').toLowerCase() !== 'true';
  if (!enabled) return;
  // Overlap guard: if a previous (slow) tick is still draining, skip this one so
  // ticks can't pile up. Due clients are just picked up on the next free tick.
  if (ctmSyncTickRunning) return;
  ctmSyncTickRunning = true;
  try {
    const owners = await query(
      `SELECT user_id, timezone FROM client_profiles WHERE ctm_account_number IS NOT NULL`
    );

    const nowMs = Date.now();
    const now = new Date(nowMs);
    const ids = [];
    for (const row of owners.rows) {
      if (!row.user_id) continue;
      const interval = ctmPollIntervalForOwner(row.timezone, now);
      const last = ctmLastPolledAt.get(row.user_id) || 0;
      if (nowMs - last >= interval) {
        ids.push(row.user_id);
        // Stamp up-front so a slow sync doesn't keep re-selecting this client.
        ctmLastPolledAt.set(row.user_id, nowMs);
      }
    }

    let totalNew = 0;
    let synced = 0;
    for (let i = 0; i < ids.length; i += CTM_SYNC_CONCURRENCY) {
      const batch = ids.slice(i, i + CTM_SYNC_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((id) => syncCallsForOwner(id)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          synced += 1;
          totalNew += r.value.newCalls || 0;
        } else if (r.status === 'rejected') {
          console.error('[cron:ctm-auto-sync] owner sync failed', r.reason?.message || r.reason);
        }
      }
    }

    const drain = await drainPendingClassifications({ limit: 50 });

    if (totalNew > 0 || drain.processed > 0 || drain.skipped > 0 || drain.failed > 0) {
      // console.warn (not console.log) — production nulls console.log, and these
      // counters are how we confirm the adaptive poll is actually working in Cloud Run.
      console.warn(
        `[cron:ctm-auto-sync] due=${ids.length} owners=${synced} newCalls=${totalNew} ` +
          `drain.processed=${drain.processed} drain.skipped=${drain.skipped} drain.failed=${drain.failed}`
      );
    }
  } catch (err) {
    console.error('[cron:ctm-auto-sync] tick failed:', err.message);
  } finally {
    ctmSyncTickRunning = false;
  }
}, { timezone: 'America/New_York' });

// Social publisher — every 2 minutes, claim and publish posts whose
// scheduled_for has arrived. runDuePosts handles its own row-level claim locking.
registerCron('*/2 * * * *', async () => {
  try {
    await runDuePosts();
  } catch (e) {
    console.error('[cron:social-publish]', e?.message);
  }
}, { timezone: 'America/New_York' });

// Daily 4 AM ET — health-check every active meta_page_link so token issues
// surface in the UI before a scheduled post fails.
registerCron('0 4 * * *', async () => {
  try {
    const { rows } = await query(
      'SELECT id FROM meta_page_links WHERE archived_at IS NULL'
    );
    for (const r of rows) {
      try { await healthCheckPage(r.id); } catch (_) { /* tracked in DB */ }
    }
  } catch (e) {
    console.error('[cron:social-health]', e?.message);
  }
}, { timezone: 'America/New_York' });

// Daily production health sweep — emails super-admins only on failure.
cron.schedule('0 8 * * *', async () => {
  if (process.env.DEMO_MODE === 'true') return;
  try {
    const { runDailyHealthCheck } = await import('./services/health/runner.js');
    const summary = await runDailyHealthCheck();
    console.log(`[cron:health] ${summary.failing.length} failing of ${summary.results.length}`);
  } catch (e) {
    console.error('[cron:health]', e?.message);
  }
}, { timezone: 'America/New_York' });

// Start listening FIRST so Cloud Run health check succeeds
const httpServer = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${PORT} (${NODE_ENV})`);

  // Run migrations AFTER server is listening (non-blocking).
  // contact_id columns first (fast, ~one op after bind) so ingest never references a
  // missing column; the full contacts foundation/segmentation run append-only at the
  // TAIL of the chain (see below) — order doesn't matter functionally (idempotent,
  // resolveContact lazily probes the catalog), and tail placement guarantees lead_tags
  // exists before the segmentation migration references it.
  ensureContactIdColumnsExist()
    .then(maybeRunMigrations)
    .then(maybeRunReviewsMigration)
    .then(maybeRunSecurityMigration)
    .then(maybeRunOnboardingTokenMigration)
    .then(maybeRunActivityLogsMigration)
    .then(maybeRunAiClassificationLogsMigration)
    .then(maybeRunFormsPlatformMigration)
    .then(maybeRunOnboardingTokenFixMigration)
    .then(maybeRunTwilioIntegrationMigration)
    .then(maybeRunFileStorageMigration)
    .then(maybeRunIpHashFixMigration)
    .then(maybeRunTaskEventsMigration)
    .then(maybeRunAutomationV2Migration)
    .then(maybeRunAutomationV3Migration)
    .then(maybeRunCtmFormsMigration)
    .then(maybeRunCtmFormsV2Migration)
    .then(maybeRunTutorialsMigration)
    .then(maybeRunPortalUpdatesMigration)
    .then(maybeRunCtmFormsSpamMigration)
    .then(maybeRunClientAnalyticsMigration)
    .then(maybeRunCtmFormsConsentMigration)
    .then(maybeRunCtmBaaMigration)
    .then(maybeRunCtmFormsRetentionMigration)
    .then(maybeRunCtmFormsAutoresponderMigration)
    .then(maybeRunCtmFormsAutoresponderV2Migration)
    .then(maybeRunCtmFormsAutoresponderV3Migration)
    .then(maybeRunJourneyStepsEmailMigration)
    .then(maybeRunSessionGracePeriodMigration)
    .then(maybeRunTeamMemberCleanup)
    .then(maybeRunFormSubmissionsHashedPhoneMigration)
    .then(maybeRunCallLogsHiddenMigration)
    .then(maybeRunCtmFormSubmissionRecaptchaJsonMigration)
    .then(maybeRunCtmFormTemplatesMigration)
    .then(maybeRunLifecycleBackfillMigration)
    .then(maybeRunDedupFormSubmissionsMigration)
    .then(maybeRunFixClientMembershipsMigration)
    .then(maybeRunClientGroupAccessMigration)
    .then(maybeRunTrackingMigration)
    .then(maybeRunTrackingV2Migration)
    .then(maybeRunTrackingV3Migration)
    .then(maybeRunTrackingV4Migration)
    .then(maybeRunTrackingV5Migration)
    .then(maybeRunTaskLabelsMigration)
    .then(maybeRunTaskDepsRecurrenceMigration)
    .then(maybeRunTaskDashboardsMigration)
    .then(maybeRunTaskItemLinksMigration)
    .then(maybeRunTaskMirrorColumnsMigration)
    .then(maybeRunTaskBaselinesMigration)
    .then(maybeRunTaskTimeTrackingV2Migration)
    .then(maybeRunTaskWebhooksMigration)
    .then(maybeRunSubitemWorkflowMigration)
    .then(maybeRunAnalyticsReportsMigration)
    .then(maybeRunReportSnapshotsMigration)
    .then(maybeRunAnalyticsAuditsMigration)
    .then(maybeRunAnalyticsAuditsVertexMigration)
    .then(maybeRunUserFkCascadeMigration)
    .then(maybeRunAccountManagerUserMigration)
    .then(maybeRunFixClientNamesMigration)
    .then(maybeRunReportBuilderMigration)
    .then(maybeRunReportGenerationCancelMigration)
    .then(maybeRunReportCsvExportMigration)
    .then(maybeRunAiWebReportsMigration)
    .then(maybeRunAiWebReportsPhiMigration)
    .then(maybeRunAiWebReportsEnabledMigration)
    .then(maybeRunAiWebReportsApprovalFreezeMigration)
    .then(maybeRunKinstaOperationsMigration)
    .then(maybeRunKinstaFindingsMigration)
    .then(maybeRunOpsPhase0DriftBaselineMigration)
    .then(maybeRunOpsFoundationMigration)
    .then(maybeRunOpsVulnFeedMigration)
    .then(maybeRunOpsSeedRunDefinitionsMigration)
    .then(maybeRunOpsSeedMetaRunDefinitionsMigration)
    .then(maybeRunOpsKeywordHistoryMigration)
    .then(maybeRunOpsSeedGadsRunDefinitionsMigration)
    .then(maybeRunOpsCheckResultsTrendIndexMigration)
    .then(maybeRunOpsSubscriptionEmailMigration)
    .then(maybeRunOpsMonthlyCapMigration)
    .then(maybeRunOpsAuditRunsDeprecationMarkerMigration)
    .then(maybeRunOpsDiscoveriesUpgradeMigration)
    .then(maybeRunOpsSkillsAndBulkMigration)
    .then(maybeSyncOpsSeedSkills)
    .then(maybeRunOpsRecipesMigration)
    .then(maybeRunOpsSkillModelMigration)
    .then(maybeRunSocialPublishingMigration)
    .then(backfillSocialClientLinks)
    .then(() => {
      if (!isDemoMode()) {
        setInterval(() => { tickBulkSchedules().catch(() => {}); }, 60_000);
      }
    })
    .then(maybeRunClassifierSoftenerBackfill)
    .then(maybeRunClientTimezoneMigration)
    .then(maybeRunJourneyStepSendHourMigration)
    .then(maybeRunBrandAssetsDedupUniqueMigration)
    .then(maybeRunBrandAssetsDisplayLogoMigration)
    .then(maybeRunLeadJourneyRedesignMigration)
    .then(maybeRunJourneyTemplateReplyToMigration)
    .then(maybeRunJourneyTemplateAttachmentsMigration)
    .then(maybeRunJourneyTemplateEmailTextMigration)
    .then(maybeRunJourneyExampleTemplateMigration)
    .then(maybeRunJourneyBackfillStartedAttributionMigration)
    // Contact Entity (Phase 1 foundation + Phase 6 segmentation) — appended at the tail
    // to keep the migration chain append-only (CLAUDE.md gotcha #3). Foundation before
    // segmentation; foundation flips resolveContact's schema-ready flag on success.
    .then(maybeRunContactsFoundationMigration)
    .then(maybeRunContactsSegmentationMigration)
    // Align journey email activities' body_format with their (HTML) body so the in-app
    // timeline/preview matches what's sent. Append-only (CLAUDE.md gotcha #3).
    .then(maybeRunJourneyActivityBodyFormatHtmlBackfillMigration)
    .then(maybeRunContactsDisplayNameSourceMigration)
    .then(maybeRunContactServicesMigration)
    .then(maybeRunPurgeReservedCategoryTagsMigration)
    .then(maybeRunCtmFormOutcomeMigration)
    .then(maybeRunSystemHealthChecksMigration)
    .then(maybeRunContactServicesEditableMigration)
    .then(maybeRunLeadRemovedAtMigration)
    .then(maybeRunLeadNotesContactUnifyMigration)
    .then(auditDuplicateLifecycleRecords)
    .then(() => {
      console.log('[migrations] All migrations completed successfully');
      // Register event bus subscribers after migrations complete
      registerTaskEventSubscribers();
      // Seed demo account if it doesn't exist yet
      maybeSeedDemoAccount().catch((err) => console.error('[demo-seed] Error:', err.message));
    })
    .catch((err) => {
      // Log error but don't crash - server is already running
      console.error('[migrations] Migration failed (server still running):', err.message);
    });
});

/**
 * One-shot startup reconciliation: walk every client that has a facebook_page
 * oauth_resource and call syncClientFacebookLinks. Idempotent — re-running is
 * a no-op once meta_page_links is in sync. Wrapped so it can never crash
 * server startup.
 */
async function backfillSocialClientLinks() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT client_id
         FROM oauth_resources
        WHERE provider = 'facebook'
          AND resource_type = 'facebook_page'
          AND is_enabled = TRUE`
    );
    if (!rows.length) return;
    const { syncClientFacebookLinks } = await import('./services/socialClientLinkSync.js');
    let touched = 0;
    for (const r of rows) {
      try {
        const result = await syncClientFacebookLinks(r.client_id, { actorId: null });
        if (result.autoLinked) touched++;
      } catch (e) {
        console.error('[backfill:social-links] client', r.client_id, e?.message);
      }
    }
    if (touched > 0) {
      console.warn(`[backfill:social-links] auto-linked ${touched} clients`);
    }
  } catch (e) {
    console.error('[backfill:social-links] failed:', e?.message);
  }
}

async function tickBulkSchedules() {
  try {
    const mod = await import('./services/ops/scheduleFanout.js');
    const { rows } = await query(`
      SELECT id, cadence, day_of_week, day_of_month, hour_local, timezone
        FROM ops_bulk_schedules
       WHERE enabled = TRUE AND (next_run_at IS NULL OR next_run_at <= now())
    `);
    for (const r of rows) {
      try {
        await mod.fanOutBulkSchedule(r.id);
        const next = mod.computeNextRunAt(r);
        await query('UPDATE ops_bulk_schedules SET next_run_at = $2 WHERE id = $1', [r.id, next]);
      } catch (e) {
        console.error('[bulk-tick] schedule failed', r.id, e?.message || e);
      }
    }
  } catch (e) {
    console.error('[bulk-tick]', e?.message || e);
  }
}

attachOperationsWebSocket(httpServer);
