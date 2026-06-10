import { query } from '../../db.js';
import { listClientAccountsForUser } from '../clientAccounts.js';
import { clientLabelSelect, clientLabelJoins } from '../clientLabel.js';

const STAFF_ROLES = new Set(['superadmin', 'admin', 'team']);

function normalizeAllowedIds(allowedUserIds = []) {
  return [...new Set((allowedUserIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildCacheKey(allowedUserIds = null) {
  if (!allowedUserIds) return 'global';
  return `scoped:${[...allowedUserIds].sort().join(',')}`;
}

export function isAnalyticsStaffUser(user) {
  const role = user?.effective_role || user?.role;
  return STAFF_ROLES.has(role);
}

export async function listAnalyticsSelectionOptions({ allowedUserIds = null } = {}) {
  const scopedIds = allowedUserIds ? normalizeAllowedIds(allowedUserIds) : null;
  if (scopedIds && scopedIds.length === 0) {
    return { clients: [], groups: [] };
  }

  const clientParams = [];
  let clientWhere = `
    WHERE (
      tc.user_id IS NOT NULL
      OR cp.ctm_account_number IS NOT NULL
    )
  `;

  if (scopedIds) {
    clientParams.push(scopedIds);
    clientWhere += ` AND u.id = ANY($1)`;
  }

  const { rows: clients } = await query(
    `SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
            cp.client_identifier_value,
            ba.business_name,
            ${clientLabelSelect()},
            cp.client_group_id,
            COALESCE(tc.client_type, cp.client_type) AS client_type,
            tc.ga4_property_id IS NOT NULL AS has_ga4,
            tc.meta_ad_account_id IS NOT NULL AS has_meta,
            tc.google_ads_customer_id IS NOT NULL AS has_google_ads,
            cp.ctm_account_number IS NOT NULL AS has_ctm
     FROM users u
     ${clientLabelJoins()}
     LEFT JOIN tracking_configs tc ON tc.user_id = u.id
     ${clientWhere}
     ORDER BY client_label`,
    clientParams
  );

  if (!scopedIds) {
    const { rows: groups } = await query(
      `SELECT cg.id, cg.name, cg.color, cg.icon,
              (SELECT COUNT(*) FROM client_profiles WHERE client_group_id = cg.id)::int AS member_count
       FROM client_groups cg
       ORDER BY cg.name`
    );
    return { clients, groups };
  }

  const groupIds = [...new Set(clients.map((client) => client.client_group_id).filter(Boolean))];
  if (groupIds.length === 0) {
    return { clients, groups: [] };
  }

  const { rows: groupRows } = await query(
    `SELECT id, name, color, icon
     FROM client_groups
     WHERE id = ANY($1)
     ORDER BY name`,
    [groupIds]
  );

  const scopedMemberCountByGroup = clients.reduce((map, client) => {
    if (!client.client_group_id) return map;
    map.set(client.client_group_id, (map.get(client.client_group_id) || 0) + 1);
    return map;
  }, new Map());

  const groups = groupRows.map((group) => ({
    ...group,
    member_count: scopedMemberCountByGroup.get(group.id) || 0
  }));

  return { clients, groups };
}

export async function resolveAnalyticsAccessScope(req, options = {}) {
  const includeSelectionOptions = options.includeSelectionOptions === true;
  const principalUserId = req.actingClient?.id || (!isAnalyticsStaffUser(req.user) ? req.user.id : null);

  if (!principalUserId) {
    const selectionOptions = includeSelectionOptions ? await listAnalyticsSelectionOptions() : null;
    return {
      scope: 'admin',
      isRestricted: false,
      principalUserId: null,
      accounts: [],
      allowedUserIds: null,
      allowedUserIdSet: null,
      allowedGroupIds: null,
      allowedGroupIdSet: null,
      clients: selectionOptions?.clients || null,
      groups: selectionOptions?.groups || null,
      cacheKey: buildCacheKey(null)
    };
  }

  const accounts = await listClientAccountsForUser(principalUserId, { userRole: 'client' });
  const allowedUserIds = normalizeAllowedIds(accounts.map((account) => account.clientOwnerId));
  const selectionOptions = includeSelectionOptions ? await listAnalyticsSelectionOptions({ allowedUserIds }) : null;

  return {
    scope: 'portal',
    isRestricted: true,
    principalUserId,
    accounts,
    allowedUserIds,
    allowedUserIdSet: new Set(allowedUserIds),
    allowedGroupIds: selectionOptions?.groups?.map((group) => group.id) || null,
    allowedGroupIdSet: selectionOptions?.groups ? new Set(selectionOptions.groups.map((group) => group.id)) : null,
    clients: selectionOptions?.clients || null,
    groups: selectionOptions?.groups || null,
    cacheKey: buildCacheKey(allowedUserIds)
  };
}

export function canAccessAnalyticsUser(accessScope, userId) {
  if (!accessScope?.isRestricted) return true;
  return accessScope.allowedUserIdSet?.has(String(userId)) || false;
}
