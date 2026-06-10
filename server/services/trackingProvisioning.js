import { google } from 'googleapis';
import { query } from '../db.js';
import { loadTemplate, substituteValues, buildValuesMap, filterConditionalTags, isManagedTemplateEntity } from './trackingTemplates.js';
import { getConversionActionDetails } from './analytics/googleAdsAdapter.js';

const tagmanager = google.tagmanager('v2');

/**
 * Get authenticated GTM API client using the default service account.
 * On Cloud Run, this uses the attached service account automatically.
 * Locally, it uses GOOGLE_APPLICATION_CREDENTIALS.
 */
async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/tagmanager.readonly',
      'https://www.googleapis.com/auth/tagmanager.edit.containers',
      'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
      'https://www.googleapis.com/auth/tagmanager.publish',
      'https://www.googleapis.com/auth/tagmanager.delete.containers',
    ],
  });
  return auth.getClient();
}

const GTM_ACCOUNT_ID = process.env.GTM_ACCOUNT_ID || '6246584794';

/**
 * List all GTM containers in the account.
 * @returns {Array<{containerId: string, publicId: string, name: string}>}
 */
export async function listContainers() {
  const authClient = await getAuthClient();
  const gtm = google.tagmanager({ version: 'v2', auth: authClient });
  const res = await gtm.accounts.containers.list({
    parent: `accounts/${GTM_ACCOUNT_ID}`
  });
  return (res.data.container || []).map((c) => ({
    containerId: c.containerId,
    publicId: c.publicId,
    name: c.name
  }));
}

// Team members who must have admin access on every GTM container
const GTM_REQUIRED_ADMINS = [
  'jmartin@anchorcorps.com',
  'bbasham@anchorcorps.com',
  'mshover@anchorcorps.com',
  'zcundiff@anchorcorps.com',
];

/**
 * Ensure required team members have admin access on a GTM container.
 * Checks existing permissions and adds missing users.
 */
async function ensureContainerAdmins(containerPath) {
  const authClient = await getAuthClient();
  const gtm = google.tagmanager({ version: 'v2', auth: authClient });
  const containerId = containerPath.split('/containers/')[1];

  let permissions = [];
  try {
    const permRes = await gtm.accounts.user_permissions.list({ parent: `accounts/${GTM_ACCOUNT_ID}` });
    permissions = permRes.data.userPermission || [];
  } catch {
    permissions = [];
  }

  const permissionsByEmail = new Map(
    permissions
      .filter((permission) => permission.emailAddress)
      .map((permission) => [permission.emailAddress, permission])
  );

  for (const email of GTM_REQUIRED_ADMINS) {
    try {
      const userPerm = permissionsByEmail.get(email);

      if (userPerm) {
        // Update existing permission to ensure container access
        const containerAccess = userPerm.containerAccess || [];
        const hasContainer = containerAccess.some(
          (ca) => ca.containerId === containerId
        );
        if (!hasContainer) {
          containerAccess.push({
            containerId,
            permission: 'publish',
          });
          const updateRes = await gtm.accounts.user_permissions.update({
            path: userPerm.path,
            requestBody: {
              ...userPerm,
              containerAccess,
            },
          });
          permissionsByEmail.set(email, updateRes.data);
        }
      } else {
        // Create new permission
        const createRes = await gtm.accounts.user_permissions.create({
          parent: `accounts/${GTM_ACCOUNT_ID}`,
          requestBody: {
            emailAddress: email,
            accountAccess: { permission: 'admin' },
            containerAccess: [{
              containerId,
              permission: 'publish',
            }],
          },
        });
        permissionsByEmail.set(email, createRes.data);
      }
    } catch (err) {
      console.warn(`[tracking:gtm] Failed to add ${email} to container: ${err.message?.slice(0, 80)}`);
    }
  }
}

function isQuotaExceededError(err) {
  const message = `${err?.message || ''} ${err?.errors?.map((item) => item.message).join(' ') || ''}`;
  return /quota.*exceeded|queries per minute per user/i.test(message);
}

/**
 * Create a new GTM web container.
 * @param {string} name - Display name for the container
 * @returns {{containerId: string, publicId: string, name: string}}
 */
export async function createContainer(name) {
  const authClient = await getAuthClient();
  const gtm = google.tagmanager({ version: 'v2', auth: authClient });
  const res = await gtm.accounts.containers.create({
    parent: `accounts/${GTM_ACCOUNT_ID}`,
    requestBody: {
      name,
      usageContext: ['web']
    }
  });

  const containerPath = `accounts/${GTM_ACCOUNT_ID}/containers/${res.data.containerId}`;

  // Ensure team members have admin access
  await ensureContainerAdmins(containerPath);

  return {
    containerId: res.data.containerId,
    publicId: res.data.publicId,
    name: res.data.name
  };
}

/**
 * Delete a GTM container.
 * @param {string} containerId - GTM container ID
 */
export async function deleteContainer(containerId) {
  const authClient = await getAuthClient();
  const gtm = google.tagmanager({ version: 'v2', auth: authClient });
  await gtm.accounts.containers.delete({
    path: `accounts/${GTM_ACCOUNT_ID}/containers/${containerId}`,
  });
}

/**
 * Update a provisioning job's step status.
 */
async function updateJobStep(jobId, stepName, status, message = '') {
  const { rows } = await query(
    `SELECT steps FROM tracking_provisioning_jobs WHERE id = $1`,
    [jobId]
  );
  const steps = rows[0]?.steps || [];
  steps.push({ step: stepName, status, message, timestamp: new Date().toISOString() });
  await query(
    `UPDATE tracking_provisioning_jobs SET steps = $1 WHERE id = $2`,
    [JSON.stringify(steps), jobId]
  );
}

async function resolvePrimaryWorkspace(containerPath) {
  const wsListRes = await tagmanager.accounts.containers.workspaces.list({ parent: containerPath });
  const workspaces = wsListRes.data.workspace || [];

  const primary =
    workspaces.find((ws) => ws.name === 'Default Workspace') ||
    workspaces.find((ws) => ws.workspaceId === '1') ||
    workspaces.find((ws) => ws.workspaceId === '2') ||
    workspaces[0] ||
    null;

  if (!primary) {
    throw new Error('No GTM workspace found for this container');
  }

  const oldProvisioningWorkspaces = workspaces.filter(
    (ws) => ws.name?.startsWith('Anchor Provisioning') && ws.workspaceId !== primary.workspaceId
  );

  return { primary, oldProvisioningWorkspaces };
}

function getLeadSubmittedMapping(conversionMappings = {}) {
  return conversionMappings?.lead_submitted || conversionMappings?.form_submitted || null;
}

async function buildEffectiveProvisioningConfig(config) {
  const effective = { ...config };
  const mappings = { ...(config.conversion_mappings || {}) };

  if (effective.google_ads_customer_id) {
    for (const [eventKey, mapping] of Object.entries(mappings)) {
      if (!mapping?.conversion_action_id) continue;
      if (mapping.conversionId && mapping.conversionLabel) continue;
      const details = await getConversionActionDetails(effective.google_ads_customer_id, mapping.conversion_action_id).catch(() => null);
      if (details?.conversionId && details?.conversionLabel) {
        mappings[eventKey] = {
          ...mapping,
          conversionId: details.conversionId,
          conversionLabel: details.conversionLabel,
        };
      }
    }
  }

  effective.conversion_mappings = mappings;
  const enrichedLeadMapping = getLeadSubmittedMapping(mappings);

  if (!effective.google_ads_conversion_id && enrichedLeadMapping?.conversionId) {
    effective.google_ads_conversion_id = enrichedLeadMapping.conversionId;
  }
  if (!effective.google_ads_conversion_label && enrichedLeadMapping?.conversionLabel) {
    effective.google_ads_conversion_label = enrichedLeadMapping.conversionLabel;
  }

  if (effective.client_type !== 'medical' && effective.meta_pixel_id) {
    effective.browser_meta_pixel_enabled = true;
  }

  return effective;
}

/**
 * Run the full provisioning sequence for a tracking config.
 */
export async function provision(configId, triggeredBy) {
  const { rows: jobRows } = await query(
    `INSERT INTO tracking_provisioning_jobs (tracking_config_id, triggered_by, status)
     VALUES ($1, $2, 'running') RETURNING id`,
    [configId, triggeredBy]
  );
  const jobId = jobRows[0].id;

  try {
    const { rows: configRows } = await query(
      `SELECT * FROM tracking_configs WHERE id = $1`,
      [configId]
    );
    if (configRows.length === 0) throw new Error('Config not found');
    let config = configRows[0];

    // Step 1: Validate
    if (!config.gtm_account_id || !config.gtm_container_id) {
      throw new Error('GTM account ID and container ID are required');
    }
    await updateJobStep(jobId, 'validate', 'completed', 'Config validated');

    const authClient = await getAuthClient();
    google.options({ auth: authClient });

    const effectiveConfig = await buildEffectiveProvisioningConfig(config);
    if (
      JSON.stringify(effectiveConfig.conversion_mappings || {}) !== JSON.stringify(config.conversion_mappings || {}) ||
      effectiveConfig.google_ads_conversion_id !== config.google_ads_conversion_id ||
      effectiveConfig.google_ads_conversion_label !== config.google_ads_conversion_label ||
      effectiveConfig.browser_meta_pixel_enabled !== config.browser_meta_pixel_enabled
    ) {
      const { rows: refreshedRows } = await query(
        `UPDATE tracking_configs SET
           conversion_mappings = $1,
           google_ads_conversion_id = $2,
           google_ads_conversion_label = $3,
           browser_meta_pixel_enabled = $4,
           updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [
          JSON.stringify(effectiveConfig.conversion_mappings || {}),
          effectiveConfig.google_ads_conversion_id || null,
          effectiveConfig.google_ads_conversion_label || null,
          !!effectiveConfig.browser_meta_pixel_enabled,
          configId,
        ]
      );
      config = refreshedRows[0] || effectiveConfig;
    } else {
      config = effectiveConfig;
    }

    const containerPath = `accounts/${config.gtm_account_id}/containers/${config.gtm_container_id}`;

    // Container admin management happens on createContainer(). Avoid re-checking it during
    // every provisioning run because GTM user_permissions queries are quota-expensive.

    // Step 2: Use the primary GTM workspace so the created entities are visible
    // in the normal Tag Manager UI. Clean up old temporary provisioning workspaces.
    let workspace;
    try {
      const { primary, oldProvisioningWorkspaces } = await resolvePrimaryWorkspace(containerPath);
      workspace = primary;
      for (const old of oldProvisioningWorkspaces) {
        await tagmanager.accounts.containers.workspaces.delete({ path: old.path }).catch(() => {});
      }
      await updateJobStep(jobId, 'create_workspace', 'completed', `Workspace: ${workspace.name || workspace.workspaceId}`);
    } catch (err) {
      await updateJobStep(jobId, 'create_workspace', 'failed', err.message);
      throw err;
    }

    const workspacePath = `${containerPath}/workspaces/${workspace.workspaceId}`;

    // Load and prepare template
    const template = await loadTemplate('standard_web_v1');
    const values = buildValuesMap(config);

    // Step 2b: Clean up only Anchor-managed entities in the workspace so re-provisioning
    // stays visible in the main GTM UI without deleting user-managed tags.
    try {
      const [existingVars, existingTriggers, existingTags] = await Promise.all([
        tagmanager.accounts.containers.workspaces.variables.list({ parent: workspacePath }).then(r => r.data.variable || []).catch(() => []),
        tagmanager.accounts.containers.workspaces.triggers.list({ parent: workspacePath }).then(r => r.data.trigger || []).catch(() => []),
        tagmanager.accounts.containers.workspaces.tags.list({ parent: workspacePath }).then(r => r.data.tag || []).catch(() => []),
      ]);
      const managedTags = existingTags.filter((tag) => isManagedTemplateEntity('tags', tag.name));
      const managedTriggers = existingTriggers.filter((trigger) => isManagedTemplateEntity('triggers', trigger.name));
      const managedVars = existingVars.filter((variable) => isManagedTemplateEntity('variables', variable.name));

      for (const tag of managedTags) {
        if (tag.path) await tagmanager.accounts.containers.workspaces.tags.delete({ path: tag.path }).catch(() => {});
      }
      for (const trigger of managedTriggers) {
        if (trigger.path) {
          await tagmanager.accounts.containers.workspaces.triggers.delete({ path: trigger.path }).catch(() => {});
        }
      }
      for (const v of managedVars) {
        if (v.path) await tagmanager.accounts.containers.workspaces.variables.delete({ path: v.path }).catch(() => {});
      }
      await updateJobStep(jobId, 'cleanup', 'completed', `Cleaned ${managedTags.length} tags, ${managedTriggers.length} triggers, ${managedVars.length} variables`);
    } catch (err) {
      await updateJobStep(jobId, 'cleanup', 'completed', 'Cleanup skipped: ' + err.message);
    }

    // Step 3: Apply variables (skip any with empty values)
    try {
      const variables = substituteValues(template.variables, values).filter((v) => {
        const val = v.parameter?.find((p) => p.key === 'value')?.value;
        return val && val.trim() !== '';
      });
      for (const variable of variables) {
        await tagmanager.accounts.containers.workspaces.variables.create({
          parent: workspacePath,
          requestBody: {
            name: variable.name,
            type: variable.type,
            parameter: variable.parameter,
          },
        });
      }
      await updateJobStep(jobId, 'apply_variables', 'completed', `${variables.length} variables created`);
    } catch (err) {
      await updateJobStep(jobId, 'apply_variables', 'failed', err.message);
      throw err;
    }

    // Step 4: Apply triggers
    const triggerIdMap = {};
    try {
      const triggers = substituteValues(template.triggers, values);
      for (const trigger of triggers) {
        const body = { name: trigger.name, type: trigger.type };
        if (trigger.parameter) body.parameter = trigger.parameter;
        if (trigger.autoEventFilter) body.autoEventFilter = trigger.autoEventFilter;
        if (trigger.filter) body.autoEventFilter = trigger.filter;
        const resp = await tagmanager.accounts.containers.workspaces.triggers.create({
          parent: workspacePath,
          requestBody: body,
        });
        triggerIdMap[trigger.name] = resp.data.triggerId;
      }
      await updateJobStep(jobId, 'apply_triggers', 'completed', `${triggers.length} triggers created`);
    } catch (err) {
      await updateJobStep(jobId, 'apply_triggers', 'failed', err.message);
      throw err;
    }

    // Step 5: Apply tags (skip tags with empty required parameter values)
    try {
      // Look up the built-in "All Pages" trigger ID
      const triggersListRes = await tagmanager.accounts.containers.workspaces.triggers.list({ parent: workspacePath });
      const allPagesTrigger = (triggersListRes.data.trigger || []).find(
        (t) => t.name === 'All Pages' || t.type === 'pageview'
      );
      const allPagesId = allPagesTrigger?.triggerId || '2147479553'; // GTM default

      let tags = substituteValues(template.tags, values);
      tags = filterConditionalTags(tags, config);
      tags = tags.filter((tag) => {
        const params = tag.parameter || [];
        return params.every((p) => {
          if (p.key === 'html') return true;
          return p.value && p.value.trim() !== '';
        });
      });

      for (const tag of tags) {
        const firingTriggerId = (tag.firingTriggerId || []).map((tid) => {
          if (tid === '__ALL_PAGES') return allPagesId;
          return triggerIdMap[tid] || tid;
        });

        await tagmanager.accounts.containers.workspaces.tags.create({
          parent: workspacePath,
          requestBody: {
            name: tag.name,
            type: tag.type,
            parameter: tag.parameter,
            firingTriggerId,
          },
        });
      }
      await updateJobStep(jobId, 'apply_tags', 'completed', `${tags.length} tags created`);
    } catch (err) {
      await updateJobStep(jobId, 'apply_tags', 'failed', err.message);
      throw err;
    }

    // Step 6: Create version
    let version;
    try {
      const versionResponse = await tagmanager.accounts.containers.workspaces.create_version({
        path: workspacePath,
        requestBody: {
          name: `Anchor v${Date.now()}`,
          notes: 'Auto-provisioned by Anchor Client Dashboard',
        },
      });
      version = versionResponse.data.containerVersion;
      await updateJobStep(jobId, 'create_version', 'completed', `Version: ${version?.containerVersionId}`);
    } catch (err) {
      await updateJobStep(jobId, 'create_version', 'failed', err.message);
      throw err;
    }

    // Step 7: Generate snippet
    let publicId = config.gtm_container_public_id;
    if (!publicId) {
      const containerResponse = await tagmanager.accounts.containers.get({
        path: containerPath,
      });
      publicId = containerResponse.data.publicId;
    }

    const snippet = generateGtmSnippet(publicId);
    await updateJobStep(jobId, 'generate_snippet', 'completed', 'Snippet generated');

    // Step 8: Save results
    await query(
      `UPDATE tracking_configs SET
        gtm_container_public_id = $1,
        gtm_workspace_id = $2,
        gtm_version_id = $3,
        install_snippet = $4,
        provisioning_status = 'provisioned',
        provisioned_at = NOW(),
        updated_at = NOW()
      WHERE id = $5`,
      [publicId, workspace.workspaceId, version?.containerVersionId, snippet, configId]
    );

    await query(
      `UPDATE tracking_provisioning_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [jobId]
    );

    const { rows: updated } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [configId]);
    return updated[0];
  } catch (err) {
    await query(
      `UPDATE tracking_provisioning_jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, jobId]
    );
    await query(
      `UPDATE tracking_configs SET
         provisioning_status = 'failed',
         updated_at = NOW()
       WHERE id = $1`,
      [configId]
    );
    if (isQuotaExceededError(err)) {
      throw new Error('Google Tag Manager API quota exceeded. Wait about a minute, then retry once.');
    }
    throw err;
  }
}

/**
 * Publish the latest version of a GTM container.
 */
export async function publishVersion(configId) {
  const { rows } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [configId]);
  if (rows.length === 0) throw new Error('Config not found');
  const config = rows[0];

  if (!config.gtm_version_id) {
    throw new Error('No version to publish — run provisioning first');
  }

  const authClient = await getAuthClient();
  google.options({ auth: authClient });

  const versionPath = `accounts/${config.gtm_account_id}/containers/${config.gtm_container_id}/versions/${config.gtm_version_id}`;

  await tagmanager.accounts.containers.versions.publish({
    path: versionPath,
  });

  await query(
    `UPDATE tracking_configs SET
      provisioning_status = 'published',
      published_at = NOW(),
      updated_at = NOW()
    WHERE id = $1`,
    [configId]
  );

  const { rows: updated } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [configId]);
  return updated[0];
}

/**
 * Generate the GTM install snippet HTML.
 */
function generateGtmSnippet(publicId) {
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${publicId}');</script>
<!-- End Google Tag Manager -->

<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${publicId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;
}
