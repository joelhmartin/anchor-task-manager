/**
 * NotificationsTab — Client-facing notification settings.
 *
 * Allows clients to manage who receives form submission notification
 * emails at the account level. Same underlying data as the admin
 * NotificationsTab (form_notification_emails on client_profiles).
 */

import { useState, useEffect } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import EmailIcon from '@mui/icons-material/Email';
import AddIcon from '@mui/icons-material/Add';

import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { fetchProfile, updateNotificationSettings } from 'api/profile';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NotificationsTab() {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [recipients, setRecipients] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchProfile()
      .then((data) => {
        const emails = data.form_notification_emails;
        setRecipients(Array.isArray(emails) ? emails : []);
      })
      .catch(() => showToast('Failed to load notification settings', 'error'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addEmail = (raw) => {
    const email = raw.trim().replace(/,+$/, '');
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setInputError('Invalid email address');
      return;
    }
    if (recipients.includes(email)) {
      setInputError('Already in the list');
      return;
    }
    setRecipients((prev) => [...prev, email]);
    setInputValue('');
    setInputError('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addEmail(inputValue);
    }
    if (e.key === 'Backspace' && !inputValue && recipients.length) {
      setRecipients((prev) => prev.slice(0, -1));
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    if (val.includes(',')) {
      const parts = val.split(',');
      parts.slice(0, -1).forEach((p) => addEmail(p));
      setInputValue(parts[parts.length - 1]);
    } else {
      setInputValue(val);
      setInputError('');
    }
  };

  const handleRemove = (email) => {
    setRecipients((prev) => prev.filter((e) => e !== email));
  };

  const handleSave = async () => {
    const pending = inputValue.trim();
    let finalRecipients = recipients;
    if (pending) {
      if (!EMAIL_RE.test(pending)) {
        setInputError('Invalid email address — press Enter to add or clear the field first');
        return;
      }
      finalRecipients = recipients.includes(pending) ? recipients : [...recipients, pending];
      setRecipients(finalRecipients);
      setInputValue('');
    }

    try {
      setSaving(true);
      await updateNotificationSettings({ form_notification_emails: finalRecipients });
      showToast('Notification settings saved', 'success');
    } catch (err) {
      showToast(err?.response?.data?.message || 'Failed to save notification settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">Loading...</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <EmailIcon fontSize="small" color="primary" />
            <Typography variant="h6">Form Submission Notifications</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These email addresses will receive a notification whenever someone submits a form on your website.
            Type an email address and press Enter to add it.
          </Typography>

          <Divider sx={{ mb: 2 }} />

          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.75,
              p: 1.25,
              border: '1px solid',
              borderColor: inputError ? 'error.main' : 'divider',
              borderRadius: 1,
              minHeight: 56,
              cursor: 'text',
              '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` }
            }}
            onClick={() => document.getElementById('portal-notif-email-input')?.focus()}
          >
            {recipients.map((email) => (
              <Chip
                key={email}
                label={email}
                size="small"
                onDelete={() => handleRemove(email)}
              />
            ))}
            <TextField
              id="portal-notif-email-input"
              variant="standard"
              placeholder={recipients.length ? 'Add another...' : 'Type an email and press Enter'}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={() => { if (inputValue.trim()) addEmail(inputValue); }}
              error={!!inputError}
              InputProps={{
                disableUnderline: true,
                startAdornment: recipients.length === 0 && (
                  <InputAdornment position="start">
                    <AddIcon fontSize="small" color="action" />
                  </InputAdornment>
                )
              }}
              sx={{ flex: 1, minWidth: 200, '& input': { p: 0, height: 28 } }}
            />
          </Box>
          {inputError && (
            <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
              {inputError}
            </Typography>
          )}

          <Alert severity="info" sx={{ mt: 2 }}>
            If no recipients are set here, notifications will be sent to your account email address.
          </Alert>
        </CardContent>
      </Card>

      <Box>
        <LoadingButton
          variant="contained"
          loading={saving}
          loadingLabel="Saving..."
          onClick={handleSave}
        >
          Save Notification Settings
        </LoadingButton>
      </Box>
    </Stack>
  );
}
