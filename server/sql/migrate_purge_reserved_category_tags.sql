-- One-time cleanup: purge category/lifecycle-word tags that leaked into the lead_tags
-- namespace before the derived `disposition` column + tag-creation guards existed. Those
-- states are now rendered from derived disposition & lifecycle, never from free-form tags.
--
-- Idempotent: re-running deletes nothing new once clean.
-- System tags (system_key IS NOT NULL) are preserved — only free-form user/auto-created tags
-- carrying a reserved name are removed. The contact_tags / call_log_tags join rows are cleaned
-- automatically by their ON DELETE CASCADE FKs to lead_tags(id), so a single DELETE suffices.
-- Reserved list mirrors RESERVED_TAG_NAMES in server/routes/hub.js — keep the two in sync.
-- Names are canonicalized (lowercase, separator runs -> single space, trimmed) before matching,
-- so leaked variants like "in-journey" / "pending__review" are also cleaned.
DELETE FROM lead_tags
 WHERE system_key IS NULL
   AND BTRIM(REGEXP_REPLACE(LOWER(name), '[-_[:space:]]+', ' ', 'g')) = ANY(ARRAY[
     'qualified','spam','not a fit','unanswered','voicemail',
     'needs attention','priority','pending','pending review',
     'lead','new lead','in journey','active client'
   ]::text[]);
