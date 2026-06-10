/**
 * AIFormBuilder — Collapsible panel for generating forms from natural language.
 *
 * Renders at the top of the builder when toggled on.
 * Generates a schema via AI, shows preview, and lets user apply or discard.
 */

import { useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';

import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { generateFormSchema } from 'api/forms';

export default function AIFormBuilder({ onApply, formType, open, onToggle }) {
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedSchema, setGeneratedSchema] = useState(null);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showToast('Describe the form you want to create', 'error');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setGeneratedSchema(null);
      const schema = await generateFormSchema(prompt.trim(), formType);
      setGeneratedSchema(schema);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!generatedSchema) return;
    onApply(generatedSchema);
    setGeneratedSchema(null);
    setPrompt('');
    showToast('AI-generated form applied! Review and customize as needed.', 'success');
    onToggle?.(false);
  };

  const handleDiscard = () => {
    setGeneratedSchema(null);
    setError(null);
  };

  return (
    <>
      {/* Toggle button */}
      {!open && (
        <Tooltip title="AI Form Builder">
          <Button
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            onClick={() => onToggle?.(true)}
            size="small"
            sx={{ textTransform: 'none' }}
          >
            AI Builder
          </Button>
        </Tooltip>
      )}

      <Collapse in={open}>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'primary.50', borderColor: 'primary.200' }}>
          <Stack spacing={2}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={1} alignItems="center">
                <AutoAwesomeIcon color="primary" fontSize="small" />
                <Typography variant="subtitle2">AI Form Builder</Typography>
              </Stack>
              <IconButton size="small" onClick={() => onToggle?.(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>

            <TextField
              multiline
              rows={3}
              placeholder="Describe the form you want to create. For example: 'A contact form with name, email, phone number, and a message field for a dental clinic. Include a dropdown for the type of service they're interested in.'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              fullWidth
              size="small"
            />

            <Stack direction="row" spacing={1}>
              <LoadingButton
                variant="contained"
                startIcon={<AutoAwesomeIcon />}
                onClick={handleGenerate}
                loading={loading}
                loadingLabel="Generating..."
                disabled={!prompt.trim()}
              >
                Generate Form
              </LoadingButton>
            </Stack>

            {error && <Alert severity="error">{error}</Alert>}

            {generatedSchema && (
              <>
                <Divider />
                <Alert severity="success">
                  Generated {generatedSchema.fields?.length || 0} fields. Review below and click Apply to use this form.
                </Alert>

                {/* Field preview list */}
                <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 200, overflow: 'auto' }}>
                  <Stack spacing={0.5}>
                    {generatedSchema.fields?.map((field, i) => (
                      <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            px: 1,
                            py: 0.25,
                            bgcolor: 'action.selected',
                            borderRadius: 0.5,
                            fontFamily: 'monospace',
                            minWidth: 60,
                            textAlign: 'center'
                          }}
                        >
                          {field.type}
                        </Typography>
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          {field.label || field.content || field.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {field.width || 'full'}
                          {field.required && ' *'}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>

                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button size="small" onClick={handleDiscard} color="inherit">
                    Discard
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<CheckIcon />}
                    onClick={handleApply}
                    color="success"
                  >
                    Apply to Form
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </Paper>
      </Collapse>
    </>
  );
}
