// Contact Entity — identity-resolution chokepoint (spec §5).
//
// resolveContact() is the single place that maps an inbound (owner, phone/email)
// to a contact_id, creating or linking as needed. It is called at every ingest
// point (CTM calls, forms, twilio calls, journey create, active-client convert)
// so contact_id is populated going forward. Phase 1 only WRITES contact_id —
// nothing reads it yet — so this must never change ingest behavior.
//
// Decisions (spec §10):
//   Q1  one contact per (owner, phone)  — enforced by contact_phones unique index
//   Q2  phone primary, email secondary  — phone match wins; email used only when phone
//                                         yields nothing; phone↔email conflict is never
//                                         auto-merged, it enqueues a merge candidate
//
// HARD RULE: this function NEVER throws. On any failure it returns null and the
// caller inserts the row with contact_id = NULL (the existing phone-match read
// path still covers it). Over-suppress rather than break ingest.

import { query as poolQuery } from '../db.js';

// Concurrency cap (CodeRabbit): the sync paths fan out resolveContact() across hundreds
// of rows via Promise.all. Each call does several pool-backed queries, so unbounded
// parallelism can exhaust the shared PG pool and spike latency for unrelated traffic.
// A server-wide semaphore caps in-flight resolveContact() bodies — fixing every call
// site (the 4 sync loops + journey/active-client convert) at the source rather than
// per-loop. 8 leaves headroom under the default pool size.
const RESOLVE_CONTACT_CONCURRENCY = 8;
let _resolveInFlight = 0;
const _resolveWaiters = [];
function _acquireResolveSlot() {
  if (_resolveInFlight < RESOLVE_CONTACT_CONCURRENCY) {
    _resolveInFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => _resolveWaiters.push(resolve));
}
function _releaseResolveSlot() {
  const next = _resolveWaiters.shift();
  if (next) next(); // hand the slot to the next waiter (in-flight count unchanged)
  else _resolveInFlight--;
}

// Deploy-safety gate. The contacts/contact_phones/contact_emails TABLES + the
// contact_id COLUMNS only exist after migrate_contacts_foundation.sql has run (in the
// post-listen migration chain — the server binds the port BEFORE migrations, so there
// is a window, and the schema may even be managed out-of-process). Until the schema is
// present we must (a) not query the contacts tables, and (b) not reference the
// contact_id column in ingest INSERTs.
//
// Readiness is a cached tri-state: null = not yet probed. It is resolved either
// proactively (the migration calls setContactsSchemaReady(true) on success) or lazily
// by probing the catalog on first use (so it also turns on when migrations are managed
// elsewhere — not only when THIS process ran them).
let schemaReady = null;

export function setContactsSchemaReady(ready = true) {
  schemaReady = !!ready;
}
// Probe the catalog once; cache the result. Cheap (no table scan). This is what makes
// readiness work even when migrations are managed out-of-process (CodeRabbit N2) —
// resolveContact discovers the schema on first use rather than trusting only that THIS
// process ran the migration.
async function probeSchema(exec) {
  // Only cache a POSITIVE result. A negative probe (table not created yet — we bind the
  // port before migrations, and they may be managed out-of-process) must NOT stick, or
  // resolveContact would refuse to stamp contact_id for the rest of the process even
  // after the schema appears. The probe is a cheap catalog lookup, so re-probing while
  // not-ready (a brief startup window) is fine.
  if (schemaReady === true) return true;
  try {
    const r = await exec("SELECT to_regclass('public.contact_phones') AS t");
    if (r.rows[0]?.t != null) schemaReady = true;
    return schemaReady === true;
  } catch {
    return false;
  }
}

// Last-10 digits, matching the rule used by the shipped email resolver. Require
// >= 10 digits so short/garbage numbers never produce false matches.
function digits10(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/[^0-9]/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

function normEmail(email) {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  // minimal shape check — avoid storing obvious non-emails as a match key
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

function cleanName(name) {
  if (!name) return null;
  const n = String(name).trim();
  if (!n) return null;
  const lower = n.toLowerCase();
  // generic placeholders that aren't a real person's name
  if (lower === 'unknown' || lower === 'form submission' || lower.startsWith('call ')) return null;
  return n.slice(0, 200);
}

/**
 * Resolve (or create) the contact for an inbound person.
 *
 * @param {object} ident
 * @param {string} ident.ownerUserId  the client (Anchor's customer) the person contacted
 * @param {string} [ident.phone]      raw caller phone
 * @param {string} [ident.email]      raw caller email
 * @param {string} [ident.name]       raw caller name (best-effort display only)
 * @param {boolean} [ident.reactivateArchived=false] when true, clears archived_at on the
 *        resolved contact (a genuinely returning lead reappears in Contacts). OPT-IN: only
 *        live new-inbound callers set it; backfill / CTM re-sync must NOT, or they'd
 *        un-archive contacts by replaying old activity.
 * @param {(text:string, params:any[]) => Promise<{rows:any[]}>} [exec]
 *        query executor — defaults to the pool. Run on the POOL, not a caller's
 *        transaction client: a statement error here would otherwise abort the
 *        caller's whole transaction (Postgres 25P02) even though we catch it.
 * @returns {Promise<string|null>} contact_id, or null if unresolvable / on error
 */
export async function resolveContact(ident = {}, exec = poolQuery) {
  await _acquireResolveSlot();
  try {
    return await resolveContactInner(ident, exec);
  } finally {
    _releaseResolveSlot();
  }
}

async function resolveContactInner({ ownerUserId, phone, email, name, reactivateArchived = false } = {}, exec = poolQuery) {
  try {
    if (!ownerUserId) return null;
    // Skip cleanly until the contacts schema exists (probed + cached). Ingest then
    // omits the contact_id column entirely (see contactIdInsert), so nothing 500s.
    if (!(await probeSchema(exec))) return null;
    const d10 = digits10(phone);
    const em = normEmail(email);
    if (!d10 && !em) return null; // nothing to match on
    const nm = cleanName(name);

    let phoneContact = null;
    if (d10) {
      const r = await exec(
        'SELECT contact_id FROM contact_phones WHERE owner_user_id = $1 AND phone_digits10 = $2 LIMIT 1',
        [ownerUserId, d10]
      );
      phoneContact = r.rows[0]?.contact_id || null;
    }
    let emailContact = null;
    if (em) {
      const r = await exec(
        'SELECT contact_id FROM contact_emails WHERE owner_user_id = $1 AND email = $2 LIMIT 1',
        [ownerUserId, em]
      );
      emailContact = r.rows[0]?.contact_id || null;
    }

    let contactId;
    if (phoneContact && emailContact) {
      if (phoneContact === emailContact) {
        contactId = phoneContact;
      } else {
        // Conflict: phone -> A, email -> B. Phone wins deterministically; never auto-merge.
        contactId = phoneContact;
        await enqueueMerge(exec, ownerUserId, phoneContact, emailContact, { phone: d10, email: em, name: nm });
      }
    } else if (phoneContact) {
      contactId = phoneContact;
      if (em) await addEmail(exec, contactId, ownerUserId, em); // link new email forward
    } else if (emailContact) {
      contactId = emailContact;
      if (d10) await addPhone(exec, contactId, ownerUserId, d10, phone); // link new phone forward
    } else {
      contactId = await createContact(exec, { ownerUserId, nm, d10, phone, em });
    }
    if (!contactId) return null;

    // Touch activity + opportunistically fill an empty display_name. last_activity_at
    // only ever moves forward.
    // reactivateArchived: clear archived_at so a contact who genuinely returns reappears in
    // the Contacts list. OPT-IN ONLY — passed true by live new-inbound paths (Twilio call,
    // form submission, a NEWLY imported CTM call). It is deliberately OFF by default so the
    // backfill and the CTM re-sync of already-imported calls (which both replay old rows
    // through this same chokepoint) never un-archive a contact the user intentionally archived.
    await exec(
      `UPDATE contacts
          SET last_activity_at = GREATEST(COALESCE(last_activity_at, to_timestamp(0)), NOW()),
              display_name = COALESCE(NULLIF(display_name, ''), $2),
              ${reactivateArchived ? 'archived_at = NULL,' : ''}
              updated_at = NOW()
        WHERE id = $1`,
      [contactId, nm]
    );
    return contactId;
  } catch (err) {
    // Non-fatal by design — let ingest proceed with contact_id = NULL.
    // Log stable metadata ONLY — never err.message: a SQL error can echo the
    // failing parameter values (email/phone = PHI) into the message.
    console.error('[resolveContact] non-fatal failure; contact_id=NULL', { code: err.code });
    return null;
  }
}

// Create a new contact, anchored on its first identifier (phone preferred). The
// unique indexes make creation race-safe: if a concurrent ingest already claimed
// the anchor identifier, we drop our orphan row and adopt the winner.
async function createContact(exec, { ownerUserId, nm, d10, phone, em }) {
  // primary_email starts NULL and is set only after we successfully CLAIM the email
  // (R3: a phone-anchored contact must never record an email it doesn't own).
  const ins = await exec(
    `INSERT INTO contacts (owner_user_id, display_name, primary_phone, first_seen_at, last_activity_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING id`,
    [ownerUserId, nm, d10 ? (phone || null) : null]
  );
  const contactId = ins.rows[0].id;

  if (d10) {
    const p = await exec(
      `INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10, phone_e164, is_primary)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (owner_user_id, phone_digits10) DO NOTHING
       RETURNING contact_id`,
      [contactId, ownerUserId, d10, phone || null]
    );
    if (!p.rows.length) {
      // Lost the race — another contact already owns this phone. Drop the orphan.
      await exec('DELETE FROM contacts WHERE id = $1', [contactId]);
      const w = await exec(
        'SELECT contact_id FROM contact_phones WHERE owner_user_id = $1 AND phone_digits10 = $2 LIMIT 1',
        [ownerUserId, d10]
      );
      const winner = w.rows[0]?.contact_id || null;
      if (winner && em) await addEmail(exec, winner, ownerUserId, em);
      return winner;
    }
    if (em) {
      const e = await exec(
        `INSERT INTO contact_emails (contact_id, owner_user_id, email, is_primary)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (owner_user_id, email) DO NOTHING
         RETURNING contact_id`,
        [contactId, ownerUserId, em]
      );
      if (!e.rows.length) {
        // Email already belongs to another contact — phone anchored us here, so this
        // is a conflict for human review (don't steal the email).
        const w = await exec(
          'SELECT contact_id FROM contact_emails WHERE owner_user_id = $1 AND email = $2 LIMIT 1',
          [ownerUserId, em]
        );
        const other = w.rows[0]?.contact_id || null;
        if (other && other !== contactId) {
          await enqueueMerge(exec, ownerUserId, contactId, other, { phone: d10, email: em, name: nm });
        }
      } else {
        // Email successfully claimed by this contact — now safe to record as primary.
        await exec('UPDATE contacts SET primary_email = $2 WHERE id = $1', [contactId, em]);
      }
    }
    return contactId;
  }

  // Email-only anchor.
  const e = await exec(
    `INSERT INTO contact_emails (contact_id, owner_user_id, email, is_primary)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (owner_user_id, email) DO NOTHING
     RETURNING contact_id`,
    [contactId, ownerUserId, em]
  );
  if (!e.rows.length) {
    await exec('DELETE FROM contacts WHERE id = $1', [contactId]);
    const w = await exec(
      'SELECT contact_id FROM contact_emails WHERE owner_user_id = $1 AND email = $2 LIMIT 1',
      [ownerUserId, em]
    );
    return w.rows[0]?.contact_id || null;
  }
  // Email claimed by this contact — record as primary.
  await exec('UPDATE contacts SET primary_email = $2 WHERE id = $1', [contactId, em]);
  return contactId;
}

async function addPhone(exec, contactId, ownerUserId, d10, phoneRaw) {
  const ins = await exec(
    `INSERT INTO contact_phones (contact_id, owner_user_id, phone_digits10, phone_e164, is_primary)
     VALUES ($1, $2, $3, $4, false)
     ON CONFLICT (owner_user_id, phone_digits10) DO NOTHING
     RETURNING contact_id`,
    [contactId, ownerUserId, d10, phoneRaw || null]
  );
  // Backfill the denormalized parent field if it was empty — admin/segment views read
  // contacts.primary_phone directly. Only on a real insert (skip no-op conflicts).
  if (ins.rows.length) {
    await exec('UPDATE contacts SET primary_phone = COALESCE(primary_phone, $2) WHERE id = $1', [contactId, phoneRaw || null]);
  }
}

async function addEmail(exec, contactId, ownerUserId, em) {
  const ins = await exec(
    `INSERT INTO contact_emails (contact_id, owner_user_id, email, is_primary)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (owner_user_id, email) DO NOTHING
     RETURNING contact_id`,
    [contactId, ownerUserId, em]
  );
  if (ins.rows.length) {
    await exec('UPDATE contacts SET primary_email = COALESCE(primary_email, $2) WHERE id = $1', [contactId, em]);
  }
}

async function enqueueMerge(exec, ownerUserId, keepId, otherId, detail) {
  await exec(
    `INSERT INTO contact_merge_candidates (owner_user_id, contact_id_keep, contact_id_other, reason, detail)
     VALUES ($1, $2, $3, 'phone_email_conflict', $4)
     ON CONFLICT (owner_user_id, contact_id_keep, contact_id_other) WHERE status = 'pending' DO NOTHING`,
    [ownerUserId, keepId, otherId, JSON.stringify(detail || {})]
  );
}
