-- Migration: Relax user-id foreign keys that block client deletion
--
-- Nine tables reference users(id) with no ON DELETE action, which blocks
-- DELETE FROM users with a 23503 foreign-key violation whenever the target
-- user has any referencing row. This manifested in production as a 500 on
-- DELETE /api/hub/clients/:id for clients with CTM forms (ctm_forms.org_id)
-- or who had triggered / authored audit-style records.
--
-- Policy:
--   • Owner/data columns -> ON DELETE CASCADE  (the row is the client's data)
--   • Audit columns (created_by / applied_by / triggered_by) -> ON DELETE SET NULL
--     (keep the historical row so the action still shows in logs; just forget who)
--
-- Idempotent: each constraint is dropped (IF EXISTS) and re-added.

BEGIN;

-- ---------- CASCADE: owner-style references ----------

ALTER TABLE ctm_forms
  DROP CONSTRAINT IF EXISTS ctm_forms_org_id_fkey,
  ADD CONSTRAINT ctm_forms_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES users(id) ON DELETE CASCADE;

-- ---------- SET NULL: audit-style references ----------

ALTER TABLE tracking_provisioning_jobs
  DROP CONSTRAINT IF EXISTS tracking_provisioning_jobs_triggered_by_fkey,
  ADD CONSTRAINT tracking_provisioning_jobs_triggered_by_fkey
    FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE task_label_definitions
  DROP CONSTRAINT IF EXISTS task_label_definitions_created_by_fkey,
  ADD CONSTRAINT task_label_definitions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE task_item_labels
  DROP CONSTRAINT IF EXISTS task_item_labels_applied_by_fkey,
  ADD CONSTRAINT task_item_labels_applied_by_fkey
    FOREIGN KEY (applied_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE task_item_dependencies
  DROP CONSTRAINT IF EXISTS task_item_dependencies_created_by_fkey,
  ADD CONSTRAINT task_item_dependencies_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE task_recurrence_rules
  DROP CONSTRAINT IF EXISTS task_recurrence_rules_created_by_fkey,
  ADD CONSTRAINT task_recurrence_rules_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE task_dashboards
  DROP CONSTRAINT IF EXISTS task_dashboards_created_by_fkey,
  ADD CONSTRAINT task_dashboards_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE task_subitem_dependencies
  DROP CONSTRAINT IF EXISTS task_subitem_dependencies_created_by_fkey,
  ADD CONSTRAINT task_subitem_dependencies_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE analytics_report_templates
  DROP CONSTRAINT IF EXISTS analytics_report_templates_created_by_fkey,
  ADD CONSTRAINT analytics_report_templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
