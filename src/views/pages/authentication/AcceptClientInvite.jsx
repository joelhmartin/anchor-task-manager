/**
 * AcceptClientInvite - Client Team Invite Acceptance Page
 *
 * Allows invited users to accept their invitation and set up their account.
 * This is a public page (no authentication required).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';

import GroupAddIcon from '@mui/icons-material/GroupAdd';

import { validateInviteToken, acceptInvite } from 'api/clientTeam';
import useAuth from 'hooks/useAuth';

import AuthWrapper1 from './AuthWrapper1';
import AuthCardWrapper from './AuthCardWrapper';
import AnimateButton from 'ui-component/extended/AnimateButton';
import CustomFormControl from 'ui-component/extended/Form/CustomFormControl';
import Logo from 'ui-component/Logo';
import AuthFooter from 'ui-component/cards/AuthFooter';

export default function AcceptClientInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { setAuthState } = useAuth();
  const matchDownSM = useMediaQuery((theme) => theme.breakpoints.down('md'));

  // Token validation state
  const [validating, setValidating] = useState(true);
  const [inviteData, setInviteData] = useState(null);
  const [tokenError, setTokenError] = useState('');

  // Form state
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);
  const [redirectToLogin, setRedirectToLogin] = useState(false);

  // Validate token on mount
  useEffect(() => {
    async function validate() {
      try {
        const data = await validateInviteToken(token);
        setInviteData(data);
        // Pre-fill first name if provided
        if (data.firstName) {
          setForm((prev) => ({ ...prev, firstName: data.firstName }));
        }
      } catch (err) {
        setTokenError(err.response?.data?.message || 'This invitation link is invalid or has expired.');
      } finally {
        setValidating(false);
      }
    }
    validate();
  }, [token]);

  const hasExistingAccount = Boolean(inviteData?.hasExistingAccount);
  const existingAccountHasPassword = Boolean(inviteData?.existingAccountHasPassword);
  const isOwnerInvite = inviteData?.role === 'owner';
  const requiresPasswordSetup = Boolean(inviteData?.requiresPasswordSetup ?? (isOwnerInvite || !existingAccountHasPassword));
  const requiresProfileDetails = Boolean(inviteData?.requiresProfileDetails ?? (!hasExistingAccount && !isOwnerInvite));
  const inviteTargetLabel = inviteData?.businessName || (inviteData?.inviteScope === 'group' ? 'this group' : 'this account');

  const passwordsMatch = useMemo(() => form.password && form.password === form.confirmPassword, [form.password, form.confirmPassword]);

  const formValid = useMemo(
    () =>
      Boolean((!requiresProfileDetails || form.firstName) && (!requiresPasswordSetup || (form.password && form.password.length >= 8 && passwordsMatch))),
    [form.firstName, form.password, passwordsMatch, requiresPasswordSetup, requiresProfileDetails]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formValid) {
      setSubmitError('Please fill in all required fields correctly.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      const result = await acceptInvite(token, {
        firstName: requiresProfileDetails ? form.firstName : undefined,
        lastName: requiresProfileDetails ? form.lastName : undefined,
        password: requiresPasswordSetup ? form.password : undefined
      });

      // Backend must return both accessToken and user for the session to be valid.
      // If either is missing (or redirectToLogin flag set), the invite was accepted
      // but the session wasn't created — redirect to login.
      if (result.accessToken && result.user && !result.redirectToLogin) {
        setAuthState({
          user: result.user,
          accessToken: result.accessToken
        });

        setSuccess(true);

        // Owner self-invites land on the portal root so the "Getting Started"
        // tutorial auto-starts. Team-member invites land on the Team tab so
        // they see their role context.
        const landingPath = inviteData?.role === 'owner' ? '/portal' : '/portal?tab=team';
        setTimeout(() => {
          navigate(landingPath, { replace: true });
        }, 1500);
      } else {
        // Invite accepted but no session — send to login
        setSuccess(true);
        setRedirectToLogin(true);
        setTimeout(() => {
          navigate('/pages/login', { replace: true });
        }, 2500);
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Failed to accept invitation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (validating) {
    return (
      <AuthWrapper1>
        <Grid container direction="column" justifyContent="center" alignItems="center" sx={{ minHeight: '100vh' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Validating invitation...</Typography>
        </Grid>
      </AuthWrapper1>
    );
  }

  // Error state
  if (tokenError) {
    return (
      <AuthWrapper1>
        <Grid container direction="column" justifyContent="flex-end" sx={{ minHeight: '100vh' }}>
          <Grid item xs={12}>
            <Grid container justifyContent="center" alignItems="center" sx={{ minHeight: 'calc(100vh - 68px)' }}>
              <Grid item sx={{ m: { xs: 1, sm: 3 }, mb: 0 }}>
                <AuthCardWrapper>
                  <Grid container spacing={2} alignItems="center" justifyContent="center">
                    <Grid item sx={{ mb: 3 }}>
                      <Link to="/" aria-label="Logo">
                        <Logo />
                      </Link>
                    </Grid>
                    <Grid item xs={12}>
                      <Alert severity="error" sx={{ mb: 2 }}>
                        {tokenError}
                      </Alert>
                      <Typography variant="body2" color="text.secondary" textAlign="center">
                        This invitation may have expired or already been used.
                        Please contact the person who invited you for a new link.
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <AnimateButton>
                        <Button
                          component={Link}
                          to="/pages/login"
                          variant="outlined"
                          fullWidth
                          size="large"
                        >
                          Go to Login
                        </Button>
                      </AnimateButton>
                    </Grid>
                  </Grid>
                </AuthCardWrapper>
              </Grid>
            </Grid>
          </Grid>
          <Grid item xs={12} sx={{ m: 3, mt: 1 }}>
            <AuthFooter />
          </Grid>
        </Grid>
      </AuthWrapper1>
    );
  }

  // Success state
  if (success) {
    return (
      <AuthWrapper1>
        <Grid container direction="column" justifyContent="center" alignItems="center" sx={{ minHeight: '100vh' }}>
          <Alert severity="success" sx={{ mb: 2 }}>
            {redirectToLogin
              ? 'Invite accepted! Please sign in to continue.'
              : isOwnerInvite
                ? 'Account ready!'
                : 'Invitation accepted!'}
          </Alert>
          <Typography>
            {redirectToLogin ? 'Redirecting to sign in...' : 'Redirecting to your dashboard...'}
          </Typography>
          <CircularProgress sx={{ mt: 2 }} />
        </Grid>
      </AuthWrapper1>
    );
  }

  // Main form
  return (
    <AuthWrapper1>
      <Grid container direction="column" justifyContent="flex-end" sx={{ minHeight: '100vh' }}>
        <Grid item xs={12}>
          <Grid container justifyContent="center" alignItems="center" sx={{ minHeight: 'calc(100vh - 68px)' }}>
            <Grid item sx={{ m: { xs: 1, sm: 3 }, mb: 0 }}>
              <AuthCardWrapper>
                <Grid container spacing={2} alignItems="center" justifyContent="center">
                  <Grid item sx={{ mb: 3 }}>
                    <Link to="/" aria-label="Logo">
                      <Logo />
                    </Link>
                  </Grid>
                  <Grid item xs={12}>
                    <Grid container direction={matchDownSM ? 'column-reverse' : 'row'} alignItems="center" justifyContent="center">
                      <Grid item>
                        <Stack alignItems="center" justifyContent="center" spacing={1}>
                          <GroupAddIcon color="primary" sx={{ fontSize: 40 }} />
                          <Typography color="secondary.main" gutterBottom variant={matchDownSM ? 'h4' : 'h3'}>
                            {isOwnerInvite ? 'Welcome to Anchor' : "You're Invited!"}
                          </Typography>
                          <Typography variant="caption" fontSize="16px" textAlign="center">
                            {isOwnerInvite
                              ? 'Your account is ready. Create your password to continue.'
                              : requiresPasswordSetup || requiresProfileDetails
                                ? <>Join <strong>{inviteTargetLabel}</strong> on Anchor.</>
                                : <>Accept this invitation to access <strong>{inviteTargetLabel}</strong>.</>}
                          </Typography>
                        </Stack>
                      </Grid>
                    </Grid>
                  </Grid>
                  {!isOwnerInvite && (
                    <Grid item xs={12}>
                      <Alert severity="info" sx={{ mb: 2 }}>
                        <strong>{inviteData?.inviterName}</strong> invited you to join as a <strong>{inviteData?.role}</strong>.
                      </Alert>
                    </Grid>
                  )}
                  <Grid item xs={12}>
                    <Box component="form" onSubmit={handleSubmit} sx={{ display: 'grid', gap: 2 }}>
                      {submitError && <Alert severity="error">{submitError}</Alert>}

                      <CustomFormControl fullWidth>
                        <InputLabel htmlFor="invite-email">Email Address</InputLabel>
                        <OutlinedInput
                          id="invite-email"
                          type="email"
                          value={inviteData?.email || ''}
                          disabled
                        />
                      </CustomFormControl>

                      {requiresProfileDetails ? (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                          <CustomFormControl fullWidth>
                            <InputLabel htmlFor="invite-first-name">First Name *</InputLabel>
                            <OutlinedInput
                              id="invite-first-name"
                              value={form.firstName}
                              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                              required
                            />
                          </CustomFormControl>
                          <CustomFormControl fullWidth>
                            <InputLabel htmlFor="invite-last-name">Last Name</InputLabel>
                            <OutlinedInput
                              id="invite-last-name"
                              value={form.lastName}
                              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                            />
                          </CustomFormControl>
                        </Stack>
                      ) : null}

                      {requiresPasswordSetup ? (
                        <>
                          <CustomFormControl fullWidth>
                            <InputLabel htmlFor="invite-password">Password *</InputLabel>
                            <OutlinedInput
                              id="invite-password"
                              type="password"
                              value={form.password}
                              onChange={(e) => setForm({ ...form, password: e.target.value })}
                              autoComplete="new-password"
                              required
                              error={form.password.length > 0 && form.password.length < 8}
                            />
                            {form.password.length > 0 && form.password.length < 8 && (
                              <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                                Password must be at least 8 characters
                              </Typography>
                            )}
                          </CustomFormControl>

                          <CustomFormControl fullWidth>
                            <InputLabel htmlFor="invite-confirm-password">Confirm Password *</InputLabel>
                            <OutlinedInput
                              id="invite-confirm-password"
                              type="password"
                              value={form.confirmPassword}
                              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                              autoComplete="new-password"
                              required
                              error={form.confirmPassword.length > 0 && !passwordsMatch}
                            />
                            {form.confirmPassword.length > 0 && !passwordsMatch && (
                              <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                                Passwords do not match
                              </Typography>
                            )}
                          </CustomFormControl>
                        </>
                      ) : null}

                      <AnimateButton>
                        <Button
                          type="submit"
                          variant="contained"
                          color="secondary"
                          fullWidth
                          size="large"
                          disabled={submitting || !formValid}
                        >
                          {submitting
                            ? isOwnerInvite
                              ? 'Activating Account...'
                              : requiresPasswordSetup || requiresProfileDetails
                                ? 'Creating Account...'
                                : 'Accepting Invitation...'
                            : isOwnerInvite
                              ? 'Activate Account'
                              : 'Accept Invitation'}
                        </Button>
                      </AnimateButton>
                    </Box>
                  </Grid>
                  <Grid item xs={12}>
                    <Divider />
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" textAlign="center">
                      Already have an account?{' '}
                      <Typography component={Link} to="/pages/login" variant="subtitle1" sx={{ textDecoration: 'none' }}>
                        Sign In
                      </Typography>
                    </Typography>
                  </Grid>
                </Grid>
              </AuthCardWrapper>
            </Grid>
          </Grid>
        </Grid>
        <Grid item xs={12} sx={{ m: 3, mt: 1 }}>
          <AuthFooter />
        </Grid>
      </Grid>
    </AuthWrapper1>
  );
}
