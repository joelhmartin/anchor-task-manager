import { useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import EditIcon from '@mui/icons-material/Edit';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';

import DataTable from 'ui-component/extended/DataTable';
import FormDialog from 'ui-component/extended/FormDialog';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import RichTextEditor from 'ui-component/extended/RichTextEditor';
import { useToast } from 'contexts/ToastContext';
import {
  fetchEmailTemplatesWithMeta,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  sendTestEmail
} from 'api/journeyTemplates';
import { htmlToText } from 'utils/htmlToText';
import AttachmentPicker from './AttachmentPicker';
import TokenChips from './TokenChips';
import SendTestEmailDialog from './SendTestEmailDialog';

const DEFAULT_OPT_OUT = 'Reply STOP to opt out.';

// Reply-To is stored/sent as an array; the field edits it as a comma-separated string.
const parseEmails = (s) =>
  String(s || '')
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter(Boolean);
const formatEmails = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');

const EMPTY_FORM = {
  name: '',
  subject: '',
  preheader: '',
  body: '',
  reply_to: [],
  attachments: [],
  sms_use_email_body: true,
  sms_body: '',
  sms_opt_out: DEFAULT_OPT_OUT
};

export default function EmailTemplatesPane() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ from_name: '', from_address: '', default_reply_to: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null=closed, {}=new, {id}=edit
  const [form, setForm] = useState(EMPTY_FORM);
  const [tab, setTab] = useState(0); // 0=Email, 1=Text
  const [confirmDel, setConfirmDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchEmailTemplatesWithMeta()
      .then(({ templates, meta: m }) => {
        setRows(templates);
        setMeta(m);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const openNew = () => {
    setForm({ ...EMPTY_FORM, attachments: [] });
    setTab(0);
    setEditing({});
  };
  const openEdit = (r) => {
    setForm({
      name: r.name || '',
      subject: r.subject || '',
      preheader: r.preheader || '',
      body: r.body || '',
      reply_to: Array.isArray(r.reply_to) ? r.reply_to : [],
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      sms_use_email_body: r.sms_use_email_body !== false,
      sms_body: r.sms_body || '',
      sms_opt_out: r.sms_opt_out ?? DEFAULT_OPT_OUT
    });
    setTab(0);
    setEditing(r);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Template needs a name.');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name,
      subject: form.subject,
      preheader: form.preheader,
      body: form.body,
      body_format: 'html',
      reply_to: form.reply_to || [],
      attachments: form.attachments || [],
      sms_use_email_body: form.sms_use_email_body,
      sms_body: form.sms_body,
      sms_opt_out: form.sms_opt_out
    };
    try {
      if (editing?.id) {
        const t = await updateEmailTemplate(editing.id, payload);
        setRows((p) => p.map((x) => (x.id === t.id ? t : x)));
        toast.success('Template updated.');
      } else {
        const t = await createEmailTemplate(payload);
        setRows((p) => [t, ...p]);
        toast.success('Template created.');
      }
      setEditing(null);
    } catch {
      toast.error('Could not save the template.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    try {
      await deleteEmailTemplate(confirmDel.id);
      setRows((p) => p.filter((x) => x.id !== confirmDel.id));
      toast.success('Template deleted.');
    } catch {
      toast.error('Could not delete the template.');
    } finally {
      setConfirmDel(null);
    }
  };

  // Fire a test of the CURRENT (possibly unsaved) draft through the real send path.
  // Throws on failure so SendTestEmailDialog keeps itself open + surfaces the message.
  const handleSendTest = async (recipients) => {
    const res = await sendTestEmail({
      subject: form.subject,
      body: form.body,
      body_format: 'html',
      preheader: form.preheader,
      attachment_file_ids: (form.attachments || []).map((a) => a.file_id),
      recipients
    });
    const n = res?.sent ?? recipients.length;
    toast.success(`Test sent to ${n} recipient${n === 1 ? '' : 's'}.`);
  };

  const columns = [
    { id: 'name', label: 'Name' },
    { id: 'subject', label: 'Subject' },
    {
      id: 'pdfs',
      label: 'PDFs',
      render: (r) => (Array.isArray(r.attachments) ? r.attachments.length : 0)
    },
    {
      id: 'actions',
      label: '',
      render: (r) => (
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => openEdit(r)}>
            Edit
          </Button>
          <Button size="small" color="error" onClick={() => setConfirmDel(r)}>
            Delete
          </Button>
        </Stack>
      )
    }
  ];

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" onClick={openNew}>
          New template
        </Button>
      </Stack>
      <DataTable
        rowKey="id"
        loading={loading}
        rows={rows}
        columns={columns}
        emptyTitle="No templates yet"
        emptyMessage="Save wording you reuse — like an implants or cosmetic intro."
      />

      <FormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSubmit={save}
        title=""
        maxWidth="sm"
        submitLabel="Save"
        loading={saving}
      >
        {/* Inline-editable template name replaces the static title. */}
        <TextField
          variant="standard"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Untitled template"
          fullWidth
          InputProps={{
            sx: { fontSize: '1.25rem', fontWeight: 600 },
            endAdornment: (
              <InputAdornment position="end">
                <EditIcon fontSize="small" color="action" />
              </InputAdornment>
            )
          }}
        />

        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Email" />
          <Tab label="Text" />
        </Tabs>

        {tab === 0 && (
          <Stack spacing={2}>
            {(meta.from_name || meta.from_address) && (
              <Typography variant="caption" color="text.secondary">
                Sending as <strong>{meta.from_name || 'Anchor'}</strong>
                {meta.from_address ? ` <${meta.from_address}>` : ''} — replies go to the Reply-To below.
              </Typography>
            )}
            <TextField label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} fullWidth />
            <TextField
              label="Preview Text"
              value={form.preheader}
              onChange={(e) => setForm({ ...form, preheader: e.target.value })}
              helperText="Shows in the inbox preview"
              fullWidth
            />
            <TextField
              label="Reply-To"
              value={formatEmails(form.reply_to)}
              onChange={(e) => setForm({ ...form, reply_to: parseEmails(e.target.value) })}
              placeholder={meta.default_reply_to?.length ? meta.default_reply_to.join(', ') : 'you@yourpractice.com'}
              helperText={
                form.reply_to?.length
                  ? 'Replies to this email go here. Separate multiple addresses with commas.'
                  : `Leave blank to use your form notification recipients${
                      meta.default_reply_to?.length ? ` (${meta.default_reply_to.join(', ')})` : ''
                    }.`
              }
              fullWidth
            />
            <TokenChips />
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Body
              </Typography>
              <RichTextEditor
                value={form.body}
                onChange={(html) => setForm({ ...form, body: html })}
                minHeight={220}
                placeholder="Write the template body…"
              />
            </Box>
            <AttachmentPicker value={form.attachments || []} onChange={(a) => setForm({ ...form, attachments: a })} />
            <Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SendOutlinedIcon />}
                onClick={() => setTestOpen(true)}
                disabled={!form.subject.trim() && !form.body.trim()}
              >
                Send test email
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Sends this draft (sample lead info, your branding) so you can see it in an inbox.
              </Typography>
            </Box>
          </Stack>
        )}

        {tab === 1 && (
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch checked={form.sms_use_email_body} onChange={(e) => setForm({ ...form, sms_use_email_body: e.target.checked })} />
              }
              label="Use email template"
            />
            {form.sms_use_email_body ? (
              <Box>
                <TextField label="Text preview" value={htmlToText(form.body)} multiline minRows={4} fullWidth disabled />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Sent as plain text — subject, preview text, and formatting are dropped.
                </Typography>
              </Box>
            ) : (
              <Box>
                <Box sx={{ mb: 1.5 }}>
                  <TokenChips />
                </Box>
                <TextField
                  label="Text message"
                  value={form.sms_body}
                  onChange={(e) => setForm({ ...form, sms_body: e.target.value })}
                  multiline
                  minRows={4}
                  fullWidth
                  placeholder="Write your text message…"
                />
              </Box>
            )}
            <TextField
              label="Opt-out language"
              value={form.sms_opt_out}
              onChange={(e) => setForm({ ...form, sms_opt_out: e.target.value })}
              helperText="Appended to outgoing texts (required for compliance)."
              fullWidth
            />
          </Stack>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        onConfirm={doDelete}
        title="Delete template?"
        message={`Delete "${confirmDel?.name}"? This can't be undone.`}
        confirmColor="error"
        confirmLabel="Delete"
      />

      <SendTestEmailDialog open={testOpen} onClose={() => setTestOpen(false)} onSubmit={handleSendTest} />
    </Box>
  );
}
