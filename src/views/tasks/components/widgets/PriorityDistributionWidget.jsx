import Chart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';
import { grey } from '@mui/material/colors';
import Typography from '@mui/material/Typography';
import { PRIORITY_PALETTE } from 'constants/taskDefaults';

export default function PriorityDistributionWidget({ data }) {
  const theme = useTheme();

  if (!data?.length) {
    return <Typography variant="body2" color="text.secondary">No priority data available.</Typography>;
  }

  const categories = data.map((d) => d.label || 'Unknown');
  const series = [{ name: 'Items', data: data.map((d) => Number(d.count) || 0) }];
  const colors = data.map((d, i) => d.color || PRIORITY_PALETTE[i] || grey[500]);

  const options = {
    chart: { type: 'bar', background: 'transparent', toolbar: { show: false } },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '60%', distributed: true } },
    colors,
    dataLabels: { enabled: true, style: { fontSize: '12px' } },
    xaxis: { categories, labels: { style: { colors: theme.palette.text.secondary } } },
    yaxis: { labels: { style: { colors: theme.palette.text.secondary } } },
    legend: { show: false },
    tooltip: { y: { formatter: (val) => `${val} items` } },
    grid: { borderColor: theme.palette.divider }
  };

  return <Chart options={options} series={series} type="bar" height={280} />;
}
