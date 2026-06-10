import { useState, useEffect, useCallback } from 'react';
import { Stack, Typography, Alert } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { fetchInsights } from 'api/analytics';

export default function InsightsCard({ userId, dateRange, comparisonRange }) {
  const { showToast } = useToast();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadRuleAlerts = useCallback(async () => {
    if (!userId || !dateRange?.start || !dateRange?.end) return;
    setLoading(true);
    try {
      const params = { start: dateRange.start, end: dateRange.end };
      if (comparisonRange?.start && comparisonRange?.end) {
        params.compareStart = comparisonRange.start;
        params.compareEnd = comparisonRange.end;
      }
      const result = await fetchInsights(userId, params);
      setAlerts(result.alerts || []);
    } catch (err) {
      console.error('[InsightsCard] rule alerts error:', err);
      showToast('Failed to load insights', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, dateRange, comparisonRange]);

  useEffect(() => {
    loadRuleAlerts();
  }, [loadRuleAlerts]);

  return (
    <MainCard
      title={
        <Stack direction="row" spacing={1} alignItems="center">
          <LightbulbIcon fontSize="small" color="warning" />
          <Typography variant="h4">Insights</Typography>
        </Stack>
      }
    >
      <Stack spacing={2}>
        {loading && (
          <Typography variant="body2" color="text.secondary">
            Evaluating performance...
          </Typography>
        )}

        {!loading && alerts.length === 0 && (
          <EmptyState
            icon={LightbulbIcon}
            title="No alerts"
            message="Everything looks good! No performance issues detected for this period."
          />
        )}

        {alerts.map((alert, idx) => (
          <Alert key={idx} severity={alert.severity} variant="outlined">
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {alert.title}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {alert.description}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, fontStyle: 'italic' }} color="text.secondary">
              {alert.recommendation}
            </Typography>
          </Alert>
        ))}
      </Stack>
    </MainCard>
  );
}
