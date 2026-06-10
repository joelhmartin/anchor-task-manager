import Chart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { WIDGET_PALETTE } from 'constants/taskDefaults';

export default function LabelDistributionWidget({ data }) {
  const theme = useTheme();

  if (!data?.length) {
    return <Typography variant="body2" color="text.secondary">No label data available.</Typography>;
  }

  const categories = data.map((d) => d.label || 'Unknown');
  const series = [{ name: 'Items', data: data.map((d) => Number(d.count) || 0) }];
  const colors = data.map((d, i) => d.color || WIDGET_PALETTE[i % WIDGET_PALETTE.length]);

  const options = {
    chart: { type: 'bar', background: 'transparent', toolbar: { show: false } },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '55%', distributed: true } },
    colors,
    dataLabels: { enabled: true, style: { fontSize: '11px' } },
    xaxis: {
      categories,
      labels: { style: { colors: theme.palette.text.secondary, fontSize: '11px' }, rotate: -45, rotateAlways: categories.length > 5 }
    },
    yaxis: { labels: { style: { colors: theme.palette.text.secondary } } },
    legend: { show: false },
    tooltip: { y: { formatter: (val) => `${val} items` } },
    grid: { borderColor: theme.palette.divider }
  };

  return <Chart options={options} series={series} type="bar" height={280} />;
}
