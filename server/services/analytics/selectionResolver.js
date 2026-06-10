import { query } from '../../db.js';
import { clientLabelSelect, clientLabelJoins } from '../clientLabel.js';

/**
 * Error thrown when an analytics selection fails validation. Callers can
 * check `err instanceof SelectionError` (or `err.statusCode === 400`) to
 * surface the message to the client as a 400 Bad Request instead of a 500.
 */
export class SelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SelectionError';
    this.statusCode = 400;
  }
}

export class AnalyticsAccessError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'AnalyticsAccessError';
    this.statusCode = 403;
  }
}

function normalizeAllowedUserIds(options = {}) {
  if (options.accessScope?.allowedUserIds) return options.accessScope.allowedUserIds;
  if (options.allowedUserIds) return options.allowedUserIds;
  return null;
}

/**
 * Resolve an analytics selection into a concrete list of user IDs with
 * platform-coverage metadata.
 *
 * @param {object} selection
 * @param {'single'|'group'|'custom'} selection.mode
 * @param {string}   [selection.userId]          — required for mode=single
 * @param {string}   [selection.groupId]         — required for mode=group
 * @param {string[]} [selection.includedUserIds]  — required for mode=custom
 * @param {string[]} [selection.excludedUserIds]  — optional for mode=group
 * @param {object} [options]
 * @returns {Promise<{ userIds: string[], label: string, clients: object[], coverage: object }>}
 */
export async function resolveAnalyticsSelection(selection, options = {}) {
  const { mode } = selection;
  const allowedUserIds = normalizeAllowedUserIds(options);
  const allowedUserIdSet = allowedUserIds ? new Set(allowedUserIds.map((value) => String(value))) : null;
  let userIds = [];
  let label = '';
  let totalGroupMembers = 0;

  switch (mode) {
    // ── Single client ──────────────────────────────────────────────
    case 'single': {
      if (!selection.userId) throw new SelectionError('userId is required for single mode');
      if (allowedUserIdSet && !allowedUserIdSet.has(String(selection.userId))) {
        throw new AnalyticsAccessError('You do not have access to this client');
      }
      userIds = [selection.userId];
      const nameRes = await query(
        `SELECT ${clientLabelSelect()}
         FROM users u
         ${clientLabelJoins()}
         WHERE u.id = $1`,
        [selection.userId]
      );
      label = nameRes.rows[0]?.client_label || 'Unknown';
      break;
    }

    // ── Group ──────────────────────────────────────────────────────
    case 'group': {
      if (!selection.groupId) throw new SelectionError('groupId is required for group mode');

      // Fetch group name
      const groupRes = await query(
        'SELECT name FROM client_groups WHERE id = $1',
        [selection.groupId]
      );
      const groupName = groupRes.rows[0]?.name || 'Unknown Group';

      // Fetch all members via client_profiles — but only those with tracking
      // credentials (GA4/Ads/Meta via tracking_configs OR CTM via client_profiles).
      // This mirrors the frontend's selection-options filter so the UI total
      // matches the server's working set.
      const membersRes = await query(
        `SELECT cp.user_id
         FROM client_profiles cp
         LEFT JOIN tracking_configs tc ON tc.user_id = cp.user_id
         WHERE cp.client_group_id = $1
           AND (tc.user_id IS NOT NULL OR cp.ctm_account_number IS NOT NULL)`,
        [selection.groupId]
      );
      const allMemberIds = membersRes.rows.map((r) => r.user_id);
      const scopedMemberIds = allowedUserIdSet ? allMemberIds.filter((id) => allowedUserIdSet.has(String(id))) : allMemberIds;
      if (allowedUserIdSet && scopedMemberIds.length === 0) {
        throw new AnalyticsAccessError('You do not have access to this group');
      }
      totalGroupMembers = scopedMemberIds.length;

      if (scopedMemberIds.length === 0) {
        throw new SelectionError('Group has no tracked members');
      }

      // Subtract excluded user IDs
      const excluded = new Set(selection.excludedUserIds || []);
      userIds = scopedMemberIds.filter((id) => !excluded.has(id));

      label =
        excluded.size > 0
          ? `${groupName} (${userIds.length} of ${totalGroupMembers})`
          : `${groupName} (${userIds.length})`;
      break;
    }

    // ── Custom selection ───────────────────────────────────────────
    case 'custom': {
      const ids = selection.includedUserIds || [];
      if (ids.length === 0) {
        throw new SelectionError('Custom selection requires at least one client');
      }
      if (allowedUserIdSet) {
        const outOfScope = ids.find((id) => !allowedUserIdSet.has(String(id)));
        if (outOfScope) {
          throw new AnalyticsAccessError('You do not have access to one or more selected clients');
        }
      }
      userIds = [...ids];
      label = `Custom (${userIds.length} client${userIds.length === 1 ? '' : 's'})`;
      break;
    }

    default:
      throw new SelectionError(`Unknown selection mode: ${mode}`);
  }

  // ── Batch-query platform coverage ────────────────────────────────
  if (userIds.length === 0) {
    return { userIds: [], label, clients: [], coverage: { total: 0, withGA4: 0, withMeta: 0, withGoogleAds: 0, withCTM: 0 } };
  }

  const { rows: clients } = await query(
    `SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
            cp.client_identifier_value,
            ba.business_name,
            ${clientLabelSelect()},
            COALESCE(tc.client_type, cp.client_type) AS client_type,
            tc.ga4_property_id IS NOT NULL AS has_ga4,
            tc.meta_ad_account_id IS NOT NULL AS has_meta,
            tc.google_ads_customer_id IS NOT NULL AS has_google_ads,
            cp.ctm_account_number IS NOT NULL AS has_ctm
     FROM users u
     ${clientLabelJoins()}
     LEFT JOIN tracking_configs tc ON tc.user_id = u.id
     WHERE u.id = ANY($1)
     ORDER BY client_label`,
    [userIds]
  );

  const coverage = {
    total: clients.length,
    withGA4: clients.filter((c) => c.has_ga4).length,
    withMeta: clients.filter((c) => c.has_meta).length,
    withGoogleAds: clients.filter((c) => c.has_google_ads).length,
    withCTM: clients.filter((c) => c.has_ctm).length
  };

  return { userIds, label, clients, coverage };
}
