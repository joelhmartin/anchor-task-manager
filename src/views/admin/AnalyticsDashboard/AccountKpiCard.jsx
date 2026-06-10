import PropTypes from 'prop-types';
import { Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { CARD_SHADOW } from './chartTheme';
import {
  computeDelta,
  formatDeltaPercent,
  getDeltaOutcome,
  getMetricPolarity,
  getOutcomeColor
} from './analyticsComparison';

/**
 * Compact "stat tile" KPI card used across Paid Ads tabs (Meta/Google).
 *
 * Standardizes height/spacing/border so KPI rows line up across tabs and
 * renders an outcome-colored delta caption when both metric and previous
 * are supplied.
 */
export default function AccountKpiCard({ label, value, color = 'primary', metric, current, previous }) {
  const theme = useTheme();
  const accent = theme.palette[color]?.main || color;

  const upIsGood = metric ? getMetricPolarity(metric) : true;
  const delta = computeDelta(current, previous);
  const outcome = getDeltaOutcome(delta, upIsGood);
  const deltaColor = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
  const deltaStr = previous != null ? formatDeltaPercent(current, previous) : null;
  const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';

  return (
    <Paper
      sx={{
        p: 1.5,
        textAlign: 'center',
        borderRadius: 2,
        boxShadow: CARD_SHADOW,
        borderBottom: `3px solid ${accent}`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}
    >
      <Typography variant="h4" fontWeight={700}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {deltaStr && (
        <Typography variant="caption" sx={{ color: deltaColor, fontWeight: 600, mt: 0.5 }}>
          {arrow} {deltaStr.replace(/^[+-]/, '')} vs prev
        </Typography>
      )}
    </Paper>
  );
}

AccountKpiCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  color: PropTypes.string,
  metric: PropTypes.string,
  current: PropTypes.number,
  previous: PropTypes.number
};
