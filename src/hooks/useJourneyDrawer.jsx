import { useCallback, useEffect, useRef, useState } from 'react';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import ArchiveIcon from '@mui/icons-material/Archive';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EmailIcon from '@mui/icons-material/Email';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import PhoneIcon from '@mui/icons-material/Phone';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SmsIcon from '@mui/icons-material/Sms';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import {
  ACTIVITY_ICON_LABEL,
  STAGE_COLORS,
  formatDateDisplay,
  nextStage,
  stageLabel
} from 'views/client/ClientPortal/leads/journeyHelpers';
import SendEmailDialog from 'views/client/ClientPortal/leads/SendEmailDialog';
import {
  addJourneyNote,
  archiveJourney,
  cancelScheduledSend,
  convertJourney,
  moveJourneyStage,
  sendJourneyEmail,
  sendJourneyText
} from 'api/journeys';
import {
  attachContactService,
  removeContactService,
  fetchContactNotes,
  addContactNote,
  deleteContactNote
} from 'api/contacts';
import { fetchServices } from 'api/services';

const TERMINAL_STATUSES = new Set(['converted', 'active_client', 'archived']);

export default function useJourneyDrawer({
  triggerMessage,
  upsertJourney,
  onArchiveJourney,
  onConvert,
  onOpenLeadDetail,
  onManageTemplates,
  tutorialMode = false
}) {
  const [journeyDrawer, setJourneyDrawer] = useState({ open: false, journey: null });
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  // Contact-level notes shown in the Notes tab (lead_notes keyed by contact_id).
  // The Activity tab still renders the journey's stage/email event log.
  const [contactNotes, setContactNotes] = useState([]);
  // Tracks which contact the Notes tab is currently showing, so an async note load/add/delete
  // that resolves after the drawer has switched contacts can't apply its result to the new one.
  const activeNotesContactRef = useRef(null);
  const [markCompleteSaving, setMarkCompleteSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState({ open: false, journey: null });
  const [timelineTab, setTimelineTab] = useState('notes');
  // Services catalog for the add-service picker (services live on the contact).
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceInput, setServiceInput] = useState('');

  useEffect(() => {
    let active = true;
    fetchServices()
      .then((list) => {
        if (active) setServiceCatalog(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const openDrawer = useCallback((journey) => {
    if (!journey) return;
    setJourneyDrawer({ open: true, journey });
    setNoteDraft('');
  }, []);

  // Load the contact's notes whenever the drawer opens on a contact-backed journey.
  const contactIdForNotes = journeyDrawer.open ? journeyDrawer.journey?.contact_id || null : null;
  useEffect(() => {
    activeNotesContactRef.current = contactIdForNotes;
    if (!contactIdForNotes) {
      setContactNotes([]);
      return undefined;
    }
    let active = true;
    fetchContactNotes(contactIdForNotes)
      .then((notes) => {
        // Ignore a stale response if the drawer moved to another contact mid-flight.
        if (active && activeNotesContactRef.current === contactIdForNotes) setContactNotes(Array.isArray(notes) ? notes : []);
      })
      .catch(() => {
        if (active && activeNotesContactRef.current === contactIdForNotes) setContactNotes([]);
      });
    return () => {
      active = false;
    };
  }, [contactIdForNotes]);

  const closeDrawer = useCallback(() => {
    setJourneyDrawer({ open: false, journey: null });
    setEmailDialogOpen(false);
    setNoteDraft('');
  }, []);

  // Merge an updated journey into the shared list + the open drawer immediately.
  const applyUpdate = useCallback(
    (updated) => {
      if (!updated) return;
      upsertJourney?.(updated);
      setJourneyDrawer((prev) => (prev.open && prev.journey?.id === updated.id ? { ...prev, journey: updated } : prev));
    },
    [upsertJourney]
  );

  const handleSendEmail = useCallback(
    async (payload) => {
      const journey = journeyDrawer.journey;
      if (!journey) return;
      if (payload.channel === 'both') {
        await sendJourneyText(journey.id, payload).catch(() => {});
      }
      const updated = await sendJourneyEmail(journey.id, payload);
      applyUpdate(updated);
      triggerMessage('success', payload.scheduled_for ? 'Email scheduled.' : 'Email sent.');
    },
    [journeyDrawer.journey, applyUpdate, triggerMessage]
  );

  const handleMarkComplete = useCallback(async () => {
    const journey = journeyDrawer.journey;
    if (!journey) return;
    const target = nextStage(journey.stage);
    if (!target) return;
    setMarkCompleteSaving(true);
    try {
      const updated = await moveJourneyStage(journey.id, target);
      applyUpdate(updated);
      triggerMessage('success', `Marked complete — moved to ${stageLabel(target)}.`);
    } catch (err) {
      triggerMessage('error', err?.response?.data?.message || 'Could not advance the journey.');
    } finally {
      setMarkCompleteSaving(false);
    }
  }, [journeyDrawer.journey, applyUpdate, triggerMessage]);

  const handleAddNote = useCallback(async () => {
    const journey = journeyDrawer.journey;
    const body = noteDraft.trim();
    if (!journey || !body) return;
    setNoteSaving(true);
    try {
      if (journey.contact_id) {
        // Contact-scoped note — append the returned row to local state immediately.
        const noteContactId = journey.contact_id;
        const res = await addContactNote(noteContactId, body);
        const note = res?.note || res;
        // Only apply if the drawer still shows the same contact (guards against a switch mid-save).
        if (note?.id && activeNotesContactRef.current === noteContactId) setContactNotes((prev) => [note, ...prev]);
        setNoteDraft('');
        triggerMessage('success', 'Note added.');
      } else {
        // Fallback: journey with no contact behind it — keep the journey-note path.
        const updated = await addJourneyNote(journey.id, body);
        applyUpdate(updated);
        setNoteDraft('');
        triggerMessage('success', 'Note added.');
      }
    } catch (err) {
      triggerMessage('error', err?.response?.data?.message || 'Could not add the note.');
    } finally {
      setNoteSaving(false);
    }
  }, [journeyDrawer.journey, noteDraft, applyUpdate, triggerMessage]);

  // Delete a contact note from the Notes tab. Optimistically drop it; restore on error.
  const handleDeleteNote = useCallback(
    async (note) => {
      const journey = journeyDrawer.journey;
      if (!journey || !journey.contact_id || !note?.id) return;
      const noteContactId = journey.contact_id;
      const prev = contactNotes;
      setContactNotes((cur) => cur.filter((n) => n.id !== note.id));
      try {
        await deleteContactNote(noteContactId, note.id);
        triggerMessage('success', 'Note deleted.');
      } catch (err) {
        // Only restore if the drawer still shows the same contact (a switch mid-delete would
        // otherwise clobber the newly-shown contact's notes with the old contact's list).
        if (activeNotesContactRef.current === noteContactId) setContactNotes(prev);
        triggerMessage('error', err?.response?.data?.message || 'Could not delete the note.');
      }
    },
    [journeyDrawer.journey, contactNotes, triggerMessage]
  );

  // Attach a catalog service to the contact behind this journey. Reconcile from
  // the server-returned row so the journey's local services update immediately.
  const handleAddService = useCallback(
    async (svc) => {
      const journey = journeyDrawer.journey;
      if (!journey || !journey.contact_id || !svc) return;
      const existing = Array.isArray(journey.services) ? journey.services : [];
      if (existing.some((s) => String(s.service_id) === String(svc.id))) {
        setServiceInput('');
        return;
      }
      setServiceSaving(true);
      try {
        const { service } = await attachContactService(journey.contact_id, svc.id);
        applyUpdate({
          ...journey,
          services: [...existing, { service_id: service.service_id, service_name: service.service_name }]
        });
        setServiceInput('');
        triggerMessage('success', `Added “${service.service_name || svc.name}”.`);
      } catch (err) {
        triggerMessage('error', err?.response?.data?.message || 'Unable to add service.');
      } finally {
        setServiceSaving(false);
      }
    },
    [journeyDrawer.journey, applyUpdate, triggerMessage]
  );

  // Remove a service from the contact. Optimistically drop it; restore on error.
  const handleRemoveService = useCallback(
    async (serviceId) => {
      const journey = journeyDrawer.journey;
      if (!journey || !journey.contact_id) return;
      const existing = Array.isArray(journey.services) ? journey.services : [];
      applyUpdate({
        ...journey,
        services: existing.filter((s) => String(s.service_id) !== String(serviceId))
      });
      try {
        await removeContactService(journey.contact_id, serviceId);
        triggerMessage('success', 'Service removed.');
      } catch (err) {
        applyUpdate({ ...journey, services: existing });
        triggerMessage('error', err?.response?.data?.message || 'Unable to remove service.');
      }
    },
    [journeyDrawer.journey, applyUpdate, triggerMessage]
  );

  const handleCancelSchedule = useCallback(async () => {
    const journey = journeyDrawer.journey;
    if (!journey) return;
    setBusy(true);
    try {
      const updated = await cancelScheduledSend(journey.id);
      applyUpdate(updated);
      triggerMessage('info', 'Scheduled send canceled.');
    } catch (err) {
      triggerMessage('error', err?.response?.data?.message || 'Could not cancel the scheduled send.');
    } finally {
      setBusy(false);
    }
  }, [journeyDrawer.journey, applyUpdate, triggerMessage]);

  const handleConvert = useCallback(async () => {
    const journey = journeyDrawer.journey;
    if (!journey) return;
    // Real conversion goes through the parent's service-dialog flow, which creates
    // the active_clients record (via POST /clients/:leadId/agree-to-service) and
    // then closes the journey as converted. Calling convertJourney() alone would
    // only flip the journey status and never create the client.
    if (onConvert) {
      onConvert(journey);
      return;
    }
    // Fallback (no parent handler wired): still close the journey so we never
    // leave a journey stuck active, but warn that no client was created.
    setBusy(true);
    try {
      const updated = await convertJourney(journey.id);
      applyUpdate(updated);
      triggerMessage('success', 'Journey marked converted.');
    } catch (err) {
      triggerMessage('error', err?.response?.data?.message || 'Could not convert this lead.');
    } finally {
      setBusy(false);
    }
  }, [journeyDrawer.journey, onConvert, applyUpdate, triggerMessage]);

  const requestArchive = useCallback((journey) => {
    if (!journey?.id) return;
    setArchiveConfirm({ open: true, journey });
  }, []);

  const confirmArchive = useCallback(async () => {
    const { journey } = archiveConfirm;
    setArchiveConfirm({ open: false, journey: null });
    if (!journey) return;
    setBusy(true);
    try {
      if (onArchiveJourney) {
        // Parent owns the archive flow (handles toast + list removal).
        await onArchiveJourney(journey);
      } else {
        const updated = await archiveJourney(journey.id);
        applyUpdate(updated);
        triggerMessage('success', 'Journey archived.');
      }
      setJourneyDrawer((prev) => (prev.open && prev.journey?.id === journey.id ? { open: false, journey: null } : prev));
    } catch (err) {
      triggerMessage('error', err?.response?.data?.message || 'Could not archive the journey.');
    } finally {
      setBusy(false);
    }
  }, [archiveConfirm, onArchiveJourney, applyUpdate, triggerMessage]);

  const drawerNode = (
    <>
      <Drawer
        anchor="right"
        open={journeyDrawer.open}
        onClose={tutorialMode ? undefined : closeDrawer}
        hideBackdrop={tutorialMode}
        PaperProps={{ sx: { width: { xs: '100%', sm: '40vw' }, p: 0 } }}
        sx={tutorialMode ? { zIndex: 9999 } : undefined}
        slotProps={tutorialMode ? { root: { style: { zIndex: 9999 } } } : undefined}
      >
        {journeyDrawer.journey &&
          (() => {
            const journey = journeyDrawer.journey;
            const activities = Array.isArray(journey.activities) ? journey.activities : [];
            const isTerminal = TERMINAL_STATUSES.has(String(journey.status || '').toLowerCase());
            const startedDate = journey.created_at ? formatDateDisplay(journey.created_at) : '';
            const startedByLine = journey.created_by_name
              ? `Started by ${journey.created_by_name}${startedDate ? ` · ${startedDate}` : ''}`
              : startedDate
                ? `Started ${startedDate}`
                : '';

            const hasEmail = Boolean(journey.client_email && String(journey.client_email).trim());
            const sendEmailDisabled = journey.status !== 'active' || !hasEmail;
            const sendEmailTooltip = !hasEmail ? 'No email on file — this lead is call/text only.' : '';

            return (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <Box
                  data-tutorial="journey-drawer-header"
                  sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
                        {journey.client_name || 'Unnamed Lead'}
                      </Typography>
                      {journey.stage && (
                        <Chip
                          label={stageLabel(journey.stage)}
                          size="small"
                          sx={{ bgcolor: STAGE_COLORS[journey.stage] || 'grey.400', color: 'white', fontWeight: 600 }}
                        />
                      )}
                      {journey.status === 'converted' && <Chip label="Converted" size="small" color="success" />}
                      {journey.status === 'archived' && <Chip label="Archived" size="small" variant="outlined" />}
                    </Stack>
                    <IconButton onClick={closeDrawer} size="small">
                      <CloseIcon />
                    </IconButton>
                  </Stack>

                  <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                    {journey.client_phone && (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <PhoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">{journey.client_phone}</Typography>
                      </Stack>
                    )}
                    {journey.client_email && (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <EmailIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">{journey.client_email}</Typography>
                      </Stack>
                    )}
                  </Stack>

                  {startedByLine && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {startedByLine}
                    </Typography>
                  )}

                  {journey.symptoms?.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                      {journey.symptoms.map((concern) => (
                        <Chip key={concern} label={concern} size="small" />
                      ))}
                    </Stack>
                  )}

                  {/* Services — view/add/remove the contact's services (parity with the contact drawer). */}
                  {(() => {
                    const services = Array.isArray(journey.services) ? journey.services : [];
                    const hasContact = Boolean(journey.contact_id);
                    const canEdit = hasContact && !tutorialMode;
                    const serviceOptions = serviceCatalog.filter((svc) => !services.some((s) => String(s.service_id) === String(svc.id)));
                    return (
                      <Box data-tutorial="journey-drawer-services" sx={{ mt: 1.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          Services{services.length ? ` (${services.length})` : ''}
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: canEdit ? 1 : 0 }}>
                          {services.length ? (
                            services.map((s) => (
                              <Chip
                                key={s.service_id}
                                label={s.service_name || 'Service'}
                                size="small"
                                variant="outlined"
                                onDelete={canEdit ? () => handleRemoveService(s.service_id) : undefined}
                              />
                            ))
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No services recorded yet.
                            </Typography>
                          )}
                        </Stack>
                        {canEdit && (
                          <Autocomplete
                            size="small"
                            disabled={serviceSaving}
                            options={serviceOptions}
                            getOptionLabel={(opt) => opt?.name || ''}
                            isOptionEqualToValue={(opt, val) => opt?.id === val?.id}
                            value={null}
                            inputValue={serviceInput}
                            onInputChange={(_e, value, reason) => {
                              if (reason !== 'reset') setServiceInput(value);
                            }}
                            onChange={(_e, value, reason) => {
                              if (value && reason === 'selectOption') handleAddService(value);
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label="Add a service"
                                placeholder={services.length ? 'Add another service…' : 'Add a service…'}
                              />
                            )}
                            clearOnBlur
                            selectOnFocus
                          />
                        )}
                      </Box>
                    );
                  })()}

                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    {!isTerminal && (
                      <LoadingButton size="small" variant="contained" color="primary" loading={busy} onClick={handleConvert}>
                        Convert to Client
                      </LoadingButton>
                    )}
                    {!isTerminal &&
                      (() => {
                        const atFinalStage = nextStage(journey.stage) === null;
                        const markCompleteDisabled = journey.status !== 'active' || atFinalStage || markCompleteSaving;
                        const tooltipTitle = atFinalStage ? 'Already at the final touch — Convert or Archive to finish.' : '';
                        return (
                          <Tooltip title={tooltipTitle}>
                            <span>
                              <LoadingButton
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<CheckCircleOutlineIcon />}
                                loading={markCompleteSaving}
                                disabled={markCompleteDisabled}
                                onClick={handleMarkComplete}
                              >
                                Mark Complete
                              </LoadingButton>
                            </span>
                          </Tooltip>
                        );
                      })()}
                    <Box sx={{ flex: 1 }} />
                    {!isTerminal && (
                      <Tooltip title="Archive Journey">
                        <span>
                          <IconButton size="small" color="error" disabled={busy} onClick={() => requestArchive(journey)}>
                            <ArchiveIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </Stack>
                </Box>

                {/* Pending-send banner */}
                {journey.pending_send && (
                  <Box sx={{ px: 2, py: 1.25, bgcolor: 'warning.lighter', borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <ScheduleIcon sx={{ fontSize: 18, color: 'warning.dark' }} />
                      <Typography variant="body2" sx={{ flex: 1, color: 'warning.dark' }}>
                        Email scheduled for {formatDateDisplay(journey.pending_send.scheduled_for)}
                      </Typography>
                      <Button size="small" color="warning" disabled={busy} onClick={handleCancelSchedule}>
                        Cancel
                      </Button>
                    </Stack>
                  </Box>
                )}

                {/* Timeline tabs */}
                {(() => {
                  const noteActivities = activities.filter((a) => a.type === 'note');
                  const otherActivities = activities.filter((a) => a.type !== 'note');
                  // Notes tab is contact-scoped when the journey has a contact behind it;
                  // otherwise fall back to the journey's own note activities.
                  const hasContactForNotes = Boolean(journey.contact_id);
                  const notesForDisplay = hasContactForNotes ? contactNotes : noteActivities;

                  const renderNoteRow = (note) => (
                    <Paper key={note.id} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 0.5 }}>
                            {note.body}
                          </Typography>
                          <Typography variant="caption" color="text.disabled">
                            {note.author_name || 'System'}
                            {note.created_at ? ` · ${formatDateDisplay(note.created_at)}` : ''}
                          </Typography>
                        </Box>
                        <Tooltip title="Delete note">
                          <IconButton size="small" aria-label="Delete note" onClick={() => handleDeleteNote(note)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Paper>
                  );

                  const renderActivityRow = (activity) => {
                    const isStageChange = activity.type === 'stage_change';
                    const headline = isStageChange
                      ? `Moved to ${stageLabel(activity.to_stage)}`
                      : activity.subject || ACTIVITY_ICON_LABEL[activity.type] || 'Activity';
                    return (
                      <Paper key={activity.id} variant="outlined" sx={{ p: 1.25 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
                          <Chip
                            label={ACTIVITY_ICON_LABEL[activity.type] || 'Activity'}
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.65rem' }}
                          />
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }} noWrap>
                            {headline}
                          </Typography>
                          {activity.email_status && (
                            <Chip
                              label={activity.email_status}
                              size="small"
                              color={activity.email_status === 'failed' ? 'error' : 'default'}
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.65rem' }}
                            />
                          )}
                        </Stack>
                        {!isStageChange && activity.body && (
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 0.5 }}>
                            {activity.body}
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.disabled">
                          {activity.author_name || 'System'}
                          {activity.created_at ? ` · ${formatDateDisplay(activity.created_at)}` : ''}
                        </Typography>
                        {onOpenLeadDetail && activity.metadata?.call_id && (
                          <Button
                            size="small"
                            sx={{ mt: 0.5, textTransform: 'none' }}
                            onClick={() => onOpenLeadDetail({ id: activity.metadata.call_id })}
                          >
                            View lead
                          </Button>
                        )}
                      </Paper>
                    );
                  };

                  return (
                    <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      <Tabs
                        data-tutorial="journey-drawer-tabs"
                        value={timelineTab}
                        onChange={(_, v) => setTimelineTab(v)}
                        sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}
                      >
                        <Tab value="notes" label={notesForDisplay.length > 0 ? `Notes (${notesForDisplay.length})` : 'Notes'} />
                        <Tab value="activity" label={otherActivities.length > 0 ? `Activity (${otherActivities.length})` : 'Activity'} />
                      </Tabs>

                      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                        {/* Notes panel */}
                        {timelineTab === 'notes' &&
                          (notesForDisplay.length === 0 ? (
                            <Box>
                              <Typography variant="subtitle2" color="text.secondary">
                                No notes yet
                              </Typography>
                              <Typography variant="body2" color="text.disabled">
                                Use the composer below to add your first note.
                              </Typography>
                            </Box>
                          ) : (
                            <Stack spacing={1.25}>
                              {hasContactForNotes
                                ? notesForDisplay.map(renderNoteRow)
                                : notesForDisplay.map(renderActivityRow)}
                            </Stack>
                          ))}

                        {/* Activity panel */}
                        {timelineTab === 'activity' &&
                          (otherActivities.length === 0 ? (
                            <EmptyState title="No activity yet" message="Send an email or convert a stage to see events here." />
                          ) : (
                            <Stack spacing={1.25}>{otherActivities.map(renderActivityRow)}</Stack>
                          ))}
                      </Box>

                      {/* Note composer — pinned at the bottom of the Notes tab, just above the action bar */}
                      {timelineTab === 'notes' && !isTerminal && (
                        <Box sx={{ px: 2, pt: 1, pb: 1.5, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
                          <Typography variant="caption" color="text.secondary">
                            Add a note
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: 0.5 }}>
                            <TextField
                              size="small"
                              fullWidth
                              multiline
                              minRows={2}
                              placeholder="Record an internal note"
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                            />
                            <LoadingButton
                              variant="outlined"
                              startIcon={<NoteAddIcon />}
                              loading={noteSaving}
                              disabled={!noteDraft.trim()}
                              onClick={handleAddNote}
                            >
                              Add
                            </LoadingButton>
                          </Stack>
                        </Box>
                      )}
                    </Box>
                  );
                })()}

                {/* Action bar — Send Email / Send Text always visible */}
                {!isTerminal && (
                  <Box
                    data-tutorial="journey-drawer-actions"
                    sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'grey.50', flexShrink: 0 }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      Send now or Schedule
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Tooltip title={sendEmailTooltip}>
                        <span>
                          <Button
                            variant="contained"
                            startIcon={<EmailIcon />}
                            disabled={sendEmailDisabled}
                            onClick={() => setEmailDialogOpen(true)}
                          >
                            Send Email
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Coming soon — pending Twilio number">
                        <span>
                          <Button variant="outlined" startIcon={<SmsIcon />} disabled>
                            Send Text
                          </Button>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Box>
                )}
              </Box>
            );
          })()}
      </Drawer>

      <SendEmailDialog
        open={emailDialogOpen}
        onClose={() => setEmailDialogOpen(false)}
        onSubmit={handleSendEmail}
        onManageTemplates={onManageTemplates}
        recipientEmail={journeyDrawer.journey?.client_email || ''}
        recipientName={journeyDrawer.journey?.client_name || ''}
      />

      <ConfirmDialog
        open={archiveConfirm.open}
        onClose={() => setArchiveConfirm({ open: false, journey: null })}
        onConfirm={confirmArchive}
        title="Archive Journey?"
        message={`Are you sure you want to archive the journey for "${
          archiveConfirm.journey?.client_name || 'this lead'
        }"? Any scheduled email will be canceled. You can restore it later from the Archive tab.`}
        confirmLabel="Archive"
        confirmColor="error"
        loading={busy}
      />
    </>
  );

  return {
    openDrawer,
    closeDrawer,
    drawerNode,
    isOpen: journeyDrawer.open,
    openJourneyId: journeyDrawer.journey?.id ?? null
  };
}
