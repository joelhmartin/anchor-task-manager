# Send Test Email — design

**Date:** 2026-05-27
**Branch:** `feat/journey-email-test-send`

## Goal

From the Email Templates builder (`ClientPortal/leads/EmailTemplatesPane.jsx`), let a user fire a real test of the current email draft through the **exact** journey render+send path, to a recipient they choose. This both gives a faithful preview and exercises the production rendering code (it would have caught the raw-`<p>` bug fixed in `2806de3`/`5329605`).

## Decisions (confirmed with user)

- **Recipient list:** the current account's team members (`fetchTeamMembers` → `members[]`), plus free-typed custom addresses. Works for every role and is privacy-safe (no cross-account user exposure).
- **Token data:** sample placeholder values for the lead-facing tokens (`first_name:"Jane"`, `client_name:"Jane Doe"`, `client_phone:"(555) 123-4567"`, `client_email:"jane.doe@example.com"`). The business-facing tokens (`business_name`/`phone`/`email`) and logo resolve from the **real account branding**, so the test looks authentic.
- **Draft handling:** send the **current (possibly unsaved) editor content** — subject, preview text, body, attachments.
- **Subject marker:** prepend `[Test] `.
- **Process:** feature branch + PR (not a direct push to main).

## Backend

### Refactor `server/services/journeyActivities.js`
Extract the render+send core of `sendJourneyEmailNow` into a private helper so real sends and test sends share one code path (no drift):

```
renderAndSendJourneyEmail({ ownerUserId, to, subject, body, bodyFormat, preheader,
                            attachmentFileIds, leadTokens, subjectPrefix, logging })
```
- Resolves branding via `resolveClientBranding(ownerUserId)`.
- Builds the token map: `leadTokens` (caller-supplied) merged with branding-derived `business_name`/`phone`/`email`.
- Renders subject/body/preheader using the existing HTML-aware logic (`HTML_TAG` allowlist + `renderTemplate`/`plainTextToParagraphs`).
- Wraps via `wrapClientEmailHtml`, attaches **owner-scoped** files (`file_uploads` where `owner_id = ownerUserId AND owner_type='user'`), sends via `sendMailgunMessageWithLogging` (`skipBodyLogging: true`).

`sendJourneyEmailNow` keeps its lead-email-validation message, then delegates to the helper with real lead tokens and `emailType: 'journey_touch_email'`.

New export `sendJourneyTestEmail({ ownerUserId, to, subject, body, bodyFormat, preheader, attachmentFileIds })`:
- Validates `to`, delegates to the helper with `SAMPLE_TEST_TOKENS`, `subjectPrefix: '[Test] '`, `emailType: 'journey_test_email'`, `metadata: { test: true }`.
- **No** journey activity row, **no** stage advance.

### New endpoint `POST /api/hub/journey-email-templates/test`
- Owner-scoped (`ownerId = req.portalUserId || req.user.id`), `canWriteAccount(req)` gate.
- Body: `{ subject, body, body_format='html', preheader, attachment_file_ids: string[], recipients: string[] }`.
- Validates: subject-or-body present; 1–10 valid, de-duped recipient emails; `attachment_file_ids` are owner-owned (same guard as `/journeys/:id/email`).
- Sends **one message per recipient** (no cross-exposure). Returns `{ sent, failed, failures }`; 502 if all fail.
- Audit via `logUserActivity` (`SEND_JOURNEY_EMAIL`, `details:{ test:true, recipients, sent }`) — recipient **count** only, never the addresses or body.

## Frontend

### `src/api/journeyTemplates.js`
Add `sendTestEmail(payload)` → `POST /hub/journey-email-templates/test`.

### New `src/views/client/ClientPortal/leads/SendTestEmailDialog.jsx`
- `FormDialog` with one field: MUI `Autocomplete` (`multiple`, `freeSolo`) seeded from `fetchTeamMembers()` (`option = { label: "Name — email", value: email }`); accepts typed custom addresses; each entry validated as an email. Prefills the current user's email.
- On submit calls `onSubmit(recipientEmails)`; toast on success/failure; `LoadingButton` submit.

### `EmailTemplatesPane.jsx`
- Add a **"Send test email"** action button in the editor dialog (alongside Save/Cancel).
- Opens `SendTestEmailDialog`; on submit, calls `sendTestEmail({ subject, body, body_format:'html', preheader, attachment_file_ids: form.attachments.map(a=>a.file_id), recipients })`.
- Toast `Test sent to N recipient(s).` / error. No list refetch needed.

## Compliance

- Owner-scoped reads/sends; attachment ownership enforced server-side.
- Recipients validated at the boundary; capped at 10.
- No PHI: sample tokens are synthetic; `skipBodyLogging:true`; audit logs counts only.
- Parameterized queries only.

## Files

- `server/services/journeyActivities.js` (refactor + new export)
- `server/routes/hub.js` (import + new endpoint)
- `src/api/journeyTemplates.js` (new client fn)
- `src/views/client/ClientPortal/leads/SendTestEmailDialog.jsx` (new)
- `src/views/client/ClientPortal/leads/EmailTemplatesPane.jsx` (button + wiring)
- `docs/API_REFERENCE.md` (endpoint)

## Verification (no test suite)

- `yarn lint` clean on changed files; `yarn build` passes.
- Node repro of `renderAndSendJourneyEmail` token/HTML rendering (reuse the existing repro pattern) — confirm sample tokens render and `[Test]` prefix applies.
- Confirm `sendJourneyEmailNow` output is byte-identical pre/post refactor for a representative input.
- Manual: button → dialog → pick team member + custom → receive `[Test]`-prefixed, branded email.
