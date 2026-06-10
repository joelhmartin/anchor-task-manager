import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// material-ui
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Avatar from '@mui/material/Avatar';
import Badge from '@mui/material/Badge';
import CardActions from '@mui/material/CardActions';
import Chip from '@mui/material/Chip';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

// project imports
import MainCard from 'ui-component/cards/MainCard';
import Transitions from 'ui-component/extended/Transitions';
import NotificationList from './NotificationList';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from 'api/notifications';

// assets
import { IconBell } from '@tabler/icons-react';
import Button from '@mui/material/Button';

// notification status options
const status = [
  {
    value: 'all',
    label: 'All Notification'
  },
  {
    value: 'new',
    label: 'New'
  },
  {
    value: 'unread',
    label: 'Unread'
  },
  {
    value: 'other',
    label: 'Other'
  }
];

// ==============================|| NOTIFICATION ||============================== //

export default function NotificationSection() {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('all');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  /**
   * anchorRef is used on different componets and specifying one type leads to other components throwing an error
   * */
  const anchorRef = useRef(null);

  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  const handleClose = (event) => {
    if (anchorRef.current && anchorRef.current.contains(event.target)) {
      return;
    }
    setOpen(false);
  };

  const prevOpen = useRef(open);
  useEffect(() => {
    if (prevOpen.current === true && open === false) {
      anchorRef.current.focus();
    }
    prevOpen.current = open;
  }, [open]);

  const handleChange = (event) => {
    const next = event?.target.value;
    setValue(next);
  };

  const loadNotifications = useCallback(() => {
    setLoading(true);
    fetchNotifications()
      .then((res) => {
        setNotifications(res.notifications || []);
        setUnreadCount(res.unread || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) {
      loadNotifications();
    }
  }, [open, loadNotifications]);

  // Poll for unread count on mount and every 60 s so the badge reflects
  // new notifications without requiring the menu to be opened.
  useEffect(() => {
    loadNotifications();
    const id = setInterval(loadNotifications, 60000);
    return () => clearInterval(id);
  }, [loadNotifications]);

  const filteredNotifications = useMemo(() => {
    if (value === 'unread') {
      return notifications.filter((item) => item.status !== 'read');
    }
    return notifications;
  }, [notifications, value]);

  const handleNotificationClick = (notification) => {
    if (!notification) return;
    setNotifications((prev) =>
      prev.map((item) => (item.id === notification.id ? { ...item, status: 'read', read_at: new Date().toISOString() } : item))
    );
    if (notification.status === 'unread') {
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    }
    markNotificationRead(notification.id).catch(() => {});
    handleClose({ target: document.body });
    if (notification.link_url) {
      navigate(notification.link_url);
    }
  };

  const handleMarkAll = () => {
    if (!notifications.length) return;
    markAllNotificationsRead()
      .then(() => {
        setNotifications((prev) => prev.map((item) => ({ ...item, status: 'read', read_at: new Date().toISOString() })));
        setUnreadCount(0);
      })
      .catch(() => {});
  };

  return (
    <>
      <Box sx={{ ml: 2 }}>
        <Badge
          badgeContent={unreadCount}
          color="error"
          invisible={!unreadCount}
          overlap="circular"
          max={99}
        >
          <Avatar
            variant="rounded"
            sx={{
              ...theme.typography.commonAvatar,
              ...theme.typography.mediumAvatar,
              transition: 'all .2s ease-in-out',
              color: theme.vars.palette.warning.dark,
              background: theme.vars.palette.warning.light,
              '&:hover, &[aria-controls="menu-list-grow"]': {
                color: theme.vars.palette.warning.light,
                background: theme.vars.palette.warning.dark
              }
            }}
            ref={anchorRef}
            aria-controls={open ? 'menu-list-grow' : undefined}
            aria-haspopup="true"
            onClick={handleToggle}
          >
            <IconBell stroke={1.5} size="20px" />
          </Avatar>
        </Badge>
      </Box>
      <Popper
        placement={downMD ? 'bottom' : 'bottom-end'}
        open={open}
        anchorEl={anchorRef.current}
        role={undefined}
        transition
        disablePortal
        modifiers={[{ name: 'offset', options: { offset: [downMD ? 5 : 0, 20] } }]}
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleClose}>
            <Transitions position={downMD ? 'top' : 'top-right'} in={open} {...TransitionProps}>
              <Paper>
                {open && (
                  <MainCard border={false} elevation={16} content={false} boxShadow shadow={theme.shadows[16]} sx={{ maxWidth: 330 }}>
                    <Stack sx={{ gap: 2 }}>
                      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', pt: 2, px: 2 }}>
                        <Stack direction="row" sx={{ gap: 2 }}>
                          <Typography variant="subtitle1">All Notification</Typography>
                          <Chip
                            size="small"
                            label={String(unreadCount).padStart(2, '0')}
                            variant="filled"
                            sx={{ color: 'background.default', bgcolor: 'warning.dark' }}
                          />
                        </Stack>
                        <Typography
                          component="button"
                          type="button"
                          onClick={handleMarkAll}
                          variant="subtitle2"
                          sx={{ color: 'primary.main', bgcolor: 'transparent', border: 0, p: 0, cursor: 'pointer' }}
                        >
                          Mark as all read
                        </Typography>
                      </Stack>
                      <Box sx={{ height: 1, maxHeight: 'calc(100vh - 205px)', overflowX: 'hidden', '&::-webkit-scrollbar': { width: 5 } }}>
                        <Box sx={{ px: 2, pt: 0.25 }}>
                          <TextField
                            id="outlined-select-currency-native"
                            select
                            fullWidth
                            value={value}
                            onChange={handleChange}
                            slotProps={{ select: { native: true } }}
                          >
                            {status.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </TextField>
                        </Box>
                        <Divider sx={{ mt: 2 }} />
                        <NotificationList
                          notifications={filteredNotifications}
                          loading={loading}
                          onSelect={handleNotificationClick}
                        />
                      </Box>
                    </Stack>
                    <CardActions sx={{ p: 1.25, justifyContent: 'center' }}>
                      <Button size="small" disableElevation>
                        View All
                      </Button>
                    </CardActions>
                  </MainCard>
                )}
              </Paper>
            </Transitions>
          </ClickAwayListener>
        )}
      </Popper>
    </>
  );
}
