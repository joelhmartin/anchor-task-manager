/**
 * ConditionalLogicPanel — Per-field conditional visibility rules.
 *
 * Show/hide a field based on the value of another field.
 * Operators: equals, not_equals, contains, not_contains, is_empty, is_not_empty, greater_than, less_than
 * Logic: ALL (AND) / ANY (OR)
 */

import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

import SelectField from 'ui-component/extended/SelectField';
import { LAYOUT_FIELD_TYPES } from './fieldTypes';

const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
  { value: 'greater_than', label: 'Greater than' },
  { value: 'less_than', label: 'Less than' }
];

const VALUE_FREE_OPS = ['is_empty', 'is_not_empty'];

export default function ConditionalLogicPanel({ field, fields, onUpdate }) {
  const conditions = field.conditions || [];
  const conditionLogic = field.conditionLogic || 'all';

  // Available fields to reference (exclude self and layout fields)
  const sourceFields = fields.filter(
    (f) => (f.id || f.name) !== (field.id || field.name) && !LAYOUT_FIELD_TYPES.includes(f.type)
  );

  const updateConditions = (newConditions) => {
    onUpdate({ conditions: newConditions });
  };

  const addCondition = () => {
    const newCond = {
      fieldId: sourceFields[0]?.id || sourceFields[0]?.name || '',
      operator: 'equals',
      value: ''
    };
    updateConditions([...conditions, newCond]);
  };

  const updateCondition = (idx, updates) => {
    updateConditions(conditions.map((c, i) => (i === idx ? { ...c, ...updates } : c)));
  };

  const removeCondition = (idx) => {
    updateConditions(conditions.filter((_, i) => i !== idx));
  };

  // Get options for a source field (for value dropdown)
  const getSourceOptions = (fieldId) => {
    const src = fields.find((f) => (f.id || f.name) === fieldId);
    if (!src || !src.options) return null;
    return src.options;
  };

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Conditional Visibility
        </Typography>
        {conditions.length > 0 && (
          <Chip
            label={conditionLogic === 'all' ? 'ALL' : 'ANY'}
            size="small"
            variant="outlined"
            onClick={() => onUpdate({ conditionLogic: conditionLogic === 'all' ? 'any' : 'all' })}
            sx={{ cursor: 'pointer', fontSize: 10 }}
          />
        )}
      </Stack>

      {conditions.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
          No conditions. This field is always visible.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {conditions.map((cond, i) => {
            const srcOptions = getSourceOptions(cond.fieldId);
            const needsValue = !VALUE_FREE_OPS.includes(cond.operator);

            return (
              <Box
                key={i}
                sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1, position: 'relative' }}
              >
                <Stack spacing={1}>
                  {i > 0 && (
                    <Typography variant="caption" color="primary" fontWeight={600} sx={{ fontSize: 10 }}>
                      {conditionLogic === 'all' ? 'AND' : 'OR'}
                    </Typography>
                  )}

                  <Typography variant="caption" color="text.secondary">Show when:</Typography>

                  {/* Source field */}
                  <SelectField
                    label="Field"
                    value={cond.fieldId}
                    onChange={(e) => updateCondition(i, { fieldId: e.target.value, value: '' })}
                    size="small"
                  >
                    {sourceFields.map((f) => (
                      <MenuItem key={f.id || f.name} value={f.id || f.name}>
                        {f.label || f.name}
                      </MenuItem>
                    ))}
                  </SelectField>

                  {/* Operator */}
                  <SelectField
                    label="Operator"
                    value={cond.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value })}
                    size="small"
                    options={OPERATORS}
                  />

                  {/* Value */}
                  {needsValue && (
                    srcOptions ? (
                      <SelectField
                        label="Value"
                        value={cond.value}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                        size="small"
                      >
                        {srcOptions.map((opt) => (
                          <MenuItem key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
                            {typeof opt === 'string' ? opt : opt.label}
                          </MenuItem>
                        ))}
                      </SelectField>
                    ) : (
                      <input
                        type={cond.operator === 'greater_than' || cond.operator === 'less_than' ? 'number' : 'text'}
                        placeholder="Value"
                        value={cond.value || ''}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                        style={{
                          padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4,
                          fontSize: 13, width: '100%', boxSizing: 'border-box'
                        }}
                      />
                    )
                  )}
                </Stack>

                <IconButton
                  size="small"
                  onClick={() => removeCondition(i)}
                  sx={{ position: 'absolute', top: 4, right: 4 }}
                >
                  <DeleteIcon fontSize="small" sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            );
          })}
        </Stack>
      )}

      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={addCondition}
        disabled={sourceFields.length === 0}
        sx={{ alignSelf: 'flex-start', textTransform: 'none', fontSize: 12 }}
      >
        Add Condition
      </Button>

      {sourceFields.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
          Add more fields to create conditions.
        </Typography>
      )}
    </Stack>
  );
}
