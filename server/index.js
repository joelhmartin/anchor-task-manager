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
import tasksRouter from './routes/tasks.js';
import { query } from './db.js';
import { purgeArchivedTasks } from './services/taskCleanup.js';
import { runDueDateAutomations } from './services/taskAutomations.js';
import { processRecurringTasks } from './services/taskRecurrence.js';
import { registerTaskEventSubscribers } from './services/taskEventSubscribers.js';
import { isDemoMode } from './services/demoMode.js';

const app = express();
// Cloud Run sets PORT=8080, so prioritize that over API_SERVER_PORT.
const PORT = process.env.PORT || process.env.API_SERVER_PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';
// Silence verbose logging in production to reduce Cloud Logging costs.
if (NODE_ENV === 'production') console.log = () => {};
const RUN_MIGRATIONS = process.env.RUN_MIGRATIONS_ON_START ?? (NODE_ENV === 'production' ? 'true' : 'false');
const CLIENT_BUILD_DIR = path.resolve(process.cwd(), 'dist');
const EMAIL_ASSETS_DIR = path.resolve(process.cwd(), 'server', 'assets', 'email');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQL_DIR = path.join(__dirname, 'sql');

// Crash visibility: log async crashes so Cloud Run doesn't just surface opaque 503s.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Security headers (CSP)
// ---------------------------------------------------------------------------
const CSP_FRAME_SRC = (process.env.CSP_FRAME_SRC || '').split(',').map((s) => s.trim()).filter(Boolean);
const CSP_IMG_SRC = (process.env.CSP_IMG_SRC || '').split(',').map((s) => s.trim()).filter(Boolean);

const baseCspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
  'script-src-elem': ["'self'", 'https://cdn.jsdelivr.net'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
  'style-src-elem': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
  'img-src': ["'self'", 'data:', 'blob:', ...CSP_IMG_SRC],
  'media-src': ["'self'", 'blob:', 'data:'],
  'connect-src': ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
  'worker-src': ["'self'", 'blob:', 'https://cdn.jsdelivr.net'],
  'child-src': ["'self'", 'blob:'],
  // blob: lets the task drawer iframe authenticated PDF previews (object URL of a fetched blob).
  'frame-src': ["'self'", 'blob:', ...CSP_FRAME_SRC]
};

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
function normalizeOrigin(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/\/$/, '');
}

const allowedOrigins = (() => {
  const selfOrigin = `http://localhost:${PORT}`;
  const defaults = ['http://localhost:3000', 'http://localhost:4173', selfOrigin];
  const fromEnv = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  // The main app's origin is allowed so the SSO handshake / cross-app calls work.
  const appBase = [process.env.APP_BASE_URL, process.env.CLIENT_APP_URL, process.env.MAIN_APP_URL].filter(Boolean);
  return new Set([...defaults, ...fromEnv, ...appBase].map(normalizeOrigin).filter(Boolean));
})();

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // non-browser / same-origin
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  helmet({
    contentSecurityPolicy: { useDefaults: false, directives: baseCspDirectives }
  })
);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);

// Avatars live in the shared users table as `/api/hub/users/:id/avatar` paths and
// are served by the dashboard's public avatar route. Redirect those requests there
// so every avatar (profile + task assignees) resolves without a local /api/hub route.
app.get('/api/hub/users/:id/avatar', (req, res) => {
  const main = (process.env.MAIN_APP_URL || '').replace(/\/$/, '');
  if (!main) return res.status(404).end();
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  return res.redirect(302, `${main}/api/hub/users/${encodeURIComponent(req.params.id)}/avatar${qs}`);
});

// Task file attachments are stored in task_files.data (BYTEA) and served through
// the authenticated /api/tasks/files/:id/content endpoint. No public /uploads
// static handler — that would re-introduce the auth bypass the BYTEA migration closed.
app.use('/email-assets', express.static(EMAIL_ASSETS_DIR));
// Serve Vite build assets (also covered by the catch-all static below in prod).
app.use('/assets', express.static(path.join(process.cwd(), 'dist', 'assets')));

if (NODE_ENV === 'production') {
  app.use(
    express.static(CLIENT_BUILD_DIR, {
      setHeaders: (res, filePath) => {
        const normalized = String(filePath || '').replace(/\\/g, '/');
        if (normalized.endsWith('/index.html') || normalized.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
          return;
        }
        if (normalized.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    })
  );
}

// Liveness probe for Cloud Run.
app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.get('/api/app-config', (req, res) => {
  const env = process.env.APP_BASE_URL || '';
  const appBaseUrl = env && !env.includes('localhost') ? env : `http://localhost:${PORT}`;
  res.json({ appBaseUrl, mainAppUrl: process.env.MAIN_APP_URL || null });
});

// SPA fallback (production): serve index.html for any non-API route.
if (NODE_ENV === 'production') {
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

// ---------------------------------------------------------------------------
// Migrations — run the base schema, shared auth/activity tables, then the task
// incrementals in dependency order. Each file is idempotent (IF NOT EXISTS).
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  'init.sql', // base schema (users, notifications, email_logs, task_* cluster, …)
  'migrate_security.sql', // user_sessions, security_audit_log, auth columns
  'migrate_activity_logs.sql', // user_activity_logs (task audit log feeds this)
  // Task incrementals — order matters (v3 builds on v2, etc.)
  'task-events.sql',
  'task-automation-v2.sql',
  'task-automation-v3.sql',
  'task-labels.sql',
  'task-deps-recurrence.sql',
  'task-dashboards.sql',
  'task-item-links.sql',
  'task-mirror-columns.sql',
  'task-baselines.sql',
  'task-time-tracking-v2.sql',
  'task-webhooks.sql',
  'task-subitem-workflow.sql',
  'task-updates-threading.sql',
  'task-files-storage.sql',
  'task-subitem-position.sql'
];

async function runMigrationFile(file) {
  let sql;
  try {
    sql = await readFile(path.join(SQL_DIR, file), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`[migrations] ${file} not found — skipping`);
      return;
    }
    throw err;
  }
  try {
    await query(sql);
    console.log(`[migrations] ran ${file}`);
  } catch (err) {
    if (err.message?.includes('already exists')) return;
    throw err;
  }
}

async function runMigrations() {
  if (String(RUN_MIGRATIONS).toLowerCase() !== 'true') {
    console.log('[migrations] RUN_MIGRATIONS_ON_START is not "true" — skipping');
    return;
  }
  for (const file of MIGRATIONS) {
    await runMigrationFile(file);
  }
  console.log('[migrations] all migrations completed');
}

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------
function registerCron(...args) {
  if (isDemoMode()) return null;
  return cron.schedule(...args);
}

const CRON_TZ = process.env.CRON_TIMEZONE || 'America/New_York';

// Purge archived task items after the retention window (daily at 2:20 AM).
registerCron(
  '20 2 * * *',
  async () => {
    try {
      const retentionDays = Number(process.env.TASK_ARCHIVE_RETENTION_DAYS || 30);
      const result = await purgeArchivedTasks({ retentionDays });
      if (result?.deleted) console.log(`[cron:purge-archived-tasks] deleted ${result.deleted} archived task item(s)`);
    } catch (err) {
      console.error('[cron:purge-archived-tasks] failed', err?.message || err);
    }
  },
  { timezone: CRON_TZ }
);

// Evaluate due-date automations every hour.
registerCron(
  '0 * * * *',
  async () => {
    try {
      const result = await runDueDateAutomations();
      if (result?.processed) console.log(`[cron:task-automations] processed ${result.processed} due-date run(s)`);
    } catch (err) {
      console.error('[cron:task-automations] failed', err?.message || err);
    }
  },
  { timezone: CRON_TZ }
);

// Process recurring tasks every 5 minutes.
registerCron(
  '*/5 * * * *',
  async () => {
    try {
      await processRecurringTasks();
    } catch (err) {
      console.error('[cron:recurring-tasks] failed', err?.message || err);
    }
  },
  { timezone: CRON_TZ }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// Start listening FIRST so the Cloud Run health check succeeds, then migrate.
app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT} (${NODE_ENV})`);
  runMigrations()
    .then(() => {
      registerTaskEventSubscribers();
    })
    .catch((err) => {
      console.error('[migrations] failed (server still running):', err.message);
    });
});
