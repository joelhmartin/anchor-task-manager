/**
 * TeamManagement - Client Team Management Component
 *
 * Allows clients to invite additional users to manage their account.
 * Features:
 * - View team members
 * - Send invitations
 * - Manage pending invites (resend/revoke)
 * - Remove team members
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import DataTable from 'ui-component/extended/DataTable';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import { clientLabel } from 'hooks/useClientLabel';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
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
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EmailIcon from '@mui/icons-material/Email';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';

import {
  fetchTeamMembers,
  fetchPendingInvites,
  sendInvite,
  resendInvite,
  revokeInvite,
  removeMember,
  leaveTeam
} from 'api/clientTeam';

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member'
};

const ROLE_COLORS = {
  owner: 'primary',
  admin: 'secondary',
  member: 'default'
};

const ROLE_DESCRIPTIONS = {
  member: 'Can view and edit all account data',
  admin: 'Can invite new users and remove members'
};

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(firstName, lastName, email) {
  if (firstName && lastName) {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  }
  if (firstName) {
    return firstName.substring(0, 2).toUpperCase();
  }
  if (email) {
    return email.substring(0, 2).toUpperCase();
  }
  return '??';
}

export default function TeamManagement() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Team data
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [businessName, setBusinessName] = useState('');
  const [userRole, setUserRole] = useState(null);
  const [canInvite, setCanInvite] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canLeave, setCanLeave] = useState(false);

  // Invite dialog
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', role: 'member' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState({ open: false, type: '', target: null });
  const [confirmLoading, setConfirmLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamData, invitesData] = await Promise.all([
        fetchTeamMembers(),
        fetchPendingInvites().catch(() => ({ invites: [] })) // May fail if user can't view invites
      ]);

      setMembers(teamData.members || []);
      setBusinessName(teamData.businessName || '');
      setUserRole(teamData.userRole);
      setCanInvite(teamData.canInvite);
      setCanManage(teamData.canManage);
      setCanLeave(Boolean(teamData.canLeave));
      setInvites(invitesData.invites || []);
    } catch (err) {
      console.error('[TeamManagement] Load error:', err);
      setError(err.response?.data?.message || 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenInviteDialog = () => {
    setInviteForm({ email: '', firstName: '', role: 'member' });
    setInviteError('');
    setInviteUrl('');
    setInviteDialogOpen(true);
  };

  const handleCloseInviteDialog = () => {
    setInviteDialogOpen(false);
    setInviteUrl('');
  };

  const handleSendInvite = async () => {
    if (!inviteForm.email) {
      setInviteError('Email is required');
      return;
    }

    setInviteLoading(true);
    setInviteError('');
    try {
      const result = await sendInvite(inviteForm);
      setInviteUrl(result.inviteUrl);
      setMessage({ type: 'success', text: result.message || 'Invitation sent' });
      loadData(); // Refresh to show new invite
    } catch (err) {
      setInviteError(err.response?.data?.message || 'Failed to send invitation');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInviteUrl = async () => {
    if (inviteUrl) {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage({ type: 'success', text: 'Invite link copied to clipboard' });
    }
  };

  const handleResendInvite = async (invite) => {
    try {
      const result = await resendInvite(invite.id);
      setMessage({ type: 'success', text: result.message || 'Invitation resent' });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to resend invitation' });
    }
  };

  const handleRevokeInvite = (invite) => {
    setConfirmDialog({ open: true, type: 'revoke', target: invite });
  };

  const handleRemoveMember = (member) => {
    setConfirmDialog({ open: true, type: 'remove', target: member });
  };

  const handleLeaveTeam = () => {
    setConfirmDialog({ open: true, type: 'leave', target: null });
  };

  const memberColumns = useMemo(() => [
    {
      id: 'member', label: 'Member',
      render: (row) => (
        <Stack direction="row" alignItems="center" spacing={2}>
          <Avatar src={row.avatar_url} sx={{ width: 36, height: 36 }}>
            {getInitials(row.first_name, row.last_name, row.email)}
          </Avatar>
          <Box>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" fontWeight={500}>
                {clientLabel(row) || 'Unnamed User'}
              </Typography>
              {row.isInherited && <Chip label={`Inherited${row.sourceGroupName ? ` • ${row.sourceGroupName}` : ''}`} size="small" variant="outlined" />}
            </Stack>
            <Typography variant="caption" color="text.secondary">{row.email}</Typography>
          </Box>
        </Stack>
      )
    },
    {
      id: 'role', label: 'Role',
      render: (row) => <Chip label={ROLE_LABELS[row.role] || row.role} size="small" color={ROLE_COLORS[row.role] || 'default'} />
    },
    {
      id: 'accepted_at', label: 'Joined',
      render: (row) => <Typography variant="body2" color="text.secondary">{formatDate(row.accepted_at)}</Typography>
    },
    {
      id: 'actions', label: 'Actions', align: 'right', hidden: !canManage,
      render: (row) => (
        (row.isEditable && row.role !== 'owner' && (userRole === 'owner' || (userRole === 'admin' && row.role === 'member'))) ? (
          <Tooltip title="Remove member">
            <IconButton size="small" color="error" onClick={() => handleRemoveMember(row)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null
      )
    },
  ], [canManage, userRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const inviteColumns = useMemo(() => [
    {
      id: 'invite_email', label: 'Email',
      render: (row) => (
        <Stack direction="row" alignItems="center" spacing={1}>
          <EmailIcon color="action" fontSize="small" />
          <Box>
            <Typography variant="body2">{row.invite_email}</Typography>
            {row.invite_first_name && <Typography variant="caption" color="text.secondary">{row.invite_first_name}</Typography>}
          </Box>
        </Stack>
      )
    },
    {
      id: 'invite_role', label: 'Role',
      render: (row) => <Chip label={ROLE_LABELS[row.invite_role] || row.invite_role} size="small" color={ROLE_COLORS[row.invite_role] || 'default'} variant="outlined" />
    },
    { id: 'created_at', label: 'Sent', render: (row) => <Typography variant="body2" color="text.secondary">{formatDate(row.created_at)}</Typography> },
    { id: 'expires_at', label: 'Expires', render: (row) => <Typography variant="body2" color="text.secondary">{formatDate(row.expires_at)}</Typography> },
    {
      id: 'actions', label: 'Actions', align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Resend invitation">
            <IconButton size="small" onClick={() => handleResendInvite(row)}>
              <SendIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Revoke invitation">
            <IconButton size="small" color="error" onClick={() => handleRevokeInvite(row)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirmAction = async () => {
    setConfirmLoading(true);
    try {
      if (confirmDialog.type === 'revoke') {
        await revokeInvite(confirmDialog.target.id);
        setMessage({ type: 'success', text: 'Invitation revoked' });
      } else if (confirmDialog.type === 'remove') {
        await removeMember(confirmDialog.target.id);
        setMessage({ type: 'success', text: 'Member removed' });
      } else if (confirmDialog.type === 'leave') {
        await leaveTeam();
        setMessage({ type: 'success', text: 'You have left the team' });
        // Reload page to refresh auth state
        window.location.reload();
      }
      setConfirmDialog({ open: false, type: '', target: null });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Action failed' });
    } finally {
      setConfirmLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={300} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      {message.text && (
        <Alert severity={message.type} onClose={() => setMessage({ type: '', text: '' })} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <GroupIcon color="primary" />
          <Typography variant="h5">Team Management</Typography>
          {businessName && (
            <Chip label={businessName} size="small" variant="outlined" />
          )}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={loadData} size="small">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          {canInvite && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenInviteDialog}>
              Invite User
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Team Members */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Team Members ({members.length})
          </Typography>
          <DataTable
            columns={memberColumns}
            rows={members}
            rowKey={(row) => row.rowKey || row.id}
            size="medium"
            emptyTitle="No team members"
          />
        </CardContent>
      </Card>

      {/* Pending Invites (only shown to those who can manage) */}
      {canManage && invites.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Pending Invitations ({invites.length})
            </Typography>
            <DataTable
              columns={inviteColumns}
              rows={invites}
              size="medium"
              emptyTitle="No pending invitations"
            />
          </CardContent>
        </Card>
      )}

      {/* Leave Team Button (for non-owners) */}
      {canLeave && (
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Button
            variant="outlined"
            color="error"
            onClick={handleLeaveTeam}
          >
            Leave Team
          </Button>
        </Box>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onClose={handleCloseInviteDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Invite Team Member</DialogTitle>
        <DialogContent>
          {!inviteUrl ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
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
                placeholder="John"
              />
              <SelectField label="Role" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                <MenuItem value="member">
                  <Stack>
                    <Typography>Member</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ROLE_DESCRIPTIONS.member}
                    </Typography>
                  </Stack>
                </MenuItem>
                <MenuItem value="admin">
                  <Stack>
                    <Typography>Admin</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ROLE_DESCRIPTIONS.admin}
                    </Typography>
                  </Stack>
                </MenuItem>
              </SelectField>
              {inviteError && (
                <Alert severity="error">{inviteError}</Alert>
              )}
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert severity="success">Invitation sent successfully!</Alert>
              <Typography variant="body2" color="text.secondary">
                You can also share this link directly:
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  fullWidth
                  value={inviteUrl}
                  size="small"
                  InputProps={{ readOnly: true }}
                />
                <Tooltip title="Copy link">
                  <IconButton onClick={handleCopyInviteUrl}>
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseInviteDialog}>
            {inviteUrl ? 'Done' : 'Cancel'}
          </Button>
          {!inviteUrl && (
            <LoadingButton
              variant="contained"
              onClick={handleSendInvite}
              disabled={!inviteForm.email}
              startIcon={<SendIcon />}
              loading={inviteLoading}
              loadingLabel="Sending..."
            >
              Send Invitation
            </LoadingButton>
          )}
        </DialogActions>
      </Dialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ open: false, type: '', target: null })}
        onConfirm={handleConfirmAction}
        title={
          confirmDialog.type === 'revoke' ? 'Revoke Invitation'
            : confirmDialog.type === 'remove' ? 'Remove Team Member'
            : 'Leave Team'
        }
        message={
          confirmDialog.type === 'revoke' ? (
            <Typography>
              Are you sure you want to revoke the invitation for <strong>{confirmDialog.target?.invite_email}</strong>?
              They will no longer be able to join using this link.
            </Typography>
          ) : confirmDialog.type === 'remove' ? (
            <Typography>
              Are you sure you want to remove <strong>{confirmDialog.target?.email}</strong> from the team?
              They will lose access to this account.
            </Typography>
          ) : (
            <Typography>
              Are you sure you want to leave the team?
              You will lose access to this account and its data.
            </Typography>
          )
        }
        confirmLabel="Confirm"
        confirmColor="error"
        loading={confirmLoading}
      />
    </Box>
  );
}
