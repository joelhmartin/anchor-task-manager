import { Grid, Paper, Typography, Stack, Skeleton, Box } from '@mui/material';
import { IconPhone, IconPhoneCheck, IconPhoneOff, IconClock } from '@tabler/icons-react';
import { useTheme, alpha } from '@mui/material/styles';
import { CARD_SHADOW } from './chartTheme';
import {
  computeDelta,
  formatDeltaPercent,
  getDeltaOutcome,
  getMetricPolarity,
  getOutcomeColor
} from './analyticsComparison';

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const STATS = [
  { key: 'totalCalls', label: 'Total Calls', icon: IconPhone, color: 'primary', metric: 'totalCalls' },
  { key: 'qualifiedCalls', label: 'Qualified', icon: IconPhoneCheck, color: 'success', metric: 'qualifiedCalls' },
  { key: 'missedCalls', label: 'Missed', icon: IconPhoneOff, color: 'error', metric: 'missedCalls' },
  { key: 'avgDuration', label: 'Avg Duration', icon: IconClock, color: 'info', format: formatDuration, metric: 'avgDuration' }
];

export default function CallSummaryCard({ ctmData, comparisonCtmData, loading }) {
  const theme = useTheme();

  return (
    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
      <Typography variant="h4" fontWeight={600} sx={{ mb: 2 }}>
        Call Summary (CTM)
      </Typography>
      {loading ? (
        <Grid container spacing={2}>
          {STATS.map((s) => (
            <Grid size={6} key={s.key}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Skeleton variant="rounded" width={48} height={48} sx={{ borderRadius: '12px' }} />
                <Stack spacing={0.5}>
                  <Skeleton width={60} height={28} />
                  <Skeleton width={80} height={16} />
                </Stack>
              </Stack>
            </Grid>
          ))}
        </Grid>
      ) : !ctmData ? (
        <Typography color="text.secondary">No call data available</Typography>
      ) : (
        <Grid container spacing={2}>
          {STATS.map(({ key, label, icon: Icon, color, format, metric }) => {
            const themeColor = theme.palette[color].main;
            const current = ctmData[key];
            const previous = comparisonCtmData ? comparisonCtmData[key] : undefined;
            const upIsGood = getMetricPolarity(metric);
            const delta = computeDelta(current, previous);
            const outcome = getDeltaOutcome(delta, upIsGood);
            const deltaColor = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
            const deltaStr = previous != null ? formatDeltaPercent(current, previous) : null;
            const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';
            return (
              <Grid size={6} key={key}>
                <Stack direction="row" spacing={2} alignItems="center">
                  {/* Icon with gradient background */}
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `linear-gradient(135deg, ${alpha(themeColor, 0.15)} 0%, ${alpha(themeColor, 0.05)} 100%)`,
                      flexShrink: 0
                    }}
                  >
                    <Icon size={24} color={themeColor} stroke={1.5} />
                  </Box>
                  {/* Value + label + delta */}
                  <Stack spacing={0.25}>
                    <Typography variant="h3" fontWeight={700} sx={{ lineHeight: 1.2 }}>
                      {format ? format(current) : (current ?? 0).toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                      {label}
                    </Typography>
                    {deltaStr && (
                      <Typography variant="caption" sx={{ color: deltaColor, fontWeight: 600 }}>
                        {arrow} {deltaStr.replace(/^[+-]/, '')} vs prev
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Paper>
  );
}
