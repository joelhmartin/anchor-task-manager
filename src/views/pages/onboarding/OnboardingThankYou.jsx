import { Box, Container, Paper, Stack, Typography, Button } from '@mui/material';
import { useLocation, Link as RouterLink } from 'react-router-dom';
import FireworksCanvas from 'ui-component/FireworksCanvas';

const CALENDAR_LINK = 'https://calendar.app.google/zgRn9gFuVizsnMmM9';

export default function OnboardingThankYou() {
  const location = useLocation();
  const email = location.state?.email || '';

  return (
    <Box sx={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', bgcolor: '#0b1020' }}>
      {/* Subtle overlay */}
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          background:
            'radial-gradient(1200px 800px at 20% 10%, rgba(102,126,234,0.35) 0%, rgba(11,16,32,0.0) 60%), linear-gradient(180deg, rgba(11,16,32,0.55) 0%, rgba(11,16,32,0.85) 100%)'
        }}
      />

      {/* Fireworks effect (no background video) */}
      <FireworksCanvas style={{ zIndex: 1 }} />

      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 2,
          background: 'rgba(10, 14, 26, 0.55)'
        }}
      />

      <Container
        maxWidth="sm"
        sx={{
          position: 'relative',
          zIndex: 3,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          py: { xs: 6, md: 10 }
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            p: { xs: 3, md: 4 },
            borderRadius: 3,
            bgcolor: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.55)'
          }}
        >
          <Stack spacing={2.25}>
            <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.6 }}>
              Thank you for completing your onboarding
            </Typography>
            <Typography variant="body1" color="text.secondary">
              We appreciate you taking the time to share these details. Your onboarding form has been received, and your account is ready
              for the next steps.
            </Typography>

            <Typography variant="body2" color="text.secondary">
              Your account is ready{email ? ` (${email})` : ''}.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'column' }} spacing={1.25} sx={{ pt: 1 }}>
              {/* <Button
                component="a"
                href={CALENDAR_LINK}
                target="_blank"
                rel="noopener noreferrer"
                variant="contained"
                size="large"
                fullWidth
              >
                Schedule a meeting with your Account Manager
              </Button> */}
              <Button component={RouterLink} to="/portal" variant="text" size="large" fullWidth>
                Back to Dashboard
              </Button>
            </Stack>

            <Typography variant="caption" color="text.secondary">
              If you have any questions, reply to your onboarding email or reach out to your account manager directly.
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
