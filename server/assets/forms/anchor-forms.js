/**
 * Anchor Forms Embed Script — Enhanced
 *
 * Renders embedded forms with support for:
 * - 16+ field types (text, email, phone, number, url, textarea, hidden,
 *   select, radio, checkbox, consent, heading, paragraph, divider, score_display)
 * - Multi-step forms with progress bar and step navigation
 * - Conditional logic (show/hide fields based on other field values)
 * - Scoring system (point-based with score display)
 * - After-submission actions (message, redirect with tokens, popup)
 * - Enhanced styling (12+ color settings, dark mode, 4 column widths)
 * - Attribution tracking integration
 *
 * Installation:
 * <div id="anchor-form" data-form-token="FORM_TOKEN"></div>
 * <script src="[APP_BASE_URL]/forms/anchor-forms.js" async></script>
 */

(function() {
  'use strict';

  var script = document.currentScript;
  var apiBase = script && script.dataset.apiBase;

  if (!apiBase) {
    var src = script && script.src;
    if (src) {
      try { apiBase = new URL(src).origin + '/api'; }
      catch (e) { apiBase = '/api'; }
    } else { apiBase = '/api'; }
  }

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  function fetchForm(token) {
    return fetch(apiBase + '/forms/embed/' + token, { headers: { 'ngrok-skip-browser-warning': '1' } })
      .then(function(r) { if (!r.ok) throw new Error('Form not found'); return r.json(); });
  }

  function submitForm(token, data) {
    return fetch(apiBase + '/forms/embed/' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify(data)
    }).then(function(r) {
      return r.json().then(function(d) { if (!r.ok) throw new Error(d.error || 'Submission failed'); return d; });
    });
  }

  function getAttribution() {
    if (window.AnchorTracking && typeof window.AnchorTracking.getFormData === 'function')
      return window.AnchorTracking.getFormData();
    return { attribution: {}, sessionId: null };
  }

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  function hexToRgb(hex) {
    hex = (hex || '#007bff').replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return parseInt(hex.substring(0,2),16) + ', ' + parseInt(hex.substring(2,4),16) + ', ' + parseInt(hex.substring(4,6),16);
  }

  function escapeHtml(str) {
    var d = document.createElement('div'); d.textContent = str; return d.innerHTML;
  }

  function buildLabelHTML(field) {
    var html = escapeHtml(field.label || '');
    if (field.required) html += ' <span class="anchor-required">*</span>';
    return html;
  }

  /** Replace {{field_name}} tokens in a string with field values */
  function replaceTokens(str, values) {
    if (!str) return str;
    return str.replace(/\{\{(\w+)\}\}/g, function(m, key) {
      var val = values[key];
      return val !== undefined && val !== null ? val : m;
    });
  }

  // ---------------------------------------------------------------------------
  // Row grouping (supports full/half/third/quarter widths)
  // ---------------------------------------------------------------------------

  var widthFraction = { full: 1, half: 0.5, third: 1/3, quarter: 0.25 };
  var widthFlex = { full: '1 1 100%', half: '1 1 calc(50% - 6px)', third: '1 1 calc(33.33% - 8px)', quarter: '1 1 calc(25% - 9px)' };

  function groupFieldsIntoRows(fields) {
    var rows = [], i = 0;
    while (i < fields.length) {
      var fw = widthFraction[fields[i].width] || 1;
      if (fw >= 1) { rows.push([fields[i]]); i++; }
      else {
        var row = [fields[i]], total = fw; i++;
        while (i < fields.length) {
          var nw = widthFraction[fields[i].width] || 1;
          if (nw >= 1 || total + nw > 1.01) break;
          row.push(fields[i]); total += nw; i++;
        }
        rows.push(row);
      }
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Field rendering
  // ---------------------------------------------------------------------------

  function renderField(field, style) {
    var isFloating = style.labelStyle === 'floating';
    var isHidden = style.labelStyle === 'hidden';
    var wrapper = document.createElement('div');
    wrapper.className = 'anchor-form-field';
    wrapper.setAttribute('data-field-id', field.id || field.name);
    wrapper.setAttribute('data-field-name', field.name || '');

    // Layout-only fields
    if (field.type === 'heading') {
      wrapper.className += ' anchor-form-field--layout';
      var h = document.createElement('h3');
      h.className = 'anchor-form-heading';
      h.textContent = field.content || field.label || '';
      wrapper.appendChild(h);
      return wrapper;
    }
    if (field.type === 'paragraph') {
      wrapper.className += ' anchor-form-field--layout';
      var p = document.createElement('p');
      p.className = 'anchor-form-paragraph';
      p.textContent = field.content || field.label || '';
      wrapper.appendChild(p);
      return wrapper;
    }
    if (field.type === 'divider') {
      wrapper.className += ' anchor-form-field--layout';
      wrapper.appendChild(document.createElement('hr')).className = 'anchor-form-divider';
      return wrapper;
    }
    if (field.type === 'score_display') {
      wrapper.className += ' anchor-form-field--layout';
      var sd = document.createElement('div');
      sd.className = 'anchor-form-score';
      sd.innerHTML = '<span class="anchor-form-score-label">' + escapeHtml(field.label || 'Your Score') + '</span><span class="anchor-form-score-value">0</span>';
      wrapper.appendChild(sd);
      return wrapper;
    }
    if (field.type === 'hidden') {
      var hi = document.createElement('input');
      hi.type = 'hidden'; hi.name = field.name; hi.value = field.defaultValue || '';
      wrapper.appendChild(hi);
      wrapper.style.display = 'none';
      return wrapper;
    }

    var labelHTML = buildLabelHTML(field);

    // --- Radio ---
    if (field.type === 'radio') {
      wrapper.className += ' anchor-form-field--radio';
      var rl = document.createElement('label');
      rl.innerHTML = labelHTML;
      wrapper.appendChild(rl);
      var rg = document.createElement('div');
      rg.className = 'anchor-form-radio-group';
      (field.options || []).forEach(function(opt) {
        var lbl = typeof opt === 'string' ? opt : opt.label;
        var val = typeof opt === 'string' ? opt : opt.value;
        var ri = document.createElement('input');
        ri.type = 'radio'; ri.name = field.name; ri.value = val;
        ri.className = 'anchor-form-radio-native';
        if (field.required) ri.required = true;
        var rLabel = document.createElement('label');
        rLabel.className = 'anchor-form-radio-label';
        rLabel.innerHTML = '';
        rLabel.appendChild(ri);
        var circle = document.createElement('span');
        circle.className = 'anchor-form-radio-circle';
        rLabel.appendChild(circle);
        rLabel.appendChild(document.createTextNode(' ' + lbl));
        rg.appendChild(rLabel);
      });
      wrapper.appendChild(rg);
      if (field.helpText) { var ht = document.createElement('span'); ht.className = 'anchor-form-help'; ht.textContent = field.helpText; wrapper.appendChild(ht); }
      return wrapper;
    }

    // --- Checkbox (multi-select) ---
    if (field.type === 'checkbox') {
      wrapper.className += ' anchor-form-field--checkbox';
      var cl = document.createElement('label');
      cl.innerHTML = labelHTML;
      wrapper.appendChild(cl);
      var cg = document.createElement('div');
      cg.className = 'anchor-form-checkbox-group';
      (field.options || []).forEach(function(opt) {
        var lbl = typeof opt === 'string' ? opt : opt.label;
        var val = typeof opt === 'string' ? opt : opt.value;
        var ci = document.createElement('input');
        ci.type = 'checkbox'; ci.name = field.name; ci.value = val;
        ci.className = 'anchor-form-checkbox-native';
        var cLabel = document.createElement('label');
        cLabel.className = 'anchor-form-checkbox-label';
        cLabel.appendChild(ci);
        var box = document.createElement('span');
        box.className = 'anchor-form-checkbox-box';
        cLabel.appendChild(box);
        cLabel.appendChild(document.createTextNode(' ' + lbl));
        cg.appendChild(cLabel);
      });
      wrapper.appendChild(cg);
      if (field.helpText) { var ht2 = document.createElement('span'); ht2.className = 'anchor-form-help'; ht2.textContent = field.helpText; wrapper.appendChild(ht2); }
      return wrapper;
    }

    // --- Consent ---
    if (field.type === 'consent') {
      wrapper.className += ' anchor-form-field--consent';
      var cni = document.createElement('input');
      cni.type = 'checkbox'; cni.name = field.name; cni.value = 'yes';
      cni.className = 'anchor-form-checkbox-native';
      cni.id = 'anchor-field-' + field.name;
      if (field.required) cni.required = true;
      wrapper.appendChild(cni);
      var cnLabel = document.createElement('label');
      cnLabel.className = 'anchor-form-consent-label';
      cnLabel.setAttribute('for', 'anchor-field-' + field.name);
      cnLabel.innerHTML = '<span class="anchor-form-checkbox-box"></span><span>' + escapeHtml(field.consentText || field.label || '') + (field.required ? ' <span class="anchor-required">*</span>' : '') + '</span>';
      wrapper.appendChild(cnLabel);
      return wrapper;
    }

    // --- Standard inputs (text, email, phone, number, url, textarea, select) ---
    var input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 4;
    } else if (field.type === 'select') {
      input = document.createElement('select');
      var defOpt = document.createElement('option');
      defOpt.value = ''; defOpt.textContent = field.placeholder || 'Select...';
      defOpt.disabled = true; defOpt.selected = true;
      input.appendChild(defOpt);
      (field.options || []).forEach(function(opt) {
        var o = document.createElement('option');
        o.value = typeof opt === 'string' ? opt : opt.value;
        o.textContent = typeof opt === 'string' ? opt : opt.label;
        input.appendChild(o);
      });
      input.setAttribute('data-empty', 'true');
      input.addEventListener('change', function() { this.setAttribute('data-empty', this.value ? 'false' : 'true'); });
    } else {
      input = document.createElement('input');
      var typeMap = { phone: 'tel', url: 'url', number: 'number', email: 'email' };
      input.type = typeMap[field.type] || 'text';
      if (field.type === 'number') {
        if (field.min != null) input.min = field.min;
        if (field.max != null) input.max = field.max;
        if (field.step != null) input.step = field.step;
      }
    }

    input.id = 'anchor-field-' + field.name;
    input.name = field.name;
    if (field.required) input.required = true;
    if (field.defaultValue) input.value = field.defaultValue;

    if (isFloating && field.type !== 'select') {
      input.placeholder = ' ';
      wrapper.appendChild(input);
      var fLabel = document.createElement('label');
      fLabel.setAttribute('for', input.id);
      fLabel.innerHTML = labelHTML;
      wrapper.appendChild(fLabel);
    } else if (!isHidden) {
      var sLabel = document.createElement('label');
      sLabel.setAttribute('for', input.id);
      sLabel.innerHTML = labelHTML;
      wrapper.appendChild(sLabel);
      if (field.placeholder && field.type !== 'select') input.placeholder = field.placeholder;
      wrapper.appendChild(input);
    } else {
      // Hidden labels — just input with placeholder as label
      if (field.placeholder) input.placeholder = field.placeholder;
      else input.placeholder = field.label || '';
      wrapper.appendChild(input);
    }

    if (field.helpText) {
      var help = document.createElement('span');
      help.className = 'anchor-form-help';
      help.textContent = field.helpText;
      wrapper.appendChild(help);
    }

    return wrapper;
  }

  // ---------------------------------------------------------------------------
  // Conditional logic evaluation
  // ---------------------------------------------------------------------------

  function evaluateCondition(rule, formValues) {
    var val = formValues[rule.fieldId] || '';
    switch (rule.operator) {
      case 'equals': return val === rule.value;
      case 'not_equals': return val !== rule.value;
      case 'contains': return val.indexOf(rule.value) !== -1;
      case 'not_contains': return val.indexOf(rule.value) === -1;
      case 'is_empty': return !val || val === '';
      case 'is_not_empty': return !!val && val !== '';
      case 'greater_than': return parseFloat(val) > parseFloat(rule.value);
      case 'less_than': return parseFloat(val) < parseFloat(rule.value);
      default: return true;
    }
  }

  function shouldShowField(field, formValues) {
    if (!field.conditions || field.conditions.length === 0) return true;
    var logic = field.conditionLogic || 'all';
    if (logic === 'all') {
      return field.conditions.every(function(r) { return evaluateCondition(r, formValues); });
    } else {
      return field.conditions.some(function(r) { return evaluateCondition(r, formValues); });
    }
  }

  function updateConditionalVisibility(form, fields) {
    var values = collectFormValues(form);
    fields.forEach(function(field) {
      var wrapper = form.querySelector('[data-field-id="' + (field.id || field.name) + '"]');
      if (!wrapper) return;
      var show = shouldShowField(field, values);
      wrapper.style.display = show ? '' : 'none';
      // Disable hidden inputs so they don't submit
      var inputs = wrapper.querySelectorAll('input, select, textarea');
      inputs.forEach(function(inp) { inp.disabled = !show; });
    });
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  function calculateScore(form, fields) {
    var total = 0;
    fields.forEach(function(field) {
      if (!field.options) return;
      field.options.forEach(function(opt) {
        if (!opt.score) return;
        var val = typeof opt === 'string' ? opt : opt.value;
        var inputs = form.querySelectorAll('[name="' + field.name + '"]');
        inputs.forEach(function(inp) {
          if (inp.type === 'radio' && inp.checked && inp.value === val) total += opt.score;
          if (inp.type === 'checkbox' && inp.checked && inp.value === val) total += opt.score;
          if (inp.tagName === 'SELECT' && inp.value === val) total += opt.score;
        });
      });
    });
    return total;
  }

  function updateScoreDisplay(form, fields) {
    var total = calculateScore(form, fields);
    var displays = form.querySelectorAll('.anchor-form-score-value');
    displays.forEach(function(d) { d.textContent = total; });
    return total;
  }

  // ---------------------------------------------------------------------------
  // Form value collection
  // ---------------------------------------------------------------------------

  function collectFormValues(form) {
    var data = {};
    var inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(function(inp) {
      if (!inp.name || inp.disabled) return;
      if (inp.type === 'radio') {
        if (inp.checked) data[inp.name] = inp.value;
      } else if (inp.type === 'checkbox') {
        if (!data[inp.name]) data[inp.name] = [];
        if (inp.checked) {
          if (Array.isArray(data[inp.name])) data[inp.name].push(inp.value);
          else data[inp.name] = inp.value;
        }
      } else {
        data[inp.name] = inp.value;
      }
    });
    // Flatten single-item checkbox arrays
    Object.keys(data).forEach(function(k) {
      if (Array.isArray(data[k]) && data[k].length === 0) delete data[k];
    });
    // Also index by data-field-id so conditional logic (which references fieldId) can find values
    var wrappers = form.querySelectorAll('[data-field-id]');
    wrappers.forEach(function(w) {
      var fid = w.getAttribute('data-field-id');
      var fname = w.getAttribute('data-field-name');
      if (fid && fname && fid !== fname && data.hasOwnProperty(fname)) {
        data[fid] = data[fname];
      }
    });
    return data;
  }

  // ---------------------------------------------------------------------------
  // Form rendering
  // ---------------------------------------------------------------------------

  function renderForm(container, config) {
    var schema = config.schema || { fields: [], style: {} };
    var fields = schema.fields || [];
    var style = schema.style || {};
    var settings = config.settings || {};
    var isMultiStep = style.multiStep && style.steps && style.steps.length > 1;
    var steps = style.steps || [];
    var stepConfig = style.stepConfig || {};
    var scoring = style.scoring || {};
    var afterSubmission = style.afterSubmission || settings.afterSubmission || {};
    var currentStep = 0;

    var colorScheme = style.colorScheme || 'light';
    var labelStyle = style.labelStyle || 'above';

    // Create form element
    var form = document.createElement('form');
    var cls = 'anchor-form anchor-form--' + colorScheme;
    if (labelStyle === 'floating') cls += ' anchor-form--floating';
    if (labelStyle === 'hidden') cls += ' anchor-form--hidden-labels';
    form.className = cls;
    form.setAttribute('novalidate', '');

    // CSS custom properties
    var primary = style.primaryColor || '#007bff';
    form.style.setProperty('--anchor-primary', primary);
    form.style.setProperty('--anchor-primary-rgb', hexToRgb(primary));
    form.style.setProperty('--anchor-radius', (style.borderRadius || 4) + 'px');
    form.style.setProperty('--anchor-max-width', (style.formMaxWidth || 480) + 'px');
    form.style.setProperty('--anchor-spacing', (style.fieldSpacing || 16) + 'px');
    if (style.backgroundColor) form.style.setProperty('--anchor-bg', style.backgroundColor);
    if (style.textColor) form.style.setProperty('--anchor-text', style.textColor);
    if (style.labelColor) form.style.setProperty('--anchor-label', style.labelColor);
    if (style.inputBgColor) form.style.setProperty('--anchor-input-bg', style.inputBgColor);
    if (style.inputBorderColor) form.style.setProperty('--anchor-input-border', style.inputBorderColor);
    if (style.inputTextColor) form.style.setProperty('--anchor-input-text', style.inputTextColor);
    if (style.focusBorderColor) form.style.setProperty('--anchor-focus-border', style.focusBorderColor);
    if (style.buttonBgColor) form.style.setProperty('--anchor-btn-bg', style.buttonBgColor);
    if (style.buttonTextColor) form.style.setProperty('--anchor-btn-text', style.buttonTextColor);

    // Fields container
    var fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'anchor-form-fields';

    // Progress bar (multi-step)
    var progressBar = null;
    if (isMultiStep && stepConfig.showProgressBar !== false) {
      progressBar = document.createElement('div');
      progressBar.className = 'anchor-form-progress';
      steps.forEach(function(_, si) {
        var seg = document.createElement('div');
        seg.className = 'anchor-form-progress-step' + (si === 0 ? ' anchor-form-progress-step--active' : '');
        progressBar.appendChild(seg);
      });
      form.appendChild(progressBar);
    }

    // Step header
    var stepHeader = null;
    if (isMultiStep) {
      stepHeader = document.createElement('div');
      stepHeader.className = 'anchor-form-step-header';
      form.appendChild(stepHeader);
    }

    form.appendChild(fieldsContainer);

    // Render all fields (grouped into rows)
    function renderStepFields(stepIndex) {
      fieldsContainer.innerHTML = '';
      var stepFields = isMultiStep && steps[stepIndex]
        ? fields.filter(function(f) { return steps[stepIndex].fieldIds.indexOf(f.id || f.name) !== -1; })
        : fields;

      var rows = groupFieldsIntoRows(stepFields);
      rows.forEach(function(row) {
        if (row.length > 1) {
          var rowDiv = document.createElement('div');
          rowDiv.className = 'anchor-form-row';
          row.forEach(function(f) {
            var fieldEl = renderField(f, style);
            fieldEl.style.flex = widthFlex[f.width] || '1 1 100%';
            rowDiv.appendChild(fieldEl);
          });
          fieldsContainer.appendChild(rowDiv);
        } else {
          fieldsContainer.appendChild(renderField(row[0], style));
        }
      });

      // Update step header
      if (stepHeader && steps[stepIndex]) {
        var s = steps[stepIndex];
        stepHeader.innerHTML = '<div class="anchor-form-step-counter">Step ' + (stepIndex + 1) + ' of ' + steps.length + '</div>';
        if (stepConfig.showStepTitles !== false && s.title) {
          stepHeader.innerHTML += '<h3 class="anchor-form-step-title">' + escapeHtml(s.title) + '</h3>';
        }
        if (s.description) {
          stepHeader.innerHTML += '<p class="anchor-form-step-desc">' + escapeHtml(s.description) + '</p>';
        }
      }

      // Update progress bar
      if (progressBar) {
        var segs = progressBar.children;
        for (var j = 0; j < segs.length; j++) {
          segs[j].className = 'anchor-form-progress-step' +
            (j === stepIndex ? ' anchor-form-progress-step--active' : '') +
            (j < stepIndex ? ' anchor-form-progress-step--done' : '');
        }
      }

      // Apply conditional visibility
      updateConditionalVisibility(form, stepFields);
      // Update scoring
      if (scoring.enabled) updateScoreDisplay(form, fields);
    }

    // Navigation buttons
    var navContainer = document.createElement('div');
    if (isMultiStep) navContainer.className = 'anchor-form-step-nav';
    form.appendChild(navContainer);

    function updateNav() {
      navContainer.innerHTML = '';
      if (isMultiStep) {
        navContainer.className = 'anchor-form-step-nav';
        if (currentStep > 0) {
          var backBtn = document.createElement('button');
          backBtn.type = 'button';
          backBtn.className = 'anchor-form-step-back';
          backBtn.textContent = 'Back';
          backBtn.addEventListener('click', function() { currentStep--; renderStepFields(currentStep); updateNav(); });
          navContainer.appendChild(backBtn);
        }
        if (currentStep < steps.length - 1) {
          var nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'anchor-form-step-next';
          nextBtn.textContent = 'Continue';
          nextBtn.addEventListener('click', function() {
            // Validate current step
            var valid = true;
            var stepFields = fieldsContainer.querySelectorAll('input[required]:not([disabled]), select[required]:not([disabled]), textarea[required]:not([disabled])');
            stepFields.forEach(function(inp) {
              if (!inp.checkValidity()) { inp.reportValidity(); valid = false; }
            });
            if (!valid) return;
            currentStep++; renderStepFields(currentStep); updateNav();
          });
          navContainer.appendChild(nextBtn);
        } else {
          var submitBtn = document.createElement('button');
          submitBtn.type = 'submit';
          submitBtn.className = 'anchor-form-step-next';
          submitBtn.textContent = style.submitLabel || 'Submit';
          navContainer.appendChild(submitBtn);
        }
      } else {
        navContainer.className = '';
        var btn = document.createElement('button');
        btn.type = 'submit';
        btn.className = 'anchor-form-submit';
        btn.textContent = style.submitLabel || 'Submit';
        navContainer.appendChild(btn);
      }
    }

    // Status area
    var status = document.createElement('div');
    status.className = 'anchor-form-status';
    form.appendChild(status);

    // Event listeners for conditional logic and scoring
    form.addEventListener('change', function() {
      updateConditionalVisibility(form, fields);
      if (scoring.enabled) updateScoreDisplay(form, fields);
    });
    form.addEventListener('input', function() {
      updateConditionalVisibility(form, fields);
      if (scoring.enabled) updateScoreDisplay(form, fields);
    });

    // Handle submission
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }

      var submitBtns = form.querySelectorAll('button[type="submit"]');
      submitBtns.forEach(function(b) { b.disabled = true; b.textContent = 'Submitting...'; });
      status.textContent = '';
      status.className = 'anchor-form-status';

      var formData = collectFormValues(form);
      if (scoring.enabled) {
        formData[scoring.fieldName || 'total_score'] = calculateScore(form, fields);
      }

      var trackingData = getAttribution();
      var token = container.dataset.formToken;

      submitForm(token, {
        fields: formData,
        attribution: trackingData.attribution,
        sessionId: trackingData.sessionId
      })
      .then(function(result) {
        var action = afterSubmission.action || 'message';

        if (action === 'redirect' && afterSubmission.redirectUrl) {
          var url = replaceTokens(afterSubmission.redirectUrl, formData);
          var delay = afterSubmission.redirectDelay || 0;
          if (delay > 0) {
            showSuccessMessage(form, 'Redirecting in ' + delay + ' seconds...');
            setTimeout(function() { window.location.href = url; }, delay * 1000);
          } else {
            window.location.href = url;
          }
        } else if (action === 'popup') {
          showPopup(afterSubmission, formData, result);
          showSuccessMessage(form, result.thankYouMessage || afterSubmission.message || 'Thank you!');
        } else {
          var msg = replaceTokens(
            afterSubmission.message || result.thankYouMessage || settings.thankYouMessage || 'Thank you for your submission!',
            formData
          );
          showSuccessMessage(form, msg);
        }
      })
      .catch(function(err) {
        status.textContent = err.message || 'Something went wrong. Please try again.';
        status.className = 'anchor-form-status anchor-form-status--error';
        submitBtns.forEach(function(b) { b.disabled = false; b.textContent = style.submitLabel || 'Submit'; });
      });
    });

    // Initial render
    renderStepFields(currentStep);
    updateNav();

    container.innerHTML = '';
    container.appendChild(form);
  }

  function showSuccessMessage(form, message) {
    form.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'anchor-form-success';
    div.innerHTML = '<h3>Thank You!</h3><p>' + escapeHtml(message) + '</p>';
    form.appendChild(div);
  }

  function showPopup(config, formData) {
    var overlay = document.createElement('div');
    overlay.className = 'anchor-form-popup-overlay';
    var popup = document.createElement('div');
    popup.className = 'anchor-form-popup';
    if (config.popupTitle) {
      var title = document.createElement('h3');
      title.textContent = replaceTokens(config.popupTitle, formData);
      popup.appendChild(title);
    }
    if (config.popupHtml) {
      var content = document.createElement('div');
      content.textContent = replaceTokens(config.popupHtml, formData);
      popup.appendChild(content);
    }
    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'anchor-form-popup-close';
    closeBtn.addEventListener('click', function() { overlay.remove(); });
    popup.appendChild(closeBtn);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    if (config.popupAutoClose && config.popupAutoClose > 0) {
      setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, config.popupAutoClose * 1000);
    }
  }

  // ---------------------------------------------------------------------------
  // Styles injection
  // ---------------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById('anchor-forms-styles')) return;
    var s = document.createElement('style');
    s.id = 'anchor-forms-styles';
    s.textContent = [
      '.anchor-form {',
      '  --anchor-primary: #007bff; --anchor-primary-rgb: 0, 123, 255;',
      '  --anchor-radius: 4px; --anchor-max-width: 480px; --anchor-spacing: 16px;',
      '  --anchor-bg: #fff; --anchor-text: #333; --anchor-label: #555;',
      '  --anchor-input-bg: #fff; --anchor-input-border: #d0d0d0; --anchor-input-text: #333;',
      '  --anchor-focus-border: var(--anchor-primary); --anchor-btn-bg: var(--anchor-primary); --anchor-btn-text: #fff;',
      '  --anchor-error: #dc3545; --anchor-success: #28a745;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '  max-width: var(--anchor-max-width); margin: 0 auto; padding: 24px;',
      '  box-sizing: border-box; background: var(--anchor-bg); color: var(--anchor-text);',
      '}',
      '.anchor-form *, .anchor-form *::before, .anchor-form *::after { box-sizing: border-box; }',
      '.anchor-form-title { margin: 0 0 20px; font-size: 1.5em; font-weight: 600; }',
      '.anchor-form-row { display: flex; gap: 12px; margin-bottom: var(--anchor-spacing); }',
      '.anchor-form-row .anchor-form-field { min-width: 0; margin-bottom: 0; }',
      '.anchor-form-field { margin-bottom: var(--anchor-spacing); }',
      '.anchor-form-field > label:not(.anchor-form-checkbox-label):not(.anchor-form-radio-label):not(.anchor-form-consent-label) {',
      '  display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px; color: var(--anchor-label); }',
      '.anchor-required { color: var(--anchor-error); }',
      '.anchor-form-help { display: block; margin-top: 4px; font-size: 12px; color: #888; }',
      '.anchor-form-field input[type="text"], .anchor-form-field input[type="email"],',
      '.anchor-form-field input[type="tel"], .anchor-form-field input[type="number"],',
      '.anchor-form-field input[type="url"], .anchor-form-field select, .anchor-form-field textarea {',
      '  width: 100%; padding: 10px 12px; border: 1px solid var(--anchor-input-border);',
      '  border-radius: var(--anchor-radius); font-size: 16px; font-family: inherit;',
      '  background: var(--anchor-input-bg); color: var(--anchor-input-text); outline: none;',
      '  transition: border-color 0.2s, box-shadow 0.2s; }',
      '.anchor-form-field textarea { resize: vertical; min-height: 80px; }',
      '.anchor-form-field input:focus, .anchor-form-field select:focus, .anchor-form-field textarea:focus {',
      '  border-color: var(--anchor-focus-border); box-shadow: 0 0 0 3px rgba(var(--anchor-primary-rgb), 0.15); }',
      '.anchor-form-field select { appearance: none; -webkit-appearance: none; cursor: pointer;',
      "  background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8.825a.5.5 0 01-.354-.146l-4.47-4.47a.5.5 0 01.707-.708L6 7.618l4.117-4.117a.5.5 0 01.707.707l-4.47 4.47A.5.5 0 016 8.826z'/%3E%3C/svg%3E\");",
      '  background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }',
      /* Checkbox */
      '.anchor-form-field--checkbox, .anchor-form-field--consent { position: relative; }',
      '.anchor-form-checkbox-group, .anchor-form-radio-group { display: flex; flex-direction: column; gap: 8px; }',
      '.anchor-form-checkbox-native, .anchor-form-radio-native { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }',
      '.anchor-form-checkbox-label, .anchor-form-radio-label, .anchor-form-consent-label {',
      '  display: inline-flex; align-items: center; cursor: pointer; user-select: none; font-weight: 400; font-size: 14px; line-height: 1.5; }',
      '.anchor-form-checkbox-box { display: inline-flex; align-items: center; justify-content: center;',
      '  width: 20px; height: 20px; min-width: 20px; border: 2px solid var(--anchor-input-border);',
      '  border-radius: var(--anchor-radius); margin-right: 10px; transition: all 0.15s; background: var(--anchor-input-bg); flex-shrink: 0; }',
      '.anchor-form-radio-circle { display: inline-flex; align-items: center; justify-content: center;',
      '  width: 20px; height: 20px; min-width: 20px; border: 2px solid var(--anchor-input-border);',
      '  border-radius: 50%; margin-right: 10px; transition: all 0.15s; background: var(--anchor-input-bg); flex-shrink: 0; }',
      '.anchor-form-checkbox-native:checked + .anchor-form-checkbox-label .anchor-form-checkbox-box,',
      '.anchor-form-field--consent .anchor-form-checkbox-native:checked + .anchor-form-consent-label .anchor-form-checkbox-box {',
      '  background: var(--anchor-primary); border-color: var(--anchor-primary); }',
      '.anchor-form-checkbox-native:checked + .anchor-form-checkbox-label .anchor-form-checkbox-box::after,',
      '.anchor-form-field--consent .anchor-form-checkbox-native:checked + .anchor-form-consent-label .anchor-form-checkbox-box::after {',
      '  content: ""; display: block; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); margin-top: -2px; }',
      '.anchor-form-radio-native:checked + .anchor-form-radio-label .anchor-form-radio-circle {',
      '  border-color: var(--anchor-primary); }',
      '.anchor-form-radio-native:checked + .anchor-form-radio-label .anchor-form-radio-circle::after {',
      '  content: ""; display: block; width: 10px; height: 10px; border-radius: 50%; background: var(--anchor-primary); }',
      /* Layout */
      '.anchor-form-heading { margin: 8px 0 4px; font-size: 1.25em; font-weight: 600; color: var(--anchor-text); }',
      '.anchor-form-paragraph { margin: 0 0 4px; font-size: 14px; color: #666; line-height: 1.6; }',
      '.anchor-form-divider { border: none; border-top: 1px solid var(--anchor-input-border); margin: 8px 0; }',
      '.anchor-form-score { text-align: center; padding: 16px; background: rgba(var(--anchor-primary-rgb), 0.08);',
      '  border-radius: var(--anchor-radius); font-size: 1.5em; font-weight: 700; color: var(--anchor-primary); }',
      '.anchor-form-score-label { font-size: 0.5em; font-weight: 500; display: block; margin-bottom: 4px; color: var(--anchor-label); }',
      /* Floating labels */
      '.anchor-form--floating .anchor-form-field:not(.anchor-form-field--checkbox):not(.anchor-form-field--radio):not(.anchor-form-field--consent):not(.anchor-form-field--layout) { position: relative; }',
      '.anchor-form--floating .anchor-form-field:not(.anchor-form-field--checkbox):not(.anchor-form-field--radio):not(.anchor-form-field--consent):not(.anchor-form-field--layout) > label:not(.anchor-form-checkbox-label):not(.anchor-form-radio-label):not(.anchor-form-consent-label) {',
      '  position: absolute; left: 13px; top: 12px; font-size: 16px; font-weight: 400; color: #888;',
      '  transition: all 0.2s ease; pointer-events: none; z-index: 1; margin: 0; padding: 0; line-height: 1; background: transparent; }',
      '.anchor-form--floating .anchor-form-field input:focus ~ label, .anchor-form--floating .anchor-form-field input:not(:placeholder-shown) ~ label,',
      '.anchor-form--floating .anchor-form-field textarea:focus ~ label, .anchor-form--floating .anchor-form-field textarea:not(:placeholder-shown) ~ label {',
      '  top: -8px; left: 9px; font-size: 12px; font-weight: 500; color: var(--anchor-primary); background: var(--anchor-input-bg); padding: 0 4px; }',
      '.anchor-form--floating .anchor-form-field select:focus ~ label, .anchor-form--floating .anchor-form-field select:not([data-empty="true"]) ~ label {',
      '  top: -8px; left: 9px; font-size: 12px; font-weight: 500; color: var(--anchor-primary); background: var(--anchor-input-bg); padding: 0 4px; }',
      /* Hidden labels */
      '.anchor-form--hidden-labels .anchor-form-field > label:not(.anchor-form-checkbox-label):not(.anchor-form-radio-label):not(.anchor-form-consent-label) { display: none; }',
      /* Submit button */
      '.anchor-form-submit, .anchor-form-step-next {',
      '  width: 100%; padding: 12px 24px; background: var(--anchor-btn-bg); color: var(--anchor-btn-text);',
      '  border: none; border-radius: var(--anchor-radius); font-size: 16px; font-weight: 600;',
      '  font-family: inherit; cursor: pointer; margin-top: 8px; transition: filter 0.2s; }',
      '.anchor-form-submit:hover, .anchor-form-step-next:hover { filter: brightness(0.9); }',
      '.anchor-form-submit:disabled, .anchor-form-step-next:disabled { opacity: 0.6; cursor: not-allowed; }',
      /* Step navigation */
      '.anchor-form-progress { display: flex; gap: 4px; margin-bottom: 24px; }',
      '.anchor-form-progress-step { flex: 1; height: 4px; border-radius: 2px; background: var(--anchor-input-border); transition: background 0.3s; }',
      '.anchor-form-progress-step--active { background: var(--anchor-primary); }',
      '.anchor-form-progress-step--done { background: var(--anchor-primary); opacity: 0.5; }',
      '.anchor-form-step-header { margin-bottom: 16px; }',
      '.anchor-form-step-title { font-size: 1.1em; font-weight: 600; margin: 0 0 4px; }',
      '.anchor-form-step-desc { font-size: 14px; color: #666; margin: 0; }',
      '.anchor-form-step-counter { font-size: 12px; color: #888; margin-bottom: 8px; }',
      '.anchor-form-step-nav { display: flex; gap: 8px; margin-top: 16px; }',
      '.anchor-form-step-back { padding: 10px 20px; border: 1px solid var(--anchor-input-border); border-radius: var(--anchor-radius);',
      '  background: transparent; color: var(--anchor-text); font-size: 14px; cursor: pointer; font-family: inherit; }',
      '.anchor-form-step-next { flex: 1; }',
      /* Status + Success */
      '.anchor-form-status { margin-top: 12px; padding: 10px; border-radius: var(--anchor-radius); text-align: center; font-size: 14px; }',
      '.anchor-form-status:empty { display: none; }',
      '.anchor-form-status--error { display: block; background: #f8d7da; color: #721c24; }',
      '.anchor-form-success { text-align: center; padding: 40px 20px; }',
      '.anchor-form-success h3 { color: var(--anchor-success); margin-bottom: 12px; }',
      /* Popup */
      '.anchor-form-popup-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%;',
      '  background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 99999; }',
      '.anchor-form-popup { background: #fff; border-radius: 8px; padding: 32px; max-width: 480px; width: 90%; text-align: center; }',
      '.anchor-form-popup h3 { margin: 0 0 12px; }',
      '.anchor-form-popup-close { margin-top: 20px; padding: 8px 24px; border: 1px solid #ccc; border-radius: 4px;',
      '  background: transparent; cursor: pointer; font-size: 14px; }',
      /* Dark theme */
      '.anchor-form--dark { --anchor-bg: #1a1a2e; --anchor-text: #e0e0e0; --anchor-label: #b0b0b0;',
      '  --anchor-input-bg: #16213e; --anchor-input-border: #444; --anchor-input-text: #e0e0e0; }',
      '.anchor-form--dark .anchor-form-checkbox-box, .anchor-form--dark .anchor-form-radio-circle { background: #16213e; border-color: #444; }',
      '.anchor-form--dark.anchor-form--floating .anchor-form-field input:focus ~ label,',
      '.anchor-form--dark.anchor-form--floating .anchor-form-field input:not(:placeholder-shown) ~ label { background: #1a1a2e; }',
      '.anchor-form--dark .anchor-form-popup { background: #2d2d2d; color: #e0e0e0; }'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function initContainer(container) {
    var token = container.dataset.formToken;
    if (!token) { console.warn('[Anchor Forms] Missing data-form-token'); return; }
    container.innerHTML = '<div style="text-align:center;padding:20px;">Loading form...</div>';
    fetchForm(token)
      .then(function(config) { renderForm(container, config); })
      .catch(function(err) { container.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">Failed to load form: ' + err.message + '</div>'; });
  }

  function init() {
    injectStyles();
    document.querySelectorAll('[data-form-token]').forEach(initContainer);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.AnchorForms = {
    init: function(c) { if (typeof c === 'string') c = document.querySelector(c); if (c) initContainer(c); },
    refresh: init
  };

})();
