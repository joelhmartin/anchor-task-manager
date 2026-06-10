import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Typography from '@mui/material/Typography';

import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import RichTextEditor from 'ui-component/extended/RichTextEditor';
import { useToast } from 'contexts/ToastContext';
import { fetchEmailTemplatesWithMeta } from 'api/journeyTemplates';
import AttachmentPicker from './AttachmentPicker';
import TokenChips from './TokenChips';

const NO_TEMPLATES_OPTIONS = [{ value: '', label: 'No templates' }];

// Reply-To is sent as an array; edited here as a comma-separated string.
const parseEmails = (s) =>
  String(s || '')
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter(Boolean);
const formatEmails = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');

const DEFAULT_OFFSET_DAYS = 7;

function defaultScheduleLocal() {
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_OFFSET_DAYS);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // for <input type=datetime-local>
}

export default function SendEmailDialog({ open, onClose, onSubmit, onManageTemplates, smsEnabled = false, recipientEmail = '', recipientName = '' }) {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [meta, setMeta] = useState({ from_name: '', from_address: '', default_reply_to: [] });
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState([]);
  const [attachments, setAttachments] = useState([]); // [{ file_id, name }]
  const [timing, setTiming] = useState('now'); // now | schedule
  const [when, setWhen] = useState(defaultScheduleLocal());
  const [channel, setChannel] = useState('email'); // email | both
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchEmailTemplatesWithMeta()
      .then(({ templates: t, meta: m }) => {
        setTemplates(t);
        setMeta(m);
        // Prefill Reply-To with the practice default until a template overrides it.
        setReplyTo(Array.isArray(m.default_reply_to) ? m.default_reply_to : []);
      })
      .catch(() => {
        setTemplates([]);
        setReplyTo([]);
      });
    setTemplateId('');
    setSubject('');
    setPreheader('');
    setBody('');
    setAttachments([]);
    setTiming('now');
    setWhen(defaultScheduleLocal());
    setChannel('email');
  }, [open]);

  const applyTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject || '');
      setPreheader(t.preheader || '');
      setBody(t.body || '');
      setAttachments(Array.isArray(t.attachments) ? t.attachments : []);
      // Template reply_to wins; otherwise fall back to the practice default.
      setReplyTo(Array.isArray(t.reply_to) && t.reply_to.length ? t.reply_to : meta.default_reply_to || []);
    } else {
      setSubject('');
      setPreheader('');
      setBody('');
      setAttachments([]);
      setReplyTo(meta.default_reply_to || []);
    }
  };

  const handleSubmit = async () => {
    if (!subject.trim() && !body.trim()) {
      toast.error('Add a subject or body first.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        template_id: templateId || null,
        subject,
        preheader,
        body,
        body_format: 'html',
        reply_to: replyTo,
        attachment_file_ids: attachments.map((a) => a.file_id),
        scheduled_for: timing === 'schedule' ? new Date(when).toISOString() : null,
        channel
      });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not send the email.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Send email"
      submitLabel={timing === 'schedule' ? 'Schedule' : 'Send now'}
      loading={saving}
      maxWidth="sm"
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {/* Recipient — resolved server-side from the contact; shown read-only so the
            sender can see exactly where it's going (and is warned when none is on file). */}
        {recipientEmail ? (
          <Typography variant="body2" color="text.secondary">
            To: <strong>{recipientName || 'this lead'}</strong> &lt;{recipientEmail}&gt;
          </Typography>
        ) : (
          <Typography variant="body2" color="error">
            No email on file for this lead — add one to the contact before sending.
          </Typography>
        )}
        <Box>
          <SelectField
            label="Template (optional)"
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            options={
              templates.length > 0
                ? [{ value: '', label: 'Custom email' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]
                : NO_TEMPLATES_OPTIONS
            }
            disabled={templates.length === 0}
            fullWidth
          />
          {templates.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              No email templates yet — create one in the{' '}
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => {
                  onClose();
                  onManageTemplates?.();
                }}
              >
                Email Templates tab
              </Link>
              .
            </Typography>
          )}
        </Box>
        <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} fullWidth />
        <TextField
          label="Preview Text"
          value={preheader}
          onChange={(e) => setPreheader(e.target.value)}
          helperText="Shows in the inbox preview"
          fullWidth
        />
        {(meta.from_name || meta.from_address) && (
          <Typography variant="caption" color="text.secondary">
            Sending as <strong>{meta.from_name || 'Anchor'}</strong>
            {meta.from_address ? ` <${meta.from_address}>` : ''}
          </Typography>
        )}
        <TextField
          label="Reply-To"
          value={formatEmails(replyTo)}
          onChange={(e) => setReplyTo(parseEmails(e.target.value))}
          placeholder={meta.default_reply_to?.length ? meta.default_reply_to.join(', ') : 'you@yourpractice.com'}
          helperText="Where replies to this email go. Separate multiple addresses with commas."
          fullWidth
        />
        <TokenChips />
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Body
          </Typography>
          <RichTextEditor value={body} onChange={setBody} minHeight={220} placeholder="Write your email…" />
        </Box>
        <AttachmentPicker value={attachments} onChange={setAttachments} />
        <Box>
          <Typography variant="caption" color="text.secondary">
            When
          </Typography>
          <ToggleButtonGroup exclusive size="small" value={timing} onChange={(_, v) => v && setTiming(v)} sx={{ ml: 1 }}>
            <ToggleButton value="now">Send now</ToggleButton>
            <ToggleButton value="schedule">Schedule</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {timing === 'schedule' && (
          <TextField
            type="datetime-local"
            label="Scheduled for"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        )}
        <Box>
          <Typography variant="caption" color="text.secondary">
            Channel
          </Typography>
          <ToggleButtonGroup exclusive size="small" value={channel} onChange={(_, v) => v && setChannel(v)} sx={{ ml: 1 }}>
            <ToggleButton value="email">Email</ToggleButton>
            <ToggleButton value="both" disabled={!smsEnabled}>
              Email + Text{!smsEnabled ? ' (soon)' : ''}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Stack>
    </FormDialog>
  );
}
