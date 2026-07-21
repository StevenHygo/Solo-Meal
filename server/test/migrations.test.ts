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
