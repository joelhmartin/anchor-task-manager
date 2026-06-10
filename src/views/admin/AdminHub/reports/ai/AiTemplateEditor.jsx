import { useEffect, useMemo, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MainCard from 'ui-component/cards/MainCard';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { getAiTemplate, updateAiTemplate, approveAiTemplate } from 'api/aiReports';
import AiTestRunPanel from './AiTestRunPanel';
import AiRunDialog from './AiRunDialog';

const DATA_SOURCE_OPTIONS = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'tasks', label: 'Tasks' }
];

const MODEL_OPTIONS = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
];
const DEFAULT_TEMPLATE_MODEL = 'gemini-2.5-pro';

export default function AiTemplateEditor() {
  const { id } = useParams();
  const { showToast } = useToast();

  const [tpl, setTpl] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [dataSources, setDataSources] = useState(['analytics', 'reviews', 'tasks']);
  const [tone, setTone] = useState('executive');
  const [modelName, setModelName] = useState(DEFAULT_TEMPLATE_MODEL);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [approvedCandidate, setApprovedCandidate] = useState(null);

  const draftFingerprint = useMemo(
    () => JSON.stringify({ name, description, prompt, dataSources: [...dataSources].sort(), tone, modelName }),
    [name, description, prompt, dataSources, tone, modelName]
  );
  const hasCurrentTestRun = approvedCandidate?.draftFingerprint === draftFingerprint && approvedCandidate?.item?.id;

  const loadTemplate = async () => {
    try {
      const fetched = await getAiTemplate(id);
      setTpl(fetched);
      setName(fetched.name || '');
      setDescription(fetched.description || '');
      setPrompt(fetched.prompt || '');
      const include = fetched.data_scope?.include;
      setDataSources(Array.isArray(include) && include.length > 0 ? include : ['analytics', 'reviews', 'tasks']);
      setTone(fetched.style_recipe?.tone || 'executive');
      setModelName(fetched.style_recipe?.model_name || fetched.style_recipe?.modelName || DEFAULT_TEMPLATE_MODEL);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to load template', 'error');
    }
  };

  useEffect(() => { loadTemplate(); }, [id]);

  const handleToggleSource = (key) => {
    setDataSources((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateAiTemplate(id, {
        name,
        description,
        prompt,
        dataScope: { ...(tpl?.data_scope || {}), include: dataSources },
        styleRecipe: { ...(tpl?.style_recipe || {}), tone, model_name: modelName }
      });
      setTpl(updated);
      setApprovedCandidate((current) => (current?.draftFingerprint === draftFingerprint ? current : null));
      showToast('Template saved', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save template', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!hasCurrentTestRun) {
      showToast('Run and review a successful test report before approving this version', 'error');
      return;
    }
    setApproving(true);
    try {
      await approveAiTemplate(id, { approvedRunItemId: approvedCandidate.item.id, modelName });
      showToast('Template version approved', 'success');
      await loadTemplate();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to approve template', 'error');
    } finally {
      setApproving(false);
    }
  };

  return (
    <MainCard
      title={
        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title="Back to templates">
            <IconButton component={RouterLink} to="/admin/reports" size="small">
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="h3" component="span">
            {name || 'AI Report Template'}
          </Typography>
        </Stack>
      }
      secondary={
        <Stack direction="row" spacing={1}>
          <LoadingButton loading={saving} loadingLabel="Saving…" onClick={handleSave} variant="contained">
            Save Draft
          </LoadingButton>
          <LoadingButton loading={approving} loadingLabel="Approving…" onClick={handleApprove} variant="outlined">
            Approve This Version
          </LoadingButton>
          <Button
            variant="contained"
            disabled={!tpl || tpl.status !== 'approved'}
            onClick={() => setRunOpen(true)}
          >
            Run for Clients
          </Button>
        </Stack>
      }
    >
      <Grid container spacing={3}>
        {/* Left: settings */}
        <Grid item xs={12} md={5}>
          <Stack spacing={2}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={2}
            />
            <TextField
              label="Prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              fullWidth
              multiline
              minRows={6}
              helperText="Plain-language brief. The AI sees this plus a frozen data package with the selected sources below."
            />
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Data Sources
              </Typography>
              <Stack>
                {DATA_SOURCE_OPTIONS.map(({ key, label }) => (
                  <FormControlLabel
                    key={key}
                    control={
                      <Checkbox
                        checked={dataSources.includes(key)}
                        onChange={() => handleToggleSource(key)}
                        size="small"
                      />
                    }
                    label={label}
                  />
                ))}
              </Stack>
            </Box>
            <TextField
              label="Tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              fullWidth
              size="small"
              helperText="e.g. executive, friendly, clinical"
            />
            <Box>
              <SelectField
                label="Template Model"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                options={MODEL_OPTIONS}
                size="small"
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Used for test runs and saved with the approved template version.
              </Typography>
            </Box>
          </Stack>
        </Grid>

        {/* Right: test-run panel */}
        <Grid item xs={12} md={7}>
          <AiTestRunPanel
            templateId={id}
            draftFingerprint={draftFingerprint}
            onRunComplete={(candidate) => setApprovedCandidate(candidate)}
            onBeforeRun={async () => {
              // Auto-save the current form state so the test run uses what the
              // user is seeing on screen, not the stale DB draft.
              await updateAiTemplate(id, {
                name,
                description,
                prompt,
                dataScope: { ...(tpl?.data_scope || {}), include: dataSources },
                styleRecipe: { ...(tpl?.style_recipe || {}), tone, model_name: modelName }
              });
            }}
          />
        </Grid>
      </Grid>

      <AiRunDialog
        open={runOpen}
        onClose={() => setRunOpen(false)}
        templateId={id}
        onStarted={() => {
          /* v1: dialog toasts on success; future: navigate to run detail */
        }}
      />
    </MainCard>
  );
}
