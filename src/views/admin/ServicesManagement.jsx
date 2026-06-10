import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import DataTable from 'ui-component/extended/DataTable';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { IconEdit, IconTrash, IconPlus } from '@tabler/icons-react';

import FormDialog from 'ui-component/extended/FormDialog';
import MainCard from 'ui-component/cards/MainCard';
import { fetchServices, createService, updateService, deleteService } from 'api/services';
import Button from '@mui/material/Button';

export default function ServicesManagement() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', base_price: '', active: true });

  // Delete confirmation dialog
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState(null);

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchServices();
      setServices(data);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Unable to load services' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const handleOpenDialog = (service = null) => {
    if (service) {
      setEditingService(service);
      setFormData({
        name: service.name || '',
        description: service.description || '',
        base_price: service.base_price || '',
        active: service.active !== false
      });
    } else {
      setEditingService(null);
      setFormData({ name: '', description: '', base_price: '', active: true });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingService(null);
    setFormData({ name: '', description: '', base_price: '', active: true });
  };

  const handleSave = async () => {
    if (!formData.name) {
      setMessage({ type: 'error', text: 'Service name is required' });
      return;
    }

    try {
      setLoading(true);
      const payload = {
        name: formData.name,
        description: formData.description,
        base_price: formData.base_price ? parseFloat(formData.base_price) : null,
        active: formData.active
      };

      if (editingService) {
        await updateService(editingService.id, payload);
        setMessage({ type: 'success', text: 'Service updated successfully' });
      } else {
        await createService(payload);
        setMessage({ type: 'success', text: 'Service created successfully' });
      }

      handleCloseDialog();
      await loadServices();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Unable to save service' });
    } finally {
      setLoading(false);
    }
  };

  const serviceColumns = useMemo(() => [
    { id: 'name', label: 'Name', render: (row) => <Typography variant="subtitle2">{row.name}</Typography> },
    { id: 'description', label: 'Description', render: (row) => <Typography variant="body2" color="text.secondary">{row.description || '—'}</Typography> },
    { id: 'base_price', label: 'Base Price', align: 'right', render: (row) => <Typography variant="body2">{row.base_price ? `$${parseFloat(row.base_price).toFixed(2)}` : '—'}</Typography> },
    { id: 'active', label: 'Active', align: 'center', render: (row) => <Switch checked={row.active !== false} disabled size="small" /> },
    {
      id: 'actions', label: 'Actions', align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <IconButton size="small" onClick={() => handleOpenDialog(row)}><IconEdit /></IconButton>
          <IconButton size="small" color="error" onClick={() => handleDeleteClick(row)}><IconTrash /></IconButton>
        </Stack>
      ),
    },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteClick = (service) => {
    setServiceToDelete(service);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!serviceToDelete) return;
    try {
      setLoading(true);
      await deleteService(serviceToDelete.id);
      setMessage({ type: 'success', text: 'Service deleted successfully' });
      setDeleteConfirmOpen(false);
      setServiceToDelete(null);
      await loadServices();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Unable to delete service' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainCard
      title="My Services"
      secondary={
        <Button variant="contained" startIcon={<IconPlus />} onClick={() => handleOpenDialog()}>
          Add Service
        </Button>
      }
    >
      <Stack spacing={3}>
        {message.text && <Alert severity={message.type === 'error' ? 'error' : 'success'}>{message.text}</Alert>}

        <DataTable
          columns={serviceColumns}
          rows={services}
          loading={loading && !services.length}
          emptyTitle="No services configured yet."
          size="medium"
        />
      </Stack>

      {/* Service Dialog */}
      <FormDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        onSubmit={handleSave}
        title={editingService ? 'Edit Service' : 'Add Service'}
        loading={loading}
        loadingLabel="Saving..."
        submitLabel={editingService ? 'Update' : 'Create'}
      >
        <TextField
          label="Service Name"
          fullWidth
          required
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
        />
        <TextField
          label="Description"
          fullWidth
          multiline
          rows={3}
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
        />
        <TextField
          label="Base Price"
          fullWidth
          type="number"
          inputProps={{ step: '0.01', min: '0' }}
          value={formData.base_price}
          onChange={(e) => setFormData((prev) => ({ ...prev, base_price: e.target.value }))}
        />
        <Stack direction="row" alignItems="center" spacing={2}>
          <Typography>Active</Typography>
          <Switch checked={formData.active} onChange={(e) => setFormData((prev) => ({ ...prev, active: e.target.checked }))} />
        </Stack>
      </FormDialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => { setDeleteConfirmOpen(false); setServiceToDelete(null); }}
        onConfirm={handleDeleteConfirm}
        title="Delete Service"
        message={<Typography>Are you sure you want to delete <strong>{serviceToDelete?.name}</strong>?</Typography>}
        confirmLabel="Delete"
        confirmColor="error"
        loading={loading}
      />
    </MainCard>
  );
}

