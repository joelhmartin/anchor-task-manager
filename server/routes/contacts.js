/**
 * Contact Entity — merge/split admin API (Phase 4).
 *
 * Mounted at /api/hub by server/index.js, so paths here are relative to that prefix
 * (e.g. /contacts/merge → /api/hub/contacts/merge). Staff-only. Resolves the
 * contact_merge_candidates queue that resolveContact() fills when a phone and an email
 * point at two different contacts (never auto-merged — a human decides here).
 *
 * All merges are transactional and audit-logged (spec §9).
 */

import express from 'express';
import { query, getClient } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isStaff } from '../middleware/roles.js';
import { logSecurityEvent } from '../services/security/audit.js';
import { applyContactTags, removeContactTag } from '../services/contactTags.js';

const router = express.Router();
router.use(requireAuth, isStaff);

// GET /contacts/merge-candidates?status=pending — the review queue, with both sides' display info.
router.get('/contacts/merge-candidates', async (req, res) => {
  try {
    const status = ['pending', 'merged', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
    const { rows } = await query(
      `SELECT mc.id, mc.owner_user_id, mc.contact_id_keep, mc.contact_id_other, mc.reason, mc.detail,
              mc.status, mc.created_at,
              ck.display_name AS keep_name, ck.primary_phone AS keep_phone, ck.primary_email AS keep_email,
              co.display_name AS other_name, co.primary_phone AS other_phone, co.primary_email AS other_email
       FROM contact_merge_candidates mc
       LEFT JOIN contacts ck ON ck.id = mc.contact_id_keep
       LEFT JOIN contacts co ON co.id = mc.contact_id_other
       WHERE mc.status = $1
       ORDER BY mc.created_at DESC
       LIMIT 500`,
      [status]
    );
    // HIPAA: reading the queue exposes contact PHI (names/phones/emails) — audit the access.
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_merge_candidates_read', eventCategory: 'contacts', success: true, details: { status, count: rows.length } });
    res.json({ candidates: rows });
  } catch (err) {
    console.error('[contacts:merge-candidates]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load merge candidates' });
  }
});

// POST /contacts/merge { keepId, mergeId, candidateId? } — fold mergeId into keepId.
router.post('/contacts/merge', async (req, res) => {
  const { keepId, mergeId, candidateId } = req.body || {};
  if (!keepId || !mergeId || keepId === mergeId) {
    return res.status(400).json({ message: 'keepId and mergeId (distinct) are required' });
  }

  let client;
  try {
    client = await getClient();
    await client.query('BEGIN');

    // Lock both contacts; they must exist and share an owner (tenant isolation).
    const { rows: cs } = await client.query(
      'SELECT id, owner_user_id, display_name, primary_phone, primary_email FROM contacts WHERE id = ANY($1) FOR UPDATE',
      [[keepId, mergeId]]
    );
    const keep = cs.find((c) => c.id === keepId);
    const other = cs.find((c) => c.id === mergeId);
    if (!keep || !other) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'One or both contacts not found' });
    }
    if (keep.owner_user_id !== other.owner_user_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Cannot merge contacts across owners' });
    }
    const owner = keep.owner_user_id;

    // Move the merged contact's non-duplicate identifiers onto keep. Deleting `other`
    // afterward cascades any duplicates (the unique index already lives on keep).
    await client.query(
      `UPDATE contact_phones SET contact_id = $1, is_primary = false
         WHERE contact_id = $2
           AND phone_digits10 NOT IN (SELECT phone_digits10 FROM contact_phones WHERE contact_id = $1)`,
      [keepId, mergeId]
    );
    await client.query(
      `UPDATE contact_emails SET contact_id = $1, is_primary = false
         WHERE contact_id = $2
           AND email NOT IN (SELECT email FROM contact_emails WHERE contact_id = $1)`,
      [keepId, mergeId]
    );

    // Reassign all activity/journey/client links to keep.
    const moved = {};
    for (const t of ['call_logs', 'client_journeys', 'active_clients']) {
      // t is from a fixed allowlist — not user input.
      const r = await client.query(`UPDATE ${t} SET contact_id = $1 WHERE contact_id = $2`, [keepId, mergeId]);
      moved[t] = r.rowCount;
    }

    // Preserve the losing contact's segmentation tags — the contact_tags → contacts FK is
    // ON DELETE CASCADE, so without this the DELETE below would silently drop them.
    await client.query(
      `INSERT INTO contact_tags (contact_id, owner_user_id, tag_id, source, created_by)
       SELECT $1, owner_user_id, tag_id, source, created_by
         FROM contact_tags WHERE contact_id = $2
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [keepId, mergeId]
    );

    // Backfill keep's display fields from other where keep is missing them.
    await client.query(
      `UPDATE contacts SET
         display_name  = COALESCE(NULLIF(display_name, ''), $2),
         primary_email = COALESCE(primary_email, $3),
         primary_phone = COALESCE(primary_phone, $4),
         updated_at = NOW()
       WHERE id = $1`,
      [keepId, other.display_name, other.primary_email, other.primary_phone]
    );

    // Resolve any pending candidate(s) for this pair (either direction) or the named one
    // BEFORE deleting the contact — the contact_merge_candidates → contacts FK is
    // ON DELETE CASCADE, so candidates referencing mergeId are removed by the delete
    // below regardless; the durable record of the merge lives in security_audit_log.
    await client.query(
      `UPDATE contact_merge_candidates SET status = 'merged', resolved_at = NOW(), resolved_by = $3
         WHERE status = 'pending'
           AND ( (contact_id_keep = $1 AND contact_id_other = $2)
              OR (contact_id_keep = $2 AND contact_id_other = $1)
              OR ( id = $4
                   AND ( (contact_id_keep = $1 AND contact_id_other = $2)
                      OR (contact_id_keep = $2 AND contact_id_other = $1) ) ) )`,
      [keepId, mergeId, req.user.id, candidateId || null]
    );

    // Delete the merged contact (cascades any leftover duplicate identifiers + its
    // now-resolved merge candidates).
    await client.query('DELETE FROM contacts WHERE id = $1', [mergeId]);

    await client.query('COMMIT');

    await logSecurityEvent({
      userId: req.user.id,
      eventType: 'contact_merge',
      eventCategory: 'contacts',
      success: true,
      details: { ownerUserId: owner, keepId, mergeId, moved }
    });
    res.json({ ok: true, keepId, mergedFrom: mergeId, moved });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[contacts:merge]', { code: err?.code });
    res.status(500).json({ message: 'Merge failed' });
  } finally {
    if (client) client.release();
  }
});

// POST /contacts/:id/split { identifierType: 'phone'|'email', identifierId } — un-merge:
// move one identifier + its matching activity into a NEW contact. Original is kept.
router.post('/contacts/:id/split', async (req, res) => {
  const sourceId = req.params.id;
  const { identifierType, identifierId } = req.body || {};
  if (!['phone', 'email'].includes(identifierType) || !identifierId) {
    return res.status(400).json({ message: 'identifierType (phone|email) and identifierId are required' });
  }
  let client;
  try {
    client = await getClient();
    await client.query('BEGIN');
    const src = await client.query('SELECT id, owner_user_id, display_name FROM contacts WHERE id = $1 FOR UPDATE', [sourceId]);
    if (!src.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Contact not found.' }); }
    const owner = src.rows[0].owner_user_id;

    // Load the identifier to split off (must belong to the source contact).
    const idTable = identifierType === 'phone' ? 'contact_phones' : 'contact_emails';
    const idRow = await client.query(`SELECT * FROM ${idTable} WHERE id = $1 AND contact_id = $2`, [identifierId, sourceId]);
    if (!idRow.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Identifier not found on this contact.' }); }
    const ident = idRow.rows[0];

    // Create the new contact (anchored on the split-off identifier).
    const ins = await client.query(
      `INSERT INTO contacts (owner_user_id, display_name, primary_phone, primary_email, first_seen_at, last_activity_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
      [owner, null,
       identifierType === 'phone' ? (ident.phone_e164 || null) : null,
       identifierType === 'email' ? ident.email : null]
    );
    const newId = ins.rows[0].id;

    // Move the identifier row to the new contact (is_primary on the new one).
    await client.query(`UPDATE ${idTable} SET contact_id = $1, is_primary = true WHERE id = $2`, [newId, identifierId]);

    // Keep the source contact's primary_phone/email in sync — if the split-off identifier was
    // the source's primary, recompute from its remaining identifiers (else it shows a stale value).
    if (identifierType === 'phone') {
      await client.query(
        `UPDATE contacts SET primary_phone = (
            SELECT COALESCE(cp.phone_e164, cp.phone_digits10) FROM contact_phones cp
             WHERE cp.contact_id = $1 ORDER BY cp.is_primary DESC, cp.id LIMIT 1
          ), updated_at = NOW() WHERE id = $1`,
        [sourceId]
      );
    } else {
      await client.query(
        `UPDATE contacts SET primary_email = (
            SELECT ce.email FROM contact_emails ce
             WHERE ce.contact_id = $1 ORDER BY ce.is_primary DESC, ce.id LIMIT 1
          ), updated_at = NOW() WHERE id = $1`,
        [sourceId]
      );
    }

    // Reassign matching activity AND lifecycle rows. Per spec §3, split moves call_logs,
    // client_journeys, AND active_clients whose identifier matches the split-off phone/email.
    // Heuristic: phone → last-10 digits of from_number/client_phone matches phone_digits10;
    // email → lower(meta->>'caller_email')/lower(client_email) matches lower(email).
    // Owner predicate ($4) on every UPDATE — defense-in-depth tenant isolation.
    let movedCalls = 0;
    let movedJourneys = 0;
    let movedActiveClients = 0;
    if (identifierType === 'phone') {
      const r1 = await client.query(
        `UPDATE call_logs SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND RIGHT(REGEXP_REPLACE(COALESCE(from_number,''), '[^0-9]', '', 'g'), 10) = $3`,
        [newId, sourceId, ident.phone_digits10, owner]
      );
      movedCalls = r1.rowCount;
      const r2 = await client.query(
        `UPDATE client_journeys SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND RIGHT(REGEXP_REPLACE(COALESCE(client_phone,''), '[^0-9]', '', 'g'), 10) = $3`,
        [newId, sourceId, ident.phone_digits10, owner]
      );
      movedJourneys = r2.rowCount;
      const r3 = await client.query(
        `UPDATE active_clients SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND RIGHT(REGEXP_REPLACE(COALESCE(client_phone,''), '[^0-9]', '', 'g'), 10) = $3`,
        [newId, sourceId, ident.phone_digits10, owner]
      );
      movedActiveClients = r3.rowCount;
    } else {
      const r1 = await client.query(
        `UPDATE call_logs SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND LOWER(meta->>'caller_email') = LOWER($3)`,
        [newId, sourceId, ident.email, owner]
      );
      movedCalls = r1.rowCount;
      const r2 = await client.query(
        `UPDATE client_journeys SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND LOWER(COALESCE(client_email,'')) = LOWER($3)`,
        [newId, sourceId, ident.email, owner]
      );
      movedJourneys = r2.rowCount;
      const r3 = await client.query(
        `UPDATE active_clients SET contact_id = $1
           WHERE contact_id = $2 AND owner_user_id = $4
             AND LOWER(COALESCE(client_email,'')) = LOWER($3)`,
        [newId, sourceId, ident.email, owner]
      );
      movedActiveClients = r3.rowCount;
    }

    await client.query('COMMIT');
    await logSecurityEvent({
      userId: req.user.id, eventType: 'contact_split', eventCategory: 'contacts', success: true,
      details: { ownerUserId: owner, sourceId, newId, identifierType, movedCalls, movedJourneys, movedActiveClients }
    });
    res.json({ ok: true, sourceId, newContactId: newId, moved: { calls: movedCalls, journeys: movedJourneys, activeClients: movedActiveClients } });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[contacts:split]', { code: err?.code });
    res.status(500).json({ message: 'Split failed.' });
  } finally {
    if (client) client.release();
  }
});

// POST /contacts/merge-candidates/:id/dismiss — drop a candidate without merging.
router.post('/contacts/merge-candidates/:id/dismiss', async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE contact_merge_candidates SET status = 'dismissed', resolved_at = NOW(), resolved_by = $2
         WHERE id = $1 AND status = 'pending'`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Candidate not found or already resolved' });
    await logSecurityEvent({
      userId: req.user.id,
      eventType: 'contact_merge_dismiss',
      eventCategory: 'contacts',
      success: true,
      details: { candidateId: req.params.id }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contacts:dismiss]', { code: err?.code });
    res.status(500).json({ message: 'Dismiss failed' });
  }
});

// --- Phase 6: contact-level tags + consent (segmentation foundation) ---

// GET /contacts/by-tag/:tagId — segmentation: everyone tagged X (the tag is owner-scoped).
router.get('/contacts/by-tag/:tagId', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.display_name, c.primary_phone, c.primary_email,
              c.email_opted_out, c.sms_opted_out, ct.source
         FROM contact_tags ct
         JOIN contacts c ON c.id = ct.contact_id
        WHERE ct.tag_id = $1
        ORDER BY c.display_name NULLS LAST
        LIMIT 2000`,
      [req.params.tagId]
    );
    // HIPAA: a tag segment exposes contact PHI (phones/emails) — audit the access.
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_segment_read', eventCategory: 'contacts', success: true, details: { tagId: req.params.tagId, count: rows.length } });
    res.json({ contacts: rows });
  } catch (err) {
    console.error('[contacts:by-tag]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load tagged contacts' });
  }
});

// GET /contacts/:id/tags — a contact's tags.
router.get('/contacts/:id/tags', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT lt.id, lt.name, lt.color, lt.system_key, ct.source, ct.created_at
         FROM contact_tags ct JOIN lead_tags lt ON lt.id = ct.tag_id
        WHERE ct.contact_id = $1 ORDER BY lt.name`,
      [req.params.id]
    );
    // HIPAA: returns contact-linked data — audit the access (consistent with the other reads).
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_tags_read', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, count: rows.length } });
    res.json({ tags: rows });
  } catch (err) {
    console.error('[contacts:tags:list]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load contact tags' });
  }
});

// POST /contacts/:id/tags { tagId } — apply a user tag (tag must belong to the contact's owner).
router.post('/contacts/:id/tags', async (req, res) => {
  const { tagId } = req.body || {};
  if (!tagId) return res.status(400).json({ message: 'tagId is required' });
  try {
    const c = await query('SELECT owner_user_id FROM contacts WHERE id = $1', [req.params.id]);
    if (!c.rows.length) return res.status(404).json({ message: 'Contact not found' });
    const owner = c.rows[0].owner_user_id;
    const t = await query('SELECT 1 FROM lead_tags WHERE id = $1 AND owner_user_id = $2', [tagId, owner]);
    if (!t.rows.length) return res.status(400).json({ message: 'Tag not found for this owner' });
    await applyContactTags({ contactId: req.params.id, ownerUserId: owner, tagIds: [tagId], source: 'user', createdBy: req.user.id });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_tag_add', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, tagId } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contacts:tags:add]', { code: err?.code });
    res.status(500).json({ message: 'Failed to add tag' });
  }
});

// DELETE /contacts/:id/tags/:tagId — remove a tag from a contact.
router.delete('/contacts/:id/tags/:tagId', async (req, res) => {
  try {
    const c = await query('SELECT owner_user_id FROM contacts WHERE id = $1', [req.params.id]);
    if (!c.rows.length) return res.status(404).json({ message: 'Contact not found' });
    await removeContactTag({ contactId: req.params.id, tagId: req.params.tagId, ownerUserId: c.rows[0].owner_user_id });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_tag_remove', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, tagId: req.params.tagId } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contacts:tags:remove]', { code: err?.code });
    res.status(500).json({ message: 'Failed to remove tag' });
  }
});

// PATCH /contacts/:id/consent { sms_opted_out?, email_opted_out? } — suppression for bulk SMS/email.
router.patch('/contacts/:id/consent', async (req, res) => {
  const { sms_opted_out, email_opted_out } = req.body || {};
  if (typeof sms_opted_out !== 'boolean' && typeof email_opted_out !== 'boolean') {
    return res.status(400).json({ message: 'Provide sms_opted_out and/or email_opted_out (boolean)' });
  }
  try {
    const sets = [];
    const params = [req.params.id];
    if (typeof sms_opted_out === 'boolean') {
      params.push(sms_opted_out);
      sets.push(`sms_opted_out = $${params.length}`);
    }
    if (typeof email_opted_out === 'boolean') {
      params.push(email_opted_out);
      sets.push(`email_opted_out = $${params.length}`);
      sets.push(`email_unsubscribed_at = ${email_opted_out ? 'NOW()' : 'NULL'}`);
    }
    const { rowCount } = await query(`UPDATE contacts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
    if (!rowCount) return res.status(404).json({ message: 'Contact not found' });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_consent_update', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, sms_opted_out, email_opted_out } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contacts:consent]', { code: err?.code });
    res.status(500).json({ message: 'Failed to update consent' });
  }
});

export default router;
