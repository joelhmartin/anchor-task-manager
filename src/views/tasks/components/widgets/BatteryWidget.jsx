import { Box, LinearProgress, Stack, Typography } from '@mui/material';

export default function BatteryWidget({ data }) {
  if (!data) return null;
  const { total, done, percent } = data;

  const color = percent >= 80 ? 'success' : percent >= 40 ? 'primary' : 'warning';

  return (
    <Stack spacing={1.5} alignItems="center" sx={{ py: 1 }}>
      <Typography variant="h2" sx={{ fontWeight: 700, color: `${color}.main` }}>
        {percent}%
      </Typography>
      <Box sx={{ width: '100%', px: 1 }}>
        <LinearProgress
          variant="determinate"
          value={percent}
          color={color}
          sx={{ height: 12, borderRadius: 6, bgcolor: 'action.hover' }}
        />
      </Box>
      <Stack direction="row" spacing={2} justifyContent="center">
        <Typography variant="caption" color="text.secondary">
          {done} done
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {total - done} remaining
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {total} total
        </Typography>
      </Stack>
    </Stack>
  );
}
