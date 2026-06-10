import { useMemo } from 'react';
import Chart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { clientLabel } from 'hooks/useClientLabel';
import { WIDGET_PALETTE } from 'constants/taskDefaults';

export default function WorkloadWidget({ data }) {
  const theme = useTheme();

  const { categories, series } = useMemo(() => {
    if (!data?.length) return { categories: [], series: [] };

    // Group by person, then collect unique statuses
    const byPerson = {};
    const allStatuses = new Set();
    for (const row of data) {
      const name = clientLabel(row) || 'Unassigned';
      if (!byPerson[name]) byPerson[name] = {};
      const status = row.status || 'Unknown';
      allStatuses.add(status);
      byPerson[name][status] = (byPerson[name][status] || 0) + Number(row.count || 0);
    }

    const people = Object.keys(byPerson);
    const statuses = [...allStatuses];
    const seriesArr = statuses.map((status) => ({
      name: status,
      data: people.map((p) => byPerson[p][status] || 0)
    }));

    return { categories: people, series: seriesArr };
  }, [data]);

  if (!categories.length) {
    return <Typography variant="body2" color="text.secondary">No workload data available.</Typography>;
  }

  const options = {
    chart: { type: 'bar', stacked: true, background: 'transparent', toolbar: { show: false } },
    plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '65%' } },
    colors: WIDGET_PALETTE.slice(0, series.length),
    xaxis: { categories, labels: { style: { colors: theme.palette.text.secondary } } },
    yaxis: { labels: { style: { colors: theme.palette.text.secondary } } },
    legend: { position: 'bottom', fontSize: '11px', labels: { colors: theme.palette.text.secondary } },
    tooltip: { y: { formatter: (val) => `${val} items` } },
    grid: { borderColor: theme.palette.divider }
  };

  return <Chart options={options} series={series} type="bar" height={Math.max(200, categories.length * 50)} />;
}
