import { useState, useEffect } from 'react';
import { Alert, Chip, InputAdornment, ListSubheader, MenuItem, Stack, TextField, Typography } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import ConditionBuilder from './ConditionBuilder';
import TemplateVariableHelper from './TemplateVariableHelper';
import { ACTIONS, getActionConfigFields, groupedActions, getActionsForTrigger } from 'constants/automationTypes';
import { clientLabel } from 'hooks/useClientLabel';

export default function StepEditorDialog({ open, onClose, onSave, step, statusLabels = [], loading, members = [], boards = [], groups = [], labels = [], triggerType }) {
  const isEdit = !!step?.id;

  const [stepType, setStepType] = useState('action');
  const [actionType, setActionType] = useState('notify_admins');
  const [actionConfig, setActionConfig] = useState({});
  const [conditionGroup, setConditionGroup] = useState({ logic: 'and', conditions: [{ field: 'item.status', operator: 'equals', value: '' }] });
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLocalError('');
    if (step) {
      setStepType(step.step_type || 'action');
      setActionType(step.action_type || 'notify_admins');
      setActionConfig(step.action_config || {});
      setConditionGroup(step.condition_group || { logic: 'and', conditions: [{ field: 'item.status', operator: 'equals', value: '' }] });
    } else {
      setStepType('action');
      setActionType('notify_admins');
      setActionConfig({});
      setConditionGroup({ logic: 'and', conditions: [{ field: 'item.status', operator: 'equals', value: '' }] });
    }
  }, [open, step]);

  const validateConditions = (conditions) => {
    for (const c of conditions) {
      // Nested condition group
      if (c.conditions && Array.isArray(c.conditions)) {
        if (!c.conditions.length) return 'Nested condition group must have at least one condition.';
        const nested = validateConditions(c.conditions);
        if (nested) return nested;
        continue;
      }
      // Leaf condition
      if (!c.field || !c.operator) return 'Each condition must have a field and operator.';
      if (!['is_empty', 'is_not_empty'].includes(c.operator) && (c.value === undefined || c.value === '')) {
        return 'Value is required unless operator is "is empty" or "is not empty".';
      }
    }
    return null;
  };

  const validate = () => {
    if (stepType === 'action') {
      const def = ACTIONS.find((a) => a.id === actionType);
      if (def?.soon) return 'This action is not yet available.';
      if (actionType === 'set_status' && !actionConfig.status) return 'Status is required for "Change status" action.';
      if (actionType === 'add_update' && !actionConfig.content?.trim()) return 'Content is required for "Post an update" action.';
      if ((actionType === 'notify_admins' || actionType === 'notify_assignees') && !actionConfig.title?.trim()) return 'Title is required for notification actions.';
    }
    if (stepType === 'if') {
      const conds = conditionGroup?.conditions || [];
      if (!conds.length) return 'At least one condition is required.';
      const condErr = validateConditions(conds);
      if (condErr) return condErr;
    }
    return null;
  };

  const handleSave = () => {
    // Merge visible defaults into actionConfig before validation
    const normalizedConfig = { ...actionConfig };
    if (stepType === 'action') {
      const fields = getActionConfigFields(actionType);
      for (const field of fields) {
        if (field.type === 'status_select' && !normalizedConfig[field.key]) {
          normalizedConfig[field.key] = statusOptions[0] || '';
        }
        if (field.type === 'boolean' && normalizedConfig[field.key] === undefined) {
          normalizedConfig[field.key] = false;
        }
      }
      setActionConfig(normalizedConfig);
    }

    const err = validate();
    if (err) { setLocalError(err); return; }
    setLocalError('');
    const payload = { step_type: stepType };
    if (stepType === 'action') {
      payload.action_type = actionType;
      payload.action_config = normalizedConfig;
    } else if (stepType === 'if') {
      payload.condition_group = conditionGroup;
    }
    // 'else' type has no config
    onSave(payload);
  };

  const actionDef = ACTIONS.find((a) => a.id === actionType);
  const isSoon = actionDef?.soon;
  const configFields = getActionConfigFields(actionType);
  const statusOptions = (statusLabels || []).map((l) => l.label || l);

  const renderActionConfig = () => {
    if (isSoon) {
      return (
        <Alert severity="info" sx={{ mt: 1 }}>
          This action is coming soon and will be available in a future update.
        </Alert>
      );
    }

    return configFields.map((field) => {
      if (field.type === 'status_select') {
        return (
          <SelectField
            key={field.key}
            label={field.label}
            size="small"
            value={actionConfig[field.key] || statusOptions[0] || ''}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          >
            {statusOptions.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </SelectField>
        );
      }
      if (field.type === 'boolean') {
        return (
          <SelectField
            key={field.key}
            label={field.label}
            size="small"
            value={String(Boolean(actionConfig[field.key]))}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value === 'true' }))}
            options={[
              { value: 'true', label: 'True' },
              { value: 'false', label: 'False' }
            ]}
          />
        );
      }
      if (field.type === 'recipient_mode') {
        return (
          <SelectField
            key={field.key}
            label={field.label}
            size="small"
            value={actionConfig[field.key] || 'current_assignees'}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          >
            <MenuItem value="trigger_assignee">Newly assigned person</MenuItem>
            <MenuItem value="current_assignees">All current assignees</MenuItem>
            <MenuItem value="actor">Person who triggered this</MenuItem>
            <MenuItem value="item_creator">Item creator</MenuItem>
            <MenuItem value="admins">All admins</MenuItem>
            <MenuItem value="specific_user">Specific person</MenuItem>
          </SelectField>
        );
      }
      if (field.type === 'member_select') {
        return (
          <SelectField
            key={field.key}
            label={field.label}
            size="small"
            value={actionConfig[field.key] || ''}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          >
            <MenuItem value=""><em>Select person</em></MenuItem>
            {members.map((m) => (
              <MenuItem key={m.user_id || m.id} value={m.user_id || m.id}>
                {clientLabel(m)}
              </MenuItem>
            ))}
          </SelectField>
        );
      }
      if (field.type === 'board_select') {
        return (
          <SelectField
            key={field.key}
            label={field.label}
            size="small"
            value={actionConfig[field.key] || ''}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          >
            <MenuItem value=""><em>Select board</em></MenuItem>
            {boards.map((b) => (
              <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
            ))}
          </SelectField>
        );
      }
      if (field.type === 'group_select') {
        return (
          <SelectField
            key={field.key}
            label={field.label}
            size="small"
            value={actionConfig[field.key] || ''}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          >
            <MenuItem value=""><em>Same group</em></MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
            ))}
          </SelectField>
        );
      }
      if (field.type === 'label_select') {
        return (
          <SelectField
            key={field.key}
            label={field.label}
            size="small"
            value={actionConfig[field.key] || ''}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          >
            <MenuItem value=""><em>Select label</em></MenuItem>
            {labels.map((l) => (
              <MenuItem key={l.id} value={l.id}>{l.category}: {l.label}</MenuItem>
            ))}
          </SelectField>
        );
      }
      if (field.type === 'date') {
        return (
          <TextField
            key={field.key}
            size="small"
            label={field.label}
            type="date"
            value={actionConfig[field.key] || ''}
            onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
        );
      }
      return (
        <TextField
          key={field.key}
          size="small"
          label={field.label}
          multiline={field.multiline || false}
          rows={field.multiline ? 3 : 1}
          value={actionConfig[field.key] || ''}
          onChange={(e) => setActionConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <TemplateVariableHelper
                  onInsert={(variable) => setActionConfig((p) => ({ ...p, [field.key]: (p[field.key] || '') + variable }))}
                />
              </InputAdornment>
            )
          }}
        />
      );
    });
  };

  // Trigger-aware action filtering
  const { suggested: suggestedActions, other: otherActions } = triggerType
    ? getActionsForTrigger(triggerType)
    : { suggested: [], other: ACTIONS.filter((a) => !a.soon) };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={handleSave}
      title={isEdit ? 'Edit Step' : 'Add Step'}
      submitLabel={isEdit ? 'Update' : 'Add'}
      loading={loading}
      loadingLabel="Saving..."
      submitDisabled={stepType === 'action' && isSoon}
    >
      {localError && <Alert severity="error" onClose={() => setLocalError('')}>{localError}</Alert>}
      {!isEdit && (
        <SelectField
          label="Step type"
          size="small"
          value={stepType}
          onChange={(e) => setStepType(e.target.value)}
          options={[
            { value: 'action', label: 'Action' },
            { value: 'if', label: 'If / Then (condition)' },
            { value: 'else', label: 'Otherwise (else)' }
          ]}
        />
      )}

      {stepType === 'action' && (
        <>
          <SelectField
            label="Action type"
            size="small"
            value={actionType}
            onChange={(e) => {
              setActionType(e.target.value);
              setActionConfig({});
            }}
          >
            {suggestedActions.length > 0 && (
              <ListSubheader key="header-suggested" sx={{ lineHeight: '32px', fontSize: '0.75rem', color: 'primary.main', fontWeight: 600 }}>
                Suggested
              </ListSubheader>
            )}
            {suggestedActions.map((a) => (
              <MenuItem key={a.id} value={a.id}>{a.label}</MenuItem>
            ))}
            {otherActions.length > 0 && (
              <ListSubheader key="header-other" sx={{ lineHeight: '32px', fontSize: '0.75rem' }}>
                Other Actions
              </ListSubheader>
            )}
            {otherActions.map((a) => (
              <MenuItem key={a.id} value={a.id}>{a.label}</MenuItem>
            ))}
          </SelectField>
          {renderActionConfig()}
        </>
      )}

      {stepType === 'if' && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Conditions</Typography>
          <ConditionBuilder conditionGroup={conditionGroup} onChange={setConditionGroup} />
        </Stack>
      )}

      {stepType === 'else' && (
        <Typography variant="body2" color="text.secondary">
          This step runs when the preceding condition is not met. No configuration needed.
        </Typography>
      )}

      {stepType === 'delay' && (
        <Alert severity="info">Delay steps are coming soon and will be available in a future update.</Alert>
      )}
    </FormDialog>
  );
}
