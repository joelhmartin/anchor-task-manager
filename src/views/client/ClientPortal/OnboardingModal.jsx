import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import FireworksCanvas from 'ui-component/FireworksCanvas';

export default function OnboardingModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(Boolean(location.state?.onboardingComplete));

  // Clear navigation state after showing the modal so it doesn't re-open on subsequent navigations.
  useEffect(() => {
    if (open && location.state?.onboardingComplete) {
      navigate(location.pathname + location.search, { replace: true, state: {} });
    }
  }, [open, location.pathname, location.search, location.state, navigate]);

  if (!open) return null;

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 2200 }}>
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(10, 14, 26, 0.5)', zIndex: 0 }} />
      <FireworksCanvas style={{ zIndex: 1 }} />
      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            maxWidth: 560,
            p: { xs: 3, md: 4 },
            borderRadius: 3,
            bgcolor: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.55)'
          }}
        >
          <Stack spacing={2.25}>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.6 }}>
              Thank you for completing your onboarding
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Your account is ready for the next steps. We've saved your details.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Next step: schedule a quick kick-off with your Account Manager.
            </Typography>
            <Button
              component="a"
              href="https://calendar.app.google/zgRn9gFuVizsnMmM9"
              target="_blank"
              rel="noopener noreferrer"
              variant="contained"
              size="large"
              fullWidth
            >
              Schedule a meeting with your Account Manager
            </Button>
            <Button variant="text" onClick={() => setOpen(false)} sx={{ alignSelf: 'center' }}>
              Close
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
