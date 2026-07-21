ALTER TABLE feedback_reports
  ADD COLUMN resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500),
  ADD COLUMN resolved_by text;

ALTER TABLE curation_tasks
  ADD COLUMN resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500);

CREATE INDEX feedback_reports_restaurant_status_idx
  ON feedback_reports (restaurant_id, status, created_at DESC);

CREATE INDEX audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id, created_at DESC);
