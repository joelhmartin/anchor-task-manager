import { useMemo, useState } from 'react';
import {
  Box, Button, Checkbox, Chip, ClickAwayListener, Divider,
  Paper, Popper, Stack, TextField, Typography
} from '@mui/material';
import { IconPlus } from '@tabler/icons-react';
import { DEFAULT_LABEL_COLOR } from 'constants/taskDefaults';

/**
 * Popover label picker for task items.
 * Shows workspace labels grouped by category with checkboxes to toggle.
 *
 * Props:
 *   anchorEl        - element to anchor the popover to
 *   open            - boolean
 *   onClose         - () => void
 *   workspaceLabels - full list of workspace labels
 *   appliedLabelIds - Set or array of label IDs currently applied to the item
 *   onToggle        - (labelId, isCurrentlyApplied) => void
 *   onCreateNew     - optional () => void — called when user clicks "Create new"
 */
export default function LabelPicker({
  anchorEl,
  open,
  onClose,
  workspaceLabels = [],
  appliedLabelIds = [],
  onToggle,
  onCreateNew
}) {
  const [query, setQuery] = useState('');

  const appliedSet = useMemo(
    () => new Set(Array.isArray(appliedLabelIds) ? appliedLabelIds : []),
    [appliedLabelIds]
  );

  // Group labels by category, filtered by search
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? workspaceLabels.filter((l) => l.label.toLowerCase().includes(q) || (l.category || '').toLowerCase().includes(q))
      : workspaceLabels;

    const map = {};
    for (const l of filtered) {
      const cat = l.category || 'General';
      if (!map[cat]) map[cat] = [];
      map[cat].push(l);
    }
    return map;
  }, [workspaceLabels, query]);

  const categories = Object.keys(grouped).sort();

  return (
    <Popper open={open} anchorEl={anchorEl} placement="bottom-start" sx={{ zIndex: 2000 }}>
      <ClickAwayListener onClickAway={onClose}>
        <Paper sx={{ p: 1, width: 280, maxHeight: 360, overflow: 'auto' }}>
          <Stack spacing={1}>
            <TextField
              size="small"
              placeholder="Search labels..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />

            {categories.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
                {workspaceLabels.length === 0 ? 'No labels created yet.' : 'No matches.'}
              </Typography>
            )}

            {categories.map((cat) => (
              <Box key={cat}>
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>
                  {cat}
                </Typography>
                <Stack spacing={0}>
                  {grouped[cat].map((label) => {
                    const isApplied = appliedSet.has(label.id);
                    return (
                      <Stack
                        key={label.id}
                        direction="row"
                        alignItems="center"
                        spacing={0.5}
                        sx={{
                          px: 0.5,
                          py: 0.25,
                          borderRadius: 1,
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'action.hover' }
                        }}
                        onClick={() => onToggle?.(label.id, isApplied)}
                      >
                        <Checkbox size="small" checked={isApplied} sx={{ p: 0.25 }} tabIndex={-1} />
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            bgcolor: label.color || DEFAULT_LABEL_COLOR,
                            flexShrink: 0
                          }}
                        />
                        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} title={label.label}>
                          {label.label}
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            ))}

            {onCreateNew && (
              <>
                <Divider />
                <Button
                  size="small"
                  startIcon={<IconPlus size={14} />}
                  onClick={() => {
                    onClose?.();
                    onCreateNew();
                  }}
                  sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                >
                  Create new label
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}

/**
 * Renders a row of small colored label chips.
 * Used in BoardTable cells and ItemDrawer.
 */
export function LabelChips({ labels = [], size = 'small', onDelete, maxVisible = 3, sx = {} }) {
  const visible = labels.slice(0, maxVisible);
  const remaining = labels.length - maxVisible;

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', ...sx }}>
      {visible.map((l) => (
        <Chip
          key={l.id}
          label={l.label}
          size={size}
          onDelete={onDelete ? () => onDelete(l.id) : undefined}
          sx={{
            bgcolor: l.color || DEFAULT_LABEL_COLOR,
            color: 'common.white',
            fontWeight: 600,
            fontSize: '0.7rem',
            height: size === 'small' ? 22 : 26,
            '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.7)', '&:hover': { color: 'common.white' } }
          }}
        />
      ))}
      {remaining > 0 && (
        <Chip
          label={`+${remaining}`}
          size={size}
          sx={{ height: size === 'small' ? 22 : 26, fontSize: '0.7rem' }}
        />
      )}
      {labels.length === 0 && !onDelete && (
        <Typography variant="caption" color="text.secondary">
          —
        </Typography>
      )}
    </Stack>
  );
}
