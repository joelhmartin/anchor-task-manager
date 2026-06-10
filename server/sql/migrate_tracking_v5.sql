-- v5: relax tracking_campaign_claims.claimed_by FK so deleting the acting
-- admin doesn't cascade-block. Audit trail retains the target_user_id in
-- security_audit_log.details either way.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'tracking_campaign_claims_claimed_by_fkey'
  ) THEN
    ALTER TABLE tracking_campaign_claims
      DROP CONSTRAINT tracking_campaign_claims_claimed_by_fkey;
  END IF;
END $$;

ALTER TABLE tracking_campaign_claims
  ADD CONSTRAINT tracking_campaign_claims_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL;
