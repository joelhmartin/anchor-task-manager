import {
Alert,
  Avatar,
  Box,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  OutlinedInput,
  Stack,
  TextField,
  Typography,
  Button,
} from '@mui/material';
import { IconUser } from '@tabler/icons-react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

export default function ProfileStep({
  token,
  data,
  form,
  setForm,
  submitting,
  avatarPreviewUrl,
  setAvatarPreviewUrl,
  uploadAvatar,
  toast,
  getErrorMessage,
  showPassword,
  showConfirmPassword,
  onTogglePassword,
  onToggleConfirmPassword,
  onMouseDownPassword,
  strength,
  level,
  onChangePassword
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.4 }}>
        Create your login details
      </Typography>
      <Typography variant="body2" color="text.secondary">
        These details let you return to onboarding anytime and access your dashboard later.
      </Typography>
      <Stack spacing={2}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Profile
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            src={avatarPreviewUrl || form.avatar_url || ''}
            alt="Avatar"
            sx={{ width: 96, height: 96, bgcolor: 'grey.200', color: 'grey.600' }}
          >
            {!form.avatar_url && <IconUser size={36} />}
          </Avatar>
          <Button variant="outlined" component="label">
            Upload Avatar
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                // Immediate local preview for UX; revoke previous URL if any.
                if (avatarPreviewUrl && typeof URL !== 'undefined') {
                  URL.revokeObjectURL(avatarPreviewUrl);
                }
                const localUrl = typeof URL !== 'undefined' ? URL.createObjectURL(file) : '';
                setAvatarPreviewUrl(localUrl);
                try {
                  const res = await uploadAvatar(token, file);
                  setForm((prev) => ({ ...prev, avatar_url: res.data?.avatar_url || prev.avatar_url }));
                } catch (err) {
                  toast.error(getErrorMessage(err, 'Unable to upload avatar'));
                }
              }}
            />
          </Button>
        </Stack>
        <TextField
          label="Display Name"
          fullWidth
          value={form.display_name}
          onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
        />
        <TextField
          label="Email"
          fullWidth
          type="email"
          value={form.email}
          onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          placeholder="you@example.com"
          helperText="Enter the email address you'll use to log in"
          required={token}
          InputProps={{ readOnly: !token }}
        />

        <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
          Password
        </Typography>
        {token || !data?.user?.has_password ? (
          <>
            <FormControl fullWidth variant="outlined">
              <InputLabel htmlFor="client-onboarding-password">Password</InputLabel>
              <OutlinedInput
                id="client-onboarding-password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => onChangePassword(e.target.value)}
                endAdornment={
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={onTogglePassword}
                      onMouseDown={onMouseDownPassword}
                      edge="end"
                      size="large"
                    >
                      {showPassword ? <Visibility /> : <VisibilityOff />}
                    </IconButton>
                  </InputAdornment>
                }
                label="Password"
              />
            </FormControl>
            {strength !== 0 && (
              <Box sx={{ mt: 1 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 90, height: 8, borderRadius: '7px', bgcolor: level?.color }} />
                  <Typography variant="caption" color="text.secondary">
                    {level?.label}
                  </Typography>
                </Stack>
              </Box>
            )}
            <FormControl fullWidth variant="outlined">
              <InputLabel htmlFor="client-onboarding-password-confirm">Confirm Password</InputLabel>
              <OutlinedInput
                id="client-onboarding-password-confirm"
                type={showConfirmPassword ? 'text' : 'password'}
                value={form.password_confirm}
                onChange={(e) => setForm((prev) => ({ ...prev, password_confirm: e.target.value }))}
                endAdornment={
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle confirm password visibility"
                      onClick={onToggleConfirmPassword}
                      onMouseDown={onMouseDownPassword}
                      edge="end"
                      size="large"
                    >
                      {showConfirmPassword ? <Visibility /> : <VisibilityOff />}
                    </IconButton>
                  </InputAdornment>
                }
                label="Confirm Password"
              />
            </FormControl>
          </>
        ) : (
          <Alert severity="info">
            Your account is active. You can save and continue at any time. When you log back in, you’ll resume where you left off.
          </Alert>
        )}

        <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
          Business Communication
        </Typography>
        <TextField
          label="Main Business Phone Number"
          fullWidth
          value={form.call_tracking_main_number}
          onChange={(e) => setForm((prev) => ({ ...prev, call_tracking_main_number: e.target.value }))}
          placeholder="e.g., (555) 123-4567"
          helperText="Where should leads call you?"
        />
        <TextField
          label="Form Submission Recipient Email(s)"
          fullWidth
          value={form.form_email_recipients}
          onChange={(e) => setForm((prev) => ({ ...prev, form_email_recipients: e.target.value }))}
          placeholder="e.g., leads@practice.com"
          helperText="Where should website form submission emails go? Comma-separated if multiple."
        />

        <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
          Internal Communication
        </Typography>
        <TextField
          label="Front Desk Email(s)"
          fullWidth
          value={form.front_desk_emails}
          onChange={(e) => setForm((prev) => ({ ...prev, front_desk_emails: e.target.value }))}
          placeholder="e.g., frontdesk@practice.com, scheduling@practice.com"
          helperText="Comma-separated if multiple."
        />
        <TextField
          label="Office Admin (Name)"
          fullWidth
          value={form.office_admin_name}
          onChange={(e) => setForm((prev) => ({ ...prev, office_admin_name: e.target.value }))}
        />
        <TextField
          label="Office Admin (Email)"
          fullWidth
          value={form.office_admin_email}
          onChange={(e) => setForm((prev) => ({ ...prev, office_admin_email: e.target.value }))}
        />
        <TextField
          label="Office Admin (Phone)"
          fullWidth
          value={form.office_admin_phone}
          onChange={(e) => setForm((prev) => ({ ...prev, office_admin_phone: e.target.value }))}
        />
      </Stack>
    </Stack>
  );
}
