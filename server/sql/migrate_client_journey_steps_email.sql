-- Add email-send capability to journey steps so each step can fire
-- a templated email at its due_at. Idempotent.

ALTER TABLE client_journey_steps
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_preheader TEXT,
  ADD COLUMN IF NOT EXISTS email_body TEXT,
  ADD COLUMN IF NOT EXISTS email_body_format TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS email_reply_to TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_send_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_client_journey_steps_email_due
  ON client_journey_steps (due_at)
  WHERE email_enabled = TRUE AND email_sent_at IS NULL;
