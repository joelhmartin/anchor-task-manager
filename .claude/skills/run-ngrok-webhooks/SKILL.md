---
name: run-ngrok-webhooks
description: Use when testing Twilio webhooks, CTM form embeds, tracking scripts, or OAuth callbacks locally in the Anchor Client Dashboard. Covers the dev-ngrok.sh script and tunnel configuration.
---

# Run ngrok for Local Webhook Testing

## When you need this

- Testing Twilio voice webhooks (call tracking, recording, transcription status)
- Testing CTM form embed on an external page
- Testing the `anchor-tracking.js` attribution script from a client site
- Testing OAuth redirect callbacks from Google/Microsoft
- Any scenario where an external service needs to reach `localhost:4000`

## Start the tunnel

```bash
./dev-ngrok.sh              # backend only (port 4000) + ngrok
./dev-ngrok.sh --full       # backend + frontend + ngrok
```

This is **separate from** `yarn server` / `./dev.sh` — ngrok does NOT auto-start with the normal dev server.

## Requirements

- `ngrok` installed: `brew install ngrok/ngrok/ngrok`
- ngrok authtoken configured: `ngrok config add-authtoken <token>`
- The authtoken is stored in `~/.config/ngrok/ngrok.yml`

## What the script does

1. Starts the backend server (nodemon on port 4000)
2. Starts an ngrok HTTP tunnel pointing at port 4000
3. Prints the public HTTPS URL (`https://<random>.ngrok-free.app`)

## Configuring webhooks to use the tunnel URL

**Twilio:** In the Twilio console (or via `twilio` CLI), set the voice webhook URL for a tracking number to `https://<tunnel>/api/twilio/voice`.

**CTM form embed:** Use `https://<tunnel>/api/ctm-forms/embed/<form_id>` in the embed snippet.

**OAuth:** Update the redirect URI in the Google/Microsoft app registration to `https://<tunnel>/api/auth/oauth/callback`.

## Caveat: tunnel URL changes each restart

Free ngrok gives a new random URL on each start. If you restart the script, update all webhook URLs pointing to the old tunnel.

## Local DB note

The local database (PostgreSQL on port 5432 via `brew services`) only runs while your Mac is on. Cloud Run uses its own Cloud SQL connection. Test data created locally will not appear in production.
