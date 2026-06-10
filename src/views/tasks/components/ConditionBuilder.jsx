import { Box, Button, IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import SelectField from 'ui-component/extended/SelectField';
import { CONDITION_FIELDS, CONDITION_OPERATORS } from 'constants/automationTypes';

const NO_VALUE_OPERATORS = ['is_empty', 'is_not_empty'];

function emptyCondition() {
  return { field: 'item.status', operator: 'equals', value: '' };
}

export default function ConditionBuilder({ conditionGroup, onChange }) {
  const group = conditionGroup || { logic: 'and', conditions: [emptyCondition()] };

  const handleLogicChange = (_e, val) => {
    if (!val) return;
    onChange({ ...group, logic: val });
  };

  const handleConditionChange = (index, key, value) => {
    const next = [...group.conditions];
    next[index] = { ...next[index], [key]: value };
    // Clear value when switching to no-value operator
    if (key === 'operator' && NO_VALUE_OPERATORS.includes(value)) {
      next[index].value = '';
    }
    onChange({ ...group, conditions: next });
  };

  const addCondition = () => {
    onChange({ ...group, conditions: [...group.conditions, emptyCondition()] });
  };

  const removeCondition = (index) => {
    const next = group.conditions.filter((_, i) => i !== index);
    onChange({ ...group, conditions: next.length ? next : [emptyCondition()] });
  };

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          When
        </Typography>
        <ToggleButtonGroup value={group.logic} exclusive onChange={handleLogicChange} size="small">
          <ToggleButton value="and" sx={{ px: 1.5, py: 0.25, textTransform: 'none', fontSize: '0.8rem' }}>
            ALL match
          </ToggleButton>
          <ToggleButton value="or" sx={{ px: 1.5, py: 0.25, textTransform: 'none', fontSize: '0.8rem' }}>
            ANY match
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {group.conditions.map((cond, i) => (
        <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
          <SelectField
            label="Field"
            size="small"
            value={cond.field}
            onChange={(e) => handleConditionChange(i, 'field', e.target.value)}
            sx={{ minWidth: 160 }}
            fullWidth={false}
          >
            {CONDITION_FIELDS.map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {f.label}
              </MenuItem>
            ))}
          </SelectField>

          <SelectField
            label="Operator"
            size="small"
            value={cond.operator}
            onChange={(e) => handleConditionChange(i, 'operator', e.target.value)}
            sx={{ minWidth: 150 }}
            fullWidth={false}
          >
            {CONDITION_OPERATORS.map((op) => (
              <MenuItem key={op.id} value={op.id}>
                {op.label}
              </MenuItem>
            ))}
          </SelectField>

          {!NO_VALUE_OPERATORS.includes(cond.operator) && (
            <TextField
              size="small"
              label="Value"
              value={cond.value}
              onChange={(e) => handleConditionChange(i, 'value', e.target.value)}
              sx={{ minWidth: 120, flex: 1 }}
            />
          )}

          <IconButton size="small" onClick={() => removeCondition(i)} sx={{ mt: 0.5 }} aria-label={`Remove condition ${i + 1}`} title={`Remove condition ${i + 1}`}>
            <IconTrash size={16} />
          </IconButton>
        </Stack>
      ))}

      <Box>
        <Button size="small" startIcon={<IconPlus size={14} />} onClick={addCondition}>
          Add condition
        </Button>
      </Box>
    </Stack>
  );
}
