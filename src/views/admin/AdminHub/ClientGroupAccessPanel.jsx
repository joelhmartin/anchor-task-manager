import { useCallback, useEffect, useMemo, useState } from 'react';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';

import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EmailIcon from '@mui/icons-material/Email';
import SendIcon from '@mui/icons-material/Send';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import DataTable from 'ui-component/extended/DataTable';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { clientLabel } from 'hooks/useClientLabel';
import { getErrorMessage } from 'utils/errors';
import {
  fetchClientGroupTeam,
  sendClientGroupInvite,
  resendClientGroupInvite,
  revokeClientGroupInvite,
  removeClientGroupMember,
  updateClientGroupMemberRole
} from 'api/clientGroups';

const ROLE_LABELS = { admin: 'Admin', member: 'Member' };
const ROLE_COLORS = { admin: 'secondary', member: 'default' };

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(first, last, email) {
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.substring(0, 2).toUpperCase();
  if (email) return email.substring(0, 2).toUpperCase();
  return '??';
}

export default function ClientGroupAccessPanel({ groupId }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [accountCount, setAccountCount] = useState(0);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', role: 'member' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  const [confirm, setConfirm] = useState({ open: false, type: '', target: null });
  const [confirmLoading, setConfirmLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!groupId) return;
    try {
      setLoading(true);
      const data = await fetchClientGroupTeam(groupId);
      setMembers(data.members || []);
      setInvites(data.invites || []);
      setAccountCount(data.accountCount || 0);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [groupId, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenInvite = () => {
    setInviteForm({ email: '', firstName: '', role: 'member' });
    setInviteUrl('');
    setInviteOpen(true);
  };

  const handleSendInvite = async () => {
    if (!inviteForm.email) {
      showToast('Email is required', 'error');
      return;
    }

    try {
      setInviteLoading(true);
      const result = await sendClientGroupInvite(groupId, inviteForm);
      setInviteUrl(result.inviteUrl);
      showToast(result.message || 'Invitation sent', 'success');
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleResend = async (invite) => {
    try {
      const result = await resendClientGroupInvite(groupId, invite.id);
      showToast(result.message || 'Invitation resent', 'success');
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const handleRoleChange = async (member, newRole) => {
    if (newRole === member.role) return;
    try {
      await updateClientGroupMemberRole(groupId, member.id, newRole);
      setMembers((prev) => prev.map((item) => (item.id === member.id ? { ...item, role: newRole } : item)));
      showToast('Role updated', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const handleConfirm = async () => {
    try {
      setConfirmLoading(true);
      if (confirm.type === 'revoke') {
        await revokeClientGroupInvite(groupId, confirm.target.id);
        showToast('Invitation revoked', 'success');
      } else if (confirm.type === 'remove') {
        await removeClientGroupMember(groupId, confirm.target.id);
        showToast('Member removed', 'success');
      }
      setConfirm({ open: false, type: '', target: null });
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setConfirmLoading(false);
    }
  };

  const memberColumns = useMemo(
    () => [
      {
        id: 'member',
        label: 'Member',
        render: (row) => (
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Avatar src={row.avatar_url} sx={{ width: 32, height: 32, fontSize: 13 }}>
              {getInitials(row.first_name, row.last_name, row.email)}
            </Avatar>
            <Box>
              <Typography variant="body2" fontWeight={500}>
                {clientLabel(row) || 'Unnamed'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.email}
              </Typography>
            </Box>
          </Stack>
        )
      },
      {
        id: 'role',
        label: 'Role',
        render: (row) => (
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select value={row.role} onChange={(e) => handleRoleChange(row, e.target.value)} sx={{ '& .MuiSelect-select': { py: 0.5, fontSize: '0.8125rem' } }}>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="member">Member</MenuItem>
            </Select>
          </FormControl>
        )
      },
      {
        id: 'accepted_at',
        label: 'Joined',
        render: (row) => (
          <Typography variant="body2" color="text.secondary">
            {formatDate(row.accepted_at)}
          </Typography>
        )
      },
      {
        id: 'actions',
        label: '',
        align: 'right',
        render: (row) => (
          <Tooltip title="Remove member">
            <IconButton size="small" color="error" onClick={() => setConfirm({ open: true, type: 'remove', target: row })}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )
      }
    ],
    [groupId]
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const inviteColumns = useMemo(
    () => [
      {
        id: 'email',
        label: 'Email',
        render: (row) => (
          <Stack direction="row" alignItems="center" spacing={1}>
            <EmailIcon color="action" fontSize="small" />
            <Box>
              <Typography variant="body2">{row.invite_email}</Typography>
              {row.invite_first_name && (
                <Typography variant="caption" color="text.secondary">
                  {row.invite_first_name}
                </Typography>
              )}
            </Box>
          </Stack>
        )
      },
      {
        id: 'role',
        label: 'Role',
        render: (row) => (
          <Chip label={ROLE_LABELS[row.invite_role] || row.invite_role} size="small" variant="outlined" color={ROLE_COLORS[row.invite_role] || 'default'} />
        )
      },
      {
        id: 'expires',
        label: 'Expires',
        render: (row) => (
          <Typography variant="body2" color="text.secondary">
            {formatDate(row.expires_at)}
          </Typography>
        )
      },
      {
        id: 'actions',
        label: '',
        align: 'right',
        render: (row) => (
          <Stack direction="row" spacing={0.25}>
            <Tooltip title="Resend">
              <IconButton size="small" onClick={() => handleResend(row)}>
                <SendIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Revoke">
              <IconButton size="small" color="error" onClick={() => setConfirm({ open: true, type: 'revoke', target: row })}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        )
      }
    ],
    []
  ); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Group Access
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Members here can access all {accountCount} account{accountCount === 1 ? '' : 's'} currently assigned to this group.
          </Typography>
        </Box>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleOpenInvite}>
          Invite
        </Button>
      </Stack>

      <DataTable
        columns={memberColumns}
        rows={members}
        rowKey={(row) => row.rowKey || row.id}
        loading={loading}
        size="small"
        outlined
        emptyTitle="No group members"
        emptyMessage="Invite someone to grant group-wide access."
      />

      {invites.length > 0 && (
        <>
          <Typography variant="subtitle1" fontWeight={600}>
            Pending Invitations ({invites.length})
          </Typography>
          <DataTable columns={inviteColumns} rows={invites} rowKey={(row) => row.id} size="small" outlined emptyTitle="No pending invites" />
        </>
      )}

      <FormDialog
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setInviteUrl('');
        }}
        onSubmit={inviteUrl ? undefined : handleSendInvite}
        title="Invite Group Member"
        loading={inviteLoading}
        submitLabel="Send Invitation"
        submitIcon={<SendIcon />}
        submitDisabled={!inviteForm.email || Boolean(inviteUrl)}
        actions={inviteUrl ? <Button onClick={() => { setInviteOpen(false); setInviteUrl(''); }}>Done</Button> : undefined}
      >
        {!inviteUrl ? (
          <>
            <TextField
              label="Email Address"
              type="email"
              fullWidth
              required
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              placeholder="colleague@example.com"
            />
            <TextField
              label="First Name (optional)"
              fullWidth
              value={inviteForm.firstName}
              onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
            />
            <SelectField label="Role" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
              <MenuItem value="member">
                <Stack>
                  <Typography>Member</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Can access all accounts in this group
                  </Typography>
                </Stack>
              </MenuItem>
              <MenuItem value="admin">
                <Stack>
                  <Typography>Admin</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Can access all accounts in this group and manage direct account teams
                  </Typography>
                </Stack>
              </MenuItem>
            </SelectField>
          </>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="success.main" fontWeight={500}>
              Invitation sent!
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You can also share this link directly:
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField fullWidth value={inviteUrl} size="small" InputProps={{ readOnly: true }} />
              <Tooltip title="Copy link">
                <IconButton onClick={() => { navigator.clipboard.writeText(inviteUrl); showToast('Copied!', 'success'); }}>
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        )}
      </FormDialog>

      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm({ open: false, type: '', target: null })}
        onConfirm={handleConfirm}
        title={confirm.type === 'revoke' ? 'Revoke Invitation' : 'Remove Group Member'}
        message={
          confirm.type === 'revoke'
            ? `Revoke the invitation for ${confirm.target?.invite_email}?`
            : `Remove ${confirm.target?.email} from this group? They will lose inherited access to every account in the group.`
        }
        confirmLabel="Confirm"
        confirmColor="error"
        loading={confirmLoading}
      />
    </Stack>
  );
}
