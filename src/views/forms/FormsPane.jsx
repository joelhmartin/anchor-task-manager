/**
 * FormsPane — List all forms with CRUD, filtering, and grouping by client.
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CodeIcon from '@mui/icons-material/Code';
import BuildIcon from '@mui/icons-material/Build';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import {
  createForm,
  updateForm,
  archiveForm,
  exportForm,
  duplicateForm
} from 'api/forms';

export default function FormsPane({ forms, setForms, clients, onRefresh, onNavigate }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('active');
  const [clientFilter, setClientFilter] = useState('all');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createData, setCreateData] = useState({ clientId: '', name: '', formType: 'conversion', presetId: '' });

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({ id: '', name: '', description: '' });

  // Archive confirmation
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [formToArchive, setFormToArchive] = useState(null);

  // Build client map
  const clientMap = {};
  const clientsWithForms = new Set();
  for (const c of clients) {
    clientMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || c.id;
  }
  for (const f of forms) {
    if (f.owner_user_id) clientsWithForms.add(f.owner_user_id);
  }

  // Filter
  const filteredForms = forms.filter((f) => {
    if (statusFilter === 'active' && f.status === 'archived') return false;
    if (statusFilter === 'draft' && f.status !== 'draft') return false;
    if (statusFilter === 'published' && f.status !== 'published') return false;
    if (statusFilter === 'archived' && f.status !== 'archived') return false;
    if (clientFilter === 'unassigned' && f.owner_user_id) return false;
    if (clientFilter !== 'all' && clientFilter !== 'unassigned' && f.owner_user_id !== clientFilter) return false;
    return true;
  });

  // Group by client
  const groupedForms = {};
  for (const f of filteredForms) {
    const clientId = f.owner_user_id || 'unassigned';
    if (!groupedForms[clientId]) groupedForms[clientId] = [];
    groupedForms[clientId].push(f);
  }
  const sortedClientIds = Object.keys(groupedForms).sort((a, b) => {
    if (a === 'unassigned') return 1;
    if (b === 'unassigned') return -1;
    return (clientMap[a] || '').localeCompare(clientMap[b] || '');
  });

  const statusCounts = {
    active: forms.filter((f) => f.status !== 'archived').length,
    draft: forms.filter((f) => f.status === 'draft').length,
    published: forms.filter((f) => f.status === 'published').length,
    archived: forms.filter((f) => f.status === 'archived').length
  };

  const handleCreate = async () => {
    if (!createData.clientId) { showToast('Select a client', 'error'); return; }
    if (!createData.name.trim()) { showToast('Name is required', 'error'); return; }
    try {
      setSaving(true);
      const newForm = await createForm(createData.clientId, { name: createData.name, formType: createData.formType });
      setForms((prev) => [newForm, ...prev]);
      showToast('Form created! Opening in Builder...', 'success');
      setCreateOpen(false);
      setCreateData({ clientId: '', name: '', formType: 'conversion' });
      onNavigate('builder', newForm.id);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    try {
      setSaving(true);
      const updatedForm = await updateForm(editData.id, { name: editData.name, description: editData.description });
      setForms((prev) => prev.map((f) => (f.id === editData.id ? { ...f, ...updatedForm } : f)));
      showToast('Form updated', 'success');
      setEditOpen(false);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (form) => {
    try {
      setSaving(true);
      const newForm = await duplicateForm(form.id);
      setForms((prev) => [newForm, ...prev]);
      showToast(`"${form.name}" duplicated`, 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (form) => {
    try {
      const data = await exportForm(form.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.name.replace(/[^a-z0-9]/gi, '_')}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Form exported', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const handleArchiveClick = (form) => {
    setFormToArchive(form);
    setArchiveConfirmOpen(true);
  };

  const handleArchiveConfirm = async () => {
    if (!formToArchive) return;
    try {
      setSaving(true);
      await archiveForm(formToArchive.id);
      setForms((prev) => prev.map((f) => (f.id === formToArchive.id ? { ...f, status: 'archived' } : f)));
      showToast('Form archived', 'success');
      setArchiveConfirmOpen(false);
      setFormToArchive(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderFormRow = (form) => {
    const fieldCount = form.schema_json?.fields?.length || 0;
    return (
      <TableRow key={form.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
        <TableCell>
          <Typography variant="body2" fontWeight={500}>{form.name}</Typography>
        </TableCell>
        <TableCell>
          <Chip
            label={form.form_type === 'intake' ? 'Intake' : 'Conversion'}
            color={form.form_type === 'intake' ? 'info' : 'primary'}
            size="small"
          />
        </TableCell>
        <TableCell>
          <StatusChip status={form.status} variant="outlined" />
        </TableCell>
        <TableCell>{fieldCount}</TableCell>
        <TableCell align="right">
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => { setEditData({ id: form.id, name: form.name, description: form.description || '' }); setEditOpen(true); }}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Open in Builder">
            <IconButton size="small" onClick={() => onNavigate('builder', form.id)}>
              <BuildIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="View Submissions">
            <IconButton size="small" onClick={() => onNavigate('submissions', form.id)}>
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Get Embed Code">
            <IconButton size="small" onClick={() => onNavigate('embed', form.id)} disabled={form.status !== 'published'}>
              <CodeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Duplicate">
            <IconButton size="small" onClick={() => handleDuplicate(form)} disabled={saving}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export JSON">
            <IconButton size="small" onClick={() => handleExport(form)} disabled={saving}>
              <FileDownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {form.status !== 'archived' && (
            <Tooltip title="Archive">
              <IconButton size="small" color="error" onClick={() => handleArchiveClick(form)} disabled={saving}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">Forms</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          Create Form
        </Button>
      </Stack>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={statusFilter} onChange={(e, v) => setStatusFilter(v)}>
          <Tab label={`Active (${statusCounts.active})`} value="active" />
          <Tab label={`Drafts (${statusCounts.draft})`} value="draft" />
          <Tab label={`Published (${statusCounts.published})`} value="published" />
          <Tab label={`Archived (${statusCounts.archived})`} value="archived" />
        </Tabs>
      </Box>

      <SelectField label="Filter by Client" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 200, maxWidth: 300 }}>
        <MenuItem value="all">All Clients</MenuItem>
        <MenuItem value="unassigned">Unassigned</MenuItem>
        {[...clientsWithForms].map((cid) => (
          <MenuItem key={cid} value={cid}>{clientMap[cid] || cid}</MenuItem>
        ))}
      </SelectField>

      {forms.length === 0 ? (
        <EmptyState title="No forms yet." message="Create one to get started." />
      ) : filteredForms.length === 0 ? (
        <EmptyState title="No forms match the current filters." />
      ) : clientFilter !== 'all' ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Fields</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredForms.map(renderFormRow)}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Stack spacing={2}>
          {sortedClientIds.map((clientId) => (
            <Paper key={clientId} variant="outlined">
              <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle2" fontWeight={600}>
                  {clientId === 'unassigned' ? 'Unassigned' : clientMap[clientId] || clientId}
                  <Chip label={groupedForms[clientId].length} size="small" sx={{ ml: 1 }} />
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Fields</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groupedForms[clientId].map(renderFormRow)}
                </TableBody>
              </Table>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Create Dialog */}
      <FormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        title="Create Form"
        loading={saving}
        loadingLabel="Creating..."
        submitLabel="Create"
      >
        <SelectField label="Client" value={createData.clientId} onChange={(e) => setCreateData({ ...createData, clientId: e.target.value })} required>
          {clients.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email}
            </MenuItem>
          ))}
        </SelectField>
        <TextField
          label="Form Name"
          value={createData.name}
          onChange={(e) => setCreateData({ ...createData, name: e.target.value })}
          fullWidth
          required
          placeholder="Contact Form"
        />
        <SelectField label="Form Type" value={createData.formType} onChange={(e) => setCreateData({ ...createData, formType: e.target.value })}
          options={[{ value: 'conversion', label: 'Conversion (leads, contact forms)' }, { value: 'intake', label: 'Intake (patient forms with PHI)' }]}
        />
      </FormDialog>

      {/* Edit Dialog */}
      <FormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={handleEdit}
        title="Edit Form"
        loading={saving}
        loadingLabel="Saving..."
      >
        <TextField
          label="Form Name"
          value={editData.name}
          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
          fullWidth
        />
        <TextField
          label="Description"
          value={editData.description}
          onChange={(e) => setEditData({ ...editData, description: e.target.value })}
          fullWidth
          multiline
          rows={3}
        />
      </FormDialog>

      {/* Archive Confirmation */}
      <ConfirmDialog
        open={archiveConfirmOpen}
        onClose={() => setArchiveConfirmOpen(false)}
        onConfirm={handleArchiveConfirm}
        title="Archive Form"
        message={`Archive "${formToArchive?.name}"? This will unpublish the form and it will no longer accept submissions.`}
        confirmLabel="Archive"
        confirmColor="error"
        loading={saving}
        loadingLabel="Archiving..."
      />
    </Stack>
  );
}
