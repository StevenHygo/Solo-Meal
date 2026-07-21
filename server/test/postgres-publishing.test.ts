import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, DatabasePool } from '../src/db/pool.js';
import type { RestaurantDraftSave } from '../src/domain/publishing.js';
import { PostgresRepository } from '../src/repositories/postgres-repository.js';

const restaurantId = '51000000-0000-4000-8000-000000000001';
const candidateId = '41000000-0000-4000-8000-000000000010';
const at = new Date('2026-07-21T03:30:00.000Z');

function result<T extends QueryResultRow>(rows: unknown[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

function managedRow(status: 'draft' | 'review' | 'published', submittedBy: string | null) {
  return {
    id: restaurantId,
    legacy_id: null,
    city_code: 'shanghai',
    city_timezone: 'Asia/Shanghai',
    coverage_area_id: 'sh-jingan-huangpu',
    coverage_area_name: '静安 / 黄浦',
    coverage_status: 'beta',
    name: '青禾单人食堂',
    address: '常熟路 88 号',
    district: '静安寺',
    wgs84_lat: 31.219,
    wgs84_lng: 121.444,
    gcj02_lat: 31.221,
    gcj02_lng: 121.449,
    distance_m: null,
    primary_cuisine_code: 'rice_meal',
    cuisine_codes: ['rice_meal'],
    price_min_fen: 2800,
    price_max_fen: 4800,
    accepts_solo: true,
    peak_policy: '午餐高峰可排队取餐，单人无需拼桌',
    seat_types: ['吧台'],
    counter_seats: 8,
    solo_portion: true,
    min_spend_fen: null,
    meal_minutes_min: 20,
    meal_minutes_max: 35,
    noise_level: 2,
    solo_score: 95,
    confidence: 'medium',
    scoring_version: 'v1-beta.1',
    last_verified_at: status === 'published' ? '2026-07-20 04:00:00+00' : null,
    reason_codes: ['accepts_solo', 'counter_seats', 'solo_set', 'quick_meal', 'budget_friendly'],
    hours: [{ dayOfWeek: 1, specialDate: null, opensAt: '10:00', closesAt: '22:00', isClosed: false }],
    dishes: ['照烧鸡饭'],
    operator_note: '事务测试',
    evidence: [{
      attribute: 'accepts_solo', title: '单人接待', value: { text: '店员确认接待单人' },
      sourceType: 'operator_call', sourceLabel: '运营电话核验',
      observedAt: '2026-07-20 04:00:00+00', expiresAt: '2026-10-20 04:00:00+00',
      status: status === 'published' ? 'published' : 'candidate'
    }],
    publish_status: status,
    version: 1,
    created_by: 'operator.editor',
    review_submitted_by: submittedBy,
    review_submitted_at: submittedBy ? '2026-07-21 03:00:00+00' : null,
    published_by: status === 'published' ? 'operator.reviewer' : null,
    published_at: status === 'published' ? '2026-07-21 03:30:00+00' : null,
    withdrawn_by: null,
    withdrawn_at: null,
    status_note: null,
    updated_by: status === 'published' ? 'operator.reviewer' : 'operator.editor',
    updated_at: '2026-07-21 03:30:00+00',
    source_candidate_id: candidateId,
    source_provider: 'licensed_map',
    source_provider_poi_id: 'publish-flow-001'
  };
}

const draft: RestaurantDraftSave = {
  name: '青禾单人食堂',
  address: '常熟路 88 号',
  district: '静安寺',
  cuisineCodes: ['rice_meal'],
  primaryCuisineCode: 'rice_meal',
  priceMinFen: 2800,
  priceMaxFen: 4800,
  acceptsSolo: true,
  peakPolicy: '午餐高峰可排队取餐，单人无需拼桌',
  seatTypes: ['吧台'],
  counterSeats: 8,
  soloPortion: true,
  minSpendFen: null,
  mealMinutes: [20, 35],
  noiseLevel: 2,
  hours: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '22:00' }],
  dishes: ['照烧鸡饭'],
  note: '事务测试',
  evidence: [{
    attribute: 'accepts_solo', title: '单人接待', value: '店员确认接待单人',
    sourceType: 'operator_call', sourceLabel: '运营电话核验',
    observedAt: new Date('2026-07-20T04:00:00.000Z'),
    expiresAt: new Date('2026-10-20T04:00:00.000Z')
  }],
  actorId: 'operator.editor',
  savedAt: at
};

function createDraftPool() {
  const calls: string[] = [];
  const query = async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push(normalized);
    if (normalized.includes('FROM poi_candidates pc JOIN coverage_areas ca')) {
      return result<T>([{
        id: candidateId, status: 'new_branch', draft_restaurant_id: null,
        provider: 'licensed_map', provider_poi_id: 'publish-flow-001',
        coverage_area_id: 'sh-jingan-huangpu', city_id: 'city-1',
        source_coord_type: 'gcj02', source_lat: 31.221, source_lng: 121.449,
        wgs84_lat: 31.219, wgs84_lng: 121.444
      }]);
    }
    if (normalized.includes('INSERT INTO restaurants')) return result<T>([{ id: restaurantId }]);
    if (normalized.includes('FROM restaurants r') && normalized.includes('source_candidate_id')) {
      return result<T>([managedRow('draft', null)]);
    }
    return result<T>([]);
  };
  const client = { query, release() {} } as unknown as DatabaseClient;
  const pool = { query, connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls };
}

function createPublishPool() {
  const calls: string[] = [];
  let status: 'review' | 'published' = 'review';
  const query = async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push(normalized);
    if (normalized === 'SELECT id FROM restaurants WHERE id = $1 FOR UPDATE') return result<T>([{ id: restaurantId }]);
    if (normalized.includes('FROM restaurants r') && normalized.includes('source_candidate_id')) {
      return result<T>([managedRow(status, 'operator.editor')]);
    }
    if (normalized.includes('SELECT restaurant_id FROM restaurant_provider_refs')) return result<T>([{ restaurant_id: restaurantId }]);
    if (normalized.includes('SELECT provider_poi_id FROM restaurant_provider_refs')) return result<T>([{ provider_poi_id: 'publish-flow-001' }]);
    if (normalized.includes("UPDATE restaurants SET publish_status = 'published'")) status = 'published';
    if (normalized.includes("UPDATE poi_candidates SET status = 'matched'")) return result<T>([{ id: candidateId }]);
    return result<T>([]);
  };
  const client = { query, release() {} } as unknown as DatabaseClient;
  const pool = { query, connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls };
}

test('postgres restaurant draft writes normalized fields without publishing', async () => {
  const { pool, calls } = createDraftPool();
  const repository = new PostgresRepository(pool);
  const created = await repository.createRestaurantDraft(candidateId, draft);
  assert.equal(created.publishStatus, 'draft');
  assert.equal(calls[0], 'BEGIN');
  assert.match(calls.join('\n'), /INSERT INTO restaurants/);
  assert.match(calls.join('\n'), /INSERT INTO restaurant_cuisines/);
  assert.match(calls.join('\n'), /INSERT INTO restaurant_hours/);
  assert.match(calls.join('\n'), /INSERT INTO solo_profiles/);
  assert.match(calls.join('\n'), /INSERT INTO evidence/);
  assert.equal(calls.some(sql => /publish_status = 'published'/.test(sql)), false);
  assert.equal(calls.some(sql => /INSERT INTO restaurant_provider_refs/.test(sql)), false);
  assert.equal(calls.includes('COMMIT'), true);
});

test('postgres publication rejects self-review before any publish writes', async () => {
  const { pool, calls } = createPublishPool();
  const repository = new PostgresRepository(pool);
  await assert.rejects(repository.transitionManagedRestaurant(restaurantId, {
    action: 'publish', note: '提交人不能自行发布', actorId: 'operator.editor', transitionedAt: at
  }), /SECOND_REVIEWER_REQUIRED/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some(sql => /INSERT INTO restaurant_provider_refs/.test(sql)), false);
  assert.equal(calls.some(sql => /UPDATE evidence SET status = 'published'/.test(sql)), false);
});

test('postgres publication commits provider ref, evidence, candidate, audit and outbox together', async () => {
  const { pool, calls } = createPublishPool();
  const repository = new PostgresRepository(pool);
  const published = await repository.transitionManagedRestaurant(restaurantId, {
    action: 'publish', note: '二次审核通过', actorId: 'operator.reviewer', transitionedAt: at
  });
  assert.equal(published.publishStatus, 'published');
  const joined = calls.join('\n');
  assert.match(joined, /INSERT INTO restaurant_provider_refs/);
  assert.match(joined, /UPDATE evidence SET status = 'published'/);
  assert.match(joined, /UPDATE restaurants SET publish_status = 'published'/);
  assert.match(joined, /UPDATE poi_candidates SET status = 'matched'/);
  assert.match(joined, /INSERT INTO audit_logs/);
  assert.match(joined, /INSERT INTO outbox_events/);
  assert.equal(calls.includes('COMMIT'), true);
});
