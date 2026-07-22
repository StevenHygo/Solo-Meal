DROP INDEX IF EXISTS outbox_processing_lease_idx;
DROP INDEX IF EXISTS outbox_failed_queue_idx;
DROP INDEX IF EXISTS outbox_delivery_queue_idx;

ALTER TABLE outbox_events
  DROP CONSTRAINT IF EXISTS outbox_events_status_check,
  DROP COLUMN IF EXISTS locked_at,
  DROP COLUMN IF EXISTS locked_by,
  DROP COLUMN IF EXISTS failed_at,
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS status;

CREATE INDEX outbox_pending_idx
  ON outbox_events (available_at)
  WHERE processed_at IS NULL;
