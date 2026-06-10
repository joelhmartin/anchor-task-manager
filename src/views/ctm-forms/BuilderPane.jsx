/**
 * BuilderPane — Visual CTM form builder
 *
 * Three-panel layout:
 * - Left: Field palette (categorized)
 * - Center: Field canvas (sortable list) + live preview
 * - Right: Sidebar (field properties + form settings)
 */

import { useEffect, useState, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import PublishIcon from '@mui/icons-material/Publish';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import SelectField from 'ui-component/extended/SelectField';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CodeIcon from '@mui/icons-material/Code';
import SettingsIcon from '@mui/icons-material/Settings';
import Autocomplete from '@mui/material/Autocomplete';
import { getCtmForm, saveCtmFormConfig, publishCtmForm, updateCtmForm, aiAssist, generateCtmEmbedCode, getAppConfig } from 'api/ctmForms';
import { fetchDocuments } from 'api/documents';
import { getFormAnalyticsContext } from 'api/tracking';
import { FIELD_TYPES, CORE_FIELDS, OPERATORS, getFieldDefaults, sanitizeFieldName } from './fieldTypes';
import OptionsEditor from './OptionsEditor';

const DEFAULT_THANKYOU_HTML = `<div style="padding: 3rem 2.5rem;max-width: 440px;width: 100%;text-align: center">

  <div style="width: 64px;height: 64px;border-radius: 50%;background: #f0faf4;display: flex;align-items: center;justify-content: center;margin: 0 auto 1.5rem">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2a9d60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  </div>

  <p style="font-size: 12px;font-weight: 500;letter-spacing: 0.12em;text-transform: uppercase;color: #888;margin: 0 0 0.5rem">Message received</p>

  <h2 style="font-size: 26px;font-weight: 500;color: #111111;margin: 0 0 1rem;line-height: 1.25">Thank you, {caller_name}!</h2>

  <p style="font-size: 15px;color: #555555;line-height: 1.7;margin: 0 0 1.75rem">We've got your info and someone from our team will be reaching out to you shortly. Keep an eye on your inbox — we'll be in touch soon.</p>

  <div style="border-top: 1px solid #eeeeee;padding-top: 1.5rem;display: flex;flex-direction: column;gap: 10px">
    <div style="display: flex;align-items: center;gap: 10px;font-size: 13px;color: #666">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      Typical response time: <strong style="color: #111111;font-weight: 500">within 1 business day</strong>
    </div>
    <div style="display: flex;align-items: center;gap: 10px;font-size: 13px;color: #666">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12 19.79 19.79 0 011.61 3.4 2 2 0 013.6 1.22h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.96a16 16 0 006.13 6.13l.96-.96a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
      We may also give you a call at the number provided
    </div>
  </div>

</div>`;

/**
 * Preview CSS — mirrors the plugin's form-logic.css exactly.
 * Scoped to .ctm-form-wrap so it doesn't leak.
 */
const PREVIEW_CSS = `
.ctm-form-wrap {
  --ctm-bg: #ffffff; --ctm-text: #1d2327; --ctm-label: #1d2327;
  --ctm-input-bg: #ffffff; --ctm-input-border: #c3c4c7; --ctm-input-text: #1d2327;
  --ctm-focus: #2271b1; --ctm-btn-bg: #2271b1; --ctm-btn-text: #ffffff;
  --ctm-muted: #666666; --ctm-divider: #dddddd;
  --ctm-score-bg: #f8f9fa; --ctm-score-border: #e2e4e7; --ctm-float-label: #888888;
  position: relative; background: var(--ctm-bg); color: var(--ctm-text); border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.ctm-form-wrap.ctm-scheme-dark {
  --ctm-bg: #1e1e2e; --ctm-text: #e0e0e0; --ctm-label: #cccccc;
  --ctm-input-bg: #2a2a3c; --ctm-input-border: #444466; --ctm-input-text: #e0e0e0;
  --ctm-focus: var(--ctm-btn-bg); --ctm-muted: #999; --ctm-divider: #3a3a4c;
  --ctm-score-bg: #2a2a3c; --ctm-score-border: #444466;
}
.ctm-form-wrap form { display: flex; flex-direction: column; gap: 16px; margin: 0 auto; padding: 16px; }
.ctm-row { display: flex; flex-wrap: wrap; gap: 16px; }
.ctm-col-full { width: 100%; }
.ctm-col-half { width: calc(50% - 8px); }
.ctm-col-third { width: calc(33.333% - 11px); }
.ctm-col-quarter { width: calc(25% - 12px); }
.ctm-form-wrap label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 4px; color: var(--ctm-label); }
.ctm-form-wrap input[type="text"], .ctm-form-wrap input[type="email"], .ctm-form-wrap input[type="tel"],
.ctm-form-wrap input[type="number"], .ctm-form-wrap input[type="url"],
.ctm-form-wrap textarea, .ctm-form-wrap select {
  display: block; width: 100%; padding: 10px 12px; border: 1px solid var(--ctm-input-border);
  border-radius: 4px; font-size: 15px; line-height: 1.5; box-sizing: border-box;
  background: var(--ctm-input-bg); color: var(--ctm-input-text); font-family: inherit;
}
.ctm-form-wrap textarea { min-height: 100px; resize: vertical; }
.ctm-form-wrap input:focus, .ctm-form-wrap textarea:focus, .ctm-form-wrap select:focus {
  border-color: var(--ctm-focus); box-shadow: 0 0 0 1px var(--ctm-focus); outline: none;
}
.ctm-form-wrap button[type="submit"], .ctm-form-wrap input[type="submit"] {
  display: inline-block; padding: 12px 28px; background: var(--ctm-btn-bg); color: var(--ctm-btn-text);
  border: none; border-radius: 4px; font-size: 15px; font-weight: 600; cursor: pointer; line-height: 1.5;
  transition: background .2s; width: 100%;
}
.ctm-form-wrap button[type="submit"]:hover { filter: brightness(0.9); }
.ctm-form-wrap fieldset { border: none; padding: 0; margin: 0; }
.ctm-form-wrap legend { font-weight: 600; font-size: 14px; margin-bottom: 6px; color: var(--ctm-label); }
.ctm-form-wrap fieldset label { display: flex; align-items: center; gap: 6px; font-weight: 400; margin-bottom: 4px; cursor: pointer; }
.ctm-form-wrap fieldset input[type="checkbox"], .ctm-form-wrap fieldset input[type="radio"] { width: auto; }
.ctm-form-wrap .input { position: relative; }
.ctm-form-wrap .input .input-label {
  position: absolute; top: 12px; left: 12px; font-size: 14px; font-weight: 400;
  color: var(--ctm-float-label); pointer-events: none; transition: all .2s ease;
}
.ctm-form-wrap .input .input-field:focus ~ .input-label,
.ctm-form-wrap .input .input-field:not(:placeholder-shown) ~ .input-label {
  top: -8px; left: 8px; font-size: 11px; color: var(--ctm-focus);
  background: var(--ctm-input-bg); padding: 0 4px;
}
.ctm-form-wrap .input .input-field {
  display: block; width: 100%; padding: 10px 12px; border: 1px solid var(--ctm-input-border);
  border-radius: 4px; font-size: 15px; line-height: 1.5; box-sizing: border-box;
  background: var(--ctm-input-bg); color: var(--ctm-input-text); font-family: inherit;
}
.ctm-form-wrap .input .input-field:focus {
  border-color: var(--ctm-focus); box-shadow: 0 0 0 1px var(--ctm-focus); outline: none;
}
.ctm-form-wrap h3 { font-size: 18px; margin: 8px 0 4px; color: var(--ctm-text); }
.ctm-form-wrap hr { border: none; border-top: 1px solid var(--ctm-divider); margin: 8px 0; }
.ctm-help-text { display: block; font-size: 12px; color: var(--ctm-muted); margin-top: 4px; }
.ctm-score-wrap {
  padding: 12px 16px; margin: 12px 0; background: var(--ctm-score-bg);
  border: 1px solid var(--ctm-score-border); border-radius: 6px; text-align: center;
}
.ctm-score-label { font-size: 14px; color: var(--ctm-muted); margin-right: 8px; }
.ctm-score-display { font-size: 24px; font-weight: 700; color: var(--ctm-text); }
.ctm-consent-wrap { margin-bottom: 4px; }
.ctm-consent-label { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; font-weight: 300; line-height: 1.2; cursor: pointer; }
.ctm-consent-label input[type="checkbox"] { width: auto; margin-top: 1px; flex-shrink: 0; }
.ctm-consent-text { color: var(--ctm-muted); }
[data-conditions] { transition: opacity .25s ease, max-height .3s ease; }
.ctm-ms-header { margin-bottom: 16px; }
.ctm-ms-counter { font-size: 12px; color: var(--ctm-muted); text-align: right; margin-bottom: 6px; }
.ctm-ms-progress { height: 5px; background: var(--ctm-input-border); border-radius: 3px; overflow: hidden; }
.ctm-ms-bar { height: 100%; background: var(--ctm-btn-bg); border-radius: 3px; transition: width .35s ease; }
.ctm-ms-nav { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
.ctm-ms-next { flex: 1; padding: 12px 24px; background: var(--ctm-btn-bg); color: var(--ctm-btn-text); border: none; border-radius: 4px; font-size: 15px; font-weight: 600; cursor: pointer; }
.ctm-ms-back { padding: 10px 20px; background: none; border: 1px solid var(--ctm-input-border); color: var(--ctm-text); border-radius: 4px; font-size: 14px; cursor: pointer; }
@media (max-width: 600px) { .ctm-col-half, .ctm-col-third, .ctm-col-quarter { width: 100%; } }
`;

export default function BuilderPane({ forms, setForms, onRefresh, initialFormId, onNavigate }) {
  const { showToast } = useToast();
  const [selectedFormId, setSelectedFormId] = useState(initialFormId || '');
  const [config, setConfig] = useState({ settings: {}, fields: [] });
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingForm, setLoadingForm] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('field');
  const [previewHtml, setPreviewHtml] = useState('');

  // Multi-step
  const [activeStep, setActiveStep] = useState(0);

  // AI
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Embed code
  const [appBaseUrl, setAppBaseUrl] = useState('');
  useEffect(() => {
    getAppConfig()
      .then((cfg) => setAppBaseUrl(cfg.appBaseUrl))
      .catch(() => {});
  }, []);

  // Analytics context (loaded when analytics tab is opened)
  const [analyticsCtx, setAnalyticsCtx] = useState(null);
  const [analyticsCtxLoading, setAnalyticsCtxLoading] = useState(false);

  // Document picker for autoresponder attachments (loaded when notify tab is opened)
  const [clientDocs, setClientDocs] = useState([]);
  const [clientDocsLoading, setClientDocsLoading] = useState(false);
  useEffect(() => {
    if (sidebarTab !== 'notify') return;
    let cancelled = false;
    setClientDocsLoading(true);
    fetchDocuments()
      .then((docs) => {
        if (!cancelled) setClientDocs(Array.isArray(docs) ? docs : []);
      })
      .catch(() => {
        if (!cancelled) setClientDocs([]);
      })
      .finally(() => {
        if (!cancelled) setClientDocsLoading(false);
      });
    return () => { cancelled = true; };
  }, [sidebarTab]);
  const selectedFormOrgId = forms.find((f) => f.id === selectedFormId)?.org_id;
  useEffect(() => {
    let cancelled = false;
    setAnalyticsCtx(null);

    if (sidebarTab !== 'analytics' || !selectedFormOrgId) {
      setAnalyticsCtxLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setAnalyticsCtxLoading(true);
    getFormAnalyticsContext(selectedFormOrgId)
      .then((data) => {
        if (!cancelled) setAnalyticsCtx(data);
      })
      .catch(() => {
        if (!cancelled) setAnalyticsCtx(null);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsCtxLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sidebarTab, selectedFormOrgId]);

  const draftForms = forms.filter((f) => f.status !== 'archived');

  // Inject preview CSS on mount
  useEffect(() => {
    if (document.getElementById('ctm-form-preview-styles')) return;
    const el = document.createElement('style');
    el.id = 'ctm-form-preview-styles';
    el.textContent = PREVIEW_CSS;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  // Load form
  useEffect(() => {
    if (initialFormId) loadForm(initialFormId);
  }, [initialFormId]); // eslint-disable-line

  const loadForm = async (formId) => {
    if (!formId) {
      setConfig({ settings: {}, fields: [] });
      return;
    }
    try {
      setLoadingForm(true);
      const form = await getCtmForm(formId);
      setConfig(form.config_json || { settings: {}, fields: [] });
      setSelectedFieldId(null);
      if (form.rendered_html) setPreviewHtml(form.rendered_html);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoadingForm(false);
    }
  };

  // Debounce timers
  const analyticsSaveTimer = useRef(null);
  useEffect(() => () => clearTimeout(analyticsSaveTimer.current), []);

  // Auto-save config (debounced)
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!selectedFormId || loadingForm) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const result = await saveCtmFormConfig(selectedFormId, config);
        if (result.html) setPreviewHtml(result.html);
        setForms((prev) => prev.map((f) => (f.id === selectedFormId ? { ...f, config_json: config } : f)));
      } catch (err) {
        console.error('[ctm-forms:autosave]', err);
      }
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [config, selectedFormId]); // eslint-disable-line

  // Field operations
  const fields = config.fields || [];
  const settings = config.settings || {};

  const updateConfig = (updates) => setConfig((prev) => ({ ...prev, ...updates }));
  const updateSettings = (updates) => setConfig((prev) => ({ ...prev, settings: { ...prev.settings, ...updates } }));

  const addField = (type) => {
    // Singleton checks (match plugin)
    if (type === 'score_display' && fields.some((f) => f.type === 'score_display')) {
      showToast('Only one Score Display per form', 'error');
      return;
    }
    if (type === 'fullname' && fields.some((f) => f.name === 'caller_name')) {
      showToast('Only one Full Name per form', 'error');
      return;
    }
    if (type === 'message' && fields.some((f) => f.name === 'message')) {
      showToast('Only one Message per form', 'error');
      return;
    }

    const f = getFieldDefaults(type);
    if (settings.multiStep) f.step = 0;
    updateConfig({ fields: [...fields, f] });
    setSelectedFieldId(f.id);
    setSidebarTab('field');
  };

  const updateField = (id, key, val) => {
    updateConfig({
      fields: fields.map((f) => {
        if (f.id !== id) return f;
        const updated = { ...f };

        if (key === 'displayName') {
          // Auto-derive machine name from display name (match plugin exactly)
          updated.displayName = val;
          const slug = sanitizeFieldName(val);
          updated.name = slug;
          updated.isCustom = !CORE_FIELDS.includes(slug);
        } else if (key === 'name') {
          // Manual name override — sanitize
          updated.name = sanitizeFieldName(val);
          updated.isCustom = !CORE_FIELDS.includes(updated.name);
        } else {
          updated[key] = val;
        }
        return updated;
      })
    });
  };

  const removeField = (id) => {
    updateConfig({ fields: fields.filter((f) => f.id !== id) });
    if (selectedFieldId === id) setSelectedFieldId(null);
  };

  const duplicateField = (id) => {
    const orig = fields.find((f) => f.id === id);
    if (!orig) return;
    const copy = { ...JSON.parse(JSON.stringify(orig)), id: `f_${Math.random().toString(36).substr(2, 8)}` };
    copy.displayName = orig.displayName ? orig.displayName + ' (Copy)' : '';
    copy.name = orig.name ? orig.name + '_copy' : '';
    const idx = fields.indexOf(orig);
    const newFields = [...fields];
    newFields.splice(idx + 1, 0, copy);
    updateConfig({ fields: newFields });
    setSelectedFieldId(copy.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = fields.findIndex((f) => f.id === active.id);
    const newIdx = fields.findIndex((f) => f.id === over.id);
    if (oldIdx !== -1 && newIdx !== -1) updateConfig({ fields: arrayMove(fields, oldIdx, newIdx) });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handlePublish = async () => {
    if (!selectedFormId) return;
    if (fields.length === 0) {
      showToast('Add at least one field', 'error');
      return;
    }
    try {
      setSaving(true);
      const result = await publishCtmForm(selectedFormId);
      if (result.reactorError) showToast('Published but reactor error: ' + result.reactorError, 'warning');
      else showToast('Published!', 'success');
      setForms((prev) => prev.map((f) => (f.id === selectedFormId ? { ...f, ...result.form } : f)));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // AI Assistant
  const handleAi = async () => {
    if (!aiPrompt.trim()) return;
    try {
      setAiLoading(true);
      const newConfig = await aiAssist(aiPrompt, config);
      setConfig(newConfig);
      showToast('AI updated your form! Review the changes.', 'success');
      setAiPrompt('');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setAiLoading(false);
    }
  };

  // Sortable field row (defined inside component to close over FIELD_TYPES / settings)
  function SortableFieldRow({ field }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
    const isSelected = field.id === selectedFieldId;
    const typeDef = FIELD_TYPES[field.type] || { label: field.type };
    const hasConds = field.conditions && field.conditions.length > 0;
    return (
      <Box
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 }}
        onClick={() => {
          setSelectedFieldId(field.id);
          setSidebarTab('field');
        }}
        sx={{
          p: 1,
          borderRadius: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          border: '1px solid',
          borderColor: isSelected ? 'primary.main' : 'divider',
          bgcolor: isSelected ? 'primary.50' : 'background.paper',
          '&:hover': { borderColor: 'primary.light' }
        }}
      >
        <Box
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          sx={{ cursor: isDragging ? 'grabbing' : 'grab', color: 'text.disabled', display: 'flex', mr: -0.5, touchAction: 'none' }}
        >
          <DragIndicatorIcon sx={{ fontSize: 16 }} />
        </Box>
        <Chip label={typeDef.label} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
        <Typography variant="body2" sx={{ flex: 1, fontWeight: isSelected ? 600 : 400 }}>
          {field.label || field.displayName || field.name || '(unnamed)'}
        </Typography>
        {field.name && (
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 10 }}>
            {field.name}
          </Typography>
        )}
        {!field.isCustom && <Chip label="CTM" size="small" color="info" sx={{ height: 18, fontSize: 9 }} />}
        {field.required && <Chip label="req" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: 9 }} />}
        {field.width !== 'full' && <Chip label={field.width} size="small" variant="outlined" sx={{ height: 18, fontSize: 9 }} />}
        {settings.multiStep && (
          <Chip label={`S${(field.step || 0) + 1}`} size="small" variant="outlined" sx={{ height: 18, fontSize: 9 }} />
        )}
        {hasConds && <Chip label="IF" size="small" color="secondary" sx={{ height: 18, fontSize: 9 }} />}
        {field.registerField && <Chip label="REG" size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: 9 }} />}
      </Box>
    );
  }

  const selectedField = fields.find((f) => f.id === selectedFieldId);
  const isOptionField = selectedField && ['select', 'radio', 'checkbox'].includes(selectedField.type);
  const isLayoutField = selectedField && ['heading', 'paragraph', 'divider', 'score_display'].includes(selectedField.type);
  const scoringEnabled = settings.scoring?.enabled;

  const selectedForm = forms.find((f) => f.id === selectedFormId);
  const isPublished = selectedForm?.status === 'published';

  const handleCopyEmbed = () => {
    if (!selectedForm?.embed_token) {
      showToast('No embed token — publish first', 'error');
      return;
    }
    const code = generateCtmEmbedCode(selectedForm, appBaseUrl || undefined);
    navigator.clipboard.writeText(code);
    showToast('Embed code copied!', 'success');
  };

  return (
    <Stack spacing={2}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" alignItems="center" spacing={1}>
          <Tooltip title="Back to client forms">
            <IconButton size="small" onClick={() => onNavigate('client', null)}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="h5">Form Builder</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => setAiOpen(!aiOpen)}>
            AI
          </Button>
          <LoadingButton
            onClick={() =>
              saveCtmFormConfig(selectedFormId, config)
                .then(() => showToast('Saved', 'success'))
                .catch((err) => showToast(getErrorMessage(err), 'error'))
            }
            disabled={!selectedFormId}
            loading={saving}
            loadingLabel="Saving..."
          >
            Save
          </LoadingButton>
          <Button variant="contained" startIcon={<PublishIcon />} onClick={handlePublish} disabled={saving || !selectedFormId}>
            Publish
          </Button>
          {isPublished && (
            <Tooltip title="Copy embed code">
              <Button variant="outlined" startIcon={<CodeIcon />} onClick={handleCopyEmbed} sx={{ textTransform: 'none' }}>
                Copy Embed
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Form settings (colors, styles)">
            <IconButton onClick={() => setSidebarTab('settings')} color={sidebarTab === 'settings' ? 'primary' : 'default'}>
              <SettingsIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Form selector */}
      <SelectField
        label="Select Form"
        value={selectedFormId}
        onChange={(e) => {
          setSelectedFormId(e.target.value);
          loadForm(e.target.value);
        }}
        fullWidth={false}
        sx={{ maxWidth: 400 }}
      >
        <MenuItem value="">— Select a form —</MenuItem>
        {draftForms.map((f) => (
          <MenuItem key={f.id} value={f.id}>
            {f.name} ({f.status})
          </MenuItem>
        ))}
      </SelectField>

      {/* AI Assistant */}
      <Collapse in={aiOpen && !!selectedFormId}>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'primary.50' }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">AI Form Assistant</Typography>
            <Typography variant="body2" color="text.secondary">
              Describe what you want. Examples: "Add a contact form with name, email, phone" or "Make it a 2-step form"
            </Typography>
            <TextField
              multiline
              rows={2}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              size="small"
              placeholder="Describe your form..."
              fullWidth
            />
            <LoadingButton
              variant="contained"
              size="small"
              onClick={handleAi}
              loading={aiLoading}
              loadingLabel="Generating..."
              disabled={!aiPrompt.trim()}
            >
              Apply
            </LoadingButton>
          </Stack>
        </Paper>
      </Collapse>

      {!selectedFormId ? (
        <Alert severity="info">Select a form above to start building.</Alert>
      ) : loadingForm ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, minHeight: 600 }}>
          {/* ─── LEFT: Field Palette ─── */}
          <Paper variant="outlined" sx={{ p: 1.5, width: 180, flexShrink: 0, overflow: 'auto' }}>
            <Typography variant="overline" sx={{ fontSize: 10, px: 0.5, color: 'text.secondary' }}>
              Input Fields
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5, mb: 1.5 }}>
              {Object.entries(FIELD_TYPES)
                .filter(([, v]) => v.group === 'input')
                .map(([type, def]) => (
                  <Button
                    key={type}
                    variant="outlined"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => addField(type)}
                    fullWidth
                    sx={{
                      justifyContent: 'flex-start',
                      textTransform: 'none',
                      fontSize: 12,
                      py: 0.5,
                      color: 'text.primary',
                      borderColor: 'divider',
                      '&:hover': { borderColor: 'primary.main' }
                    }}
                  >
                    {def.label}
                  </Button>
                ))}
            </Stack>
            <Typography variant="overline" sx={{ fontSize: 10, px: 0.5, color: 'text.secondary' }}>
              Layout
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {Object.entries(FIELD_TYPES)
                .filter(([, v]) => v.group === 'layout')
                .map(([type, def]) => (
                  <Button
                    key={type}
                    variant="outlined"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => addField(type)}
                    fullWidth
                    sx={{
                      justifyContent: 'flex-start',
                      textTransform: 'none',
                      fontSize: 12,
                      py: 0.5,
                      color: 'text.primary',
                      borderColor: 'divider',
                      '&:hover': { borderColor: 'primary.main' }
                    }}
                  >
                    {def.label}
                  </Button>
                ))}
            </Stack>
          </Paper>

          {/* ─── CENTER: Field Canvas + Preview ─── */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Field Canvas */}
            <Paper variant="outlined" sx={{ p: 2, minHeight: 200 }}>
              <Typography variant="subtitle2" gutterBottom>
                Fields ({fields.length})
              </Typography>

              {/* Multi-Step Controls */}
              {settings.multiStep &&
                (() => {
                  const maxStep = fields.reduce((max, f) => Math.max(max, f.step || 0), 0);
                  const stepCount = maxStep + 1;
                  return (
                    <Box sx={{ mb: 1.5 }}>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" sx={{ gap: 0.5, mb: 1 }}>
                        {Array.from({ length: stepCount }, (_, i) => {
                          const fieldCount = fields.filter((f) => (f.step || 0) === i).length;
                          return (
                            <Chip
                              key={i}
                              label={`Step ${i + 1} (${fieldCount})`}
                              size="small"
                              color={i === activeStep ? 'primary' : 'default'}
                              variant={i === activeStep ? 'filled' : 'outlined'}
                              onClick={() => setActiveStep(i)}
                              sx={{ cursor: 'pointer' }}
                            />
                          );
                        })}
                      </Stack>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setActiveStep(stepCount);
                          }}
                        >
                          + Add Step
                        </Button>
                        {stepCount > 1 && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => {
                              const lastStep = stepCount - 1;
                              // Move fields from last step to previous
                              updateConfig({
                                fields: fields.map((f) => ((f.step || 0) === lastStep ? { ...f, step: lastStep - 1 } : f))
                              });
                              if (activeStep >= lastStep) setActiveStep(lastStep - 1);
                            }}
                          >
                            Remove Last Step
                          </Button>
                        )}
                      </Stack>
                    </Box>
                  );
                })()}

              {(() => {
                const visibleFields = settings.multiStep ? fields.filter((f) => (f.step || 0) === activeStep) : fields;

                if (visibleFields.length === 0) {
                  return (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      {fields.length === 0
                        ? 'Click a button on the left to add fields'
                        : `No fields in Step ${activeStep + 1}. Add fields or move fields here.`}
                    </Typography>
                  );
                }
                return (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={visibleFields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                      <Stack spacing={0.5}>
                        {visibleFields.map((f) => (
                          <SortableFieldRow key={f.id} field={f} />
                        ))}
                      </Stack>
                    </SortableContext>
                  </DndContext>
                );
              })()}
            </Paper>

            {/* Preview */}
            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" gutterBottom>
                Preview
              </Typography>
              {previewHtml ? (
                (() => {
                  const colorScheme = settings.colorScheme || 'light';
                  const colors = settings.colors || {};
                  const wrapClass = 'ctm-form-wrap' + (colorScheme === 'dark' ? ' ctm-scheme-dark' : '');
                  const cssVars = {};
                  if (colors.bg) cssVars['--ctm-bg'] = colors.bg;
                  if (colors.text) cssVars['--ctm-text'] = colors.text;
                  if (colors.label) cssVars['--ctm-label'] = colors.label;
                  if (colors.inputBg) cssVars['--ctm-input-bg'] = colors.inputBg;
                  if (colors.inputBorder) cssVars['--ctm-input-border'] = colors.inputBorder;
                  if (colors.inputText) cssVars['--ctm-input-text'] = colors.inputText;
                  if (colors.focus) cssVars['--ctm-focus'] = colors.focus;
                  if (colors.btnBg) cssVars['--ctm-btn-bg'] = colors.btnBg;
                  if (colors.btnText) cssVars['--ctm-btn-text'] = colors.btnText;
                  return (
                    <div className={wrapClass} style={cssVars}>
                      <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                  );
                })()
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  Add fields and save to see preview
                </Typography>
              )}
            </Paper>
          </Box>

          {/* ─── RIGHT: Sidebar ─── */}
          <Paper variant="outlined" sx={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <Tabs
              value={sidebarTab}
              onChange={(_, v) => setSidebarTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                borderBottom: 1,
                borderColor: 'divider',
                minHeight: 38,
                '& .MuiTab-root': { minHeight: 38, py: 0.5, fontSize: 11, minWidth: 50 }
              }}
            >
              <Tab label="Field" value="field" />
              <Tab label="Settings" value="settings" />
              <Tab label="After Submit" value="after" />
              <Tab label="Notify" value="notify" />
              <Tab label="Analytics" value="analytics" />
            </Tabs>

            <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
              {sidebarTab === 'field' ? (
                !selectedField ? (
                  <Typography variant="body2" color="text.secondary">
                    Click a field to edit its properties.
                  </Typography>
                ) : (
                  <Stack spacing={1.5}>
                    <Typography variant="caption" color="text.secondary">
                      Type: {FIELD_TYPES[selectedField.type]?.label || selectedField.type}
                    </Typography>

                    {/* Display Name (human-readable) */}
                    {!isLayoutField && (
                      <TextField
                        label="Display Name"
                        value={selectedField.displayName || ''}
                        onChange={(e) => updateField(selectedField.id, 'displayName', e.target.value)}
                        size="small"
                        fullWidth
                        helperText="Human-readable label. Auto-generates the field name."
                      />
                    )}

                    {/* Label */}
                    <TextField
                      label="Label"
                      value={selectedField.label || ''}
                      onChange={(e) => updateField(selectedField.id, 'label', e.target.value)}
                      size="small"
                      fullWidth
                    />

                    {/* Field Name (machine) */}
                    {!isLayoutField && (
                      <TextField
                        label="Field Name"
                        value={selectedField.name || ''}
                        onChange={(e) => updateField(selectedField.id, 'name', e.target.value)}
                        size="small"
                        fullWidth
                        helperText={selectedField.isCustom === false ? 'Core CTM field' : 'Custom field (auto-prefixed custom_ in CTM)'}
                        InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
                      />
                    )}

                    {/* Placeholder */}
                    {!isLayoutField && !['checkbox', 'radio', 'consent', 'hidden'].includes(selectedField.type) && (
                      <TextField
                        label="Placeholder"
                        value={selectedField.placeholder || ''}
                        onChange={(e) => updateField(selectedField.id, 'placeholder', e.target.value)}
                        size="small"
                        fullWidth
                      />
                    )}

                    {/* Help text */}
                    {!isLayoutField && selectedField.type !== 'hidden' && (
                      <TextField
                        label="Help Text"
                        value={selectedField.helpText || ''}
                        onChange={(e) => updateField(selectedField.id, 'helpText', e.target.value)}
                        size="small"
                        fullWidth
                      />
                    )}

                    {/* Default value */}
                    {!isLayoutField && !['checkbox', 'radio', 'consent'].includes(selectedField.type) && (
                      <TextField
                        label="Default Value"
                        value={selectedField.defaultValue || ''}
                        onChange={(e) => updateField(selectedField.id, 'defaultValue', e.target.value)}
                        size="small"
                        fullWidth
                      />
                    )}

                    {/* Consent text */}
                    {selectedField.type === 'consent' && (
                      <TextField
                        label="Consent Text"
                        value={selectedField.consentText || ''}
                        onChange={(e) => updateField(selectedField.id, 'consentText', e.target.value)}
                        size="small"
                        fullWidth
                        multiline
                        rows={2}
                      />
                    )}

                    {/* Number min/max/step */}
                    {selectedField.type === 'number' && (
                      <Stack direction="row" spacing={0.5}>
                        <TextField
                          label="Min"
                          type="number"
                          value={selectedField.min ?? ''}
                          onChange={(e) => updateField(selectedField.id, 'min', e.target.value === '' ? null : Number(e.target.value))}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          label="Max"
                          type="number"
                          value={selectedField.max ?? ''}
                          onChange={(e) => updateField(selectedField.id, 'max', e.target.value === '' ? null : Number(e.target.value))}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          label="Step"
                          type="number"
                          value={selectedField.numStep ?? ''}
                          onChange={(e) => updateField(selectedField.id, 'numStep', e.target.value === '' ? null : Number(e.target.value))}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                      </Stack>
                    )}

                    {/* Required */}
                    {!isLayoutField && selectedField.type !== 'hidden' && (
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!selectedField.required}
                            onChange={(e) => updateField(selectedField.id, 'required', e.target.checked)}
                            size="small"
                          />
                        }
                        label="Required"
                      />
                    )}

                    {/* Options */}
                    {isOptionField && (
                      <OptionsEditor
                        options={selectedField.options || []}
                        onChange={(opts) => updateField(selectedField.id, 'options', opts)}
                        showScores={!!scoringEnabled}
                      />
                    )}

                    <Divider />

                    {/* Width */}
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Width
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        {['full', 'half', 'third', 'quarter'].map((w) => (
                          <Button
                            key={w}
                            size="small"
                            variant={(selectedField.width || 'full') === w ? 'contained' : 'outlined'}
                            onClick={() => updateField(selectedField.id, 'width', w)}
                            sx={{ flex: 1, textTransform: 'none', fontSize: 11, minWidth: 0 }}
                          >
                            {w === 'full' ? 'Full' : w === 'half' ? '1/2' : w === 'third' ? '1/3' : '1/4'}
                          </Button>
                        ))}
                      </Stack>
                    </Box>

                    {/* Step assignment (multi-step only) */}
                    {settings.multiStep && (
                      <SelectField
                        label="Step"
                        value={String(selectedField.step || 0)}
                        onChange={(e) => updateField(selectedField.id, 'step', parseInt(e.target.value, 10))}
                        size="small"
                      >
                        {(() => {
                          const maxStep = fields.reduce((max, f) => Math.max(max, f.step || 0), 0);
                          return Array.from({ length: maxStep + 2 }, (_, i) => (
                            <MenuItem key={i} value={String(i)}>
                              Step {i + 1}
                            </MenuItem>
                          ));
                        })()}
                      </SelectField>
                    )}

                    {/* Label style override */}
                    {!isLayoutField && selectedField.type !== 'hidden' && (
                      <SelectField
                        label="Label Style"
                        value={selectedField.labelStyle || 'inherit'}
                        onChange={(e) => updateField(selectedField.id, 'labelStyle', e.target.value)}
                        size="small"
                        options={[
                          { value: 'inherit', label: 'Inherit' },
                          { value: 'above', label: 'Above' },
                          { value: 'floating', label: 'Floating' },
                          { value: 'hidden', label: 'Hidden' }
                        ]}
                      />
                    )}

                    {/* Log visible */}
                    {!isLayoutField && (
                      <FormControlLabel
                        control={
                          <Switch
                            checked={selectedField.logVisible !== false}
                            onChange={(e) => updateField(selectedField.id, 'logVisible', e.target.checked)}
                            size="small"
                          />
                        }
                        label="Show in CTM activity log"
                      />
                    )}

                    {/* Register field */}
                    {!isLayoutField && selectedField.isCustom && (
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!selectedField.registerField}
                            onChange={(e) => updateField(selectedField.id, 'registerField', e.target.checked)}
                            size="small"
                          />
                        }
                        label="Register as CTM custom field"
                      />
                    )}

                    {/* Conditional logic */}
                    {!isLayoutField && fields.length > 1 && (
                      <>
                        <Divider />
                        <Typography variant="caption" color="text.secondary" fontWeight={600}>
                          Conditions
                        </Typography>
                        <SelectField
                          label="Logic"
                          value={selectedField.conditionLogic || 'all'}
                          onChange={(e) => updateField(selectedField.id, 'conditionLogic', e.target.value)}
                          size="small"
                          options={[
                            { value: 'all', label: 'ALL must match' },
                            { value: 'any', label: 'ANY must match' }
                          ]}
                        />
                        {(selectedField.conditions || []).map((cond, ci) => (
                          <Box key={ci} sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                            <Stack spacing={1}>
                              <SelectField
                                label="When field"
                                value={cond.field || ''}
                                onChange={(e) => {
                                  const newConds = [...(selectedField.conditions || [])];
                                  newConds[ci] = { ...newConds[ci], field: e.target.value };
                                  updateField(selectedField.id, 'conditions', newConds);
                                }}
                                size="small"
                              >
                                {fields
                                  .filter((f) => f.id !== selectedField.id && !['heading', 'paragraph', 'divider'].includes(f.type))
                                  .map((f) => (
                                    <MenuItem key={f.id} value={f.id}>
                                      {f.label || f.name}
                                    </MenuItem>
                                  ))}
                              </SelectField>
                              <SelectField
                                label="Operator"
                                value={cond.operator || 'equals'}
                                onChange={(e) => {
                                  const newConds = [...(selectedField.conditions || [])];
                                  newConds[ci] = { ...newConds[ci], operator: e.target.value };
                                  updateField(selectedField.id, 'conditions', newConds);
                                }}
                                size="small"
                                options={OPERATORS}
                              />
                              {!['is_empty', 'is_not_empty'].includes(cond.operator) && (
                                <TextField
                                  label="Value"
                                  value={cond.value || ''}
                                  onChange={(e) => {
                                    const newConds = [...(selectedField.conditions || [])];
                                    newConds[ci] = { ...newConds[ci], value: e.target.value };
                                    updateField(selectedField.id, 'conditions', newConds);
                                  }}
                                  size="small"
                                />
                              )}
                              <Button
                                size="small"
                                color="error"
                                onClick={() => {
                                  updateField(
                                    selectedField.id,
                                    'conditions',
                                    (selectedField.conditions || []).filter((_, j) => j !== ci)
                                  );
                                }}
                              >
                                Remove
                              </Button>
                            </Stack>
                          </Box>
                        ))}
                        <Button
                          size="small"
                          startIcon={<AddIcon />}
                          onClick={() => {
                            const otherField = fields.find(
                              (f) => f.id !== selectedField.id && !['heading', 'paragraph', 'divider'].includes(f.type)
                            );
                            updateField(selectedField.id, 'conditions', [
                              ...(selectedField.conditions || []),
                              { field: otherField?.id || '', operator: 'equals', value: '' }
                            ]);
                          }}
                          disabled={fields.length <= 1}
                        >
                          Add Condition
                        </Button>
                      </>
                    )}

                    <Divider />
                    {/* Duplicate / Delete */}
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        Drag handle to reorder
                      </Typography>
                      <Tooltip title="Duplicate">
                        <IconButton size="small" onClick={() => duplicateField(selectedField.id)}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => removeField(selectedField.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                )
              ) : sidebarTab === 'settings' ? (
                <Stack spacing={2}>
                  <Typography variant="subtitle2">Form Settings</Typography>

                  <SelectField
                    label="Label Style"
                    value={settings.labelStyle || 'above'}
                    onChange={(e) => updateSettings({ labelStyle: e.target.value })}
                    size="small"
                    options={[
                      { value: 'above', label: 'Above' },
                      { value: 'floating', label: 'Floating' },
                      { value: 'hidden', label: 'Hidden' }
                    ]}
                  />

                  <TextField
                    label="Submit Button Text"
                    value={settings.submitText || 'Submit'}
                    onChange={(e) => updateSettings({ submitText: e.target.value })}
                    size="small"
                    fullWidth
                  />

                  <SelectField
                    label="Color Scheme"
                    value={settings.colorScheme || 'light'}
                    onChange={(e) => updateSettings({ colorScheme: e.target.value })}
                    size="small"
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' }
                    ]}
                  />

                  <Stack spacing={1}>
                    <Typography variant="caption" fontWeight={600}>
                      Submit Button Color
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        component="input"
                        type="color"
                        value={settings.colors?.btnBg || '#2271b1'}
                        onChange={(e) => updateSettings({ colors: { ...(settings.colors || {}), btnBg: e.target.value } })}
                        sx={{
                          width: 36,
                          height: 36,
                          border: '1px solid #ccc',
                          borderRadius: 1,
                          cursor: 'pointer',
                          p: 0,
                          '&::-webkit-color-swatch-wrapper': { p: 0 },
                          '&::-webkit-color-swatch': { border: 'none', borderRadius: 1 }
                        }}
                      />
                      <TextField
                        value={settings.colors?.btnBg || '#2271b1'}
                        onChange={(e) => updateSettings({ colors: { ...(settings.colors || {}), btnBg: e.target.value } })}
                        size="small"
                        sx={{ flex: 1 }}
                        inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                      />
                    </Box>
                  </Stack>

                  <Stack spacing={1}>
                    <Typography variant="caption" fontWeight={600}>
                      Accent / Focus Color
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        component="input"
                        type="color"
                        value={settings.colors?.focus || '#2271b1'}
                        onChange={(e) => updateSettings({ colors: { ...(settings.colors || {}), focus: e.target.value } })}
                        sx={{
                          width: 36,
                          height: 36,
                          border: '1px solid #ccc',
                          borderRadius: 1,
                          cursor: 'pointer',
                          p: 0,
                          '&::-webkit-color-swatch-wrapper': { p: 0 },
                          '&::-webkit-color-swatch': { border: 'none', borderRadius: 1 }
                        }}
                      />
                      <TextField
                        value={settings.colors?.focus || '#2271b1'}
                        onChange={(e) => updateSettings({ colors: { ...(settings.colors || {}), focus: e.target.value } })}
                        size="small"
                        sx={{ flex: 1 }}
                        inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                      />
                    </Box>
                  </Stack>

                  <Divider />
                  <Typography variant="caption" fontWeight={600}>
                    Multi-Step
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!settings.multiStep}
                        onChange={(e) => updateSettings({ multiStep: e.target.checked })}
                        size="small"
                      />
                    }
                    label="Enable multi-step"
                  />
                  {settings.multiStep && (
                    <>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!settings.autoAdvance}
                            onChange={(e) => updateSettings({ autoAdvance: e.target.checked })}
                            size="small"
                          />
                        }
                        label="Auto-advance steps"
                      />
                      <Typography variant="caption" color="text.secondary">
                        Set each field's "step" value (0, 1, 2...) in the Field tab to assign it to a step.
                      </Typography>
                    </>
                  )}

                  <Divider />
                  <Typography variant="caption" fontWeight={600}>
                    Scoring
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!settings.scoring?.enabled}
                        onChange={(e) => updateSettings({ scoring: { ...(settings.scoring || {}), enabled: e.target.checked } })}
                        size="small"
                      />
                    }
                    label="Enable scoring"
                  />
                  {settings.scoring?.enabled && (
                    <>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.scoring?.showTotal !== false}
                            onChange={(e) => updateSettings({ scoring: { ...settings.scoring, showTotal: e.target.checked } })}
                            size="small"
                          />
                        }
                        label="Show score to user"
                      />
                      <TextField
                        label="Score field name"
                        value={settings.scoring?.sendAs || 'custom_total_score'}
                        onChange={(e) => updateSettings({ scoring: { ...settings.scoring, sendAs: e.target.value } })}
                        size="small"
                        fullWidth
                      />
                    </>
                  )}

                  <Divider />
                  <Typography variant="caption" fontWeight={600}>
                    Spam &amp; CTM
                  </Typography>
                  <SelectField
                    label="reCAPTCHA enforcement"
                    value={settings.recaptcha_mode || 'review_missing_token'}
                    onChange={(e) => updateSettings({ recaptcha_mode: e.target.value })}
                    size="small"
                    options={[
                      { value: 'review_missing_token', label: 'Review missing tokens (recommended)' },
                      { value: 'block_low_score', label: 'Block bots, pass missing tokens' },
                      { value: 'strict_block', label: 'Strict — block any failure' },
                      { value: 'observe_only', label: 'Observe only (never block)' }
                    ]}
                  />
                  <Typography variant="caption" color="text.secondary">
                    A missing reCAPTCHA token often means a real visitor behind a privacy browser
                    or blocker — not a bot. &quot;Review&quot; accepts and forwards those leads but
                    flags them; only positive bot signals (low score / invalid token) are held.
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.require_phone_for_ctm !== false}
                        onChange={(e) => updateSettings({ require_phone_for_ctm: e.target.checked })}
                        size="small"
                      />
                    }
                    label="Require phone number"
                  />
                  <Typography variant="caption" color="text.secondary">
                    On — a phone number is required (CTM needs it). Off — email-only leads are
                    accepted and the team is notified, but they are not forwarded to CTM.
                  </Typography>
                </Stack>
              ) : sidebarTab === 'after' ? (
                (() => {
                  const af = forms.find((f) => f.id === selectedFormId) || {};
                  const submitAction = af.submit_action || 'message';
                  const saveForm = (patch) =>
                    updateCtmForm(selectedFormId, patch)
                      .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                      .catch((err) => showToast(getErrorMessage(err), 'error'));
                  // Optimistic local update so text fields are typeable; persist on blur
                  const setLocal = (patch) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...patch } : x)));
                  const saveOnBlur = (key) => (e) =>
                    updateCtmForm(selectedFormId, { [key]: e.target.value })
                      .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                      .catch((err) => showToast(getErrorMessage(err), 'error'));
                  return (
                    <Stack spacing={2}>
                      <Typography variant="subtitle2">After Submission</Typography>
                      <SelectField
                        label="Action"
                        value={submitAction}
                        onChange={(e) => {
                          const patch = { submit_action: e.target.value };
                          if (e.target.value === 'popup' && !af.thankyou_html) patch.thankyou_html = DEFAULT_THANKYOU_HTML;
                          saveForm(patch);
                        }}
                        size="small"
                        options={[
                          { value: 'message', label: 'Show message' },
                          { value: 'redirect', label: 'Redirect to URL' },
                          { value: 'popup', label: 'Show popup' }
                        ]}
                      />

                      {submitAction === 'message' && (
                        <TextField
                          label="Success Message"
                          value={af.success_message || ''}
                          onChange={(e) => setLocal({ success_message: e.target.value })}
                          onBlur={saveOnBlur('success_message')}
                          size="small"
                          fullWidth
                          multiline
                          rows={2}
                          helperText="Shown inline below the form"
                        />
                      )}
                      {submitAction === 'redirect' && (
                        <TextField
                          label="Redirect URL"
                          value={af.redirect_url || ''}
                          onChange={(e) => setLocal({ redirect_url: e.target.value })}
                          onBlur={saveOnBlur('redirect_url')}
                          size="small"
                          fullWidth
                          helperText="Use {field_name} for tokens. e.g. /thanks?name={caller_name}"
                        />
                      )}
                      {submitAction === 'popup' && (
                        <TextField
                          label="Popup HTML"
                          value={af.thankyou_html || DEFAULT_THANKYOU_HTML}
                          onChange={(e) => setLocal({ thankyou_html: e.target.value })}
                          onBlur={(e) => {
                            const val = e.target.value.trim() || DEFAULT_THANKYOU_HTML;
                            setLocal({ thankyou_html: val });
                            saveOnBlur('thankyou_html')({ target: { value: val } });
                          }}
                          size="small"
                          fullWidth
                          multiline
                          rows={10}
                          helperText="Use {field_name} for tokens"
                        />
                      )}

                      <Divider />
                      <Typography variant="caption" fontWeight={600}>
                        Duplicate Protection
                      </Typography>
                      <TextField
                        label="Office Phone (display)"
                        value={af.dupe_phone || ''}
                        onChange={(e) => setLocal({ dupe_phone: e.target.value })}
                        onBlur={saveOnBlur('dupe_phone')}
                        size="small"
                        fullWidth
                        placeholder="(469) 555-1234"
                      />
                      <TextField
                        label="Office Phone (tel: href)"
                        value={af.dupe_phone_href || ''}
                        onChange={(e) => setLocal({ dupe_phone_href: e.target.value })}
                        onBlur={saveOnBlur('dupe_phone_href')}
                        size="small"
                        fullWidth
                        placeholder="+14695551234"
                      />
                    </Stack>
                  );
                })()
              ) : sidebarTab === 'notify' ? (
                (() => {
                  const nf = forms.find((f) => f.id === selectedFormId) || {};
                  const setLocal = (patch) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...patch } : x)));
                  const saveOnBlur = (key, transform) => (e) => {
                    const val = transform ? transform(e.target.value) : e.target.value;
                    updateCtmForm(selectedFormId, { [key]: val })
                      .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                      .catch((err) => showToast(getErrorMessage(err), 'error'));
                  };
                  const splitEmails = (v) =>
                    v
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                  return (
                    <Stack spacing={2}>
                      <Typography variant="subtitle2">Email Notifications</Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={nf.notification_enabled !== false}
                            onChange={(e) =>
                              updateCtmForm(selectedFormId, { notification_enabled: e.target.checked })
                                .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                                .catch(() => {})
                            }
                            size="small"
                          />
                        }
                        label="Send email on submission"
                      />
                      <TextField
                        label="Recipients (comma-separated)"
                        value={(nf.notification_emails || []).join(', ')}
                        onChange={(e) => setLocal({ notification_emails: e.target.value.split(',').map((s) => s.trim()) })}
                        onBlur={saveOnBlur('notification_emails', splitEmails)}
                        size="small"
                        fullWidth
                        helperText="Leave empty to use account defaults"
                      />
                      <TextField
                        label="CC (comma-separated)"
                        value={(nf.notification_cc || []).join(', ')}
                        onChange={(e) => setLocal({ notification_cc: e.target.value.split(',').map((s) => s.trim()) })}
                        onBlur={saveOnBlur('notification_cc', splitEmails)}
                        size="small"
                        fullWidth
                      />
                      <TextField
                        label="Subject Template"
                        value={nf.notification_subject_template || ''}
                        onChange={(e) => setLocal({ notification_subject_template: e.target.value })}
                        onBlur={saveOnBlur('notification_subject_template')}
                        size="small"
                        fullWidth
                        helperText="Use {{field_name}} for tokens"
                      />
                      <TextField
                        label="Body Template"
                        value={nf.notification_body_template || ''}
                        onChange={(e) => setLocal({ notification_body_template: e.target.value })}
                        onBlur={saveOnBlur('notification_body_template')}
                        size="small"
                        fullWidth
                        multiline
                        rows={4}
                        helperText="Leave empty for default field table"
                      />

                      <Divider sx={{ my: 1 }} />
                      <Typography variant="subtitle2">Autoresponder to Submitter</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Send a confirmation email to the person who filled out the form. Useful for lead-magnet PDFs (free guides, checklists, etc.). Requires an email field on the form.
                      </Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!nf.autoresponder_enabled}
                            onChange={(e) =>
                              updateCtmForm(selectedFormId, { autoresponder_enabled: e.target.checked })
                                .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                                .catch((err) => showToast(getErrorMessage(err), 'error'))
                            }
                            size="small"
                          />
                        }
                        label="Send confirmation email to submitter"
                      />
                      {nf.autoresponder_enabled && (
                        <>
                          {(() => {
                            const formNotify = Array.isArray(nf.notification_emails) ? nf.notification_emails : [];
                            const clientNotify = Array.isArray(nf.client_notification_emails) ? nf.client_notification_emails : [];
                            const merged = Array.from(new Set([...formNotify, ...clientNotify].map((s) => (s || '').trim()).filter(Boolean)));
                            const selected = Array.isArray(nf.autoresponder_reply_to) ? nf.autoresponder_reply_to : [];
                            const fallback = formNotify.length ? formNotify : clientNotify;
                            return (
                              <Autocomplete
                                multiple
                                freeSolo
                                size="small"
                                options={merged}
                                value={selected}
                                onChange={(_e, newValue) => {
                                  const cleaned = Array.from(
                                    new Set(
                                      newValue
                                        .map((s) => (typeof s === 'string' ? s.trim() : ''))
                                        .filter(Boolean)
                                    )
                                  );
                                  updateCtmForm(selectedFormId, { autoresponder_reply_to: cleaned })
                                    .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                                    .catch((err) => showToast(getErrorMessage(err), 'error'));
                                }}
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    label="Reply-To"
                                    placeholder={selected.length ? '' : 'Pick or type email addresses'}
                                    helperText={
                                      selected.length
                                        ? 'Replies route to these addresses.'
                                        : fallback.length
                                          ? `Defaults to: ${fallback.join(', ')}`
                                          : 'No notification recipients configured — replies will go to the From address.'
                                    }
                                  />
                                )}
                              />
                            );
                          })()}
                          <TextField
                            label="Subject"
                            value={nf.autoresponder_subject || ''}
                            onChange={(e) => setLocal({ autoresponder_subject: e.target.value })}
                            onBlur={saveOnBlur('autoresponder_subject')}
                            size="small"
                            fullWidth
                            helperText="Use {{field_name}} for tokens (e.g. {{caller_name}})"
                          />
                          <TextField
                            label="Preview Text"
                            value={nf.autoresponder_preheader || ''}
                            onChange={(e) => setLocal({ autoresponder_preheader: e.target.value })}
                            onBlur={saveOnBlur('autoresponder_preheader')}
                            size="small"
                            fullWidth
                            helperText="Short text shown in inbox previews (Gmail, Apple Mail, Outlook). Tokens supported."
                          />
                          <SelectField
                            label="Body Format"
                            value={nf.autoresponder_body_format || 'text'}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateCtmForm(selectedFormId, { autoresponder_body_format: val })
                                .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                                .catch((err) => showToast(getErrorMessage(err), 'error'));
                            }}
                            options={[
                              { value: 'text', label: 'Plain Text (auto paragraphs)' },
                              { value: 'html', label: 'Custom HTML' }
                            ]}
                            size="small"
                            fullWidth
                          />
                          <TextField
                            label={nf.autoresponder_body_format === 'html' ? 'Body (HTML)' : 'Body'}
                            value={nf.autoresponder_body || ''}
                            onChange={(e) => setLocal({ autoresponder_body: e.target.value })}
                            onBlur={saveOnBlur('autoresponder_body')}
                            size="small"
                            fullWidth
                            multiline
                            rows={6}
                            helperText={
                              nf.autoresponder_body_format === 'html'
                                ? 'Write raw HTML. Tokens like {{caller_name}} are inserted (escaped). The client logo and outer frame are added automatically.'
                                : 'Write plain text. Blank lines become paragraphs, single newlines become line breaks. Tokens like {{caller_name}} supported.'
                            }
                          />
                          {(() => {
                            const pdfDocs = clientDocs.filter(
                              (d) => d.file_id && (d.content_type === 'application/pdf' || /\.pdf$/i.test(d.name || ''))
                            );
                            const selected = Array.isArray(nf.autoresponder_attachments) ? nf.autoresponder_attachments : [];
                            const selectedDocs = selected
                              .map((sel) => pdfDocs.find((d) => d.file_id === sel.file_id))
                              .filter(Boolean);
                            const totalBytes = selectedDocs.reduce((sum, d) => sum + (d.size_bytes || 0), 0);
                            const overSize = totalBytes > 10 * 1024 * 1024;
                            const overCount = selected.length > 5;
                            return (
                              <>
                                <Autocomplete
                                  multiple
                                  size="small"
                                  options={pdfDocs}
                                  loading={clientDocsLoading}
                                  value={selectedDocs}
                                  getOptionLabel={(d) => d.label || d.name || ''}
                                  isOptionEqualToValue={(a, b) => a.file_id === b.file_id}
                                  onChange={(_e, newValue) => {
                                    const next = newValue.slice(0, 5).map((d) => ({
                                      file_id: d.file_id,
                                      filename: d.name || d.label || 'attachment.pdf'
                                    }));
                                    updateCtmForm(selectedFormId, { autoresponder_attachments: next })
                                      .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                                      .catch((err) => showToast(getErrorMessage(err), 'error'));
                                  }}
                                  renderInput={(params) => (
                                    <TextField
                                      {...params}
                                      label="PDF Attachments"
                                      placeholder={pdfDocs.length ? 'Select PDFs from Documents tab' : 'No PDFs uploaded yet'}
                                      helperText={`Max 5 files / 10 MB total. Upload PDFs to the client Documents tab to make them available here.${
                                        selected.length ? ` Selected: ${selected.length} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)` : ''
                                      }`}
                                    />
                                  )}
                                />
                                {(overSize || overCount) && (
                                  <Alert severity="warning" sx={{ mt: 1 }}>
                                    {overCount && 'Too many files (max 5). '}
                                    {overSize && 'Total size exceeds 10 MB — some attachments will be dropped at send time.'}
                                  </Alert>
                                )}
                              </>
                            );
                          })()}
                        </>
                      )}
                    </Stack>
                  );
                })()
              ) : sidebarTab === 'analytics' ? (
                (() => {
                  const af = forms.find((f) => f.id === selectedFormId) || {};
                  const a = af.analytics_json || {};
                  const ctx = analyticsCtx;
                  const saveAnalytics = (patch) => {
                    const merged = { ...a, ...patch };
                    updateCtmForm(selectedFormId, { analytics_json: merged })
                      .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                      .catch((err) => showToast(getErrorMessage(err), 'error'));
                  };
                  const debouncedSave = (patch) => {
                    clearTimeout(analyticsSaveTimer.current);
                    analyticsSaveTimer.current = setTimeout(() => saveAnalytics(patch), 800);
                  };
                  const setLocalAnalytics = (patch) =>
                    setForms((prev) =>
                      prev.map((x) => (x.id === selectedFormId ? { ...x, analytics_json: { ...(x.analytics_json || {}), ...patch } } : x))
                    );
                  const saveOnBlurAnalytics = (key) => () => saveAnalytics({ [key]: a[key] });

                  const GA4_EVENTS = [
                    'generate_lead',
                    'form_submit',
                    'sign_up',
                    'purchase',
                    'contact',
                    'submit_lead_form',
                    'request_quote',
                    'book_appointment'
                  ];
                  const META_EVENTS = [
                    'Lead',
                    'Contact',
                    'SubmitApplication',
                    'Schedule',
                    'CompleteRegistration',
                    'Purchase',
                    'Subscribe',
                    'StartTrial'
                  ];

                  return (
                    <Stack spacing={2}>
                      <Typography variant="subtitle2">Analytics</Typography>

                      {/* Account tracking status */}
                      {analyticsCtxLoading ? (
                        <Typography variant="caption" color="text.secondary">
                          Loading account config...
                        </Typography>
                      ) : ctx ? (
                        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                          <Chip
                            size="small"
                            label="GA4"
                            color={ctx.configured.ga4 ? 'success' : 'default'}
                            variant={ctx.configured.ga4 ? 'filled' : 'outlined'}
                          />
                          <Chip
                            size="small"
                            label="Meta"
                            color={ctx.configured.meta ? 'success' : 'default'}
                            variant={ctx.configured.meta ? 'filled' : 'outlined'}
                          />
                          <Chip
                            size="small"
                            label="Google Ads"
                            color={ctx.configured.googleAds ? 'success' : 'default'}
                            variant={ctx.configured.googleAds ? 'filled' : 'outlined'}
                          />
                          {ctx.configured.relay && <Chip size="small" label="Server Relay" color="info" variant="outlined" />}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          No tracking configured for this account.
                        </Typography>
                      )}

                      <Typography variant="caption" color="text.secondary">
                        Leave blank to inherit account defaults. Override individual events for this form only.
                      </Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!af.analytics_override}
                            onChange={(e) =>
                              updateCtmForm(selectedFormId, { analytics_override: e.target.checked })
                                .then((f) => setForms((prev) => prev.map((x) => (x.id === selectedFormId ? { ...x, ...f } : x))))
                                .catch(() => {})
                            }
                            size="small"
                          />
                        }
                        label="Override all account defaults for this form"
                      />
                      <Divider />

                      {/* GA4 */}
                      <Typography variant="caption" fontWeight={600}>
                        Google Analytics 4
                        {!a.ga4_event && ctx?.defaults?.ga4_event && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {' '}
                            — inherits: {ctx.defaults.ga4_event}
                          </Typography>
                        )}
                      </Typography>
                      <Autocomplete
                        freeSolo
                        size="small"
                        options={GA4_EVENTS}
                        value={a.ga4_event || ''}
                        onInputChange={(_, val) => {
                          setLocalAnalytics({ ga4_event: val });
                          debouncedSave({ ga4_event: val || undefined });
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="GA4 Event Name"
                            placeholder={ctx?.defaults?.ga4_event || 'generate_lead'}
                            helperText="Fires gtag('event', ...)"
                          />
                        )}
                      />
                      <Divider />

                      {/* Google Ads — dropdown of available conversion actions */}
                      <Typography variant="caption" fontWeight={600}>
                        Google Ads
                        {!a.gads_conversion_action_id && ctx?.defaults?.gads_conversion_action && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {' '}
                            — inherits: {ctx.defaults.gads_conversion_action.name}
                          </Typography>
                        )}
                      </Typography>
                      {ctx?.conversionActions?.length > 0 ? (
                        <Autocomplete
                          size="small"
                          options={ctx.conversionActions}
                          getOptionLabel={(opt) => (typeof opt === 'string' ? opt : `${opt.name} (${opt.type})`)}
                          value={ctx.conversionActions.find((ca) => String(ca.id) === String(a.gads_conversion_action_id)) || null}
                          onChange={(_, val) => {
                            const patch = {
                              gads_conversion_action_id: val?.id || undefined,
                              gads_conversion_action_name: val?.name || undefined
                            };
                            setLocalAnalytics(patch);
                            saveAnalytics(patch);
                          }}
                          isOptionEqualToValue={(opt, val) => String(opt.id) === String(val?.id)}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label="Offline Conversion Action"
                              placeholder={ctx?.defaults?.gads_conversion_action?.name || 'Select conversion action'}
                              helperText="Server-side relay only. Browser gtag conversion is configured below."
                            />
                          )}
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {ctx?.configured?.googleAds
                            ? 'No offline conversion actions were found for this Google Ads account.'
                            : 'No Google Ads account linked for offline conversion uploads.'}
                        </Typography>
                      )}
                      <TextField
                        label="Browser Conversion (send_to)"
                        value={a.gads_conversion || ''}
                        onChange={(e) => setLocalAnalytics({ gads_conversion: e.target.value })}
                        onBlur={() => saveAnalytics({ gads_conversion: a.gads_conversion || undefined })}
                        size="small"
                        fullWidth
                        placeholder={ctx?.defaults?.gads_browser_conversion || 'AW-XXXXXXXXX/LABEL'}
                        helperText={
                          !a.gads_conversion && ctx?.defaults?.gads_browser_conversion
                            ? `Inherits browser default: ${ctx.defaults.gads_browser_conversion}`
                            : 'Optional browser-side gtag conversion. Leave blank to rely on inherited defaults or server relay only.'
                        }
                      />
                      <Divider />

                      {/* Meta / Facebook */}
                      <Typography variant="caption" fontWeight={600}>
                        Facebook / Meta
                        {!a.fb_event && ctx?.defaults?.fb_event && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {' '}
                            — inherits: {ctx.defaults.fb_event}
                          </Typography>
                        )}
                      </Typography>
                      <Autocomplete
                        freeSolo
                        size="small"
                        options={META_EVENTS}
                        value={a.fb_event || ''}
                        onInputChange={(_, val) => {
                          setLocalAnalytics({ fb_event: val });
                          debouncedSave({ fb_event: val || undefined });
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="FB Event Name"
                            placeholder={ctx?.defaults?.fb_event || 'Lead'}
                            helperText="Fires fbq('track', ...)"
                          />
                        )}
                      />
                      <Divider />

                      {/* TikTok */}
                      <Typography variant="caption" fontWeight={600}>
                        TikTok
                      </Typography>
                      <TextField
                        label="TikTok Event Name"
                        value={a.tiktok_event || ''}
                        onChange={(e) => setLocalAnalytics({ tiktok_event: e.target.value })}
                        onBlur={saveOnBlurAnalytics('tiktok_event')}
                        size="small"
                        fullWidth
                        placeholder="SubmitForm"
                      />
                      <Divider />

                      {/* Bing */}
                      <Typography variant="caption" fontWeight={600}>
                        Bing / Microsoft Ads
                      </Typography>
                      <TextField
                        label="Bing Event Name"
                        value={a.bing_event || ''}
                        onChange={(e) => setLocalAnalytics({ bing_event: e.target.value })}
                        onBlur={saveOnBlurAnalytics('bing_event')}
                        size="small"
                        fullWidth
                        placeholder="submit"
                      />
                    </Stack>
                  );
                })()
              ) : null}
            </Box>
          </Paper>
        </Box>
      )}
    </Stack>
  );
}
