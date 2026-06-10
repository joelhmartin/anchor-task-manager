/**
 * CTMConfigPanel — CTM FormReactor configuration within the form builder.
 *
 * Allows admins to:
 * - Enable/disable CTM integration for a form
 * - Select existing FormReactor or auto-create one
 * - View connection status
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  Typography
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import SelectField from 'ui-component/extended/SelectField';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import {
  listCtmReactors,
  createCtmReactor,
  linkCtmReactor,
  disableCtmIntegration,
  listCtmTrackingNumbers
} from 'api/forms';

export default function CTMConfigPanel({ formId, form, onFormUpdate }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [reactors, setReactors] = useState([]);
  const [trackingNumbers, setTrackingNumbers] = useState([]);
  const [loadingReactors, setLoadingReactors] = useState(false);
  const [selectedReactorId, setSelectedReactorId] = useState('');
  const [selectedNumberId, setSelectedNumberId] = useState('');
  const [ctmError, setCtmError] = useState(null);

  const settings = form?.settings_json || {};
  const isCtmEnabled = settings.ctm_enabled && form?.ctm_reactor_id;

  // Load CTM data when panel opens
  const loadCtmData = useCallback(async () => {
    if (!formId) return;
    setLoadingReactors(true);
    setCtmError(null);
    try {
      const [reactorList, numberList] = await Promise.all([
        listCtmReactors(formId).catch(() => []),
        listCtmTrackingNumbers(formId).catch(() => [])
      ]);
      setReactors(reactorList);
      setTrackingNumbers(numberList);
    } catch (err) {
      setCtmError(getErrorMessage(err));
    } finally {
      setLoadingReactors(false);
    }
  }, [formId]);

  useEffect(() => {
    loadCtmData();
  }, [loadCtmData]);

  const handleCreateReactor = async () => {
    try {
      setLoading(true);
      const result = await createCtmReactor(formId, selectedNumberId || undefined);
      showToast('CTM FormReactor created and linked!', 'success');
      onFormUpdate?.({
        ctm_reactor_id: result.reactor?.id || result.reactor?.form_reactor?.id,
        settings_json: { ...settings, ctm_enabled: true }
      });
      loadCtmData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLinkReactor = async () => {
    if (!selectedReactorId) {
      showToast('Select a FormReactor to link', 'error');
      return;
    }
    try {
      setLoading(true);
      await linkCtmReactor(formId, selectedReactorId);
      showToast('FormReactor linked!', 'success');
      onFormUpdate?.({
        ctm_reactor_id: selectedReactorId,
        settings_json: { ...settings, ctm_enabled: true }
      });
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    try {
      setLoading(true);
      await disableCtmIntegration(formId);
      showToast('CTM integration disabled', 'success');
      onFormUpdate?.({
        ctm_reactor_id: null,
        settings_json: { ...settings, ctm_enabled: false }
      });
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!formId) {
    return <Alert severity="info">Select a form first to configure CTM integration.</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">CTM Integration</Typography>

      {/* Status */}
      {isCtmEnabled ? (
        <Alert
          severity="success"
          icon={<CheckCircleIcon />}
          action={
            <Button size="small" color="inherit" onClick={handleDisable} disabled={loading}>
              Disconnect
            </Button>
          }
        >
          Connected to FormReactor
          <Typography variant="caption" display="block" color="text.secondary">
            ID: {form.ctm_reactor_id}
          </Typography>
        </Alert>
      ) : ctmError ? (
        <Alert severity="warning">
          CTM not available: {ctmError}
          <Typography variant="caption" display="block">
            Ensure this client has CTM credentials configured in their profile.
          </Typography>
        </Alert>
      ) : (
        <Alert severity="info">
          CTM integration is not enabled for this form. Form submissions will be stored locally but not sent to CTM.
        </Alert>
      )}

      {!isCtmEnabled && !ctmError && (
        <>
          <Divider />

          {loadingReactors ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Stack spacing={2}>
              {/* Option 1: Link existing reactor */}
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                Use Existing FormReactor
              </Typography>
              {reactors.length > 0 ? (
                <Stack direction="row" spacing={1} alignItems="flex-end">
                  <SelectField
                    label="FormReactor"
                    value={selectedReactorId}
                    onChange={(e) => setSelectedReactorId(e.target.value)}
                    size="small"
                    sx={{ flex: 1 }}
                  >
                    <MenuItem value="">— Select —</MenuItem>
                    {reactors.map((r) => (
                      <MenuItem key={r.id} value={String(r.id)}>
                        {r.name || `Reactor #${r.id}`}
                      </MenuItem>
                    ))}
                  </SelectField>
                  <LoadingButton
                    variant="outlined"
                    startIcon={<LinkIcon />}
                    onClick={handleLinkReactor}
                    loading={loading}
                    loadingLabel="Linking..."
                    disabled={!selectedReactorId}
                    size="small"
                  >
                    Link
                  </LoadingButton>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No existing FormReactors found. Create one below.
                </Typography>
              )}

              <Divider />

              {/* Option 2: Auto-create reactor */}
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                Auto-Create FormReactor
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Creates a new FormReactor in CTM based on this form's fields.
              </Typography>
              {trackingNumbers.length > 0 && (
                <SelectField
                  label="Tracking Number (optional)"
                  value={selectedNumberId}
                  onChange={(e) => setSelectedNumberId(e.target.value)}
                  size="small"
                >
                  <MenuItem value="">— None —</MenuItem>
                  {trackingNumbers.map((n) => (
                    <MenuItem key={n.id} value={String(n.id)}>
                      {n.name || n.number || n.id}
                    </MenuItem>
                  ))}
                </SelectField>
              )}
              <LoadingButton
                variant="contained"
                startIcon={<AddCircleIcon />}
                onClick={handleCreateReactor}
                loading={loading}
                loadingLabel="Creating..."
                size="small"
              >
                Create & Link FormReactor
              </LoadingButton>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
