import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  CircularProgress,
  Stack,
  TextField
} from '@mui/material';
import {
  createTrackingConfig,
  getCtmAccounts,
  getGA4Accounts,
  getGoogleAdsAccounts,
  getMetaAdAccounts,
  getMetaPixels,
  updateTrackingConfig
} from 'api/tracking';
import CampaignClaimsPanel from './CampaignClaimsPanel';

function mapBusinessTypeToTrackingType(clientType) {
  if (!clientType) return null;
  return clientType === 'medical' ? 'medical' : 'non_medical';
}

function buildTrackingPayload(record, trackingClientType) {
  return {
    client_type: trackingClientType,
    ga4_property_id: record.ga4_property_id || null,
    ga4_measurement_id: record.ga4_property_id ? record.ga4_measurement_id || null : null,
    google_ads_customer_id: record.google_ads_customer_id || null,
    meta_ad_account_id: record.meta_ad_account_id || null,
    meta_pixel_id: record.meta_ad_account_id ? record.meta_pixel_id || null : null,
    browser_meta_pixel_enabled: trackingClientType !== 'medical' && !!record.meta_pixel_id
  };
}

function formatGoogleAdsId(id) {
  if (!id) return id;
  const digits = String(id).replace(/-/g, '');
  return digits.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
}

function normalizeMeta(id) {
  if (!id) return null;
  return String(id).startsWith('act_') ? String(id) : `act_${id}`;
}

function matchesGoogleAdsId(optionId, selectedId) {
  return String(optionId || '').replace(/-/g, '') === String(selectedId || '').replace(/-/g, '');
}

export default function ConnectedAccountsSection({ editing, setEditing, onError }) {
  const [ga4Properties, setGa4Properties] = useState([]);
  const [adsAccounts, setAdsAccounts] = useState([]);
  const [metaAccounts, setMetaAccounts] = useState([]);
  const [ctmAccounts, setCtmAccounts] = useState([]);
  const [metaPixels, setMetaPixels] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingPixels, setLoadingPixels] = useState(false);
  const [ctmLookupUnavailable, setCtmLookupUnavailable] = useState(false);
  const [pixelNotice, setPixelNotice] = useState('');
  const [ctmInputValue, setCtmInputValue] = useState('');
  const [persistingMeta, setPersistingMeta] = useState(false);
  // Track the Meta ad account that has been successfully synced to the server
  // so the campaigns panel can mount as soon as the in-drawer persist completes,
  // without waiting for a save+reopen to repopulate `editing.tracking_config_id`.
  // Seed from the initial editing state so previously-saved clients render on open.
  const [syncedMetaAdAccountId, setSyncedMetaAdAccountId] = useState(
    () => (editing?.tracking_config_id ? normalizeMeta(editing?.meta_ad_account_id) : null)
  );
  // Always read the freshest `editing` from a ref so chained saves see the
  // tracking_config_id assigned by the previous save in the same chain.
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  // Serial queue: each persist call awaits the previous so a CREATE finishes
  // (and tracking_config_id propagates into editing) before the next one runs
  // — otherwise concurrent CREATEs hit the unique-user-id constraint (409).
  const persistChainRef = useRef(Promise.resolve());
  const inFlightCountRef = useRef(0);

  // Persist the tracking_configs row immediately so the campaign claims panel
  // (which reads `meta_ad_account_id` from `tracking_configs` server-side) can
  // render before the user clicks the drawer's Save button. Without this, the
  // `/hub/tracking/:userId/meta-campaigns` endpoint returns
  // `no_meta_ad_account_configured` until a save round-trip completes.
  const persistTrackingConfig = useCallback(
    (overrides = {}) => {
      const run = async () => {
        const current = editingRef.current;
        if (!current?.id) return null;
        const trackingClientType = mapBusinessTypeToTrackingType(current.client_type);
        if (!trackingClientType) return null;
        const merged = { ...current, ...overrides };
        const payload = buildTrackingPayload(merged, trackingClientType);
        try {
          let config = null;
          if (current.tracking_config_id) {
            const result = await updateTrackingConfig(current.tracking_config_id, payload);
            config = result?.config || null;
          } else {
            const result = await createTrackingConfig({ ...payload, user_id: current.id });
            config = result?.config || null;
          }
          if (config) {
            setSyncedMetaAdAccountId(normalizeMeta(config.meta_ad_account_id) || null);
            setEditing((prev) =>
              prev?.id === current.id
                ? {
                    ...prev,
                    tracking_config_id: config.id || prev.tracking_config_id,
                    tracking_client_type: config.client_type || prev.tracking_client_type,
                    ga4_property_id: config.ga4_property_id ?? prev.ga4_property_id ?? null,
                    ga4_measurement_id: config.ga4_measurement_id ?? prev.ga4_measurement_id ?? null,
                    google_ads_customer_id: config.google_ads_customer_id ?? prev.google_ads_customer_id ?? null,
                    meta_ad_account_id: config.meta_ad_account_id ?? prev.meta_ad_account_id ?? null,
                    meta_pixel_id: config.meta_pixel_id ?? prev.meta_pixel_id ?? null,
                    browser_meta_pixel_enabled: !!config.browser_meta_pixel_enabled
                  }
                : prev
            );
          }
          return config;
        } catch (err) {
          onError?.(err, 'Unable to save connected accounts');
          return null;
        }
      };
      inFlightCountRef.current += 1;
      setPersistingMeta(true);
      const chained = persistChainRef.current.then(run, run).finally(() => {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
        if (inFlightCountRef.current === 0) setPersistingMeta(false);
      });
      persistChainRef.current = chained;
      return chained;
    },
    [setEditing, onError]
  );

  useEffect(() => {
    let active = true;
    setLoadingAccounts(true);

    Promise.allSettled([getGA4Accounts(), getGoogleAdsAccounts(), getMetaAdAccounts(), getCtmAccounts()])
      .then(([ga4Result, adsResult, metaResult, ctmResult]) => {
        if (!active) return;

        if (ga4Result.status === 'fulfilled') {
          setGa4Properties(Array.isArray(ga4Result.value) ? ga4Result.value : []);
        } else {
          setGa4Properties([]);
          onError?.(ga4Result.reason, 'Unable to load GA4 properties');
        }

        if (adsResult.status === 'fulfilled') {
          const accounts = Array.isArray(adsResult.value) ? adsResult.value : [];
          setAdsAccounts(accounts.filter((account) => !account.manager));
        } else {
          setAdsAccounts([]);
          onError?.(adsResult.reason, 'Unable to load Google Ads accounts');
        }

        if (metaResult.status === 'fulfilled') {
          setMetaAccounts(Array.isArray(metaResult.value) ? metaResult.value : []);
        } else {
          setMetaAccounts([]);
          onError?.(metaResult.reason, 'Unable to load Meta ad accounts');
        }

        if (ctmResult.status === 'fulfilled') {
          setCtmAccounts(Array.isArray(ctmResult.value) ? ctmResult.value : []);
          setCtmLookupUnavailable(false);
        } else {
          setCtmAccounts([]);
          setCtmLookupUnavailable(true);
        }
      })
      .finally(() => {
        if (!active) return;
        setLoadingAccounts(false);
      });

    return () => {
      active = false;
    };
  }, [onError]);

  const selectedGa4 = useMemo(
    () => ga4Properties.find((property) => String(property.propertyId) === String(editing?.ga4_property_id || '')) || null,
    [editing?.ga4_property_id, ga4Properties]
  );

  const selectedAds = useMemo(
    () => adsAccounts.find((account) => matchesGoogleAdsId(account.id, editing?.google_ads_customer_id)) || null,
    [adsAccounts, editing?.google_ads_customer_id]
  );

  const selectedMeta = useMemo(
    () => metaAccounts.find((account) => normalizeMeta(account.id) === normalizeMeta(editing?.meta_ad_account_id)) || null,
    [editing?.meta_ad_account_id, metaAccounts]
  );

  const selectedPixel = useMemo(
    () => metaPixels.find((pixel) => String(pixel.id) === String(editing?.meta_pixel_id || '')) || null,
    [editing?.meta_pixel_id, metaPixels]
  );

  const selectedCtm = useMemo(
    () => ctmAccounts.find((account) => String(account.id) === String(editing?.ctm_account_number || '')) || null,
    [ctmAccounts, editing?.ctm_account_number]
  );

  useEffect(() => {
    if (selectedCtm) {
      setCtmInputValue(selectedCtm.name ? `${selectedCtm.name} — ${selectedCtm.id}` : String(selectedCtm.id));
      return;
    }
    setCtmInputValue(editing?.ctm_account_number || '');
  }, [editing?.ctm_account_number, selectedCtm]);

  useEffect(() => {
    const metaAccountId = selectedMeta?.id || null;
    if (!metaAccountId) {
      setMetaPixels([]);
      setPixelNotice('');
      return;
    }

    let active = true;
    setLoadingPixels(true);

    getMetaPixels(metaAccountId)
      .then((pixels) => {
        if (!active) return;
        const nextPixels = Array.isArray(pixels) ? pixels : [];
        setMetaPixels(nextPixels);

        if (nextPixels.length === 1) {
          const onlyPixelId = String(nextPixels[0].id);
          setPixelNotice(`Pixel auto-selected: ${nextPixels[0].name} (${onlyPixelId})`);
          let pixelChanged = false;
          setEditing((prev) => {
            if (!prev) return prev;
            if (String(prev.meta_pixel_id || '') === onlyPixelId) return prev;
            pixelChanged = true;
            return { ...prev, meta_pixel_id: onlyPixelId };
          });
          if (pixelChanged) {
            persistTrackingConfig({ meta_pixel_id: onlyPixelId }).catch(() => {});
          }
          return;
        }

        if (nextPixels.length === 0) {
          setPixelNotice('No pixels found for this ad account yet.');
          setEditing((prev) => {
            if (!prev || !prev.meta_pixel_id) return prev;
            return { ...prev, meta_pixel_id: null };
          });
          return;
        }

        setPixelNotice('');
        setEditing((prev) => {
          if (!prev?.meta_pixel_id) return prev;
          const exists = nextPixels.some((pixel) => String(pixel.id) === String(prev.meta_pixel_id));
          return exists ? prev : { ...prev, meta_pixel_id: null };
        });
      })
      .catch((err) => {
        if (!active) return;
        setMetaPixels([]);
        setPixelNotice('Unable to load Meta pixels for this account.');
        onError?.(err, 'Unable to load Meta pixels');
      })
      .finally(() => {
        if (!active) return;
        setLoadingPixels(false);
      });

    return () => {
      active = false;
    };
  }, [onError, selectedMeta?.id, setEditing, persistTrackingConfig]);

  return (
    <Stack spacing={2}>
      <Autocomplete
        options={ga4Properties}
        value={selectedGa4}
        loading={loadingAccounts}
        onChange={(_event, value) =>
          setEditing((prev) => ({
            ...prev,
            ga4_property_id: value?.propertyId || null,
            ga4_measurement_id: value?.measurementId || null
          }))
        }
        getOptionLabel={(option) =>
          option?.accountName ? `${option.accountName} > ${option.propertyName}` : option?.propertyName || option?.propertyId || ''
        }
        isOptionEqualToValue={(option, value) => String(option?.propertyId) === String(value?.propertyId)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="GA4 Property"
            placeholder="Search GA4 properties..."
            helperText={selectedGa4?.measurementId ? `Measurement ID: ${selectedGa4.measurementId}` : ' '}
          />
        )}
      />

      <Autocomplete
        options={adsAccounts}
        value={selectedAds}
        loading={loadingAccounts}
        onChange={(_event, value) =>
          setEditing((prev) => ({
            ...prev,
            google_ads_customer_id: value ? formatGoogleAdsId(value.id) : null
          }))
        }
        getOptionLabel={(option) => (option?.name ? `${option.name} — ${formatGoogleAdsId(option.id)}` : String(option?.id || ''))}
        isOptionEqualToValue={(option, value) => matchesGoogleAdsId(option?.id, value?.id)}
        renderInput={(params) => (
          <TextField {...params} label="Google Ads Account" placeholder="Search Google Ads accounts..." helperText=" " />
        )}
      />

      <Autocomplete
        options={metaAccounts}
        value={selectedMeta}
        loading={loadingAccounts}
        disabled={persistingMeta}
        onChange={(_event, value) => {
          const nextId = value?.id || null;
          setEditing((prev) => ({
            ...prev,
            meta_ad_account_id: nextId,
            meta_pixel_id: null
          }));
          // Persist immediately so the campaign claims panel below can render
          // without requiring the user to click the drawer's Save button first.
          persistTrackingConfig({ meta_ad_account_id: nextId, meta_pixel_id: null });
        }}
        getOptionLabel={(option) => (option?.name ? `${option.name} — ${option.id}` : String(option?.id || ''))}
        isOptionEqualToValue={(option, value) => normalizeMeta(option?.id) === normalizeMeta(value?.id)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Meta Ad Account"
            placeholder="Search Meta ad accounts..."
            helperText={
              !editing?.client_type && selectedMeta
                ? 'Set a Client Type above to enable Meta campaign claims.'
                : ' '
            }
          />
        )}
      />

      <Autocomplete
        options={metaPixels}
        value={selectedPixel}
        loading={loadingPixels}
        disabled={!selectedMeta || persistingMeta}
        onChange={(_event, value) => {
          const nextPixelId = value?.id || null;
          setEditing((prev) => ({
            ...prev,
            meta_pixel_id: nextPixelId
          }));
          persistTrackingConfig({ meta_pixel_id: nextPixelId });
        }}
        getOptionLabel={(option) => (option?.name ? `${option.name} (${option.id})` : String(option?.id || ''))}
        isOptionEqualToValue={(option, value) => String(option?.id) === String(value?.id)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Meta Pixel"
            placeholder={selectedMeta ? 'Search Meta pixels...' : 'Select a Meta ad account first'}
            helperText=" "
          />
        )}
      />

      <Autocomplete
        freeSolo
        options={ctmAccounts}
        value={selectedCtm}
        inputValue={ctmInputValue}
        loading={loadingAccounts && !ctmLookupUnavailable}
        onChange={(_event, value) => {
          const rawValue = typeof value === 'string' ? value.trim() : value?.id ? String(value.id) : '';
          const nextValue = typeof value === 'string' && !/^\d*$/.test(rawValue) ? '' : rawValue;
          setEditing((prev) => ({ ...prev, ctm_account_number: nextValue || null }));
          setCtmInputValue(typeof value === 'string' ? value : value?.name ? `${value.name} — ${value.id}` : nextValue);
        }}
        onInputChange={(_event, value, reason) => {
          setCtmInputValue(value);
          if (reason === 'clear') {
            setEditing((prev) => ({ ...prev, ctm_account_number: null }));
            return;
          }
          if (reason !== 'input') return;
          if (/^\d*$/.test(value)) {
            setEditing((prev) => ({ ...prev, ctm_account_number: value || null }));
          }
        }}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option?.name ? `${option.name} — ${option.id}` : String(option?.id || ''))}
        isOptionEqualToValue={(option, value) => String(option?.id) === String(value?.id)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="CTM Account"
            placeholder="Search CTM accounts or enter an account number..."
            helperText={ctmLookupUnavailable ? 'CTM account lookup is unavailable right now. You can still enter the account number manually.' : 'Uses the agency-level CTM API credentials.'}
          />
        )}
      />

      {loadingPixels && selectedMeta && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <span>Loading Meta pixels...</span>
        </Stack>
      )}

      {pixelNotice && (
        <Alert severity={selectedPixel ? 'success' : 'info'} variant="outlined">
          {pixelNotice}
        </Alert>
      )}

      {persistingMeta && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <span>Saving connected accounts...</span>
        </Stack>
      )}

      {editing?.meta_ad_account_id &&
        syncedMetaAdAccountId &&
        syncedMetaAdAccountId === normalizeMeta(editing.meta_ad_account_id) && (
          <CampaignClaimsPanel userId={editing.id} adAccountId={editing.meta_ad_account_id} />
        )}
    </Stack>
  );
}
