-- Migration: add consent tracking columns to ctm_form_submissions
ALTER TABLE ctm_form_submissions
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_field_name TEXT;
