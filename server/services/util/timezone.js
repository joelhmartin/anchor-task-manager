export const DEFAULT_TZ = 'America/New_York';

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(tz) {
  if (!isValidTimeZone(tz)) throw new Error('Timezone is invalid');
}

export function resolveTimeZone(...candidates) {
  for (const c of candidates) if (isValidTimeZone(c)) return c;
  return DEFAULT_TZ;
}

// Wall-clock {year, month, day, hour, minute, second} of `date` as seen in `tz`.
export function getZonedParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  // Intl can emit '24' for midnight in some locales; normalize to 0.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

// Given wall-clock parts in `tz`, return the UTC Date whose representation in
// `tz` matches. Two passes handle DST transitions.
export function zonedWallClockToUTC(year, month, day, hour, tz) {
  const minute = 0;
  const second = 0;
  const target = Date.UTC(year, month - 1, day, hour, minute, second);

  const seen1 = getZonedParts(new Date(target), tz);
  const seen1Utc = Date.UTC(seen1.year, seen1.month - 1, seen1.day, seen1.hour, seen1.minute, seen1.second);
  const offset1 = seen1Utc - target;
  let corrected = target - offset1;

  const seen2 = getZonedParts(new Date(corrected), tz);
  const seen2Utc = Date.UTC(seen2.year, seen2.month - 1, seen2.day, seen2.hour, seen2.minute, seen2.second);
  const offset2 = seen2Utc - corrected;
  if (offset2 !== offset1) corrected = target - offset2;

  return new Date(corrected);
}

// Add `days` calendar days to `from` in `tz`, then set the wall-clock hour.
// Returns a UTC Date.
export function addDaysAtHourInTz(from, days, hour, tz) {
  const parts = getZonedParts(from, tz);
  // JS Date arithmetic on local UTC parts handles month/year rollover & DST.
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + Math.max(0, days));
  return zonedWallClockToUTC(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, tz);
}
