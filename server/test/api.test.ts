import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { FixtureRepository } from '../src/repositories/fixture-repository.js';

const config: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 8787,
  dataSource: 'fixture',
  databaseUrl: undefined,
  corsOrigins: ['http://127.0.0.1:4173'],
  logLevel: 'silent'
};

const fixedNow = () => new Date('2026-07-21T03:30:00.000Z');

function searchPayload(overrides: Record<string, unknown> = {}) {
  return {
    location: { lat: 31.2231, lng: 121.4452, coord_type: 'gcj02' },
    coverage_area_id: 'sh-jingan-huangpu',
    radius_m: 2500,
    filters: { budget_max_fen: null, cuisine_codes: [], open_now: true, fast_meal: false, only_solo_verified: true },
    sort: 'recommended',
    page_size: 20,
    cursor: null,
    ...overrides
  };
}

test('configuration, city, suggestion, search and detail contracts work together', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  try {
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().source, 'fixture');

    const configuration = await app.inject({ method: 'GET', url: '/api/v1/config' });
    assert.equal(configuration.statusCode, 200);
    assert.equal(configuration.json().cuisines.length, 16);
    assert.equal(configuration.json().ranking_version, 'v1-beta.1');

    const cityResponse = await app.inject({ method: 'GET', url: '/api/v1/cities' });
    assert.equal(cityResponse.json().cities.length, 4);

    const suggestions = await app.inject({ method: 'GET', url: '/api/v1/locations/suggest?q=北京' });
    assert.deepEqual(suggestions.json().suggestions.map((item: { label: string }) => item.label), ['国贸']);

    const search = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload() });
    assert.equal(search.statusCode, 200);
    const body = search.json();
    assert.equal(body.coverage_status, 'beta');
    assert.equal(body.results.length, 5);
    assert.equal(body.results[0].legacy_id, 'r001');
    assert.deepEqual(new Set(body.results.map((item: { legacy_id: string }) => item.legacy_id)), new Set(['r001', 'r002', 'r003', 'r004', 'r006']));
    assert.ok(body.results.every((item: { open_now: boolean }) => item.open_now));

    const detail = await app.inject({ method: 'GET', url: '/api/v1/restaurants/r001' });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().restaurant.id, '10000000-0000-4000-8000-000000000001');
    assert.equal(detail.json().restaurant.evidence.length, 3);
    assert.equal(detail.json().restaurant.primary_cuisine_code, 'noodles');
  } finally {
    await app.close();
  }
});

test('search filters, coverage states and cursor pagination are deterministic', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  try {
    const cuisine = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload({
      filters: { budget_max_fen: 6000, cuisine_codes: ['noodles'], open_now: false, fast_meal: false, only_solo_verified: true }
    }) });
    assert.deepEqual(cuisine.json().results.map((item: { legacy_id: string }) => item.legacy_id), ['r001']);

    const firstPage = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload({
      filters: { budget_max_fen: null, cuisine_codes: [], open_now: false, fast_meal: false, only_solo_verified: true }, page_size: 2
    }) });
    const firstBody = firstPage.json();
    assert.equal(firstBody.results.length, 2);
    assert.equal(typeof firstBody.next_cursor, 'string');
    const secondPage = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload({
      filters: { budget_max_fen: null, cuisine_codes: [], open_now: false, fast_meal: false, only_solo_verified: true },
      page_size: 2, cursor: firstBody.next_cursor
    }) });
    const secondBody = secondPage.json();
    assert.equal(secondBody.results.length, 2);
    assert.equal(new Set([...firstBody.results, ...secondBody.results].map((item: { id: string }) => item.id)).size, 4);

    const upcoming = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload({ coverage_area_id: 'bj-guomao' }) });
    assert.equal(upcoming.statusCode, 200);
    assert.equal(upcoming.json().coverage_status, 'upcoming');
    assert.deepEqual(upcoming.json().results, []);
  } finally {
    await app.close();
  }
});

test('validation and missing resources return stable error codes', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  try {
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: { coverage_area_id: 'x' } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'INVALID_REQUEST');

    const missingArea = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload({ coverage_area_id: 'missing' }) });
    assert.equal(missingArea.statusCode, 404);
    assert.equal(missingArea.json().error.code, 'COVERAGE_AREA_NOT_FOUND');

    const missingRestaurant = await app.inject({ method: 'GET', url: '/api/v1/restaurants/missing' });
    assert.equal(missingRestaurant.statusCode, 404);
    assert.equal(missingRestaurant.json().error.code, 'RESTAURANT_NOT_FOUND');
  } finally {
    await app.close();
  }
});
