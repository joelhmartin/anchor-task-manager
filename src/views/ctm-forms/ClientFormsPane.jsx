/**
 * ClientFormsPane — Per-client form management
 *
 * Shows a specific client's forms with:
 * - Create new form
 * - Edit / archive / duplicate / export forms
 * - Navigate to builder, submissions, analytics
 * - Embed code inline
 * - Back button to return to client list
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, IconButton, MenuItem,
  Paper, Stack, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import BuildIcon from '@mui/icons-material/Build';
import VisibilityIcon from '@mui/icons-material/Visibility';
import BarChartIcon from '@mui/icons-material/BarChart';
import CodeIcon from '@mui/icons-material/Code';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import DeleteIcon from '@mui/icons-material/Delete';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { clientLabel } from 'hooks/useClientLabel';
import {
  createCtmForm, updateCtmForm, archiveCtmForm,
  exportCtmForm, duplicateCtmForm, generateCtmEmbedCode, getAppConfig,
  listCtmFormTemplates, saveAsTemplate, createFormFromTemplate
} from 'api/ctmForms';

export default function ClientFormsPane({ client, forms, setForms, onRefresh, onNavigate, onBack }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [appBaseUrl, setAppBaseUrl] = useState('');

  // Create form dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createData, setCreateData] = useState({ name: '', formMode: 'builder', templateId: '' });
  const [templates, setTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // Save as template dialog
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateData, setTemplateData] = useState({ formId: '', name: '', description: '', category: '' });

  // Edit form dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({ id: '', name: '' });

  // Archive confirm dialog
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [formToArchive, setFormToArchive] = useState(null);

  // Embed code expansion
  const [embedFormId, setEmbedFormId] = useState(null);

  useEffect(() => {
    getAppConfig().then(cfg => setAppBaseUrl(cfg.appBaseUrl)).catch(() => {});
  }, []);

  const filtered = useMemo(() => forms.filter(f => {
    if (statusFilter === 'active' && f.status === 'archived') return false;
    if (statusFilter === 'draft' && f.status !== 'draft') return false;
    if (statusFilter === 'published' && f.status !== 'published') return false;
    if (statusFilter === 'archived' && f.status !== 'archived') return false;
    return true;
  }), [forms, statusFilter]);

  const counts = useMemo(() => ({
    active: forms.filter(f => f.status !== 'archived').length,
    draft: forms.filter(f => f.status === 'draft').length,
    published: forms.filter(f => f.status === 'published').length,
    archived: forms.filter(f => f.status === 'archived').length
  }), [forms]);

  const clientName = client
    ? (client.display_name || clientLabel(client) || 'Client')
    : 'Unknown Client';

  // Load templates when create dialog opens
  const loadTemplates = async () => {
    if (templatesLoaded) return;
    try {
      const tpls = await listCtmFormTemplates();
      setTemplates(tpls);
      setTemplatesLoaded(true);
    } catch (err) { /* silent — templates are optional */ }
  };

  const handleCreate = async () => {
    if (!createData.name.trim()) { showToast('Name is required', 'error'); return; }
    try {
      setSaving(true);
      let f;
      if (createData.templateId) {
        f = await createFormFromTemplate(createData.templateId, client.id, createData.name);
      } else {
        f = await createCtmForm(client.id, createData.name, createData.formMode);
      }
      setForms(prev => [f, ...prev]);
      showToast('Form created!', 'success');
      setCreateOpen(false);
      setCreateData({ name: '', formMode: 'builder', templateId: '' });
      onNavigate('builder', { formId: f.id, clientId: client.id });
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
    finally { setSaving(false); }
  };

  const handleSaveAsTemplate = async () => {
    if (!templateData.name.trim()) { showToast('Template name is required', 'error'); return; }
    try {
      setSaving(true);
      await saveAsTemplate(templateData.formId, {
        name: templateData.name,
        description: templateData.description,
        category: templateData.category
      });
      showToast('Saved as template!', 'success');
      setTemplateOpen(false);
      setTemplatesLoaded(false); // force reload next time
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
    finally { setSaving(false); }
  };

  const handleEdit = async () => {
    try {
      setSaving(true);
      const updated = await updateCtmForm(editData.id, { name: editData.name });
      setForms(prev => prev.map(f => f.id === editData.id ? { ...f, ...updated } : f));
      showToast('Updated', 'success');
      setEditOpen(false);
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
    finally { setSaving(false); }
  };

  const handleArchive = async () => {
    if (!formToArchive) return;
    try {
      setSaving(true);
      await archiveCtmForm(formToArchive.id);
      setForms(prev => prev.map(f => f.id === formToArchive.id ? { ...f, status: 'archived' } : f));
      showToast('Archived', 'success');
      setArchiveOpen(false);
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
    finally { setSaving(false); }
  };

  const handleDuplicate = async (form) => {
    try {
      setSaving(true);
      const dup = await duplicateCtmForm(form.id);
      setForms(prev => [dup, ...prev]);
      showToast('Duplicated', 'success');
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
    finally { setSaving(false); }
  };

  const handleExport = async (form) => {
    try {
      const data = await exportCtmForm(form.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${form.name.replace(/[^a-z0-9]/gi, '_')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Exported', 'success');
    } catch (err) { showToast(getErrorMessage(err), 'error'); }
  };

  const toggleEmbed = (formId) => {
    setEmbedFormId(prev => prev === formId ? null : formId);
  };

  if (!client) {
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ alignSelf: 'flex-start' }}>All Clients</Button>
        <EmptyState title="Client not found" message="This client may have been removed." />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Header with back button */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton onClick={onBack} size="small">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">{clientName}</Typography>
          <Chip label={`${forms.length} form${forms.length !== 1 ? 's' : ''}`} size="small" variant="outlined" />
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { loadTemplates(); setCreateOpen(true); }}>
          Create Form
        </Button>
      </Stack>

      {/* Status filter tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={statusFilter} onChange={(e, v) => setStatusFilter(v)}>
          <Tab label={`Active (${counts.active})`} value="active" />
          <Tab label={`Drafts (${counts.draft})`} value="draft" />
          <Tab label={`Published (${counts.published})`} value="published" />
          <Tab label={`Archived (${counts.archived})`} value="archived" />
        </Tabs>
      </Box>

      {/* Forms list */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No forms found"
          message={forms.length === 0 ? 'Create your first form for this client.' : 'No forms match the current filter.'}
          action={forms.length === 0 && (
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>Create Form</Button>
          )}
        />
      ) : (
        <Stack spacing={1.5}>
          {filtered.map(form => (
            <Card key={form.id} variant="outlined">
              <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack spacing={0.25} sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle1" fontWeight={600}>{form.name}</Typography>
                      <StatusChip status={form.status} variant="outlined" size="small" />
                      {form.form_mode === 'reactor' && <Chip label="Reactor" size="small" variant="outlined" />}
                    </Stack>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        {form.submission_count || 0} submission{(form.submission_count || 0) !== 1 ? 's' : ''}
                      </Typography>
                      {form.ctm_reactor_id && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          Reactor: {form.ctm_reactor_id}
                        </Typography>
                      )}
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Edit Name">
                      <IconButton size="small" onClick={() => { setEditData({ id: form.id, name: form.name }); setEditOpen(true); }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Form Builder">
                      <IconButton size="small" onClick={() => onNavigate('builder', { formId: form.id, clientId: client.id })}>
                        <BuildIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Submissions">
                      <IconButton size="small" onClick={() => onNavigate('submissions', { formId: form.id, clientId: client.id })}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Analytics">
                      <IconButton size="small" onClick={() => onNavigate('analytics', { formId: form.id, clientId: client.id })}>
                        <BarChartIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={form.status === 'published' ? 'Embed Code' : 'Publish to get embed code'}>
                      <span>
                        <IconButton size="small" onClick={() => toggleEmbed(form.id)} disabled={form.status !== 'published'}>
                          <CodeIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Duplicate">
                      <IconButton size="small" onClick={() => handleDuplicate(form)} disabled={saving}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Export">
                      <IconButton size="small" onClick={() => handleExport(form)}>
                        <FileDownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Save as Template">
                      <IconButton size="small" onClick={() => { setTemplateData({ formId: form.id, name: form.name, description: '', category: '' }); setTemplateOpen(true); }}>
                        <BookmarkAddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {form.status !== 'archived' && (
                      <Tooltip title="Archive">
                        <IconButton size="small" color="error" onClick={() => { setFormToArchive(form); setArchiveOpen(true); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Stack>

                {/* Inline embed code */}
                {embedFormId === form.id && form.status === 'published' && (
                  <Box sx={{ mt: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography variant="caption" fontWeight={600}>Embed Code</Typography>
                      <Button
                        size="small"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => {
                          navigator.clipboard.writeText(generateCtmEmbedCode(form, appBaseUrl || undefined));
                          showToast('Copied!', 'success');
                        }}
                      >
                        Copy
                      </Button>
                    </Stack>
                    <Paper
                      variant="outlined"
                      sx={{ p: 1.5, bgcolor: 'grey.50', fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                    >
                      {generateCtmEmbedCode(form, appBaseUrl || undefined)}
                    </Paper>
                    <Alert severity="info" sx={{ mt: 1 }}>Paste before the closing <code>&lt;/body&gt;</code> tag.</Alert>
                  </Box>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Create Form Dialog */}
      <FormDialog open={createOpen} onClose={() => { setCreateOpen(false); setCreateData({ name: '', formMode: 'builder', templateId: '' }); }} onSubmit={handleCreate} title="Create Form" loading={saving} submitLabel="Create">
        {templates.length > 0 && (
          <SelectField
            label="Start from Template (optional)"
            value={createData.templateId}
            onChange={e => setCreateData({ ...createData, templateId: e.target.value })}
          >
            <MenuItem value="">Blank Form</MenuItem>
            {templates.map(t => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}{t.multi_step ? ' (multi-step)' : ''}{t.category ? ` — ${t.category}` : ''}
              </MenuItem>
            ))}
          </SelectField>
        )}
        <TextField label="Form Name" value={createData.name} onChange={e => setCreateData({ ...createData, name: e.target.value })} fullWidth required placeholder="Contact Form" />
        {!createData.templateId && (
          <SelectField label="Mode" value={createData.formMode} onChange={e => setCreateData({ ...createData, formMode: e.target.value })} options={[{ value: 'builder', label: 'Build Custom Form' }, { value: 'reactor', label: 'Use Existing Reactor' }]} />
        )}
      </FormDialog>

      {/* Edit Form Dialog */}
      <FormDialog open={editOpen} onClose={() => setEditOpen(false)} onSubmit={handleEdit} title="Edit Form" loading={saving}>
        <TextField label="Form Name" value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} fullWidth />
      </FormDialog>

      {/* Archive Confirm */}
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={handleArchive}
        title="Archive Form"
        message={`Archive "${formToArchive?.name}"? It will no longer accept submissions.`}
        confirmLabel="Archive"
        confirmColor="error"
        loading={saving}
      />

      {/* Save as Template Dialog */}
      <FormDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onSubmit={handleSaveAsTemplate}
        title="Save as Template"
        loading={saving}
        submitLabel="Save Template"
        submitIcon={<BookmarkAddIcon />}
      >
        <TextField label="Template Name" value={templateData.name} onChange={e => setTemplateData({ ...templateData, name: e.target.value })} fullWidth required />
        <TextField label="Description (optional)" value={templateData.description} onChange={e => setTemplateData({ ...templateData, description: e.target.value })} fullWidth multiline rows={2} />
        <SelectField
          label="Category (optional)"
          value={templateData.category}
          onChange={e => setTemplateData({ ...templateData, category: e.target.value })}
        >
          <MenuItem value="">None</MenuItem>
          <MenuItem value="contact">Contact</MenuItem>
          <MenuItem value="intake">Intake</MenuItem>
          <MenuItem value="quiz">Quiz / Assessment</MenuItem>
          <MenuItem value="appointment">Appointment</MenuItem>
          <MenuItem value="consultation">Consultation</MenuItem>
        </SelectField>
      </FormDialog>
    </Stack>
  );
}
