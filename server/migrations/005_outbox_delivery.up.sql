ALTER TABLE outbox_events
  ADD COLUMN status text NOT NULL DEFAULT 'pending',
  ADD COLUMN last_error text,
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN locked_by text,
  ADD COLUMN locked_at timestamptz,
  ADD CONSTRAINT outbox_events_status_check
    CHECK (status IN ('pending', 'processing', 'failed', 'processed'));

UPDATE outbox_events
SET status = 'processed'
WHERE processed_at IS NOT NULL;

DROP INDEX IF EXISTS outbox_pending_idx;

CREATE INDEX outbox_delivery_queue_idx
  ON outbox_events (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX outbox_failed_queue_idx
  ON outbox_events (failed_at DESC, created_at DESC)
  WHERE status = 'failed';

CREATE INDEX outbox_processing_lease_idx
  ON outbox_events (locked_at)
  WHERE status = 'processing';
