import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { IconLayoutDashboard, IconPlus, IconTrash, IconCheck, IconX } from '@tabler/icons-react';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import SelectField from 'ui-component/extended/SelectField';
import { useTaskContext } from 'contexts/TaskContext';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import {
  fetchDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  fetchDashboardWidgets,
  createWidget
} from 'api/tasks';

import WidgetCard from '../components/widgets/WidgetCard';
import AddWidgetDialog from '../components/widgets/AddWidgetDialog';

const DEFAULT_WIDGETS = [
  { widget_type: 'status_breakdown', config: {}, position: { col: 0, row: 0 } },
  { widget_type: 'priority_distribution', config: {}, position: { col: 1, row: 0 } },
  { widget_type: 'kpi_number', config: { metric: 'open_items' }, position: { col: 2, row: 0 } },
  { widget_type: 'overdue', config: {}, position: { col: 3, row: 0 } }
];

export default function DashboardPane({ activeWorkspaceId: propWorkspaceId }) {
  const { workspaces } = useTaskContext();
  const activeWorkspaceId = propWorkspaceId || (workspaces?.length > 0 ? workspaces[0].id : '');
  const toast = useToast();
  const [dashboards, setDashboards] = useState([]);
  const [activeDashboardId, setActiveDashboardId] = useState('');
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [addingWidget, setAddingWidget] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const initializedRef = useRef(false);

  // Load dashboards for workspace
  const loadDashboards = useCallback(async () => {
    if (!activeWorkspaceId) {
      setDashboards([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchDashboards(activeWorkspaceId);
      setDashboards(data || []);
      return data || [];
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load dashboards'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, toast]);

  // Load widgets for the active dashboard
  const loadWidgets = useCallback(async (dashboardId) => {
    if (!dashboardId) { setWidgets([]); return; }
    setWidgetsLoading(true);
    try {
      const data = await fetchDashboardWidgets(dashboardId);
      setWidgets(data || []);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load widgets'));
    } finally {
      setWidgetsLoading(false);
    }
  }, [toast]);

  // Auto-create default dashboard if none exist
  const maybeCreateDefault = useCallback(async (existingDashboards) => {
    if (initializedRef.current) return existingDashboards;
    initializedRef.current = true;

    if (existingDashboards.length > 0) return existingDashboards;
    if (!activeWorkspaceId) return existingDashboards;

    try {
      const dashboard = await createDashboard({ workspace_id: activeWorkspaceId, name: 'My Dashboard' });
      // Create starter widgets
      await Promise.all(
        DEFAULT_WIDGETS.map((w) =>
          createWidget(dashboard.id, { widget_type: w.widget_type, config: w.config, position: w.position })
        )
      );
      toast.success('Created your first dashboard with starter widgets!');
      return [dashboard];
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create default dashboard'));
      return [];
    }
  }, [activeWorkspaceId, toast]);

  // Initial load
  useEffect(() => {
    initializedRef.current = false;
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data = await loadDashboards();
      if (cancelled) return;
      data = await maybeCreateDefault(data);
      if (cancelled) return;
      if (data.length > 0) {
        setDashboards(data);
        setActiveDashboardId(data[0].id);
      }
    })();
    return () => { cancelled = true; };
  }, [loadDashboards, maybeCreateDefault]);

  // Load widgets when active dashboard changes
  useEffect(() => {
    if (activeDashboardId) loadWidgets(activeDashboardId);
  }, [activeDashboardId, loadWidgets]);

  // Current dashboard object
  const activeDashboard = dashboards.find((d) => d.id === activeDashboardId);

  // ── Handlers ──

  const handleAddWidget = async (widgetType, config) => {
    if (!activeDashboardId) return;
    setAddingWidget(true);
    try {
      const position = { col: widgets.length % 4, row: Math.floor(widgets.length / 4) };
      const widget = await createWidget(activeDashboardId, { widget_type: widgetType, config, position });
      setWidgets((prev) => [...prev, widget]);
      setAddWidgetOpen(false);
      toast.success('Widget added!');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add widget'));
    } finally {
      setAddingWidget(false);
    }
  };

  const handleWidgetDeleted = (widgetId) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
  };

  const handleDeleteDashboard = async () => {
    if (!activeDashboardId) return;
    setDeleting(true);
    try {
      await deleteDashboard(activeDashboardId);
      const remaining = dashboards.filter((d) => d.id !== activeDashboardId);
      setDashboards(remaining);
      setActiveDashboardId(remaining.length > 0 ? remaining[0].id : '');
      setDeleteOpen(false);
      toast.success('Dashboard deleted.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete dashboard'));
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateDashboard = async () => {
    if (!activeWorkspaceId) return;
    try {
      const dashboard = await createDashboard({ workspace_id: activeWorkspaceId, name: 'New Dashboard' });
      setDashboards((prev) => [...prev, dashboard]);
      setActiveDashboardId(dashboard.id);
      toast.success('Dashboard created!');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create dashboard'));
    }
  };

  const handleSaveName = async () => {
    if (!activeDashboardId || !nameValue.trim()) {
      setEditingName(false);
      return;
    }
    try {
      const updated = await updateDashboard(activeDashboardId, { name: nameValue.trim() });
      setDashboards((prev) => prev.map((d) => (d.id === activeDashboardId ? { ...d, ...updated } : d)));
      toast.success('Dashboard renamed.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to rename dashboard'));
    } finally {
      setEditingName(false);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress />
      </Box>
    );
  }

  // ── No workspace selected ──
  if (!activeWorkspaceId) {
    return (
      <EmptyState
        icon={<IconLayoutDashboard size={48} />}
        title="Select a workspace to view dashboards."
        message="Choose a workspace from the sidebar to get started."
      />
    );
  }

  // ── No dashboards ──
  if (!dashboards.length) {
    return (
      <EmptyState
        icon={<IconLayoutDashboard size={48} />}
        title="No dashboards yet."
        message="Create your first dashboard to start tracking metrics."
        action={
          <Button variant="contained" startIcon={<IconPlus size={18} />} onClick={handleCreateDashboard}>
            Create Dashboard
          </Button>
        }
      />
    );
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, minHeight: 420 }}>
      <Stack spacing={2}>
        {/* ── Top Bar ── */}
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          {/* Dashboard selector (when multiple) */}
          {dashboards.length > 1 && (
            <SelectField
              label="Dashboard"
              value={activeDashboardId}
              onChange={(e) => setActiveDashboardId(e.target.value)}
              options={dashboards.map((d) => ({ value: d.id, label: d.name }))}
              size="small"
              sx={{ minWidth: 200, maxWidth: 280 }}
              fullWidth={false}
            />
          )}

          {/* Dashboard name (editable) */}
          {editingName ? (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <TextField
                size="small"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                autoFocus
                sx={{ minWidth: 200 }}
              />
              <IconButton size="small" onClick={handleSaveName} aria-label="Save dashboard name"><IconCheck size={16} /></IconButton>
              <IconButton size="small" onClick={() => setEditingName(false)} aria-label="Cancel rename"><IconX size={16} /></IconButton>
            </Stack>
          ) : (
            <Typography
              variant="h5"
              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
              onClick={() => { setNameValue(activeDashboard?.name || ''); setEditingName(true); }}
            >
              {activeDashboard?.name || 'Dashboard'}
            </Typography>
          )}

          <Box sx={{ flex: 1 }} />

          <Button variant="outlined" size="small" startIcon={<IconPlus size={16} />} onClick={() => setAddWidgetOpen(true)}>
            Add Widget
          </Button>
          <Button variant="outlined" size="small" startIcon={<IconPlus size={16} />} onClick={handleCreateDashboard}>
            New Dashboard
          </Button>
          <Tooltip title="Delete this dashboard">
            <IconButton size="small" color="error" onClick={() => setDeleteOpen(true)} aria-label="Delete this dashboard">
              <IconTrash size={18} />
            </IconButton>
          </Tooltip>
        </Stack>

        {/* ── Widget Grid ── */}
        {widgetsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : widgets.length === 0 ? (
          <EmptyState
            icon={<IconLayoutDashboard size={48} />}
            title="No widgets yet."
            message="Add widgets to start visualizing your data."
            action={
              <Button variant="contained" size="small" startIcon={<IconPlus size={16} />} onClick={() => setAddWidgetOpen(true)}>
                Add Widget
              </Button>
            }
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, 1fr)',
                lg: 'repeat(4, 1fr)'
              },
              gap: 2
            }}
          >
            {widgets.map((widget) => (
              <WidgetCard key={widget.id} widget={widget} onDeleted={handleWidgetDeleted} />
            ))}
          </Box>
        )}
      </Stack>

      {/* ── Dialogs ── */}
      <AddWidgetDialog
        open={addWidgetOpen}
        onClose={() => setAddWidgetOpen(false)}
        onAdd={handleAddWidget}
        loading={addingWidget}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteDashboard}
        title="Delete Dashboard"
        message={<Typography>Delete <strong>{activeDashboard?.name}</strong> and all its widgets?</Typography>}
        secondaryText="This cannot be undone."
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
        loadingLabel="Deleting..."
      />
    </Box>
  );
}
