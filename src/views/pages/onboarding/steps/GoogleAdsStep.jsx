import {
  FormControlLabel,
  Link,
  Paper,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckboxRadio from './CheckboxRadio';

export default function GoogleAdsStep({ access, setAccess, setAccessStatus }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.4 }}>
        Google Ads account (if applicable)
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Only complete this if you currently run or plan to run Google Ads. Otherwise, you can skip this step for now by selecting “Not
        applicable”.
      </Typography>
      <TextField
        label="Google Ads account ID (if available)"
        fullWidth
        value={access.google_ads_account_id || ''}
        onChange={(e) => setAccess((p) => ({ ...p, google_ads_account_id: e.target.value }))}
        placeholder="e.g., 123-456-7890"
      />
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2">How to grant access</Typography>
        <Link href="https://support.google.com/google-ads/answer/6372672?sjid=11176952801985058373-NA" target="_blank" rel="noreferrer">
          Google Ads access instructions
        </Link>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Please add: <strong>access@anchorcorps.com</strong> (Admin access)
        </Typography>
      </Paper>
      <RadioGroup
        value={access.google_ads_access_status}
        onChange={(_e, v) =>
          setAccessStatus('google_ads_access_status', v, (val) => ({
            google_ads_access_provided: val === 'provided',
            google_ads_access_understood: val === 'will_provide'
          }))
        }
      >
        <FormControlLabel value="no_google_ads_account" control={<CheckboxRadio />} label="I do not have a Google Ads account" />
        <FormControlLabel value="no_google_ads_history" control={<CheckboxRadio />} label="I have not run Google Ads before" />
        <FormControlLabel value="not_sure" control={<CheckboxRadio />} label="Not sure" />
        <FormControlLabel
          value="agency_owns_google_ads"
          control={<CheckboxRadio />}
          label="I am running Google Ads but my agency owns the account. We may need to start a new Google Ads account"
        />
        <FormControlLabel value="provided" control={<CheckboxRadio />} label="I have provided access" />
        <FormControlLabel
          value="will_provide"
          control={<CheckboxRadio />}
          label="I have access and will be providing to Anchor Corps as soon as possible to ensure a smooth onboarding"
        />
        <FormControlLabel
          value="not_running_google_ads"
          control={<CheckboxRadio />}
          label="Not applicable / we’re not planning to run Google Ads right now"
        />
        <FormControlLabel
          value="need_help"
          control={<CheckboxRadio />}
          label="Please help!  I don’t know who has administrative access to my Google Ads account"
        />
      </RadioGroup>
    </Stack>
  );
}
