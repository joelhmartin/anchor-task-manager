import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Skeleton,
  Stack,
  Typography
} from '@mui/material';
import {
  IconAlertTriangle,
  IconBulb,
  IconChecklist,
  IconClock,
  IconMessageCircle,
  IconRefresh,
  IconSparkles,
  IconSun,
  IconMoon,
  IconSunrise,
  IconUserQuestion
} from '@tabler/icons-react';
import { purple, red, orange, lightBlue } from '@mui/material/colors';
import { fetchAiDailyOverview } from 'api/tasks';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { WARNING_ACCENT_COLOR } from 'constants/taskDefaults';

function getGreetingIcon() {
  const hour = new Date().getHours();
  if (hour < 12) return <IconSunrise size={28} />;
  if (hour < 18) return <IconSun size={28} />;
  return <IconMoon size={28} />;
}

function PriorityChip({ priority }) {
  const colors = {
    1: 'error',
    2: 'warning',
    3: 'info',
    4: 'default',
    5: 'default'
  };
  return <Chip label={`P${priority}`} size="small" color={colors[priority] || 'default'} sx={{ minWidth: 36, fontWeight: 600 }} />;
}

export default function HomePane() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);
  const [parsedSummary, setParsedSummary] = useState(null);
  const toast = useToast();
  const lastToastRef = useRef('');

  const loadOverview = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const data = await fetchAiDailyOverview(refresh);
      setOverview(data.overview);

      // Parse the summary JSON
      if (data.overview?.summary) {
        try {
          const parsed = JSON.parse(data.overview.summary);
          setParsedSummary(parsed);
        } catch {
          setParsedSummary({ today_at_a_glance: data.overview.summary });
        }
      }
    } catch (err) {
      const msg = getErrorMessage(err, 'Unable to load daily overview');
      setError(msg);
      if (lastToastRef.current !== msg) {
        lastToastRef.current = msg;
        toast.error(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  if (loading) {
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3, minHeight: 420 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Skeleton variant="circular" width={48} height={48} />
            <Stack spacing={0.5} flex={1}>
              <Skeleton variant="text" width={200} height={32} />
              <Skeleton variant="text" width={160} height={20} />
            </Stack>
          </Stack>
          <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2 }} />
          <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
          <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
        </Stack>
      </Box>
    );
  }

  if (error && !overview) {
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3, minHeight: 420 }}>
        <Typography variant="caption" color="error" sx={{ display: 'block', mb: 2 }}>
          Unable to load daily overview.
        </Typography>
        <Button variant="outlined" onClick={() => loadOverview()} startIcon={<IconRefresh size={18} />}>
          Try Again
        </Button>
      </Box>
    );
  }

  // Extract data from the new structured format
  const greeting = parsedSummary?.greeting || `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}!`;
  const todayAtAGlance = parsedSummary?.today_at_a_glance || '';
  const topPriorities = parsedSummary?.top_priorities || overview?.todo_items || [];
  const mentionsNeedingResponse = parsedSummary?.mentions_needing_response || [];
  const mentionsAwaitingReplies = parsedSummary?.mentions_awaiting_replies || [];
  const upcomingAndAtRisk = parsedSummary?.upcoming_and_at_risk || [];
  const suggestions = parsedSummary?.suggestions || [];

  // Fallback to raw data if AI-parsed sections are empty
  const pendingMentions = overview?.pending_mentions || [];
  const unansweredMentions = overview?.unanswered_mentions || [];

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3, minHeight: 420 }}>
      <Stack spacing={3}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48 }}>{getGreetingIcon()}</Avatar>
            <Stack>
              <Typography variant="h5">{greeting}</Typography>
              <Typography variant="body2" color="text.secondary">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </Typography>
            </Stack>
          </Stack>
          <Button
            size="small"
            variant="outlined"
            onClick={() => loadOverview(true)}
            disabled={refreshing}
            startIcon={refreshing ? <CircularProgress size={14} /> : <IconRefresh size={16} />}
          >
            Refresh
          </Button>
        </Stack>

        {/* Today at a Glance */}
        {todayAtAGlance && (
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <IconSparkles size={22} style={{ color: purple[500], flexShrink: 0, marginTop: 2 }} />
              <Stack>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Today at a Glance
      </Typography>
                <Typography variant="body1">{todayAtAGlance}</Typography>
              </Stack>
            </Stack>
          </Paper>
        )}

        <Divider />

        {/* Top Priorities */}
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <IconChecklist size={22} />
              <Typography variant="h6">Top Priorities</Typography>
              {topPriorities.length > 0 && <Chip label={`${topPriorities.length} items`} size="small" color="primary" />}
            </Stack>

            {topPriorities.length === 0 ? (
      <Typography variant="body2" color="text.secondary">
                No priority items identified for today. Great job staying on top of things!
              </Typography>
            ) : (
              <List dense disablePadding>
                {topPriorities.map((item, idx) => (
                  <ListItem
                    key={idx}
                    sx={{
                      bgcolor: item.priority === 1 ? 'error.lighter' : item.priority === 2 ? 'warning.lighter' : 'transparent',
                      borderRadius: 1,
                      mb: 0.5,
                      border: item.priority <= 2 ? '1px solid' : 'none',
                      borderColor: item.priority === 1 ? 'error.light' : 'warning.light'
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 44 }}>
                      <PriorityChip priority={item.priority || idx + 1} />
                    </ListItemIcon>
                    <ListItemText
                      primary={item.task || item.item_name}
                      secondary={item.reason}
                      primaryTypographyProps={{ fontWeight: item.priority <= 2 ? 600 : 500 }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        {/* Mentions Section */}
        {(mentionsNeedingResponse.length > 0 ||
          mentionsAwaitingReplies.length > 0 ||
          pendingMentions.length > 0 ||
          unansweredMentions.length > 0) && (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {/* Mentions Needing Response */}
            {(mentionsNeedingResponse.length > 0 || pendingMentions.length > 0) && (
              <Card variant="outlined" sx={{ flex: 1, borderColor: 'error.light' }}>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <IconMessageCircle size={20} color={red[500]} />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Mentions You Haven't Responded To
                    </Typography>
                    <Chip label={mentionsNeedingResponse.length || pendingMentions.length} size="small" color="error" />
                  </Stack>
                  <List dense disablePadding>
                    {(mentionsNeedingResponse.length > 0 ? mentionsNeedingResponse : pendingMentions).slice(0, 5).map((m, idx) => (
                      <ListItem key={idx} sx={{ px: 0, py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 28 }}>
                          <IconUserQuestion size={16} />
                        </ListItemIcon>
                        <ListItemText
                          primary={m.summary || m.content?.slice(0, 80)}
                          secondary={`From ${m.from || m.author_name} on "${m.item || m.item_name}"`}
                          primaryTypographyProps={{ variant: 'body2', sx: { fontStyle: 'italic' } }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}

            {/* Mentions Awaiting Replies */}
            {(mentionsAwaitingReplies.length > 0 || unansweredMentions.length > 0) && (
              <Card variant="outlined" sx={{ flex: 1, borderColor: 'warning.light' }}>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <IconClock size={20} color={orange[500]} />
                    <Typography variant="subtitle1" fontWeight={600}>
                      Mentions Awaiting Replies
                    </Typography>
                    <Chip label={mentionsAwaitingReplies.length || unansweredMentions.length} size="small" color="warning" />
                  </Stack>
                  <List dense disablePadding>
                    {(mentionsAwaitingReplies.length > 0 ? mentionsAwaitingReplies : unansweredMentions).slice(0, 5).map((m, idx) => (
                      <ListItem key={idx} sx={{ px: 0, py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 28 }}>
                          <IconMessageCircle size={16} />
                        </ListItemIcon>
                        <ListItemText
                          primary={m.summary || m.content?.slice(0, 80)}
                          secondary={`On "${m.item || m.item_name}"`}
                          primaryTypographyProps={{ variant: 'body2', sx: { fontStyle: 'italic' } }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}

        {/* Upcoming & At-Risk Items */}
        {upcomingAndAtRisk.length > 0 && (
          <Card variant="outlined" sx={{ borderColor: 'warning.main' }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <IconAlertTriangle size={20} color={WARNING_ACCENT_COLOR} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Upcoming & At-Risk Items
                </Typography>
              </Stack>
              <List dense disablePadding>
                {upcomingAndAtRisk.map((item, idx) => (
                  <ListItem key={idx} sx={{ px: 0, py: 0.5 }}>
                    <ListItemText
                      primary={item.item_name}
                      secondary={item.risk}
                      primaryTypographyProps={{ fontWeight: 500 }}
                      secondaryTypographyProps={{ variant: 'caption', color: 'warning.main' }}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'info.lighter', borderRadius: 2, borderColor: 'info.light' }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <IconBulb size={20} style={{ color: lightBlue[700], flexShrink: 0, marginTop: 2 }} />
              <Stack>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Suggestions
                </Typography>
                <Stack spacing={0.25}>
                  {suggestions.map((tip, idx) => (
                    <Typography key={idx} variant="body2" color="text.secondary">
                      • {tip}
                    </Typography>
                  ))}
                </Stack>
              </Stack>
            </Stack>
          </Paper>
        )}

        {/* Footer */}
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', pt: 1 }}>
          <IconSparkles size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          AI-powered daily overview • Last updated:{' '}
          {overview?.generated_at ? new Date(overview.generated_at).toLocaleTimeString() : 'just now'}
      </Typography>
      </Stack>
    </Box>
  );
}
