import PropTypes from 'prop-types';

import { useTheme } from '@mui/material/styles';
import Avatar from '@mui/material/Avatar';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import { withAlpha } from 'utils/colorUtils';
import { IconBell } from '@tabler/icons-react';

function ListItemWrapper({ children, onClick }) {
  const theme = useTheme();

  return (
    <Box
      onClick={onClick}
      sx={{
        p: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        '&:hover': {
          bgcolor: withAlpha(theme.palette.grey[200], 0.3)
        }
      }}
    >
      {children}
    </Box>
  );
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export default function NotificationList({ notifications = [], onSelect, loading }) {
  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (!notifications.length) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          You&apos;re all caught up!
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: { xs: 300, md: 330 } }}>
      {notifications.map((notification) => (
        <ListItemWrapper key={notification.id} onClick={() => onSelect?.(notification)}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Avatar
              sx={{
                color: 'primary.dark',
                bgcolor: 'primary.light',
                width: 36,
                height: 36
              }}
            >
              <IconBell stroke={1.5} size="18px" />
            </Avatar>
            <Stack spacing={0.25} sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {formatTimestamp(notification.created_at)}
              </Typography>
              <Typography variant="subtitle2" color="text.primary" sx={{ lineHeight: 1.25 }}>
                {notification.title || 'Notification'}
              </Typography>
              {notification.body ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                  {notification.body}
                </Typography>
              ) : null}
            </Stack>
          </Stack>
        </ListItemWrapper>
      ))}
    </Box>
  );
}

NotificationList.propTypes = {
  loading: PropTypes.bool,
  notifications: PropTypes.array,
  onSelect: PropTypes.func
};

ListItemWrapper.propTypes = { children: PropTypes.node, onClick: PropTypes.func };
