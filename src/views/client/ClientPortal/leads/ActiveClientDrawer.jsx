import { useEffect, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import CloseIcon from '@mui/icons-material/Close';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import UnarchiveIcon from '@mui/icons-material/Unarchive';

import ContactActivityExpander from './ContactActivityExpander';

const formatPrice = (price) => `$${(parseFloat(price) || 0).toFixed(2)}`;
const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export default function ActiveClientDrawer({
  open,
  client,
  servicesCatalog = [],
  servicesCatalogLoading = false,
  onClose,
  onArchive,
  onRestore,
  onAddServices,
  onOpenLeadDetail,
  triggerMessage
}) {
  const isArchived = Boolean(client?.archived_at);
  const [activeTab, setActiveTab] = useState(0);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  // Reset selection + tab when switching clients or closing the drawer.
  // No `!open` guard: switching `client?.id` while the drawer is still open must
  // also clear stale selections so a submit can't apply to the wrong client.
  useEffect(() => {
    setActiveTab(0);
    setSelected([]);
    setSaving(false);
  }, [open, client?.id]);

  const activeServices = useMemo(
    () => (client?.services || []).filter((s) => !s.redacted_at),
    [client?.services]
  );
  const historicalServices = useMemo(
    () => (client?.services || []).filter((s) => s.redacted_at),
    [client?.services]
  );
  const totalRevenue = useMemo(
    () => (client?.services || []).reduce((sum, s) => sum + (parseFloat(s.agreed_price) || 0), 0),
    [client?.services]
  );

  const handleToggleService = (serviceId) => {
    setSelected((prev) => {
      const exists = prev.find((s) => s.service_id === serviceId);
      if (exists) return prev.filter((s) => s.service_id !== serviceId);
      const service = servicesCatalog.find((s) => s.id === serviceId);
      return [...prev, { service_id: serviceId, agreed_price: service?.base_price || 0 }];
    });
  };

  const handlePriceChange = (serviceId, value) => {
    setSelected((prev) => prev.map((s) => (s.service_id === serviceId ? { ...s, agreed_price: parseFloat(value) || 0 } : s)));
  };

  const handleSubmit = async () => {
    if (!client?.id || selected.length === 0) return;
    setSaving(true);
    try {
      await onAddServices(client.id, selected);
      triggerMessage?.('success', `Added ${selected.length} service${selected.length === 1 ? '' : 's'} to ${client.client_name || 'client'}`);
      setSelected([]);
    } catch (err) {
      triggerMessage?.('error', err.response?.data?.message || err.message || 'Unable to add services');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: '40vw' }, p: 0 } }}
    >
      {client && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {client.client_name || 'Client'}
              </Typography>
              <IconButton onClick={onClose} size="small" aria-label="Close drawer">
                <CloseIcon />
              </IconButton>
            </Stack>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              {client.client_phone && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <PhoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2">{client.client_phone}</Typography>
                </Stack>
              )}
              {client.client_email && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <EmailIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2">{client.client_email}</Typography>
                </Stack>
              )}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
              {client.source && <Chip label={client.source} size="small" variant="outlined" />}
              <Chip label={`Client since ${formatDate(client.agreed_date || client.created_at)}`} size="small" variant="outlined" />
              <Chip label={`Total revenue ${formatPrice(totalRevenue)}`} size="small" color="primary" />
              {isArchived && (
                <Chip
                  label={`Archived ${formatDate(client.archived_at)}`}
                  size="small"
                  color="warning"
                  variant="outlined"
                />
              )}
              <Box sx={{ flex: 1 }} />
              {isArchived && onRestore ? (
                <Tooltip title="Restore client">
                  <IconButton size="small" color="success" onClick={() => onRestore(client)} aria-label="Restore client">
                    <UnarchiveIcon />
                  </IconButton>
                </Tooltip>
              ) : !isArchived && onArchive ? (
                <Tooltip title="Archive client">
                  <IconButton size="small" color="error" onClick={() => onArchive(client)} aria-label="Archive client">
                    <ArchiveIcon />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>
          </Box>

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{ borderBottom: 1, borderColor: 'divider', px: 2, minHeight: 40 }}
          >
            <Tab label="Services" sx={{ minHeight: 40 }} />
            <Tab label="Activity" sx={{ minHeight: 40 }} />
          </Tabs>

          {/* Body */}
          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
            {activeTab === 0 ? (
              <Stack spacing={3}>
                {/* Active services */}
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Active services
                  </Typography>
                  {activeServices.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No active services. Use the form below to add one.
                    </Typography>
                  ) : (
                    <Paper variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Service</TableCell>
                            <TableCell align="right">Agreed price</TableCell>
                            <TableCell>Agreed date</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {activeServices.map((s) => (
                            <TableRow key={s.id}>
                              <TableCell>{s.service_name || '—'}</TableCell>
                              <TableCell align="right">{formatPrice(s.agreed_price)}</TableCell>
                              <TableCell>{formatDate(s.agreed_date)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                  )}
                </Box>

                {/* Historical (redacted) services */}
                {historicalServices.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Historical services (revenue retained)
                    </Typography>
                    <Paper variant="outlined" sx={{ opacity: 0.75 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Service (redacted)</TableCell>
                            <TableCell align="right">Agreed price</TableCell>
                            <TableCell>Agreed date</TableCell>
                            <TableCell>Redacted</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {historicalServices.map((s) => (
                            <TableRow key={s.id}>
                              <TableCell sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                                {s.service_name || 'Redacted'}
                              </TableCell>
                              <TableCell align="right">{formatPrice(s.agreed_price)}</TableCell>
                              <TableCell>{formatDate(s.agreed_date)}</TableCell>
                              <TableCell>{formatDate(s.redacted_at)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Box>
                )}

                {!isArchived && <Divider />}

                {/* Add services — hidden for archived clients */}
                {!isArchived && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Add services
                  </Typography>
                  {servicesCatalogLoading ? (
                    <Typography variant="body2" color="text.secondary">
                      Loading services…
                    </Typography>
                  ) : servicesCatalog.length === 0 ? (
                    <Alert severity="info">No services configured yet. Add services in the Services page first.</Alert>
                  ) : (
                    <Stack spacing={1.5}>
                      {servicesCatalog.map((service) => {
                        const picked = selected.find((s) => s.service_id === service.id);
                        const isSelected = Boolean(picked);
                        return (
                          <Paper
                            key={service.id}
                            variant="outlined"
                            sx={{
                              p: 1.5,
                              borderColor: isSelected ? 'primary.main' : 'divider',
                              bgcolor: isSelected ? 'primary.lighter' : 'transparent'
                            }}
                          >
                            <Stack direction="row" spacing={1.5} alignItems="center">
                              <Checkbox
                                checked={isSelected}
                                onChange={() => handleToggleService(service.id)}
                                inputProps={{ 'aria-label': `Select ${service.name}` }}
                              />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" fontWeight={600} noWrap>
                                  {service.name}
                                </Typography>
                                {service.description && (
                                  <Typography variant="caption" color="text.secondary" noWrap>
                                    {service.description}
                                  </Typography>
                                )}
                              </Box>
                              {isSelected ? (
                                <TextField
                                  label="Price"
                                  type="number"
                                  size="small"
                                  value={picked?.agreed_price ?? 0}
                                  onChange={(e) => handlePriceChange(service.id, e.target.value)}
                                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                                  inputProps={{ step: '0.01', min: '0' }}
                                  sx={{ width: 130 }}
                                />
                              ) : service.base_price ? (
                                <Typography variant="caption" color="text.secondary">
                                  Base {formatPrice(service.base_price)}
                                </Typography>
                              ) : null}
                            </Stack>
                          </Paper>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
                )}
              </Stack>
            ) : (
              <ContactActivityExpander
                phone={client.client_phone || ''}
                open
                onOpenLeadDetail={onOpenLeadDetail}
              />
            )}
          </Box>

          {/* Footer — Services tab only, hidden for archived clients */}
          {activeTab === 0 && !isArchived && (
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {selected.length
                    ? `${selected.length} service${selected.length === 1 ? '' : 's'} selected`
                    : 'Select one or more services to add'}
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled={selected.length === 0 || saving}
                  onClick={handleSubmit}
                >
                  {saving ? 'Saving…' : 'Add to client'}
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      )}
    </Drawer>
  );
}
