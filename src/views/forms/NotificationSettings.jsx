/**
 * NotificationSettings — Per-form email notification configuration.
 *
 * Features:
 * - Toggle notifications on/off
 * - Custom recipient emails (override account defaults)
 * - Subject template with {{field}} token insertion
 * - Body template with {{field}} token insertion
 * - Toggle include field values in email
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import AddIcon from '@mui/icons-material/Add';

import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import {
  getNotificationOverride,
  upsertNotificationOverride,
  deleteNotificationOverride
} from 'api/forms';

export default function NotificationSettings({ formId, form, schemaFields }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasOverride, setHasOverride] = useState(false);

  // Form state
  const [enabled, setEnabled] = useState(true);
  const [recipients, setRecipients] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [ccEmails, setCcEmails] = useState([]);
  const [newCc, setNewCc] = useState('');
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [includeFieldValues, setIncludeFieldValues] = useState(true);

  const isIntake = form?.form_type === 'intake';

  // Load existing override
  const loadConfig = useCallback(async () => {
    if (!formId) return;
    try {
      setLoading(true);
      const override = await getNotificationOverride(formId);
      if (override) {
        setHasOverride(true);
        setEnabled(override.enabled ?? true);
        setRecipients(override.recipient_emails || []);
        setCcEmails(override.cc_emails || []);
        setSubjectTemplate(override.subject_template || '');
        setBodyTemplate(override.body_template || '');
        setIncludeFieldValues(override.include_field_values ?? true);
      }
    } catch {
      // No override exists — that's fine
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await upsertNotificationOverride(formId, {
        recipientEmails: recipients,
        ccEmails,
        subjectTemplate: subjectTemplate || null,
        bodyTemplate: bodyTemplate || null,
        includeFieldValues: isIntake ? false : includeFieldValues,
        enabled
      });
      setHasOverride(true);
      showToast('Notification settings saved', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setSaving(true);
      await deleteNotificationOverride(formId);
      setHasOverride(false);
      setRecipients([]);
      setCcEmails([]);
      setSubjectTemplate('');
      setBodyTemplate('');
      setIncludeFieldValues(true);
      setEnabled(true);
      showToast('Notification override removed — using account defaults', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const addRecipient = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email address', 'error');
      return;
    }
    if (recipients.includes(email)) return;
    setRecipients([...recipients, email]);
    setNewEmail('');
  };

  const removeRecipient = (email) => {
    setRecipients(recipients.filter((e) => e !== email));
  };

  const addCc = () => {
    const email = newCc.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email address', 'error');
      return;
    }
    if (ccEmails.includes(email)) return;
    setCcEmails([...ccEmails, email]);
    setNewCc('');
  };

  const removeCc = (email) => {
    setCcEmails(ccEmails.filter((e) => e !== email));
  };

  // Get available field tokens for insertion
  const fieldTokens = (schemaFields || [])
    .filter((f) => !['heading', 'paragraph', 'divider', 'score_display', 'hidden'].includes(f.type))
    .map((f) => ({ name: f.name, label: f.label }));

  const insertToken = (fieldName, target) => {
    const token = `{{${fieldName}}}`;
    if (target === 'subject') {
      setSubjectTemplate((prev) => (prev ? `${prev} ${token}` : token));
    } else {
      setBodyTemplate((prev) => (prev ? `${prev} ${token}` : token));
    }
  };

  if (!formId) {
    return <Alert severity="info">Select a form first to configure notifications.</Alert>;
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">Email Notifications</Typography>
        <Stack direction="row" spacing={1}>
          {hasOverride && (
            <Tooltip title="Revert to account defaults">
              <IconButton size="small" onClick={handleReset} disabled={saving}>
                <RestoreIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <LoadingButton
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            loading={saving}
            loadingLabel="Saving..."
          >
            Save
          </LoadingButton>
        </Stack>
      </Stack>

      <FormControlLabel
        control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
        label="Send email on submission"
      />

      {enabled && (
        <>
          <Divider />

          {/* Recipients */}
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Recipients {recipients.length === 0 && '(using account defaults)'}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
            {recipients.map((email) => (
              <Chip key={email} label={email} size="small" onDelete={() => removeRecipient(email)} />
            ))}
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              placeholder="email@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRecipient())}
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={addRecipient}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Stack>

          {/* CC */}
          <Typography variant="caption" color="text.secondary" fontWeight={600}>CC</Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
            {ccEmails.map((email) => (
              <Chip key={email} label={email} size="small" onDelete={() => removeCc(email)} />
            ))}
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              placeholder="cc@example.com"
              value={newCc}
              onChange={(e) => setNewCc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCc())}
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={addCc}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Divider />

          {/* Include field values toggle */}
          {isIntake ? (
            <Alert severity="info" sx={{ fontSize: 12 }}>
              Intake forms never include field values in emails (HIPAA compliance). Only a secure portal link is sent.
            </Alert>
          ) : (
            <FormControlLabel
              control={<Switch checked={includeFieldValues} onChange={(e) => setIncludeFieldValues(e.target.checked)} />}
              label="Include field values in email"
            />
          )}

          <Divider />

          {/* Subject template */}
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Subject Template
          </Typography>
          <TextField
            size="small"
            placeholder={`New ${form?.name || 'Form'} Submission`}
            value={subjectTemplate}
            onChange={(e) => setSubjectTemplate(e.target.value)}
            fullWidth
            helperText="Use {{field_name}} for dynamic values"
          />

          {/* Body template */}
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Body Template (optional)
          </Typography>
          <TextField
            size="small"
            multiline
            rows={4}
            placeholder="Leave empty for default email template"
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
            fullWidth
            helperText="Use {{field_name}} for dynamic values"
          />

          {/* Token insertion */}
          {fieldTokens.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                Insert Field Token
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
                {fieldTokens.map((f) => (
                  <Chip
                    key={f.name}
                    label={f.label || f.name}
                    size="small"
                    variant="outlined"
                    onClick={() => insertToken(f.name, 'body')}
                    sx={{ cursor: 'pointer', fontSize: 11 }}
                  />
                ))}
              </Stack>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
