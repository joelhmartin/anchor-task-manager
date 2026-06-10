ALTER TABLE report_generations
  ADD COLUMN IF NOT EXISTS csv_file_id UUID REFERENCES file_uploads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS output_format TEXT DEFAULT 'pdf';
