import { query } from '../../db.js';
import { sendMailgunMessageWithLogging, getMailgunFromAddress } from '../mailgun.js';

function statusBadge(status) {
  if (status === 'fail') return '🔴 FAIL';
  if (status === 'warn') return '🟡 WARN';
  return '🟢 OK';
}

// Check strings are server-controlled, but `error` can carry a third-party API
// message — escape so a stray `<`/`>` can't garble (or inject into) the table.
function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildHtml(failing, passingCount) {
  const rows = failing
    .map(
      (f) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>${esc(f.label)}</strong><br>
          <span style="color:#888;font-size:12px;">${esc(f.category)} · ${esc(f.check_id)}</span></td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;">${statusBadge(f.status)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${esc(f.detail)}${
          f.error ? `<br><span style="color:#b00;font-size:12px;">${esc(f.error)}</span>` : ''
        }</td>
      </tr>`
    )
    .join('');
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:680px;">
    <h2 style="margin:0 0 4px;">Heads up — a production check needs attention</h2>
    <p style="color:#555;margin:0 0 16px;">${failing.length} check(s) not healthy${
      passingCount ? `, ${passingCount} passing` : ''
    }. This is the daily Anchor Hub health sweep.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">${rows}</table>
    <p style="color:#999;font-size:12px;margin-top:16px;">You're getting this because you're a super-admin. Silence means all checks passed.</p>
  </div>`;
}

function buildText(failing, passingCount) {
  const lines = failing.map((f) => `- [${f.status.toUpperCase()}] ${f.label} (${f.check_id}): ${f.detail || ''}${f.error ? ` — ${f.error}` : ''}`);
  return `Anchor Hub daily health sweep — ${failing.length} check(s) need attention${passingCount ? `, ${passingCount} passing` : ''}.\n\n${lines.join('\n')}\n`;
}

/**
 * Email super-admins about failing checks. No-op when nothing is failing.
 * @param {{ failing: Array, results: Array }} summary
 */
export async function sendHealthFailureEmail({ failing, results }) {
  if (!failing || failing.length === 0) return { sent: false, reason: 'all green' };
  const { rows } = await query(
    "SELECT email FROM users WHERE role = 'superadmin' AND email IS NOT NULL"
  );
  const recipients = rows.map((r) => r.email).filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no superadmin recipients' };

  const passingCount = (results?.length || 0) - failing.length;
  const subject = `⚠️ Anchor Hub health: ${failing.length} check(s) need attention`;
  // bcc so super-admins aren't exposed to each other in the To: header.
  await sendMailgunMessageWithLogging(
    { to: getMailgunFromAddress() || recipients[0], bcc: recipients, subject, html: buildHtml(failing, passingCount), text: buildText(failing, passingCount) },
    { emailType: 'system_health', metadata: { failing: failing.length, passing: passingCount } }
  );
  return { sent: true, recipients: recipients.length };
}
