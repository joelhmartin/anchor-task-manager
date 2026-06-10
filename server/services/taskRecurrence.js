import { query, getClient } from '../db.js';
import { activeOnly } from './queryHelpers.js';

export async function processRecurringTasks() {
  try {
    // Find rules where next_occurrence <= now. Skip rules whose template item
    // has been archived — otherwise the cron keeps spawning new occurrences
    // long after the user soft-deleted the source task.
    const { rows: dueRules } = await query(
      `SELECT r.*, i.group_id, i.name, i.status, i.needs_attention, i.due_date
       FROM task_recurrence_rules r
       JOIN task_items i ON i.id = r.item_id
       WHERE r.is_active = true
         AND r.next_occurrence <= NOW()
         AND ${activeOnly('i')}`
    );

    if (!dueRules.length) return;

    for (const rule of dueRules) {
      // Each rule's claim + clone + assignee copy + label copy must be atomic.
      // Without a transaction a partial failure leaves an orphaned half-cloned
      // item, and a failure on the rule UPDATE causes the next cron pass to
      // re-spawn the same task (duplicates).
      //
      // getClient() lives inside the per-rule try so a transient connection
      // failure is caught and reported per-rule instead of aborting the whole
      // cron pass.
      let client;
      try {
        client = await getClient();
        await client.query('BEGIN');

        // Claim the rule with an optimistic UPDATE guarded by the
        // next_occurrence we read outside the transaction. If two cron workers
        // raced and another worker already advanced this rule, rowCount === 0
        // and we skip — preventing duplicate clones.
        const nextOcc = calculateNext(rule.pattern, new Date(rule.next_occurrence));
        const claim = await client.query(
          `UPDATE task_recurrence_rules
              SET next_occurrence = $1, last_generated = NOW()
            WHERE id = $2
              AND next_occurrence = $3
              AND is_active = true`,
          [nextOcc, rule.id, rule.next_occurrence]
        );
        if (claim.rowCount === 0) {
          await client.query('ROLLBACK');
          continue;
        }

        const { rows: newItem } = await client.query(
          `INSERT INTO task_items (group_id, name, status, needs_attention, created_by)
           VALUES ($1, $2, 'To Do', $3, $4) RETURNING id`,
          [rule.group_id, rule.name, rule.needs_attention || false, rule.created_by]
        );

        if (newItem[0]) {
          await client.query(
            `INSERT INTO task_item_assignees (item_id, user_id)
             SELECT $1, user_id FROM task_item_assignees WHERE item_id = $2`,
            [newItem[0].id, rule.item_id]
          );

          await client.query(
            `INSERT INTO task_item_labels (item_id, label_id, applied_by)
             SELECT $1, label_id, applied_by FROM task_item_labels WHERE item_id = $2`,
            [newItem[0].id, rule.item_id]
          );
        }

        await client.query('COMMIT');
        console.log(`[recurrence] Generated recurring task from template ${rule.item_id}`);
      } catch (err) {
        if (client) {
          try { await client.query('ROLLBACK'); } catch { /* noop */ }
        }
        console.error(`[recurrence] Error processing rule ${rule.id}:`, err.message);
      } finally {
        if (client) client.release();
      }
    }
  } catch (err) {
    console.error('[recurrence] processRecurringTasks error:', err.message);
  }
}

function calculateNext(pattern, from) {
  const d = new Date(from);
  switch (pattern) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    default: d.setDate(d.getDate() + 7);
  }
  return d;
}
