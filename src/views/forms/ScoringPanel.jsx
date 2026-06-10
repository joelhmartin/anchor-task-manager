/**
 * ScoringPanel — Form scoring configuration.
 *
 * Features:
 * - Enable/disable scoring for the form
 * - Configure score ranges with labels and colors
 * - Toggle show score to user
 * - Per-option scores are configured in the OptionsEditor (in BuilderPane)
 */

import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

export default function ScoringPanel({ style, onStyleChange }) {
  const scoring = style.scoring || { enabled: false, ranges: [], showToUser: true, fieldName: 'custom_total_score' };

  const updateScoring = (updates) => {
    onStyleChange({ scoring: { ...scoring, ...updates } });
  };

  const toggleScoring = (enabled) => {
    if (enabled && (!scoring.ranges || scoring.ranges.length === 0)) {
      updateScoring({
        enabled: true,
        ranges: [
          { min: 0, max: 30, label: 'Low', color: '#28a745' },
          { min: 31, max: 60, label: 'Medium', color: '#ffc107' },
          { min: 61, max: 100, label: 'High', color: '#dc3545' }
        ]
      });
    } else {
      updateScoring({ enabled });
    }
  };

  const updateRange = (idx, updates) => {
    const ranges = (scoring.ranges || []).map((r, i) => (i === idx ? { ...r, ...updates } : r));
    updateScoring({ ranges });
  };

  const addRange = () => {
    const ranges = scoring.ranges || [];
    const lastMax = ranges.length > 0 ? ranges[ranges.length - 1].max : 0;
    updateScoring({
      ranges: [...ranges, { min: lastMax + 1, max: lastMax + 30, label: 'New Range', color: '#007bff' }]
    });
  };

  const removeRange = (idx) => {
    updateScoring({ ranges: (scoring.ranges || []).filter((_, i) => i !== idx) });
  };

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Scoring</Typography>

      <FormControlLabel
        control={<Switch checked={scoring.enabled || false} onChange={(e) => toggleScoring(e.target.checked)} />}
        label="Enable scoring"
      />

      {scoring.enabled && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
            Assign point values to options in select, radio, and checkbox fields. The total score is calculated automatically.
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={scoring.showToUser !== false}
                onChange={(e) => updateScoring({ showToUser: e.target.checked })}
                size="small"
              />
            }
            label={<Typography variant="body2">Show score to user</Typography>}
          />

          <TextField
            label="CTM Score Field Name"
            value={scoring.fieldName || 'custom_total_score'}
            onChange={(e) => updateScoring({ fieldName: e.target.value })}
            size="small"
            fullWidth
            helperText="Field name sent to CTM"
          />

          <Divider />
          <Typography variant="caption" color="text.secondary" fontWeight={600}>Score Ranges</Typography>

          {(scoring.ranges || []).map((range, i) => (
            <Stack key={i} direction="row" spacing={0.5} alignItems="center">
              <TextField
                type="number"
                value={range.min}
                onChange={(e) => updateRange(i, { min: Number(e.target.value) })}
                size="small"
                sx={{ width: 55 }}
                inputProps={{ style: { textAlign: 'center', fontSize: 12 } }}
              />
              <Typography variant="caption">–</Typography>
              <TextField
                type="number"
                value={range.max}
                onChange={(e) => updateRange(i, { max: Number(e.target.value) })}
                size="small"
                sx={{ width: 55 }}
                inputProps={{ style: { textAlign: 'center', fontSize: 12 } }}
              />
              <TextField
                value={range.label}
                onChange={(e) => updateRange(i, { label: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
                inputProps={{ style: { fontSize: 12 } }}
              />
              <Box
                component="input"
                type="color"
                value={range.color || '#007bff'}
                onChange={(e) => updateRange(i, { color: e.target.value })}
                sx={{ width: 28, height: 28, border: '1px solid #ccc', borderRadius: 0.5, cursor: 'pointer', p: '1px' }}
              />
              <IconButton size="small" onClick={() => removeRange(i)}>
                <DeleteIcon fontSize="small" sx={{ fontSize: 14 }} />
              </IconButton>
            </Stack>
          ))}

          <Button size="small" startIcon={<AddIcon />} onClick={addRange} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontSize: 12 }}>
            Add Range
          </Button>
        </>
      )}
    </Stack>
  );
}
