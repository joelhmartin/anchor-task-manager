# CTM Texting (SMS) — Brainstorm + Test Handoff

**Status:** Research done; feature NOT built. Hand-off for a fresh agent to (1) build a small CTM-SMS test page and (2) brainstorm the full feature.
**Decided earlier:** SMS goes through **CallTrackingMetrics (CTM)**, not Twilio. Compliance stance: "allow all clients, with guardrails."
**Test account:** CTM agency/test account id **`267834`** (the user's own account).

---

## Goal

Add **outbound** lead-journey texting via the CTM API. For v1: **send-only** (no in-dashboard reply handling), with message content (authored in the WYSIWYG/text template) directing recipients to call the right number or book online. Each client gets a dedicated text-enabled number; texting is a setting that must be enabled. A full reply system (softphone + inbound) is explicitly out of scope for v1.

**First concrete step (this hand-off):** a minimal, admin-only **test page/endpoint** that sends a single SMS via the CTM API using account `267834` to the user's own phone — to empirically nail down the exact CTM send-SMS endpoint + fields (public docs couldn't be extracted headlessly) and confirm the account/number can actually text.

---

## What already exists in the codebase (reuse this)

- **CTM API client:** `server/services/ctm.js`. Auth = HTTP **Basic** `base64(apiKey:apiSecret)`; base URL `process.env.CTM_API_BASE || 'https://api.calltrackingmetrics.com'`; `axios`. Account-scoped routes: `/api/v1/accounts/{accountId}/...`.
- **Credentials:** code reads agency-level **`CTM_API_KEY` / `CTM_API_SECRET`** (resolved in `resolveCtmCreds()` ~`ctm.js:1935`); legacy per-client encrypted `ctm_api_key`/`ctm_api_secret` fallback. ⚠️ CLAUDE.md names these `CTM_ACCESS_KEY`/`CTM_SECRET_KEY` — **confirm which are actually set** in `.env`/Cloud Run before the test.
- **Client ↔ CTM account map:** `client_profiles.ctm_account_number` (per-client CTM sub-account). The test uses `267834` directly.
- **Existing CTM calls (no texting yet):** calls pull, call detail, `POST .../calls/{id}/sale`, form reactors, `numbers.json`, custom fields.
- **Gated journey-text stub (already shipped):** `POST /api/hub/journeys/:id/text` (`server/routes/hub.js`) — records a `text` activity, gated by `JOURNEY_SMS_ENABLED` (returns `{gated:true}` when off, `501` when "on"); `server/services/journeyScheduledSends.js` currently skips `type='text'` rows. **Fill these in** rather than building a parallel path.
- **Text template authoring already built:** `journey_email_templates` has `sms_use_email_body` (bool), `sms_body` (text), `sms_opt_out` (text). The template dialog has Email/Text tabs; the Text tab has "Use email template" (derive plain text from the email body) + an opt-out language field (default "Reply STOP to opt out."). So the *content* side is ready; only *sending* is missing.

---

## CTM texting research findings (public docs)

- **Texting is a per-number capability.** Must purchase/enable a **text-enabled** tracking number; numbers carry SMS/MMS capability flags. Each client (CTM sub-account) can have its own text number. Numbers are metered (no included texts).
- **A2P 10DLC registration is mandatory for US business texting** — a 3-step CTM **Trust Center** flow (Business → Brand → Campaign), one registration per sub-account; agencies register on behalf of each client. Unregistered 10DLC traffic is carrier-filtered/blocked. **This is a hard prerequisite with lead time**, and healthcare campaigns may get extra vetting. (Account `267834` may or may not be registered — the test will reveal it.)
- **Send endpoint:** CTM's public API includes a "send SMS message" request (Postman + Make.com "Send SMS Message" action), `POST` with `{from = text-enabled number, to, message}` scoped to the account, same Basic auth. **Exact path + field names could NOT be extracted** (Postman is a JS-rendered SPA; Zendesk articles are 403-gated; browser automation is barred on this machine). → The test page resolves this empirically, or pull it from a logged-in Postman session.
- **Inbound replies** land in CTM and can be pushed via a **"text message received" webhook**; no API gives a reliable pre-send "is this number textable" check → plan for **delivery-status-based failure handling** + STOP/opt-out, not a pre-flight check.
- **HIPAA:** CTM **signs a BAA**; MMS is HIPAA-compliant; **keep PHI out of SMS bodies**. Recommend a medical-content gate on SMS templates (mirrors the existing Meta CAPI `client_type='medical'` gate). TCPA: capture prior express consent; honor STOP/opt-out (CTM has an opt-out list primitive).

**Sources:** CTM Postman "send SMS message" (`postman.com/ctm-8695/.../request/uu6i0jt/send-sms-message`); CTM API guide (`github.com/calltracking/calltracking.github.io/blob/master/api_users_guide.md`); Enabling Text Messaging + Sending/Receiving Texts (CTM Zendesk); A2P 10DLC Trust Center (CTM Zendesk); HIPAA/BAA (`calltrackingmetrics.com/security/hipaa/`); Make.com connector (`apps.make.com/calltrackingmetrics`).

---

## Test page — objective & guardrails

Build a small **admin-only** test surface (a dev/test page or a single authenticated endpoint) that:
1. Sends **one** SMS via the CTM API using account **`267834`**, `{ from: <a text-enabled number on 267834>, to: <user's own phone>, message: <free text> }`.
2. Surfaces the **raw CTM response/error** so we can confirm the exact endpoint/fields and whether the number is text-enabled + A2P-registered.
3. Is **isolated from the live journey flow** (don't enable `JOURNEY_SMS_ENABLED` or wire it into journeys yet).

**Guardrails:** real external send — costs money and may be A2P-filtered. Send **only to the user's own number**. No PHI in the test body. Confirm the agency CTM creds + the account's text-enabled `from` number first (`GET .../accounts/267834/numbers.json` to list numbers + capabilities).

---

## Open questions for the brainstorm

1. Exact CTM send-SMS endpoint path + field names (resolve via the test / Postman).
2. Env-var truth: `CTM_API_KEY`/`CTM_API_SECRET` vs `CTM_ACCESS_KEY`/`CTM_SECRET_KEY`.
3. A2P registration ownership + lead time (agency-on-behalf vs client); healthcare vetting/throughput.
4. Per-client text-enabled number provisioning (do existing sub-accounts have one? cost?).
5. Delivery status + inbound: per-message status (webhook vs log)? inbound "text received" webhook payload shape (for a future `/api/webhooks` handler).
6. Deliverability: accept "send and detect failure" vs add a line-type lookup.
7. Consent model: where/how TCPA consent is captured + enforced; opt-out/STOP suppression.
8. PHI template guardrails: medical/non-medical content gate on SMS bodies.
9. Reuse the `JOURNEY_SMS_ENABLED` stub (`hub.js` `/text` + `journeyScheduledSends.js` text branch) vs a dedicated SMS service.

---

## Context: the lead journey redesign (just shipped)

This SMS work follows the **Lead Journey Redesign** — PR **#93** (`feature/lead-journey-redesign`): fixed-stage pipeline + activity log + rich email/text template composer. Design/plan: `docs/superpowers/specs/2026-05-21-lead-journey-redesign-design.md`, `docs/superpowers/plans/2026-05-21-lead-journey-redesign.md`. SMS sending was deliberately deferred to this hand-off. Start the SMS work on a **fresh branch off `main`** (after #93 merges), not on the journey branch.
