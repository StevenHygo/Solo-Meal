import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, DatabasePool } from '../src/db/pool.js';
import { PostgresRepository } from '../src/repositories/postgres-repository.js';

function result<T extends QueryResultRow>(rows: unknown[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

function managedCity(status: 'beta' | 'paused' = 'paused') {
  return {
    code: 'shanghai', name: '上海', timezone: 'Asia/Shanghai', status,
    areas: [{
      id: 'sh-jingan-huangpu', name: '静安 / 黄浦', configured_status: 'beta',
      effective_status: status === 'paused' ? 'paused' : 'beta'
    }]
  };
}

function createCoveragePool(options: { failAudit?: boolean } = {}) {
  const calls: string[] = [];
  const parameters: unknown[][] = [];
  const query = async <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push(normalized);
    parameters.push(params);
    if (normalized === 'SELECT status FROM cities WHERE code = $1 FOR UPDATE') return result<T>([{ status: 'beta' }]);
    if (normalized.includes('SELECT ca.status, c.code AS city_code')) {
      return result<T>([{ status: 'beta', city_code: 'shanghai' }]);
    }
    if (normalized.includes('SELECT c.code, c.name, c.timezone, c.status')) return result<T>([managedCity()]);
    if (options.failAudit && normalized.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
    return result<T>([]);
  };
  const client = { query, release() {} } as unknown as DatabaseClient;
  const pool = { query, connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls, parameters };
}

test('postgres city status update commits state, audit and outbox together', async () => {
  const { pool, calls } = createCoveragePool();
  const repository = new PostgresRepository(pool);
  const city = await repository.updateCityStatus('shanghai', {
    status: 'paused', reason: '临时暂停公开推荐进行质量复核', actorId: 'operator.coverage',
    updatedAt: new Date('2026-07-21T03:30:00.000Z')
  });
  assert.equal(city.status, 'paused');
  assert.equal(city.areas[0]?.configuredStatus, 'beta');
  assert.equal(city.areas[0]?.effectiveStatus, 'paused');
  assert.equal(calls[0], 'BEGIN');
  assert.match(calls.join('\n'), /UPDATE cities SET status = \$2::coverage_state/);
  assert.match(calls.join('\n'), /INSERT INTO audit_logs/);
  assert.match(calls.join('\n'), /coverage\.city_status_updated/);
  const commit = calls.indexOf('COMMIT');
  const reread = calls.findIndex((sql, index) => index > commit && sql.includes('SELECT c.code, c.name, c.timezone, c.status'));
  assert.ok(commit >= 0 && reread > commit);
});

test('postgres area status update rolls back when audit persistence fails', async () => {
  const { pool, calls } = createCoveragePool({ failAudit: true });
  const repository = new PostgresRepository(pool);
  await assert.rejects(repository.updateCoverageAreaStatus('sh-jingan-huangpu', {
    status: 'paused', reason: '暂停区域进行现场数据复核', actorId: 'operator.coverage',
    updatedAt: new Date('2026-07-21T03:30:00.000Z')
  }), /audit unavailable/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(calls.some(sql => sql.includes('coverage.area_status_updated')), false);
});

test('postgres expiring evidence uses timestamp bounds and parameterized filters', async () => {
  const calls: string[] = [];
  const parameters: unknown[][] = [];
  const pool = {
    async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      parameters.push(params);
      return result<T>([{
        id: '61000000-0000-4000-8000-000000000001',
        restaurant_id: '10000000-0000-4000-8000-000000000006',
        restaurant_legacy_id: 'r006', restaurant_name: '禾下粥铺', city_code: 'shanghai',
        coverage_area_id: 'sh-jingan-huangpu', coverage_area_name: '静安 / 黄浦',
        attribute: 'ordering', title: '点餐', source_type: 'menu_review', source_label: '运营菜单核验',
        expires_at: '2026-08-19 04:00:00+00', expires_in_days: 30
      }]);
    },
    async end() {}
  } as unknown as DatabasePool;
  const repository = new PostgresRepository(pool);
  const at = new Date('2026-07-21T03:30:00.000Z');
  const evidence = await repository.listExpiringEvidence({
    withinDays: 30, coverageAreaId: 'sh-jingan-huangpu', attribute: 'ordering', limit: 25, at
  });
  assert.equal(evidence[0]?.expiresInDays, 30);
  assert.match(calls[0] ?? '', /e\.expires_at > \$1/);
  assert.match(calls[0] ?? '', /e\.expires_at <= \$2/);
  assert.equal((calls[0] ?? '').includes("interval '30 days'"), false);
  assert.equal(parameters[0]?.[0], at);
  assert.equal((parameters[0]?.[1] as Date).toISOString(), '2026-08-20T03:30:00.000Z');
  assert.deepEqual(parameters[0]?.slice(2), ['sh-jingan-huangpu', 'ordering', 25]);
});
