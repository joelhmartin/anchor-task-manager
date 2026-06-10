import { Grid, Paper, Typography, Stack, Skeleton, Box, Chip } from '@mui/material';
import { IconUsers, IconCurrencyDollar, IconTarget, IconEye, IconPercentage } from '@tabler/icons-react';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { alpha } from '@mui/material/styles';
import { CARD_SHADOW, useChartTheme } from './chartTheme';

const KPI_CONFIG = [
  { key: 'totalLeads', label: 'Qualified Leads', icon: IconUsers, format: (v) => v.toLocaleString(), color: 'primary', upIsGood: true },
  {
    key: 'totalSpend',
    label: 'Ad Spend',
    icon: IconCurrencyDollar,
    format: (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    color: 'warning',
    upIsGood: false
  },
  { key: 'costPerLead', label: 'CPQL', icon: IconTarget, format: (v) => `$${v.toFixed(2)}`, color: 'error', upIsGood: false },
  { key: 'totalSessions', label: 'Sessions', icon: IconEye, format: (v) => v.toLocaleString(), color: 'info', upIsGood: true },
  {
    key: 'conversionRate',
    label: 'Engaged Conversion Rate',
    icon: IconPercentage,
    format: (v) => `${v.toFixed(2)}%`,
    color: 'success',
    upIsGood: true
  }
];

function DeltaChip({ current, previous, upIsGood }) {
  const theme = useChartTheme();
  if (!previous || previous === 0) return null;

  const delta = ((current - previous) / previous) * 100;

  if (!isFinite(delta) || Math.abs(delta) < 0.01) return null;

  const isUp = delta > 0;
  const isGood = isUp === upIsGood;
  const ArrowIcon = isUp ? ArrowUpwardIcon : ArrowDownwardIcon;

  return (
    <Chip
      size="small"
      icon={<ArrowIcon sx={{ fontSize: '14px !important' }} />}
      label={`${Math.abs(delta).toFixed(1)}%`}
      sx={{
        height: 22,
        fontSize: '0.7rem',
        fontWeight: 700,
        bgcolor: alpha(isGood ? theme.palette.success.main : theme.palette.error.main, 0.12),
        color: isGood ? 'success.dark' : 'error.dark',
        '& .MuiChip-icon': {
          color: 'inherit',
          ml: 0.5
        },
        borderRadius: '6px'
      }}
    />
  );
}

export default function ComparisonKpiCards({ kpis, comparisonKpis, loading, config = KPI_CONFIG, sx }) {
  const theme = useChartTheme();

  return (
    <Grid container spacing={2} sx={sx}>
      {config.map(({ key, label, icon: Icon, format, color, upIsGood }) => (
        <Grid size={{ xs: 6, sm: 4, md: 4, lg: 'grow' }} key={key}>
          <Paper
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 2,
              boxShadow: CARD_SHADOW,
              borderBottom: `3px solid ${theme.palette[color].main}`,
              position: 'relative',
              overflow: 'hidden',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center'
            }}
          >
            {loading ? (
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={{ xs: 1, lg: 2 }}
                alignItems="center"
                sx={{ textAlign: { xs: 'center', lg: 'left' } }}
              >
                <Skeleton variant="rounded" width={48} height={48} sx={{ borderRadius: '12px' }} />
                <Stack spacing={0.5} sx={{ flex: { lg: 1 }, width: '100%', alignItems: { xs: 'center', lg: 'flex-start' } }}>
                  <Skeleton width={100} height={36} />
                  <Skeleton width={70} height={18} />
                </Stack>
              </Stack>
            ) : (
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={{ xs: 1, lg: 2 }}
                alignItems="center"
                sx={{ textAlign: { xs: 'center', lg: 'left' } }}
              >
                {/* Icon with gradient background */}
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `linear-gradient(135deg, ${alpha(theme.palette[color].main, 0.15)} 0%, ${alpha(theme.palette[color].main, 0.05)} 100%)`,
                    flexShrink: 0
                  }}
                >
                  <Icon size={24} color={theme.palette[color].main} stroke={1.5} />
                </Box>
                {/* Value + label */}
                <Stack spacing={0.25} sx={{ flex: { lg: 1 }, minWidth: 0, width: '100%' }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    flexWrap="wrap"
                    justifyContent={{ xs: 'center', lg: 'flex-start' }}
                  >
                    <Typography variant="h2" fontWeight={700} sx={{ lineHeight: 1.2 }}>
                      {format(kpis?.[key] ?? 0)}
                    </Typography>
                    {comparisonKpis && <DeltaChip current={kpis?.[key] ?? 0} previous={comparisonKpis?.[key] ?? 0} upIsGood={upIsGood} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    {label}
                  </Typography>
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}
