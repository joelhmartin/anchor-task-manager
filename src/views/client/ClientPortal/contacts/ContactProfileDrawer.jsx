import { useCallback, useEffect, useState } from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Autocomplete from '@mui/material/Autocomplete';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LoadingButton from 'ui-component/extended/LoadingButton';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import {
  fetchContact,
  addContactTag,
  removeContactTagApi,
  updateContactConsent,
  archiveContact,
  attachContactService,
  removeContactService,
  fetchContactNotes,
  addContactNote,
  deleteContactNote
} from 'api/contacts';
import { renameContact, fetchCalls, fetchAllTags } from 'api/calls';
import { fetchServices } from 'api/services';
import LeadActivityRow from '../leads/LeadActivityRow';
import ActivityDetailDrawer from '../leads/ActivityDetailDrawer';
import SplitContactDialog from './SplitContactDialog';

const TIMELINE_PAGE_SIZE = 25;

const SERVICE_SOURCE_LABEL = { journey: 'Journey', active_client: 'Active client', manual: 'Added by you' };

const formatServiceDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ContactProfileDrawer({
  open,
  contactId,
  onClose,
  onContactUpdated,
  onContactSplit,
  isStaff = false,
  // Tutorial mode: render the provided mock detail/timeline instead of fetching,
  // and no-op all mutations (the contacts-overview tour spotlights a fake contact).
  tutorialMode = false,
  tutorialDetail = null,
  tutorialTimeline = null
}) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [renameState, setRenameState] = useState({ editing: false, value: '', saving: false });
  const [ownerTags, setOwnerTags] = useState([]);
  const [newTagName, setNewTagName] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [consentSaving, setConsentSaving] = useState({ sms: false, email: false });
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceInput, setServiceInput] = useState('');
  // Contact-level notes (lead_notes keyed by contact_id).
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelinePagination, setTimelinePagination] = useState(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // Clicking a timeline row opens the read-only activity detail (transcript / form fill).
  const [activityDetail, setActivityDetail] = useState({ open: false, call: null });

  // Load the profile + first timeline page whenever a contact is opened.
  useEffect(() => {
    if (!open || !contactId) return;
    // Close any open activity-detail popup when the contact context changes, so a different
    // contact's transcript can't linger on screen.
    setActivityDetail({ open: false, call: null });
    // Tutorial mock: render the provided detail/timeline; skip network + audit log.
    if (tutorialMode && tutorialDetail) {
      setLoading(false);
      setDetail(tutorialDetail);
      setTimeline(Array.isArray(tutorialTimeline) ? tutorialTimeline : []);
      setTimelinePagination(null);
      setTimelinePage(1);
      setTimelineLoading(false);
      setRenameState({ editing: false, value: '', saving: false });
      return;
    }
    let active = true;
    setLoading(true);
    setDetail(null);
    setTimeline([]);
    setTimelinePage(1);
    setRenameState({ editing: false, value: '', saving: false });
    fetchContact(contactId)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((err) => {
        if (active) toast.error(err?.message || 'Unable to load contact');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    setTimelineLoading(true);
    fetchCalls({ contact_id: contactId, page: 1, limit: TIMELINE_PAGE_SIZE })
      .then(({ calls, pagination }) => {
        if (!active) return;
        setTimeline(Array.isArray(calls) ? calls : []);
        setTimelinePagination(pagination);
      })
      .catch(() => {
        /* timeline failure is non-fatal; profile still shows */
      })
      .finally(() => {
        if (active) setTimelineLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, contactId, toast, tutorialMode, tutorialDetail, tutorialTimeline]);

  // Owner tag list for the add-tag autocomplete (loaded once per open).
  useEffect(() => {
    if (!open || tutorialMode) return;
    let active = true;
    fetchAllTags()
      .then((list) => {
        if (active) setOwnerTags(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, tutorialMode]);

  // Service catalog for the add-service picker (loaded once per open).
  useEffect(() => {
    if (!open || tutorialMode) return;
    let active = true;
    fetchServices()
      .then((list) => {
        if (active) setServiceCatalog(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, tutorialMode]);

  // Contact notes (loaded once per open). Skipped in tutorial mode.
  useEffect(() => {
    if (!open || !contactId || tutorialMode) {
      setNotes([]);
      return undefined;
    }
    let active = true;
    setNoteDraft('');
    fetchContactNotes(contactId)
      .then((list) => {
        if (active) setNotes(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (active) setNotes([]);
      });
    return () => {
      active = false;
    };
  }, [open, contactId, tutorialMode]);

  const handleAddNote = useCallback(async () => {
    if (tutorialMode) return;
    const body = noteDraft.trim();
    if (!body || !contactId) return;
    setNoteSaving(true);
    try {
      const res = await addContactNote(contactId, body);
      const note = res?.note || res;
      if (note?.id) setNotes((prev) => [note, ...prev]);
      setNoteDraft('');
      toast.success('Note added');
    } catch (err) {
      toast.error(err?.message || 'Unable to add note');
    } finally {
      setNoteSaving(false);
    }
  }, [contactId, noteDraft, toast, tutorialMode]);

  const handleDeleteNote = useCallback(
    async (note) => {
      if (tutorialMode || !contactId || !note?.id) return;
      const prev = notes;
      setNotes((cur) => cur.filter((n) => n.id !== note.id));
      try {
        await deleteContactNote(contactId, note.id);
        toast.success('Note deleted');
      } catch (err) {
        setNotes(prev);
        toast.error(err?.message || 'Unable to delete note');
      }
    },
    [contactId, notes, toast, tutorialMode]
  );

  const handleSaveName = useCallback(async () => {
    if (tutorialMode) return;
    const name = renameState.value.trim();
    if (!name) return;
    setRenameState((s) => ({ ...s, saving: true }));
    try {
      const updated = await renameContact(contactId, name);
      setDetail((d) =>
        d ? { ...d, contact: { ...d.contact, display_name: updated.display_name, display_name_source: updated.display_name_source } } : d
      );
      onContactUpdated?.({ id: contactId, display_name: updated.display_name, display_name_source: updated.display_name_source });
      setRenameState({ editing: false, value: '', saving: false });
      toast.success('Name updated');
    } catch (err) {
      setRenameState((s) => ({ ...s, saving: false }));
      toast.error(err?.message || 'Unable to update name');
    }
  }, [renameState.value, contactId, onContactUpdated, toast, tutorialMode]);

  // Add a tag by name (free-form, create-on-the-fly) — mirrors the Leads "add a tag" UX.
  // We post the name and reconcile from the server-returned tag so a brand-new tag gets
  // its real id/color before rendering the chip.
  const handleAddTag = useCallback(
    async (name) => {
      if (tutorialMode) return;
      const clean = String(name || '').trim();
      if (!clean || !detail) return;
      // Already on this contact (case-insensitive)? No-op.
      if ((detail.tags || []).some((t) => (t.name || '').toLowerCase() === clean.toLowerCase())) {
        setNewTagName('');
        return;
      }
      setTagSaving(true);
      try {
        const { tag } = await addContactTag(contactId, { tagName: clean });
        setDetail((d) => ({ ...d, tags: [...(d.tags || []), { id: tag.id, name: tag.name, color: tag.color, source: 'user' }] }));
        // Keep the owner catalog fresh so a newly-created tag is reusable immediately.
        setOwnerTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
        setNewTagName('');
        toast.success(`Tagged “${tag.name}”`);
      } catch (err) {
        toast.error(err?.message || 'Unable to add tag');
      } finally {
        setTagSaving(false);
      }
    },
    [contactId, detail, toast, tutorialMode]
  );

  const handleRemoveTag = useCallback(
    async (tagId) => {
      if (tutorialMode) return;
      if (!detail) return;
      const prev = detail.tags || [];
      setDetail((d) => ({ ...d, tags: (d.tags || []).filter((t) => t.id !== tagId) }));
      try {
        await removeContactTagApi(contactId, tagId);
        toast.success('Tag removed');
      } catch (err) {
        setDetail((d) => ({ ...d, tags: prev }));
        toast.error(err?.message || 'Unable to remove tag');
      }
    },
    [contactId, detail, toast, tutorialMode]
  );

  const handleConsentToggle = useCallback(
    async (field, value) => {
      if (tutorialMode) return;
      const which = field === 'sms_opted_out' ? 'sms' : 'email';
      setConsentSaving((s) => ({ ...s, [which]: true }));
      const prev = detail?.consent;
      setDetail((d) => ({ ...d, consent: { ...d.consent, [field]: value } }));
      try {
        await updateContactConsent(contactId, { [field]: value });
        toast.success('Consent updated');
      } catch (err) {
        setDetail((d) => ({ ...d, consent: prev }));
        toast.error(err?.message || 'Unable to update consent');
      } finally {
        setConsentSaving((s) => ({ ...s, [which]: false }));
      }
    },
    [contactId, detail, toast, tutorialMode]
  );

  // Attach a catalog service. We reconcile from the server-returned row so the chip carries
  // the real ledger id/source/date before rendering.
  const handleAddService = useCallback(
    async (svc) => {
      if (tutorialMode || !detail || !svc?.id) return;
      // Already attached (active)? No-op.
      if ((detail.services || []).some((s) => String(s.service_id) === String(svc.id))) {
        setServiceInput('');
        return;
      }
      setServiceSaving(true);
      try {
        const { service } = await attachContactService(contactId, svc.id);
        setDetail((d) => {
          const existing = d?.services || [];
          // Guard against a double-add racing the optimistic state.
          if (existing.some((s) => String(s.service_id) === String(service.service_id))) return d;
          return { ...d, services: [...existing, service] };
        });
        setServiceInput('');
        toast.success(`Added “${service.service_name || svc.name}”`);
      } catch (err) {
        toast.error(err?.message || 'Unable to add service');
      } finally {
        setServiceSaving(false);
      }
    },
    [contactId, detail, toast, tutorialMode]
  );

  // Remove keys off the catalog service_id (the DELETE endpoint matches on service_id, not the row id).
  const handleRemoveService = useCallback(
    async (serviceId) => {
      if (tutorialMode || !detail) return;
      const prev = detail.services || [];
      setDetail((d) => ({ ...d, services: (d.services || []).filter((s) => String(s.service_id) !== String(serviceId)) }));
      try {
        await removeContactService(contactId, serviceId);
        toast.success('Service removed');
      } catch (err) {
        setDetail((d) => ({ ...d, services: prev }));
        toast.error(err?.message || 'Unable to remove service');
      }
    },
    [contactId, detail, toast, tutorialMode]
  );

  const handleLoadMore = useCallback(async () => {
    if (tutorialMode) return;
    const next = timelinePage + 1;
    setTimelineLoading(true);
    try {
      const { calls, pagination } = await fetchCalls({ contact_id: contactId, page: next, limit: TIMELINE_PAGE_SIZE });
      setTimeline((prev) => [...prev, ...(Array.isArray(calls) ? calls : [])]);
      setTimelinePagination(pagination);
      setTimelinePage(next);
    } catch (err) {
      toast.error(err?.message || 'Unable to load more activity');
    } finally {
      setTimelineLoading(false);
    }
  }, [contactId, timelinePage, toast, tutorialMode]);

  const handleArchiveToggle = useCallback(async () => {
    if (tutorialMode) return;
    const next = !detail?.contact?.archived_at;
    setArchiving(true);
    try {
      const { contact: updated } = await archiveContact(contactId, next);
      setDetail((d) => (d ? { ...d, contact: { ...d.contact, archived_at: updated.archived_at } } : d));
      onContactUpdated?.({ id: contactId, archived_at: updated.archived_at });
      toast.success(next ? 'Contact archived' : 'Contact restored');
    } catch (err) {
      toast.error(err?.message || 'Unable to update archive state');
    } finally {
      setArchiving(false);
    }
  }, [contactId, detail, onContactUpdated, toast, tutorialMode]);

  // After a split, the source loses an identifier + matching activity — reload the profile and timeline.
  const handleSplitDone = useCallback(async () => {
    if (tutorialMode) return;
    try {
      const [data, calls] = await Promise.all([
        fetchContact(contactId),
        fetchCalls({ contact_id: contactId, page: 1, limit: TIMELINE_PAGE_SIZE })
      ]);
      setDetail(data);
      setTimeline(Array.isArray(calls.calls) ? calls.calls : []);
      setTimelinePagination(calls.pagination);
      setTimelinePage(1);
    } catch {
      /* non-fatal; the list refresh below still reflects the split */
    }
    onContactSplit?.();
  }, [contactId, onContactSplit, tutorialMode]);

  const contact = detail?.contact;
  // The owner's own tags (exclude system/lifecycle tags like "In Journey") that aren't
  // already on this contact — these feed the type-ahead suggestions.
  const userTagOptions = ownerTags.filter((t) => !t.system_key && !(detail?.tags || []).some((ct) => ct.id === t.id));
  // Catalog services not already attached to this contact (feeds the add-service picker).
  const serviceOptions = serviceCatalog.filter((svc) => !(detail?.services || []).some((s) => String(s.service_id) === String(svc.id)));
  const hasMore = timelinePagination && timelinePagination.page < timelinePagination.pages;
  // Hide the staff-only Split control during the tour (the mock has 2 identifiers, which
  // would otherwise surface it) so the spotlight steps stay clean.
  const canSplit = isStaff && !tutorialMode && (detail?.phones?.length || 0) + (detail?.emails?.length || 0) > 1;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={tutorialMode ? undefined : onClose}
      hideBackdrop={tutorialMode}
      PaperProps={{ sx: { width: { xs: '100%', sm: 480 } } }}
      // During the tour, sit just below react-joyride's overlay (10000) so the
      // spotlight dims the drawer and cuts a highlight hole over the target.
      sx={tutorialMode ? { zIndex: 9999 } : undefined}
      slotProps={tutorialMode ? { root: { style: { zIndex: 9999 } } } : undefined}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack data-tutorial="contact-drawer-header" direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {renameState.editing ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  value={renameState.value}
                  onChange={(e) => setRenameState((s) => ({ ...s, value: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') setRenameState({ editing: false, value: '', saving: false });
                  }}
                  autoFocus
                  sx={{ minWidth: 200 }}
                />
                <LoadingButton
                  size="small"
                  variant="contained"
                  loading={renameState.saving}
                  loadingLabel="Saving…"
                  onClick={handleSaveName}
                >
                  Save
                </LoadingButton>
                <Button size="small" onClick={() => setRenameState({ editing: false, value: '', saving: false })}>
                  Cancel
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="h4" fontWeight={600} noWrap>
                  {contact?.display_name || 'Unknown'}
                </Typography>
                {contact && (
                  <Tooltip title="Edit name">
                    <IconButton
                      size="small"
                      aria-label="Edit contact name"
                      onClick={() => setRenameState({ editing: true, value: contact.display_name || '', saving: false })}
                      sx={{ opacity: 0.7 }}
                    >
                      <EditIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            )}
            {contact?.display_name_source === 'user' && (
              <Typography variant="caption" color="text.secondary">
                ✎ set by you
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {canSplit && (
              <Tooltip title="Split off an identifier into a new contact">
                <Button size="small" variant="outlined" startIcon={<CallSplitIcon />} onClick={() => setSplitOpen(true)}>
                  Split
                </Button>
              </Tooltip>
            )}
            {contact && (
              <LoadingButton
                data-tutorial="contact-drawer-archive"
                size="small"
                variant="outlined"
                color={contact.archived_at ? 'primary' : 'inherit'}
                startIcon={contact.archived_at ? <UnarchiveIcon /> : <ArchiveIcon />}
                loading={archiving}
                loadingLabel="…"
                onClick={handleArchiveToggle}
              >
                {contact.archived_at ? 'Restore' : 'Archive'}
              </LoadingButton>
            )}
            {/* Hidden during the tour — the tutorial drives navigation, and closing
                the drawer mid-tour would break the spotlight choreography. */}
            {!tutorialMode && (
              <IconButton aria-label="Close" onClick={onClose} size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        </Stack>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        {contact && (
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {/* Identifiers */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Identifiers
              </Typography>
              <Stack spacing={0.75}>
                {(detail.phones || []).map((p) => (
                  <Stack key={p.id} direction="row" spacing={1} alignItems="center">
                    <PhoneIcon fontSize="small" color="action" />
                    <Typography variant="body2">{p.phone_e164 || p.phone_digits10}</Typography>
                    {p.is_primary && <Chip label="Primary" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
                  </Stack>
                ))}
                {(detail.emails || []).map((e) => (
                  <Stack key={e.id} direction="row" spacing={1} alignItems="center">
                    <EmailIcon fontSize="small" color="action" />
                    <Typography variant="body2">{e.email}</Typography>
                    {e.is_primary && <Chip label="Primary" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
                  </Stack>
                ))}
                {!(detail.phones || []).length && !(detail.emails || []).length && (
                  <Typography variant="body2" color="text.secondary">
                    No phone or email on file.
                  </Typography>
                )}
              </Stack>
            </Box>

            <Divider />

            {/* Tags */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Tags
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                {(detail.tags || []).length ? (
                  (detail.tags || []).map((t) => (
                    <Chip
                      key={t.id}
                      label={t.name}
                      size="small"
                      onDelete={() => handleRemoveTag(t.id)}
                      variant="outlined"
                      sx={{ ...(t.color ? { borderColor: t.color, color: t.color } : {}) }}
                    />
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No tags yet.
                  </Typography>
                )}
              </Stack>
              <Autocomplete
                freeSolo
                size="small"
                disabled={tagSaving}
                options={userTagOptions.map((t) => t.name)}
                inputValue={newTagName}
                onInputChange={(_e, value, reason) => {
                  if (reason !== 'reset') setNewTagName(value);
                }}
                onChange={(_e, value, reason) => {
                  if (value && (reason === 'selectOption' || reason === 'createOption')) {
                    if (value === '— Already on this contact') return;
                    const cleanName = value.startsWith('+ Create "') && value.endsWith('"') ? value.slice(10, -1) : value;
                    handleAddTag(cleanName);
                  }
                }}
                filterOptions={(options, { inputValue }) => {
                  const trimmedInput = inputValue.trim();
                  // Empty input shows nothing — the user types to search or create.
                  if (!trimmedInput) return [];
                  const lowerInput = trimmedInput.toLowerCase();
                  const filtered = options.filter((option) => option.toLowerCase().includes(lowerInput));
                  // Already on this contact? Surface a disabled hint instead of a dupe.
                  const alreadyOnContact = (detail?.tags || []).some((t) => (t.name || '').toLowerCase() === lowerInput);
                  if (alreadyOnContact) {
                    filtered.push('— Already on this contact');
                    return filtered;
                  }
                  // Offer to create the tag when it doesn't already exist for this owner.
                  const existsInOwnerTags = ownerTags.some((t) => (t.name || '').toLowerCase() === lowerInput);
                  if (!existsInOwnerTags) filtered.push(`+ Create "${trimmedInput}"`);
                  return filtered;
                }}
                renderOption={(props, option) => {
                  const isCreateOption = option.startsWith('+ Create "') && option.endsWith('"');
                  const isAlreadyAdded = option === '— Already on this contact';
                  const existingTag = ownerTags.find((t) => t.name === option);
                  return (
                    <Box
                      component="li"
                      {...props}
                      onClick={isAlreadyAdded ? undefined : props.onClick}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        ...(isCreateOption && { fontStyle: 'italic', color: 'primary.main' }),
                        ...(isAlreadyAdded && {
                          fontStyle: 'italic',
                          color: 'text.disabled',
                          cursor: 'default',
                          '&:hover': { bgcolor: 'transparent' }
                        })
                      }}
                    >
                      {!isCreateOption && !isAlreadyAdded && existingTag && (
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: existingTag.color || '#6366f1', flexShrink: 0 }} />
                      )}
                      {option}
                    </Box>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Add a tag"
                    placeholder={(detail?.tags || []).length ? 'Add another tag…' : 'Add a tag…'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTagName.trim()) {
                        e.preventDefault();
                        const cleanName =
                          newTagName.startsWith('+ Create "') && newTagName.endsWith('"') ? newTagName.slice(10, -1) : newTagName.trim();
                        handleAddTag(cleanName);
                      }
                    }}
                  />
                )}
                selectOnFocus
                clearOnBlur={false}
              />
            </Box>

            <Divider />

            {/* Consent */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Communication consent
              </Typography>
              <Stack>
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!detail.consent?.sms_opted_out}
                      disabled={consentSaving.sms}
                      onChange={(e) => handleConsentToggle('sms_opted_out', e.target.checked)}
                    />
                  }
                  label="SMS opted out"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!detail.consent?.email_opted_out}
                      disabled={consentSaving.email}
                      onChange={(e) => handleConsentToggle('email_opted_out', e.target.checked)}
                    />
                  }
                  label="Email opted out"
                />
              </Stack>
            </Box>

            <Divider />

            {/* Services — editable ledger of services this contact is interested in. */}
            <Box data-tutorial="contact-drawer-services">
              <Typography variant="subtitle2" gutterBottom>
                Services {Array.isArray(detail.services) && detail.services.length ? `(${detail.services.length})` : ''}
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                {Array.isArray(detail.services) && detail.services.length ? (
                  detail.services.map((s) => {
                    const sourceLabel = SERVICE_SOURCE_LABEL[s.source] || s.source;
                    const dateLabel = formatServiceDate(s.created_at);
                    const tip = [sourceLabel, dateLabel].filter(Boolean).join(' · ');
                    const chip = (
                      <Chip
                        key={s.id}
                        label={s.service_name || 'Service'}
                        size="small"
                        variant="outlined"
                        onDelete={tutorialMode ? undefined : () => handleRemoveService(s.service_id)}
                      />
                    );
                    return tip ? (
                      <Tooltip key={s.id} title={tip}>
                        {chip}
                      </Tooltip>
                    ) : (
                      chip
                    );
                  })
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No services recorded yet.
                  </Typography>
                )}
              </Stack>
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
                    placeholder={(detail?.services || []).length ? 'Add another service…' : 'Add a service…'}
                  />
                )}
                clearOnBlur
                selectOnFocus
              />
            </Box>

            <Divider />

            {/* Notes — contact-level internal notes (parity with Services). */}
            <Box data-tutorial="contact-drawer-notes">
              <Typography variant="subtitle2" gutterBottom>
                Notes {notes.length ? `(${notes.length})` : ''}
              </Typography>
              {!tutorialMode && (
                <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1.5 }}>
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
                    loading={noteSaving}
                    loadingLabel="…"
                    disabled={!noteDraft.trim()}
                    onClick={handleAddNote}
                  >
                    Add
                  </LoadingButton>
                </Stack>
              )}
              {notes.length ? (
                <Stack spacing={1.25}>
                  {notes.map((note) => (
                    <Stack key={note.id} direction="row" spacing={1} alignItems="flex-start">
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {note.body}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {note.author_name || 'System'}
                          {note.created_at ? ` · ${new Date(note.created_at).toLocaleString()}` : ''}
                        </Typography>
                      </Box>
                      {!tutorialMode && (
                        <Tooltip title="Delete note">
                          <IconButton size="small" aria-label="Delete note" onClick={() => handleDeleteNote(note)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No notes yet.
                </Typography>
              )}
            </Box>

            <Divider />

            {/* Activity timeline */}
            <Box data-tutorial="contact-drawer-activity">
              <Typography variant="subtitle2" gutterBottom>
                Activity {detail.activity_count ? `(${detail.activity_count})` : ''}
              </Typography>
              {timelineLoading && !timeline.length && <LinearProgress sx={{ mb: 1 }} />}
              {timeline.length ? (
                <Stack spacing={1}>
                  {timeline.map((call) => (
                    <LeadActivityRow
                      key={call.call_id || call.id}
                      call={call}
                      onOpenLeadDetail={(c) => setActivityDetail({ open: true, call: c })}
                    />
                  ))}
                  {hasMore && (
                    <LoadingButton variant="text" size="small" loading={timelineLoading} loadingLabel="Loading…" onClick={handleLoadMore}>
                      Load more
                    </LoadingButton>
                  )}
                </Stack>
              ) : (
                !timelineLoading && <EmptyState title="No activity yet" message="Calls and form fills for this contact will show here." />
              )}
            </Box>
          </Stack>
        )}
      </Box>

      {canSplit && (
        <SplitContactDialog
          open={splitOpen}
          contact={contact}
          phones={detail?.phones || []}
          emails={detail?.emails || []}
          onClose={() => setSplitOpen(false)}
          onSplit={handleSplitDone}
        />
      )}

      <ActivityDetailDrawer
        open={open && activityDetail.open}
        call={activityDetail.call}
        onClose={() => setActivityDetail({ open: false, call: null })}
      />
    </Drawer>
  );
}
