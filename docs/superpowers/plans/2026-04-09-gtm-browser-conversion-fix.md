# GTM Browser Conversion Provisioning Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tracking wizard correctly provision browser Google Ads conversion tags and Meta Pixel tags into GTM containers, so CTM form submissions fire valid browser-side conversion events without manual setup.

**Architecture:** The Google Ads API's `conversion_action.tag_snippets` field contains the real `conversionId` and `conversionLabel` needed for browser `gtag('event', 'conversion', { send_to: 'AW-XXX/YYY' })`. We extend `listConversionActions()` to return these values, save them when conversion mappings are configured, and wire them into the GTM provisioning template substitution. For Meta, we auto-set `browser_meta_pixel_enabled = true` when a pixel is selected.

**Tech Stack:** Express.js, google-ads-api v23 (GAQL), GTM API v2, React, MUI v5

---

## Current State & Root Cause

### Browser Google Ads (broken)
1. **Template is correct:** `standard_web_v1` has an `awct` tag with `{{google_ads_conversion_id}}` and `{{google_ads_conversion_label}}` placeholders
2. **Wizard never populates those fields:** AccountSelectionStep saves `google_ads_customer_id` (the account ID). ConversionEventsStep saves `conversion_mappings` (offline relay `conversion_action_id`). Neither writes `google_ads_conversion_id` or `google_ads_conversion_label`.
3. **Provisioner skips the tag:** `trackingProvisioning.js:319-325` filters out tags with empty required parameter values → the Google Ads tag gets dropped
4. **`conversionId` ≠ `customer_id`:** The browser `send_to` format `AW-{conversionId}/{conversionLabel}` uses values from the Google Ads tag snippet, NOT the account customer ID or offline conversion action ID

### Browser Meta Pixel (broken)
1. **Template is correct:** `standard_web_v1` has a conditional Meta Pixel PageView tag gated on `browser_meta_pixel_enabled`
2. **Wizard never sets the flag:** AccountSelectionStep saves `meta_pixel_id` but not `browser_meta_pixel_enabled`
3. **Provisioner filters it out:** `filterConditionalTags()` removes the Meta tag because the flag is falsy

### What works
- GA4 browser: provisioned correctly (measurement ID saved by wizard, template substitutes it)
- Server-side relay: GA4 MP, Meta CAPI, Google Ads offline conversions all work independently of GTM

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/services/analytics/googleAdsAdapter.js` | Modify | Add `tag_snippets` to GAQL query, parse `conversionId`/`conversionLabel` |
| `server/routes/tracking.js` | Modify | Save `google_ads_conversion_id`/`label` from conversion mappings; auto-set `browser_meta_pixel_enabled` |
| `server/services/trackingTemplates.js` | No change | `buildValuesMap` already reads the right fields — just need them populated |
| `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx` | Modify | Auto-set `browser_meta_pixel_enabled: true` when pixel selected |
| `src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx` | Modify | Save `conversionId`/`conversionLabel` alongside relay mappings |
| `src/api/tracking.js` | No change | `saveConversionMappings` already passes arbitrary data |

---

## Task 1: Extend listConversionActions to return tag snippet values

**Files:**
- Modify: `server/services/analytics/googleAdsAdapter.js:164-185`

The Google Ads API `conversion_action.tag_snippets` field contains an array of `TagSnippet` objects. Each has an `event_snippet` string containing `gtag('event', 'conversion', {'send_to': 'AW-XXX/YYY'})`. We parse the `send_to` to extract `conversionId` and `conversionLabel`.

- [ ] **Step 1: Add tag_snippets to GAQL query and parse the values**

Replace `listConversionActions` in `server/services/analytics/googleAdsAdapter.js`:

```js
export async function listConversionActions(customerId) {
  if (!DEVELOPER_TOKEN || !REFRESH_TOKEN) return [];

  const cleanId = customerId.replace(/-/g, '');
  const customer = getCustomer(cleanId);
  const results = await customer.query(`
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.type,
      conversion_action.status,
      conversion_action.tag_snippets
    FROM conversion_action
    WHERE conversion_action.status = 'ENABLED'
  `);

  return results.map((r) => {
    // Parse conversionId and conversionLabel from tag_snippets event_snippet
    // The send_to format is: AW-{conversionId}/{conversionLabel}
    let conversionId = '';
    let conversionLabel = '';
    const snippets = r.conversion_action.tag_snippets || [];
    for (const snippet of snippets) {
      if (snippet.event_snippet) {
        const match = snippet.event_snippet.match(/send_to['":\s]+['"]AW-([^/'"]+)\/([^'"]+)['"]/);
        if (match) {
          conversionId = match[1];
          conversionLabel = match[2];
          break;
        }
      }
    }

    return {
      id: String(r.conversion_action.id),
      name: r.conversion_action.name || '',
      type: r.conversion_action.type || '',
      status: r.conversion_action.status || '',
      conversionId,
      conversionLabel,
    };
  });
}
```

Note: If `tag_snippets` is not available in the API version used by `google-ads-api@23`, the fields will be empty strings and the rest of the code degrades gracefully (no browser tag provisioned, same as today).

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/services/analytics/googleAdsAdapter.js
git commit -m "feat(tracking): parse conversionId/Label from Google Ads tag_snippets

listConversionActions now queries conversion_action.tag_snippets and
extracts the AW-{conversionId}/{conversionLabel} values needed for
browser-side GTM conversion tags."
```

---

## Task 2: Save browser conversion IDs when saving relay mappings

**Files:**
- Modify: `src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx:112-125`
- Modify: `server/routes/tracking.js` (conversion-mappings PUT handler)

When the user saves conversion mappings, we also look at the `lead_submitted` mapping's `conversionId`/`conversionLabel` and persist them to `tracking_configs.google_ads_conversion_id` and `tracking_configs.google_ads_conversion_label`. These are the values the GTM template needs.

- [ ] **Step 1: Include conversionId/Label in the mapping data sent from frontend**

In `ConversionEventsStep.jsx`, modify `handleSave` (around line 112) to include the tag snippet values:

```js
  const handleSave = async () => {
    setSaving(true);
    try {
      const mappings = {};
      RELAY_EVENTS.forEach((event) => {
        const actionId = relayMappings[event.key];
        if (!actionId) return;
        const action = actions.find((a) => String(a.id) === actionId);
        mappings[event.key] = {
          conversion_action_id: actionId,
          name: action?.name || '',
          conversionId: action?.conversionId || '',
          conversionLabel: action?.conversionLabel || '',
        };
      });

      const usedActionIds = Object.values(mappings).map((m) => m.conversion_action_id);
      const duplicates = usedActionIds.filter((id, i) => usedActionIds.indexOf(id) !== i);
      if (duplicates.length > 0) {
        const dupName = actions.find((a) => String(a.id) === duplicates[0])?.name || duplicates[0];
        showToast(`"${dupName}" is mapped to multiple relay events. Each Google Ads action can only be used once.`, 'error');
        setSaving(false);
        return;
      }

      await saveConversionMappings(config.id, mappings);
      await onReload();
      showToast('Relay mappings saved', 'success');
      onNext();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save mappings'), 'error');
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 2: Backend: extract browser conversion IDs from the lead_submitted mapping and save to tracking_configs**

In `server/routes/tracking.js`, find the `PUT /:id/conversion-mappings` handler. After saving `conversion_mappings`, also update `google_ads_conversion_id` and `google_ads_conversion_label` from the lead_submitted (or form_submitted) mapping:

```js
// After: await query(`UPDATE tracking_configs SET conversion_mappings = $1 ...`)
// Add:
const leadMapping = mappings?.lead_submitted || mappings?.form_submitted;
if (leadMapping?.conversionId && leadMapping?.conversionLabel) {
  await query(
    `UPDATE tracking_configs
     SET google_ads_conversion_id = $1, google_ads_conversion_label = $2, updated_at = NOW()
     WHERE id = $3`,
    [leadMapping.conversionId, leadMapping.conversionLabel, req.params.id]
  );
}
```

Find the exact location by searching for `conversion-mappings` in tracking.js.

- [ ] **Step 3: Verify build**

```bash
yarn build
```

- [ ] **Step 4: Commit**

```bash
git add src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx server/routes/tracking.js
git commit -m "feat(tracking): save browser conversion IDs from tag_snippets

When saving conversion mappings, the lead_submitted mapping's
conversionId and conversionLabel are extracted and saved to
tracking_configs.google_ads_conversion_id/label. These are the
values the GTM template needs to provision a working Google Ads
conversion tag."
```

---

## Task 3: Auto-enable browser Meta Pixel when pixel is selected

**Files:**
- Modify: `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx:107-136`

When the user selects a Meta pixel in the Accounts step, include `browser_meta_pixel_enabled: true` in the saved config. The GTM template's Meta Pixel PageView tag is conditional on this flag.

- [ ] **Step 1: Add browser_meta_pixel_enabled to the saved fields**

In `AccountSelectionStep.jsx`, modify `handleNext` (line 107). Change the `fields` object:

```js
  const handleNext = async () => {
    setSaving(true);
    try {
      const fields = {
        ga4_property_id: selectedGa4?.propertyId || null,
        ga4_measurement_id: selectedGa4?.measurementId || config?.ga4_measurement_id || null,
        google_ads_customer_id: selectedAds ? formatGoogleAdsId(selectedAds.id) : null,
        meta_ad_account_id: selectedMeta?.id || null,
        meta_pixel_id: selectedPixel?.id || null,
        // Auto-enable browser Meta Pixel when a pixel is selected
        // (the GTM template gates the Meta PageView tag on this flag)
        browser_meta_pixel_enabled: !!selectedPixel,
      };

      const saved = await saveConfig(fields);
      // ... rest unchanged
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx
git commit -m "feat(tracking): auto-enable browser Meta Pixel when pixel selected

Sets browser_meta_pixel_enabled = true when a Meta pixel is chosen
in the Accounts step. This unblocks the conditional Meta Pixel
PageView tag in the GTM template during provisioning."
```

---

## Task 4: Wire browser send_to into CTM form embed defaults

**Files:**
- Modify: `server/routes/ctmForms.js` (embed GET handler, around line 278)

Now that `google_ads_conversion_id` and `google_ads_conversion_label` are populated, the embed endpoint can derive a valid browser `gads_conversion` value.

- [ ] **Step 1: Re-add gads_conversion derivation using the correct fields**

In `server/routes/ctmForms.js`, modify the tracking-derived defaults section (currently around line 278):

```js
    // Auto-derive analytics defaults from tracking_configs
    let trackingDerivedDefaults = {};
    try {
      const { rows: tc } = await query(
        `SELECT ga4_measurement_id, meta_pixel_id, google_ads_conversion_id,
                google_ads_conversion_label, client_type
         FROM tracking_configs WHERE user_id = $1`,
        [form.org_id]
      );
      if (tc[0]) {
        const t = tc[0];
        if (t.ga4_measurement_id) trackingDerivedDefaults.ga4_event = 'generate_lead';
        if (t.meta_pixel_id && t.client_type !== 'medical') trackingDerivedDefaults.fb_event = 'Lead';
        // Browser Google Ads conversion: AW-{conversionId}/{conversionLabel}
        // These come from the Google Ads tag snippet, saved during ConversionEventsStep
        if (t.google_ads_conversion_id && t.google_ads_conversion_label) {
          trackingDerivedDefaults.gads_conversion = `AW-${t.google_ads_conversion_id}/${t.google_ads_conversion_label}`;
        }
      }
    } catch {}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/ctmForms.js
git commit -m "feat(forms): derive browser gads_conversion from correct tag snippet values

Uses google_ads_conversion_id and google_ads_conversion_label (from
the Google Ads tag snippet, saved during tracking wizard setup) to
build a valid AW-{conversionId}/{conversionLabel} send_to value
for browser-side form conversion tracking."
```

---

## Task 5: Verify end-to-end

- [ ] **Step 1: Test tag_snippets parsing**

Start the dev server and query a known Google Ads account's conversion actions. Verify `conversionId` and `conversionLabel` are populated in the response.

```bash
# In browser devtools or via curl against localhost:4000
# GET /api/hub/tracking/accounts/google-ads/{customerId}/conversions
# Each action should now include conversionId and conversionLabel fields
```

- [ ] **Step 2: Test wizard flow**

1. Open a test client's tracking config in the admin hub
2. Go through the Accounts step — select a Google Ads account + Meta pixel
3. Verify `browser_meta_pixel_enabled` is saved (check network tab for the PUT payload)
4. Go to Conversion Events step — map a "Form Submitted" action
5. Save — verify `google_ads_conversion_id` and `google_ads_conversion_label` are now set on the tracking config
6. Go to Install & Status — reprovision the GTM container
7. Open GTM and verify:
   - Google Ads conversion tag exists with correct `conversionId` and `conversionLabel`
   - Meta Pixel PageView tag exists (was previously filtered out)

- [ ] **Step 3: Test form embed**

1. Load a published CTM form embed endpoint: `GET /api/ctm-forms/embed/:token`
2. Verify the `analytics` object in the response has:
   - `ga4_event: 'generate_lead'`
   - `fb_event: 'Lead'` (non-medical)
   - `gads_conversion: 'AW-{conversionId}/{conversionLabel}'` (valid format)

- [ ] **Step 4: Test fallback when tag_snippets unavailable**

If the Google Ads API doesn't return `tag_snippets` for some actions:
- `conversionId` and `conversionLabel` will be empty strings
- The mapping save won't update `google_ads_conversion_id`/`label` on tracking_configs
- The GTM provisioner will skip the Google Ads tag (same as today — graceful degradation)
- Server-side relay continues to work via `conversion_action_id`

---

## Design Decisions

1. **tag_snippets is the source of truth for browser conversion IDs.** The `conversionId` in `AW-{conversionId}/{conversionLabel}` is NOT the same as `google_ads_customer_id`. It's a different identifier embedded in the Google Ads tag snippet. The only reliable way to get it is from `conversion_action.tag_snippets`.

2. **Save to the existing legacy fields.** `tracking_configs` already has `google_ads_conversion_id` and `google_ads_conversion_label` columns, and `buildValuesMap()` already reads them for template substitution. We just need to populate them.

3. **Derive from lead_submitted mapping.** The "Form Submitted" relay event is the most relevant conversion action for form-triggered browser tracking. We use its tag snippet values as the default browser conversion.

4. **Graceful degradation.** If `tag_snippets` returns empty (API version limitations), everything works exactly as it does today — no browser conversion tag provisioned, server-side relay handles Google Ads. No regression.

5. **Meta fix is trivial.** Just setting `browser_meta_pixel_enabled: true` when a pixel is selected. The template, provisioner, and substitution all already work — just needed the flag.
