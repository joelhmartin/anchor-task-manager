/**
 * TeamTab — Admin-side team management for a client account
 *
 * Lets admins view, invite, remove, and manage team members
 * for any client account from the AdminHub drawer.
 */

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
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';

import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EmailIcon from '@mui/icons-material/Email';
import SendIcon from '@mui/icons-material/Send';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import DataTable from 'ui-component/extended/DataTable';
import EmptyState from 'ui-component/extended/EmptyState';
import FormDialog from 'ui-component/extended/FormDialog';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { clientLabel } from 'hooks/useClientLabel';
import { getErrorMessage } from 'utils/errors';
import {
  fetchClientTeam,
  sendClientTeamInvite,
  resendClientTeamInvite,
  revokeClientTeamInvite,
  removeClientTeamMember,
  updateClientTeamMemberRole,
  updateClientTeamInvite,
  transferClientOwnership
} from 'api/clients';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const ROLE_COLORS = { owner: 'primary', admin: 'secondary', member: 'default' };

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(first, last, email) {
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.substring(0, 2).toUpperCase();
  if (email) return email.substring(0, 2).toUpperCase();
  return '??';
}

export default function TeamTab({ clientId }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', role: 'member' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  // Confirm dialog
  const [confirm, setConfirm] = useState({ open: false, type: '', target: null });
  const [confirmLoading, setConfirmLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchClientTeam(clientId);
      setMembers(data.members || []);
      setInvites(data.invites || []);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [clientId, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenInvite = () => {
    setInviteForm({ email: '', firstName: '', role: 'member' });
    setInviteUrl('');
    setInviteOpen(true);
  };

  const handleSendInvite = async () => {
    if (!inviteForm.email) { showToast('Email is required', 'error'); return; }
    try {
      setInviteLoading(true);
      const result = await sendClientTeamInvite(clientId, inviteForm);
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
      const result = await resendClientTeamInvite(clientId, invite.id);
      showToast(result.message || 'Invitation resent', 'success');
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const handleRoleChange = async (member, newRole) => {
    if (newRole === member.role) return;
    if (newRole === 'owner') {
      setTransferDialog({
        open: true,
        targetKind: 'member',
        targetId: member.id,
        targetLabel: clientLabel(member),
        previousRole: member.role
      });
      return;
    }
    try {
      await updateClientTeamMemberRole(clientId, member.id, newRole);
      showToast('Role updated', 'success');
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  // State for the transfer-ownership dialog (Task 10 wires the dialog UI).
  const [transferDialog, setTransferDialog] = useState({
    open: false,
    targetKind: null, // 'member' | 'invite'
    targetId: null,
    targetLabel: '',
    previousRole: null
  });
  const [transferAction, setTransferAction] = useState('demote');
  const [transferLoading, setTransferLoading] = useState(false);

  const handleInviteRoleChange = async (invite, newRole) => {
    if (newRole === invite.invite_role) return;
    if (newRole === 'owner') {
      setTransferDialog({
        open: true,
        targetKind: 'invite',
        targetId: invite.id,
        targetLabel: invite.invite_email,
        previousRole: invite.invite_role
      });
      return;
    }
    try {
      await updateClientTeamInvite(clientId, invite.id, { role: newRole });
      showToast('Invite role updated', 'success');
      setInvites((prev) => prev.map((i) => (i.id === invite.id ? { ...i, invite_role: newRole } : i)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const handleConfirmTransfer = async () => {
    const target =
      transferDialog.targetKind === 'member'
        ? { kind: 'member', memberId: transferDialog.targetId }
        : { kind: 'invite', inviteId: transferDialog.targetId };
    try {
      setTransferLoading(true);
      await transferClientOwnership(clientId, { target, currentOwnerAction: transferAction });
      showToast(
        transferDialog.targetKind === 'member'
          ? 'Ownership transferred'
          : 'Ownership transfer queued — applies when the invite is accepted',
        'success'
      );
      setTransferDialog({ open: false, targetKind: null, targetId: null, targetLabel: '', previousRole: null });
      setTransferAction('demote');
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleCancelTransfer = () => {
    setTransferDialog({ open: false, targetKind: null, targetId: null, targetLabel: '', previousRole: null });
    setTransferAction('demote');
  };

  const [relinquishDialog, setRelinquishDialog] = useState({ open: false });
  const [relinquishForm, setRelinquishForm] = useState({ email: '', firstName: '', action: 'demote' });
  const [relinquishLoading, setRelinquishLoading] = useState(false);
  const [relinquishInviteUrl, setRelinquishInviteUrl] = useState('');

  const handleOpenRelinquish = () => {
    setRelinquishForm({ email: '', firstName: '', action: 'demote' });
    setRelinquishInviteUrl('');
    setRelinquishDialog({ open: true });
  };

  const handleSubmitRelinquish = async () => {
    if (!relinquishForm.email) { showToast('Email is required', 'error'); return; }
    try {
      setRelinquishLoading(true);
      const result = await transferClientOwnership(clientId, {
        target: { kind: 'email', email: relinquishForm.email, firstName: relinquishForm.firstName || undefined },
        currentOwnerAction: relinquishForm.action
      });
      setRelinquishInviteUrl(result.inviteUrl || '');
      showToast('Ownership transfer invite sent', 'success');
      loadData();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRelinquishLoading(false);
    }
  };

  const handleConfirmAction = async () => {
    try {
      setConfirmLoading(true);
      if (confirm.type === 'revoke') {
        await revokeClientTeamInvite(clientId, confirm.target.id);
        showToast('Invitation revoked', 'success');
      } else if (confirm.type === 'remove') {
        await removeClientTeamMember(clientId, confirm.target.id);
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

  const memberColumns = useMemo(() => [
    {
      id: 'member', label: 'Member',
      render: (row) => (
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Avatar src={row.avatar_url} sx={{ width: 32, height: 32, fontSize: 13 }}>
            {getInitials(row.first_name, row.last_name, row.email)}
          </Avatar>
          <Box>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" fontWeight={500}>
                {clientLabel(row) || 'Unnamed'}
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
      render: (row) => {
        if (!row.isEditable || row.role === 'owner') {
          return <Chip label={ROLE_LABELS[row.role] || row.role} size="small" color={ROLE_COLORS[row.role] || 'default'} />;
        }
        return (
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select
              value={row.role}
              onChange={(e) => handleRoleChange(row, e.target.value)}
              sx={{ '& .MuiSelect-select': { py: 0.5, fontSize: '0.8125rem' } }}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="member">Member</MenuItem>
              <MenuItem value="owner">Owner</MenuItem>
            </Select>
          </FormControl>
        );
      }
    },
    {
      id: 'accepted_at', label: 'Joined',
      render: (row) => <Typography variant="body2" color="text.secondary">{formatDate(row.accepted_at)}</Typography>
    },
    {
      id: 'actions', label: '', align: 'right',
      render: (row) => row.isEditable ? (
        <Tooltip title="Remove member">
          <IconButton size="small" color="error" onClick={() => setConfirm({ open: true, type: 'remove', target: row })}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null
    }
  ], [clientId]);

  const inviteColumns = useMemo(() => [
    {
      id: 'email', label: 'Email',
      render: (row) => {
        // Treat a queued transfer as "meaningful" only when the displaced user
        // is a real human (not the client identity / placeholder ghost). When
        // displaced_owner_user_id matches the clientId, this is structurally a
        // normal owner invite — the "demote current owner" action is a no-op
        // against the self-membership row, so showing a transfer chip is just
        // confusing UI noise.
        const displacedIsGhost = row.metadata?.displaced_owner_user_id === clientId;
        const pendingTransfer = !!row.metadata?.pending_owner_transfer && !displacedIsGhost;
        const action = row.metadata?.on_accept_action;
        return (
          <Stack direction="row" alignItems="center" spacing={1}>
            <EmailIcon color="action" fontSize="small" />
            <Box>
              <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography variant="body2">{row.invite_email}</Typography>
                {pendingTransfer && (
                  <Chip
                    label={action === 'boot' ? 'Owner transfer (current owner removed)' : 'Owner transfer (current owner demoted)'}
                    size="small"
                    color="warning"
                    variant="outlined"
                  />
                )}
              </Stack>
              {row.invite_first_name && <Typography variant="caption" color="text.secondary">{row.invite_first_name}</Typography>}
            </Box>
          </Stack>
        );
      }
    },
    {
      id: 'role', label: 'Role',
      render: (row) => {
        const isPendingOwnerTransfer = !!row.metadata?.pending_owner_transfer;
        // If this invite already carries a queued owner-transfer (or is itself an owner invite),
        // show a chip — editing role from "owner" via this select is not how you cancel a transfer
        // (revoke the invite instead).
        if (row.invite_role === 'owner' || isPendingOwnerTransfer) {
          return (
            <Chip
              label={ROLE_LABELS[row.invite_role] || row.invite_role}
              size="small"
              variant="outlined"
              color={ROLE_COLORS[row.invite_role] || 'default'}
            />
          );
        }
        return (
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select
              value={row.invite_role}
              onChange={(e) => handleInviteRoleChange(row, e.target.value)}
              sx={{ '& .MuiSelect-select': { py: 0.5, fontSize: '0.8125rem' } }}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="member">Member</MenuItem>
              <MenuItem value="owner">Owner</MenuItem>
            </Select>
          </FormControl>
        );
      }
    },
    { id: 'expires', label: 'Expires', render: (row) => <Typography variant="body2" color="text.secondary">{formatDate(row.expires_at)}</Typography> },
    {
      id: 'actions', label: '', align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={0.25}>
          <Tooltip title="Resend"><IconButton size="small" onClick={() => handleResend(row)}><SendIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Revoke"><IconButton size="small" color="error" onClick={() => setConfirm({ open: true, type: 'revoke', target: row })}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      )
    }
  ], [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={600}>Team Members ({members.length})</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={handleOpenRelinquish}>
            Relinquish Ownership
          </Button>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleOpenInvite}>Invite</Button>
        </Stack>
      </Stack>

      <DataTable
        columns={memberColumns}
        rows={members}
        rowKey={(row) => row.rowKey || row.id}
        loading={loading}
        size="small"
        outlined
        emptyTitle="No team members"
        emptyMessage="Invite someone to get started."
      />

      {invites.length > 0 && (
        <>
          <Typography variant="subtitle1" fontWeight={600}>Pending Invitations ({invites.length})</Typography>
          <DataTable columns={inviteColumns} rows={invites} size="small" outlined emptyTitle="No pending invites" />
        </>
      )}

      {/* Invite Dialog */}
      <FormDialog
        open={inviteOpen}
        onClose={() => { setInviteOpen(false); setInviteUrl(''); }}
        onSubmit={inviteUrl ? undefined : handleSendInvite}
        title="Invite Team Member"
        loading={inviteLoading}
        submitLabel="Send Invitation"
        submitIcon={<SendIcon />}
        submitDisabled={!inviteForm.email || !!inviteUrl}
        actions={inviteUrl ? (
          <Button onClick={() => { setInviteOpen(false); setInviteUrl(''); }}>Done</Button>
        ) : undefined}
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
                  <Typography variant="caption" color="text.secondary">Can view and edit all account data</Typography>
                </Stack>
              </MenuItem>
              <MenuItem value="admin">
                <Stack>
                  <Typography>Admin</Typography>
                  <Typography variant="caption" color="text.secondary">Can invite new users and remove members</Typography>
                </Stack>
              </MenuItem>
            </SelectField>
          </>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="success.main" fontWeight={500}>Invitation sent!</Typography>
            <Typography variant="body2" color="text.secondary">You can also share this link directly:</Typography>
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

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm({ open: false, type: '', target: null })}
        onConfirm={handleConfirmAction}
        title={confirm.type === 'revoke' ? 'Revoke Invitation' : 'Remove Team Member'}
        message={
          confirm.type === 'revoke'
            ? `Revoke the invitation for ${confirm.target?.invite_email}? They won't be able to join using this link.`
            : `Remove ${confirm.target?.email} from the team? They will lose access to this account.`
        }
        confirmLabel="Confirm"
        confirmColor="error"
        loading={confirmLoading}
      />

      {/* Transfer Ownership Dialog (member or pending invite as target) */}
      <ConfirmDialog
        open={transferDialog.open}
        onClose={handleCancelTransfer}
        onConfirm={handleConfirmTransfer}
        title="Transfer Ownership"
        confirmLabel={transferDialog.targetKind === 'member' ? 'Transfer Now' : 'Queue Transfer'}
        confirmColor="primary"
        loading={transferLoading}
        loadingLabel="Transferring..."
        message={
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Make <strong>{transferDialog.targetLabel}</strong> the owner of this account
              {transferDialog.targetKind === 'invite' ? ' once they accept their invitation' : ''}.
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>What happens to the current owner?</Typography>
            <RadioGroup value={transferAction} onChange={(e) => setTransferAction(e.target.value)}>
              <FormControlLabel
                value="demote"
                control={<Radio size="small" />}
                label="Demote to admin (keeps access)"
              />
              <FormControlLabel
                value="boot"
                control={<Radio size="small" />}
                label="Remove from this account (loses access)"
              />
            </RadioGroup>
          </>
        }
      />
      {/* Relinquish Ownership Dialog (email kind) */}
      <FormDialog
        open={relinquishDialog.open}
        onClose={() => { setRelinquishDialog({ open: false }); setRelinquishInviteUrl(''); }}
        onSubmit={relinquishInviteUrl ? undefined : handleSubmitRelinquish}
        title="Relinquish Ownership"
        loading={relinquishLoading}
        submitLabel="Send Owner Invitation"
        submitDisabled={!relinquishForm.email || !!relinquishInviteUrl}
        actions={relinquishInviteUrl ? (
          <Button onClick={() => { setRelinquishDialog({ open: false }); setRelinquishInviteUrl(''); }}>Done</Button>
        ) : undefined}
      >
        {!relinquishInviteUrl ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              An invitation will be sent. The transfer applies once the new owner accepts.
            </Typography>
            <TextField
              label="New Owner Email"
              type="email"
              fullWidth
              required
              value={relinquishForm.email}
              onChange={(e) => setRelinquishForm({ ...relinquishForm, email: e.target.value })}
              placeholder="newowner@example.com"
            />
            <TextField
              label="First Name (optional)"
              fullWidth
              value={relinquishForm.firstName}
              onChange={(e) => setRelinquishForm({ ...relinquishForm, firstName: e.target.value })}
            />
            <Typography variant="body2" sx={{ mt: 1 }}>
              When the new owner accepts, the current owner will be:
            </Typography>
            <RadioGroup
              value={relinquishForm.action}
              onChange={(e) => setRelinquishForm({ ...relinquishForm, action: e.target.value })}
            >
              <FormControlLabel value="demote" control={<Radio size="small" />} label="Demoted to admin (keeps access)" />
              <FormControlLabel value="boot" control={<Radio size="small" />} label="Removed from this account" />
            </RadioGroup>
          </>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="success.main" fontWeight={500}>Owner invitation sent!</Typography>
            <Typography variant="body2" color="text.secondary">You can also share this link directly:</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField fullWidth value={relinquishInviteUrl} size="small" InputProps={{ readOnly: true }} />
              <Tooltip title="Copy link">
                <IconButton onClick={() => { navigator.clipboard.writeText(relinquishInviteUrl); showToast('Copied!', 'success'); }}>
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        )}
      </FormDialog>
    </Stack>
  );
}
