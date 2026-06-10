# Analytics Group Selection — Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selection resolver service, a selection-options endpoint with group metadata, and a shared AnalyticsSelectionControl component that replaces the single-client dropdown in the dashboard header. Backward compatible — starts in single mode by default.

**Architecture:** Backend gets a `resolveAnalyticsSelection(selection)` function and a `/analytics/selection-options` endpoint. Frontend gets an `AnalyticsSelectionControl` component with three modes (Single/Group/Custom). The dashboard shell's `selectedClient` state is replaced with a `selection` object, but single-mode behavior is identical to today.

**Tech Stack:** Express.js, PostgreSQL, React, MUI v5

**Spec:** `docs/superpowers/specs/2026-04-17-analytics-group-selection-design.md`

**No test suite.** Verify via `yarn build` + visual check.

---

### Task 1: Build selection resolver service

**Files:**
- Create: `server/services/analytics/selectionResolver.js`

- [ ] **Step 1: Create the resolver**

```javascript
import { query } from '../../db.js';

/**
 * Resolve an analytics selection object into a list of user IDs + metadata.
 *
 * Selection object shape:
 *   { mode: 'single'|'group'|'custom', userId, groupId, includedUserIds, excludedUserIds }
 *
 * @param {object} selection
 * @returns {{ userIds: string[], label: string, clients: object[], coverage: object }}
 */
export async function resolveAnalyticsSelection(selection) {
  const { mode } = selection;
  let userIds = [];
  let label = '';

  if (mode === 'single') {
    if (!selection.userId) throw new Error('selection.userId required for single mode');
    userIds = [selection.userId];
    const nameRes = await query('SELECT first_name, last_name FROM users WHERE id = $1', [selection.userId]);
    const u = nameRes.rows[0];
    label = u ? `${u.first_name} ${u.last_name}`.trim() : 'Unknown Client';

  } else if (mode === 'group') {
    if (!selection.groupId) throw new Error('selection.groupId required for group mode');
    // Get group name
    const groupRes = await query('SELECT name FROM client_groups WHERE id = $1', [selection.groupId]);
    const groupName = groupRes.rows[0]?.name || 'Unknown Group';
    // Get all members
    const membersRes = await query(
      'SELECT user_id FROM client_profiles WHERE client_group_id = $1',
      [selection.groupId]
    );
    const allMembers = membersRes.rows.map((r) => r.user_id);
    const excluded = new Set(selection.excludedUserIds || []);
    userIds = allMembers.filter((id) => !excluded.has(id));
    const excludedCount = allMembers.length - userIds.length;
    label = excludedCount > 0
      ? `${groupName} (${userIds.length} of ${allMembers.length})`
      : `${groupName} (${userIds.length})`;

  } else if (mode === 'custom') {
    userIds = selection.includedUserIds || [];
    label = `Custom (${userIds.length} client${userIds.length !== 1 ? 's' : ''})`;

  } else {
    throw new Error(`Invalid selection mode: ${mode}`);
  }

  if (userIds.length === 0) {
    return { userIds: [], label, clients: [], coverage: { total: 0, withGA4: 0, withMeta: 0, withGoogleAds: 0, withCTM: 0 } };
  }

  // Fetch client metadata + platform coverage for all resolved users
  const clientsRes = await query(`
    SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
           tc.ga4_property_id IS NOT NULL AS has_ga4,
           tc.meta_ad_account_id IS NOT NULL AS has_meta,
           tc.google_ads_customer_id IS NOT NULL AS has_google_ads,
           cp.ctm_account_number IS NOT NULL AS has_ctm
    FROM users u
    LEFT JOIN tracking_configs tc ON tc.user_id = u.id
    LEFT JOIN client_profiles cp ON cp.user_id = u.id
    WHERE u.id = ANY($1)
    ORDER BY u.first_name, u.last_name
  `, [userIds]);

  const clients = clientsRes.rows;

  const coverage = {
    total: clients.length,
    withGA4: clients.filter((c) => c.has_ga4).length,
    withMeta: clients.filter((c) => c.has_meta).length,
    withGoogleAds: clients.filter((c) => c.has_google_ads).length,
    withCTM: clients.filter((c) => c.has_ctm).length
  };

  return { userIds, label, clients, coverage };
}
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add server/services/analytics/selectionResolver.js
git commit -m "feat: Add analytics selection resolver for single/group/custom modes"
```

---

### Task 2: Add selection-options endpoint

**Files:**
- Modify: `server/routes/analytics.js`

- [ ] **Step 1: Add the endpoint**

Add this endpoint BEFORE the `/:userId/...` routes in `server/routes/analytics.js`. Read the file first to find the right insertion point (after the `/reports/...` routes, before `/:userId/connections`).

```javascript
// GET /selection-options — clients + groups for the analytics selector
router.get('/selection-options', async (req, res) => {
  try {
    // Fetch all clients with platform coverage
    const clientsRes = await query(`
      SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
             cp.client_group_id,
             tc.ga4_property_id IS NOT NULL AS has_ga4,
             tc.meta_ad_account_id IS NOT NULL AS has_meta,
             tc.google_ads_customer_id IS NOT NULL AS has_google_ads,
             cp.ctm_account_number IS NOT NULL AS has_ctm
      FROM users u
      LEFT JOIN client_profiles cp ON cp.user_id = u.id
      LEFT JOIN tracking_configs tc ON tc.user_id = u.id
      WHERE u.role IN ('client', 'admin')
        AND (tc.user_id IS NOT NULL OR cp.ctm_account_number IS NOT NULL)
      ORDER BY u.first_name, u.last_name
    `);

    // Fetch all groups with member counts
    const groupsRes = await query(`
      SELECT cg.id, cg.name, cg.color, cg.icon,
        (SELECT COUNT(*) FROM client_profiles WHERE client_group_id = cg.id)::int AS member_count
      FROM client_groups cg
      ORDER BY cg.name
    `);

    res.json({
      clients: clientsRes.rows,
      groups: groupsRes.rows
    });
  } catch (err) {
    console.error('[analytics] selection-options error:', err);
    res.status(500).json({ message: 'Failed to fetch selection options' });
  }
});
```

- [ ] **Step 2: Add the frontend API function**

Append to `src/api/analytics.js`:

```javascript
// Selection options (clients + groups for the selector)
export const fetchSelectionOptions = () =>
  client.get('/analytics/selection-options').then((r) => r.data);
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add server/routes/analytics.js src/api/analytics.js
git commit -m "feat: Add /analytics/selection-options endpoint with client groups"
```

---

### Task 3: Build AnalyticsSelectionControl component

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/AnalyticsSelectionControl.jsx`

- [ ] **Step 1: Create the component**

This component handles three selection modes. It receives the full clients + groups lists as props and emits a selection object.

```jsx
import { useState, useMemo } from 'react';
import {
  Stack, ToggleButton, ToggleButtonGroup, Typography, Chip,
  Checkbox, List, ListItem, ListItemText, ListItemIcon,
  Popover, Button, Box, Divider, TextField, InputAdornment
} from '@mui/material';
import SelectField from 'ui-component/extended/SelectField';
import SearchIcon from '@mui/icons-material/Search';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import TuneIcon from '@mui/icons-material/Tune';

export default function AnalyticsSelectionControl({ selection, onChange, clients, groups, compact = true }) {
  const [memberAnchor, setMemberAnchor] = useState(null);
  const [searchText, setSearchText] = useState('');

  const mode = selection.mode || 'single';

  // Resolve current selection label
  const selectionLabel = useMemo(() => {
    if (mode === 'single') {
      const c = clients.find((cl) => cl.user_id === selection.userId);
      return c ? `${c.first_name} ${c.last_name}`.trim() : 'Select client';
    }
    if (mode === 'group') {
      const g = groups.find((gr) => gr.id === selection.groupId);
      const excluded = selection.excludedUserIds?.length || 0;
      const total = g?.member_count || 0;
      return g ? `${g.name} (${total - excluded}/${total})` : 'Select group';
    }
    if (mode === 'custom') {
      const count = selection.includedUserIds?.length || 0;
      return `${count} client${count !== 1 ? 's' : ''} selected`;
    }
    return 'Select';
  }, [mode, selection, clients, groups]);

  // Group members (for group mode member list)
  const groupMembers = useMemo(() => {
    if (mode !== 'group' || !selection.groupId) return [];
    return clients.filter((c) => c.client_group_id === selection.groupId);
  }, [mode, selection.groupId, clients]);

  // Filtered client list for custom mode / group member popover
  const filteredClients = useMemo(() => {
    const list = mode === 'group' ? groupMembers : clients;
    if (!searchText) return list;
    const lower = searchText.toLowerCase();
    return list.filter((c) =>
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(lower) ||
      c.email?.toLowerCase().includes(lower)
    );
  }, [mode, groupMembers, clients, searchText]);

  const handleModeChange = (_, newMode) => {
    if (!newMode) return;
    if (newMode === 'single') {
      onChange({ mode: 'single', userId: clients[0]?.user_id || null, groupId: null, includedUserIds: [], excludedUserIds: [] });
    } else if (newMode === 'group') {
      onChange({ mode: 'group', userId: null, groupId: groups[0]?.id || null, includedUserIds: [], excludedUserIds: [] });
    } else if (newMode === 'custom') {
      onChange({ mode: 'custom', userId: null, groupId: null, includedUserIds: [], excludedUserIds: [] });
    }
  };

  const handleSingleChange = (e) => {
    onChange({ ...selection, userId: e.target.value });
  };

  const handleGroupChange = (e) => {
    onChange({ ...selection, groupId: e.target.value, excludedUserIds: [] });
  };

  const toggleExcluded = (userId) => {
    const excluded = new Set(selection.excludedUserIds || []);
    if (excluded.has(userId)) {
      excluded.delete(userId);
    } else {
      excluded.add(userId);
    }
    onChange({ ...selection, excludedUserIds: [...excluded] });
  };

  const toggleIncluded = (userId) => {
    const included = new Set(selection.includedUserIds || []);
    if (included.has(userId)) {
      included.delete(userId);
    } else {
      included.add(userId);
    }
    onChange({ ...selection, includedUserIds: [...included] });
  };

  const clientOptions = clients.map((c) => ({ value: c.user_id, label: `${c.first_name} ${c.last_name}`.trim() }));
  const groupOptions = groups.map((g) => ({ value: g.id, label: `${g.name} (${g.member_count})` }));

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
      {/* Mode toggle */}
      <ToggleButtonGroup value={mode} exclusive onChange={handleModeChange} size="small">
        <ToggleButton value="single"><PersonIcon sx={{ fontSize: 16, mr: 0.5 }} />Client</ToggleButton>
        <ToggleButton value="group"><GroupIcon sx={{ fontSize: 16, mr: 0.5 }} />Group</ToggleButton>
        <ToggleButton value="custom"><TuneIcon sx={{ fontSize: 16, mr: 0.5 }} />Custom</ToggleButton>
      </ToggleButtonGroup>

      {/* Single mode: client dropdown */}
      {mode === 'single' && (
        <SelectField
          value={selection.userId || ''}
          onChange={handleSingleChange}
          options={clientOptions}
          size="small"
          fullWidth={false}
          sx={{ minWidth: 200 }}
        />
      )}

      {/* Group mode: group dropdown + member count chip */}
      {mode === 'group' && (
        <>
          <SelectField
            value={selection.groupId || ''}
            onChange={handleGroupChange}
            options={groupOptions}
            size="small"
            fullWidth={false}
            sx={{ minWidth: 180 }}
          />
          <Chip
            label={selectionLabel}
            size="small"
            onClick={(e) => setMemberAnchor(e.currentTarget)}
            onDelete={groupMembers.length > 0 ? () => setMemberAnchor(memberAnchor ? null : document.body) : undefined}
            deleteIcon={<Typography variant="caption">edit</Typography>}
            variant="outlined"
            sx={{ cursor: 'pointer' }}
          />
          <Popover
            open={Boolean(memberAnchor)}
            anchorEl={memberAnchor}
            onClose={() => { setMemberAnchor(null); setSearchText(''); }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <Box sx={{ p: 1, width: 300 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search members..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                sx={{ mb: 1 }}
              />
              <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                {filteredClients.map((c) => {
                  const excluded = (selection.excludedUserIds || []).includes(c.user_id);
                  return (
                    <ListItem key={c.user_id} disablePadding sx={{ px: 1 }} onClick={() => toggleExcluded(c.user_id)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderRadius: 1, px: 1, py: 0.25 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <Checkbox size="small" checked={!excluded} edge="start" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${c.first_name} ${c.last_name}`}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondary={excluded ? 'Excluded' : null}
                        secondaryTypographyProps={{ variant: 'caption', color: 'error' }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </Box>
          </Popover>
        </>
      )}

      {/* Custom mode: multi-select with count */}
      {mode === 'custom' && (
        <>
          <Chip
            label={selectionLabel}
            size="small"
            onClick={(e) => setMemberAnchor(e.currentTarget)}
            variant="outlined"
            color={selection.includedUserIds?.length > 0 ? 'primary' : 'default'}
            sx={{ cursor: 'pointer' }}
          />
          <Popover
            open={Boolean(memberAnchor)}
            anchorEl={memberAnchor}
            onClose={() => { setMemberAnchor(null); setSearchText(''); }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <Box sx={{ p: 1, width: 300 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search clients..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                />
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ mb: 1 }}>
                <Button size="small" onClick={() => onChange({ ...selection, includedUserIds: clients.map((c) => c.user_id) })}>
                  Select All
                </Button>
                <Button size="small" onClick={() => onChange({ ...selection, includedUserIds: [] })}>
                  Clear
                </Button>
              </Stack>
              <Divider sx={{ mb: 0.5 }} />
              <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                {filteredClients.map((c) => {
                  const included = (selection.includedUserIds || []).includes(c.user_id);
                  return (
                    <ListItem key={c.user_id} disablePadding onClick={() => toggleIncluded(c.user_id)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderRadius: 1, px: 1, py: 0.25 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <Checkbox size="small" checked={included} edge="start" />
                      </ListItemIcon>
                      <ListItemText primary={`${c.first_name} ${c.last_name}`} primaryTypographyProps={{ variant: 'body2' }} />
                    </ListItem>
                  );
                })}
              </List>
            </Box>
          </Popover>
        </>
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/AnalyticsSelectionControl.jsx
git commit -m "feat: Add AnalyticsSelectionControl with single/group/custom modes"
```

---

### Task 4: Wire selection control into dashboard shell

**Files:**
- Modify: `src/views/admin/AnalyticsDashboard/index.jsx`
- Modify: `src/api/analytics.js`

- [ ] **Step 1: Update index.jsx to use selection state**

Replace the current `selectedClient` + `clients` approach with `selection` + `selectionOptions`. The key changes:

1. Replace `selectedClient` state with `selection` state
2. Load `selectionOptions` (clients + groups) on mount instead of just clients
3. Replace the `SelectField` in the header with `AnalyticsSelectionControl`
4. Derive `userId` from `selection` for single-mode tabs (backward compatible)
5. Pass `selection` + `clients` to tabs that need it

```jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Stack, Typography, Tab, Tabs, Box } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import EmptyState from 'ui-component/extended/EmptyState';
import DateRangeControls from './DateRangeControls';
import AnalyticsSelectionControl from './AnalyticsSelectionControl';
import OverviewTab from './OverviewTab';
import PaidAdsTab from './PaidAdsTab';
import TrafficTab from './TrafficTab';
import CallsLeadsTab from './CallsLeadsTab';
import SettingsTab from './SettingsTab';
import ReportsTab from './ReportsTab';
import { fetchSelectionOptions, fetchAnalyticsOverview } from 'api/analytics';
import { useToast } from 'contexts/ToastContext';
import BarChartIcon from '@mui/icons-material/BarChart';

const TABS = [
  { label: 'Overview', key: 'overview' },
  { label: 'Paid Ads', key: 'paid_ads' },
  { label: 'Traffic & Attribution', key: 'traffic' },
  { label: 'Calls & Leads', key: 'calls_leads' },
  { label: 'Reports', key: 'reports' },
  { label: 'Settings', key: 'settings' }
];

function TabPanel({ value, current, children }) {
  if (value !== current) return null;
  return <Box sx={{ pt: 2 }}>{children}</Box>;
}

export default function AnalyticsDashboard() {
  const [clients, setClients] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selection, setSelection] = useState({ mode: 'single', userId: null, groupId: null, includedUserIds: [], excludedUserIds: [] });
  const [data, setData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  });
  const [comparisonRange, setComparisonRange] = useState(null);
  const { showToast } = useToast();

  // Load selection options (clients + groups) on mount
  useEffect(() => {
    fetchSelectionOptions()
      .then(({ clients: c, groups: g }) => {
        setClients(c || []);
        setGroups(g || []);
        if (c?.length > 0) {
          setSelection({ mode: 'single', userId: c[0].user_id, groupId: null, includedUserIds: [], excludedUserIds: [] });
        }
      })
      .catch((err) => {
        console.error('[AnalyticsDashboard] selection options error:', err);
        showToast('Failed to load analytics clients', 'error');
      })
      .finally(() => setOptionsLoading(false));
  }, [showToast]);

  // Derive the active userId for single-mode (backward compatible for all tabs)
  const activeUserId = useMemo(() => {
    if (selection.mode === 'single') return selection.userId;
    // For group/custom: tabs still need a single userId for now (Phase 2 adds group aggregation)
    // Use the first included user as a fallback
    if (selection.mode === 'group') {
      const members = clients.filter((c) => c.client_group_id === selection.groupId);
      const excluded = new Set(selection.excludedUserIds || []);
      const active = members.filter((c) => !excluded.has(c.user_id));
      return active[0]?.user_id || null;
    }
    if (selection.mode === 'custom') {
      return selection.includedUserIds?.[0] || null;
    }
    return null;
  }, [selection, clients]);

  // Derive platform coverage badges
  const selectedClientData = useMemo(() => {
    if (!activeUserId) return null;
    return clients.find((c) => c.user_id === activeUserId) || null;
  }, [activeUserId, clients]);

  // Load data when selection or date range changes
  const loadData = useCallback(async () => {
    if (!activeUserId) return;
    setLoading(true);
    try {
      const requests = [fetchAnalyticsOverview(activeUserId, { start: dateRange.start, end: dateRange.end })];
      if (comparisonRange) {
        requests.push(fetchAnalyticsOverview(activeUserId, { start: comparisonRange.start, end: comparisonRange.end }));
      }
      const results = await Promise.all(requests);
      const current = results[0];
      const comparison = results.length > 1 ? results[1] : null;
      setData(current);
      setComparisonData(comparison);

      if (current.errors?.length) {
        current.errors.forEach((e) => showToast(`${e.scope}: ${e.message}`, 'warning'));
      }
    } catch (err) {
      console.error('[AnalyticsDashboard] load error:', err);
      showToast('Failed to load analytics data', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeUserId, dateRange, comparisonRange, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const hasSelection = selection.mode === 'single' ? !!selection.userId
    : selection.mode === 'group' ? !!selection.groupId
    : (selection.includedUserIds?.length || 0) > 0;

  return (
    <MainCard title="Analytics">
      {!hasSelection && !optionsLoading ? (
        <EmptyState
          icon={BarChartIcon}
          title="No clients configured"
          message="No clients have tracking credentials set up yet. Add tracking configs to see analytics."
        />
      ) : (
        <Stack spacing={2}>
          {/* Selection control + date controls */}
          <Stack spacing={1.5}>
            <AnalyticsSelectionControl
              selection={selection}
              onChange={setSelection}
              clients={clients}
              groups={groups}
            />
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
              <DateRangeControls
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                comparisonRange={comparisonRange}
                onComparisonChange={setComparisonRange}
              />
              {selectedClientData && selection.mode === 'single' && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {selectedClientData.has_ga4 && (
                    <Typography variant="caption" sx={{ bgcolor: 'success.light', color: 'success.dark', px: 1, py: 0.25, borderRadius: 1 }}>GA4</Typography>
                  )}
                  {selectedClientData.has_meta && (
                    <Typography variant="caption" sx={{ bgcolor: 'info.light', color: 'info.dark', px: 1, py: 0.25, borderRadius: 1 }}>Meta Ads</Typography>
                  )}
                  {selectedClientData.has_google_ads && (
                    <Typography variant="caption" sx={{ bgcolor: 'warning.light', color: 'warning.dark', px: 1, py: 0.25, borderRadius: 1 }}>Google Ads</Typography>
                  )}
                </Stack>
              )}
            </Stack>
          </Stack>

          {/* Tabs */}
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            {TABS.map((t) => (
              <Tab key={t.key} label={t.label} value={t.key} />
            ))}
          </Tabs>

          {/* Tab panels — all receive activeUserId for backward compatibility */}
          <TabPanel value="overview" current={tab}>
            <OverviewTab data={data} comparisonData={comparisonData} loading={loading} userId={activeUserId} dateRange={dateRange} comparisonRange={comparisonRange} />
          </TabPanel>

          <TabPanel value="paid_ads" current={tab}>
            <PaidAdsTab userId={activeUserId} dateRange={dateRange} comparisonRange={comparisonRange} />
          </TabPanel>

          <TabPanel value="traffic" current={tab}>
            <TrafficTab userId={activeUserId} dateRange={dateRange} comparisonRange={comparisonRange} />
          </TabPanel>

          <TabPanel value="calls_leads" current={tab}>
            <CallsLeadsTab userId={activeUserId} dateRange={dateRange} comparisonRange={comparisonRange} />
          </TabPanel>

          <TabPanel value="reports" current={tab}>
            <ReportsTab userId={activeUserId} clients={clients} />
          </TabPanel>

          <TabPanel value="settings" current={tab}>
            <SettingsTab userId={activeUserId} />
          </TabPanel>
        </Stack>
      )}
    </MainCard>
  );
}
```

- [ ] **Step 2: Verify build + visual check**

Run: `yarn build`
Expected: Build succeeds.

Start servers and verify:
- Mode toggle shows Client / Group / Custom
- Client mode: dropdown works same as before, all tabs load data
- Group mode: group dropdown shows groups, member chip shows count, clicking chip opens member popover with checkboxes
- Custom mode: clicking chip opens multi-select client list with search, select all, clear
- Switching modes changes selection, triggers data reload
- Platform badges still show for single-client mode

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/index.jsx src/api/analytics.js
git commit -m "feat: Replace single-client selector with AnalyticsSelectionControl in dashboard"
```
