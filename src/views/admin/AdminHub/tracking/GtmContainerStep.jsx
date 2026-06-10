import { useState, useEffect } from 'react';
import {
  Box, Stack, Typography, Autocomplete, TextField,
  CircularProgress, IconButton, Tooltip, Button,
  List, ListItem, ListItemText, ListItemSecondaryAction
} from '@mui/material';
import {
  Save as SaveIcon, Delete as DeleteIcon
} from '@mui/icons-material';
import LoadingButton from 'ui-component/extended/LoadingButton';
import StatusChip from 'ui-component/extended/StatusChip';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import {
  getGtmContainers, createGtmContainer, deleteGtmContainer
} from 'api/tracking';

const NEW_CONTAINER_SENTINEL = { containerId: '__new__', name: '+ Create New Container' };

export default function GtmContainerStep({ config, saveConfig, onNext, onBack, onReload }) {
  const { showToast } = useToast();
  const [containers, setContainers] = useState([]);
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadContainers = () => {
    setLoadingContainers(true);
    getGtmContainers()
      .then((list) => {
        setContainers(list || []);
        if (config?.gtm_container_id) {
          const match = (list || []).find((c) => String(c.containerId) === String(config.gtm_container_id));
          if (match) setSelected(match);
        }
      })
      .catch((err) => showToast(getErrorMessage(err, 'Failed to load GTM containers'), 'error'))
      .finally(() => setLoadingContainers(false));
  };

  useEffect(() => { loadContainers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isCreatingNew = selected?.containerId === '__new__';
  const canNext = !!selected;

  const handleSaveAndContinue = async () => {
    setSaving(true);
    try {
      let container = selected;
      if (isCreatingNew) {
        if (!newName.trim()) {
          showToast('Enter a name for the new container', 'error');
          setSaving(false);
          return;
        }
        container = await createGtmContainer(newName.trim());
      }
      await saveConfig({
        gtm_account_id: '6246584794',
        gtm_container_id: container.containerId,
        gtm_container_public_id: container.publicId || container.gtm_container_public_id || null,
      });
      onReload();
      showToast('GTM container saved', 'success');
      if (isCreatingNew) {
        setContainers((prev) => [...prev, container]);
        setSelected(container);
      }
      onNext();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save GTM container'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteGtmContainer(deleteTarget.containerId);
      setContainers((prev) => prev.filter((c) => c.containerId !== deleteTarget.containerId));
      if (selected?.containerId === deleteTarget.containerId) setSelected(null);
      showToast('Deleted "' + deleteTarget.name + '"', 'success');
    } catch (err) { showToast(getErrorMessage(err, 'Failed to delete container'), 'error'); }
    finally { setDeleting(false); setDeleteTarget(null); }
  };
  const options = [NEW_CONTAINER_SENTINEL, ...(containers || [])];

  if (showAll) {
    return (
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5">All GTM Containers</Typography>
          <Button size="small" onClick={() => { setShowAll(false); loadContainers(); }}>Back to Wizard</Button>
        </Box>
        {loadingContainers ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">Loading...</Typography></Box>
        ) : containers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No containers found.</Typography>
        ) : (
          <List disablePadding>
            {containers.map((c) => (
              <ListItem key={c.containerId} divider sx={{ px: 0 }}>
                <ListItemText primary={c.name} secondary={(c.publicId || '') + ' \u2014 ID: ' + c.containerId} />
                <ListItemSecondaryAction>
                  <Tooltip title="Delete container"><IconButton edge="end" size="small" color="error" onClick={() => setDeleteTarget(c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
        <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete GTM Container" message={'Are you sure you want to permanently delete "' + (deleteTarget?.name || '') + '"? This will remove all tags, triggers, and variables in this container. This cannot be undone.'} confirmLabel="Delete" confirmColor="error" loading={deleting} loadingLabel="Deleting..." severity="error" />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5" gutterBottom>GTM Container</Typography>
          <Button size="small" onClick={() => setShowAll(true)} sx={{ textTransform: 'none' }}>See All Containers</Button>
        </Box>
        <Typography variant="body2" color="text.secondary">Select an existing GTM container or create a new one so the account details are saved. Automated GTM provisioning is paused on `main`.</Typography>
      </Box>
      {config?.provisioning_status && (<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Typography variant="body2" color="text.secondary">Status:</Typography><StatusChip status={config.provisioning_status} /></Box>)}
      {loadingContainers ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">Loading containers...</Typography></Box>
      ) : (
        <Autocomplete options={options} value={selected} onChange={(_, val) => { setSelected(val); setNewName(''); }}
          getOptionLabel={(opt) => opt.containerId === '__new__' ? opt.name : (opt.name || opt.publicId) + ' (' + (opt.publicId || opt.containerId) + ')'}
          isOptionEqualToValue={(opt, val) => opt.containerId === val.containerId}
          renderInput={(params) => (<TextField {...params} label="GTM Container" size="small" placeholder="Select or create..." />)} />
      )}
      {isCreatingNew && (<TextField label="New Container Name" value={newName} onChange={(e) => setNewName(e.target.value)} size="small" fullWidth placeholder="e.g. Acme Dental — Tracking" autoFocus />)}
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <LoadingButton variant="outlined" onClick={onBack}>Back</LoadingButton>
        <LoadingButton variant="contained" startIcon={<SaveIcon />} loading={saving} loadingLabel="Saving..." onClick={handleSaveAndContinue} disabled={!canNext}>Save & Continue</LoadingButton>
      </Box>
    </Stack>
  );
}
