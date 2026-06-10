/**
 * StepManager — Multi-step form configuration panel.
 *
 * Allows admins to:
 * - Toggle multi-step mode on/off
 * - Add/remove/reorder steps
 * - Assign fields to steps via drag or select
 * - Configure per-step title/description
 * - Configure progress bar, auto-advance, title page
 */

import { useState } from 'react';
import {
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';


/**
 * Generate a unique step ID.
 */
let _stepCounter = 0;
function stepId() {
  _stepCounter += 1;
  return `step_${Date.now().toString(36)}${_stepCounter.toString(36)}`;
}

/**
 * Build initial steps from fields (one step per field if no steps exist).
 */
export function buildInitialSteps(fields) {
  if (!fields.length) return [];
  return [{
    id: stepId(),
    title: 'Step 1',
    description: '',
    fieldIds: fields.map((f) => f.id || f.name)
  }];
}

/**
 * Ensure all fields are assigned to a step (orphans go to last step).
 */
export function syncFieldsToSteps(steps, fields) {
  if (!steps.length) return steps;
  const allAssigned = new Set(steps.flatMap((s) => s.fieldIds));
  const orphans = fields
    .map((f) => f.id || f.name)
    .filter((id) => !allAssigned.has(id));
  if (!orphans.length) return steps;
  // Add orphans to the last step
  const updated = [...steps];
  updated[updated.length - 1] = {
    ...updated[updated.length - 1],
    fieldIds: [...updated[updated.length - 1].fieldIds, ...orphans]
  };
  return updated;
}

export default function StepManager({ fields, style, onStyleChange }) {
  const multiStep = style.multiStep || false;
  const steps = style.steps || [];
  const stepConfig = style.stepConfig || {
    showProgressBar: true,
    showStepTitles: true,
    autoAdvance: false,
    titlePage: null
  };

  const [activeStepIdx, setActiveStepIdx] = useState(0);

  const updateSteps = (newSteps) => {
    onStyleChange({ steps: newSteps });
  };

  const updateStepConfig = (updates) => {
    onStyleChange({ stepConfig: { ...stepConfig, ...updates } });
  };

  const toggleMultiStep = (enabled) => {
    if (enabled && steps.length === 0) {
      // Initialize with all fields in step 1
      const initialSteps = buildInitialSteps(fields);
      onStyleChange({ multiStep: true, steps: initialSteps });
    } else {
      onStyleChange({ multiStep: enabled });
    }
  };

  const addStep = () => {
    const newStep = {
      id: stepId(),
      title: `Step ${steps.length + 1}`,
      description: '',
      fieldIds: []
    };
    updateSteps([...steps, newStep]);
    setActiveStepIdx(steps.length);
  };

  const removeStep = (idx) => {
    if (steps.length <= 1) return;
    const removed = steps[idx];
    const updated = steps.filter((_, i) => i !== idx);
    // Move orphaned fields to the previous or first step
    if (removed.fieldIds.length > 0) {
      const targetIdx = Math.max(0, idx - 1);
      updated[targetIdx] = {
        ...updated[targetIdx],
        fieldIds: [...updated[targetIdx].fieldIds, ...removed.fieldIds]
      };
    }
    updateSteps(updated);
    setActiveStepIdx(Math.min(activeStepIdx, updated.length - 1));
  };

  const moveStep = (idx, direction) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= steps.length) return;
    const updated = [...steps];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    updateSteps(updated);
    setActiveStepIdx(newIdx);
  };

  const updateStep = (idx, updates) => {
    const updated = steps.map((s, i) => (i === idx ? { ...s, ...updates } : s));
    updateSteps(updated);
  };

  const moveFieldToStep = (fieldId, fromStepIdx, toStepIdx) => {
    if (fromStepIdx === toStepIdx) return;
    const updated = steps.map((step, i) => {
      if (i === fromStepIdx) {
        return { ...step, fieldIds: step.fieldIds.filter((id) => id !== fieldId) };
      }
      if (i === toStepIdx) {
        return { ...step, fieldIds: [...step.fieldIds, fieldId] };
      }
      return step;
    });
    updateSteps(updated);
  };

  // Build field lookup
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.id || f.name] = f;
  }

  const activeStep = steps[activeStepIdx];

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Multi-Step Form</Typography>

      <FormControlLabel
        control={<Switch checked={multiStep} onChange={(e) => toggleMultiStep(e.target.checked)} />}
        label="Enable multi-step"
      />

      {multiStep && (
        <>
          {/* Step config */}
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={stepConfig.showProgressBar}
                  onChange={(e) => updateStepConfig({ showProgressBar: e.target.checked })}
                  size="small"
                />
              }
              label={<Typography variant="body2">Show progress bar</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={stepConfig.showStepTitles}
                  onChange={(e) => updateStepConfig({ showStepTitles: e.target.checked })}
                  size="small"
                />
              }
              label={<Typography variant="body2">Show step titles</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={stepConfig.autoAdvance}
                  onChange={(e) => updateStepConfig({ autoAdvance: e.target.checked })}
                  size="small"
                />
              }
              label={<Typography variant="body2">Auto-advance on selection</Typography>}
            />
          </Stack>

          {/* Title page */}
          <Divider />
          <FormControlLabel
            control={
              <Switch
                checked={!!stepConfig.titlePage}
                onChange={(e) =>
                  updateStepConfig({
                    titlePage: e.target.checked ? { heading: 'Welcome', subheading: '', startButton: 'Get Started' } : null
                  })
                }
                size="small"
              />
            }
            label={<Typography variant="body2">Title page before Step 1</Typography>}
          />
          {stepConfig.titlePage && (
            <Stack spacing={1} sx={{ pl: 2 }}>
              <TextField
                label="Heading"
                value={stepConfig.titlePage.heading || ''}
                onChange={(e) => updateStepConfig({ titlePage: { ...stepConfig.titlePage, heading: e.target.value } })}
                size="small"
                fullWidth
              />
              <TextField
                label="Subheading"
                value={stepConfig.titlePage.subheading || ''}
                onChange={(e) => updateStepConfig({ titlePage: { ...stepConfig.titlePage, subheading: e.target.value } })}
                size="small"
                fullWidth
              />
              <TextField
                label="Start Button Text"
                value={stepConfig.titlePage.startButton || 'Get Started'}
                onChange={(e) => updateStepConfig({ titlePage: { ...stepConfig.titlePage, startButton: e.target.value } })}
                size="small"
                fullWidth
              />
            </Stack>
          )}

          <Divider />

          {/* Step tabs */}
          <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center" sx={{ gap: 0.5 }}>
            {steps.map((step, i) => (
              <Chip
                key={step.id}
                label={`${step.title} (${step.fieldIds.length})`}
                color={i === activeStepIdx ? 'primary' : 'default'}
                onClick={() => setActiveStepIdx(i)}
                size="small"
                variant={i === activeStepIdx ? 'filled' : 'outlined'}
              />
            ))}
            <Tooltip title="Add Step">
              <IconButton size="small" onClick={addStep}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          {/* Active step editor */}
          {activeStep && (
            <Stack spacing={1.5} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  label="Step Title"
                  value={activeStep.title}
                  onChange={(e) => updateStep(activeStepIdx, { title: e.target.value })}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <Tooltip title="Move Up">
                  <span>
                    <IconButton size="small" onClick={() => moveStep(activeStepIdx, -1)} disabled={activeStepIdx === 0}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Move Down">
                  <span>
                    <IconButton size="small" onClick={() => moveStep(activeStepIdx, 1)} disabled={activeStepIdx === steps.length - 1}>
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Remove Step">
                  <span>
                    <IconButton size="small" color="error" onClick={() => removeStep(activeStepIdx)} disabled={steps.length <= 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              <TextField
                label="Description (optional)"
                value={activeStep.description || ''}
                onChange={(e) => updateStep(activeStepIdx, { description: e.target.value })}
                size="small"
                fullWidth
                multiline
                rows={2}
              />

              {/* Fields in this step */}
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                Fields in this step
              </Typography>
              {activeStep.fieldIds.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  No fields assigned. Click a field below to add it.
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {activeStep.fieldIds.map((fid) => {
                    const field = fieldMap[fid];
                    if (!field) return null;
                    return (
                      <Stack key={fid} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                        <Typography
                          variant="caption"
                          sx={{ px: 0.75, py: 0.25, bgcolor: 'action.selected', borderRadius: 0.5, fontFamily: 'monospace', fontSize: 10 }}
                        >
                          {field.type}
                        </Typography>
                        <Typography variant="body2" sx={{ flex: 1, fontSize: 13 }}>
                          {field.label || field.name}
                        </Typography>
                        {/* Move to other step buttons */}
                        {steps.length > 1 && (
                          <Stack direction="row" spacing={0.25}>
                            {steps.map((s, si) =>
                              si !== activeStepIdx ? (
                                <Tooltip key={s.id} title={`Move to ${s.title}`}>
                                  <Chip
                                    label={si + 1}
                                    size="small"
                                    variant="outlined"
                                    onClick={() => moveFieldToStep(fid, activeStepIdx, si)}
                                    sx={{ height: 20, fontSize: 10, cursor: 'pointer' }}
                                  />
                                </Tooltip>
                              ) : null
                            )}
                          </Stack>
                        )}
                      </Stack>
                    );
                  })}
                </Stack>
              )}

              {/* Unassigned fields */}
              {(() => {
                const assignedSet = new Set(steps.flatMap((s) => s.fieldIds));
                const unassigned = fields.filter((f) => !assignedSet.has(f.id || f.name));
                if (!unassigned.length) return null;
                return (
                  <>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mt: 1 }}>
                      Unassigned fields
                    </Typography>
                    <Stack spacing={0.5}>
                      {unassigned.map((f) => {
                        const fid = f.id || f.name;
                        return (
                          <Chip
                            key={fid}
                            label={`${f.label || f.name} (${f.type})`}
                            size="small"
                            variant="outlined"
                            onClick={() => updateStep(activeStepIdx, { fieldIds: [...activeStep.fieldIds, fid] })}
                            sx={{ cursor: 'pointer', justifyContent: 'flex-start' }}
                          />
                        );
                      })}
                    </Stack>
                  </>
                );
              })()}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
