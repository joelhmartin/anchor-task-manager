/**
 * Call Tracking Tab Component
 *
 * Manages Twilio call tracking configuration including:
 * - Provider selection (CTM vs Twilio)
 * - Tracking numbers (purchase, edit, release)
 * - Attribution script generation
 *
 * Note: Twilio credentials are configured globally via environment variables.
 * This UI manages per-client tracking numbers and provider preferences.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import FormDialog from 'ui-component/extended/FormDialog';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PhoneIcon from '@mui/icons-material/Phone';

import {
  getTwilioConfig,
  switchCallProvider,
  listTrackingNumbers,
  purchaseTrackingNumber,
  updateTrackingNumber,
  releaseTrackingNumber,
  getTrackingScript
} from 'api/twilio';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

const SOURCE_TYPES = [
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tv', label: 'TV' },
  { value: 'radio', label: 'Radio' },
  { value: 'print', label: 'Print' },
  { value: 'organic', label: 'Organic' },
  { value: 'direct', label: 'Direct' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Other' }
];

export default function CallTrackingTab({ clientId }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Provider config
  const [config, setConfig] = useState(null);
  const [provider, setProvider] = useState('ctm');

  // Tracking numbers
  const [numbers, setNumbers] = useState([]);
  const [numbersLoading, setNumbersLoading] = useState(false);

  // Purchase dialog
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({
    areaCode: '',
    friendlyName: '',
    forwardTo: '',
    sourceType: '',
    recordingEnabled: true,
    transcriptionEnabled: true
  });

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editNumber, setEditNumber] = useState(null);

  // Script dialog
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptCode, setScriptCode] = useState('');

  // Release confirmation dialog
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const [numberToRelease, setNumberToRelease] = useState(null);

  const numberColumns = useMemo(() => [
    {
      id: 'phone_number', label: 'Phone Number',
      render: (row) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <PhoneIcon fontSize="small" color="primary" />
          <Typography variant="body2">{row.phone_number}</Typography>
        </Stack>
      )
    },
    { id: 'friendly_name', label: 'Name', render: (row) => row.friendly_name || '-' },
    { id: 'forward_to_number', label: 'Forward To' },
    {
      id: 'source_type', label: 'Source',
      render: (row) => row.source_type
        ? <Chip label={SOURCE_TYPES.find((s) => s.value === row.source_type)?.label || row.source_type} size="small" />
        : null
    },
    {
      id: 'recording_enabled', label: 'Recording',
      render: (row) => <StatusChip status={row.recording_enabled ? 'on' : 'off'} />
    },
    {
      id: 'actions', label: 'Actions', align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <IconButton size="small" onClick={() => { setEditNumber({ ...row }); setEditOpen(true); }}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" color="error" onClick={() => handleReleaseClick(row)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      )
    },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load initial data
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTwilioConfig(clientId);
      setConfig(data);
      setProvider(data.provider || 'ctm');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [clientId, showToast]);

  const loadNumbers = useCallback(async () => {
    if (provider !== 'twilio' || !config?.configured) return;

    try {
      setNumbersLoading(true);
      const data = await listTrackingNumbers(clientId);
      setNumbers(data);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setNumbersLoading(false);
    }
  }, [clientId, provider, config?.configured, showToast]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    loadNumbers();
  }, [loadNumbers]);

  // Handle provider switch
  const handleProviderChange = async (newProvider) => {
    if (newProvider === 'twilio' && !config?.configured) {
      showToast('Twilio is not configured. Contact your administrator to set up Twilio credentials.', 'warning');
      return;
    }

    try {
      setSaving(true);
      await switchCallProvider(clientId, newProvider);
      setProvider(newProvider);
      showToast(`Switched to ${newProvider.toUpperCase()} provider`, 'success');
      loadConfig();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Handle number purchase
  const handlePurchaseNumber = async () => {
    if (!purchaseForm.forwardTo) {
      showToast('Forward-to number is required', 'error');
      return;
    }

    try {
      setSaving(true);
      await purchaseTrackingNumber(clientId, purchaseForm);
      showToast('Tracking number purchased successfully', 'success');
      setPurchaseOpen(false);
      setPurchaseForm({
        areaCode: '',
        friendlyName: '',
        forwardTo: '',
        sourceType: '',
        recordingEnabled: true,
        transcriptionEnabled: true
      });
      loadNumbers();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Handle number update
  const handleUpdateNumber = async () => {
    if (!editNumber) return;

    try {
      setSaving(true);
      await updateTrackingNumber(editNumber.id, {
        friendlyName: editNumber.friendly_name,
        forwardToNumber: editNumber.forward_to_number,
        sourceType: editNumber.source_type,
        recordingEnabled: editNumber.recording_enabled,
        transcriptionEnabled: editNumber.transcription_enabled
      });
      showToast('Tracking number updated', 'success');
      setEditOpen(false);
      setEditNumber(null);
      loadNumbers();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Handle number release - show confirmation dialog
  const handleReleaseClick = (number) => {
    setNumberToRelease(number);
    setReleaseConfirmOpen(true);
  };

  const handleReleaseConfirm = async () => {
    if (!numberToRelease) return;

    try {
      setSaving(true);
      await releaseTrackingNumber(numberToRelease.id);
      showToast('Number released successfully', 'success');
      setReleaseConfirmOpen(false);
      setNumberToRelease(null);
      loadNumbers();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Handle script generation
  const handleGenerateScript = async () => {
    try {
      const script = await getTrackingScript(clientId);
      setScriptCode(script);
      setScriptOpen(true);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Provider Selection */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Call Tracking Provider
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <SelectField value={provider} onChange={(e) => handleProviderChange(e.target.value)} disabled={saving} fullWidth={false} sx={{ minWidth: 200 }}>
              <MenuItem value="ctm">CallTrackingMetrics (CTM)</MenuItem>
              <MenuItem value="twilio" disabled={!config?.configured}>
                Twilio {!config?.configured && '(Not Configured)'}
              </MenuItem>
            </SelectField>
            {provider === 'twilio' && config?.configured && (
              <Chip
                label={`Account ...${config.accountSidLast4}`}
                color="success"
                size="small"
                variant="outlined"
              />
            )}
          </Stack>
          {!config?.configured && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Twilio is not configured. Contact your administrator to set up the Twilio integration.
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Twilio Tracking Numbers */}
      {provider === 'twilio' && config?.configured && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">Tracking Numbers</Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  onClick={handleGenerateScript}
                >
                  Get Tracking Script
                </Button>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setPurchaseOpen(true)}
                >
                  Purchase Number
                </Button>
              </Stack>
            </Stack>

            <DataTable
              columns={numberColumns}
              rows={numbers}
              loading={numbersLoading}
              outlined
              emptyTitle="No tracking numbers configured."
              emptyMessage={'Click "Purchase Number" to add one.'}
            />
          </CardContent>
        </Card>
      )}

      {/* CTM Info */}
      {provider === 'ctm' && (
        <Alert severity="info">
          Call tracking is managed through CallTrackingMetrics (CTM). Configure CTM credentials in the client's profile settings.
        </Alert>
      )}

      {/* Purchase Number Dialog */}
      <FormDialog
        open={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        onSubmit={handlePurchaseNumber}
        title="Purchase Tracking Number"
        loading={saving}
        loadingLabel="Purchasing..."
        submitLabel="Purchase"
      >
        <TextField
          label="Area Code"
          value={purchaseForm.areaCode}
          onChange={(e) => setPurchaseForm({ ...purchaseForm, areaCode: e.target.value })}
          placeholder="212"
          helperText="US area code (optional)"
        />
        <TextField
          label="Friendly Name"
          value={purchaseForm.friendlyName}
          onChange={(e) => setPurchaseForm({ ...purchaseForm, friendlyName: e.target.value })}
          placeholder="Google Ads - Main"
          fullWidth
        />
        <TextField
          label="Forward To Number"
          value={purchaseForm.forwardTo}
          onChange={(e) => setPurchaseForm({ ...purchaseForm, forwardTo: e.target.value })}
          placeholder="+15551234567"
          fullWidth
          required
          helperText="Number to forward calls to (E.164 format)"
        />
        <SelectField label="Source Type" value={purchaseForm.sourceType} onChange={(e) => setPurchaseForm({ ...purchaseForm, sourceType: e.target.value })}>
          <MenuItem value="">None</MenuItem>
          {SOURCE_TYPES.map((type) => (
            <MenuItem key={type.value} value={type.value}>
              {type.label}
            </MenuItem>
          ))}
        </SelectField>
        <Stack direction="row" spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={purchaseForm.recordingEnabled}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, recordingEnabled: e.target.checked })}
              />
            }
            label="Record Calls"
          />
          <FormControlLabel
            control={
              <Switch
                checked={purchaseForm.transcriptionEnabled}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, transcriptionEnabled: e.target.checked })}
              />
            }
            label="Transcribe Calls"
          />
        </Stack>
      </FormDialog>

      {/* Edit Number Dialog */}
      <FormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={handleUpdateNumber}
        title="Edit Tracking Number"
        loading={saving}
        loadingLabel="Saving..."
      >
        {editNumber && (
          <>
            <Typography variant="body2" color="text.secondary">
              Phone: {editNumber.phone_number}
            </Typography>
            <TextField
              label="Friendly Name"
              value={editNumber.friendly_name || ''}
              onChange={(e) => setEditNumber({ ...editNumber, friendly_name: e.target.value })}
              fullWidth
            />
            <TextField
              label="Forward To Number"
              value={editNumber.forward_to_number || ''}
              onChange={(e) => setEditNumber({ ...editNumber, forward_to_number: e.target.value })}
              fullWidth
            />
            <SelectField label="Source Type" value={editNumber.source_type || ''} onChange={(e) => setEditNumber({ ...editNumber, source_type: e.target.value })}>
              <MenuItem value="">None</MenuItem>
              {SOURCE_TYPES.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </SelectField>
            <Stack direction="row" spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editNumber.recording_enabled}
                    onChange={(e) => setEditNumber({ ...editNumber, recording_enabled: e.target.checked })}
                  />
                }
                label="Record Calls"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={editNumber.transcription_enabled}
                    onChange={(e) => setEditNumber({ ...editNumber, transcription_enabled: e.target.checked })}
                  />
                }
                label="Transcribe Calls"
              />
            </Stack>
          </>
        )}
      </FormDialog>

      {/* Script Dialog */}
      <Dialog open={scriptOpen} onClose={() => setScriptOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Attribution Tracking Script</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add this script to the client's website to track attribution (Google Ads, Facebook, UTMs) for calls and form submissions.
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              bgcolor: 'grey.50',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {scriptCode}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScriptOpen(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<ContentCopyIcon />}
            onClick={() => copyToClipboard(scriptCode)}
          >
            Copy
          </Button>
        </DialogActions>
      </Dialog>

      {/* Release Confirmation Dialog */}
      <ConfirmDialog
        open={releaseConfirmOpen}
        onClose={() => { setReleaseConfirmOpen(false); setNumberToRelease(null); }}
        onConfirm={handleReleaseConfirm}
        title="Release Tracking Number"
        message={<Typography>Are you sure you want to release <strong>{numberToRelease?.phone_number}</strong>?</Typography>}
        secondaryText={<Typography variant="body2" color="error" sx={{ mt: 1 }}>This action cannot be undone. The number will be returned to Twilio and may be reassigned to another account.</Typography>}
        confirmLabel="Release Number"
        confirmColor="error"
        loading={saving}
        loadingLabel="Releasing..."
      />
    </Box>
  );
}

CallTrackingTab.propTypes = {
  clientId: PropTypes.string.isRequired
};
