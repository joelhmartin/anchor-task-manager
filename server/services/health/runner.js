import { randomUUID } from 'crypto';
import { query } from '../../db.js';
import { getHealthChecks } from './registry.js';
import { sendHealthFailureEmail } from './healthEmail.js';
import './checks/index.js'; // ensure checks are registered

const RETENTION_DAYS = 30;

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * Run every registered health check sequentially, persist one row each.
 * @param {{ trigger?: 'cron'|'manual' }} opts
 * @returns {Promise<{ run_id, results, failing }>}
 */
export async function runAllHealthChecks({ trigger = 'manual' } = {}) {
  const runId = randomUUID();
  const checks = getHealthChecks();
  const results = [];

  for (const check of checks) {
    const startedAt = Date.now();
    let result;
    try {
      const raw = await withTimeout(Promise.resolve(check.run({})), check.timeoutMs, check.checkId);
      result = {
        status: raw?.status || 'fail',
        detail: raw?.detail || null,
        error: raw?.error || null,
        metrics: raw?.metrics || {}
      };
    } catch (err) {
      result = { status: 'fail', detail: null, error: err?.message || String(err), metrics: {} };
    }
    const durationMs = Date.now() - startedAt;
    const row = {
      run_id: runId,
      check_id: check.checkId,
      label: check.label,
      category: check.category,
      status: result.status,
      detail: result.detail,
      error: result.error,
      metrics: result.metrics,
      duration_ms: durationMs
    };
    results.push(row);
    try {
      await query(
        `INSERT INTO system_health_checks
           (run_id, check_id, label, category, status, detail, error, metrics, duration_ms, trigger)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [runId, check.checkId, check.label, check.category, result.status,
         result.detail, result.error, JSON.stringify(result.metrics || {}), durationMs, trigger]
      );
    } catch (err) {
      console.error('[health/runner] persist failed for', check.checkId, err?.message);
    }
  }

  const failing = results.filter((r) => r.status !== 'ok');
  return { run_id: runId, results, failing };
}

export async function pruneOldHealthChecks() {
  try {
    await query(
      `DELETE FROM system_health_checks WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(RETENTION_DAYS)]
    );
  } catch (err) {
    console.error('[health/runner] prune failed:', err?.message);
  }
}

/**
 * Cron entrypoint: run all checks, prune old rows, email super-admins on a hard
 * failure. Note: only `fail` triggers the email — `warn` (e.g. an optional
 * integration that is intentionally unconfigured) is recorded in history but must
 * never nag daily. The /run API response still surfaces warns via `summary.failing`.
 */
export async function runDailyHealthCheck() {
  const summary = await runAllHealthChecks({ trigger: 'cron' });
  await pruneOldHealthChecks();
  const hardFails = summary.results.filter((r) => r.status === 'fail');
  if (hardFails.length > 0) {
    try { await sendHealthFailureEmail({ failing: hardFails, results: summary.results }); }
    catch (err) { console.error('[health] email failed:', err?.message); }
  }
  return summary;
}
