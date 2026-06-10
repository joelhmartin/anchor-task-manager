import { useEffect, useMemo, useState } from 'react';
import Typography from '@mui/material/Typography';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import FormDialog from 'ui-component/extended/FormDialog';
import { useToast } from 'contexts/ToastContext';
import { splitContact } from 'api/contacts';

// Builds a flat option list of the contact's identifiers (phones + emails).
const buildOptions = (phones = [], emails = []) => [
  ...phones.map((p) => ({ key: `phone:${p.id}`, type: 'phone', id: p.id, label: p.phone_e164 || p.phone_digits10 })),
  ...emails.map((e) => ({ key: `email:${e.id}`, type: 'email', id: e.id, label: e.email }))
];

export default function SplitContactDialog({ open, contact, phones = [], emails = [], onClose, onSplit }) {
  const toast = useToast();
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => buildOptions(phones, emails), [phones, emails]);

  useEffect(() => {
    if (open) setSelected('');
  }, [open, contact?.id]);

  const handleSubmit = async () => {
    const opt = options.find((o) => o.key === selected);
    if (!opt || !contact?.id) return;
    setSaving(true);
    try {
      const result = await splitContact(contact.id, opt.type, opt.id);
      const m = result?.moved || {};
      const parts = [];
      if (m.calls) parts.push(`${m.calls} ${m.calls === 1 ? 'activity' : 'activities'}`);
      if (m.journeys) parts.push(`${m.journeys} ${m.journeys === 1 ? 'journey' : 'journeys'}`);
      if (m.activeClients) parts.push(`${m.activeClients} client ${m.activeClients === 1 ? 'record' : 'records'}`);
      toast.success(parts.length ? `Split complete — moved ${parts.join(', ')}` : 'Split complete — new contact created');
      onSplit?.(result);
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Split failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Split this contact"
      maxWidth="sm"
      loading={saving}
      loadingLabel="Splitting…"
      submitLabel="Split off"
      submitDisabled={!selected}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Choose one phone or email to break out. It moves into a brand-new contact along with the activity
        that matches it. The original contact is kept.
      </Typography>
      {options.length ? (
        <RadioGroup value={selected} onChange={(e) => setSelected(e.target.value)}>
          {options.map((o) => (
            <FormControlLabel
              key={o.key}
              value={o.key}
              control={<Radio />}
              label={
                <Stack direction="row" spacing={1} alignItems="center">
                  {o.type === 'phone' ? <PhoneIcon fontSize="small" color="action" /> : <EmailIcon fontSize="small" color="action" />}
                  <Typography variant="body2">{o.label}</Typography>
                </Stack>
              }
            />
          ))}
        </RadioGroup>
      ) : (
        <Alert severity="info">This contact has only one identifier — there's nothing to split off.</Alert>
      )}
    </FormDialog>
  );
}
