import { useState } from 'react';
import {
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FileUploadList from 'ui-component/extended/Form/FileUploadList';

export default function BrandStep({
  token,
  data,
  setData,
  form,
  setForm,
  submitting,
  uploadingLogo,
  setUploadingLogo,
  logoUploadError,
  setLogoUploadError,
  uploadingStyleGuide,
  setUploadingStyleGuide,
  styleGuideUploadError,
  setStyleGuideUploadError,
  removingBrandAssetId,
  setRemovingBrandAssetId,
  uploadBrandAssets,
  deleteBrandAsset,
  uploadDisplayLogo,
  deleteDisplayLogo,
  onClearMessages,
  toast,
  getErrorMessage
}) {
  const [displayLogoBusy, setDisplayLogoBusy] = useState(false);
  const displayLogo = data?.brand?.display_logo || null;

  const handleDisplayLogoUpload = async (file) => {
    if (!file || !uploadDisplayLogo) return;
    onClearMessages?.();
    setDisplayLogoBusy(true);
    try {
      const next = await uploadDisplayLogo(token, file);
      setData((prev) => ({ ...prev, brand: { ...(prev?.brand || {}), display_logo: next } }));
      toast.success('Logo uploaded');
    } catch (err) {
      const msg = getErrorMessage(err, 'Unable to upload logo');
      toast.error(msg);
    } finally {
      setDisplayLogoBusy(false);
    }
  };

  const handleDisplayLogoRemove = async () => {
    if (!deleteDisplayLogo) return;
    onClearMessages?.();
    setDisplayLogoBusy(true);
    try {
      await deleteDisplayLogo(token);
      setData((prev) => ({ ...prev, brand: { ...(prev?.brand || {}), display_logo: null } }));
      toast.success('Logo removed');
    } catch (err) {
      const msg = getErrorMessage(err, 'Unable to remove logo');
      toast.error(msg);
    } finally {
      setDisplayLogoBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.4 }}>
        Business and brand details
      </Typography>
      <Typography variant="body2" color="text.secondary">
        This helps us match your website and marketing to your existing look and messaging. If something isn’t finalized, your best guess is fine.
      </Typography>
      <Stack spacing={2}>
        <TextField
          label="Business Name"
          fullWidth
          value={form.brand.business_name || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, brand: { ...prev.brand, business_name: e.target.value } }))}
        />
        <TextField
          label="Business Description"
          fullWidth
          multiline
          minRows={3}
          value={form.brand.business_description || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, brand: { ...prev.brand, business_description: e.target.value } }))}
        />
        <TextField
          label="Website URL"
          fullWidth
          value={form.brand.website_url || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, brand: { ...prev.brand, website_url: e.target.value } }))}
        />
        <TextField
          label="Brand notes (optional)"
          multiline
          minRows={3}
          fullWidth
          value={form.brand.brand_notes || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, brand: { ...prev.brand, brand_notes: e.target.value } }))}
        />
        <TextField
          label="Primary brand colors (if known)"
          fullWidth
          value={form.brand.primary_brand_colors || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, brand: { ...prev.brand, primary_brand_colors: e.target.value } }))}
          placeholder="e.g., Navy (#0B1F3B), Teal (#00A7A7)"
        />
        <Stack spacing={2}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Display Logo (optional)</Typography>
            <Typography variant="caption" color="text.secondary">
              A single PNG or JPG used in your portal, admin views, and emails. Upload a new file to replace it.
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              {displayLogo?.url ? (
                <Box
                  component="img"
                  src={displayLogo.url}
                  alt="Display logo"
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
                  disabled={submitting || displayLogoBusy}
                >
                  {displayLogo?.url ? 'Replace' : 'Upload Logo'}
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
                {displayLogo?.url && (
                  <Button
                    variant="text"
                    color="error"
                    onClick={handleDisplayLogoRemove}
                    disabled={submitting || displayLogoBusy}
                    startIcon={<DeleteOutlineIcon />}
                  >
                    Remove
                  </Button>
                )}
              </Stack>
            </Stack>
          </Stack>

          <FileUploadList
            title="Logo (optional)"
            description="If available, upload a logo file (PNG/JPG/WebP/SVG). You can upload more than one."
            accept="image/*"
            multiple
            disabled={submitting}
            busy={uploadingLogo}
            errorText={logoUploadError}
            kindLabel="Logo"
            items={(Array.isArray(data?.brand?.logos) ? data.brand.logos : []).filter((a) => (a?.kind || 'logo') === 'logo')}
            onAddFiles={async (files) => {
              setLogoUploadError('');
              onClearMessages?.();
              setUploadingLogo(true);
              try {
                const res = await uploadBrandAssets(token, files, { kind: 'logo' });
                const next = res?.data?.logos || res?.data?.assets || [];
                setData((prev) => ({ ...prev, brand: { ...(prev?.brand || {}), logos: next } }));
              } catch (err) {
                const msg = getErrorMessage(err, 'Unable to upload logo(s)');
                setLogoUploadError(msg);
                toast.error(msg);
              } finally {
                setUploadingLogo(false);
              }
            }}
            onRemove={async (asset) => {
              setLogoUploadError('');
              onClearMessages?.();
              setRemovingBrandAssetId(asset?.id || '');
              try {
                const next = await deleteBrandAsset(token, asset.id);
                const logos = next?.logos || next?.assets || [];
                setData((prev) => ({ ...prev, brand: { ...(prev?.brand || {}), logos } }));
              } catch (err) {
                const msg = getErrorMessage(err, 'Unable to remove file');
                setLogoUploadError(msg);
                toast.error(msg);
              } finally {
                setRemovingBrandAssetId('');
              }
            }}
          />

          <FileUploadList
            title="Style Guides"
            description="If available, upload style guides or brand docs (PDF/DOC/DOCX). You can upload multiple."
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            disabled={submitting}
            busy={uploadingStyleGuide}
            errorText={styleGuideUploadError}
            kindLabel="Style Guide"
            items={(Array.isArray(data?.brand?.logos) ? data.brand.logos : []).filter((a) => a?.kind === 'style_guide')}
            onAddFiles={async (files) => {
              setStyleGuideUploadError('');
              onClearMessages?.();
              setUploadingStyleGuide(true);
              try {
                const res = await uploadBrandAssets(token, files, { kind: 'style_guide' });
                const next = res?.data?.logos || res?.data?.assets || [];
                setData((prev) => ({ ...prev, brand: { ...(prev?.brand || {}), logos: next } }));
              } catch (err) {
                const msg = getErrorMessage(err, 'Unable to upload style guide(s)');
                setStyleGuideUploadError(msg);
                toast.error(msg);
              } finally {
                setUploadingStyleGuide(false);
              }
            }}
            onRemove={async (asset) => {
              setStyleGuideUploadError('');
              onClearMessages?.();
              setRemovingBrandAssetId(asset?.id || '');
              try {
                const next = await deleteBrandAsset(token, asset.id);
                const logos = next?.logos || next?.assets || [];
                setData((prev) => ({ ...prev, brand: { ...(prev?.brand || {}), logos } }));
              } catch (err) {
                const msg = getErrorMessage(err, 'Unable to remove file');
                setStyleGuideUploadError(msg);
                toast.error(msg);
              } finally {
                setRemovingBrandAssetId('');
              }
            }}
          />

          <Typography variant="caption" color="text.secondary">
            Tip: Uploaded items appear above. Use the X to remove anything incorrect.
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}


