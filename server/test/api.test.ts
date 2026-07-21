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
  feedbackApiEnabled: true,
  adminApiToken: 'test-admin-token-with-at-least-32-characters',
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
    assert.equal(configuration.json().features.feedback_api, true);
    assert.equal(configuration.json().features.operations_api, true);

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

    const invalidFeedback = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback-reports',
      payload: {
        restaurant_id: 'r001', report_type: 'other', note: 'invalid\u0000note',
        idempotency_key: '08cc2589-2dbf-4aac-82e8-533e30f0f7c9'
      }
    });
    assert.equal(invalidFeedback.statusCode, 400);
    assert.equal(invalidFeedback.json().error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
  }
});

test('feedback creates one review task and replays idempotently', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  const payload = {
    restaurant_id: 'r001',
    report_type: 'hours_incorrect',
    note: '周二午后没有营业',
    idempotency_key: 'a6ad05eb-5ab7-47c7-9494-817f3635aee6'
  };
  const authorization = `Bearer ${config.adminApiToken}`;
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/feedback-reports', payload });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().report.status, 'open');
    assert.equal(created.json().idempotent_replay, false);

    const replay = await app.inject({ method: 'POST', url: '/api/v1/feedback-reports', payload });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().report.id, created.json().report.id);
    assert.equal(replay.json().report.task_id, created.json().report.task_id);
    assert.equal(replay.json().idempotent_replay, true);

    const reused = await app.inject({ method: 'POST', url: '/api/v1/feedback-reports', payload: { ...payload, note: '不同内容' } });
    assert.equal(reused.statusCode, 409);
    assert.equal(reused.json().error.code, 'IDEMPOTENCY_KEY_REUSED');

    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/admin/tasks' });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error.code, 'ADMIN_UNAUTHORIZED');

    const taskList = await app.inject({ method: 'GET', url: '/api/v1/admin/tasks?status=open', headers: { authorization } });
    assert.equal(taskList.statusCode, 200);
    assert.equal(taskList.json().tasks.length, 1);
    const task = taskList.json().tasks[0];
    assert.equal(task.feedback.report_type, 'hours_incorrect');
    assert.equal(task.restaurant.legacy_id, 'r001');
    assert.equal(task.priority, 1);

    const started = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tasks/${task.id}`,
      headers: { authorization, 'x-operator-id': 'operator.test' },
      payload: { status: 'in_progress', assignee: 'operator.test' }
    });
    assert.equal(started.statusCode, 200);
    assert.equal(started.json().task.status, 'in_progress');
    assert.equal(started.json().task.feedback.status, 'triaged');

    const competingClaim = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tasks/${task.id}`,
      headers: { authorization, 'x-operator-id': 'operator.other' },
      payload: { status: 'in_progress', assignee: 'operator.other' }
    });
    assert.equal(competingClaim.statusCode, 409);
    assert.equal(competingClaim.json().error.code, 'TASK_ALREADY_CLAIMED');

    const released = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tasks/${task.id}`,
      headers: { authorization, 'x-operator-id': 'operator.test' },
      payload: { status: 'open', assignee: null }
    });
    assert.equal(released.statusCode, 200);
    assert.equal(released.json().task.status, 'open');
    assert.equal(released.json().task.assignee, null);

    const restarted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tasks/${task.id}`,
      headers: { authorization, 'x-operator-id': 'operator.test' },
      payload: { status: 'in_progress' }
    });
    assert.equal(restarted.statusCode, 200);
    assert.equal(restarted.json().task.assignee, 'operator.test');

    const missingResolution = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tasks/${task.id}`,
      headers: { authorization },
      payload: { status: 'completed' }
    });
    assert.equal(missingResolution.statusCode, 400);
    assert.equal(missingResolution.json().error.code, 'INVALID_REQUEST');

    const completed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tasks/${task.id}`,
      headers: { authorization, 'x-operator-id': 'operator.test' },
      payload: { status: 'completed', resolution_note: '电话复核后已修正营业时间', feedback_status: 'resolved' }
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().task.status, 'completed');
    assert.equal(completed.json().task.feedback.status, 'resolved');

    const invalidTransition = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tasks/${task.id}`,
      headers: { authorization },
      payload: { status: 'open' }
    });
    assert.equal(invalidTransition.statusCode, 409);
    assert.equal(invalidTransition.json().error.code, 'INVALID_TASK_TRANSITION');
  } finally {
    await app.close();
  }
});

test('feedback remains disabled unless explicitly enabled', async () => {
  const disabledConfig: AppConfig = { ...config, feedbackApiEnabled: false };
  const app = await createApp({ config: disabledConfig, repository: new FixtureRepository(), clock: fixedNow });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback-reports',
      payload: {
        restaurant_id: 'r001', report_type: 'other', note: '',
        idempotency_key: '184a33ee-d589-4182-a080-31eb44cc5c98'
      }
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'FEEDBACK_API_DISABLED');
  } finally {
    await app.close();
  }
});

test('operator API remains disabled unless an admin token is configured', async () => {
  const disabledConfig: AppConfig = { ...config, adminApiToken: undefined };
  const app = await createApp({ config: disabledConfig, repository: new FixtureRepository(), clock: fixedNow });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/tasks' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'ADMIN_API_DISABLED');
  } finally {
    await app.close();
  }
});

test('evidence sweep is protected, idempotent and creates one task per restaurant', async () => {
  const sweepNow = () => new Date('2026-11-01T03:30:00.000Z');
  const app = await createApp({ config, repository: new FixtureRepository(), clock: sweepNow });
  const authorization = `Bearer ${config.adminApiToken}`;
  try {
    const unauthorized = await app.inject({ method: 'POST', url: '/api/v1/admin/evidence/sweep' });
    assert.equal(unauthorized.statusCode, 401);

    const first = await app.inject({
      method: 'POST', url: '/api/v1/admin/evidence/sweep',
      headers: { authorization, 'x-operator-id': 'operator.test' }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().result.expired_evidence, 17);
    assert.equal(first.json().result.created_tasks, 6);

    const second = await app.inject({
      method: 'POST', url: '/api/v1/admin/evidence/sweep',
      headers: { authorization, 'x-operator-id': 'operator.test' }
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().result.expired_evidence, 0);
    assert.equal(second.json().result.created_tasks, 0);

    const tasks = await app.inject({ method: 'GET', url: '/api/v1/admin/tasks?status=open', headers: { authorization } });
    assert.equal(tasks.json().tasks.length, 6);
    assert.ok(tasks.json().tasks.every((task: { reason: string }) => task.reason === 'evidence_expired'));
  } finally {
    await app.close();
  }
});
