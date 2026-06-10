import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, Stack, TextField, Typography
} from '@mui/material';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';

export default function StatusLabelsDialog({
  open, onClose,
  statusLabels, editingLabel, setEditingLabel,
  newLabelText, newLabelColor, savingLabel,
  onSetNewLabelText, onSetNewLabelColor,
  onInitializeLabels, onAddLabel, onUpdateLabel, onDeleteLabelClick,
  updateStatusLabelsInView
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Edit Status Labels
        <Typography variant="body2" color="text.secondary">
          Customize status options for this board
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {statusLabels.some((l) => l.id?.toString().startsWith('default-')) && (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={onInitializeLabels} disabled={savingLabel}>
                  Customize
                </Button>
              }
            >
              This board uses default status labels. Click &quot;Customize&quot; to create editable copies.
            </Alert>
          )}

          {statusLabels.map((sl) => (
            <Box
              key={sl.id}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              {editingLabel === sl.id ? (
                <>
                  <input
                    type="color"
                    value={sl.color}
                    onChange={(e) => {
                      updateStatusLabelsInView((prev) =>
                        (prev || []).map((l) => (l.id === sl.id ? { ...l, color: e.target.value } : l))
                      );
                    }}
                    style={{ width: 32, height: 32, border: 'none', cursor: 'pointer' }}
                    aria-label={`Color for status label ${sl.label || ''}`.trim()}
                  />
                  <TextField
                    size="small"
                    value={sl.label}
                    onChange={(e) => {
                      updateStatusLabelsInView((prev) =>
                        (prev || []).map((l) => (l.id === sl.id ? { ...l, label: e.target.value } : l))
                      );
                    }}
                    sx={{ flex: 1 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={sl.is_done_state}
                        onChange={(e) => {
                          updateStatusLabelsInView((prev) =>
                            (prev || []).map((l) => (l.id === sl.id ? { ...l, is_done_state: e.target.checked } : l))
                          );
                        }}
                        size="small"
                      />
                    }
                    label="Done state"
                  />
                  <Button
                    size="small"
                    onClick={() => onUpdateLabel(sl.id, { label: sl.label, color: sl.color, is_done_state: sl.is_done_state })}
                    disabled={savingLabel || sl.id?.toString().startsWith('default-')}
                  >
                    Save
                  </Button>
                  <IconButton size="small" onClick={() => setEditingLabel(null)} aria-label="Cancel editing label">
                    ✕
                  </IconButton>
                </>
              ) : (
                <>
                  <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: sl.color }} />
                  <Typography sx={{ flex: 1 }}>{sl.label}</Typography>
                  {sl.is_done_state && (
                    <Typography variant="caption" color="text.secondary">
                      (marks complete)
                    </Typography>
                  )}
                  <IconButton size="small" onClick={() => setEditingLabel(sl.id)} disabled={sl.id?.toString().startsWith('default-')} aria-label={`Edit status label ${sl.label}`}>
                    <IconPencil size={16} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => onDeleteLabelClick(sl)}
                    disabled={savingLabel || sl.id?.toString().startsWith('default-')}
                    aria-label={`Delete status label ${sl.label}`}
                  >
                    <IconTrash size={16} />
                  </IconButton>
                </>
              )}
            </Box>
          ))}

          {!statusLabels.some((l) => l.id?.toString().startsWith('default-')) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
              <input
                type="color"
                value={newLabelColor}
                onChange={(e) => onSetNewLabelColor(e.target.value)}
                style={{ width: 32, height: 32, border: 'none', cursor: 'pointer' }}
                aria-label="Color for new status label"
              />
              <TextField
                size="small"
                placeholder="New label name"
                value={newLabelText}
                onChange={(e) => onSetNewLabelText(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Button
                size="small"
                startIcon={<IconPlus size={14} />}
                onClick={onAddLabel}
                disabled={savingLabel || !newLabelText.trim()}
              >
                Add
              </Button>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
