-- Migration: add anonymization support for GDPR erasure requests on form submissions
ALTER TABLE ctm_form_submissions
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
