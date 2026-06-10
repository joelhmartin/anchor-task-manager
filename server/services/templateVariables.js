/**
 * TM-015v2b: Template Variables
 *
 * Builds execution context from event data and resolves {path.to.value}
 * template variables in action configs. Context is built once per event
 * and shared across all matching rules.
 */

import { query } from '../db.js';
import { getNestedValue } from './conditionEvaluator.js';

const MAX_RESOLVED_LENGTH = 1000;

/**
 * Build the execution context for a rule engine event.
 * Uses parallel DB queries for item, board, workspace, actor, and assignees.
 * Returns empty sub-objects gracefully when data is unavailable.
 */
export async function buildExecutionContext(event, triggerType) {
  const itemId = event.item_id;
  const actorId = event.actor_id;
  const boardId = event.board_id;
  const workspaceId = event.workspace_id;

  // Parallel queries — only fetch what's available
  const [itemResult, boardResult, workspaceResult, actorResult, assigneesResult] = await Promise.all([
    itemId
      ? query('SELECT * FROM task_items WHERE id = $1', [itemId]).then(r => r.rows[0] || null)
      : Promise.resolve(null),
    boardId
      ? query('SELECT * FROM task_boards WHERE id = $1', [boardId]).then(r => r.rows[0] || null)
      : Promise.resolve(null),
    workspaceId
      ? query('SELECT * FROM task_workspaces WHERE id = $1', [workspaceId]).then(r => r.rows[0] || null)
      : Promise.resolve(null),
    actorId
      ? query('SELECT id, first_name, last_name, email, role FROM users WHERE id = $1', [actorId]).then(r => r.rows[0] || null)
      : Promise.resolve(null),
    itemId
      ? query(
          `SELECT u.id, u.first_name, u.last_name, u.email
           FROM task_item_assignees a
           JOIN users u ON u.id = a.user_id
           WHERE a.item_id = $1`,
          [itemId]
        ).then(r => r.rows || [])
      : Promise.resolve([])
  ]);

  return {
    item: itemResult || {},
    event: {
      type: triggerType,
      event_type: event.event_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      old_value: event.old_value || {},
      new_value: event.new_value || {},
      metadata: event.metadata || {}
    },
    actor: {
      ...(actorResult || {}),
      name: actorResult ? `${actorResult.first_name || ''} ${actorResult.last_name || ''}`.trim() : ''
    },
    board: boardResult || {},
    workspace: workspaceResult || {},
    assignees: assigneesResult,
    trigger: {
      type: triggerType
    },
    date: {
      now: new Date().toISOString(),
      today: new Date().toISOString().slice(0, 10)
    }
  };
}

/**
 * Resolve template variables in a string.
 * Replaces {path.to.value} with the corresponding value from context.
 * Unresolved variables are left as-is. Resolved values are truncated to MAX_RESOLVED_LENGTH.
 */
export function resolveTemplateVariables(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    const value = getNestedValue(context, path.trim());
    if (value === undefined || value === null) return match; // leave unresolved
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return str.length > MAX_RESOLVED_LENGTH ? str.slice(0, MAX_RESOLVED_LENGTH) + '...' : str;
  });
}

/**
 * Resolve all string values in an action_config object.
 * Walks the object recursively and applies resolveTemplateVariables to each string.
 */
export function resolveActionConfig(config, context) {
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config)) {
    return config.map(item => resolveActionConfig(item, context));
  }
  const resolved = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      resolved[key] = resolveTemplateVariables(value, context);
    } else if (typeof value === 'object' && value !== null) {
      resolved[key] = resolveActionConfig(value, context);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
