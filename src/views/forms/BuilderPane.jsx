/**
 * BuilderPane — Enhanced visual form builder with categorized field palette,
 * live preview canvas, and rich properties panel.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
import PublishIcon from '@mui/icons-material/Publish';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import SelectField from 'ui-component/extended/SelectField';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { getForm, saveDraftSchema, publishForm } from 'api/forms';

import FormPreview, { PREVIEW_CSS } from './FormPreview';
import CTMConfigPanel from './CTMConfigPanel';
import NotificationSettings from './NotificationSettings';
import AIFormBuilder from './AIFormBuilder';
import StepManager from './StepManager';
import ConditionalLogicPanel from './ConditionalLogicPanel';
import ScoringPanel from './ScoringPanel';
import {
  FIELD_TYPES,
  FIELD_CATEGORIES,
  STYLE_DEFAULTS,
  WIDTH_OPTIONS,
  LABEL_STYLES,
  makeDefaultField,
  uniqueFieldName,
  sanitizeFieldName,
  hasOptions,
  LAYOUT_FIELD_TYPES
} from './fieldTypes';

// ---------------------------------------------------------------------------
// Color picker helper
// ---------------------------------------------------------------------------

function ColorField({ label, value, onChange }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{label}</Typography>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          component="input"
          type="color"
          value={value || '#007bff'}
          onChange={(e) => onChange(e.target.value)}
          sx={{
            width: 36, height: 32, border: '1px solid #ccc', borderRadius: 1,
            cursor: 'pointer', padding: '2px', background: 'transparent'
          }}
        />
        <TextField
          value={value || ''}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === '') onChange(v);
          }}
          size="small"
          sx={{ flex: 1 }}
          inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
        />
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Options editor for select/radio/checkbox
// ---------------------------------------------------------------------------

function OptionsEditor({ options, onChange, showScores }) {
  const updateOption = (index, updates) => {
    const updated = options.map((opt, i) => (i === index ? { ...opt, ...updates } : opt));
    onChange(updated);
  };

  const addOption = () => {
    const num = options.length + 1;
    onChange([...options, { label: `Option ${num}`, value: `option_${num}`, score: 0 }]);
  };

  const removeOption = (index) => {
    if (options.length <= 1) return;
    onChange(options.filter((_, i) => i !== index));
  };

  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">Options</Typography>
      {options.map((opt, i) => (
        <Stack key={i} direction="row" spacing={0.5} alignItems="center">
          <TextField
            value={opt.label}
            onChange={(e) => updateOption(i, { label: e.target.value })}
            size="small"
            sx={{ flex: 1 }}
            placeholder="Label"
          />
          <TextField
            value={opt.value}
            onChange={(e) => updateOption(i, { value: sanitizeFieldName(e.target.value) })}
            size="small"
            sx={{ flex: 1 }}
            placeholder="Value"
          />
          {showScores && (
            <TextField
              type="number"
              value={opt.score || 0}
              onChange={(e) => updateOption(i, { score: Number(e.target.value) || 0 })}
              size="small"
              sx={{ width: 60 }}
              inputProps={{ style: { textAlign: 'center' } }}
            />
          )}
          <IconButton size="small" onClick={() => removeOption(i)} disabled={options.length <= 1}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={addOption} sx={{ alignSelf: 'flex-start' }}>
        Add Option
      </Button>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// BuilderPane
// ---------------------------------------------------------------------------

export default function BuilderPane({ forms, setForms, onRefresh, initialFormId }) {
  const { showToast } = useToast();
  const [selectedFormId, setSelectedFormId] = useState(initialFormId || '');
  const [fields, setFields] = useState([]);
  const [style, setStyle] = useState({ ...STYLE_DEFAULTS });
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingForm, setLoadingForm] = useState(false);
  const [propsTab, setPropsTab] = useState('field');
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);

  // Inject preview CSS on mount
  useEffect(() => {
    if (document.getElementById('anchor-form-preview-styles')) return;
    const el = document.createElement('style');
    el.id = 'anchor-form-preview-styles';
    el.textContent = PREVIEW_CSS;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const draftForms = forms.filter((f) => f.status !== 'archived');

  // Auto-load initial form
  useEffect(() => {
    if (initialFormId && !fields.length) {
      loadFormSchema(initialFormId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFormId]);

  // Auto-save (debounced 1.5s)
  useEffect(() => {
    if (!selectedFormId || loadingForm) return;
    const timer = setTimeout(async () => {
      try {
        await saveDraftSchema(selectedFormId, { fields, style });
        setForms((prev) => prev.map((f) => (f.id === selectedFormId ? { ...f, schema_json: { fields, style } } : f)));
      } catch (err) {
        console.error('[forms:autosave]', err);
      }
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, style, selectedFormId]);

  const loadFormSchema = async (formId) => {
    if (!formId) {
      setFields([]);
      setStyle({ ...STYLE_DEFAULTS });
      setSelectedIndex(null);
      return;
    }
    try {
      setLoadingForm(true);
      const form = await getForm(formId);
      const schema = form.schema_json || {};
      setFields(schema.fields || []);
      setStyle({ ...STYLE_DEFAULTS, ...(schema.style || {}) });
      setSelectedIndex(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoadingForm(false);
    }
  };

  const handleFormSelect = (formId) => {
    setSelectedFormId(formId);
    loadFormSchema(formId);
  };

  const addField = (type) => {
    const newField = makeDefaultField(type);
    const existingNames = fields.map((f) => f.name);
    newField.name = uniqueFieldName(newField.name, existingNames);
    const updated = [...fields, newField];
    setFields(updated);
    setSelectedIndex(updated.length - 1);
    setPropsTab('field');
  };

  const updateField = (index, updates) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  const removeField = (index) => {
    setFields(fields.filter((_, i) => i !== index));
    setSelectedIndex(null);
  };

  const moveField = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= fields.length) return;
    const updated = [...fields];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setFields(updated);
    setSelectedIndex(newIndex);
  };

  const updateStyle = (updates) => {
    setStyle((prev) => ({ ...prev, ...updates }));
  };

  const handleSaveDraft = async () => {
    if (!selectedFormId) return;
    try {
      setSaving(true);
      const updatedForm = await saveDraftSchema(selectedFormId, { fields, style });
      setForms((prev) => prev.map((f) => (f.id === selectedFormId ? { ...f, schema_json: updatedForm.schema_json } : f)));
      showToast('Draft saved', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedFormId) return;
    if (fields.length === 0) { showToast('Add at least one field before publishing', 'error'); return; }
    try {
      setSaving(true);
      await publishForm(selectedFormId, { schemaJson: { fields, style } });
      setForms((prev) => prev.map((f) => (f.id === selectedFormId ? { ...f, status: 'published', schema_json: { fields, style } } : f)));
      showToast('Form published!', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedField = selectedIndex !== null ? fields[selectedIndex] : null;
  const selectedFieldType = selectedField ? FIELD_TYPES.find((ft) => ft.type === selectedField.type) : null;
  const isLayoutField = selectedField ? LAYOUT_FIELD_TYPES.includes(selectedField.type) : false;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">Form Builder</Typography>
        <Stack direction="row" spacing={1}>
          <LoadingButton onClick={handleSaveDraft} loading={saving} disabled={!selectedFormId} loadingLabel="Saving...">
            Save Draft
          </LoadingButton>
          <Button variant="contained" startIcon={<PublishIcon />} onClick={handlePublish} disabled={saving || !selectedFormId}>
            Publish
          </Button>
        </Stack>
      </Stack>

      {/* Form selector */}
      <SelectField label="Select Form" value={selectedFormId} onChange={(e) => handleFormSelect(e.target.value)} fullWidth={false} sx={{ maxWidth: 400 }}>
        <MenuItem value="">— Select a form —</MenuItem>
        {draftForms.map((f) => (
          <MenuItem key={f.id} value={f.id}>
            {f.name} ({f.status})
          </MenuItem>
        ))}
      </SelectField>

      {/* AI Builder */}
      {selectedFormId && !loadingForm && (
        <AIFormBuilder
          open={aiBuilderOpen}
          onToggle={setAiBuilderOpen}
          formType={forms.find((f) => f.id === selectedFormId)?.form_type || 'conversion'}
          onApply={(schema) => {
            setFields(schema.fields || []);
            if (schema.style) setStyle((prev) => ({ ...prev, ...schema.style }));
            setSelectedIndex(null);
          }}
        />
      )}

      {!selectedFormId ? (
        <Alert severity="info">Select a form above to start editing its fields.</Alert>
      ) : loadingForm ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, minHeight: 500 }}>
          {/* ─── Field Palette ─── */}
          <Paper variant="outlined" sx={{ p: 1.5, width: 200, flexShrink: 0, overflow: 'auto' }}>
            {FIELD_CATEGORIES.map((cat) => {
              const catFields = FIELD_TYPES.filter((ft) => ft.category === cat.key);
              if (catFields.length === 0) return null;
              return (
                <Box key={cat.key} sx={{ mb: 2 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, px: 0.5 }}>
                    {cat.label}
                  </Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {catFields.map((ft) => (
                      <Button
                        key={ft.type}
                        variant="outlined"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => addField(ft.type)}
                        fullWidth
                        sx={{
                          justifyContent: 'flex-start',
                          textTransform: 'none',
                          fontSize: 12,
                          py: 0.5,
                          color: 'text.primary',
                          borderColor: 'divider',
                          '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
                        }}
                      >
                        {ft.label}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              );
            })}
          </Paper>

          {/* ─── Live Preview Canvas ─── */}
          <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto', p: 0 }}>
            <Box className="anchor-form-builder-wrap" onClick={() => setSelectedIndex(null)}>
              <FormPreview
                fields={fields}
                submitLabel={style.submitLabel}
                style={style}
                selectedIndex={selectedIndex}
                onSelectField={(idx) => { setSelectedIndex(idx); setPropsTab('field'); }}
              />
            </Box>
          </Paper>

          {/* ─── Properties Panel ─── */}
          <Paper variant="outlined" sx={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <Tabs
              value={propsTab}
              onChange={(_, v) => setPropsTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.5, fontSize: 11, minWidth: 60 } }}
            >
              <Tab label="Field" value="field" />
              <Tab label="Style" value="style" />
              <Tab label="Steps" value="steps" />
              <Tab label="Score" value="score" />
              <Tab label="CTM" value="ctm" />
              <Tab label="Notify" value="notify" />
            </Tabs>

            <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
              {propsTab === 'score' ? (
                <ScoringPanel
                  style={style}
                  onStyleChange={(updates) => updateStyle(updates)}
                />
              ) : propsTab === 'steps' ? (
                <StepManager
                  fields={fields}
                  style={style}
                  onStyleChange={(updates) => updateStyle(updates)}
                />
              ) : propsTab === 'ctm' ? (
                <CTMConfigPanel
                  formId={selectedFormId}
                  form={forms.find((f) => f.id === selectedFormId)}
                  onFormUpdate={(updates) => {
                    setForms((prev) => prev.map((f) => (f.id === selectedFormId ? { ...f, ...updates } : f)));
                  }}
                />
              ) : propsTab === 'notify' ? (
                <NotificationSettings
                  formId={selectedFormId}
                  form={forms.find((f) => f.id === selectedFormId)}
                  schemaFields={fields}
                />
              ) : propsTab === 'field' ? (
                !selectedField ? (
                  <Typography variant="body2" color="text.secondary">Click a field in the preview to edit its properties.</Typography>
                ) : (
                  <Stack spacing={2}>
                    {/* Type badge */}
                    <Typography variant="caption" color="text.secondary">
                      Type: {selectedFieldType?.label || selectedField.type}
                    </Typography>

                    {/* Label (all fields) */}
                    <TextField
                      label="Label"
                      value={selectedField.label}
                      onChange={(e) => updateField(selectedIndex, { label: e.target.value })}
                      size="small"
                      fullWidth
                    />

                    {/* Content (layout fields) */}
                    {(selectedField.type === 'heading' || selectedField.type === 'paragraph') && (
                      <TextField
                        label="Content"
                        value={selectedField.content || ''}
                        onChange={(e) => updateField(selectedIndex, { content: e.target.value })}
                        size="small"
                        fullWidth
                        multiline={selectedField.type === 'paragraph'}
                        rows={selectedField.type === 'paragraph' ? 3 : undefined}
                      />
                    )}

                    {/* Field name (submittable fields only) */}
                    {!isLayoutField && (
                      <TextField
                        label="Field Name"
                        value={selectedField.name}
                        onChange={(e) => updateField(selectedIndex, { name: sanitizeFieldName(e.target.value) })}
                        size="small"
                        fullWidth
                        helperText="Used as the field key in submissions (snake_case)"
                      />
                    )}

                    {/* Placeholder (text-like fields) */}
                    {!isLayoutField && !['checkbox', 'radio', 'consent', 'hidden'].includes(selectedField.type) && (
                      <TextField
                        label="Placeholder"
                        value={selectedField.placeholder || ''}
                        onChange={(e) => updateField(selectedIndex, { placeholder: e.target.value })}
                        size="small"
                        fullWidth
                      />
                    )}

                    {/* Default value */}
                    {!isLayoutField && !['checkbox', 'radio', 'consent'].includes(selectedField.type) && (
                      <TextField
                        label="Default Value"
                        value={selectedField.defaultValue || ''}
                        onChange={(e) => updateField(selectedIndex, { defaultValue: e.target.value })}
                        size="small"
                        fullWidth
                      />
                    )}

                    {/* Help text */}
                    {!isLayoutField && selectedField.type !== 'hidden' && (
                      <TextField
                        label="Help Text"
                        value={selectedField.helpText || ''}
                        onChange={(e) => updateField(selectedIndex, { helpText: e.target.value })}
                        size="small"
                        fullWidth
                        placeholder="Shown below the field"
                      />
                    )}

                    {/* Required toggle */}
                    {!isLayoutField && selectedField.type !== 'hidden' && (
                      <FormControlLabel
                        control={
                          <Switch
                            checked={selectedField.required || false}
                            onChange={(e) => updateField(selectedIndex, { required: e.target.checked })}
                          />
                        }
                        label="Required"
                      />
                    )}

                    {/* Consent text */}
                    {selectedField.type === 'consent' && (
                      <TextField
                        label="Consent Text"
                        value={selectedField.consentText || ''}
                        onChange={(e) => updateField(selectedIndex, { consentText: e.target.value })}
                        size="small"
                        fullWidth
                        multiline
                        rows={2}
                      />
                    )}

                    {/* Number min/max/step */}
                    {selectedField.type === 'number' && (
                      <Stack direction="row" spacing={1}>
                        <TextField
                          label="Min"
                          type="number"
                          value={selectedField.min ?? ''}
                          onChange={(e) => updateField(selectedIndex, { min: e.target.value === '' ? null : Number(e.target.value) })}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          label="Max"
                          type="number"
                          value={selectedField.max ?? ''}
                          onChange={(e) => updateField(selectedIndex, { max: e.target.value === '' ? null : Number(e.target.value) })}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          label="Step"
                          type="number"
                          value={selectedField.step ?? ''}
                          onChange={(e) => updateField(selectedIndex, { step: e.target.value === '' ? null : Number(e.target.value) })}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                      </Stack>
                    )}

                    {/* Options editor (select, radio, checkbox) */}
                    {hasOptions(selectedField.type) && (
                      <OptionsEditor
                        options={selectedField.options || []}
                        onChange={(opts) => updateField(selectedIndex, { options: opts })}
                        showScores={style.scoring?.enabled || false}
                      />
                    )}

                    <Divider />

                    {/* Width */}
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Width</Typography>
                      <Stack direction="row" spacing={0.5}>
                        {WIDTH_OPTIONS.map((w) => (
                          <Button
                            key={w.value}
                            size="small"
                            variant={(selectedField.width || 'full') === w.value ? 'contained' : 'outlined'}
                            onClick={() => updateField(selectedIndex, { width: w.value })}
                            sx={{ flex: 1, textTransform: 'none', minWidth: 0, fontSize: 12 }}
                          >
                            {w.label}
                          </Button>
                        ))}
                      </Stack>
                    </Box>

                    {/* Per-field label style override */}
                    {!isLayoutField && selectedField.type !== 'hidden' && (
                      <SelectField
                        label="Label Style"
                        value={selectedField.labelStyle || 'inherit'}
                        onChange={(e) => updateField(selectedIndex, { labelStyle: e.target.value })}
                        size="small"
                        options={LABEL_STYLES}
                      />
                    )}

                    {/* CSS class */}
                    <TextField
                      label="CSS Class"
                      value={selectedField.cssClass || ''}
                      onChange={(e) => updateField(selectedIndex, { cssClass: e.target.value })}
                      size="small"
                      fullWidth
                      placeholder="custom-class"
                    />

                    {/* Conditional logic */}
                    {!isLayoutField && selectedField.type !== 'hidden' && fields.length > 1 && (
                      <>
                        <Divider />
                        <ConditionalLogicPanel
                          field={selectedField}
                          fields={fields}
                          onUpdate={(updates) => updateField(selectedIndex, updates)}
                        />
                      </>
                    )}

                    <Divider />

                    {/* Move / Delete */}
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Tooltip title="Move Up">
                        <span>
                          <IconButton size="small" onClick={() => moveField(selectedIndex, -1)} disabled={selectedIndex === 0}>
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move Down">
                        <span>
                          <IconButton size="small" onClick={() => moveField(selectedIndex, 1)} disabled={selectedIndex === fields.length - 1}>
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Box sx={{ flex: 1 }} />
                      <Tooltip title="Remove Field">
                        <IconButton size="small" color="error" onClick={() => removeField(selectedIndex)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                )
              ) : (
                /* ─── Form Style Tab ─── */
                <Stack spacing={2.5}>
                  {/* Label Style */}
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Label Style</Typography>
                    <Stack direction="row" spacing={0.5}>
                      {['above', 'floating', 'hidden'].map((ls) => (
                        <Button
                          key={ls}
                          size="small"
                          variant={style.labelStyle === ls ? 'contained' : 'outlined'}
                          onClick={() => updateStyle({ labelStyle: ls })}
                          sx={{ flex: 1, textTransform: 'none', fontSize: 12 }}
                        >
                          {ls.charAt(0).toUpperCase() + ls.slice(1)}
                        </Button>
                      ))}
                    </Stack>
                  </Box>

                  {/* Color Scheme */}
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Color Scheme</Typography>
                    <Stack direction="row" spacing={0.5}>
                      {['light', 'dark'].map((cs) => (
                        <Button
                          key={cs}
                          size="small"
                          variant={style.colorScheme === cs ? 'contained' : 'outlined'}
                          onClick={() => updateStyle({ colorScheme: cs })}
                          sx={{ flex: 1, textTransform: 'none', fontSize: 12 }}
                        >
                          {cs.charAt(0).toUpperCase() + cs.slice(1)}
                        </Button>
                      ))}
                    </Stack>
                  </Box>

                  <Divider />
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>Colors</Typography>

                  <ColorField label="Primary Color" value={style.primaryColor} onChange={(v) => updateStyle({ primaryColor: v })} />
                  <ColorField label="Background" value={style.backgroundColor} onChange={(v) => updateStyle({ backgroundColor: v })} />
                  <ColorField label="Text Color" value={style.textColor} onChange={(v) => updateStyle({ textColor: v })} />
                  <ColorField label="Label Color" value={style.labelColor} onChange={(v) => updateStyle({ labelColor: v })} />
                  <ColorField label="Input Background" value={style.inputBgColor} onChange={(v) => updateStyle({ inputBgColor: v })} />
                  <ColorField label="Input Border" value={style.inputBorderColor} onChange={(v) => updateStyle({ inputBorderColor: v })} />
                  <ColorField label="Input Text" value={style.inputTextColor} onChange={(v) => updateStyle({ inputTextColor: v })} />
                  <ColorField label="Focus Border" value={style.focusBorderColor} onChange={(v) => updateStyle({ focusBorderColor: v })} />
                  <ColorField label="Button Background" value={style.buttonBgColor} onChange={(v) => updateStyle({ buttonBgColor: v })} />
                  <ColorField label="Button Text" value={style.buttonTextColor} onChange={(v) => updateStyle({ buttonTextColor: v })} />

                  <Divider />
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>Dimensions</Typography>

                  {/* Form Max Width */}
                  <TextField
                    label="Form Max Width (px)"
                    type="number"
                    value={style.formMaxWidth || 480}
                    onChange={(e) => updateStyle({ formMaxWidth: Math.max(200, Math.min(1200, Number(e.target.value) || 480)) })}
                    size="small"
                    fullWidth
                    inputProps={{ min: 200, max: 1200, step: 10 }}
                  />

                  {/* Border Radius */}
                  <TextField
                    label="Border Radius (px)"
                    type="number"
                    value={style.borderRadius ?? 4}
                    onChange={(e) => updateStyle({ borderRadius: Math.max(0, Math.min(24, Number(e.target.value) || 0)) })}
                    size="small"
                    fullWidth
                    inputProps={{ min: 0, max: 24, step: 1 }}
                  />

                  {/* Field Spacing */}
                  <TextField
                    label="Field Spacing (px)"
                    type="number"
                    value={style.fieldSpacing ?? 16}
                    onChange={(e) => updateStyle({ fieldSpacing: Math.max(4, Math.min(48, Number(e.target.value) || 16)) })}
                    size="small"
                    fullWidth
                    inputProps={{ min: 4, max: 48, step: 2 }}
                  />

                  <Divider />

                  {/* Submit Button Text */}
                  <TextField
                    label="Submit Button Text"
                    value={style.submitLabel || 'Submit'}
                    onChange={(e) => updateStyle({ submitLabel: e.target.value })}
                    size="small"
                    fullWidth
                  />

                  <Divider />
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>After Submission</Typography>

                  {/* Action type */}
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Action</Typography>
                    <Stack direction="row" spacing={0.5}>
                      {[
                        { value: 'message', label: 'Message' },
                        { value: 'redirect', label: 'Redirect' },
                        { value: 'popup', label: 'Popup' }
                      ].map((opt) => (
                        <Button
                          key={opt.value}
                          size="small"
                          variant={(style.afterSubmission?.action || 'message') === opt.value ? 'contained' : 'outlined'}
                          onClick={() => updateStyle({
                            afterSubmission: { ...(style.afterSubmission || {}), action: opt.value }
                          })}
                          sx={{ flex: 1, textTransform: 'none', fontSize: 11 }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </Stack>
                  </Box>

                  {/* Message */}
                  {(!style.afterSubmission?.action || style.afterSubmission?.action === 'message') && (
                    <TextField
                      label="Success Message"
                      value={style.afterSubmission?.message || 'Thank you for your submission!'}
                      onChange={(e) => updateStyle({
                        afterSubmission: { ...(style.afterSubmission || {}), action: 'message', message: e.target.value }
                      })}
                      size="small"
                      fullWidth
                      multiline
                      rows={2}
                      helperText="Supports {{field_name}} tokens"
                    />
                  )}

                  {/* Redirect */}
                  {style.afterSubmission?.action === 'redirect' && (
                    <>
                      <TextField
                        label="Redirect URL"
                        value={style.afterSubmission?.redirectUrl || ''}
                        onChange={(e) => updateStyle({
                          afterSubmission: { ...(style.afterSubmission || {}), redirectUrl: e.target.value }
                        })}
                        size="small"
                        fullWidth
                        placeholder="https://example.com/thanks?name={{caller_name}}"
                        helperText="Supports {{field_name}} tokens in URL"
                      />
                      <TextField
                        label="Redirect Delay (seconds)"
                        type="number"
                        value={style.afterSubmission?.redirectDelay ?? 0}
                        onChange={(e) => updateStyle({
                          afterSubmission: { ...(style.afterSubmission || {}), redirectDelay: Number(e.target.value) || 0 }
                        })}
                        size="small"
                        fullWidth
                        inputProps={{ min: 0, max: 30 }}
                      />
                    </>
                  )}

                  {/* Popup */}
                  {style.afterSubmission?.action === 'popup' && (
                    <>
                      <TextField
                        label="Popup Title"
                        value={style.afterSubmission?.popupTitle || ''}
                        onChange={(e) => updateStyle({
                          afterSubmission: { ...(style.afterSubmission || {}), popupTitle: e.target.value }
                        })}
                        size="small"
                        fullWidth
                        placeholder="Thank You!"
                      />
                      <TextField
                        label="Popup Content"
                        value={style.afterSubmission?.popupHtml || ''}
                        onChange={(e) => updateStyle({
                          afterSubmission: { ...(style.afterSubmission || {}), popupHtml: e.target.value }
                        })}
                        size="small"
                        fullWidth
                        multiline
                        rows={3}
                        placeholder="We'll be in touch soon!"
                        helperText="Supports {{field_name}} tokens"
                      />
                      <TextField
                        label="Auto-close (seconds, 0 = manual)"
                        type="number"
                        value={style.afterSubmission?.popupAutoClose ?? 5}
                        onChange={(e) => updateStyle({
                          afterSubmission: { ...(style.afterSubmission || {}), popupAutoClose: Number(e.target.value) || 0 }
                        })}
                        size="small"
                        fullWidth
                        inputProps={{ min: 0, max: 60 }}
                      />
                    </>
                  )}
                </Stack>
              )}
            </Box>
          </Paper>
        </Box>
      )}
    </Stack>
  );
}
