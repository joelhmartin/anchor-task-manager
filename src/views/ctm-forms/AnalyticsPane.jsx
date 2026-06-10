/**
 * AnalyticsPane — CTM Form submission analytics
 */
import { useEffect, useState, useCallback } from 'react';
import { Alert, Box, Card, CardContent, Chip, Divider, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import ReactApexChart from 'react-apexcharts';
import SelectField from 'ui-component/extended/SelectField';
import StatusChip from 'ui-component/extended/StatusChip';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { getCtmFormAnalytics, getCtmFormHealth } from 'api/ctmForms';

const BLOCK_REASON_LABELS = {
  recaptcha_missing_token: 'reCAPTCHA: no token (privacy browser / blocker)',
  recaptcha_low_score: 'reCAPTCHA: low score (likely bot)',
  recaptcha_invalid_token: 'reCAPTCHA: invalid token',
  recaptcha_action_mismatch: 'reCAPTCHA: action mismatch',
  recaptcha_service_unavailable: 'reCAPTCHA: service unavailable',
  recaptcha_failed: 'reCAPTCHA: failed',
  ai_spam: 'AI spam filter',
  heuristic_spam: 'Heuristic spam filter'
};

// Ordered funnel stages with the funnel-event key that feeds each.
const FUNNEL_STAGES = [
  { key: 'rendered', label: 'Form loaded' },
  { key: 'submit_click', label: 'Submit clicked' },
  { key: 'post_start', label: 'Request sent' },
  { key: 'post_success', label: 'Accepted by server' }
];

function StatCard({ label, value, sub, color }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 140 }}>
      <CardContent sx={{ pb: '12px !important', pt: 1.5, px: 2 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h3" sx={{ color: color || 'text.primary', my: 0.25 }}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPane({ forms, initialFormId }) {
  const { showToast } = useToast();
  const [selectedFormId, setSelectedFormId] = useState(initialFormId || '');
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);

  const activeForms = forms.filter(f => f.status !== 'archived');

  const load = useCallback(async (id) => {
    if (!id) { setData(null); setHealth(null); return; }
    try {
      setLoading(true);
      const [result, healthResult] = await Promise.all([
        getCtmFormAnalytics(id),
        getCtmFormHealth(id).catch(() => null)
      ]);
      setData(result);
      setHealth(healthResult);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { if (selectedFormId) load(selectedFormId); }, [selectedFormId, load]);

  const summary = data?.summary || {};
  const total = parseInt(summary.total || 0, 10);
  const ctmSent = parseInt(summary.ctm_sent || 0, 10);
  const ctmFailed = parseInt(summary.ctm_failed || 0, 10);
  const emailSent = parseInt(summary.email_sent || 0, 10);

  const held = parseInt(summary.held || 0, 10);
  const review = parseInt(summary.review || 0, 10);
  const withSid = parseInt(summary.with_visitor_sid || 0, 10);

  const ctmRate = total > 0 ? Math.round((ctmSent / total) * 100) : 0;
  const emailRate = total > 0 ? Math.round((emailSent / total) * 100) : 0;
  const sidRate = total > 0 ? Math.round((withSid / total) * 100) : 0;

  const funnel = data?.funnel || {};
  const blockReasons = data?.blockReasons || [];

  // Build chart series — fill in zeros for days with no submissions
  const chartData = (() => {
    if (!data?.daily?.length) return { categories: [], series: [] };
    const dailyMap = {};
    for (const row of data.daily) dailyMap[row.day] = parseInt(row.count, 10);

    // Generate last 30 days
    const days = [];
    const counts = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(key.slice(5)); // MM-DD
      counts.push(dailyMap[key] || 0);
    }
    return { categories: days, series: counts };
  })();

  const chartOptions = {
    chart: { type: 'bar', toolbar: { show: false }, sparkline: { enabled: false } },
    plotOptions: { bar: { borderRadius: 3, columnWidth: '60%' } },
    colors: ['#2271b1'],
    xaxis: {
      categories: chartData.categories,
      labels: { rotate: -45, style: { fontSize: '10px' } },
      tickAmount: 10
    },
    yaxis: { labels: { style: { fontSize: '11px' } }, min: 0, forceNiceScale: true },
    tooltip: { y: { formatter: v => `${v} submission${v !== 1 ? 's' : ''}` } },
    dataLabels: { enabled: false },
    grid: { borderColor: '#f0f0f0' }
  };

  const firstAt = summary.first_at ? new Date(summary.first_at).toLocaleDateString() : '—';
  const lastAt = summary.last_at ? new Date(summary.last_at).toLocaleDateString() : '—';

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Analytics</Typography>

      <SelectField
        label="Select Form"
        value={selectedFormId}
        onChange={e => { setSelectedFormId(e.target.value); setData(null); }}
        fullWidth={false}
        sx={{ maxWidth: 400 }}
      >
        <MenuItem value="">— Select —</MenuItem>
        {activeForms.map(f => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
      </SelectField>

      {!selectedFormId ? (
        <Alert severity="info">Select a form to view analytics.</Alert>
      ) : loading ? (
        <Typography color="text.secondary">Loading...</Typography>
      ) : (
        <>
          {/* Stat cards */}
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <StatCard label="Total Submissions" value={total} sub={`First: ${firstAt} · Last: ${lastAt}`} />
            <StatCard label="CTM Sent" value={`${ctmRate}%`} sub={`${ctmSent} of ${total}`} color={ctmRate >= 90 ? 'success.main' : ctmRate >= 50 ? 'warning.main' : 'error.main'} />
            <StatCard label="CTM Failed" value={ctmFailed} color={ctmFailed > 0 ? 'error.main' : 'text.primary'} />
            <StatCard label="Held (spam)" value={held} sub={review > 0 ? `${review} flagged for review` : undefined} color={held > 0 ? 'warning.main' : 'text.primary'} />
            <StatCard label="Email Sent" value={`${emailRate}%`} sub={`${emailSent} of ${total}`} color={emailRate >= 90 ? 'success.main' : 'text.primary'} />
            <StatCard label="CTM Attribution" value={`${sidRate}%`} sub={`${withSid} with visitor_sid`} color={sidRate >= 50 ? 'success.main' : 'text.primary'} />
          </Stack>

          {/* CTM configuration health */}
          {health && (
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="subtitle2" gutterBottom>CTM Configuration Health</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <StatusChip status={health.published ? 'published' : 'inactive'} variant="outlined" label={health.published ? 'Published' : 'Not published'} />
                  <StatusChip status={health.hasReactor ? 'connected' : 'disconnected'} variant="outlined" label={health.hasReactor ? 'Reactor linked' : 'No reactor'} />
                  <StatusChip status={health.credentialsOk ? 'connected' : 'disconnected'} variant="outlined" label={health.credentialsOk ? 'CTM credentials OK' : 'CTM credentials missing'} />
                  <StatusChip status={health.ctmAccountNumber ? 'connected' : 'pending'} variant="outlined" label={health.ctmAccountNumber ? `Account ${health.ctmAccountNumber}` : 'No account number'} />
                  {health.pendingRetries > 0 && <StatusChip status="in_progress" variant="outlined" label={`${health.pendingRetries} retry queued`} />}
                  {health.ctmFailed > 0 && <StatusChip status="failed" variant="outlined" label={`${health.ctmFailed} CTM failures`} />}
                </Stack>
                {health.lastCtmError && !health.lastCtmSentAt && (
                  <Alert severity="warning" sx={{ mt: 1.5 }}>Last CTM error: {health.lastCtmError}</Alert>
                )}
                {(!health.hasReactor || !health.credentialsOk) && health.published && (
                  <Alert severity="error" sx={{ mt: 1.5 }}>This form is published but not connected to CTM — submissions are stored locally but won&apos;t reach CTM.</Alert>
                )}
              </CardContent>
            </Card>
          )}

          {/* Conversion funnel — loaded → clicked → sent → accepted (last 30 days) */}
          {(funnel.rendered || funnel.submit_click || funnel.post_start) ? (
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="subtitle2" gutterBottom>Conversion Funnel — Last 30 Days</Typography>
                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  {FUNNEL_STAGES.map((stage, i) => {
                    const count = funnel[stage.key] || 0;
                    const prev = i === 0 ? count : (funnel[FUNNEL_STAGES[i - 1].key] || 0);
                    const pct = prev > 0 ? Math.round((count / prev) * 100) : null;
                    return (
                      <StatCard
                        key={stage.key}
                        label={stage.label}
                        value={count}
                        sub={i > 0 && pct !== null ? `${pct}% of prior step` : undefined}
                        color={i > 0 && pct !== null && pct < 50 ? 'warning.main' : 'text.primary'}
                      />
                    );
                  })}
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {funnel.validation_failed > 0 && <Chip size="small" variant="outlined" color="warning" label={`${funnel.validation_failed} stopped by form validation`} />}
                  {funnel.recaptcha_missing > 0 && <Tooltip title="No reCAPTCHA token was produced in the browser (privacy browser / blocker / outage)."><Chip size="small" variant="outlined" color="info" label={`${funnel.recaptcha_missing} missing reCAPTCHA token`} /></Tooltip>}
                  {funnel.blocked_shown > 0 && <Chip size="small" variant="outlined" color="error" label={`${funnel.blocked_shown} shown blocked message`} />}
                  {funnel.duplicate_shown > 0 && <Chip size="small" variant="outlined" label={`${funnel.duplicate_shown} duplicate`} />}
                  {funnel.post_failed > 0 && <Chip size="small" variant="outlined" color="error" label={`${funnel.post_failed} request failed`} />}
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          {/* Why submissions were held/flagged */}
          {blockReasons.length > 0 && (
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="subtitle2" gutterBottom>Why Submissions Were Held / Flagged — Last 30 Days</Typography>
                <Divider sx={{ mb: 1 }} />
                <Stack spacing={0.5}>
                  {blockReasons.map((br) => (
                    <Stack key={br.reason} direction="row" justifyContent="space-between">
                      <Typography variant="body2">{BLOCK_REASON_LABELS[br.reason] || br.reason}</Typography>
                      <Typography variant="body2" fontWeight={600}>{br.count}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Daily chart */}
          {total > 0 ? (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Submissions — Last 30 Days</Typography>
              <ReactApexChart
                type="bar"
                height={220}
                series={[{ name: 'Submissions', data: chartData.series }]}
                options={chartOptions}
              />
            </Box>
          ) : (
            <Alert severity="info">No submissions yet for this form.</Alert>
          )}
        </>
      )}
    </Stack>
  );
}
