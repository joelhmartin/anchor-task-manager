// Shared call_logs upsert for the ingest paths (CTM pull, autosync, forms, twilio).
// Guards contact_id: the server binds the port before migrations run, and the
// contact_id column is added by ensureContactIdColumnsExist()/the foundation migration.
// Until it exists, omit contact_id rather than throw undefined_column (42703).
import { query as poolQuery } from '../db.js';

let _contactIdColReady = false; // only ever latches true (mirrors contacts.js schema probe)

async function contactIdColumnReady(exec) {
  if (_contactIdColReady) return true;
  try {
    const r = await exec(
      "SELECT 1 FROM information_schema.columns WHERE table_name='call_logs' AND column_name='contact_id' LIMIT 1"
    );
    if (r.rows.length) _contactIdColReady = true;
    return _contactIdColReady;
  } catch {
    return false;
  }
}

// owner_user_id AND user_id both bind $1. $2..$14 are the remaining columns in order.
const SET_COMMON = `direction=EXCLUDED.direction, from_number=EXCLUDED.from_number,
  to_number=EXCLUDED.to_number, started_at=EXCLUDED.started_at, duration_sec=EXCLUDED.duration_sec,
  score=EXCLUDED.score, meta=EXCLUDED.meta, caller_type=EXCLUDED.caller_type,
  active_client_id=EXCLUDED.active_client_id, call_sequence=EXCLUDED.call_sequence,
  activity_type=EXCLUDED.activity_type`;

const SQL_WITH_CONTACT = `INSERT INTO call_logs
  (owner_user_id, user_id, call_id, direction, from_number, to_number, started_at, duration_sec, score, meta, caller_type, active_client_id, call_sequence, activity_type, contact_id)
  VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (call_id) DO UPDATE SET ${SET_COMMON},
    contact_id=COALESCE(call_logs.contact_id, EXCLUDED.contact_id)
  RETURNING (xmax = 0) AS inserted`;

const SQL_NO_CONTACT = `INSERT INTO call_logs
  (owner_user_id, user_id, call_id, direction, from_number, to_number, started_at, duration_sec, score, meta, caller_type, active_client_id, call_sequence, activity_type)
  VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (call_id) DO UPDATE SET ${SET_COMMON}
  RETURNING (xmax = 0) AS inserted`;

/**
 * Exported readiness probe — returns true once the contact_id column exists in
 * call_logs. Shared by forms.js, twilio.js, and ctmAutoSync.js so they can gate
 * their own INSERTs without re-implementing the schema check.
 * @param {Function} [exec] - optional query executor (defaults to pool)
 * @returns {Promise<boolean>}
 */
export async function callLogsHasContactId(exec = poolQuery) {
  return contactIdColumnReady(exec);
}

/**
 * Upsert one call_logs row (ON CONFLICT (call_id)). Omits contact_id if the column
 * isn't present yet. `row` carries every column value.
 * @param {object} row { ownerUserId, callId, direction, fromNumber, toNumber, startedAt,
 *   durationSec, score, meta, callerType, activeClientId, callSequence, activityType, contactId }
 */
export async function upsertCallLog(row, exec = poolQuery) {
  // $1..$13 (owner_user_id reused for user_id via $1,$1 in the SQL).
  const params = [
    row.ownerUserId, row.callId, row.direction || null, row.fromNumber || null,
    row.toNumber || null, row.startedAt, row.durationSec || null, row.score || 0, row.meta,
    row.callerType || 'new', row.activeClientId || null, row.callSequence || 1, row.activityType || 'call'
  ];
  if (await contactIdColumnReady(exec)) {
    return exec(SQL_WITH_CONTACT, [...params, row.contactId || null]); // adds $14
  }
  return exec(SQL_NO_CONTACT, params);
}
