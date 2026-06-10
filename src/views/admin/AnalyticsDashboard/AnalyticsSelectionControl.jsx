import { useState, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Checkbox from '@mui/material/Checkbox';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Popover from '@mui/material/Popover';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import TuneIcon from '@mui/icons-material/Tune';
import SelectField from 'ui-component/extended/SelectField';
import { clientLabel } from 'hooks/useClientLabel';

// ── Helpers ──────────────────────────────────────────────────────────

function groupLabel(g, memberCount) {
  const count = memberCount !== undefined ? memberCount : g.member_count;
  return `${g.name} (${count})`;
}

// ── Sub-components ───────────────────────────────────────────────────

/** Small platform indicator chip */
function PlatformBadge({ label, color }) {
  return (
    <Box
      sx={{
        px: 0.6,
        py: 0.1,
        fontSize: '0.6rem',
        fontWeight: 600,
        borderRadius: 0.5,
        bgcolor: `${color}.light`,
        color: `${color}.dark`,
        lineHeight: 1.4,
        letterSpacing: 0.2
      }}
    >
      {label}
    </Box>
  );
}

PlatformBadge.propTypes = {
  label: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired
};

/** Searchable checkbox list used by both Group and Custom popovers */
function ClientCheckboxList({ clients, selectedIds, onToggle, search, onSearchChange }) {
  const filtered = useMemo(() => {
    if (!search) return clients;
    const q = search.toLowerCase();
    return clients.filter((c) => clientLabel(c).toLowerCase().includes(q) || c.email?.toLowerCase().includes(q));
  }, [clients, search]);

  return (
    <Box sx={{ width: 360, maxHeight: 400, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search clients..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
        />
      </Box>
      <Divider />
      <List dense sx={{ overflow: 'auto', flex: 1 }}>
        {filtered.length === 0 && (
          <ListItem>
            <ListItemText secondary="No clients match your search" />
          </ListItem>
        )}
        {filtered.map((c) => {
          const checked = selectedIds.has(c.user_id);
          return (
            <ListItem key={c.user_id} button onClick={() => onToggle(c.user_id)} dense>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple size="small" />
              </ListItemIcon>
              <ListItemText
                primary={clientLabel(c)}
                secondary={
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }}>
                    {c.has_ga4 && <PlatformBadge label="GA4" color="success" />}
                    {c.has_meta && <PlatformBadge label="Meta" color="info" />}
                    {c.has_google_ads && <PlatformBadge label="Ads" color="warning" />}
                    {c.has_ctm && <PlatformBadge label="CTM" color="primary" />}
                  </Stack>
                }
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}

ClientCheckboxList.propTypes = {
  clients: PropTypes.array.isRequired,
  selectedIds: PropTypes.instanceOf(Set).isRequired,
  onToggle: PropTypes.func.isRequired,
  search: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired
};

// ── Group Member Popover ─────────────────────────────────────────────

function GroupMemberPopover({ anchorEl, onClose, group, clients, excludedUserIds, onChange }) {
  const [search, setSearch] = useState('');

  const groupMembers = useMemo(() => clients.filter((c) => c.client_group_id === group?.id), [clients, group]);

  const includedSet = useMemo(() => {
    const excluded = new Set(excludedUserIds);
    return new Set(groupMembers.filter((c) => !excluded.has(c.user_id)).map((c) => c.user_id));
  }, [groupMembers, excludedUserIds]);

  const handleToggle = useCallback(
    (userId) => {
      const newExcluded = new Set(excludedUserIds);
      if (newExcluded.has(userId)) {
        newExcluded.delete(userId);
      } else {
        newExcluded.add(userId);
      }
      onChange([...newExcluded]);
    },
    [excludedUserIds, onChange]
  );

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      {group && (
        <Box>
          <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
            <Typography variant="subtitle2">{group.name} members</Typography>
            <Typography variant="caption" color="text.secondary">
              {includedSet.size}/{groupMembers.length} selected
            </Typography>
          </Box>
          <Divider />
          <ClientCheckboxList
            clients={groupMembers}
            selectedIds={includedSet}
            onToggle={handleToggle}
            search={search}
            onSearchChange={setSearch}
          />
        </Box>
      )}
    </Popover>
  );
}

GroupMemberPopover.propTypes = {
  anchorEl: PropTypes.any,
  onClose: PropTypes.func.isRequired,
  group: PropTypes.object,
  clients: PropTypes.array.isRequired,
  excludedUserIds: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired
};

// ── Custom Multi-Select Popover ──────────────────────────────────────

function CustomSelectPopover({ anchorEl, onClose, clients, includedUserIds, onChange }) {
  const [search, setSearch] = useState('');

  // Only clients with at least one tracking platform configured
  const trackedClients = useMemo(() => clients.filter((c) => c.has_ga4 || c.has_meta || c.has_google_ads || c.has_ctm), [clients]);

  const includedSet = useMemo(() => new Set(includedUserIds), [includedUserIds]);

  const handleToggle = useCallback(
    (userId) => {
      const next = new Set(includedUserIds);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      onChange([...next]);
    },
    [includedUserIds, onChange]
  );

  const handleSelectAll = useCallback(() => {
    onChange(trackedClients.map((c) => c.user_id));
  }, [trackedClients, onChange]);

  const handleClear = useCallback(() => {
    onChange([]);
  }, [onChange]);

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      <Box>
        <Stack direction="row" spacing={1} sx={{ px: 2, pt: 1.5, pb: 0.5 }} alignItems="center" justifyContent="space-between">
          <Stack>
            <Typography variant="subtitle2">
              {includedSet.size} of {trackedClients.length} selected
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Showing clients with tracking configured
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <Button size="small" onClick={handleSelectAll}>
              Select All
            </Button>
            <Button size="small" onClick={handleClear}>
              Clear
            </Button>
          </Stack>
        </Stack>
        <Divider />
        <ClientCheckboxList
          clients={trackedClients}
          selectedIds={includedSet}
          onToggle={handleToggle}
          search={search}
          onSearchChange={setSearch}
        />
      </Box>
    </Popover>
  );
}

CustomSelectPopover.propTypes = {
  anchorEl: PropTypes.any,
  onClose: PropTypes.func.isRequired,
  clients: PropTypes.array.isRequired,
  includedUserIds: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired
};

// ── Main Component ───────────────────────────────────────────────────

export default function AnalyticsSelectionControl({ selection, onChange, clients, groups, allowedModes = ['single', 'group', 'custom'] }) {
  const [groupPopoverAnchor, setGroupPopoverAnchor] = useState(null);
  const [customPopoverAnchor, setCustomPopoverAnchor] = useState(null);
  const canUseSingle = allowedModes.includes('single');
  const canUseGroup = allowedModes.includes('group');
  const canUseCustom = allowedModes.includes('custom');

  // ── Mode switching ──

  const handleModeChange = useCallback(
    (_e, newMode) => {
      if (!newMode || newMode === selection.mode) return;

      if (newMode === 'single') {
        onChange({
          mode: 'single',
          userId: clients[0]?.user_id || '',
          groupId: null,
          includedUserIds: [],
          excludedUserIds: []
        });
      } else if (newMode === 'group') {
        onChange({
          mode: 'group',
          userId: null,
          groupId: groups[0]?.id || '',
          includedUserIds: [],
          excludedUserIds: []
        });
      } else if (newMode === 'custom') {
        onChange({
          mode: 'custom',
          userId: null,
          groupId: null,
          includedUserIds: [],
          excludedUserIds: []
        });
      }
    },
    [selection.mode, clients, groups, onChange]
  );

  // ── Single mode handlers ──

  const handleClientChange = useCallback(
    (e) => {
      onChange({ ...selection, userId: e.target.value });
    },
    [selection, onChange]
  );

  // ── Group mode handlers ──

  const selectedGroup = useMemo(() => groups.find((g) => g.id === selection.groupId), [groups, selection.groupId]);

  const groupMemberCount = useMemo(() => {
    if (!selectedGroup) return 0;
    return clients.filter((c) => c.client_group_id === selectedGroup.id).length;
  }, [clients, selectedGroup]);

  const activeGroupMemberCount = useMemo(
    () => groupMemberCount - (selection.excludedUserIds?.length || 0),
    [groupMemberCount, selection.excludedUserIds]
  );

  const handleGroupChange = useCallback(
    (e) => {
      onChange({ ...selection, groupId: e.target.value, excludedUserIds: [] });
    },
    [selection, onChange]
  );

  const handleGroupExclusionsChange = useCallback(
    (newExcluded) => {
      onChange({ ...selection, excludedUserIds: newExcluded });
    },
    [selection, onChange]
  );

  // ── Custom mode handlers ──

  const handleCustomChange = useCallback(
    (newIncluded) => {
      onChange({ ...selection, includedUserIds: newIncluded });
    },
    [selection, onChange]
  );

  // ── Option lists ──

  const clientOptions = useMemo(() => clients.map((c) => ({ value: c.user_id, label: clientLabel(c) })), [clients]);

  const groupOptions = useMemo(
    () =>
      groups.map((g) => ({
        value: g.id,
        label: groupLabel(g)
      })),
    [groups]
  );

  // ── Render ──

  const modeToggleSx = {
    '& .MuiToggleButton-root': {
      fontSize: { xs: '0.95rem', md: '1rem' },
      fontWeight: 600,
      textTransform: 'none',
      letterSpacing: 0.1,
      px: { xs: 2, md: 2.5 },
      py: { xs: 1, md: 1.25 },
      flex: { xs: 1, sm: 'initial' }
    }
  };
  const selectFieldSx = {
    '& .MuiInputBase-root': { fontSize: { xs: '0.95rem', md: '1rem' } },
    '& .MuiInputLabel-root': { fontSize: { xs: '0.95rem', md: '1rem' } }
  };
  const selectionChipSx = {
    height: { xs: 36, md: 40 },
    fontSize: { xs: '0.9rem', md: '0.95rem' },
    fontWeight: 600,
    px: 0.5
  };

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ width: '100%' }}>
      {/* Mode toggle */}
      {allowedModes.length > 1 && (
        <ToggleButtonGroup value={selection.mode} exclusive onChange={handleModeChange} sx={modeToggleSx}>
          {canUseSingle && (
            <ToggleButton value="single">
              <PersonIcon sx={{ fontSize: 20, mr: 0.75 }} />
              Client
            </ToggleButton>
          )}
          {canUseGroup && (
            <ToggleButton value="group">
              <GroupIcon sx={{ fontSize: 20, mr: 0.75 }} />
              Group
            </ToggleButton>
          )}
          {canUseCustom && (
            <ToggleButton value="custom">
              <TuneIcon sx={{ fontSize: 20, mr: 0.75 }} />
              Custom
            </ToggleButton>
          )}
        </ToggleButtonGroup>
      )}

      {/* Single mode — client dropdown */}
      {selection.mode === 'single' && canUseSingle && (
        <SelectField
          label="Client"
          value={selection.userId || ''}
          onChange={handleClientChange}
          options={clientOptions}
          fullWidth={false}
          sx={{ minWidth: { xs: '100%', sm: 320 }, flexGrow: 1, maxWidth: 520, ...selectFieldSx }}
        />
      )}

      {/* Group mode — group dropdown + member chip */}
      {selection.mode === 'group' && canUseGroup && (
        <>
          <SelectField
            label="Group"
            value={selection.groupId || ''}
            onChange={handleGroupChange}
            options={groupOptions}
            fullWidth={false}
            sx={{ minWidth: { xs: '100%', sm: 300 }, flexGrow: 1, maxWidth: 480, ...selectFieldSx }}
          />
          {selectedGroup && (
            <Chip
              icon={<GroupIcon />}
              label={`${selectedGroup.name} (${activeGroupMemberCount}/${groupMemberCount})`}
              onClick={(e) => setGroupPopoverAnchor(e.currentTarget)}
              variant="outlined"
              sx={selectionChipSx}
            />
          )}
          <GroupMemberPopover
            anchorEl={groupPopoverAnchor}
            onClose={() => setGroupPopoverAnchor(null)}
            group={selectedGroup}
            clients={clients}
            excludedUserIds={selection.excludedUserIds || []}
            onChange={handleGroupExclusionsChange}
          />
        </>
      )}

      {/* Custom mode — selection chip + multi-select popover */}
      {selection.mode === 'custom' && canUseCustom && (
        <>
          <Chip
            icon={<TuneIcon />}
            label={`${selection.includedUserIds?.length || 0} clients selected`}
            onClick={(e) => setCustomPopoverAnchor(e.currentTarget)}
            variant="outlined"
            color={selection.includedUserIds?.length > 0 ? 'primary' : 'default'}
            sx={selectionChipSx}
          />
          <CustomSelectPopover
            anchorEl={customPopoverAnchor}
            onClose={() => setCustomPopoverAnchor(null)}
            clients={clients}
            includedUserIds={selection.includedUserIds || []}
            onChange={handleCustomChange}
          />
        </>
      )}
    </Stack>
  );
}

AnalyticsSelectionControl.propTypes = {
  selection: PropTypes.shape({
    mode: PropTypes.oneOf(['single', 'group', 'custom']).isRequired,
    userId: PropTypes.string,
    groupId: PropTypes.string,
    includedUserIds: PropTypes.arrayOf(PropTypes.string),
    excludedUserIds: PropTypes.arrayOf(PropTypes.string)
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  allowedModes: PropTypes.arrayOf(PropTypes.oneOf(['single', 'group', 'custom'])),
  clients: PropTypes.arrayOf(
    PropTypes.shape({
      user_id: PropTypes.string.isRequired,
      client_label: PropTypes.string,
      client_identifier_value: PropTypes.string,
      business_name: PropTypes.string,
      first_name: PropTypes.string,
      last_name: PropTypes.string,
      email: PropTypes.string,
      client_group_id: PropTypes.string,
      has_ga4: PropTypes.bool,
      has_meta: PropTypes.bool,
      has_google_ads: PropTypes.bool,
      has_ctm: PropTypes.bool
    })
  ).isRequired,
  groups: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      color: PropTypes.string,
      icon: PropTypes.string,
      member_count: PropTypes.number
    })
  ).isRequired
};
