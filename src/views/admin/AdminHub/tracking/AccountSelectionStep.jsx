import { useState, useEffect } from 'react';
import {
  Box, Stack, Typography, Autocomplete, TextField, Alert,
  CircularProgress
} from '@mui/material';
import LoadingButton from 'ui-component/extended/LoadingButton';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import CampaignClaimsPanel from './CampaignClaimsPanel';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import {
  getGA4Accounts, getGoogleAdsAccounts, getMetaAdAccounts,
  getMetaPixels, createMPSecret, listMetaCampaigns
} from 'api/tracking';

function formatGoogleAdsId(id) {
  if (!id) return id;
  const digits = String(id).replace(/-/g, '');
  return digits.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
}

function normalizeMeta(id) {
  if (!id) return null;
  return id.startsWith('act_') ? id : `act_${id}`;
}

export default function AccountSelectionStep({ config, saveConfig, onNext, onBack, userId }) {
  const { showToast } = useToast();

  // Dropdown option lists
  const [ga4Properties, setGa4Properties] = useState([]);
  const [adsAccounts, setAdsAccounts] = useState([]);
  const [metaAccounts, setMetaAccounts] = useState([]);
  const [metaPixels, setMetaPixels] = useState([]);

  // Loading states
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingPixels, setLoadingPixels] = useState(false);
  const [saving, setSaving] = useState(false);

  // Selected values
  const [selectedGa4, setSelectedGa4] = useState(null);
  const [selectedAds, setSelectedAds] = useState(null);
  const [selectedMeta, setSelectedMeta] = useState(null);
  const [selectedPixel, setSelectedPixel] = useState(null);
  const [pixelAutoLabel, setPixelAutoLabel] = useState('');
  const [pendingMetaAccount, setPendingMetaAccount] = useState(null); // { newVal, claimedCount }

  // Load all account lists on mount
  useEffect(() => {
    setLoadingAccounts(true);
    Promise.all([getGA4Accounts(), getGoogleAdsAccounts(), getMetaAdAccounts()])
      .then(([ga4, ads, meta]) => {
        setGa4Properties(ga4);
        // Filter out manager accounts
        setAdsAccounts((ads || []).filter((a) => !a.manager));
        setMetaAccounts(meta || []);

        // Restore selections from existing config
        if (config) {
          if (config.ga4_property_id) {
            const match = ga4.find((p) => p.propertyId === config.ga4_property_id);
            if (match) setSelectedGa4(match);
          }
          if (config.google_ads_customer_id) {
            const rawId = String(config.google_ads_customer_id).replace(/-/g, '');
            const match = (ads || []).find((a) => String(a.id).replace(/-/g, '') === rawId);
            if (match) setSelectedAds(match);
          }
          if (config.meta_ad_account_id) {
            const match = (meta || []).find((a) => String(a.id) === String(config.meta_ad_account_id));
            if (match) setSelectedMeta(match);
          }
        }
      })
      .catch((err) => {
        showToast(getErrorMessage(err, 'Failed to load accounts'), 'error');
      })
      .finally(() => setLoadingAccounts(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When a Meta ad account is chosen, auto-fetch its pixels
  useEffect(() => {
    if (!selectedMeta) {
      setMetaPixels([]);
      setSelectedPixel(null);
      setPixelAutoLabel('');
      return;
    }
    setLoadingPixels(true);
    getMetaPixels(selectedMeta.id)
      .then((pixels) => {
        setMetaPixels(pixels);
        if (pixels.length === 1) {
          setSelectedPixel(pixels[0]);
          setPixelAutoLabel(`Pixel auto-selected: ${pixels[0].name} (${pixels[0].id})`);
        } else {
          setSelectedPixel(null);
          setPixelAutoLabel('');
          // Restore from config if multiple pixels
          if (config?.meta_pixel_id) {
            const match = pixels.find((p) => String(p.id) === String(config.meta_pixel_id));
            if (match) setSelectedPixel(match);
          }
        }
      })
      .catch(() => {
        setMetaPixels([]);
        setSelectedPixel(null);
        setPixelAutoLabel('');
      })
      .finally(() => setLoadingPixels(false));
  }, [selectedMeta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMetaAccountChange = async (newVal) => {
    const oldId = selectedMeta?.id || null;
    const newId = newVal?.id || null;
    if (oldId && newId && oldId !== newId && userId) {
      // Check whether this client has claims on the old account
      try {
        const data = await listMetaCampaigns(userId, { status: 'all' });
        const claimedCount = (data.campaigns || []).filter((c) => c.claimed_by?.is_current_client).length;
        if (claimedCount > 0) {
          setPendingMetaAccount({ newVal, claimedCount });
          return; // wait for user confirmation
        }
      } catch (err) {
        // If listing fails we can't count existing claims. Warn the admin so
        // they know the pre-switch validation didn't run — the account change
        // still proceeds, and the backend will clear any stale claims on save.
        console.warn('[tracking] pre-switch claims check failed:', err);
        showToast('Could not verify claimed campaigns; proceeding without validation', 'warning');
      }
    }
    // No claims or no prior account: apply immediately
    setSelectedMeta(newVal);
    setSelectedPixel(null);
    setPixelAutoLabel('');
  };

  const handleNext = async () => {
    setSaving(true);
    try {
      const fields = {
        ga4_property_id: selectedGa4?.propertyId || null,
        ga4_measurement_id: selectedGa4?.measurementId || config?.ga4_measurement_id || null,
        google_ads_customer_id: selectedAds ? formatGoogleAdsId(selectedAds.id) : null,
        meta_ad_account_id: selectedMeta?.id || null,
        meta_pixel_id: selectedPixel?.id || null,
        // Auto-enable browser Meta Pixel when a pixel is selected
        // (the GTM template gates the Meta PageView tag on this flag)
        browser_meta_pixel_enabled: config?.client_type !== 'medical' && !!selectedPixel,
      };

      const saved = await saveConfig(fields);

      // Auto-create GA4 Measurement Protocol secret (non-fatal)
      if (saved?.ga4_property_id) {
        try {
          await createMPSecret(saved.ga4_property_id);
        } catch {
          // intentionally non-fatal
        }
      }

      showToast('Accounts saved', 'success');
      onNext();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save accounts'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loadingAccounts) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" gutterBottom>Connect Accounts</Typography>
        <Typography variant="body2" color="text.secondary">
          Link the advertising and analytics accounts for this client.
        </Typography>
      </Box>

      {/* GA4 Property */}
      <Autocomplete
        options={ga4Properties}
        value={selectedGa4}
        onChange={(_, val) => setSelectedGa4(val)}
        getOptionLabel={(opt) =>
          opt.accountName ? `${opt.accountName} > ${opt.propertyName}` : opt.propertyName || opt.propertyId
        }
        isOptionEqualToValue={(opt, val) => opt.propertyId === val.propertyId}
        renderInput={(params) => (
          <TextField {...params} label="GA4 Property" size="small" placeholder="Search properties…" />
        )}
      />

      {/* Google Ads Account */}
      <Autocomplete
        options={adsAccounts}
        value={selectedAds}
        onChange={(_, val) => setSelectedAds(val)}
        getOptionLabel={(opt) =>
          opt.name ? `${opt.name} — ${formatGoogleAdsId(opt.id)}` : String(opt.id)
        }
        isOptionEqualToValue={(opt, val) => String(opt.id) === String(val.id)}
        renderInput={(params) => (
          <TextField {...params} label="Google Ads Account" size="small" placeholder="Search accounts…" />
        )}
      />

      {/* Meta Ad Account */}
      <Autocomplete
        options={metaAccounts}
        value={selectedMeta}
        onChange={(_, val) => handleMetaAccountChange(val)}
        getOptionLabel={(opt) => opt.name ? `${opt.name} — ${opt.id}` : String(opt.id)}
        isOptionEqualToValue={(opt, val) => String(opt.id) === String(val.id)}
        renderInput={(params) => (
          <TextField {...params} label="Meta Ad Account" size="small" placeholder="Search ad accounts…" />
        )}
      />

      {/* Meta Pixel — shown after ad account is selected */}
      {selectedMeta && (
        <>
          {loadingPixels ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Loading pixels…</Typography>
            </Box>
          ) : metaPixels.length === 0 ? (
            <Alert severity="info" variant="outlined">
              No pixels found for this ad account. You can add one later in Meta Events Manager.
            </Alert>
          ) : metaPixels.length === 1 ? (
            <Alert severity="success" variant="outlined">
              {pixelAutoLabel}
            </Alert>
          ) : (
            <Autocomplete
              options={metaPixels}
              value={selectedPixel}
              onChange={(_, val) => setSelectedPixel(val)}
              getOptionLabel={(opt) => opt.name ? `${opt.name} (${opt.id})` : String(opt.id)}
              isOptionEqualToValue={(opt, val) => String(opt.id) === String(val.id)}
              renderInput={(params) => (
                <TextField {...params} label="Meta Pixel" size="small" placeholder="Select pixel…" />
              )}
            />
          )}
        </>
      )}

      {/* Meta Campaign Allowlist — shown only when the selected account matches
          what's already saved. The backend endpoint resolves the account from
          tracking_configs, so rendering the panel against an unsaved selection
          would show campaigns from the PREVIOUS account (or 400 for first-time
          setup). Admins save first via "Next", then manage campaigns. */}
      {selectedMeta?.id && config?.meta_ad_account_id &&
        normalizeMeta(selectedMeta.id) === normalizeMeta(config.meta_ad_account_id) && (
          <CampaignClaimsPanel userId={userId} adAccountId={selectedMeta.id} />
        )}
      {selectedMeta?.id && (!config?.meta_ad_account_id ||
        normalizeMeta(selectedMeta.id) !== normalizeMeta(config?.meta_ad_account_id)) && (
          <Alert severity="info" sx={{ mt: 1 }}>
            Save this Meta ad account (click Next) to manage its campaign allowlist for this client.
          </Alert>
        )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <LoadingButton variant="outlined" onClick={onBack}>Back</LoadingButton>
        <LoadingButton
          variant="contained"
          loading={saving}
          loadingLabel="Saving…"
          onClick={handleNext}
        >
          Next
        </LoadingButton>
      </Box>

      <ConfirmDialog
        open={!!pendingMetaAccount}
        onClose={() => setPendingMetaAccount(null)}
        onConfirm={() => {
          const { newVal } = pendingMetaAccount || {};
          setPendingMetaAccount(null);
          setSelectedMeta(newVal);
          setSelectedPixel(null);
          setPixelAutoLabel('');
        }}
        title="Switch Meta ad account?"
        message={`This client has ${pendingMetaAccount?.claimedCount || 0} claimed campaign(s) on the current account. Switching will clear those claims.`}
        secondaryText="You can re-claim campaigns on the new account after switching."
        confirmLabel="Switch account"
        confirmColor="warning"
      />
    </Stack>
  );
}
