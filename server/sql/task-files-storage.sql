-- task-files-storage.sql
--
-- Phase 3: persist task file attachments in Postgres (BYTEA) instead of the
-- ephemeral Cloud Run filesystem. Old rows that still reference /uploads/...
-- continue to resolve via express.static; new uploads write the bytes here and
-- expose `/api/tasks/files/:fileId/content` as an authenticated download URL.

ALTER TABLE task_files
  ADD COLUMN IF NOT EXISTS data BYTEA,
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
