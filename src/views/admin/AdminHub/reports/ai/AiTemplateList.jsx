import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  IconButton,
  Link,
  Stack,
  Switch,
  Tab,
  Tabs,
  Tooltip
} from '@mui/material';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import RestoreOutlinedIcon from '@mui/icons-material/RestoreOutlined';
import MainCard from 'ui-component/cards/MainCard';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { listAiTemplates, createAiTemplate, updateAiTemplate } from 'api/aiReports';

const TABS = [
  { value: 'active', label: 'Active', emptyTitle: 'No active templates', emptyMessage: 'Approved templates show up here. Drafts live in the Drafts tab.' },
  { value: 'drafts', label: 'Drafts', emptyTitle: 'No drafts', emptyMessage: 'New templates start as drafts until you approve a version.' },
  { value: 'trash',  label: 'Trash',  emptyTitle: 'Trash is empty',     emptyMessage: 'Archived templates land here. Restore or leave them.' }
];

export default function AiTemplateList() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [scope, setScope] = useState('active');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyRowId, setBusyRowId] = useState(null);

  const load = useCallback(async (currentScope) => {
    setLoading(true);
    try {
      const templates = await listAiTemplates({ scope: currentScope });
      setRows(templates || []);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to load AI templates', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(scope); }, [scope, load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const tpl = await createAiTemplate({ name: 'Untitled AI Template' });
      showToast('Template created', 'success');
      navigate(`/admin/reports/ai/${tpl.id}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to create template', 'error');
    } finally {
      setCreating(false);
    }
  };

  const patchRow = async (row, patch, successMessage) => {
    setBusyRowId(row.id);
    try {
      const updated = await updateAiTemplate(row.id, patch);
      // If the row no longer matches the current scope (e.g. archived from Active),
      // drop it locally; otherwise replace in place.
      const stillInScope =
        scope === 'active' ? updated.status === 'approved' && !updated.is_archived :
        scope === 'drafts' ? updated.status === 'draft'    && !updated.is_archived :
        scope === 'trash'  ? updated.is_archived === true                          :
        true;
      setRows((prev) =>
        stillInScope
          ? prev.map((r) => (r.id === row.id ? updated : r))
          : prev.filter((r) => r.id !== row.id)
      );
      if (successMessage) showToast(successMessage, 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Update failed', 'error');
    } finally {
      setBusyRowId(null);
    }
  };

  const handleToggleEnabled = (row) => (e) => {
    e.stopPropagation();
    const next = !row.enabled;
    patchRow(row, { enabled: next }, next ? 'Template enabled' : 'Template disabled');
  };

  const handleArchive = (row) => (e) => {
    e.stopPropagation();
    patchRow(row, { isArchived: true }, 'Moved to trash');
  };

  const handleRestore = (row) => (e) => {
    e.stopPropagation();
    patchRow(row, { isArchived: false }, 'Restored from trash');
  };

  const columns = [
    {
      id: 'name',
      label: 'Name',
      render: (r) => (
        <Link component={RouterLink} to={`/admin/reports/ai/${r.id}`} underline="hover">
          {r.name || '(untitled)'}
        </Link>
      )
    },
    {
      id: 'status',
      label: 'Status',
      render: (r) => <StatusChip status={r.status || 'draft'} />
    },
    {
      id: 'updated_at',
      label: 'Last Modified',
      render: (r) => new Date(r.updated_at).toLocaleString()
    },
    {
      id: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
          {scope === 'active' && (
            <Tooltip title={r.enabled ? 'Disable scheduled & manual runs' : 'Enable runs'}>
              <Switch
                size="small"
                checked={!!r.enabled}
                onClick={(e) => e.stopPropagation()}
                onChange={handleToggleEnabled(r)}
                disabled={busyRowId === r.id}
              />
            </Tooltip>
          )}
          {scope !== 'trash' && (
            <Tooltip title="Move to trash">
              <span>
                <IconButton size="small" onClick={handleArchive(r)} disabled={busyRowId === r.id}>
                  <ArchiveOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {scope === 'trash' && (
            <Tooltip title="Restore">
              <span>
                <IconButton size="small" onClick={handleRestore(r)} disabled={busyRowId === r.id}>
                  <RestoreOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )
    }
  ];

  const newButton = (
    <LoadingButton loading={creating} loadingLabel="Creating..." onClick={handleCreate} variant="contained">
      New AI Template
    </LoadingButton>
  );

  const activeTab = TABS.find((t) => t.value === scope) || TABS[0];

  return (
    <MainCard title="AI Web Report Templates" secondary={newButton}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={scope} onChange={(_, v) => setScope(v)}>
          {TABS.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
        </Tabs>
      </Box>

      {!loading && rows.length === 0 ? (
        <EmptyState
          title={activeTab.emptyTitle}
          message={activeTab.emptyMessage}
          action={scope === 'drafts' ? (
            <LoadingButton loading={creating} loadingLabel="Creating..." onClick={handleCreate} variant="contained">
              New AI Template
            </LoadingButton>
          ) : null}
        />
      ) : (
        <DataTable
          rowKey="id"
          loading={loading}
          rows={rows}
          columns={columns}
          onRowClick={(r) => navigate(`/admin/reports/ai/${r.id}`)}
          searchable
          searchFields={['name']}
        />
      )}
    </MainCard>
  );
}
