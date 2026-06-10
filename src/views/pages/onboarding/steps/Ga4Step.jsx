import {
  FormControlLabel,
  Link,
  Paper,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import CheckboxRadio from './CheckboxRadio';

export default function Ga4Step({ access, setAccessStatus }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.4 }}>
        Google Analytics (GA4)
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Google Analytics helps track website traffic and conversions. If you’re unsure whether this exists, select “Not sure”.
      </Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2">How to grant access</Typography>
        <Link href="https://support.google.com/analytics/answer/1009702" target="_blank" rel="noreferrer">
          Google Analytics access instructions
        </Link>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Please add: <strong>access@anchorcorps.com</strong> (Admin access)
        </Typography>
      </Paper>
      <RadioGroup
        value={access.ga4_access_status}
        onChange={(_e, v) =>
          setAccessStatus('ga4_access_status', v, (val) => ({
            ga4_access_provided: val === 'provided',
            ga4_access_understood: val === 'will_provide'
          }))
        }
      >
        <FormControlLabel value="no_ga4_setup" control={<CheckboxRadio />} label="No — please help set it up" />
        <FormControlLabel
          value="agency_controls_ga4"
          control={<CheckboxRadio />}
          label="My agency/vendor controls GA4 access. I may need help getting Anchor added as an admin"
        />
        <FormControlLabel
          value="not_ga4"
          control={<CheckboxRadio />}
          label="We are using a different analytics setup (not GA4) and need guidance"
        />
        <FormControlLabel value="provided" control={<CheckboxRadio />} label="Yes — we already have GA4 and can grant access" />
        <FormControlLabel
          value="will_provide"
          control={<CheckboxRadio />}
          label="I have access and will be providing to Anchor Corps as soon as possible to ensure a smooth onboarding"
        />
        <FormControlLabel
          value="not_running_ga4"
          control={<CheckboxRadio />}
          label="Not applicable / we’re not prioritizing GA4 right now"
        />
        <FormControlLabel value="need_help" control={<CheckboxRadio />} label="Not sure" />
      </RadioGroup>
    </Stack>
  );
}
