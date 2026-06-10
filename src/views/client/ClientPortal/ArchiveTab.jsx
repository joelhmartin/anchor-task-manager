import { useCallback, useEffect, useState } from 'react';
import EmptyState from 'ui-component/extended/EmptyState';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArchiveIcon from '@mui/icons-material/Archive';
import PersonIcon from '@mui/icons-material/Person';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestoreIcon from '@mui/icons-material/Restore';
import { fetchActiveClients, restoreActiveClient } from 'api/services';
import { fetchJourneys, restoreJourney } from 'api/journeys';

const formatDateDisplay = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
};

export default function ArchiveTab({ triggerMessage }) {
  const [archivedJourneys, setArchivedJourneys] = useState([]);
  const [archivedClients, setArchivedClients] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [archiveConfirmDialog, setArchiveConfirmDialog] = useState({ open: false, type: null, item: null });

  const loadArchiveData = useCallback(async () => {
    setArchiveLoading(true);
    try {
      const [archivedJourneyList, archivedClientList] = await Promise.all([
        fetchJourneys({ archived: true }),
        fetchActiveClients('archived')
      ]);
      setArchivedJourneys(Array.isArray(archivedJourneyList) ? archivedJourneyList : []);
      setArchivedClients(Array.isArray(archivedClientList) ? archivedClientList : []);
      setArchiveLoaded(true);
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to load archive');
    } finally {
      setArchiveLoading(false);
    }
  }, [triggerMessage]);

  // Load on first render
  useEffect(() => {
    if (!archiveLoaded && !archiveLoading) loadArchiveData();
  }, [archiveLoaded, archiveLoading, loadArchiveData]);

  const handleRestoreJourney = useCallback(
    async (journey) => {
      if (!journey?.id) return;
      try {
        await restoreJourney(journey.id);
        triggerMessage('success', 'Journey restored');
        await loadArchiveData();
      } catch (err) {
        triggerMessage('error', err.message || 'Unable to restore journey');
      }
    },
    [loadArchiveData, triggerMessage]
  );

  const handleRestoreClient = useCallback(
    async (client) => {
      if (!client?.id) return;
      const label = client.client_name || client.client_email || client.client_phone || 'this client';
      try {
        await restoreActiveClient(client.id);
        triggerMessage('success', `${label} restored`);
        await loadArchiveData();
      } catch (err) {
        triggerMessage('error', err.message || 'Unable to restore client');
      }
    },
    [loadArchiveData, triggerMessage]
  );

  return (
    <>
      <Stack spacing={3}>
        {archiveLoading && <LinearProgress />}

        {/* Archived Journeys Section */}
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1} alignItems="center">
                  <ArchiveIcon color="action" />
                  <Typography variant="h6">Archived Journeys</Typography>
                  <Chip label={archivedJourneys.length} size="small" color="default" />
                </Stack>
                <Tooltip title="Refresh archive data">
                  <IconButton size="small" onClick={loadArchiveData} disabled={archiveLoading}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {archivedJourneys.length === 0 ? (
                <EmptyState
                  icon={<ArchiveIcon />}
                  title="No archived journeys."
                  message="Archived journeys will appear here."
                  sx={{ bgcolor: 'action.hover', borderRadius: 2 }}
                />
              ) : (
                <Stack spacing={1.5}>
                  {archivedJourneys.map((journey) => (
                    <Card
                      key={journey.id}
                      variant="outlined"
                      sx={{
                        bgcolor: 'grey.50',
                        transition: 'all 0.2s',
                        '&:hover': { bgcolor: 'background.paper', boxShadow: 1 }
                      }}
                    >
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1.5}
                          justifyContent="space-between"
                          alignItems={{ xs: 'flex-start', sm: 'center' }}
                        >
                          <Box sx={{ flex: 1 }}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="subtitle1" fontWeight={600}>
                                {journey.client_name || journey.client_phone || journey.client_email || 'Unnamed Lead'}
                              </Typography>
                              {journey.status && (
                                <Chip
                                  label={journey.status.replace(/_/g, ' ')}
                                  size="small"
                                  variant="outlined"
                                  sx={{ textTransform: 'capitalize', fontSize: '0.7rem' }}
                                />
                              )}
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              Archived {journey.archived_at ? formatDateDisplay(journey.archived_at) : 'unknown'}
                            </Typography>
                            {journey.symptoms?.length > 0 && (
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                                {journey.symptoms.slice(0, 3).map((concern) => (
                                  <Chip
                                    key={`${journey.id}-archived-${concern}`}
                                    label={concern}
                                    size="small"
                                    sx={{ fontSize: '0.7rem', height: 20 }}
                                  />
                                ))}
                                {journey.symptoms.length > 3 && (
                                  <Chip
                                    label={`+${journey.symptoms.length - 3}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: '0.7rem', height: 20 }}
                                  />
                                )}
                              </Stack>
                            )}
                          </Box>
                          <Tooltip title="Restore this journey">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<RestoreIcon />}
                              onClick={() => handleRestoreJourney(journey)}
                              sx={{ minWidth: 100 }}
                            >
                              Restore
                            </Button>
                          </Tooltip>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Archived Active Clients Section */}
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <PersonIcon color="action" />
                <Typography variant="h6">Archived Clients</Typography>
                <Chip label={archivedClients.length} size="small" color="default" />
              </Stack>
              {archivedClients.length === 0 ? (
                <EmptyState
                  icon={<PersonIcon />}
                  title="No archived clients."
                  message="Archived clients will appear here."
                  sx={{ bgcolor: 'action.hover', borderRadius: 2 }}
                />
              ) : (
                <Stack spacing={1.5}>
                  {archivedClients.map((client) => (
                    <Card
                      key={client.id}
                      variant="outlined"
                      sx={{
                        bgcolor: 'grey.50',
                        transition: 'all 0.2s',
                        '&:hover': { bgcolor: 'background.paper', boxShadow: 1 }
                      }}
                    >
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1.5}
                          justifyContent="space-between"
                          alignItems={{ xs: 'flex-start', sm: 'center' }}
                        >
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle1" fontWeight={600}>
                              {client.client_name || 'Unknown Client'}
                            </Typography>
                            <Stack direction="row" spacing={2} alignItems="center">
                              <Typography variant="caption" color="text.secondary">
                                Archived {client.archived_at ? formatDateDisplay(client.archived_at) : 'unknown'}
                              </Typography>
                              {client.client_phone && (
                                <Typography variant="caption" color="text.secondary">
                                  {client.client_phone}
                                </Typography>
                              )}
                              {client.client_email && (
                                <Typography variant="caption" color="text.secondary">
                                  {client.client_email}
                                </Typography>
                              )}
                            </Stack>
                            {client.services?.length > 0 && (
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                                {client.services
                                  .filter((s) => !s.redacted_at)
                                  .slice(0, 4)
                                  .map((service) => (
                                    <Chip
                                      key={`${client.id}-${service.id}`}
                                      label={service.service_name}
                                      size="small"
                                      color="primary"
                                      variant="outlined"
                                      sx={{ fontSize: '0.7rem', height: 20 }}
                                    />
                                  ))}
                                {client.services.filter((s) => !s.redacted_at).length > 4 && (
                                  <Chip
                                    label={`+${client.services.filter((s) => !s.redacted_at).length - 4}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: '0.7rem', height: 20 }}
                                  />
                                )}
                              </Stack>
                            )}
                          </Box>
                          <Tooltip title="Restore this client">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<RestoreIcon />}
                              onClick={() => handleRestoreClient(client)}
                              sx={{ minWidth: 100 }}
                            >
                              Restore
                            </Button>
                          </Tooltip>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      {/* Archive Confirmation Dialog */}
      <Dialog
        open={archiveConfirmDialog.open}
        onClose={() => setArchiveConfirmDialog({ open: false, type: null, item: null })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{archiveConfirmDialog.type === 'journey' ? 'Archive Journey?' : 'Archive Client?'}</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            Are you sure you want to archive{' '}
            <strong>
              {archiveConfirmDialog.item?.client_name ||
                archiveConfirmDialog.item?.client_phone ||
                archiveConfirmDialog.item?.client_email ||
                (archiveConfirmDialog.type === 'journey' ? 'this journey' : 'this client')}
            </strong>
            ?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            You can restore archived items from the Archive tab at any time.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveConfirmDialog({ open: false, type: null, item: null })}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => {
            setArchiveConfirmDialog({ open: false, type: null, item: null });
          }}>
            Archive
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
