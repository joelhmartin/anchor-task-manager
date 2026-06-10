/**
 * TM-015v2b: Rule Engine — Multi-Step Chains + Conditions
 *
 * Central automation rule evaluator. Receives trigger type + event from the
 * event bus subscribers, finds matching rules across 3 scopes (board, workspace,
 * global), evaluates conditions, and executes multi-step action chains with
 * if/else branching.
 *
 * Features:
 * - 3-scope rule matching (board → workspace → global)
 * - Multi-step chain execution with if/else branching (max depth 3)
 * - AND/OR condition groups
 * - Template variable interpolation in action configs
 * - Monthly action quota (default 10K/month)
 * - Circuit breaker (5 errors → auto-disable)
 * - Backward compat: legacy rules (no steps) execute as single-action
 */

import { query } from '../db.js';
import { executeAction as legacyExecuteAction } from './taskAutomations.js';
import { evaluateConditionGroup } from './conditionEvaluator.js';
import { buildExecutionContext, resolveActionConfig } from './templateVariables.js';
import { logSecurityEvent, SecurityEventTypes, SecurityEventCategories } from './security/index.js';
import { activeOnly } from './queryHelpers.js';

const MAX_CHAIN_DEPTH = 3;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const DEFAULT_MONTHLY_QUOTA = 10000;
const STEP_TIMEOUT_MS = 30000;

// ─── Per-Item Concurrency Control ────────────────────────────────────────────
const itemLocks = new Map();

function withItemLock(itemId, fn) {
  if (!itemId) return fn();
  const prev = itemLocks.get(itemId) || Promise.resolve();
  const next = prev.then(fn, fn); // always run, even if previous failed
  itemLocks.set(itemId, next);
  // Clean up after completion
  next.finally(() => {
    if (itemLocks.get(itemId) === next) itemLocks.delete(itemId);
  });
  return next;
}

// ─── Timeout Utility ─────────────────────────────────────────────────────────
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Legacy action types handled by taskAutomations.executeAction
const LEGACY_ACTION_TYPES = new Set([
  'notify_admins', 'notify_assignees', 'notify_users', 'set_status', 'set_needs_attention', 'add_update',
  'set_due_date', 'clear_due_date', 'archive_item',
  'assign_user', 'remove_assignee',
  'move_to_group', 'move_to_board',
  'create_item', 'duplicate_item', 'create_subitem',
  'send_email', 'send_webhook',
  'start_time_tracking', 'stop_time_tracking',
  'add_label', 'remove_label'
]);

function safeJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return {}; }
  }
  return {};
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Evaluate automation rules for a given trigger type and event.
 * Called by event bus subscribers.
 */
export async function evaluateRules(triggerType, event) {
  try {
    const matchingRules = await findMatchingRules(triggerType, event);
    if (matchingRules.length === 0) return;

    // Build base context once, clone per rule so mutations are isolated
    const baseContext = await buildExecutionContext(event, triggerType);

    for (const entry of matchingRules) {
      try {
        // Deep-clone context so refreshItemContext in one rule doesn't affect others
        const context = JSON.parse(JSON.stringify(baseContext));
        await withItemLock(event.item_id, () =>
          processRule({ ...entry, triggerType, event, context })
        );
      } catch (err) {
        console.error(`[ruleEngine] Error processing rule ${entry.rule.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[ruleEngine] evaluateRules error for ${triggerType}:`, err.message);
  }
}

// ─── Rule Matching ──────────────────────────────────────────────────────────

/**
 * Find matching rules across 3 scopes in parallel:
 * 1. Board-scoped (by board_id from event)
 * 2. Workspace-scoped (global table with workspace_id matching event)
 * 3. Global (global table with workspace_id IS NULL)
 */
async function findMatchingRules(triggerType, event) {
  const boardId = event.board_id || null;
  const workspaceId = event.workspace_id || null;

  // Include tripped rules (is_active=FALSE with circuit breaker) so the auto-recovery
  // probe in processRule() can run. The probe checks updated_at > 1 hour ago.
  const activeOrTripped = `(is_active = TRUE OR (is_active = FALSE AND disabled_reason LIKE 'Circuit breaker%'))`;

  const [boardResult, workspaceResult, globalResult] = await Promise.all([
    // Board-scoped rules
    boardId
      ? query(
          `SELECT * FROM task_board_automations
           WHERE board_id = $1 AND ${activeOrTripped} AND ${activeOnly()}
             AND (trigger_type = $2 OR $2 = ANY(trigger_events))
           ORDER BY created_at ASC`,
          [boardId, triggerType]
        )
      : Promise.resolve({ rows: [] }),

    // Workspace-scoped rules (global table with workspace_id set)
    workspaceId
      ? query(
          `SELECT * FROM task_global_automations
           WHERE workspace_id = $1 AND ${activeOrTripped} AND ${activeOnly()}
             AND (trigger_type = $2 OR $2 = ANY(trigger_events))
           ORDER BY created_at ASC`,
          [workspaceId, triggerType]
        )
      : Promise.resolve({ rows: [] }),

    // Global rules (no workspace_id)
    query(
      `SELECT * FROM task_global_automations
       WHERE workspace_id IS NULL AND ${activeOrTripped} AND ${activeOnly()}
         AND (trigger_type = $1 OR $1 = ANY(trigger_events))
       ORDER BY created_at ASC`,
      [triggerType]
    )
  ]);
  const boardRules = boardResult.rows || [];
  const workspaceRules = workspaceResult.rows || [];
  const globalRules = globalResult.rows || [];

  return [
    ...boardRules.map(rule => ({ rule, scope: 'board', boardId })),
    ...workspaceRules.map(rule => ({ rule, scope: 'global', boardId })),
    ...globalRules.map(rule => ({ rule, scope: 'global', boardId }))
  ];
}

// ─── Rule Processing ────────────────────────────────────────────────────────

/**
 * Process a single matched rule:
 * 1. Circuit breaker check
 * 2. Quota check
 * 3. Trigger config match (filter by trigger-specific conditions)
 * 4. Load steps (or fall back to legacy single-action)
 * 5. Execute chain
 */
async function processRule({ rule, scope, boardId, triggerType, event, context }) {
  // Circuit breaker: skip if error_count >= threshold (unless auto-recovery window)
  if ((rule.error_count || 0) >= CIRCUIT_BREAKER_THRESHOLD) {
    // Auto-recovery probe: if last update was > 1 hour ago, allow a single attempt
    const updatedAt = rule.updated_at ? new Date(rule.updated_at) : null;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (!updatedAt || updatedAt.getTime() > oneHourAgo) return;
    // Allow probe execution — will reset on success or re-trip on failure
    console.log(`[ruleEngine] Circuit breaker probe for automation ${rule.id} (last error > 1h ago)`);
  }

  // Trigger config match
  if (!(await matchesTriggerConfig(rule, triggerType, event, context))) return;

  // Quota check
  const quotaOk = await checkAndIncrementQuota();
  if (!quotaOk) {
    console.warn('[ruleEngine] Monthly quota exceeded, skipping rule', rule.id);
    return;
  }

  // Load steps
  const steps = await loadSteps(rule.id, scope);

  // Count all executable steps (including nested children)
  const stepsTotal = steps.length === 0 ? 1 : countExecutableSteps(steps);

  // Create workflow run
  const workflowRun = await createWorkflowRun({
    automationId: rule.id,
    scope,
    boardId,
    itemId: event.item_id,
    triggerType,
    eventId: event.entity_id, // closest to the persisted event ID
    stepsTotal
  });

  let execStatus = 'success';
  let stepsCompleted = 0;
  try {
    if (steps.length === 0) {
      // Legacy single-action execution (backward compat)
      const result = await executeLegacyAction({ rule, scope, boardId, event, context });
      if (result && result.ok === false) {
        execStatus = 'error';
        await completeWorkflowRun(workflowRun.id, 'error', result.error);
        await incrementErrorCount(rule.id, scope);
      } else {
        await completeWorkflowRun(workflowRun.id, 'success');
        await resetErrorCount(rule.id, scope);
        stepsCompleted = 1;
      }
    } else {
      // Multi-step chain execution
      const result = await executeChain(steps, context, workflowRun, {
        rule, scope, boardId, event
      });
      execStatus = result.errors > 0
        ? (result.completed > 0 ? 'partial' : 'error')
        : 'success';
      stepsCompleted = result.completed;
      await completeWorkflowRun(workflowRun.id, execStatus, result.lastError);
      if (result.errors === 0) {
        await resetErrorCount(rule.id, scope);
      } else {
        await incrementErrorCount(rule.id, scope);
      }
    }
  } catch (err) {
    execStatus = 'error';
    await completeWorkflowRun(workflowRun.id, 'error', err.message);
    await incrementErrorCount(rule.id, scope);
  }
  // Audit log: automation executed (no PHI — only IDs)
  logSecurityEvent({
    eventType: SecurityEventTypes.SENSITIVE_ACTION,
    eventCategory: SecurityEventCategories.ACCESS,
    success: execStatus === 'success',
    details: { action: 'automation_executed', automationId: rule.id, scope, triggerType, status: execStatus, stepsCompleted, stepsTotal }
  });
}

/**
 * Trigger-specific filtering — ensures the event matches trigger_config constraints.
 * e.g. status_change with to_status, field_changed with field name, etc.
 */
async function matchesTriggerConfig(rule, triggerType, event, context) {
  const trigger = safeJson(rule.trigger_config);

  switch (triggerType) {
    case 'status_change': {
      const toStatus = trigger.to_status;
      if (!toStatus) return true; // no filter = match all status changes
      const newStatus = event.new_value?.status ?? context.item?.status;
      return newStatus === toStatus;
    }

    case 'field_changed': {
      const field = trigger.field;
      if (!field) return true; // no filter = match all field changes
      return event.metadata?.field === field || event.entity_type === field;
    }

    case 'item_completed': {
      // Check against board's is_done_state labels, not a hard-coded string
      const newStatus = event.new_value?.status ?? context.item?.status;
      if (!newStatus) return false;
      try {
        const { rows } = await query(
          `SELECT is_done_state FROM task_board_status_labels WHERE board_id = $1 AND label = $2`,
          [event.board_id, newStatus]
        );
        if (rows.length > 0) return rows[0].is_done_state === true;
      } catch { /* fallback below */ }
      return newStatus === 'Done'; // fallback
    }

    case 'all_subitems_completed': {
      // Check if ALL subitems of the item are in a done-state.
      // Archived subitems are excluded — they aren't part of the active checklist.
      const itemId = event.item_id || context.item?.id;
      if (!itemId) return false;
      try {
        const { rows } = await query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE s.status IN (
                    SELECT sl.label FROM task_board_status_labels sl
                    WHERE sl.board_id = $2 AND sl.is_done_state = TRUE
                  ) OR s.status = 'Done')::int AS done
           FROM task_subitems s
           WHERE s.parent_item_id = $1 AND ${activeOnly('s')}`,
          [itemId, event.board_id]
        );
        const r = rows[0];
        return r && r.total > 0 && r.total === r.done;
      } catch { return false; }
    }

    case 'all_assignees_completed': {
      // Check if all subitems are complete (assignee completion is not modeled separately)
      // This is equivalent to all_subitems_completed — kept as separate trigger for UX clarity
      const itemId = event.item_id || context.item?.id;
      if (!itemId) return false;
      try {
        const { rows } = await query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE s.status IN (
                    SELECT sl.label FROM task_board_status_labels sl
                    WHERE sl.board_id = $2 AND sl.is_done_state = TRUE
                  ) OR s.status = 'Done')::int AS done
           FROM task_subitems s
           WHERE s.parent_item_id = $1 AND ${activeOnly('s')}`,
          [itemId, event.board_id]
        );
        const r = rows[0];
        return r && r.total > 0 && r.total === r.done;
      } catch { return false; }
    }

    default:
      return true; // no trigger-specific filtering needed
  }
}

// ─── Legacy Single-Action ───────────────────────────────────────────────────

/**
 * Execute a legacy rule as a single action via taskAutomations.executeAction().
 * Used for backward compat when no steps exist in task_automation_steps.
 */
async function executeLegacyAction({ rule, scope, boardId, event, context }) {
  const item = context.item?.id ? context.item : { id: event.item_id };
  try {
    const result = await legacyExecuteAction({
      scope,
      rule,
      boardId,
      item,
      actorUserId: event.actor_id,
      event: {
        type: event.event_type,
        ...event.new_value,
        assignee_user_id: event.new_value?.user_id || event.entity_id
      }
    });
    return result || { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Step Loading ───────────────────────────────────────────────────────────

/**
 * Load all steps for an automation, organized into a tree.
 * Top-level steps (parent_step_id IS NULL) are returned as an array.
 * Children are nested under their parent's `children` property.
 */
async function loadSteps(automationId, scope) {
  const { rows } = await query(
    `SELECT * FROM task_automation_steps
     WHERE automation_id = $1 AND automation_scope = $2
     ORDER BY step_order ASC`,
    [automationId, scope]
  );

  if (rows.length === 0) return [];

  // Build parent→children map
  const byId = new Map();
  for (const row of rows) {
    row.children = [];
    byId.set(row.id, row);
  }

  const topLevel = [];
  for (const row of rows) {
    if (row.parent_step_id && byId.has(row.parent_step_id)) {
      byId.get(row.parent_step_id).children.push(row);
    } else {
      topLevel.push(row);
    }
  }

  return topLevel;
}

// ─── Context Refresh ─────────────────────────────────────────────────────────

async function refreshItemContext(itemId, context) {
  try {
    const { rows } = await query('SELECT * FROM task_items WHERE id = $1', [itemId]);
    if (rows[0]) context.item = rows[0];
  } catch {
    // Non-critical — stale context is better than no context
  }
}

// ─── Step Run Tracking ───────────────────────────────────────────────────────

async function createStepRun(workflowRunId, step) {
  if (!workflowRunId) return null;
  try {
    const { rows } = await query(
      `INSERT INTO task_workflow_step_runs (workflow_run_id, step_id, step_type, action_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [workflowRunId, step.id, step.step_type, step.action_type || null]
    );
    return rows[0];
  } catch {
    return null;
  }
}

async function completeStepRun(stepRunId, status, error = null) {
  if (!stepRunId) return;
  try {
    await query(
      `UPDATE task_workflow_step_runs
       SET status = $2, error = $3, completed_at = NOW(),
           duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
       WHERE id = $1`,
      [stepRunId, status, error || null]
    );
  } catch {
    // Non-critical
  }
}

// ─── Step Count Helper ──────────────────────────────────────────────────────

function countExecutableSteps(steps) {
  let count = 0;
  for (const step of steps) {
    count++;
    if (step.children?.length) count += countExecutableSteps(step.children);
  }
  return count;
}

// ─── Chain Execution ────────────────────────────────────────────────────────

/**
 * Execute a sequence of steps with if/else branching.
 * @param {Array} steps - Ordered steps at the current level
 * @param {object} context - Execution context (item, event, actor, etc.)
 * @param {object} workflowRun - The workflow run record
 * @param {object} meta - { rule, scope, boardId, event }
 * @param {number} depth - Current nesting depth (max MAX_CHAIN_DEPTH)
 */
async function executeChain(steps, context, workflowRun, meta, depth = 0) {
  if (depth > MAX_CHAIN_DEPTH) {
    return { completed: 0, errors: 0, lastError: 'Max nesting depth exceeded' };
  }

  let completed = 0;
  let errors = 0;
  let lastError = null;
  let lastIfResult = null; // tracks if the last `if` step evaluated true or false

  for (const step of steps) {
    const stepRun = await createStepRun(workflowRun.id, step);
    try {
      switch (step.step_type) {
        case 'action': {
          const result = await withTimeout(executeActionV2({
            actionType: step.action_type,
            actionConfig: safeJson(step.action_config),
            context,
            rule: meta.rule,
            scope: meta.scope,
            boardId: meta.boardId,
            event: meta.event
          }), STEP_TIMEOUT_MS);
          if (result.ok) {
            completed++;
            await completeStepRun(stepRun?.id, 'success');
            // Refresh context after state-changing actions
            if (['set_status', 'set_needs_attention'].includes(step.action_type) && meta.event.item_id) {
              await refreshItemContext(meta.event.item_id, context);
            }
          } else {
            errors++;
            lastError = result.error;
            await completeStepRun(stepRun?.id, 'error', result.error);
          }
          // Update workflow run progress
          await updateWorkflowRunProgress(workflowRun.id, completed);
          break;
        }

        case 'if': {
          const conditionGroup = safeJson(step.condition_group);
          lastIfResult = evaluateConditionGroup(conditionGroup, context);
          if (lastIfResult && step.children.length > 0) {
            await completeStepRun(stepRun?.id, 'success');
            const childResult = await executeChain(step.children, context, workflowRun, meta, depth + 1);
            completed += childResult.completed;
            errors += childResult.errors;
            if (childResult.lastError) lastError = childResult.lastError;
          } else {
            await completeStepRun(stepRun?.id, lastIfResult ? 'success' : 'skipped');
          }
          break;
        }

        case 'else': {
          // Only execute if the preceding `if` was false
          if (lastIfResult === false && step.children.length > 0) {
            await completeStepRun(stepRun?.id, 'success');
            const childResult = await executeChain(step.children, context, workflowRun, meta, depth + 1);
            completed += childResult.completed;
            errors += childResult.errors;
            if (childResult.lastError) lastError = childResult.lastError;
          } else {
            await completeStepRun(stepRun?.id, 'skipped');
          }
          // Reset so a stray `else` doesn't fire on the next unrelated `if`
          lastIfResult = null;
          break;
        }

        case 'delay': {
          // Stub: delay steps are a no-op until TM-015v2d
          await completeStepRun(stepRun?.id, 'skipped');
          break;
        }

        default:
          console.warn(`[ruleEngine] Unknown step_type: ${step.step_type}`);
          await completeStepRun(stepRun?.id, 'skipped');
      }
    } catch (err) {
      errors++;
      lastError = err.message;
      await completeStepRun(stepRun?.id, 'error', err.message);
      console.error(`[ruleEngine] Step ${step.id} error:`, err.message);
    }
  }

  return { completed, errors, lastError };
}

// ─── Action Execution ───────────────────────────────────────────────────────

/**
 * Execute an action step. Resolves template variables, then delegates:
 * - Legacy 5 action types → taskAutomations.executeAction()
 * - New action types → stub "not implemented (TM-015v2c)"
 */
async function executeActionV2({ actionType, actionConfig, context, rule, scope, boardId, event }) {
  // Resolve template variables in action config
  const resolvedConfig = resolveActionConfig(actionConfig, context);

  // Legacy action types: delegate to existing executeAction
  if (LEGACY_ACTION_TYPES.has(actionType)) {
    const legacyRule = {
      ...rule,
      action_type: actionType,
      action_config: resolvedConfig
    };
    const item = context.item?.id ? context.item : { id: event.item_id };
    try {
      const result = await legacyExecuteAction({
        scope,
        rule: legacyRule,
        boardId,
        item,
        actorUserId: event.actor_id,
        event: {
          type: event.event_type,
          assignee_user_id: event.new_value?.user_id || event.entity_id
        }
      });
      return result || { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // New action types: stub for TM-015v2c
  console.log(`[ruleEngine] Action type "${actionType}" not implemented (TM-015v2c)`);
  return { ok: true, stubbed: true };
}

// ─── Quota Management ───────────────────────────────────────────────────────

/**
 * Check monthly quota and atomically increment if within limit.
 * Uses upsert to create the period row if it doesn't exist.
 * Returns true if action is allowed, false if quota exceeded.
 */
async function checkAndIncrementQuota() {
  const periodStart = new Date().toISOString().slice(0, 7) + '-01'; // YYYY-MM-01
  try {
    const { rows } = await query(
      `INSERT INTO task_automation_quota (period_start, actions_consumed, actions_limit)
       VALUES ($1, 1, $2)
       ON CONFLICT (period_start) DO UPDATE
         SET actions_consumed = task_automation_quota.actions_consumed + 1
       RETURNING actions_consumed, actions_limit`,
      [periodStart, DEFAULT_MONTHLY_QUOTA]
    );
    const row = rows[0];
    if (row.actions_consumed > row.actions_limit) {
      // Exceeded — roll back the increment
      await query(
        `UPDATE task_automation_quota SET actions_consumed = actions_consumed - 1
         WHERE period_start = $1`,
        [periodStart]
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error('[ruleEngine] Quota check error:', err.message);
    return true; // fail-open: don't block automations on quota errors
  }
}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

async function incrementErrorCount(automationId, scope) {
  const table = scope === 'board' ? 'task_board_automations' : 'task_global_automations';
  try {
    const { rows } = await query(
      `UPDATE ${table}
       SET error_count = COALESCE(error_count, 0) + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING error_count`,
      [automationId]
    );
    const count = rows[0]?.error_count || 0;
    if (count >= CIRCUIT_BREAKER_THRESHOLD) {
      await query(
        `UPDATE ${table}
         SET is_active = FALSE,
             disabled_reason = 'Circuit breaker: ' || $2 || ' consecutive errors',
             updated_at = NOW()
         WHERE id = $1`,
        [automationId, count]
      );
      console.warn(`[ruleEngine] Circuit breaker tripped for ${scope} automation ${automationId} (${count} errors)`);
      logSecurityEvent({
        eventType: SecurityEventTypes.SENSITIVE_ACTION,
        eventCategory: SecurityEventCategories.ACCESS,
        success: true,
        details: { action: 'circuit_breaker_tripped', automationId, scope, errorCount: count }
      });
    }
  } catch (err) {
    console.error('[ruleEngine] Error incrementing error count:', err.message);
  }
}

async function resetErrorCount(automationId, scope) {
  const table = scope === 'board' ? 'task_board_automations' : 'task_global_automations';
  try {
    const { rows } = await query(
      `UPDATE ${table}
       SET error_count = 0, is_active = TRUE, disabled_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND error_count > 0
       RETURNING error_count`,
      [automationId]
    );
    if (rows.length > 0) {
      logSecurityEvent({
        eventType: SecurityEventTypes.SENSITIVE_ACTION,
        eventCategory: SecurityEventCategories.ACCESS,
        success: true,
        details: { action: 'circuit_breaker_recovered', automationId, scope }
      });
    }
  } catch (err) {
    // Non-critical, don't propagate
  }
}

// ─── Workflow Runs ──────────────────────────────────────────────────────────

async function createWorkflowRun({ automationId, scope, boardId, itemId, triggerType, eventId, stepsTotal }) {
  try {
    const { rows } = await query(
      `INSERT INTO task_workflow_runs
         (automation_id, automation_scope, board_id, item_id, trigger_type, trigger_event_id, steps_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [automationId, scope, boardId || null, itemId || null, triggerType, eventId || null, stepsTotal]
    );
    return rows[0];
  } catch (err) {
    console.error('[ruleEngine] Failed to create workflow run:', err.message);
    // Return a stub so the rest of execution can proceed
    return { id: null };
  }
}

async function completeWorkflowRun(runId, status, error = null) {
  if (!runId) return;
  try {
    await query(
      `UPDATE task_workflow_runs
       SET status = $2, error = $3, completed_at = NOW()
       WHERE id = $1`,
      [runId, status, error || null]
    );
  } catch (err) {
    console.error('[ruleEngine] Failed to complete workflow run:', err.message);
  }
}

async function updateWorkflowRunProgress(runId, stepsCompleted) {
  if (!runId) return;
  try {
    await query(
      `UPDATE task_workflow_runs SET steps_completed = $2 WHERE id = $1`,
      [runId, stepsCompleted]
    );
  } catch (err) {
    // Non-critical progress update
  }
}
