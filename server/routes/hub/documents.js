// Hub documents routes: per-user client documents (/docs) and admin-managed shared documents (/shared-docs). Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';

import { query } from '../../db.js';
import { logDocumentActivity, ActivityEventTypes } from '../../services/activityLog.js';
import { requireAdmin } from '../../middleware/auth.js';
import { isAdminOrEditor } from '../../middleware/roles.js';
import { storeFile, deleteFile } from '../../services/fileStorage.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from '../../services/mailgun.js';
import { createNotification, createNotificationsForAdmins, notifyAdminsByEmail } from '../../services/notifications.js';
import { resolveBaseUrl } from '../../services/hubUtils.js';
import { uploadDocs, publicUrl } from './_shared.js';

const router = express.Router();

router.get('/docs', async (req, res) => {
  const defaultDocs = process.env.DEFAULT_DOCS ? JSON.parse(process.env.DEFAULT_DOCS) : [];
  const targetUserId = req.portalUserId || req.user.id;
  const { rows } = await query(
    `SELECT
       d.*,
       fu.content_type AS file_content_type,
       fu.size_bytes AS file_size_bytes,
       rii.id AS report_run_item_id,
       rii.published_at AS report_published_at,
       rr.id AS report_run_id,
       rr.template_id AS report_template_id,
       rr.date_range AS report_date_range,
       rt.name AS report_template_name
       FROM documents d
       LEFT JOIN file_uploads fu ON fu.id = d.file_id
       LEFT JOIN report_run_items rii ON rii.document_id = d.id
       LEFT JOIN report_runs rr ON rr.id = rii.run_id
       LEFT JOIN report_templates rt ON rt.id = rr.template_id
      WHERE d.user_id = $1
      ORDER BY d.created_at DESC`,
    [targetUserId]
  );
  const docs = [
    ...defaultDocs.map((d) => ({ ...d, type: 'default', origin: 'default', review_status: 'none' })),
    ...rows.map((r) => ({
      id: r.id,
      label: r.label || r.name,
      name: r.name,
      url: r.url,
      type: r.type || 'client',
      origin: r.origin || 'client',
      review_status: r.review_status || 'none',
      review_requested_at: r.review_requested_at,
      viewed_at: r.viewed_at,
      created_at: r.created_at,
      file_id: r.file_id || null,
      content_type: r.file_content_type || null,
      size_bytes: r.file_size_bytes || null,
      report_run_item_id: r.report_run_item_id || null,
      report_run_id: r.report_run_id || null,
      report_template_id: r.report_template_id || null,
      report_template_name: r.report_template_name || null,
      report_date_range: r.report_date_range || null,
      report_published_at: r.report_published_at || null
    }))
  ];
  res.json({ docs });
});

router.get('/docs/admin/:userId', isAdminOrEditor, async (req, res) => {
  const targetUser = req.params.userId;
  const defaultDocs = process.env.DEFAULT_DOCS ? JSON.parse(process.env.DEFAULT_DOCS) : [];
  const { rows } = await query(
    `SELECT
       d.*,
       rii.id AS report_run_item_id,
       rii.published_at AS report_published_at,
       rr.id AS report_run_id,
       rr.template_id AS report_template_id,
       rr.date_range AS report_date_range,
       rt.name AS report_template_name
      FROM documents d
      LEFT JOIN report_run_items rii ON rii.document_id = d.id
      LEFT JOIN report_runs rr ON rr.id = rii.run_id
      LEFT JOIN report_templates rt ON rt.id = rr.template_id
     WHERE d.user_id = $1
     ORDER BY d.created_at DESC`,
    [targetUser]
  );
  const docs = [
    ...defaultDocs.map((d) => ({ ...d, type: 'default', origin: 'default', review_status: 'none' })),
    ...rows.map((r) => ({
      id: r.id,
      label: r.label || r.name,
      name: r.name,
      url: r.url,
      type: r.type || 'client',
      origin: r.origin || 'client',
      review_status: r.review_status || 'none',
      review_requested_at: r.review_requested_at,
      viewed_at: r.viewed_at,
      created_at: r.created_at,
      report_run_item_id: r.report_run_item_id || null,
      report_run_id: r.report_run_id || null,
      report_template_id: r.report_template_id || null,
      report_template_name: r.report_template_name || null,
      report_date_range: r.report_date_range || null,
      report_published_at: r.report_published_at || null
    }))
  ];
  res.json({ docs });
});
router.post('/docs', uploadDocs.array('client_doc', 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });
  const targetUserId = req.portalUserId || req.user.id;
  const inserted = [];
  for (const file of req.files) {
    // Try to store in database (persistent), fall back to filesystem if migration hasn't run
    let url;
    let fileId = null;
    try {
      const result = await storeFile(file, {
        category: 'document',
        ownerId: targetUserId,
        ownerType: 'user'
      });
      fileId = result.id;
      url = result.url;
    } catch (storeErr) {
      console.warn('[docs:upload] Database storage failed, using filesystem:', storeErr.message);
      url = publicUrl(file.path);
    }

    // Try insert with file_id, fall back without if column doesn't exist
    let rows;
    try {
      const result = await query(
        `INSERT INTO documents (user_id, label, name, url, file_id, origin, type, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, label, name, url, file_id, origin, type, review_status, review_requested_at, viewed_at`,
        [targetUserId, file.originalname, file.originalname, url, fileId, 'client', 'client', 'none']
      );
      rows = result.rows;
    } catch (insertErr) {
      if (insertErr.message?.includes('file_id')) {
        const result = await query(
          `INSERT INTO documents (user_id, label, name, url, origin, type, review_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, label, name, url, origin, type, review_status, review_requested_at, viewed_at`,
          [targetUserId, file.originalname, file.originalname, url, 'client', 'client', 'none']
        );
        rows = result.rows;
      } else {
        throw insertErr;
      }
    }
    inserted.push(rows[0]);
  }
  res.json({ message: 'Uploaded', docs: inserted });
});

router.delete('/docs/:id', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  // Try to get file_id and delete from storage
  try {
    const { rows } = await query('SELECT file_id FROM documents WHERE id = $1 AND user_id = $2', [req.params.id, targetUserId]);
    if (rows[0]?.file_id) {
      await deleteFile(rows[0].file_id).catch(() => {});
    }
  } catch (e) {
    // file_id column doesn't exist yet - ignore
  }
  await query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [req.params.id, targetUserId]);
  res.json({ message: 'Deleted' });
});

router.post('/docs/:id/viewed', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const docId = req.params.id;
  const { rowCount } = await query('UPDATE documents SET review_status=$1, viewed_at=NOW() WHERE id=$2 AND user_id=$3', [
    'viewed',
    docId,
    targetUserId
  ]);
  if (!rowCount) return res.status(404).json({ message: 'Document not found' });

  const { rows: docRows } = await query(
    `SELECT d.label, d.name, u.first_name, u.last_name, u.email
     FROM documents d
     LEFT JOIN users u ON d.user_id = u.id
     WHERE d.id = $1`,
    [docId]
  );
  const docInfo = docRows[0];
  const docLabel = docInfo?.label || docInfo?.name || 'Document';
  const clientName = [docInfo?.first_name, docInfo?.last_name].filter(Boolean).join(' ').trim() || docInfo?.email || 'Client';
  const baseUrl = resolveBaseUrl(req);
  const adminLink = `${baseUrl}/client-hub`;

  logDocumentActivity({
    userId: req.user.id,
    actionType: 'view_document',
    documentId: docId,
    documentName: docLabel,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']
  }).catch(() => {});

  await createNotificationsForAdmins({
    title: 'Client reviewed a document',
    body: `${clientName} viewed ${docLabel}.`,
    linkUrl: '/client-hub',
    meta: { document_id: docId, client_id: targetUserId }
  });

  await notifyAdminsByEmail({
    subject: `${clientName} reviewed ${docLabel}`,
    text: `${clientName} just viewed "${docLabel}".\n\nOpen the Admin Hub: ${adminLink}`,
    html: `<p>${clientName} just viewed <strong>${docLabel}</strong>.</p><p><a href="${adminLink}" target="_blank" rel="noopener">Open the Admin Hub</a></p>`
  });

  res.json({ message: 'Document marked as viewed' });
});

router.post('/docs/admin/upload', isAdminOrEditor, uploadDocs.array('client_doc', 10), async (req, res) => {
  const targetUser = req.body.user_id;
  if (!targetUser) return res.status(400).json({ message: 'Missing client ID' });
  const forReview = req.body.for_review === 'true' || req.body.for_review === true;
  const labelInput = req.body.doc_label || '';
  const added = [];
  for (const file of req.files || []) {
    // Try to store in database (persistent), fall back to filesystem if migration hasn't run
    let url;
    let fileId = null;
    try {
      const result = await storeFile(file, {
        category: 'document',
        ownerId: targetUser,
        ownerType: 'user',
        metadata: { uploadedBy: req.user.id }
      });
      fileId = result.id;
      url = result.url;
    } catch (storeErr) {
      console.warn('[docs:admin:upload] Database storage failed, using filesystem:', storeErr.message);
      url = publicUrl(file.path);
    }

    const label = labelInput || file.originalname;
    const reviewStatus = forReview ? 'pending' : 'none';

    // Try insert with file_id, fall back without if column doesn't exist
    let rows;
    try {
      const result = await query(
        `INSERT INTO documents (user_id, label, name, url, file_id, origin, type, review_status, review_requested_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [targetUser, label, file.originalname, url, fileId, 'admin', 'client', reviewStatus, forReview ? new Date() : null, req.user.id]
      );
      rows = result.rows;
    } catch (insertErr) {
      if (insertErr.message?.includes('file_id')) {
        const result = await query(
          `INSERT INTO documents (user_id, label, name, url, origin, type, review_status, review_requested_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [targetUser, label, file.originalname, url, 'admin', 'client', reviewStatus, forReview ? new Date() : null, req.user.id]
        );
        rows = result.rows;
      } else {
        throw insertErr;
      }
    }
    added.push(rows[0]);

    // Log document upload activity
    await logDocumentActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.UPLOAD_DOCUMENT,
      documentId: rows[0].id,
      documentName: label,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { targetUserId: targetUser, forReview }
    });
  }
  res.json({ message: 'Uploaded', docs: added });
});

router.post('/docs/admin/review', requireAdmin, async (req, res) => {
  const { user_id, doc_id, review_action } = req.body;
  if (!user_id || !doc_id) return res.status(400).json({ message: 'Missing client or document' });
  const status = review_action === 'pending' ? 'pending' : 'none';
  await query('UPDATE documents SET review_status=$1, review_requested_at=$2 WHERE id=$3 AND user_id=$4 AND type != $5', [
    status,
    status === 'pending' ? new Date() : null,
    doc_id,
    user_id,
    'default'
  ]);

  if (status === 'pending') {
    const [{ rows: docRows }, { rows: userRows }] = await Promise.all([
      query('SELECT label, name FROM documents WHERE id = $1', [doc_id]),
      query('SELECT email, first_name FROM users WHERE id = $1', [user_id])
    ]);
    const docInfo = docRows[0] || {};
    const clientInfo = userRows[0] || {};
    const docLabel = docInfo.label || docInfo.name || 'Document';
    const portalLink = `${resolveBaseUrl(req)}/portal?tab=documents`;
    await createNotification({
      userId: user_id,
      title: 'Document ready for review',
      body: `${docLabel} was flagged for your review by the admin team.`,
      linkUrl: '/portal?tab=documents',
      meta: { document_id: doc_id, action: 'review_requested' }
    });
    if (isMailgunConfigured() && clientInfo.email) {
      await sendMailgunMessageWithLogging(
        {
          to: clientInfo.email,
          subject: 'A document needs your review',
          text: `Hi ${clientInfo.first_name || ''},\n\n"${docLabel}" has been flagged for your review. Visit your client portal to respond: ${portalLink}`,
          html: `<p>Hi ${clientInfo.first_name || 'there'},</p><p><strong>${docLabel}</strong> has been flagged for your review. Visit your client portal to respond.</p><p><a href="${portalLink}" target="_blank" rel="noopener">Open Client Portal</a></p>`
        },
        {
          emailType: 'document_review',
          recipientName: clientInfo.first_name,
          triggeredById: req.user?.id,
          clientId: user_id,
          metadata: { document_id: doc_id }
        }
      );
    }
  }

  res.json({ message: status === 'pending' ? 'Client notified for review' : 'Review cleared' });
});

router.delete('/docs/admin/:docId', isAdminOrEditor, async (req, res) => {
  const docId = req.params.docId;
  const targetUser = req.body?.user_id;
  if (!targetUser) return res.status(400).json({ message: 'Missing client ID' });

  // Get document info before deleting for logging
  const { rows: docInfo } = await query('SELECT label, name FROM documents WHERE id = $1', [docId]);

  const result = await query('DELETE FROM documents WHERE id=$1 AND user_id=$2 AND type != $3', [docId, targetUser, 'default']);
  if (!result.rowCount) {
    return res.status(404).json({ message: 'Document not found' });
  }

  // Log document delete activity
  await logDocumentActivity({
    userId: req.user.id,
    actionType: ActivityEventTypes.DELETE_DOCUMENT,
    documentId: docId,
    documentName: docInfo[0]?.label || docInfo[0]?.name,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: { targetUserId: targetUser }
  });

  res.json({ message: 'Deleted' });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DOCUMENTS (admin-managed, visible to all clients under "Helpful Documents")
// ─────────────────────────────────────────────────────────────────────────────

// Client-facing: fetch shared docs
router.get('/shared-docs', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, label, name, url, description, sort_order, created_at FROM shared_documents ORDER BY sort_order ASC, created_at DESC'
    );
    res.json({ shared_docs: rows });
  } catch (err) {
    console.error('[hub:shared-docs:get]', err);
    res.status(500).json({ message: 'Failed to load shared documents' });
  }
});

// Admin: list shared docs with creator info
router.get('/shared-docs/admin', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT sd.*, u.first_name AS creator_first_name, u.last_name AS creator_last_name, u.email AS creator_email
      FROM shared_documents sd
      LEFT JOIN users u ON sd.created_by = u.id
      ORDER BY sd.sort_order ASC, sd.created_at DESC
    `);
    res.json({ shared_docs: rows });
  } catch (err) {
    console.error('[hub:shared-docs:admin:get]', err);
    res.status(500).json({ message: 'Failed to load shared documents' });
  }
});

// Admin: upload new shared document(s)
router.post('/shared-docs/admin', requireAdmin, uploadDocs.array('shared_doc', 10), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ message: 'No file uploaded' });
    const labels = req.body.labels ? (Array.isArray(req.body.labels) ? req.body.labels : [req.body.labels]) : [];
    const descriptions = req.body.descriptions
      ? Array.isArray(req.body.descriptions)
        ? req.body.descriptions
        : [req.body.descriptions]
      : [];
    const uploaded = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const url = publicUrl(file.path);
      const label = labels[i] || file.originalname;
      const description = descriptions[i] || null;
      const { rows } = await query(
        `INSERT INTO shared_documents (label, name, url, description, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [label, file.originalname, url, description, req.user.id]
      );
      uploaded.push(rows[0]);
    }
    res.json({ message: 'Uploaded', shared_docs: uploaded });
  } catch (err) {
    console.error('[hub:shared-docs:admin:post]', err);
    res.status(500).json({ message: 'Failed to upload shared document' });
  }
});

// Admin: update shared document details (label, description, sort_order)
router.put('/shared-docs/admin/:id', requireAdmin, async (req, res) => {
  try {
    const { label, description, sort_order } = req.body;
    const { rows } = await query(
      `UPDATE shared_documents SET label = COALESCE($1, label), description = $2, sort_order = COALESCE($3, sort_order), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [label, description, sort_order, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Document not found' });
    res.json({ shared_doc: rows[0] });
  } catch (err) {
    console.error('[hub:shared-docs:admin:put]', err);
    res.status(500).json({ message: 'Failed to update shared document' });
  }
});

// Admin: delete shared document
router.delete('/shared-docs/admin/:id', requireAdmin, async (req, res) => {
  try {
    const result = await query('DELETE FROM shared_documents WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Document not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[hub:shared-docs:admin:delete]', err);
    res.status(500).json({ message: 'Failed to delete shared document' });
  }
});

// Admin: reorder shared documents
router.post('/shared-docs/admin/reorder', requireAdmin, async (req, res) => {
  try {
    const { order } = req.body; // array of { id, sort_order }
    if (!Array.isArray(order)) return res.status(400).json({ message: 'Invalid order array' });
    for (const item of order) {
      if (item.id && typeof item.sort_order === 'number') {
        await query('UPDATE shared_documents SET sort_order = $1, updated_at = NOW() WHERE id = $2', [item.sort_order, item.id]);
      }
    }
    res.json({ message: 'Reordered' });
  } catch (err) {
    console.error('[hub:shared-docs:admin:reorder]', err);
    res.status(500).json({ message: 'Failed to reorder documents' });
  }
});

export default router;
