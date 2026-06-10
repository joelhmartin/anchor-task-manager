-- Add spam flag to CTM form submissions
ALTER TABLE ctm_form_submissions ADD COLUMN IF NOT EXISTS spam BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_ctm_form_submissions_spam ON ctm_form_submissions(spam) WHERE spam = TRUE;
