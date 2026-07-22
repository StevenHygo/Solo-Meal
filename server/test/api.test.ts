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

test('CORS preflight allows browser draft updates with PUT', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  try {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/admin/restaurants/51000000-0000-4000-8000-000000000001/draft',
      headers: {
        origin: 'http://127.0.0.1:4173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type,x-operator-id'
      }
    });
    assert.equal(response.statusCode, 204);
    assert.match(response.headers['access-control-allow-methods'] ?? '', /PUT/);
    assert.match(response.headers['access-control-expose-headers'] ?? '', /Content-Disposition/i);
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
      headers: { authorization, 'x-operator-id': 'operator.test' },
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

test('POI import requires operator authorization and source authorization metadata', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  const payload = {
    coverage_area_id: 'sh-jingan-huangpu',
    provider: 'licensed_map',
    source_label: '地图合作方导出 2026-07-20',
    authorization_basis: '测试环境授权数据，仅用于候选去重契约验证',
    idempotency_key: '4a73a91b-d280-46cb-8937-b299fa0dfe51',
    candidates: [{
      provider_poi_id: 'auth-check-001', name: '授权检查', address: '测试路 1 号', district: '静安寺',
      location: { lat: 31.2231, lng: 121.4452, coord_type: 'gcj02' },
      observed_at: '2026-07-20T04:00:00.000Z'
    }]
  };
  try {
    const unauthorized = await app.inject({ method: 'POST', url: '/api/v1/admin/poi/imports', payload });
    assert.equal(unauthorized.statusCode, 401);
    const missingOperator = await app.inject({
      method: 'POST', url: '/api/v1/admin/poi/imports',
      headers: { authorization: `Bearer ${config.adminApiToken}` }, payload
    });
    assert.equal(missingOperator.statusCode, 400);
    const invalid = await app.inject({
      method: 'POST', url: '/api/v1/admin/poi/imports',
      headers: { authorization: `Bearer ${config.adminApiToken}`, 'x-operator-id': 'operator.poi' },
      payload: { ...payload, authorization_basis: '' }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
  }
});

test('authorized POI imports remain candidates until an operator resolves deduplication', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  const authorization = `Bearer ${config.adminApiToken}`;
  const headers = { authorization, 'x-operator-id': 'operator.poi' };
  const payload = {
    coverage_area_id: 'sh-jingan-huangpu',
    provider: 'licensed_map',
    source_label: '地图合作方导出 2026-07-20',
    authorization_basis: '测试环境授权数据，仅用于候选去重契约验证',
    idempotency_key: '91e9bc53-c812-43f6-a17d-595609d46f02',
    candidates: [
      {
        provider_poi_id: 'map-poi-001',
        name: '杉木面所',
        address: '华山路 388 号 B1 层',
        district: '静安寺',
        location: { lat: 31.2231, lng: 121.4452, coord_type: 'gcj02' },
        phone: '021-5555-0101',
        raw_category: '面馆',
        observed_at: '2026-07-20T04:00:00.000Z'
      },
      {
        provider_poi_id: 'map-poi-002',
        name: '待核验新分店',
        address: '测试路 18 号',
        district: '静安寺',
        location: { lat: 31.218, lng: 121.438, coord_type: 'gcj02' },
        raw_category: '简餐',
        observed_at: '2026-07-20T04:00:00.000Z'
      }
    ]
  };
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/poi/imports', headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().batch.input_count, 2);
    assert.equal(created.json().batch.created_count, 2);
    assert.equal(created.json().batch.exact_match_count, 0);
    assert.equal(created.json().idempotent_replay, false);

    const replay = await app.inject({ method: 'POST', url: '/api/v1/admin/poi/imports', headers, payload });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().batch.id, created.json().batch.id);
    assert.equal(replay.json().idempotent_replay, true);

    const conflict = await app.inject({
      method: 'POST', url: '/api/v1/admin/poi/imports', headers,
      payload: { ...payload, source_label: '不同导入内容' }
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'POI_IDEMPOTENCY_KEY_REUSED');

    const pending = await app.inject({
      method: 'GET', url: '/api/v1/admin/poi/candidates?status=pending&coverage_area_id=sh-jingan-huangpu', headers
    });
    assert.equal(pending.statusCode, 200);
    assert.equal(pending.json().candidates.length, 2);
    const duplicate = pending.json().candidates.find((item: { provider_poi_id: string }) => item.provider_poi_id === 'map-poi-001');
    const newBranch = pending.json().candidates.find((item: { provider_poi_id: string }) => item.provider_poi_id === 'map-poi-002');
    assert.equal(duplicate.suggested_restaurant.legacy_id, 'r001');
    assert.equal(duplicate.match_method, 'name_address_distance');
    assert.equal(duplicate.location.source.coord_type, 'gcj02');
    assert.notEqual(duplicate.location.source.lng, duplicate.location.wgs84.lng);

    const matched = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/poi/candidates/${duplicate.id}`, headers,
      payload: { decision: 'match_existing', restaurant_id: 'r001', resolution_note: 'Provider ID、名称、地址与坐标一致' }
    });
    assert.equal(matched.statusCode, 200);
    assert.equal(matched.json().candidate.status, 'matched');
    assert.equal(matched.json().candidate.matched_restaurant.legacy_id, 'r001');

    const acceptedNewBranch = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/poi/candidates/${newBranch.id}`, headers,
      payload: { decision: 'new_branch', resolution_note: '未发现重复分店，进入字段核验阶段' }
    });
    assert.equal(acceptedNewBranch.statusCode, 200);
    assert.equal(acceptedNewBranch.json().candidate.status, 'new_branch');

    const providerSlotConflict = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/poi/candidates/${newBranch.id}`, headers,
      payload: { decision: 'match_existing', restaurant_id: 'r001', resolution_note: '同一 Provider 的分店映射冲突' }
    });
    assert.equal(providerSlotConflict.statusCode, 409);
    assert.equal(providerSlotConflict.json().error.code, 'PROVIDER_REF_CONFLICT');

    const invalidTransition = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/poi/candidates/${duplicate.id}`, headers,
      payload: { decision: 'reject', resolution_note: '不能覆盖已确认的 Provider 映射' }
    });
    assert.equal(invalidTransition.statusCode, 409);
    assert.equal(invalidTransition.json().error.code, 'INVALID_POI_CANDIDATE_TRANSITION');

    const exactReplay = await app.inject({
      method: 'POST', url: '/api/v1/admin/poi/imports', headers,
      payload: {
        ...payload,
        idempotency_key: '0ba94990-8bdf-4657-9043-fbf6a402e947',
        candidates: [payload.candidates[0]]
      }
    });
    assert.equal(exactReplay.statusCode, 201);
    assert.equal(exactReplay.json().batch.updated_count, 1);
    assert.equal(exactReplay.json().batch.exact_match_count, 1);

    const search = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload() });
    assert.equal(search.statusCode, 200);
    assert.equal(search.json().results.length, 5);
    assert.equal(search.json().results.some((item: { name: string }) => item.name === '待核验新分店'), false);
  } finally {
    await app.close();
  }
});

test('new branch draft requires valid evidence and a second operator before publication', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  const editorHeaders = {
    authorization: `Bearer ${config.adminApiToken}`,
    'x-operator-id': 'operator.editor'
  };
  const reviewerHeaders = {
    authorization: `Bearer ${config.adminApiToken}`,
    'x-operator-id': 'operator.reviewer'
  };
  const draftPayload = {
    name: '青禾单人食堂',
    address: '常熟路 88 号',
    district: '静安寺',
    cuisine_codes: ['rice_meal'],
    primary_cuisine_code: 'rice_meal',
    price_min_fen: 2800,
    price_max_fen: 4600,
    accepts_solo: true,
    peak_policy: '午餐高峰可排队取餐，单人无需拼桌',
    seat_types: ['吧台', '双人桌'],
    counter_seats: 8,
    solo_portion: true,
    min_spend_fen: null,
    meal_minutes: { min: 20, max: 35 },
    noise_level: 2,
    hours: Array.from({ length: 7 }, (_, day) => ({ day_of_week: day, opens_at: '10:00', closes_at: '22:00' })),
    dishes: ['照烧鸡饭', '番茄牛腩饭'],
    note: '本地发布流程回归样例。',
    evidence: [{
      attribute: 'accepts_solo',
      title: '单人接待',
      value: '店员确认全天接待单人，无需拼桌',
      source_type: 'operator_call',
      source_label: '运营电话核验',
      observed_at: '2026-07-20T04:00:00.000Z',
      expires_at: '2026-10-20T04:00:00.000Z'
    }]
  };
  try {
    const imported = await app.inject({
      method: 'POST', url: '/api/v1/admin/poi/imports', headers: editorHeaders,
      payload: {
        coverage_area_id: 'sh-jingan-huangpu',
        provider: 'licensed_map',
        source_label: '发布流程授权样例',
        authorization_basis: '测试环境授权数据，仅用于发布状态机回归',
        idempotency_key: '1421ed55-408f-4c70-88e1-59a599d660f2',
        candidates: [{
          provider_poi_id: 'publish-flow-001', name: draftPayload.name, address: draftPayload.address,
          district: draftPayload.district,
          location: { lat: 31.221, lng: 121.449, coord_type: 'gcj02' },
          raw_category: '盖饭', observed_at: '2026-07-20T04:00:00.000Z'
        }]
      }
    });
    assert.equal(imported.statusCode, 201);
    const pending = await app.inject({
      method: 'GET', url: '/api/v1/admin/poi/candidates?status=pending', headers: editorHeaders
    });
    const candidate = pending.json().candidates.find((item: { provider_poi_id: string }) => item.provider_poi_id === 'publish-flow-001');
    assert.ok(candidate);
    const newBranch = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/poi/candidates/${candidate.id}`, headers: editorHeaders,
      payload: { decision: 'new_branch', resolution_note: '未发现重复分店，进入核心字段核验' }
    });
    assert.equal(newBranch.statusCode, 200);

    const created = await app.inject({
      method: 'POST', url: `/api/v1/admin/poi/candidates/${candidate.id}/draft`,
      headers: editorHeaders, payload: draftPayload
    });
    assert.equal(created.statusCode, 201, created.body);
    const restaurantId = created.json().restaurant.id;
    assert.equal(created.json().restaurant.status, 'draft');
    assert.equal(created.json().restaurant.fields.evidence[0].status, 'candidate');

    const invalidCandidateRewrite = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/poi/candidates/${candidate.id}`, headers: editorHeaders,
      payload: { decision: 'reject', resolution_note: '草稿建立后不能从候选队列改写状态' }
    });
    assert.equal(invalidCandidateRewrite.statusCode, 409);
    assert.equal(invalidCandidateRewrite.json().error.code, 'POI_CANDIDATE_DRAFT_IN_PROGRESS');

    const beforePublish = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload() });
    assert.equal(beforePublish.json().results.some((item: { id: string }) => item.id === restaurantId), false);

    const updated = await app.inject({
      method: 'PUT', url: `/api/v1/admin/restaurants/${restaurantId}/draft`, headers: editorHeaders,
      payload: { ...draftPayload, price_max_fen: 4800 }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().restaurant.version, 2);
    assert.equal(updated.json().restaurant.fields.price.max_fen, 4800);

    const submitted = await app.inject({
      method: 'POST', url: `/api/v1/admin/restaurants/${restaurantId}/transitions`, headers: editorHeaders,
      payload: { action: 'submit_review', note: '核心字段和单人接待证据已核验' }
    });
    assert.equal(submitted.statusCode, 200);
    assert.equal(submitted.json().restaurant.status, 'review');

    const selfPublish = await app.inject({
      method: 'POST', url: `/api/v1/admin/restaurants/${restaurantId}/transitions`, headers: editorHeaders,
      payload: { action: 'publish', note: '尝试由提交人自行发布应被拒绝' }
    });
    assert.equal(selfPublish.statusCode, 409);
    assert.equal(selfPublish.json().error.code, 'SECOND_REVIEWER_REQUIRED');

    const published = await app.inject({
      method: 'POST', url: `/api/v1/admin/restaurants/${restaurantId}/transitions`, headers: reviewerHeaders,
      payload: { action: 'publish', note: '二次审核通过，允许进入公开搜索' }
    });
    assert.equal(published.statusCode, 200, published.body);
    assert.equal(published.json().restaurant.status, 'published');
    assert.equal(published.json().restaurant.fields.evidence[0].status, 'published');
    assert.equal(published.json().restaurant.workflow.published_by, 'operator.reviewer');

    const afterPublish = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload() });
    assert.equal(afterPublish.json().results.some((item: { id: string }) => item.id === restaurantId), true);
    const detail = await app.inject({ method: 'GET', url: `/api/v1/restaurants/${restaurantId}` });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().restaurant.evidence[0].source_type, 'operator_call');

    const matched = await app.inject({
      method: 'GET', url: '/api/v1/admin/poi/candidates?status=matched', headers: reviewerHeaders
    });
    const publishedCandidate = matched.json().candidates.find((item: { id: string }) => item.id === candidate.id);
    assert.equal(publishedCandidate.matched_restaurant.id, restaurantId);
    assert.equal(publishedCandidate.draft_restaurant.status, 'published');

    const withdrawn = await app.inject({
      method: 'POST', url: `/api/v1/admin/restaurants/${restaurantId}/transitions`, headers: reviewerHeaders,
      payload: { action: 'withdraw', note: '回归验证撤回后立即退出公开搜索' }
    });
    assert.equal(withdrawn.statusCode, 200);
    assert.equal(withdrawn.json().restaurant.status, 'withdrawn');
    const afterWithdraw = await app.inject({ method: 'POST', url: '/api/v1/restaurants/search', payload: searchPayload() });
    assert.equal(afterWithdraw.json().results.some((item: { id: string }) => item.id === restaurantId), false);
  } finally {
    await app.close();
  }
});

test('coverage quality report blocks fixture and missing manual evidence from promotion', async () => {
  const app = await createApp({ config, repository: new FixtureRepository(), clock: fixedNow });
  const headers = {
    authorization: `Bearer ${config.adminApiToken}`,
    'x-operator-id': 'operator.quality'
  };
  try {
    const response = await app.inject({
      method: 'GET', url: '/api/v1/admin/coverage/sh-jingan-huangpu/quality', headers
    });
    assert.equal(response.statusCode, 200);
    const quality = response.json().quality;
    assert.equal(quality.area.status, 'beta');
    assert.equal(quality.metrics.published_restaurants, 6);
    assert.equal(quality.metrics.provider_reference_rate, 0);
    assert.equal(quality.metrics.search_sample_coverage_rate, null);
    assert.equal(quality.gates.beta.policyVersion, 'coverage-beta-v1');
    assert.equal(quality.gates.beta.eligible, false);
    assert.equal(quality.gates.live.eligible, false);
    assert.ok(quality.gates.beta.checks.some((check: { code: string; passed: boolean }) => check.code === 'provider_terms' && !check.passed));

    const updated = await app.inject({
      method: 'PATCH', url: '/api/v1/admin/coverage/sh-jingan-huangpu/quality', headers,
      payload: {
        search_sample_coverage_rate: 0.8,
        branch_mismatch_rate: 0.01,
        visit_conformity_rate: 0.75,
        incident_free_weeks: 2,
        provider_terms_reviewed: true,
        privacy_reviewed: true,
        postgis_rehearsal_passed: true,
        evidence_note: '测试样本、评审记录和演练记录均已归档'
      }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().quality.metrics.search_sample_coverage_rate, 0.8);
    assert.equal(updated.json().quality.metrics.provider_terms_reviewed, true);
    assert.equal(updated.json().quality.gates.beta.eligible, false);

    const invalidUpdate = await app.inject({
      method: 'PATCH', url: '/api/v1/admin/coverage/sh-jingan-huangpu/quality', headers,
      payload: { evidence_note: '只有说明但没有指标' }
    });
    assert.equal(invalidUpdate.statusCode, 400);

    const upcoming = await app.inject({
      method: 'GET', url: '/api/v1/admin/coverage/sh-xujiahui/quality', headers
    });
    assert.equal(upcoming.statusCode, 200);
    assert.equal(upcoming.json().quality.area.status, 'upcoming');
    assert.equal(upcoming.json().quality.metrics.published_restaurants, 0);

    const cities = await app.inject({ method: 'GET', url: '/api/v1/cities' });
    const xujiahui = cities.json().cities
      .find((city: { code: string }) => city.code === 'shanghai').areas
      .find((area: { id: string }) => area.id === 'sh-xujiahui');
    assert.equal(xujiahui.status, 'upcoming');
  } finally {
    await app.close();
  }
});

test('operations API exposes audit, delivery retry and bounded CSV exports', async () => {
  const repository = new FixtureRepository();
  const app = await createApp({ config, repository, clock: fixedNow });
  const headers = {
    authorization: `Bearer ${config.adminApiToken}`,
    'x-operator-id': 'operator.delivery'
  };
  try {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/feedback-reports',
      payload: {
        restaurant_id: 'r001', report_type: 'hours_incorrect', note: '周二午后没有营业',
        idempotency_key: '7420ad5e-678a-4dfb-a2a0-c423c93554d5'
      }
    });
    assert.equal(created.statusCode, 201);

    const pending = await app.inject({
      method: 'GET', url: '/api/v1/admin/outbox-events?status=pending', headers
    });
    assert.equal(pending.statusCode, 200);
    assert.equal(pending.json().outbox_events.length, 1);
    const eventId = pending.json().outbox_events[0].id;
    const claimed = await repository.claimOutboxEvents({
      workerId: 'worker-test', claimedAt: fixedNow(),
      leaseExpiredBefore: new Date(fixedNow().getTime() - 60000), limit: 1
    });
    assert.equal(claimed[0]?.id, eventId);
    await repository.failOutboxEvent({
      eventId, workerId: 'worker-test', error: 'WEBHOOK_HTTP_503', failedAt: fixedNow(),
      nextAvailableAt: fixedNow(), maxAttempts: 1
    });

    const failed = await app.inject({
      method: 'GET', url: '/api/v1/admin/outbox-events?status=failed', headers
    });
    assert.equal(failed.json().outbox_events[0].last_error, 'WEBHOOK_HTTP_503');
    const retried = await app.inject({
      method: 'POST', url: `/api/v1/admin/outbox-events/${eventId}/retry`, headers, payload: {}
    });
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.json().outbox_event.status, 'pending');

    const retryAudit = await app.inject({
      method: 'GET', url: '/api/v1/admin/audit-logs?entity_type=outbox_event', headers
    });
    assert.equal(retryAudit.statusCode, 200);
    assert.equal(retryAudit.json().audit_logs.length, 1);
    assert.equal(retryAudit.json().audit_logs[0].action, 'retry');

    const allEvents = await app.inject({
      method: 'GET', url: '/api/v1/admin/outbox-events', headers
    });
    assert.equal(allEvents.json().outbox_events.length, 1);

    const csv = await app.inject({
      method: 'GET', url: '/api/v1/admin/exports/audit_logs.csv?limit=100', headers
    });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.headers['content-type'] ?? '', /text\/csv/);
    assert.match(csv.headers['content-disposition'] ?? '', /solo-meal-audit_logs-2026-07-21\.csv/);
    assert.match(csv.body, /operator\.delivery/);
    assert.doesNotMatch(csv.body, /before_value|after_value|WEBHOOK_HTTP_503/);

    const unauthorized = await app.inject({
      method: 'GET', url: '/api/v1/admin/exports/restaurants.csv'
    });
    assert.equal(unauthorized.statusCode, 401);
  } finally {
    await app.close();
  }
});
