-- Edit Contact Name: distinguish a human-set contact name from an auto-captured one.
-- 'user' = a person set contacts.display_name (authoritative for display); 'auto' = ingest-captured/empty.
-- Additive, idempotent. Instant on PG (non-volatile default → no table rewrite).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS display_name_source TEXT NOT NULL DEFAULT 'auto';
