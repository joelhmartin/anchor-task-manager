export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'UTC', label: 'UTC' }
];

export const DEFAULT_TIMEZONE = 'America/New_York';

export const SEND_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
}));

export const DEFAULT_SEND_HOUR = 9;
