-- File Storage Migration
-- Stores uploaded files in PostgreSQL for persistence on ephemeral platforms
-- Run: psql $DATABASE_URL -f server/sql/migrate_file_storage.sql

-- file_uploads: Generic binary file storage
CREATE TABLE IF NOT EXISTS file_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'general',     -- 'avatar', 'group-icon', 'document', 'brand', etc.
  owner_id TEXT,                                 -- ID of owning entity (user_id, group_id, etc.)
  owner_type TEXT,                               -- Type of owner ('user', 'group', 'client', etc.)
  original_name TEXT NOT NULL,                   -- Original filename
  content_type TEXT NOT NULL,                    -- MIME type
  size_bytes INTEGER NOT NULL,                   -- File size in bytes
  hash TEXT,                                     -- SHA-256 hash for deduplication
  bytes BYTEA NOT NULL,                          -- The actual file content
  metadata JSONB DEFAULT '{}',                   -- Additional metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_file_uploads_category ON file_uploads(category);
CREATE INDEX IF NOT EXISTS idx_file_uploads_owner ON file_uploads(owner_id, owner_type);
CREATE INDEX IF NOT EXISTS idx_file_uploads_hash ON file_uploads(hash);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_file_uploads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS file_uploads_updated_at ON file_uploads;
CREATE TRIGGER file_uploads_updated_at
  BEFORE UPDATE ON file_uploads
  FOR EACH ROW
  EXECUTE FUNCTION update_file_uploads_updated_at();

-- Add file_id column to documents table to reference stored files
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES file_uploads(id) ON DELETE SET NULL;

-- Add file_id column to client_groups for custom icons
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS icon_file_id UUID REFERENCES file_uploads(id) ON DELETE SET NULL;
