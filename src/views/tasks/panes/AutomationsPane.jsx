import { useEffect, useMemo, useState, useCallback } from 'react';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  LinearProgress,
  ListSubheader,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  IconArrowLeft,
  IconBolt,
  IconList,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconSettings,
  IconSitemap,
  IconTrash,
  IconChevronDown,
  IconChevronUp
} from '@tabler/icons-react';
import { useTaskContext } from 'contexts/TaskContext';
import { useToast } from 'contexts/ToastContext';
import {
  fetchTaskBoardAutomations,
  createTaskBoardAutomation,
  fetchGlobalTaskAutomations,
  createGlobalTaskAutomation,
  updateTaskAutomation,
  fetchAutomationRuns,
  deleteTaskAutomation,
  fetchAutomationSteps,
  createAutomationStep,
  updateAutomationStep,
  deleteAutomationStep,
  reorderAutomationStep,
  fetchAutomationQuota,
  fetchAutomationWorkflowRuns,
  testAutomation,
  fetchBoardStatusLabels
} from 'api/tasks';
import { getTriggerLabel, getActionLabel, groupedTriggers, groupedActions } from 'constants/automationTypes';
import StepBuilder from '../components/StepBuilder';
import FlowBuilder from '../components/FlowBuilder';
import StepEditorDialog from '../components/StepEditorDialog';
import WorkflowRunsPanel from '../components/WorkflowRunsPanel';
import EditAutomationDialog from '../components/EditAutomationDialog';
import TriggerPickerDialog from '../components/TriggerPickerDialog';

// ------- Default draft for creating new automation -------
function defaultDraft(statusLabels) {
  const defaultStatus = (statusLabels || []).find((l) => l.label)?.label || 'Needs Attention';
  return {
    name: 'When status changes \u2192 notify admins',
    trigger_type: 'status_change',
    trigger_config: { to_status: defaultStatus },
    action_type: 'notify_admins',
    action_config: { title: 'Task updated', body: 'A task changed status.' },
    is_active: true
  };
}

// ------- Quota Bar -------
function QuotaBar({ quota, loading }) {
  if (loading || !quota) return null;
  const { used = 0, limit = 1000 } = quota;
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" color="text.secondary">
          Automation runs: {used} / {limit}
        </Typography>
        <Typography variant="caption" color={pct > 80 ? 'error' : 'text.secondary'}>
          {pct.toFixed(0)}%
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={pct > 80 ? 'error' : pct > 60 ? 'warning' : 'primary'}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Stack>
  );
}

// ------- Automation Card (list view) -------
function AutomationCard({ rule, onToggle, onEdit, onDelete, onReEnable }) {
  return (
    <Box
      sx={{
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' }
      }}
    >
      <Switch size="small" checked={rule.is_active} onChange={() => onToggle(rule)} />

      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500} noWrap title={rule.name}>
          {rule.name}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
          <Chip label={getTriggerLabel(rule.trigger_type)} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
          <Typography variant="caption" color="text.secondary">{'\u2192'}</Typography>
          <Chip label={getActionLabel(rule.action_type)} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
          {Number(rule.step_count) > 0 && (
            <Chip label={`${rule.step_count} steps`} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
          )}
          {rule.disabled_reason && String(rule.disabled_reason).startsWith('Circuit breaker') && (
            <>
              <Chip label="Circuit Breaker" size="small" color="error" sx={{ height: 20, fontSize: '0.65rem' }} />
              <Chip
                label="Re-enable"
                size="small"
                color="primary"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.65rem', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onReEnable(rule); }}
              />
            </>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={0.5}>
        <Tooltip title="Edit">
          <IconButton size="small" onClick={() => onEdit(rule)} aria-label={`Edit automation ${rule.name || rule.id}`}>
            <IconSettings size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" color="error" onClick={() => onDelete(rule)} aria-label={`Delete automation ${rule.name || rule.id}`}>
            <IconTrash size={16} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

// ======= MAIN COMPONENT =======
export default function AutomationsPane({ activeBoardId = '', boardStatusLabels = [] }) {
  const { allBoards, boardsLoading: loadingBoards, loadAllBoards, workspaceMembers, workspaceLabels } = useTaskContext();
  const { showToast } = useToast();

  // --- View state ---
  const [view, setView] = useState('list'); // 'list' | 'builder'
  const [builderAutomation, setBuilderAutomation] = useState(null);
  const [builderMode, setBuilderMode] = useState('flow'); // 'list' | 'flow'

  // --- Scope / board ---
  const [scope, setScope] = useState('board');
  const [selectedBoardId, setSelectedBoardId] = useState(activeBoardId || '');
  const [boardQuery, setBoardQuery] = useState('');

  // --- Rules / runs ---
  const [rules, setRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [error, setError] = useState('');

  // --- Create automation ---
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(() => defaultDraft(boardStatusLabels));

  // --- Trigger picker dialog ---
  const [triggerPickerOpen, setTriggerPickerOpen] = useState(false);
  const [triggerPickerSaving, setTriggerPickerSaving] = useState(false);

  // --- Edit dialog (legacy) ---
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: '', trigger_config: {}, action_config: {} });

  // --- Delete confirm ---
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // --- Builder: steps ---
  const [steps, setSteps] = useState([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepEditorOpen, setStepEditorOpen] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  const [savingStep, setSavingStep] = useState(false);

  // --- Builder: workflow runs ---
  const [workflowRuns, setWorkflowRuns] = useState([]);
  const [workflowRunsLoading, setWorkflowRunsLoading] = useState(false);
  const [runsExpanded, setRunsExpanded] = useState(false);

  // --- Quota ---
  const [quota, setQuota] = useState(null);
  const [quotaLoading, setQuotaLoading] = useState(false);

  // --- Testing ---
  const [testing, setTesting] = useState(false);

  // --- Board sync ---
  useEffect(() => {
    if (activeBoardId) setSelectedBoardId(activeBoardId);
  }, [activeBoardId]);

  useEffect(() => {
    if (!allBoards.length) loadAllBoards();
  }, [allBoards.length, loadAllBoards]);

  const effectiveBoardId = scope === 'board' ? selectedBoardId : '';

  // Fetch status labels for the currently selected board (not just the active board from TaskManager)
  const [localStatusLabels, setLocalStatusLabels] = useState([]);
  useEffect(() => {
    if (!effectiveBoardId) { setLocalStatusLabels([]); return; }
    // If selected board matches the parent prop, use that; otherwise fetch
    if (effectiveBoardId === activeBoardId && boardStatusLabels?.length) {
      setLocalStatusLabels(boardStatusLabels);
    } else {
      fetchBoardStatusLabels(effectiveBoardId)
        .then((labels) => setLocalStatusLabels(labels || []))
        .catch(() => setLocalStatusLabels([]));
    }
  }, [effectiveBoardId, activeBoardId, boardStatusLabels]);

  const effectiveStatusLabels = localStatusLabels.length ? localStatusLabels : boardStatusLabels;

  const statusOptions = useMemo(() => {
    const labels = Array.isArray(effectiveStatusLabels) && effectiveStatusLabels.length
      ? effectiveStatusLabels
      : [{ id: 'default', label: 'Needs Attention' }];
    return labels.map((l) => l.label);
  }, [effectiveStatusLabels]);

  // --- Refresh rules ---
  const refresh = useCallback(async () => {
    setError('');
    setLoadingRules(true);
    try {
      const next = scope === 'global'
        ? await fetchGlobalTaskAutomations()
        : effectiveBoardId
          ? await fetchTaskBoardAutomations(effectiveBoardId)
          : [];
      setRules(next || []);
    } catch (err) {
      setRules([]);
      setError(err.message || 'Unable to load automations');
    } finally {
      setLoadingRules(false);
    }

    setLoadingRuns(true);
    try {
      const params = scope === 'global'
        ? { scope: 'global' }
        : effectiveBoardId
          ? { scope: 'board', board_id: effectiveBoardId }
          : { scope: 'board' };
      const rows = await fetchAutomationRuns(params);
      setRuns(rows || []);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, [scope, effectiveBoardId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // --- Load quota on mount ---
  useEffect(() => {
    setQuotaLoading(true);
    fetchAutomationQuota()
      .then((q) => setQuota(q))
      .catch(() => setQuota(null))
      .finally(() => setQuotaLoading(false));
  }, []);

  // --- Create automation (instant → opens builder) ---
  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      // Seed default values that the UI shows but may not be in draft
      const payload = { ...draft, action_config: { ...draft.action_config } };
      if (payload.action_type === 'set_status' && !payload.action_config.status) {
        payload.action_config.status = statusOptions[0] || 'To Do';
      }
      if (scope === 'global') {
        await createGlobalTaskAutomation(payload);
      } else {
        if (!effectiveBoardId) throw new Error('Select a board first');
        await createTaskBoardAutomation(effectiveBoardId, payload);
      }
      setDraft(defaultDraft(effectiveStatusLabels));
      setShowCreateForm(false);
      showToast('Automation created', 'success');
      await refresh();
    } catch (err) {
      showToast(err.message || 'Unable to create automation', 'error');
    } finally {
      setCreating(false);
    }
  };

  // --- Quick-create and open builder (flow-first experience) ---
  const handleNewAutomation = async () => {
    setCreating(true);
    setError('');
    try {
      const payload = {
        name: 'New Automation',
        trigger_type: 'status_change',
        trigger_config: {},
        action_type: 'notify_users',
        action_config: { recipient_mode: 'current_assignees', title: 'Task updated', body: '{item.name} changed status to {item.status}' }
      };
      let created;
      if (scope === 'global') {
        created = await createGlobalTaskAutomation(payload);
      } else {
        if (!effectiveBoardId) throw new Error('Select a board first');
        created = await createTaskBoardAutomation(effectiveBoardId, payload);
      }
      await refresh();
      // Immediately open builder with the new automation
      setBuilderAutomation(created);
      setView('builder');
      loadBuilderData(created.id);
      showToast('Automation created — configure it on the canvas', 'success');
    } catch (err) {
      showToast(err.message || 'Unable to create automation', 'error');
    } finally {
      setCreating(false);
    }
  };

  // --- Toggle active ---
  const handleToggle = async (rule) => {
    if (!rule?.id) return;
    try {
      const updated = await updateTaskAutomation(rule.id, { is_active: !rule.is_active });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      showToast(`Automation ${updated.is_active ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      showToast(err.message || 'Unable to update automation', 'error');
    }
  };

  // --- Re-enable (circuit breaker recovery) ---
  const handleReEnable = async (rule) => {
    if (!rule?.id) return;
    try {
      const updated = await updateTaskAutomation(rule.id, { is_active: true, error_count: 0, disabled_reason: null });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      showToast('Automation re-enabled', 'success');
    } catch (err) {
      showToast(err.message || 'Unable to re-enable automation', 'error');
    }
  };

  // --- Edit (choose legacy dialog vs builder) ---
  const handleEdit = (rule) => {
    // Always open the builder view (the legacy dialog is used only for
    // quick inline edits via a different entry point)
    setBuilderAutomation(rule);
    setView('builder');
    loadBuilderData(rule.id);
  };

  const handleSaveTrigger = async ({ name, trigger_type, trigger_config }) => {
    if (!builderAutomation?.id) return;
    setTriggerPickerSaving(true);
    try {
      const updated = await updateTaskAutomation(builderAutomation.id, { name, trigger_type, trigger_config });
      setBuilderAutomation(updated);
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setTriggerPickerOpen(false);
      showToast('Trigger updated', 'success');
    } catch (err) {
      showToast(err.message || 'Unable to update trigger', 'error');
    } finally {
      setTriggerPickerSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingAutomation?.id) return;
    setError('');
    try {
      const payload = {
        name: editDraft.name || editingAutomation.name,
        trigger_config: editDraft.trigger_config,
        action_config: editDraft.action_config
      };
      // Include trigger_type / action_type if changed via draft
      if (editDraft.trigger_type && editDraft.trigger_type !== editingAutomation.trigger_type) {
        payload.trigger_type = editDraft.trigger_type;
      }
      if (editDraft.action_type && editDraft.action_type !== editingAutomation.action_type) {
        payload.action_type = editDraft.action_type;
      }
      const updated = await updateTaskAutomation(editingAutomation.id, payload);
      setRules((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      // Also update builder automation if we're editing the active one
      if (builderAutomation?.id === updated.id) {
        setBuilderAutomation(updated);
      }
      setEditDialogOpen(false);
      setEditingAutomation(null);
      showToast('Automation updated', 'success');
    } catch (err) {
      showToast(err.message || 'Unable to save automation', 'error');
    }
  };

  // --- Delete ---
  const handleDeleteClick = (rule) => {
    setRuleToDelete(rule);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!ruleToDelete) return;
    setDeleting(true);
    try {
      await deleteTaskAutomation(ruleToDelete.id);
      setRules((prev) => prev.filter((r) => r.id !== ruleToDelete.id));
      setDeleteConfirmOpen(false);
      setRuleToDelete(null);
      showToast('Automation deleted', 'success');
      // If we deleted the builder automation, go back to list
      if (builderAutomation?.id === ruleToDelete.id) {
        setView('list');
        setBuilderAutomation(null);
      }
    } catch (err) {
      showToast(err.message || 'Unable to delete automation', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ======= BUILDER FUNCTIONS =======

  const loadBuilderData = async (automationId) => {
    setStepsLoading(true);
    setWorkflowRunsLoading(true);
    try {
      const data = await fetchAutomationSteps(automationId);
      setSteps(data.steps || data || []);
    } catch {
      setSteps([]);
    } finally {
      setStepsLoading(false);
    }
    try {
      const r = await fetchAutomationWorkflowRuns(automationId);
      setWorkflowRuns(r || []);
    } catch {
      setWorkflowRuns([]);
    } finally {
      setWorkflowRunsLoading(false);
    }
  };

  // --- Steps ---
  const [presetStepType, setPresetStepType] = useState(null);
  const [parentStepId, setParentStepId] = useState(null);

  const handleAddStepClick = (stepType, forParentId = null) => {
    setEditingStep(null);
    setPresetStepType(stepType || null);
    setParentStepId(forParentId);
    setStepEditorOpen(true);
  };

  const handleEditStep = (step) => {
    setEditingStep(step);
    setStepEditorOpen(true);
  };

  const handleDeleteStepConfirm = async (stepId) => {
    try {
      await deleteAutomationStep(stepId);
      // Remove the deleted step and all its descendants
      setSteps((prev) => {
        const descendantIds = new Set([stepId]);
        let found = true;
        while (found) {
          found = false;
          for (const s of prev) {
            if (s.parent_step_id && descendantIds.has(s.parent_step_id) && !descendantIds.has(s.id)) {
              descendantIds.add(s.id);
              found = true;
            }
          }
        }
        return prev.filter((s) => !descendantIds.has(s.id));
      });
      showToast('Step deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Unable to delete step', 'error');
    }
  };

  const handleSaveStep = async (payload) => {
    if (!builderAutomation?.id) return;
    setSavingStep(true);
    try {
      if (editingStep?.id) {
        // Update existing step
        const updated = await updateAutomationStep(editingStep.id, payload);
        setSteps((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        showToast('Step updated', 'success');
      } else {
        // Create new step — include parent_step_id if adding a child
        const createPayload = parentStepId ? { ...payload, parent_step_id: parentStepId } : payload;
        const step = await createAutomationStep(builderAutomation.id, createPayload);
        setSteps((prev) => [...prev, step]);
        showToast('Step added', 'success');
      }
      setStepEditorOpen(false);
      setEditingStep(null);
      setParentStepId(null);
    } catch (err) {
      showToast(err.message || 'Unable to save step', 'error');
    } finally {
      setSavingStep(false);
    }
  };

  const handleReorderStep = async (stepId, newOrder) => {
    // Optimistic: reorder locally
    const oldIndex = steps.findIndex((s) => s.id === stepId);
    if (oldIndex === -1) return;
    const reordered = [...steps];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newOrder, 0, moved);
    setSteps(reordered);

    try {
      await reorderAutomationStep(stepId, newOrder);
      // Reload to get accurate order from server
      const data = await fetchAutomationSteps(builderAutomation.id);
      setSteps(data.steps || data || []);
    } catch (err) {
      showToast(err.message || 'Unable to reorder step', 'error');
      // Revert on failure
      const data = await fetchAutomationSteps(builderAutomation.id);
      setSteps(data.steps || data || []);
    }
  };

  // --- Toggle builder automation active ---
  const handleBuilderToggle = async () => {
    if (!builderAutomation?.id) return;
    try {
      const updated = await updateTaskAutomation(builderAutomation.id, { is_active: !builderAutomation.is_active });
      setBuilderAutomation(updated);
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      showToast(`Automation ${updated.is_active ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      showToast(err.message || 'Unable to update automation', 'error');
    }
  };

  // --- Test automation ---
  const handleTest = async () => {
    if (!builderAutomation?.id) return;
    setTesting(true);
    try {
      const result = await testAutomation(builderAutomation.id);
      showToast(result?.message || 'Dry-run completed successfully', 'success');
    } catch (err) {
      showToast(err.message || 'Test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  // --- Back to list ---
  const handleBack = () => {
    setView('list');
    setBuilderAutomation(null);
    setSteps([]);
    setWorkflowRuns([]);
    refresh();
  };

  // ------- Render trigger config fields for create form -------
  const renderTriggerFields = () => {
    if (draft.trigger_type === 'status_change') {
      return (
        <SelectField
          label="Target status"
          size="small"
          value={draft.trigger_config?.to_status || ''}
          onChange={(e) => setDraft((p) => ({ ...p, trigger_config: { ...(p.trigger_config || {}), to_status: e.target.value } }))}
        >
          <MenuItem value="">Any status</MenuItem>
          {statusOptions.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </SelectField>
      );
    }
    if (draft.trigger_type === 'due_date_relative') {
      return (
        <TextField
          size="small"
          type="number"
          label="Days from due date"
          helperText="-10 = 10 days before, 0 = on due date, 1 = after"
          value={draft.trigger_config?.days_from_due ?? -10}
          onChange={(e) =>
            setDraft((p) => ({ ...p, trigger_config: { ...(p.trigger_config || {}), days_from_due: Number(e.target.value) } }))
          }
        />
      );
    }
    return null;
  };

  // ------- Render action config fields for create form -------
  const renderActionFields = () => {
    if (draft.action_type === 'set_status') {
      return (
        <SelectField
          label="Set to status"
          size="small"
          value={draft.action_config?.status || statusOptions[0] || 'To Do'}
          onChange={(e) => setDraft((p) => ({ ...p, action_config: { ...(p.action_config || {}), status: e.target.value } }))}
        >
          {statusOptions.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </SelectField>
      );
    }
    if (draft.action_type === 'set_needs_attention') {
      return (
        <SelectField
          label="Set attention flag"
          size="small"
          value={String(Boolean(draft.action_config?.value))}
          onChange={(e) => setDraft((p) => ({ ...p, action_config: { ...(p.action_config || {}), value: e.target.value === 'true' } }))}
          options={[
            { value: 'true', label: 'Set to true' },
            { value: 'false', label: 'Set to false' }
          ]}
        />
      );
    }
    if (draft.action_type === 'add_update') {
      return (
        <TextField
          size="small"
          label="Update content"
          value={draft.action_config?.content || ''}
          onChange={(e) => setDraft((p) => ({ ...p, action_config: { ...(p.action_config || {}), content: e.target.value } }))}
        />
      );
    }
    // notification defaults (notify_admins, notify_assignees)
    if (draft.action_type === 'notify_admins' || draft.action_type === 'notify_assignees') {
      return (
        <>
          <TextField
            size="small"
            label="Title"
            value={draft.action_config?.title || ''}
            onChange={(e) => setDraft((p) => ({ ...p, action_config: { ...(p.action_config || {}), title: e.target.value } }))}
          />
          <TextField
            size="small"
            label="Body"
            value={draft.action_config?.body || ''}
            onChange={(e) => setDraft((p) => ({ ...p, action_config: { ...(p.action_config || {}), body: e.target.value } }))}
          />
        </>
      );
    }
    return null;
  };

  const triggerCategories = groupedTriggers();
  const actionCategories = groupedActions();

  // ======= BUILDER VIEW =======
  if (view === 'builder' && builderAutomation) {
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3, minHeight: 420 }}>
        <Stack spacing={2}>
          {/* Header */}
          <Stack direction="row" spacing={1.5} alignItems="center">
            <IconButton size="small" onClick={handleBack} aria-label="Back to automations list">
              <IconArrowLeft size={18} />
            </IconButton>
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <TextField
                value={builderAutomation.name}
                onChange={(e) => setBuilderAutomation((prev) => ({ ...prev, name: e.target.value }))}
                onBlur={async () => {
                  const name = (builderAutomation.name || '').trim();
                  if (name && name !== 'New Automation') {
                    try { await updateTaskAutomation(builderAutomation.id, { name }); } catch {}
                  }
                }}
                variant="standard"
                InputProps={{ disableUnderline: true, sx: { fontSize: '1.1rem', fontWeight: 600 } }}
                placeholder="Automation name"
                fullWidth
              />
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip
                  label={getTriggerLabel(builderAutomation.trigger_type)}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
                <Typography variant="caption" color="text.secondary">{'\u2192'}</Typography>
                <Chip
                  label={getActionLabel(builderAutomation.action_type)}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
              </Stack>
            </Stack>
            <Switch size="small" checked={builderAutomation.is_active} onChange={handleBuilderToggle} />
            <LoadingButton
              size="small"
              variant="outlined"
              startIcon={<IconPlayerPlay size={14} />}
              loading={testing}
              loadingLabel="Testing..."
              onClick={handleTest}
            >
              Test
            </LoadingButton>
          </Stack>

          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          <Divider />

          {/* Step builder with view toggle */}
          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2">Steps ({steps.length})</Typography>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Flow view">
                  <IconButton
                    size="small"
                    color={builderMode === 'flow' ? 'primary' : 'default'}
                    onClick={() => setBuilderMode('flow')}
                    aria-label="Switch to flow view"
                    aria-pressed={builderMode === 'flow'}
                  >
                    <IconSitemap size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="List view">
                  <IconButton
                    size="small"
                    color={builderMode === 'list' ? 'primary' : 'default'}
                    onClick={() => setBuilderMode('list')}
                    aria-label="Switch to list view"
                    aria-pressed={builderMode === 'list'}
                  >
                    <IconList size={16} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
            {builderMode === 'flow' ? (
              <FlowBuilder
                automation={builderAutomation}
                steps={steps}
                loading={stepsLoading}
                onEditStep={handleEditStep}
                onDeleteStep={handleDeleteStepConfirm}
                onAddStep={handleAddStepClick}
                onEditTrigger={() => setTriggerPickerOpen(true)}
              />
            ) : (
              <StepBuilder
                steps={steps}
                loading={stepsLoading}
                onReorder={handleReorderStep}
                onAddStep={handleAddStepClick}
                onAddChildStep={handleAddStepClick}
                onEditStep={handleEditStep}
                onDeleteStep={handleDeleteStepConfirm}
              />
            )}
          </Stack>

          <Divider />

          {/* Workflow runs (collapsible) */}
          <Stack spacing={1}>
            <Button
              size="small"
              onClick={() => setRunsExpanded(!runsExpanded)}
              endIcon={runsExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >
              Workflow runs ({workflowRuns.length})
            </Button>
            <Collapse in={runsExpanded}>
              <WorkflowRunsPanel runs={workflowRuns} loading={workflowRunsLoading} />
            </Collapse>
          </Stack>
        </Stack>

        {/* Step editor dialog */}
        <StepEditorDialog
          open={stepEditorOpen}
          onClose={() => { setStepEditorOpen(false); setEditingStep(null); setPresetStepType(null); setParentStepId(null); }}
          onSave={handleSaveStep}
          step={editingStep?.id ? editingStep : presetStepType ? { step_type: presetStepType } : null}
          statusLabels={effectiveStatusLabels}
          loading={savingStep}
          members={workspaceMembers || []}
          boards={allBoards || []}
          groups={activeBoardId && allBoards?.length ? (allBoards.find((b) => b.id === (scope === 'board' ? effectiveBoardId : activeBoardId))?.groups || []) : []}
          labels={workspaceLabels || []}
          triggerType={builderAutomation?.trigger_type}
        />

        {/* Trigger picker dialog (flow builder) */}
        <TriggerPickerDialog
          open={triggerPickerOpen}
          onClose={() => setTriggerPickerOpen(false)}
          onSave={handleSaveTrigger}
          automation={builderAutomation}
          statusLabels={effectiveStatusLabels}
          loading={triggerPickerSaving}
        />

        {/* Trigger/action edit dialog (shared with list view) */}
        <EditAutomationDialog
          open={editDialogOpen}
          onClose={() => { setEditDialogOpen(false); setEditingAutomation(null); }}
          automation={editingAutomation}
          editDraft={editDraft}
          onChangeDraft={setEditDraft}
          statusLabels={effectiveStatusLabels}
          groups={[]}
          boards={allBoards}
          members={workspaceMembers}
          labels={workspaceLabels}
          onSave={handleSaveEdit}
        />
      </Box>
    );
  }

  // ======= LIST VIEW =======
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3, minHeight: 420 }}>
      <Stack spacing={2}>
        <Stack spacing={0.25}>
          <Typography variant="h5">Automations</Typography>
          <Typography variant="body2" color="text.secondary">
            Create rules to automate your workflow. Scope them to a board or make them global.
          </Typography>
        </Stack>

        {/* Quota bar */}
        <QuotaBar quota={quota} loading={quotaLoading} />

        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        <Divider />

        {/* Scope + board selector */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <SelectField
            size="small"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            sx={{ minWidth: 140 }}
            fullWidth={false}
            options={[
              { value: 'board', label: 'Board' },
              { value: 'global', label: 'Global' }
            ]}
          />

          {scope === 'board' && (
            <Autocomplete
              size="small"
              options={allBoards}
              loading={loadingBoards}
              getOptionLabel={(option) => {
                const ws = option.workspace_name ? ` \u2022 ${option.workspace_name}` : '';
                return `${option.name || 'Board'}${ws}`;
              }}
              value={allBoards.find((b) => b.id === selectedBoardId) || null}
              onChange={(_e, val) => setSelectedBoardId(val?.id || '')}
              inputValue={boardQuery}
              onInputChange={(_e, val) => setBoardQuery(val)}
              sx={{ minWidth: 280, flex: 1 }}
              renderInput={(params) => <TextField {...params} placeholder="Search boards\u2026" />}
              filterOptions={(opts, state) => {
                const q = (state.inputValue || '').toLowerCase().trim();
                if (!q) return opts;
                return opts.filter((o) => {
                  const name = (o.name || '').toLowerCase();
                  const ws = (o.workspace_name || '').toLowerCase();
                  return name.includes(q) || ws.includes(q);
                });
              }}
            />
          )}

          <Button variant="outlined" size="small" onClick={refresh} disabled={loadingRules || loadingRuns}>
            Refresh
          </Button>
        </Stack>

        <Divider />

        {/* Automations list */}
        <Stack spacing={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2">Rules ({rules.length})</Typography>
            <LoadingButton
              size="small"
              variant="contained"
              startIcon={<IconPlus size={14} />}
              onClick={handleNewAutomation}
              loading={creating}
              loadingLabel="Creating..."
              disabled={scope === 'board' && !effectiveBoardId}
            >
              New Automation
            </LoadingButton>
          </Stack>

          {/* Rules list */}
          {loadingRules ? (
            <CircularProgress size={18} />
          ) : (
            <Stack spacing={0.75}>
              {!rules.length && (
                <EmptyState
                  title="No automations yet"
                  message={scope === 'board' && !effectiveBoardId ? 'Select a board to see its automations' : 'Create your first automation to get started'}
                  icon={<IconBolt size={32} />}
                  sx={{ py: 3 }}
                />
              )}
              {rules.map((r) => (
                <AutomationCard
                  key={r.id}
                  rule={r}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                  onDelete={handleDeleteClick}
                  onReEnable={handleReEnable}
                />
              ))}
            </Stack>
          )}
        </Stack>

        <Divider />

        {/* Recent runs */}
        <Stack spacing={1}>
          <Typography variant="subtitle2">Recent runs</Typography>
          {loadingRuns ? (
            <CircularProgress size={18} />
          ) : (
            <Stack spacing={0.75}>
              {!runs.length && (
                <EmptyState title="No runs yet" sx={{ py: 2 }} />
              )}
              {runs.slice(0, 20).map((r) => (
                <Box key={r.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    {r.scope} \u2022 {getTriggerLabel(r.trigger_type)} \u2022 {r.status} \u2022 {r.ran_at ? new Date(r.ran_at).toLocaleString() : ''}
                  </Typography>
                  {r.error && (
                    <Typography variant="body2" color="error" sx={{ mt: 0.25 }}>
                      {r.error}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => { setDeleteConfirmOpen(false); setRuleToDelete(null); }}
        onConfirm={handleDeleteConfirm}
        title="Delete Automation"
        message="Are you sure you want to delete this automation? This action cannot be undone."
        secondaryText={ruleToDelete?.name || undefined}
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
        loadingLabel="Deleting..."
      />

      {/* Legacy Edit Dialog */}
      <EditAutomationDialog
        open={editDialogOpen}
        onClose={() => { setEditDialogOpen(false); setEditingAutomation(null); }}
        automation={editingAutomation}
        editDraft={editDraft}
        onChangeDraft={setEditDraft}
        statusLabels={effectiveStatusLabels}
        groups={[]}
        boards={allBoards}
        members={workspaceMembers}
        labels={workspaceLabels}
        onSave={handleSaveEdit}
      />
    </Box>
  );
}
