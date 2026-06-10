import { useEffect, useState } from 'react';

import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutline';

import MainCard from 'ui-component/cards/MainCard';
import DataTable from 'ui-component/extended/DataTable';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import StatusChip from 'ui-component/extended/StatusChip';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import { useToast } from 'contexts/ToastContext';
import { fetchAllUpdates, createUpdate, updateUpdate, deleteUpdate } from 'api/portalUpdates';

const TYPE_OPTIONS = [
  { value: 'feature', label: 'New Feature' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'notice', label: 'Notice' },
  { value: 'maintenance', label: 'Maintenance' }
];
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' }
];
const TYPE_COLOR = { feature: 'primary', improvement: 'success', notice: 'info', maintenance: 'warning' };
const typeLabel = (type) => (TYPE_OPTIONS.find((t) => t.value === type) || {}).label || type;
const EMPTY_FORM = { type: 'notice', title: '', body: '', link_url: '', status: 'draft' };

/**
 * Admin authoring UI for client-portal Updates (the dismissible banner clients
 * see). Mirrors the blog-post CRUD pattern with shared components.
 */
export default function PortalUpdatesManager() {
  const toast = useToast();
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState({ open: false, editingId: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null, deleting: false });

  useEffect(() => {
    let active = true;
    fetchAllUpdates()
      .then((rows) => {
        if (active) setUpdates(rows);
      })
      .catch(() => toast.error('Unable to load updates'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setDialog({ open: true, editingId: null });
  };
  const openEdit = (row) => {
    setForm({ type: row.type, title: row.title, body: row.body || '', link_url: row.link_url || '', status: row.status });
    setDialog({ open: true, editingId: row.id });
  };
  const closeDialog = () => {
    setDialog({ open: false, editingId: null });
    setForm(EMPTY_FORM);
  };
  const handleField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type: form.type,
        title: form.title.trim(),
        body: form.body,
        link_url: form.link_url,
        status: form.status
      };
      if (dialog.editingId) {
        const updated = await updateUpdate(dialog.editingId, payload);
        setUpdates((list) => list.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
        toast.success('Update saved');
      } else {
        const created = await createUpdate(payload);
        setUpdates((list) => [{ ...created, dismiss_count: 0 }, ...list]);
        toast.success('Update created');
      }
      closeDialog();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to save update');
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (row) => {
    const next = row.status === 'published' ? 'draft' : 'published';
    try {
      const updated = await updateUpdate(row.id, { status: next });
      setUpdates((list) => list.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      toast.success(next === 'published' ? 'Update published' : 'Update unpublished');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to change status');
    }
  };

  const handleDelete = async () => {
    setConfirmDelete((c) => ({ ...c, deleting: true }));
    try {
      await deleteUpdate(confirmDelete.id);
      setUpdates((list) => list.filter((u) => u.id !== confirmDelete.id));
      toast.success('Update deleted');
      setConfirmDelete({ open: false, id: null, deleting: false });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unable to delete update');
      setConfirmDelete((c) => ({ ...c, deleting: false }));
    }
  };

  const columns = [
    {
      id: 'type',
      label: 'Type',
      render: (row) => <Chip size="small" color={TYPE_COLOR[row.type] || 'default'} label={typeLabel(row.type)} />
    },
    { id: 'title', label: 'Title' },
    { id: 'status', label: 'Status', render: (row) => <StatusChip status={row.status} /> },
    {
      id: 'published_at',
      label: 'Published',
      render: (row) => (row.published_at ? new Date(row.published_at).toLocaleDateString() : '—')
    },
    { id: 'dismiss_count', label: 'Dismissals', align: 'right', render: (row) => row.dismiss_count ?? 0 },
    {
      id: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Button size="small" onClick={() => togglePublish(row)}>
            {row.status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
          <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setConfirmDelete({ open: true, id: row.id, deleting: false })}
          >
            Delete
          </Button>
        </Stack>
      )
    }
  ];

  return (
    <MainCard
      title="Portal Updates"
      secondary={
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          New Update
        </Button>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Announcements shown as a dismissible banner at the top of every client&rsquo;s portal. Publish to make an update
        visible; each client dismisses it per account.
      </Typography>

      <DataTable
        columns={columns}
        rows={updates}
        rowKey="id"
        loading={loading}
        searchable
        searchFields={['title', 'body']}
        paginated
        pageSize={10}
        emptyTitle="No updates yet"
        emptyMessage="Create your first client-facing update."
      />

      <FormDialog
        open={dialog.open}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        title={dialog.editingId ? 'Edit Update' : 'New Update'}
        loading={saving}
        submitLabel={dialog.editingId ? 'Save' : 'Create'}
        submitDisabled={!form.title.trim()}
      >
        <SelectField label="Type" value={form.type} onChange={handleField('type')} options={TYPE_OPTIONS} fullWidth />
        <TextField label="Title" value={form.title} onChange={handleField('title')} fullWidth required inputProps={{ maxLength: 200 }} />
        <TextField
          label="Body"
          value={form.body}
          onChange={handleField('body')}
          fullWidth
          multiline
          minRows={3}
          inputProps={{ maxLength: 2000 }}
          helperText="Shown in the banner. Plain text."
        />
        <TextField
          label="Learn more link (optional)"
          value={form.link_url}
          onChange={handleField('link_url')}
          fullWidth
          placeholder="https://..."
        />
        <SelectField label="Status" value={form.status} onChange={handleField('status')} options={STATUS_OPTIONS} fullWidth />
      </FormDialog>

      <ConfirmDialog
        open={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, id: null, deleting: false })}
        onConfirm={handleDelete}
        title="Delete update?"
        message="This permanently deletes the update and its dismissal records. This can't be undone."
        confirmLabel="Delete"
        confirmColor="error"
        loading={confirmDelete.deleting}
      />
    </MainCard>
  );
}
