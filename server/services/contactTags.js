// Contact Entity — contact-level tagging (Phase 6).
//
// Tags live on the PERSON (contact_tags), reusing the lead_tags catalog. `source`
// distinguishes user-applied tags from system tags rolled up from a contact's activity.
// This is the home for "everyone with tag X" segmentation + bulk operations.
//
// Helpers take a query executor so they can run on the pool, inside a transaction, or
// be called from the ingest pipeline to roll system tags up onto the contact.

import { query as poolQuery } from '../db.js';

/**
 * Upsert one or more lead_tags onto a contact. Idempotent (ON CONFLICT DO NOTHING).
 * @param {object} args
 * @param {string} args.contactId
 * @param {string} args.ownerUserId
 * @param {string[]} args.tagIds  lead_tags.id values
 * @param {'user'|'system'} [args.source]
 * @param {string|null} [args.createdBy]
 * @param {(t:string,p:any[])=>Promise<{rows:any[]}>} [exec]
 */
export async function applyContactTags({ contactId, ownerUserId, tagIds = [], source = 'user', createdBy = null }, exec = poolQuery) {
  if (!contactId || !ownerUserId || !tagIds.length) return;
  for (const tagId of tagIds) {
    if (!tagId) continue;
    await exec(
      `INSERT INTO contact_tags (contact_id, owner_user_id, tag_id, source, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [contactId, ownerUserId, tagId, source === 'system' ? 'system' : 'user', createdBy]
    );
  }
}

export async function removeContactTag({ contactId, tagId, ownerUserId }, exec = poolQuery) {
  // ownerUserId is mandatory: the DELETE is always owner-scoped so a tag can never be
  // removed across tenants, even if a future caller passes an attacker-supplied contactId.
  if (!contactId || !tagId || !ownerUserId) {
    throw new Error('removeContactTag requires contactId, tagId, and ownerUserId');
  }
  await exec('DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2 AND owner_user_id = $3', [contactId, tagId, ownerUserId]);
}

/**
 * Roll a contact's system tags (from its activity's meta.system_tags) up onto the
 * contact, mapped to the owner's lead_tags catalog by system_key. Safe to call after
 * resolving contact_id at ingest. No-op when nothing maps.
 */
export async function rollupSystemTagsForContact({ contactId, ownerUserId }, exec = poolQuery) {
  if (!contactId || !ownerUserId) return;
  // Distinct system-tag keys seen across this contact's activity.
  const { rows: keyRows } = await exec(
    `SELECT DISTINCT t->>'key' AS key
       FROM call_logs cl, jsonb_array_elements(COALESCE(cl.meta->'system_tags', '[]'::jsonb)) t
      WHERE cl.contact_id = $1 AND cl.owner_user_id = $2 AND (t->>'key') IS NOT NULL`,
    [contactId, ownerUserId]
  );
  const keys = keyRows.map((r) => r.key).filter(Boolean);
  if (!keys.length) return;
  // Map keys → this owner's lead_tags (system_key), then upsert.
  const { rows: tagRows } = await exec(
    `SELECT id FROM lead_tags WHERE owner_user_id = $1 AND system_key = ANY($2) AND disabled_at IS NULL`,
    [ownerUserId, keys]
  );
  await applyContactTags({ contactId, ownerUserId, tagIds: tagRows.map((r) => r.id), source: 'system' }, exec);
}
