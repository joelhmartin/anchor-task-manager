import { query } from '../../db.js';

/**
 * Fetch CTM call analytics for a client within a date range.
 * @param {string} userId - The client's user ID (UUID)
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @returns {object} { totalCalls, qualifiedCalls, missedCalls, avgDuration, topSources, timeSeries }
 */
export async function fetchCTMAnalytics(userId, startDate, endDate) {
  const [summaryRes, sourceRes, timeSeriesRes] = await Promise.all([
    query(
      `SELECT
        COUNT(*) FILTER (WHERE activity_type = 'call' OR activity_type IS NULL) AS total_calls,
        COUNT(*) FILTER (WHERE activity_type = 'form') AS total_forms,
        COUNT(*) FILTER (WHERE score >= 3) AS qualified_calls,
        COUNT(*) FILTER (WHERE (activity_type = 'call' OR activity_type IS NULL) AND (duration_sec = 0 OR duration_sec IS NULL)) AS missed_calls,
        ROUND(AVG(duration_sec) FILTER (WHERE duration_sec > 0 AND (activity_type = 'call' OR activity_type IS NULL)))::int AS avg_duration
      FROM call_logs
      WHERE user_id = $1
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')`,
      [userId, startDate, endDate]
    ),
    query(
      `SELECT
        COALESCE(meta->>'source', 'Unknown') AS source,
        COUNT(*) AS count
      FROM call_logs
      WHERE user_id = $1
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')
      GROUP BY COALESCE(meta->>'source', 'Unknown')
      ORDER BY count DESC
      LIMIT 10`,
      [userId, startDate, endDate]
    ),
    query(
      `SELECT
        started_at::date AS date,
        COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE score >= 3) AS qualified
      FROM call_logs
      WHERE user_id = $1
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')
      GROUP BY started_at::date
      ORDER BY date`,
      [userId, startDate, endDate]
    )
  ]);

  const summary = summaryRes.rows[0] || {};
  return {
    totalCalls: parseInt(summary.total_calls) || 0,
    totalForms: parseInt(summary.total_forms) || 0,
    qualifiedCalls: parseInt(summary.qualified_calls) || 0,
    missedCalls: parseInt(summary.missed_calls) || 0,
    avgDuration: parseInt(summary.avg_duration) || 0,
    topSources: sourceRes.rows.map((r) => ({ source: r.source, count: parseInt(r.count) })),
    timeSeries: timeSeriesRes.rows.map((r) => ({
      date: r.date.toISOString().split('T')[0],
      calls: parseInt(r.calls),
      qualified: parseInt(r.qualified)
    }))
  };
}

/**
 * Fetch lead counts grouped by star rating.
 * @param {string} userId - Client user ID (UUID)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{rating: number, count: number}>}
 */
export async function fetchByRating(userId, startDate, endDate) {
  const res = await query(
    `SELECT score, COUNT(*) AS count
     FROM call_logs
     WHERE user_id = $1
       AND started_at >= $2::date
       AND started_at < ($3::date + interval '1 day')
       AND score IS NOT NULL AND score > 0
     GROUP BY score
     ORDER BY score`,
    [userId, startDate, endDate]
  );
  return res.rows.map((r) => ({ rating: parseInt(r.score), count: parseInt(r.count) }));
}

/**
 * Fetch lead counts grouped by AI category.
 * @param {string} userId - Client user ID (UUID)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{category: string, count: number}>}
 */
export async function fetchByCategory(userId, startDate, endDate) {
  const res = await query(
    `SELECT COALESCE(meta->>'category', 'uncategorized') AS category, COUNT(*) AS count
     FROM call_logs
     WHERE user_id = $1
       AND started_at >= $2::date
       AND started_at < ($3::date + interval '1 day')
     GROUP BY COALESCE(meta->>'category', 'uncategorized')
     ORDER BY count DESC`,
    [userId, startDate, endDate]
  );
  return res.rows.map((r) => ({ category: r.category, count: parseInt(r.count) }));
}

/**
 * Fetch lead counts grouped by source with call/form/qualified breakdown.
 * @param {string} userId - Client user ID (UUID)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{source, total, calls, forms, qualified, qualifiedRate}>}
 */
export async function fetchBySource(userId, startDate, endDate) {
  const res = await query(
    `SELECT
       COALESCE(meta->>'source', 'Unknown') AS source,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE activity_type = 'call') AS calls,
       COUNT(*) FILTER (WHERE activity_type = 'form') AS forms,
       COUNT(*) FILTER (WHERE score >= 3) AS qualified
     FROM call_logs
     WHERE user_id = $1
       AND started_at >= $2::date
       AND started_at < ($3::date + interval '1 day')
     GROUP BY COALESCE(meta->>'source', 'Unknown')
     ORDER BY total DESC`,
    [userId, startDate, endDate]
  );
  return res.rows.map((r) => {
    const total = parseInt(r.total) || 0;
    const qualified = parseInt(r.qualified) || 0;
    return {
      source: r.source,
      total,
      calls: parseInt(r.calls) || 0,
      forms: parseInt(r.forms) || 0,
      qualified,
      qualifiedRate: total > 0 ? Math.round((qualified / total) * 100 * 10) / 10 : 0
    };
  });
}

/**
 * Fetch daily call/form volume time series.
 * @param {string} userId - Client user ID (UUID)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{date: string, calls: number, forms: number}>}
 */
export async function fetchVolumeTimeSeries(userId, startDate, endDate) {
  const res = await query(
    `SELECT
       started_at::date AS date,
       COUNT(*) FILTER (WHERE activity_type = 'call' OR activity_type IS NULL) AS calls,
       COUNT(*) FILTER (WHERE activity_type = 'form') AS forms
     FROM call_logs
     WHERE user_id = $1
       AND started_at >= $2::date
       AND started_at < ($3::date + interval '1 day')
     GROUP BY started_at::date
     ORDER BY date`,
    [userId, startDate, endDate]
  );
  return res.rows.map((r) => ({
    date: r.date.toISOString().split('T')[0],
    calls: parseInt(r.calls) || 0,
    forms: parseInt(r.forms) || 0
  }));
}

/**
 * Fetch call duration distribution in bucketed ranges.
 * @param {string} userId - Client user ID (UUID)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{bucket: string, count: number}>}
 */
export async function fetchDurationDistribution(userId, startDate, endDate) {
  const res = await query(
    `SELECT
       CASE
         WHEN duration_sec IS NULL OR duration_sec = 0 THEN 'missed'
         WHEN duration_sec < 30 THEN 'under_30s'
         WHEN duration_sec < 60 THEN '30s_to_1m'
         WHEN duration_sec < 180 THEN '1m_to_3m'
         WHEN duration_sec < 300 THEN '3m_to_5m'
         WHEN duration_sec < 600 THEN '5m_to_10m'
         ELSE 'over_10m'
       END AS bucket,
       COUNT(*) AS count
     FROM call_logs
     WHERE user_id = $1
       AND started_at >= $2::date
       AND started_at < ($3::date + interval '1 day')
     GROUP BY bucket
     ORDER BY
       CASE bucket
         WHEN 'missed' THEN 0
         WHEN 'under_30s' THEN 1
         WHEN '30s_to_1m' THEN 2
         WHEN '1m_to_3m' THEN 3
         WHEN '3m_to_5m' THEN 4
         WHEN '5m_to_10m' THEN 5
         WHEN 'over_10m' THEN 6
       END`,
    [userId, startDate, endDate]
  );
  return res.rows.map((r) => ({ bucket: r.bucket, count: parseInt(r.count) || 0 }));
}
