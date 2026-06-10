import { Menu, MenuItem, ListItemIcon, ListItemText, Divider, Typography } from '@mui/material';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';

const SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'assignees', label: 'Assignees' },
  { key: 'updates', label: 'Updates' },
  { key: 'time', label: 'Time' },
];

export default function SortMenu({ anchorEl, open, onClose, sortBy, sortDir, onToggleSort, onClearSort }) {
  return (
    <Menu anchorEl={anchorEl} open={open} onClose={onClose} slotProps={{ paper: { sx: { minWidth: 200 } } }}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, display: 'block' }}>
        Sort by
      </Typography>
      {SORT_OPTIONS.map((opt) => {
        const isActive = sortBy === opt.key;
        return (
          <MenuItem
            key={opt.key}
            selected={isActive}
            onClick={() => {
              onToggleSort(opt.key);
              onClose();
            }}
          >
            {isActive && (
              <ListItemIcon sx={{ minWidth: 28 }}>
                {sortDir === 'asc' ? <IconArrowUp size={16} /> : <IconArrowDown size={16} />}
              </ListItemIcon>
            )}
            <ListItemText inset={!isActive}>{opt.label}</ListItemText>
          </MenuItem>
        );
      })}
      {sortBy && (
        <>
          <Divider />
          <MenuItem
            onClick={() => {
              onClearSort();
              onClose();
            }}
          >
            <ListItemText>Clear sort</ListItemText>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
