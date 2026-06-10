#!/usr/bin/env node
/*
 * CTM SMS test harness — ISOLATED diagnostic, NOT wired into journeys.
 *
 * Purpose (per docs/superpowers/specs/2026-05-21-ctm-texting-handoff.md):
 *   1. Empirically confirm agency CTM creds work against account 267834.
 *   2. List numbers + capability flags to find a text-enabled "from" number
 *      and surface A2P/messaging status.
 *   3. Empirically resolve the exact CTM "send SMS" endpoint + field names by
 *      probing candidate paths, then send ONE real SMS to the user's own phone.
 *
 * This script does NOT touch JOURNEY_SMS_ENABLED, the /text stub, or
 * journeyScheduledSends. It talks to the CTM API directly.
 *
 * Auth: HTTP Basic base64(CTM_API_KEY:CTM_API_SECRET) — confirmed env var names.
 *
 * Usage:
 *   node scripts/ctm-sms-test.js list
 *   node scripts/ctm-sms-test.js account
 *   node scripts/ctm-sms-test.js get <path-after-base>            # ad-hoc GET
 *   node scripts/ctm-sms-test.js send --to <e164> --from <e164|id> --message "..."
 *
 * Guardrails: `send` performs a REAL external SMS (costs money, may be
 * A2P-filtered). Only ever pass YOUR OWN number to --to. No PHI in --message.
 */

import '../server/loadEnv.js';
import axios from 'axios';

const ACCOUNT_ID = '267834';
const BASE = process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com';
const API_KEY = process.env.CTM_API_KEY || null;
const API_SECRET = process.env.CTM_API_SECRET || null;

if (!API_KEY || !API_SECRET) {
  console.error('Missing CTM_API_KEY / CTM_API_SECRET in env. Check .env loaded.');
  process.exit(1);
}

const AUTH = `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')}`;
const HEADERS = { Authorization: AUTH, Accept: 'application/json' };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i += 1; }
      else out[key] = true;
    }
  }
  return out;
}

// HIPAA: never print contact/message PII to logs. Mask phones and redact the
// contact-associated keys in any CTM payload we dump.
const maskPhone = (p) => {
  const d = String(p || '').replace(/[^0-9]/g, '');
  return d.length <= 4 ? '***' : `***${d.slice(-4)}`;
};
const SENSITIVE_KEYS = /^(to|from|message|message_body|email|emails|caller_email|caller_number|contact_number|phone)$/i;
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.test(k) ? '«redacted»' : redact(v);
    return out;
  }
  return value;
}

function show(label, status, data) {
  console.log(`\n=== ${label} → HTTP ${status} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(redact(data), null, 2));
}

async function rawGet(pathAfterBase) {
  const url = `${BASE}${pathAfterBase.startsWith('/') ? '' : '/'}${pathAfterBase}`;
  try {
    const resp = await axios.get(url, { headers: HEADERS, timeout: 30000 });
    show(`GET ${url}`, resp.status, resp.data);
    return resp.data;
  } catch (err) {
    show(`GET ${url} (ERROR)`, err.response?.status || 'no-response', err.response?.data || err.message);
    return null;
  }
}

// --- list numbers + capability flags --------------------------------------
async function listNumbers() {
  const url = `${BASE}/api/v1/accounts/${ACCOUNT_ID}/numbers.json`;
  console.log(`Listing numbers for account ${ACCOUNT_ID} ...`);
  try {
    const resp = await axios.get(url, { headers: HEADERS, params: { per_page: 200 }, timeout: 30000 });
    const numbers = resp.data?.numbers || resp.data?.tracking_numbers || resp.data || [];
    console.log(`\nHTTP ${resp.status} — ${Array.isArray(numbers) ? numbers.length : '?'} number(s)`);
    if (Array.isArray(numbers) && numbers.length) {
      console.log('\n--- keys present on first number object ---');
      console.log(Object.keys(numbers[0]).join(', '));
      console.log('\n--- per-number capability summary ---');
      for (const n of numbers) {
        const cap = {};
        for (const k of Object.keys(n)) {
          if (/sms|mms|text|messag|capab|a2p|10dlc|voice|type/i.test(k)) cap[k] = n[k];
        }
        console.log(`\n# ${n.name || n.label || '(unnamed)'}  id=${n.id}  number=${n.number || n.phone_number || n.formatted_number || '?'}`);
        console.log(JSON.stringify(cap, null, 2));
      }
    }
    console.log('\n--- RAW first number object (full) ---');
    console.log(JSON.stringify(Array.isArray(numbers) ? numbers[0] : numbers, null, 2));
    return numbers;
  } catch (err) {
    show(`GET ${url} (ERROR)`, err.response?.status || 'no-response', err.response?.data || err.message);
    return null;
  }
}

// --- send SMS: probe candidate endpoints -----------------------------------
// Each candidate is {method, path, body}. We try in order and STOP on the
// first response that is NOT 404/405 (i.e. the path the API actually routes).
// A 2xx means a text was sent — we stop immediately. A 422 means the path is
// right but fields need adjusting — we stop and report so we can refine
// WITHOUT firing additional sends.
function buildCandidates({ to, from, message }) {
  const acct = `/api/v1/accounts/${ACCOUNT_ID}`;
  return [
    { path: `${acct}/messages.json`, body: { to, from, message } },
    { path: `${acct}/texts.json`, body: { to, from, message } },
    { path: `${acct}/sms.json`, body: { to, from, message } },
    { path: `${acct}/text_messages.json`, body: { to, from, message } },
    { path: `${acct}/messages.json`, body: { to, from, text: message } },
    { path: `${acct}/sms/send.json`, body: { to, from, message } },
  ];
}

async function sendSms({ to, from, message }) {
  if (!to || !from || !message) {
    console.error('send requires --to, --from, and --message');
    process.exit(1);
  }
  console.log(`\nProbing send-SMS endpoints for account ${ACCOUNT_ID}`);
  console.log(`from=${maskPhone(from)}  to=${maskPhone(to)}  message=[${String(message).length} chars]\n`);

  const candidates = buildCandidates({ to, from, message });
  for (const c of candidates) {
    const url = `${BASE}${c.path}`;
    try {
      const resp = await axios.post(url, c.body, {
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: () => true, // we inspect every status ourselves
      });
      const status = resp.status;
      const skip = status === 404 || status === 405;
      console.log(`POST ${c.path}  body=${JSON.stringify(redact(c.body))}  → HTTP ${status}${skip ? '  (route miss, trying next)' : ''}`);
      if (skip) continue;

      // Non-404/405: this is the route. Report fully and STOP.
      show(`MATCHED ${c.path}`, status, resp.data);
      if (status >= 200 && status < 300) {
        console.log('\n✅ Looks like a SEND SUCCESS — a real text may have been dispatched. Check your phone.');
      } else if (status === 422 || status === 400) {
        console.log('\nℹ️  Path matched but fields/validation failed. NO text sent. Endpoint resolved — refine fields next.');
      } else {
        console.log(`\nℹ️  Path matched, HTTP ${status}. Inspect body above (auth/permission/A2P issue likely).`);
      }
      return;
    } catch (err) {
      console.log(`POST ${c.path}  → request error: ${err.message}`);
    }
  }
  console.log('\n❌ All candidate paths returned 404/405. Endpoint not in candidate list — need the Postman path.');
}

// --- main ------------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (cmd) {
  case 'list':
    await listNumbers();
    break;
  case 'account':
    await rawGet(`/api/v1/accounts/${ACCOUNT_ID}.json`);
    break;
  case 'get':
    if (!rest[0]) { console.error('get requires a path'); process.exit(1); }
    await rawGet(rest[0]);
    break;
  case 'send':
    await sendSms({ to: args.to, from: args.from, message: args.message });
    break;
  default:
    console.log('Usage: node scripts/ctm-sms-test.js <list|account|get <path>|send --to --from --message>');
}
