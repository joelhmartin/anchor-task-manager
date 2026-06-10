import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Autocomplete,
  Box,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LaunchIcon from '@mui/icons-material/Launch';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import {
  fetchClientSites,
  fetchOperationsSites,
  linkSiteToClient,
  unlinkSiteClient
} from 'api/operations';

const RELATIONSHIPS = [
  { value: 'primary', label: 'Primary' },
  { value: 'staging', label: 'Staging' },
  { value: 'microsite', label: 'Microsite' }
];

export default function ClientSitesTab({ clientId }) {
  const { toast } = useToast();
  const [linked, setLinked] = useState([]);
  const [allSites, setAllSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(null);
  const [relationship, setRelationship] = useState('primary');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [linkedRes, allRes] = await Promise.all([
        fetchClientSites(clientId),
        fetchOperationsSites()
      ]);
      setLinked(linkedRes);
      setAllSites(allRes);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to load sites', 'error');
    } finally {
      setLoading(false);
    }
  }, [clientId, toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  const linkedSiteIds = useMemo(() => new Set(linked.map((l) => l.site_id)), [linked]);
  const available = allSites.filter((s) => !linkedSiteIds.has(s.id));

  async function handleLink() {
    if (!picked) return;
    setSubmitting(true);
    try {
      const link = await linkSiteToClient(picked.id, { client_user_id: clientId, relationship });
      const newRow = {
        link_id: link.id,
        site_id: picked.id,
        site_name: picked.site_name,
        display_name: picked.display_name,
        primary_domain: picked.primary_domain,
        relationship: link.relationship || relationship,
        notes: link.notes || null,
        linked_at: link.created_at || new Date().toISOString()
      };
      setLinked((prev) => {
        const without = prev.filter((l) => l.link_id !== newRow.link_id);
        return [...without, newRow].sort((a, b) =>
          (a.site_name || '').localeCompare(b.site_name || '')
        );
      });
      toast('Site linked', 'success');
      setPicked(null);
    } catch (err) {
      toast(err.response?.data?.message || 'Link failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlink(siteId, linkId) {
    const prev = linked;
    setLinked((rows) => rows.filter((l) => l.link_id !== linkId));
    try {
      await unlinkSiteClient(siteId, linkId);
      toast('Site unlinked', 'success');
    } catch (err) {
      setLinked(prev);
      toast(err.response?.data?.message || 'Unlink failed', 'error');
    }
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Connected Kinsta Sites
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
        <Autocomplete
          sx={{ minWidth: 360 }}
          size="small"
          options={available}
          getOptionLabel={(s) => s.display_name || s.site_name || ''}
          value={picked}
          onChange={(_, v) => setPicked(v)}
          renderOption={(props, option) => {
            const { key, ...rest } = props;
            return (
              <li key={key} {...rest}>
                <Stack>
                  <Typography variant="body2">{option.display_name || option.site_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.primary_domain || option.kinsta_site_id}
                  </Typography>
                </Stack>
              </li>
            );
          }}
          renderInput={(params) => <TextField {...params} label="Link a Kinsta site" />}
        />
        <SelectField
          label="Relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          options={RELATIONSHIPS}
          size="small"
          fullWidth={false}
          sx={{ minWidth: 160 }}
        />
        <LoadingButton
          variant="contained"
          onClick={handleLink}
          loading={submitting}
          disabled={!picked}
          loadingLabel="Linking…"
        >
          Link
        </LoadingButton>
      </Stack>

      {!loading && linked.length === 0 && (
        <EmptyState
          title="No sites linked yet."
          message="Use the form above to associate this client with one or more Kinsta sites."
        />
      )}

      <Stack spacing={1.5}>
        {linked.map((l) => (
          <Stack
            key={l.link_id}
            direction="row"
            spacing={2}
            alignItems="center"
            sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
          >
            <Stack sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {l.display_name || l.site_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {l.primary_domain || '—'}
              </Typography>
            </Stack>
            <Chip size="small" label={l.relationship} />
            <IconButton
              size="small"
              component={RouterLink}
              to={`/operations?tab=sites&site=${l.site_id}`}
              title="Open in Operations"
            >
              <LaunchIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => handleUnlink(l.site_id, l.link_id)} title="Unlink">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
