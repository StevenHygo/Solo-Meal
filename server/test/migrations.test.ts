import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('initial migration contains the v1 relational and spatial invariants', async () => {
  const migration = await readFile(path.resolve('migrations', '001_initial_schema.up.sql'), 'utf8');
  for (const table of ['cities', 'coverage_areas', 'cuisine_categories', 'restaurants', 'restaurant_cuisines', 'restaurant_hours', 'solo_profiles', 'evidence', 'feedback_reports', 'curation_tasks', 'ranking_configs', 'audit_logs', 'outbox_events']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(migration, /location_wgs84 geography\(Point, 4326\) NOT NULL/);
  assert.match(migration, /restaurants_location_idx ON restaurants USING gist \(location_wgs84\)/);
  assert.match(migration, /restaurant_one_primary_cuisine_idx[\s\S]+WHERE is_primary/);
  assert.match(migration, /gcj02_lat double precision/);
  assert.doesNotMatch(migration, /gcj02[^\n]*geometry\(/i);
  assert.match(migration, /expires_at timestamptz/);
  assert.match(migration, /search_text gin_trgm_ops/);
});

test('initial migration has an explicit rollback pair', async () => {
  const rollback = await readFile(path.resolve('migrations', '001_initial_schema.down.sql'), 'utf8');
  assert.match(rollback, /DROP TABLE IF EXISTS restaurants/);
  assert.match(rollback, /DROP TYPE IF EXISTS coverage_state/);
});

test('feedback operations migration is additive and reversible', async () => {
  const migration = await readFile(path.resolve('migrations', '002_feedback_operations.up.sql'), 'utf8');
  const rollback = await readFile(path.resolve('migrations', '002_feedback_operations.down.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE feedback_reports/);
  assert.match(migration, /ADD COLUMN resolution_note/);
  assert.match(migration, /ALTER TABLE curation_tasks/);
  assert.match(migration, /audit_logs_entity_idx/);
  assert.match(rollback, /DROP INDEX IF EXISTS audit_logs_entity_idx/);
  assert.match(rollback, /DROP COLUMN IF EXISTS resolution_note/);
});

test('POI candidate pipeline records licensed batches and remains reversible', async () => {
  const migration = await readFile(path.resolve('migrations', '003_poi_candidate_pipeline.up.sql'), 'utf8');
  const rollback = await readFile(path.resolve('migrations', '003_poi_candidate_pipeline.down.sql'), 'utf8');
  assert.match(migration, /CREATE TYPE poi_candidate_status/);
  assert.match(migration, /CREATE TABLE poi_import_batches/);
  assert.match(migration, /authorization_basis text NOT NULL/);
  assert.match(migration, /idempotency_key uuid NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE poi_candidates/);
  assert.match(migration, /location_wgs84 geography\(Point, 4326\) NOT NULL/);
  assert.match(migration, /CREATE TABLE poi_import_batch_items/);
  assert.doesNotMatch(migration, /raw_payload/);
  assert.match(rollback, /DROP TABLE IF EXISTS poi_import_batch_items/);
  assert.match(rollback, /DROP TYPE IF EXISTS poi_candidate_status/);
});

test('restaurant publishing migration adds dual-review metadata and a reversible candidate link', async () => {
  const migration = await readFile(path.resolve('migrations', '004_restaurant_publishing.up.sql'), 'utf8');
  const rollback = await readFile(path.resolve('migrations', '004_restaurant_publishing.down.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN review_submitted_by text/);
  assert.match(migration, /ADD COLUMN published_by text/);
  assert.match(migration, /ADD COLUMN withdrawn_by text/);
  assert.match(migration, /ADD COLUMN draft_restaurant_id uuid UNIQUE REFERENCES restaurants\(id\)/);
  assert.match(migration, /CREATE INDEX restaurants_publish_queue_idx/);
  assert.match(rollback, /DROP COLUMN IF EXISTS draft_restaurant_id/);
  assert.match(rollback, /DROP COLUMN IF EXISTS review_submitted_by/);
});
