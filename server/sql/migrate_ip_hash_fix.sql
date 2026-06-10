-- Fix IP address columns to accept hashed values (privacy compliance)
-- The ip_address columns store hashed IPs, not actual IPs, for HIPAA compliance

-- form_submissions: change ip_address from INET to TEXT
ALTER TABLE form_submissions ALTER COLUMN ip_address TYPE TEXT USING ip_address::TEXT;

-- form_draft_sessions: change ip_address from INET to TEXT
ALTER TABLE form_draft_sessions ALTER COLUMN ip_address TYPE TEXT USING ip_address::TEXT;

-- form_audit_logs: change ip_address from INET to TEXT
ALTER TABLE form_audit_logs ALTER COLUMN ip_address TYPE TEXT USING ip_address::TEXT;
