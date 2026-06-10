import { query } from '../../db.js';
import { nextRunAt } from './scheduleUtils.js';
import { recoverInterruptedRuns, startRun } from './aiRunExecutor.js';

/**
 * Tick the report scheduler.  Called every 15 minutes by the cron in server/index.js.
 * Finds all non-archived scheduled templates whose next_run_at is due and fires them
 * through the AI web-report engine.  Legacy widget-canvas engine templates are skipped
 * with a warning — the widget-canvas system has been removed.
 */
export async function tickScheduler() {
  await recoverInterruptedRuns().catch((err) => {
    console.error('[reports.scheduler] recovery failed:', err.message);
  });

  const { rows: templates } = await query(
    `SELECT * FROM report_templates
     WHERE schedule IS NOT NULL
       AND is_archived = false
       AND (next_run_at IS NULL OR next_run_at <= NOW())`
  );

  if (templates.length === 0) return;

  for (const tmpl of templates) {
    let shouldAdvance = false;

    // AI web-report engine: route through aiRunExecutor.
    if (tmpl.engine === 'ai_web') {
      try {
        const schedule = tmpl.schedule || {};
        if (tmpl.is_archived) {
          console.warn(`[reports.scheduler] AI template ${tmpl.id} (${tmpl.name}) is archived; skipping`);
          shouldAdvance = true;
        } else if (tmpl.enabled === false) {
          console.warn(`[reports.scheduler] AI template ${tmpl.id} (${tmpl.name}) is disabled; skipping`);
          shouldAdvance = true;
        } else if (!tmpl.approved_version_id) {
          console.warn(`[reports.scheduler] AI template ${tmpl.id} (${tmpl.name}) has no approved version; skipping`);
          shouldAdvance = true;
        } else {
          const dateRange = resolveScheduledDateRange(schedule);
          await startRun({
            templateId: tmpl.id,
            source: 'scheduled',
            audienceFilter: schedule.audience_filter || { mode: 'all' },
            dateRange,
            createdBy: null
          });
          shouldAdvance = true;
        }
      } catch (err) {
        console.error(`[reports.scheduler] AI run failed for template ${tmpl.id}:`, err.message);
      }
      // Advance only when the scheduled decision was handled. Transient enqueue
      // failures should remain due so the next tick can retry.
      try {
        if (shouldAdvance) {
          const next = nextRunAt(tmpl.schedule);
          if (next) {
            await query(`UPDATE report_templates SET next_run_at = $1 WHERE id = $2`, [next, tmpl.id]);
          }
        }
      } catch (err) {
        console.error(`[reports.scheduler] failed to advance next_run_at for ${tmpl.id}:`, err.message);
      }
      continue;
    }

    // Non-AI engines are no longer supported (widget-canvas system removed).
    console.warn(`[reports.scheduler] template ${tmpl.id} (${tmpl.name}) has unsupported engine '${tmpl.engine || 'none'}'; skipping`);
    try {
      const next = nextRunAt(tmpl.schedule);
      if (next) {
        await query(`UPDATE report_templates SET next_run_at = $1 WHERE id = $2`, [next, tmpl.id]);
      }
    } catch (err) {
      console.error(`[reports.scheduler] failed to advance next_run_at for ${tmpl.id}:`, err.message);
    }
  }
}

/**
 * Resolve the date range for a scheduled AI run.
 * Defaults to the previous calendar month if the schedule doesn't specify an explicit date_range.
 */
function resolveScheduledDateRange(schedule) {
  const today = new Date();
  const firstOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    from: schedule?.date_range?.from || fmt(firstOfPrevMonth),
    to:   schedule?.date_range?.to   || fmt(lastOfPrevMonth)
  };
}
