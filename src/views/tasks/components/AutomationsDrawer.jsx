import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, CircularProgress, Divider, Drawer, Stack, Switch, Typography
} from '@mui/material';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import {
  fetchTaskBoardAutomations,
  createTaskBoardAutomation,
  updateTaskAutomation,
  deleteTaskAutomation,
  fetchAutomationRuns
} from 'api/tasks';

export default function AutomationsDrawer({ open, onClose, boardId, onOpenAutomationsPane }) {
  const { showToast } = useToast();
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, rule: null });
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    try {
      const rules = await fetchTaskBoardAutomations(boardId);
      setAutomations(rules || []);
    } catch {
      setAutomations([]);
    } finally {
      setLoading(false);
    }
    setRunsLoading(true);
    try {
      const rows = await fetchAutomationRuns({ scope: 'board', board_id: boardId });
      setRuns(rows || []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    if (open && boardId) refresh();
  }, [open, boardId, refresh]);

  const handleToggle = async (rule) => {
    try {
      const updated = await updateTaskAutomation(rule.id, { is_active: !rule.is_active });
      setAutomations((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      showToast(`Automation ${updated.is_active ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      showToast(err.message || 'Unable to update automation', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.rule) return;
    setDeleting(true);
    try {
      await deleteTaskAutomation(deleteConfirm.rule.id);
      setAutomations((prev) => prev.filter((r) => r.id !== deleteConfirm.rule.id));
      setDeleteConfirm({ open: false, rule: null });
      showToast('Automation deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Unable to delete automation', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddTemplate = async () => {
    if (!boardId) return;
    setCreating(true);
    try {
      await createTaskBoardAutomation(boardId, {
        name: 'Notify admins when status becomes Needs Attention',
        trigger_type: 'status_change',
        trigger_config: { to_status: 'Needs Attention' },
        action_type: 'notify_admins',
        action_config: { title: 'Task needs attention', body: 'An item was moved to Needs Attention.' },
        is_active: true
      });
      showToast('Template automation added', 'success');
      await refresh();
    } catch (err) {
      showToast(err.message || 'Unable to create automation', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: '40vw' } } }}
    >
      <Box sx={{ p: 2 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h5">Automations</Typography>
            <Button size="small" variant="text" onClick={onClose}>
              Close
            </Button>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Quick edit for this board. For full rule builder + global automations, use Tasks &rarr; Automations.
          </Typography>

          <Divider />

          <Typography variant="subtitle2">Board automations</Typography>
          {loading ? (
            <CircularProgress size={18} />
          ) : (
            <Stack spacing={0.75}>
              {!automations.length && (
                <EmptyState title="No board automations yet." sx={{ py: 2 }} />
              )}
              {automations.slice(0, 12).map((r) => (
                <Box
                  key={r.id}
                  sx={{
                    p: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.trigger_type} &rarr; {r.action_type} {r.is_active ? '(active)' : '(inactive)'}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Switch size="small" checked={r.is_active} onChange={() => handleToggle(r)} />
                    <Button size="small" color="error" variant="outlined" onClick={() => setDeleteConfirm({ open: true, rule: r })}>
                      Delete
                    </Button>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}

          <LoadingButton variant="outlined" onClick={handleAddTemplate} loading={creating} loadingLabel="Adding…">
            Add &ldquo;Needs Attention&rdquo; template
          </LoadingButton>

          <Divider />

          <Typography variant="subtitle2">Recent runs</Typography>
          {runsLoading ? (
            <CircularProgress size={18} />
          ) : (
            <Stack spacing={0.75}>
              {!runs.length && (
                <EmptyState title="No runs yet." sx={{ py: 2 }} />
              )}
              {runs.slice(0, 8).map((r) => (
                <Box key={r.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    {r.trigger_type} &bull; {r.status} &bull; {r.ran_at ? new Date(r.ran_at).toLocaleString() : ''}
                  </Typography>
                  {r.error ? (
                    <Typography variant="body2" color="error" sx={{ mt: 0.25 }}>
                      {r.error}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Stack>
          )}

          <Divider />

          <Button variant="contained" onClick={onOpenAutomationsPane}>
            Open Automations Board
          </Button>
        </Stack>
      </Box>

      <ConfirmDialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, rule: null })}
        onConfirm={handleDeleteConfirm}
        title="Delete Automation"
        message="Are you sure you want to delete this automation?"
        secondaryText={deleteConfirm.rule?.name || undefined}
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
      />
    </Drawer>
  );
}
