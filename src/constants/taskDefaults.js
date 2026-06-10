// Shared task platform constants — single source of truth for status labels, colors, and formatters.

import { blue, green, orange, red, purple, cyan, brown, blueGrey, grey, deepPurple } from '@mui/material/colors';

// ── Brand / accent colors ──────────────────────────────────────────────────────
// The only literal hex in the task subsystem lives here. These are Monday-style
// status accents plus the MUI v5 default warning orange — none have a
// `@mui/material/colors` equivalent. Everything else below references the stock
// Material palette so the task views keep their existing Material-style look
// (the task UI predates the app's custom teal theme and deliberately uses the
// standard Material colors for charts, automations, and timelines).
export const TASK_DONE_COLOR = '#00c875'; // "Done / complete" green
export const TASK_BLOCKED_COLOR = '#e2445c'; // "Stuck / blocked" red
export const WARNING_ACCENT_COLOR = '#ed6c02'; // bright actionable warning orange
export const DEFAULT_LABEL_COLOR = '#808080'; // fallback when a label has no color

export const DEFAULT_STATUS_LABELS = [
  { id: 'default-todo', label: 'To Do', color: DEFAULT_LABEL_COLOR, order_index: 0, is_done_state: false },
  { id: 'default-working', label: 'Working on it', color: '#fdab3d', order_index: 1, is_done_state: false },
  { id: 'default-stuck', label: 'Stuck', color: TASK_BLOCKED_COLOR, order_index: 2, is_done_state: false },
  { id: 'default-done', label: 'Done', color: TASK_DONE_COLOR, order_index: 3, is_done_state: true },
  { id: 'default-needs-attention', label: 'Needs Attention', color: '#ff642e', order_index: 4, is_done_state: false }
];

const LEGACY_COLOR_MAP = {
  done: TASK_DONE_COLOR,
  working: '#fdab3d',
  blocked: TASK_BLOCKED_COLOR,
  stuck: TASK_BLOCKED_COLOR,
  needs_attention: '#ff642e',
  todo: DEFAULT_LABEL_COLOR
};

export function getStatusColor(status, statusLabels = []) {
  const labels = statusLabels.length ? statusLabels : DEFAULT_STATUS_LABELS;
  const match = labels.find((l) => l.label === status);
  if (match) {
    return { bg: match.color, fg: '#ffffff' };
  }
  return { bg: LEGACY_COLOR_MAP[status] || DEFAULT_LABEL_COLOR, fg: '#ffffff' };
}

// ── Task view color helpers ─────────────────────────────────────────────────────

// Automation flow / step builder node colors (FlowBuilder + StepBuilder).
export const AUTOMATION_NODE_COLORS = {
  trigger: green[800], // #2e7d32
  action: blue[700], // #1976d2
  if: WARNING_ACCENT_COLOR, // #ed6c02
  else: grey[600], // #757575
  delay: purple[500], // #9c27b0
  add: grey[400] // #bdbdbd
};

// Categorical chart palettes. CHART_PALETTE = softer Material 400 ramp (ChartView,
// TimelineWidget); WIDGET_PALETTE = bolder Material 500 ramp (dashboard widgets).
export const CHART_PALETTE = [blue[400], green[400], orange[400], red[400], purple[400], cyan[400], brown[400], blueGrey[400]];
export const WIDGET_PALETTE = [green[500], blue[500], orange[500], red[500], purple[500], cyan[500], brown[500], blueGrey[500]];
// Priority distribution ramp: high → none.
export const PRIORITY_PALETTE = [red[500], orange[500], blue[500], grey[500], grey[400]];
// Fallback for an un-mapped status chip / chart segment.
export const STATUS_FALLBACK_COLOR = blue[200]; // #90caf9

// Audit log event-type → color (AuditLogPane).
export const AUDIT_EVENT_COLORS = {
  created: green[500],
  updated: blue[500],
  deleted: red[500],
  archived: grey[500],
  added: green[400],
  removed: red[400],
  satisfied: green[500],
  changed: orange[500]
};

// Workload pane status → color.
export const WORKLOAD_STATUS_COLORS = {
  'To Do': blue[200],
  'Working on it': orange[300],
  'In Progress': orange[300],
  Done: green[400],
  Stuck: red[400],
  Review: purple[200]
};

// Gantt timeline accent colors (TimelineView).
export const TIMELINE_COLORS = {
  done: TASK_DONE_COLOR, // completed bar
  pending: grey[500], // #9e9e9e — neutral / unscheduled bar
  blocked: TASK_BLOCKED_COLOR, // #e2445c — blocked predecessor
  dependency: deepPurple[400], // #7e57c2 — dependency arrow
  critical: red[500] // #f44336 — critical path / today line
};

export function fmtMinutes(mins) {
  const n = Number(mins || 0);
  if (!n) return '0m';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
