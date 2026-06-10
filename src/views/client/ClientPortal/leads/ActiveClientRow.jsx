import { useState } from 'react';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';

import StatusChip from 'ui-component/extended/StatusChip';

const formatDateSafe = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};
const formatDateTimeSafe = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

export default function ActiveClientRow({ client, onArchive = null, columnCount = 8, extraDetailContent = null }) {
  const [open, setOpen] = useState(false);
  const canArchive = typeof onArchive === 'function';
  const detailsPanelId = `active-client-details-${client.id}`;

  const activeServices = client.services?.filter((s) => !s.redacted_at) || [];
  const historicalServices = client.services?.filter((s) => s.redacted_at) || [];
  const totalRevenue = client.services?.reduce((sum, s) => sum + (parseFloat(s.agreed_price) || 0), 0) || 0;
  const journeySummary = client.journey_id
    ? {
        id: client.journey_id,
        status: client.journey_status,
        paused: client.journey_paused,
        concerns: Array.isArray(client.journey_symptoms) ? client.journey_symptoms : [],
        next_action_at: client.journey_next_action_at
      }
    : null;
  const journeyConcerns = journeySummary?.concerns || [];

  return (
    <>
      <TableRow sx={{ '& > *': { borderBottom: 'unset' } }}>
        <TableCell>
          <IconButton
            size="small"
            aria-label={open ? 'Collapse client details' : 'Expand client details'}
            aria-expanded={open}
            aria-controls={detailsPanelId}
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? <IconChevronUp /> : <IconChevronDown />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar alt={client.client_name}>{client.client_name?.[0] || '?'}</Avatar>
            <Box>
              <Typography variant="subtitle2">{client.client_name || 'Unknown'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {client.client_phone || client.client_email || 'No contact info'}
              </Typography>
            </Box>
          </Stack>
        </TableCell>
        <TableCell>
          {activeServices.length > 0 ? (
            <Stack direction="row" spacing={0.5} flexWrap="wrap">
              {activeServices.map((s) => (
                <Chip key={s.id} label={s.service_name} size="small" color="primary" />
              ))}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              No active services
            </Typography>
          )}
        </TableCell>
        <TableCell>
          {journeySummary ? (
            <Stack spacing={0.5}>
              <StatusChip
                status={journeySummary.paused ? 'pending' : journeySummary.status || 'pending'}
                label={(journeySummary.status || 'pending').replace(/_/g, ' ')}
              />
              {journeyConcerns.length > 0 && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {journeyConcerns.slice(0, 3).map((concern) => (
                    <Chip key={`${client.id}-${concern}`} label={concern} size="small" variant="outlined" />
                  ))}
                  {journeyConcerns.length > 3 && <Chip size="small" variant="outlined" label={`+${journeyConcerns.length - 3}`} />}
                </Stack>
              )}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              —
            </Typography>
          )}
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary">
            {client.source || '—'}
          </Typography>
        </TableCell>
        <TableCell align="right">
          <Typography variant="subtitle2">${totalRevenue.toFixed(2)}</Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary">
            {formatDateSafe(client.agreed_date)}
          </Typography>
        </TableCell>
        <TableCell align="right">
          {canArchive && (
            <Button size="small" color="error" onClick={() => onArchive(client)}>
              Archive
            </Button>
          )}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={columnCount}>
          <Collapse id={detailsPanelId} in={open} timeout="auto" unmountOnExit>
            <Box sx={{ margin: 2 }}>
              <Typography variant="h6" gutterBottom>
                Service Details
              </Typography>
              {activeServices.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    Active Services
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Service</TableCell>
                        <TableCell align="right">Price</TableCell>
                        <TableCell>Agreed Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activeServices.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.service_name}</TableCell>
                          <TableCell align="right">${parseFloat(s.agreed_price || 0).toFixed(2)}</TableCell>
                          <TableCell>{formatDateSafe(s.agreed_date)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
              {historicalServices.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Historical Services (Revenue Retained)
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Service (Redacted)</TableCell>
                        <TableCell align="right">Price</TableCell>
                        <TableCell>Agreed Date</TableCell>
                        <TableCell>Redacted Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {historicalServices.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell sx={{ fontStyle: 'italic', color: 'text.secondary' }}>{s.service_name || 'Redacted'}</TableCell>
                          <TableCell align="right">${parseFloat(s.agreed_price || 0).toFixed(2)}</TableCell>
                          <TableCell>{formatDateSafe(s.agreed_date)}</TableCell>
                          <TableCell>{formatDateSafe(s.redacted_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
              {journeySummary && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2">Lead Journey</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Status: {(journeySummary.status || 'pending').replace(/_/g, ' ')}
                    {journeySummary.next_action_at && ` · Next action ${formatDateTimeSafe(journeySummary.next_action_at)}`}
                  </Typography>
                  {journeyConcerns.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1 }}>
                      {journeyConcerns.map((concern) => (
                        <Chip key={`${client.id}-detail-${concern}`} label={concern} size="small" variant="outlined" />
                      ))}
                    </Stack>
                  )}
                </Box>
              )}
              {extraDetailContent && <Box sx={{ mt: 2 }}>{extraDetailContent}</Box>}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}
