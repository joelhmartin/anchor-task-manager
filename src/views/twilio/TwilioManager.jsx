/**
 * Twilio Manager Dashboard
 *
 * Admin-only dashboard for managing Twilio call tracking:
 * - Overview: Status and quick stats
 * - Numbers: Purchase, edit, release tracking numbers across all clients
 * - Clients: Per-client provider settings and number assignments
 * - Scripts: Generate tracking/attribution scripts for client websites
 * - Settings: Global Twilio configuration status
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PhoneIcon from '@mui/icons-material/Phone';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import FormDialog from 'ui-component/extended/FormDialog';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import MainCard from 'ui-component/cards/MainCard';
import useAuth from 'hooks/useAuth';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { fetchClients } from 'api/clients';
import { clientLabel } from 'hooks/useClientLabel';
import {
  getTwilioConfig,
  switchCallProvider,
  listTrackingNumbers,
  purchaseTrackingNumber,
  updateTrackingNumber,
  releaseTrackingNumber,
  getTrackingScript,
  reconfigureWebhooks
} from 'api/twilio';

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

const VALID_PANES = ['overview', 'numbers', 'clients', 'scripts', 'settings'];

// ============================================================================
// Overview Pane
// ============================================================================
function OverviewPane({ config, numbers, clients }) {
  const twilioClients = clients.filter((c) => c.call_provider === 'twilio');
  const activeNumbers = numbers.filter((n) => n.is_active);

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Twilio Call Tracking Overview</Typography>

      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
        <Card sx={{ minWidth: 200, flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">Connection Status</Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              {config?.configured ? (
                <>
                  <CheckCircleIcon color="success" />
                  <Typography variant="h6">Connected</Typography>
                </>
              ) : (
                <>
                  <ErrorIcon color="error" />
                  <Typography variant="h6">Not Configured</Typography>
                </>
              )}
            </Stack>
            {config?.configured && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Account ...{config.accountSidLast4}
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card sx={{ minWidth: 200, flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">Active Numbers</Typography>
            <Typography variant="h4" sx={{ mt: 1 }}>{activeNumbers.length}</Typography>
            <Typography variant="body2" color="text.secondary">
              {numbers.length} total
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ minWidth: 200, flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">Twilio Clients</Typography>
            <Typography variant="h4" sx={{ mt: 1 }}>{twilioClients.length}</Typography>
            <Typography variant="body2" color="text.secondary">
              of {clients.length} total clients
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {!config?.configured && (
        <Alert severity="warning">
          Twilio is not configured. Set <code>TWILIO_ACCOUNT_SID</code> and <code>TWILIO_AUTH_TOKEN</code> environment variables on the server.
        </Alert>
      )}
    </Stack>
  );
}

// ============================================================================
// Numbers Pane
// ============================================================================
function NumbersPane({ config, numbers, clients, onRefresh }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [scriptDialog, setScriptDialog] = useState({ open: false, script: '' });

  // Purchase dialog
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseClientId, setPurchaseClientId] = useState('');
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

  // Release confirmation dialog
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const [numberToRelease, setNumberToRelease] = useState(null);

  const handlePurchase = async () => {
    if (!purchaseClientId) {
      showToast('Select a client first', 'error');
      return;
    }
    if (!purchaseForm.forwardTo) {
      showToast('Forward-to number is required', 'error');
      return;
    }
    try {
      setSaving(true);
      const result = await purchaseTrackingNumber(purchaseClientId, purchaseForm);
      showToast('Tracking number purchased', 'success');
      setPurchaseOpen(false);
      setPurchaseForm({ areaCode: '', friendlyName: '', forwardTo: '', sourceType: '', recordingEnabled: true, transcriptionEnabled: true });
      setPurchaseClientId('');
      onRefresh();

      // If first number for this client, show tracking script
      if (result.trackingScript) {
        setScriptDialog({ open: true, script: result.trackingScript });
      }
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
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
      showToast('Number updated', 'success');
      setEditOpen(false);
      setEditNumber(null);
      onRefresh();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReleaseClick = (number) => {
    setNumberToRelease(number);
    setReleaseConfirmOpen(true);
  };

  const handleReleaseConfirm = async () => {
    if (!numberToRelease) return;
    try {
      setSaving(true);
      await releaseTrackingNumber(numberToRelease.id);
      showToast('Number released', 'success');
      setReleaseConfirmOpen(false);
      setNumberToRelease(null);
      onRefresh();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Build a lookup for client names
  const clientMap = {};
  for (const c of clients) {
    clientMap[c.id] = clientLabel(c) || c.id;
  }

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
    {
      id: 'client', label: 'Client',
      render: (row) => (
        <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>
          {clientMap[row.client_user_id] || row.client_user_id}
        </Typography>
      )
    },
    { id: 'forward_to_number', label: 'Forward To' },
    {
      id: 'source_type', label: 'Source',
      render: (row) => row.source_type
        ? <Chip label={SOURCE_TYPES.find((s) => s.value === row.source_type)?.label || row.source_type} size="small" />
        : null
    },
    { id: 'recording_enabled', label: 'Recording', render: (row) => <StatusChip status={row.recording_enabled ? 'on' : 'off'} /> },
    { id: 'is_active', label: 'Status', render: (row) => <StatusChip status={row.is_active ? 'active' : 'inactive'} variant="outlined" /> },
    {
      id: 'actions', label: 'Actions', align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <IconButton size="small" onClick={() => { setEditNumber({ ...row }); setEditOpen(true); }}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" color="error" onClick={() => handleReleaseClick(row)} disabled={saving}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      )
    },
  ], [clientMap, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!config?.configured) {
    return <Alert severity="warning">Twilio is not configured. Set environment variables on the server first.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">Tracking Numbers</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setPurchaseOpen(true)}>
          Purchase Number
        </Button>
      </Stack>

      <DataTable
        columns={numberColumns}
        rows={numbers}
        outlined
        emptyTitle="No tracking numbers yet."
        emptyMessage="Purchase one to get started."
      />

      {/* Purchase Dialog */}
      <FormDialog
        open={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        onSubmit={handlePurchase}
        title="Purchase Tracking Number"
        loading={saving}
        loadingLabel="Purchasing..."
        submitLabel="Purchase"
      >
        <SelectField label="Client" value={purchaseClientId} onChange={(e) => setPurchaseClientId(e.target.value)} required>
          {clients.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {clientLabel(c)}
            </MenuItem>
          ))}
        </SelectField>
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
            <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>
          ))}
        </SelectField>
        <Stack direction="row" spacing={2}>
          <FormControlLabel
            control={<Switch checked={purchaseForm.recordingEnabled} onChange={(e) => setPurchaseForm({ ...purchaseForm, recordingEnabled: e.target.checked })} />}
            label="Record Calls"
          />
          <FormControlLabel
            control={<Switch checked={purchaseForm.transcriptionEnabled} onChange={(e) => setPurchaseForm({ ...purchaseForm, transcriptionEnabled: e.target.checked })} />}
            label="Transcribe Calls"
          />
        </Stack>
      </FormDialog>

      {/* Edit Dialog */}
      <FormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={handleUpdate}
        title="Edit Tracking Number"
        loading={saving}
        loadingLabel="Saving..."
      >
        {editNumber && (
          <>
            <Typography variant="body2" color="text.secondary">Phone: {editNumber.phone_number}</Typography>
            <Typography variant="body2" color="text.secondary">Client: {clientMap[editNumber.client_user_id] || editNumber.client_user_id}</Typography>
            <TextField label="Friendly Name" value={editNumber.friendly_name || ''} onChange={(e) => setEditNumber({ ...editNumber, friendly_name: e.target.value })} fullWidth />
            <TextField label="Forward To Number" value={editNumber.forward_to_number || ''} onChange={(e) => setEditNumber({ ...editNumber, forward_to_number: e.target.value })} fullWidth />
            <SelectField label="Source Type" value={editNumber.source_type || ''} onChange={(e) => setEditNumber({ ...editNumber, source_type: e.target.value })}>
              <MenuItem value="">None</MenuItem>
              {SOURCE_TYPES.map((type) => (
                <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>
              ))}
            </SelectField>
            <Stack direction="row" spacing={2}>
              <FormControlLabel
                control={<Switch checked={editNumber.recording_enabled} onChange={(e) => setEditNumber({ ...editNumber, recording_enabled: e.target.checked })} />}
                label="Record Calls"
              />
              <FormControlLabel
                control={<Switch checked={editNumber.transcription_enabled} onChange={(e) => setEditNumber({ ...editNumber, transcription_enabled: e.target.checked })} />}
                label="Transcribe Calls"
              />
            </Stack>
          </>
        )}
      </FormDialog>

      {/* Tracking Script Dialog — shown automatically on first number purchase */}
      <Dialog open={scriptDialog.open} onClose={() => setScriptDialog({ open: false, script: '' })} maxWidth="md" fullWidth>
        <DialogTitle>Tracking Script Ready</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            This is the first tracking number for this client. Install the script below on their website to capture call attribution (Google Ads, Facebook, UTMs, and more).
          </Alert>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {scriptDialog.script}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScriptDialog({ open: false, script: '' })}>Close</Button>
          <Button
            variant="contained"
            startIcon={<ContentCopyIcon />}
            onClick={() => {
              navigator.clipboard?.writeText(scriptDialog.script);
              showToast('Script copied to clipboard', 'success');
            }}
          >
            Copy Script
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
        secondaryText={
          <Typography variant="body2" color="error">
            This action cannot be undone. The number will be returned to Twilio and may be reassigned to another account.
          </Typography>
        }
        confirmLabel="Release Number"
        confirmColor="error"
        loading={saving}
        loadingLabel="Releasing..."
      />
    </Stack>
  );
}

// ============================================================================
// Clients Pane
// ============================================================================
function ClientsPane({ config, clients, onRefresh }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleSwitchProvider = async (clientId, newProvider) => {
    if (newProvider === 'twilio' && !config?.configured) {
      showToast('Twilio is not configured on the server', 'warning');
      return;
    }
    try {
      setSaving(true);
      await switchCallProvider(clientId, newProvider);
      showToast(`Switched to ${newProvider.toUpperCase()}`, 'success');
      onRefresh();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const clientColumns = useMemo(() => [
    {
      id: 'name', label: 'Client',
      render: (row) => clientLabel(row) || '-'
    },
    { id: 'email', label: 'Email' },
    {
      id: 'call_provider', label: 'Provider',
      render: (row) => {
        const p = row.call_provider || 'ctm';
        return <Chip label={p.toUpperCase()} color={p === 'twilio' ? 'primary' : 'default'} size="small" />;
      }
    },
    {
      id: 'actions', label: 'Actions', align: 'right',
      render: (row) => {
        const p = row.call_provider || 'ctm';
        return (
          <SelectField value={p} onChange={(e) => handleSwitchProvider(row.id, e.target.value)} disabled={saving} size="small" fullWidth={false} sx={{ minWidth: 120 }}>
            <MenuItem value="ctm">CTM</MenuItem>
            <MenuItem value="twilio" disabled={!config?.configured}>Twilio</MenuItem>
          </SelectField>
        );
      }
    },
  ], [saving, config?.configured]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Client Call Providers</Typography>
      <Typography variant="body2" color="text.secondary">
        Manage which call tracking provider each client uses. Switching to Twilio requires the global Twilio integration to be configured.
      </Typography>

      <DataTable
        columns={clientColumns}
        rows={clients}
        outlined
        emptyTitle="No clients found."
      />
    </Stack>
  );
}

// ============================================================================
// Scripts Pane
// ============================================================================
function ScriptsPane({ config, clients }) {
  const { showToast } = useToast();
  const [selectedClient, setSelectedClient] = useState('');
  const [scriptCode, setScriptCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!selectedClient) {
      showToast('Select a client first', 'error');
      return;
    }
    try {
      setLoading(true);
      const script = await getTrackingScript(selectedClient);
      setScriptCode(script);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  };

  if (!config?.configured) {
    return <Alert severity="warning">Twilio is not configured. Set environment variables on the server first.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Attribution Tracking Scripts</Typography>
      <Typography variant="body2" color="text.secondary">
        Generate tracking scripts that capture attribution data (Google Ads GCLID, Facebook Pixel, UTMs) for calls and form submissions on client websites.
      </Typography>

      <Stack direction="row" spacing={2} alignItems="flex-end">
        <SelectField label="Select Client" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)} fullWidth={false} sx={{ minWidth: 300 }}>
          {clients.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {clientLabel(c)}
            </MenuItem>
          ))}
        </SelectField>
        <LoadingButton variant="contained" onClick={handleGenerate} loading={loading} disabled={!selectedClient} loadingLabel="Generating...">
          Generate Script
        </LoadingButton>
      </Stack>

      {scriptCode && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Tracking Script</Typography>
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copyToClipboard(scriptCode)}>
                Copy
              </Button>
            </Stack>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: 'grey.50',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 400,
                overflow: 'auto'
              }}
            >
              {scriptCode}
            </Paper>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Add this script tag to the client's website, just before the closing <code>&lt;/body&gt;</code> tag.
            </Typography>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

// ============================================================================
// Settings Pane
// ============================================================================
function SettingsPane({ config, showToast }) {
  const [reconfiguring, setReconfiguring] = useState(false);

  const handleReconfigure = async () => {
    setReconfiguring(true);
    try {
      const result = await reconfigureWebhooks();
      if (result.failed > 0) {
        showToast(`Updated ${result.updated} numbers, ${result.failed} failed`, 'warning');
      } else {
        showToast(`All ${result.updated} numbers configured successfully`, 'success');
      }
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setReconfiguring(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Twilio Configuration</Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="subtitle1">Connection Status:</Typography>
              {config?.configured ? (
                <StatusChip status="connected" icon={<CheckCircleIcon />} />
              ) : (
                <StatusChip status="disconnected" label="Not Configured" icon={<ErrorIcon />} />
              )}
            </Stack>

            {config?.configured && (
              <Stack spacing={1}>
                <Typography variant="body2">
                  <strong>Account SID:</strong> ...{config.accountSidLast4}
                </Typography>
                <Typography variant="body2">
                  <strong>Active Numbers:</strong> {config.numberCount ?? 0}
                </Typography>
              </Stack>
            )}

            {!config?.configured && (
              <Alert severity="info">
                To connect Twilio, set the following environment variables on the server:
                <Box component="ul" sx={{ mt: 1, mb: 0 }}>
                  <li><code>TWILIO_ACCOUNT_SID</code> - Your Twilio Account SID</li>
                  <li><code>TWILIO_AUTH_TOKEN</code> - Your Twilio Auth Token</li>
                </Box>
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="subtitle1">Webhook Configuration</Typography>
            <Typography variant="body2" color="text.secondary">
              Webhooks are automatically configured on each number when purchased in production.
              Use the button below to reconfigure all numbers at once (e.g. after deployment or URL change).
            </Typography>
            <Stack spacing={1}>
              <Typography variant="body2"><strong>Voice:</strong> <code>/api/twilio/voice</code></Typography>
              <Typography variant="body2"><strong>Status Callback:</strong> <code>/api/twilio/status</code></Typography>
              <Typography variant="body2"><strong>Recording:</strong> <code>/api/twilio/recording</code></Typography>
              <Typography variant="body2"><strong>Transcription:</strong> <code>/api/twilio/transcription</code></Typography>
            </Stack>
            <Box>
              <LoadingButton
                variant="contained"
                onClick={handleReconfigure}
                disabled={!config?.configured}
                loading={reconfiguring}
                loadingLabel="Reconfiguring..."
              >
                Reconfigure All Numbers
              </LoadingButton>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

// ============================================================================
// Main TwilioManager Component
// ============================================================================
export default function TwilioManager() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const rawPane = searchParams.get('pane') || 'overview';
  const pane = VALID_PANES.includes(rawPane) ? rawPane : 'overview';

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [numbers, setNumbers] = useState([]);
  const [clients, setClients] = useState([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [configData, clientsData] = await Promise.all([
        getTwilioConfig().catch(() => null),
        fetchClients().catch(() => [])
      ]);
      setConfig(configData);
      setClients(Array.isArray(clientsData) ? clientsData : clientsData?.clients || []);

      // Load numbers if Twilio is configured
      if (configData?.configured) {
        const nums = await listTrackingNumbers(null, { includeInactive: true }).catch(() => []);
        setNumbers(nums);
      }
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <MainCard title="Twilio Manager">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );
  }

  const renderContent = () => {
    switch (pane) {
      case 'numbers':
        return <NumbersPane config={config} numbers={numbers} clients={clients} onRefresh={loadData} />;
      case 'clients':
        return <ClientsPane config={config} clients={clients} onRefresh={loadData} />;
      case 'scripts':
        return <ScriptsPane config={config} clients={clients} />;
      case 'settings':
        return <SettingsPane config={config} showToast={showToast} />;
      default:
        return <OverviewPane config={config} numbers={numbers} clients={clients} />;
    }
  };

  return (
    <MainCard title="Twilio Manager">
      {renderContent()}
    </MainCard>
  );
}
