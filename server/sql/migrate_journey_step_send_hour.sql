-- Hour-of-day (0-23) in the client's local timezone at which the journey
-- email step should be delivered. NULL means "use the default" (9 AM).
ALTER TABLE client_journey_steps
  ADD COLUMN IF NOT EXISTS email_send_hour SMALLINT
  CHECK (email_send_hour IS NULL OR (email_send_hour BETWEEN 0 AND 23));
