import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

const EVENT_LABELS = {
  item_created: 'Created',
  item_updated: 'Updated',
  status_changed: 'Status Changed',
  item_completed: 'Completed',
  item_assigned: 'Assigned',
  comment_added: 'Comment',
  file_uploaded: 'File Uploaded'
};

export default function RecentActivityWidget({ data }) {
  if (!data?.length) {
    return <Typography variant="body2" color="text.secondary">No recent activity.</Typography>;
  }

  return (
    <List dense disablePadding sx={{ maxHeight: 300, overflow: 'auto' }}>
      {data.slice(0, 15).map((event, idx) => (
        <ListItem key={event.id || idx} divider={idx < data.length - 1} sx={{ px: 0 }}>
          <ListItemText
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label={EVENT_LABELS[event.event_type] || event.event_type || 'Event'}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
                <Typography variant="body2" noWrap>
                  {event.entity_name || event.entity_type || ''}
                </Typography>
              </Box>
            }
            secondary={formatTimestamp(event.created_at)}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </ListItem>
      ))}
    </List>
  );
}
