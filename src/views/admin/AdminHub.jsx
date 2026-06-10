import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import SelectField from 'ui-component/extended/SelectField';
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from 'constants/timezones';
import { DemoChip } from 'ui-component/extended/DemoBanner';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Autocomplete from '@mui/material/Autocomplete';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import OutlinedInput from '@mui/material/OutlinedInput';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';

import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import HistoryIcon from '@mui/icons-material/History';
import LanguageIcon from '@mui/icons-material/Language';
import PsychologyIcon from '@mui/icons-material/Psychology';
import FolderIcon from '@mui/icons-material/Folder';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import OndemandVideoOutlinedIcon from '@mui/icons-material/OndemandVideoOutlined';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';

import MainCard from 'ui-component/cards/MainCard';
import useAuth from 'hooks/useAuth';
import useTableSearch from 'hooks/useTableSearch';
import { clientLabel } from 'hooks/useClientLabel';
import {
  createClient,
  fetchClients,
  updateClient,
  deleteClient,
  fetchClientDetail,
  completeClientOnboarding,
  activateClient,
  deactivateClient,
  getClientOnboardingLink,
  generateClientOnboardingLink,
  getClientActivationLink,
  generateClientActivationLink,
  sendClientActivationEmail
} from 'api/clients';
import { requestPasswordReset } from 'api/auth';
import { fetchInternalUsers } from 'api/internalUsers';
import { fetchTaskWorkspaces } from 'api/tasks';
import client from 'api/client';
import { CLIENT_TYPE_PRESETS, getAiPromptForClient } from 'constants/clientPresets';
import { fetchClientServices, saveClientServices } from 'api/services';
import { getClientGroups } from 'api/clientGroups';
import { createMPSecret, createTrackingConfig, updateTrackingConfig } from 'api/tracking';
import { useToast } from 'contexts/ToastContext';
import useTutorial from 'hooks/useTutorial';
import { getErrorMessage } from 'utils/errors';
import AnchorStepIcon from 'ui-component/extended/AnchorStepIcon';
import Button from '@mui/material/Button';
import FormsTab from './FormsTab';
import NotificationsTab from './NotificationsTab';
import EmailLogsSection from './AdminHub/EmailLogsSection';
import SocialSection from './AdminHub/social/SocialSection';
import ActivityLogsTab from './AdminHub/ActivityLogsTab';
import AiClassificationLogsTab from './AdminHub/AiClassificationLogsTab';
import DocumentsTab from './AdminHub/DocumentsTab';
import BrandAssetsTab from './AdminHub/BrandAssetsTab';
import ClientGroupsManager, { getGroupIcon } from './AdminHub/ClientGroupsManager';
import TeamTab from './AdminHub/TeamTab';
import TrackingTab from './AdminHub/TrackingTab';
import ClientSitesTab from './AdminHub/ClientSitesTab';
import ConnectedAccountsSection from './AdminHub/tracking/ConnectedAccountsSection';

const EMPTY_SERVICE_LIST = Object.freeze([]);
const CLIENT_PACKAGE_OPTIONS = ['Essentials', 'Growth', 'Accelerate', 'Custom'];
const EMPTY_SUBTYPE_LIST = Object.freeze([]);

const makeLocalServiceId = () => `svc-${Math.random().toString(36).slice(2, 11)}`;
const formatServiceLabel = (value = '') =>
  String(value || '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
const mapServiceRecord = (record = {}) => ({
  id: record.id || null,
  localId: record.id || makeLocalServiceId(),
  name: record.name || '',
  description: record.description || '',
  base_price: record.base_price === null || record.base_price === undefined || record.base_price === '' ? '' : String(record.base_price),
  active: record.active !== false,
  isPreset: false
});
const buildNewServiceDraft = (name, options = {}) => ({
  id: null,
  localId: makeLocalServiceId(),
  name,
  description: options.description || '',
  base_price: options.base_price !== undefined ? options.base_price : '0',
  active: true,
  isPreset: options.isPreset || false
});
const getSubtypePresetServices = (clientType, clientSubtype) =>
  CLIENT_TYPE_PRESETS.find((type) => type.value === clientType)?.subtypes?.find((sub) => sub.value === clientSubtype)?.services || EMPTY_SERVICE_LIST;
const buildPresetServiceDrafts = (clientType, clientSubtype) =>
  getSubtypePresetServices(clientType, clientSubtype)
    .filter(Boolean)
    .map((name) => buildNewServiceDraft(formatServiceLabel(name), { isPreset: true }));
const mapBusinessTypeToTrackingType = (clientType) => {
  if (!clientType) return null;
  return clientType === 'medical' ? 'medical' : 'non_medical';
};
const hasAnyTrackingSelection = (record = {}) =>
  Boolean(record.ga4_property_id || record.google_ads_customer_id || record.meta_ad_account_id || record.meta_pixel_id);
const pickTrackingFields = (config = {}) => ({
  tracking_config_id: config?.id || config?.tracking_config_id || null,
  tracking_client_type: config?.client_type || config?.tracking_client_type || null,
  ga4_property_id: config?.ga4_property_id || null,
  ga4_measurement_id: config?.ga4_measurement_id || null,
  google_ads_customer_id: config?.google_ads_customer_id || null,
  meta_ad_account_id: config?.meta_ad_account_id || null,
  meta_pixel_id: config?.meta_pixel_id || null,
  browser_meta_pixel_enabled: config?.browser_meta_pixel_enabled || false
});

// Helper to check if email is a placeholder (used during client creation before onboarding)
const isPlaceholderEmail = (email) => (email || '').includes('@placeholder.anchor');

const ADMIN_VIDEO_TUTORIALS = [
  {
    id: 'admin-adding-managing-clients-video',
    label: 'Adding/Managing Clients',
    description:
      'Details adding new clients, assigning account managers, categorizing businesses, and customizing service scopes.',
    videoSrc: 'https://player.vimeo.com/video/1189135544?h=64f8cb6383&badge=0&autopause=0&player_id=0&app_id=58479'
  }
];

export default function AdminHub() {
  const { user, initializing, setActingClient } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { tutorials, completedIds, activeTutorial, startTutorial } = useTutorial();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newClient, setNewClient] = useState({ businessName: '', email: '', name: '', role: 'client', isExisting: false });
  const [savingNew, setSavingNew] = useState(false);
  // Post-create invite dialog for existing clients
  const [inviteDialog, setInviteDialog] = useState({ open: false, clientId: null, clientName: '', url: '' });
  const [sendingActivationEmail, setSendingActivationEmail] = useState(false);
  const [sendActivationConfirm, setSendActivationConfirm] = useState({ open: false, clientId: null, clientName: '' });

  const [editing, setEditing] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const [internalUsers, setInternalUsers] = useState([]);
  const [loadingInternalUsers, setLoadingInternalUsers] = useState(false);

  const [brandData, setBrandData] = useState(null);
  const [savingBrand, setSavingBrand] = useState(false);
  const [editingDisplayLogo, setEditingDisplayLogo] = useState(null);
  const [clientServices, setClientServices] = useState([]);
  const [clientServicesLoading, setClientServicesLoading] = useState(false);
  const [clientServicesReady, setClientServicesReady] = useState(false);
  const pendingSubtypePresetRef = useRef(null);
  const lastAppliedPromptRef = useRef('');
  const [deletingClientId, setDeletingClientId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, clientId: null, label: '', hasBoard: false, deleteBoard: false });
  const [selectedClientIds, setSelectedClientIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState('');
  const [onboardingWizardOpen, setOnboardingWizardOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const ONBOARDING_WIZARD_LAST_STEP = 2;
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [sendOnboardingEmailFlag, setSendOnboardingEmailFlag] = useState(true);
  const [sendingOnboardingEmail, setSendingOnboardingEmail] = useState(false);
  const [activatingClientId, setActivatingClientId] = useState('');
  const [completingOnboardingId, setCompletingOnboardingId] = useState('');
  const [deactivatingClientId, setDeactivatingClientId] = useState('');
  const [deactivateConfirm, setDeactivateConfirm] = useState({ open: false, client: null });
  const [copyingLinkForId, setCopyingLinkForId] = useState('');
  const [taskWorkspaces, setTaskWorkspaces] = useState([]);
  const [taskWorkspacesLoading, setTaskWorkspacesLoading] = useState(false);

  // Client Groups (for organizing clients)
  const [clientGroups, setClientGroups] = useState([]);
  const [, setClientGroupsLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({ '__ungrouped__': true }); // Ungrouped expanded by default
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  // Drag and drop state
  const [draggedClient, setDraggedClient] = useState(null);
  const [dragOverGroup, setDragOverGroup] = useState(null);
  // Track if we're creating a group for bulk assignment
  const [bulkGroupClientIds, setBulkGroupClientIds] = useState(null);

  // Hub Section Tabs (0 = Users & Clients, 1 = Email Logs)
  const [hubSection, setHubSection] = useState(0);





  const effectiveRole = user?.effective_role || user?.role;
  const isSuperAdmin = effectiveRole === 'superadmin';
  const isAdmin = effectiveRole === 'superadmin' || effectiveRole === 'admin';
  const canAccessHub = isAdmin || effectiveRole === 'team';

  // Roles assignable to a staff member via this UI. Never includes 'superadmin'
  // (cannot be granted through the staff drawer) or 'client' (different surface).
  const editableRoles = ['admin', 'team'];
  // Admins and superadmins can edit other staff members' roles, including peers.
  // Only superadmin can change a superadmin's role; nobody can change their own
  // role via this UI.
  const canEditUserRole = (targetRole, targetUserId = null) => {
    if (!['superadmin', 'admin'].includes(effectiveRole)) return false;
    if (targetUserId && user?.id && String(targetUserId) === String(user.id)) return false;
    if (targetRole === 'superadmin' && effectiveRole !== 'superadmin') return false;
    return true;
  };
  const isStaffRole = (role) => ['superadmin', 'admin', 'team'].includes(role);

  const reportError = useCallback(
    (err, fallback) => {
      const msg = getErrorMessage(err, fallback);
      setError(msg);
      toast.error(msg);
    },
    [toast]
  );

  useEffect(() => {
    if (!canAccessHub) return;
    let active = true;
    setLoading(true);
    setClientGroupsLoading(true);
    Promise.all([
      fetchClients(),
      getClientGroups()
    ])
      .then(([clientsData, groupsData]) => {
        if (active) {
          setClients(clientsData);
          const groups = groupsData?.groups || [];
          setClientGroups(groups);
          // Initialize all groups as expanded
          setExpandedGroups((prev) => {
            const next = { ...prev, '__ungrouped__': true };
            groups.forEach((g) => {
              if (next[g.id] === undefined) next[g.id] = true;
            });
            return next;
          });
        }
      })
      .catch((err) => {
        if (active) reportError(err, 'Unable to load clients');
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setClientGroupsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [canAccessHub]);


  useEffect(() => {
    if (!canAccessHub) return;
    setLoadingInternalUsers(true);
    fetchInternalUsers()
      .then((users) => setInternalUsers(Array.isArray(users) ? users : []))
      .catch((err) => reportError(err, 'Unable to load internal users'))
      .finally(() => setLoadingInternalUsers(false));
  }, [canAccessHub]);

  useEffect(() => {
    if (!canAccessHub) return;
    let active = true;
    setTaskWorkspacesLoading(true);
    fetchTaskWorkspaces()
      .then((rows) => {
        if (!active) return;
        setTaskWorkspaces(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!active) return;
        setTaskWorkspaces([]);
      })
      .finally(() => {
        if (!active) return;
        setTaskWorkspacesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canAccessHub]);


  useEffect(() => {
    if (!editing?.id) {
      setClientServices([]);
      setClientServicesLoading(false);
      setClientServicesReady(false);
      return;
    }
    let active = true;
    setClientServicesLoading(true);
    setClientServicesReady(false);
    fetchClientServices(editing.id)
      .then((services) => {
        if (!active) return;
        const normalized = Array.isArray(services) ? services : [];
        const pendingSubtypePreset = pendingSubtypePresetRef.current;
        if (pendingSubtypePreset?.clientId === editing.id) {
          setClientServices(pendingSubtypePreset.services);
          pendingSubtypePresetRef.current = null;
          return;
        }
        setClientServices(normalized.map((service) => mapServiceRecord(service)));
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Unable to load client services');
        setClientServices([]);
      })
      .finally(() => {
        if (!active) return;
        setClientServicesLoading(false);
        setClientServicesReady(true);
      });
    return () => {
      active = false;
    };
  }, [editing?.id]);

  const selectedTypePreset = useMemo(() => CLIENT_TYPE_PRESETS.find((type) => type.value === editing?.client_type), [editing?.client_type]);
  const subtypeOptions = selectedTypePreset?.subtypes || EMPTY_SUBTYPE_LIST;

  useEffect(() => {
    if (!isAdmin || !editing) return;
    if (!editing.client_type) {
      lastAppliedPromptRef.current = '';
      if (editing.ai_prompt) {
        setEditing((prev) => (prev ? { ...prev, ai_prompt: '' } : prev));
      }
      return;
    }

    const prompt = getAiPromptForClient(editing.client_type, editing.client_subtype);
    const shouldApplyPreset = !editing.ai_prompt || editing.ai_prompt === lastAppliedPromptRef.current;
    if (shouldApplyPreset || editing.ai_prompt === prompt) {
      lastAppliedPromptRef.current = prompt;
      setEditing((prev) => (prev ? { ...prev, ai_prompt: prompt } : prev));
    }
  }, [editing?.client_type, editing?.client_subtype, editing?.ai_prompt, isAdmin]);

  const sortedClients = useMemo(() => {
    const displayKey = (c) =>
      c.client_label ||
      c.business_name ||
      `${c.first_name || ''} ${c.last_name || ''}`.trim() ||
      (isPlaceholderEmail(c.email) ? 'New Client' : c.email || '');
    return [...clients].sort((a, b) => displayKey(a).localeCompare(displayKey(b)));
  }, [clients]);

  const sortedEditors = useMemo(
    () => sortedClients.filter((c) => c.role === 'admin' || c.role === 'superadmin' || c.role === 'team'),
    [sortedClients]
  );
  const sortedClientOnly = useMemo(() => sortedClients.filter((c) => c.role === 'client'), [sortedClients]);

  const {
    query: adminsQuery,
    setQuery: setAdminsQuery,
    filtered: filteredAdmins
  } = useTableSearch(sortedEditors, ['email', 'first_name', 'last_name', 'role']);
  const {
    query: clientsQuery,
    setQuery: setClientsQuery,
    filtered: filteredClients
  } = useTableSearch(sortedClientOnly, ['email', 'first_name', 'last_name', 'role']);
  const activeAdminTutorialId = activeTutorial?.tutorial?.id || null;
  const activeAdminTutorialStep = activeTutorial?.stepIndex ?? -1;
  const tutorialClient =
    editing?.role === 'client'
      ? sortedClientOnly.find((client) => client.id === editing.id) || editing
      : sortedClientOnly[0] || null;

  // Group clients by client_group_id for accordion display
  const { groupedClients, ungroupedClients } = useMemo(() => {
    const grouped = {};
    const ungrouped = [];
    filteredClients.forEach((client) => {
      if (client.client_group_id) {
        if (!grouped[client.client_group_id]) {
          grouped[client.client_group_id] = [];
        }
        grouped[client.client_group_id].push(client);
      } else {
        ungrouped.push(client);
      }
    });
    return { groupedClients: grouped, ungroupedClients: ungrouped };
  }, [filteredClients]);

  useEffect(() => {
    // Keep selection valid as the client list changes.
    setSelectedClientIds((prev) => prev.filter((id) => sortedClientOnly.some((c) => c.id === id)));
  }, [sortedClientOnly]);


  const toggleSelectClient = (clientId) => {
    setSelectedClientIds((prev) => {
      if (prev.includes(clientId)) return prev.filter((id) => id !== clientId);
      return [...prev, clientId];
    });
  };

  const handleApplyBulkAction = async () => {
    if (!selectedClientIds.length || !bulkAction) return;
    if (bulkAction === 'delete') {
      setBulkDeleteConfirmOpen(true);
      return;
    }
    // Handle group assignment
    if (bulkAction.startsWith('group:')) {
      const groupId = bulkAction.replace('group:', '');

      // Handle creating a new group
      if (groupId === '__new__') {
        setBulkGroupClientIds([...selectedClientIds]);
        setGroupDialogOpen(true);
        setBulkAction('');
        return;
      }

      const newGroupId = groupId === '__none__' ? null : groupId;
      const group = newGroupId ? clientGroups.find((g) => g.id === newGroupId) : null;
      try {
        // Update each selected client
        await Promise.all(
          selectedClientIds.map((clientId) => updateClient(clientId, { client_group_id: newGroupId }))
        );
        // Immediately update local state
        setClients((prev) =>
          prev.map((c) =>
            selectedClientIds.includes(c.id)
              ? {
                  ...c,
                  client_group_id: newGroupId,
                  client_group_name: group?.name || null,
                  client_group_color: group?.color || null,
                  client_group_icon: group?.icon || null,
                  client_group_icon_url: group?.icon_url || null
                }
              : c
          )
        );
        toast.success(newGroupId ? `Moved ${selectedClientIds.length} client(s) to ${group?.name}` : `Removed ${selectedClientIds.length} client(s) from group`);
        setSelectedClientIds([]);
        setBulkAction('');
      } catch {
        toast.error('Failed to update client groups');
      }
      return;
    }
  };

  const handleBulkDeleteClients = async () => {
    if (!selectedClientIds.length) return;
    setBulkDeleting(true);
    setError('');
    setSuccess('');
    try {
      await Promise.all(selectedClientIds.map((id) => deleteClient(id)));
      setClients((prev) => prev.filter((c) => !selectedClientIds.includes(c.id)));
      if (editing?.id && selectedClientIds.includes(editing.id)) setEditing(null);
      setSelectedClientIds([]);
      setSuccess(`Deleted ${selectedClientIds.length} client(s).`);
    } catch (err) {
      reportError(err, 'Unable to delete selected clients');
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirmOpen(false);
    }
  };

  const handleAddClient = async () => {
    setSavingNew(true);
    setError('');
    setSuccess('');
    try {
      const res = await createClient(newClient);
      setSuccess(res.created ? 'Client created' : 'Client updated');
      setClients((prev) => {
        const others = prev.filter((c) => c.id !== res.client.id);
        return [...others, res.client];
      });
      setNewClient({ businessName: '', email: '', name: '', role: 'client', isExisting: false });
      if (res.client.role === 'client' && !res.isExisting) {
        await startOnboardingFlow(res.client.id);
      } else if (res.client.role === 'client' && res.isExisting) {
        // Existing client — account is active immediately. Show the owner-invite
        // dialog so admin can copy the claim link or send email when ready.
        setInviteDialog({
          open: true,
          clientId: res.client.id,
          clientName: res.client.first_name || res.client.email || 'this client',
          url: res.inviteUrl || ''
        });
        setSuccess('Client created and activated. Share the owner invite when you\'re ready.');
      } else if (res.client.role === 'admin' || res.client.role === 'team') {
        try {
          await requestPasswordReset(res.client.email);
          setSuccess(`${res.client.role === 'team' ? 'Team user' : 'Admin'} created. Password reset email sent.`);
        } catch (resetErr) {
          reportError(resetErr, 'User created, but failed to send reset email.');
        }
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409) {
        const normalizedEmail = String(newClient?.email || '')
          .trim()
          .toLowerCase();
        const existingIdFromApi = err?.response?.data?.existing_user_id || null;
        const existingClient =
          clients.find((c) => c.id === existingIdFromApi) ||
          clients.find(
            (c) =>
              String(c.email || '')
                .trim()
                .toLowerCase() === normalizedEmail
          ) ||
          null;

        if (existingClient?.id) {
          setNewClient({ businessName: '', email: '', name: '', role: 'client', isExisting: false });
          const label = existingClient.first_name || existingClient.email || 'this user';
          setSuccess(`This email is already registered to ${label}. Opening their record.`);
          try {
            const detail = await fetchClientDetail(existingClient.id);
            startEdit(detail);
          } catch (detailErr) {
            reportError(detailErr, 'Unable to open existing client');
          }
          return;
        }
      }

      reportError(err, 'Unable to save client');
    } finally {
      setSavingNew(false);
    }
  };

  // Helper to render a client row (reused for both ungrouped and grouped clients)
  const renderClientRow = (c) => (
    <TableRow
      key={c.id}
      hover
      draggable
      onDragStart={(e) => handleDragStart(e, c)}
      onDragEnd={handleDragEnd}
      sx={{
        cursor: 'grab',
        opacity: draggedClient?.id === c.id ? 0.5 : 1,
        '&:active': { cursor: 'grabbing' }
      }}
    >
      <TableCell padding="checkbox">
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled', cursor: 'grab' }} />
          <Checkbox
            size="small"
            checked={selectedClientIds.includes(c.id)}
            onChange={() => toggleSelectClient(c.id)}
            disabled={!isAdmin}
            onClick={(e) => e.stopPropagation()}
          />
        </Stack>
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={1} alignItems="center">
          <span>{c.client_label || c.business_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || (isPlaceholderEmail(c.email) ? 'New Client' : c.email)}</span>
          <DemoChip isDemo={c.is_demo} />
        </Stack>
      </TableCell>
      <TableCell>{isPlaceholderEmail(c.email) ? <Typography variant="body2" color="text.secondary" fontStyle="italic">Pending onboarding</Typography> : c.email}</TableCell>
      <TableCell sx={{ textTransform: 'capitalize' }}>{c.role || 'client'}</TableCell>
      <TableCell>
        {c.role === 'client' ? (
          c.onboarding_completed_at ? (
            c.activated_at ? (
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'success.main' }} title={`Activated: ${new Date(c.activated_at).toLocaleString()}`}>
                Active
              </Typography>
            ) : (
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'info.main' }} title={`Onboarding completed: ${new Date(c.onboarding_completed_at).toLocaleString()}`}>
                Pending Activation
              </Typography>
            )
          ) : c.onboarding_link_status === 'active' ? (
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'success.main' }} title={c.onboarding_link_expires_at ? `Expires: ${new Date(c.onboarding_link_expires_at).toLocaleString()}` : ''}>
              Link Active
            </Typography>
          ) : c.onboarding_link_status === 'consumed' ? (
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'warning.main' }}>In Progress</Typography>
          ) : c.onboarding_link_status === 'expired' ? (
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'error.main' }}>Link Expired</Typography>
          ) : (
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>No Link</Typography>
          )
        ) : (
          <Typography variant="caption" color="text.secondary">—</Typography>
        )}
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => startEdit(c)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {isAdmin && (
            <Tooltip title="Delete">
              <span>
                <IconButton size="small" color="error" onClick={() => confirmDeleteClient(c.id)} disabled={deletingClientId === c.id}>
                  {deletingClientId === c.id ? <CircularProgress size={18} color="inherit" /> : <DeleteOutlineIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          {c.role === 'client' && !c.onboarding_completed_at && c.onboarding_link_status === 'active' && (
            <Tooltip title="Copy onboarding link">
              <span>
                <IconButton size="small" onClick={() => handleCopyOnboardingLink(c.id)} disabled={copyingLinkForId === c.id}>
                  {copyingLinkForId === c.id ? <CircularProgress size={18} color="inherit" /> : <ContentCopyIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          {c.role === 'client' && !c.onboarding_completed_at && (!c.onboarding_link_status || c.onboarding_link_status === 'expired') && (
            <Tooltip title="Set up onboarding">
              <IconButton size="small" color="primary" onClick={() => startOnboardingFlow(c.id)} disabled={onboardingLoading}>
                <SendIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {c.role === 'client' && c.onboarding_completed_at && !c.activated_at && (
            <>
              <Tooltip title="Copy owner invite link">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => handleCopyActivationLink(c.id, c.first_name || c.email)}
                    disabled={copyingLinkForId === c.id}
                  >
                    {copyingLinkForId === c.id ? <CircularProgress size={18} color="inherit" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Send owner invite email">
                <span>
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => setSendActivationConfirm({ open: true, clientId: c.id, clientName: c.first_name || c.email })}
                    disabled={sendingActivationEmail}
                  >
                    <SendIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Button size="small" variant="contained" color="secondary" onClick={() => handleActivateClient(c.id)} disabled={activatingClientId === c.id}>
                {activatingClientId === c.id ? 'Activating…' : 'Activate'}
              </Button>
            </>
          )}
          {c.role === 'client' && c.activated_at && c.has_pending_self_invite && (
            <>
              <Tooltip title="Copy owner invite link">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => handleCopyActivationLink(c.id, c.first_name || c.email)}
                    disabled={copyingLinkForId === c.id}
                  >
                    {copyingLinkForId === c.id ? <CircularProgress size={18} color="inherit" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Send owner invite email">
                <span>
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => setSendActivationConfirm({ open: true, clientId: c.id, clientName: c.first_name || c.email })}
                    disabled={sendingActivationEmail}
                  >
                    <SendIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
          {(c.role !== 'client' || Boolean(c.onboarding_completed_at)) && (
            <Button
              size="small"
              variant="contained"
              disableElevation
              onClick={() => {
                if (c.role === 'client' && !c.onboarding_completed_at) return;
                const displayName = clientLabel(c) || 'Client';
                setActingClient(c.id, displayName);
                navigate('/portal');
              }}
            >
              Jump to View
            </Button>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );


  const startEdit = useCallback((clientData) => {
    const displayName = [clientData.first_name, clientData.last_name].filter(Boolean).join(' ').trim();
    const accessRequirements = {
      requires_website_access: clientData.requires_website_access !== false,
      requires_ga4_access: clientData.requires_ga4_access !== false,
      requires_google_ads_access: clientData.requires_google_ads_access !== false,
      requires_meta_access: clientData.requires_meta_access !== false,
      requires_forms_step: clientData.requires_forms_step !== false
    };
    const cleanEmail = isPlaceholderEmail(clientData.email) ? '' : clientData.email;
    setEditing({ ...clientData, ...accessRequirements, display_name: clientData.display_name || displayName, email: cleanEmail });
    setActiveTab(0);
    setSuccess('');
    setError('');
  }, []);

  useEffect(() => {
    if (!activeAdminTutorialId?.startsWith('admin-')) return;
    if (hubSection !== 0) {
      setHubSection(0);
    }
  }, [activeAdminTutorialId, hubSection]);

  useEffect(() => {
    // Always reset first so the previous client's logo doesn't flash while
    // the next request is in flight.
    setEditingDisplayLogo(null);
    if (!editing?.id || isStaffRole(editing.role)) return undefined;
    let active = true;
    client
      .get(`/hub/brand/admin/${editing.id}`)
      .then((res) => {
        if (!active) return;
        setEditingDisplayLogo(res.data?.brand?.display_logo || null);
      })
      .catch(() => {
        if (active) setEditingDisplayLogo(null);
      });
    return () => {
      active = false;
    };
  }, [editing?.id, editing?.role]);

  useEffect(() => {
    if (brandData?.display_logo !== undefined) {
      setEditingDisplayLogo(brandData.display_logo || null);
    }
  }, [brandData?.display_logo]);

  useEffect(() => {
    if (!activeAdminTutorialId?.startsWith('admin-')) return;
    if (activeAdminTutorialStep < 2 || !tutorialClient) return;

    if (!editing || editing.role !== 'client' || editing.id !== tutorialClient.id) {
      startEdit(tutorialClient);
      return;
    }

    const tutorialTabMap = {
      'admin-forms': 3,
      'admin-team': 4,
      'admin-notifications': 5,
      'admin-tracking': 7
    };
    const nextTab = tutorialTabMap[activeAdminTutorialId];
    if (Number.isInteger(nextTab) && activeTab !== nextTab) {
      setActiveTab(nextTab);
    }
  }, [activeAdminTutorialId, activeAdminTutorialStep, tutorialClient, editing, activeTab, startEdit]);

  const handleEditChange = (key) => (event) => {
    setEditing((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const handleAnalyticsChange = (key) => (event) => {
    setEditing((prev) => ({
      ...prev,
      analytics_defaults: { ...(prev.analytics_defaults || {}), [key]: event.target.value }
    }));
  };

  const syncTrackingConfigFromDetails = useCallback(async (draft) => {
    if (!draft?.id || draft.role !== 'client') return null;

    const trackingClientType = mapBusinessTypeToTrackingType(draft.client_type);
    const hasTrackingSelection = hasAnyTrackingSelection(draft);

    if (!draft.tracking_config_id && !hasTrackingSelection) {
      return null;
    }

    if (!trackingClientType) {
      if (hasTrackingSelection) {
        throw new Error('Select a Client Type before saving connected accounts.');
      }
      return null;
    }

    const payload = {
      client_type: trackingClientType,
      ga4_property_id: draft.ga4_property_id || null,
      ga4_measurement_id: draft.ga4_property_id ? draft.ga4_measurement_id || null : null,
      google_ads_customer_id: draft.google_ads_customer_id || null,
      meta_ad_account_id: draft.meta_ad_account_id || null,
      meta_pixel_id: draft.meta_ad_account_id ? draft.meta_pixel_id || null : null,
      browser_meta_pixel_enabled: trackingClientType !== 'medical' && !!draft.meta_pixel_id
    };

    let config = null;
    if (draft.tracking_config_id) {
      const result = await updateTrackingConfig(draft.tracking_config_id, payload);
      config = result?.config || null;
    } else if (hasTrackingSelection) {
      const result = await createTrackingConfig({ ...payload, user_id: draft.id });
      config = result?.config || null;
    }

    if (config?.ga4_property_id) {
      try {
        await createMPSecret(config.ga4_property_id);
      } catch {
        // Non-fatal — the tracking config itself is still valid.
      }
    }

    return config ? pickTrackingFields(config) : null;
  }, []);

  const handleSaveEdit = async ({ exitAfterSave = true, silent = false } = {}) => {
    if (!editing) return false;
    setSavingEdit(true);
    setError('');
    if (!silent) setSuccess('');
    let saved = false;
    let updatedClient = null;
    try {
      updatedClient = await updateClient(editing.id, {
        display_name: editing.display_name,
        first_name: editing.first_name,
        last_name: editing.last_name,
        user_email: editing.email,
        role: editing.role,
        client_type: editing.client_type,
        client_subtype: editing.client_subtype,
        client_package: editing.client_package,
        requires_website_access: editing.requires_website_access !== false,
        requires_ga4_access: editing.requires_ga4_access !== false,
        requires_google_ads_access: editing.requires_google_ads_access !== false,
        requires_meta_access: editing.requires_meta_access !== false,
        requires_forms_step: editing.requires_forms_step !== false,
        website_access_provided: editing.website_access_provided,
        website_access_understood: editing.website_access_understood,
        ga4_access_provided: editing.ga4_access_provided,
        ga4_access_understood: editing.ga4_access_understood,
        google_ads_access_provided: editing.google_ads_access_provided,
        google_ads_access_understood: editing.google_ads_access_understood,
        meta_access_provided: editing.meta_access_provided,
        meta_access_understood: editing.meta_access_understood,
        website_forms_details_provided: editing.website_forms_details_provided,
        website_forms_details_understood: editing.website_forms_details_understood,
        website_forms_uses_third_party: editing.website_forms_uses_third_party,
        website_forms_uses_hipaa: editing.website_forms_uses_hipaa,
        website_forms_connected_crm: editing.website_forms_connected_crm,
        website_forms_custom: editing.website_forms_custom,
        website_forms_notes: editing.website_forms_notes,
        looker_url: editing.looker_url,
        client_identifier_value: editing.client_identifier_value,
        task_workspace_id: editing.task_workspace_id,
        board_prefix: editing.board_prefix,
        account_manager_user_id: editing.account_manager_user_id || null,
        ai_prompt: editing.ai_prompt,
        ctm_account_number: editing.ctm_account_number,
        ctm_api_key: editing.ctm_api_key,
        ctm_api_secret: editing.ctm_api_secret,
        auto_star_enabled: editing.auto_star_enabled,
        client_group_id: editing.client_group_id || null,
        call_tracking_main_number: editing.call_tracking_main_number || '',
        front_desk_emails: editing.front_desk_emails || '',
        analytics_defaults: editing.analytics_defaults || null,
        timezone: editing.timezone || null
      });
      let servicesSynced = false;
      if (clientServicesReady && editing.id) {
        const payload = clientServices
          .filter((service) => service.active !== false)
          .map((service) => {
            const parsedPrice =
              service.base_price === '' || service.base_price === null || service.base_price === undefined
                ? null
                : Number.parseFloat(service.base_price);
            const safePrice = Number.isNaN(parsedPrice) ? null : parsedPrice;
            return {
              id: service.id,
              name: service.name,
              description: service.description || '',
              base_price: safePrice,
              active: true
            };
          });
        const latestServices = await saveClientServices(editing.id, payload);
        setClientServices(latestServices.map((service) => mapServiceRecord(service)));
        servicesSynced = true;
      }
      // Use the in-flight draft (`editing`) for connected-account fields. The PUT
      // /clients response carries the *pre-save* tracking_configs row from a join,
      // so spreading it on top of `editing` would clobber the user's just-picked
      // GA4 / Ads / Meta values and either skip the insert or write nulls into
      // an existing config.
      const trackingFields = await syncTrackingConfigFromDetails({ ...updatedClient, ...editing });
      const mergedUpdated = { ...updatedClient, ...(trackingFields || {}) };

      setClients((prev) => prev.map((c) => (c.id === mergedUpdated.id ? { ...c, ...mergedUpdated } : c)));
      if (!silent) {
        setSuccess(servicesSynced ? 'Client details & services saved' : 'Client updated');
      }
      if (exitAfterSave) {
        setEditing(null);
      } else {
        setEditing((prev) => (prev ? { ...prev, ...mergedUpdated } : prev));
      }
      saved = true;
    } catch (err) {
      if (updatedClient?.id) {
        setClients((prev) => prev.map((c) => (c.id === updatedClient.id ? { ...c, ...updatedClient } : c)));
        // Don't wipe the user's in-flight connected-account picks on error —
        // the in-flight state (`prev`) wins so they can fix the issue (e.g. set
        // a Client Type) and retry without losing their selections.
        setEditing((prev) => (prev ? { ...updatedClient, ...prev } : prev));
      }
      // In the wizard we often save with `silent: true`; still show an actionable error.
      reportError(err, updatedClient ? 'Client details saved, but tracking sync failed' : 'Unable to update client');
    } finally {
      setSavingEdit(false);
    }
    return saved;
  };

  const confirmDeleteClient = (clientId) => {
    const target = clients.find((c) => c.id === clientId);
    const label = target ? target.email || `${target.first_name || ''} ${target.last_name || ''}`.trim() : 'this client';
    const hasBoard = Boolean(target?.task_board_id);
    setDeleteConfirm({ open: true, clientId, label, hasBoard, deleteBoard: false });
  };

  const handleDeleteClient = async () => {
    const clientId = deleteConfirm.clientId;
    if (!clientId) return;
    setDeletingClientId(clientId);
    setError('');
    setSuccess('');
    try {
      const result = await deleteClient(clientId, { deleteBoard: deleteConfirm.deleteBoard });
      setClients((prev) => prev.filter((c) => c.id !== clientId));
      if (editing?.id === clientId) {
        setEditing(null);
      }
      setSuccess(result.boardDeleted ? 'Client and associated board deleted' : 'Client deleted');
    } catch (err) {
      setError(err.message || 'Unable to delete client');
    } finally {
      setDeletingClientId(null);
      setDeleteConfirm({ open: false, clientId: null, label: '', hasBoard: false, deleteBoard: false });
    }
  };

  const newRolesOptions = isSuperAdmin ? ['client', 'admin', 'team'] : ['client', 'team'];


  const startOnboardingFlow = async (clientId) => {
    setOnboardingLoading(true);
    setError('');
    try {
      const detail = await fetchClientDetail(clientId);
      startEdit(detail);
      setOnboardingWizardOpen(true);
      setOnboardingStep(0);
      setSendOnboardingEmailFlag(true);
    } catch (err) {
      setError(err.message || 'Unable to load client for onboarding');
    } finally {
      setOnboardingLoading(false);
    }
  };

  const handleClientTypeSelect = (event) => {
    const nextType = event.target.value;
    pendingSubtypePresetRef.current = null;
    lastAppliedPromptRef.current = '';
    setEditing((prev) => ({ ...prev, client_type: nextType, client_subtype: '', ai_prompt: '' }));
  };

  const handleClientSubtypeSelect = (event) => {
    const nextSubtype = event.target.value;
    const nextPresetServices = buildPresetServiceDrafts(editing?.client_type, nextSubtype);
    pendingSubtypePresetRef.current =
      nextPresetServices.length > 0 && editing?.id ? { clientId: editing.id, services: nextPresetServices } : null;
    setEditing((prev) => ({ ...prev, client_subtype: nextSubtype }));
    if (clientServicesReady && nextPresetServices.length > 0) {
      setClientServices(nextPresetServices);
      pendingSubtypePresetRef.current = null;
    }
  };

  const handleWizardClose = () => {
    setOnboardingWizardOpen(false);
    setOnboardingStep(0);
    setSendOnboardingEmailFlag(true);
    setEditing(null);
  };

  const handleWizardNext = async () => {
    const saved = await handleSaveEdit({ exitAfterSave: false, silent: true });
    if (saved) {
      setOnboardingStep((prev) => Math.min(prev + 1, ONBOARDING_WIZARD_LAST_STEP));
    }
  };

  const handleWizardBack = () => {
    setOnboardingStep((prev) => Math.max(prev - 1, 0));
  };

  const handleWizardFinish = async () => {
    if (!editing?.id) {
      handleWizardClose();
      return;
    }
    if (!sendOnboardingEmailFlag) {
      setSuccess('Client onboarding saved');
      handleWizardClose();
      return;
    }
    setSendingOnboardingEmail(true);
    setError('');
    try {
      const result = await generateClientOnboardingLink(editing.id);
      await navigator.clipboard.writeText(result.url);
      // Update local state so the list immediately shows "Link Active"
      setClients((prev) =>
        prev.map((c) =>
          c.id === editing.id ? { ...c, onboarding_link_status: 'active', onboarding_link_expires_at: result.expiresAt || null } : c
        )
      );
      setSuccess('Onboarding link generated and copied to clipboard');
      toast.success('Onboarding link generated and copied!');
      handleWizardClose();
    } catch (err) {
      const errorData = err?.response?.data;
      setError(errorData?.message || err.message || 'Unable to generate onboarding link');
    } finally {
      setSendingOnboardingEmail(false);
    }
  };

  const ACCESS_STEP_OPTIONS = [
    { key: 'requires_website_access', label: 'Website / hosting / DNS access' },
    { key: 'requires_ga4_access', label: 'Google Analytics (GA4)' },
    { key: 'requires_google_ads_access', label: 'Google Ads' },
    { key: 'requires_meta_access', label: 'Facebook / Instagram (Meta)' },
    { key: 'requires_forms_step', label: 'Website forms & integrations' }
  ];

  const toggleAccessRequirement = (key) => (event) => {
    const checked = Boolean(event.target.checked);
    setEditing((prev) => ({ ...prev, [key]: checked }));
  };

  const handleCopyOnboardingLink = async (clientId) => {
    if (!clientId) return;
    setCopyingLinkForId(clientId);
    setError('');
    setSuccess('');
    try {
      const result = await getClientOnboardingLink(clientId);
      await navigator.clipboard.writeText(result.url);
      setSuccess('Onboarding link copied to clipboard');
      toast.success('Onboarding link copied!');
    } catch (err) {
      // Check if error is "no active link" - suggest generating a new one first
      const errorData = err?.response?.data;
      if (errorData?.noActiveLink) {
        toast.error('No active onboarding link found. Send an onboarding email to create one.');
      } else {
        toast.error(errorData?.message || err.message || 'Unable to get onboarding link');
      }
    } finally {
      setCopyingLinkForId('');
    }
  };

  const handleCopyActivationLink = async (clientId, clientName) => {
    if (!clientId) return;
    setCopyingLinkForId(clientId);
    try {
      let result;
      try {
        result = await getClientActivationLink(clientId);
      } catch (err) {
        if (err?.response?.data?.noActiveLink) {
          result = await generateClientActivationLink(clientId);
        } else {
          throw err;
        }
      }
      await navigator.clipboard.writeText(result.url);
      toast.success(`Invite link copied for ${clientName || 'this client'}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || 'Unable to copy invite link');
    } finally {
      setCopyingLinkForId('');
    }
  };

  const handleSendActivationEmail = async (clientId, clientName) => {
    if (!clientId) return;
    setSendingActivationEmail(true);
    try {
      await sendClientActivationEmail(clientId);
      toast.success(`Invite email sent to ${clientName || 'this client'}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || 'Unable to send invite email');
    } finally {
      setSendingActivationEmail(false);
    }
  };

  const handleActivateClient = async (clientId) => {
    if (!clientId) return;
    setActivatingClientId(clientId);
    setError('');
    setSuccess('');
    try {
      const result = await activateClient(clientId);
      const updatedClient = result.client;
      setSuccess(result.message || 'Account activated successfully');
      // Immediately update the client in the list with server-returned data
      if (updatedClient) {
        setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, ...updatedClient } : c)));
        // Also update editing if this client is being edited
        if (editing?.id === clientId) {
          setEditing((prev) => ({ ...prev, ...updatedClient }));
        }
      }
    } catch (err) {
      setError(err.message || 'Unable to activate account');
    } finally {
      setActivatingClientId('');
    }
  };

  const handleCompleteOnboarding = async (clientId) => {
    if (!clientId) return;
    setCompletingOnboardingId(clientId);
    setError('');
    setSuccess('');
    try {
      const result = await completeClientOnboarding(clientId);
      setSuccess('Onboarding marked as complete');
      if (result.client) {
        setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, ...result.client } : c)));
        if (editing?.id === clientId) setEditing((prev) => ({ ...prev, ...result.client }));
      }
    } catch (err) {
      setError(err.message || 'Unable to complete onboarding');
    } finally {
      setCompletingOnboardingId('');
    }
  };

  // Deactivate client (revert to pending activation)
  const handleDeactivateClick = (client) => {
    setDeactivateConfirm({ open: true, client });
  };

  const handleDeactivateConfirm = async () => {
    const { client } = deactivateConfirm;
    if (!client?.id) return;
    setDeactivateConfirm({ open: false, client: null });
    setDeactivatingClientId(client.id);
    setError('');
    setSuccess('');
    try {
      const result = await deactivateClient(client.id);
      const updatedClient = result.client;
      setSuccess(result.message || 'Account reverted to pending activation');
      // Immediately update the client in the list with server-returned data
      if (updatedClient) {
        setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, ...updatedClient } : c)));
        // Also update editing if this client is being edited
        if (editing?.id === client.id) {
          setEditing((prev) => ({ ...prev, ...updatedClient }));
        }
      }
    } catch (err) {
      setError(err.message || 'Unable to deactivate account');
    } finally {
      setDeactivatingClientId('');
    }
  };

  // Client Group management
  const handleToggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Callback from ClientGroupsManager when a group is created, updated, or deleted
  const handleGroupsChange = (savedGroup, action) => {
    if (action === 'created') {
      setClientGroups((prev) => [...prev, savedGroup]);
      setExpandedGroups((prev) => ({ ...prev, [savedGroup.id]: true }));
    } else if (action === 'updated') {
      setClientGroups((prev) => prev.map((g) => (g.id === savedGroup.id ? savedGroup : g)));
      // Also update any clients that belong to this group
      setClients((prev) =>
        prev.map((c) =>
          c.client_group_id === savedGroup.id
            ? { ...c, client_group_name: savedGroup.name, client_group_color: savedGroup.color, client_group_icon: savedGroup.icon, client_group_icon_url: savedGroup.icon_url }
            : c
        )
      );
    } else if (action === 'deleted') {
      setClientGroups((prev) => prev.filter((g) => g.id !== savedGroup.id));
      // Update any clients that were in this group
      setClients((prev) =>
        prev.map((c) =>
          c.client_group_id === savedGroup.id ? { ...c, client_group_id: null, client_group_name: null, client_group_color: null } : c
        )
      );
    }
  };

  // Callback from ClientGroupsManager when a new group is created for bulk assignment
  const handleBulkGroupComplete = async (savedGroup, clientIds) => {
    try {
      await Promise.all(
        clientIds.map((clientId) => updateClient(clientId, { client_group_id: savedGroup.id }))
      );
      // Update local state
      setClients((prev) =>
        prev.map((c) =>
          clientIds.includes(c.id)
            ? { ...c, client_group_id: savedGroup.id, client_group_name: savedGroup.name, client_group_color: savedGroup.color, client_group_icon: savedGroup.icon, client_group_icon_url: savedGroup.icon_url }
            : c
        )
      );
      toast.success(`Group created and ${clientIds.length} client(s) moved`);
      setSelectedClientIds([]);
    } catch {
      toast.error('Group created but failed to move some clients');
    }
    setBulkGroupClientIds(null);
  };

  // Drag and drop handlers for moving clients between groups
  const handleDragStart = (e, client) => {
    setDraggedClient(client);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', client.id);
  };

  const handleDragEnd = () => {
    setDraggedClient(null);
    setDragOverGroup(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (groupId) => {
    setDragOverGroup(groupId);
  };

  const handleDragLeave = (e, groupId) => {
    // Only clear if we're actually leaving the group area
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (dragOverGroup === groupId) setDragOverGroup(null);
    }
  };

  const handleDrop = async (e, targetGroupId) => {
    e.preventDefault();
    if (!draggedClient) return;

    const newGroupId = targetGroupId === '__ungrouped__' ? null : targetGroupId;
    const group = newGroupId ? clientGroups.find((g) => g.id === newGroupId) : null;

    // Skip if dropping into same group
    if (draggedClient.client_group_id === newGroupId) {
      setDraggedClient(null);
      setDragOverGroup(null);
      return;
    }

    try {
      await updateClient(draggedClient.id, { client_group_id: newGroupId });
      // Immediately update local state
      setClients((prev) =>
        prev.map((c) =>
          c.id === draggedClient.id
            ? {
                ...c,
                client_group_id: newGroupId,
                client_group_name: group?.name || null,
                client_group_color: group?.color || null,
                client_group_icon: group?.icon || null,
                client_group_icon_url: group?.icon_url || null
              }
            : c
        )
      );
      toast.success(newGroupId ? `Moved to ${group?.name}` : 'Removed from group');
    } catch {
      toast.error('Failed to move client');
    } finally {
      setDraggedClient(null);
      setDragOverGroup(null);
    }
  };

  // Simplified staff edit view (for admin/team users)
  const renderStaffEditContent = () => {
    const canEditRole = canEditUserRole(editing?.role, editing?.id);

    return (
      <Stack spacing={3} sx={{ mt: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="First Name"
            value={editing?.first_name || ''}
            onChange={handleEditChange('first_name')}
            fullWidth
          />
          <TextField
            label="Last Name"
            value={editing?.last_name || ''}
            onChange={handleEditChange('last_name')}
            fullWidth
          />
        </Stack>
        <TextField
          label="Email"
          value={editing?.email || ''}
          disabled
          fullWidth
          helperText="Email cannot be changed from this drawer."
        />
        <TextField
          label="Role"
          select
          value={editing?.role || 'team'}
          onChange={handleEditChange('role')}
          disabled={!canEditRole}
          fullWidth
          helperText={
            !canEditRole
              ? 'You cannot change this user’s role.'
              : 'Select the user’s permission level.'
          }
        >
          {/* Show current role even if not in the assignable list (e.g. superadmin, client, editor) */}
          {!editableRoles.includes(editing?.role) && (
            <MenuItem value={editing?.role} disabled>
              {(editing?.role || 'Unknown').charAt(0).toUpperCase() + (editing?.role || '').slice(1)}
            </MenuItem>
          )}
          {editableRoles.map((role) => (
            <MenuItem key={role} value={role}>
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </MenuItem>
          ))}
        </TextField>
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2">
            <strong>Role Permissions:</strong>
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            • <strong>Admin:</strong> Can manage clients, view all data, impersonate clients
          </Typography>
          <Typography variant="body2">
            • <strong>Team:</strong> Can view assigned tasks and limited client data
          </Typography>
        </Alert>
      </Stack>
    );
  };

  const renderDetailsTab = () => (
    <Stack spacing={3} sx={{ mt: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1">Business Overview</Typography>
          <Typography variant="caption" color="text.secondary">
            Core client information and ownership for this account.
          </Typography>
        </Box>
        <TextField
          label="Owner Name"
          value={editing.display_name || ''}
          onChange={handleEditChange('display_name')}
          helperText="The account owner's full name (e.g. Dr. Nathan Smith). Used in greetings, notifications, and the client list."
        />
        <TextField
          label="Informal Business Name"
          value={editing.client_identifier_value || ''}
          onChange={handleEditChange('client_identifier_value')}
          helperText="A short alias for this account, shown in the client list."
        />
        {editing?.role === 'client' && (
          <SelectField
            label="Timezone"
            value={editing.timezone || DEFAULT_TIMEZONE}
            onChange={handleEditChange('timezone')}
            options={TIMEZONE_OPTIONS}
            helperText="The business's local timezone. Used for the call-volume heat map and other time-of-day analytics."
          />
        )}
        <Autocomplete
          options={internalUsers}
          getOptionLabel={(option) =>
            option?.display_name || clientLabel(option) || ''
          }
          value={internalUsers.find((u) => String(u.id) === String(editing.account_manager_user_id)) || null}
          onChange={(_e, val) => setEditing((prev) => ({ ...prev, account_manager_user_id: val?.id || null }))}
          renderInput={(params) => <TextField {...params} label="Account Manager" placeholder="Select a person" />}
          loading={loadingInternalUsers}
          isOptionEqualToValue={(option, value) => String(option?.id) === String(value?.id)}
        />
        {editing?.role === 'client' && (
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <TextField
              label="Client Group"
              value={editing.client_group_id || ''}
              onChange={(e) => setEditing((prev) => ({ ...prev, client_group_id: e.target.value || null }))}
              select
              fullWidth
              InputLabelProps={{ shrink: true }}
              SelectProps={{
                displayEmpty: true,
                renderValue: (selected) => {
                  if (!selected) return 'No group';
                  const group = clientGroups.find((g) => g.id === selected);
                  return group?.name || 'Unknown group';
                }
              }}
            >
              <MenuItem value="">
                <em>No group</em>
              </MenuItem>
              {clientGroups.map((g) => {
                const GroupIcon = g.icon ? getGroupIcon(g.icon) : null;
                return (
                  <MenuItem key={g.id} value={g.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {g.icon_url ? (
                        <Box component="img" src={g.icon_url} alt="" sx={{ width: 16, height: 16, borderRadius: 0.5, objectFit: 'cover', flexShrink: 0 }} />
                      ) : GroupIcon ? (
                        <GroupIcon fontSize="small" sx={{ color: g.color || 'action.active', fontSize: 16 }} />
                      ) : g.color ? (
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: g.color, flexShrink: 0 }} />
                      ) : (
                        <FolderIcon fontSize="small" sx={{ color: 'action.disabled', fontSize: 16 }} />
                      )}
                      <span>{g.name}</span>
                    </Stack>
                  </MenuItem>
                );
              })}
            </TextField>
            <Tooltip title="Manage Groups">
              <IconButton size="small" onClick={() => setGroupDialogOpen(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      <Divider />

      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1">Client Type & Services</Typography>
          <Typography variant="caption" color="text.secondary">
            Sets service presets here and provides the default tracking mode for the Tracking tab.
          </Typography>
        </Box>
        <Grid
          container
          spacing={2}
          sx={{
            width: '100%',
            '& > .MuiGrid-item': { pl: 0, pr: 0 }
          }}
        >
          <Grid item xs={12} md={6}>
            <TextField
              label="Client Type"
              value={editing.client_type || ''}
              onChange={handleClientTypeSelect}
              select
              fullWidth
              InputLabelProps={{ shrink: true }}
              SelectProps={{
                displayEmpty: true,
                renderValue: (selected) => {
                  if (!selected) return 'Not set';
                  return CLIENT_TYPE_PRESETS.find((type) => type.value === selected)?.label || selected;
                }
              }}
            >
              <MenuItem value="">
                <em>Not set</em>
              </MenuItem>
              {CLIENT_TYPE_PRESETS.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Client Subtype"
              value={editing.client_subtype || ''}
              onChange={handleClientSubtypeSelect}
              select
              fullWidth
              disabled={!subtypeOptions.length}
              InputLabelProps={{ shrink: true }}
              SelectProps={{
                displayEmpty: true,
                renderValue: (selected) => {
                  if (!selected) {
                    return subtypeOptions.length ? 'Not set' : 'No presets yet';
                  }
                  return subtypeOptions.find((sub) => sub.value === selected)?.label || selected;
                }
              }}
            >
              <MenuItem value="">
                <em>{subtypeOptions.length ? 'Not set' : 'No presets yet'}</em>
              </MenuItem>
              {subtypeOptions.map((sub) => (
                <MenuItem key={sub.value} value={sub.value}>
                  {sub.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>
        {clientServicesLoading && <LinearProgress />}
        {isAdmin && editing.client_type && (
          <TextField
            label="AI Prompt"
            value={editing.ai_prompt || ''}
            onChange={handleEditChange('ai_prompt')}
            multiline
            minRows={4}
            helperText="Prompt used for CTM lead classification"
          />
        )}
        <FormControlLabel
          control={
            <Switch
              checked={editing.auto_star_enabled || false}
              onChange={(e) => setEditing((prev) => ({ ...prev, auto_star_enabled: e.target.checked }))}
            />
          }
          label="Auto-Star Leads"
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1, mb: 1 }}>
          When enabled, AI will automatically assign star ratings based on classification (never 4 or 5 stars).
          <br />
          1★ = Spam | 2★ = Not a fit | 3★ = Solid lead | 0★ = Voicemail/Unanswered/Neutral | 5★ = Manual only (booked appointment)
        </Typography>
      </Stack>

      <Divider />

      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1">Connected Accounts</Typography>
          <Typography variant="caption" color="text.secondary">
            These saved selections feed the Tracking tab automatically. Advanced event defaults now live in Tracking.
          </Typography>
        </Box>
        <ConnectedAccountsSection editing={editing} setEditing={setEditing} onError={reportError} />
      </Stack>

      {editing?.role === 'client' && (
        <>
          <Divider />

          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1">Internal Task Board</Typography>
              <Typography variant="caption" color="text.secondary">
                Internal workspace settings for Anchor operations.
              </Typography>
            </Box>
            <TextField
              label="Package"
              value={editing.client_package || ''}
              onChange={handleEditChange('client_package')}
              select
              fullWidth
              InputLabelProps={{ shrink: true }}
              SelectProps={{
                displayEmpty: true,
                renderValue: (selected) => {
                  if (!selected) return 'Not set';
                  return selected;
                }
              }}
            >
              <MenuItem value="">
                <em>Not set</em>
              </MenuItem>
              {CLIENT_PACKAGE_OPTIONS.map((pkg) => (
                <MenuItem key={pkg} value={pkg}>
                  {pkg}
                </MenuItem>
              ))}
            </TextField>
            <Autocomplete
              options={taskWorkspaces}
              getOptionLabel={(option) => option?.name || ''}
              value={taskWorkspaces.find((w) => String(w.id) === String(editing.task_workspace_id)) || null}
              onChange={(_e, val) => setEditing((prev) => ({ ...prev, task_workspace_id: val?.id || '' }))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Task Workspace"
                  placeholder="Select a workspace"
                  required
                  error={!editing.task_workspace_id && editing.client_identifier_value}
                  helperText={
                    !editing.task_workspace_id && editing.client_identifier_value ? 'Workspace is required when Client Identifier is set' : ''
                  }
                />
              )}
              loading={taskWorkspacesLoading}
            />
            <TextField
              label="Board Prefix"
              value={editing.board_prefix || ''}
              onChange={handleEditChange('board_prefix')}
              helperText="Prepended to every item created on this client board (ex: ACME - Fix homepage)."
            />
            {editing.task_board_id && (
              <Alert severity="success" sx={{ borderRadius: 1 }}>
                Task board is provisioned for this client.
              </Alert>
            )}
          </Stack>
        </>
      )}
    </Stack>
  );


  const saveBrand = async ({ silent = false } = {}) => {
    if (!editing || !brandData) return;
    setSavingBrand(true);
    setError('');
    if (!silent) setSuccess('');
    try {
      const res = await client.put(`/hub/brand/admin/${editing.id}`, brandData);
      setBrandData(res.data?.brand || brandData);
      if (!silent) setSuccess('Brand saved');
      return true;
    } catch (err) {
      reportError(err, 'Unable to save brand');
      return false;
    } finally {
      setSavingBrand(false);
    }
  };

  if (initializing) return null;
  if (!canAccessHub) return <Navigate to="/" replace />;

  return (
    <MainCard title="Client Hub">
      <Stack spacing={3}>
        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        {/* Top-level Hub Navigation */}
        <Tabs value={hubSection} onChange={(e, v) => setHubSection(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab icon={<PeopleOutlineIcon />} iconPosition="start" label="Users & Clients" />
          <Tab icon={<MailOutlineIcon />} iconPosition="start" label="Email Logs" />
          <Tab icon={<SchoolOutlinedIcon />} iconPosition="start" label="Tutorials" />
          <Tab icon={<ShareOutlinedIcon />} iconPosition="start" label="Social" />
        </Tabs>

        {/* Users & Clients Section */}
        {hubSection === 0 && (
          <>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
              <Box sx={{ flex: 1, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Typography variant="h5" sx={{ mb: 2 }}>
                  Add User
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={2}>
                    <SelectField label="Role" value={newClient.role} onChange={(e) => setNewClient((p) => ({ ...p, role: e.target.value, isExisting: false }))}>
                      {newRolesOptions.map((r) => (
                        <MenuItem key={r} value={r}>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </MenuItem>
                      ))}
                    </SelectField>
                  </Grid>
                  {newClient.role === 'client' ? (
                    <>
                      <Grid item xs={12} md={2}>
                        <SelectField label="Client Type" value={newClient.isExisting ? 'existing' : 'new'} onChange={(e) => setNewClient((p) => ({ ...p, isExisting: e.target.value === 'existing' }))}>
                          <MenuItem value="new">New Client</MenuItem>
                          <MenuItem value="existing">Existing Client</MenuItem>
                        </SelectField>
                      </Grid>
                      {newClient.isExisting && (
                        <Grid item xs={12} md={3}>
                          <FormControl fullWidth>
                            <InputLabel htmlFor="new-owner-name">Owner Name</InputLabel>
                            <OutlinedInput
                              id="new-owner-name"
                              value={newClient.name}
                              onChange={(e) => setNewClient((p) => ({ ...p, name: e.target.value }))}
                              label="Owner Name"
                            />
                          </FormControl>
                        </Grid>
                      )}
                      <Grid item xs={12} md={newClient.isExisting ? 3 : 6}>
                        <FormControl fullWidth>
                          <InputLabel htmlFor="new-business-name">Business Informal Name</InputLabel>
                          <OutlinedInput
                            id="new-business-name"
                            value={newClient.businessName}
                            onChange={(e) => setNewClient((p) => ({ ...p, businessName: e.target.value }))}
                            label="Business Informal Name"
                          />
                        </FormControl>
                      </Grid>
                      {newClient.isExisting && (
                        <Grid item xs={12} md={3}>
                          <FormControl fullWidth>
                            <InputLabel htmlFor="new-client-email">Owner Email</InputLabel>
                            <OutlinedInput
                              id="new-client-email"
                              value={newClient.email}
                              onChange={(e) => setNewClient((p) => ({ ...p, email: e.target.value }))}
                              label="Owner Email"
                              type="email"
                            />
                          </FormControl>
                        </Grid>
                      )}
                    </>
                  ) : (
                    <>
                      <Grid item xs={12} md={4}>
                        <FormControl fullWidth>
                          <InputLabel htmlFor="new-email">Email</InputLabel>
                          <OutlinedInput
                            id="new-email"
                            value={newClient.email}
                            onChange={(e) => setNewClient((p) => ({ ...p, email: e.target.value }))}
                            label="Email"
                            type="email"
                          />
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} md={4}>
                        <FormControl fullWidth>
                          <InputLabel htmlFor="new-name">Name</InputLabel>
                          <OutlinedInput
                            id="new-name"
                            value={newClient.name}
                            onChange={(e) => setNewClient((p) => ({ ...p, name: e.target.value }))}
                            label="Name"
                          />
                        </FormControl>
                      </Grid>
                    </>
                  )}
                  <Grid item xs={12} md={2} sx={{ display: 'flex', alignItems: 'center' }}>
                    <Button
                      variant="contained"
                      fullWidth
                      disableElevation
                      onClick={handleAddClient}
                      disabled={savingNew || (newClient.role === 'client' ? (!newClient.businessName || (newClient.isExisting && (!newClient.email || !newClient.name?.trim()))) : !newClient.email)}
                    >
                      {savingNew ? 'Saving…' : 'Save'}
                    </Button>
                  </Grid>
                </Grid>
              </Box>
            </Box>

            {isAdmin && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 2 }}>
                <Box sx={{ p: 2 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                    justifyContent="space-between"
                  >
                    <Typography variant="h5">Staff</Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {loading && <CircularProgress size={20} />}
                      <TextField
                        size="small"
                        placeholder="Search staff…"
                        value={adminsQuery}
                        onChange={(e) => setAdminsQuery(e.target.value)}
                      />
                    </Stack>
                  </Stack>
                </Box>
                <Divider />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Display Name</TableCell>
                        <TableCell>Email</TableCell>
                        <TableCell>Role</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredAdmins.map((c) => {
                        const canEdit = canEditUserRole(c.role, c.id);
                        return (
                          <TableRow key={c.id} hover>
                            <TableCell>{clientLabel(c)}</TableCell>
                            <TableCell>{c.email}</TableCell>
                            <TableCell sx={{ textTransform: 'capitalize' }}>{c.role || 'admin'}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                {canEdit ? (
                                  <Tooltip title="Edit">
                                    <IconButton size="small" onClick={() => startEdit(c)}>
                                      <EditIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : (
                                  <Tooltip title="Cannot edit users at or above your role level">
                                    <span>
                                      <IconButton size="small" disabled>
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                )}
                                {canEdit && isAdmin && (
                                  <Tooltip title="Delete">
                                    <span>
                                      <IconButton
                                        size="small"
                                        color="error"
                                        onClick={() => confirmDeleteClient(c.id)}
                                        disabled={deletingClientId === c.id}
                                      >
                                        {deletingClientId === c.id ? (
                                          <CircularProgress size={18} color="inherit" />
                                        ) : (
                                          <DeleteOutlineIcon fontSize="small" />
                                        )}
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                )}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!filteredAdmins.length && !loading && (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
                            No staff yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            <Box data-tutorial="admin-client-list" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ p: 2 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                  justifyContent="space-between"
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h5">Clients</Typography>
                    <Button size="small" variant="text" onClick={() => setGroupDialogOpen(true)}>
                      Manage Groups
                    </Button>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
                    {loading && <CircularProgress size={20} />}
                    <TextField
                      size="small"
                      placeholder="Search clients…"
                      value={clientsQuery}
                      onChange={(e) => setClientsQuery(e.target.value)}
                    />
                    {isAdmin && (
                      <>
                        <Select
                          size="small"
                          value={bulkAction}
                          onChange={(e) => setBulkAction(e.target.value)}
                          displayEmpty
                          renderValue={(v) => {
                            if (!v) return 'Bulk Actions';
                            if (v === 'delete') return 'Delete';
                            if (v.startsWith('group:')) {
                              const groupId = v.replace('group:', '');
                              if (groupId === '__new__') return 'Create new group...';
                              if (groupId === '__none__') return 'Remove from group';
                              const group = clientGroups.find((g) => g.id === groupId);
                              return `Move to: ${group?.name || 'Group'}`;
                            }
                            return v;
                          }}
                          sx={{ minWidth: 220 }}
                          disabled={!selectedClientIds.length}
                        >
                          <MenuItem value="">
                            <em>Bulk Actions</em>
                          </MenuItem>
                          <MenuItem value="delete">Delete</MenuItem>
                          <Divider />
                          <MenuItem disabled sx={{ opacity: 0.7, fontSize: '0.75rem' }}>
                            Move to Group
                          </MenuItem>
                          <MenuItem value="group:__new__">
                            <Stack direction="row" spacing={1} alignItems="center">
                              <AddIcon fontSize="small" />
                              <em>Create new group...</em>
                            </Stack>
                          </MenuItem>
                          <MenuItem value="group:__none__">
                            <em>Remove from group</em>
                          </MenuItem>
                          {clientGroups.map((g) => {
                            const GroupIcon = g.icon ? getGroupIcon(g.icon) : null;
                            return (
                              <MenuItem key={g.id} value={`group:${g.id}`}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                  {g.icon_url ? (
                                    <Box component="img" src={g.icon_url} alt="" sx={{ width: 14, height: 14, borderRadius: 0.5, objectFit: 'cover', flexShrink: 0 }} />
                                  ) : GroupIcon ? (
                                    <GroupIcon fontSize="small" sx={{ color: g.color || 'action.active', fontSize: 16 }} />
                                  ) : g.color ? (
                                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: g.color }} />
                                  ) : (
                                    <FolderIcon fontSize="small" sx={{ color: 'action.disabled', fontSize: 16 }} />
                                  )}
                                  <span>{g.name}</span>
                                </Stack>
                              </MenuItem>
                            );
                          })}
                        </Select>
                        <Button
                          size="small"
                          variant="contained"
                          disableElevation
                          onClick={handleApplyBulkAction}
                          disabled={!selectedClientIds.length || !bulkAction || bulkDeleting}
                        >
                          Apply
                        </Button>
                      </>
                    )}
                  </Stack>
                </Stack>
                {selectedClientIds.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Selected: {selectedClientIds.length}
                  </Typography>
                )}
              </Box>
              <Divider />

              {/* Client Groups - Each group is a separate visual section */}
              <Stack spacing={1.5} sx={{ p: 1.5 }}>
                {/* All Groups (including empty) */}
                {clientGroups.map((group) => {
                    const isExpanded = expandedGroups[group.id];
                    const clients = groupedClients[group.id] || [];
                    const isDragOver = dragOverGroup === group.id;
                    return (
                      <Box
                        key={group.id}
                        onDragOver={handleDragOver}
                        onDragEnter={() => handleDragEnter(group.id)}
                        onDragLeave={(e) => handleDragLeave(e, group.id)}
                        onDrop={(e) => handleDrop(e, group.id)}
                        sx={{
                          border: '2px solid',
                          borderColor: isDragOver ? 'primary.main' : 'divider',
                          borderRadius: 2,
                          overflow: 'hidden',
                          bgcolor: isDragOver ? 'primary.50' : 'transparent',
                          transition: 'border-color 0.2s, background-color 0.2s'
                        }}
                      >
                        {/* Group Header */}
                        <Box
                          onClick={() => handleToggleGroup(group.id)}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            px: 1.5,
                            py: 1,
                            bgcolor: isDragOver ? 'primary.100' : 'grey.100',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: isDragOver ? 'primary.100' : 'grey.200' }
                          }}
                        >
                          <IconButton size="small" sx={{ p: 0.25 }}>
                            <ExpandMoreIcon
                              fontSize="small"
                              sx={{
                                transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                                transition: 'transform 0.2s'
                              }}
                            />
                          </IconButton>
                          {(() => {
                            if (group.icon_url) {
                              return <Box component="img" src={group.icon_url} alt="" sx={{ width: 18, height: 18, borderRadius: 0.5, objectFit: 'cover', flexShrink: 0 }} />;
                            }
                            const GroupIcon = group.icon ? getGroupIcon(group.icon) : null;
                            if (GroupIcon) {
                              return <GroupIcon fontSize="small" sx={{ color: group.color || 'action.active' }} />;
                            }
                            if (group.color) {
                              return <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: group.color, flexShrink: 0 }} />;
                            }
                            return <FolderIcon fontSize="small" sx={{ color: 'action.disabled' }} />;
                          })()}
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
                            {group.name}
                          </Typography>
                          <Chip label={clients.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                        </Box>

                        {/* Group Clients Table (shown when expanded) */}
                        {/* custom table — DataTable cannot express drag-and-drop client grouping with collapsible group rows */}
                        {isExpanded && (
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell padding="checkbox">
                                    <Checkbox
                                      size="small"
                                      checked={clients.length > 0 && clients.every((c) => selectedClientIds.includes(c.id))}
                                      indeterminate={
                                        clients.some((c) => selectedClientIds.includes(c.id)) &&
                                        !clients.every((c) => selectedClientIds.includes(c.id))
                                      }
                                      onChange={() => {
                                        const allSelected = clients.every((c) => selectedClientIds.includes(c.id));
                                        if (allSelected) {
                                          setSelectedClientIds((prev) => prev.filter((id) => !clients.some((c) => c.id === id)));
                                        } else {
                                          setSelectedClientIds((prev) => [...new Set([...prev, ...clients.map((c) => c.id)])]);
                                        }
                                      }}
                                      disabled={!isAdmin}
                                    />
                                  </TableCell>
                                  <TableCell>Business Name</TableCell>
                                  <TableCell>Email</TableCell>
                                  <TableCell>Role</TableCell>
                                  <TableCell>Onboarding</TableCell>
                                  <TableCell align="right">Action</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {clients.map(renderClientRow)}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </Box>
                    );
                  })}

                {/* Ungrouped Clients Section */}
                {(ungroupedClients.length > 0 || draggedClient) && (
                  <Box
                    onDragOver={handleDragOver}
                    onDragEnter={() => handleDragEnter('__ungrouped__')}
                    onDragLeave={(e) => handleDragLeave(e, '__ungrouped__')}
                    onDrop={(e) => handleDrop(e, '__ungrouped__')}
                    sx={{
                      border: '2px solid',
                      borderColor: dragOverGroup === '__ungrouped__' ? 'primary.main' : 'divider',
                      borderRadius: 2,
                      overflow: 'hidden',
                      bgcolor: dragOverGroup === '__ungrouped__' ? 'primary.50' : 'transparent',
                      transition: 'border-color 0.2s, background-color 0.2s'
                    }}
                  >
                    {/* Section Header */}
                    <Box
                      onClick={() => handleToggleGroup('__ungrouped__')}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        px: 1.5,
                        py: 1,
                        bgcolor: dragOverGroup === '__ungrouped__' ? 'primary.100' : 'grey.50',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: dragOverGroup === '__ungrouped__' ? 'primary.100' : 'grey.100' }
                      }}
                    >
                      <IconButton size="small" sx={{ p: 0.25 }}>
                        <ExpandMoreIcon
                          fontSize="small"
                          sx={{
                            transform: expandedGroups['__ungrouped__'] !== false ? 'rotate(0deg)' : 'rotate(-90deg)',
                            transition: 'transform 0.2s'
                          }}
                        />
                      </IconButton>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1, color: 'text.secondary' }}>
                        Ungrouped
                      </Typography>
                      <Chip label={ungroupedClients.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} variant="outlined" />
                    </Box>

                    {/* Ungrouped Clients Table */}
                    {expandedGroups['__ungrouped__'] !== false && (
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  size="small"
                                  checked={ungroupedClients.length > 0 && ungroupedClients.every((c) => selectedClientIds.includes(c.id))}
                                  indeterminate={
                                    ungroupedClients.some((c) => selectedClientIds.includes(c.id)) &&
                                    !ungroupedClients.every((c) => selectedClientIds.includes(c.id))
                                  }
                                  onChange={() => {
                                    const allSelected = ungroupedClients.every((c) => selectedClientIds.includes(c.id));
                                    if (allSelected) {
                                      setSelectedClientIds((prev) => prev.filter((id) => !ungroupedClients.some((c) => c.id === id)));
                                    } else {
                                      setSelectedClientIds((prev) => [...new Set([...prev, ...ungroupedClients.map((c) => c.id)])]);
                                    }
                                  }}
                                  disabled={!isAdmin}
                                />
                              </TableCell>
                              <TableCell>Business Name</TableCell>
                              <TableCell>Email</TableCell>
                              <TableCell>Role</TableCell>
                              <TableCell>Onboarding</TableCell>
                              <TableCell align="right">Action</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {ungroupedClients.map(renderClientRow)}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Box>
                )}

                {/* No clients message */}
                {!filteredClients.length && !loading && (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">No clients yet.</Typography>
                  </Box>
                )}
              </Stack>
            </Box>
          </>
        )}

        {/* Email Logs Section */}
        <EmailLogsSection active={hubSection === 1} canAccessHub={canAccessHub} />
        <SocialSection active={hubSection === 3} canAccessHub={canAccessHub} clients={sortedClientOnly} />

        {/* Tutorials Section */}
        {hubSection === 2 && (
          <Stack spacing={3}>
            <Stack spacing={0.5}>
              <Typography variant="h5">Admin Guides</Typography>
              <Typography variant="body2" color="text.secondary">
                Step through each tutorial at your own pace. Spotlight guides will walk you through key features of the Client Hub.
              </Typography>
            </Stack>
            <Grid container spacing={2}>
              {tutorials.map((tutorial) => {
                const isCompleted = completedIds.has(tutorial.id);
                return (
                  <Grid item xs={12} sm={6} md={4} key={tutorial.id}>
                    <Card
                      variant="outlined"
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        borderColor: isCompleted ? 'success.light' : 'divider',
                        transition: 'box-shadow 0.2s',
                        '&:hover': { boxShadow: 3 }
                      }}
                    >
                      <CardContent sx={{ flex: 1 }}>
                        <Stack spacing={1.5}>
                          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                            <SchoolOutlinedIcon sx={{ color: isCompleted ? 'success.main' : 'primary.main', mt: 0.25 }} />
                            {isCompleted ? (
                              <Chip
                                icon={<CheckCircleOutlineIcon />}
                                label="Completed"
                                size="small"
                                color="success"
                                variant="outlined"
                              />
                            ) : (
                              <Chip label="Not started" size="small" variant="outlined" sx={{ color: 'text.secondary', borderColor: 'divider' }} />
                            )}
                          </Stack>
                          <Stack spacing={0.5}>
                            <Typography variant="h6" sx={{ lineHeight: 1.3 }}>{tutorial.label}</Typography>
                            <Typography variant="body2" color="text.secondary">{tutorial.description}</Typography>
                          </Stack>
                          <Stack direction="row" alignItems="center" spacing={0.5}>
                            <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            <Typography variant="caption" color="text.secondary">~{tutorial.estimatedMinutes} min</Typography>
                          </Stack>
                        </Stack>
                      </CardContent>
                      <CardActions sx={{ px: 2, pb: 2 }}>
                        <Button
                          variant={isCompleted ? 'outlined' : 'contained'}
                          size="small"
                          startIcon={isCompleted ? <ReplayIcon /> : <PlayArrowIcon />}
                          onClick={() => startTutorial(tutorial.id)}
                          fullWidth
                        >
                          {isCompleted ? 'Replay' : 'Start Tutorial'}
                        </Button>
                      </CardActions>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>

            <Stack spacing={0.5}>
              <Typography variant="h5">Video Walkthroughs</Typography>
              <Typography variant="body2" color="text.secondary">
                Recorded walkthroughs for parts of the Client Hub that are better shown than spotlighted.
              </Typography>
            </Stack>
            <Grid container spacing={2}>
              {ADMIN_VIDEO_TUTORIALS.map((tutorial) => (
                <Grid item xs={12} md={6} key={tutorial.id}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'box-shadow 0.2s',
                      '&:hover': { boxShadow: 3 }
                    }}
                  >
                    <Box sx={{ position: 'relative', width: '100%', pt: '56.25%', borderBottom: 1, borderColor: 'divider' }}>
                      <Box
                        component="iframe"
                        src={tutorial.videoSrc}
                        title={tutorial.label}
                        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                      />
                    </Box>
                    <CardContent sx={{ flex: 1 }}>
                      <Stack spacing={1.5}>
                        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                          <OndemandVideoOutlinedIcon sx={{ color: 'primary.main', mt: 0.25 }} />
                          <Chip label="Video" size="small" variant="outlined" />
                        </Stack>
                        <Stack spacing={0.5}>
                          <Typography variant="h6" sx={{ lineHeight: 1.3 }}>{tutorial.label}</Typography>
                          <Typography variant="body2" color="text.secondary">{tutorial.description}</Typography>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Stack>
        )}
      </Stack>

      <Drawer
        anchor="right"
        open={Boolean(editing) && !onboardingWizardOpen}
        onClose={() => setEditing(null)}
        sx={{ '& .MuiDrawer-paper': { width: { xs: '90vw', sm: '40vw' }, minWidth: { xs: 0, sm: 800 }, p: 2 } }}
      >
        {editing && (
          <Stack spacing={2} sx={{ height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                {!isStaffRole(editing.role) && editingDisplayLogo?.url && (
                  <Box
                    component="img"
                    src={editingDisplayLogo.url}
                    alt="Client logo"
                    sx={{
                      width: 40,
                      height: 40,
                      objectFit: 'contain',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                      p: 0.5,
                      flexShrink: 0
                    }}
                  />
                )}
                <Typography variant="h5" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isStaffRole(editing.role) ? 'Edit Staff Member' : 'Editing'}:{' '}
                  {isStaffRole(editing.role)
                    ? (editing.first_name || editing.email)
                    : (editing.client_identifier_value || editing.business_name || editing.first_name || editing.email)}
                </Typography>
              </Box>
              <IconButton onClick={() => setEditing(null)} aria-label="close">
                ×
              </IconButton>
            </Box>
            <Button variant="text" onClick={() => setEditing(null)} sx={{ alignSelf: 'flex-start' }}>
              {isStaffRole(editing.role) ? 'Back to Staff List' : 'Back to All Clients'}
            </Button>
            {isStaffRole(editing.role) ? (
              // Simplified staff editing view
              <Box sx={{ flex: 1, overflowY: 'auto' }}>{renderStaffEditContent()}</Box>
            ) : (
              // Full client editing view with tabs
              <>
                <Tabs data-tutorial="admin-drawer-tabs" value={activeTab} onChange={(_e, v) => setActiveTab(v)} variant="scrollable" allowScrollButtonsMobile>
                  <Tab label="Client Details" />
                  <Tab label="Client Assets" />
                  <Tab label="Client Documents" />
                  <Tab label="Forms" />
                  <Tab label="Team" />
                  <Tab label="Notifications" />
                  <Tab label="Activity Log" icon={<HistoryIcon />} iconPosition="start" />
                  <Tab label="AI Review" icon={<PsychologyIcon />} iconPosition="start" />
                  <Tab label="Tracking" />
                  <Tab label="Sites" icon={<LanguageIcon />} iconPosition="start" />
                </Tabs>
                <Box sx={{ flex: 1, overflowY: 'auto' }}>
                  {activeTab === 0 && renderDetailsTab()}
                  {activeTab === 1 && (
                    <BrandAssetsTab
                      clientId={editing.id}
                      brandData={brandData}
                      setBrandData={setBrandData}
                      editing={editing}
                      onEditChange={handleEditChange}
                    />
                  )}
                  {activeTab === 2 && <DocumentsTab clientId={editing.id} />}
                  {activeTab === 3 && <Box data-tutorial="admin-forms-tab"><FormsTab clientId={editing.id} /></Box>}
                  {activeTab === 4 && <Box data-tutorial="admin-team-tab"><TeamTab clientId={editing.id} /></Box>}
                  {activeTab === 5 && <Box data-tutorial="admin-notifications-tab"><NotificationsTab clientId={editing.id} /></Box>}
                  {activeTab === 6 && <ActivityLogsTab clientId={editing.id} active />}
                  {activeTab === 7 && <AiClassificationLogsTab clientId={editing.id} active />}
                  {activeTab === 8 && <Box data-tutorial="admin-tracking-tab"><TrackingTab clientId={editing.id} editing={editing} onAnalyticsChange={handleAnalyticsChange} /></Box>}
                  {activeTab === 9 && <ClientSitesTab clientId={editing.id} />}
                </Box>
              </>
            )}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              {isStaffRole(editing?.role) ? (
                // Staff editing buttons
                <>
                  <Button onClick={() => setEditing(null)} color="secondary">
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    disableElevation
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                  >
                    {savingEdit ? 'Saving…' : 'Save Changes'}
                  </Button>
                </>
              ) : (
                // Client editing buttons
                <>
                  {editing?.role === 'client' && !editing?.onboarding_completed_at && (
                    <>
                      <Tooltip title="Copy onboarding link to clipboard">
                        <Button
                          variant="text"
                          onClick={() => handleCopyOnboardingLink(editing.id)}
                          disabled={copyingLinkForId === editing.id}
                          startIcon={copyingLinkForId === editing.id ? <CircularProgress size={16} /> : <ContentCopyIcon />}
                        >
                          {copyingLinkForId === editing.id ? 'Copying…' : 'Copy Link'}
                        </Button>
                      </Tooltip>
                      <Tooltip title="Mark onboarding as complete and skip the wizard">
                        <Button
                          variant="outlined"
                          color="success"
                          onClick={() => handleCompleteOnboarding(editing.id)}
                          disabled={completingOnboardingId === editing.id}
                          startIcon={completingOnboardingId === editing.id ? <CircularProgress size={16} /> : null}
                        >
                          {completingOnboardingId === editing.id ? 'Completing…' : '✓ Complete Onboarding'}
                        </Button>
                      </Tooltip>
                    </>
                  )}
                  {editing?.role === 'client' && editing?.onboarding_completed_at && !editing?.activated_at && (
                    <>
                      <Tooltip title="Copy owner invite link to clipboard">
                        <Button
                          variant="text"
                          onClick={() => handleCopyActivationLink(editing.id, editing.first_name || editing.email)}
                          disabled={copyingLinkForId === editing.id}
                          startIcon={copyingLinkForId === editing.id ? <CircularProgress size={16} /> : <ContentCopyIcon />}
                        >
                          {copyingLinkForId === editing.id ? 'Copying…' : 'Copy Invite Link'}
                        </Button>
                      </Tooltip>
                      <Tooltip title="Email the owner invite link to the client">
                        <Button
                          variant="outlined"
                          onClick={() => setSendActivationConfirm({ open: true, clientId: editing.id, clientName: editing.first_name || editing.email })}
                          disabled={sendingActivationEmail}
                          startIcon={sendingActivationEmail ? <CircularProgress size={16} /> : <SendIcon />}
                        >
                          {sendingActivationEmail ? 'Sending…' : 'Send Invite Email'}
                        </Button>
                      </Tooltip>
                      <Button
                        variant="contained"
                        color="secondary"
                        onClick={() => handleActivateClient(editing.id)}
                        disabled={activatingClientId === editing.id}
                      >
                        {activatingClientId === editing.id ? 'Activating…' : 'Activate Account'}
                      </Button>
                    </>
                  )}
                  {editing?.role === 'client' && editing?.activated_at && editing?.has_pending_self_invite && (
                    <>
                      <Tooltip title="Copy owner invite link to clipboard">
                        <Button
                          variant="text"
                          onClick={() => handleCopyActivationLink(editing.id, editing.first_name || editing.email)}
                          disabled={copyingLinkForId === editing.id}
                          startIcon={copyingLinkForId === editing.id ? <CircularProgress size={16} /> : <ContentCopyIcon />}
                        >
                          {copyingLinkForId === editing.id ? 'Copying…' : 'Copy Invite Link'}
                        </Button>
                      </Tooltip>
                      <Tooltip title="Email the owner invite link to the client">
                        <Button
                          variant="outlined"
                          onClick={() => setSendActivationConfirm({ open: true, clientId: editing.id, clientName: editing.first_name || editing.email })}
                          disabled={sendingActivationEmail}
                          startIcon={sendingActivationEmail ? <CircularProgress size={16} /> : <SendIcon />}
                        >
                          {sendingActivationEmail ? 'Sending…' : 'Send Invite Email'}
                        </Button>
                      </Tooltip>
                    </>
                  )}
                  {editing?.role === 'client' && editing?.activated_at && (
                    <Button
                      variant="outlined"
                      color="warning"
                      onClick={() => handleDeactivateClick(editing)}
                      disabled={deactivatingClientId === editing.id}
                    >
                      {deactivatingClientId === editing.id ? 'Reverting…' : 'Revert to Pending'}
                    </Button>
                  )}
                  <Button onClick={() => setEditing(null)} color="secondary">
                    Cancel
                  </Button>
                  {activeTab === 1 && (
                    <Button
                      variant="contained"
                      disableElevation
                      onClick={async () => {
                        setError('');
                        setSuccess('');
                        const brandSaved = await saveBrand({ silent: true });
                        if (!brandSaved) return;
                        const detailsSaved = await handleSaveEdit({ exitAfterSave: false, silent: true });
                        if (detailsSaved) {
                          setSuccess('Brand and client details saved');
                        }
                      }}
                      disabled={!brandData || savingBrand || savingEdit}
                    >
                      {savingBrand || savingEdit ? 'Saving…' : 'Save Changes'}
                    </Button>
                  )}
                  {(activeTab === 0 || activeTab === 8) && (
                    <Button variant="contained" disableElevation onClick={handleSaveEdit} disabled={savingEdit}>
                      {savingEdit ? 'Saving…' : 'Save Changes'}
                    </Button>
                  )}
                </>
              )}
            </Stack>
          </Stack>
        )}
      </Drawer>

      <Dialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, clientId: null, label: '', hasBoard: false, deleteBoard: false })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Client</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This action cannot be undone.
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Are you sure you want to delete {deleteConfirm.label || 'this client'}?
          </Typography>
          {deleteConfirm.hasBoard && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={deleteConfirm.deleteBoard}
                  onChange={(e) => setDeleteConfirm((prev) => ({ ...prev, deleteBoard: e.target.checked }))}
                />
              }
              label="Also delete associated task board"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm({ open: false, clientId: null, label: '', hasBoard: false, deleteBoard: false })}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={handleDeleteClient} disabled={Boolean(deletingClientId)}>
            {deletingClientId ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        onConfirm={handleBulkDeleteClients}
        title="Delete Clients"
        message={`Are you sure you want to delete ${selectedClientIds.length} client(s)?`}
        confirmLabel="Delete"
        confirmColor="error"
        loading={bulkDeleting}
        loadingLabel="Deleting…"
        severity="warning"
        severityMessage="This action cannot be undone."
      />

      {/* Client Group Management Dialog */}
      <ClientGroupsManager
        open={groupDialogOpen}
        onClose={() => { setGroupDialogOpen(false); setBulkGroupClientIds(null); }}
        clientGroups={clientGroups}
        onGroupsChange={handleGroupsChange}
        bulkGroupClientIds={bulkGroupClientIds}
        onBulkGroupComplete={handleBulkGroupComplete}
      />

      <Dialog open={onboardingWizardOpen} onClose={handleWizardClose} fullWidth maxWidth="md">
        <DialogTitle sx={{ pb: 1 }}>
          <Stack spacing={0.5}>
            <Typography variant="h5">New Client Onboarding</Typography>
            <Typography variant="body2" color="text.secondary">
              Capture the core client details, then decide whether to trigger their onboarding email.
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3}>
            <Stepper
              activeStep={onboardingStep}
              alternativeLabel
              sx={{
                '& .MuiStepLabel-label.Mui-active': { fontWeight: 700, transform: 'scale(1.03)' },
                '& .MuiStepLabel-labelContainer': { transformOrigin: 'center' }
              }}
            >
              <Step>
                <StepLabel StepIconComponent={AnchorStepIcon}>Client Details</StepLabel>
              </Step>
              <Step>
                <StepLabel StepIconComponent={AnchorStepIcon}>Access Scope</StepLabel>
              </Step>
              <Step>
                <StepLabel StepIconComponent={AnchorStepIcon}>Onboarding Link</StepLabel>
              </Step>
            </Stepper>
            {onboardingStep === 0 && editing && (
              <Card variant="outlined" sx={{ boxShadow: 'none', borderRadius: 2 }}>
                <CardContent>
                  <Stack spacing={1.5} sx={{ mb: 2 }}>
                    <Typography variant="subtitle1">Client Details</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Confirm the account metadata and workflow settings before inviting the client.
                    </Typography>
                  </Stack>
                  <Box sx={{ maxHeight: { xs: '60vh', md: '55vh' }, overflowY: 'auto', pr: 1 }}>{renderDetailsTab()}</Box>
                </CardContent>
              </Card>
            )}
            {onboardingStep === 1 && editing && (
              <Card variant="outlined" sx={{ boxShadow: 'none', borderRadius: 2 }}>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="subtitle1">Access Steps</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Pick which access steps this client should see in their onboarding. Unchecked items won&apos;t appear in the
                      client-facing flow.
                    </Typography>
                    <Grid container spacing={1}>
                      {ACCESS_STEP_OPTIONS.map((option) => (
                        <Grid item xs={12} sm={6} key={option.key}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={editing?.[option.key] !== false}
                                onChange={toggleAccessRequirement(option.key)}
                                color="primary"
                              />
                            }
                            label={option.label}
                          />
                        </Grid>
                      ))}
                    </Grid>
                    <Alert severity="info" sx={{ borderRadius: 1 }}>
                      These settings only affect the client onboarding form. You can update them anytime.
                    </Alert>
                  </Stack>
                </CardContent>
              </Card>
            )}
            {onboardingStep === 2 && editing && (
              <Card variant="outlined" sx={{ boxShadow: 'none', borderRadius: 2 }}>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="subtitle1">Generate Onboarding Link?</Typography>
                    <Typography variant="body2" color="text.secondary">
                      A secure link will be generated and copied to your clipboard. Share it with the client so they can set up their
                      account, confirm services, and provide brand details.
                    </Typography>
                    <FormControlLabel
                      control={<Switch checked={sendOnboardingEmailFlag} onChange={(e) => setSendOnboardingEmailFlag(e.target.checked)} />}
                      label="Generate onboarding link immediately"
                    />
                    {!sendOnboardingEmailFlag && (
                      <Alert severity="info" sx={{ borderRadius: 1 }}>
                        You can generate an onboarding link later from the client hub if you need to finish configuration first.
                      </Alert>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          {onboardingStep === 0 ? (
            <>
              <Button onClick={handleWizardClose}>Cancel</Button>
              <Button variant="contained" onClick={handleWizardNext} disabled={savingEdit || onboardingLoading}>
                {savingEdit ? 'Saving…' : 'Continue'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleWizardBack} disabled={savingEdit || onboardingLoading || sendingOnboardingEmail}>
                Back
              </Button>
              <Button
                variant="contained"
                onClick={onboardingStep === ONBOARDING_WIZARD_LAST_STEP ? handleWizardFinish : handleWizardNext}
                disabled={sendingOnboardingEmail || onboardingLoading}
              >
                {onboardingStep === ONBOARDING_WIZARD_LAST_STEP
                  ? sendingOnboardingEmail
                    ? 'Sending…'
                    : 'Finish'
                  : savingEdit || onboardingLoading
                    ? 'Saving…'
                    : 'Continue'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>


      {/* Deactivate Client Confirmation */}
      <ConfirmDialog
        open={sendActivationConfirm.open}
        onClose={() => setSendActivationConfirm({ open: false, clientId: null, clientName: '' })}
        onConfirm={async () => {
          await handleSendActivationEmail(sendActivationConfirm.clientId, sendActivationConfirm.clientName);
          setSendActivationConfirm({ open: false, clientId: null, clientName: '' });
        }}
        title="Send owner invite"
        message={<Typography>Email the owner invite link to <strong>{sendActivationConfirm.clientName || 'this client'}</strong>?</Typography>}
        secondaryText="They'll be prompted to set a password and claim access to the account."
        confirmLabel="Send email"
        confirmColor="primary"
        loading={sendingActivationEmail}
        loadingLabel="Sending…"
      />

      <ConfirmDialog
        open={deactivateConfirm.open}
        onClose={() => setDeactivateConfirm({ open: false, client: null })}
        onConfirm={handleDeactivateConfirm}
        title="Revert to Pending Activation"
        message={<Typography>Revert <strong>{deactivateConfirm.client?.first_name || deactivateConfirm.client?.email || 'this client'}</strong> to pending activation status?</Typography>}
        secondaryText="They will no longer be able to access their dashboard until you activate their account again."
        confirmLabel="Revert to Pending"
        confirmColor="warning"
      />

      <Dialog
        open={inviteDialog.open}
        onClose={() => setInviteDialog({ open: false, clientId: null, clientName: '', url: '' })}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Owner invite ready</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              <strong>{inviteDialog.clientName}</strong> is active and ready. Share the owner invite below whenever you&apos;re ready —
              nothing is emailed automatically. Use it when you want them to claim the account and set their password.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                fullWidth
                size="small"
                value={inviteDialog.url}
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
              <IconButton
                onClick={async () => {
                  if (!inviteDialog.url) return;
                  try {
                    await navigator.clipboard.writeText(inviteDialog.url);
                    toast.success('Invite link copied');
                  } catch {
                    toast.error('Unable to copy link');
                  }
                }}
                aria-label="Copy owner invite link"
              >
                <ContentCopyIcon />
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              When the client opens this link they&apos;ll set a password, claim the account, and land in the dashboard immediately.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => handleSendActivationEmail(inviteDialog.clientId, inviteDialog.clientName)}
            disabled={sendingActivationEmail || !inviteDialog.clientId}
            startIcon={sendingActivationEmail ? <CircularProgress size={16} /> : <SendIcon />}
          >
            {sendingActivationEmail ? 'Sending…' : 'Send invite email'}
          </Button>
          <Button
            variant="contained"
            onClick={() => setInviteDialog({ open: false, clientId: null, clientName: '', url: '' })}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
