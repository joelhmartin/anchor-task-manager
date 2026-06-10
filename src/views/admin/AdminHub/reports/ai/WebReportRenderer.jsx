import { Box, Typography, Divider } from '@mui/material';
import KpiGrid from './blocks/KpiGrid';
import ChartBlock from './blocks/ChartBlock';
import Narrative from './blocks/Narrative';
import TableBlock from './blocks/TableBlock';
import Callout from './blocks/Callout';

export default function WebReportRenderer({ payload }) {
  if (!payload) return null;
  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto', p: 3 }}>
      <Typography variant="h3" gutterBottom>{payload.title}</Typography>
      {payload.client?.business_name && (
        <Typography variant="subtitle1" color="text.secondary">
          {payload.client.business_name} · {payload.period?.from} → {payload.period?.to}
        </Typography>
      )}
      {payload.summary && <Typography sx={{ mt: 2 }}>{payload.summary}</Typography>}
      <Divider sx={{ my: 3 }} />
      {payload.sections?.map((s, i) => {
        switch (s.type) {
          case 'kpi_grid':  return <KpiGrid key={i} {...s} />;
          case 'chart':     return <ChartBlock key={i} {...s} />;
          case 'narrative': return <Narrative key={i} {...s} />;
          case 'table':     return <TableBlock key={i} {...s} />;
          case 'callout':   return <Callout key={i} {...s} />;
          default:          return null;
        }
      })}
    </Box>
  );
}
