import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import MainCard from 'ui-component/cards/MainCard';
import useAuth from 'hooks/useAuth';
import { fetchClients } from 'api/clients';
import { clientLabel } from 'hooks/useClientLabel';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import Button from '@mui/material/Button';

// Helper to check if email is a placeholder (used during client creation before onboarding)
const isPlaceholderEmail = (email) => (email || '').includes('@placeholder.anchor');

export default function ClientView() {
  const { user, initializing, setActingClient, clearActingClient, actingClientId } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const toast = useToast();

  const effectiveRole = user?.effective_role || user?.role;
  const isAllowed = effectiveRole === 'superadmin' || effectiveRole === 'admin';

  useEffect(() => {
    if (!isAllowed) return;
    setLoading(true);
    fetchClients()
      .then((rows) => setClients((rows || []).filter((c) => (c.role || 'client') === 'client')))
      .catch((err) => toast.error(getErrorMessage(err, 'Unable to load clients')))
      .finally(() => setLoading(false));
  }, [isAllowed]);

  if (initializing) return null;
  if (!isAllowed) return <Navigate to="/" replace />;

  return (
    <MainCard title="Jump to Client View">
      <Stack spacing={2}>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Select a client to switch into their view without changing your login session.
          </Typography>
          {actingClientId && (
            <Alert severity="info" action={<Button onClick={() => clearActingClient()}>Clear</Button>}>
              Currently viewing client context selected. Use "Clear" to return to your own view.
            </Alert>
          )}
        </Stack>
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <List disablePadding>
            {clients.map((c) => (
              (() => {
                const isClient = (c.role || 'client') === 'client';
                const onboardingComplete = Boolean(c.onboarding_completed_at);
                const canJump = !isClient || onboardingComplete;
                const displayEmail = isPlaceholderEmail(c.email) ? '' : (c.email || '');
                const secondary = `${displayEmail}${
                  isClient ? (onboardingComplete ? ' • Onboarding: Complete' : ' • Onboarding: Pending') : ''
                }`.replace(/^\s*•\s*/, ''); // Clean up leading bullet if no email
                return (
              <ListItem
                key={c.id}
                secondaryAction={
                  canJump ? (
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        if (isClient && !onboardingComplete) return;
                        const displayName = clientLabel(c) || 'Client';
                        setActingClient(c.id, displayName);
                        navigate('/portal');
                      }}
                    >
                      Jump to View
                    </Button>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Onboarding pending
                    </Typography>
                  )
                }
              >
                <ListItemText primary={`${c.first_name || ''} ${c.last_name || ''}`.trim() || (isPlaceholderEmail(c.email) ? 'New Client' : c.email)} secondary={secondary} />
              </ListItem>
                );
              })()
            ))}
            {!clients.length && (
              <ListItem>
                <ListItemText primary="No clients found" />
              </ListItem>
            )}
          </List>
        </Box>
      </Stack>
    </MainCard>
  );
}
