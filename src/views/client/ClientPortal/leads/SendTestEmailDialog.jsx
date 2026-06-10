import { useContext, useEffect, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from 'ui-component/extended/FormDialog';
import { AuthContext } from 'contexts/AuthContext';
import { useToast } from 'contexts/ToastContext';
import { fetchTeamMembers } from 'api/clientTeam';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pick recipients for a template test send: choose from the account's team members or type
// any custom address. Submits a de-duped, validated array of emails to `onSubmit`.
export default function SendTestEmailDialog({ open, onClose, onSubmit }) {
  const { user } = useContext(AuthContext) || {};
  const toast = useToast();
  const [options, setOptions] = useState([]); // [{ email, label }]
  const [recipients, setRecipients] = useState([]); // string[] of emails
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Prefill with the current user's own email so "send to myself" is one click.
    setRecipients(user?.email && EMAIL_RE.test(user.email) ? [user.email] : []);
    fetchTeamMembers()
      .then((data) => {
        const members = Array.isArray(data?.members) ? data.members : [];
        setOptions(
          members
            .filter((m) => m.email && EMAIL_RE.test(m.email))
            .map((m) => {
              const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
              return { email: m.email, label: name ? `${name} — ${m.email}` : m.email };
            })
        );
      })
      .catch(() => setOptions([]));
  }, [open, user?.email]);

  const labelByEmail = useMemo(() => {
    const map = new Map();
    options.forEach((o) => map.set(o.email.toLowerCase(), o.label));
    return map;
  }, [options]);

  const handleSubmit = async () => {
    const cleaned = [...new Set(recipients.map((r) => String(r).trim()).filter(Boolean))];
    if (!cleaned.length) {
      toast.error('Add at least one recipient.');
      return;
    }
    const invalid = cleaned.find((r) => !EMAIL_RE.test(r));
    if (invalid) {
      toast.error(`Hmm, "${invalid}" doesn't look like an email.`);
      return;
    }
    setSending(true);
    try {
      await onSubmit(cleaned);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not send the test email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Send test email"
      submitLabel="Send test"
      loading={sending}
      maxWidth="sm"
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Sends the current draft through the real delivery path — with sample lead info and your branding — so you see exactly how it
          lands. Pick teammates or type any address.
        </Typography>
        <Autocomplete
          multiple
          freeSolo
          options={options.map((o) => o.email)}
          value={recipients}
          onChange={(_, val) => setRecipients(val.map((v) => String(v).trim()).filter(Boolean))}
          getOptionLabel={(opt) => String(opt)}
          renderOption={(props, opt) => (
            <li {...props} key={opt}>
              {labelByEmail.get(String(opt).toLowerCase()) || opt}
            </li>
          )}
          renderInput={(params) => <TextField {...params} label="Recipients" placeholder="name@example.com" autoFocus />}
        />
      </Stack>
    </FormDialog>
  );
}
