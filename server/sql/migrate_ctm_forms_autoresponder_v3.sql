-- CTM Forms autoresponder v3: per-form Reply-To override.
-- If empty, send pipeline falls back to form.notification_emails, then to
-- client_profiles.form_notification_emails. Idempotent.

ALTER TABLE ctm_forms
  ADD COLUMN IF NOT EXISTS autoresponder_reply_to TEXT[] NOT NULL DEFAULT '{}';
