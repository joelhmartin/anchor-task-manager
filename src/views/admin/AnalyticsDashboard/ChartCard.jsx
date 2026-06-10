import PropTypes from 'prop-types';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CARD_SHADOW } from './chartTheme';
import useChartContainer from './useChartContainer';

/**
 * ChartCard — single source of truth for chart grid items in the analytics dashboard.
 *
 * Wraps a chart (or any content) in a properly-sized MUI v7 Grid item + Paper,
 * with flexbox shrink fixes (minWidth: 0) and a content Box so ApexCharts
 * measures its container correctly.
 *
 * Usage:
 *   <Grid container spacing={3}>
 *     <ChartCard title="Meta Spend by Client">
 *       <Chart options={...} series={...} type="bar" height={320} width="100%" />
 *     </ChartCard>
 *     <ChartCard title="Spend Share" span={{ xs: 12, md: 6 }}>
 *       <Chart ... />
 *     </ChartCard>
 *   </Grid>
 *
 * @param {string|node} title - section title
 * @param {string|node} [subtitle] - optional subtitle under title
 * @param {object|number|string} [span] - Grid size prop. Defaults to { xs: 12, md: 6 }.
 * @param {object} [paperSx] - extra sx merged into the Paper wrapper
 * @param {object} [sx] - extra sx on the inner content Box
 * @param {object} [headerAction] - optional node rendered right of title (e.g., a toggle)
 */
export default function ChartCard({
  title,
  subtitle,
  span = { xs: 12, md: 6 },
  paperSx,
  sx,
  headerAction,
  children
}) {
  const { ref: contentRef, sx: containerSx } = useChartContainer();

  return (
    <Grid size={span} sx={{ minWidth: 0, flex: 1 }}>
      <Paper
        sx={{
          p: 3,
          borderRadius: 2,
          boxShadow: CARD_SHADOW,
          height: '100%',
          width: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          ...(paperSx || {})
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
        <Box ref={contentRef} sx={{ ...containerSx, flex: 1, ...(sx || {}) }}>
          {children}
        </Box>
      </Paper>
    </Grid>
  );
}

ChartCard.propTypes = {
  title: PropTypes.node,
  subtitle: PropTypes.node,
  span: PropTypes.oneOfType([PropTypes.object, PropTypes.number, PropTypes.string]),
  paperSx: PropTypes.object,
  sx: PropTypes.object,
  headerAction: PropTypes.node,
  children: PropTypes.node.isRequired
};
