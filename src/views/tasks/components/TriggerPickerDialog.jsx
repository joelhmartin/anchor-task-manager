import { useState, useEffect } from 'react';
import { ListSubheader, MenuItem, Stack, TextField } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { TRIGGERS, groupedTriggers } from 'constants/automationTypes';

export default function TriggerPickerDialog({ open, onClose, onSave, automation, statusLabels = [], loading }) {
  const [triggerType, setTriggerType] = useState('');
  const [triggerConfig, setTriggerConfig] = useState({});
  const [name, setName] = useState('');

  useEffect(() => {
    if (open && automation) {
      setTriggerType(automation.trigger_type || 'status_change');
      setTriggerConfig(automation.trigger_config || {});
      setName(automation.name || '');
    }
  }, [open, automation]);

  const handleSave = () => {
    onSave({ name: name.trim() || 'New Automation', trigger_type: triggerType, trigger_config: triggerConfig });
  };

  const triggerCategories = groupedTriggers();
  const statusOptions = (statusLabels || []).map((l) => l.label || l);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={handleSave}
      title="Configure Trigger"
      submitLabel="Save"
      loading={loading}
      loadingLabel="Saving..."
    >
      <TextField
        label="Automation Name"
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. When status changes → notify team"
        fullWidth
      />

      <SelectField
        label="When this happens..."
        size="small"
        value={triggerType}
        onChange={(e) => { setTriggerType(e.target.value); setTriggerConfig({}); }}
      >
        {Object.entries(triggerCategories).flatMap(([cat, items]) => [
          <ListSubheader key={`th-${cat}`} sx={{ lineHeight: '32px', fontSize: '0.75rem' }}>{cat}</ListSubheader>,
          ...items.map((t) => (
            <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>
          ))
        ])}
      </SelectField>

      {/* Trigger-specific config */}
      {triggerType === 'status_change' && (
        <SelectField
          label="Target status (optional)"
          size="small"
          value={triggerConfig.to_status || ''}
          onChange={(e) => setTriggerConfig((p) => ({ ...p, to_status: e.target.value }))}
        >
          <MenuItem value=""><em>Any status change</em></MenuItem>
          {statusOptions.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </SelectField>
      )}

      {triggerType === 'due_date_relative' && (
        <Stack direction="row" spacing={1}>
          <TextField
            label="Days before/after"
            size="small"
            type="number"
            value={triggerConfig.days_from_due ?? 1}
            onChange={(e) => setTriggerConfig((p) => ({ ...p, days_from_due: parseInt(e.target.value) || 0 }))}
            inputProps={{ min: -30, max: 30 }}
            sx={{ width: 140 }}
          />
          <SelectField
            label="Direction"
            size="small"
            value={triggerConfig.direction || 'before'}
            onChange={(e) => setTriggerConfig((p) => ({ ...p, direction: e.target.value }))}
            options={[
              { value: 'before', label: 'Before due date' },
              { value: 'after', label: 'After due date' }
            ]}
          />
        </Stack>
      )}

      {triggerType === 'update_created' && (
        <TextField
          label="Keyword filter (optional)"
          size="small"
          value={triggerConfig.keyword || ''}
          onChange={(e) => setTriggerConfig((p) => ({ ...p, keyword: e.target.value }))}
          placeholder="Only trigger when update contains this text"
        />
      )}

      {triggerType === 'field_changed' && (
        <TextField
          label="Field name (optional)"
          size="small"
          value={triggerConfig.field || ''}
          onChange={(e) => setTriggerConfig((p) => ({ ...p, field: e.target.value }))}
          placeholder="e.g. status, due_date, name"
        />
      )}
    </FormDialog>
  );
}
