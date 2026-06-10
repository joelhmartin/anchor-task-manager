-- CTM Forms autoresponder: send confirmation email + PDF attachments to submitter.
-- Idempotent.

ALTER TABLE ctm_forms
  ADD COLUMN IF NOT EXISTS autoresponder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS autoresponder_from_name TEXT,
  ADD COLUMN IF NOT EXISTS autoresponder_subject TEXT,
  ADD COLUMN IF NOT EXISTS autoresponder_body TEXT,
  ADD COLUMN IF NOT EXISTS autoresponder_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
