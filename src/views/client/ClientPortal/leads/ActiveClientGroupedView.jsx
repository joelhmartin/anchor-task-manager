import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PhoneIcon from '@mui/icons-material/Phone';

import EmptyState from 'ui-component/extended/EmptyState';
import ContactActivityExpander from './ContactActivityExpander';

const matchesQuery = (clientRow, q) => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    String(clientRow.client_name || '')
      .toLowerCase()
      .includes(needle) ||
    String(clientRow.client_phone || '')
      .toLowerCase()
      .includes(needle) ||
    String(clientRow.client_email || '')
      .toLowerCase()
      .includes(needle)
  );
};

const formatRevenue = (value) => `$${(value || 0).toFixed(2)}`;

export default function ActiveClientGroupedView({
  clients,
  clientsLoading,
  onOpenClient,
  onOpenLeadDetail,
  searchQuery = ''
}) {
  const [expandedActivity, setExpandedActivity] = useState({});

  const filtered = useMemo(
    () => (Array.isArray(clients) ? clients : []).filter((c) => matchesQuery(c, searchQuery)),
    [clients, searchQuery]
  );

  if (clientsLoading && (!clients || clients.length === 0)) {
    return <LinearProgress />;
  }

  if (!clients || clients.length === 0) {
    return <EmptyState title="No active clients yet" message="Convert a lead from the New Leads tab to add them here." />;
  }

  if (filtered.length === 0) {
    return <EmptyState title="No clients match your search" message="Try a different name, phone, or email." />;
  }

  return (
    <Stack spacing={1.5}>
      {filtered.map((client) => {
        const activeServices = (client.services || []).filter((s) => !s.redacted_at);
        const totalRevenue = (client.services || []).reduce((sum, s) => sum + (parseFloat(s.agreed_price) || 0), 0);
        const activityOpen = !!expandedActivity[client.id];
        const visibleServices = activeServices.slice(0, 2);
        const extraServices = Math.max(activeServices.length - visibleServices.length, 0);

        return (
          <Card key={client.id} variant="outlined">
            <CardContent
              sx={{ py: 2, '&:last-child': { pb: 1.5 }, cursor: 'pointer', '&:hover': { bgcolor: 'grey.50' } }}
              onClick={() => onOpenClient?.(client)}
            >
              <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
                <Box sx={{ flex: 1, minWidth: 220 }}>
                  <Typography variant="subtitle1" fontWeight={600} noWrap>
                    {client.client_name || 'Unnamed Client'}
                  </Typography>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                    {client.client_phone && (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <PhoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', letterSpacing: '0.02em' }}>
                          {client.client_phone}
                        </Typography>
                      </Stack>
                    )}
                    {visibleServices.map((s) => (
                      <Chip
                        key={`${client.id}-${s.id}`}
                        label={s.service_name || 'Service'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          bgcolor: 'primary.lighter',
                          color: 'primary.dark',
                          border: '1px solid',
                          borderColor: 'primary.light',
                          '& .MuiChip-label': { px: 0.75 }
                        }}
                      />
                    ))}
                    {extraServices > 0 && (
                      <Chip label={`+${extraServices}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                    )}
                  </Stack>
                </Box>

                <Chip
                  label={formatRevenue(totalRevenue)}
                  size="small"
                  color="primary"
                  sx={{ fontWeight: 600 }}
                />
                <Chip
                  label={`${activeServices.length} active`}
                  size="small"
                  variant="outlined"
                  sx={{ fontWeight: 600 }}
                />

                <Stack direction="row" spacing={0.5} alignItems="center" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => onOpenClient?.(client)}
                    sx={{ minWidth: 0, px: 1.25, py: 0.4, fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                  >
                    View Details
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Button
                size="small"
                onClick={() => setExpandedActivity((prev) => ({ ...prev, [client.id]: !prev[client.id] }))}
                endIcon={activityOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                sx={{ pl: 2, py: 0.5, textTransform: 'none' }}
              >
                Activity
              </Button>
              <ContactActivityExpander phone={client.client_phone} open={activityOpen} onOpenLeadDetail={onOpenLeadDetail} />
            </Box>
          </Card>
        );
      })}
    </Stack>
  );
}
