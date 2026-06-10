/**
 * OptionsEditor — Edit options for select/radio/checkbox fields
 * With optional score column for scoring forms
 */

import { Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

export default function OptionsEditor({ options, onChange, showScores }) {
  const update = (i, updates) => onChange(options.map((o, j) => j === i ? { ...o, ...updates } : o));
  const add = () => onChange([...options, { label: `Option ${options.length + 1}`, value: `opt${options.length + 1}`, score: 0 }]);
  const remove = (i) => { if (options.length > 1) onChange(options.filter((_, j) => j !== i)); };

  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">Options</Typography>
      {options.map((opt, i) => (
        <Stack key={i} direction="row" spacing={0.5} alignItems="center">
          <TextField value={opt.label} onChange={e => update(i, { label: e.target.value })} size="small" sx={{ flex: 1 }} placeholder="Label" />
          <TextField value={opt.value} onChange={e => update(i, { value: e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() })} size="small" sx={{ flex: 1 }} placeholder="value" />
          {showScores && (
            <TextField type="number" value={opt.score || 0} onChange={e => update(i, { score: Number(e.target.value) || 0 })} size="small" sx={{ width: 55 }} inputProps={{ style: { textAlign: 'center' } }} />
          )}
          <IconButton size="small" onClick={() => remove(i)} disabled={options.length <= 1}><DeleteIcon fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={add} sx={{ alignSelf: 'flex-start' }}>Add Option</Button>
    </Stack>
  );
}
