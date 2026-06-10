import {
  Autocomplete,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { IconX } from '@tabler/icons-react';
import SelectField from 'ui-component/extended/SelectField';
import { clientLabel } from 'hooks/useClientLabel';

const DUE_DATE_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'next_week', label: 'Next Week' },
  { value: 'no_date', label: 'No Date' },
];

const ATTENTION_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export default function FilterBar({
  filters,
  onUpdateFilter,
  onClearFilters,
  hasActiveFilters,
  statusLabels = [],
  workspaceLabels = [],
  workspaceMembers = [],
  groups = []
}) {
  // Build option lists
  const statusOptions = statusLabels.map((sl) => ({ value: sl.label, label: sl.label, color: sl.color }));
  const labelOptions = workspaceLabels.map((wl) => ({ value: wl.id, label: wl.name, color: wl.color, category: wl.category }));
  const memberOptions = (workspaceMembers || []).map((m) => {
    const name = clientLabel(m);
    return { value: m.user_id, label: name || m.user_id?.slice(0, 8) };
  });
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));

  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper'
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        {/* Status multi-select */}
        <Autocomplete
          multiple
          size="small"
          options={statusOptions}
          getOptionLabel={(opt) => opt.label}
          value={statusOptions.filter((o) => filters.status.includes(o.value))}
          onChange={(_e, val) => onUpdateFilter('status', val.map((v) => v.value))}
          isOptionEqualToValue={(opt, val) => opt.value === val.value}
          renderInput={(params) => <TextField {...params} label="Status" />}
          renderTags={(value, getTagProps) =>
            value.map((opt, idx) => (
              <Chip
                {...getTagProps({ index: idx })}
                key={opt.value}
                label={opt.label}
                size="small"
                sx={{ bgcolor: opt.color, color: 'common.white', fontWeight: 600, '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.7)' } }}
              />
            ))
          }
          renderOption={(props, opt) => (
            <li {...props} key={opt.value}>
              <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', bgcolor: opt.color, mr: 1 }} />
              {opt.label}
            </li>
          )}
          sx={{ minWidth: 180 }}
        />

        {/* Labels multi-select */}
        {labelOptions.length > 0 && (
          <Autocomplete
            multiple
            size="small"
            options={labelOptions}
            groupBy={(opt) => opt.category || 'Other'}
            getOptionLabel={(opt) => opt.label}
            value={labelOptions.filter((o) => filters.labels.includes(o.value))}
            onChange={(_e, val) => onUpdateFilter('labels', val.map((v) => v.value))}
            isOptionEqualToValue={(opt, val) => opt.value === val.value}
            renderInput={(params) => <TextField {...params} label="Labels" />}
            renderTags={(value, getTagProps) =>
              value.map((opt, idx) => (
                <Chip
                  {...getTagProps({ index: idx })}
                  key={opt.value}
                  label={opt.label}
                  size="small"
                  sx={opt.color ? { bgcolor: opt.color, color: 'common.white', '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.7)' } } : {}}
                />
              ))
            }
            renderOption={(props, opt) => (
              <li {...props} key={opt.value}>
                {opt.color && (
                  <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', bgcolor: opt.color, mr: 1 }} />
                )}
                {opt.label}
              </li>
            )}
            sx={{ minWidth: 180 }}
          />
        )}

        {/* Assignees multi-select */}
        <Autocomplete
          multiple
          size="small"
          options={memberOptions}
          getOptionLabel={(opt) => opt.label}
          value={memberOptions.filter((o) => filters.assignees.includes(o.value))}
          onChange={(_e, val) => onUpdateFilter('assignees', val.map((v) => v.value))}
          isOptionEqualToValue={(opt, val) => opt.value === val.value}
          renderInput={(params) => <TextField {...params} label="Assignee" />}
          renderTags={(value, getTagProps) =>
            value.map((opt, idx) => (
              <Chip {...getTagProps({ index: idx })} key={opt.value} label={opt.label} size="small" />
            ))
          }
          sx={{ minWidth: 180 }}
        />

        {/* Due Date dropdown */}
        <SelectField
          label="Due Date"
          size="small"
          value={filters.due_date}
          onChange={(e) => onUpdateFilter('due_date', e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">
            <em>Any</em>
          </MenuItem>
          {DUE_DATE_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </SelectField>

        {/* Needs Attention dropdown */}
        <SelectField
          label="Attention"
          size="small"
          value={filters.needs_attention}
          onChange={(e) => onUpdateFilter('needs_attention', e.target.value)}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="">
            <em>Any</em>
          </MenuItem>
          {ATTENTION_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </SelectField>

        {/* Groups multi-select */}
        {groupOptions.length > 1 && (
          <Autocomplete
            multiple
            size="small"
            options={groupOptions}
            getOptionLabel={(opt) => opt.label}
            value={groupOptions.filter((o) => filters.groups.includes(o.value))}
            onChange={(_e, val) => onUpdateFilter('groups', val.map((v) => v.value))}
            isOptionEqualToValue={(opt, val) => opt.value === val.value}
            renderInput={(params) => <TextField {...params} label="Group" />}
            renderTags={(value, getTagProps) =>
              value.map((opt, idx) => (
                <Chip {...getTagProps({ index: idx })} key={opt.value} label={opt.label} size="small" />
              ))
            }
            sx={{ minWidth: 160 }}
          />
        )}

        {/* Clear all */}
        {hasActiveFilters && (
          <Button size="small" variant="text" color="error" startIcon={<IconX size={14} />} onClick={onClearFilters}>
            Clear all
          </Button>
        )}
      </Stack>
    </Box>
  );
}
