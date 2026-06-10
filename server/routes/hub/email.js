// Hub admin email routes: send a Mailgun test message and read the email-log
// admin endpoints (list, stats, single). Mounted by the hub.js aggregator AFTER
// `router.use(requireAuth)`; each route additionally guards with isAdminOrEditor.
import express from 'express';

import {
  isMailgunConfigured,
  sendMailgunMessageWithLogging,
  fetchEmailLogs,
  fetchEmailLogById,
  getEmailStats
} from '../../services/mailgun.js';
import { logEvent } from '../../services/hubUtils.js';
import { isAdminOrEditor } from '../../middleware/roles.js';

const router = express.Router();

router.post('/email/test', isAdminOrEditor, async (req, res) => {
  if (!isMailgunConfigured()) {
    return res.status(400).json({ message: 'Mailgun credentials are not configured' });
  }
  const { to, subject, text, html } = req.body || {};
  if (!to) return res.status(400).json({ message: 'Recipient is required' });
  const resolvedSubject = subject || 'Anchor Mailgun Test';
  const bodyText = text || 'Test email sent via Mailgun sandbox.';

  try {
    const response = await sendMailgunMessageWithLogging(
      {
        to,
        subject: resolvedSubject,
        text: bodyText,
        html
      },
      {
        emailType: 'test',
        triggeredById: req.user?.id,
        metadata: { source: 'admin_test' }
      }
    );
    logEvent('mailgun:test', 'Mailgun test email sent', { id: response.id, message: response.message });
    res.json({ id: response.id, message: response.message });
  } catch (err) {
    logEvent('mailgun:test', 'Failed to send test email', { error: err.message });
    res.status(500).json({ message: err.message || 'Unable to send email' });
  }
});

// Email Logs - Admin endpoints
router.get('/email-logs', isAdminOrEditor, async (req, res) => {
  try {
    const { page, limit, email_type, status, search, date_from, date_to } = req.query;
    const result = await fetchEmailLogs({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
      emailType: email_type,
      status,
      search,
      dateFrom: date_from,
      dateTo: date_to
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to fetch email logs' });
  }
});

router.get('/email-logs/stats', isAdminOrEditor, async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const stats = await getEmailStats(days);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to fetch email stats' });
  }
});

router.get('/email-logs/:id', isAdminOrEditor, async (req, res) => {
  try {
    const log = await fetchEmailLogById(req.params.id);
    if (!log) {
      return res.status(404).json({ message: 'Email log not found' });
    }
    res.json(log);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to fetch email log' });
  }
});

export default router;
