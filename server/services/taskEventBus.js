/**
 * TM-014: Task Event Bus
 *
 * In-process EventEmitter that every task mutation emits to.
 * Events are persisted to the task_events table (append-only audit trail)
 * and dispatched to in-process subscribers (automations, activity log, etc.).
 */

import { EventEmitter } from 'events';
import { query } from '../db.js';

const bus = new EventEmitter();
bus.setMaxListeners(50);

const INSERT_TASK_EVENT_SQL = `INSERT INTO task_events
   (event_type, workspace_id, board_id, item_id, entity_type, entity_id,
    actor_id, actor_type, old_value, new_value, metadata)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

function buildTaskEventParams(event) {
  const {
    event_type, workspace_id, board_id, item_id,
    entity_type, entity_id, actor_id,
    actor_type = 'user', old_value, new_value, metadata = {}
  } = event;
  return [
    event_type, workspace_id || null, board_id || null, item_id || null,
    entity_type, entity_id,
    actor_id || null, actor_type,
    old_value ? JSON.stringify(old_value) : null,
    new_value ? JSON.stringify(new_value) : null,
    JSON.stringify(metadata)
  ];
}

/**
 * Persist a task event using an existing transactional client. Does NOT fire
 * in-process subscribers — call fireTaskEventSubscribers(event) after COMMIT
 * so subscribers don't run on a rolled-back write.
 */
export async function persistTaskEventInTx(client, event) {
  await client.query(INSERT_TASK_EVENT_SQL, buildTaskEventParams(event));
}

/**
 * Fire in-process bus subscribers for a task event (no DB write). Call this
 * after the originating transaction has committed.
 *
 * bus.emit() is synchronous — a throwing listener would otherwise bubble back
 * into the route after COMMIT and the user would see a 500 for a write that
 * already succeeded. Each emit is wrapped so subscriber failures stay
 * best-effort at the bus boundary.
 */
export function fireTaskEventSubscribers(event) {
  try {
    bus.emit(event.event_type, event);
  } catch (err) {
    console.error(`[taskEventBus] subscriber threw on ${event.event_type}:`, err?.message);
  }
  try {
    bus.emit('*', event);
  } catch (err) {
    console.error(`[taskEventBus] wildcard subscriber threw on ${event.event_type}:`, err?.message);
  }
}

/**
 * Emit a task event.
 * 1. Persists to task_events table (fire-and-forget)
 * 2. Emits to in-process subscribers
 */
export function emitTaskEvent(event) {
  // Persist to DB (fire-and-forget — don't block the response)
  query(INSERT_TASK_EVENT_SQL, buildTaskEventParams(event))
    .catch(err => console.error('Failed to persist task event:', err.message));

  fireTaskEventSubscribers(event);
}

/**
 * Subscribe to task events.
 * @param {string} eventType - Event type (e.g. 'item.status_changed') or '*' for all
 * @param {Function} handler - async (event) => void
 */
export function onTaskEvent(eventType, handler) {
  bus.on(eventType, (event) => {
    Promise.resolve(handler(event)).catch(err => {
      console.error(`Task event subscriber error [${eventType}]:`, err.message);
    });
  });
}

/**
 * Resolve workspace_id and board_id for an item.
 * Used by route handlers that don't already have this context.
 */
export async function resolveItemContext(itemId) {
  const { rows } = await query(
    `SELECT b.workspace_id, g.board_id
     FROM task_items i
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE i.id = $1`,
    [itemId]
  );
  return rows[0] || {};
}

export default bus;
