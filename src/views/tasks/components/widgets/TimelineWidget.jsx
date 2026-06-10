import { useMemo } from 'react';
import { Box, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import { common } from '@mui/material/colors';
import { CHART_PALETTE } from 'constants/taskDefaults';

function dateToX(date, minDate, totalDays, width) {
  const d = new Date(date);
  const offset = (d - minDate) / (1000 * 60 * 60 * 24);
  return (offset / totalDays) * width;
}

export default function TimelineWidget({ data }) {
  const theme = useTheme();

  const { items, minDate, totalDays } = useMemo(() => {
    if (!data?.length) return { items: [], minDate: new Date(), totalDays: 30 };

    const dates = data.flatMap((it) => {
      const arr = [];
      if (it.start_date) arr.push(new Date(it.start_date));
      if (it.due_date) arr.push(new Date(it.due_date));
      return arr;
    }).filter((d) => !isNaN(d));

    if (!dates.length) return { items: data, minDate: new Date(), totalDays: 30 };

    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    min.setDate(min.getDate() - 2);
    max.setDate(max.getDate() + 2);
    const days = Math.max(7, (max - min) / (1000 * 60 * 60 * 24));

    return { items: data, minDate: min, totalDays: days };
  }, [data]);

  if (!items.length) {
    return <Typography variant="caption" color="text.secondary">No items with dates</Typography>;
  }

  const BAR_HEIGHT = 18;
  const ROW_HEIGHT = 24;
  const WIDTH = 400;
  const chartHeight = Math.min(items.length * ROW_HEIGHT + 20, 240);

  const COLORS = CHART_PALETTE.slice(0, 6);

  return (
    <Box sx={{ overflow: 'auto', maxHeight: 260 }}>
      <svg width="100%" viewBox={`0 0 ${WIDTH} ${chartHeight}`} style={{ minWidth: 300 }}>
        {/* Today line */}
        {(() => {
          const todayX = dateToX(new Date(), minDate, totalDays, WIDTH);
          if (todayX >= 0 && todayX <= WIDTH) {
            return (
              <line
                x1={todayX} y1={0} x2={todayX} y2={chartHeight}
                stroke={theme.palette.error.main} strokeWidth={1} strokeDasharray="3 3" opacity={0.5}
              />
            );
          }
          return null;
        })()}

        {items.slice(0, 10).map((item, i) => {
          const y = i * ROW_HEIGHT + 4;
          const start = item.start_date ? new Date(item.start_date) : null;
          const end = item.due_date ? new Date(item.due_date) : null;
          const color = COLORS[i % COLORS.length];

          if (start && end) {
            const x1 = dateToX(start, minDate, totalDays, WIDTH);
            const barWidth = Math.max(6, dateToX(end, minDate, totalDays, WIDTH) - x1);
            return (
              <g key={item.id}>
                <Tooltip title={`${item.name} (${item.status})`}>
                  <rect x={x1} y={y} width={barWidth} height={BAR_HEIGHT} rx={3} fill={color} opacity={0.8} />
                </Tooltip>
                <text x={x1 + 4} y={y + 13} fontSize={9} fill={common.white} style={{ pointerEvents: 'none' }}>
                  {item.name.length > 20 ? item.name.slice(0, 20) + '…' : item.name}
                </text>
              </g>
            );
          }

          // Due date only — render as diamond marker
          if (end) {
            const x = dateToX(end, minDate, totalDays, WIDTH);
            return (
              <g key={item.id}>
                <Tooltip title={`${item.name} — due ${end.toLocaleDateString()}`}>
                  <circle cx={x} cy={y + BAR_HEIGHT / 2} r={5} fill={color} />
                </Tooltip>
                <text x={x + 8} y={y + 13} fontSize={9} fill={theme.palette.text.secondary}>
                  {item.name.length > 25 ? item.name.slice(0, 25) + '…' : item.name}
                </text>
              </g>
            );
          }

          return null;
        })}
      </svg>
      {items.length > 10 && (
        <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
          +{items.length - 10} more items
        </Typography>
      )}
    </Box>
  );
}
