CREATE TYPE poi_candidate_status AS ENUM ('pending', 'matched', 'new_branch', 'rejected');

CREATE TABLE poi_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_area_id text NOT NULL REFERENCES coverage_areas(id),
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  source_label text NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 120),
  authorization_basis text NOT NULL CHECK (char_length(authorization_basis) BETWEEN 10 AND 500),
  idempotency_key uuid NOT NULL UNIQUE,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  input_count smallint NOT NULL CHECK (input_count BETWEEN 1 AND 50),
  created_count smallint NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count smallint NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  exact_match_count smallint NOT NULL DEFAULT 0 CHECK (exact_match_count >= 0),
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poi_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  provider_poi_id text NOT NULL CHECK (char_length(provider_poi_id) BETWEEN 1 AND 128),
  coverage_area_id text NOT NULL REFERENCES coverage_areas(id),
  last_batch_id uuid NOT NULL REFERENCES poi_import_batches(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  address text NOT NULL CHECK (char_length(address) BETWEEN 1 AND 300),
  district text NOT NULL CHECK (char_length(district) BETWEEN 1 AND 80),
  source_coord_type coordinate_type NOT NULL,
  source_lat double precision NOT NULL CHECK (source_lat BETWEEN -90 AND 90),
  source_lng double precision NOT NULL CHECK (source_lng BETWEEN -180 AND 180),
  gcj02_lat double precision CHECK (gcj02_lat BETWEEN -90 AND 90),
  gcj02_lng double precision CHECK (gcj02_lng BETWEEN -180 AND 180),
  location_wgs84 geography(Point, 4326) NOT NULL,
  phone_normalized text CHECK (phone_normalized IS NULL OR char_length(phone_normalized) BETWEEN 5 AND 24),
  raw_category text CHECK (raw_category IS NULL OR char_length(raw_category) <= 120),
  observed_at timestamptz NOT NULL,
  status poi_candidate_status NOT NULL DEFAULT 'pending',
  matched_restaurant_id uuid REFERENCES restaurants(id),
  suggested_restaurant_id uuid REFERENCES restaurants(id),
  suggestion_score numeric(5,4) CHECK (suggestion_score BETWEEN 0 AND 1),
  match_method text CHECK (match_method IS NULL OR match_method IN ('provider_ref', 'name_address_distance', 'operator')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500),
  reviewed_by text,
  reviewed_at timestamptz,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_poi_id),
  CHECK ((gcj02_lat IS NULL) = (gcj02_lng IS NULL)),
  CHECK (source_coord_type <> 'gcj02' OR (gcj02_lat IS NOT NULL AND gcj02_lng IS NOT NULL)),
  CHECK (status <> 'matched' OR matched_restaurant_id IS NOT NULL)
);

CREATE TABLE poi_import_batch_items (
  batch_id uuid NOT NULL REFERENCES poi_import_batches(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES poi_candidates(id),
  provider_poi_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'exact_match')),
  PRIMARY KEY (batch_id, candidate_id)
);

CREATE INDEX poi_import_batches_area_created_idx
  ON poi_import_batches (coverage_area_id, created_at DESC);
CREATE INDEX poi_candidates_queue_idx
  ON poi_candidates (status, coverage_area_id, last_seen_at DESC);
CREATE INDEX poi_candidates_location_idx
  ON poi_candidates USING gist (location_wgs84);
CREATE INDEX poi_candidates_suggestion_idx
  ON poi_candidates (suggested_restaurant_id) WHERE suggested_restaurant_id IS NOT NULL;
