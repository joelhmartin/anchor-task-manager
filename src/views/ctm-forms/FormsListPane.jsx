/**
 * FormsListPane — Clients organized by group, click to manage their forms
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Box, Button, Chip, IconButton, InputAdornment, Stack,
  Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import SearchIcon from '@mui/icons-material/Search';
import DescriptionIcon from '@mui/icons-material/Description';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BuildIcon from '@mui/icons-material/Build';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InboxIcon from '@mui/icons-material/Inbox';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import DataTable from 'ui-component/extended/DataTable';
import EmptyState from 'ui-component/extended/EmptyState';
import FormDialog from 'ui-component/extended/FormDialog';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { listCtmFormTemplates, deleteCtmFormTemplate } from 'api/ctmForms';
import { getGroupIcon } from 'views/admin/AdminHub/ClientGroupsManager';
import { clientLabel } from 'hooks/useClientLabel';

export default function FormsListPane({ clients, clientGroups, forms, onNavigate }) {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, target: null });
  const [deleting, setDeleting] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      setTemplatesLoading(true);
      setTemplates(await listCtmFormTemplates());
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
    finally { setTemplatesLoading(false); }
  }, [showToast]);

  const handleDeleteTemplate = async () => {
    if (!deleteConfirm.target) return;
    try {
      setDeleting(true);
      await deleteCtmFormTemplate(deleteConfirm.target.id);
      setTemplates(prev => prev.filter(t => t.id !== deleteConfirm.target.id));
      showToast('Template deleted', 'success');
      setDeleteConfirm({ open: false, target: null });
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
    finally { setDeleting(false); }
  };

  const templateColumns = useMemo(() => [
    { id: 'name', label: 'Name', render: r => <Typography variant="body2" fontWeight={500}>{r.name}</Typography> },
    { id: 'category', label: 'Category', render: r => r.category ? <Chip label={r.category} size="small" variant="outlined" /> : '—' },
    { id: 'fields', label: 'Fields', render: r => r.field_count || 0 },
    { id: 'type', label: 'Type', render: r => r.multi_step ? <Chip label="Multi-step" size="small" /> : <Chip label="Single" size="small" variant="outlined" /> },
    { id: 'actions', label: '', align: 'right', render: r => !r.is_system ? (
      <Tooltip title="Delete template">
        <IconButton size="small" color="error" onClick={() => setDeleteConfirm({ open: true, target: r })}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    ) : null }
  ], []);
  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = { '__ungrouped__': true };
    for (const g of clientGroups) initial[g.id] = true;
    return initial;
  });

  // Build form count map by client
  const formCountMap = useMemo(() => {
    const map = {};
    for (const f of forms) {
      if (f.org_id) map[f.org_id] = (map[f.org_id] || 0) + 1;
    }
    return map;
  }, [forms]);

  // Filter clients by search
  const filteredClients = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(c => {
      const name = clientLabel(c).toLowerCase();
      const email = (c.email || '').toLowerCase();
      const display = (c.display_name || '').toLowerCase();
      return name.includes(q) || email.includes(q) || display.includes(q);
    });
  }, [clients, search]);

  // Group clients
  const { groupedClients, ungroupedClients } = useMemo(() => {
    const grouped = {};
    const ungrouped = [];
    filteredClients.forEach(client => {
      if (client.client_group_id) {
        if (!grouped[client.client_group_id]) grouped[client.client_group_id] = [];
        grouped[client.client_group_id].push(client);
      } else {
        ungrouped.push(client);
      }
    });
    return { groupedClients: grouped, ungroupedClients: ungrouped };
  }, [filteredClients]);

  const handleToggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const getClientDisplayName = (client) =>
    client.display_name || clientLabel(client) || 'Unnamed';

  const handleClientClick = (client) => {
    onNavigate('client', { clientId: client.id });
  };

  const renderClientRow = (client) => {
    const count = formCountMap[client.id] || 0;
    return (
      <TableRow key={client.id} hover sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
        <TableCell>
          <Typography variant="body2" fontWeight={500}>{getClientDisplayName(client)}</Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary">{client.email || '—'}</Typography>
        </TableCell>
        <TableCell>
          <Chip
            label={`${count} form${count !== 1 ? 's' : ''}`}
            size="small"
            variant={count > 0 ? 'filled' : 'outlined'}
            color={count > 0 ? 'primary' : 'default'}
            sx={{ minWidth: 70 }}
          />
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            <Tooltip title="Build Forms">
              <Button size="small" variant="outlined" startIcon={<BuildIcon />} onClick={() => handleClientClick(client)} sx={{ textTransform: 'none', fontSize: 12 }}>
                Forms
              </Button>
            </Tooltip>
            {count > 0 && (
              <Tooltip title="View Submissions">
                <Button size="small" variant="outlined" startIcon={<InboxIcon />} onClick={() => onNavigate('submissions', { clientId: client.id })} sx={{ textTransform: 'none', fontSize: 12 }}>
                  Submissions
                </Button>
              </Tooltip>
            )}
          </Stack>
        </TableCell>
      </TableRow>
    );
  };

  const renderGroupSection = (groupId, groupName, groupClients, options = {}) => {
    const { icon, color, iconUrl } = options;
    const isExpanded = expandedGroups[groupId] !== false;

    return (
      <Box
        key={groupId}
        sx={{
          border: '2px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden'
        }}
      >
        {/* Group Header */}
        <Box
          onClick={() => handleToggleGroup(groupId)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 1,
            bgcolor: groupId === '__ungrouped__' ? 'grey.50' : 'grey.100',
            cursor: 'pointer',
            '&:hover': { bgcolor: groupId === '__ungrouped__' ? 'grey.100' : 'grey.200' }
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
          {iconUrl ? (
            <Box component="img" src={iconUrl} alt="" sx={{ width: 18, height: 18, borderRadius: 0.5, objectFit: 'cover', flexShrink: 0 }} />
          ) : (() => {
            const GroupIcon = icon ? getGroupIcon(icon) : null;
            if (GroupIcon) return <GroupIcon fontSize="small" sx={{ color: color || 'action.active' }} />;
            if (color) return <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />;
            return <FolderIcon fontSize="small" sx={{ color: 'action.disabled' }} />;
          })()}
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 600, flex: 1, color: groupId === '__ungrouped__' ? 'text.secondary' : 'text.primary' }}
          >
            {groupName}
          </Typography>
          <Chip label={groupClients.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} variant={groupId === '__ungrouped__' ? 'outlined' : 'filled'} />
        </Box>

        {/* Clients Table */}
        {isExpanded && groupClients.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Client</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Forms</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groupClients.map(renderClientRow)}
            </TableBody>
          </Table>
        )}
        {isExpanded && groupClients.length === 0 && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="body2" color="text.secondary">No clients match your search.</Typography>
          </Box>
        )}
      </Box>
    );
  };

  if (clients.length === 0) {
    return <EmptyState title="No clients" message="No clients found. Add clients in the Admin Hub first." />;
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">Forms by Client</Typography>
        <Button variant="outlined" size="small" startIcon={<BookmarkIcon />} onClick={() => { loadTemplates(); setTemplatesOpen(true); }}>
          Templates
        </Button>
      </Stack>

      <TextField
        placeholder="Search clients..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        size="small"
        sx={{ maxWidth: 400 }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>
        }}
      />

      <Stack spacing={1.5}>
        {clientGroups.map(group => {
          const groupClients = groupedClients[group.id] || [];
          // Hide empty groups when searching
          if (search.trim() && groupClients.length === 0) return null;
          return renderGroupSection(group.id, group.name, groupClients, {
            icon: group.icon,
            color: group.color,
            iconUrl: group.icon_url
          });
        })}

        {/* Ungrouped clients */}
        {(ungroupedClients.length > 0 || !search.trim()) &&
          renderGroupSection('__ungrouped__', 'Ungrouped', ungroupedClients)
        }
      </Stack>

      {filteredClients.length === 0 && search.trim() && (
        <EmptyState
          title="No results"
          message={`No clients match "${search}".`}
          icon={DescriptionIcon}
        />
      )}

      {/* Templates Dialog */}
      <FormDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        title="Form Templates"
        maxWidth="md"
        actions={<Button onClick={() => setTemplatesOpen(false)}>Close</Button>}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Templates are reusable form configurations. Save any form as a template, then use it when creating forms for other clients.
        </Typography>
        <DataTable
          columns={templateColumns}
          rows={templates}
          loading={templatesLoading}
          size="small"
          outlined
          emptyTitle="No templates yet"
          emptyMessage="Save a form as a template from any client's form list."
        />
      </FormDialog>

      <ConfirmDialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, target: null })}
        onConfirm={handleDeleteTemplate}
        title="Delete Template"
        message={`Delete "${deleteConfirm.target?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
      />
    </Stack>
  );
}
