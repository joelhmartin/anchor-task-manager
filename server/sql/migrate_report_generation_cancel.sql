ALTER TABLE report_generations
  DROP CONSTRAINT IF EXISTS report_generations_status_check;

ALTER TABLE report_generations
  ADD CONSTRAINT report_generations_status_check
  CHECK (status IN ('pending','running','complete','failed','canceled'));
