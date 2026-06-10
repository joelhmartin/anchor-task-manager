import { useCallback, useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import SelectField from 'ui-component/extended/SelectField';
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from 'constants/timezones';
import { fetchMyProfile, updateMyProfile, uploadMyAvatar } from 'api/profile';
import useAuth from 'hooks/useAuth';
import { clientLabel } from 'hooks/useClientLabel';

export default function ProfileTab({ triggerMessage, refreshUser }) {
  const { user, activeClientAccount } = useAuth();
  // Revenue goal is a client-owner setting. If the viewer is a group/invited member
  // looking at someone else's account, don't show the field — they'd only be editing
  // their own (likely unused) client_profile row, which is confusing.
  const isOwnAccount = !activeClientAccount || activeClientAccount.isSelfOwner;
  const showRevenueGoal = isOwnAccount && (user?.role === 'client' || user?.effectiveRole === 'client');
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({
    display_name: '',
    email: '',
    current_password: '',
    new_password: '',
    new_password_confirm: '',
    monthly_revenue_goal: '',
    timezone: DEFAULT_TIMEZONE
  });
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(() => {
    setProfileLoading(true);
    fetchMyProfile()
      .then((data) => {
        setProfile(data);
        setProfileForm({
          display_name: clientLabel(data),
          email: data.email,
          current_password: '',
          new_password: '',
          new_password_confirm: '',
          monthly_revenue_goal: data.monthly_revenue_goal || '',
          timezone: data.timezone || DEFAULT_TIMEZONE
        });
      })
      .catch((err) => triggerMessage('error', err.message || 'Unable to load profile'))
      .finally(() => setProfileLoading(false));
  }, [triggerMessage]);

  // Load on first render
  if (!profile && !profileLoading) loadProfile();

  const handleProfileSave = async () => {
    if (!profileForm.display_name || !profileForm.email) {
      triggerMessage('error', 'Display name and email are required');
      return;
    }
    const wantsPasswordChange = Boolean(profileForm.new_password || profileForm.new_password_confirm || profileForm.current_password);
    if (wantsPasswordChange) {
      if (!profileForm.current_password) {
        triggerMessage('error', 'Current password is required to set a new password');
        return;
      }
      if (!profileForm.new_password) {
        triggerMessage('error', 'New password is required');
        return;
      }
      if (profileForm.new_password !== profileForm.new_password_confirm) {
        triggerMessage('error', 'New passwords do not match');
        return;
      }
    }
    setProfileLoading(true);
    try {
      const payload = {
        first_name: profileForm.display_name.split(' ')[0] || profileForm.display_name,
        last_name: profileForm.display_name.split(' ').slice(1).join(' '),
        email: profileForm.email
      };
      if (showRevenueGoal) {
        payload.monthly_revenue_goal = profileForm.monthly_revenue_goal ? parseFloat(profileForm.monthly_revenue_goal) : null;
        payload.timezone = profileForm.timezone || DEFAULT_TIMEZONE;
      }
      if (wantsPasswordChange) {
        payload.password = profileForm.current_password;
        payload.new_password = profileForm.new_password;
      }
      const updated = await updateMyProfile(payload);
      setProfile(updated);
      triggerMessage('success', 'Profile saved');
      try {
        await refreshUser();
      } catch {}
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to save profile');
    } finally {
      setProfileLoading(false);
      setProfileForm((prev) => ({ ...prev, current_password: '', new_password: '', new_password_confirm: '' }));
    }
  };

  const handleAvatarUpload = async (file) => {
    if (!file) return;
    try {
      await uploadMyAvatar(file);
      triggerMessage('success', 'Avatar updated');
      loadProfile();
      try {
        await refreshUser();
      } catch {}
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to upload avatar');
    }
  };

  return (
    <Box data-tutorial="profile-form">
      {profileLoading && !profile && <LinearProgress />}
      {profile && (
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <Avatar src={profile.avatar_url || ''} sx={{ width: 96, height: 96 }} />
            <Button variant="outlined" component="label">
              Upload Photo
              <input type="file" hidden accept="image/*" onChange={(e) => handleAvatarUpload(e.target.files?.[0])} />
            </Button>
          </Stack>
          <Stack spacing={2}>
            <TextField
              label="Display Name"
              fullWidth
              value={profileForm.display_name}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, display_name: e.target.value }))}
            />
            <TextField
              label="Email"
              type="email"
              fullWidth
              value={profileForm.email}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
            />
            <TextField
              label="Current Password"
              type="password"
              fullWidth
              value={profileForm.current_password}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, current_password: e.target.value }))}
              InputProps={{
                endAdornment: <InputAdornment position="end">Required to change password</InputAdornment>
              }}
            />
            <TextField
              label="New Password"
              type="password"
              fullWidth
              value={profileForm.new_password}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, new_password: e.target.value }))}
            />
            <TextField
              label="Confirm New Password"
              type="password"
              fullWidth
              value={profileForm.new_password_confirm}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, new_password_confirm: e.target.value }))}
            />
            {showRevenueGoal && (
              <TextField
                label="Monthly Revenue Goal"
                type="number"
                fullWidth
                value={profileForm.monthly_revenue_goal}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, monthly_revenue_goal: e.target.value }))}
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>
                }}
                inputProps={{ step: '0.01', min: '0' }}
                helperText="Track progress towards your monthly goal in Client List"
              />
            )}
            {showRevenueGoal && (
              <SelectField
                label="Timezone"
                value={profileForm.timezone || DEFAULT_TIMEZONE}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, timezone: e.target.value }))}
                options={TIMEZONE_OPTIONS}
                helperText="Your business's local timezone. Used for the call-volume heat map and other time-of-day analytics."
              />
            )}
          </Stack>
          <Button variant="contained" onClick={handleProfileSave} disabled={profileLoading} sx={{ alignSelf: 'flex-start' }}>
            {profileLoading ? 'Saving…' : 'Save Profile'}
          </Button>
        </Stack>
      )}
    </Box>
  );
}
