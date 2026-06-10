# Unified Forms + Tracking Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a client has tracking configured (GA4, Meta, Google Ads), all their forms auto-inherit the right analytics events without additional setup. Per-form overrides use smart dropdowns populated from the client's actual tracking config. Server-side relay handles Google Ads offline conversions — the primary path for Google Ads.

**Architecture:** The embed endpoint gains a new trickle-down layer that reads `tracking_configs` to auto-derive analytics defaults. CTM form submissions gain server-side relay (GA4 MP, Meta CAPI, Google Ads offline conversions) matching what standard forms already do. The per-form analytics UI in BuilderPane replaces plain text fields with smart selects showing what's configured and available. The Google Ads default conversion action for forms is chosen during TrackingWizard setup via the existing ConversionEventsStep (the `form_submitted` mapping in `conversion_mappings`).

**Tech Stack:** Express.js, PostgreSQL, google-ads-api v23, React, MUI v5

---

## Current State

### Two systems, partially connected

**Tracking** (`tracking_configs` table, one row per client):
- GA4: `ga4_measurement_id`, `ga4_api_secret` (encrypted)
- Meta: `meta_pixel_id`, `meta_capi_token` (encrypted)
- Google Ads: `google_ads_customer_id`, `conversion_mappings` JSONB
- `relay_enabled` controls server-side event relay
- `conversion_mappings` format: `{ form_submitted: { conversion_action_id: '123', name: 'Form Submission' } }`
- ConversionEventsStep already has `autoMatch()` that regex-matches `/lead|form|submit/` → `form_submitted`

**Forms** (`ctm_forms` table):
- `analytics_override` (bool) + `analytics_json` JSONB per form
- `client_profiles.analytics_defaults` JSONB per client
- Trickle-down: system defaults → client defaults → per-form overrides
- Browser-side: `ctm-forms.js` fires `gtag()`, `fbq()`, `gtag('event','conversion',{send_to})` using resolved analytics config
- **Gap**: CTM forms do NOT call `sendTrackingEvent()` for server-side relay (standard forms do)

### Analytics resolution (embed endpoint, `ctmForms.js:192-198`)
```js
const SYSTEM_ANALYTICS_DEFAULTS = { ga4_event: 'form_submit' };
const resolvedAnalytics = form.analytics_override
  ? (form.analytics_json || {})
  : { ...SYSTEM_ANALYTICS_DEFAULTS, ...clientAnalyticsDefaults, ...(form.analytics_json || {}) };
```

### Per-form analytics UI (BuilderPane.jsx:848-885)
Currently plain text fields for: `ga4_event`, `gads_conversion`, `fb_event`, `tiktok_event`, `bing_event`. No dropdowns, no inherited-from-account indicators.

### Browser-side event firing (ctm-forms.js:435-477)
- GA4: `gtag('event', a.ga4_event, a.ga4_params || {})`
- Google Ads: `gtag('event', 'conversion', { send_to: a.gads_conversion })`
- Meta: `fbq('track', a.fb_event, a.fb_params || {})`
- TikTok: `ttq.track(a.tiktok_event)`
- Bing: `uetq.push('event', a.bing_event)`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/routes/ctmForms.js` | Modify | Add tracking_configs lookup to embed endpoint; add server-side relay to submission handler |
| `server/routes/tracking.js` | Modify | Add `GET .../form-analytics-context/:userId` endpoint |
| `src/api/tracking.js` | Modify | Add `getFormAnalyticsContext(userId)` API function |
| `src/views/ctm-forms/BuilderPane.jsx` | Modify | Replace plain text analytics fields with smart selects showing account status + conversion action dropdown |

---

## Task 1: Auto-derive analytics defaults from tracking_configs

**Files:**
- Modify: `server/routes/ctmForms.js:168-229` (embed GET endpoint)

The embed endpoint currently fetches `client_profiles` for `analytics_defaults`. We add a parallel fetch of `tracking_configs` to auto-derive analytics defaults based on what's configured. The `conversion_mappings.form_submitted` entry (set during tracking setup) provides the default Google Ads conversion action for forms.

- [ ] **Step 1: Add tracking_configs query to embed GET handler**

In `server/routes/ctmForms.js`, modify the embed GET handler (line ~180) to also fetch tracking_configs:

```js
// After the existing client_profiles query (line 183-190), add:
let trackingDerivedDefaults = {};
try {
  const { rows: tc } = await query(
    `SELECT ga4_measurement_id, meta_pixel_id, google_ads_customer_id, conversion_mappings,
            client_type
     FROM tracking_configs WHERE user_id = $1`,
    [form.org_id]
  );
  if (tc[0]) {
    const t = tc[0];
    if (t.ga4_measurement_id) trackingDerivedDefaults.ga4_event = 'generate_lead';
    if (t.meta_pixel_id && t.client_type !== 'medical') trackingDerivedDefaults.fb_event = 'Lead';
    // Google Ads: form_submitted mapping is set during tracking setup (ConversionEventsStep)
    const formMapping = t.conversion_mappings?.form_submitted;
    if (formMapping?.conversion_action_id && t.google_ads_customer_id) {
      // Construct AW-CUSTOMER_ID/ACTION_ID for browser-side gtag
      trackingDerivedDefaults.gads_conversion = `AW-${t.google_ads_customer_id}/${formMapping.conversion_action_id}`;
    }
  }
} catch (_) {}
```

- [ ] **Step 2: Insert tracking layer into trickle-down resolution**

Replace the existing trickle-down logic (lines 192-198) with:

```js
// Trickle-down: system → tracking-derived → client defaults → form-level (last wins)
const SYSTEM_ANALYTICS_DEFAULTS = { ga4_event: 'form_submit' };
const resolvedAnalytics = form.analytics_override
  ? (form.analytics_json || {})
  : { ...SYSTEM_ANALYTICS_DEFAULTS, ...trackingDerivedDefaults, ...clientAnalyticsDefaults, ...(form.analytics_json || {}) };
```

- [ ] **Step 3: Verify build**

```bash
yarn build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/ctmForms.js
git commit -m "feat(forms): auto-derive analytics defaults from tracking_configs

Forms now inherit GA4/Meta/Google Ads event config from the client's
tracking setup. New trickle-down order:
system → tracking_configs → client_profiles → per-form override.
Google Ads default comes from conversion_mappings.form_submitted
set during tracking wizard setup."
```

---

## Task 2: Add server-side relay to CTM form submissions

**Files:**
- Modify: `server/routes/ctmForms.js:232-420` (embed POST endpoint)

Standard forms (`server/services/forms.js:622-630`) already call `sendTrackingEvent()` after submission. CTM forms do not. This adds the same server-side relay for GA4 Measurement Protocol, Meta CAPI, and Google Ads offline conversions. This is the primary path for Google Ads conversions — it uses the conversion_action_id from `conversion_mappings` via the Google Ads API, so it works regardless of browser-side GTM.

- [ ] **Step 1: Import sendEvent at the top of ctmForms.js**

Add this import near the top of `server/routes/ctmForms.js`, alongside the existing imports:

```js
import { sendEvent as sendTrackingEvent } from '../services/trackingRelay.js';
```

- [ ] **Step 2: Add relay call after successful submission storage**

In the embed POST handler, after the email notification block (around line 413, before `res.json({ success: true, submissionId })`), add:

```js
// Server-side tracking relay (GA4 MP, Meta CAPI, Google Ads offline conversions)
// Non-blocking — errors logged by trackingRelay, don't fail the submission
sendTrackingEvent(form.org_id, 'lead_submitted', 'ctm_form_submission', submissionId, {
  event_source_url: attribution.referrer || '',
  value: 1,
  currency: 'USD',
  email: core.email,
  phone: core.phone_number,
  first_name: core.caller_name
}).catch(err => {
  console.error('[ctmForms:submit] Tracking relay failed:', err.message);
});
```

- [ ] **Step 3: Verify build**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/ctmForms.js
git commit -m "feat(forms): add server-side tracking relay to CTM form submissions

CTM form submissions now trigger GA4 Measurement Protocol, Meta CAPI,
and Google Ads offline conversions via trackingRelay, matching what
standard forms already do. Google Ads conversions use the
conversion_action_id from conversion_mappings."
```

---

## Task 3: Add form analytics context endpoint

**Files:**
- Modify: `server/routes/tracking.js` (add new endpoint)
- Modify: `src/api/tracking.js` (add API function)

The BuilderPane needs to know what's configured at the account level to show smart dropdowns. This endpoint returns the tracking config summary and available conversion actions for the per-form override UI.

- [ ] **Step 1: Add GET endpoint to tracking.js**

In `server/routes/tracking.js`, add a new endpoint (after the existing config endpoints). Make sure `listConversionActions` is imported at the top from `../services/analytics/googleAdsAdapter.js`:

```js
// GET /api/hub/tracking/form-analytics-context/:userId
// Returns tracking config summary + available conversion actions for form builder UI
router.get('/form-analytics-context/:userId', requireAuth, isAdminOrEditor, async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch tracking config
    const { rows: tc } = await query(
      `SELECT ga4_measurement_id, meta_pixel_id, google_ads_customer_id,
              conversion_mappings, client_type, relay_enabled
       FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const config = tc[0] || null;

    // Fetch available Google Ads conversion actions if account is linked
    let conversionActions = [];
    if (config?.google_ads_customer_id) {
      try {
        conversionActions = await listConversionActions(config.google_ads_customer_id);
      } catch (err) {
        console.error('[tracking:form-analytics-context] Failed to load conversions:', err.message);
      }
    }

    // Build response
    const formSubmittedMapping = config?.conversion_mappings?.form_submitted || null;

    res.json({
      configured: {
        ga4: !!config?.ga4_measurement_id,
        meta: !!config?.meta_pixel_id,
        googleAds: !!config?.google_ads_customer_id,
        relay: !!config?.relay_enabled,
        clientType: config?.client_type || null,
      },
      defaults: {
        ga4_event: config?.ga4_measurement_id ? 'generate_lead' : null,
        fb_event: config?.meta_pixel_id && config?.client_type !== 'medical' ? 'Lead' : null,
        gads_conversion_action: formSubmittedMapping || null,
      },
      conversionActions,
      conversionMappings: config?.conversion_mappings || {},
    });
  } catch (err) {
    console.error('[tracking:form-analytics-context]', err.message);
    res.status(500).json({ error: 'Failed to load analytics context' });
  }
});
```

- [ ] **Step 2: Add frontend API function**

In `src/api/tracking.js`, add:

```js
export function getFormAnalyticsContext(userId) {
  return client.get(`/hub/tracking/form-analytics-context/${userId}`).then((res) => res.data);
}
```

- [ ] **Step 3: Verify build**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/tracking.js src/api/tracking.js
git commit -m "feat(tracking): add form analytics context endpoint

New GET /hub/tracking/form-analytics-context/:userId returns tracking
config summary, default event mappings, and available Google Ads
conversion actions for the form builder analytics UI."
```

---

## Task 4: Upgrade per-form analytics UI in BuilderPane

**Files:**
- Modify: `src/views/ctm-forms/BuilderPane.jsx:848-885`

Replace the plain text analytics fields with smart selects that show account tracking status, inherited defaults, and dropdowns populated from the client's tracking config. Google Ads shows the same conversion actions dropdown used in TrackingWizard's ConversionEventsStep.

- [ ] **Step 1: Add state and data fetching for analytics context**

Near the top of the `BuilderPane` component (where other state/effects are defined), add:

```js
import { getFormAnalyticsContext } from 'api/tracking';
```

Inside the component, add state:

```js
const [analyticsCtx, setAnalyticsCtx] = useState(null);
const [analyticsCtxLoading, setAnalyticsCtxLoading] = useState(false);
```

Derive `clientId` from the selected form's `org_id`:

```js
const selectedFormOrgId = forms.find(f => f.id === selectedFormId)?.org_id;
```

Add a useEffect to fetch context when the analytics tab is opened:

```js
useEffect(() => {
  if (sidebarTab === 'analytics' && selectedFormOrgId && !analyticsCtx) {
    setAnalyticsCtxLoading(true);
    getFormAnalyticsContext(selectedFormOrgId)
      .then(setAnalyticsCtx)
      .catch(() => {})
      .finally(() => setAnalyticsCtxLoading(false));
  }
}, [sidebarTab, selectedFormOrgId, analyticsCtx]);
```

- [ ] **Step 2: Replace the analytics tab content**

Replace the analytics tab content (lines 848-885) with:

```jsx
sidebarTab === 'analytics' ? (() => {
  const af = forms.find(f => f.id === selectedFormId) || {};
  const a = af.analytics_json || {};
  const ctx = analyticsCtx;
  const debouncedSaveRef = useRef(null);
  const saveAnalytics = (patch) => {
    const merged = { ...a, ...patch };
    updateCtmForm(selectedFormId, { analytics_json: merged })
      .then(f => setForms(prev => prev.map(x => x.id === selectedFormId ? { ...x, ...f } : x)))
      .catch(err => showToast(getErrorMessage(err), 'error'));
  };
  const debouncedSave = (patch) => {
    clearTimeout(debouncedSaveRef.current);
    debouncedSaveRef.current = setTimeout(() => saveAnalytics(patch), 800);
  };

  // Standard event options for autocomplete
  const GA4_EVENTS = ['generate_lead', 'form_submit', 'sign_up', 'purchase', 'contact', 'submit_lead_form', 'request_quote', 'book_appointment'];
  const META_EVENTS = ['Lead', 'Contact', 'SubmitApplication', 'Schedule', 'CompleteRegistration', 'Purchase', 'Subscribe', 'StartTrial'];

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Analytics</Typography>

      {/* Account tracking status */}
      {analyticsCtxLoading ? (
        <Typography variant="caption" color="text.secondary">Loading account config...</Typography>
      ) : ctx ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
          <Chip size="small" label="GA4" color={ctx.configured.ga4 ? 'success' : 'default'} variant={ctx.configured.ga4 ? 'filled' : 'outlined'} />
          <Chip size="small" label="Meta" color={ctx.configured.meta ? 'success' : 'default'} variant={ctx.configured.meta ? 'filled' : 'outlined'} />
          <Chip size="small" label="Google Ads" color={ctx.configured.googleAds ? 'success' : 'default'} variant={ctx.configured.googleAds ? 'filled' : 'outlined'} />
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
        control={<Switch checked={!!af.analytics_override} onChange={e => updateCtmForm(selectedFormId, { analytics_override: e.target.checked }).then(f => setForms(prev => prev.map(x => x.id === selectedFormId ? { ...x, ...f } : x))).catch(() => {})} size="small" />}
        label="Override all account defaults for this form"
      />
      <Divider />

      {/* GA4 */}
      <Typography variant="caption" fontWeight={600}>
        Google Analytics 4
        {!a.ga4_event && ctx?.defaults?.ga4_event && (
          <Typography component="span" variant="caption" color="text.secondary"> — inherits: {ctx.defaults.ga4_event}</Typography>
        )}
      </Typography>
      <Autocomplete
        freeSolo
        size="small"
        options={GA4_EVENTS}
        value={a.ga4_event || ''}
        onInputChange={(_, val) => debouncedSave({ ga4_event: val || undefined })}
        renderInput={(params) => <TextField {...params} label="GA4 Event Name" placeholder={ctx?.defaults?.ga4_event || 'generate_lead'} helperText="Fires gtag('event', ...)" />}
      />
      <Divider />

      {/* Google Ads — dropdown of available conversion actions */}
      <Typography variant="caption" fontWeight={600}>
        Google Ads
        {!a.gads_conversion_action_id && ctx?.defaults?.gads_conversion_action && (
          <Typography component="span" variant="caption" color="text.secondary"> — inherits: {ctx.defaults.gads_conversion_action.name}</Typography>
        )}
      </Typography>
      {ctx?.conversionActions?.length > 0 ? (
        <Autocomplete
          size="small"
          options={ctx.conversionActions}
          getOptionLabel={(opt) => typeof opt === 'string' ? opt : `${opt.name} (${opt.type})`}
          value={ctx.conversionActions.find(ca => ca.id === a.gads_conversion_action_id) || null}
          onChange={(_, val) => saveAnalytics({
            gads_conversion_action_id: val?.id || undefined,
            gads_conversion_action_name: val?.name || undefined,
          })}
          isOptionEqualToValue={(opt, val) => opt.id === val?.id}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Conversion Action"
              placeholder={ctx?.defaults?.gads_conversion_action?.name || 'Select conversion action'}
              helperText="Server-side relay uses this for offline conversion uploads"
            />
          )}
        />
      ) : (
        <TextField
          label="Conversion (send_to)"
          value={a.gads_conversion || ''}
          onChange={e => saveAnalytics({ gads_conversion: e.target.value || undefined })}
          size="small" fullWidth
          placeholder="AW-XXXXXXXXX/LABEL"
          helperText={ctx?.configured?.googleAds
            ? 'No conversion actions found — enter send_to manually'
            : 'No Google Ads account linked — set up tracking first, or enter send_to manually'}
        />
      )}
      <Divider />

      {/* Meta / Facebook */}
      <Typography variant="caption" fontWeight={600}>
        Facebook / Meta
        {!a.fb_event && ctx?.defaults?.fb_event && (
          <Typography component="span" variant="caption" color="text.secondary"> — inherits: {ctx.defaults.fb_event}</Typography>
        )}
      </Typography>
      <Autocomplete
        freeSolo
        size="small"
        options={META_EVENTS}
        value={a.fb_event || ''}
        onInputChange={(_, val) => debouncedSave({ fb_event: val || undefined })}
        renderInput={(params) => <TextField {...params} label="FB Event Name" placeholder={ctx?.defaults?.fb_event || 'Lead'} helperText="Fires fbq('track', ...)" />}
      />
      <Divider />

      {/* TikTok */}
      <Typography variant="caption" fontWeight={600}>TikTok</Typography>
      <TextField label="TikTok Event Name" value={a.tiktok_event || ''} onChange={e => saveAnalytics({ tiktok_event: e.target.value || undefined })} size="small" fullWidth placeholder="SubmitForm" />
      <Divider />

      {/* Bing */}
      <Typography variant="caption" fontWeight={600}>Bing / Microsoft Ads</Typography>
      <TextField label="Bing Event Name" value={a.bing_event || ''} onChange={e => saveAnalytics({ bing_event: e.target.value || undefined })} size="small" fullWidth placeholder="submit" />
    </Stack>
  );
})()
```

Note: Ensure `Autocomplete` and `Chip` are imported from MUI at the top of the file. `Autocomplete` may need to be added: `import { Autocomplete } from '@mui/material';`

- [ ] **Step 3: Verify build**

```bash
yarn build
```

- [ ] **Step 4: Visual check**

```bash
yarn start
```
1. Open a CTM form in the builder
2. Click the Analytics tab in the sidebar
3. Verify: account tracking status chips appear (green for configured, default for not)
4. Verify: GA4 field shows autocomplete with standard events
5. Verify: Google Ads shows dropdown of conversion actions (if Google Ads is configured for the client)
6. Verify: Meta shows autocomplete with standard events
7. Verify: "inherits: ..." text appears when field is empty and account has defaults
8. Verify: Override switch still works

- [ ] **Step 5: Commit**

```bash
git add src/views/ctm-forms/BuilderPane.jsx
git commit -m "feat(forms): smart analytics UI with account tracking status

Replaces plain text analytics fields with Autocomplete dropdowns
showing standard events. Shows account tracking status chips.
Google Ads shows available conversion actions from the client's
account (same list as ConversionEventsStep in TrackingWizard).
Empty fields show inherited default from tracking config."
```

---

## Task 5: Wire per-form Google Ads override into server-side relay

**Files:**
- Modify: `server/routes/ctmForms.js` (embed POST handler)

When a form has a per-form `gads_conversion_action_id` override in its `analytics_json`, the server-side relay should use that conversion action instead of the account-level `form_submitted` mapping.

- [ ] **Step 1: Pass per-form conversion override to relay**

In the embed POST handler, after the `sendTrackingEvent` call added in Task 2, modify it to include the per-form override:

```js
// Resolve per-form Google Ads conversion override if set
const formAnalytics = form.analytics_json || {};
const perFormGadsOverride = formAnalytics.gads_conversion_action_id || null;

// Server-side tracking relay (GA4 MP, Meta CAPI, Google Ads offline conversions)
sendTrackingEvent(form.org_id, 'lead_submitted', 'ctm_form_submission', submissionId, {
  event_source_url: attribution.referrer || '',
  value: 1,
  currency: 'USD',
  email: core.email,
  phone: core.phone_number,
  first_name: core.caller_name,
  _gads_override_action_id: perFormGadsOverride,
}).catch(err => {
  console.error('[ctmForms:submit] Tracking relay failed:', err.message);
});
```

- [ ] **Step 2: Handle override in trackingRelay.js sendToGoogleAds**

In `server/services/trackingRelay.js`, modify `sendToGoogleAds()` (line 219) to check for the override:

```js
async function sendToGoogleAds(config, eventName, scrubbed) {
  if (!config.conversion_mappings || !config.google_ads_customer_id) return;

  // Per-form override takes precedence over account-level mapping
  const overrideActionId = scrubbed._gads_override_action_id;
  const mapping = overrideActionId
    ? { conversion_action_id: overrideActionId }
    : config.conversion_mappings[eventName];
  if (!mapping?.conversion_action_id) return;

  // ... rest of function unchanged
```

- [ ] **Step 3: Verify build**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/ctmForms.js server/services/trackingRelay.js
git commit -m "feat(forms): per-form Google Ads conversion override in server relay

When a form has gads_conversion_action_id in its analytics_json,
the server-side relay uses that conversion action instead of the
account-level form_submitted mapping."
```

---

## Task 6: Verify end-to-end

- [ ] **Step 1: Test auto-inherit (no per-form config)**

1. Ensure a test client has tracking configured (GA4 + Meta + Google Ads with form_submitted mapping)
2. Create a new CTM form for that client, publish it
3. Open the form embed URL in browser
4. Check the response from `GET /api/ctm-forms/embed/:token` — verify `analytics` object has:
   - `ga4_event: 'generate_lead'` (from tracking_configs)
   - `fb_event: 'Lead'` (from tracking_configs)
   - `gads_conversion` value derived from conversion_mappings.form_submitted

- [ ] **Step 2: Test per-form override**

1. Open the form builder → Analytics tab
2. Set GA4 event to `purchase` (overriding the default `generate_lead`)
3. Select a different Google Ads conversion action from the dropdown
4. Reload the embed endpoint — verify `ga4_event` is now `purchase` and Google Ads conversion changed
5. Toggle "Override all account defaults" — verify only the form's own values are returned

- [ ] **Step 3: Test server-side relay**

1. Submit a test form (use "Anchor Corps" passphrase to bypass spam/dupe)
2. Check `tracking_event_log` table for new entries with `source_type = 'ctm_form_submission'`
3. Verify GA4 MP, Meta CAPI, and/or Google Ads entries appear (depending on what's configured + relay_enabled)

- [ ] **Step 4: Test no tracking configured**

1. Create a form for a client with NO tracking config
2. Open the builder Analytics tab — verify "No tracking configured" message appears
3. Verify the form still works with system default (`ga4_event: 'form_submit'`)

---

## Design Decisions

1. **Auto-inherit, not auto-setup**: Forms read `tracking_configs` at embed time. No new DB columns, no sync jobs. The `tracking_configs` table is the single source of truth.

2. **Server-side relay is the primary path for Google Ads**: The server-side relay via `sendTrackingEvent()` → `sendToGoogleAds()` uses the Google Ads API for offline conversions with the `conversion_action_id` from `conversion_mappings`. This always works if tracking is configured — no dependency on GTM being installed on the embed page. Browser-side `gads_conversion` is supplementary.

3. **Default form conversion chosen during tracking setup**: The `form_submitted` entry in `conversion_mappings` (set via ConversionEventsStep's `autoMatch()` regex or manual selection) IS the default Google Ads conversion action for forms. No additional setup needed.

4. **Per-form override uses same dropdown**: The BuilderPane Google Ads override shows the same list of conversion actions that ConversionEventsStep shows, loaded via `listConversionActions()`. This stores `gads_conversion_action_id` in the form's `analytics_json`, which is passed to the server-side relay as an override.

5. **No new DB migrations**: `conversion_mappings` is JSONB, `analytics_json` is JSONB — no schema changes needed.

6. **Trickle-down order**: system → tracking_configs → client_profiles.analytics_defaults → per-form analytics_json. This means tracking config automatically provides sensible defaults for all platforms, but any layer can override.
