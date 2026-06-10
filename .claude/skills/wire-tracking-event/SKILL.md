---
name: wire-tracking-event
description: Use when adding a new server-side conversion tracking event to the Anchor Client Dashboard relay (GA4 Measurement Protocol, Meta CAPI, Google Ads offline conversions). Covers hook points, the medical/non-medical HIPAA gate, and per-form override patterns.
---

# Wire a New Server-Side Tracking Event

## Overview

The tracking relay (`server/services/trackingRelay.js`) fires conversion events to GA4 MP, Meta CAPI, and Google Ads. It is called from three existing hook points. Adding a new event = deciding where in the request lifecycle to call `sendEvent()`.

## Existing hook points

| File | Event | When it fires |
|------|-------|--------------|
| `server/services/forms.js` | `lead_submitted` | After a form submission is saved |
| `server/routes/ctmForms.js` | `lead_submitted` | After a CTM form submission |
| `server/routes/hub.js` | `qualified_call` | When a call is AI-classified as qualified |
| `server/routes/hub.js` | `new_client` | When a client onboarding is completed/signed |

## Adding a new hook point

In your route/service, after the core business logic completes:

```js
import { sendEvent } from '../services/trackingRelay.js';

await sendEvent(userId, 'your_event_name', {
  value: 100,       // optional
  currency: 'USD',  // optional
});
```

`userId` is the client's `user_id` — the relay looks up `tracking_configs` for that client.

## HIPAA gate — Meta CAPI is medical-blocked

The relay enforces `config.client_type !== 'medical'` before any Meta CAPI dispatch. **Never bypass this.** Meta does not sign BAAs. Medical client data must never reach Meta, even hashed.

Non-medical clients: PII is SHA-256 hashed before sending to Meta CAPI.

## Per-form Google Ads override

If a form should fire to a different Google Ads conversion action than the account-level default:
1. Set `gads_conversion_action_id` in `ctm_forms.analytics_json`
2. Pass as `_gads_override_action_id` in the event data object
3. Relay checks `eventData._gads_override_action_id` first, then falls back to `config.conversion_mappings[eventName]`

## Adding a new event name to conversion mappings

Conversion mappings live in `tracking_configs.conversion_mappings` (JSONB). If the new event should be mappable in the TrackingWizard, add it to the relay events list in `src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx`.

## Audit log

All relay dispatches — successes and failures — are logged to `tracking_event_log` (30-day retention). Debug with:

```sql
SELECT * FROM tracking_event_log
WHERE user_id = '<client_user_id>'
ORDER BY created_at DESC LIMIT 20;
```

## Destination summary

| Destination | Medical | Non-Medical |
|------------|---------|-------------|
| GA4 Measurement Protocol | ✅ | ✅ |
| Meta CAPI | ❌ (HIPAA) | ✅ (hashed PII) |
| Google Ads Offline | ✅ | ✅ |

The relay is fire-and-forget from the route's perspective — failures are logged but don't block the HTTP response.
