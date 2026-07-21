CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE coverage_state AS ENUM ('live', 'beta', 'upcoming', 'paused', 'unsupported');
CREATE TYPE coordinate_type AS ENUM ('wgs84', 'gcj02');
CREATE TYPE restaurant_publish_status AS ENUM ('draft', 'review', 'published', 'withdrawn');
CREATE TYPE confidence_level AS ENUM ('low', 'medium', 'high');
CREATE TYPE evidence_status AS ENUM ('candidate', 'published', 'expired', 'rejected');
CREATE TYPE feedback_status AS ENUM ('open', 'triaged', 'resolved', 'rejected');
CREATE TYPE curation_task_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');

CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL,
  timezone text NOT NULL,
  status coverage_state NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coverage_areas (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+$'),
  city_id uuid NOT NULL REFERENCES cities(id),
  name text NOT NULL,
  status coverage_state NOT NULL,
  boundary_wgs84 geography(MultiPolygon, 4326),
  quality_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, name)
);

CREATE TABLE cuisine_categories (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL,
  icon_key text NOT NULL,
  sort_order smallint NOT NULL CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE location_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id),
  coverage_area_id text REFERENCES coverage_areas(id),
  name text NOT NULL,
  detail text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('city', 'district', 'business_area', 'metro_station')),
  sort_order smallint NOT NULL DEFAULT 0,
  search_text text GENERATED ALWAYS AS (lower(name || ' ' || detail)) STORED,
  UNIQUE (city_id, name)
);

CREATE TABLE restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  city_id uuid NOT NULL REFERENCES cities(id),
  coverage_area_id text NOT NULL REFERENCES coverage_areas(id),
  name text NOT NULL,
  address text NOT NULL,
  district text NOT NULL,
  source_coord_type coordinate_type NOT NULL,
  source_lat double precision NOT NULL CHECK (source_lat BETWEEN -90 AND 90),
  source_lng double precision NOT NULL CHECK (source_lng BETWEEN -180 AND 180),
  gcj02_lat double precision CHECK (gcj02_lat BETWEEN -90 AND 90),
  gcj02_lng double precision CHECK (gcj02_lng BETWEEN -180 AND 180),
  location_wgs84 geography(Point, 4326) NOT NULL,
  price_min_fen integer NOT NULL CHECK (price_min_fen >= 0),
  price_max_fen integer NOT NULL CHECK (price_max_fen >= price_min_fen),
  peak_policy text NOT NULL,
  seat_types text[] NOT NULL DEFAULT '{}',
  counter_seats smallint NOT NULL DEFAULT 0 CHECK (counter_seats >= 0),
  solo_portion boolean,
  min_spend_fen integer CHECK (min_spend_fen >= 0),
  meal_minutes_min smallint NOT NULL CHECK (meal_minutes_min > 0),
  meal_minutes_max smallint NOT NULL CHECK (meal_minutes_max >= meal_minutes_min),
  noise_level smallint CHECK (noise_level BETWEEN 1 AND 5),
  dishes text[] NOT NULL DEFAULT '{}',
  operator_note text NOT NULL DEFAULT '',
  publish_status restaurant_publish_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((gcj02_lat IS NULL) = (gcj02_lng IS NULL)),
  CHECK (source_coord_type <> 'gcj02' OR (gcj02_lat IS NOT NULL AND gcj02_lng IS NOT NULL))
);

CREATE TABLE restaurant_cuisines (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  cuisine_code text NOT NULL REFERENCES cuisine_categories(code),
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (restaurant_id, cuisine_code)
);

CREATE UNIQUE INDEX restaurant_one_primary_cuisine_idx
  ON restaurant_cuisines (restaurant_id)
  WHERE is_primary;

CREATE TABLE restaurant_provider_refs (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_poi_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  raw_category text,
  PRIMARY KEY (provider, provider_poi_id),
  UNIQUE (restaurant_id, provider)
);

CREATE TABLE restaurant_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6),
  special_date date,
  opens_at time,
  closes_at time,
  is_closed boolean NOT NULL DEFAULT false,
  crosses_midnight boolean GENERATED ALWAYS AS (
    CASE WHEN opens_at IS NULL OR closes_at IS NULL THEN false ELSE closes_at <= opens_at END
  ) STORED,
  source_label text NOT NULL,
  observed_at timestamptz NOT NULL,
  CHECK ((day_of_week IS NULL) <> (special_date IS NULL)),
  CHECK ((is_closed AND opens_at IS NULL AND closes_at IS NULL) OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL))
);

CREATE UNIQUE INDEX restaurant_weekly_hours_idx
  ON restaurant_hours (restaurant_id, day_of_week, opens_at)
  WHERE special_date IS NULL;

CREATE UNIQUE INDEX restaurant_special_hours_idx
  ON restaurant_hours (restaurant_id, special_date, opens_at)
  WHERE special_date IS NOT NULL;

CREATE TABLE solo_profiles (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  accepts_solo boolean,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence confidence_level NOT NULL,
  scoring_version text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  attribute text NOT NULL,
  title text NOT NULL,
  value jsonb NOT NULL,
  source_type text NOT NULL,
  source_label text NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz,
  status evidence_status NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > observed_at)
);

CREATE TABLE feedback_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES restaurants(id),
  report_type text NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  idempotency_key text NOT NULL UNIQUE,
  status feedback_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE curation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id),
  restaurant_id uuid REFERENCES restaurants(id),
  feedback_report_id uuid REFERENCES feedback_reports(id),
  reason text NOT NULL,
  priority smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  status curation_task_status NOT NULL DEFAULT 'open',
  assignee text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ranking_configs (
  version text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  weights jsonb NOT NULL,
  checksum text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_ranking_config_idx
  ON ranking_configs ((status))
  WHERE status = 'active';

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coverage_areas_city_status_idx ON coverage_areas (city_id, status);
CREATE INDEX coverage_areas_boundary_idx ON coverage_areas USING gist (boundary_wgs84);
CREATE INDEX location_aliases_search_idx ON location_aliases USING gin (search_text gin_trgm_ops);
CREATE INDEX restaurants_location_idx ON restaurants USING gist (location_wgs84);
CREATE INDEX restaurants_city_publish_idx ON restaurants (city_id, publish_status);
CREATE INDEX restaurants_coverage_publish_idx ON restaurants (coverage_area_id, publish_status);
CREATE INDEX restaurants_name_trgm_idx ON restaurants USING gin (name gin_trgm_ops);
CREATE INDEX restaurants_address_trgm_idx ON restaurants USING gin (address gin_trgm_ops);
CREATE INDEX restaurant_cuisines_lookup_idx ON restaurant_cuisines (cuisine_code, restaurant_id);
CREATE INDEX restaurant_hours_lookup_idx ON restaurant_hours (restaurant_id, day_of_week, special_date);
CREATE INDEX evidence_freshness_idx ON evidence (restaurant_id, attribute, status, expires_at);
CREATE INDEX feedback_reports_queue_idx ON feedback_reports (status, created_at);
CREATE INDEX curation_tasks_queue_idx ON curation_tasks (status, priority, due_at);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE processed_at IS NULL;
