import {
  FormControlLabel,
  Link,
  Paper,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import CheckboxRadio from './CheckboxRadio';

export default function MetaStep({ access, setAccessStatus }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.4 }}>
        Facebook and Instagram (Meta)
      </Typography>
      <Typography variant="body2" color="text.secondary">
        If you advertise or plan to advertise on Facebook or Instagram, this helps us connect tracking and campaigns.
      </Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2">How to grant access</Typography>
        <Link href="https://www.facebook.com/business/help/1717412048538897?id=2190812977867143" target="_blank" rel="noreferrer">
          Meta partner access instructions
        </Link>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Give partner access to the <strong>Anchor Business Portfolio</strong> (Business ID <strong>577506357410429</strong>) and ensure{' '}
          <strong>Admin access</strong> is granted.
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          If you also need to add a person by email anywhere in the flow, use <strong>access@anchorcorps.com</strong> (Admin access).
        </Typography>
      </Paper>
      <RadioGroup
        value={access.meta_access_status}
        onChange={(_e, v) =>
          setAccessStatus('meta_access_status', v, (val) => ({
            meta_access_provided: val === 'provided_access',
            meta_access_understood: val === 'will_provide_access'
          }))
        }
      >
        <FormControlLabel value="not_sure" control={<CheckboxRadio />} label="Not sure" />
        <FormControlLabel
          value="no_social_accounts"
          control={<CheckboxRadio />}
          label="I do not have a Facebook page or Instagram account"
        />
        <FormControlLabel value="no_meta_ads_history" control={<CheckboxRadio />} label="I have not run Meta Ads before" />
        <FormControlLabel
          value="agency_owns_ad_account"
          control={<CheckboxRadio />}
          label="I am running Meta ads but my agency owns the ad account. We will need to start a new ad account"
        />
        <FormControlLabel value="provided_access" control={<CheckboxRadio />} label="I have provided access" />
        <FormControlLabel
          value="will_provide_access"
          control={<CheckboxRadio />}
          label="I have access and will be providing to Anchor Corps as soon as possible to ensure a smooth onboarding"
        />
        <FormControlLabel value="not_running_meta" control={<CheckboxRadio />} label="No — not using Meta ads right now" />
        <FormControlLabel
          value="need_help"
          control={<CheckboxRadio />}
          label="Please help!  I don’t know who has administrative access to my Meta account"
        />
      </RadioGroup>
    </Stack>
  );
}
