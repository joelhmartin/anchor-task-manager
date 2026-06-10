import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Pagination from '@mui/material/Pagination';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Badge from '@mui/material/Badge';
import Drawer from '@mui/material/Drawer';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import SearchIcon from '@mui/icons-material/Search';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import DownloadIcon from '@mui/icons-material/Download';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import SelectField from 'ui-component/extended/SelectField';
import FormDialog from 'ui-component/extended/FormDialog';
import { fetchContacts, fetchMergeCandidates, fetchContactTagOptions, exportContactsCsv, archiveContact } from 'api/contacts';
import { fetchServices } from 'api/services';
import useTutorial from 'hooks/useTutorial';
import useStateVersionPoll from 'hooks/useStateVersionPoll';
import ContactProfileDrawer from './contacts/ContactProfileDrawer';
import MergeQueuePanel from './contacts/MergeQueuePanel';

// Sentinel id for the mock contact the contacts-overview tutorial spotlights.
const TUTORIAL_MOCK_CONTACT_ID = 'mock-contact-001';

// Stage (lifecycle) multi-select options. 'archived' is its own bucket (an archived contact
// only shows under Archived). Empty selection = all non-archived stages (server default).
const STATUS_OPTIONS = [
  { value: 'lead', label: 'New Lead' },
  { value: 'in_journey', label: 'In Journey' },
  { value: 'active_client', label: 'Active Client' },
  { value: 'archived', label: 'Archived' }
];
const STATUS_VALUES = STATUS_OPTIONS.map((o) => o.value);
// Default opens on the goal state — New Lead (not in a journey / not an active client) — paired
// with the 'qualified' disposition default below.
const DEFAULT_STATUS_FILTER = ['lead'];

// Lead-category multi-select options (mirror the Lead Inbox chips). Default selection is
// "Qualified" only — which already includes Priority/needs_attention leads — so spam,
// not-a-fit, unanswered, and unclassified contacts are hidden until explicitly added.
const CATEGORY_OPTIONS = [
  { value: 'qualified', label: 'Qualified' },
  { value: 'unanswered', label: 'Unanswered' },
  { value: 'not_a_fit', label: 'Not a Fit' },
  { value: 'spam', label: 'Spam' },
  { value: 'pending_review', label: 'Pending Review' }
];
const DEFAULT_CATEGORY_FILTER = ['qualified'];

// Derived disposition (quality) → StatusChip key + label. The value doubles as the StatusChip
// status key, so colors/labels live centrally in STATUS_MAP (StatusChip.jsx); this map is the
// label source + a guard for unexpected values. Keep in sync with DISPOSITION_LABEL (hub.js).
const DISPOSITION_CHIP = {
  qualified: { status: 'qualified', label: 'Qualified Lead' },
  needs_attention: { status: 'needs_attention', label: 'Priority' },
  unanswered: { status: 'unanswered', label: 'Unanswered' },
  not_a_fit: { status: 'not_a_fit', label: 'Not a Fit' },
  spam: { status: 'spam', label: 'Spam' },
  pending_review: { status: 'pending_review', label: 'Pending Review' }
};
// Lifecycle (where the contact is in the pipeline) → a secondary badge layered over disposition.
// Only shown for in-journey / active-client; a plain "lead" needs no badge.
const LIFECYCLE_BADGE = {
  in_journey: { status: 'in_journey', label: 'In Journey' },
  active_client: { status: 'active_client', label: 'Active Client' }
};

const formatShortDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const PAGE_SIZE = 50;

// Export column registry — keys must match the server's CONTACT_CSV_COLUMNS. `default: true`
// are pre-checked in the Export dialog (Name/Phone/Email/Tags/Services). To offer a future
// client field: add one entry here + the matching server registry entry.
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Name', default: true },
  { key: 'phone', label: 'Phone', default: true },
  { key: 'email', label: 'Email', default: true },
  { key: 'tags', label: 'Tags', default: true },
  { key: 'services', label: 'Services', default: true },
  { key: 'status', label: 'Status' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'first_source', label: 'First source' },
  { key: 'sources_touched', label: 'Sources touched' },
  { key: 'first_activity', label: 'First activity' },
  { key: 'last_activity', label: 'Last activity' },
  { key: 'first_seen', label: 'First seen' },
  { key: 'activity_count', label: 'Activity count' }
];
const DEFAULT_EXPORT_COLUMNS = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.key, !!c.default]));

export default function ContactsTab({ triggerMessage, isStaff = false, initialStatus = '' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState({ open: false, contactId: null });
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Multi-select Stage (array of lifecycle buckets). Defaults to ['lead']; a truthy URL-driven
  // initialStatus (e.g. active-clients/archive redirects) seeds a single-stage selection.
  const [statusFilter, setStatusFilter] = useState(
    initialStatus && STATUS_VALUES.includes(initialStatus) ? [initialStatus] : DEFAULT_STATUS_FILTER
  );
  // Multi-select: arrays of tag/service ids. A contact must carry ALL selected (AND).
  const [tagFilter, setTagFilter] = useState([]);
  const [serviceFilter, setServiceFilter] = useState([]);
  // Multi-select lead categories (OR). Defaults to Qualified so the list isn't cluttered
  // with spam/not-a-fit/unanswered/unclassified contacts.
  const [categoryFilter, setCategoryFilter] = useState(DEFAULT_CATEGORY_FILTER);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [tags, setTags] = useState([]);
  const [services, setServices] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState(DEFAULT_EXPORT_COLUMNS);
  const [mergeQueueOpen, setMergeQueueOpen] = useState(false);
  const [mergeCount, setMergeCount] = useState(0);

  // --- Tutorial drawer choreography (contacts-overview) ---
  // Steps 7–10 of the contacts-overview tutorial describe the profile drawer, so
  // auto-open it with a mock contact for that range (no PHI, no empty-state stall).
  // Keep this index range in sync with src/tutorials/contacts.js.
  const { activeTutorial, mockData: tutorialMockData } = useTutorial();
  const tutorialId = activeTutorial?.tutorial?.id;
  const tutorialStepIndex = activeTutorial?.stepIndex ?? -1;
  const drawerTutorialMode = tutorialId === 'contacts-overview' && tutorialStepIndex >= 7 && tutorialStepIndex <= 10;
  const tutorialContact = tutorialMockData?.contact || null;
  const tutorialContactTimeline = tutorialMockData?.contactTimeline || null;

  // Open the drawer (with the mock contact) while the tour is on the drawer steps;
  // close it when the tour leaves that range — but only if the mock is what's showing,
  // so a real contact a user opened isn't yanked shut.
  useEffect(() => {
    if (drawerTutorialMode && tutorialContact) {
      setDrawer({ open: true, contactId: TUTORIAL_MOCK_CONTACT_ID });
    } else if (!drawerTutorialMode) {
      setDrawer((prev) => (prev.contactId === TUTORIAL_MOCK_CONTACT_ID ? { open: false, contactId: null } : prev));
    }
  }, [drawerTutorialMode, tutorialContact]);

  // Re-apply the URL-driven status when it changes (e.g. the /active-clients or ?tab=archive
  // redirects land while this tab is already mounted — useState only seeds on first mount).
  useEffect(() => {
    // A valid URL-driven status seeds a single-stage selection; clearing it (or an invalid
    // value) returns to the default rather than leaving a stale selection.
    setStatusFilter(initialStatus && STATUS_VALUES.includes(initialStatus) ? [initialStatus] : DEFAULT_STATUS_FILTER);
  }, [initialStatus]);

  // Debounce the free-text search ~300ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to page 1 whenever the query (search/filters) changes. Arrays are joined so the
  // effect compares by value, not identity (a fresh [] each render would loop otherwise).
  const statusKey = statusFilter.join(',');
  const tagKey = tagFilter.join(',');
  const serviceKey = serviceFilter.join(',');
  const categoryKey = categoryFilter.join(',');
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusKey, tagKey, serviceKey, categoryKey]);

  // Load the filter dropdowns once: tags actually applied to contacts + the service catalog.
  useEffect(() => {
    let active = true;
    fetchContactTagOptions()
      .then((list) => {
        if (active) setTags(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        /* tag filter is optional — silently skip if it fails */
      });
    fetchServices()
      .then((list) => {
        if (active) setServices(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        /* service filter is optional — silently skip if it fails */
      });
    return () => {
      active = false;
    };
  }, []);

  // Staff only: pending merge-candidate count for the "Review merges" badge.
  const loadMergeCount = useCallback(() => {
    if (!isStaff) return;
    fetchMergeCandidates('pending')
      .then((list) => setMergeCount(Array.isArray(list) ? list.length : 0))
      .catch(() => {});
  }, [isStaff]);

  useEffect(() => {
    loadMergeCount();
  }, [loadMergeCount]);

  // Current filter set — shared by the list load and the CSV export so they stay aligned.
  // Multi-select tag/service arrays are sent as comma-separated UUID lists (server ANDs them).
  const currentFilters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: statusKey || undefined,
      tag: tagKey || undefined,
      service: serviceKey || undefined,
      category: categoryKey || undefined
    }),
    [debouncedSearch, statusKey, tagKey, serviceKey, categoryKey]
  );

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const { contacts, pagination: pg } = await fetchContacts({ ...currentFilters, page, limit: PAGE_SIZE });
      setRows(Array.isArray(contacts) ? contacts : []);
      setPagination(pg);
    } catch (err) {
      triggerMessage?.('error', err?.message || 'Unable to load contacts');
    } finally {
      setLoading(false);
    }
  }, [currentFilters, page, triggerMessage]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Cross-client sync: refetch the list when another staff member edits contacts/journeys elsewhere.
  useStateVersionPoll(loadContacts);

  // Quick archive / restore straight from a list row (no drawer). Archiving drops the contact
  // from the current view immediately (CLAUDE.md hard rule); reverts + toasts on error. Restore
  // is offered on the Archived view so the action is reversible in one click.
  const handleArchiveRow = useCallback(
    async (row) => {
      const next = !row.archived_at;
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      try {
        await archiveContact(row.id, next);
        triggerMessage?.('success', next ? 'Contact archived' : 'Contact restored');
        loadContacts(); // reconcile counts/pagination — row is already gone from the view
      } catch (err) {
        setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
        triggerMessage?.('error', err?.message || 'Unable to update archive state');
      }
    },
    [loadContacts, triggerMessage]
  );

  // Export the current filtered set (all pages, capped server-side at 10k) to CSV, with the
  // columns chosen in the dialog. Defaults to Name/Phone/Email/Tags/Services.
  const runExport = useCallback(async () => {
    const columns = EXPORT_COLUMNS.filter((c) => exportColumns[c.key]).map((c) => c.key);
    if (!columns.length) {
      triggerMessage?.('error', 'Pick at least one column to export');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportContactsCsv({ ...currentFilters, columns: columns.join(',') });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contacts.csv';
      a.click();
      URL.revokeObjectURL(url);
      setExportDialogOpen(false);
      triggerMessage?.('success', 'Export ready');
    } catch (err) {
      triggerMessage?.('error', err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [currentFilters, exportColumns, triggerMessage]);

  // id → name lookups for rendering selected chips in the multi-select inputs.
  const tagNameById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t.name])), [tags]);
  const serviceNameById = useMemo(() => Object.fromEntries(services.map((s) => [s.id, s.name])), [services]);

  const columns = useMemo(
    () => [
      {
        id: 'display_name',
        label: 'Name',
        render: (row) => (
          <Stack spacing={0}>
            <Typography variant="body2" fontWeight={600}>
              {row.display_name || 'Unknown'}
            </Typography>
            {row.display_name_source === 'user' && (
              <Typography variant="caption" color="text.secondary">
                ✎ set by you
              </Typography>
            )}
          </Stack>
        )
      },
      { id: 'primary_phone', label: 'Phone', render: (row) => row.primary_phone || '—' },
      { id: 'primary_email', label: 'Email', render: (row) => row.primary_email || '—' },
      {
        id: 'disposition',
        label: 'Status',
        render: (row) => {
          if (row.archived_at) return <StatusChip status="archived" label="Archived" />;
          const d = DISPOSITION_CHIP[row.disposition] || { status: 'unknown', label: row.disposition || 'Pending Review' };
          const badge = LIFECYCLE_BADGE[row.lifecycle];
          return (
            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <StatusChip status={d.status} label={d.label} />
              {badge && <StatusChip status={badge.status} label={badge.label} size="small" variant="outlined" />}
            </Stack>
          );
        }
      },
      {
        id: 'tags',
        label: 'Tags',
        sortable: false,
        render: (row) =>
          Array.isArray(row.tags) && row.tags.length ? (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {row.tags.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontSize: '0.7rem',
                    height: 20,
                    ...(tag.color ? { borderColor: tag.color, color: tag.color } : {})
                  }}
                />
              ))}
            </Stack>
          ) : (
            '—'
          )
      },
      {
        id: 'services',
        label: 'Services',
        sortable: false,
        render: (row) =>
          Array.isArray(row.services) && row.services.length ? (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {row.services.map((name) => (
                <Chip key={name} label={name} size="small" sx={{ fontSize: '0.7rem', height: 20 }} />
              ))}
            </Stack>
          ) : (
            '—'
          )
      },
      {
        id: 'last_activity_at',
        label: 'Last activity',
        render: (row) => formatShortDate(row.last_activity_at)
      },
      { id: 'activity_count', label: 'Activity', align: 'right', render: (row) => row.activity_count ?? 0 },
      {
        id: 'rowArchive',
        label: '',
        align: 'right',
        sortable: false,
        render: (row) => (
          <Tooltip title={row.archived_at ? 'Restore contact' : 'Archive contact'}>
            <IconButton
              size="small"
              color={row.archived_at ? 'success' : 'error'}
              aria-label={row.archived_at ? 'Restore contact' : 'Archive contact'}
              onClick={(e) => {
                e.stopPropagation();
                handleArchiveRow(row);
              }}
            >
              {row.archived_at ? <UnarchiveOutlinedIcon fontSize="small" /> : <ArchiveOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )
      }
    ],
    [handleArchiveRow]
  );

  const totalPages = pagination?.pages || 1;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          data-tutorial="contacts-search"
          size="small"
          placeholder="Search name, phone, or email"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          sx={{ flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 120 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
        />
        <SelectField
          data-tutorial="contacts-status"
          label="Stage"
          multiple
          value={statusFilter}
          onChange={(e) => setStatusFilter(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
          size="small"
          fullWidth={false}
          sx={{ width: 160, flexShrink: 0 }}
          renderValue={(selected) =>
            selected.length === 0
              ? 'All stages'
              : selected.length === 1
                ? STATUS_OPTIONS.find((o) => o.value === selected[0])?.label || '1 stage'
                : `${selected.length} stages`
          }
        >
          {STATUS_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              <Checkbox size="small" checked={statusFilter.includes(o.value)} />
              <ListItemText primary={o.label} />
            </MenuItem>
          ))}
        </SelectField>
        <SelectField
          data-tutorial="contacts-category"
          label="Disposition"
          multiple
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
          size="small"
          fullWidth={false}
          sx={{ width: 160, flexShrink: 0 }}
          renderValue={(selected) =>
            selected.length === 0
              ? 'All dispositions'
              : selected.length === 1
                ? CATEGORY_OPTIONS.find((o) => o.value === selected[0])?.label || '1 disposition'
                : `${selected.length} dispositions`
          }
        >
          {CATEGORY_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              <Checkbox size="small" checked={categoryFilter.includes(o.value)} />
              <ListItemText primary={o.label} />
            </MenuItem>
          ))}
        </SelectField>
        <SelectField
          data-tutorial="contacts-tags"
          label="Tags"
          multiple
          value={tagFilter}
          onChange={(e) => setTagFilter(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
          size="small"
          fullWidth={false}
          sx={{ width: 150, flexShrink: 0 }}
          renderValue={(selected) => (selected.length === 1 ? tagNameById[selected[0]] || '1 tag' : `${selected.length} tags`)}
        >
          {tags.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              <Checkbox size="small" checked={tagFilter.includes(t.id)} />
              <ListItemText primary={t.name} />
            </MenuItem>
          ))}
        </SelectField>
        <SelectField
          data-tutorial="contacts-services"
          label="Services"
          multiple
          value={serviceFilter}
          onChange={(e) => setServiceFilter(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
          size="small"
          fullWidth={false}
          sx={{ width: 150, flexShrink: 0 }}
          renderValue={(selected) => (selected.length === 1 ? serviceNameById[selected[0]] || '1 service' : `${selected.length} services`)}
        >
          {services.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              <Checkbox size="small" checked={serviceFilter.includes(s.id)} />
              <ListItemText primary={s.name} />
            </MenuItem>
          ))}
        </SelectField>
        <Button
          data-tutorial="contacts-export"
          variant="outlined"
          size="small"
          startIcon={<DownloadIcon />}
          onClick={() => setExportDialogOpen(true)}
          disabled={!rows.length && !loading}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          Export CSV
        </Button>
        {isStaff && (
          <Badge badgeContent={mergeCount} color="primary" sx={{ '& .MuiBadge-badge': { right: 4, top: 4 } }}>
            <Button variant="outlined" size="small" startIcon={<MergeTypeIcon />} onClick={() => setMergeQueueOpen(true)}>
              Review merges
            </Button>
          </Badge>
        )}
      </Stack>

      <Box data-tutorial="contacts-table">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          searchable={false}
          paginated={false}
          loading={loading}
          outlined
          onRowClick={(row) => setDrawer({ open: true, contactId: row.id })}
          emptyIcon={<PeopleAltIcon />}
          emptyTitle="No contacts yet"
          emptyMessage="Contacts appear here as calls and form submissions come in."
        />
      </Box>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_e, value) => setPage(value)}
            color="primary"
            size="small"
            disabled={loading}
          />
        </Box>
      )}

      <ContactProfileDrawer
        open={drawer.open}
        contactId={drawer.contactId}
        isStaff={isStaff}
        tutorialMode={drawerTutorialMode}
        tutorialDetail={drawerTutorialMode ? tutorialContact : null}
        tutorialTimeline={drawerTutorialMode ? tutorialContactTimeline : null}
        onClose={() => setDrawer({ open: false, contactId: null })}
        onContactUpdated={(u) => {
          // Archive/restore changes whether the row belongs in the current view. Update
          // local rows immediately (CLAUDE.md hard rule — don't rely on refetch alone),
          // then reconcile with a reload (fixes pagination counts). A row belongs in the view
          // when its stage bucket is among the selected stages (archived wins as its own
          // bucket); empty selection = all non-archived (mirrors the server default).
          if (Object.prototype.hasOwnProperty.call(u, 'archived_at')) {
            const selectedStages = statusFilter.length ? statusFilter : ['lead', 'in_journey', 'active_client'];
            setRows((prev) =>
              prev
                .map((r) => (r.id === u.id ? { ...r, archived_at: u.archived_at } : r))
                .filter((r) => selectedStages.includes(r.archived_at ? 'archived' : r.lifecycle))
            );
            loadContacts();
            return;
          }
          setRows((prev) =>
            prev.map((r) => (r.id === u.id ? { ...r, display_name: u.display_name, display_name_source: u.display_name_source } : r))
          );
        }}
        onContactSplit={() => {
          loadContacts();
        }}
      />

      {isStaff && (
        <Drawer anchor="right" open={mergeQueueOpen} onClose={() => setMergeQueueOpen(false)}>
          <MergeQueuePanel
            onResolved={() => {
              loadMergeCount();
              loadContacts();
            }}
          />
        </Drawer>
      )}

      <FormDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onSubmit={runExport}
        title="Export contacts to CSV"
        maxWidth="xs"
        loading={exporting}
        loadingLabel="Exporting…"
        submitLabel="Export"
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Exports every contact matching your current filters (all pages), not just this page. Choose the columns to include.
        </Typography>
        <FormGroup>
          {EXPORT_COLUMNS.map((col) => (
            <FormControlLabel
              key={col.key}
              control={
                <Checkbox
                  size="small"
                  checked={!!exportColumns[col.key]}
                  onChange={(e) => setExportColumns((prev) => ({ ...prev, [col.key]: e.target.checked }))}
                />
              }
              label={col.label}
            />
          ))}
        </FormGroup>
      </FormDialog>
    </Stack>
  );
}
