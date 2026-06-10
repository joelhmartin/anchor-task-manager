import { useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ListItemButton from '@mui/material/ListItemButton';
import { IconChevronRight, IconUsersGroup } from '@tabler/icons-react';

import MainCard from 'ui-component/cards/MainCard';
import EmptyState from 'ui-component/extended/EmptyState';
import useAuth from 'hooks/useAuth';

export default function SelectAccount() {
  const { user, setClientAccount } = useAuth();
  const navigate = useNavigate();

  const accounts = useMemo(() => user?.availableClientAccounts || [], [user]);

  // If there's only one account (or none), nothing to choose — send them on.
  if (accounts.length <= 1) {
    return <Navigate to="/" replace />;
  }

  const handlePick = (clientOwnerId) => {
    setClientAccount(clientOwnerId);
    navigate('/portal');
  };

  const groupedAccounts = accounts.reduce(
    (acc, account) => {
      if (account.accessScope === 'group') {
        const groupKey = account.sourceGroupId || 'group';
        const groupName = account.sourceGroupName || 'Group';
        if (!acc.groups[groupKey]) acc.groups[groupKey] = { name: groupName, accounts: [] };
        acc.groups[groupKey].accounts.push(account);
      } else {
        acc.direct.push(account);
      }
      return acc;
    },
    { direct: [], groups: {} }
  );

  const renderAccountRow = (account) => (
    <ListItemButton
      key={account.clientOwnerId}
      onClick={() => handlePick(account.clientOwnerId)}
      sx={{ borderRadius: 1, py: 1.5 }}
    >
      <Avatar sx={{ mr: 2, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
        {(account.displayName || '?').charAt(0).toUpperCase()}
      </Avatar>
      <Stack sx={{ flex: 1 }} spacing={0.25}>
        <Typography variant="subtitle1">{account.displayName}</Typography>
        {account.ownerEmail && account.ownerEmail !== account.displayName && (
          <Typography variant="caption" color="text.secondary">
            {account.ownerEmail}
          </Typography>
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        {account.membershipRole && account.membershipRole !== 'member' && (
          <Chip label={account.membershipRole} size="small" variant="outlined" />
        )}
        <IconChevronRight size={18} stroke={1.5} />
      </Stack>
    </ListItemButton>
  );

  const groupEntries = Object.entries(groupedAccounts.groups);

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', py: 4 }}>
      <Stack spacing={3}>
        <Stack spacing={0.5}>
          <Typography variant="h3">Choose an account</Typography>
          <Typography variant="body2" color="text.secondary">
            {user?.first_name ? `Welcome back, ${user.first_name}. ` : ''}
            Pick an account to open. You can switch anytime from the top-right menu.
          </Typography>
        </Stack>

        {accounts.length === 0 && (
          <MainCard>
            <EmptyState
              icon={IconUsersGroup}
              title="No accounts available yet."
              message="Once you're added to a client account or group, it'll show up here."
            />
          </MainCard>
        )}

        {groupedAccounts.direct.length > 0 && (
          <MainCard title="Your accounts" contentSX={{ p: 1 }}>
            <Stack>{groupedAccounts.direct.map(renderAccountRow)}</Stack>
          </MainCard>
        )}

        {groupEntries.map(([groupId, group]) => (
          <MainCard key={groupId} title={group.name} contentSX={{ p: 1 }}>
            <Stack>{group.accounts.map(renderAccountRow)}</Stack>
          </MainCard>
        ))}
      </Stack>
    </Box>
  );
}
