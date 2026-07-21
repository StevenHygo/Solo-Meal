DROP INDEX IF EXISTS poi_candidates_draft_restaurant_idx;
DROP INDEX IF EXISTS restaurants_publish_queue_idx;

ALTER TABLE poi_candidates
  DROP COLUMN IF EXISTS draft_restaurant_id;

ALTER TABLE restaurants
  DROP COLUMN IF EXISTS status_note,
  DROP COLUMN IF EXISTS withdrawn_at,
  DROP COLUMN IF EXISTS withdrawn_by,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS review_submitted_at,
  DROP COLUMN IF EXISTS review_submitted_by,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS created_by;
