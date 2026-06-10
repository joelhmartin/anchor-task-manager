import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const METRIC_LABELS = {
  open_items: 'Open Items',
  completed_items: 'Completed Items',
  overdue_items: 'Overdue Items'
};

export default function KpiNumberWidget({ data }) {
  const value = data?.value ?? '—';
  const metric = data?.metric || '';
  const label = METRIC_LABELS[metric] || metric || 'Metric';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 3 }}>
      <Typography variant="h1" sx={{ fontWeight: 700, fontSize: '3.5rem', lineHeight: 1 }}>
        {value}
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 1, textTransform: 'capitalize' }}>
        {label}
      </Typography>
    </Box>
  );
}
