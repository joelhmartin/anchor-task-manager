/**
 * CTM Form Builder — Field Type Definitions
 *
 * Mirrors the WordPress plugin's FIELD_TYPES and field defaults exactly.
 * Core CTM fields: caller_name, email, phone_number, phone, country_code
 */

export const CORE_FIELDS = ['caller_name', 'email', 'phone_number', 'phone', 'country_code'];

export const FIELD_TYPES = {
  // Shortcut types (palette-only, map to real types)
  fullname:      { label: 'Full Name',      group: 'input' },
  email:         { label: 'Email',           group: 'input' },
  tel:           { label: 'Phone',           group: 'input' },
  message:       { label: 'Message',         group: 'input' },
  // Standard types
  text:          { label: 'Text',            group: 'input' },
  textarea:      { label: 'Textarea',        group: 'input' },
  number:        { label: 'Number',          group: 'input' },
  url:           { label: 'URL',             group: 'input' },
  select:        { label: 'Select',          group: 'input' },
  checkbox:      { label: 'Checkbox',        group: 'input' },
  radio:         { label: 'Radio',           group: 'input' },
  hidden:        { label: 'Hidden',          group: 'input' },
  consent:       { label: 'Consent',         group: 'input' },
  // Layout
  heading:       { label: 'Heading',         group: 'layout' },
  paragraph:     { label: 'Paragraph',       group: 'layout' },
  divider:       { label: 'Divider',         group: 'layout' },
  score_display: { label: 'Score Display',   group: 'layout' }
};

export const OPERATORS = [
  { value: 'equals',       label: 'equals' },
  { value: 'not_equals',   label: 'not equals' },
  { value: 'contains',     label: 'contains' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than',    label: 'less than' }
];

export function uid() {
  return 'f_' + Math.random().toString(36).substr(2, 8);
}

/**
 * Sanitize a display name into a machine-safe field name.
 * Matches the plugin's sanitizeFieldName() in builder.js exactly.
 */
export function sanitizeFieldName(name) {
  return name
    .replace(/[^a-zA-Z0-9_\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Get default field config for a given type.
 * Mirrors the plugin's getFieldDefaults() exactly.
 */
export function getFieldDefaults(type) {
  const f = {
    id: uid(),
    type,
    label: '',
    name: '',
    displayName: '',
    placeholder: '',
    helpText: '',
    defaultValue: '',
    required: false,
    isCustom: true,
    width: 'full',
    labelStyle: 'inherit',
    cssClass: '',
    step: 0,
    conditions: [],
    conditionLogic: 'all',
    logVisible: true,
    registerField: false
  };

  switch (type) {
    case 'fullname':
      f.label = 'Full Name';
      f.name = 'caller_name';
      f.displayName = 'Full Name';
      f.isCustom = false;
      f.required = true;
      break;
    case 'email':
      f.label = 'Email';
      f.name = 'email';
      f.displayName = 'Email';
      f.isCustom = false;
      break;
    case 'tel':
      f.label = 'Phone';
      f.name = 'phone_number';
      f.displayName = 'Phone';
      f.isCustom = false;
      f.required = true;
      break;
    case 'message':
      f.type = 'textarea';
      f.label = 'Message';
      f.name = 'message';
      f.displayName = 'Message';
      break;
    case 'text':
      f.label = 'Text Field';
      break;
    case 'textarea':
      f.label = 'Text Area';
      break;
    case 'number':
      f.label = 'Number';
      f.min = null;
      f.max = null;
      f.numStep = null;
      break;
    case 'url':
      f.label = 'URL';
      break;
    case 'select':
      f.label = 'Select';
      f.options = [
        { label: 'Option 1', value: 'opt1', score: 0 },
        { label: 'Option 2', value: 'opt2', score: 0 }
      ];
      break;
    case 'checkbox':
      f.label = 'Checkbox';
      f.options = [
        { label: 'Option 1', value: 'opt1', score: 0 },
        { label: 'Option 2', value: 'opt2', score: 0 }
      ];
      break;
    case 'radio':
      f.label = 'Radio';
      f.options = [
        { label: 'Option 1', value: 'opt1', score: 0 },
        { label: 'Option 2', value: 'opt2', score: 0 }
      ];
      break;
    case 'hidden':
      f.label = 'Hidden Field';
      break;
    case 'consent':
      f.label = 'Consent Field';
      f.consentText = 'I agree to the terms and conditions.';
      f.labelStyle = 'hidden';
      break;
    case 'heading':
      f.label = 'Section Heading';
      break;
    case 'paragraph':
      f.label = 'Paragraph text goes here.';
      break;
    case 'divider':
      f.label = '';
      break;
    case 'score_display':
      f.label = 'Your Score';
      f.name = 'custom_total_score';
      break;
    default:
      break;
  }

  // Auto-generate field name from type if not set
  if (!f.name && !['heading', 'paragraph', 'divider', 'score_display'].includes(type)) {
    f.name = 'custom_' + type + '_' + f.id.substr(2, 4);
  }

  // Set displayName from label
  if (!['heading', 'paragraph', 'divider'].includes(type) && !f.displayName) {
    f.displayName = f.label;
  }

  return f;
}
