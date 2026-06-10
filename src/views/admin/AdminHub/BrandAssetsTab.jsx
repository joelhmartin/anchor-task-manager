import { useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import client from 'api/client';

const EMPTY_BRAND = {
  logos: [],
  style_guides: [],
  business_name: '',
  business_description: '',
  brand_notes: '',
  website_url: ''
};

export default function BrandAssetsTab({ clientId, brandData, setBrandData, editing, onEditChange }) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setBrandData(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setBrandData(null);
    client
      .get(`/hub/brand/admin/${clientId}`)
      .then((res) => {
        if (!active) return;
        setBrandData(res.data.brand || EMPTY_BRAND);
      })
      .catch(() => {
        if (!active) return;
        setBrandData(EMPTY_BRAND);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, setBrandData]);

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Typography variant="subtitle1">Contact Info</Typography>
      <TextField
        label="Business Name"
        value={brandData?.business_name || ''}
        onChange={(e) => setBrandData((p) => ({ ...(p || {}), business_name: e.target.value }))}
        placeholder="Acme Dental"
        fullWidth
      />
      <TextField
        label="Main Phone"
        value={editing?.call_tracking_main_number || ''}
        onChange={onEditChange('call_tracking_main_number')}
        placeholder="(555) 555-5555"
        fullWidth
      />
      <TextField
        label="Account Email"
        value={editing?.email || ''}
        onChange={onEditChange('email')}
        placeholder="office@example.com"
        helperText="Login email for this account — set during onboarding or manually here"
        fullWidth
      />
      <TextField
        label="Website URL"
        value={brandData?.website_url || ''}
        onChange={(e) => setBrandData((p) => ({ ...(p || {}), website_url: e.target.value }))}
        placeholder="https://example.com"
        fullWidth
      />

      <Divider />

      <Typography variant="subtitle1">Brand Assets</Typography>
      {loading && <CircularProgress size={20} />}{' '}
      {brandData?.logos?.length ? (
        <Stack spacing={1}>
          {brandData.logos.map((logo) => (
            <Box
              key={logo.id}
              sx={{
                p: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <Typography>{logo.name}</Typography>
              <Button size="small" href={logo.url} target="_blank" rel="noreferrer">
                View
              </Button>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No brand assets uploaded.
        </Typography>
      )}

      <Divider />

      <Typography variant="subtitle2">Brand Basics</Typography>
      <TextField
        label="Business Description"
        value={brandData?.business_description || ''}
        onChange={(e) => setBrandData((p) => ({ ...(p || {}), business_description: e.target.value }))}
        multiline
        minRows={3}
      />
      <TextField
        label="Brand Notes"
        value={brandData?.brand_notes || ''}
        onChange={(e) => setBrandData((p) => ({ ...(p || {}), brand_notes: e.target.value }))}
        multiline
        rows={3}
      />
    </Stack>
  );
}
