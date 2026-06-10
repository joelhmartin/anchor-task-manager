/**
 * NotificationsTab — Admin-only per-client notification settings.
 *
 * Controls default recipients and preferences for automated emails
 * sent on behalf of this client (form submissions, etc.).
 * Not accessible to the client themselves.
 */

import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

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
import { fetchClientDetail, updateClientNotifications } from 'api/clients';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NotificationsTab({ clientId }) {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Current saved recipients
  const [recipients, setRecipients] = useState([]);
  // Typing field — user types then hits Enter or comma to add
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchClientDetail(clientId)
      .then((client) => {
        const emails = client.form_notification_emails;
        setRecipients(Array.isArray(emails) ? emails : []);
      })
      .catch(() => showToast('Failed to load notification settings', 'error'))
      .finally(() => setLoading(false));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Auto-add if user pastes a comma-separated list
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
    // Commit any pending input before saving
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
      await updateClientNotifications(clientId, { form_notification_emails: finalRecipients });
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
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      {/* Form Submission Notifications */}
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <EmailIcon fontSize="small" color="primary" />
            <Typography variant="h6">Form Submission Notifications</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These email addresses receive a notification whenever a form is submitted for this client.
            Individual forms can override this list in their own notification settings.
          </Typography>

          <Divider sx={{ mb: 2 }} />

          {/* Chip input */}
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
            onClick={() => document.getElementById('notif-email-input')?.focus()}
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
              id="notif-email-input"
              variant="standard"
              placeholder={recipients.length ? 'Add another…' : 'Type an email and press Enter'}
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
            If no recipients are set here, form notifications fall back to the client&apos;s account email address.
          </Alert>
        </CardContent>
      </Card>

      <Box>
        <LoadingButton
          variant="contained"
          loading={saving}
          loadingLabel="Saving…"
          onClick={handleSave}
        >
          Save Notification Settings
        </LoadingButton>
      </Box>
    </Stack>
  );
}

NotificationsTab.propTypes = {
  clientId: PropTypes.string.isRequired
};
