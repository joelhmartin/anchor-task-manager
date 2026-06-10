import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Button, Card, CardContent, Divider, Link, Stack, TextField, Typography } from '@mui/material';

import useAuth from 'hooks/useAuth';

// The Task Manager does not own login. In production, users arrive with a valid
// SSO session minted by the main app (anchor-hub). This page provides:
//   - a "continue in the main app" handoff (production), and
//   - a lightweight dev login shim (when the backend has DEV_LOGIN enabled).
const MAIN_APP_URL = import.meta.env.VITE_MAIN_APP_URL || '';
const DEV_LOGIN = import.meta.env.VITE_DEV_LOGIN !== 'false';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const from = location.state?.from?.pathname || '/tasks';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login({ email, role: 'admin' });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1} sx={{ mb: 3 }}>
            <Typography variant="h3">Anchor Tasks</Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in to continue.
            </Typography>
          </Stack>

          {MAIN_APP_URL && (
            <>
              <Button fullWidth variant="contained" size="large" href={`${MAIN_APP_URL}/pages/login`}>
                Continue in the Anchor Hub
              </Button>
              {DEV_LOGIN && (
                <Divider sx={{ my: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    or dev login
                  </Typography>
                </Divider>
              )}
            </>
          )}

          {DEV_LOGIN && (
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <TextField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  fullWidth
                  autoFocus
                />
                {error && (
                  <Typography variant="body2" color="error">
                    {error}
                  </Typography>
                )}
                <Button type="submit" fullWidth variant="contained" size="large" disabled={submitting || !email}>
                  {submitting ? 'Signing in…' : 'Dev sign in'}
                </Button>
              </Stack>
            </Box>
          )}

          {!MAIN_APP_URL && !DEV_LOGIN && (
            <Typography variant="body2" color="text.secondary">
              Login is handled by the main app. Set <code>VITE_MAIN_APP_URL</code> to enable the handoff.
            </Typography>
          )}

          {MAIN_APP_URL && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
              Trouble signing in?{' '}
              <Link href={`${MAIN_APP_URL}/pages/login`} underline="hover">
                Open the Anchor Hub
              </Link>
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
