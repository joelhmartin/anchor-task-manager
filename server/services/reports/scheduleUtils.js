export function nextRunAt(schedule, fromDate = new Date()) {
  if (!schedule) return null;
  const d = new Date(fromDate);
  const hour = schedule.hour ?? 9;
  d.setHours(hour, 0, 0, 0);

  if (schedule.freq === 'daily') {
    if (d <= fromDate) d.setDate(d.getDate() + 1);
    return d;
  }

  if (schedule.freq === 'weekly') {
    const day = schedule.day_of_week ?? 1;
    d.setDate(d.getDate() + 1);
    while (d.getDay() !== day) d.setDate(d.getDate() + 1);
    return d;
  }

  if (schedule.freq === 'monthly') {
    const dom = Math.max(1, Math.min(28, schedule.day_of_month ?? 1));
    d.setDate(dom);
    if (d <= fromDate) d.setMonth(d.getMonth() + 1);
    return d;
  }

  return null;
}
