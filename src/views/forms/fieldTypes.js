/**
 * Field type definitions for the enhanced form builder.
 *
 * Categories:
 *   input   — Standard input fields (text, email, phone, number, url, textarea, hidden)
 *   choice  — Selection fields (select, radio, checkbox, consent)
 *   layout  — Visual-only elements (heading, paragraph, divider)
 *   special — Computed/display fields (score_display)
 */

// ---------------------------------------------------------------------------
// Field type registry
// ---------------------------------------------------------------------------

export const FIELD_CATEGORIES = [
  { key: 'input', label: 'Input Fields' },
  { key: 'choice', label: 'Choice Fields' },
  { key: 'layout', label: 'Layout' },
  { key: 'special', label: 'Special' }
];

export const FIELD_TYPES = [
  // Input
  { type: 'text', label: 'Text Input', icon: 'Abc', category: 'input' },
  { type: 'email', label: 'Email', icon: 'Email', category: 'input' },
  { type: 'phone', label: 'Phone', icon: 'Phone', category: 'input' },
  { type: 'number', label: 'Number', icon: 'Numbers', category: 'input' },
  { type: 'url', label: 'URL', icon: 'Link', category: 'input' },
  { type: 'textarea', label: 'Text Area', icon: 'Notes', category: 'input' },
  { type: 'hidden', label: 'Hidden', icon: 'VisibilityOff', category: 'input' },
  // Choice
  { type: 'select', label: 'Dropdown', icon: 'ArrowDropDownCircle', category: 'choice' },
  { type: 'radio', label: 'Radio Buttons', icon: 'RadioButtonChecked', category: 'choice' },
  { type: 'checkbox', label: 'Checkbox', icon: 'CheckBox', category: 'choice' },
  { type: 'consent', label: 'Consent', icon: 'Verified', category: 'choice' },
  // Layout
  { type: 'heading', label: 'Heading', icon: 'Title', category: 'layout' },
  { type: 'paragraph', label: 'Paragraph', icon: 'Notes', category: 'layout' },
  { type: 'divider', label: 'Divider', icon: 'HorizontalRule', category: 'layout' },
  // Special
  { type: 'score_display', label: 'Score Display', icon: 'Score', category: 'special' }
];

/**
 * Field types that accept options (label + value + optional score).
 */
export const OPTION_FIELD_TYPES = ['select', 'radio', 'checkbox'];

/**
 * Field types that are layout-only (no value submitted).
 */
export const LAYOUT_FIELD_TYPES = ['heading', 'paragraph', 'divider', 'score_display'];

/**
 * Field types that are "core" CTM fields (not prefixed with custom_).
 */
export const CTM_CORE_FIELDS = {
  caller_name: 'caller_name',
  name: 'caller_name',
  full_name: 'caller_name',
  fullname: 'caller_name',
  email: 'email',
  phone: 'phone_number',
  phone_number: 'phone_number'
};

/**
 * Width options for fields.
 */
export const WIDTH_OPTIONS = [
  { value: 'full', label: 'Full', flex: 1 },
  { value: 'half', label: '1/2', flex: 0.5 },
  { value: 'third', label: '1/3', flex: 0.333 },
  { value: 'quarter', label: '1/4', flex: 0.25 }
];

/**
 * Label style options.
 */
export const LABEL_STYLES = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'above', label: 'Above' },
  { value: 'floating', label: 'Floating' },
  { value: 'hidden', label: 'Hidden' }
];

// ---------------------------------------------------------------------------
// Style defaults
// ---------------------------------------------------------------------------

export const STYLE_DEFAULTS = {
  labelStyle: 'above',
  colorScheme: 'light',
  primaryColor: '#007bff',
  backgroundColor: '#ffffff',
  textColor: '#333333',
  labelColor: '#555555',
  inputBgColor: '#ffffff',
  inputBorderColor: '#d0d0d0',
  inputTextColor: '#333333',
  focusBorderColor: '#007bff',
  buttonBgColor: '#007bff',
  buttonTextColor: '#ffffff',
  errorColor: '#dc3545',
  successColor: '#28a745',
  formMaxWidth: 480,
  borderRadius: 4,
  fieldSpacing: 16,
  submitLabel: 'Submit'
};

// ---------------------------------------------------------------------------
// Default field factory
// ---------------------------------------------------------------------------

let _counter = 0;

function uid() {
  _counter += 1;
  return `f_${Date.now().toString(36)}${_counter.toString(36)}`;
}

/**
 * Create a new field with sensible defaults for the given type.
 */
export function makeDefaultField(type) {
  const id = uid();
  const base = {
    id,
    type,
    label: '',
    name: '',
    required: false,
    placeholder: '',
    helpText: '',
    defaultValue: '',
    width: 'full',
    labelStyle: 'inherit',
    cssClass: '',
    conditions: [],
    conditionLogic: 'all'
  };

  switch (type) {
    // --- Input ---
    case 'text':
      return { ...base, label: 'Text Field', name: 'text_field' };
    case 'email':
      return { ...base, label: 'Email', name: 'email', required: true, placeholder: 'you@example.com' };
    case 'phone':
      return { ...base, label: 'Phone', name: 'phone', placeholder: '(555) 123-4567' };
    case 'number':
      return { ...base, label: 'Number', name: 'number_field', placeholder: '0', min: null, max: null, step: null };
    case 'url':
      return { ...base, label: 'Website', name: 'website', placeholder: 'https://example.com' };
    case 'textarea':
      return { ...base, label: 'Message', name: 'message', placeholder: 'Type your message...' };
    case 'hidden':
      return { ...base, label: 'Hidden Field', name: 'hidden_field', defaultValue: '' };

    // --- Choice ---
    case 'select':
      return {
        ...base,
        label: 'Select',
        name: 'select_field',
        placeholder: 'Select...',
        options: [
          { label: 'Option 1', value: 'option_1', score: 0 },
          { label: 'Option 2', value: 'option_2', score: 0 }
        ]
      };
    case 'radio':
      return {
        ...base,
        label: 'Choose One',
        name: 'radio_field',
        options: [
          { label: 'Option 1', value: 'option_1', score: 0 },
          { label: 'Option 2', value: 'option_2', score: 0 }
        ]
      };
    case 'checkbox':
      return {
        ...base,
        label: 'Select All That Apply',
        name: 'checkbox_field',
        options: [
          { label: 'Option 1', value: 'option_1', score: 0 },
          { label: 'Option 2', value: 'option_2', score: 0 }
        ]
      };
    case 'consent':
      return {
        ...base,
        label: 'Consent',
        name: 'consent',
        consentText: 'I agree to receive communications',
        required: true
      };

    // --- Layout ---
    case 'heading':
      return { ...base, label: 'Section Heading', name: `heading_${id}`, content: 'Section Heading' };
    case 'paragraph':
      return { ...base, label: 'Paragraph', name: `para_${id}`, content: 'Enter your descriptive text here.' };
    case 'divider':
      return { ...base, label: 'Divider', name: `divider_${id}` };

    // --- Special ---
    case 'score_display':
      return { ...base, label: 'Your Score', name: 'total_score', scoreFieldName: 'custom_total_score' };

    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a field type submits a value (vs layout-only).
 */
export function isSubmittableField(type) {
  return !LAYOUT_FIELD_TYPES.includes(type);
}

/**
 * Check if a field type has options (select, radio, checkbox).
 */
export function hasOptions(type) {
  return OPTION_FIELD_TYPES.includes(type);
}

/**
 * Get unique name for a new field, avoiding collisions.
 */
export function uniqueFieldName(baseName, existingNames) {
  if (!existingNames.includes(baseName)) return baseName;
  let i = 2;
  while (existingNames.includes(`${baseName}_${i}`)) i++;
  return `${baseName}_${i}`;
}

/**
 * Sanitize a field name to snake_case (CTM-compatible).
 */
export function sanitizeFieldName(name) {
  return name.replace(/[^a-z0-9_]/gi, '_').toLowerCase().replace(/^_+|_+$/g, '').replace(/_+/g, '_');
}

/**
 * Determine if a field name maps to a CTM core field.
 */
export function getCTMCoreName(fieldName) {
  return CTM_CORE_FIELDS[fieldName] || null;
}

/**
 * Group fields into rows based on width.
 * Consecutive fields with compatible widths are grouped into a single row.
 * Returns array of rows, each row is array of field objects with _idx attached.
 */
export function groupFieldsIntoRows(fields) {
  const rows = [];
  let i = 0;
  const widthFraction = { full: 1, half: 0.5, third: 1 / 3, quarter: 0.25 };

  while (i < fields.length) {
    const field = fields[i];
    const fw = widthFraction[field.width] || 1;

    if (fw >= 1) {
      // Full-width field gets its own row
      rows.push([{ ...field, _idx: i }]);
      i++;
    } else {
      // Collect fields that fit in one row (sum <= 1)
      const row = [{ ...field, _idx: i }];
      let total = fw;
      i++;
      while (i < fields.length) {
        const nextW = widthFraction[fields[i].width] || 1;
        if (nextW >= 1 || total + nextW > 1.01) break; // 1.01 for float tolerance
        row.push({ ...fields[i], _idx: i });
        total += nextW;
        i++;
      }
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Convert hex color to RGB string for CSS variables.
 */
export function hexToRgb(hex) {
  hex = (hex || '#007bff').replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  return `${r}, ${g}, ${b}`;
}
