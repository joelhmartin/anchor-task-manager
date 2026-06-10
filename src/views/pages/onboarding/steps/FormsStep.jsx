import {
  Checkbox,
  FormControlLabel,
  Paper,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckboxRadio from './CheckboxRadio';

export default function FormsStep({ access, setAccess, setAccessStatus }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.4 }}>
        Contact and lead forms
      </Typography>
      <Typography variant="body2" color="text.secondary">
        These are the forms visitors use to contact you, book appointments, or request information.
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Examples: Contact form, appointment request, consultation request
      </Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2">Check all that apply</Typography>
        <Stack>
          <FormControlLabel
            control={
              <Checkbox
                checked={access.website_forms_uses_third_party}
                onChange={(e) => setAccess((p) => ({ ...p, website_forms_uses_third_party: e.target.checked }))}
              />
            }
            label="Third-party form tools (Jotform, Formstack, Typeform, etc.)"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={access.website_forms_uses_hipaa}
                onChange={(e) => setAccess((p) => ({ ...p, website_forms_uses_hipaa: e.target.checked }))}
              />
            }
            label="HIPAA-compliant or secure intake forms"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={access.website_forms_connected_crm}
                onChange={(e) => setAccess((p) => ({ ...p, website_forms_connected_crm: e.target.checked }))}
              />
            }
            label="Forms connected to a CRM or practice management system"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={access.website_forms_custom}
                onChange={(e) => setAccess((p) => ({ ...p, website_forms_custom: e.target.checked }))}
              />
            }
            label="Custom-built or developer-managed forms"
          />
        </Stack>
        <TextField
          label="Notes (optional)"
          fullWidth
          multiline
          minRows={3}
          value={access.website_forms_notes || ''}
          onChange={(e) => setAccess((p) => ({ ...p, website_forms_notes: e.target.value }))}
          sx={{ mt: 1 }}
        />
      </Paper>
      <RadioGroup
        value={access.website_forms_details_status}
        onChange={(_e, v) =>
          setAccessStatus('website_forms_details_status', v, (val) => ({
            website_forms_details_provided: val === 'provided',
            website_forms_details_understood: val === 'will_provide'
          }))
        }
      >
        <FormControlLabel
          value="provided"
          control={<CheckboxRadio />}
          label="I have provided details about my website form setup and integrations"
        />
        <FormControlLabel
          value="will_provide"
          control={<CheckboxRadio />}
          label="I have access and will be providing form/integration details to Anchor Corps as soon as possible to ensure a smooth onboarding"
        />
        <FormControlLabel
          value="need_help"
          control={<CheckboxRadio />}
          label="Please help! I’m not sure what information you need for website forms/integrations"
        />
      </RadioGroup>
    </Stack>
  );
}
