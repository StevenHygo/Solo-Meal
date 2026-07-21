ALTER TABLE restaurants
  ADD COLUMN created_by text NOT NULL DEFAULT 'system:legacy',
  ADD COLUMN updated_by text NOT NULL DEFAULT 'system:legacy',
  ADD COLUMN review_submitted_by text,
  ADD COLUMN review_submitted_at timestamptz,
  ADD COLUMN published_by text,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN withdrawn_by text,
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN status_note text CHECK (status_note IS NULL OR char_length(status_note) <= 500);

UPDATE restaurants
SET published_by = 'system:v0-migration',
    published_at = coalesce(last_verified_at, updated_at)
WHERE publish_status = 'published';

ALTER TABLE poi_candidates
  ADD COLUMN draft_restaurant_id uuid UNIQUE REFERENCES restaurants(id);

CREATE INDEX restaurants_publish_queue_idx
  ON restaurants (publish_status, coverage_area_id, updated_at DESC);

CREATE INDEX poi_candidates_draft_restaurant_idx
  ON poi_candidates (draft_restaurant_id) WHERE draft_restaurant_id IS NOT NULL;
