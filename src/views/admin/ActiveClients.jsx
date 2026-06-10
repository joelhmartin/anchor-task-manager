import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';

import SearchIcon from '@mui/icons-material/Search';

import MainCard from 'ui-component/cards/MainCard';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import ActiveClientGroupedView from 'views/client/ClientPortal/leads/ActiveClientGroupedView';
import ActiveClientDrawer from 'views/client/ClientPortal/leads/ActiveClientDrawer';
import useActiveClients from 'hooks/useActiveClients';
import { useToast } from 'contexts/ToastContext';
import { fetchProfile } from 'api/profile';
import { fetchServices } from 'api/services';

export default function ActiveClients() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('active');
  const {
    clients,
    loading,
    error: loadError,
    load: reloadClients,
    archive,
    restore,
    redactOldServices,
    addServices
  } = useActiveClients({ status });
  const toast = useToast();
  const [monthlyGoal, setMonthlyGoal] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerClientId, setDrawerClientId] = useState(null);
  const [servicesCatalog, setServicesCatalog] = useState([]);
  const [servicesCatalogLoading, setServicesCatalogLoading] = useState(false);

  // Confirmation dialogs
  const [redactConfirmOpen, setRedactConfirmOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState({ open: false, client: null });
  const [restoreConfirm, setRestoreConfirm] = useState({ open: false, client: null });

  const loadProfile = useCallback(async () => {
    try {
      const profile = await fetchProfile();
      setMonthlyGoal(profile.monthly_revenue_goal ? parseFloat(profile.monthly_revenue_goal) : null);
    } catch (err) {
      toast.error(err.message || 'Unable to load profile');
    }
  }, [toast]);

  const loadServicesCatalog = useCallback(async () => {
    setServicesCatalogLoading(true);
    try {
      const data = await fetchServices();
      setServicesCatalog(Array.isArray(data) ? data.filter((s) => s.active !== false) : []);
    } catch (err) {
      console.warn('[ActiveClients] failed to load services catalog:', err.message);
    } finally {
      setServicesCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
    loadServicesCatalog();
  }, [loadProfile, loadServicesCatalog]);

  const drawerClient = useMemo(
    () => (drawerClientId ? clients.find((c) => c.id === drawerClientId) || null : null),
    [drawerClientId, clients]
  );

  const handleRedactClick = () => setRedactConfirmOpen(true);

  const handleRedactConfirm = async () => {
    setRedactConfirmOpen(false);
    try {
      const result = await redactOldServices();
      toast.success(`Successfully redacted ${result.redacted_count} service(s)`);
    } catch (err) {
      toast.error(err.message || 'Unable to redact services');
    }
  };

  const handleArchiveClick = useCallback((client) => {
    if (!client?.id) return;
    setArchiveConfirm({ open: true, client });
  }, []);

  const handleArchiveConfirm = useCallback(async () => {
    const { client } = archiveConfirm;
    if (!client?.id) return;
    const label = client.client_name || client.client_email || 'this client';
    setArchiveConfirm({ open: false, client: null });
    try {
      await archive(client);
      setDrawerClientId((prev) => (prev === client.id ? null : prev));
      toast.success(`${label} archived`);
    } catch (err) {
      toast.error(err.message || 'Unable to archive client');
    }
  }, [archiveConfirm, archive, toast]);

  const handleRestoreClick = useCallback((client) => {
    if (!client?.id) return;
    setRestoreConfirm({ open: true, client });
  }, []);

  const handleRestoreConfirm = useCallback(async () => {
    const { client } = restoreConfirm;
    if (!client?.id) return;
    const label = client.client_name || client.client_email || 'this client';
    setRestoreConfirm({ open: false, client: null });
    try {
      await restore(client);
      setDrawerClientId((prev) => (prev === client.id ? null : prev));
      toast.success(`${label} restored`);
    } catch (err) {
      toast.error(err.message || 'Unable to restore client');
    }
  }, [restoreConfirm, restore, toast]);

  // Revenue + monthly goal are only meaningful on the active view.
  const totalRevenue = useMemo(
    () =>
      clients.reduce((sum, client) => {
        const clientRevenue = client.services?.reduce((s, srv) => s + (parseFloat(srv.agreed_price) || 0), 0) || 0;
        return sum + clientRevenue;
      }, 0),
    [clients]
  );

  const currentMonth = new Date();
  const monthStart = useMemo(() => new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1), [currentMonth]);
  const monthlyRevenue = useMemo(
    () =>
      clients.reduce((sum, client) => {
        const agreedDate = new Date(client.agreed_date);
        if (agreedDate >= monthStart) {
          const clientRevenue = client.services?.reduce((s, srv) => s + (parseFloat(srv.agreed_price) || 0), 0) || 0;
          return sum + clientRevenue;
        }
        return sum;
      }, 0),
    [clients, monthStart]
  );

  const goalProgress = monthlyGoal && monthlyGoal > 0 ? (monthlyRevenue / monthlyGoal) * 100 : 0;
  const isActiveView = status === 'active';

  return (
    <MainCard
      title="Client List"
      secondary={
        isActiveView ? (
          <Button variant="outlined" onClick={handleRedactClick}>
            Redact Old Services
          </Button>
        ) : null
      }
    >
      <Stack spacing={3}>
        <Tabs
          value={status}
          onChange={(_, v) => setStatus(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
        >
          <Tab value="active" label="Active" sx={{ minHeight: 40 }} />
          <Tab value="archived" label="Archived" sx={{ minHeight: 40 }} />
        </Tabs>

        {/* Monthly Revenue Goal Progress — active view only */}
        {isActiveView && monthlyGoal && (
          <Box sx={{ p: 3, bgcolor: 'primary.lighter', borderRadius: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h5">Monthly Revenue Goal</Typography>
                <Typography variant="h4" color="primary">
                  ${monthlyRevenue.toFixed(2)} / ${monthlyGoal.toFixed(2)}
                </Typography>
              </Stack>
              <Box sx={{ position: 'relative' }}>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(goalProgress, 100)}
                  sx={{
                    height: 20,
                    borderRadius: 1,
                    bgcolor: 'grey.200',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: goalProgress >= 100 ? 'success.main' : 'primary.main'
                    }
                  }}
                />
                <Typography
                  variant="body2"
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontWeight: 'bold',
                    color: goalProgress > 50 ? 'white' : 'text.primary'
                  }}
                >
                  {goalProgress.toFixed(1)}%
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Revenue from clients added this month ({currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })})
              </Typography>
            </Stack>
          </Box>
        )}

        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h6" color={isActiveView ? 'primary' : 'text.secondary'}>
            {isActiveView ? 'Total All-Time Revenue:' : 'Archived Revenue (historical):'} ${totalRevenue.toFixed(2)}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <TextField
            size="small"
            placeholder="Search clients…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
            sx={{ width: { xs: '100%', sm: 260 } }}
          />
        </Stack>

        {loadError && !loading && !clients.length ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => reloadClients().catch(() => {})}>
                Retry
              </Button>
            }
          >
            {loadError.message || 'Unable to load active clients.'}
          </Alert>
        ) : (
          <ActiveClientGroupedView
            clients={clients}
            clientsLoading={loading}
            onOpenClient={(c) => setDrawerClientId(c?.id || null)}
            // /active-clients is a standalone route, not nested in ClientPortal,
            // so the lead-detail drawer isn't reachable in place. Soft-nav into
            // the portal's leads tab; LeadsTab's ?lead= deep-link picks it up.
            onOpenLeadDetail={(call) => {
              if (!call?.id) return;
              navigate(`/portal?tab=leads&lead=${encodeURIComponent(call.id)}`);
            }}
            searchQuery={searchQuery}
          />
        )}
      </Stack>

      {/* Drawer shared between active + archived; flips Archive↔Restore by client.archived_at */}
      <ActiveClientDrawer
        open={Boolean(drawerClient)}
        client={drawerClient}
        servicesCatalog={servicesCatalog}
        servicesCatalogLoading={servicesCatalogLoading}
        onClose={() => setDrawerClientId(null)}
        onArchive={handleArchiveClick}
        onRestore={handleRestoreClick}
        onAddServices={addServices}
        onOpenLeadDetail={(call) => {
          if (!call?.id) return;
          navigate(`/portal?tab=leads&lead=${encodeURIComponent(call.id)}`);
        }}
        triggerMessage={(type, text) => (type === 'error' ? toast.error(text) : toast.success(text))}
      />

      {/* Redact Old Services Confirmation */}
      <ConfirmDialog
        open={redactConfirmOpen}
        onClose={() => setRedactConfirmOpen(false)}
        onConfirm={handleRedactConfirm}
        title="Redact Old Services"
        message="Redact all services older than 90 days?"
        secondaryText="This will preserve revenue data but hide service details."
        confirmLabel="Redact"
        confirmColor="warning"
      />

      {/* Archive Client Confirmation */}
      <ConfirmDialog
        open={archiveConfirm.open}
        onClose={() => setArchiveConfirm({ open: false, client: null })}
        onConfirm={handleArchiveConfirm}
        title="Archive Client"
        message={
          <Typography>
            Move <strong>{archiveConfirm.client?.client_name || archiveConfirm.client?.client_email || 'this client'}</strong> to the
            archive?
          </Typography>
        }
        secondaryText="Archiving the client also archives any linked lead journey. They can be restored later."
        confirmLabel="Archive"
        confirmColor="error"
      />

      {/* Restore Client Confirmation */}
      <ConfirmDialog
        open={restoreConfirm.open}
        onClose={() => setRestoreConfirm({ open: false, client: null })}
        onConfirm={handleRestoreConfirm}
        title="Restore Client"
        message={
          <Typography>
            Restore <strong>{restoreConfirm.client?.client_name || restoreConfirm.client?.client_email || 'this client'}</strong> to
            active?
          </Typography>
        }
        secondaryText="The linked lead journey will also be reactivated."
        confirmLabel="Restore"
        confirmColor="success"
      />
    </MainCard>
  );
}
