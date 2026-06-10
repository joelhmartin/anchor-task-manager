import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import useTutorial from 'hooks/useTutorial';
import useAuth from 'hooks/useAuth';
import { useToast } from 'contexts/ToastContext';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Skeleton from '@mui/material/Skeleton';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import CloseIcon from '@mui/icons-material/Close';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import CallMadeIcon from '@mui/icons-material/CallMade';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import SearchIcon from '@mui/icons-material/Search';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import PeopleIcon from '@mui/icons-material/People';
import StarIcon from '@mui/icons-material/Star';
import WarningIcon from '@mui/icons-material/Warning';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Replay10Icon from '@mui/icons-material/Replay10';
import Forward10Icon from '@mui/icons-material/Forward10';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import client from 'api/client';
import { splitQualifiedReturning } from './leads/leadCategory';
import PipelineBoard from './leads/PipelineBoard';
import EmailTemplatesPane from './leads/EmailTemplatesPane';
import { stageLabel, STAGE_COLORS } from './leads/journeyHelpers';
import ContactActivityExpander from './leads/ContactActivityExpander';
import ContactsTab from './ContactsTab';
import { fetchContacts, deleteContactNote } from 'api/contacts';
import {
  fetchCalls,
  syncCalls,
  clearAndReloadCalls,
  fetchLeadStats,
  fetchLeadDetail,
  fetchLeadRecordingBlob,
  fetchPipelineStages,
  fetchLeadNotes,
  addLeadNote,
  deleteLeadNote,
  fetchAllTags,
  addTagToCall,
  removeTagFromCall,
  updateCallCategory,
  hideCall,
  hideSingleCall,
  unhideCall,
  renameContact
} from 'api/calls';

// Category color mapping for visual distinction
const CATEGORY_COLORS = {
  converted: { bg: '#d1fae5', text: '#047857', border: '#34d399' }, // Green - successful conversion (manual only)
  active_client: { bg: '#dbeafe', text: '#1e40af', border: '#60a5fa' }, // Blue - existing customer
  returning_customer: { bg: '#e0e7ff', text: '#4338ca', border: '#818cf8' }, // Indigo - past customer returning
  warm: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  very_good: { bg: '#bbf7d0', text: '#065f46', border: '#6ee7b7' },
  applicant: { bg: '#fef3c7', text: '#92400e', border: '#fbbf24' }, // Job applicant
  needs_attention: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  voicemail: { bg: '#f5f5f5', text: '#525252', border: '#d4d4d4' },
  unanswered: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' },
  not_a_fit: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  spam: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  neutral: { bg: '#f5f5f5', text: '#525252', border: '#d4d4d4' },
  unreviewed: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' }
};

const getCategoryColor = (callOrCategory) => {
  const lead = typeof callOrCategory === 'object' && callOrCategory !== null ? callOrCategory : null;
  const rawCategory = lead ? lead.category : callOrCategory;
  if (lead && lead.classification_pending) {
    return VISIBLE_CATEGORY_COLORS.pending_review;
  }
  const base = VISIBLE_CATEGORY_MAP[rawCategory?.toLowerCase()] || 'lead';
  const mapped = splitQualifiedReturning(base, lead);
  return VISIBLE_CATEGORY_COLORS[mapped] || CATEGORY_COLORS.unreviewed;
};

// Map raw server categories to collapsed front-desk visible set
const VISIBLE_CATEGORY_MAP = {
  warm: 'lead',
  very_good: 'lead',
  very_hot: 'lead',
  'very-hot': 'lead',
  hot: 'lead',
  neutral: 'lead',
  needs_attention: 'needs_attention',
  unanswered: 'unanswered',
  voicemail: 'unanswered',
  not_a_fit: 'not_a_fit',
  applicant: 'not_a_fit',
  spam: 'spam',
  converted: 'lead', // legacy — conversion is lifecycle, not triage
  active_client: 'lead',
  returning_customer: 'lead',
  // `unreviewed` maps to 'lead', NOT 'pending_review'. Pending Review is now
  // gated on meta.classification_pending (see getVisibleCategory). A row whose
  // raw category is "unreviewed" but where the classifier actually ran — e.g.
  // an opt-in form with just name/email — belongs in Leads, not Pending.
  unreviewed: 'lead'
};

const VISIBLE_CATEGORY_LABELS = {
  qualified: 'Qualified',
  returning: 'Returning/Other',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};

// Order of the filter-chip row. `needs_attention` (Priority) is intentionally
// omitted — Priority leads are folded into the Qualified list (ordered by date)
// rather than sitting behind their own filter chip. Per-row Priority chips still
// use VISIBLE_CATEGORY_LABELS / VISIBLE_CATEGORY_COLORS above, which retain the
// needs_attention entry.
// 'returning' (Returning/Other) is no longer its own chip — those leads surface under the
// 'All Activity' firehose (the first chip, handled separately). Qualified stays the default.
const CATEGORY_FILTER_CHIPS = ['qualified', 'unanswered', 'not_a_fit', 'spam', 'pending_review'];

const formatAudioTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

async function buildWaveformFromBlob(blob, bars = 56) {
  if (typeof window === 'undefined' || !blob) return [];
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return [];

  const audioContext = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    if (!channelData?.length) return [];

    const blockSize = Math.max(1, Math.floor(channelData.length / bars));
    const points = [];
    for (let i = 0; i < bars; i += 1) {
      const start = i * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let peak = 0;
      for (let j = start; j < end; j += 1) {
        const value = Math.abs(channelData[j]);
        if (value > peak) peak = value;
      }
      points.push(peak);
    }

    const max = Math.max(...points, 0.01);
    return points.map((value) => Math.max(0.12, value / max));
  } catch {
    return [];
  } finally {
    await audioContext.close().catch(() => {});
  }
}

const VISIBLE_CATEGORY_COLORS = {
  qualified: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  returning: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  needs_attention: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  unanswered: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  not_a_fit: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  spam: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  pending_review: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
};

const DEFAULT_VISIBLE_CATEGORY_FILTER = 'qualified';
// Default everyone to the current month (was 'all_time') so the Leads view opens scoped to
// recent activity. Users who saved an explicit default view keep their own preset.
const DEFAULT_DATE_PRESET = 'this_month';
// Sentinel for the "All Time" preset (empty date range). Kept distinct from
// DEFAULT_DATE_PRESET so the default (This Month) and All Time don't collide.
const ALL_TIME_DATE_PRESET = 'all_time';

const ACTIVITY_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'call', label: 'Call' },
  { value: 'sms', label: 'SMS' },
  { value: 'form', label: 'Form' }
];

const defaultViewStorageKey = (userId) => (userId ? `leads-default-view:${userId}` : null);

// localStorage is user-controllable — even though only this user can write to
// it, the values flow into filter state and API request params. Normalize the
// payload against allowlists before returning so a malformed or tampered blob
// can't push invalid values downstream.
const ALLOWED_ACTIVITY_TYPES = new Set(['all', 'call', 'sms', 'form']);
const ALLOWED_VIEW_MODES = new Set(['card', 'table']);
const ALLOWED_DATE_PRESETS = new Set(['all_time', 'today', 'this_week', 'this_month', 'custom']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const sanitizeDateRange = (range) => {
  if (!range || typeof range !== 'object') return undefined;
  const from = typeof range.from === 'string' && (range.from === '' || ISO_DATE_RE.test(range.from)) ? range.from : '';
  const to = typeof range.to === 'string' && (range.to === '' || ISO_DATE_RE.test(range.to)) ? range.to : '';
  return { from, to };
};

const sanitizeDefaultView = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return null;
  const out = {};
  if (parsed.callFilters && typeof parsed.callFilters === 'object') {
    const cf = {};
    if (ALLOWED_ACTIVITY_TYPES.has(parsed.callFilters.type)) cf.type = parsed.callFilters.type;
    if (typeof parsed.callFilters.category === 'string') {
      // Legacy saved views may persist a category that no longer has a filter
      // chip: the old 'lead' (now split into qualified/returning) or
      // 'needs_attention' (Priority, now folded into Qualified). Normalize both
      // to 'qualified' on load so a hydrated filter always maps to a selectable chip.
      const legacyCategory = parsed.callFilters.category;
      cf.category = legacyCategory === 'lead' || legacyCategory === 'needs_attention' ? 'qualified' : legacyCategory;
    }
    if (Object.keys(cf).length) out.callFilters = cf;
  }
  if (typeof parsed.lifecycleFilter === 'string') out.lifecycleFilter = parsed.lifecycleFilter;
  if (ALLOWED_VIEW_MODES.has(parsed.viewMode)) out.viewMode = parsed.viewMode;
  if (ALLOWED_DATE_PRESETS.has(parsed.datePreset)) out.datePreset = parsed.datePreset;
  const dr = sanitizeDateRange(parsed.dateRange);
  if (dr) out.dateRange = dr;
  if (Number.isInteger(parsed.perPage) && parsed.perPage >= 5 && parsed.perPage <= 200) out.perPage = parsed.perPage;
  return Object.keys(out).length ? out : null;
};

const loadDefaultView = (userId) => {
  const key = defaultViewStorageKey(userId);
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return sanitizeDefaultView(JSON.parse(raw));
  } catch {
    return null;
  }
};

const formatDateInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDisplaySummary = (summary, fallback = '') => {
  const text = String(summary || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  if (text === '{' || text === '[') return fallback;
  if (/^```/.test(text)) return fallback;
  if (/^\{/.test(text)) return fallback;
  if (/^"category"/i.test(text)) return fallback;
  if (/^okay,\s*i'?m ready to classify/i.test(text)) return fallback;
  if (/^i need the actual message content/i.test(text)) return fallback;
  if (/once you provide the message/i.test(text)) return fallback;
  return text;
};

const getDatePresetRange = (preset) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === 'today') {
    const date = formatDateInput(today);
    return { from: date, to: date };
  }

  if (preset === 'this_week') {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    return { from: formatDateInput(start), to: formatDateInput(today) };
  }

  if (preset === 'this_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: formatDateInput(start), to: formatDateInput(today) };
  }

  return { from: '', to: '' };
};

const detectDatePreset = (range) => {
  if (!range?.from && !range?.to) return ALL_TIME_DATE_PRESET;

  for (const preset of ['today', 'this_week', 'this_month']) {
    const presetRange = getDatePresetRange(preset);
    if (presetRange.from === (range.from || '') && presetRange.to === (range.to || '')) {
      return preset;
    }
  }

  return 'custom';
};

// Get visible category label for display. "Pending Review" is a state flag
// (meta.classification_pending), not a category value — a row whose category
// is "unreviewed" because the classifier intentionally landed there (e.g. an
// opt-in form with just name/email) is still a Lead. Only flag pending when
// the AI never produced a usable result.
const getVisibleCategory = (callOrCategory) => {
  const lead = typeof callOrCategory === 'object' && callOrCategory !== null ? callOrCategory : null;
  const rawCategory = lead ? lead.category : callOrCategory;
  const isPending = lead ? Boolean(lead.classification_pending) : false;
  if (isPending) {
    return { key: 'pending_review', label: VISIBLE_CATEGORY_LABELS.pending_review };
  }
  const base = VISIBLE_CATEGORY_MAP[(rawCategory || 'unreviewed').toLowerCase()] || 'lead';
  const mapped = splitQualifiedReturning(base, lead);
  return { key: mapped, label: VISIBLE_CATEGORY_LABELS[mapped] || 'Qualified' };
};

const needsCallbackFollowUp = (lead) => Boolean(lead?.requires_callback || (lead?.is_voicemail && lead?.category === 'needs_attention'));

// `showClientProvided` gates the "Client Provided" chip — it only makes sense to
// agency staff viewing a client's portal (it means "the category was set by hand
// and reclassification won't touch it"). To the client themselves it's confusing
// ("client" reads as their own customers), so hide it outside the admin/acting view.
const getSystemTags = (lead, userTags = [], { showClientProvided = false } = {}) => {
  const seen = new Set(
    userTags
      .map((tag) =>
        String(tag.name || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
  const rawSystemTags = Array.isArray(lead?.system_tags)
    ? lead.system_tags
    : [
        ...(lead?.is_referral ? [{ key: 'referral', label: 'Referral', color: '#0f766e' }] : []),
        ...(lead?.category_source === 'client' ? [{ key: 'client_provided', label: 'Client Provided', color: '#1d4ed8' }] : []),
        ...((lead?.semantic_category || lead?.category) === 'applicant' ? [{ key: 'applicant', label: 'Applicant', color: '#92400e' }] : [])
      ];

  return rawSystemTags.filter((tag) => {
    if (!showClientProvided && (tag?.key === 'client_provided' || tag?.label === 'Client Provided')) return false;
    const key = String(tag?.label || tag?.name || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const OPEN_JOURNEY_TERMINAL_STATUSES = new Set(['active_client', 'won', 'lost', 'archived']);

const getOpenJourney = (...journeys) =>
  journeys.find((journey) => {
    if (!journey) return false;
    const status = String(journey.status || 'in_progress').toLowerCase();
    return !OPEN_JOURNEY_TERMINAL_STATUSES.has(status);
  }) || null;

// Format E.164 phone numbers to US (XXX) XXX-XXXX or international +X XXX...
const formatPhone = (raw) => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw; // non-US — return as-is
};

export default function LeadsTab({
  isActiveTab = true,
  triggerMessage,
  services,
  loadServices,
  journeyByLeadId,
  onOpenConcernDialog,
  onOpenServiceDialog,
  isAdmin,
  actingClientId,
  journeys,
  journeysLoading,
  openJourneyDrawer,
  applyJourneyUpdate,
  leadDrawerOpenerRef
}) {
  // Real warning-severity toast: triggerMessage renders every non-error as a green
  // success Alert, which would mis-style a CTM-failure warning. useToast preserves severity.
  const toast = useToast();
  // Tutorial mock data hook — must be above loadCalls so we can guard fetches
  const { mockData: tutorialMockData } = useTutorial();
  const hasTutorialMockLeads = !!tutorialMockData?.calls;
  const tutorialMockRef = useRef(hasTutorialMockLeads);
  tutorialMockRef.current = hasTutorialMockLeads;

  const { user } = useAuth();
  const savedDefaultView = useMemo(() => loadDefaultView(user?.id), [user?.id]);

  const [calls, setCalls] = useState(null);
  const [callsLoading, setCallsLoading] = useState(true);
  // Background-refresh: number of newly-ingested leads not yet shown. Surfaced as a
  // non-disruptive "N new leads" pill so an open page never silently re-sorts under the
  // user — they click to pull them in. knownLeadIdsRef holds the ids currently displayed.
  const [newLeadsAvailable, setNewLeadsAvailable] = useState(0);
  const knownLeadIdsRef = useRef(new Set());
  const [callFilters, setCallFilters] = useState(() => ({
    type: savedDefaultView?.callFilters?.type ?? 'all',
    category: savedDefaultView?.callFilters?.category ?? DEFAULT_VISIBLE_CATEGORY_FILTER
  }));
  const [lifecycleFilter, setLifecycleFilter] = useState(() => {
    // Valid in-Leads views: lead_inbox (qualified inbox), all (All-Activity firehose chip),
    // in_journey (Lead Journeys), contacts (Contacts). 'active_client' was retired → inbox.
    const saved = savedDefaultView?.lifecycleFilter;
    return ['lead_inbox', 'all', 'in_journey', 'contacts'].includes(saved) ? saved : 'lead_inbox';
  });
  const [lifecycleCounts, setLifecycleCounts] = useState({ lead_inbox: 0, in_journey: 0, active_client: 0, all: 0 });
  const [showHidden, setShowHidden] = useState(false);
  const [hidePopover, setHidePopover] = useState({ anchorEl: null, call: null });
  const [clearCallsDialogOpen, setClearCallsDialogOpen] = useState(false);
  const [reclassifyDialog, setReclassifyDialog] = useState({ open: false, loading: false, days: 7 });
  const [actionsMenuAnchor, setActionsMenuAnchor] = useState(null);
  const [fullSyncing, setFullSyncing] = useState(false);

  // CRM Enhancement State
  const [leadStats, setLeadStats] = useState(null);
  const [, /* leadStatsLoading */ setLeadStatsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState(() => {
    // No saved view → fall back to the default preset (now 'this_month') so the initial
    // range matches the default preset rather than opening on all-time.
    const preset = savedDefaultView?.datePreset ?? DEFAULT_DATE_PRESET;
    // Recompute relative presets at load time (today/this_week/this_month move
    // with the calendar). For 'custom' (or any other preset whose range is
    // user-defined), fall back to the persisted explicit range.
    const RELATIVE_PRESETS = new Set(['today', 'this_week', 'this_month']);
    if (RELATIVE_PRESETS.has(preset)) return getDatePresetRange(preset);
    return savedDefaultView?.dateRange ?? { from: '', to: '' };
  });
  const [datePreset, setDatePreset] = useState(() => savedDefaultView?.datePreset ?? DEFAULT_DATE_PRESET);
  const [viewMode, setViewMode] = useState(() => savedDefaultView?.viewMode ?? 'card'); // 'card' or 'table'
  const [journeySubTab, setJourneySubTab] = useState(0); // 0 = Pipeline, 1 = Email Templates
  // All Activity is a firehose view and always renders as a table regardless of user preference.
  // In Journey + Contacts are entity-grouped sub-views (rendered inline below the tab bar).
  const isEntityGrouped = lifecycleFilter === 'in_journey' || lifecycleFilter === 'contacts';
  const effectiveViewMode = lifecycleFilter === 'all' ? 'table' : viewMode;

  // Contacts count for the 'Contacts' switcher tab badge (cheap — pull pagination.total only).
  const [contactsCount, setContactsCount] = useState(null);
  useEffect(() => {
    let active = true;
    fetchContacts({ page: 1, limit: 1 })
      .then(({ pagination: pg }) => {
        if (active && pg) setContactsCount(pg.total ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const [pagination, setPagination] = useState({ page: 1, limit: savedDefaultView?.perPage ?? 20, total: 0 });
  const [searchParams, setSearchParams] = useSearchParams();
  const [leadDetailDrawer, setLeadDetailDrawer] = useState({ open: false, lead: null, detail: null, loading: false, tab: 0 });
  const [renameState, setRenameState] = useState({ editing: false, value: '', saving: false });
  const [recordingState, setRecordingState] = useState({
    callId: null,
    loading: false,
    error: '',
    src: '',
    waveform: [],
    currentTime: 0,
    duration: 0,
    playing: false,
    volume: 1,
    playbackRate: 1
  });
  const [, /* pipelineStages */ setPipelineStages] = useState([]);
  const [leadNotes, setLeadNotes] = useState({});
  const [newNoteText, setNewNoteText] = useState('');

  // Tags state
  const [allTags, setAllTags] = useState([]);
  const [callTags, setCallTags] = useState({}); // { callId: [tags] }
  const [, /* tagDialogOpen */ setTagDialogOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [categoryMenuAnchor, setCategoryMenuAnchor] = useState(null);
  const [categoryMenuCallId, setCategoryMenuCallId] = useState(null);

  const [ctmSyncing, setCtmSyncing] = useState(false);
  const [categoryCounts, setCategoryCounts] = useState({});
  const latestLoadRequestRef = useRef(0);
  // Tracks the lead id the detail drawer is currently open on, so an async note load/add/delete
  // that resolves after the drawer has switched leads can't apply its result to the new one.
  const activeLeadDrawerIdRef = useRef(null);
  const audioRef = useRef(null);
  const recordingObjectUrlRef = useRef(null);
  const showLifecycleFilters = lifecycleFilter === 'lead_inbox' || lifecycleFilter === 'all';
  const hasLeadOnlyFilters =
    dateRange.from || dateRange.to || callFilters.type !== 'all' || callFilters.category !== DEFAULT_VISIBLE_CATEGORY_FILTER;
  const hasVisibleFilters = Boolean(
    searchQuery || showHidden || lifecycleFilter !== 'lead_inbox' || (showLifecycleFilters && hasLeadOnlyFilters)
  );

  // Helper: build current filter params (shared by loadCalls, syncAndRefresh, handleManualCtmSync)
  const buildFilterParams = useCallback(
    (overrides = {}) => {
      const includeLifecycleFilters = lifecycleFilter === 'lead_inbox' || lifecycleFilter === 'all';
      const params = {
        page: overrides.page || pagination.page,
        limit: overrides.limit || pagination.limit
      };
      if (showHidden) params.show_hidden = 'true';
      if (searchQuery) params.search = searchQuery;
      if (includeLifecycleFilters && dateRange.from) params.date_from = dateRange.from;
      if (includeLifecycleFilters && dateRange.to) params.date_to = dateRange.to;
      // Category applies only to the qualified inbox. 'All Activity' (lifecycleFilter === 'all')
      // is the firehose — never send a category, regardless of the last-selected chip (which is
      // preserved in state so returning to New Leads restores it).
      if (lifecycleFilter === 'lead_inbox' && callFilters.category) params.category = callFilters.category;
      if (includeLifecycleFilters && callFilters.type && callFilters.type !== 'all') params.activity_type = callFilters.type;
      if (lifecycleFilter && lifecycleFilter !== 'all') params.lifecycle = lifecycleFilter;
      return params;
    },
    [searchQuery, dateRange, callFilters, lifecycleFilter, pagination.page, pagination.limit, showHidden]
  );

  // Helper: apply fetched call data to state
  const applyCallData = useCallback(({ calls: fetchedCalls, pagination: pag, categoryCounts: counts, lifecycleCounts: lcCounts }) => {
    setCalls(fetchedCalls);
    // The just-applied list now includes whatever was pending, so clear the "new leads" pill.
    setNewLeadsAvailable(0);
    if (pag) setPagination(pag);
    if (counts) setCategoryCounts(counts);
    if (lcCounts) setLifecycleCounts(lcCounts);
    // Hydrate callTags from server-provided tags
    const tags = {};
    fetchedCalls.forEach((call) => {
      if (call.tags?.length) tags[call.id] = call.tags;
    });
    setCallTags((prev) => ({ ...prev, ...tags }));
  }, []);

  // Cache-only fetch — fast, no CTM sync
  const loadCalls = useCallback(
    async (options = {}) => {
      if (tutorialMockRef.current) return;
      const requestId = latestLoadRequestRef.current + 1;
      latestLoadRequestRef.current = requestId;
      setCallsLoading(true);
      try {
        const data = await fetchCalls(buildFilterParams(options));
        if (latestLoadRequestRef.current !== requestId) return;
        applyCallData(data);
      } catch (err) {
        if (latestLoadRequestRef.current !== requestId) return;
        triggerMessage('error', err.message || 'Unable to load calls');
      } finally {
        if (latestLoadRequestRef.current === requestId) {
          setCallsLoading(false);
        }
      }
    },
    [triggerMessage, buildFilterParams, applyCallData]
  );

  // Sync with CTM then refresh — only called on initial mount or explicit user action
  const syncAndRefresh = useCallback(async () => {
    if (tutorialMockRef.current) return;
    setCtmSyncing(true);
    try {
      await syncCalls();
      // Always reconcile against the server after a sync — not only when the sync itself
      // reported new/updated rows. The background poll may have ingested leads since the
      // initial cache load, so refetching is what makes visiting Leads reliably reflect the
      // latest server state. Route through loadCalls() so this inherits its request-staleness
      // guard (latestLoadRequestRef) — a raw refetch could otherwise overwrite newer state if
      // the user changed filters/page mid-sync.
      await loadCalls();
    } catch (syncErr) {
      // Don't blank the page on a transient CTM hiccup, but don't silently imply the
      // list is current either — tell the user it may be stale so they can retry.
      // Exception: a client with no CTM credentials gets a 400 ("not configured") on
      // every mount — that's not a pull failure (there's no CTM source), so stay quiet.
      console.warn('[CTM Sync]', syncErr.message);
      if (syncErr?.response?.status !== 400) {
        toast.warning('Could not pull the latest leads from CTM just now — showing the most recent saved data.');
      }
    } finally {
      setCtmSyncing(false);
    }
  }, [loadCalls, toast]);

  // Keep the set of currently-displayed lead ids in sync for the background-refresh check.
  useEffect(() => {
    knownLeadIdsRef.current = new Set((calls || []).map((c) => c.id));
  }, [calls]);

  // Pull the new leads in (jump to the newest page); applyCallData clears the pill.
  const handleShowNewLeads = useCallback(() => {
    loadCalls({ page: 1 });
  }, [loadCalls]);

  // Background live-refresh: while the Leads tab is the active portal tab and visible,
  // quietly re-read the cached list every 45s (no CTM pull) and, if new leads have landed,
  // surface the pill rather than re-rendering the list under the user. The effect only runs
  // while isActiveTab is true — LeadsTab stays mounted (display:none) on other portal tabs,
  // so without this gate it would keep hitting /hub/calls there. Also paused when the browser
  // tab is backgrounded or a detail drawer is open, and disabled during the tutorial.
  useEffect(() => {
    if (hasTutorialMockLeads || !isActiveTab) return undefined;
    const POLL_MS = 45000;
    let cancelled = false; // a deps change (filters/page/tab) tears down this poll
    let inFlight = false; // don't stack a second fetch on a slow one
    const timer = setInterval(async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (leadDetailDrawer.open) return; // don't disrupt an open activity
      const known = knownLeadIdsRef.current;
      if (known.size === 0) return; // no baseline yet — don't flag the whole list as "new"
      inFlight = true;
      try {
        const data = await fetchCalls(buildFilterParams());
        if (cancelled) return; // view changed mid-flight — discard this stale result
        // Set unconditionally so a later poll that sees nothing new also clears the pill.
        const newCount = (data.calls || []).reduce((n, c) => (known.has(c.id) ? n : n + 1), 0);
        setNewLeadsAvailable(newCount);
      } catch {
        // Background refresh — stay silent; the on-load/explicit paths surface real errors.
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasTutorialMockLeads, isActiveTab, leadDetailDrawer.open, buildFilterParams]);

  // Load lead statistics for dashboard
  const loadLeadStats = useCallback(async () => {
    setLeadStatsLoading(true);
    try {
      const stats = await fetchLeadStats(30);
      setLeadStats(stats);
    } catch (err) {
      console.warn('[Lead Stats]', err.message);
    } finally {
      setLeadStatsLoading(false);
    }
  }, []);

  // Load pipeline stages
  const loadPipelineStages = useCallback(async () => {
    try {
      const stages = await fetchPipelineStages();
      setPipelineStages(stages);
    } catch (err) {
      console.warn('[Pipeline Stages]', err.message);
    }
  }, []);

  // Open lead detail drawer.
  // Accepts either a call_logs row (preferred — has all the inline fields) or a
  // bare { id } stub (e.g. from the journey drawer's Activity tab, which only
  // has the row shape returned by /hub/calls). When given a stub we still open
  // immediately so the drawer renders skeletons, then fetchLeadDetail fills in
  // the gaps.
  const handleOpenLeadDetail = useCallback(
    async (lead) => {
      // Open to Overview tab (tab: 0) by default — shows actions, tags, notes, lifecycle state
      // Normalize to a String so the staleness ref compares consistently with the deep-link
      // path (which seeds from a string searchParam) — "123" vs 123 must not read as a switch.
      activeLeadDrawerIdRef.current = String(lead.id);
      setLeadDetailDrawer({ open: true, lead, detail: null, loading: true, tab: 0 });
      try {
        const detail = await fetchLeadDetail(lead.id);
        // Ignore stale responses if the drawer moved to another lead mid-flight.
        if (activeLeadDrawerIdRef.current !== String(lead.id)) return;
        setLeadDetailDrawer((prev) => ({ ...prev, detail, loading: false }));
        // Load notes for this lead
        const notes = await fetchLeadNotes(lead.id);
        if (activeLeadDrawerIdRef.current !== String(lead.id)) return;
        setLeadNotes((prev) => ({ ...prev, [lead.id]: notes }));
      } catch {
        if (activeLeadDrawerIdRef.current !== String(lead.id)) return;
        triggerMessage('error', 'Failed to load lead details');
        setLeadDetailDrawer((prev) => ({ ...prev, loading: false }));
      }
    },
    [triggerMessage]
  );

  // Expose handleOpenLeadDetail to the parent through a ref. The MUI Drawer is
  // portal-mounted, so consumers (journey drawer, Journey tab) can invoke this
  // while LeadsTab is hidden (display:none) and still get the drawer overlay.
  useEffect(() => {
    if (!leadDrawerOpenerRef) return undefined;
    leadDrawerOpenerRef.current = handleOpenLeadDetail;
    return () => {
      if (leadDrawerOpenerRef.current === handleOpenLeadDetail) {
        leadDrawerOpenerRef.current = null;
      }
    };
  }, [leadDrawerOpenerRef, handleOpenLeadDetail]);

  const cleanupRecordingPlayer = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    if (recordingObjectUrlRef.current) {
      URL.revokeObjectURL(recordingObjectUrlRef.current);
      recordingObjectUrlRef.current = null;
    }
    setRecordingState({
      callId: null,
      loading: false,
      error: '',
      src: '',
      waveform: [],
      currentTime: 0,
      duration: 0,
      playing: false,
      volume: 1,
      playbackRate: 1
    });
  }, []);

  const handleCloseLeadDetail = useCallback(() => {
    cleanupRecordingPlayer();
    activeLeadDrawerIdRef.current = null;
    setLeadDetailDrawer({ open: false, lead: null, detail: null, loading: false, tab: 0 });
    setNewNoteText('');
    // Clear the lead param from URL if present
    if (searchParams.has('lead')) {
      const next = new URLSearchParams(searchParams);
      next.delete('lead');
      setSearchParams(next, { replace: true });
    }
    // Reset deep-link tracker so reopening the same lead via ?lead= works again.
    lastDeepLinkLead.current = null;
  }, [cleanupRecordingPlayer, searchParams, setSearchParams]);

  // Rename contact from the lead drawer
  const handleSaveContactName = useCallback(async (openContactId) => {
    if (!openContactId) return;
    const name = renameState.value.trim();
    if (!name) return;
    setRenameState((s) => ({ ...s, saving: true }));
    try {
      const updated = await renameContact(openContactId, name);
      const patch = { contact_display_name: updated.display_name, contact_name_source: updated.display_name_source };
      // Immediate UI update — patch the drawer + every list row for this contact.
      setLeadDetailDrawer((prev) => ({
        ...prev,
        detail: prev.detail ? { ...prev.detail, ...patch } : prev.detail,
        lead: prev.lead ? { ...prev.lead, ...patch } : prev.lead
      }));
      setCalls((prev) => prev?.map((c) => (c.contact_id === openContactId ? { ...c, ...patch } : c)));
      setRenameState({ editing: false, value: '', saving: false });
      triggerMessage('success', 'Name updated');
    } catch {
      setRenameState((s) => ({ ...s, saving: false }));
      triggerMessage('error', 'Couldn\'t update the name. Please try again.');
    }
  }, [renameState.value, triggerMessage]);

  // Load all tags for the user
  const loadAllTags = useCallback(async () => {
    try {
      const tags = await fetchAllTags();
      setAllTags(tags);
    } catch (err) {
      console.warn('[Tags]', err.message);
    }
  }, []);

  // Add tag to a call
  const handleAddTagToCall = useCallback(
    async (callId, tagName) => {
      if (!tagName?.trim()) return;
      try {
        const tags = await addTagToCall(callId, null, tagName.trim());
        setCallTags((prev) => ({ ...prev, [callId]: tags }));
        // Also update the allTags if it's a new tag
        loadAllTags();
        setNewTagName('');
        setTagDialogOpen(false);
      } catch {
        triggerMessage('error', 'Failed to add tag');
      }
    },
    [loadAllTags, triggerMessage]
  );

  // Remove tag from a call
  const handleRemoveTagFromCall = useCallback(
    async (callId, tagId) => {
      try {
        await removeTagFromCall(callId, tagId);
        setCallTags((prev) => ({
          ...prev,
          [callId]: (prev[callId] || []).filter((t) => t.id !== tagId)
        }));
      } catch {
        triggerMessage('error', 'Failed to remove tag');
      }
    },
    [triggerMessage]
  );

  // Update call category
  const handleUpdateCategory = useCallback(
    async (callId, category) => {
      try {
        const previousCategory = calls?.find((c) => c.id === callId)?.category || 'unreviewed';
        const result = await updateCallCategory(callId, category);
        // If the server applied a star (qualified tiers → 3★), merge it into
        // local state immediately so the Qualified/Returning chip moves without
        // a reload (CLAUDE.md "Immediate UI Updates" rule).
        const newRating = result?.score != null ? result.score : undefined;
        // Update local state - both calls list and drawer if open
        setCalls((prev) =>
          prev?.map((c) => {
            if (c.id !== callId) return c;
            return newRating !== undefined ? { ...c, category, rating: newRating } : { ...c, category };
          })
        );
        setCategoryCounts((prev) => {
          const next = { ...prev };
          next[previousCategory] = Math.max(0, (next[previousCategory] || 0) - 1);
          next[category] = (next[category] || 0) + 1;
          return next;
        });
        // Also update the drawer's lead if it's the same call
        setLeadDetailDrawer((prev) => {
          if (prev.lead?.id !== callId) return prev;
          const updatedLead = { ...prev.lead, category };
          if (newRating !== undefined) updatedLead.rating = newRating;
          return { ...prev, lead: updatedLead };
        });
        setCategoryMenuAnchor(null);
        setCategoryMenuCallId(null);
        triggerMessage('success', 'Classification updated');
      } catch {
        triggerMessage('error', 'Failed to update classification');
      }
    },
    [calls, triggerMessage]
  );

  // Add note to lead
  const handleAddNote = useCallback(async () => {
    if (!newNoteText.trim() || !leadDetailDrawer.lead) return;
    const leadKey = String(leadDetailDrawer.lead.id);
    try {
      const note = await addLeadNote(leadKey, newNoteText.trim());
      // Ignore the result if the drawer switched leads while the save was in flight.
      if (activeLeadDrawerIdRef.current !== leadKey) return;
      setLeadNotes((prev) => ({
        ...prev,
        [leadKey]: [note, ...(prev[leadKey] || [])]
      }));
      setNewNoteText('');
      triggerMessage('success', 'Note added');
    } catch {
      triggerMessage('error', 'Failed to add note');
    }
  }, [newNoteText, leadDetailDrawer.lead, triggerMessage]);

  // Delete a contact note from the lead detail drawer. Prefer the contact-scoped
  // delete path (the note belongs to the contact, not the call); fall back to the
  // lead-notes delete path when the lead row has no contact_id.
  const handleDeleteNote = useCallback(
    async (note) => {
      const lead = leadDetailDrawer.lead;
      if (!lead || !note?.id) return;
      const leadKey = String(lead.id);
      const contactId = lead.contact_id || leadDetailDrawer.detail?.contact_id;
      const prevNotes = leadNotes[leadKey] || [];
      // Optimistically remove
      setLeadNotes((prev) => ({
        ...prev,
        [leadKey]: (prev[leadKey] || []).filter((n) => n.id !== note.id)
      }));
      try {
        if (contactId) {
          await deleteContactNote(contactId, note.id);
        } else {
          await deleteLeadNote(leadKey, note.id);
        }
        triggerMessage('success', 'Note deleted');
      } catch {
        // Restore on error — only if the drawer still shows this lead, so a mid-delete switch
        // can't repaint the now-current lead's notes with this lead's stale list.
        if (activeLeadDrawerIdRef.current === leadKey) {
          setLeadNotes((prev) => ({ ...prev, [leadKey]: prevNotes }));
        }
        triggerMessage('error', 'Failed to delete note');
      }
    },
    [leadDetailDrawer.lead, leadDetailDrawer.detail, leadNotes, triggerMessage]
  );

  const handlePlayRecording = useCallback(
    async (lead) => {
      if (!lead?.id || lead.activity_type !== 'call') return;
      if (recordingState.callId && recordingState.callId !== lead.id) {
        cleanupRecordingPlayer();
      }

      if (recordingState.src && recordingState.callId === lead.id && audioRef.current) {
        if (audioRef.current.paused) {
          await audioRef.current.play();
        } else {
          audioRef.current.pause();
        }
        return;
      }

      setRecordingState((prev) => ({
        ...prev,
        callId: lead.id,
        loading: true,
        error: '',
        src: '',
        waveform: [],
        currentTime: 0,
        duration: 0,
        playing: false
      }));
      try {
        const rawBlob = await fetchLeadRecordingBlob(lead.id);
        const blob = rawBlob && rawBlob.type && rawBlob.type.startsWith('audio/') ? rawBlob : new Blob([rawBlob], { type: 'audio/mpeg' });
        const objectUrl = URL.createObjectURL(blob);
        recordingObjectUrlRef.current = objectUrl;
        const waveform = await buildWaveformFromBlob(blob);
        setRecordingState((prev) => ({
          ...prev,
          callId: lead.id,
          loading: false,
          src: objectUrl,
          waveform,
          error: ''
        }));
      } catch (err) {
        cleanupRecordingPlayer();
        const message = err.response?.data?.message || err.message || 'Failed to load recording';
        setRecordingState((prev) => ({
          ...prev,
          callId: lead.id,
          loading: false,
          error: message
        }));
        triggerMessage('error', message);
      }
    },
    [cleanupRecordingPlayer, recordingState.callId, recordingState.src, triggerMessage]
  );

  useEffect(
    () => () => {
      if (recordingObjectUrlRef.current) {
        URL.revokeObjectURL(recordingObjectUrlRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const leadId = leadDetailDrawer.lead?.id || null;
    if (!leadId) return;
    if (recordingState.callId && recordingState.callId !== leadId) {
      cleanupRecordingPlayer();
    }
  }, [cleanupRecordingPlayer, leadDetailDrawer.lead?.id, recordingState.callId]);

  useEffect(() => {
    setRenameState({ editing: false, value: '', saving: false });
  }, [leadDetailDrawer.lead?.id, leadDetailDrawer.open]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !recordingState.src) return;
    audio.volume = recordingState.volume;
    audio.playbackRate = recordingState.playbackRate;
    audio.play().catch(() => {});
  }, [recordingState.playbackRate, recordingState.src, recordingState.volume]);

  const handleAudioLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = recordingState.volume;
    audio.playbackRate = recordingState.playbackRate;
    setRecordingState((prev) => ({
      ...prev,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0
    }));
  }, [recordingState.playbackRate, recordingState.volume]);

  const handleAudioTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setRecordingState((prev) => ({
      ...prev,
      currentTime: audio.currentTime || 0
    }));
  }, []);

  const handleAudioPlay = useCallback(() => {
    setRecordingState((prev) => ({ ...prev, playing: true }));
  }, []);

  const handleAudioPause = useCallback(() => {
    setRecordingState((prev) => ({ ...prev, playing: false }));
  }, []);

  const handleToggleAudioPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const handleSkipAudio = useCallback((deltaSeconds) => {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const nextTime = Math.min(Math.max(0, (audio.currentTime || 0) + deltaSeconds), duration || Infinity);
    audio.currentTime = nextTime;
    setRecordingState((prev) => ({ ...prev, currentTime: nextTime }));
  }, []);

  const handleSeekAudio = useCallback((nextTime) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = nextTime;
    setRecordingState((prev) => ({ ...prev, currentTime: nextTime }));
  }, []);

  const handleWaveformSeek = useCallback(
    (event) => {
      const duration = recordingState.duration;
      if (!duration) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(Math.max(0, (event.clientX - rect.left) / rect.width), 1);
      handleSeekAudio(duration * ratio);
    },
    [handleSeekAudio, recordingState.duration]
  );

  const handleVolumeChange = useCallback((_event, nextValue) => {
    const volume = Array.isArray(nextValue) ? nextValue[0] : nextValue;
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
    setRecordingState((prev) => ({ ...prev, volume }));
  }, []);

  const handlePlaybackRateChange = useCallback((rate) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    setRecordingState((prev) => ({ ...prev, playbackRate: rate }));
  }, []);

  // Full historical sync with CTM
  const handleFullSync = useCallback(async () => {
    if (fullSyncing || ctmSyncing) return;
    setFullSyncing(true);
    setActionsMenuAnchor(null);
    try {
      const { newCalls, updatedCalls, message } = await syncCalls(true);
      const data = await fetchCalls(buildFilterParams());
      applyCallData(data);
      triggerMessage('success', message || `Full sync complete: ${newCalls} new, ${updatedCalls} updated`);
    } catch (err) {
      triggerMessage('error', err.message || 'Full sync failed');
    } finally {
      setFullSyncing(false);
    }
  }, [fullSyncing, ctmSyncing, triggerMessage, buildFilterParams, applyCallData]);

  // Reclassify leads - admin only function
  const handleReclassifyLeads = useCallback(async () => {
    if (!actingClientId) return;
    setReclassifyDialog((prev) => ({ ...prev, loading: true }));
    try {
      const resp = await client.post(`/hub/clients/${actingClientId}/reclassify-leads`, {
        days: reclassifyDialog.days,
        force: true
      });
      triggerMessage('success', resp.data.message || 'Lead classifications and summaries refreshed');
      loadCalls(); // Refresh leads list
    } catch (err) {
      triggerMessage('error', err.response?.data?.message || 'Failed to reclassify leads');
    } finally {
      setReclassifyDialog({ open: false, loading: false, days: 7 });
    }
  }, [actingClientId, reclassifyDialog.days, triggerMessage, loadCalls]);

  const handleClearAndReloadCalls = useCallback(async () => {
    setClearCallsDialogOpen(false);
    setCallsLoading(true);
    try {
      const data = await clearAndReloadCalls();
      setCalls(data.calls);
      triggerMessage('success', data.message || 'Calls cleared and reloaded successfully');
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to clear and reload calls');
    } finally {
      setCallsLoading(false);
    }
  }, []);

  // Normalize phone to last 10 digits for matching
  const normalizePhone = (num) => (num || '').replace(/\D/g, '').slice(-10);

  const handleHideCall = async (call) => {
    try {
      await hideCall(call.row_id);
      const phone = normalizePhone(call.from_number || call.caller_number);
      const stamp = new Date().toISOString();
      setCalls((prev) =>
        prev
          ? prev.map((c) => {
              if (phone && normalizePhone(c.from_number || c.caller_number) === phone) {
                return { ...c, hidden_at: stamp };
              }
              return c;
            })
          : prev
      );
      setLeadDetailDrawer((prev) => {
        if (!prev.lead) return prev;
        const leadPhone = normalizePhone(prev.lead.from_number || prev.lead.caller_number);
        if (phone && leadPhone === phone) {
          return { ...prev, lead: { ...prev.lead, hidden_at: stamp } };
        }
        return prev;
      });
      triggerMessage('success', 'All activity from this contact archived');
      loadCalls();
    } catch (err) {
      triggerMessage('error', err.message || 'Failed to archive');
    }
  };

  const handleHideSingleCall = async (call) => {
    try {
      await hideSingleCall(call.row_id);
      const stamp = new Date().toISOString();
      setCalls((prev) => (prev ? prev.map((c) => (c.id === call.id ? { ...c, hidden_at: stamp } : c)) : prev));
      setLeadDetailDrawer((prev) => (prev.lead && prev.lead.id === call.id ? { ...prev, lead: { ...prev.lead, hidden_at: stamp } } : prev));
      triggerMessage('success', 'Entry archived');
      loadCalls();
    } catch (err) {
      triggerMessage('error', err.message || 'Failed to archive');
    }
  };

  const handleUnhideCall = async (call) => {
    try {
      await unhideCall(call.row_id);
      const phone = normalizePhone(call.from_number || call.caller_number);
      setCalls((prev) =>
        prev
          ? prev.map((c) => {
              if (phone && normalizePhone(c.from_number || c.caller_number) === phone) {
                return { ...c, hidden_at: null };
              }
              return c;
            })
          : prev
      );
      setLeadDetailDrawer((prev) => {
        if (!prev.lead) return prev;
        const leadPhone = normalizePhone(prev.lead.from_number || prev.lead.caller_number);
        if (phone && leadPhone === phone) {
          return { ...prev, lead: { ...prev.lead, hidden_at: null } };
        }
        return prev;
      });
      triggerMessage('success', 'All activity from this contact unarchived');
      loadCalls();
    } catch (err) {
      triggerMessage('error', err.message || 'Failed to unarchive');
    }
  };

  // Listen for lead-converted events — refresh to pick up new lifecycle state from server
  useEffect(() => {
    const handler = () => loadCalls();
    window.addEventListener('lead-converted', handler);
    return () => window.removeEventListener('lead-converted', handler);
  }, [loadCalls]);

  // Tutorial mock data — swap in mock leads/tags while a leads tutorial is running
  useEffect(() => {
    if (hasTutorialMockLeads) {
      setCalls(tutorialMockData.calls);
      setCallTags(tutorialMockData.callTags);
      setAllTags(tutorialMockData.allTags);
      setCallsLoading(false);
    } else {
      // Tutorial ended (or was never active) — load cache, then sync in background
      loadCalls();
      loadAllTags();
      syncAndRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTutorialMockLeads]);

  // Initial data load (non-leads data — always runs)
  useEffect(() => {
    loadLeadStats();
    loadPipelineStages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link: open lead drawer if ?lead=<call_id> is in the URL.
  // Track the param VALUE rather than a one-shot flag so navigating to a
  // different ?lead= (e.g. clicking from the journey drawer's Activity tab)
  // reopens the drawer on the new call.
  const lastDeepLinkLead = useRef(null);
  useEffect(() => {
    const leadParam = searchParams.get('lead');
    if (!leadParam || lastDeepLinkLead.current === leadParam) return;
    lastDeepLinkLead.current = leadParam;
    // Fetch the lead detail directly and open the drawer
    (async () => {
      activeLeadDrawerIdRef.current = String(leadParam);
      setLeadDetailDrawer({ open: true, lead: null, detail: null, loading: true, tab: 0 });
      try {
        const detail = await fetchLeadDetail(leadParam);
        // Ignore stale responses if the drawer moved to another lead mid-flight.
        if (activeLeadDrawerIdRef.current !== String(leadParam)) return;
        // Use the detail as the lead object (it has the same shape from buildCallsFromCache)
        setLeadDetailDrawer({ open: true, lead: detail, detail, loading: false, tab: 0 });
        const notes = await fetchLeadNotes(leadParam);
        if (activeLeadDrawerIdRef.current !== String(leadParam)) return;
        setLeadNotes((prev) => ({ ...prev, [leadParam]: notes }));
      } catch {
        if (activeLeadDrawerIdRef.current !== String(leadParam)) return;
        triggerMessage('error', 'Could not load the linked lead');
        setLeadDetailDrawer({ open: false, lead: null, detail: null, loading: false, tab: 0 });
      }
    })();
  }, [searchParams, triggerMessage]);

  // Track previous filter values to detect actual changes
  const prevFiltersRef = useRef(null);

  // Reload calls when filters change (only if we already have calls loaded)
  useEffect(() => {
    // Build current filter key
    const currentFilters = [
      callFilters.category,
      callFilters.type,
      lifecycleFilter,
      showHidden ? 'hidden' : 'visible',
      dateRange.from || '',
      dateRange.to || ''
    ].join('|');

    // Skip if filters haven't actually changed (prevents double-load on mount)
    if (prevFiltersRef.current === currentFilters) return;

    // Skip if this is the initial mount (calls will be null)
    if (prevFiltersRef.current === null) {
      prevFiltersRef.current = currentFilters;
      return;
    }

    prevFiltersRef.current = currentFilters;

    // The In Journey + Contacts sub-tabs render their own data — no need to refetch the
    // page-level call list when switching into them.
    if (lifecycleFilter === 'in_journey' || lifecycleFilter === 'contacts') return;

    loadCalls({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callFilters.category, callFilters.type, lifecycleFilter, showHidden, dateRange.from, dateRange.to]);

  // Backend is the single source of truth for both lifecycle and hidden filtering.
  // Hide state only affects the Lead Inbox tab server-side; other tabs always
  // return everything regardless of dismissal, so no client-side filtering here.
  // The Qualified list (Qualified + Priority leads combined) is ordered solely by
  // date — server-side started_at DESC. Priority leads appear inline by date with
  // their own chip; no priority-first ordering or section grouping.
  const filteredCalls = useMemo(() => calls || [], [calls]);

  // The shared search bar above is also visible on the Lead Journeys tab, but the
  // journey pipeline is fetched separately from `calls` (it doesn't go through
  // loadCalls/buildFilterParams), so the server-side `search` param never touches
  // it. Filter the journeys client-side here so the same search box narrows the
  // pipeline by contact name / phone / email.
  const filteredJourneys = useMemo(() => {
    const list = Array.isArray(journeys) ? journeys : [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((j) =>
      [j.client_name, j.client_phone, j.client_email].some((field) => (field || '').toLowerCase().includes(q))
    );
  }, [journeys, searchQuery]);

  // Lifecycle is computed server-side (by phone match), so it only refreshes on a
  // refetch. When a lead is moved into a journey, journeyByLeadId updates instantly
  // — so in the Lead Inbox we drop any lead that now has a journey, moving it out of
  // the list and into the Journey tab immediately without waiting for a refresh.
  useEffect(() => {
    if (lifecycleFilter !== 'lead_inbox') return;
    setCalls((prev) => {
      if (!prev?.length) return prev;
      const next = prev.filter((c) => !journeyByLeadId.has(c.id));
      return next.length === prev.length ? prev : next;
    });
  }, [journeyByLeadId, lifecycleFilter]);

  return (
    <>
      <Stack spacing={2}>
        {/* Dashboard Summary Cards - DISABLED FOR NOW */}
        {/* To re-enable, change false to leadStats below */}
        {false && leadStats && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 1 }}>
            <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
              <CardContent sx={{ py: 1.5, px: 2 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'primary.lighter' }}>
                    <PeopleIcon color="primary" />
                  </Box>
                  <Box>
                    <Typography variant="h4" fontWeight={600}>
                      {leadStats.total}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Total Leads (30d)
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
              <CardContent sx={{ py: 1.5, px: 2 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'success.lighter' }}>
                    <TrendingUpIcon color="success" />
                  </Box>
                  <Box>
                    <Typography variant="h4" fontWeight={600}>
                      {leadStats.conversionRate}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Conversion Rate
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
              <CardContent sx={{ py: 1.5, px: 2 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'warning.lighter' }}>
                    <WarningIcon color="warning" />
                  </Box>
                  <Box>
                    <Typography variant="h4" fontWeight={600}>
                      {leadStats.needsAttention}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Need Attention
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
              <CardContent sx={{ py: 1.5, px: 2 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'info.lighter' }}>
                    <StarIcon color="info" />
                  </Box>
                  <Box>
                    <Typography variant="h4" fontWeight={600}>
                      {leadStats.averageRating}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Avg Rating
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        )}

        {/* Conversion Funnel Visualization - DISABLED FOR NOW */}
        {/* To re-enable, change false to leadStats below */}
        {false && leadStats && leadStats.byCategory && (
          <Card variant="outlined" sx={{ mb: 2 }}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Lead Funnel (30 days)
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 100, mt: 2 }}>
                {(() => {
                  const funnelStages = [
                    { key: 'total', label: 'Total', value: leadStats.total, color: '#6366f1' },
                    { key: 'warm', label: 'Warm', value: leadStats.byCategory.warm || 0, color: '#22c55e' },
                    { key: 'very_good', label: 'Very Good', value: leadStats.byCategory.very_good || 0, color: '#10b981' },
                    { key: 'converted', label: 'Converted', value: leadStats.converted || 0, color: '#059669' }
                  ];
                  const maxValue = Math.max(...funnelStages.map((s) => s.value), 1);

                  return funnelStages.map((stage, idx) => {
                    const height = Math.max((stage.value / maxValue) * 100, 8);
                    return (
                      <Box
                        key={stage.key}
                        sx={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 0.5
                        }}
                      >
                        <Typography variant="h6" fontWeight={600}>
                          {stage.value}
                        </Typography>
                        <Box
                          sx={{
                            width: '100%',
                            height: `${height}%`,
                            bgcolor: stage.color,
                            borderRadius: '4px 4px 0 0',
                            minHeight: 8,
                            transition: 'height 0.3s ease'
                          }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                          {stage.label}
                        </Typography>
                      </Box>
                    );
                  });
                })()}
              </Box>
              {/* Category breakdown */}
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {Object.entries(leadStats.byCategory).map(([cat, count]) => {
                  const catColor = getCategoryColor(cat);
                  return (
                    <Chip
                      key={cat}
                      label={`${cat.replace(/_/g, ' ')}: ${count}`}
                      size="small"
                      sx={{
                        bgcolor: catColor.bg,
                        color: catColor.text,
                        border: `1px solid ${catColor.border}`,
                        fontSize: '0.7rem'
                      }}
                    />
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Primary CRM switcher — mirrors the sidebar (Leads / Lead Journeys / Contacts).
            New Leads stays here (the inbox); Lead Journeys + Contacts open their own tabs.
            'All Activity' is no longer a top tab — it's the first Lead Category chip below. */}
        {(() => {
          const journeyCount = Array.isArray(journeys)
            ? journeys.filter((j) => {
                const s = String(j?.status || 'in_progress').toLowerCase();
                return !['active_client', 'won', 'lost', 'archived'].includes(s);
              }).length
            : lifecycleCounts.in_journey;
          const tabs = [
            // Count the QUALIFIED inbox, not the whole inbox: clicking New Leads lands on the
            // Qualified default view, so the tab number must match what you actually see (and
            // the Qualified chip). categoryCounts.qualified is inbox-scoped (see hub.js), so
            // it stays correct regardless of the All-Activity firehose.
            { value: 'lead_inbox', label: 'New Leads', icon: <MoveToInboxIcon />, count: categoryCounts.qualified || 0, unit: 'Leads' },
            { value: 'in_journey', label: 'Lead Journeys', icon: <TrendingUpIcon />, count: journeyCount, unit: 'Leads' },
            { value: 'contacts', label: 'Contacts', icon: <PeopleIcon />, count: contactsCount ?? 0, unit: 'Contacts' }
          ];
          // New Leads owns both the qualified inbox and the All-Activity firehose.
          return (
            <Box
              data-tutorial="leads-switcher"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'hidden'
              }}
            >
              {tabs.map((tab) => {
                const active = tab.value === 'lead_inbox' ? lifecycleFilter === 'lead_inbox' || lifecycleFilter === 'all' : lifecycleFilter === tab.value;
                return (
                  <Box
                    key={tab.value}
                    onClick={() => {
                      setLifecycleFilter(tab.value);
                      setPagination((p) => ({ ...p, page: 1 }));
                      if (tab.value === 'in_journey') {
                        setDateRange({ from: '', to: '' });
                        setDatePreset(ALL_TIME_DATE_PRESET);
                        setCallFilters((prev) => ({ ...prev, type: 'all', category: DEFAULT_VISIBLE_CATEGORY_FILTER }));
                      }
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      px: 3,
                      py: 2,
                      cursor: 'pointer',
                      bgcolor: active ? 'primary.lighter' : 'background.paper',
                      borderBottom: '3px solid',
                      borderBottomColor: active ? 'primary.main' : 'transparent',
                      borderRight: '1px solid',
                      borderRightColor: 'divider',
                      '&:last-child': { borderRight: 'none' },
                      transition: 'background-color 0.15s',
                      '&:hover': { bgcolor: active ? 'primary.lighter' : 'grey.50' }
                    }}
                  >
                    <Box sx={{ color: active ? 'primary.main' : 'text.secondary', display: 'flex' }}>{tab.icon}</Box>
                    <Box>
                      <Typography
                        variant="subtitle2"
                        fontWeight={700}
                        sx={{ textTransform: 'uppercase', letterSpacing: 0.5, color: active ? 'primary.main' : 'text.primary' }}
                      >
                        {tab.label}
                      </Typography>
                      {tab.unit && (
                        <Typography variant="caption" color="text.secondary">
                          {tab.count} {tab.unit}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          );
        })()}

        {/* Contacts switcher renders the master list inline beneath the tab bar. New Leads /
            Lead Journeys keep their own inbox/pipeline body below. */}
        {lifecycleFilter === 'contacts' ? (
          <ContactsTab key={`leads-contacts-${actingClientId || 'self'}`} triggerMessage={triggerMessage} isStaff={isAdmin} />
        ) : (
          <>
        {/* Search and Action Bar */}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" flexWrap="wrap">
          {/* Search Input */}
          <Box
            data-tutorial="leads-search"
            sx={{
              display: 'flex',
              alignItems: 'center',
              bgcolor: 'grey.100',
              borderRadius: 1,
              px: 1.5,
              py: 0.5,
              minWidth: { xs: '100%', sm: 250 }
            }}
          >
            <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />
            <InputBase
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadCalls()}
              sx={{ flex: 1 }}
            />
          </Box>

          {/* View Toggle — hidden on All Activity (table-only) and entity-grouped sub-tabs (single layout) */}
          {lifecycleFilter !== 'all' && !isEntityGrouped && (
            <ToggleButtonGroup value={viewMode} exclusive onChange={(e, val) => val && setViewMode(val)} size="small">
              <ToggleButton value="card">
                <Tooltip title="Card View">
                  <ViewModuleIcon />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="table">
                <Tooltip title="Table View">
                  <ViewListIcon />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          )}

          <Box sx={{ flex: 1 }} />
        </Stack>

        {/* Filters Row */}
        {showLifecycleFilters && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" flexWrap="wrap">
            <ToggleButtonGroup
              value={callFilters.type}
              exclusive
              size="small"
              onChange={(_, val) => {
                if (val) setCallFilters((prev) => ({ ...prev, type: val }));
              }}
              sx={{
                borderRadius: 999,
                '& .MuiToggleButton-root': {
                  px: 2,
                  py: 0.5,
                  textTransform: 'none',
                  fontSize: '0.8rem',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.dark' }
                  }
                },
                '& .MuiToggleButton-root:first-of-type': { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
                '& .MuiToggleButton-root:last-of-type': { borderTopRightRadius: 999, borderBottomRightRadius: 999 }
              }}
            >
              {ACTIVITY_TYPE_OPTIONS.map((opt) => (
                <ToggleButton key={opt.value} value={opt.value}>
                  {opt.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <ToggleButtonGroup
              value={datePreset}
              exclusive
              size="small"
              onChange={(_, val) => {
                if (!val) return;
                if (val === ALL_TIME_DATE_PRESET) {
                  setDateRange({ from: '', to: '' });
                } else {
                  setDateRange(getDatePresetRange(val));
                }
                setDatePreset(val);
              }}
              sx={{
                borderRadius: 999,
                '& .MuiToggleButton-root': {
                  px: 2,
                  py: 0.5,
                  textTransform: 'none',
                  fontSize: '0.8rem',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.dark' }
                  }
                },
                '& .MuiToggleButton-root:first-of-type': { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
                '& .MuiToggleButton-root:last-of-type': { borderTopRightRadius: 999, borderBottomRightRadius: 999 }
              }}
            >
              <ToggleButton value="today">Today</ToggleButton>
              <ToggleButton value="this_week">This Week</ToggleButton>
              <ToggleButton value="this_month">This Month</ToggleButton>
              <ToggleButton value={ALL_TIME_DATE_PRESET}>All Time</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              type="date"
              label="From"
              value={dateRange.from}
              onChange={(e) => {
                const nextRange = { ...dateRange, from: e.target.value };
                setDateRange(nextRange);
                setDatePreset(detectDatePreset(nextRange));
              }}
              size="small"
              sx={{ minWidth: 140 }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              type="date"
              label="To"
              value={dateRange.to}
              onChange={(e) => {
                const nextRange = { ...dateRange, to: e.target.value };
                setDateRange(nextRange);
                setDatePreset(detectDatePreset(nextRange));
              }}
              size="small"
              sx={{ minWidth: 140 }}
              InputLabelProps={{ shrink: true }}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={!user?.id}
              onClick={() => {
                const key = defaultViewStorageKey(user?.id);
                if (!key) {
                  triggerMessage('error', 'Sign in required to save a default view');
                  return;
                }
                try {
                  const payload = {
                    lifecycleFilter,
                    callFilters,
                    datePreset,
                    dateRange,
                    viewMode,
                    perPage: pagination.limit
                  };
                  window.localStorage.setItem(key, JSON.stringify(payload));
                  triggerMessage('success', 'Default view saved');
                } catch {
                  triggerMessage('error', 'Failed to save default view');
                }
              }}
            >
              Make Default View
            </Button>
            {hasVisibleFilters && (
              <>
                <Button
                  size="small"
                  onClick={async () => {
                    // Reset all filter state back to the default view (This Month + Qualified inbox).
                    setSearchQuery('');
                    setDatePreset(DEFAULT_DATE_PRESET);
                    setDateRange(getDatePresetRange(DEFAULT_DATE_PRESET));
                    setCallFilters({ type: 'all', category: DEFAULT_VISIBLE_CATEGORY_FILTER });
                    setLifecycleFilter('lead_inbox');
                    setShowHidden(false);

                    // Always reload with cleared filters (fetch with default params)
                    setCallsLoading(true);
                    try {
                      const data = await fetchCalls({
                        page: 1,
                        limit: pagination.limit,
                        lifecycle: 'lead_inbox',
                        category: DEFAULT_VISIBLE_CATEGORY_FILTER
                      });
                      applyCallData(data);
                    } catch {
                      triggerMessage('error', 'Failed to reload calls');
                    } finally {
                      setCallsLoading(false);
                    }
                  }}
                >
                  Clear Filters
                </Button>
              </>
            )}
          </Stack>
        )}
        {callsLoading && <LinearProgress />}
        {/* Table-adjacent row: category chips (conditional) + per-page + three-dots */}
        <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
          {showLifecycleFilters && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                Lead Category:
              </Typography>
              {/* All Activity — the firehose (every call/form, no category filter). Lives as the
                  first chip so clients can switch to it without leaving the Leads view. */}
              <Button
                key="all_activity"
                variant={lifecycleFilter === 'all' ? 'contained' : 'outlined'}
                size="small"
                onClick={() => {
                  setLifecycleFilter('all');
                  setPagination((p) => ({ ...p, page: 1 }));
                }}
                sx={{ textTransform: 'none' }}
              >
                All Activity ({lifecycleCounts.all || 0})
              </Button>
              {CATEGORY_FILTER_CHIPS.map((key) => {
                const label = VISIBLE_CATEGORY_LABELS[key];
                // Pending Review is a synthetic bucket emitted by the server based
                // on meta.classification_pending — not a raw category. Read it
                // straight off categoryCounts. Other buckets are summed from the
                // raw category counts that map to this visible bucket; the server
                // excludes pending rows from those raw counts so we don't double-
                // count.
                const count =
                  key === 'pending_review'
                    ? categoryCounts.pending_review || 0
                    : key === 'qualified'
                      ? categoryCounts.qualified || 0
                      : key === 'returning'
                        ? categoryCounts.returning || 0
                        : Object.entries(categoryCounts).reduce((sum, [rawCat, c]) => {
                            if (['pending_review', 'qualified', 'returning'].includes(rawCat)) return sum;
                            if (VISIBLE_CATEGORY_MAP[rawCat] === key) return sum + c;
                            return sum;
                          }, 0);
                return (
                  <Button
                    key={key}
                    variant={lifecycleFilter !== 'all' && callFilters.category === key ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => {
                      // Leaving All Activity (firehose) back into the qualified inbox + this category.
                      setLifecycleFilter('lead_inbox');
                      setCallFilters((prev) => ({ ...prev, category: key }));
                      setPagination((p) => ({ ...p, page: 1 }));
                    }}
                    sx={{ textTransform: 'none' }}
                  >
                    {label} ({count})
                  </Button>
                );
              })}
            </Box>
          )}

          <Box sx={{ flex: 1 }} />

          <TextField
            select
            size="small"
            label="Per page"
            value={pagination.limit}
            onChange={(e) => {
              const nextLimit = parseInt(e.target.value, 10) || 20;
              setPagination((p) => ({ ...p, page: 1, limit: nextLimit }));
            }}
            sx={{ minWidth: 96 }}
          >
            {[20, 50, 100].map((n) => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </TextField>

          <Tooltip title="More actions">
            <IconButton size="small" onClick={(e) => setActionsMenuAnchor(e.currentTarget)}>
              <MoreVertIcon />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={actionsMenuAnchor} open={Boolean(actionsMenuAnchor)} onClose={() => setActionsMenuAnchor(null)}>
            {isAdmin && (
              <MenuItem onClick={handleFullSync} disabled={fullSyncing || ctmSyncing}>
                {fullSyncing ? 'Running Full Sync...' : 'Full Sync (Historical)'}
              </MenuItem>
            )}
            {isAdmin && actingClientId && (
              <MenuItem
                onClick={() => {
                  setActionsMenuAnchor(null);
                  setReclassifyDialog({ open: true, loading: false, days: 7 });
                }}
              >
                Backfill Classification & Summary
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                setActionsMenuAnchor(null);
                setShowHidden((v) => !v);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            >
              {showHidden ? 'Hide Hidden Entries' : 'Show Hidden Entries'}
            </MenuItem>
          </Menu>

          {showHidden && (
            <Chip
              label="Showing Hidden"
              size="small"
              color="warning"
              variant="outlined"
              onDelete={() => {
                setShowHidden(false);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            />
          )}
          {fullSyncing && <Chip label="Full Sync..." size="small" color="info" variant="outlined" />}
        </Stack>
        <Divider />

        {lifecycleFilter === 'in_journey' && (
          <Box>
            <Tabs value={journeySubTab} onChange={(_, v) => setJourneySubTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tab label="Pipeline" />
              <Tab label="Email Templates" />
            </Tabs>
            {journeySubTab === 0 &&
              (journeysLoading && (!journeys || journeys.length === 0) ? (
                <LinearProgress />
              ) : (
                <PipelineBoard
                  journeys={filteredJourneys}
                  onOpen={openJourneyDrawer}
                  onJourneyUpdate={applyJourneyUpdate}
                  searching={!!searchQuery.trim()}
                />
              ))}
            {journeySubTab === 1 && <EmailTemplatesPane />}
          </Box>
        )}

        {/* New-leads pill — background refresh found leads not yet shown. Non-disruptive:
            the list isn't touched until the user clicks. */}
        {!isEntityGrouped && newLeadsAvailable > 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              onClick={handleShowNewLeads}
              sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 600, boxShadow: 2 }}
            >
              {newLeadsAvailable === 1 ? '1 new lead' : `${newLeadsAvailable} new leads`} — click to refresh
            </Button>
          </Box>
        )}

        {/* Card View */}
        <Stack
          data-tutorial="leads-card-list"
          spacing={2}
          sx={{ display: !isEntityGrouped && effectiveViewMode === 'card' ? 'flex' : 'none' }}
        >
          {callsLoading && !filteredCalls.length && (
            <>
              {[1, 2, 3, 4, 5].map((idx) => (
                <Card key={`skeleton-${idx}`} variant="outlined">
                  <CardContent>
                    <Stack spacing={1}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
                        <Skeleton variant="rectangular" width={100} height={24} sx={{ borderRadius: 1 }} />
                        <Skeleton variant="text" width="100%" height={24} sx={{ flex: 1 }} />
                        <Skeleton variant="text" width={150} height={20} />
                      </Stack>
                      <Skeleton variant="text" width="80%" height={20} />
                      <Skeleton variant="text" width="100%" height={20} />
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Skeleton variant="rectangular" width={140} height={32} sx={{ borderRadius: 1 }} />
                        <Skeleton variant="rectangular" width={160} height={32} sx={{ borderRadius: 1 }} />
                        <Skeleton variant="rectangular" width={100} height={32} sx={{ borderRadius: 1 }} />
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
          {!callsLoading &&
            filteredCalls.map((call, index) => {
              const categoryColor = getCategoryColor(call);
              const tags = callTags[call.id] || [];
              const systemTags = getSystemTags(call, tags, { showClientProvided: isAdmin && Boolean(actingClientId) });
              const openJourney = getOpenJourney(call.journey, journeyByLeadId.get(call.id));
              const isActiveClient = call.lifecycle_state === 'active_client';
              const displaySummary = getDisplaySummary(call.classification_summary, '');
              return (
                <Fragment key={call.id}>
                  <Tooltip
                    title={
                      displaySummary ? (
                        <Box sx={{ maxWidth: 360, p: 0.5 }}>
                          <Typography
                            sx={(theme) => ({
                              fontWeight: 700,
                              color: 'white',
                              fontSize: '0.9rem',
                              mb: 0.5,
                              ...theme.applyStyles('dark', { color: 'rgba(0,0,0,0.87)' })
                            })}
                          >
                            {getVisibleCategory(call).label}
                          </Typography>
                          <Typography
                            sx={(theme) => ({
                              color: 'rgba(255,255,255,0.9)',
                              fontSize: '0.875rem',
                              lineHeight: 1.5,
                              ...theme.applyStyles('dark', { color: 'rgba(0,0,0,0.78)' })
                            })}
                          >
                            {displaySummary}
                          </Typography>
                        </Box>
                      ) : (
                        ''
                      )
                    }
                    arrow
                    placement="top"
                    enterDelay={400}
                  >
                    <Card
                      variant="outlined"
                      sx={{
                        borderLeft: `4px solid ${categoryColor.border}`,
                        '&:hover': { boxShadow: 2, cursor: 'pointer' },
                        transition: 'box-shadow 0.2s'
                      }}
                      onClick={() => handleOpenLeadDetail(call)}
                    >
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack direction="row" spacing={2} alignItems="center">
                          {/* Caller Name, Number & Form Badge */}
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="subtitle1" fontWeight={600} noWrap>
                              {(call.contact_name_source === 'user' && call.contact_display_name)
                                ? call.contact_display_name
                                : (call.caller_name || 'Unknown Caller')}
                            </Typography>
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                              {call.activity_type === 'form' && call.form_name ? (
                                <Chip
                                  label={call.form_name}
                                  size="small"
                                  sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    bgcolor: 'primary.lighter',
                                    color: 'primary.dark',
                                    border: '1px solid',
                                    borderColor: 'primary.light',
                                    '& .MuiChip-label': { px: 0.75 }
                                  }}
                                />
                              ) : call.caller_number ? (
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{ fontFamily: 'monospace', letterSpacing: '0.02em' }}
                                >
                                  {formatPhone(call.caller_number)}
                                </Typography>
                              ) : null}
                            </Stack>
                          </Box>

                          {/* Classification - Clickable to change */}
                          <Tooltip title="Click to change">
                            <Chip
                              label={getVisibleCategory(call).label}
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCategoryMenuAnchor(e.currentTarget);
                                setCategoryMenuCallId(call.id);
                              }}
                              sx={{
                                bgcolor: categoryColor.bg,
                                color: categoryColor.text,
                                border: `1px solid ${categoryColor.border}`,
                                fontWeight: 600,
                                cursor: 'pointer',
                                '&:hover': { opacity: 0.8 }
                              }}
                            />
                          </Tooltip>

                          {needsCallbackFollowUp(call) && (
                            <Chip
                              icon={<WarningIcon sx={{ fontSize: 14 }} />}
                              label="Callback Needed"
                              size="small"
                              variant="outlined"
                              sx={{
                                fontWeight: 600,
                                color: 'warning.dark',
                                borderColor: 'warning.main',
                                bgcolor: 'warning.lighter'
                              }}
                            />
                          )}

                          {/* Lifecycle State */}
                          {call.lifecycle_state && call.lifecycle_state !== 'new' && (
                            <Chip
                              label={
                                call.lifecycle_state === 'active_client'
                                  ? 'Client'
                                  : call.lifecycle_state === 'in_journey'
                                    ? 'In Journey'
                                    : call.lifecycle_state === 'returning_customer'
                                      ? 'Returning'
                                      : call.lifecycle_state === 'repeat'
                                        ? 'Repeat'
                                        : ''
                              }
                              size="small"
                              variant="outlined"
                              sx={{
                                fontSize: '0.7rem',
                                height: 22,
                                fontWeight: 600,
                                borderColor:
                                  call.lifecycle_state === 'active_client'
                                    ? 'success.main'
                                    : call.lifecycle_state === 'in_journey'
                                      ? 'info.main'
                                      : 'grey.400',
                                color:
                                  call.lifecycle_state === 'active_client'
                                    ? 'success.dark'
                                    : call.lifecycle_state === 'in_journey'
                                      ? 'info.dark'
                                      : 'text.secondary'
                              }}
                            />
                          )}

                          {/* Journey stage — when this lead has an active journey */}
                          {openJourney?.stage && (
                            <Chip
                              label={stageLabel(openJourney.stage)}
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJourneyDrawer(openJourney);
                              }}
                              sx={{
                                fontSize: '0.7rem',
                                height: 22,
                                fontWeight: 600,
                                cursor: 'pointer',
                                bgcolor: STAGE_COLORS[openJourney.stage] || 'grey.400',
                                color: 'white'
                              }}
                            />
                          )}

                          {/* Previous Journey badge — this contact had a prior (archived/converted) journey */}
                          {call.has_previous_journey && (
                            <Tooltip title="This contact has a previous journey on file.">
                              <Chip
                                label="Previous Journey"
                                size="small"
                                color="info"
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 22 }}
                              />
                            </Tooltip>
                          )}

                          {/* Dismissed indicator — row is hidden from Lead Inbox */}
                          {call.hidden_at && (
                            <Tooltip title="Dismissed from Lead Inbox. Still appears here and in Journey / Client views.">
                              <Chip
                                label="Dismissed"
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.7rem',
                                  height: 22,
                                  fontWeight: 600,
                                  borderColor: 'grey.500',
                                  color: 'text.secondary',
                                  bgcolor: 'grey.100'
                                }}
                              />
                            </Tooltip>
                          )}

                          {/* Tags */}
                          <Stack
                            data-tutorial="lead-tag-area"
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {systemTags.map((tag) => (
                              <Chip
                                key={`system-${call.id}-${tag.key || tag.label}`}
                                label={tag.label || tag.name}
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.7rem',
                                  height: 22,
                                  fontWeight: 600,
                                  color: tag.color || 'info.dark',
                                  borderColor: tag.color || 'info.main',
                                  bgcolor: 'background.paper'
                                }}
                              />
                            ))}
                            {tags.slice(0, 3).map((tag) => (
                              <Chip
                                key={tag.id}
                                label={tag.name}
                                size="small"
                                deleteIcon={<CloseIcon sx={{ fontSize: '12px !important' }} />}
                                onDelete={() => handleRemoveTagFromCall(call.id, tag.id)}
                                sx={{
                                  bgcolor: tag.color || '#6366f1',
                                  color: 'white',
                                  fontSize: '0.7rem',
                                  height: 22,
                                  fontWeight: 500,
                                  '& .MuiChip-deleteIcon': {
                                    color: 'rgba(255,255,255,0.7)',
                                    marginLeft: '-2px',
                                    '&:hover': { color: 'white' }
                                  }
                                }}
                              />
                            ))}
                            {tags.length > 3 && (
                              <Chip label={`+${tags.length - 3}`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                            )}
                            <Tooltip title="Add tag">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenLeadDetail(call);
                                }}
                                sx={{
                                  p: 0.25,
                                  bgcolor: 'action.hover',
                                  '&:hover': { bgcolor: 'action.selected' }
                                }}
                              >
                                <LocalOfferIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </Stack>

                          {/* Action Buttons */}
                          <Stack
                            data-tutorial="lead-actions"
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!isActiveClient && (
                              <Button
                                data-tutorial="lead-start-journey"
                                size="small"
                                variant="outlined"
                                onClick={() => onOpenConcernDialog(call, openJourney)}
                                sx={{ minWidth: 0, px: 1.75, py: 0.75, fontSize: '0.75rem', fontWeight: 600, borderRadius: 999 }}
                              >
                                {openJourney ? 'Update Journey' : 'Start Journey'}
                              </Button>
                            )}
                            {!isActiveClient && (
                              <Button
                                size="small"
                                variant="contained"
                                color="secondary"
                                onClick={() => onOpenServiceDialog(call)}
                                startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                                sx={{ minWidth: 0, px: 1.75, py: 0.75, fontSize: '0.75rem', fontWeight: 600, borderRadius: 999 }}
                              >
                                Add To Client List
                              </Button>
                            )}
                            {/* Archive is an inbox-triage action — only exposed on Lead Inbox. */}
                            {lifecycleFilter === 'lead_inbox' && (
                              <Button
                                size="small"
                                variant={call.hidden_at ? 'outlined' : 'contained'}
                                color="error"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (call.hidden_at) {
                                    handleUnhideCall(call);
                                  } else {
                                    setHidePopover({ anchorEl: e.currentTarget, call });
                                  }
                                }}
                                sx={{ minWidth: 0, px: 1.75, py: 0.75, fontSize: '0.75rem', fontWeight: 600, borderRadius: 999 }}
                              >
                                {call.hidden_at ? 'Unarchive' : 'Archive'}
                              </Button>
                            )}
                          </Stack>

                          {/* Time ago */}
                          <Typography variant="caption" color="text.disabled" sx={{ minWidth: 50, textAlign: 'right' }}>
                            {call.time_ago || call.call_time}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  </Tooltip>
                </Fragment>
              );
            })}
          {!filteredCalls.length && !callsLoading && <EmptyState title="No calls to display." />}
        </Stack>

        {/* Table View */}
        {/* custom table — DataTable cannot express multi-mode lead table with inline star/category editors, tutorial data-attrs, nested call-detail drawers, and per-row action menus */}
        {!isEntityGrouped && effectiveViewMode === 'table' && !callsLoading && filteredCalls.length > 0 && (
          <TableContainer data-tutorial="leads-table" component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Caller</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Phone</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Source</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Duration</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredCalls.map((call, index) => {
                  const categoryColor = getCategoryColor(call);
                  const openJourney = getOpenJourney(call.journey, journeyByLeadId.get(call.id));
                  const isActiveClient = call.lifecycle_state === 'active_client';
                  const displaySummary = getDisplaySummary(call.classification_summary, '');
                  return (
                    <Fragment key={call.id}>
                      <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => handleOpenLeadDetail(call)}>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Tooltip
                              title={
                                displaySummary ? (
                                  <Box sx={{ maxWidth: 360, p: 0.5 }}>
                                    <Typography
                                      sx={(theme) => ({
                                        fontWeight: 700,
                                        display: 'block',
                                        mb: 0.5,
                                        color: 'white',
                                        fontSize: '0.9rem',
                                        ...theme.applyStyles('dark', { color: 'rgba(0,0,0,0.87)' })
                                      })}
                                    >
                                      AI Classification
                                    </Typography>
                                    <Typography
                                      sx={(theme) => ({
                                        color: 'rgba(255,255,255,0.9)',
                                        fontSize: '0.875rem',
                                        lineHeight: 1.5,
                                        ...theme.applyStyles('dark', { color: 'rgba(0,0,0,0.78)' })
                                      })}
                                    >
                                      {displaySummary}
                                    </Typography>
                                  </Box>
                                ) : (
                                  ''
                                )
                              }
                              arrow
                            >
                              <Chip
                                label={getVisibleCategory(call).label}
                                size="small"
                                sx={{
                                  bgcolor: categoryColor.bg,
                                  color: categoryColor.text,
                                  border: `1px solid ${categoryColor.border}`,
                                  fontWeight: 600,
                                  fontSize: '0.7rem'
                                }}
                              />
                            </Tooltip>
                            {needsCallbackFollowUp(call) && (
                              <Chip
                                icon={<WarningIcon sx={{ fontSize: 14 }} />}
                                label="Callback Needed"
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontWeight: 600,
                                  fontSize: '0.7rem',
                                  color: 'warning.dark',
                                  borderColor: 'warning.main',
                                  bgcolor: 'warning.lighter'
                                }}
                              />
                            )}
                            {call.lifecycle_state && call.lifecycle_state !== 'new' && (
                              <Chip
                                label={
                                  call.lifecycle_state === 'active_client'
                                    ? 'Client'
                                    : call.lifecycle_state === 'in_journey'
                                      ? 'In Journey'
                                      : call.lifecycle_state === 'returning_customer'
                                        ? 'Returning'
                                        : call.lifecycle_state === 'repeat'
                                          ? 'Repeat'
                                          : ''
                                }
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.7rem',
                                  height: 22,
                                  fontWeight: 600,
                                  borderColor:
                                    call.lifecycle_state === 'active_client'
                                      ? 'success.main'
                                      : call.lifecycle_state === 'in_journey'
                                        ? 'info.main'
                                        : 'grey.400',
                                  color:
                                    call.lifecycle_state === 'active_client'
                                      ? 'success.dark'
                                      : call.lifecycle_state === 'in_journey'
                                        ? 'info.dark'
                                        : 'text.secondary'
                                }}
                              />
                            )}
                            {openJourney?.stage && (
                              <Chip
                                label={stageLabel(openJourney.stage)}
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openJourneyDrawer(openJourney);
                                }}
                                sx={{
                                  fontSize: '0.7rem',
                                  height: 22,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  bgcolor: STAGE_COLORS[openJourney.stage] || 'grey.400',
                                  color: 'white'
                                }}
                              />
                            )}
                            {call.has_previous_journey && (
                              <Tooltip title="This contact has a previous journey on file.">
                                <Chip
                                  label="Previous Journey"
                                  size="small"
                                  color="info"
                                  variant="outlined"
                                  sx={{ fontSize: '0.7rem', height: 22 }}
                                />
                              </Tooltip>
                            )}
                            {call.hidden_at && (
                              <Tooltip title="Dismissed from Lead Inbox. Still appears here and in Journey / Client views.">
                                <Chip
                                  label="Dismissed"
                                  size="small"
                                  variant="outlined"
                                  sx={{
                                    fontSize: '0.7rem',
                                    height: 22,
                                    fontWeight: 600,
                                    borderColor: 'grey.500',
                                    color: 'text.secondary',
                                    bgcolor: 'grey.100'
                                  }}
                                />
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            {call.is_inbound ? (
                              <CallReceivedIcon sx={{ fontSize: 14, color: 'success.main' }} />
                            ) : (
                              <CallMadeIcon sx={{ fontSize: 14, color: 'primary.main' }} />
                            )}
                            <Typography variant="body2">
                              {(call.contact_name_source === 'user' && call.contact_display_name)
                                ? call.contact_display_name
                                : (call.caller_name || 'Unknown')}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          {call.activity_type === 'form' && call.form_name ? (
                            <Chip
                              label={call.form_name}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                bgcolor: 'primary.lighter',
                                color: 'primary.dark',
                                border: '1px solid',
                                borderColor: 'primary.light',
                                '& .MuiChip-label': { px: 0.75 }
                              }}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                              {call.caller_number ? formatPhone(call.caller_number) : '-'}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {call.source || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{call.duration_formatted || '-'}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {call.time_ago || call.call_time}
                          </Typography>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Stack direction="row" spacing={0.5}>
                            {!isActiveClient && (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => onOpenConcernDialog(call, openJourney)}
                                sx={{ fontSize: '0.65rem', py: 0.25 }}
                              >
                                {openJourney ? 'Update Journey' : 'Start Journey'}
                              </Button>
                            )}
                            {!isActiveClient && (
                              <Button
                                size="small"
                                variant="contained"
                                color="secondary"
                                onClick={() => onOpenServiceDialog(call)}
                                startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                                sx={{ fontSize: '0.65rem', py: 0.25 }}
                              >
                                Add To Client List
                              </Button>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Pagination */}
        {!isEntityGrouped && pagination.totalPages > 1 && (
          <Stack direction="row" justifyContent="center" alignItems="center" spacing={2} sx={{ mt: 2 }}>
            <Button size="small" disabled={pagination.page <= 1} onClick={() => loadCalls({ page: pagination.page - 1 })}>
              Previous
            </Button>
            <Typography variant="body2">
              Page {pagination.page} of {pagination.totalPages}
            </Typography>
            <Button size="small" disabled={!pagination.hasMore} onClick={() => loadCalls({ page: pagination.page + 1 })}>
              Next
            </Button>
          </Stack>
        )}
          </>
        )}
      </Stack>

      {/* Lead Detail Drawer */}
      <Drawer
        anchor="right"
        open={leadDetailDrawer.open}
        onClose={handleCloseLeadDetail}
        PaperProps={{
          sx: { width: { xs: '100%', sm: '50vw' }, p: 0 }
        }}
      >
        {leadDetailDrawer.lead &&
          (() => {
            const lead = leadDetailDrawer.lead;
            const detail = leadDetailDrawer.detail;
            const categoryColor = getCategoryColor(lead);
            const notes = leadNotes[lead.id] || [];
            const tags = callTags[lead.id] || [];
            const systemTags = getSystemTags(lead, tags, { showClientProvided: isAdmin && Boolean(actingClientId) });
            const leadJourney = getOpenJourney(detail?.journey, journeyByLeadId.get(lead.id));
            const isLeadActiveClient = lead.lifecycle_state === 'active_client';
            // Only surface an email directly attached to THIS lead or its linked
            // journey/client record — never another row that merely shares the
            // phone number (shared/family lines would leak a different contact's
            // email into this drawer).
            const resolvedEmail = lead.caller_email || leadJourney?.client_email || detail?.journey?.client_email || null;
            const openLead = detail || lead;
            const openContactId = openLead?.contact_id || null;
            const effectiveLeadName = (openLead?.contact_name_source === 'user' && openLead?.contact_display_name)
              ? openLead.contact_display_name
              : (lead.caller_name || 'Unknown Caller');

            return (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Header — categoryColor.bg is a pastel that stays the same in both modes,
                    so force text to categoryColor.text (dark, paired with the bg) instead of
                    inheriting the theme's text color (white in dark mode = invisible on pastel). */}
                <Box sx={{ p: 2, bgcolor: categoryColor.bg, borderBottom: `3px solid ${categoryColor.border}`, color: categoryColor.text }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      {renameState.editing ? (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <TextField
                            size="small"
                            value={renameState.value}
                            onChange={(e) => setRenameState((s) => ({ ...s, value: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveContactName(openContactId);
                              if (e.key === 'Escape') setRenameState({ editing: false, value: '', saving: false });
                            }}
                            autoFocus
                            sx={{
                              '& .MuiInputBase-root': { bgcolor: 'background.paper' },
                              minWidth: 180
                            }}
                          />
                          <LoadingButton
                            size="small"
                            variant="contained"
                            loading={renameState.saving}
                            loadingLabel="Saving…"
                            onClick={() => handleSaveContactName(openContactId)}
                          >
                            Save
                          </LoadingButton>
                          <Button
                            size="small"
                            onClick={() => setRenameState({ editing: false, value: '', saving: false })}
                            sx={{ color: categoryColor.text }}
                          >
                            Cancel
                          </Button>
                        </Stack>
                      ) : (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="h5" fontWeight={600} sx={{ color: categoryColor.text }}>
                            {effectiveLeadName}
                          </Typography>
                          {openContactId && (
                            <Tooltip title="Edit name">
                              <IconButton
                                size="small"
                                aria-label="Edit contact name"
                                onClick={() => setRenameState({ editing: true, value: (openLead?.contact_display_name || ''), saving: false })}
                                sx={{ color: categoryColor.text, opacity: 0.7 }}
                              >
                                <EditIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      )}
                      <Typography variant="body2" sx={{ mt: 0.5, color: categoryColor.text, opacity: 0.75 }}>
                        <PhoneIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
                        {lead.caller_number ? formatPhone(lead.caller_number) : 'No number'}
                      </Typography>
                      {resolvedEmail && (
                        <Typography variant="body2" sx={{ mt: 0.5, color: categoryColor.text, opacity: 0.75, wordBreak: 'break-all' }}>
                          <EmailIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
                          {resolvedEmail}
                        </Typography>
                      )}
                      {lead.id && (
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: categoryColor.text, opacity: 0.6, wordBreak: 'break-all' }}>
                          ID - {lead.id}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                        <Chip
                          label={getVisibleCategory(lead).label}
                          size="small"
                          sx={{
                            bgcolor: categoryColor.bg,
                            color: categoryColor.text,
                            border: `1px solid ${categoryColor.border}`,
                            fontWeight: 600
                          }}
                        />
                        {needsCallbackFollowUp(lead) && (
                          <Chip
                            icon={<WarningIcon sx={{ fontSize: 14 }} />}
                            label="Callback Needed"
                            size="small"
                            variant="outlined"
                            sx={{
                              fontWeight: 600,
                              color: 'warning.dark',
                              borderColor: 'warning.main',
                              bgcolor: 'warning.lighter'
                            }}
                          />
                        )}
                      </Stack>
                    </Box>
                    <IconButton onClick={handleCloseLeadDetail} sx={{ color: categoryColor.text }}>
                      <CloseIcon />
                    </IconButton>
                  </Stack>
                  {/* Tags in header */}
                  {(systemTags.length > 0 || tags.length > 0) && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                      {systemTags.map((tag) => (
                        <Chip
                          key={`system-header-${lead.id}-${tag.key || tag.label}`}
                          label={tag.label || tag.name}
                          size="small"
                          variant="outlined"
                          sx={{
                            fontWeight: 600,
                            color: tag.color || 'info.dark',
                            borderColor: tag.color || 'info.main',
                            bgcolor: 'background.paper'
                          }}
                        />
                      ))}
                      {tags.map((tag) => (
                        <Chip
                          key={tag.id}
                          label={tag.name}
                          size="small"
                          deleteIcon={<CloseIcon sx={{ fontSize: '14px !important' }} />}
                          onDelete={() => handleRemoveTagFromCall(lead.id, tag.id)}
                          sx={{
                            bgcolor: tag.color || '#6366f1',
                            color: 'white',
                            fontWeight: 500,
                            '& .MuiChip-deleteIcon': {
                              color: 'rgba(255,255,255,0.7)',
                              '&:hover': { color: 'white' }
                            }
                          }}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>

                {/* Tabs */}
                <Tabs
                  value={leadDetailDrawer.tab}
                  onChange={(e, v) => setLeadDetailDrawer((prev) => ({ ...prev, tab: v }))}
                  sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
                >
                  <Tab label="Overview" />
                  <Tab label="Transcript" />
                  <Tab label="Activity" />
                </Tabs>

                {/* Tab Content */}
                <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                  {leadDetailDrawer.loading ? (
                    <Stack spacing={2}>
                      <Skeleton variant="rectangular" height={100} />
                      <Skeleton variant="rectangular" height={200} />
                    </Stack>
                  ) : leadDetailDrawer.tab === 0 ? (
                    /* Overview Tab */
                    <Stack spacing={3}>
                      {/* Actions Section */}
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Actions
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {!isLeadActiveClient && (
                            <Button variant="contained" color="primary" onClick={() => onOpenConcernDialog(lead, leadJourney)}>
                              {leadJourney ? 'Update Journey' : 'Start Journey'}
                            </Button>
                          )}
                          {!isLeadActiveClient && (
                            <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => onOpenServiceDialog(lead)}>
                              Add To Client List
                            </Button>
                          )}
                          {lifecycleFilter === 'lead_inbox' && (
                            <Button
                              variant={lead.hidden_at ? 'outlined' : 'contained'}
                              color="error"
                              onClick={(e) => {
                                if (lead.hidden_at) {
                                  handleUnhideCall(lead);
                                } else {
                                  setHidePopover({ anchorEl: e.currentTarget, call: lead });
                                }
                              }}
                            >
                              {lead.hidden_at ? 'Unarchive' : 'Archive'}
                            </Button>
                          )}
                          {isLeadActiveClient && (
                            <Typography variant="body2" color="text.secondary">
                              This contact is already an active client.
                            </Typography>
                          )}
                        </Stack>
                      </Box>

                      {/* Classification Section */}
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Classification
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {[
                            { label: 'Qualified', raw: 'warm', keys: ['qualified', 'returning'] },
                            { label: 'Priority', raw: 'needs_attention', keys: ['needs_attention'] },
                            { label: 'Unanswered', raw: 'unanswered', keys: ['unanswered'] },
                            { label: 'Not a Fit', raw: 'not_a_fit', keys: ['not_a_fit'] },
                            { label: 'Spam', raw: 'spam', keys: ['spam'] }
                          ].map(({ label, raw, keys }) => {
                            const catColor = getCategoryColor(raw);
                            const isSelected = keys.includes(getVisibleCategory(lead).key);
                            return (
                              <Chip
                                key={raw}
                                label={label}
                                size="small"
                                onClick={() => handleUpdateCategory(lead.id, raw)}
                                sx={{
                                  bgcolor: isSelected ? catColor.bg : 'transparent',
                                  color: isSelected ? catColor.text : 'text.secondary',
                                  border: `1px solid ${isSelected ? catColor.border : 'divider'}`,
                                  fontWeight: isSelected ? 600 : 400,
                                  cursor: 'pointer',
                                  '&:hover': { bgcolor: catColor.bg, color: catColor.text }
                                }}
                              />
                            );
                          })}
                        </Stack>
                      </Box>

                      {/* Tags Section */}
                      <Box data-tutorial="lead-tags-drawer">
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Tags
                        </Typography>
                        {/* Current tags as chips */}
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                          {systemTags.map((tag) => (
                            <Chip
                              key={`system-drawer-${lead.id}-${tag.key || tag.label}`}
                              label={tag.label || tag.name}
                              size="small"
                              variant="outlined"
                              sx={{
                                fontWeight: 600,
                                color: tag.color || 'info.dark',
                                borderColor: tag.color || 'info.main',
                                bgcolor: 'background.paper'
                              }}
                            />
                          ))}
                          {tags.map((tag) => (
                            <Chip
                              key={tag.id}
                              label={tag.name}
                              size="small"
                              deleteIcon={<CloseIcon sx={{ fontSize: '14px !important' }} />}
                              onDelete={() => handleRemoveTagFromCall(lead.id, tag.id)}
                              sx={{
                                bgcolor: tag.color || '#6366f1',
                                color: 'white',
                                fontWeight: 500,
                                '& .MuiChip-deleteIcon': {
                                  color: 'rgba(255,255,255,0.7)',
                                  '&:hover': { color: 'white' }
                                }
                              }}
                            />
                          ))}
                        </Stack>
                        {/* Add tag input */}
                        <Autocomplete
                          freeSolo
                          size="small"
                          options={allTags.filter((t) => !tags.some((existingTag) => existingTag.id === t.id)).map((t) => t.name)}
                          inputValue={newTagName}
                          onInputChange={(e, value, reason) => {
                            if (reason !== 'reset') {
                              setNewTagName(value);
                            }
                          }}
                          onChange={(e, value, reason) => {
                            if (value && (reason === 'selectOption' || reason === 'createOption')) {
                              // Ignore "already added" message
                              if (value === '— Already on this lead') return;
                              // Strip "+ Create " prefix if present
                              const cleanName = value.startsWith('+ Create "') && value.endsWith('"') ? value.slice(10, -1) : value;
                              handleAddTagToCall(lead.id, cleanName);
                              setNewTagName('');
                            }
                          }}
                          filterOptions={(options, { inputValue }) => {
                            const trimmedInput = inputValue.trim();
                            // If empty input, show nothing - user must type to see options
                            if (!trimmedInput) {
                              return [];
                            }
                            const lowerInput = trimmedInput.toLowerCase();
                            // Filter existing tags that match (case-insensitive)
                            const filtered = options.filter((option) => option.toLowerCase().includes(lowerInput));
                            // Check if it matches a tag already on this lead
                            const alreadyOnLead = tags.some((t) => t.name.toLowerCase() === lowerInput);
                            if (alreadyOnLead) {
                              filtered.push('— Already on this lead');
                              return filtered;
                            }
                            // Check if it matches an existing tag (that's not on this lead)
                            const exactMatch = options.some((o) => o.toLowerCase() === lowerInput);
                            if (!exactMatch) {
                              // Also check allTags in case it exists but is filtered from options
                              const existsInAllTags = allTags.some((t) => t.name.toLowerCase() === lowerInput);
                              if (!existsInAllTags) {
                                filtered.push(`+ Create "${trimmedInput}"`);
                              }
                            }
                            return filtered;
                          }}
                          renderOption={(props, option) => {
                            const isCreateOption = option.startsWith('+ Create "') && option.endsWith('"');
                            const isAlreadyAdded = option === '— Already on this lead';
                            const existingTag = allTags.find((t) => t.name === option);
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
                                  <Box
                                    sx={{
                                      width: 12,
                                      height: 12,
                                      borderRadius: '50%',
                                      bgcolor: existingTag.color || '#6366f1',
                                      flexShrink: 0
                                    }}
                                  />
                                )}
                                {option}
                              </Box>
                            );
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              placeholder={tags.length ? 'Add another tag...' : 'Add a tag...'}
                              variant="outlined"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTagName.trim()) {
                                  e.preventDefault();
                                  // Strip "+ Create " prefix if present
                                  const cleanName =
                                    newTagName.startsWith('+ Create "') && newTagName.endsWith('"')
                                      ? newTagName.slice(10, -1)
                                      : newTagName.trim();
                                  handleAddTagToCall(lead.id, cleanName);
                                  setNewTagName('');
                                }
                              }}
                              sx={{
                                '& .MuiOutlinedInput-root': {
                                  bgcolor: 'background.paper'
                                }
                              }}
                            />
                          )}
                          sx={{ width: '100%' }}
                          selectOnFocus
                          clearOnBlur={false}
                          handleHomeEndKeys
                          noOptionsText="Type to search or create a tag"
                        />
                      </Box>

                      {/* Summary */}
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Summary
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                          <Typography variant="body2">{getDisplaySummary(lead.classification_summary, 'No summary available.')}</Typography>
                        </Paper>
                      </Box>

                      {/* Call Details */}
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Call Details
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                          <Grid container spacing={2}>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary">
                                Date/Time
                              </Typography>
                              <Typography variant="body2">{lead.call_time || lead.time_ago}</Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary">
                                Duration
                              </Typography>
                              <Typography variant="body2">{lead.duration_formatted || 'N/A'}</Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary">
                                Source
                              </Typography>
                              <Typography variant="body2">{lead.source || 'Unknown'}</Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary">
                                Region
                              </Typography>
                              <Typography variant="body2">{lead.region || 'N/A'}</Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary">
                                Direction
                              </Typography>
                              <Typography variant="body2">{lead.is_inbound ? 'Inbound' : 'Outbound'}</Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary">
                                Caller Type
                              </Typography>
                              <Typography variant="body2">
                                {lead.caller_type === 'returning_customer'
                                  ? 'Returning Customer'
                                  : lead.caller_type === 'repeat'
                                    ? `Repeat (#${lead.call_sequence})`
                                    : 'New'}
                              </Typography>
                            </Grid>
                          </Grid>
                        </Paper>
                      </Box>

                      {/* Notes */}
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Notes ({notes.length})
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                          <Stack spacing={2}>
                            <Stack direction="row" spacing={1}>
                              <TextField
                                fullWidth
                                size="small"
                                placeholder="Add a note..."
                                value={newNoteText}
                                onChange={(e) => setNewNoteText(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                              />
                              <Button variant="contained" onClick={handleAddNote} disabled={!newNoteText.trim()}>
                                Add
                              </Button>
                            </Stack>
                            {notes.length === 0 ? (
                              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                                No notes yet.
                              </Typography>
                            ) : (
                              notes.map((note) => (
                                <Box
                                  key={note.id}
                                  sx={{
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    pb: 1.5,
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 1
                                  }}
                                >
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="body2">{note.body}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {note.author_name} · {new Date(note.created_at).toLocaleString()}
                                    </Typography>
                                  </Box>
                                  <IconButton
                                    size="small"
                                    aria-label="Delete note"
                                    onClick={() => handleDeleteNote(note)}
                                    sx={{ mt: -0.5 }}
                                  >
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                              ))
                            )}
                          </Stack>
                        </Paper>
                      </Box>

                      {/* Associated Journey */}
                      {leadJourney && (
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Associated Journey
                          </Typography>
                          <Paper
                            variant="outlined"
                            sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                            onClick={() => {
                              handleCloseLeadDetail();
                              setSearchParams({ tab: 'journey' });
                            }}
                          >
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Box>
                                <Typography variant="subtitle2">{leadJourney.client_name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {leadJourney.service_name || 'General Journey'}
                                </Typography>
                              </Box>
                              <StatusChip status={leadJourney.status} />
                            </Stack>
                          </Paper>
                        </Box>
                      )}
                    </Stack>
                  ) : leadDetailDrawer.tab === 1 ? (
                    /* Transcript Tab */
                    <Stack spacing={2}>
                      <Typography variant="subtitle2" color="text.secondary">
                        {lead.activity_type === 'call' ? 'Call Transcript' : 'Form Submission'}
                      </Typography>

                      {lead.activity_type === 'call' && (
                        <Paper variant="outlined" sx={{ p: 2 }}>
                          <audio
                            ref={audioRef}
                            src={recordingState.callId === lead.id ? recordingState.src : ''}
                            preload="metadata"
                            onLoadedMetadata={handleAudioLoadedMetadata}
                            onTimeUpdate={handleAudioTimeUpdate}
                            onPlay={handleAudioPlay}
                            onPause={handleAudioPause}
                            onEnded={handleAudioPause}
                          />

                          {recordingState.callId !== lead.id || (!recordingState.src && !recordingState.loading) ? (
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                              <Stack direction="row" spacing={1.5} alignItems="center">
                                <GraphicEqIcon color="primary" />
                                <Box>
                                  <Typography variant="subtitle2">Call Recording</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    Open the player inline in this drawer.
                                  </Typography>
                                </Box>
                              </Stack>
                              <LoadingButton
                                variant="contained"
                                size="small"
                                loading={recordingState.loading && recordingState.callId === lead.id}
                                onClick={() => handlePlayRecording(lead)}
                              >
                                Open Player
                              </LoadingButton>
                            </Stack>
                          ) : (
                            <Stack spacing={2}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                                <Box>
                                  <Typography variant="subtitle2">Call Recording</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    Inline playback for this activity ID.
                                  </Typography>
                                </Box>
                                <Stack direction="row" spacing={0.5}>
                                  {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                                    <Chip
                                      key={rate}
                                      label={`${rate}x`}
                                      size="small"
                                      onClick={() => handlePlaybackRateChange(rate)}
                                      sx={{
                                        cursor: 'pointer',
                                        bgcolor: recordingState.playbackRate === rate ? 'primary.main' : 'transparent',
                                        color: recordingState.playbackRate === rate ? 'primary.contrastText' : 'text.secondary',
                                        border: '1px solid',
                                        borderColor: recordingState.playbackRate === rate ? 'primary.main' : 'divider'
                                      }}
                                    />
                                  ))}
                                </Stack>
                              </Stack>

                              {recordingState.loading && recordingState.callId === lead.id && <LinearProgress />}

                              {recordingState.error && recordingState.callId === lead.id && (
                                <Typography variant="body2" color="error">
                                  {recordingState.error}
                                </Typography>
                              )}

                              {recordingState.src && recordingState.callId === lead.id && (
                                <>
                                  <Box
                                    onClick={handleWaveformSeek}
                                    sx={{
                                      display: 'flex',
                                      alignItems: 'end',
                                      gap: 0.5,
                                      height: 88,
                                      px: 1,
                                      py: 1.5,
                                      borderRadius: 1,
                                      bgcolor: 'grey.50',
                                      border: '1px solid',
                                      borderColor: 'divider',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {(recordingState.waveform.length ? recordingState.waveform : Array.from({ length: 56 }, () => 0.2)).map(
                                      (value, index, array) => {
                                        const progressRatio =
                                          recordingState.duration > 0 ? recordingState.currentTime / recordingState.duration : 0;
                                        const barRatio = (index + 1) / array.length;
                                        const isPlayed = barRatio <= progressRatio;
                                        return (
                                          <Box
                                            key={`${lead.id}-wave-${index}`}
                                            sx={{
                                              flex: 1,
                                              minWidth: 3,
                                              borderRadius: 999,
                                              height: `${Math.max(18, Math.round(value * 100))}%`,
                                              bgcolor: isPlayed ? 'primary.main' : 'grey.400',
                                              opacity: isPlayed ? 1 : 0.65
                                            }}
                                          />
                                        );
                                      }
                                    )}
                                  </Box>

                                  <Slider
                                    min={0}
                                    max={recordingState.duration || 0}
                                    step={0.1}
                                    value={Math.min(recordingState.currentTime, recordingState.duration || 0)}
                                    onChange={(_event, value) => handleSeekAudio(Array.isArray(value) ? value[0] : value)}
                                    sx={{ mt: -0.5 }}
                                  />

                                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                      <IconButton onClick={() => handleSkipAudio(-10)} size="small">
                                        <Replay10Icon />
                                      </IconButton>
                                      <IconButton onClick={handleToggleAudioPlayback} color="primary">
                                        {recordingState.playing ? <PauseIcon /> : <PlayArrowIcon />}
                                      </IconButton>
                                      <IconButton onClick={() => handleSkipAudio(10)} size="small">
                                        <Forward10Icon />
                                      </IconButton>
                                      <Typography variant="body2" sx={{ minWidth: 92 }}>
                                        {formatAudioTime(recordingState.currentTime)} / {formatAudioTime(recordingState.duration)}
                                      </Typography>
                                    </Stack>

                                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 180 }}>
                                      <VolumeUpIcon fontSize="small" color="action" />
                                      <Slider min={0} max={1} step={0.05} value={recordingState.volume} onChange={handleVolumeChange} />
                                    </Stack>
                                  </Stack>
                                </>
                              )}
                            </Stack>
                          )}
                        </Paper>
                      )}

                      {/* Transcript Content */}
                      {(() => {
                        // Check multiple possible sources for transcript
                        const transcriptContent =
                          lead.transcript || lead.transcription_text || lead.transcription?.text || lead.meta?.transcript || null;

                        // Detect and parse form submission transcripts (label:/value:/id: blocks).
                        // Order-agnostic: dashboard forms emit label → value → id; CTM FormReactor
                        // (e.g. CF7 integrations) emits value → id → label. We start a new block
                        // whenever a key we've already seen reappears.
                        const parseFormTranscript = (text) => {
                          if (!text || !text.includes('label:') || !text.includes('value:')) return null;
                          const lines = text
                            .split('\n')
                            .map((l) => l.trim())
                            .filter(Boolean);
                          const rows = [];
                          let current = {};
                          const flush = () => {
                            if (current.label && current.value !== undefined) rows.push(current);
                            current = {};
                          };
                          for (const line of lines) {
                            const m = line.match(/^(label|value|id):\s*(.*)$/);
                            if (!m) continue;
                            const [, key, val] = m;
                            if (current[key] !== undefined) flush();
                            current[key] = val.trim();
                          }
                          flush();
                          return rows.length ? rows : null;
                        };

                        // Only humanize machine-style values (snake_case tokens, no spaces, all lower).
                        // Free-text answers should be shown verbatim.
                        const formatValue = (val) => {
                          if (typeof val !== 'string' || !val) return val;
                          const isToken = !/\s/.test(val) && /_/.test(val) && val === val.toLowerCase();
                          if (!isToken) return val;
                          return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                        };

                        const formRows = parseFormTranscript(transcriptContent);

                        if (formRows) {
                          return (
                            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380, overflowY: 'auto' }}>
                              <Table size="small">
                                <TableBody>
                                  {formRows.map((row, i) => (
                                    <TableRow key={i} sx={{ '&:last-child td': { border: 0 } }}>
                                      <TableCell sx={{ color: 'text.secondary', width: '60%', verticalAlign: 'top', py: 1 }}>
                                        {row.label}
                                      </TableCell>
                                      <TableCell sx={{ fontWeight: 500, verticalAlign: 'top', py: 1 }}>{formatValue(row.value)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          );
                        }

                        if (transcriptContent) {
                          // Parse dialogue lines: "SPEAKER: text"
                          const parseTranscriptLines = (text) => {
                            const lines = text
                              .split('\n')
                              .map((l) => l.trim())
                              .filter(Boolean);
                            const turns = [];
                            for (const line of lines) {
                              const idx = line.indexOf(': ');
                              if (idx > 0) {
                                const rawSpeaker = line.slice(0, idx).trim();
                                const text = line.slice(idx + 2).trim();
                                // Phone numbers → Agent
                                const isPhone = /^[+\d][\d\s\-().]{6,}$/.test(rawSpeaker);
                                const speaker = isPhone ? 'Agent' : rawSpeaker;
                                turns.push({ speaker, text, isAgent: isPhone });
                              }
                            }
                            return turns;
                          };

                          const turns = parseTranscriptLines(transcriptContent);

                          if (turns.length > 1) {
                            return (
                              <Box sx={{ maxHeight: 380, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {turns.map((turn, i) => (
                                  <Box
                                    key={i}
                                    sx={{
                                      p: 1.5,
                                      borderRadius: 2,
                                      bgcolor: turn.isAgent ? 'primary.lighter' : 'grey.100',
                                      borderLeft: turn.isAgent ? '3px solid' : 'none',
                                      borderColor: 'primary.main'
                                    }}
                                  >
                                    <Typography
                                      variant="caption"
                                      fontWeight={700}
                                      color={turn.isAgent ? 'primary.dark' : 'text.secondary'}
                                      display="block"
                                      gutterBottom
                                    >
                                      {turn.speaker}
                                    </Typography>
                                    <Typography variant="body2">{turn.text}</Typography>
                                  </Box>
                                ))}
                              </Box>
                            );
                          }

                          return (
                            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', maxHeight: 380, overflow: 'auto' }}>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                {transcriptContent}
                              </Typography>
                            </Paper>
                          );
                        }

                        // If no transcript but there's a message (form submission or voicemail)
                        if (lead.message && !lead.message.includes('Call from') && lead.message.length > 20) {
                          const messageFormRows = parseFormTranscript(lead.message);
                          return (
                            <Box>
                              <Typography variant="caption" color="text.secondary" gutterBottom>
                                {lead.is_voicemail ? 'Voicemail Message' : messageFormRows ? 'Form Submission' : 'Call Notes'}
                              </Typography>
                              {messageFormRows ? (
                                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380, overflowY: 'auto' }}>
                                  <Table size="small">
                                    <TableBody>
                                      {messageFormRows.map((row, i) => (
                                        <TableRow key={i}>
                                          <TableCell sx={{ width: '45%', color: 'text.secondary', fontWeight: 500, verticalAlign: 'top' }}>
                                            {row.label}
                                          </TableCell>
                                          <TableCell sx={{ verticalAlign: 'top' }}>{formatValue(row.value)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              ) : (
                                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', maxHeight: 380, overflowY: 'auto' }}>
                                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                    {lead.message}
                                  </Typography>
                                </Paper>
                              )}
                            </Box>
                          );
                        }

                        // No transcript available
                        return (
                          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                            <Typography variant="body2" color="text.secondary">
                              {lead.is_voicemail
                                ? 'This was a voicemail. No transcript available.'
                                : lead.duration_sec && lead.duration_sec < 10
                                  ? 'Call was too short to generate transcript.'
                                  : 'No transcript available for this call.'}
                            </Typography>
                            {lead.transcript_url && (
                              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                Try viewing in CTM for more details.
                              </Typography>
                            )}
                          </Paper>
                        );
                      })()}

                      {/* AI Summary */}
                      {getDisplaySummary(lead.classification_summary, '') && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            AI Summary
                          </Typography>
                          <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="body2">
                              {getDisplaySummary(lead.classification_summary, 'No summary available.')}
                            </Typography>
                          </Paper>
                        </Box>
                      )}

                      {/* Call History in Transcript Tab */}
                      {detail?.callHistory?.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Previous Calls from this Number ({detail.callHistory.length})
                          </Typography>
                          <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
                            {detail.callHistory.map((histCall, idx) => (
                              <Box
                                key={histCall.call_id}
                                sx={{
                                  p: 1.5,
                                  borderBottom: idx < detail.callHistory.length - 1 ? '1px solid' : 'none',
                                  borderColor: 'divider'
                                }}
                              >
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Chip label={getVisibleCategory(histCall).label} size="small" sx={{ fontSize: '0.7rem' }} />
                                    <Typography variant="caption" color="text.secondary">
                                      {histCall.duration_sec
                                        ? `${Math.floor(histCall.duration_sec / 60)}m ${histCall.duration_sec % 60}s`
                                        : 'N/A'}
                                    </Typography>
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary">
                                    {new Date(histCall.started_at).toLocaleDateString()}
                                  </Typography>
                                </Stack>
                                {histCall.summary && (
                                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                    {histCall.summary}
                                  </Typography>
                                )}
                              </Box>
                            ))}
                          </Paper>
                        </Box>
                      )}
                    </Stack>
                  ) : (
                    /* Activity Tab — full contact history by phone, deep-linked to other leads */
                    <ContactActivityExpander
                      phone={lead.from_number || lead.caller_number || ''}
                      open
                      onOpenLeadDetail={handleOpenLeadDetail}
                    />
                  )}
                </Box>
              </Box>
            );
          })()}
      </Drawer>

      {/* Clear Calls Confirmation Dialog */}
      <Dialog open={clearCallsDialogOpen} onClose={() => setClearCallsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Clear All Calls?</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Are you sure you want to clear all calls and reload? This action is non-reversible.
          </Typography>
          <Typography variant="body2" color="error">
            All cached call data will be permanently deleted and fresh data will be loaded from CallTrackingMetrics.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearCallsDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleClearAndReloadCalls}>
            Yes, Clear & Reload
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reclassify Leads Dialog - Admin only */}
      <Dialog
        open={reclassifyDialog.open}
        onClose={() => !reclassifyDialog.loading && setReclassifyDialog({ open: false, loading: false, days: 7 })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Backfill Classification & Summary</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            This will re-run AI classification and regenerate summaries for leads in the selected time window. Existing ratings will be
            preserved.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This is a forced refresh for the selected time range, so summaries will be rebuilt even when the category does not change.
          </Typography>
          <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>
            Time window
          </Typography>
          <ToggleButtonGroup
            value={reclassifyDialog.days}
            exclusive
            onChange={(_, val) => val !== null && setReclassifyDialog((prev) => ({ ...prev, days: val }))}
            size="small"
            fullWidth
          >
            {[7, 14, 30, 90].map((n) => (
              <ToggleButton key={n} value={n} sx={{ flex: 1 }}>
                {n}d
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {`Will process leads from the last ${reclassifyDialog.days} day${reclassifyDialog.days === 1 ? '' : 's'}.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReclassifyDialog({ open: false, loading: false, days: 7 })} disabled={reclassifyDialog.loading}>
            Cancel
          </Button>
          <LoadingButton
            variant="contained"
            onClick={handleReclassifyLeads}
            loading={reclassifyDialog.loading}
            loadingLabel="Reclassifying..."
          >
            Refresh Classification & Summary
          </LoadingButton>
        </DialogActions>
      </Dialog>

      {/* Category Selection Menu */}
      <Menu
        anchorEl={categoryMenuAnchor}
        open={Boolean(categoryMenuAnchor)}
        onClose={() => {
          setCategoryMenuAnchor(null);
          setCategoryMenuCallId(null);
        }}
      >
        {(() => {
          const activeCall = (calls || []).find((c) => c.id === categoryMenuCallId);
          const isCall = (activeCall?.activity_type || 'call') === 'call';
          return [
            { key: 'warm', label: 'Qualified', raw: 'warm' },
            { key: 'needs_attention', label: 'Priority', raw: 'needs_attention' },
            // 'Unanswered' only makes sense on phone calls — forms, SMS, etc. can't be unanswered.
            ...(isCall ? [{ key: 'unanswered', label: 'Unanswered', raw: 'unanswered' }] : []),
            { key: 'not_a_fit', label: 'Not a Fit', raw: 'not_a_fit' },
            { key: 'spam', label: 'Spam', raw: 'spam' }
          ];
        })().map(({ key, label, raw }) => {
          const catColor = getCategoryColor(raw);
          return (
            <MenuItem
              key={key}
              onClick={() => {
                if (categoryMenuCallId) {
                  handleUpdateCategory(categoryMenuCallId, raw);
                }
              }}
              sx={{ gap: 1 }}
            >
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: catColor.border }} />
              {label}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Hide Contact Popover */}
      <Popover
        open={Boolean(hidePopover.anchorEl)}
        anchorEl={hidePopover.anchorEl}
        onClose={() => setHidePopover({ anchorEl: null, call: null })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { p: 2, maxWidth: 260 } } }}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2" fontWeight={600} textAlign="center">
            {hidePopover.call?.caller_name || hidePopover.call?.from_number || 'This contact'}
          </Typography>
          <Stack spacing={0.75}>
            <Button
              size="small"
              variant="outlined"
              fullWidth
              onClick={() => {
                if (hidePopover.call) handleHideSingleCall(hidePopover.call);
                setHidePopover({ anchorEl: null, call: null });
              }}
            >
              Archive this entry
            </Button>
            <Button
              size="small"
              variant="contained"
              color="error"
              fullWidth
              onClick={() => {
                if (hidePopover.call) handleHideCall(hidePopover.call);
                setHidePopover({ anchorEl: null, call: null });
              }}
            >
              Archive all from this contact
            </Button>
            <Button size="small" fullWidth onClick={() => setHidePopover({ anchorEl: null, call: null })}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}
