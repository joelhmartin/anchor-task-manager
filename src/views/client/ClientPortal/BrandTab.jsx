import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { fetchBrand, saveBrand, uploadDisplayLogo, deleteDisplayLogo } from 'api/brand';
import { fetchProfile, updateProfile } from 'api/profile';

const fieldLabels = {
  business_name: 'Business Name',
  business_description: 'Business Description',
  brand_notes: 'Brand Notes',
  website_url: 'Website URL'
};

export default function BrandTab({ triggerMessage }) {
  const [brand, setBrand] = useState(null);
  const [brandFields, setBrandFields] = useState({});
  const [accessFields, setAccessFields] = useState({
    website_access_provided: false,
    website_access_understood: false,
    ga4_access_provided: false,
    ga4_access_understood: false,
    google_ads_access_provided: false,
    google_ads_access_understood: false,
    meta_access_provided: false,
    meta_access_understood: false,
    website_forms_details_provided: false,
    website_forms_details_understood: false,
    website_forms_uses_third_party: false,
    website_forms_uses_hipaa: false,
    website_forms_connected_crm: false,
    website_forms_custom: false,
    website_forms_notes: ''
  });
  const [logoUploads, setLogoUploads] = useState([]);
  const [styleUploads, setStyleUploads] = useState([]);
  const [logoDeletions, setLogoDeletions] = useState([]);
  const [styleDeletions, setStyleDeletions] = useState([]);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandLoaded, setBrandLoaded] = useState(false);
  const [displayLogoBusy, setDisplayLogoBusy] = useState(false);

  const handleDisplayLogoUpload = async (file) => {
    if (!file) return;
    setDisplayLogoBusy(true);
    try {
      const displayLogo = await uploadDisplayLogo(file);
      setBrand((prev) => ({ ...(prev || {}), display_logo: displayLogo }));
      triggerMessage('success', 'Logo updated');
    } catch (err) {
      triggerMessage('error', err?.response?.data?.message || err.message || 'Unable to upload logo');
    } finally {
      setDisplayLogoBusy(false);
    }
  };

  const handleDisplayLogoRemove = async () => {
    setDisplayLogoBusy(true);
    try {
      await deleteDisplayLogo();
      setBrand((prev) => ({ ...(prev || {}), display_logo: null }));
      triggerMessage('success', 'Logo removed');
    } catch (err) {
      triggerMessage('error', err?.response?.data?.message || err.message || 'Unable to remove logo');
    } finally {
      setDisplayLogoBusy(false);
    }
  };

  const loadBrand = useCallback(() => {
    Promise.all([fetchBrand(), fetchProfile()])
      .then(([data, profileData]) => {
        setBrand(data);
        setBrandFields({
          business_name: data.business_name || '',
          business_description: data.business_description || '',
          brand_notes: data.brand_notes || '',
          website_url: data.website_url || ''
        });
        setAccessFields((prev) => ({
          ...prev,
          website_access_provided: profileData.website_access_provided || false,
          website_access_understood: profileData.website_access_understood || false,
          ga4_access_provided: profileData.ga4_access_provided || false,
          ga4_access_understood: profileData.ga4_access_understood || false,
          google_ads_access_provided: profileData.google_ads_access_provided || false,
          google_ads_access_understood: profileData.google_ads_access_understood || false,
          meta_access_provided: profileData.meta_access_provided || false,
          meta_access_understood: profileData.meta_access_understood || false,
          website_forms_details_provided: profileData.website_forms_details_provided || false,
          website_forms_details_understood: profileData.website_forms_details_understood || false,
          website_forms_uses_third_party: profileData.website_forms_uses_third_party || false,
          website_forms_uses_hipaa: profileData.website_forms_uses_hipaa || false,
          website_forms_connected_crm: profileData.website_forms_connected_crm || false,
          website_forms_custom: profileData.website_forms_custom || false,
          website_forms_notes: profileData.website_forms_notes || ''
        }));
      })
      .catch((err) => triggerMessage('error', err.message || 'Unable to load brand profile'))
      .finally(() => setBrandLoaded(true));
  }, [triggerMessage]);

  // Load on first render
  if (!brandLoaded) loadBrand();

  const handleBrandSave = async () => {
    setBrandSaving(true);
    try {
      const updated = await saveBrand({
        fields: brandFields,
        logoFiles: logoUploads,
        styleGuideFiles: styleUploads,
        deletions: [...logoDeletions, ...styleDeletions]
      });
      setBrand(updated);
      setLogoUploads([]);
      setStyleUploads([]);
      setLogoDeletions([]);
      setStyleDeletions([]);
      // Persist access confirmations alongside brand info
      await updateProfile({ ...accessFields });
      triggerMessage('success', 'Brand profile saved');
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to save brand profile');
    } finally {
      setBrandSaving(false);
    }
  };

  if (!brand) {
    return (
      <Typography variant="body2" color="text.secondary">
        Brand profile not loaded yet.
      </Typography>
    );
  }

  return (
    <Stack spacing={3}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={12}>
          <Stack spacing={2}>
            <Typography variant="h6">Brand Basics</Typography>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Display Logo</Typography>
              <Typography variant="caption" color="text.secondary">
                A single PNG or JPG used in the portal header, admin views, and emails. Replaces any previous upload.
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                {brand.display_logo?.url ? (
                  <Box
                    component="img"
                    src={brand.display_logo.url}
                    alt="Client display logo"
                    sx={{
                      width: 96,
                      height: 96,
                      objectFit: 'contain',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      bgcolor: 'background.paper',
                      p: 1
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: 96,
                      height: 96,
                      border: '1px dashed',
                      borderColor: 'divider',
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'text.disabled',
                      fontSize: 12
                    }}
                  >
                    No logo
                  </Box>
                )}
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<UploadFileIcon />}
                    disabled={displayLogoBusy}
                  >
                    {brand.display_logo?.url ? 'Replace' : 'Upload Logo'}
                    <input
                      type="file"
                      hidden
                      accept="image/png,image/jpeg"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        handleDisplayLogoUpload(file);
                      }}
                    />
                  </Button>
                  {brand.display_logo?.url && (
                    <Button
                      variant="text"
                      color="error"
                      onClick={handleDisplayLogoRemove}
                      disabled={displayLogoBusy}
                      startIcon={<DeleteOutlineIcon />}
                    >
                      Remove
                    </Button>
                  )}
                </Stack>
              </Stack>
            </Stack>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Logo Files</Typography>
              <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
                Select Logos
                <input type="file" hidden multiple onChange={(e) => setLogoUploads(Array.from(e.target.files || []))} />
              </Button>
              {logoUploads.length > 0 && <Typography variant="caption">{logoUploads.length} new file(s) selected</Typography>}
              {brand.logos?.length ? (
                brand.logos.map((logo) => (
                  <Stack
                    key={logo.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}
                  >
                    <Typography sx={{ flex: 1 }}>{logo.name}</Typography>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setBrand((prev) => ({ ...prev, logos: prev.logos.filter((l) => l.id !== logo.id) }));
                        setLogoDeletions((prev) => [...prev, logo.id]);
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No logos uploaded.
                </Typography>
              )}
            </Stack>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Style Guides</Typography>
              <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
                Select Style Guides
                <input type="file" hidden multiple onChange={(e) => setStyleUploads(Array.from(e.target.files || []))} />
              </Button>
              {styleUploads.length > 0 && <Typography variant="caption">{styleUploads.length} new file(s) selected</Typography>}
              {brand.style_guides?.length ? (
                brand.style_guides.map((guide) => (
                  <Stack
                    key={guide.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}
                  >
                    <Typography sx={{ flex: 1 }}>{guide.name}</Typography>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setBrand((prev) => ({
                          ...prev,
                          style_guides: prev.style_guides.filter((l) => l.id !== guide.id)
                        }));
                        setStyleDeletions((prev) => [...prev, guide.id]);
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No style guides uploaded.
                </Typography>
              )}
            </Stack>
            <TextField
              label={fieldLabels.business_name}
              fullWidth
              value={brandFields.business_name || ''}
              onChange={(e) => setBrandFields((prev) => ({ ...prev, business_name: e.target.value }))}
            />
            <TextField
              label={fieldLabels.business_description}
              fullWidth
              multiline
              minRows={4}
              value={brandFields.business_description || ''}
              onChange={(e) => setBrandFields((prev) => ({ ...prev, business_description: e.target.value }))}
            />
            <TextField
              label={fieldLabels.brand_notes}
              fullWidth
              multiline
              minRows={4}
              value={brandFields.brand_notes || ''}
              onChange={(e) => setBrandFields((prev) => ({ ...prev, brand_notes: e.target.value }))}
            />
            <TextField
              label={fieldLabels.website_url}
              fullWidth
              value={brandFields.website_url || ''}
              onChange={(e) => setBrandFields((prev) => ({ ...prev, website_url: e.target.value }))}
            />
          </Stack>
        </Grid>
      </Grid>
      <Box sx={{ mt: 1 }}>
        <Button variant="contained" onClick={handleBrandSave} disabled={brandSaving} sx={{ alignSelf: 'flex-start' }}>
          {brandSaving ? 'Saving…' : 'Save Brand Profile'}
        </Button>
      </Box>
    </Stack>
  );
}
