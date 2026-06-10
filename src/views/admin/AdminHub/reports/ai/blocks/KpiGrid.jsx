import { Grid, Card, Typography, Stack } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';

const dirIcon = { up: TrendingUpIcon, down: TrendingDownIcon, flat: TrendingFlatIcon };

export default function KpiGrid({ title, items = [] }) {
  return (
    <>
      {title && <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{title}</Typography>}
      <Grid container spacing={2}>
        {items.map((it, i) => {
          const Icon = dirIcon[it.direction] || TrendingFlatIcon;
          return (
            <Grid item xs={12} sm={6} md={3} key={i}>
              <Card sx={{ p: 2 }}>
                <Typography variant="caption" color="text.secondary">{it.label}</Typography>
                <Typography variant="h4" sx={{ mt: 0.5 }}>{it.value}</Typography>
                {it.delta && (
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                    <Icon fontSize="small" />
                    <Typography variant="body2">{it.delta}</Typography>
                  </Stack>
                )}
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}
