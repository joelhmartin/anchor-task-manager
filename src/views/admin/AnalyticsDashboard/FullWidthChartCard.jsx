import PropTypes from 'prop-types';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CARD_SHADOW } from './chartTheme';
import useChartContainer from './useChartContainer';

/**
 * FullWidthChartCard — standalone full-width chart card with no Grid wrapper.
 *
 * Use this for single charts that should span the full pane width (not part
 * of a 2-column Grid). Applies the same resize/CSS-override fix as ChartCard.
 */
export default function FullWidthChartCard({ title, subtitle, sx, headerAction, children }) {
  const { ref, sx: containerSx } = useChartContainer();

  return (
    <Paper
      sx={{
        p: 3,
        mb: 3,
        borderRadius: 2,
        boxShadow: CARD_SHADOW,
        width: '100%',
        minWidth: 0,
        ...(sx || {})
      }}
    >
      {(title || headerAction) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            mb: subtitle ? 0.25 : 1,
            gap: 1
          }}
        >
          {title && (
            <Typography variant="h4" fontWeight={600}>
              {title}
            </Typography>
          )}
          {headerAction && <Box sx={{ flexShrink: 0 }}>{headerAction}</Box>}
        </Box>
      )}
      {subtitle && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {subtitle}
        </Typography>
      )}
      <Box ref={ref} sx={containerSx}>
        {children}
      </Box>
    </Paper>
  );
}

FullWidthChartCard.propTypes = {
  title: PropTypes.node,
  subtitle: PropTypes.node,
  sx: PropTypes.object,
  headerAction: PropTypes.node,
  children: PropTypes.node.isRequired
};
