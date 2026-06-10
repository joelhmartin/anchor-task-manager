import PropTypes from 'prop-types';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Stack, Typography, Tab, Tabs, Box, Button, Paper } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import EmptyState from 'ui-component/extended/EmptyState';
import DateRangeControls from './DateRangeControls';
import AnalyticsSelectionControl from './AnalyticsSelectionControl';
import OverviewTab from './OverviewTab';
import PaidAdsTab from './PaidAdsTab';
import TrafficTab from './TrafficTab';
import CallsLeadsTab from './CallsLeadsTab';
import SettingsTab from './SettingsTab';
import { fetchSelectionOptions, fetchAnalyticsOverview, fetchGroupOverview } from 'api/analytics';
import { clientLabel } from 'hooks/useClientLabel';
import { useToast } from 'contexts/ToastContext';
import BarChartIcon from '@mui/icons-material/BarChart';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

function ReportsRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/admin/reports', { replace: true });
  }, [navigate]);
  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography>Redirecting to Reports…</Typography>
    </Box>
  );
}

const TABS = [
  { label: 'Overview', key: 'overview' },
  { label: 'Paid Ads', key: 'paid_ads' },
  { label: 'Traffic & Attribution', key: 'traffic' },
  { label: 'Calls & Leads', key: 'calls_leads' },
  { label: 'Reports', key: 'reports' },
  { label: 'Settings', key: 'settings' }
];

const EMPTY_SELECTION = {
  mode: 'single',
  userId: null,
  groupId: null,
  includedUserIds: [],
  excludedUserIds: []
};

function TabPanel({ value, current, children }) {
  if (value !== current) return null;
  return <Box sx={{ pt: 2 }}>{children}</Box>;
}

function getSelectionLabel(selection, clients, groups) {
  if (!selection) return '';
  if (selection.mode === 'group') {
    const group = groups.find((item) => item.id === selection.groupId);
    if (!group) return 'Group view';
    const totalMembers = clients.filter((client) => client.client_group_id === group.id).length;
    const activeMembers = totalMembers - (selection.excludedUserIds?.length || 0);
    return `${group.name} (${activeMembers}/${totalMembers})`;
  }
  if (selection.mode === 'custom') {
    return `Custom (${selection.includedUserIds?.length || 0} clients)`;
  }
  const client = clients.find((item) => item.user_id === selection.userId);
  return client ? clientLabel(client) || 'Client view' : 'Client view';
}

function buildSingleSelection(userId = null) {
  return {
    mode: 'single',
    userId,
    groupId: null,
    includedUserIds: [],
    excludedUserIds: []
  };
}

function buildGroupSelection(groupId = null, excludedUserIds = []) {
  return {
    mode: 'group',
    userId: null,
    groupId,
    includedUserIds: [],
    excludedUserIds
  };
}

function buildCustomSelection(userIds = []) {
  return {
    mode: 'custom',
    userId: null,
    groupId: null,
    includedUserIds: userIds,
    excludedUserIds: []
  };
}

function derivePortalAllowedModes(clients, groups) {
  if (clients.length <= 1) return ['single'];

  const sharedGroupIds = [...new Set(clients.map((client) => client.client_group_id).filter(Boolean))];
  const allClientsShareOneGroup = sharedGroupIds.length === 1 && clients.every((client) => client.client_group_id === sharedGroupIds[0]);

  if (allClientsShareOneGroup && groups.some((group) => group.id === sharedGroupIds[0])) {
    return ['single', 'group'];
  }

  const modes = ['single'];
  if (groups.length > 0) {
    modes.push('group');
  }
  modes.push('custom');
  return modes;
}

function buildPortalInitialSelection(clients, groups) {
  if (clients.length === 0) return { ...EMPTY_SELECTION };
  if (clients.length === 1) return buildSingleSelection(clients[0].user_id);

  const sharedGroupIds = [...new Set(clients.map((client) => client.client_group_id).filter(Boolean))];
  const allClientsShareOneGroup = sharedGroupIds.length === 1 && clients.every((client) => client.client_group_id === sharedGroupIds[0]);

  if (allClientsShareOneGroup && groups.some((group) => group.id === sharedGroupIds[0])) {
    return buildGroupSelection(sharedGroupIds[0]);
  }

  return buildCustomSelection(clients.map((client) => client.user_id));
}

function buildFallbackSelection(allowedModes, clients, groups) {
  if (allowedModes.includes('single') && clients.length > 0) {
    return buildSingleSelection(clients[0].user_id);
  }
  if (allowedModes.includes('group') && groups.length > 0) {
    return buildGroupSelection(groups[0].id);
  }
  if (allowedModes.includes('custom') && clients.length > 0) {
    return buildCustomSelection(clients.map((client) => client.user_id));
  }
  return { ...EMPTY_SELECTION };
}

function normalizeSelection(selection, allowedModes, clients, groups) {
  const nextSelection = selection || EMPTY_SELECTION;
  const allowedClientIds = new Set(clients.map((client) => client.user_id));
  const allowedGroupIds = new Set(groups.map((group) => group.id));

  if (!allowedModes.includes(nextSelection.mode)) {
    return buildFallbackSelection(allowedModes, clients, groups);
  }

  if (nextSelection.mode === 'single') {
    return allowedClientIds.has(nextSelection.userId)
      ? buildSingleSelection(nextSelection.userId)
      : buildFallbackSelection(allowedModes, clients, groups);
  }

  if (nextSelection.mode === 'group') {
    return allowedGroupIds.has(nextSelection.groupId)
      ? buildGroupSelection(nextSelection.groupId, nextSelection.excludedUserIds || [])
      : buildFallbackSelection(allowedModes, clients, groups);
  }

  const includedUserIds = (nextSelection.includedUserIds || []).filter((id) => allowedClientIds.has(id));
  if (includedUserIds.length === 0) {
    return buildFallbackSelection(allowedModes, clients, groups);
  }
  return buildCustomSelection(includedUserIds);
}

export default function AnalyticsDashboard({ scope = 'admin', allowedTabs = null, initialSelection = null, showSelectionControl = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isPortalScope = scope === 'portal';
  const [clients, setClients] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selection, setSelection] = useState({ ...EMPTY_SELECTION });
  const [returnSelection, setReturnSelection] = useState(null);
  const [data, setData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  });
  const [comparisonRange, setComparisonRange] = useState(null);
  const { showToast } = useToast();
  const initializedSelectionRef = useRef(false);
  // When embedded under /portal the outer ClientPortal owns `?tab=`, so route
  // our sub-tab through `?atab=` to avoid clobbering it.
  const TAB_PARAM = isPortalScope ? 'atab' : 'tab';
  const requestedTab = searchParams.get(TAB_PARAM) || 'overview';

  const visibleTabs = useMemo(() => TABS.filter((tabConfig) => !allowedTabs || allowedTabs.includes(tabConfig.key)), [allowedTabs]);

  const tab = useMemo(() => {
    if (visibleTabs.some((tabConfig) => tabConfig.key === requestedTab)) {
      return requestedTab;
    }
    return visibleTabs[0]?.key || 'overview';
  }, [requestedTab, visibleTabs]);

  const selectionModes = useMemo(
    () => (isPortalScope ? derivePortalAllowedModes(clients, groups) : ['single', 'group', 'custom']),
    [clients, groups, isPortalScope]
  );

  const shouldShowSelectionControl = useMemo(() => {
    if (!showSelectionControl) return false;
    if (!isPortalScope) return true;
    return clients.length > 1;
  }, [clients.length, isPortalScope, showSelectionControl]);

  useEffect(() => {
    fetchSelectionOptions()
      .then(({ clients: nextClients, groups: nextGroups }) => {
        setClients(nextClients || []);
        setGroups(nextGroups || []);
      })
      .catch((err) => {
        console.error('[AnalyticsDashboard] selection options error:', err);
        showToast('Failed to load analytics options', 'error');
      })
      .finally(() => setOptionsLoading(false));
  }, [showToast]);

  useEffect(() => {
    const currentTabParam = searchParams.get(TAB_PARAM) || '';
    const desiredTabParam = tab === 'overview' ? '' : tab;
    const shouldClearRunParam = searchParams.has('run');
    if (currentTabParam === desiredTabParam && !shouldClearRunParam) return;
    const next = new URLSearchParams(searchParams);
    if (desiredTabParam) next.set(TAB_PARAM, desiredTabParam);
    else next.delete(TAB_PARAM);
    next.delete('run');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, tab, TAB_PARAM]);

  const handleTabChange = useCallback(
    (_, nextTab) => {
      const next = new URLSearchParams(searchParams);
      if (nextTab && nextTab !== 'overview') next.set(TAB_PARAM, nextTab);
      else next.delete(TAB_PARAM);
      next.delete('run');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, TAB_PARAM]
  );

  useEffect(() => {
    if (optionsLoading || initializedSelectionRef.current) return;

    const nextSelection = isPortalScope
      ? normalizeSelection(initialSelection || buildPortalInitialSelection(clients, groups), selectionModes, clients, groups)
      : normalizeSelection(initialSelection || buildFallbackSelection(selectionModes, clients, groups), selectionModes, clients, groups);

    setSelection(nextSelection);
    initializedSelectionRef.current = true;
  }, [clients, groups, initialSelection, isPortalScope, optionsLoading, selectionModes]);

  const activeUserId = useMemo(() => {
    if (selection.mode === 'single') return selection.userId;
    if (selection.mode === 'group' && selection.groupId) {
      const members = clients.filter((client) => client.client_group_id === selection.groupId);
      const excluded = new Set(selection.excludedUserIds || []);
      const active = members.filter((client) => !excluded.has(client.user_id));
      return active[0]?.user_id || null;
    }
    if (selection.mode === 'custom') return selection.includedUserIds?.[0] || null;
    return null;
  }, [selection, clients]);

  const selectedClientData = useMemo(() => {
    if (!activeUserId) return null;
    return clients.find((client) => client.user_id === activeUserId) || null;
  }, [activeUserId, clients]);

  const hasSelection =
    selection.mode === 'single'
      ? !!selection.userId
      : selection.mode === 'group'
        ? !!selection.groupId
        : (selection.includedUserIds?.length || 0) > 0;
  const hasConfiguredClients = clients.length > 0;

  const selectionPrompt = useMemo(() => {
    if (selection.mode === 'custom') {
      return {
        title: 'Choose clients to compare',
        message: 'Custom mode stays empty until you select one or more clients from the Custom picker.'
      };
    }
    if (selection.mode === 'group') {
      return {
        title: 'Choose a group',
        message:
          groups.length > 0
            ? 'Select a client group to load group analytics.'
            : 'No client groups are configured yet. Use single client mode or create a group first.'
      };
    }
    return {
      title: 'Choose a client',
      message: 'Select a client to load analytics.'
    };
  }, [groups.length, selection.mode]);

  const handleSelectionChange = useCallback(
    (nextSelection, options = {}) => {
      const normalized = normalizeSelection(nextSelection, selectionModes, clients, groups);
      if (options.preserveReturnSelection && selection.mode !== 'single') {
        setReturnSelection(selection);
      } else if (options.clearReturnSelection !== false) {
        setReturnSelection(null);
      }
      setSelection(normalized);
    },
    [clients, groups, selection, selectionModes]
  );

  const returnSelectionLabel = useMemo(() => getSelectionLabel(returnSelection, clients, groups), [returnSelection, clients, groups]);

  const loadData = useCallback(async () => {
    if (!activeUserId && selection.mode === 'single') return;
    if (selection.mode !== 'single' && !hasSelection) return;

    setLoading(true);
    try {
      let current;
      let comparison;

      if (selection.mode === 'single') {
        const requests = [fetchAnalyticsOverview(activeUserId, { start: dateRange.start, end: dateRange.end })];
        if (comparisonRange) {
          requests.push(fetchAnalyticsOverview(activeUserId, { start: comparisonRange.start, end: comparisonRange.end }));
        }
        const results = await Promise.all(requests);
        current = results[0];
        comparison = results.length > 1 ? results[1] : null;
      } else {
        const requests = [fetchGroupOverview(selection, { start: dateRange.start, end: dateRange.end })];
        if (comparisonRange) {
          requests.push(fetchGroupOverview(selection, { start: comparisonRange.start, end: comparisonRange.end }));
        }
        const results = await Promise.all(requests);
        current = results[0];
        comparison = results.length > 1 ? results[1] : null;
      }

      setData(current);
      setComparisonData(comparison);

      if (current.errors?.length) {
        current.errors.forEach((error) => showToast(`${error.scope}: ${error.message}`, 'warning'));
      }
    } catch (err) {
      console.error('[AnalyticsDashboard] load error:', err);
      showToast('Failed to load analytics data', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeUserId, comparisonRange, dateRange, hasSelection, selection, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <MainCard title="Analytics">
      {!hasConfiguredClients && !optionsLoading ? (
        <EmptyState icon={BarChartIcon} title="No clients configured" message="No clients have tracking credentials set up yet." />
      ) : (
        <Stack spacing={2}>
          <Paper sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
            <Stack spacing={2}>
              {shouldShowSelectionControl && (
                <AnalyticsSelectionControl
                  selection={selection}
                  onChange={(nextSelection) => handleSelectionChange(nextSelection)}
                  clients={clients}
                  groups={groups}
                  allowedModes={selectionModes}
                />
              )}
              <Stack spacing={1.5}>
                <DateRangeControls
                  dateRange={dateRange}
                  onDateRangeChange={setDateRange}
                  comparisonRange={comparisonRange}
                  onComparisonChange={setComparisonRange}
                />
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {selection.mode === 'single' && returnSelection && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ArrowBackIcon />}
                      onClick={() => handleSelectionChange(returnSelection, { clearReturnSelection: true })}
                    >
                      Back to {returnSelectionLabel}
                    </Button>
                  )}
                  {selectedClientData && selection.mode === 'single' && (
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                      {selectedClientData.has_ga4 && (
                        <Typography
                          variant="caption"
                          sx={{ bgcolor: 'success.light', color: 'success.dark', px: 1, py: 0.25, borderRadius: 1 }}
                        >
                          GA4
                        </Typography>
                      )}
                      {selectedClientData.has_meta && (
                        <Typography variant="caption" sx={{ bgcolor: 'info.light', color: 'info.dark', px: 1, py: 0.25, borderRadius: 1 }}>
                          Meta Ads
                        </Typography>
                      )}
                      {selectedClientData.has_google_ads && (
                        <Typography
                          variant="caption"
                          sx={{ bgcolor: 'warning.light', color: 'warning.dark', px: 1, py: 0.25, borderRadius: 1 }}
                        >
                          Google Ads
                        </Typography>
                      )}
                    </Stack>
                  )}
                </Stack>
              </Stack>
            </Stack>
          </Paper>

          {!hasSelection ? (
            <EmptyState icon={BarChartIcon} title={selectionPrompt.title} message={selectionPrompt.message} />
          ) : (
            <>
              <Tabs
                value={tab}
                onChange={handleTabChange}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  minHeight: { xs: 48, md: 56 },
                  '& .MuiTab-root': {
                    fontSize: { xs: '0.95rem', md: '1.05rem' },
                    fontWeight: 600,
                    textTransform: 'none',
                    letterSpacing: 0.1,
                    minHeight: { xs: 48, md: 56 },
                    px: { xs: 2, md: 2.5 },
                    minWidth: { xs: 'auto', md: 120 }
                  },
                  '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0' }
                }}
              >
                {visibleTabs.map((tabConfig) => (
                  <Tab key={tabConfig.key} label={tabConfig.label} value={tabConfig.key} />
                ))}
              </Tabs>

              {visibleTabs.some((tabConfig) => tabConfig.key === 'overview') && (
                <TabPanel value="overview" current={tab}>
                  <OverviewTab
                    data={data}
                    comparisonData={comparisonData}
                    loading={loading}
                    userId={activeUserId}
                    activeClient={selectedClientData}
                    dateRange={dateRange}
                    comparisonRange={comparisonRange}
                    selection={selection}
                    onSelectionChange={handleSelectionChange}
                  />
                </TabPanel>
              )}

              {visibleTabs.some((tabConfig) => tabConfig.key === 'paid_ads') && (
                <TabPanel value="paid_ads" current={tab}>
                  <PaidAdsTab
                    userId={activeUserId}
                    dateRange={dateRange}
                    comparisonRange={comparisonRange}
                    selection={selection}
                    onSelectionChange={handleSelectionChange}
                  />
                </TabPanel>
              )}

              {visibleTabs.some((tabConfig) => tabConfig.key === 'traffic') && (
                <TabPanel value="traffic" current={tab}>
                  <TrafficTab
                    userId={activeUserId}
                    dateRange={dateRange}
                    comparisonRange={comparisonRange}
                    selection={selection}
                    onSelectionChange={handleSelectionChange}
                  />
                </TabPanel>
              )}

              {visibleTabs.some((tabConfig) => tabConfig.key === 'calls_leads') && (
                <TabPanel value="calls_leads" current={tab}>
                  <CallsLeadsTab
                    userId={activeUserId}
                    dateRange={dateRange}
                    comparisonRange={comparisonRange}
                    selection={selection}
                    onSelectionChange={handleSelectionChange}
                  />
                </TabPanel>
              )}

              {visibleTabs.some((tabConfig) => tabConfig.key === 'reports') && (
                <TabPanel value="reports" current={tab}>
                  <ReportsRedirect />
                </TabPanel>
              )}

              {visibleTabs.some((tabConfig) => tabConfig.key === 'settings') && (
                <TabPanel value="settings" current={tab}>
                  <SettingsTab userId={selection.mode === 'single' ? activeUserId : null} selection={selection} />
                </TabPanel>
              )}
            </>
          )}
        </Stack>
      )}
    </MainCard>
  );
}

AnalyticsDashboard.propTypes = {
  scope: PropTypes.oneOf(['admin', 'portal']),
  allowedTabs: PropTypes.arrayOf(PropTypes.string),
  initialSelection: PropTypes.shape({
    mode: PropTypes.oneOf(['single', 'group', 'custom']),
    userId: PropTypes.string,
    groupId: PropTypes.string,
    includedUserIds: PropTypes.arrayOf(PropTypes.string),
    excludedUserIds: PropTypes.arrayOf(PropTypes.string)
  }),
  showSelectionControl: PropTypes.bool
};
