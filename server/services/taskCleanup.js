import { query } from '../db.js';

// Permanently delete archived task items/subitems older than N days.
// Note: deleting task_items will cascade to subitems, updates, assignees, files, time entries.
export async function purgeArchivedTasks({ retentionDays = 30 } = {}) {
  const days = Number(retentionDays) || 30;
  try {
    const { rows } = await query(
      `
        WITH deleted_items AS (
          DELETE FROM task_items
          WHERE archived_at IS NOT NULL
            AND archived_at < NOW() - ($1::int * INTERVAL '1 day')
          RETURNING id
        )
        SELECT COUNT(*)::int AS deleted_count FROM deleted_items
      `,
      [days]
    );
    return { deleted: Number(rows?.[0]?.deleted_count || 0) };
  } catch (err) {
    console.error('[cron:purge-archived-tasks] failed', err);
    return { deleted: 0, error: err?.message || String(err) };
  }
}


