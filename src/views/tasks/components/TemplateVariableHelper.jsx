import { useState } from 'react';
import { Box, Chip, IconButton, Popover, Stack, Typography } from '@mui/material';
import { IconCode } from '@tabler/icons-react';

const VARIABLE_GROUPS = [
  {
    label: 'Item',
    variables: [
      { key: '{item.name}', desc: 'Item name' },
      { key: '{item.status}', desc: 'Current status' },
      { key: '{item.due_date}', desc: 'Due date' },
      { key: '{item.id}', desc: 'Item ID' }
    ]
  },
  {
    label: 'Event',
    variables: [
      { key: '{event.type}', desc: 'Event type' },
      { key: '{event.old_value.status}', desc: 'Previous status' },
      { key: '{event.new_value.status}', desc: 'New status' }
    ]
  },
  {
    label: 'Actor',
    variables: [
      { key: '{actor.first_name}', desc: 'First name' },
      { key: '{actor.last_name}', desc: 'Last name' },
      { key: '{actor.email}', desc: 'Actor email' },
      { key: '{actor.role}', desc: 'Actor role' }
    ]
  },
  {
    label: 'Board',
    variables: [
      { key: '{board.name}', desc: 'Board name' },
      { key: '{workspace.name}', desc: 'Workspace name' }
    ]
  },
  {
    label: 'Date',
    variables: [
      { key: '{date.now}', desc: 'Current date/time' },
      { key: '{date.today}', desc: 'Today (YYYY-MM-DD)' }
    ]
  }
];

export default function TemplateVariableHelper({ onInsert }) {
  const [anchorEl, setAnchorEl] = useState(null);

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} title="Insert variable" aria-label="Insert variable">
        <IconCode size={16} />
      </IconButton>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, maxWidth: 320, maxHeight: 400, overflow: 'auto' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Template Variables</Typography>
          <Stack spacing={1.5}>
            {VARIABLE_GROUPS.map((group) => (
              <Stack key={group.label} spacing={0.5}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {group.label}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {group.variables.map((v) => (
                    <Chip
                      key={v.key}
                      label={v.key}
                      size="small"
                      variant="outlined"
                      title={v.desc}
                      onClick={() => {
                        onInsert(v.key);
                        setAnchorEl(null);
                      }}
                      sx={{ height: 22, fontSize: '0.7rem', cursor: 'pointer' }}
                    />
                  ))}
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Popover>
    </>
  );
}
