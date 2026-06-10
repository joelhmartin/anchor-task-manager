/**
 * Lean scheduled-send processor (replaces journeyEmailScheduler.js).
 * Sends activity rows where email_status='scheduled' AND scheduled_for<=NOW(),
 * for journeys that are still active. Atomic claim per row guards against
 * double-send across Cloud Run replicas. Sending does NOT advance the stage —
 * staff advance the journey manually. SMS rows stay skipped while
 * JOURNEY_SMS_ENABLED is off.
 */
import { query } from '../db.js';
import { isMailgunConfigured } from './mailgun.js';
import { sendJourneyEmailNow } from './journeyActivities.js';

const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 25;

async function claim(activityId) {
  const { rows } = await query(
    `UPDATE client_journey_activities
        SET send_attempts = send_attempts + 1
      WHERE id = $1 AND email_status = 'scheduled' AND send_attempts < $2
      RETURNING id`, [activityId, MAX_ATTEMPTS]);
  return rows.length > 0;
}

export async function processDueJourneySends() {
  if (!isMailgunConfigured()) return { sent: 0, failed: 0, skipped: 0 };

  const { rows } = await query(
    `SELECT a.id AS activity_id, a.type, a.subject, a.body, a.body_format, a.metadata,
            j.id AS journey_id, j.stage, j.owner_user_id, j.client_name, j.client_email, j.client_phone
       FROM client_journey_activities a
       JOIN client_journeys j ON j.id = a.journey_id
      WHERE a.email_status = 'scheduled'
        AND a.scheduled_for IS NOT NULL
        AND a.scheduled_for <= NOW()
        AND a.send_attempts < $1
        AND j.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = j.contact_id AND c.archived_at IS NOT NULL)
      ORDER BY a.scheduled_for ASC
      LIMIT $2`, [MAX_ATTEMPTS, BATCH_LIMIT]);

  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    // FIX 7: leave text rows as 'scheduled' so they can send once SMS is enabled
    if (row.type === 'text') { skipped += 1; continue; }

    const claimed = await claim(row.activity_id).catch(() => false);
    if (!claimed) { skipped += 1; continue; }

    // FIX 6: re-read current journey state after claiming to handle archive/convert/advance.
    // Also skip if the journey's contact has since been archived (contact marked done).
    const { rows: jr } = await query(
      `SELECT j.status, j.stage, (c.archived_at IS NOT NULL) AS contact_archived
         FROM client_journeys j
         LEFT JOIN contacts c ON c.id = j.contact_id
        WHERE j.id = $1`, [row.journey_id]);
    const cur = jr[0];
    if (!cur || cur.status !== 'active' || cur.contact_archived) {
      await query(`UPDATE client_journey_activities SET email_status='canceled' WHERE id=$1`, [row.activity_id]);
      skipped += 1; continue;
    }

    try {
      await sendJourneyEmailNow({
        journey: { id: row.journey_id, owner_user_id: row.owner_user_id,
          client_name: row.client_name,
          // Prefer the recipient resolved (from the contact) at compose time; the raw
          // client_email is empty for most journeys (created phone-first).
          client_email: row.metadata?.recipient_email || row.client_email,
          client_phone: row.client_phone },
        subject: row.subject, body: row.body, bodyFormat: row.body_format || 'html', activityId: row.activity_id,
        attachmentFileIds: Array.isArray(row.metadata?.attachment_file_ids) ? row.metadata.attachment_file_ids : [],
        preheader: row.metadata?.preheader || null,
        replyTo: Array.isArray(row.metadata?.reply_to) ? row.metadata.reply_to : null });
      await query(`UPDATE client_journey_activities SET email_status='sent', email_error=NULL WHERE id=$1`, [row.activity_id]);
      // Scheduled journey emails no longer auto-advance the stage on send; staff
      // advance the journey manually via the stage controls.
      sent += 1;
    } catch (err) {
      await query(`UPDATE client_journey_activities SET email_status='failed', email_error=$2 WHERE id=$1`,
        [row.activity_id, String(err?.message || err).slice(0, 500)]).catch(() => {});
      failed += 1;
      console.error('[journeyScheduledSends] send failed', { activity_id: row.activity_id, error: err?.message });
    }
  }
  return { sent, failed, skipped };
}
