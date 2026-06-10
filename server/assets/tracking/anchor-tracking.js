/**
 * Anchor Universal Tracking Script v2
 *
 * Comprehensive attribution capture for calls and form submissions.
 * Handles ALL major ad platforms and organic attribution automatically.
 *
 * Installation (auto-generated per client):
 * <script src="[APP_BASE_URL]/tracking/anchor-tracking.js"
 *         data-client-id="CLIENT_UUID"
 *         data-api-base="[APP_BASE_URL]/api"
 *         async></script>
 *
 * Supported Attribution Sources:
 * - Google Ads:      gclid, gbraid, wbraid (auto-tags utm_source/medium when only gclid present)
 * - Facebook/Meta:   fbclid, _fbc cookie, _fbp cookie
 * - Microsoft/Bing:  msclkid
 * - TikTok:          ttclid
 * - LinkedIn:        li_fat_id
 * - UTM Parameters:  utm_source, utm_medium, utm_campaign, utm_content, utm_term
 * - Organic:         referrer-based source detection (google, bing, yahoo, duckduckgo, etc.)
 * - Direct:          landing page, timestamp
 *
 * Attribution Model: Last-touch with 30-day persistence.
 * New paid click IDs always overwrite. Organic does NOT overwrite paid.
 */

(function() {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────
  var script = document.currentScript;
  var clientId = script && script.dataset.clientId;
  var apiBase = script && script.dataset.apiBase;

  if (!clientId) {
    console.warn('[Anchor] Missing data-client-id');
    return;
  }

  if (!apiBase) {
    var src = script && script.src;
    if (src) {
      try { apiBase = new URL(src).origin + '/api'; }
      catch (e) { apiBase = '/api'; }
    } else {
      apiBase = '/api';
    }
  }

  var STORAGE_KEY = 'anchor_attr';
  var SESSION_KEY = 'anchor_sess';
  var TOUCH_KEY   = 'anchor_first_touch';
  var SESSION_TTL = 30 * 60 * 1000;   // 30 min session
  var PERSIST_TTL = 30 * 24 * 60 * 60 * 1000; // 30 day attribution window

  // ── Click ID → inferred source mapping ─────────────────────────
  // When a click ID is present without UTMs, we infer the source/medium
  var CLICK_ID_MAP = {
    gclid:     { utm_source: 'google',    utm_medium: 'cpc' },
    gbraid:    { utm_source: 'google',    utm_medium: 'cpc' },
    wbraid:    { utm_source: 'google',    utm_medium: 'cpc' },
    msclkid:   { utm_source: 'bing',      utm_medium: 'cpc' },
    fbclid:    { utm_source: 'facebook',  utm_medium: 'cpc' },
    ttclid:    { utm_source: 'tiktok',    utm_medium: 'cpc' },
    li_fat_id: { utm_source: 'linkedin',  utm_medium: 'cpc' }
  };

  // ── Organic referrer → source mapping ──────────────────────────
  var ORGANIC_DOMAINS = {
    'google':       'google',
    'bing':         'bing',
    'yahoo':        'yahoo',
    'duckduckgo':   'duckduckgo',
    'baidu':        'baidu',
    'yandex':       'yandex',
    'ecosia':       'ecosia',
    'ask':          'ask'
  };

  // ── All click-ID parameter names we capture ────────────────────
  var CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'li_fat_id', 'dclid'];
  var UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  // ── Utilities ──────────────────────────────────────────────────

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getOrCreateSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.expires > Date.now()) return s.id;
      }
    } catch (e) { /* ignore */ }

    var session = { id: generateUUID(), expires: Date.now() + SESSION_TTL };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
    return session.id;
  }

  function getUrlParams() {
    var params = {};
    try {
      var sp = new URLSearchParams(window.location.search);
      sp.forEach(function(v, k) { params[k] = v; });
    } catch (e) {
      var q = window.location.search.substring(1);
      var pairs = q.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i].split('=');
        if (p[0]) params[decodeURIComponent(p[0])] = p[1] ? decodeURIComponent(p[1]) : '';
      }
    }
    return params;
  }

  function getCookies() {
    var cookies = {};
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].trim().split('=');
        if (pair[0]) cookies[pair[0]] = decodeURIComponent(pair[1] || '');
      }
    } catch (e) { /* ignore */ }
    return cookies;
  }

  function getReferrerSource() {
    if (!document.referrer) return null;
    try {
      var hostname = new URL(document.referrer).hostname.toLowerCase();
      for (var key in ORGANIC_DOMAINS) {
        if (hostname.indexOf(key) !== -1) {
          return ORGANIC_DOMAINS[key];
        }
      }
      // Unknown external referrer
      return hostname;
    } catch (e) {
      return null;
    }
  }

  function isInternalReferrer() {
    if (!document.referrer) return false;
    try {
      return new URL(document.referrer).hostname === window.location.hostname;
    } catch (e) { return false; }
  }

  function safeGetItem(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSetItem(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }

  // ── Attribution Capture ────────────────────────────────────────

  function captureAttribution() {
    var params = getUrlParams();
    var cookies = getCookies();
    var attr = {};

    // 1. Capture all click IDs from URL
    var hasClickId = false;
    for (var i = 0; i < CLICK_ID_PARAMS.length; i++) {
      var cid = CLICK_ID_PARAMS[i];
      if (params[cid]) {
        attr[cid] = params[cid];
        hasClickId = true;
      }
    }

    // 2. Capture UTM parameters from URL
    var hasUtm = false;
    for (var j = 0; j < UTM_PARAMS.length; j++) {
      var utm = UTM_PARAMS[j];
      if (params[utm]) {
        attr[utm] = params[utm];
        hasUtm = true;
      }
    }

    // 3. EDGE CASE: Click ID present WITHOUT UTMs → infer source/medium
    //    e.g. Google auto-tagging sends ?gclid=xxx but no utm_ params
    if (hasClickId && !hasUtm) {
      for (var ckey in CLICK_ID_MAP) {
        if (attr[ckey]) {
          var inferred = CLICK_ID_MAP[ckey];
          attr.utm_source = attr.utm_source || inferred.utm_source;
          attr.utm_medium = attr.utm_medium || inferred.utm_medium;
          attr._inferred = true; // flag that these were auto-derived
          break; // use the first matching click ID
        }
      }
    }

    // 4. Facebook cookie-based attribution (_fbc, _fbp)
    //    _fbc = click ID cookie (set when fbclid is in URL)
    //    _fbp = browser ID cookie (set by Meta Pixel, persists across visits)
    if (cookies._fbc) attr.fbc = cookies._fbc;
    if (cookies._fbp) attr.fbp = cookies._fbp;

    // If we have _fbc cookie but no fbclid in URL, we still know it's Facebook
    if (cookies._fbc && !attr.fbclid && !attr.utm_source) {
      attr.utm_source = 'facebook';
      attr.utm_medium = 'cpc';
      attr._inferred = true;
    }

    // 5. Organic / referrer-based attribution (only if no paid click IDs)
    if (!hasClickId && !hasUtm && !isInternalReferrer()) {
      var refSource = getReferrerSource();
      if (refSource) {
        attr.utm_source = refSource;
        attr.utm_medium = 'organic';
        attr._inferred = true;
      }
    }

    // 6. Always capture context
    attr.landing_page = window.location.href;
    attr.referrer = document.referrer || null;
    attr.timestamp = new Date().toISOString();

    return attr;
  }

  // ── Attribution Storage (Last-Touch with First-Touch Preservation) ──

  function getStoredAttribution() {
    var raw = safeGetItem(STORAGE_KEY);
    if (!raw) return {};
    try {
      var data = JSON.parse(raw);
      // Check expiry
      if (data._expires && data._expires < Date.now()) {
        safeSetItem(STORAGE_KEY, '');
        return {};
      }
      return data;
    } catch (e) { return {}; }
  }

  function getFirstTouch() {
    var raw = safeGetItem(TOUCH_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function isPaidAttribution(attr) {
    for (var i = 0; i < CLICK_ID_PARAMS.length; i++) {
      if (attr[CLICK_ID_PARAMS[i]]) return true;
    }
    return false;
  }

  function hasNewAttribution(attr) {
    for (var i = 0; i < CLICK_ID_PARAMS.length; i++) {
      if (attr[CLICK_ID_PARAMS[i]]) return true;
    }
    for (var j = 0; j < UTM_PARAMS.length; j++) {
      if (attr[UTM_PARAMS[j]]) return true;
    }
    if (attr.fbc) return true;
    return false;
  }

  function storeAttribution(newAttr) {
    var existing = getStoredAttribution();
    var isPaid = isPaidAttribution(newAttr);

    // Save first touch if we don't have one yet
    if (!getFirstTouch() && hasNewAttribution(newAttr)) {
      var firstTouch = {};
      for (var k in newAttr) {
        if (k[0] !== '_') firstTouch[k] = newAttr[k];
      }
      safeSetItem(TOUCH_KEY, JSON.stringify(firstTouch));
    }

    // Last-touch model: new paid ALWAYS overwrites; organic does NOT overwrite paid
    var merged = {};

    if (isPaid) {
      // Paid click: start fresh with new data
      for (var key in newAttr) merged[key] = newAttr[key];
    } else if (hasNewAttribution(newAttr)) {
      // Has UTMs but no click ID (e.g. email campaign, social organic)
      // Only overwrite if existing is NOT paid
      if (isPaidAttribution(existing)) {
        // Keep existing paid attribution, just update landing page
        for (var eKey in existing) merged[eKey] = existing[eKey];
        merged.landing_page = newAttr.landing_page;
        merged.referrer = newAttr.referrer;
        merged.timestamp = newAttr.timestamp;
      } else {
        for (var nKey in newAttr) merged[nKey] = newAttr[nKey];
      }
    } else {
      // No new attribution signals — keep existing, update context
      for (var xKey in existing) merged[xKey] = existing[xKey];
      merged.landing_page = newAttr.landing_page || existing.landing_page;
      merged.referrer = newAttr.referrer || existing.referrer;
      merged.timestamp = newAttr.timestamp || existing.timestamp;
    }

    // Set expiry
    merged._expires = Date.now() + PERSIST_TTL;

    safeSetItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  }

  // ── Server Communication ───────────────────────────────────────

  function sendToServer(data, event, phone) {
    var payload = {
      clientId: clientId,
      sessionId: getOrCreateSession()
    };

    // Copy attribution fields (skip internal flags)
    for (var key in data) {
      if (key[0] !== '_') payload[key] = data[key];
    }

    if (event) payload.event = event;
    if (phone) payload.phone = phone;

    var endpoint = apiBase + '/twilio/attribution';
    var body = JSON.stringify(payload);

    // sendBeacon requires a Blob with content type for JSON
    if (typeof navigator.sendBeacon === 'function') {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(endpoint, blob)) return;
      } catch (e) { /* fall through to fetch */ }
    }

    // Fallback to fetch
    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function() { /* silent */ });
    } catch (e) { /* silent */ }
  }

  // ── Phone Click Tracking ───────────────────────────────────────

  function setupPhoneClickTracking() {
    document.addEventListener('click', function(e) {
      var target = e.target;
      // Walk up DOM tree to catch clicks on children of <a> tags
      while (target && target !== document) {
        if (target.tagName === 'A' && target.href && target.href.indexOf('tel:') === 0) {
          var phone = target.href.replace('tel:', '').replace(/[^\d+]/g, '');
          sendToServer(getStoredAttribution(), 'phone_click', phone);
          return;
        }
        target = target.parentElement;
      }
    }, true); // capture phase to catch before any stopPropagation
  }

  // ── Form Submit Tracking ───────────────────────────────────────

  function setupFormTracking() {
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;

      // Check for action URL pointing to an external service (skip those)
      var action = form.getAttribute('action') || '';
      if (action && action.indexOf('http') === 0) {
        try {
          if (new URL(action).hostname !== window.location.hostname) return;
        } catch (err) { /* ignore */ }
      }

      // Track form submission event
      sendToServer(getStoredAttribution(), 'form_submit');
    }, true);
  }

  // ── Initialization ─────────────────────────────────────────────

  function init() {
    var newAttr = captureAttribution();
    var stored = storeAttribution(newAttr);

    // Always send a pageview with current attribution to keep sessions alive
    if (hasNewAttribution(stored)) {
      sendToServer(stored, 'pageview');
    }

    setupPhoneClickTracking();
    setupFormTracking();
  }

  // ── Public API ─────────────────────────────────────────────────

  window.AnchorTracking = {
    /** Get current (last-touch) attribution */
    getAttribution: function() {
      var data = getStoredAttribution();
      var clean = {};
      for (var k in data) { if (k[0] !== '_') clean[k] = data[k]; }
      return clean;
    },

    /** Get first-touch attribution (the original source) */
    getFirstTouch: function() {
      return getFirstTouch() || {};
    },

    /** Get current session ID */
    getSessionId: function() {
      return getOrCreateSession();
    },

    /** Get configured client ID */
    getClientId: function() {
      return clientId;
    },

    /** Manually fire a tracking event */
    track: function(event, extraData) {
      var attr = getStoredAttribution();
      if (extraData) {
        for (var k in extraData) attr[k] = extraData[k];
      }
      sendToServer(attr, event);
    },

    /** Get all data needed to submit with a form */
    getFormData: function() {
      return {
        sessionId: getOrCreateSession(),
        clientId: clientId,
        attribution: this.getAttribution(),
        firstTouch: this.getFirstTouch()
      };
    }
  };

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
