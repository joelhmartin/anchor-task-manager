-- Fix client records where the business name was incorrectly split into
-- first_name / last_name by the PUT /clients/:id handler.
-- Restores first_name = client_identifier_value, last_name = '' for any
-- client user that has a non-empty last_name (which only happens via the
-- now-fixed split logic — real clients never have a meaningful last name).
UPDATE users u
SET first_name = cp.client_identifier_value,
    last_name  = ''
FROM client_profiles cp
WHERE cp.user_id = u.id
  AND u.role = 'client'
  AND u.last_name IS NOT NULL
  AND u.last_name != ''
  AND cp.client_identifier_value IS NOT NULL;
