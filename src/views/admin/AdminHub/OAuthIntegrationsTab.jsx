import { useCallback, useEffect, useState } from 'react';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import StatusChip from 'ui-component/extended/StatusChip';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Avatar from '@mui/material/Avatar';

import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import StarIcon from '@mui/icons-material/Star';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ScheduleIcon from '@mui/icons-material/Schedule';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InsightsIcon from '@mui/icons-material/Insights';
import ArticleIcon from '@mui/icons-material/Article';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';

import {
  fetchOAuthConnections,
  createOAuthConnection,
  updateOAuthConnection,
  revokeOAuthConnection,
  deleteOAuthConnection,
  fetchOAuthResources,
  createOAuthResource,
  updateOAuthResource,
  deleteOAuthResource,
  OAUTH_PROVIDERS,
  getResourceTypesForProvider,
  initiateOAuth,
  fetchGoogleBusinessAccounts,
  fetchGoogleBusinessLocations,
  fetchFacebookPages,
  fetchInstagramAccounts,
  fetchTikTokAccount,
  fetchWordPressSites,
  connectWordPress,
  testMetaPermissions,
  fetchMetaInsights
} from 'api/oauth';
import { getClientPages, setPagePublishing } from 'api/social';
import { BRAND_COLORS } from 'constants/brandColors';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

// OAuth provider icons
import GoogleIcon from 'assets/images/icons/google.svg';
import FacebookIcon from 'assets/images/icons/facebook.svg';
import TikTokIcon from 'assets/images/icons/tiktok.svg';
import WordPressIcon from 'assets/images/icons/wordpress.svg';

const OAUTH_PROVIDER_ICONS = {
  google: GoogleIcon,
  facebook: FacebookIcon,
  instagram: FacebookIcon, // Instagram uses Facebook OAuth
  tiktok: TikTokIcon,
  wordpress: WordPressIcon
};

/**
 * Self-contained OAuth / Integrations tab extracted from AdminHub.
 *
 * Props:
 *  - clientId   : UUID of the currently-edited client
 *  - active     : whether this tab is currently visible (activeTab === 3)
 *  - isSuperadmin : whether the logged-in user is a superadmin
 */
export default function OAuthIntegrationsTab({ clientId, active, isSuperadmin }) {
  const toast = useToast();

  const reportError = useCallback(
    (err, fallback) => {
      const msg = getErrorMessage(err, fallback);
      toast.error(msg);
    },
    [toast]
  );

  // ── OAuth state ──────────────────────────────────────────────
  const [oauthConnections, setOauthConnections] = useState([]);
  const [oauthConnectionsLoading, setOauthConnectionsLoading] = useState(false);
  const [oauthConnectionsLoaded, setOauthConnectionsLoaded] = useState(false);
  const [oauthResources, setOauthResources] = useState({});
  const [oauthResourcesLoading, setOauthResourcesLoading] = useState({});
  const [oauthConnectionDialog, setOauthConnectionDialog] = useState({ open: false, connection: null });
  const [oauthResourceDialog, setOauthResourceDialog] = useState({ open: false, connectionId: null, resource: null });
  const [savingOauth, setSavingOauth] = useState(false);
  const [expandedConnection, setExpandedConnection] = useState(null);

  // OAuth confirmation dialogs
  const [revokeConnectionConfirm, setRevokeConnectionConfirm] = useState({ open: false, connectionId: null });
  const [deleteConnectionConfirm, setDeleteConnectionConfirm] = useState({ open: false, connectionId: null });
  const [deleteResourceConfirm, setDeleteResourceConfirm] = useState({ open: false, resourceId: null, connectionId: null });

  // Fetch Resources dialog (supports all providers)
  const [fetchResourcesDialog, setFetchResourcesDialog] = useState({
    open: false,
    connectionId: null,
    provider: null,
    loading: false,
    accounts: [],
    selectedAccount: null,
    locations: [],
    pages: [],
    instagramAccounts: [],
    tiktokAccount: null,
    wordpressSites: [],
    resourcesLoading: false
  });

  // Meta App Review -- permission test
  const [metaTestRunning, setMetaTestRunning] = useState(false);
  const [metaTestResult, setMetaTestResult] = useState(null);
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaPageId, setMetaPageId] = useState('');

  // Meta Insights -- display-ready data for Facebook connections
  const [metaInsights, setMetaInsights] = useState({});
  const [metaInsightsLoading, setMetaInsightsLoading] = useState({});

  // Social publishing — merged client-page view (oauth_resources × meta_page_links)
  // keyed by fb_page_id for fast lookup against resource rows.
  const [clientPages, setClientPages] = useState([]);
  const [pagePublishingBusy, setPagePublishingBusy] = useState({});

  // ── Loaders ──────────────────────────────────────────────────
  const loadOAuthConnections = useCallback(async (cid) => {
    if (!cid) return;
    setOauthConnectionsLoading(true);
    try {
      const conns = await fetchOAuthConnections(cid);
      setOauthConnections(conns);
    } catch (err) {
      reportError(err, 'Unable to load OAuth connections');
    } finally {
      setOauthConnectionsLoading(false);
      setOauthConnectionsLoaded(true);
    }
  }, [reportError]);

  const loadOAuthResourcesForConnection = useCallback(async (connectionId) => {
    if (!connectionId) return;
    setOauthResourcesLoading((prev) => ({ ...prev, [connectionId]: true }));
    try {
      const resources = await fetchOAuthResources(connectionId);
      setOauthResources((prev) => ({ ...prev, [connectionId]: resources }));
    } catch (err) {
      reportError(err, 'Unable to load OAuth resources');
    } finally {
      setOauthResourcesLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, [reportError]);

  // Load connections when the tab becomes active (once per client)
  useEffect(() => {
    if (active && clientId && !oauthConnectionsLoaded && !oauthConnectionsLoading) {
      loadOAuthConnections(clientId);
    }
  }, [active, clientId, oauthConnectionsLoaded, oauthConnectionsLoading, loadOAuthConnections]);

  // Reset when clientId changes
  useEffect(() => {
    setOauthConnections([]);
    setOauthConnectionsLoaded(false);
    setOauthResources({});
    setClientPages([]);
  }, [clientId]);

  // Load merged FB page publishing view whenever the tab is active for a client.
  const loadClientPages = useCallback(async (cid) => {
    if (!cid) return;
    try {
      const pages = await getClientPages(cid);
      setClientPages(Array.isArray(pages) ? pages : []);
    } catch (err) {
      // Non-fatal — drawer still works without the publishing toggle data.
      console.warn('[OAuthIntegrationsTab] getClientPages failed:', err?.message);
      setClientPages([]);
    }
  }, []);

  useEffect(() => {
    if (active && clientId) loadClientPages(clientId);
  }, [active, clientId, loadClientPages]);

  const handleTogglePagePublishing = useCallback(
    async (fbPageId, nextEnabled) => {
      if (!clientId || !fbPageId) return;
      setPagePublishingBusy((prev) => ({ ...prev, [fbPageId]: true }));
      try {
        const pages = await setPagePublishing(clientId, fbPageId, nextEnabled);
        setClientPages(Array.isArray(pages) ? pages : []);
        toast.success(nextEnabled ? 'Publishing enabled' : 'Publishing disabled');
      } catch (err) {
        reportError(err, 'Failed to update publishing state');
      } finally {
        setPagePublishingBusy((prev) => {
          const next = { ...prev };
          delete next[fbPageId];
          return next;
        });
      }
    },
    [clientId, reportError, toast]
  );

  // Handle OAuth callback URL parameters (success/error from Google OAuth)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get('oauth');
    const provider = params.get('provider');
    const errorMessage = params.get('message');
    const clientIdFromCallback = params.get('clientId');

    if (oauthStatus === 'success') {
      toast.success(`${provider === 'google' ? 'Google' : 'OAuth'} account connected successfully!`);
      window.history.replaceState({}, '', window.location.pathname);
      if (clientIdFromCallback) {
        loadOAuthConnections(clientIdFromCallback);
      }
    } else if (oauthStatus === 'error') {
      toast.error(`OAuth connection failed: ${errorMessage || 'Unknown error'}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast, loadOAuthConnections]);

  // ── Connection handlers ──────────────────────────────────────
  const handleAddOAuthConnection = () => {
    setOauthConnectionDialog({
      open: true,
      connection: {
        provider: 'google',
        provider_account_id: '',
        provider_account_name: '',
        access_token: '',
        refresh_token: '',
        scope_granted: []
      }
    });
  };

  const handleEditOAuthConnection = (connection) => {
    setOauthConnectionDialog({ open: true, connection });
  };

  const handleSaveOAuthConnection = async () => {
    if (!oauthConnectionDialog.connection || !clientId) return;
    setSavingOauth(true);
    try {
      const conn = oauthConnectionDialog.connection;
      if (conn.id) {
        await updateOAuthConnection(conn.id, conn);
        toast.success('Connection updated');
      } else if (conn.provider === 'wordpress') {
        const { wordpress_site_url, wordpress_username, wordpress_app_password } = conn;
        if (!wordpress_site_url || !wordpress_username || !wordpress_app_password) {
          toast.error('Please fill in all WordPress fields');
          setSavingOauth(false);
          return;
        }
        const result = await connectWordPress(clientId, wordpress_site_url, wordpress_username, wordpress_app_password);
        toast.success(result.message || 'WordPress connected successfully');
      } else {
        await createOAuthConnection(clientId, conn);
        toast.success('Connection created');
      }
      await loadOAuthConnections(clientId);
      setOauthConnectionDialog({ open: false, connection: null });
    } catch (err) {
      reportError(err, 'Failed to save connection');
    } finally {
      setSavingOauth(false);
    }
  };

  const handleRevokeOAuthConnectionClick = (connectionId) => {
    setRevokeConnectionConfirm({ open: true, connectionId });
  };

  const handleRevokeOAuthConnectionConfirm = async () => {
    const { connectionId } = revokeConnectionConfirm;
    if (!connectionId) return;
    try {
      await revokeOAuthConnection(connectionId);
      toast.success('Connection revoked');
      setRevokeConnectionConfirm({ open: false, connectionId: null });
      await loadOAuthConnections(clientId);
    } catch (err) {
      reportError(err, 'Failed to revoke connection');
    }
  };

  const handleDeleteOAuthConnectionClick = (connectionId) => {
    setDeleteConnectionConfirm({ open: true, connectionId });
  };

  const handleDeleteOAuthConnectionConfirm = async () => {
    const { connectionId } = deleteConnectionConfirm;
    if (!connectionId) return;
    try {
      await deleteOAuthConnection(connectionId);
      toast.success('Connection deleted');
      setDeleteConnectionConfirm({ open: false, connectionId: null });
      await loadOAuthConnections(clientId);
    } catch (err) {
      reportError(err, 'Failed to delete connection');
    }
  };

  // ── Meta permission test ─────────────────────────────────────
  const handleTestMetaPermissions = async () => {
    setMetaTestRunning(true);
    setMetaTestResult(null);
    try {
      const opts = metaAccessToken.trim() ? { accessToken: metaAccessToken.trim() } : {};
      if (metaPageId.trim()) opts.pageId = metaPageId.trim();
      const result = await testMetaPermissions(opts);
      setMetaTestResult(result);
      const { passed, failed, skipped } = result.summary;
      if (failed === 0) {
        toast.success(`Meta permissions test passed! ${passed} passed, ${skipped} skipped (${result.durationMs}ms)`);
      } else {
        toast.warning(`Meta permissions test: ${passed} passed, ${failed} failed, ${skipped} skipped`);
      }
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Failed to run Meta permission test');
    } finally {
      setMetaTestRunning(false);
    }
  };

  // ── Meta Insights ────────────────────────────────────────────
  const handleLoadMetaInsights = async (connectionId) => {
    setMetaInsightsLoading((prev) => ({ ...prev, [connectionId]: true }));
    try {
      const insights = await fetchMetaInsights(connectionId);
      setMetaInsights((prev) => ({ ...prev, [connectionId]: insights }));
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Failed to load Meta insights');
    } finally {
      setMetaInsightsLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  };

  // ── Resource handlers ────────────────────────────────────────
  const handleAddOAuthResource = (connectionId) => {
    const conn = oauthConnections.find((c) => c.id === connectionId);
    const resourceTypes = conn ? getResourceTypesForProvider(conn.provider) : [];
    setOauthResourceDialog({
      open: true,
      connectionId,
      resource: {
        resource_type: resourceTypes[0]?.value || '',
        resource_id: '',
        resource_name: '',
        resource_username: '',
        resource_url: '',
        is_primary: false
      }
    });
  };

  const handleEditOAuthResource = (connectionId, resource) => {
    setOauthResourceDialog({ open: true, connectionId, resource });
  };

  const handleSaveOAuthResource = async () => {
    if (!oauthResourceDialog.resource || !oauthResourceDialog.connectionId) return;
    setSavingOauth(true);
    try {
      const res = oauthResourceDialog.resource;
      if (res.id) {
        await updateOAuthResource(res.id, res);
        toast.success('Resource updated');
      } else {
        await createOAuthResource(oauthResourceDialog.connectionId, res);
        toast.success('Resource added');
      }
      await loadOAuthResourcesForConnection(oauthResourceDialog.connectionId);
      setOauthResourceDialog({ open: false, connectionId: null, resource: null });
    } catch (err) {
      reportError(err, 'Failed to save resource');
    } finally {
      setSavingOauth(false);
    }
  };

  const handleTogglePrimaryResource = async (resourceId, isPrimary) => {
    try {
      await updateOAuthResource(resourceId, { is_primary: isPrimary });
      for (const connId of Object.keys(oauthResources)) {
        await loadOAuthResourcesForConnection(connId);
      }
    } catch (err) {
      reportError(err, 'Failed to update resource');
    }
  };

  const handleDeleteOAuthResourceClick = (resourceId, connectionId) => {
    setDeleteResourceConfirm({ open: true, resourceId, connectionId });
  };

  const handleDeleteOAuthResourceConfirm = async () => {
    const { resourceId, connectionId } = deleteResourceConfirm;
    if (!resourceId) return;
    try {
      await deleteOAuthResource(resourceId);
      toast.success('Resource deleted');
      setDeleteResourceConfirm({ open: false, resourceId: null, connectionId: null });
      await loadOAuthResourcesForConnection(connectionId);
    } catch (err) {
      reportError(err, 'Failed to delete resource');
    }
  };

  // ── Fetch Resources handlers (all providers) ────────────────
  const handleOpenFetchResources = async (connectionId, provider) => {
    const initialState = {
      open: true,
      connectionId,
      provider,
      loading: true,
      accounts: [],
      selectedAccount: null,
      locations: [],
      pages: [],
      instagramAccounts: [],
      tiktokAccount: null,
      wordpressSites: [],
      resourcesLoading: false
    };
    setFetchResourcesDialog(initialState);

    try {
      if (provider === 'google') {
        const accounts = await fetchGoogleBusinessAccounts(connectionId);
        setFetchResourcesDialog((prev) => ({ ...prev, loading: false, accounts }));
      } else if (provider === 'facebook') {
        const [pages, igAccounts] = await Promise.all([fetchFacebookPages(connectionId), fetchInstagramAccounts(connectionId)]);
        setFetchResourcesDialog((prev) => ({ ...prev, loading: false, pages, instagramAccounts: igAccounts }));
      } else if (provider === 'tiktok') {
        const tiktokAccount = await fetchTikTokAccount(connectionId);
        setFetchResourcesDialog((prev) => ({ ...prev, loading: false, tiktokAccount }));
      } else if (provider === 'wordpress') {
        const wordpressSites = await fetchWordPressSites(connectionId);
        setFetchResourcesDialog((prev) => ({ ...prev, loading: false, wordpressSites }));
      } else {
        setFetchResourcesDialog((prev) => ({ ...prev, loading: false }));
      }
    } catch (err) {
      reportError(err, `Failed to fetch ${provider} resources`);
      setFetchResourcesDialog((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleSelectGoogleAccount = async (accountName) => {
    if (!fetchResourcesDialog.connectionId || !accountName) return;

    setFetchResourcesDialog((prev) => ({
      ...prev,
      selectedAccount: accountName,
      resourcesLoading: true,
      locations: []
    }));

    try {
      const locations = await fetchGoogleBusinessLocations(fetchResourcesDialog.connectionId, accountName);
      setFetchResourcesDialog((prev) => ({
        ...prev,
        resourcesLoading: false,
        locations
      }));
    } catch (err) {
      reportError(err, 'Failed to fetch locations');
      setFetchResourcesDialog((prev) => ({ ...prev, resourcesLoading: false }));
    }
  };

  const handleAddResource = async (resource, resourceType) => {
    if (!fetchResourcesDialog.connectionId) return;

    try {
      let payload;
      let displayName;

      if (resourceType === 'google_location') {
        const locationId = resource.name.replace('locations/', '');
        payload = {
          resource_type: 'google_location',
          resource_id: locationId,
          resource_name: resource.title,
          resource_url: resource.websiteUri || '',
          is_primary: false
        };
        displayName = resource.title;
      } else if (resourceType === 'facebook_page') {
        payload = {
          resource_type: 'facebook_page',
          resource_id: resource.id,
          resource_name: resource.name,
          resource_url: resource.link || '',
          is_primary: false
        };
        displayName = resource.name;
      } else if (resourceType === 'instagram_account') {
        payload = {
          resource_type: 'instagram_account',
          resource_id: resource.id,
          resource_name: resource.name || resource.username,
          resource_username: resource.username,
          resource_url: `https://instagram.com/${resource.username}`,
          is_primary: false
        };
        displayName = resource.username;
      } else if (resourceType === 'tiktok_account') {
        payload = {
          resource_type: 'tiktok_account',
          resource_id: resource.id,
          resource_name: resource.displayName || resource.username,
          resource_username: resource.username,
          resource_url: resource.profileUrl || '',
          is_primary: false
        };
        displayName = resource.displayName || resource.username;
      } else if (resourceType === 'wordpress_site') {
        payload = {
          resource_type: 'wordpress_site',
          resource_id: String(resource.blogId || resource.id),
          resource_name: resource.name,
          resource_url: resource.url,
          is_primary: false
        };
        displayName = resource.name;
      }

      await createOAuthResource(fetchResourcesDialog.connectionId, payload);
      toast.success(`Added: ${displayName}`);
      await loadOAuthResourcesForConnection(fetchResourcesDialog.connectionId);
    } catch (err) {
      reportError(err, 'Failed to add resource');
    }
  };

  const handleCloseFetchResources = () => {
    setFetchResourcesDialog({
      open: false,
      connectionId: null,
      provider: null,
      loading: false,
      accounts: [],
      selectedAccount: null,
      locations: [],
      pages: [],
      instagramAccounts: [],
      tiktokAccount: null,
      wordpressSites: [],
      resourcesLoading: false
    });
  };

  // ── Render ───────────────────────────────────────────────────
  if (!active) return null;

  return (
    <>
      <Stack spacing={2} sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle1">OAuth Connections</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" startIcon={<AddIcon />} onClick={handleAddOAuthConnection}>
              Add Connection
            </Button>
          </Stack>
        </Box>
        {isSuperadmin && (
          <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Meta App Review — Permission Test</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Paste a token from{' '}
              <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">
                Graph API Explorer
              </a>
              {' '}with the required scopes, or leave blank to use an existing connection.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                placeholder="Paste Graph API Explorer access token..."
                value={metaAccessToken}
                onChange={(e) => setMetaAccessToken(e.target.value)}
                sx={{ flex: 1 }}
                type="password"
              />
              <TextField
                size="small"
                placeholder="Page ID (optional)"
                value={metaPageId}
                onChange={(e) => setMetaPageId(e.target.value)}
                sx={{ width: 180 }}
              />
              <Button
                size="small"
                variant="contained"
                startIcon={metaTestRunning ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
                onClick={handleTestMetaPermissions}
                disabled={metaTestRunning}
              >
                {metaTestRunning ? 'Testing...' : 'Run Test'}
              </Button>
            </Stack>
          </Box>
        )}
        {metaTestResult && (
          <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Meta Permission Test Results ({metaTestResult.durationMs}ms)
            </Typography>
            <Stack spacing={0.5}>
              {Object.entries(metaTestResult.permissions).map(([perm, result]) => (
                <Box key={perm} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {result.skipped ? (
                    <ScheduleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  ) : result.success || result.forms?.success ? (
                    <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                  ) : (
                    <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
                  )}
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {perm}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {result.skipped
                      ? result.reason
                      : result.endpoint || result.forms?.endpoint || ''}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        )}
        {oauthConnectionsLoading && <CircularProgress size={20} />}
        {!oauthConnectionsLoading && oauthConnections.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No OAuth connections yet. Add a connection to link Google, Facebook, Instagram, or TikTok accounts.
          </Typography>
        )}
        {oauthConnections.map((conn) => {
          const providerConfig = OAUTH_PROVIDERS[conn.provider] || { label: conn.provider, color: '#666' };
          const isExpanded = expandedConnection === conn.id;
          const resources = oauthResources[conn.id] || [];
          const resourcesLoading = oauthResourcesLoading[conn.id];
          return (
            <Accordion
              key={conn.id}
              expanded={isExpanded}
              onChange={(_, expanded) => {
                setExpandedConnection(expanded ? conn.id : null);
                if (expanded && !oauthResources[conn.id]) {
                  loadOAuthResourcesForConnection(conn.id);
                }
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                  <Chip label={providerConfig.label} size="small" sx={{ bgcolor: providerConfig.color, color: '#fff', fontWeight: 500 }} />
                  <Typography sx={{ flex: 1 }}>{conn.provider_account_name || conn.provider_account_id}</Typography>
                  <StatusChip status={conn.is_connected ? 'connected' : 'disconnected'} />
                  <Typography variant="caption" color="text.secondary">
                    {conn.resource_count || 0} resource(s)
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => handleEditOAuthConnection(conn)}>
                      Edit
                    </Button>
                    {conn.is_connected && (
                      <Button size="small" color="warning" startIcon={<LinkOffIcon />} onClick={() => handleRevokeOAuthConnectionClick(conn.id)}>
                        Revoke
                      </Button>
                    )}
                    <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => handleDeleteOAuthConnectionClick(conn.id)}>
                      Delete
                    </Button>
                  </Box>
                  <Divider />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="subtitle2">Resources (Pages / Locations)</Typography>
                    <Stack direction="row" spacing={1}>
                      {conn.is_connected && ['google', 'facebook', 'tiktok', 'wordpress'].includes(conn.provider) && (
                        <Button size="small" variant="outlined" onClick={() => handleOpenFetchResources(conn.id, conn.provider)}>
                          Fetch{' '}
                          {conn.provider === 'google'
                            ? 'Locations'
                            : conn.provider === 'facebook'
                              ? 'Pages'
                              : conn.provider === 'wordpress'
                                ? 'Sites'
                                : 'Account'}
                        </Button>
                      )}
                      <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddOAuthResource(conn.id)}>
                        Add Resource
                      </Button>
                    </Stack>
                  </Box>
                  {resourcesLoading && <CircularProgress size={16} />}
                  {!resourcesLoading && resources.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No resources added yet.
                    </Typography>
                  )}
                  {resources.map((res) => {
                    const isFbPage = res.resource_type === 'facebook_page';
                    const pageInfo = isFbPage ? clientPages.find((p) => p.fb_page_id === res.resource_id) : null;
                    const publishing = !!pageInfo?.publishing_enabled;
                    const accessibleBySystem = pageInfo?.accessible_by_system_user;
                    const healthStatus = pageInfo?.last_health_status || null;
                    const busy = !!pagePublishingBusy[res.resource_id];
                    return (
                      <Box
                        key={res.id}
                        sx={{
                          p: 1,
                          border: '1px solid',
                          borderColor: res.is_primary ? 'primary.main' : 'divider',
                          borderRadius: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.5
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {res.is_primary && (
                            <Tooltip title="Primary resource">
                              <StarIcon color="primary" fontSize="small" />
                            </Tooltip>
                          )}
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight={res.is_primary ? 600 : 400}>
                              {res.resource_name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {res.resource_type} • {res.resource_id}
                            </Typography>
                          </Box>
                          <Stack direction="row" spacing={0.5}>
                            {!res.is_primary && (
                              <Tooltip title="Set as primary">
                                <IconButton size="small" onClick={() => handleTogglePrimaryResource(res.id, true)}>
                                  <StarIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <IconButton size="small" onClick={() => handleEditOAuthResource(conn.id, res)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" color="error" onClick={() => handleDeleteOAuthResourceClick(res.id, conn.id)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </Box>
                        {isFbPage && (
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{ pl: 4, pt: 0.5 }}
                          >
                            <Switch
                              size="small"
                              checked={publishing}
                              disabled={busy}
                              onChange={(e) => handleTogglePagePublishing(res.resource_id, e.target.checked)}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {publishing ? 'Publishing enabled' : 'Publishing disabled'}
                            </Typography>
                            {publishing && healthStatus && (
                              <StatusChip status={healthStatus} />
                            )}
                            {accessibleBySystem === false && (
                              <Tooltip title="Agency Business Manager lacks publishing access to this Page. Share the Page with the agency BM via Business Manager → Partners before posting.">
                                <WarningAmberIcon color="warning" fontSize="small" />
                              </Tooltip>
                            )}
                          </Stack>
                        )}
                      </Box>
                    );
                  })}
                  {/* Meta Insights Panel -- Facebook connections only */}
                  {conn.provider === 'facebook' && conn.is_connected && (
                    <>
                      <Divider />
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle2">Meta Insights</Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={metaInsightsLoading[conn.id] ? <CircularProgress size={14} /> : <InsightsIcon />}
                          onClick={() => handleLoadMetaInsights(conn.id)}
                          disabled={metaInsightsLoading[conn.id]}
                        >
                          {metaInsightsLoading[conn.id] ? 'Loading...' : metaInsights[conn.id] ? 'Refresh Insights' : 'Load Insights'}
                        </Button>
                      </Box>
                      {metaInsights[conn.id] && (() => {
                        const data = metaInsights[conn.id];
                        return (
                          <Stack spacing={2}>
                            {/* Pages Overview */}
                            {data.pages.length > 0 && (
                              <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                  <ArticleIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                                  <Typography variant="subtitle2">Facebook Pages</Typography>
                                  <Chip label="pages_show_list" size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                </Stack>
                                <Stack spacing={1}>
                                  {data.pages.map((page) => (
                                    <Box key={page.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                      {page.picture ? (
                                        <Avatar src={page.picture} sx={{ width: 32, height: 32 }} />
                                      ) : (
                                        <Avatar sx={{ width: 32, height: 32, bgcolor: BRAND_COLORS.facebook }}>F</Avatar>
                                      )}
                                      <Box sx={{ flex: 1 }}>
                                        <Typography variant="body2" fontWeight={600}>{page.name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {page.category} {page.hasInstagram ? ' • Instagram linked' : ''}
                                        </Typography>
                                      </Box>
                                      {page.link && (
                                        <Typography
                                          component="a"
                                          href={page.link}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          variant="caption"
                                          sx={{ color: 'primary.main' }}
                                        >
                                          View Page
                                        </Typography>
                                      )}
                                    </Box>
                                  ))}
                                </Stack>
                              </Box>
                            )}

                            {/* Page Engagement */}
                            {data.engagement.length > 0 && (
                              <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                  <ThumbUpIcon sx={{ fontSize: 18, color: BRAND_COLORS.facebook }} />
                                  <Typography variant="subtitle2">Page Engagement</Typography>
                                  <Chip label="pages_read_engagement" size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                </Stack>
                                {data.engagement.map((eng) => (
                                  <Box key={eng.pageId} sx={{ mb: 1 }}>
                                    <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5 }}>
                                      {eng.pageName}
                                      {eng.ratingsCount > 0 && (
                                        <Chip label={`${eng.ratingsCount} rating(s)`} size="small" color="success" variant="outlined" sx={{ ml: 1, fontSize: '0.65rem', height: 20 }} />
                                      )}
                                    </Typography>
                                    {eng.recentPosts.length > 0 ? (
                                      <Stack spacing={0.5}>
                                        {eng.recentPosts.map((post) => (
                                          <Box key={post.id} sx={{ pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                                            <Typography variant="caption" color="text.secondary">
                                              {post.type} • {new Date(post.createdAt).toLocaleDateString()}
                                            </Typography>
                                            {post.snippet && (
                                              <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{post.snippet}</Typography>
                                            )}
                                          </Box>
                                        ))}
                                      </Stack>
                                    ) : (
                                      <Typography variant="caption" color="text.secondary">No recent posts</Typography>
                                    )}
                                  </Box>
                                ))}
                              </Box>
                            )}

                            {/* Lead Forms */}
                            {data.leadForms.length > 0 && (
                              <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                  <LeaderboardIcon sx={{ fontSize: 18, color: BRAND_COLORS.facebook_green }} />
                                  <Typography variant="subtitle2">Lead Ad Forms</Typography>
                                  <Chip label="leads_retrieval" size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                </Stack>
                                {data.leadForms.map((pf) => (
                                  <Box key={pf.pageId} sx={{ mb: 1.5 }}>
                                    <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5 }}>{pf.pageName}</Typography>
                                    <Stack spacing={0.5}>
                                      {pf.forms.map((form) => (
                                        <Box key={form.id} sx={{ pl: 1, borderLeft: '2px solid', borderColor: form.status === 'ACTIVE' ? 'success.main' : 'divider' }}>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{form.name}</Typography>
                                            <StatusChip
                                              status={form.status === 'ACTIVE' ? 'active' : form.status}
                                              label={form.status}
                                              variant="outlined"
                                              sx={{ fontSize: '0.6rem', height: 18 }}
                                            />
                                            <Typography variant="caption" color="text.secondary">
                                              {form.leadsCount} lead(s)
                                            </Typography>
                                          </Box>
                                          {form.recentLeads.length > 0 && (
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                                              Latest: {new Date(form.recentLeads[0].createdAt).toLocaleString()}
                                            </Typography>
                                          )}
                                        </Box>
                                      ))}
                                    </Stack>
                                  </Box>
                                ))}
                              </Box>
                            )}

                            {/* Instagram Accounts */}
                            {data.instagramAccounts.length > 0 && (
                              <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                                  <CameraAltIcon sx={{ fontSize: 18, color: BRAND_COLORS.instagram }} />
                                  <Typography variant="subtitle2">Instagram Accounts</Typography>
                                  <Chip label="instagram_basic" size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                </Stack>
                                <Stack spacing={1}>
                                  {data.instagramAccounts.map((ig) => (
                                    <Box key={ig.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                      {ig.picture ? (
                                        <Avatar src={ig.picture} sx={{ width: 32, height: 32 }} />
                                      ) : (
                                        <Avatar sx={{ width: 32, height: 32, bgcolor: BRAND_COLORS.instagram }}>IG</Avatar>
                                      )}
                                      <Box sx={{ flex: 1 }}>
                                        <Typography variant="body2" fontWeight={600}>@{ig.username}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {ig.name} • Linked to {ig.linkedPageName}
                                        </Typography>
                                      </Box>
                                      <Stack direction="row" spacing={2}>
                                        <Box sx={{ textAlign: 'center' }}>
                                          <Typography variant="body2" fontWeight={600}>{ig.followersCount?.toLocaleString() ?? '—'}</Typography>
                                          <Typography variant="caption" color="text.secondary">Followers</Typography>
                                        </Box>
                                        <Box sx={{ textAlign: 'center' }}>
                                          <Typography variant="body2" fontWeight={600}>{ig.mediaCount?.toLocaleString() ?? '—'}</Typography>
                                          <Typography variant="caption" color="text.secondary">Posts</Typography>
                                        </Box>
                                      </Stack>
                                    </Box>
                                  ))}
                                </Stack>
                              </Box>
                            )}

                            {/* Errors */}
                            {data.errors.length > 0 && (
                              <Box sx={{ p: 1.5, bgcolor: 'error.50', borderRadius: 1, border: '1px solid', borderColor: 'error.light' }}>
                                <Typography variant="subtitle2" color="error" sx={{ mb: 0.5 }}>API Errors</Typography>
                                {data.errors.map((err, i) => (
                                  <Typography key={i} variant="caption" color="error" sx={{ display: 'block' }}>
                                    {err.scope}: {err.message}
                                  </Typography>
                                ))}
                              </Box>
                            )}

                            {data.pages.length === 0 && data.errors.length === 0 && (
                              <Typography variant="body2" color="text.secondary">
                                No pages found for this connection. The connected Facebook account may not manage any pages.
                              </Typography>
                            )}
                          </Stack>
                        );
                      })()}
                    </>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Stack>

      {/* ── OAuth Connection Dialog ─────────────────────────── */}
      <Dialog
        open={oauthConnectionDialog.open}
        onClose={() => setOauthConnectionDialog({ open: false, connection: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{oauthConnectionDialog.connection?.id ? 'Edit Connection' : 'Add OAuth Connection'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Provider"
              select
              value={oauthConnectionDialog.connection?.provider || 'google'}
              onChange={(e) =>
                setOauthConnectionDialog((prev) => ({
                  ...prev,
                  connection: { ...prev.connection, provider: e.target.value }
                }))
              }
              disabled={!!oauthConnectionDialog.connection?.id}
            >
              {Object.entries(OAUTH_PROVIDERS).map(([value, config]) => (
                <MenuItem key={value} value={value}>
                  {config.label}
                </MenuItem>
              ))}
            </TextField>

            {/* For new connections with OAuth support (Google, Facebook, Instagram, TikTok), show sign-in button */}
            {!oauthConnectionDialog.connection?.id &&
              ['google', 'facebook', 'instagram', 'tiktok'].includes(oauthConnectionDialog.connection?.provider) && (
                <Box sx={{ py: 2, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {oauthConnectionDialog.connection?.provider === 'google' &&
                      'Connect your Google account to access Google Business Profile features including reviews.'}
                    {oauthConnectionDialog.connection?.provider === 'facebook' &&
                      'Connect your Facebook account to manage Facebook Pages and linked Instagram accounts.'}
                    {oauthConnectionDialog.connection?.provider === 'instagram' &&
                      'Connect via Facebook to manage your Instagram Business account (Instagram is linked through Facebook).'}
                    {oauthConnectionDialog.connection?.provider === 'tiktok' &&
                      'Connect your TikTok account to manage your TikTok for Business presence.'}
                  </Typography>
                  <Button
                    variant="contained"
                    size="large"
                    onClick={async () => {
                      if (clientId) {
                        try {
                          const provider = oauthConnectionDialog.connection?.provider;
                          // Instagram uses Facebook OAuth
                          const oauthProvider = provider === 'instagram' ? 'facebook' : provider;
                          const { authUrl } = await initiateOAuth(oauthProvider, clientId);
                          window.location.href = authUrl;
                        } catch (err) {
                          toast.error(err?.response?.data?.message || err?.message || 'Failed to start OAuth');
                        }
                      }
                    }}
                    disabled={!clientId}
                    sx={{
                      bgcolor: OAUTH_PROVIDERS[oauthConnectionDialog.connection?.provider]?.color || '#666',
                      '&:hover': { opacity: 0.9 },
                      textTransform: 'none',
                      px: 4,
                      py: 1.5
                    }}
                  >
                    {OAUTH_PROVIDER_ICONS[oauthConnectionDialog.connection?.provider] && (
                      <Box
                        component="img"
                        src={OAUTH_PROVIDER_ICONS[oauthConnectionDialog.connection?.provider]}
                        alt=""
                        sx={{
                          width: 20,
                          height: 20,
                          mr: 1.5,
                          filter: oauthConnectionDialog.connection?.provider === 'tiktok' ? 'invert(1)' : 'none'
                        }}
                      />
                    )}
                    Sign in with{' '}
                    {oauthConnectionDialog.connection?.provider === 'instagram'
                      ? 'Facebook (for Instagram)'
                      : OAUTH_PROVIDERS[oauthConnectionDialog.connection?.provider]?.label}
                  </Button>
                  <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 2 }}>
                    You&apos;ll be redirected to{' '}
                    {oauthConnectionDialog.connection?.provider === 'instagram'
                      ? 'Facebook'
                      : OAUTH_PROVIDERS[oauthConnectionDialog.connection?.provider]?.label}{' '}
                    to authorize access.
                  </Typography>
                </Box>
              )}

            {/* WordPress uses Application Passwords instead of OAuth */}
            {!oauthConnectionDialog.connection?.id && oauthConnectionDialog.connection?.provider === 'wordpress' && (
              <Box sx={{ py: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Connect your self-hosted WordPress site using Application Passwords.
                  <Box component="span" sx={{ display: 'block', mt: 1, fontSize: '0.75rem' }}>
                    To create an Application Password: Go to WordPress Admin → Users → Profile → Application Passwords
                  </Box>
                </Typography>
                <Stack spacing={2}>
                  <TextField
                    label="WordPress Site URL"
                    value={oauthConnectionDialog.connection?.wordpress_site_url || ''}
                    onChange={(e) =>
                      setOauthConnectionDialog((prev) => ({
                        ...prev,
                        connection: { ...prev.connection, wordpress_site_url: e.target.value }
                      }))
                    }
                    placeholder="https://example.com"
                    required
                    helperText="The full URL of your WordPress site"
                  />
                  <TextField
                    label="WordPress Username"
                    value={oauthConnectionDialog.connection?.wordpress_username || ''}
                    onChange={(e) =>
                      setOauthConnectionDialog((prev) => ({
                        ...prev,
                        connection: { ...prev.connection, wordpress_username: e.target.value }
                      }))
                    }
                    placeholder="admin"
                    required
                    helperText="Your WordPress admin username"
                  />
                  <TextField
                    label="Application Password"
                    value={oauthConnectionDialog.connection?.wordpress_app_password || ''}
                    onChange={(e) =>
                      setOauthConnectionDialog((prev) => ({
                        ...prev,
                        connection: { ...prev.connection, wordpress_app_password: e.target.value }
                      }))
                    }
                    type="password"
                    placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                    required
                    helperText="The application password from WordPress (spaces are OK)"
                  />
                </Stack>
              </Box>
            )}

            {/* For editing existing connections, show manual entry (read-only for key fields) */}
            {oauthConnectionDialog.connection?.id && (
              <>
                <TextField
                  label="Account ID"
                  value={oauthConnectionDialog.connection?.provider_account_id || ''}
                  onChange={(e) =>
                    setOauthConnectionDialog((prev) => ({
                      ...prev,
                      connection: { ...prev.connection, provider_account_id: e.target.value }
                    }))
                  }
                  placeholder="e.g., 123456789 (from the platform)"
                  required
                  disabled={!!oauthConnectionDialog.connection?.id}
                />
                <TextField
                  label="Account Name"
                  value={oauthConnectionDialog.connection?.provider_account_name || ''}
                  onChange={(e) =>
                    setOauthConnectionDialog((prev) => ({
                      ...prev,
                      connection: { ...prev.connection, provider_account_name: e.target.value }
                    }))
                  }
                  placeholder="Display name for this connection"
                />
                <TextField
                  label="Access Token"
                  value={oauthConnectionDialog.connection?.access_token || ''}
                  onChange={(e) =>
                    setOauthConnectionDialog((prev) => ({
                      ...prev,
                      connection: { ...prev.connection, access_token: e.target.value }
                    }))
                  }
                  type="password"
                  placeholder="OAuth access token"
                />
                <TextField
                  label="Refresh Token"
                  value={oauthConnectionDialog.connection?.refresh_token || ''}
                  onChange={(e) =>
                    setOauthConnectionDialog((prev) => ({
                      ...prev,
                      connection: { ...prev.connection, refresh_token: e.target.value }
                    }))
                  }
                  type="password"
                  placeholder="OAuth refresh token (if available)"
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOauthConnectionDialog({ open: false, connection: null })}>Cancel</Button>
          {/* Show Save button when editing existing connections OR when adding WordPress (which uses form instead of OAuth) */}
          {(oauthConnectionDialog.connection?.id || oauthConnectionDialog.connection?.provider === 'wordpress') && (
            <Button
              variant="contained"
              onClick={handleSaveOAuthConnection}
              disabled={
                savingOauth ||
                (oauthConnectionDialog.connection?.id && !oauthConnectionDialog.connection?.provider_account_id) ||
                (oauthConnectionDialog.connection?.provider === 'wordpress' &&
                  !oauthConnectionDialog.connection?.id &&
                  (!oauthConnectionDialog.connection?.wordpress_site_url ||
                    !oauthConnectionDialog.connection?.wordpress_username ||
                    !oauthConnectionDialog.connection?.wordpress_app_password))
              }
            >
              {savingOauth ? 'Connecting...' : oauthConnectionDialog.connection?.id ? 'Save' : 'Connect WordPress'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── OAuth Resource Dialog ───────────────────────────── */}
      <Dialog
        open={oauthResourceDialog.open}
        onClose={() => setOauthResourceDialog({ open: false, connectionId: null, resource: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{oauthResourceDialog.resource?.id ? 'Edit Resource' : 'Add Resource'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {(() => {
              const conn = oauthConnections.find((c) => c.id === oauthResourceDialog.connectionId);
              const resourceTypes = conn ? getResourceTypesForProvider(conn.provider) : [];
              return (
                <TextField
                  label="Resource Type"
                  select
                  value={oauthResourceDialog.resource?.resource_type || ''}
                  onChange={(e) =>
                    setOauthResourceDialog((prev) => ({
                      ...prev,
                      resource: { ...prev.resource, resource_type: e.target.value }
                    }))
                  }
                  disabled={!!oauthResourceDialog.resource?.id}
                >
                  {resourceTypes.map((type) => (
                    <MenuItem key={type.value} value={type.value}>
                      {type.label}
                    </MenuItem>
                  ))}
                </TextField>
              );
            })()}
            <TextField
              label="Resource ID"
              value={oauthResourceDialog.resource?.resource_id || ''}
              onChange={(e) =>
                setOauthResourceDialog((prev) => ({
                  ...prev,
                  resource: { ...prev.resource, resource_id: e.target.value }
                }))
              }
              placeholder="e.g., page ID or location ID"
              required
            />
            <TextField
              label="Resource Name"
              value={oauthResourceDialog.resource?.resource_name || ''}
              onChange={(e) =>
                setOauthResourceDialog((prev) => ({
                  ...prev,
                  resource: { ...prev.resource, resource_name: e.target.value }
                }))
              }
              placeholder="Display name"
              required
            />
            <TextField
              label="Username / Handle"
              value={oauthResourceDialog.resource?.resource_username || ''}
              onChange={(e) =>
                setOauthResourceDialog((prev) => ({
                  ...prev,
                  resource: { ...prev.resource, resource_username: e.target.value }
                }))
              }
              placeholder="e.g., @username (optional)"
            />
            <TextField
              label="Resource URL"
              value={oauthResourceDialog.resource?.resource_url || ''}
              onChange={(e) =>
                setOauthResourceDialog((prev) => ({
                  ...prev,
                  resource: { ...prev.resource, resource_url: e.target.value }
                }))
              }
              placeholder="https://... (optional)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={oauthResourceDialog.resource?.is_primary || false}
                  onChange={(e) =>
                    setOauthResourceDialog((prev) => ({
                      ...prev,
                      resource: { ...prev.resource, is_primary: e.target.checked }
                    }))
                  }
                />
              }
              label="Set as primary resource for this connection"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOauthResourceDialog({ open: false, connectionId: null, resource: null })}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveOAuthResource}
            disabled={savingOauth || !oauthResourceDialog.resource?.resource_id || !oauthResourceDialog.resource?.resource_name}
          >
            {savingOauth ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Fetch Resources Dialog (All Providers) ──────────── */}
      <Dialog open={fetchResourcesDialog.open} onClose={handleCloseFetchResources} maxWidth="sm" fullWidth>
        <DialogTitle>
          Fetch{' '}
          {fetchResourcesDialog.provider === 'google'
            ? 'Google Business Locations'
            : fetchResourcesDialog.provider === 'facebook'
              ? 'Facebook Pages & Instagram'
              : fetchResourcesDialog.provider === 'tiktok'
                ? 'TikTok Account'
                : 'Resources'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {fetchResourcesDialog.loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress />
              </Box>
            )}

            {/* Google Content */}
            {!fetchResourcesDialog.loading && fetchResourcesDialog.provider === 'google' && (
              <>
                {fetchResourcesDialog.accounts.length === 0 && (
                  <Alert severity="warning">
                    No Google Business accounts found. Make sure your Google account has access to Google Business Profile.
                  </Alert>
                )}

                {fetchResourcesDialog.accounts.length > 0 && (
                  <>
                    <TextField
                      label="Select Business Account"
                      select
                      value={fetchResourcesDialog.selectedAccount || ''}
                      onChange={(e) => handleSelectGoogleAccount(e.target.value)}
                      fullWidth
                    >
                      {fetchResourcesDialog.accounts.map((account) => (
                        <MenuItem key={account.name} value={account.name}>
                          {account.accountName} ({account.type})
                        </MenuItem>
                      ))}
                    </TextField>

                    {fetchResourcesDialog.resourcesLoading && (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={24} />
                      </Box>
                    )}

                    {!fetchResourcesDialog.resourcesLoading &&
                      fetchResourcesDialog.selectedAccount &&
                      fetchResourcesDialog.locations.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          No locations found for this account.
                        </Typography>
                      )}

                    {fetchResourcesDialog.locations.length > 0 && (
                      <Stack spacing={1}>
                        <Typography variant="subtitle2">Available Locations</Typography>
                        {fetchResourcesDialog.locations.map((location) => (
                          <Box
                            key={location.name}
                            sx={{
                              p: 1.5,
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}
                          >
                            <Box>
                              <Typography variant="body2" fontWeight={500}>
                                {location.title}
                              </Typography>
                              {location.address && (
                                <Typography variant="caption" color="text.secondary">
                                  {[location.address.locality, location.address.administrativeArea].filter(Boolean).join(', ')}
                                </Typography>
                              )}
                            </Box>
                            <Button size="small" variant="outlined" onClick={() => handleAddResource(location, 'google_location')}>
                              Add
                            </Button>
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </>
                )}
              </>
            )}

            {/* Facebook Content */}
            {!fetchResourcesDialog.loading && fetchResourcesDialog.provider === 'facebook' && (
              <>
                {fetchResourcesDialog.pages.length === 0 && fetchResourcesDialog.instagramAccounts.length === 0 && (
                  <Alert severity="warning">
                    No Facebook Pages or Instagram accounts found. Make sure you have admin access to at least one Facebook Page.
                  </Alert>
                )}

                {fetchResourcesDialog.pages.length > 0 && (
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Facebook Pages</Typography>
                    {fetchResourcesDialog.pages.map((page) => (
                      <Box
                        key={page.id}
                        sx={{
                          p: 1.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {page.picture && (
                            <Box component="img" src={page.picture} alt="" sx={{ width: 32, height: 32, borderRadius: 1 }} />
                          )}
                          <Box>
                            <Typography variant="body2" fontWeight={500}>
                              {page.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {page.category}
                            </Typography>
                          </Box>
                        </Box>
                        <Button size="small" variant="outlined" onClick={() => handleAddResource(page, 'facebook_page')}>
                          Add
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                )}

                {fetchResourcesDialog.instagramAccounts.length > 0 && (
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Instagram Accounts</Typography>
                    {fetchResourcesDialog.instagramAccounts.map((account) => (
                      <Box
                        key={account.id}
                        sx={{
                          p: 1.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {account.picture && (
                            <Box component="img" src={account.picture} alt="" sx={{ width: 32, height: 32, borderRadius: '50%' }} />
                          )}
                          <Box>
                            <Typography variant="body2" fontWeight={500}>
                              @{account.username}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {account.followersCount?.toLocaleString()} followers • Linked to {account.linkedPageName}
                            </Typography>
                          </Box>
                        </Box>
                        <Button size="small" variant="outlined" onClick={() => handleAddResource(account, 'instagram_account')}>
                          Add
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                )}
              </>
            )}

            {/* TikTok Content */}
            {!fetchResourcesDialog.loading && fetchResourcesDialog.provider === 'tiktok' && (
              <>
                {!fetchResourcesDialog.tiktokAccount && (
                  <Alert severity="warning">Unable to fetch TikTok account information. Please try reconnecting.</Alert>
                )}

                {fetchResourcesDialog.tiktokAccount && (
                  <Box
                    sx={{
                      p: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      {fetchResourcesDialog.tiktokAccount.picture && (
                        <Box
                          component="img"
                          src={fetchResourcesDialog.tiktokAccount.picture}
                          alt=""
                          sx={{ width: 48, height: 48, borderRadius: '50%' }}
                        />
                      )}
                      <Box>
                        <Typography variant="body1" fontWeight={500}>
                          {fetchResourcesDialog.tiktokAccount.displayName}
                          {fetchResourcesDialog.tiktokAccount.isVerified && ' \u2713'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          @{fetchResourcesDialog.tiktokAccount.username}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {fetchResourcesDialog.tiktokAccount.followerCount?.toLocaleString()} followers •{' '}
                          {fetchResourcesDialog.tiktokAccount.videoCount?.toLocaleString()} videos
                        </Typography>
                      </Box>
                    </Box>
                    <Button variant="outlined" onClick={() => handleAddResource(fetchResourcesDialog.tiktokAccount, 'tiktok_account')}>
                      Add
                    </Button>
                  </Box>
                )}
              </>
            )}

            {/* WordPress Content */}
            {!fetchResourcesDialog.loading && fetchResourcesDialog.provider === 'wordpress' && (
              <>
                {fetchResourcesDialog.wordpressSites.length === 0 && (
                  <Alert severity="info">
                    No WordPress sites found for this account. Make sure you have sites connected to your WordPress.com account.
                  </Alert>
                )}

                {fetchResourcesDialog.wordpressSites.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      WordPress Sites ({fetchResourcesDialog.wordpressSites.length})
                    </Typography>
                    <Stack spacing={1}>
                      {fetchResourcesDialog.wordpressSites.map((site) => (
                        <Box
                          key={site.id}
                          sx={{
                            p: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            {site.icon && <Box component="img" src={site.icon} alt="" sx={{ width: 40, height: 40, borderRadius: 1 }} />}
                            <Box>
                              <Typography variant="body1" fontWeight={500}>
                                {site.name}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {site.url}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {site.isJetpack ? 'Jetpack Connected' : 'WordPress.com'} • {site.plan}
                              </Typography>
                            </Box>
                          </Box>
                          <Button variant="outlined" onClick={() => handleAddResource(site, 'wordpress_site')}>
                            Add
                          </Button>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseFetchResources}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ── Revoke OAuth Connection Confirmation ────────────── */}
      <ConfirmDialog
        open={revokeConnectionConfirm.open}
        onClose={() => setRevokeConnectionConfirm({ open: false, connectionId: null })}
        onConfirm={handleRevokeOAuthConnectionConfirm}
        title="Revoke Connection"
        message="Revoke this connection? This will disconnect it but not delete it."
        confirmLabel="Revoke"
        confirmColor="warning"
      />

      {/* ── Delete OAuth Connection Confirmation ────────────── */}
      <ConfirmDialog
        open={deleteConnectionConfirm.open}
        onClose={() => setDeleteConnectionConfirm({ open: false, connectionId: null })}
        onConfirm={handleDeleteOAuthConnectionConfirm}
        title="Delete Connection"
        message="Delete this connection and all its resources?"
        secondaryText={<Typography variant="body2" color="error" sx={{ mt: 1 }}>This action cannot be undone.</Typography>}
        confirmLabel="Delete"
        confirmColor="error"
      />

      {/* ── Delete OAuth Resource Confirmation ──────────────── */}
      <ConfirmDialog
        open={deleteResourceConfirm.open}
        onClose={() => setDeleteResourceConfirm({ open: false, resourceId: null, connectionId: null })}
        onConfirm={handleDeleteOAuthResourceConfirm}
        title="Delete Resource"
        message="Are you sure you want to delete this resource?"
        confirmLabel="Delete"
        confirmColor="error"
      />
    </>
  );
}
