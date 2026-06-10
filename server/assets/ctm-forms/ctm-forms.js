/**
 * CTM Forms Embed Script
 *
 * Loads a CTM form by embed token and handles submission.
 * Mirrors the WordPress plugin's inline script behavior.
 *
 * Usage:
 * <div id="anchor-ctm-form" data-ctm-form-token="TOKEN"></div>
 * <script src="[APP_URL]/ctm-forms/ctm-forms.js" async></script>
 */
(function() {
  'use strict';

  var script = document.currentScript;
  var apiBase = script && script.dataset.apiBase;
  if (!apiBase) {
    var c = document.querySelector('[data-ctm-form-token][data-api-base]');
    if (c) { apiBase = c.dataset.apiBase; }
    else { try { apiBase = new URL(script.src).origin + '/api'; } catch(e) { apiBase = '/api'; } }
  }

  var DUPE_TTL = 900000; // 15 minutes

  // ── Helpers ──

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function getParam(n) { try { return new URLSearchParams(location.search).get(n) || ''; } catch(e) { return ''; } }

  function replaceTokens(tmpl, fields) {
    return tmpl.replace(/\{([^}]+)\}/g, function(m, k) { return fields.hasOwnProperty(k) ? escapeHtml(String(fields[k])) : m; });
  }

  function replaceTokensUrl(tmpl, fields) {
    return tmpl.replace(/\{([^}]+)\}/g, function(m, k) { return fields.hasOwnProperty(k) ? encodeURIComponent(fields[k]) : m; });
  }

  function readCookie(name) {
    try {
      var re = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)');
      var m = document.cookie.match(re);
      if (m) return m[1];
    } catch(e) {}
    return '';
  }

  function getCtmSid() {
    try {
      if (typeof __ctm !== 'undefined') {
        if (__ctm.tracker && __ctm.tracker.getSessionId) return __ctm.tracker.getSessionId();
        if (__ctm.session) return __ctm.session;
        if (__ctm.sid) return __ctm.sid;
        if (__ctm.config && __ctm.config.sid) return __ctm.config.sid; // tctm.co format
      }
    } catch(ex) {}
    // Cookie fallback — mirrors the reference WordPress plugin's priority order
    var cookieNames = ['__ctmid', '__ctm_uid', 'ctm_session_id'];
    for (var ci = 0; ci < cookieNames.length; ci++) {
      var val = readCookie(cookieNames[ci]);
      if (val) return val;
    }
    return '';
  }

  // Wait up to maxMs for ctm.js to initialise, then resolve with the SID.
  function waitForCtmSid(maxMs) {
    return new Promise(function(resolve) {
      var elapsed = 0;
      var interval = 100;
      (function check() {
        var sid = getCtmSid();
        if (sid || elapsed >= maxMs) { resolve(sid); return; }
        elapsed += interval;
        setTimeout(check, interval);
      })();
    });
  }

  // ── Attribution (captured at page load) ──

  var attribution = {};
  if (document.referrer) attribution.referring_url = document.referrer;
  attribution.page_url = location.href;
  var paramKeys = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','fbclid','msclkid'];
  for (var p = 0; p < paramKeys.length; p++) {
    var v = getParam(paramKeys[p]);
    if (v) attribution[paramKeys[p]] = v;
  }

  // ── Conditional logic + scoring (mirrors form-logic.js) ──

  function initFormLogic(wrap) {
    var conditionalFields = wrap.querySelectorAll('[data-conditions]');
    var hasScoringAttr = wrap.querySelector('[data-scoring]');
    var hasConditionals = conditionalFields.length > 0;
    var scoring = null;

    if (hasScoringAttr) {
      try { scoring = JSON.parse(hasScoringAttr.getAttribute('data-scoring')); } catch(e) {}
    }
    if (!hasConditionals && !scoring) return;

    var fieldMap = {};
    var allFieldEls = wrap.querySelectorAll('[data-field-id]');
    for (var i = 0; i < allFieldEls.length; i++) {
      var el = allFieldEls[i];
      fieldMap[el.getAttribute('data-field-id')] = el;
    }

    function getFieldValue(fieldId) {
      var container = fieldMap[fieldId];
      if (!container) return '';
      var radios = container.querySelectorAll('input[type="radio"]');
      if (radios.length > 0) { for (var r = 0; r < radios.length; r++) { if (radios[r].checked) return radios[r].value; } return ''; }
      var checkboxes = container.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length > 0) { var vals = []; for (var c = 0; c < checkboxes.length; c++) { if (checkboxes[c].checked) vals.push(checkboxes[c].value); } return vals.join(','); }
      var sel = container.querySelector('select'); if (sel) return sel.value;
      var ta = container.querySelector('textarea'); if (ta) return ta.value;
      var inp = container.querySelector('input'); if (inp) return inp.value;
      return '';
    }

    function evalCondition(cond) {
      var val = getFieldValue(cond.field || cond.fieldId), target = cond.value || '';
      switch (cond.operator) {
        case 'equals': return val === target;
        case 'not_equals': return val !== target;
        case 'contains': return val.indexOf(target) !== -1;
        case 'is_empty': return val === '';
        case 'is_not_empty': return val !== '';
        case 'greater_than': return parseFloat(val) > parseFloat(target);
        case 'less_than': return parseFloat(val) < parseFloat(target);
        default: return false;
      }
    }

    function evalConditions(el) {
      var condJson = el.getAttribute('data-conditions'), logic = el.getAttribute('data-condition-logic') || 'all', conditions;
      try { conditions = JSON.parse(condJson); } catch(e) { return true; }
      if (!conditions || conditions.length === 0) return true;
      if (logic === 'any') { for (var i = 0; i < conditions.length; i++) { if (evalCondition(conditions[i])) return true; } return false; }
      for (var j = 0; j < conditions.length; j++) { if (!evalCondition(conditions[j])) return false; }
      return true;
    }

    function updateConditionals() {
      for (var i = 0; i < conditionalFields.length; i++) {
        var el = conditionalFields[i], show = evalConditions(el);
        el.style.display = show ? '' : 'none';
        var inputs = el.querySelectorAll('input, select, textarea');
        for (var j = 0; j < inputs.length; j++) inputs[j].disabled = !show;
      }
    }

    var scoreDisplay = wrap.querySelector('.ctm-score-display');
    var scoreInput = wrap.querySelector('.ctm-score-input');

    function updateScoring() {
      if (!scoring) return;
      var total = 0, scoredEls = wrap.querySelectorAll('[data-score]');
      for (var i = 0; i < scoredEls.length; i++) {
        var el = scoredEls[i], score = parseFloat(el.getAttribute('data-score')) || 0;
        if (el.tagName === 'OPTION') { if (el.selected) total += score; }
        else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) total += score; }
      }
      if (scoreDisplay) scoreDisplay.textContent = total;
      if (scoreInput) scoreInput.value = total;
    }

    var formEl = wrap.querySelector('form');
    if (formEl) {
      formEl.addEventListener('change', function() { if (hasConditionals) updateConditionals(); if (scoring) updateScoring(); });
      formEl.addEventListener('input', function() { if (hasConditionals) updateConditionals(); });
    }
    if (hasConditionals) updateConditionals();
    if (scoring) updateScoring();
  }

  // ── Form rendering ──

  function initContainer(container) {
    var token = container.dataset.ctmFormToken;
    if (!token) return;

    container.innerHTML = '<div style="text-align:center;padding:20px;font-family:sans-serif;color:#666">Loading form...</div>';

    fetch(apiBase + '/ctm-forms/embed/' + token, { headers: { 'ngrok-skip-browser-warning': '1' } })
      .then(function(r) { if (!r.ok) throw new Error('Form not found'); return r.json(); })
      .then(function(data) { renderForm(container, data, token); emitFunnel(token, 'rendered'); })
      .catch(function(err) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545">' + escapeHtml(err.message) + '</div>';
      });
  }

  // ── CTM Tracking Script loader ──
  // Injects the CTM visitor-tracking script if not already present.
  // Load reCAPTCHA Enterprise script once per page.
  var recaptchaLoaded = false;
  function loadRecaptcha(siteKey) {
    if (recaptchaLoaded || !siteKey) return;
    recaptchaLoaded = true;
    var s = document.createElement('script');
    // Load from recaptcha.net (not google.com): same Enterprise script + same site key,
    // but the recaptcha.net host is less likely to be blocked by tracker/privacy blockers
    // and Edge Tracking Prevention, which otherwise suppress the token entirely.
    s.src = 'https://www.recaptcha.net/recaptcha/enterprise.js?render=' + encodeURIComponent(siteKey);
    s.async = true;
    document.head.appendChild(s);
  }

  // Get a reCAPTCHA token (resolves to '' if reCAPTCHA not loaded).
  function getRecaptchaToken(siteKey, action) {
    return new Promise(function(resolve) {
      if (!siteKey || typeof grecaptcha === 'undefined' || !grecaptcha.enterprise) return resolve('');
      try {
        grecaptcha.enterprise.ready(function() {
          // Inner try/catch needed — ready() callback is async so outer catch won't catch throws here
          try {
            grecaptcha.enterprise.execute(siteKey, { action: action })
              .then(resolve)
              .catch(function() { resolve(''); });
          } catch(e) { resolve(''); }
        });
      } catch(e) { resolve(''); }
    });
  }

  // Lightweight, fire-and-forget conversion-funnel telemetry. Never blocks or throws — it
  // lets the dashboard tell "user clicked but request never reached backend" apart from
  // "backend received but blocked". ES5-only (runs un-transpiled on arbitrary client sites).
  function emitFunnel(token, event, meta) {
    if (!token || !event) return;
    try {
      var url = apiBase + '/ctm-forms/embed/' + token + '/funnel';
      var payload = JSON.stringify({ event: event, meta: meta || null });
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: payload,
        keepalive: true
      })['catch'](function() {});
    } catch (e) {}
  }

  // This creates the __ctm session so visitor_sid is linkable in CTM.
  var ctmScriptLoaded = false;
  function loadCtmTrackingScript(accountNumber) {
    if (ctmScriptLoaded || !accountNumber) return;
    if (typeof __ctm !== 'undefined') { ctmScriptLoaded = true; return; }
    ctmScriptLoaded = true;
    var s = document.createElement('script');
    s.src = '//cdn.calltrackingmetrics.com/a/' + accountNumber + '/ctm.js';
    s.async = true;
    document.head.appendChild(s);
  }

  function renderForm(container, data, token) {
    var CFG = data.settings || {};
    var html = data.html || '';
    if (!html) { container.innerHTML = '<div style="padding:20px;color:#999">Form has no content.</div>'; return; }

    // NOTE: CTM tracking script is intentionally NOT loaded here at form render time.
    // It is injected only after a successful form submission (GDPR ePrivacy compliance).
    // See the success handler in doSubmit() below.

    // Load reCAPTCHA Enterprise
    if (data.recaptchaSiteKey) loadRecaptcha(data.recaptchaSiteKey);

    // Color scheme
    // NOTE: keep this widget ES5-only — it runs un-transpiled on arbitrary client
    // sites, including legacy/pre-Chromium Edge (EdgeHTML) and Edge IE mode, where
    // optional chaining (?.) is a PARSE error that kills the whole script (no form,
    // no submit). Use explicit && guards instead of ?. / ?? / arrow fns / template literals.
    var config = data.config || {};
    var settings = config.settings || {};
    var colorScheme = settings.colorScheme || 'light';
    var colors = settings.colors || {};

    var wrapClass = 'ctm-form-wrap';
    if (colorScheme === 'dark') wrapClass += ' ctm-scheme-dark';

    // CSS custom properties for colors
    var styleStr = '';
    var colorMap = {
      bg: '--ctm-bg', text: '--ctm-text', label: '--ctm-label',
      inputBg: '--ctm-input-bg', inputBorder: '--ctm-input-border', inputText: '--ctm-input-text',
      focus: '--ctm-focus', btnBg: '--ctm-btn-bg', btnText: '--ctm-btn-text'
    };
    for (var ck in colorMap) {
      if (colors[ck]) styleStr += colorMap[ck] + ':' + colors[ck] + ';';
    }

    var wrap = document.createElement('div');
    wrap.className = wrapClass;
    if (styleStr) wrap.setAttribute('style', styleStr);

    // Multi-step class
    if (CFG.multiStep) {
      html = html.replace(/(<form\b)/, '$1 class="ctm-multi-step"');
      if (CFG.autoAdvance) html = html.replace(/(<form\b)/, '$1 data-auto-advance="1"');
    }

    // Title page
    if (CFG.multiStep && CFG.titlePage) {
      var titleHtml = '<div class="ctm-multi-step-title">'
        + '<h2>' + escapeHtml(CFG.titleHeading || '') + '</h2>'
        + '<div class="ctm-ms-title-desc">' + escapeHtml(CFG.titleDesc || '') + '</div>'
        + '<button type="button" class="ctm-ms-start">' + escapeHtml(CFG.startText || 'Get Started') + '</button>'
        + '</div>';
      html = html.replace(/(<form[^>]*>)/, '$1' + titleHtml);
    }

    wrap.innerHTML = html;
    container.innerHTML = '';
    container.appendChild(wrap);

    var form = wrap.querySelector('form');
    if (!form) return;

    // ── Conditional logic + scoring (mirrors form-logic.js) ──
    initFormLogic(wrap);

    // ── Multi-step navigation ──
    // Hoisted so submit handler can navigate to invalid steps
    var msItems = null, msGoTo = null;
    if (CFG.multiStep) {
      msItems = form.querySelectorAll('.ctm-multi-step-item');
      var msTotal = msItems.length;
      if (msTotal > 1) {
        var msCurrent = 0;

        // Hide all steps except first
        for (var msi = 1; msi < msTotal; msi++) msItems[msi].style.display = 'none';

        // Progress bar + counter
        var msHeader = document.createElement('div');
        msHeader.className = 'ctm-ms-header';
        msHeader.innerHTML = '<div class="ctm-ms-counter">Step <span class="ctm-ms-cur">1</span> of ' + msTotal + '</div>'
          + '<div class="ctm-ms-progress"><div class="ctm-ms-bar"></div></div>';
        form.insertBefore(msHeader, form.firstChild);

        var msBar = msHeader.querySelector('.ctm-ms-bar');
        var msCurEl = msHeader.querySelector('.ctm-ms-cur');

        function msUpdateProgress() {
          var pct = ((msCurrent + 1) / msTotal * 100).toFixed(1);
          msBar.style.width = pct + '%';
          msCurEl.textContent = msCurrent + 1;
        }
        msUpdateProgress();

        // Add Next button to all but last step; Back button to all but first
        // On last step, move the submit button into the nav row styled like Next
        for (var msj = 0; msj < msTotal; msj++) {
          var msNav = document.createElement('div');
          msNav.className = 'ctm-ms-nav';
          msNav.dataset.step = msj;
          if (msj > 0) {
            var bBtn = document.createElement('button');
            bBtn.type = 'button';
            bBtn.className = 'ctm-ms-back';
            bBtn.textContent = CFG.backText || '\u2190 Back';
            msNav.appendChild(bBtn);
          }
          if (msj < msTotal - 1) {
            var nBtn = document.createElement('button');
            nBtn.type = 'button';
            nBtn.className = 'ctm-ms-next';
            nBtn.textContent = CFG.nextText || 'Next \u2192';
            msNav.appendChild(nBtn);
          }
          // On the last step, pull the submit button into the nav row
          var submitEl = msItems[msj].querySelector('button[type="submit"]');
          if (msj === msTotal - 1 && submitEl) {
            // Style it like the Next button, but mark it ctm-ms-submit so the nav handler
            // does NOT treat the final submit as a "go to next step" click (which would walk
            // past the last step and silently swallow the submission).
            submitEl.className = 'ctm-ms-next ctm-ms-submit';
            msNav.appendChild(submitEl);
          }
          if (msNav.children.length) {
            msItems[msj].appendChild(msNav);
          }
        }

        msGoTo = function(step) {
          msItems[msCurrent].style.display = 'none';
          msCurrent = step;
          msItems[msCurrent].style.display = '';
          msUpdateProgress();
          wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };

        // Navigation event handler
        form.addEventListener('click', function(ev) {
          var t = ev.target;

          // Navigate only on a real Next button — never on the final submit button (which
          // also carries ctm-ms-next for styling but must submit, not advance).
          if (t.classList.contains('ctm-ms-next') && !t.classList.contains('ctm-ms-submit')) {
            // HTML5 validation on current step's required fields
            var required = msItems[msCurrent].querySelectorAll('[required]');
            for (var ri = 0; ri < required.length; ri++) {
              if (!required[ri].checkValidity()) { required[ri].reportValidity(); return; }
            }
            msGoTo(msCurrent + 1);
          }

          if (t.classList.contains('ctm-ms-back')) {
            msGoTo(msCurrent - 1);
          }
        });

        // Validate all required fields in a given step
        function msStepValid(stepIndex) {
          var required = msItems[stepIndex].querySelectorAll('[required]');
          for (var ri = 0; ri < required.length; ri++) {
            if (!required[ri].checkValidity()) return false;
          }
          return true;
        }

        // Auto-advance: move to next step when a radio or select is changed
        if (form.dataset.autoAdvance === '1') {
          form.addEventListener('change', function(ev) {
            var el = ev.target;
            if (msCurrent >= msTotal - 1) return; // don't auto-advance on last step
            var isRadio = el.type === 'radio';
            var isSelect = el.tagName === 'SELECT';
            if (!isRadio && !isSelect) return;
            // Only advance if all required fields on this step are filled
            if (!msStepValid(msCurrent)) return;
            // Brief delay so the user sees their selection before advancing
            setTimeout(function() { msGoTo(msCurrent + 1); }, 350);
          });
        }
      }
    }

    // ── Duplicate protection ──
    var DUPE_KEY = 'ctm_dupe_' + token;

    function isDupe() {
      try { var ts = parseInt(localStorage.getItem(DUPE_KEY), 10); return ts && Date.now() - ts < DUPE_TTL; }
      catch(e) { return false; }
    }
    function markDupe() { try { localStorage.setItem(DUPE_KEY, String(Date.now())); } catch(e) {} }

    // ── Loading overlay ──
    function showLoading() {
      wrap.classList.add('ctm-submitting');
      if (!wrap.querySelector('.ctm-form-loading')) {
        var ov = document.createElement('div');
        ov.className = 'ctm-form-loading';
        ov.innerHTML = '<div class="ctm-form-spinner"></div>';
        wrap.appendChild(ov);
      }
    }
    function hideLoading() {
      wrap.classList.remove('ctm-submitting');
      var ov = wrap.querySelector('.ctm-form-loading');
      if (ov) ov.remove();
    }

    // ── Analytics ──
    function fireAnalytics() {
      var a = CFG.analytics || {};
      var log = [];

      // GA4 event
      if (a.ga4_event) {
        if (typeof gtag === 'function') {
          try { gtag('event', a.ga4_event, a.ga4_params ? JSON.parse(a.ga4_params) : {}); log.push({ type: 'ga4', event: a.ga4_event, status: 'fired' }); }
          catch(e) { try { gtag('event', a.ga4_event); log.push({ type: 'ga4', event: a.ga4_event, status: 'fired_fallback' }); } catch(e2) { log.push({ type: 'ga4', event: a.ga4_event, status: 'error', error: e2.message }); } }
        } else { log.push({ type: 'ga4', event: a.ga4_event, status: 'skipped', reason: 'gtag not defined' }); }
      }
      // Google Ads conversion — direct gtag call
      if (a.gads_conversion) {
        if (typeof gtag === 'function') {
          try { gtag('event', 'conversion', { send_to: a.gads_conversion }); log.push({ type: 'gads', send_to: a.gads_conversion, status: 'fired' }); }
          catch(e) { log.push({ type: 'gads', send_to: a.gads_conversion, status: 'error', error: e.message }); }
        } else { log.push({ type: 'gads', send_to: a.gads_conversion, status: 'skipped', reason: 'gtag not defined' }); }
      }
      // Facebook / Meta
      if (a.fb_event) {
        if (typeof fbq === 'function') {
          try { fbq('track', a.fb_event, a.fb_params ? JSON.parse(a.fb_params) : {}); log.push({ type: 'fb', event: a.fb_event, status: 'fired' }); }
          catch(e) { try { fbq('track', a.fb_event); log.push({ type: 'fb', event: a.fb_event, status: 'fired_fallback' }); } catch(e2) { log.push({ type: 'fb', event: a.fb_event, status: 'error', error: e2.message }); } }
        } else { log.push({ type: 'fb', event: a.fb_event, status: 'skipped', reason: 'fbq not defined' }); }
      }
      // TikTok
      if (a.tiktok_event) {
        if (typeof ttq !== 'undefined' && ttq.track) {
          try { ttq.track(a.tiktok_event, a.tiktok_params ? JSON.parse(a.tiktok_params) : {}); log.push({ type: 'tiktok', event: a.tiktok_event, status: 'fired' }); }
          catch(e) { log.push({ type: 'tiktok', event: a.tiktok_event, status: 'error', error: e.message }); }
        } else { log.push({ type: 'tiktok', event: a.tiktok_event, status: 'skipped', reason: 'ttq not defined' }); }
      }
      // Bing / Microsoft Ads
      if (a.bing_event) {
        if (typeof window.uetq !== 'undefined') {
          try { window.uetq.push('event', a.bing_event, a.bing_params ? JSON.parse(a.bing_params) : {}); log.push({ type: 'bing', event: a.bing_event, status: 'fired' }); }
          catch(e) { log.push({ type: 'bing', event: a.bing_event, status: 'error', error: e.message }); }
        } else { log.push({ type: 'bing', event: a.bing_event, status: 'skipped', reason: 'uetq not defined' }); }
      }
      if (log.length === 0) log.push({ type: 'none', status: 'no_analytics_configured' });
      return log;
    }

    // ── Thank-you popup ──
    var DEFAULT_POPUP_HTML = '<div style="padding:3rem 2.5rem;max-width:440px;width:100%;text-align:center">'
      + '<div style="width:64px;height:64px;border-radius:50%;background:#f0faf4;display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem">'
      + '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2a9d60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
      + '<p style="font-size:12px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:#888;margin:0 0 0.5rem">Message received</p>'
      + '<h2 style="font-size:26px;font-weight:500;color:#111;margin:0 0 1rem;line-height:1.25">Thank you!</h2>'
      + '<p style="font-size:15px;color:#555;line-height:1.7;margin:0">We\'ve got your info and someone from our team will be reaching out to you shortly.</p></div>';

    function showPopup(allFields) {
      var popHtml = replaceTokens(CFG.thankyouHtml || DEFAULT_POPUP_HTML, allFields);
      var overlay = document.createElement('div');
      overlay.className = 'ctm-thankyou-overlay';
      overlay.innerHTML = '<div class="ctm-thankyou-box"><button type="button" class="ctm-thankyou-close" aria-label="Close">&times;</button><div class="ctm-thankyou-body">' + popHtml + '</div></div>';
      document.body.appendChild(overlay);
      overlay.offsetHeight;
      overlay.classList.add('ctm-active');
      overlay.querySelector('.ctm-thankyou-close').addEventListener('click', function() { overlay.classList.remove('ctm-active'); setTimeout(function() { overlay.remove(); }, 300); });
      overlay.addEventListener('click', function(ev) { if (ev.target === overlay) { overlay.classList.remove('ctm-active'); setTimeout(function() { overlay.remove(); }, 300); } });
    }

    // ── Submit handler ──
    // Check if any form field contains a test passphrase (Anchor Corps or Anchor Test)
    function hasPassphrase() {
      var inputs = form.querySelectorAll('input, textarea, select');
      for (var i = 0; i < inputs.length; i++) {
        if (/anchor\s*(corps|test)/i.test(inputs[i].value)) return true;
      }
      return false;
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      emitFunnel(token, 'submit_click');

      // Final validation: check ALL required fields across all steps
      var allRequired = form.querySelectorAll('[required]');
      for (var vi = 0; vi < allRequired.length; vi++) {
        if (!allRequired[vi].checkValidity()) {
          // If multi-step, navigate to the step containing the invalid field
          if (msItems && msGoTo) {
            for (var si = 0; si < msItems.length; si++) {
              if (msItems[si].contains(allRequired[vi])) { msGoTo(si); break; }
            }
          }
          allRequired[vi].reportValidity();
          emitFunnel(token, 'validation_failed', { reason: 'required_field' });
          return;
        }
      }

      // Phone number validation — reject obviously invalid numbers before submission
      var phoneInput = form.querySelector('input[type="tel"], input[name="phone_number"], input[name="phone"]');
      if (phoneInput && phoneInput.value) {
        var digits = phoneInput.value.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) {
          // Navigate to step containing the phone field if multi-step
          if (msItems && msGoTo) {
            for (var pi = 0; pi < msItems.length; pi++) {
              if (msItems[pi].contains(phoneInput)) { msGoTo(pi); break; }
            }
          }
          phoneInput.setCustomValidity('Please enter a valid phone number (7–15 digits).');
          phoneInput.reportValidity();
          // Clear the custom validity once the user edits the field
          phoneInput.addEventListener('input', function() { phoneInput.setCustomValidity(''); }, { once: true });
          emitFunnel(token, 'validation_failed', { reason: 'phone_length' });
          return;
        }
        // Check for obviously fake repeating patterns like 777-7777
        if (/^(\d)\1{6,}$/.test(digits) || /^1234567/.test(digits) || /^0{7,}$/.test(digits)) {
          if (msItems && msGoTo) {
            for (var pi2 = 0; pi2 < msItems.length; pi2++) {
              if (msItems[pi2].contains(phoneInput)) { msGoTo(pi2); break; }
            }
          }
          phoneInput.setCustomValidity('Please enter a real phone number.');
          phoneInput.reportValidity();
          phoneInput.addEventListener('input', function() { phoneInput.setCustomValidity(''); }, { once: true });
          emitFunnel(token, 'validation_failed', { reason: 'phone_fake' });
          return;
        }
        phoneInput.setCustomValidity('');
      }

      if (isDupe() && !hasPassphrase()) {
        var msg = form.querySelector('.ctm-form-msg') || (function() { var m = document.createElement('div'); m.className = 'ctm-form-msg'; form.appendChild(m); return m; })();
        var phoneHtml = CFG.dupePhoneHref ? '<a href="tel:' + CFG.dupePhoneHref + '">' + (CFG.dupePhone || CFG.dupePhoneHref) + '</a>' : CFG.dupePhone || '';
        msg.innerHTML = 'We got your message! Please allow us 24 hours to respond.' + (phoneHtml ? ' Please call us at ' + phoneHtml + ' if you need immediate assistance.' : '');
        msg.style.color = '#b45309';
        emitFunnel(token, 'duplicate_shown', { reason: 'client_local' });
        return;
      }

      // Wait up to 2s for ctm.js to initialise before capturing the session ID.
      // This handles the case where our embed injected ctm.js just moments ago.
      showLoading();
      waitForCtmSid(2000).then(function(sid) {
        attribution.visitor_sid = sid;
        return getRecaptchaToken(data.recaptchaSiteKey, 'ctm_form_submit');
      }).then(function(recaptchaToken) {
        doSubmit(recaptchaToken || '');
      });
      return; // actual submit continues inside doSubmit()

      function doSubmit(recaptchaToken) {

      if (!recaptchaToken) emitFunnel(token, 'recaptcha_missing');

      var core = {}, custom = {};
      var els = form.querySelectorAll('[name]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i], name = el.getAttribute('name'), val;
        if (!name || el.disabled) continue;
        var isCustom = el.classList.contains('ctm-custom');
        var target = isCustom ? custom : core;

        if (el.type === 'checkbox') {
          if (el.classList.contains('ctm-consent-checkbox')) { val = el.checked ? 'Yes' : 'No'; }
          else { if (!el.checked) continue; val = el.value; }
          if (name.endsWith('[]')) {
            var bn = name.slice(0, -2);
            if (!target[bn]) target[bn] = [];
            target[bn].push(val);
            continue;
          }
        } else if (el.type === 'radio') {
          if (!el.checked) continue;
          val = el.value;
        } else { val = el.value; }
        if (val === '') continue;
        target[name] = val;
      }

      var allFields = {};
      for (var k in core) allFields[k] = Array.isArray(core[k]) ? core[k].join(', ') : core[k];
      for (var k2 in custom) allFields[k2] = Array.isArray(custom[k2]) ? custom[k2].join(', ') : custom[k2];

      emitFunnel(token, 'post_start');
      fetch(apiBase + '/ctm-forms/embed/' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ core_json: core, custom_json: custom, attribution_json: attribution, recaptcha_token: recaptchaToken })
      })
      // Read both ok-ness and the JSON body. A non-2xx (400/403/422/429/500) carries a
      // user-safe { error } from the backend — surface it instead of a generic message so
      // the visitor knows what to fix (and staff can see it in the funnel).
      .then(function(r) {
        var okFlag = r.ok, st = r.status;
        return r.json().then(function(body) { return { ok: okFlag, status: st, body: body }; },
                            function() { return { ok: okFlag, status: st, body: {} }; });
      })
      .then(function(resp) {
        hideLoading();
        var result = resp.body || {};
        if (!resp.ok) {
          emitFunnel(token, 'post_failed', { httpStatus: resp.status, reason: result.error ? 'backend_error' : ('http_' + resp.status) });
          var msgErr = form.querySelector('.ctm-form-msg') || (function() { var m = document.createElement('div'); m.className = 'ctm-form-msg'; form.appendChild(m); return m; })();
          msgErr.textContent = result.error || 'There has been an error submitting the form. Please try again later.';
          msgErr.style.color = '#d63638';
          return;
        }
        if (result.duplicate || result.blocked) {
          emitFunnel(token, result.blocked ? 'blocked_shown' : 'duplicate_shown', { httpStatus: resp.status });
          var dupeMsg = form.querySelector('.ctm-form-msg') || (function() { var m = document.createElement('div'); m.className = 'ctm-form-msg'; form.appendChild(m); return m; })();
          dupeMsg.innerHTML = result.message || 'We got your message! Please allow us 24 hours to respond.';
          dupeMsg.style.color = '#b45309';
          return;
        }
        if (result.success) {
          emitFunnel(token, 'post_success', { httpStatus: resp.status });
          markDupe();
          var analyticsLog = fireAnalytics();
          // Send analytics diagnostics back to server
          if (result.submissionId && analyticsLog.length > 0) {
            try {
              fetch(apiBase + '/ctm-forms/embed/' + token + '/analytics-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submissionId: result.submissionId, log: analyticsLog })
              }).catch(function() {});
            } catch(e) {}
          }
          // Inject CTM tracking script only after successful submission (GDPR ePrivacy consent gate)
          if (data.ctmAccountNumber) loadCtmTrackingScript(data.ctmAccountNumber);

          if (CFG.submitAction === 'redirect' && CFG.redirectUrl) {
            window.location.href = replaceTokensUrl(CFG.redirectUrl, allFields);
            return;
          }
          if (CFG.submitAction === 'popup') {
            try { form.reset(); } catch(e) {}
            showPopup(allFields);
            return;
          }
          // Default: inline message
          var msg = form.querySelector('.ctm-form-msg') || (function() { var m = document.createElement('div'); m.className = 'ctm-form-msg'; form.appendChild(m); return m; })();
          msg.textContent = CFG.successMessage || "Thanks! We'll be in touch shortly.";
          msg.style.color = '#00a32a';
          try { form.reset(); } catch(e) {}
        } else {
          emitFunnel(token, 'post_failed', { httpStatus: resp.status, reason: 'no_success_flag' });
          var msg2 = form.querySelector('.ctm-form-msg') || (function() { var m = document.createElement('div'); m.className = 'ctm-form-msg'; form.appendChild(m); return m; })();
          msg2.textContent = 'There has been an error submitting the form. Please try again later.';
          msg2.style.color = '#d63638';
        }
      })
      .catch(function() {
        hideLoading();
        emitFunnel(token, 'post_failed', { reason: 'network' });
        var msg3 = form.querySelector('.ctm-form-msg') || (function() { var m = document.createElement('div'); m.className = 'ctm-form-msg'; form.appendChild(m); return m; })();
        msg3.textContent = 'There has been an error submitting the form. Please try again later.';
        msg3.style.color = '#d63638';
      });
      } // end doSubmit
    });
  }

  // ── Init ──

  function injectStyles() {
    if (document.getElementById('ctm-forms-embed-styles')) return;
    var s = document.createElement('style'); s.id = 'ctm-forms-embed-styles';
    // Minimal reset — the rendered HTML from the server includes inline structure
    // Form-logic.css and multi-step.css are loaded separately if needed
    // Styles match the plugin's form-logic.css exactly
    s.textContent = ''
      // Theme custom properties
      + '.ctm-form-wrap{--ctm-bg:#fff;--ctm-text:#1d2327;--ctm-label:#1d2327;--ctm-input-bg:#fff;--ctm-input-border:#c3c4c7;--ctm-input-text:#1d2327;--ctm-focus:#2271b1;--ctm-btn-bg:#2271b1;--ctm-btn-text:#fff;--ctm-muted:#666;--ctm-divider:#ddd;--ctm-score-bg:#f8f9fa;--ctm-score-border:#e2e4e7;--ctm-float-label:#888;position:relative;color:var(--ctm-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
      + '.ctm-scheme-dark{--ctm-bg:#1e1e2e;--ctm-text:#e0e0e0;--ctm-label:#ccc;--ctm-input-bg:#2a2a3c;--ctm-input-border:#444466;--ctm-input-text:#e0e0e0;--ctm-focus:var(--ctm-btn-bg);--ctm-muted:#999;--ctm-divider:#3a3a4c;--ctm-score-bg:#2a2a3c;--ctm-score-border:#444466}'
      // Form layout
      + '.ctm-form-wrap form{display:flex;flex-direction:column;gap:16px;margin:0 auto}'
      // Column layout
      + '.ctm-row{display:flex;flex-wrap:wrap;gap:16px}'
      + '.ctm-col-full{width:100%}'
      + '.ctm-col-half{width:calc(50% - 8px)}'
      + '.ctm-col-third{width:calc(33.333% - 11px)}'
      + '.ctm-col-quarter{width:calc(25% - 12px)}'
      + '.ctm-col-full{margin-bottom:4px}'
      // Labels
      + '.ctm-form-wrap label{display:block;font-weight:600;font-size:14px;margin-bottom:4px;color:var(--ctm-label)}'
      // Inputs
      + '.ctm-form-wrap input[type="text"],.ctm-form-wrap input[type="email"],.ctm-form-wrap input[type="tel"],.ctm-form-wrap input[type="number"],.ctm-form-wrap input[type="url"],.ctm-form-wrap textarea,.ctm-form-wrap select{display:block;width:100%;padding:10px 12px;border:1px solid var(--ctm-input-border);border-radius:4px;font-size:15px;line-height:1.5;box-sizing:border-box;background:var(--ctm-input-bg);color:var(--ctm-input-text);font-family:inherit}'
      + '.ctm-form-wrap textarea{min-height:100px;resize:vertical}'
      + '.ctm-form-wrap input:focus,.ctm-form-wrap textarea:focus,.ctm-form-wrap select:focus{border-color:var(--ctm-focus);box-shadow:0 0 0 1px var(--ctm-focus);outline:none}'
      // Submit button
      + '.ctm-form-wrap button[type="submit"],.ctm-form-wrap input[type="submit"]{display:inline-block;width:100%;padding:12px 28px;background:var(--ctm-btn-bg);color:var(--ctm-btn-text);border:none;border-radius:4px;font-size:15px;font-weight:600;cursor:pointer;line-height:1.5;transition:filter .2s}'
      + '.ctm-form-wrap button[type="submit"]:hover{filter:brightness(0.9)}'
      + '.ctm-form-wrap button[type="submit"]:disabled{opacity:0.6;cursor:not-allowed}'
      // Fieldset / radio / checkbox
      + '.ctm-form-wrap fieldset{border:none;padding:0;margin:0;display:flex;flex-direction:column;gap:2px}'
      + '.ctm-form-wrap legend{font-weight:600;font-size:14px;margin-bottom:8px;color:var(--ctm-label)}'
      + '.ctm-form-wrap fieldset label{display:flex;align-items:center;gap:10px;font-weight:400;font-size:15px;line-height:1.4;color:var(--ctm-text);padding:8px 10px;margin:0;border-radius:6px;cursor:pointer;transition:background-color .15s ease}'
      + '.ctm-form-wrap fieldset label:hover{background:rgba(0,0,0,0.03)}'
      + '.ctm-scheme-dark .ctm-form-wrap fieldset label:hover,.ctm-form-wrap.ctm-scheme-dark fieldset label:hover{background:rgba(255,255,255,0.05)}'
      // Custom radio
      + '.ctm-form-wrap fieldset input[type="radio"]{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:20px;height:20px;margin:0;flex-shrink:0;border:2px solid var(--ctm-input-border);border-radius:50%;background:var(--ctm-input-bg);cursor:pointer;position:relative;transition:border-color .15s ease,box-shadow .15s ease}'
      + '.ctm-form-wrap fieldset input[type="radio"]:hover{border-color:var(--ctm-focus)}'
      + '.ctm-form-wrap fieldset input[type="radio"]:checked{border-color:var(--ctm-focus);background:var(--ctm-input-bg)}'
      + '.ctm-form-wrap fieldset input[type="radio"]:checked::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;background:var(--ctm-focus)}'
      + '.ctm-form-wrap fieldset input[type="radio"]:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(34,113,177,0.25)}'
      // Custom checkbox
      + '.ctm-form-wrap fieldset input[type="checkbox"]{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:20px;height:20px;margin:0;flex-shrink:0;border:2px solid var(--ctm-input-border);border-radius:4px;background:var(--ctm-input-bg);cursor:pointer;position:relative;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}'
      + '.ctm-form-wrap fieldset input[type="checkbox"]:hover{border-color:var(--ctm-focus)}'
      + '.ctm-form-wrap fieldset input[type="checkbox"]:checked{border-color:var(--ctm-focus);background:var(--ctm-focus)}'
      + '.ctm-form-wrap fieldset input[type="checkbox"]:checked::after{content:"";position:absolute;top:1px;left:5px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}'
      + '.ctm-form-wrap fieldset input[type="checkbox"]:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(34,113,177,0.25)}'
      // Custom select with caret
      + '.ctm-form-wrap select{appearance:none;-webkit-appearance:none;-moz-appearance:none;padding-right:36px;background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\' fill=\'none\'><path d=\'M1 1.5L6 6.5L11 1.5\' stroke=\'%23666\' stroke-width=\'1.75\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 8px;cursor:pointer}'
      + '.ctm-form-wrap select::-ms-expand{display:none}'
      // Floating labels
      + '.ctm-form-wrap .input{position:relative}'
      + '.ctm-form-wrap .input .input-label{position:absolute;top:12px;left:12px;font-size:14px;font-weight:400;color:var(--ctm-float-label);pointer-events:none;transition:all .2s ease}'
      + '.ctm-form-wrap .input .input-field{display:block;width:100%;padding:10px 12px;border:1px solid var(--ctm-input-border);border-radius:4px;font-size:15px;line-height:1.5;box-sizing:border-box;background:var(--ctm-input-bg);color:var(--ctm-input-text);font-family:inherit}'
      + '.ctm-form-wrap .input .input-field:focus~.input-label,.ctm-form-wrap .input .input-field:not(:placeholder-shown)~.input-label{top:-8px;left:8px;font-size:11px;color:var(--ctm-focus);background:var(--ctm-input-bg);padding:0 4px}'
      + '.ctm-form-wrap .input .input-field:focus{border-color:var(--ctm-focus);box-shadow:0 0 0 1px var(--ctm-focus);outline:none}'
      // Headings, dividers
      + '.ctm-form-wrap h3{font-size:18px;margin:8px 0 4px;color:var(--ctm-text)}'
      + '.ctm-form-wrap hr{border:none;border-top:1px solid var(--ctm-divider);margin:8px 0}'
      // Help text, score, consent
      + '.ctm-help-text{display:block;font-size:12px;color:var(--ctm-muted);margin-top:4px}'
      + '.ctm-score-wrap{padding:12px 16px;margin:12px 0;background:var(--ctm-score-bg);border:1px solid var(--ctm-score-border);border-radius:6px;text-align:center}'
      + '.ctm-score-label{font-size:14px;color:var(--ctm-muted);margin-right:8px}'
      + '.ctm-score-display{font-size:24px;font-weight:700;color:var(--ctm-text)}'
      + '.ctm-consent-wrap{margin-bottom:4px}'
      + '.ctm-consent-label{display:flex;align-items:flex-start;gap:6px;font-size:12px;font-weight:300;line-height:1.2;cursor:pointer}'
      + '.ctm-consent-label input[type="checkbox"]{width:auto;margin-top:1px;flex-shrink:0}'
      + '.ctm-consent-text{color:var(--ctm-muted)}'
      + '.ctm-consent-text a{color:var(--ctm-accent,#1976d2);text-decoration:underline}'
      // Message
      + '.ctm-form-msg{margin-top:12px;padding:10px;font-size:14px;text-align:center}'
      // Loading overlay
      + '.ctm-form-wrap.ctm-submitting button[type="submit"]{opacity:0.6;pointer-events:none;cursor:not-allowed}'
      + '.ctm-form-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.7);z-index:100;border-radius:6px}'
      + '.ctm-scheme-dark .ctm-form-loading{background:rgba(30,30,46,0.7)}'
      + '.ctm-form-spinner{width:36px;height:36px;border:3px solid var(--ctm-input-border);border-top-color:var(--ctm-btn-bg);border-radius:50%;animation:ctm-spin 0.7s linear infinite}'
      + '@keyframes ctm-spin{to{transform:rotate(360deg)}}'
      // Thank-you popup
      + '.ctm-thankyou-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);z-index:999999;opacity:0;transition:opacity .25s}'
      + '.ctm-thankyou-overlay.ctm-active{opacity:1}'
      + '.ctm-thankyou-box{position:relative;background:#fff;border-radius:8px;padding:32px 28px 24px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2)}'
      + '.ctm-thankyou-close{position:absolute;top:10px;right:12px;background:none;border:none;font-size:22px;cursor:pointer;color:#666;line-height:1;padding:4px}'
      + '.ctm-thankyou-close:hover{color:#333}'
      // Conditional transitions
      + '[data-conditions]{transition:opacity .25s ease,max-height .3s ease}'
      // Multi-step progress bar
      + '.ctm-ms-header{margin-bottom:16px}'
      + '.ctm-ms-counter{font-size:12px;color:var(--ctm-muted);text-align:right;margin-bottom:6px}'
      + '.ctm-ms-progress{height:5px;background:var(--ctm-input-border);border-radius:3px;overflow:hidden}'
      + '.ctm-ms-bar{height:100%;background:var(--ctm-btn-bg);border-radius:3px;transition:width .35s ease}'
      + '.ctm-ms-nav{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}'
      + '.ctm-ms-next{flex:1;padding:12px 24px;background:var(--ctm-btn-bg);color:var(--ctm-btn-text);border:none;border-radius:4px;font-size:15px;font-weight:600;cursor:pointer;transition:filter .2s}'
      + '.ctm-ms-next:hover{filter:brightness(0.9)}'
      + '.ctm-ms-back{padding:10px 20px;background:none;border:1px solid var(--ctm-input-border);color:var(--ctm-text);border-radius:4px;font-size:14px;cursor:pointer;white-space:nowrap}'
      + '.ctm-ms-back:hover{background:var(--ctm-input-border)}'
      // Responsive
      + '@media(max-width:600px){.ctm-col-half,.ctm-col-third,.ctm-col-quarter{width:100%}}';
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();
    document.querySelectorAll('[data-ctm-form-token]:not([data-ctm-initialized])').forEach(function(c) {
      initContainer(c);
      c.dataset.ctmInitialized = '1';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Watch for dynamically added form containers (popups, modals, AJAX-loaded content)
  try {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.nodeType !== 1) continue;
          if (node.dataset && node.dataset.ctmFormToken && !node.dataset.ctmInitialized) {
            injectStyles();
            initContainer(node);
            node.dataset.ctmInitialized = '1';
          }
          // Also check children (popup might wrap the form div)
          if (node.querySelectorAll) {
            var nested = node.querySelectorAll('[data-ctm-form-token]:not([data-ctm-initialized])');
            for (var k = 0; k < nested.length; k++) {
              injectStyles();
              initContainer(nested[k]);
              nested[k].dataset.ctmInitialized = '1';
            }
          }
        }
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  window.AnchorCTMForms = { init: function(c) { if (typeof c === 'string') c = document.querySelector(c); if (c) initContainer(c); }, refresh: init };
})();
