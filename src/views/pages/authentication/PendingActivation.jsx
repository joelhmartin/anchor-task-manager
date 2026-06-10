import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';
import { IconClock, IconLogout } from '@tabler/icons-react';
import useAuth from 'hooks/useAuth';
import Loader from 'ui-component/Loader';

export default function PendingActivation() {
  const { user, logout, initializing } = useAuth();
  const navigate = useNavigate();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!initializing && !user) {
      navigate('/pages/login', { replace: true });
    }
  }, [user, initializing, navigate]);

  // If user becomes activated (e.g., admin activates while they're on this page), redirect to portal
  useEffect(() => {
    if (!initializing && user?.activated_at) {
      navigate('/portal', { replace: true });
    }
  }, [user?.activated_at, initializing, navigate]);

  if (initializing) return <Loader />;

  const handleLogout = async () => {
    await logout();
    navigate('/pages/login', { replace: true });
  };

  return (
    <Container maxWidth="sm" sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', py: 4 }}>
      <Paper elevation={2} sx={{ p: { xs: 3, md: 4 }, width: '100%' }}>
        <Stack spacing={3} alignItems="center" textAlign="center">
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              bgcolor: 'primary.lighter',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <IconClock size={40} stroke={1.5} color="var(--mui-palette-primary-main)" />
          </Box>

          <Typography variant="h3" sx={{ fontWeight: 700 }}>
            Almost There!
          </Typography>

          <Typography variant="body1" color="text.secondary">
            Thank you for completing your onboarding. Our team is now setting up your personalized dashboard.
          </Typography>

          <Typography variant="body1" color="text.secondary">
            We&apos;ll send you an email when everything is ready for you to log in and explore.
          </Typography>

          <Box sx={{ bgcolor: 'grey.100', borderRadius: 2, p: 2, width: '100%' }}>
            <Typography variant="body2" color="text.secondary">
              <strong>What happens next?</strong>
              <br />
              Our team reviews your information and configures your dashboard with the services and integrations you need.
              This typically takes 1-2 business days.
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary">
            If you have questions, reply to your onboarding email or contact your account manager.
          </Typography>

          <Button
            variant="outlined"
            color="inherit"
            startIcon={<IconLogout size={18} />}
            onClick={handleLogout}
            sx={{ mt: 2 }}
          >
            Sign Out
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
