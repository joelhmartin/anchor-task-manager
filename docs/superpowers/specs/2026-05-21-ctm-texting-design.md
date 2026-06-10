# CTM Journey Texting (SMS) — v1 Design

**Status:** Design approved in brainstorm (2026-05-21). Ready for implementation plan.
**Branch:** `feature/lead-journey-redesign` (this work depends on the journey infrastructure shipped there — `/text` stub, `journeyScheduledSends` text branch, `journey_email_templates` SMS fields — which is not yet on `main`).
**Predecessor:** `docs/superpowers/specs/2026-05-21-ctm-texting-handoff.md` (research + test handoff).

---

## 1. Goal & scope

Add **outbound, send-only** lead-journey texting via the **CallTrackingMetrics (CTM) API** (not Twilio). Message content directs recipients to call or book online; there is no in-dashboard reply handling in v1.

**In scope (v1):**
- Per-client dedicated text number, texting gated by an admin "Enabled" toggle.
- Sending journey texts via the existing `/text` stub and scheduled-send branch.
- TCPA/HIPAA guardrails: inbound-initiated consent, STOP suppression, opt-out language, quiet hours, no-PHI content allowlist.
- Inbound STOP capture via a CTM webhook (suppression only — not a reply UI).
- Capturing durable business-identity fields (legal name, EIN, address) in onboarding + the client Assets tab, for staff to use when registering in CTM.

**Out of scope (v1):** two-way reply UI / softphone, MMS/media, async delivery-receipt ingestion, automated number purchase, automated A2P/toll-free registration, line-type/textability lookup.

**Compliance stance:** allow **all client types** (CTM signs a BAA covering SMS/MMS). Guardrails are content-level, not channel-level — unlike the Meta CAPI gate which blocks `client_type='medical'`.

---

## 2. Confirmed CTM facts (empirically verified via `scripts/ctm-sms-test.js`)

- **Send endpoint:** `POST /api/v1/accounts/{accountId}/sms.json`, JSON body `{ to, from, message }`, HTTP Basic auth `base64(CTM_API_KEY:CTM_API_SECRET)`. (`messages.json` and `texts.json` return 404.)
- **Env vars:** `CTM_API_KEY` / `CTM_API_SECRET` / `CTM_API_BASE` are the real, working credentials. CLAUDE.md's `CTM_ACCESS_KEY`/`CTM_SECRET_KEY` are **wrong** (doc bug — fix separately).
- **A2P/registration gate is server-enforced by CTM.** An unregistered number returns `HTTP 400 {status:"error", message:"Message cannot be delivered until A2P campaign is registered.", number:"<from>"}`. We detect this (status + message) as `blocked_a2p`.
- **No pre-flight textability check exists.** A number's `sms_enabled:true` flag does **not** imply deliverability (a long-lived `sms_enabled:true` number still A2P-blocked in testing). Deliverability is **send-and-detect** only.
- Numbers expose `sms_enabled`, `sms_supported`, `sms_long_outgoing`, `type` (`local` vs toll-free) via `GET /api/v1/accounts/{accountId}/numbers.json`.

---

## 3. Architecture overview

One send path. A new module `server/services/sms.js` owns the CTM call + the full compliance gauntlet. The already-shipped `POST /api/hub/journeys/:id/text` route and the `journeyScheduledSends.js` text branch both call it — neither talks to CTM directly. This mirrors how `trackingRelay.js` centralizes server-side conversion dispatch.

```text
journey "Send text" action ─┐
                            ├─> server/services/sms.js  sendJourneyText()
journeyScheduledSends (cron)┘         │
                                      ├─ gauntlet: enabled? from#? consent? suppressed? quiet hours? content safe?
                                      ├─ POST /accounts/{acct}/sms.json {to,from,message}
                                      ├─ interpret result → status
                                      └─ write sms_messages + journey activity + return for immediate UI update

inbound STOP ─> POST /api/webhooks/ctm/sms ─> sms_opt_outs upsert + stop journey
```

---

## 4. Data model

### 4.1 New `brand_assets` columns (durable business identity)
Captured in onboarding (`BrandStep.jsx`) and shown/edited in the Assets tab (`BrandAssetsTab.jsx`). Reusable beyond SMS.

| Column | Type | Notes |
|---|---|---|
| `legal_business_name` | TEXT | Legal entity name for A2P/toll-free registration. Distinct from the informal `business_name` / `client_identifier_value`. |
| `ein_tax_id` | TEXT | Business Tax ID. Sensitive (not PHI). Internal/admin-only display. Encryption-at-rest deferred (see §11). |
| `business_address` | TEXT | Registered business address. |

> SMS-program specifics (use case, sample messages, opt-in wording, volume) are **not** stored — staff enters those directly into CTM Trust Center. (Decided in brainstorm: "identity fields only.")

### 4.2 `client_sms_config` (1:1 per client — operational config)
```sql
CREATE TABLE IF NOT EXISTS client_sms_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  number_type         TEXT CHECK (number_type IN ('local','toll_free')),
  from_number         TEXT,            -- E.164 dedicated text number
  from_number_ctm_id  TEXT,            -- CTM number id (TPN...)
  registration_status TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (registration_status IN ('not_started','submitted','registered','rejected')),
  booking_url         TEXT,            -- token source for {{booking_link}}
  call_number         TEXT,            -- token source for {{call_number}}
  send_timezone       TEXT,            -- IANA TZ for quiet-hours (see §8); nullable → agency default
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  updated_by          UUID REFERENCES users(id),
  UNIQUE (client_user_id)
);
```

### 4.3 `sms_opt_outs` (suppression list, per client/brand)
```sql
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number   TEXT NOT NULL,        -- normalized E.164 (lead's number)
  opted_out_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source         TEXT NOT NULL DEFAULT 'inbound_stop'
                   CHECK (source IN ('inbound_stop','manual','ctm_sync')),
  keyword        TEXT,                 -- the STOP/UNSUBSCRIBE word received
  UNIQUE (client_user_id, phone_number)
);
```

### 4.4 `sms_messages` (outbound send log)
```sql
CREATE TABLE IF NOT EXISTS sms_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id     UUID,                 -- nullable
  call_log_id    UUID,                 -- the lead (nullable)
  template_id    UUID,
  to_number      TEXT NOT NULL,        -- normalized E.164
  from_number    TEXT NOT NULL,
  body           TEXT,                 -- rendered; allowlist-only (no PHI by design)
  status         TEXT NOT NULL
                   CHECK (status IN ('sent','failed','blocked_a2p','suppressed',
                                     'quiet_hours_deferred','skipped_disabled','no_consent','no_number')),
  ctm_message_id TEXT,
  error_text     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_client_created ON sms_messages (client_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_journey ON sms_messages (journey_id);
```

The user-facing journey timeline reuses the existing journey "text" **activity** record; it references the `sms_messages.id` for status/detail.

**Migrations:** follow the `add-migration` skill — idempotent SQL files in `server/sql/`, a `maybeRunX()` per migration, appended to the chain in `server/index.js`. Phone numbers stored normalized E.164 consistent with `call_logs.from_number` (the app already stores call/lead phone numbers; no new encryption layer introduced for them).

---

## 5. Per-client setup UI

### 5.1 Assets tab additions (`BrandAssetsTab.jsx` + onboarding `BrandStep.jsx`)
Add inputs for `legal_business_name`, `ein_tax_id`, `business_address` to the existing Contact Info / Brand Basics sections. Persisted through the existing onboarding submit + brand-admin save endpoints (extend `/api/hub/brand/admin/:clientId` and the onboarding payloads).

### 5.2 "Texting (SMS)" panel (admin, per client)
A focused panel (in the client drawer, alongside other integration settings):
- **Number type:** local / toll-free (drives which registration path staff follows + guidance text).
- **From-number:** dropdown of the client's text-capable CTM numbers (`sms_enabled:true`), fetched live from `numbers.json` for the client's `ctm_account_number`.
- **Registration status:** `not_started → submitted → registered / rejected` (manual workflow tracker).
- **Enabled toggle:** master gate; off by default, only flippable once a from-number is assigned.
- **Booking URL / call number:** token sources for templates.
- **Read-only:** opt-out list + recent `sms_messages` log.

All saves use shared components (`FormDialog`, `SelectField`, `StatusChip`, `LoadingButton`), toast on success/failure, and update local state immediately per the CLAUDE.md hard rules.

---

## 6. Send service — `server/services/sms.js`

`sendJourneyText({ journeyId, callLogId, clientUserId, templateId, toNumber, actor })` runs the **compliance gauntlet in order**, short-circuiting with a logged status:

1. **Enabled** — load `client_sms_config`; if `!enabled` → `skipped_disabled`.
2. **From-number** — `from_number` + client `ctm_account_number` resolved → else `no_number`.
3. **Consent** — `toNumber` belongs to a lead who contacted *this* client (an inbound `call_logs` row exists for the number under this owner) → else `no_consent`.
4. **Suppression** — not in `sms_opt_outs` for this client → else `suppressed`.
5. **Quiet hours** — current time within 08:00–21:00 in the client's `send_timezone` → else `quiet_hours_deferred` (rescheduled by the scheduler, not dropped).
6. **Content guard** — render body from template; assert only allowlisted tokens used (§7); ensure opt-out language present (append the template's `sms_opt_out`, default "Reply STOP to opt out.", if missing).
7. **Dispatch** — `POST /accounts/{acct}/sms.json {to, from, message}` with `validateStatus: () => true`.
8. **Interpret** — 2xx → `sent` (+ `ctm_message_id`); 400 + A2P message → `blocked_a2p`; else `failed` (+ `error_text`).
9. **Record** — write `sms_messages` row + journey activity; return a structured result so the caller updates local UI state immediately + toasts.

**Integration points:**
- `POST /api/hub/journeys/:id/text` — replace the `501`/gated stub body with a call to `sendJourneyText`; keep recording the journey activity.
- `server/services/journeyScheduledSends.js` — replace the `type='text'` skip with a call to `sendJourneyText`; on `quiet_hours_deferred`, reschedule to the next allowed window.
- `JOURNEY_SMS_ENABLED` — repurposed as a **global kill-switch** (default `true` once shipped). Per-client `enabled` is the granular gate.

---

## 7. Templates & safe-token allowlist

Reuses `journey_email_templates.sms_body` / `sms_opt_out` / `sms_use_email_body`.

- **Allowed tokens (only):** `{{first_name}}`, `{{business_name}}`, `{{booking_link}}`, `{{call_number}}`, `{{opt_out}}`.
  - `{{first_name}}` — lead first name (allowed per brainstorm; leads are pre-patient prospects).
  - `{{business_name}}` — resolves to `client_identifier_value` (the canonical display name per CLAUDE.md), **not** `brand_assets.business_name`.
  - `{{booking_link}}` / `{{call_number}}` — from `client_sms_config`.
- **Authoring UI:** token picker limited to the allowlist; persistent "No PHI in texts" warning banner.
- **Save-time validation:** reject/flag any token outside the allowlist.
- **`sms_use_email_body`:** when deriving SMS text from the email body, run the derived text through the **same allowlist validator** (email bodies may contain PHI tokens) — strip/flag anything off-allowlist.

---

## 8. Quiet hours & scheduling

TCPA restricts messaging to 08:00–21:00 in the **recipient's** local time. We rarely know the lead's true timezone, so v1 uses the **client's business timezone** (`client_sms_config.send_timezone`, falling back to an agency default) as a documented proxy. Scheduled sends that would fire outside the window are deferred (`quiet_hours_deferred`) and re-queued for the next allowed window by `journeyScheduledSends`, not dropped.

---

## 9. Inbound STOP webhook

- **Endpoint:** `POST /api/webhooks/ctm/sms` — public, registered with the two-layer public-CORS bypass (like `/api/twilio/*`), under `server/routes/webhooks.js`.
- **Behavior:** parse inbound keyword. `STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT` → upsert `sms_opt_outs` (source `inbound_stop`) **and** stop the lead's active journey + log to audit. `START/UNSTOP/YES` → remove suppression. All other inbound messages: acknowledged 200, no reply (send-only).
- **Auth:** verify CTM's webhook signature if one exists; **fallback** to a shared-secret token in the path/header if CTM provides no HMAC (see §11). Always respond 200 quickly.
- **CTM setup (manual):** configure the account-level "text message received" webhook to point at this URL.

---

## 10. Delivery & error handling

- v1 records the **synchronous** CTM response only. `blocked_a2p` and `failed` are surfaced in the send log + journey activity with a clear staff-facing reason (e.g., "Not deliverable — number not yet A2P-registered in CTM").
- **No async delivery-receipt ingestion** — carrier filtering that occurs after a 200 is out of scope (future delivery-receipt webhook).
- Conservative failure posture: any gauntlet error logs a status and never silently "succeeds."

---

## 11. Open items & risks

1. **CTM webhook signing** — mechanism unconfirmed (docs were JS-rendered/403-gated). Resolve during implementation; if no HMAC, use a shared-secret URL token. *Does not block the send path — only inbound STOP.*
2. **Quiet-hours timezone source** — confirm whether any existing client column holds a timezone; if not, `send_timezone` on `client_sms_config` + agency default. Documented approximation (client TZ ≠ lead TZ).
3. **`ein_tax_id` at rest** — stored plaintext in v1 (business data, admin-only). Flag for `compliance-auditor`; encrypt-at-rest if required.
4. **A2P prerequisite is external** — no client can actually send until a number is A2P-registered (local) or toll-free-verified in CTM. The app gates on the admin toggle; the real go-live depends on this manual step completing.
5. **CLAUDE.md env-var doc bug** — `CTM_ACCESS_KEY`/`CTM_SECRET_KEY` should read `CTM_API_KEY`/`CTM_API_SECRET`. Fix in a docs pass.

---

## 12. Compliance summary (HIPAA / TCPA)

- **HIPAA:** CTM BAA covers the channel; no-PHI content allowlist keeps message bodies clean; `ein_tax_id` is not PHI but flagged for encryption review. Audit-log opt-outs and journey stops.
- **TCPA:** inbound-initiated prior express consent; opt-out language in every message; STOP suppression honored before every send; quiet-hours windowing.
- `compliance-auditor` review required before merge (touches consent, audit logging, sensitive business data, public webhook).

---

## 13. File-change map

| Area | Files |
|---|---|
| Migrations | new `server/sql/migrate_*.sql` (brand_assets cols, client_sms_config, sms_opt_outs, sms_messages) + `maybeRunX` in `server/index.js` |
| Send service | new `server/services/sms.js` |
| Journey integration | `server/routes/hub.js` (`/journeys/:id/text`), `server/services/journeyScheduledSends.js` |
| Inbound webhook | `server/routes/webhooks.js` |
| Admin API | `server/routes/hub.js` (SMS config CRUD, from-number list, opt-out list, send log; brand-admin field additions) |
| Onboarding | `server/routes/onboarding.js`, `src/views/pages/onboarding/steps/BrandStep.jsx` |
| Assets tab | `src/views/admin/AdminHub/BrandAssetsTab.jsx` |
| Texting panel | new component under `src/views/admin/AdminHub/` + API client in `src/api/` |
| Template authoring | existing journey template dialog (allowlist enforcement) |
| Docs | `docs/API_REFERENCE.md`, `SKILLS.md` (schema), `docs/INTEGRATIONS.md`, CLAUDE.md env-var fix |

---

## 14. Verification (no test suite)

`yarn build` + `yarn lint`; `scripts/ctm-sms-test.js send …` for a real live send once a number is A2P-registered; manual UI walkthrough (setup panel, toggle gating, template allowlist rejection, STOP suppression, quiet-hours defer); migration idempotency check (run twice); `compliance-auditor` agent review.
