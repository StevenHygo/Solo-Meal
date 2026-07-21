import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, DatabasePool } from '../src/db/pool.js';
import { PostgresRepository } from '../src/repositories/postgres-repository.js';

interface PoiCandidateRowForTest {
  id: string;
  provider: string;
  provider_poi_id: string;
  city_code: string;
  coverage_area_id: string;
  coverage_area_name: string;
  name: string;
  address: string;
  district: string;
  source_coord_type: 'wgs84' | 'gcj02';
  source_lat: number;
  source_lng: number;
  wgs84_lat: number;
  wgs84_lng: number;
  phone_normalized: string | null;
  raw_category: string | null;
  observed_at: string;
  status: 'pending' | 'matched' | 'new_branch' | 'rejected';
  matched_restaurant_id: string | null;
  matched_restaurant_legacy_id: string | null;
  matched_restaurant_name: string | null;
  draft_restaurant_id: string | null;
  draft_restaurant_status: 'draft' | 'review' | 'published' | 'withdrawn' | null;
  suggested_restaurant_id: string | null;
  suggested_restaurant_legacy_id: string | null;
  suggested_restaurant_name: string | null;
  suggestion_score: number | null;
  match_method: 'provider_ref' | 'name_address_distance' | 'operator' | null;
  resolution_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

const pendingRow: PoiCandidateRowForTest = {
  id: '41000000-0000-4000-8000-000000000001',
  provider: 'licensed_map',
  provider_poi_id: 'map-poi-001',
  city_code: 'shanghai',
  coverage_area_id: 'sh-jingan-huangpu',
  coverage_area_name: '静安 / 黄浦',
  name: '杉木面所',
  address: '华山路 388 号 B1 层',
  district: '静安寺',
  source_coord_type: 'gcj02',
  source_lat: 31.2231,
  source_lng: 121.4452,
  wgs84_lat: 31.225,
  wgs84_lng: 121.4406,
  phone_normalized: '02155550101',
  raw_category: '面馆',
  observed_at: '2026-07-20 04:00:00+00',
  status: 'pending',
  matched_restaurant_id: null,
  matched_restaurant_legacy_id: null,
  matched_restaurant_name: null,
  draft_restaurant_id: null,
  draft_restaurant_status: null,
  suggested_restaurant_id: '10000000-0000-4000-8000-000000000001',
  suggested_restaurant_legacy_id: 'r001',
  suggested_restaurant_name: '杉木面所',
  suggestion_score: 0.98,
  match_method: 'name_address_distance',
  resolution_note: null,
  reviewed_by: null,
  reviewed_at: null,
  first_seen_at: '2026-07-21 03:30:00+00',
  last_seen_at: '2026-07-21 03:30:00+00'
};

function result<T extends QueryResultRow>(rows: unknown[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

function createImportPool() {
  const calls: string[] = [];
  const client = {
    async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized === 'SELECT id FROM coverage_areas WHERE id = $1') return result<T>([{ id: 'sh-jingan-huangpu' }]);
      if (normalized.includes('INSERT INTO poi_import_batches')) {
        return result<T>([{ id: '40000000-0000-4000-8000-000000000001', imported_at: '2026-07-21 03:30:00+00' }]);
      }
      if (normalized.includes('FROM restaurant_provider_refs pr')) return result<T>([]);
      if (normalized.includes('SELECT ranked.id, ranked.score')) {
        return result<T>([{ id: '10000000-0000-4000-8000-000000000001', score: 0.98 }]);
      }
      if (normalized.includes('INSERT INTO poi_candidates')) return result<T>([{ id: pendingRow.id }]);
      return result<T>([]);
    },
    release() {}
  } as unknown as DatabaseClient;
  const pool = { connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls };
}

function createReviewPool(options: { coverageMismatch?: boolean; draftInProgress?: boolean } = {}) {
  const calls: string[] = [];
  let candidateReads = 0;
  const client = {
    async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized.includes('FROM poi_candidates pc')) {
        candidateReads += 1;
        return result<T>([candidateReads === 1 ? (options.draftInProgress ? {
          ...pendingRow,
          status: 'new_branch',
          draft_restaurant_id: '51000000-0000-4000-8000-000000000001',
          draft_restaurant_status: 'draft'
        } : pendingRow) : {
          ...pendingRow,
          status: 'matched',
          matched_restaurant_id: '10000000-0000-4000-8000-000000000001',
          matched_restaurant_legacy_id: 'r001',
          matched_restaurant_name: '杉木面所',
          match_method: 'operator',
          resolution_note: 'Provider ID、名称和地址一致',
          reviewed_by: 'operator.poi',
          reviewed_at: '2026-07-21 03:30:00+00'
        }]);
      }
      if (normalized.includes("SELECT id, coverage_area_id FROM restaurants")) {
        return result<T>([{
          id: '10000000-0000-4000-8000-000000000001',
          coverage_area_id: options.coverageMismatch ? 'sh-xujiahui' : 'sh-jingan-huangpu'
        }]);
      }
      if (normalized.includes('SELECT restaurant_id FROM restaurant_provider_refs')) {
        return result<T>([{ restaurant_id: '10000000-0000-4000-8000-000000000001' }]);
      }
      return result<T>([]);
    },
    release() {}
  } as unknown as DatabaseClient;
  const pool = { connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls };
}

function createQualityPool() {
  const calls: string[] = [];
  const query = async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push(normalized);
    if (normalized.includes('SELECT quality_metrics FROM coverage_areas')) {
      return result<T>([{ quality_metrics: { search_sample_coverage_rate: 0.5 } }]);
    }
    if (normalized.includes('SELECT ca.id, ca.name, c.code AS city_code')) {
      return result<T>([{
        id: 'sh-xujiahui', name: '徐家汇', city_code: 'shanghai', status: 'upcoming',
        quality_metrics: {
          search_sample_coverage_rate: 0.6,
          branch_mismatch_rate: 0.02,
          visit_conformity_rate: 0.7,
          incident_free_weeks: 2,
          provider_terms_reviewed: true,
          privacy_reviewed: true,
          postgis_rehearsal_passed: true
        }
      }]);
    }
    if (normalized.includes('AS published_count')) {
      return result<T>([{ published_count: 30, recent_count: 24, complete_count: 27, provider_ref_count: 27 }]);
    }
    if (normalized.includes('AS pending_high_confidence')) return result<T>([{ pending_high_confidence: 0 }]);
    if (normalized.includes('AS eligible_count')) return result<T>([{ eligible_count: 10, on_time_count: 8 }]);
    return result<T>([]);
  };
  const client = { query, release() {} } as unknown as DatabaseClient;
  const pool = { query, connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls };
}

const importSubmission = {
  coverageAreaId: 'sh-jingan-huangpu',
  provider: 'licensed_map',
  sourceLabel: '地图合作方导出 2026-07-20',
  authorizationBasis: '测试环境授权数据，仅用于候选去重契约验证',
  idempotencyKey: '91e9bc53-c812-43f6-a17d-595609d46f02',
  payloadSha256: 'a'.repeat(64),
  candidates: [{
    providerPoiId: 'map-poi-001',
    name: '杉木面所',
    address: '华山路 388 号 B1 层',
    district: '静安寺',
    sourceCoordType: 'gcj02' as const,
    sourceLocation: { lat: 31.2231, lng: 121.4452 },
    locationWgs84: { lat: 31.225, lng: 121.4406 },
    phoneNormalized: '02155550101',
    rawCategory: '面馆',
    observedAt: new Date('2026-07-20T04:00:00.000Z')
  }],
  actorId: 'operator.poi',
  importedAt: new Date('2026-07-21T03:30:00.000Z')
};

test('postgres POI import writes only candidate pipeline, audit and outbox records', async () => {
  const { pool, calls } = createImportPool();
  const repository = new PostgresRepository(pool);
  const receipt = await repository.importPoiCandidates(importSubmission);
  assert.equal(receipt.created, true);
  assert.equal(receipt.createdCount, 1);
  assert.equal(calls[0], 'BEGIN');
  assert.match(calls.join('\n'), /INSERT INTO poi_import_batches/);
  assert.match(calls.join('\n'), /INSERT INTO poi_candidates/);
  assert.match(calls.join('\n'), /INSERT INTO poi_import_batch_items/);
  assert.match(calls.join('\n'), /INSERT INTO audit_logs/);
  assert.match(calls.join('\n'), /INSERT INTO outbox_events/);
  assert.equal(calls.some(sql => /INSERT INTO restaurants/.test(sql)), false);
  assert.equal(calls.some(sql => /UPDATE restaurants/.test(sql)), false);
  assert.equal(calls.at(-1), 'COMMIT');
});

test('postgres POI review links a provider ref without publishing the candidate', async () => {
  const { pool, calls } = createReviewPool();
  const repository = new PostgresRepository(pool);
  const candidate = await repository.reviewPoiCandidate(pendingRow.id, {
    decision: 'match_existing',
    restaurantId: 'r001',
    resolutionNote: 'Provider ID、名称和地址一致',
    actorId: 'operator.poi',
    reviewedAt: new Date('2026-07-21T03:30:00.000Z')
  });
  assert.equal(candidate.status, 'matched');
  assert.equal(candidate.matchedRestaurantLegacyId, 'r001');
  assert.match(calls.join('\n'), /INSERT INTO restaurant_provider_refs/);
  assert.match(calls.join('\n'), /ON CONFLICT DO NOTHING/);
  assert.match(calls.join('\n'), /UPDATE poi_candidates/);
  assert.equal(calls.some(sql => /UPDATE restaurants/.test(sql)), false);
  assert.equal(calls.at(-1), 'COMMIT');
});

test('postgres POI review rolls back a cross-coverage match', async () => {
  const { pool, calls } = createReviewPool({ coverageMismatch: true });
  const repository = new PostgresRepository(pool);
  await assert.rejects(repository.reviewPoiCandidate(pendingRow.id, {
    decision: 'match_existing',
    restaurantId: 'r001',
    resolutionNote: '错误覆盖区测试',
    actorId: 'operator.poi',
    reviewedAt: new Date('2026-07-21T03:30:00.000Z')
  }), /POI_RESTAURANT_COVERAGE_MISMATCH/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some(sql => /INSERT INTO restaurant_provider_refs/.test(sql)), false);
});

test('postgres POI review cannot replace a candidate with an active restaurant draft', async () => {
  const { pool, calls } = createReviewPool({ draftInProgress: true });
  const repository = new PostgresRepository(pool);
  await assert.rejects(repository.reviewPoiCandidate(pendingRow.id, {
    decision: 'reject',
    resolutionNote: '草稿建立后不能从候选队列改写状态',
    actorId: 'operator.poi',
    reviewedAt: new Date('2026-07-21T03:30:00.000Z')
  }), /POI_CANDIDATE_DRAFT_IN_PROGRESS/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some(sql => /^UPDATE poi_candidates/.test(sql)), false);
});

test('postgres coverage quality update is audited before recomputing the gate metrics', async () => {
  const { pool, calls } = createQualityPool();
  const repository = new PostgresRepository(pool);
  const quality = await repository.updateCoverageQuality('sh-xujiahui', {
    searchSampleCoverageRate: 0.6,
    branchMismatchRate: 0.02,
    visitConformityRate: 0.7,
    incidentFreeWeeks: 2,
    providerTermsReviewed: true,
    privacyReviewed: true,
    postgisRehearsalPassed: true,
    evidenceNote: '抽样记录、条款评审和演练记录均已归档',
    actorId: 'operator.quality',
    updatedAt: new Date('2026-07-21T03:30:00.000Z')
  });
  assert.equal(quality.metrics.publishedRestaurants, 30);
  assert.equal(quality.metrics.searchSampleCoverageRate, 0.6);
  assert.equal(quality.metrics.highPriorityFeedbackSlaRate, 0.8);
  assert.match(calls.join('\n'), /UPDATE coverage_areas SET quality_metrics/);
  assert.match(calls.join('\n'), /INSERT INTO audit_logs/);
  assert.match(calls.join('\n'), /INSERT INTO outbox_events/);
  const commitIndex = calls.indexOf('COMMIT');
  const qualityReadIndex = calls.findIndex(sql => sql.includes('SELECT ca.id, ca.name, c.code AS city_code'));
  assert.ok(commitIndex >= 0 && qualityReadIndex > commitIndex);
});
