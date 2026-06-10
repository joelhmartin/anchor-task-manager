import { useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';

import { agreeToService } from 'api/services';

/**
 * Service agreement / "Convert to Client" dialog — always mounted at
 * ClientPortal level so it works regardless of which tab is active.
 *
 * Props:
 *   open, onClose, lead, services, onServiceAgreed(),
 *   triggerMessage
 */
export default function ServiceDialog({ open, onClose, lead, services, servicesLoading = false, onServiceAgreed, triggerMessage }) {
  const [selectedServices, setSelectedServices] = useState([]);
  const [patientType, setPatientType] = useState(''); // '' | 'new' | 'existing'
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setSelectedServices([]);
    setPatientType('');
    setSaving(false);
    onClose();
  };

  const handleToggle = (serviceId) => {
    setSelectedServices((prev) => {
      const exists = prev.find((s) => s.service_id === serviceId);
      if (exists) return prev.filter((s) => s.service_id !== serviceId);
      const service = services.find((s) => s.id === serviceId);
      return [...prev, { service_id: serviceId, agreed_price: service?.base_price || 0 }];
    });
  };

  const handlePriceChange = (serviceId, price) => {
    setSelectedServices((prev) => prev.map((s) => (s.service_id === serviceId ? { ...s, agreed_price: parseFloat(price) || 0 } : s)));
  };

  const handleConfirm = async () => {
    if (!lead) {
      triggerMessage('error', 'No lead selected');
      return;
    }
    if (selectedServices.length === 0) {
      triggerMessage('error', 'Please select at least one service');
      return;
    }
    if (patientType !== 'new' && patientType !== 'existing') {
      triggerMessage('error', 'Please choose new or existing patient');
      return;
    }

    setSaving(true);
    try {
      const funnelData = {
        caller_name: lead.caller_name,
        caller_number: lead.caller_number,
        email: lead.caller_email || lead.email || null,
        source: lead.source,
        category: lead.category,
        region: lead.region,
        call_id: lead.id,
        call_time: lead.call_time,
        contact_id: lead.contact_id || null
      };

      const result = await agreeToService(lead.id, {
        services: selectedServices,
        source: lead.source || 'CTM',
        funnel_data: funnelData,
        journey_id: lead.journey_id || null,
        patient_type: patientType
      });

      triggerMessage('success', `Successfully converted ${lead.caller_name || 'lead'} to active client`);
      // Pass the full conversion context back so the parent can close any linked
      // journey as converted. Keep leadId as the first arg for back-compat with
      // existing LeadsTab callers that only read it.
      if (onServiceAgreed) {
        onServiceAgreed(lead.id, {
          activeClientId: result?.active_client_id || null,
          journeyId: lead.journey_id || null
        });
      }
      handleClose();
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to process service agreement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Convert this lead to a Client</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            All activity from this client will move to the &lsquo;Client List&rsquo; Tab.
          </Typography>
          <FormControl required>
            <FormLabel sx={{ fontWeight: 600, color: 'text.primary' }}>Is this a new or existing patient?</FormLabel>
            <RadioGroup row value={patientType} onChange={(e) => setPatientType(e.target.value)}>
              <FormControlLabel value="new" control={<Radio />} label="New patient — marks 5★ and counts as a conversion" />
              <FormControlLabel value="existing" control={<Radio />} label="Existing patient — add to list only" />
            </RadioGroup>
          </FormControl>
          {lead && (
            <Box sx={{ p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="subtitle2">Lead Information:</Typography>
              <Typography variant="body2">
                <strong>Name:</strong> {lead.caller_name || 'Unknown'}
              </Typography>
              <Typography variant="body2">
                <strong>Phone:</strong> {lead.caller_number || 'N/A'}
              </Typography>
              <Typography variant="body2">
                <strong>Source:</strong> {lead.source || 'N/A'}
              </Typography>
              <Typography variant="body2">
                <strong>Region:</strong> {lead.region || 'N/A'}
              </Typography>
            </Box>
          )}
          {servicesLoading ? (
            <Typography variant="body2" color="text.secondary">
              Loading services…
            </Typography>
          ) : services.length === 0 ? (
            <Alert severity="warning">No services configured. Please add services in the Services page first.</Alert>
          ) : (
            <Stack spacing={2}>
              {services.map((service) => {
                const isSelected = selectedServices.some((s) => s.service_id === service.id);
                const selected = selectedServices.find((s) => s.service_id === service.id);
                return (
                  <Box
                    key={service.id}
                    sx={{
                      p: 2,
                      border: '1px solid',
                      borderColor: isSelected ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      bgcolor: isSelected ? 'primary.lighter' : 'transparent'
                    }}
                  >
                    <Stack direction="row" spacing={2} alignItems="flex-start">
                      <Checkbox checked={isSelected} onChange={() => handleToggle(service.id)} />
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle1">{service.name}</Typography>
                        {service.description && (
                          <Typography variant="body2" color="text.secondary">
                            {service.description}
                          </Typography>
                        )}
                      </Box>
                      {isSelected && (
                        <TextField
                          label="Agreed Price"
                          type="number"
                          size="small"
                          value={selected?.agreed_price || 0}
                          onChange={(e) => handlePriceChange(service.id, e.target.value)}
                          InputProps={{
                            startAdornment: <InputAdornment position="start">$</InputAdornment>
                          }}
                          inputProps={{ step: '0.01', min: '0' }}
                          sx={{ width: 150 }}
                        />
                      )}
                      {!isSelected && service.base_price && (
                        <Typography variant="body2" color="text.secondary">
                          Base: ${parseFloat(service.base_price).toFixed(2)}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={saving || selectedServices.length === 0 || !patientType}>
          {saving ? 'Saving…' : `Confirm Agreement (${selectedServices.length} service${selectedServices.length !== 1 ? 's' : ''})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
