export const JOURNEY_STAGES = ['first_touch', 'second_touch', 'third_touch', 'fourth_touch', 'awaiting_decision'];

export const STAGE_LABELS = {
  first_touch: 'First Touch',
  second_touch: 'Second Touch',
  third_touch: 'Third Touch',
  fourth_touch: 'Fourth Touch',
  awaiting_decision: 'Awaiting Decision'
};

export const STAGE_COLORS = {
  first_touch: '#1976d2',
  second_touch: '#0288d1',
  third_touch: '#7b1fa2',
  fourth_touch: '#ed6c02',
  awaiting_decision: '#2e7d32'
};

export const ACTIVITY_ICON_LABEL = {
  email: 'Email',
  call: 'Call',
  text: 'Text',
  note: 'Note',
  stage_change: 'Stage'
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || '—';
}

export function nextStage(stage) {
  const i = JOURNEY_STAGES.indexOf(stage);
  if (i < 0 || i >= JOURNEY_STAGES.length - 1) return null; // null = already at last stage
  return JOURNEY_STAGES[i + 1];
}

export const formatDateDisplay = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
};
