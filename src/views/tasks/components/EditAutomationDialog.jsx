import { Box, Chip, ListSubheader, MenuItem, Stack, TextField } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { groupedTriggers, groupedActions, getActionConfigFields } from 'constants/automationTypes';
import { clientLabel } from 'hooks/useClientLabel';

export default function EditAutomationDialog({
  open, onClose,
  automation, editDraft, onChangeDraft,
  statusLabels, groups, boards, members, labels,
  onSave, loading
}) {
  const triggerCategories = groupedTriggers();
  const actionCategories = groupedActions();
  const activeAction = editDraft.action_type || automation?.action_type || '';
  const activeTrigger = editDraft.trigger_type || automation?.trigger_type || '';
  const configFields = getActionConfigFields(activeAction);

  function setConfig(key, value) {
    onChangeDraft((p) => ({ ...p, action_config: { ...(p.action_config || {}), [key]: value } }));
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSave}
      title="Edit automation"
      submitLabel="Save"
      loading={loading}
    >
      <TextField
        size="small"
        label="Name"
        value={editDraft.name}
        onChange={(e) => onChangeDraft((p) => ({ ...p, name: e.target.value }))}
      />

      <SelectField
        label="Trigger"
        size="small"
        value={activeTrigger}
        onChange={(e) => onChangeDraft((p) => ({ ...p, trigger_type: e.target.value, trigger_config: {} }))}
      >
        {Object.entries(triggerCategories).flatMap(([cat, items]) => [
          <ListSubheader key={`th-${cat}`} sx={{ lineHeight: '32px', fontSize: '0.75rem' }}>
            {cat}
          </ListSubheader>,
          ...items.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.label}
            </MenuItem>
          ))
        ])}
      </SelectField>

      <SelectField
        label="Action"
        size="small"
        value={activeAction}
        onChange={(e) => onChangeDraft((p) => ({ ...p, action_type: e.target.value, action_config: {} }))}
      >
        {Object.entries(actionCategories).flatMap(([cat, items]) => [
          <ListSubheader key={`ah-${cat}`} sx={{ lineHeight: '32px', fontSize: '0.75rem' }}>
            {cat}
          </ListSubheader>,
          ...items.map((a) => (
            <MenuItem key={a.id} value={a.id} disabled={a.soon}>
              <Stack direction="row" spacing={1} alignItems="center">
                <span>{a.label}</span>
                {a.soon && <Chip label="Soon" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
              </Stack>
            </MenuItem>
          ))
        ])}
      </SelectField>

      {/* Trigger-specific config */}
      {activeTrigger === 'status_change' && (
        <SelectField
          label="Target status"
          size="small"
          value={editDraft.trigger_config?.to_status || ''}
          onChange={(e) =>
            onChangeDraft((p) => ({ ...p, trigger_config: { ...(p.trigger_config || {}), to_status: e.target.value } }))
          }
        >
          <MenuItem value="">Any status</MenuItem>
          {(statusLabels || []).map((sl) => (
            <MenuItem key={sl.id || sl.label} value={sl.label}>
              {sl.label}
            </MenuItem>
          ))}
        </SelectField>
      )}

      {activeTrigger === 'due_date_relative' && (
        <TextField
          size="small"
          type="number"
          label="Days from due date"
          helperText="-10 = 10 days before, 0 = on due date, 1 = 1 day after"
          value={editDraft.trigger_config?.days_from_due ?? 0}
          onChange={(e) =>
            onChangeDraft((p) => ({ ...p, trigger_config: { ...(p.trigger_config || {}), days_from_due: Number(e.target.value) } }))
          }
        />
      )}

      {/* Action config fields — rendered dynamically */}
      {configFields.map((field) => {
        if (field.type === 'status_select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={editDraft.action_config?.[field.key] || (statusLabels || [])[0]?.label || 'To Do'}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              {(statusLabels || []).map((sl) => (
                <MenuItem key={sl.id || sl.label} value={sl.label}>{sl.label}</MenuItem>
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
              value={String(Boolean(editDraft.action_config?.[field.key]))}
              onChange={(e) => setConfig(field.key, e.target.value === 'true')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
            />
          );
        }
        if (field.type === 'date') {
          return (
            <TextField
              key={field.key}
              size="small"
              type="date"
              label={field.label}
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          );
        }
        if (field.type === 'group_select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              <MenuItem value="">Same group</MenuItem>
              {(groups || []).map((g) => (
                <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
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
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              {(boards || []).map((b) => (
                <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
              ))}
            </SelectField>
          );
        }
        if (field.type === 'member_select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              {(members || []).map((m) => (
                <MenuItem key={m.id} value={m.id}>{clientLabel(m)}</MenuItem>
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
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              {(labels || []).map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: l.color }} />
                    <span>{l.label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </SelectField>
          );
        }
        // Default: text field
        return (
          <TextField
            key={field.key}
            size="small"
            label={field.label}
            multiline={field.multiline || false}
            minRows={field.multiline ? 2 : undefined}
            value={editDraft.action_config?.[field.key] || ''}
            onChange={(e) => setConfig(field.key, e.target.value)}
          />
        );
      })}
    </FormDialog>
  );
}
