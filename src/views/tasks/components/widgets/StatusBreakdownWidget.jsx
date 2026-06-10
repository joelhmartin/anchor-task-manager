import Chart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { WIDGET_PALETTE } from 'constants/taskDefaults';

export default function StatusBreakdownWidget({ data }) {
  const theme = useTheme();

  if (!data?.length) {
    return <Typography variant="body2" color="text.secondary">No status data available.</Typography>;
  }

  const labels = data.map((d) => d.status || 'Unknown');
  const series = data.map((d) => Number(d.count) || 0);

  const options = {
    chart: { type: 'donut', background: 'transparent' },
    labels,
    colors: WIDGET_PALETTE.slice(0, labels.length),
    legend: { position: 'bottom', fontSize: '12px', labels: { colors: theme.palette.text.secondary } },
    tooltip: { y: { formatter: (val) => `${val} items` } },
    plotOptions: { pie: { donut: { size: '55%' } } },
    dataLabels: { enabled: true, formatter: (val) => `${Math.round(val)}%` },
    stroke: { show: false }
  };

  return <Chart options={options} series={series} type="donut" height={280} />;
}
