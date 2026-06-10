/**
 * FormPreview — Live preview that mirrors the embed script's output.
 *
 * Renders all 16+ field types with the same class names / DOM structure
 * as anchor-forms.js so WYSIWYG is accurate.  Inputs are inert
 * (pointer-events: none); field wrappers are clickable for selection
 * in the builder.
 */

import { useState } from 'react';
import EmptyState from 'ui-component/extended/EmptyState';
import { groupFieldsIntoRows, hexToRgb } from './fieldTypes';

// ---------------------------------------------------------------------------
// Preview CSS — injected once into <head>
// ---------------------------------------------------------------------------

export const PREVIEW_CSS = `
/* === Anchor Form Preview — matches embed output === */
.anchor-form {
  --anchor-primary: #007bff;
  --anchor-primary-rgb: 0, 123, 255;
  --anchor-radius: 4px;
  --anchor-max-width: 480px;
  --anchor-bg: #ffffff;
  --anchor-text: #333333;
  --anchor-label: #555555;
  --anchor-input-bg: #ffffff;
  --anchor-input-border: #d0d0d0;
  --anchor-input-text: #333333;
  --anchor-focus-border: #007bff;
  --anchor-btn-bg: #007bff;
  --anchor-btn-text: #ffffff;
  --anchor-error: #dc3545;
  --anchor-success: #28a745;
  --anchor-spacing: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  max-width: var(--anchor-max-width);
  margin: 0 auto;
  padding: 24px;
  box-sizing: border-box;
  background: var(--anchor-bg);
  color: var(--anchor-text);
}
.anchor-form *, .anchor-form *::before, .anchor-form *::after { box-sizing: border-box; }
.anchor-form-title { margin: 0 0 20px; font-size: 1.5em; font-weight: 600; }

/* Row layout */
.anchor-form-row { display: flex; gap: 12px; margin-bottom: var(--anchor-spacing); }
.anchor-form-row .anchor-form-field { flex: 1; min-width: 0; margin-bottom: 0; }

/* Field base */
.anchor-form-field { margin-bottom: var(--anchor-spacing); }
.anchor-form-field > label:not(.anchor-form-checkbox-label):not(.anchor-form-radio-label):not(.anchor-form-consent-label) {
  display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px; color: var(--anchor-label);
}
.anchor-required { color: var(--anchor-error); }
.anchor-form-help { display: block; margin-top: 4px; font-size: 12px; color: #888; }

/* Inputs */
.anchor-form-field input[type="text"],
.anchor-form-field input[type="email"],
.anchor-form-field input[type="tel"],
.anchor-form-field input[type="number"],
.anchor-form-field input[type="url"],
.anchor-form-field select,
.anchor-form-field textarea {
  width: 100%; padding: 10px 12px; border: 1px solid var(--anchor-input-border);
  border-radius: var(--anchor-radius); font-size: 16px; font-family: inherit;
  background: var(--anchor-input-bg); color: var(--anchor-input-text); outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.anchor-form-field textarea { resize: vertical; min-height: 80px; }
.anchor-form-field input:focus, .anchor-form-field select:focus, .anchor-form-field textarea:focus {
  border-color: var(--anchor-focus-border);
  box-shadow: 0 0 0 3px rgba(var(--anchor-primary-rgb), 0.15);
}

/* Custom select arrow */
.anchor-form-field select {
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8.825a.5.5 0 01-.354-.146l-4.47-4.47a.5.5 0 01.707-.708L6 7.618l4.117-4.117a.5.5 0 01.707.707l-4.47 4.47A.5.5 0 016 8.826z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; cursor: pointer;
}

/* Checkbox (multi-select) */
.anchor-form-field--checkbox { position: relative; }
.anchor-form-checkbox-group { display: flex; flex-direction: column; gap: 8px; }
.anchor-form-checkbox-native { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.anchor-form-checkbox-label {
  display: inline-flex; align-items: center; cursor: pointer; user-select: none;
  font-weight: 400; font-size: 14px; line-height: 1.5;
}
.anchor-form-checkbox-box {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; min-width: 20px; border: 2px solid var(--anchor-input-border);
  border-radius: var(--anchor-radius); margin-right: 10px;
  transition: all 0.15s ease; background: var(--anchor-input-bg); flex-shrink: 0;
}

/* Radio buttons */
.anchor-form-field--radio { position: relative; }
.anchor-form-radio-group { display: flex; flex-direction: column; gap: 8px; }
.anchor-form-radio-native { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.anchor-form-radio-label {
  display: inline-flex; align-items: center; cursor: pointer; user-select: none;
  font-weight: 400; font-size: 14px; line-height: 1.5;
}
.anchor-form-radio-circle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; min-width: 20px; border: 2px solid var(--anchor-input-border);
  border-radius: 50%; margin-right: 10px;
  transition: all 0.15s ease; background: var(--anchor-input-bg); flex-shrink: 0;
}

/* Consent */
.anchor-form-field--consent { position: relative; }
.anchor-form-consent-label {
  display: inline-flex; align-items: flex-start; cursor: pointer; user-select: none;
  font-weight: 400; font-size: 14px; line-height: 1.5;
}

/* Layout: heading, paragraph, divider */
.anchor-form-heading { margin: 8px 0 4px; font-size: 1.25em; font-weight: 600; color: var(--anchor-text); }
.anchor-form-paragraph { margin: 0 0 4px; font-size: 14px; color: #666; line-height: 1.6; }
.anchor-form-divider { border: none; border-top: 1px solid var(--anchor-input-border); margin: 8px 0; }

/* Score display */
.anchor-form-score {
  text-align: center; padding: 16px; background: rgba(var(--anchor-primary-rgb), 0.08);
  border-radius: var(--anchor-radius); font-size: 1.5em; font-weight: 700;
  color: var(--anchor-primary);
}
.anchor-form-score-label { font-size: 0.5em; font-weight: 500; display: block; margin-bottom: 4px; color: var(--anchor-label); }

/* Hidden field indicator (builder only) */
.anchor-form-hidden-indicator {
  padding: 8px 12px; background: #f0f0f0; border: 1px dashed #ccc;
  border-radius: var(--anchor-radius); font-size: 12px; color: #888;
  text-align: center;
}

/* Floating labels */
.anchor-form--floating .anchor-form-field:not(.anchor-form-field--checkbox):not(.anchor-form-field--radio):not(.anchor-form-field--consent):not(.anchor-form-field--layout) { position: relative; }
.anchor-form--floating .anchor-form-field:not(.anchor-form-field--checkbox):not(.anchor-form-field--radio):not(.anchor-form-field--consent):not(.anchor-form-field--layout) > label:not(.anchor-form-checkbox-label):not(.anchor-form-radio-label):not(.anchor-form-consent-label) {
  position: absolute; left: 13px; top: 12px; font-size: 16px; font-weight: 400;
  color: #888; transition: all 0.2s ease; pointer-events: none; z-index: 1;
  margin: 0; padding: 0; line-height: 1; background: transparent;
}
.anchor-form--floating .anchor-form-field input:focus ~ label,
.anchor-form--floating .anchor-form-field input:not(:placeholder-shown) ~ label,
.anchor-form--floating .anchor-form-field textarea:focus ~ label,
.anchor-form--floating .anchor-form-field textarea:not(:placeholder-shown) ~ label {
  top: -8px; left: 9px; font-size: 12px; font-weight: 500;
  color: var(--anchor-primary); background: var(--anchor-input-bg); padding: 0 4px;
}
.anchor-form--floating .anchor-form-field select:focus ~ label,
.anchor-form--floating .anchor-form-field select:not([data-empty="true"]) ~ label {
  top: -8px; left: 9px; font-size: 12px; font-weight: 500;
  color: var(--anchor-primary); background: var(--anchor-input-bg); padding: 0 4px;
}

/* Hidden label style */
.anchor-form--hidden-labels .anchor-form-field > label:not(.anchor-form-checkbox-label):not(.anchor-form-radio-label):not(.anchor-form-consent-label) {
  display: none;
}

/* Dark color scheme */
.anchor-form--dark {
  --anchor-bg: #1a1a2e;
  --anchor-text: #e0e0e0;
  --anchor-label: #b0b0b0;
  --anchor-input-bg: #16213e;
  --anchor-input-border: #444;
  --anchor-input-text: #e0e0e0;
  --anchor-btn-text: #ffffff;
}

/* Submit button */
.anchor-form-submit {
  width: 100%; padding: 12px 24px; background: var(--anchor-btn-bg); color: var(--anchor-btn-text);
  border: none; border-radius: var(--anchor-radius); font-size: 16px; font-weight: 600;
  font-family: inherit; cursor: pointer; margin-top: 8px; transition: filter 0.2s ease;
}
.anchor-form-submit:hover { filter: brightness(0.9); }

/* Multi-step */
.anchor-form-progress { display: flex; gap: 4px; margin-bottom: 24px; }
.anchor-form-progress-step {
  flex: 1; height: 4px; border-radius: 2px; background: var(--anchor-input-border);
  transition: background 0.3s;
}
.anchor-form-progress-step--active { background: var(--anchor-primary); }
.anchor-form-progress-step--done { background: var(--anchor-primary); opacity: 0.5; }
.anchor-form-step-header { margin-bottom: 16px; }
.anchor-form-step-title { font-size: 1.1em; font-weight: 600; margin: 0 0 4px; color: var(--anchor-text); }
.anchor-form-step-desc { font-size: 14px; color: #666; margin: 0; }
.anchor-form-step-counter { font-size: 12px; color: #888; margin-bottom: 8px; }
.anchor-form-step-nav { display: flex; gap: 8px; margin-top: 16px; }
.anchor-form-step-back {
  padding: 10px 20px; border: 1px solid var(--anchor-input-border); border-radius: var(--anchor-radius);
  background: transparent; color: var(--anchor-text); font-size: 14px; cursor: pointer; font-family: inherit;
}
.anchor-form-step-next {
  flex: 1; padding: 10px 20px; background: var(--anchor-primary); color: var(--anchor-btn-text);
  border: none; border-radius: var(--anchor-radius); font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.anchor-form-title-page { text-align: center; padding: 40px 20px; }
.anchor-form-title-page h2 { margin: 0 0 8px; font-size: 1.5em; color: var(--anchor-text); }
.anchor-form-title-page p { margin: 0 0 24px; color: #666; font-size: 14px; }
.anchor-form-title-page .anchor-form-submit { width: auto; padding: 12px 32px; }

/* Conditional logic badge (builder only) */
.anchor-form-condition-badge {
  position: absolute; top: -6px; right: -6px; background: #ff9800; color: #fff;
  font-size: 9px; padding: 1px 5px; border-radius: 8px; font-weight: 600; z-index: 2;
}

/* === Builder-specific === */
.anchor-form-builder-wrap {
  background: #f8f9fa;
  background-image: radial-gradient(#e0e0e0 1px, transparent 1px);
  background-size: 20px 20px;
  min-height: 400px;
  padding: 24px;
  border-radius: 4px;
}
.anchor-form-builder-wrap .anchor-form-field {
  cursor: pointer; position: relative; transition: outline 0.15s;
  border-radius: 4px;
}
.anchor-form-builder-wrap .anchor-form-field:hover {
  outline: 2px dashed rgba(var(--anchor-primary-rgb), 0.4);
  outline-offset: 4px;
}
.anchor-form-builder-wrap .anchor-form-field--selected {
  outline: 2px solid var(--anchor-primary) !important;
  outline-offset: 4px;
}
.anchor-form-builder-wrap input,
.anchor-form-builder-wrap select,
.anchor-form-builder-wrap textarea,
.anchor-form-builder-wrap button.anchor-form-submit {
  pointer-events: none;
}
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FormPreview({ fields, submitLabel, style, selectedIndex, onSelectField }) {
  const isFloating = style.labelStyle === 'floating';
  const isHiddenLabels = style.labelStyle === 'hidden';
  const isDark = style.colorScheme === 'dark';
  const primaryColor = style.primaryColor || '#007bff';

  const cssVars = {
    '--anchor-primary': primaryColor,
    '--anchor-primary-rgb': hexToRgb(primaryColor),
    '--anchor-radius': `${style.borderRadius ?? 4}px`,
    '--anchor-max-width': `${style.formMaxWidth || 480}px`,
    '--anchor-bg': style.backgroundColor || (isDark ? '#1a1a2e' : '#ffffff'),
    '--anchor-text': style.textColor || (isDark ? '#e0e0e0' : '#333333'),
    '--anchor-label': style.labelColor || (isDark ? '#b0b0b0' : '#555555'),
    '--anchor-input-bg': style.inputBgColor || (isDark ? '#16213e' : '#ffffff'),
    '--anchor-input-border': style.inputBorderColor || (isDark ? '#444' : '#d0d0d0'),
    '--anchor-input-text': style.inputTextColor || (isDark ? '#e0e0e0' : '#333333'),
    '--anchor-focus-border': style.focusBorderColor || primaryColor,
    '--anchor-btn-bg': style.buttonBgColor || primaryColor,
    '--anchor-btn-text': style.buttonTextColor || '#ffffff',
    '--anchor-error': style.errorColor || '#dc3545',
    '--anchor-success': style.successColor || '#28a745',
    '--anchor-spacing': `${style.fieldSpacing || 16}px`
  };

  const formClass = [
    'anchor-form',
    isDark ? 'anchor-form--dark' : 'anchor-form--light',
    isFloating && 'anchor-form--floating',
    isHiddenLabels && 'anchor-form--hidden-labels'
  ].filter(Boolean).join(' ');

  const renderFieldPreview = (field) => {
    const idx = field._idx;
    const isSelected = idx === selectedIndex;
    const hasConditions = field.conditions && field.conditions.length > 0;

    const handleClick = (e) => {
      e.stopPropagation();
      onSelectField(idx);
    };

    // Condition badge (builder-only)
    const conditionBadge = hasConditions ? (
      <span className="anchor-form-condition-badge">IF</span>
    ) : null;

    // --- Layout fields ---
    if (field.type === 'heading') {
      return (
        <div
          key={idx}
          className={`anchor-form-field anchor-form-field--layout${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <h3 className="anchor-form-heading">{field.content || field.label || 'Heading'}</h3>
        </div>
      );
    }

    if (field.type === 'paragraph') {
      return (
        <div
          key={idx}
          className={`anchor-form-field anchor-form-field--layout${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <p className="anchor-form-paragraph">{field.content || field.label || 'Paragraph text'}</p>
        </div>
      );
    }

    if (field.type === 'divider') {
      return (
        <div
          key={idx}
          className={`anchor-form-field anchor-form-field--layout${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <hr className="anchor-form-divider" />
        </div>
      );
    }

    if (field.type === 'score_display') {
      return (
        <div
          key={idx}
          className={`anchor-form-field anchor-form-field--layout${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <div className="anchor-form-score">
            <span className="anchor-form-score-label">{field.label || 'Your Score'}</span>
            0
          </div>
        </div>
      );
    }

    if (field.type === 'hidden') {
      return (
        <div
          key={idx}
          className={`anchor-form-field${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <div className="anchor-form-hidden-indicator">
            Hidden: {field.name || 'hidden_field'} {field.defaultValue ? `= "${field.defaultValue}"` : ''}
          </div>
        </div>
      );
    }

    // --- Shared label content ---
    const labelContent = (
      <>{field.label}{field.required && <> <span className="anchor-required">*</span></>}</>
    );

    // --- Radio ---
    if (field.type === 'radio') {
      const options = field.options || [];
      return (
        <div
          key={idx}
          className={`anchor-form-field anchor-form-field--radio${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <label>{labelContent}</label>
          <div className="anchor-form-radio-group">
            {options.map((opt, oi) => (
              <label key={oi} className="anchor-form-radio-label">
                <input type="radio" className="anchor-form-radio-native" readOnly tabIndex={-1} />
                <span className="anchor-form-radio-circle" />
                {typeof opt === 'string' ? opt : opt.label}
              </label>
            ))}
          </div>
          {field.helpText && <span className="anchor-form-help">{field.helpText}</span>}
        </div>
      );
    }

    // --- Checkbox (multi-select) ---
    if (field.type === 'checkbox') {
      const options = field.options || [];
      return (
        <div
          key={idx}
          className={`anchor-form-field anchor-form-field--checkbox${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <label>{labelContent}</label>
          <div className="anchor-form-checkbox-group">
            {options.map((opt, oi) => (
              <label key={oi} className="anchor-form-checkbox-label">
                <input type="checkbox" className="anchor-form-checkbox-native" readOnly tabIndex={-1} />
                <span className="anchor-form-checkbox-box" />
                {typeof opt === 'string' ? opt : opt.label}
              </label>
            ))}
          </div>
          {field.helpText && <span className="anchor-form-help">{field.helpText}</span>}
        </div>
      );
    }

    // --- Consent ---
    if (field.type === 'consent') {
      return (
        <div
          key={idx}
          className={`anchor-form-field anchor-form-field--consent${isSelected ? ' anchor-form-field--selected' : ''}`}
          onClick={handleClick}
        >
          <label className="anchor-form-consent-label">
            <input type="checkbox" className="anchor-form-checkbox-native" readOnly tabIndex={-1} />
            <span className="anchor-form-checkbox-box" />
            <span>{field.consentText || field.label || 'I agree'}{field.required && <> <span className="anchor-required">*</span></>}</span>
          </label>
          {field.helpText && <span className="anchor-form-help">{field.helpText}</span>}
        </div>
      );
    }

    // --- Standard input fields (text, email, phone, number, url, textarea, select) ---
    const inputTypeMap = { phone: 'tel', url: 'url', number: 'number', email: 'email', text: 'text' };

    const inputElement = field.type === 'textarea' ? (
      <textarea rows={4} placeholder={isFloating ? ' ' : field.placeholder} readOnly tabIndex={-1} />
    ) : field.type === 'select' ? (
      <select readOnly tabIndex={-1} data-empty="true">
        <option>{field.placeholder || 'Select...'}</option>
        {(field.options || []).map((opt, i) => (
          <option key={i}>{typeof opt === 'string' ? opt : opt.label}</option>
        ))}
      </select>
    ) : (
      <input
        type={inputTypeMap[field.type] || 'text'}
        placeholder={isFloating ? ' ' : field.placeholder}
        readOnly
        tabIndex={-1}
        {...(field.type === 'number' ? { min: field.min, max: field.max, step: field.step } : {})}
      />
    );

    const wrapperClass = [
      'anchor-form-field',
      isSelected && 'anchor-form-field--selected'
    ].filter(Boolean).join(' ');

    return (
      <div key={idx} className={wrapperClass} onClick={handleClick} style={{ position: 'relative' }}>
        {conditionBadge}
        {isFloating && field.type !== 'select' ? (
          <>
            {inputElement}
            <label>{labelContent}</label>
          </>
        ) : (
          <>
            <label>{labelContent}</label>
            {inputElement}
          </>
        )}
        {field.helpText && <span className="anchor-form-help">{field.helpText}</span>}
      </div>
    );
  };

  // Compute flex style for fields in rows
  const widthToFlex = { full: '1 1 100%', half: '1 1 calc(50% - 6px)', third: '1 1 calc(33.33% - 8px)', quarter: '1 1 calc(25% - 9px)' };

  // Multi-step state
  const isMultiStep = style.multiStep && style.steps?.length > 1;
  const steps = style.steps || [];
  const stepConfig = style.stepConfig || {};
  const [previewStep, setPreviewStep] = useState(0);
  const [showTitlePage, setShowTitlePage] = useState(!!stepConfig.titlePage);

  // Get fields for current step (or all fields if not multi-step)
  const fieldIdSet = isMultiStep && steps[previewStep]
    ? new Set(steps[previewStep].fieldIds)
    : null;
  const visibleFields = fieldIdSet
    ? fields.filter((f) => fieldIdSet.has(f.id || f.name))
    : fields;

  const renderRows = (fieldsToRender) => {
    const rows = groupFieldsIntoRows(fieldsToRender);
    return rows.map((row, ri) =>
      row.length > 1 ? (
        <div key={ri} className="anchor-form-row">
          {row.map((f) => (
            <div key={f._idx} style={{ flex: widthToFlex[f.width] || '1 1 100%' }}>
              {renderFieldPreview(f)}
            </div>
          ))}
        </div>
      ) : (
        renderFieldPreview(row[0])
      )
    );
  };

  return (
    <div className={formClass} style={cssVars}>
      {fields.length === 0 ? (
        <EmptyState title="No fields yet" message="Add fields from the palette on the left." />
      ) : isMultiStep && showTitlePage && stepConfig.titlePage ? (
        /* Title page */
        <div className="anchor-form-title-page">
          <h2>{stepConfig.titlePage.heading || 'Welcome'}</h2>
          {stepConfig.titlePage.subheading && <p>{stepConfig.titlePage.subheading}</p>}
          <button
            type="button"
            className="anchor-form-submit"
            tabIndex={-1}
            onClick={() => setShowTitlePage(false)}
            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          >
            {stepConfig.titlePage.startButton || 'Get Started'}
          </button>
        </div>
      ) : (
        <>
          {/* Progress bar */}
          {isMultiStep && stepConfig.showProgressBar !== false && (
            <div className="anchor-form-progress">
              {steps.map((_, si) => (
                <div
                  key={si}
                  className={[
                    'anchor-form-progress-step',
                    si === previewStep && 'anchor-form-progress-step--active',
                    si < previewStep && 'anchor-form-progress-step--done'
                  ].filter(Boolean).join(' ')}
                  onClick={() => setPreviewStep(si)}
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </div>
          )}

          {/* Step header */}
          {isMultiStep && steps[previewStep] && (
            <div className="anchor-form-step-header">
              <div className="anchor-form-step-counter">
                Step {previewStep + 1} of {steps.length}
              </div>
              {stepConfig.showStepTitles !== false && (
                <h3 className="anchor-form-step-title">{steps[previewStep].title}</h3>
              )}
              {steps[previewStep].description && (
                <p className="anchor-form-step-desc">{steps[previewStep].description}</p>
              )}
            </div>
          )}

          {/* Fields */}
          {renderRows(visibleFields)}

          {/* Step navigation / Submit */}
          {isMultiStep ? (
            <div className="anchor-form-step-nav">
              {previewStep > 0 && (
                <button
                  type="button"
                  className="anchor-form-step-back"
                  tabIndex={-1}
                  onClick={() => setPreviewStep(previewStep - 1)}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                >
                  Back
                </button>
              )}
              {previewStep < steps.length - 1 ? (
                <button
                  type="button"
                  className="anchor-form-step-next"
                  tabIndex={-1}
                  onClick={() => setPreviewStep(previewStep + 1)}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                >
                  Continue
                </button>
              ) : (
                <button type="button" className="anchor-form-step-next" tabIndex={-1}>
                  {style.submitLabel || submitLabel || 'Submit'}
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="anchor-form-submit" tabIndex={-1}>
              {style.submitLabel || submitLabel || 'Submit'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
