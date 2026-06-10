// Hub sub-router: contacts — list/export/profile, contact rename, archive, tags, consent.
import express from 'express';

import { query, getClient } from '../../db.js';
import { logSecurityEvent } from '../../services/security/index.js';
import { csvCell, formatCsvDate } from '../../utils/csv.js';
import { applyContactTags, removeContactTag } from '../../services/contactTags.js';
import { CONTACT_ROUTE_UUID_RE } from './_shared.js';
import { isReservedTagName, RESERVED_TAG_NAMES } from './_callHelpers.js';

const router = express.Router();

// server/index.js binds the port BEFORE the migration chain runs, so the notes endpoints can
// be hit before migrate_lead_notes_contact_unify adds lead_notes.contact_id — querying that
// column would 500 with undefined_column (42703). Memoize a one-time information_schema probe:
// once the column exists the flag latches true and costs nothing per request. A failed probe is
// treated as not-ready (re-checked next request) and never crashes the handler. Mirrors the
// ensureLeadRemovedCol() pattern in calls.js.
let leadNotesContactColReady = false;
async function ensureLeadNotesContactCol() {
  if (leadNotesContactColReady) return;
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'lead_notes' AND column_name = 'contact_id' LIMIT 1`
    );
    if (rows.length) leadNotesContactColReady = true;
  } catch {
    // Not-ready; leave the flag false so we re-probe on the next request.
  }
}

// GET /state-version — cheap per-owner change token for lightweight polling (~15s).
// Returns an opaque string the client compares verbatim; it changes on any insert/update/
// archive of the contacts or client_journeys tables this owner cares about (archive bumps
// updated_at, so the mtime still moves even though COUNT(*) doesn't drop on soft-archive).
// Registered ahead of the /contacts/:id-style routes; its path segment differs, so it is
// never shadowed by the UUID-guarded param routes below.
router.get('/state-version', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*) FROM contacts WHERE owner_user_id = $1) AS contacts_count,
         (SELECT EXTRACT(EPOCH FROM COALESCE(MAX(updated_at), to_timestamp(0))) FROM contacts WHERE owner_user_id = $1) AS contacts_mtime,
         (SELECT COUNT(*) FROM client_journeys WHERE owner_user_id = $1) AS journeys_count,
         (SELECT EXTRACT(EPOCH FROM COALESCE(MAX(updated_at), to_timestamp(0))) FROM client_journeys WHERE owner_user_id = $1) AS journeys_mtime`,
      [targetUserId]
    );
    const r = rows[0] || {};
    const contactsCount = Number(r.contacts_count) || 0;
    const contactsMtime = Math.trunc(Number(r.contacts_mtime) || 0);
    const journeysCount = Number(r.journeys_count) || 0;
    const journeysMtime = Math.trunc(Number(r.journeys_mtime) || 0);
    const version = `${contactsCount}:${contactsMtime}:${journeysCount}:${journeysMtime}`;
    res.json({
      version,
      contacts: { count: contactsCount, mtime: contactsMtime },
      journeys: { count: journeysCount, mtime: journeysMtime }
    });
  } catch (err) {
    console.error('[contacts:state-version]', { code: err?.code });
    res.status(500).json({ message: 'Failed to read state version.' });
  }
});

// PATCH /contacts/:id/name — rename a contact (human-set, authoritative for display).
// In hub.js (not the staff-only contacts router) so client-portal users can rename their
// own contacts too. Owner-scoped like /calls/:id/score.
router.patch('/contacts/:id/name', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const contactId = req.params.id;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(contactId)) return res.status(400).json({ message: 'Invalid contact id.' });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ message: 'A name is required.' });
  if (name.length > 200) return res.status(400).json({ message: 'Name is too long (max 200 characters).' });
  try {
    const { rows } = await query(
      `UPDATE contacts SET display_name = $1, display_name_source = 'user', updated_at = NOW()
       WHERE id = $2 AND owner_user_id = $3
       RETURNING id, display_name, display_name_source`,
      [name, contactId, targetUserId]
    );
    if (!rows.length) {
      await logSecurityEvent({
        userId: req.user.id, eventType: 'contact_name_update', eventCategory: 'contacts',
        success: false, details: { contactId, ownerUserId: targetUserId, reason: 'not_found_or_not_owned' }
      });
      return res.status(404).json({ message: 'Contact not found.' });
    }
    await logSecurityEvent({
      userId: req.user.id,
      eventType: 'contact_name_update',
      eventCategory: 'contacts',
      success: true,
      details: { contactId, ownerUserId: targetUserId }
    });
    res.json({ contact: rows[0] });
  } catch (err) {
    console.error('[contacts:name]', { code: err?.code });
    await logSecurityEvent({
      userId: req.user.id, eventType: 'contact_name_update', eventCategory: 'contacts',
      success: false, details: { contactId, reason: 'error', code: err?.code }
    }).catch(() => {});
    res.status(500).json({ message: 'Failed to update name.' });
  }
});

// Shared filter/SQL builder for the contacts list + CSV export — owner-scoped, so the two
// can never drift apart. Returns { error } on a bad filter, else { targetUserId, inner,
// Raw classifier labels behind each user-facing "lead" category. KEEP IN SYNC with the
// Lead Inbox's VISIBLE_CATEGORY_BUCKETS (this file, ~line 5704) — they must agree so the
// Contacts category filter and the Leads list bucket rows identically.
const CONTACT_CATEGORY_RAW = {
  lead: ['warm', 'very_good', 'very_hot', 'very-hot', 'hot', 'neutral', 'unreviewed', 'converted'],
  unanswered: ['unanswered', 'voicemail'],
  not_a_fit: ['not_a_fit', 'applicant'],
  spam: ['spam']
};
// The user-facing category options offered by the Contacts filter (mirror Leads chips).
const CONTACT_CATEGORY_OPTIONS = ['qualified', 'unanswered', 'not_a_fit', 'spam', 'pending_review'];

// Derived per-contact disposition value → human label (CSV export + any server rendering).
// Keep in sync with DISPOSITION_CHIP on the frontend (ContactsTab.jsx).
const DISPOSITION_LABEL = {
  qualified: 'Qualified Lead',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};

// Reserved tag-name validation (normalizeTagName / RESERVED_TAG_NAMES / RESERVED_TAG_NAME_SET /
// isReservedTagName) now lives in ./hub/_callHelpers.js — shared with /calls/:id/tags (calls.js).

// Build a single per-activity predicate (operating on alias `cl`) for one visible category,
// pushing any array params via `push`. Mirrors the Lead Inbox category SQL exactly so a
// contact is bucketed the same way its activities are.
function contactCategoryActivityCond(cat, push) {
  const catCol = `COALESCE(cl.meta->>'category', 'unreviewed')`;
  const notPending = `COALESCE(cl.meta->>'classification_pending', 'false') <> 'true'`;
  if (cat === 'pending_review') return `cl.meta->>'classification_pending' = 'true'`;
  if (cat === 'qualified') {
    // 3★+ slice of the lead bucket (forms/SMS never demoted) PLUS Priority (needs_attention).
    const p = push(CONTACT_CATEGORY_RAW.lead);
    return `${notPending} AND ((${catCol} = ANY(${p}::text[]) AND (COALESCE(cl.activity_type,'call') <> 'call' OR COALESCE(cl.score,0) >= 3)) OR ${catCol} = 'needs_attention')`;
  }
  const raw = CONTACT_CATEGORY_RAW[cat];
  if (!raw) return null;
  const p = push(raw);
  return `${catCol} = ANY(${p}::text[]) AND ${notPending}`;
}

// EXISTS clause: the contact has ≥1 activity matching ANY of the selected categories.
function buildContactCategoryExists(cats, push) {
  const ors = cats.map((c) => contactCategoryActivityCond(c, push)).filter(Boolean);
  if (!ors.length) return null;
  return `EXISTS (SELECT 1 FROM call_logs cl WHERE cl.contact_id = c.id AND (${ors.map((o) => `(${o})`).join(' OR ')}))`;
}

// params, lifeParams, lifeFilter }. `status` supersedes `lifecycle` (kept as an alias);
// 'archived' is orthogonal (flips the contact's own archived_at predicate).
function buildContactListQuery(req, { forExport = false } = {}) {
  const targetUserId = req.portalUserId || req.user.id;
  const search = (req.query.search || '').trim();
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // tag/service accept a comma-separated list of UUIDs (multi-select). Each selected value
  // adds its own EXISTS, so the contact must match ALL of them (AND). Cap at 20 to bound SQL.
  const parseUuidList = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return { values: [] };
    const values = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
    if (values.some((v) => !UUID_RE.test(v)) || values.length > 20) return { error: true };
    return { values };
  };
  const tagParsed = parseUuidList(req.query.tag);
  if (tagParsed.error) return { error: 'Invalid tag filter.' };
  const serviceParsed = parseUuidList(req.query.service);
  if (serviceParsed.error) return { error: 'Invalid service filter.' };
  const tagIds = tagParsed.values;
  const serviceIds = serviceParsed.values;
  // Stage multi-select: comma-separated buckets. 'archived' is its own top-precedence bucket
  // (an archived contact appears ONLY under 'archived', regardless of its underlying lifecycle).
  // Empty/absent = all non-archived stages — matches the old single-select "All statuses".
  const STAGE_VALUES = ['lead', 'in_journey', 'active_client', 'archived'];
  const statusRaw = (req.query.status || req.query.lifecycle || '').trim();
  let stages = statusRaw ? [...new Set(statusRaw.split(',').map((s) => s.trim()).filter(Boolean))] : [];
  if (stages.some((s) => !STAGE_VALUES.includes(s))) return { error: 'Invalid status filter.' };
  if (!stages.length) stages = ['lead', 'in_journey', 'active_client'];
  // Strict calendar-date validation: the shape regex alone accepts impossible dates
  // (e.g. 2026-99-99) which would then throw on the ::date cast (→ 500). Round-trip
  // through Date to reject them at the boundary with a 400 instead.
  const parseYmd = (value, label) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { value: null };
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      return { error: `Invalid ${label} filter.` };
    }
    return { value };
  };
  const fromParsed = parseYmd(req.query.from, 'from');
  if (fromParsed.error) return { error: fromParsed.error };
  const toParsed = parseYmd(req.query.to, 'to');
  if (toParsed.error) return { error: toParsed.error };
  const dateFrom = fromParsed.value;
  const dateTo = toParsed.value;

  // archived_at is no longer a base predicate — the stage filter (applied on the outer query
  // below) decides whether archived contacts are included, so multi-select can mix archived
  // with live stages.
  const conds = ['c.owner_user_id = $1'];
  const params = [targetUserId];
  if (search) {
    params.push(`%${search}%`); const p = `$${params.length}`;
    params.push(search.replace(/[^0-9]/g, '')); const digits = `$${params.length}`;
    conds.push(`(c.display_name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.contact_id = c.id AND ${digits} <> '' AND cp.phone_digits10 LIKE '%' || RIGHT(${digits}, 10) || '%')
      OR EXISTS (SELECT 1 FROM contact_emails ce WHERE ce.contact_id = c.id AND ce.email ILIKE ${p}))`);
  }
  // One EXISTS per selected id → contact must carry ALL chosen tags / ALL chosen services.
  for (const tagId of tagIds) {
    params.push(tagId);
    conds.push(`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = $${params.length})`);
  }
  for (const serviceId of serviceIds) {
    params.push(serviceId);
    conds.push(`EXISTS (SELECT 1 FROM contact_services csv WHERE csv.contact_id = c.id AND csv.service_id = $${params.length} AND csv.redacted_at IS NULL)`);
  }
  if (dateFrom) { params.push(dateFrom); conds.push(`c.last_activity_at >= $${params.length}::date`); }
  if (dateTo) { params.push(dateTo); conds.push(`c.last_activity_at < ($${params.length}::date + INTERVAL '1 day')`); }

  // Category multi-select (comma-separated visible categories). A contact matches if it has
  // any activity in the selected categories — so a person with even one qualified contact
  // stays, while pure spam/not-a-fit/unanswered get filtered out. Empty/absent = no filter.
  const categoryRaw = (req.query.category || '').trim();
  if (categoryRaw) {
    const cats = [...new Set(categoryRaw.split(',').map((s) => s.trim()).filter(Boolean))];
    if (cats.some((c) => !CONTACT_CATEGORY_OPTIONS.includes(c))) return { error: 'Invalid category filter.' };
    const exists = buildContactCategoryExists(cats, (arr) => { params.push(arr); return `$${params.length}`; });
    if (exists) conds.push(exists);
  }

  const lifecycleSql = `CASE
    WHEN EXISTS (SELECT 1 FROM active_clients ac WHERE ac.owner_user_id = c.owner_user_id AND ac.contact_id = c.id AND ac.archived_at IS NULL) THEN 'active_client'
    WHEN EXISTS (SELECT 1 FROM client_journeys cj WHERE cj.owner_user_id = c.owner_user_id AND cj.contact_id = c.id AND cj.active_client_id IS NULL AND COALESCE(cj.status,'in_progress') NOT IN ('active_client','won','lost','archived')) THEN 'in_journey'
    ELSE 'lead' END`;

  // Export-only derived columns: attribution is per-activity (call_logs.meta->>'source'),
  // not stored on the contact, so first-touch / sources-touched / first-activity are derived
  // here at export time. Kept out of the list query (perf) — only appended when forExport.
  const exportCols = forExport
    ? `,
           (SELECT cl.meta->>'source' FROM call_logs cl
              WHERE cl.contact_id = c.id AND NULLIF(TRIM(cl.meta->>'source'), '') IS NOT NULL
              ORDER BY cl.started_at ASC NULLS LAST LIMIT 1) AS first_source,
           (SELECT string_agg(DISTINCT NULLIF(TRIM(cl.meta->>'source'), ''), '; ')
              FROM call_logs cl WHERE cl.contact_id = c.id) AS sources_touched,
           (SELECT MIN(cl.started_at) FROM call_logs cl WHERE cl.contact_id = c.id) AS first_activity_at`
    : '';

  // Per-contact disposition = highest-precedence category across ALL its activities (derived,
  // never stored). Mirrors contactCategoryActivityCond's predicates so this column and the
  // Category filter can never disagree. needs_attention is surfaced as its own "Priority" tier
  // here even though the filter folds it into "qualified".
  // ⚠ These three params.push() must run AFTER every filter param above and BEFORE `inner` is
  // built, so the $N placeholders embedded in dispositionSql stay aligned with `params`.
  const dCat = `COALESCE(cl.meta->>'category', 'unreviewed')`;
  const dNotPending = `COALESCE(cl.meta->>'classification_pending', 'false') <> 'true'`;
  const dLead = (() => { params.push(CONTACT_CATEGORY_RAW.lead); return `$${params.length}`; })();
  const dUn = (() => { params.push(CONTACT_CATEGORY_RAW.unanswered); return `$${params.length}`; })();
  const dNaf = (() => { params.push(CONTACT_CATEGORY_RAW.not_a_fit); return `$${params.length}`; })();
  const dEx = (pred) => `EXISTS (SELECT 1 FROM call_logs cl WHERE cl.contact_id = c.id AND (${pred}))`;
  const dispositionSql = `CASE
    WHEN ${dEx(`${dNotPending} AND ${dCat} = ANY(${dLead}::text[]) AND (COALESCE(cl.activity_type,'call') <> 'call' OR COALESCE(cl.score,0) >= 3)`)} THEN 'qualified'
    WHEN ${dEx(`${dNotPending} AND ${dCat} = 'needs_attention'`)} THEN 'needs_attention'
    WHEN ${dEx(`${dNotPending} AND ${dCat} = ANY(${dUn}::text[])`)} THEN 'unanswered'
    WHEN ${dEx(`${dNotPending} AND ${dCat} = ANY(${dNaf}::text[])`)} THEN 'not_a_fit'
    WHEN ${dEx(`${dNotPending} AND ${dCat} = 'spam'`)} THEN 'spam'
    ELSE 'pending_review' END`;

  const inner = `
    SELECT c.id, c.display_name, c.display_name_source, c.primary_phone, c.primary_email,
           c.last_activity_at, c.first_seen_at, c.archived_at,
           (SELECT COUNT(*) FROM call_logs cl WHERE cl.contact_id = c.id) AS activity_count,
           (SELECT COALESCE(json_agg(json_build_object('id', lt.id, 'name', lt.name, 'color', lt.color)), '[]'::json)
              FROM contact_tags ct2 JOIN lead_tags lt ON lt.id = ct2.tag_id WHERE ct2.contact_id = c.id) AS tags,
           (SELECT COALESCE(json_agg(DISTINCT cs2.service_name), '[]'::json)
              FROM contact_services cs2 WHERE cs2.contact_id = c.id AND cs2.service_name IS NOT NULL AND cs2.redacted_at IS NULL) AS services,
           ${lifecycleSql} AS lifecycle, ${dispositionSql} AS disposition${exportCols}
    FROM contacts c
    WHERE ${conds.join(' AND ')}`;

  // Stage filter (multi-select): archived is the top-precedence bucket; otherwise the contact's
  // derived lifecycle. Always applied (defaults to the non-archived stages above).
  const lifeParams = [...params];
  lifeParams.push(stages);
  const lifeFilter = `WHERE (CASE WHEN t.archived_at IS NOT NULL THEN 'archived' ELSE t.lifecycle END) = ANY($${lifeParams.length}::text[])`;
  return { targetUserId, inner, params, lifeParams, lifeFilter };
}

// GET /contacts — owner-scoped contact list. Search (name/phone/email), filters
// (status incl. archived, tag, service, date range), paginate. Read-only.
router.get('/contacts', async (req, res) => {
  const built = buildContactListQuery(req);
  if (built.error) return res.status(400).json({ message: built.error });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  try {
    const countResult = await query(`SELECT COUNT(*) AS total FROM (${built.inner}) t ${built.lifeFilter}`, built.lifeParams);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);
    const pageParams = [...built.lifeParams, limit, offset];
    const { rows } = await query(
      `SELECT * FROM (${built.inner}) t ${built.lifeFilter}
       ORDER BY t.last_activity_at DESC NULLS LAST
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );
    res.json({ contacts: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[contacts:list]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load contacts.' });
  }
});

// csvCell / formatCsvDate now live in server/utils/csv.js (shared with the portal exports).

const contactStatusLabel = (r) =>
  r.archived_at ? 'Archived' : r.lifecycle === 'active_client' ? 'Active Client' : r.lifecycle === 'in_journey' ? 'In Journey' : 'New Lead';

// CSV column registry — single source of truth for export columns. The frontend dialog
// offers these same keys (kept in sync by key); `default: true` are pre-checked there.
// To add a future client field: add one entry here (+ the source column on the row, via
// buildContactListQuery's exportCols when it's derived). Keep keys in this canonical order.
const CONTACT_CSV_COLUMNS = [
  { key: 'name', header: 'Name', default: true, value: (r) => r.display_name },
  { key: 'phone', header: 'Phone', default: true, value: (r) => r.primary_phone },
  { key: 'email', header: 'Email', default: true, value: (r) => r.primary_email },
  { key: 'tags', header: 'Tags', default: true, value: (r) => (Array.isArray(r.tags) ? r.tags.map((t) => t.name).join('; ') : '') },
  { key: 'services', header: 'Services', default: true, value: (r) => (Array.isArray(r.services) ? r.services.join('; ') : '') },
  { key: 'status', header: 'Status', value: contactStatusLabel },
  { key: 'disposition', header: 'Disposition', value: (r) => DISPOSITION_LABEL[r.disposition] || '' },
  { key: 'first_source', header: 'First source', value: (r) => r.first_source },
  { key: 'sources_touched', header: 'Sources touched', value: (r) => r.sources_touched },
  { key: 'first_activity', header: 'First activity', value: (r) => formatCsvDate(r.first_activity_at) },
  { key: 'last_activity', header: 'Last activity', value: (r) => formatCsvDate(r.last_activity_at) },
  { key: 'first_seen', header: 'First seen', value: (r) => formatCsvDate(r.first_seen_at) },
  { key: 'activity_count', header: 'Activity count', value: (r) => r.activity_count ?? 0 }
];
const CONTACT_CSV_BY_KEY = Object.fromEntries(CONTACT_CSV_COLUMNS.map((c) => [c.key, c]));
const CONTACT_CSV_DEFAULT_KEYS = CONTACT_CSV_COLUMNS.filter((c) => c.default).map((c) => c.key);

// Parse the `columns` query param against the registry, preserving canonical order; fall
// back to the default set when nothing valid is requested.
function resolveContactCsvColumns(raw) {
  const requested = typeof raw === 'string' ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const picked = CONTACT_CSV_COLUMNS.filter((c) => requested.includes(c.key)).map((c) => c.key);
  return picked.length ? picked : CONTACT_CSV_DEFAULT_KEYS;
}

// GET /contacts/export.csv — owner-scoped CSV of the filtered set (same filters as the
// list, via buildContactListQuery). PHI export → audited; capped; text/csv attachment.
// Declared before /contacts/:id so the literal path isn't captured as an :id.
router.get('/contacts/export.csv', async (req, res) => {
  const built = buildContactListQuery(req, { forExport: true });
  if (built.error) return res.status(400).json({ message: built.error });
  const MAX = 10000;
  try {
    const { rows } = await query(
      `SELECT * FROM (${built.inner}) t ${built.lifeFilter}
       ORDER BY t.last_activity_at DESC NULLS LAST LIMIT ${MAX + 1}`,
      built.lifeParams
    );
    const capped = rows.length > MAX;
    const out = rows.slice(0, MAX);
    const columns = resolveContactCsvColumns(req.query.columns);
    await logSecurityEvent({
      userId: req.user.id, eventType: 'contacts_export', eventCategory: 'contacts', success: true,
      details: {
        ownerUserId: built.targetUserId, count: out.length, capped, columns,
        filters: {
          status: req.query.status || req.query.lifecycle || null,
          tag: req.query.tag || null, service: req.query.service || null,
          category: req.query.category || null
        }
      }
    });
    const lines = [columns.map((key) => csvCell(CONTACT_CSV_BY_KEY[key].header)).join(',')];
    for (const r of out) {
      lines.push(columns.map((key) => csvCell(CONTACT_CSV_BY_KEY[key].value(r))).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[contacts:export]', { code: err?.code });
    res.status(500).json({ message: 'Failed to export contacts.' });
  }
});

// GET /contacts/tag-options — distinct tags actually applied to THIS owner's contacts.
// Powers the Contacts tag filter so it only offers tags that can return results (the full
// lead_tags catalog includes system/lead tags never put on a contact). Declared before
// /contacts/:id so the literal path isn't captured as an :id.
router.get('/contacts/tag-options', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const { rows } = await query(
      `SELECT DISTINCT lt.id, lt.name, lt.color
         FROM contact_tags ct
         JOIN lead_tags lt ON lt.id = ct.tag_id
         JOIN contacts c ON c.id = ct.contact_id
        WHERE c.owner_user_id = $1
          AND lt.owner_user_id = $1
          AND BTRIM(REGEXP_REPLACE(LOWER(lt.name), '[-_[:space:]]+', ' ', 'g')) <> ALL($2::text[])
        ORDER BY lt.name`,
      [targetUserId, RESERVED_TAG_NAMES]
    );
    res.json({ tags: rows });
  } catch (err) {
    console.error('[contacts:tag-options]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load tag options.' });
  }
});

// PATCH /contacts/:id/archive { archived: boolean } — owner-scoped soft archive/restore.
router.patch('/contacts/:id/archive', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  const archived = req.body?.archived;
  if (typeof archived !== 'boolean') return res.status(400).json({ message: 'archived (boolean) is required.' });
  let client;
  try {
    client = await getClient();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE contacts SET archived_at = CASE WHEN $3 THEN NOW() ELSE NULL END, updated_at = NOW()
         WHERE id = $1 AND owner_user_id = $2 RETURNING id, archived_at`,
      [req.params.id, targetUserId, archived]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      await logSecurityEvent({ userId: req.user.id, eventType: 'contact_archive', eventCategory: 'contacts', success: false, details: { contactId: req.params.id, archived, reason: 'not_found_or_not_owned' } }).catch(() => {});
      return res.status(404).json({ message: 'Contact not found.' });
    }
    // Cascade: archiving a contact also archives its LIVE (non-terminal) journeys so a stale
    // journey can't keep running on the pipeline board / scheduler after the contact is gone.
    // Restore (archived === false) intentionally does NOT un-archive journeys — by product
    // decision a callback starts a fresh journey rather than resuming the old one.
    let archivedJourneyCount = 0;
    if (archived === true) {
      const journeyResult = await client.query(
        `UPDATE client_journeys
           SET status = 'archived', stage = NULL, archived_at = COALESCE(archived_at, NOW()),
               next_action_at = NULL, updated_at = NOW()
         WHERE contact_id = $1 AND owner_user_id = $2
           AND COALESCE(status, 'in_progress') NOT IN ('active_client', 'won', 'lost', 'archived', 'converted')`,
        [req.params.id, targetUserId]
      );
      archivedJourneyCount = journeyResult.rowCount || 0;
    }
    await client.query('COMMIT');
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_archive', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, archived, archivedJourneyCount } });
    res.json({ contact: rows[0] });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[contacts:archive]', { code: err?.code });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_archive', eventCategory: 'contacts', success: false, details: { contactId: req.params.id, archived, reason: 'error', code: err?.code } }).catch(() => {});
    res.status(500).json({ message: 'Failed to update archive state.' });
  } finally {
    client?.release();
  }
});

// GET /contacts/:id — owner-scoped profile: contact + identifiers + tags + consent.
router.get('/contacts/:id', async (req, res, next) => {
  const targetUserId = req.portalUserId || req.user.id;
  const id = req.params.id;
  // A non-UUID :id means this isn't a profile lookup — it's a sibling literal route
  // (e.g. /contacts/merge-candidates in routes/contacts.js, mounted after hub.js at the
  // same /api/hub base). Fall through to it instead of 400-ing, so this param route can't
  // shadow literal contact routes.
  if (!CONTACT_ROUTE_UUID_RE.test(id)) return next();
  try {
    const c = await query(
      `SELECT id, display_name, display_name_source, primary_phone, primary_email,
              sms_opted_out, email_opted_out, email_unsubscribed_at, first_seen_at, last_activity_at, archived_at
         FROM contacts WHERE id = $1 AND owner_user_id = $2`,
      [id, targetUserId]
    );
    if (!c.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    const [phones, emails, tags, count, services] = await Promise.all([
      query('SELECT id, phone_digits10, phone_e164, is_primary FROM contact_phones WHERE contact_id = $1 ORDER BY is_primary DESC', [id]),
      query('SELECT id, email, is_primary FROM contact_emails WHERE contact_id = $1 ORDER BY is_primary DESC', [id]),
      query('SELECT lt.id, lt.name, lt.color, ct.source FROM contact_tags ct JOIN lead_tags lt ON lt.id = ct.tag_id WHERE ct.contact_id = $1 ORDER BY lt.name', [id]),
      query('SELECT COUNT(*) AS n FROM call_logs WHERE contact_id = $1', [id]),
      query(`SELECT cs.id, cs.service_id, cs.service_name, cs.source, cs.source_ref_id, cs.created_at
               FROM contact_services cs WHERE cs.contact_id = $1 AND cs.owner_user_id = $2 AND cs.redacted_at IS NULL ORDER BY cs.created_at DESC`, [id, targetUserId])
    ]);
    // Audit the PHI read (identifiers + consent) to the immutable trail. No PHI values in details.
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_profile_read', eventCategory: 'contacts', success: true, details: { contactId: id, ownerUserId: targetUserId } });
    res.json({
      contact: c.rows[0],
      phones: phones.rows,
      emails: emails.rows,
      tags: tags.rows,
      services: services.rows,
      consent: { sms_opted_out: c.rows[0].sms_opted_out, email_opted_out: c.rows[0].email_opted_out, email_unsubscribed_at: c.rows[0].email_unsubscribed_at },
      activity_count: parseInt(count.rows[0]?.n || 0, 10)
    });
  } catch (err) {
    console.error('[contacts:get]', { code: err?.code });
    res.status(500).json({ message: 'Failed to load contact.' });
  }
});

// Tags (client-accessible, owner-scoped). The staff copies in contacts.js remain.
router.get('/contacts/:id/tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    const { rows } = await query(
      `SELECT lt.id, lt.name, lt.color, lt.system_key, ct.source, ct.created_at
         FROM contact_tags ct JOIN lead_tags lt ON lt.id = ct.tag_id
        WHERE ct.contact_id = $1 ORDER BY lt.name`, [req.params.id]);
    res.json({ tags: rows });
  } catch (err) { console.error('[contacts:tags:get]', { code: err?.code }); res.status(500).json({ message: 'Failed to load tags.' }); }
});

// Apply a tag to a contact. Two shapes (mirrors the Leads "add a tag" UX):
//   { tagId }              → attach an existing owner tag by id
//   { tagName, tagColor? } → create-or-get a free-form user tag by name, then attach
// Returns the resolved tag ({ id, name, color }) so the UI can render the real chip.
router.post('/contacts/:id/tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { tagId, tagName, tagColor } = req.body || {};
  const trimmedName = typeof tagName === 'string' ? tagName.trim() : '';
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  if (!tagId && !trimmedName) return res.status(400).json({ message: 'A tagId or tagName is required.' });
  if (tagId && !CONTACT_ROUTE_UUID_RE.test(tagId)) return res.status(400).json({ message: 'A valid tagId is required.' });
  // Creating a new tag by name? Block reserved category/lifecycle words — those are derived states, not tags.
  if (!tagId && isReservedTagName(trimmedName)) {
    return res.status(400).json({ message: `“${trimmedName}” is a category, not a tag — pick a different name.` });
  }
  try {
    const owns = await query('SELECT owner_user_id FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    // Resolve the tag: an existing owner tag by id, or create-or-get a user tag by name.
    let tag;
    if (tagId) {
      const t = await query('SELECT id, name, color FROM lead_tags WHERE id = $1 AND owner_user_id = $2', [tagId, targetUserId]);
      if (!t.rows.length) return res.status(400).json({ message: 'Tag not found for this owner.' });
      tag = t.rows[0];
    } else {
      const created = await query(
        `INSERT INTO lead_tags (owner_user_id, name, color)
         VALUES ($1, $2, $3)
         ON CONFLICT (owner_user_id, name) DO UPDATE SET color = COALESCE(EXCLUDED.color, lead_tags.color)
         RETURNING id, name, color`,
        [targetUserId, trimmedName, tagColor || '#6366f1']
      );
      tag = created.rows[0];
    }
    await applyContactTags({ contactId: req.params.id, ownerUserId: targetUserId, tagIds: [tag.id], source: 'user', createdBy: req.user.id });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_tag_add', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, tagId: tag.id } });
    res.json({ ok: true, tag });
  } catch (err) { console.error('[contacts:tags:add]', { code: err?.code }); res.status(500).json({ message: 'Failed to add tag.' }); }
});

router.delete('/contacts/:id/tags/:tagId', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id) || !CONTACT_ROUTE_UUID_RE.test(req.params.tagId)) {
    return res.status(400).json({ message: 'Invalid contact or tag id.' });
  }
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    await removeContactTag({ contactId: req.params.id, tagId: req.params.tagId, ownerUserId: targetUserId });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_tag_remove', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, tagId: req.params.tagId } });
    res.json({ ok: true });
  } catch (err) { console.error('[contacts:tags:del]', { code: err?.code }); res.status(500).json({ message: 'Failed to remove tag.' }); }
});

// Services (client-accessible, owner-scoped). contact_services is an editable ledger of the
// services a contact is interested in. Mirrors the /contacts/:id/tags pattern. Adds use
// source='manual'; removes are soft (redacted_at) so history/auto-writers survive.

// POST /contacts/:id/services { service_id } — attach a catalog service to a contact.
// Idempotent: returns the existing active row if present; un-removes a redacted one;
// otherwise inserts a fresh manual row snapshotting the catalog name. Returns the row.
router.post('/contacts/:id/services', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { service_id: serviceId } = req.body || {};
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  if (!serviceId || !CONTACT_ROUTE_UUID_RE.test(serviceId)) return res.status(400).json({ message: 'A valid service_id is required.' });
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    // The service must exist in this owner's catalog. Snapshot its name at attach time.
    const svc = await query('SELECT name FROM services WHERE id = $1 AND user_id = $2', [serviceId, targetUserId]);
    if (!svc.rows.length) return res.status(404).json({ message: 'Service not found for this owner.' });
    const serviceName = svc.rows[0].name;
    const cols = 'id, service_id, service_name, source, source_ref_id, created_at';
    // Already linked (active)? Return it unchanged — no duplicate row.
    const existing = await query(
      `SELECT ${cols} FROM contact_services
        WHERE contact_id = $1 AND service_id = $2 AND owner_user_id = $3 AND redacted_at IS NULL
        LIMIT 1`,
      [req.params.id, serviceId, targetUserId]
    );
    if (existing.rows.length) return res.json({ ok: true, service: existing.rows[0] });
    // Previously removed? Un-remove (clear redacted_at) instead of inserting a duplicate.
    const revived = await query(
      `UPDATE contact_services SET redacted_at = NULL
        WHERE contact_id = $1 AND service_id = $2 AND owner_user_id = $3 AND redacted_at IS NOT NULL
        RETURNING ${cols}`,
      [req.params.id, serviceId, targetUserId]
    );
    if (revived.rows.length) {
      await logSecurityEvent({ userId: req.user.id, eventType: 'contact_service_add', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, serviceId, revived: true } });
      return res.json({ ok: true, service: revived.rows[0] });
    }
    const inserted = await query(
      `INSERT INTO contact_services (contact_id, owner_user_id, service_id, service_name, source)
       VALUES ($1, $2, $3, $4, 'manual')
       RETURNING ${cols}`,
      [req.params.id, targetUserId, serviceId, serviceName]
    );
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_service_add', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, serviceId } });
    res.json({ ok: true, service: inserted.rows[0] });
  } catch (err) { console.error('[contacts:services:add]', { code: err?.code }); res.status(500).json({ message: 'Failed to add service.' }); }
});

// DELETE /contacts/:id/services/:serviceId — soft-remove (redacted_at). Owner-scoped, idempotent.
router.delete('/contacts/:id/services/:serviceId', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id) || !CONTACT_ROUTE_UUID_RE.test(req.params.serviceId)) {
    return res.status(400).json({ message: 'Invalid contact or service id.' });
  }
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    await query(
      `UPDATE contact_services SET redacted_at = NOW()
        WHERE contact_id = $1 AND service_id = $2 AND owner_user_id = $3 AND redacted_at IS NULL`,
      [req.params.id, req.params.serviceId, targetUserId]
    );
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_service_remove', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, serviceId: req.params.serviceId } });
    res.json({ ok: true });
  } catch (err) { console.error('[contacts:services:del]', { code: err?.code }); res.status(500).json({ message: 'Failed to remove service.' }); }
});

// Notes (client-accessible, owner-scoped). Contact-level notes spine — lead_notes.contact_id.
// Mirrors the /contacts/:id/tags + /contacts/:id/services pattern (UUID validation, owner-scope,
// audit logging). Every note for the contact is returned regardless of which activity created it,
// so the same set shows on every surface. Author fields mirror GET /leads/:callId/notes so the UI
// can render "Theresa · date" identically.

// GET /contacts/:id/notes — all of the contact's notes, owner-scoped, newest first.
router.get('/contacts/:id/notes', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    // Pre-migration window: contact_id may not exist yet — return an empty list (notes will
    // appear once the migration lands) instead of 500-ing on undefined_column.
    await ensureLeadNotesContactCol();
    if (!leadNotesContactColReady) return res.json({ notes: [] });
    const result = await query(
      `SELECT ln.id, ln.body, ln.note_type, ln.author_id, ln.created_at, ln.call_id,
              u.first_name, u.last_name, u.email AS author_email
         FROM lead_notes ln
         LEFT JOIN users u ON u.id = ln.author_id
        WHERE ln.contact_id = $1 AND ln.owner_user_id = $2
        ORDER BY ln.created_at DESC`,
      [req.params.id, targetUserId]
    );
    const notes = result.rows.map((row) => ({
      ...row,
      author_name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.author_email || 'Unknown'
    }));
    // Audit the PHI read (note bodies) to the immutable trail. IDs + count only — no note bodies.
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_notes_read', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, ownerUserId: targetUserId, count: notes.length } });
    res.json({ notes });
  } catch (err) { console.error('[contacts:notes:get]', { code: err?.code }); res.status(500).json({ message: 'Failed to load notes.' }); }
});

// POST /contacts/:id/notes { body } — add a contact-level note (call_id '' since not activity-scoped).
router.post('/contacts/:id/notes', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const authorId = req.user.id;
  const { body } = req.body || {};
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ message: 'A non-empty note body is required.' });
  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND owner_user_id = $2', [req.params.id, targetUserId]);
    if (!owns.rows.length) return res.status(404).json({ message: 'Contact not found.' });
    // Pre-migration window: can't write a contact_id-scoped note yet — ask the client to retry.
    await ensureLeadNotesContactCol();
    if (!leadNotesContactColReady) return res.status(503).json({ message: 'Notes are initializing, try again shortly.' });
    const result = await query(
      `INSERT INTO lead_notes (owner_user_id, call_id, author_id, note_type, body, metadata, contact_id)
       VALUES ($1, '', $2, 'note', $3, '{}'::jsonb, $4)
       RETURNING id, body, note_type, author_id, created_at, call_id`,
      [targetUserId, authorId, body.trim(), req.params.id]
    );
    const userRes = await query('SELECT first_name, last_name, email FROM users WHERE id = $1', [authorId]);
    const user = userRes.rows[0] || {};
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_note_add', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, noteId: result.rows[0].id } });
    res.json({
      note: {
        ...result.rows[0],
        first_name: user.first_name,
        last_name: user.last_name,
        author_email: user.email,
        author_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unknown'
      }
    });
  } catch (err) { console.error('[contacts:notes:add]', { code: err?.code }); res.status(500).json({ message: 'Failed to add note.' }); }
});

// DELETE /contacts/:id/notes/:noteId — remove a contact note. Owner + contact + note scoped.
router.delete('/contacts/:id/notes/:noteId', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id) || !CONTACT_ROUTE_UUID_RE.test(req.params.noteId)) {
    return res.status(400).json({ message: 'Invalid contact or note id.' });
  }
  try {
    // Pre-migration window: contact_id doesn't exist yet, so no contact-scoped note can exist.
    await ensureLeadNotesContactCol();
    if (!leadNotesContactColReady) return res.status(503).json({ message: 'Notes are initializing, try again shortly.' });
    const result = await query(
      'DELETE FROM lead_notes WHERE id = $1 AND contact_id = $2 AND owner_user_id = $3 RETURNING id',
      [req.params.noteId, req.params.id, targetUserId]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Note not found.' });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_note_remove', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, noteId: req.params.noteId } });
    res.json({ ok: true });
  } catch (err) { console.error('[contacts:notes:del]', { code: err?.code }); res.status(500).json({ message: 'Failed to remove note.' }); }
});

// Consent (client-accessible, owner-scoped).
router.patch('/contacts/:id/consent', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { sms_opted_out, email_opted_out } = req.body || {};
  if (!CONTACT_ROUTE_UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid contact id.' });
  if (typeof sms_opted_out !== 'boolean' && typeof email_opted_out !== 'boolean') {
    return res.status(400).json({ message: 'Provide sms_opted_out and/or email_opted_out (boolean).' });
  }
  try {
    const sets = []; const params = [req.params.id, targetUserId];
    if (typeof sms_opted_out === 'boolean') { params.push(sms_opted_out); sets.push(`sms_opted_out = $${params.length}`); }
    if (typeof email_opted_out === 'boolean') {
      params.push(email_opted_out);
      sets.push(`email_opted_out = $${params.length}`);
      // Preserve the original unsubscribe time on repeated opt-outs; only set it on the false→true transition.
      sets.push(`email_unsubscribed_at = CASE WHEN $${params.length} THEN COALESCE(email_unsubscribed_at, NOW()) ELSE NULL END`);
    }
    const { rowCount } = await query(`UPDATE contacts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND owner_user_id = $2`, params);
    if (!rowCount) return res.status(404).json({ message: 'Contact not found.' });
    await logSecurityEvent({ userId: req.user.id, eventType: 'contact_consent_update', eventCategory: 'contacts', success: true, details: { contactId: req.params.id, sms_opted_out, email_opted_out } });
    res.json({ ok: true });
  } catch (err) { console.error('[contacts:consent]', { code: err?.code }); res.status(500).json({ message: 'Failed to update consent.' }); }
});


export default router;
