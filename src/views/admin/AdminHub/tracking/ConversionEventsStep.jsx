import { useState, useEffect, useCallback } from 'react';
import {
  Box, Stack, Typography, MenuItem, Select, IconButton, Tooltip,
  Alert, Divider, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import LoadingButton from 'ui-component/extended/LoadingButton';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { getConversionActions, saveConversionMappings } from 'api/tracking';

// Our internal relay events — things that happen inside Anchor
const RELAY_EVENTS = [
  {
    key: 'lead_submitted',
    label: 'Form Submitted',
    description: 'When a form is submitted through Anchor forms',
    suggestMatch: /lead|form|submit/i,
  },
  {
    key: 'qualified_call',
    label: 'AI Qualified Call',
    description: 'When the AI classifies a call as a qualified lead',
    suggestMatch: /ai.qual|verified|anchor.qual/i,
  },
  {
    key: 'new_client',
    label: 'New Client Signed',
    description: 'When a lead is converted to an active client in the dashboard',
    suggestMatch: /new.client|signed|patient|convert/i,
  },
  {
    key: 'appointment_request',
    label: 'Appointment Request',
    description: 'When an appointment form is submitted',
    suggestMatch: /appoint|book|schedule/i,
  },
];

// Google Ads conversion types that are browser-side / auto-tracked
const BROWSER_SIDE_TYPES = new Set([
  'CALL_FROM_ADS', 'CLICK_TO_CALL', 'GOOGLE_PLAY_DOWNLOAD',
  'GOOGLE_PLAY_IN_APP_PURCHASE', 'STORE_VISIT', 'STORE_SALE',
]);

const BROWSER_SIDE_NAME_PATTERNS = /^(calls? from ads|clicks? to call|local actions?|store visit)/i;

function isBrowserSide(action) {
  if (BROWSER_SIDE_TYPES.has(action.type)) return true;
  if (BROWSER_SIDE_NAME_PATTERNS.test(action.name)) return true;
  // Type numbers: 2 = CALL_FROM_ADS, 9 = WEBPAGE (click-to-call), 28 = local actions
  if ([2, 9, 28].includes(Number(action.type))) return true;
  return false;
}

function suggestAction(actions, pattern) {
  return actions.find((a) => pattern.test(a.name));
}

export default function ConversionEventsStep({ config, saveConfig, onNext, onBack, onReload }) {
  const { showToast } = useToast();
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // State: { lead_submitted: "action_id" | "", qualified_call: "action_id" | "", ... }
  const [relayMappings, setRelayMappings] = useState({});

  const customerId = config?.google_ads_customer_id;

  const loadActions = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const data = await getConversionActions(customerId);
      setActions(data);

      // Initialize from saved config (check aliases for backward compat)
      const saved = config?.conversion_mappings || {};
      const initial = {};
      RELAY_EVENTS.forEach((event) => {
        // Check the canonical key and known aliases (form_submitted ↔ lead_submitted)
        const aliases = event.key === 'lead_submitted'
          ? ['lead_submitted', 'form_submitted']
          : [event.key];
        const existing = aliases.map((k) => saved[k]).find((m) => m?.conversion_action_id);
        if (existing?.conversion_action_id) {
          initial[event.key] = String(existing.conversion_action_id);
        } else {
          // Auto-suggest based on name pattern (only for relay-appropriate actions)
          const relayActions = data.filter((a) => !isBrowserSide(a));
          const match = suggestAction(relayActions, event.suggestMatch);
          initial[event.key] = match ? String(match.id) : '';
        }
      });
      setRelayMappings(initial);
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load conversion actions'), 'error');
    } finally {
      setLoading(false);
    }
  }, [customerId, config?.conversion_mappings, showToast]);

  useEffect(() => { loadActions(); }, [loadActions]);

  const handleMappingChange = (eventKey, actionId) => {
    setRelayMappings((prev) => ({ ...prev, [eventKey]: actionId }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Build mappings: { event_key: { conversion_action_id, name } }
      const mappings = {};
      RELAY_EVENTS.forEach((event) => {
        const actionId = relayMappings[event.key];
        if (!actionId) return;
        const action = actions.find((a) => String(a.id) === actionId);
        mappings[event.key] = {
          conversion_action_id: actionId,
          name: action?.name || '',
          conversionId: action?.conversionId || '',
          conversionLabel: action?.conversionLabel || '',
        };
      });

      // Check for duplicates (two relay events pointing to the same Google Ads action)
      const usedActionIds = Object.values(mappings).map((m) => m.conversion_action_id);
      const duplicates = usedActionIds.filter((id, i) => usedActionIds.indexOf(id) !== i);
      if (duplicates.length > 0) {
        const dupName = actions.find((a) => String(a.id) === duplicates[0])?.name || duplicates[0];
        showToast(`"${dupName}" is mapped to multiple relay events. Each Google Ads action can only be used once.`, 'error');
        setSaving(false);
        return;
      }

      await saveConversionMappings(config.id, mappings);
      await onReload(); // update wizard's in-memory config so revisiting shows saved state
      showToast('Relay mappings saved', 'success');
      onNext();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save mappings'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!customerId) {
    return (
      <Stack spacing={3}>
        <EmptyState
          title="No Google Ads account linked"
          message="Select a Google Ads account under Client Details to configure conversion events here."
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <LoadingButton variant="outlined" onClick={onBack}>Back</LoadingButton>
          <LoadingButton variant="contained" onClick={onNext}>Skip</LoadingButton>
        </Box>
      </Stack>
    );
  }

  const browserActions = actions.filter(isBrowserSide);
  const relayEligibleActions = actions.filter((a) => !isBrowserSide(a));

  return (
    <Stack spacing={3}>
      {/* Header + Refresh */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" gutterBottom>Conversion Events</Typography>
          <Typography variant="body2" color="text.secondary">
            Configure which Google Ads conversion actions the server-side relay fires.
          </Typography>
        </Box>
        <Tooltip title="Refresh conversion actions from Google Ads">
          <span>
            <IconButton size="small" onClick={loadActions} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Section A: Browser-side (read-only) */}
      {browserActions.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Browser-Side Tracking
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              (handled by Google Ads automatically — no configuration needed)
            </Typography>
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {browserActions.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                size="small"
                variant="outlined"
                color="default"
              />
            ))}
          </Box>
        </Box>
      )}

      {browserActions.length > 0 && relayEligibleActions.length > 0 && <Divider />}

      {/* Section B: Server-side relay mappings */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Server-Side Relay
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            (Anchor sends conversion data to Google Ads when these events occur)
          </Typography>
        </Typography>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Each relay event fires a Google Ads offline conversion. Pick which conversion action
          should be credited — or leave blank to skip that event. These are higher-quality signals
          than browser-side tracking because they&apos;re verified by your system.
        </Alert>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Anchor Event</strong></TableCell>
                <TableCell><strong>Description</strong></TableCell>
                <TableCell sx={{ minWidth: 220 }}><strong>Google Ads Action</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {RELAY_EVENTS.map((event) => (
                <TableRow key={event.key}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{event.label}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">{event.description}</Typography>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={relayMappings[event.key] || ''}
                      onChange={(e) => handleMappingChange(event.key, e.target.value)}
                      size="small"
                      fullWidth
                      displayEmpty
                    >
                      <MenuItem value="">
                        <em>None — don&apos;t fire</em>
                      </MenuItem>
                      {relayEligibleActions.map((a) => (
                        <MenuItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </MenuItem>
                      ))}
                      <Divider />
                      {browserActions.map((a) => (
                        <MenuItem key={a.id} value={String(a.id)} sx={{ color: 'text.secondary' }}>
                          {a.name} (browser-side)
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {relayEligibleActions.length === 0 && !loading && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            No relay-specific conversion actions found. Consider creating dedicated actions in Google Ads
            (e.g., &quot;AI Qualified Lead&quot;, &quot;New Patient Signed&quot;) for more precise optimization.
          </Alert>
        )}
      </Box>

      {/* Navigation */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <LoadingButton variant="outlined" onClick={onBack}>Back</LoadingButton>
        <LoadingButton
          variant="contained"
          loading={saving}
          loadingLabel="Saving…"
          onClick={handleSave}
          disabled={loading}
        >
          Save & Next
        </LoadingButton>
      </Box>
    </Stack>
  );
}
