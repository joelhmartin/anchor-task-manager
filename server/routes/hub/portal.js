// Hub client-portal routes: self-scoped activity logs and email logs (+CSV exports). Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';

import { query } from '../../db.js';
import { fetchActivityLogs, getActionLabel, getCategoryLabel } from '../../services/activityLog.js';
import { logSecurityEvent } from '../../services/security/index.js';
import { fetchEmailLogs, fetchEmailLogById } from '../../services/mailgun.js';
import { csvCell, formatCsvDate } from '../../utils/csv.js';
import { CONTACT_ROUTE_UUID_RE } from './_shared.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT PORTAL: ACTIVITY LOG (self-scoped activity logs + email logs)
//
// These are the client-facing counterparts of the admin-only /email-logs and
// /user-activity-logs/:userId endpoints. They run under the default requireAuth
// (router.use above) and ALWAYS self-scope to req.portalUserId — never a client-
// supplied id. Activity = account owner + active members; Email = client_id match.
// ip_address/user_agent and agency identity are hidden; export bodies are opt-in.
// ─────────────────────────────────────────────────────────────────────────────

const PORTAL_EXPORT_MAX = 10000;

// A date-only `to` value (YYYY-MM-DD) is parsed as midnight, which would exclude that day's
// rows from a `created_at <= to` bound. Extend it to end-of-day so the range is inclusive.
const inclusiveEndBound = (to) => (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : to || undefined);

// Parse a ?columns=a,b,c list against a registry, preserving the registry's canonical order;
// fall back to the registry's `default: true` set when nothing valid is requested.
function resolvePortalCsvColumns(raw, registry) {
  const requested = typeof raw === 'string' ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const picked = registry.filter((c) => requested.includes(c.key)).map((c) => c.key);
  return picked.length ? picked : registry.filter((c) => c.default).map((c) => c.key);
}

const activityActorLabel = (r) => {
  const name = `${r.user_first_name || ''} ${r.user_last_name || ''}`.trim();
  return name || r.user_email || '';
};

// details is sanitized at write-time (services/activityLog.js sanitizeDetails strips PHI keys),
// so a compact JSON dump is safe for the client's own export.
const activityDetailsSummary = (r) => {
  if (!r.details || typeof r.details !== 'object') return '';
  const keys = Object.keys(r.details);
  if (!keys.length) return '';
  try {
    return JSON.stringify(r.details);
  } catch {
    return '';
  }
};

const ACTIVITY_CSV_COLUMNS = [
  { key: 'date', header: 'Date', default: true, value: (r) => formatCsvDate(r.created_at) },
  { key: 'actor', header: 'Team member', default: true, value: activityActorLabel },
  { key: 'action', header: 'Action', default: true, value: (r) => getActionLabel(r.action_type) },
  { key: 'category', header: 'Category', default: true, value: (r) => getCategoryLabel(r.action_category) },
  { key: 'entity', header: 'Entity', value: (r) => r.target_entity_type || '' },
  { key: 'details', header: 'Details', value: activityDetailsSummary }
];

const EMAIL_CSV_COLUMNS = [
  { key: 'type', header: 'Type', default: true, value: (r) => r.email_type || '' },
  { key: 'recipient', header: 'Recipient', default: true, value: (r) => r.recipient_email || '' },
  { key: 'subject', header: 'Subject', default: true, value: (r) => r.subject || '' },
  { key: 'status', header: 'Status', default: true, value: (r) => r.status || '' },
  { key: 'sent_at', header: 'Sent', default: true, value: (r) => formatCsvDate(r.sent_at) },
  { key: 'delivered_at', header: 'Delivered', default: true, value: (r) => formatCsvDate(r.delivered_at) },
  { key: 'opened_at', header: 'Opened', default: true, value: (r) => formatCsvDate(r.opened_at) },
  { key: 'open_count', header: 'Open count', default: true, value: (r) => r.open_count ?? 0 },
  { key: 'clicked_at', header: 'Clicked', default: true, value: (r) => formatCsvDate(r.clicked_at) },
  { key: 'bounced_at', header: 'Bounced', default: true, value: (r) => formatCsvDate(r.bounced_at) },
  // Optional, off-by-default columns (the dialog flags text_body as possibly sensitive).
  { key: 'recipient_name', header: 'Recipient name', value: (r) => r.recipient_name || '' },
  { key: 'text_body', header: 'Body', value: (r) => r.text_body || '' }
];

const buildCsv = (columns, registryByKey, rows) => {
  const lines = [columns.map((key) => csvCell(registryByKey[key].header)).join(',')];
  for (const r of rows) {
    lines.push(columns.map((key) => csvCell(registryByKey[key].value(r))).join(','));
  }
  return lines.join('\n');
};

const ACTIVITY_CSV_BY_KEY = Object.fromEntries(ACTIVITY_CSV_COLUMNS.map((c) => [c.key, c]));
const EMAIL_CSV_BY_KEY = Object.fromEntries(EMAIL_CSV_COLUMNS.map((c) => [c.key, c]));

const clampPortalLimit = (raw, fallback = 50) => Math.min(Math.max(parseInt(raw, 10) || fallback, 1), 100);

// GET /portal/activity-logs — paginated activity for the client's own account team.
router.get('/portal/activity-logs', async (req, res) => {
  try {
    const portalUserId = req.portalUserId || req.user.id;
    const { page, limit, search, category, from, to } = req.query;
    const result = await fetchActivityLogs({
      accountOwnerId: portalUserId,
      includeOwner: true,
      excludeCategories: ['admin'],
      omitNetworkFields: true,
      page: parseInt(page, 10) || 1,
      limit: clampPortalLimit(limit),
      search: search || undefined,
      category: category && category !== 'all' ? category : undefined,
      startDate: from || undefined,
      endDate: inclusiveEndBound(to)
    });
    res.json(result);
  } catch (err) {
    console.error('[portal:activity-logs]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load activity logs.' });
  }
});

// GET /portal/activity-logs/export.csv — column selection + date range. Audited; capped.
router.get('/portal/activity-logs/export.csv', async (req, res) => {
  try {
    const portalUserId = req.portalUserId || req.user.id;
    const columns = resolvePortalCsvColumns(req.query.columns, ACTIVITY_CSV_COLUMNS);
    const { logs } = await fetchActivityLogs({
      accountOwnerId: portalUserId,
      includeOwner: true,
      excludeCategories: ['admin'],
      omitNetworkFields: true,
      page: 1,
      limit: PORTAL_EXPORT_MAX,
      startDate: req.query.from || undefined,
      endDate: inclusiveEndBound(req.query.to)
    });
    await logSecurityEvent({
      userId: req.user.id, eventType: 'portal_activity_export', eventCategory: 'activity', success: true,
      details: { ownerUserId: portalUserId, count: logs.length, columns, from: req.query.from || null, to: req.query.to || null }
    }).catch(() => {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.csv"');
    res.send(buildCsv(columns, ACTIVITY_CSV_BY_KEY, logs));
  } catch (err) {
    console.error('[portal:activity-export]', { code: err?.code });
    res.status(500).json({ message: 'Failed to export activity logs.' });
  }
});

// Map a raw email_logs row to the client-safe shape (no agency identity / internal fields).
const safeEmailRow = (r) => ({
  id: r.id,
  email_type: r.email_type,
  recipient_email: r.recipient_email,
  recipient_name: r.recipient_name,
  subject: r.subject,
  status: r.status,
  created_at: r.created_at,
  sent_at: r.sent_at,
  delivered_at: r.delivered_at,
  opened_at: r.opened_at,
  open_count: r.open_count,
  clicked_at: r.clicked_at,
  click_count: r.click_count,
  bounced_at: r.bounced_at,
  bounce_type: r.bounce_type,
  complained_at: r.complained_at,
  unsubscribed_at: r.unsubscribed_at
});

// GET /portal/email-logs — paginated emails about this client (metadata + delivery, no body).
router.get('/portal/email-logs', async (req, res) => {
  try {
    const portalUserId = req.portalUserId || req.user.id;
    const { page, limit, email_type, status, search, from, to } = req.query;
    const result = await fetchEmailLogs({
      clientId: portalUserId,
      page: parseInt(page, 10) || 1,
      limit: clampPortalLimit(limit),
      emailType: email_type,
      status,
      search,
      dateFrom: from,
      dateTo: inclusiveEndBound(to)
    });
    res.json({ logs: result.logs.map(safeEmailRow), pagination: result.pagination });
  } catch (err) {
    console.error('[portal:email-logs]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load email logs.' });
  }
});

// GET /portal/email-logs/export.csv — column selection (text_body opt-in) + date range. Audited; capped.
router.get('/portal/email-logs/export.csv', async (req, res) => {
  try {
    const portalUserId = req.portalUserId || req.user.id;
    const columns = resolvePortalCsvColumns(req.query.columns, EMAIL_CSV_COLUMNS);
    const toBound = inclusiveEndBound(req.query.to);
    const params = [portalUserId];
    let sql = `SELECT id, email_type, recipient_email, recipient_name, subject, status,
                 created_at, sent_at, delivered_at, opened_at, open_count, clicked_at,
                 bounced_at, text_body
               FROM email_logs WHERE client_id = $1`;
    if (req.query.from) { params.push(req.query.from); sql += ` AND created_at >= $${params.length}`; }
    if (toBound) { params.push(toBound); sql += ` AND created_at <= $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT ${PORTAL_EXPORT_MAX}`;
    const { rows } = await query(sql, params);
    await logSecurityEvent({
      userId: req.user.id, eventType: 'portal_email_export', eventCategory: 'email', success: true,
      details: { ownerUserId: portalUserId, count: rows.length, columns, includesBody: columns.includes('text_body'), from: req.query.from || null, to: req.query.to || null }
    }).catch(() => {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="email-logs.csv"');
    res.send(buildCsv(columns, EMAIL_CSV_BY_KEY, rows));
  } catch (err) {
    console.error('[portal:email-export]', { code: err?.code });
    res.status(500).json({ message: 'Failed to export email logs.' });
  }
});

// GET /portal/email-logs/:id — single email WITH body, gated to the owning client (404 otherwise).
router.get('/portal/email-logs/:id', async (req, res) => {
  try {
    if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(404).json({ message: 'Email log not found.' });
    const portalUserId = req.portalUserId || req.user.id;
    const row = await fetchEmailLogById(req.params.id);
    if (!row || row.client_id !== portalUserId) {
      return res.status(404).json({ message: 'Email log not found.' });
    }
    res.json({ ...safeEmailRow(row), text_body: row.text_body, html_body: row.html_body, error_message: row.error_message });
  } catch (err) {
    console.error('[portal:email-detail]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load email.' });
  }
});

export default router;
