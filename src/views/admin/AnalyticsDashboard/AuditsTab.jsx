import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import LaunchIcon from '@mui/icons-material/Launch';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import SelectField from 'ui-component/extended/SelectField';
import StatusChip from 'ui-component/extended/StatusChip';
import DataTable from 'ui-component/extended/DataTable';
import MainCard from 'ui-component/cards/MainCard';
import { useToast } from 'contexts/ToastContext';
import {
  createAuditSchedule,
  deleteAuditSchedule,
  fetchAuditRun,
  fetchAuditRuns,
  fetchAuditSchedules,
  runAuditNow,
  runAuditScheduleNow,
  updateAuditSchedule
} from 'api/analytics';
import { TIMEZONE_OPTIONS } from 'constants/timezones';

const LOOKBACK_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' }
];

const CUSTOM_MODEL_OPTION = '__custom__';
const LEGACY_INVALID_AUDIT_MODELS = new Set(['claude', 'openai', 'codex', 'claude_auditor', 'openai_auditor', 'vertex_auditor']);
const COMMON_VERTEX_MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' }
];

const RUN_STATUS_MAP = {
  queued: { status: 'pending', label: 'Queued' },
  running: { status: 'in_progress', label: 'Running' },
  success: { status: 'completed', label: 'Success' },
  error: { status: 'failed', label: 'Error' }
};

function parseRecipientEmails(value = '') {
  return [
    ...new Set(
      String(value)
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ];
}

function getDefaultAuditModel(presets) {
  const defaultModel = String(presets[0]?.defaultModel || '').trim();
  return /^gemini-/i.test(defaultModel) ? defaultModel : 'gemini-2.5-flash';
}

function normalizeAuditModelId(modelId, presets) {
  const trimmedModelId = String(modelId || '').trim();
  if (!trimmedModelId) {
    return getDefaultAuditModel(presets);
  }

  if (LEGACY_INVALID_AUDIT_MODELS.has(trimmedModelId.toLowerCase())) {
    return getDefaultAuditModel(presets);
  }

  return trimmedModelId;
}

function buildModelOptions(presets) {
  const defaultModel = getDefaultAuditModel(presets);
  const hasDefaultInCommon = COMMON_VERTEX_MODEL_OPTIONS.some((option) => option.value === defaultModel);
  const commonOptions = COMMON_VERTEX_MODEL_OPTIONS.map((option) => ({
    ...option,
    label: option.value === defaultModel ? `${option.label} (Default)` : option.label
  }));

  return [
    ...(hasDefaultInCommon ? [] : [{ value: defaultModel, label: `Workspace Default (${defaultModel})` }]),
    ...commonOptions,
    { value: CUSTOM_MODEL_OPTION, label: 'Custom Model ID' }
  ];
}

function buildModelState(modelId, presets) {
  const resolvedModelId = normalizeAuditModelId(modelId, presets);
  const knownModelIds = new Set(
    buildModelOptions(presets)
      .map((option) => option.value)
      .filter((value) => value !== CUSTOM_MODEL_OPTION)
  );

  return knownModelIds.has(resolvedModelId)
    ? { modelChoice: resolvedModelId, customModelId: '' }
    : { modelChoice: CUSTOM_MODEL_OPTION, customModelId: resolvedModelId };
}

function resolveModelId(modelState, presets) {
  if (modelState.modelChoice && modelState.modelChoice !== CUSTOM_MODEL_OPTION) {
    return modelState.modelChoice;
  }

  return normalizeAuditModelId(modelState.customModelId, presets);
}

function buildInitialForm(presets, schedule = null) {
  const modelState = buildModelState(schedule?.config_json?.modelId, presets);
  const localTime = schedule?.daily_time_local ? String(schedule.daily_time_local).slice(0, 5) : '06:00';
  return {
    name: schedule?.name || '',
    lookbackDays: schedule?.config_json?.lookbackDays || 30,
    ...modelState,
    dailyTimeLocal: localTime,
    timezone: schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
    recipientEmailsText: (schedule?.recipient_emails || []).join(', '),
    paused: Boolean(schedule?.paused)
  };
}

function buildManualRunForm(presets, schedules = []) {
  const mostRecentSchedule = schedules[0] || null;
  const modelState = buildModelState(mostRecentSchedule?.config_json?.modelId, presets);
  return {
    lookbackDays: mostRecentSchedule?.config_json?.lookbackDays || 30,
    ...modelState
  };
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatSeverityCounts(summary = {}) {
  const counts = summary.severityCounts || {};
  return `C ${counts.critical || 0} · W ${counts.warning || 0} · I ${counts.info || 0}`;
}

function getRiskTone(overallRisk) {
  if (overallRisk === 'high') return 'error';
  if (overallRisk === 'medium') return 'warning';
  return 'success';
}

function findingSeverityToAlert(severity) {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function getAuditRequestErrorMessage(err, fallbackMessage) {
  if (err?.response?.status === 404) {
    return 'Audit API route not found. Restart the backend server so the new audits routes are loaded.';
  }

  return err?.response?.data?.message || fallbackMessage;
}

export default function AuditsTab({ userId, selection, selectedClient, isAdmin, surface = 'analytics' }) {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [schedules, setSchedules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [formState, setFormState] = useState(() => buildInitialForm([]));
  const [manualRunDialogOpen, setManualRunDialogOpen] = useState(false);
  const [manualRunState, setManualRunState] = useState(() => buildManualRunForm([]));
  const [saving, setSaving] = useState(false);
  const [manualRunSubmitting, setManualRunSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [runningScheduleId, setRunningScheduleId] = useState('');
  const [openRun, setOpenRun] = useState(null);
  const [runLoading, setRunLoading] = useState(false);

  const runParam = searchParams.get('run');
  const isSingleClient = selection?.mode === 'single';
  const hasGoogleAds = Boolean(selectedClient?.has_google_ads);
  const canLoadAudits = Boolean(isAdmin && isSingleClient && hasGoogleAds && userId);
  const modelOptions = useMemo(() => buildModelOptions(presets), [presets]);

  const loadSchedules = useCallback(async () => {
    if (!userId) return;
    setLoadingSchedules(true);
    try {
      const result = await fetchAuditSchedules(userId);
      setSchedules(result.schedules || []);
      setPresets(result.presets || []);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to load audit schedules', 'error');
    } finally {
      setLoadingSchedules(false);
    }
  }, [showToast, userId]);

  const loadRuns = useCallback(async () => {
    if (!userId) return;
    setLoadingRuns(true);
    try {
      const result = await fetchAuditRuns({ userId, limit: 50 });
      setRuns(result.runs || []);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to load audit runs', 'error');
    } finally {
      setLoadingRuns(false);
    }
  }, [showToast, userId]);

  useEffect(() => {
    if (!canLoadAudits) {
      setSchedules([]);
      setRuns([]);
      setOpenRun(null);
      return;
    }
    loadSchedules();
    loadRuns();
  }, [canLoadAudits, loadRuns, loadSchedules]);

  useEffect(() => {
    if (!runParam || !canLoadAudits) return;
    if (openRun?.id === runParam) return;

    let cancelled = false;
    const loadRun = async () => {
      setRunLoading(true);
      try {
        const result = await fetchAuditRun(runParam);
        if (!cancelled) setOpenRun(result.run || null);
      } catch (err) {
        if (!cancelled) {
          showToast(err.response?.data?.message || 'Failed to load audit run', 'error');
        }
      } finally {
        if (!cancelled) setRunLoading(false);
      }
    };

    loadRun();
    return () => {
      cancelled = true;
    };
  }, [canLoadAudits, openRun?.id, runParam, showToast]);

  useEffect(() => {
    if (!runParam) {
      setOpenRun(null);
    }
  }, [runParam]);

  const openCreateDialog = useCallback(() => {
    setEditingSchedule(null);
    setFormState(buildInitialForm(presets));
    setDialogOpen(true);
  }, [presets]);

  const openEditDialog = useCallback(
    (schedule) => {
      setEditingSchedule(schedule);
      setFormState(buildInitialForm(presets, schedule));
      setDialogOpen(true);
    },
    [presets]
  );

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingSchedule(null);
  }, []);

  const openManualRunDialog = useCallback(() => {
    setManualRunState(buildManualRunForm(presets, schedules));
    setManualRunDialogOpen(true);
  }, [presets, schedules]);

  const closeManualRunDialog = useCallback(() => {
    setManualRunDialogOpen(false);
  }, []);

  const handleFormChange = (field) => (event) => {
    const value = event?.target?.type === 'checkbox' ? event.target.checked : event?.target?.value;
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleManualRunChange = (field) => (event) => {
    const value = event?.target?.value;
    setManualRunState((prev) => ({ ...prev, [field]: value }));
  };

  const handleModelChoiceChange = (event) => {
    const value = event?.target?.value;
    setFormState((prev) => ({
      ...prev,
      modelChoice: value,
      customModelId: value === CUSTOM_MODEL_OPTION ? prev.customModelId : ''
    }));
  };

  const handleManualModelChoiceChange = (event) => {
    const value = event?.target?.value;
    setManualRunState((prev) => ({
      ...prev,
      modelChoice: value,
      customModelId: value === CUSTOM_MODEL_OPTION ? prev.customModelId : ''
    }));
  };

  const handleSave = async () => {
    const emails = parseRecipientEmails(formState.recipientEmailsText);
    if (!formState.name.trim()) {
      showToast('Schedule name is required', 'error');
      return;
    }
    if (!emails.length) {
      showToast('At least one recipient email is required', 'error');
      return;
    }
    if (formState.modelChoice === CUSTOM_MODEL_OPTION && !String(formState.customModelId || '').trim()) {
      showToast('Custom model ID is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        userId,
        name: formState.name.trim(),
        providerPreset: presets[0]?.id || 'vertex_auditor',
        recipientEmails: emails,
        dailyTimeLocal: formState.dailyTimeLocal,
        timezone: formState.timezone,
        paused: formState.paused,
        configJson: {
          lookbackDays: Number(formState.lookbackDays || 30),
          modelId: resolveModelId(formState, presets)
        }
      };

      if (editingSchedule) {
        await updateAuditSchedule(editingSchedule.id, payload);
        showToast('Audit schedule updated', 'success');
      } else {
        await createAuditSchedule(payload);
        showToast('Audit schedule created', 'success');
      }

      closeDialog();
      loadSchedules();
      loadRuns();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save audit schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePaused = useCallback(
    async (schedule) => {
      try {
        await updateAuditSchedule(schedule.id, { paused: !schedule.paused });
        showToast(schedule.paused ? 'Audit schedule resumed' : 'Audit schedule paused', 'success');
        loadSchedules();
      } catch (err) {
        showToast(err.response?.data?.message || 'Failed to update audit schedule', 'error');
      }
    },
    [loadSchedules, showToast]
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteAuditSchedule(deleteTarget.id);
      showToast('Audit schedule deleted', 'success');
      setDeleteTarget(null);
      loadSchedules();
      loadRuns();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete audit schedule', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const updateRunQueryParam = useCallback(
    (runId) => {
      const next = new URLSearchParams(searchParams);
      if (runId) {
        next.set('tab', 'audits');
        next.set('run', runId);
      } else {
        next.delete('run');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleViewRun = useCallback(
    async (runId) => {
      setRunLoading(true);
      try {
        const result = await fetchAuditRun(runId);
        setOpenRun(result.run || null);
        updateRunQueryParam(runId);
      } catch (err) {
        showToast(err.response?.data?.message || 'Failed to load audit run', 'error');
      } finally {
        setRunLoading(false);
      }
    },
    [showToast, updateRunQueryParam]
  );

  const handleCloseRun = () => {
    setOpenRun(null);
    updateRunQueryParam(null);
  };

  const handleRunNow = useCallback(
    async (schedule) => {
      setRunningScheduleId(schedule.id);
      try {
        const result = await runAuditScheduleNow(schedule.id);
        showToast('Audit run completed', 'success');
        await Promise.all([loadSchedules(), loadRuns()]);
        if (result.run?.id) {
          setOpenRun(result.run);
          updateRunQueryParam(result.run.id);
        }
      } catch (err) {
        showToast(getAuditRequestErrorMessage(err, 'Failed to run audit'), 'error');
        await loadRuns();
      } finally {
        setRunningScheduleId('');
      }
    },
    [loadRuns, loadSchedules, showToast, updateRunQueryParam]
  );

  const handleManualRunSubmit = useCallback(async () => {
    if (manualRunState.modelChoice === CUSTOM_MODEL_OPTION && !String(manualRunState.customModelId || '').trim()) {
      showToast('Custom model ID is required', 'error');
      return;
    }

    setManualRunSubmitting(true);
    try {
      const result = await runAuditNow({
        userId,
        providerPreset: presets[0]?.id || 'vertex_auditor',
        configJson: {
          lookbackDays: Number(manualRunState.lookbackDays || 30),
          modelId: resolveModelId(manualRunState, presets)
        }
      });
      showToast('Manual audit run completed', 'success');
      closeManualRunDialog();
      await Promise.all([loadSchedules(), loadRuns()]);
      if (result.run?.id) {
        setOpenRun(result.run);
        updateRunQueryParam(result.run.id);
      }
    } catch (err) {
      showToast(getAuditRequestErrorMessage(err, 'Failed to run audit'), 'error');
      await loadRuns();
    } finally {
      setManualRunSubmitting(false);
    }
  }, [closeManualRunDialog, loadRuns, loadSchedules, manualRunState, presets, showToast, updateRunQueryParam, userId]);

  const scheduleColumns = useMemo(
    () => [
      {
        id: 'name',
        label: 'Schedule',
        sortable: true,
        render: (row) => (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" fontWeight={600}>
              {row.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {LOOKBACK_OPTIONS.find((option) => Number(option.value) === Number(row.config_json?.lookbackDays || 30))?.label ||
                'Last 30 days'}
            </Typography>
          </Stack>
        )
      },
      {
        id: 'model',
        label: 'Model',
        render: (row) => <Typography variant="body2">{normalizeAuditModelId(row.config_json?.modelId, presets)}</Typography>
      },
      {
        id: 'next_run_at',
        label: 'Next Run',
        sortable: true,
        sortValue: (row) => (row.next_run_at ? new Date(row.next_run_at).getTime() : 0),
        render: (row) => (
          <Stack spacing={0.5}>
            <Typography variant="body2">{formatDateTime(row.next_run_at)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {row.timezone}
            </Typography>
          </Stack>
        )
      },
      {
        id: 'recipient_emails',
        label: 'Recipients',
        render: (row) => <Typography variant="body2">{(row.recipient_emails || []).join(', ') || '—'}</Typography>
      },
      {
        id: 'paused',
        label: 'Status',
        render: (row) => <StatusChip status={row.paused ? 'paused' : 'active'} label={row.paused ? 'Paused' : 'Active'} />
      },
      {
        id: 'actions',
        label: 'Actions',
        render: (row) => (
          <Stack direction="row" spacing={0.5}>
            <IconButton size="small" onClick={() => handleRunNow(row)} disabled={runningScheduleId === row.id}>
              <PlayArrowIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => handleTogglePaused(row)}>
              {row.paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
            </IconButton>
            <IconButton size="small" onClick={() => openEditDialog(row)}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setDeleteTarget(row)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
        )
      }
    ],
    [handleRunNow, handleTogglePaused, openEditDialog, presets, runningScheduleId]
  );

  const runColumns = useMemo(
    () => [
      {
        id: 'status',
        label: 'Status',
        sortable: true,
        render: (row) => {
          const mapped = RUN_STATUS_MAP[row.status] || { status: row.status, label: row.status };
          return <StatusChip status={mapped.status} label={mapped.label} />;
        }
      },
      {
        id: 'created_at',
        label: 'Started',
        sortable: true,
        sortValue: (row) => (row.created_at ? new Date(row.created_at).getTime() : 0),
        render: (row) => formatDateTime(row.created_at)
      },
      {
        id: 'model',
        label: 'Model',
        render: (row) => <Typography variant="body2">{row.debug_json?.model || presets[0]?.defaultModel || 'gemini-2.5-flash'}</Typography>
      },
      {
        id: 'summary',
        label: 'Summary',
        render: (row) => (
          <Stack spacing={0.5}>
            <Typography variant="body2" fontWeight={600}>
              {row.summary_json?.headline || row.error_message || 'Audit run'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatSeverityCounts(row.summary_json || {})}
            </Typography>
          </Stack>
        )
      },
      {
        id: 'email_status',
        label: 'Email',
        render: (row) => (
          <StatusChip
            status={row.email_status === 'skipped' ? 'inactive' : row.email_status || 'inactive'}
            label={row.email_status === 'skipped' ? 'Not Sent' : row.email_status || 'Unknown'}
          />
        )
      },
      {
        id: 'trigger_type',
        label: 'Trigger',
        render: (row) => <Typography variant="body2">{row.trigger_type === 'scheduled' ? 'Scheduled' : 'Manual'}</Typography>
      },
      {
        id: 'actions',
        label: 'Actions',
        render: (row) => (
          <IconButton size="small" onClick={() => handleViewRun(row.id)}>
            <VisibilityOutlinedIcon fontSize="small" />
          </IconButton>
        )
      }
    ],
    [handleViewRun, presets]
  );

  if (!isAdmin) {
    return <Alert severity="info">Audit management is only available to admins.</Alert>;
  }

  if (!isSingleClient) {
    return (
      <Alert severity="info">Audits are managed one client at a time. Switch analytics selection to a single client to use this tab.</Alert>
    );
  }

  if (!hasGoogleAds) {
    return (
      <EmptyState
        icon={LaunchIcon}
        title="Google Ads is not configured"
        message="This client needs a Google Ads account connected in tracking setup before admin audits can run."
        action={
          <Button variant="contained" component={RouterLink} to="/client-hub" startIcon={<LaunchIcon />}>
            Open Client Hub
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Stack spacing={2}>
        {surface !== 'operations' ? (
          <Alert severity="warning">
            This tab is admin-only. Audit schedules, run history, and AI findings are not exposed anywhere in the client portal.
          </Alert>
        ) : null}

        <MainCard
          title={surface === 'operations' ? 'Google Ads Schedules' : 'Audit Schedules'}
          secondary={
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<PlayArrowIcon />} onClick={openManualRunDialog}>
                Manual Run
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog}>
                New Schedule
              </Button>
            </Stack>
          }
        >
          <DataTable
            columns={scheduleColumns}
            rows={schedules}
            loading={loadingSchedules}
            searchable
            searchFields={['name', (row) => normalizeAuditModelId(row.config_json?.modelId, presets)]}
            outlined
            paginated
            pageSize={10}
            emptyTitle="No audit schedules yet"
            emptyMessage="Create a daily admin audit to review Google Ads performance every morning."
          />
        </MainCard>

        <MainCard title={surface === 'operations' ? 'Recent Google Ads Runs' : 'Recent Audit Runs'}>
          <DataTable
            columns={runColumns}
            rows={runs}
            loading={loadingRuns}
            searchable
            searchFields={['status', 'trigger_type', (row) => row.debug_json?.model || '']}
            outlined
            paginated
            pageSize={10}
            emptyTitle="No audit runs yet"
            emptyMessage="Runs will appear here after a manual execution or the first scheduled morning audit."
          />
        </MainCard>
      </Stack>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>{editingSchedule ? 'Edit Audit Schedule' : 'Create Audit Schedule'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Schedule Name" value={formState.name} onChange={handleFormChange('name')} fullWidth />
            <SelectField
              label="Lookback Window"
              value={formState.lookbackDays}
              onChange={handleFormChange('lookbackDays')}
              options={LOOKBACK_OPTIONS}
            />
            <SelectField label="Vertex Model" value={formState.modelChoice} onChange={handleModelChoiceChange} options={modelOptions} />
            <Typography variant="caption" color="text.secondary">
              Flash is the default for daily audits. Pro is heavier and better suited for deeper reasoning.
            </Typography>
            {formState.modelChoice === CUSTOM_MODEL_OPTION && (
              <TextField
                label="Custom Vertex Model ID"
                value={formState.customModelId}
                onChange={handleFormChange('customModelId')}
                fullWidth
                helperText="Use any Vertex Gemini model ID if you want to override the common presets."
              />
            )}
            <TextField
              label="Daily Time"
              type="time"
              value={formState.dailyTimeLocal}
              onChange={handleFormChange('dailyTimeLocal')}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <SelectField label="Timezone" value={formState.timezone} onChange={handleFormChange('timezone')} options={TIMEZONE_OPTIONS} />
            <TextField
              label="Recipient Emails"
              value={formState.recipientEmailsText}
              onChange={handleFormChange('recipientEmailsText')}
              fullWidth
              multiline
              minRows={2}
              helperText="Separate addresses with commas or new lines."
            />
            <FormControlLabel
              control={<Switch checked={formState.paused} onChange={handleFormChange('paused')} />}
              label="Create as paused"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <LoadingButton onClick={handleSave} loading={saving} variant="contained" loadingLabel="Saving...">
            {editingSchedule ? 'Save Changes' : 'Create Schedule'}
          </LoadingButton>
        </DialogActions>
      </Dialog>

      <Dialog open={manualRunDialogOpen} onClose={closeManualRunDialog} fullWidth maxWidth="sm">
        <DialogTitle>Run Audit Now</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              This creates a one-off admin audit run for the selected client and saves it to run history without creating a schedule.
            </Alert>
            <SelectField
              label="Lookback Window"
              value={manualRunState.lookbackDays}
              onChange={handleManualRunChange('lookbackDays')}
              options={LOOKBACK_OPTIONS}
            />
            <SelectField
              label="Vertex Model"
              value={manualRunState.modelChoice}
              onChange={handleManualModelChoiceChange}
              options={modelOptions}
            />
            <Typography variant="caption" color="text.secondary">
              Use Flash for standard runs. Switch to Pro only when you want a more expensive, deeper pass.
            </Typography>
            {manualRunState.modelChoice === CUSTOM_MODEL_OPTION && (
              <TextField
                label="Custom Vertex Model ID"
                value={manualRunState.customModelId}
                onChange={handleManualRunChange('customModelId')}
                fullWidth
                helperText="Use any Vertex Gemini model ID for this one-off analysis run."
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeManualRunDialog} disabled={manualRunSubmitting}>
            Cancel
          </Button>
          <LoadingButton onClick={handleManualRunSubmit} loading={manualRunSubmitting} variant="contained" loadingLabel="Running...">
            Run Audit
          </LoadingButton>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Audit Schedule"
        message={deleteTarget ? `Delete "${deleteTarget.name}"?` : 'Delete this audit schedule?'}
        secondaryText="This only removes the schedule. Existing audit runs remain in history."
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleteLoading}
        loadingLabel="Deleting..."
      />

      <Drawer
        anchor="right"
        open={Boolean(openRun) || runLoading}
        onClose={handleCloseRun}
        PaperProps={{ sx: { width: { xs: '100%', sm: '44vw' }, minWidth: { xs: 0, sm: 520 }, p: 2 } }}
      >
        {runLoading && !openRun ? (
          <Stack spacing={2}>
            <Typography variant="h3">Loading audit run...</Typography>
          </Stack>
        ) : !openRun ? null : (
          <Stack spacing={2}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
              <Box>
                <Typography variant="h3">{openRun.summary_json?.headline || openRun.schedule_name || 'Audit Run'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatDateTime(openRun.created_at)} · {openRun.trigger_type === 'scheduled' ? 'Scheduled' : 'Manual'} run
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Model: {openRun.debug_json?.model || presets[0]?.defaultModel || 'gemini-2.5-flash'}
                </Typography>
              </Box>
              <StatusChip
                status={RUN_STATUS_MAP[openRun.status]?.status || openRun.status}
                label={RUN_STATUS_MAP[openRun.status]?.label || openRun.status}
              />
            </Stack>

            {openRun.summary_json?.overallRisk && (
              <Alert severity={getRiskTone(openRun.summary_json.overallRisk)}>
                Overall risk: {String(openRun.summary_json.overallRisk).toUpperCase()}
              </Alert>
            )}

            {openRun.summary_json?.executiveSummary && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Executive Summary
                </Typography>
                <Typography variant="body2">{openRun.summary_json.executiveSummary}</Typography>
              </Paper>
            )}

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <StatusChip status="failed" label={`Critical ${openRun.summary_json?.severityCounts?.critical || 0}`} />
                <StatusChip status="warning" label={`Warning ${openRun.summary_json?.severityCounts?.warning || 0}`} />
                <StatusChip status="info" label={`Info ${openRun.summary_json?.severityCounts?.info || 0}`} />
                <StatusChip
                  status={openRun.email_status === 'skipped' ? 'inactive' : openRun.email_status || 'inactive'}
                  label={openRun.email_status === 'skipped' ? 'Email Not Sent' : `Email ${openRun.email_status || 'unknown'}`}
                />
              </Stack>
            </Paper>

            {(openRun.summary_json?.topRecommendations || []).length > 0 && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Top Recommendations
                </Typography>
                <List dense sx={{ py: 0 }}>
                  {openRun.summary_json.topRecommendations.map((recommendation, index) => (
                    <ListItem key={`${recommendation}-${index}`} sx={{ px: 0 }}>
                      <ListItemText primary={recommendation} />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            )}

            <Divider />

            <Stack spacing={1.5}>
              <Typography variant="h4">Findings</Typography>
              {(openRun.result_json?.findings || []).length === 0 ? (
                <Alert severity="success">No material red flags were detected in this run.</Alert>
              ) : (
                (openRun.result_json?.findings || []).map((finding) => (
                  <Alert key={finding.id} severity={findingSeverityToAlert(finding.severity)} variant="outlined">
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {finding.title}
                      </Typography>
                      <Typography variant="body2">{finding.summary}</Typography>
                      {finding.recommendation && (
                        <Typography variant="body2" color="text.secondary">
                          Recommendation: {finding.recommendation}
                        </Typography>
                      )}
                      {(finding.evidence || []).length > 0 && (
                        <List dense sx={{ py: 0 }}>
                          {finding.evidence.map((item, index) => (
                            <ListItem key={`${finding.id}-evidence-${index}`} sx={{ px: 0, py: 0.25 }}>
                              <ListItemText primary={`${item.label}: ${item.value}`} />
                            </ListItem>
                          ))}
                        </List>
                      )}
                    </Stack>
                  </Alert>
                ))
              )}
            </Stack>

            {(openRun.result_json?.facts?.errors || []).length > 0 && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Source Errors
                </Typography>
                <List dense sx={{ py: 0 }}>
                  {openRun.result_json.facts.errors.map((error, index) => (
                    <ListItem key={`${error.scope}-${index}`} sx={{ px: 0 }}>
                      <ListItemText primary={`${error.scope}: ${error.message}`} />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            )}
          </Stack>
        )}
      </Drawer>
    </>
  );
}
