DO $$
DECLARE
  schedule_constraint_name TEXT;
  run_constraint_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'analytics_audit_schedules'
  ) THEN
    SELECT conname
    INTO schedule_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'analytics_audit_schedules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%provider_preset%';

    IF schedule_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE analytics_audit_schedules DROP CONSTRAINT %I', schedule_constraint_name);
    END IF;

    UPDATE analytics_audit_schedules
    SET provider_preset = 'vertex_auditor'
    WHERE provider_preset <> 'vertex_auditor';

    ALTER TABLE analytics_audit_schedules
      ADD CONSTRAINT analytics_audit_schedules_provider_preset_check
      CHECK (provider_preset IN ('vertex_auditor'));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'analytics_audit_runs'
  ) THEN
    SELECT conname
    INTO run_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'analytics_audit_runs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%provider_preset%';

    IF run_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE analytics_audit_runs DROP CONSTRAINT %I', run_constraint_name);
    END IF;

    UPDATE analytics_audit_runs
    SET provider_preset = 'vertex_auditor'
    WHERE provider_preset <> 'vertex_auditor';

    ALTER TABLE analytics_audit_runs
      ADD CONSTRAINT analytics_audit_runs_provider_preset_check
      CHECK (provider_preset IN ('vertex_auditor'));
  END IF;
END $$;
