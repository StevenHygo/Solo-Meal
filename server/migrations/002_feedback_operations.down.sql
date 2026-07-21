DROP INDEX IF EXISTS audit_logs_entity_idx;
DROP INDEX IF EXISTS feedback_reports_restaurant_status_idx;

ALTER TABLE curation_tasks DROP COLUMN IF EXISTS resolution_note;

ALTER TABLE feedback_reports
  DROP COLUMN IF EXISTS resolved_by,
  DROP COLUMN IF EXISTS resolution_note;
