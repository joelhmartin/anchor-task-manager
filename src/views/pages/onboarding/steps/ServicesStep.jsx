import { Alert, Box, Checkbox, FormControlLabel, Paper, Stack, TextField, Typography, Button } from '@mui/material';
import { IconPlus } from '@tabler/icons-react';

const SERVICE_PLACEHOLDER_BY_TYPE = {
  medical: 'e.g., Consultation, Exam, Treatment',
  dental: 'e.g., Teeth Whitening, Root Canal',
  tmj_sleep: 'e.g., Sleep Study, Oral Appliance',
  med_spa: 'e.g., Botox, Laser Treatment',
  chiropractic: 'e.g., Adjustment, Massage Therapy',
  home_service: 'e.g., Repair, Installation, Inspection',
  roofing: 'e.g., Roof Repair, Gutter Install',
  plumbing: 'e.g., Drain Cleaning, Water Heater',
  hvac: 'e.g., AC Repair, Furnace Tune-Up',
  food_service: 'e.g., Catering, Private Event',
  other: 'e.g., Consultation, Service Call'
};

function getPlaceholder(clientType, clientSubtype) {
  return SERVICE_PLACEHOLDER_BY_TYPE[clientSubtype] || SERVICE_PLACEHOLDER_BY_TYPE[clientType] || 'e.g., Your custom service';
}

export default function ServicesStep({
  defaultOptions,
  isDefaultChecked,
  handleToggleDefaultService,
  customServiceName,
  setCustomServiceName,
  handleCustomServiceKeyDown,
  handleCustomServiceAdd,
  serviceList,
  clientType,
  clientSubtype
}) {
  const placeholder = getPlaceholder(clientType, clientSubtype);

  // Combine default options with any custom services (services not in defaultOptions)
  const customServices = serviceList
    .filter((s) => s.name && !defaultOptions.some((opt) => opt.toLowerCase() === s.name.toLowerCase()))
    .map((s) => s.name);

  const allServices = [...defaultOptions, ...customServices];

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.4 }}>
          Services you offer
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Select the services you offer, this helps you tag and organize leads so you can track them more easily.{' '}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          You can change this later.
        </Typography>
      </Box>

      {allServices.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {allServices.map((option) => (
              <FormControlLabel
                key={option}
                control={
                  <Checkbox checked={isDefaultChecked(option)} onChange={() => handleToggleDefaultService(option)} color="primary" />
                }
                label={option}
              />
            ))}
          </Stack>
        </Paper>
      ) : (
        <Alert severity="info">No services yet. Add your services below.</Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          fullWidth
          label="Add another service"
          placeholder={placeholder}
          value={customServiceName}
          onChange={(e) => setCustomServiceName(e.target.value)}
          onKeyDown={handleCustomServiceKeyDown}
        />
        <Button
          variant="contained"
          startIcon={<IconPlus />}
          onClick={handleCustomServiceAdd}
          disabled={!customServiceName.trim()}
          sx={{ minWidth: { xs: '100%', sm: 160 } }}
        >
          Add Service
        </Button>
      </Stack>

      {!serviceList.length && <Alert severity="info">Select or add at least one service to continue.</Alert>}
    </Stack>
  );
}
