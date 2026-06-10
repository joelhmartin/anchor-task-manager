#!/usr/bin/env node
/*
 * One-off backfill: populate caller_email for historical contacts by re-fetching
 * each client's CTM activity and extracting the contact email.
 *
 * Forms collect an email (required field) and CTM returns it on the call object
 * (`email`), but older call_logs rows were imported before we extracted it. In the
 * current model a "contact" is a unique phone number under an owner, so for each
 * owner with a CTM account we:
 *   1. sweep the account's CTM calls (bulk list, paginated) and build a
 *      phone -> email map using the same getCallerEmail() the live pull uses,
 *   2. for each of our emailless contacts whose phone is in that map, stamp the
 *      email onto the most recent call_logs row for that contact.
 * One row is enough — the phone-match resolver (and the future contact table)
 * surface it everywhere from there.
 *
 * NOTE: the bulk list endpoint carries `email`; the per-caller_number filter does
 * NOT reliably match form submissions, which is why we sweep in bulk.
 *
 * Idempotent: contacts that already have an email anywhere are left untouched, so
 * it is safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-ctm-contact-emails.js [options]
 * Options:
 *   --owner <userId>   Restrict to one owner_user_id
 *   --limit <N>        Max contacts to UPDATE this run (default 1000)
 *   --max-pages <N>    Max CTM pages to sweep per account (default 50, 100/page)
 *   --sleep <ms>       Delay between CTM page fetches (default 200)
 *   --dry-run          Don't write; just report what would change
 */

import '../server/loadEnv.js';
import axios from 'axios';
import { query } from '../server/db.js';
import { getCallerEmail } from '../server/services/ctm.js';

const CTM_BASE = process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com';
const API_KEY = process.env.CTM_API_KEY;
const API_SECRET = process.env.CTM_API_SECRET;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const LIMIT = Number(args.limit) || 1000;
const MAX_PAGES = Number(args['max-pages']) || 50;
const SLEEP = Number(args.sleep) || 200;
const DRY = Boolean(args['dry-run']);
const OWNER = typeof args.owner === 'string' ? args.owner : null;

if (!API_KEY || !API_SECRET) {
  console.error('Missing CTM_API_KEY / CTM_API_SECRET — check .env loaded.');
  process.exit(1);
}

const AUTH = `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digitsOf = (s) => String(s || '').replace(/[^0-9]/g, '');

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

// Never log full phone numbers (PHI) — keep only the last 4 for correlation.
function maskPhone(digits) {
  const d = String(digits || '');
  return d.length <= 4 ? '***' : `***${d.slice(-4)}`;
}

// Sweep the account's CTM calls in bulk and build a phone(digits) -> email map.
// Skips the per-caller_number filter because it doesn't match form submissions.
async function buildEmailByPhone(accountId) {
  const emailByPhone = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let resp;
    try {
      resp = await axios.get(`${CTM_BASE}/api/v1/accounts/${encodeURIComponent(accountId)}/calls`, {
        params: { per_page: 100, page, order: 'desc' },
        headers: { Authorization: AUTH, Accept: 'application/json' },
        timeout: 30000,
        validateStatus: () => true
      });
    } catch (err) {
      console.error(`  page ${page} fetch error: ${err.message}`);
      break;
    }
    if (resp.status !== 200) {
      console.error(`  page ${page} HTTP ${resp.status} — stopping account`);
      break;
    }
    const calls = Array.isArray(resp.data?.calls) ? resp.data.calls : Array.isArray(resp.data?.data) ? resp.data.data : [];
    if (!calls.length) break;
    for (const call of calls) {
      const email = getCallerEmail(call);
      if (!email) continue;
      const digits = digitsOf(call.caller_number || call.contact_number || call.caller?.number);
      // Require a full 10-digit number: RIGHT(x,10) on a shorter value can't
      // equal a real 10-digit number, so this avoids matching another contact
      // on a short/malformed phone (would write the wrong email).
      if (digits.length >= 10 && !emailByPhone.has(digits)) emailByPhone.set(digits, email);
    }
    if (calls.length < 100) break;
    await sleep(SLEEP);
  }
  return emailByPhone;
}

async function main() {
  const ownerRows = await query(
    `SELECT cp.user_id, cp.ctm_account_number
       FROM client_profiles cp
      WHERE cp.ctm_account_number IS NOT NULL AND cp.ctm_account_number <> ''
        AND ($1::uuid IS NULL OR cp.user_id = $1)
      ORDER BY cp.user_id`,
    [OWNER || null]
  );

  console.log(`Owners with a CTM account: ${ownerRows.rows.length}${DRY ? ' (dry-run)' : ''}`);

  let mapped = 0;
  let updated = 0;
  let rowsStamped = 0;

  for (const owner of ownerRows.rows) {
    if (updated >= LIMIT) break;
    console.log(`\nOwner ${owner.user_id} (CTM ${owner.ctm_account_number}) — sweeping…`);
    const emailByPhone = await buildEmailByPhone(owner.ctm_account_number);
    mapped += emailByPhone.size;
    console.log(`  CTM phones with an email: ${emailByPhone.size}`);

    for (const [digits, email] of emailByPhone) {
      if (updated >= LIMIT) break;
      // Stamp the email onto EVERY emailless row for this contact (matched by
      // last-10 digits) so per-row lead drawers — not just the phone-resolving
      // journey view — surface it. Only fills blanks; never overwrites.
      const matchClause = `owner_user_id = $1
            AND LENGTH(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g')) >= 10
            AND RIGHT(REGEXP_REPLACE(from_number, '[^0-9]', '', 'g'), 10) = RIGHT($2, 10)
            AND COALESCE(meta->>'caller_email', '') = ''`;
      if (DRY) {
        const chk = await query(`SELECT count(*)::int AS n FROM call_logs WHERE ${matchClause}`, [owner.user_id, digits]);
        const n = chk.rows[0]?.n || 0;
        if (n > 0) {
          updated += 1;
          rowsStamped += n;
          console.log(`  ${maskPhone(digits)} -> ${maskEmail(email)} (${n} rows, dry)`);
        }
      } else {
        const upd = await query(
          `UPDATE call_logs SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{caller_email}', to_jsonb($3::text), true) WHERE ${matchClause}`,
          [owner.user_id, digits, email]
        );
        if (upd.rowCount) {
          updated += 1;
          rowsStamped += upd.rowCount;
          console.log(`  ${maskPhone(digits)} -> ${maskEmail(email)} (${upd.rowCount} rows)`);
        }
      }
    }
  }

  console.log(`\nDone. CTM phones-with-email mapped=${mapped}  contacts updated=${updated}  rows stamped=${rowsStamped}${DRY ? ' (dry-run)' : ''}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
  });
