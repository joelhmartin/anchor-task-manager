/**
 * TM-014 + TM-015v2a: Task Event Subscribers
 *
 * Two subscriber categories:
 * 1. Automation subscribers — route events to the rule engine via TRIGGER_EVENT_MAP
 * 2. Activity log subscribers — replicate existing logTaskActivity behavior
 *
 * Gated behind TASK_EVENT_BUS_ENABLED=true. When disabled, route handlers
 * continue calling side effects directly (no subscribers fire).
 */

import { onTaskEvent } from './taskEventBus.js';
import { evaluateRules } from './ruleEngine.js';
import { logTaskActivity, ActivityEventTypes } from './activityLog.js';

/**
 * Maps automation trigger types to the event bus event types they listen to.
 * Each entry registers a subscriber that routes the event to ruleEngine.evaluateRules().
 *
 * Note: Multiple trigger types can map to the same event type (e.g. both
 * all_subitems_completed and all_assignees_completed listen to subitem.updated).
 */
const TRIGGER_EVENT_MAP = {
  'status_change':           'item.status_changed',
  'item_completed':          'item.completed',
  'item_created':            'item.created',
  'item_archived':           'item.archived',
  'update_created':          'update.created',
  'assignee_added':          'assignee.added',
  'assignee_removed':        'assignee.removed',
  'field_changed':           'item.updated',
  'time_entry_logged':       'time_entry.created',
  'file_uploaded':           'file.uploaded',
  'all_subitems_completed':  'subitem.updated',
  'all_assignees_completed': 'subitem.updated',
  'label_added':             'label.added',
  'label_removed':           'label.removed',
};

export function registerTaskEventSubscribers() {
  if (process.env.TASK_EVENT_BUS_ENABLED !== 'true') {
    console.log('Task event bus subscribers: disabled (set TASK_EVENT_BUS_ENABLED=true to enable)');
    return;
  }

  console.log('Task event bus subscribers: registering');

  // --- Automation subscribers (route to rule engine) ---

  for (const [triggerType, eventType] of Object.entries(TRIGGER_EVENT_MAP)) {
    onTaskEvent(eventType, async (event) => {
      if (event.actor_type === 'automation') return;
      await evaluateRules(triggerType, event);
    });
  }

  // --- Activity log subscribers ---

  onTaskEvent('item.created', async (event) => {
    await logTaskActivity({
      userId: event.actor_id,
      actionType: ActivityEventTypes.CREATE_TASK,
      taskId: event.entity_id,
      taskName: event.new_value?.name
    });
  });

  onTaskEvent('item.status_changed', async (event) => {
    // Check done state via board status labels, not hard-coded string
    const { query: dbQuery } = await import('../db.js');
    let isDone = false;
    if (event.board_id && event.new_value?.status) {
      const { rows } = await dbQuery(
        `SELECT is_done_state FROM task_board_status_labels WHERE board_id = $1 AND label = $2`,
        [event.board_id, event.new_value.status]
      );
      isDone = rows[0]?.is_done_state === true;
    }
    if (!isDone) isDone = event.new_value?.status === 'Done'; // fallback
    await logTaskActivity({
      userId: event.actor_id,
      actionType: isDone ? ActivityEventTypes.COMPLETE_TASK : ActivityEventTypes.UPDATE_TASK,
      taskId: event.item_id,
      taskName: event.new_value?.name,
      details: { from_status: event.old_value?.status, to_status: event.new_value?.status }
    });
  });

  onTaskEvent('item.updated', async (event) => {
    await logTaskActivity({
      userId: event.actor_id,
      actionType: ActivityEventTypes.UPDATE_TASK,
      taskId: event.item_id,
      taskName: event.new_value?.name
    });
  });

  onTaskEvent('item.archived', async (event) => {
    await logTaskActivity({
      userId: event.actor_id,
      actionType: ActivityEventTypes.DELETE_TASK,
      taskId: event.entity_id,
      taskName: event.old_value?.name
    });
  });

  console.log('Task event bus subscribers: registered (12 trigger types, 4 activity log handlers)');
}
