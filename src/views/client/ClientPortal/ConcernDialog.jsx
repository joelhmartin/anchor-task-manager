import { useState } from 'react';

import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/**
 * Concern / "Start Journey" dialog — always mounted at ClientPortal level
 * so it works regardless of which tab is active.
 *
 * Props:
 *   open, onClose, lead, journey, forceNew, activeClientId,
 *   concernOptions, serviceOptions ({id, name}[]), onCreate(payload), onUpdate(id, payload), triggerMessage
 */
export default function ConcernDialog({
  open,
  onClose,
  lead,
  journey,
  forceNew,
  activeClientId,
  concernOptions,
  serviceOptions,
  onCreate,
  onUpdate,
  triggerMessage
}) {
  const [values, setValues] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);
  const [saving, setSaving] = useState(false);

  // Sync values when dialog opens. Concerns/symptoms hydrate from the journey, but the
  // Services field always starts EMPTY: this dialog only APPENDS services at start, it
  // never removes them. Viewing/removing a contact's services lives in the journey drawer.
  const handleEntered = () => {
    setValues(journey?.symptoms || []);
    setSelectedServices([]);
  };

  const handleClose = () => {
    setValues([]);
    setSelectedServices([]);
    setSaving(false);
    onClose();
  };

  const handleSave = async () => {
    const selections = Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
    const serviceIds = Array.from(new Set(selectedServices.map((s) => s?.id).filter(Boolean)));

    if (!lead && !journey?.id && !activeClientId) {
      handleClose();
      return;
    }

    setSaving(true);
    try {
      if (journey?.id && !forceNew) {
        await onUpdate(journey.id, { symptoms: selections, services: serviceIds });
        triggerMessage('success', 'Lead journey updated');
      } else {
        const payload = {
          lead_call_id: lead?.id,
          client_name: lead?.caller_name || lead?.name || '',
          client_phone: lead?.caller_number || '',
          client_email: lead?.caller_email || '',
          symptoms: selections,
          services: serviceIds,
          active_client_id: activeClientId || lead?.active_client_id || null,
          force_new: forceNew || false
        };
        await onCreate(payload);
      }
      handleClose();
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to save journey');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth TransitionProps={{ onEntered: handleEntered }}>
      <DialogTitle>{journey?.id && !forceNew ? 'Update Journey' : 'Start Journey'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Capture this lead&apos;s concerns and the services they&apos;re interested in to start tracking their journey.
          </Typography>
          <Autocomplete
            multiple
            freeSolo
            options={concernOptions || []}
            value={values}
            onChange={(_event, next) => setValues(next)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Concerns / Symptoms"
                placeholder="Select or type a custom entry"
                helperText="Select from suggestions or type a custom entry and press Enter"
              />
            )}
          />
          <Autocomplete
            multiple
            options={serviceOptions || []}
            value={selectedServices}
            onChange={(_event, next) => setSelectedServices(next)}
            getOptionLabel={(option) => option?.name || ''}
            isOptionEqualToValue={(option, value) => String(option?.id) === String(value?.id)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Services"
                placeholder="Select services"
                helperText="Catalog services added here are saved to this contact's Services"
              />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
