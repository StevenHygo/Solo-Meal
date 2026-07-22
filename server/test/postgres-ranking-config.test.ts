import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, DatabasePool } from '../src/db/pool.js';
import { PostgresRepository } from '../src/repositories/postgres-repository.js';

function result<T extends QueryResultRow>(rows: unknown[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

const baseline = {
  version: 'v1-beta.1',
  status: 'active',
  weights: { soloFit: 0.35, distanceFit: 0.25, budgetFit: 0.15, cuisineFit: 0.15, timeFit: 0.1 },
  checksum: 'baseline-checksum',
  published_at: '2026-07-21 00:00:00+00',
  created_at: '2026-07-21 00:00:00+00'
};

const retired = {
  version: 'v1-distance.1',
  status: 'retired',
  weights: { soloFit: 0, distanceFit: 1, budgetFit: 0, cuisineFit: 0, timeFit: 0 },
  checksum: 'distance-checksum',
  published_at: '2026-07-21 01:00:00+00',
  created_at: '2026-07-21 00:30:00+00'
};

function createRankingPool(options: { failAudit?: boolean } = {}) {
  const calls: string[] = [];
  const parameters: unknown[][] = [];
  const query = async <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push(normalized);
    parameters.push(params);
    if (normalized.includes("WHERE status = 'active' OR version = $1")) {
      return result<T>([baseline, retired]);
    }
    if (normalized.includes("SET status = 'active', published_at = $2")) {
      return result<T>([{ ...retired, status: 'active', published_at: '2026-07-22 03:30:00+00' }]);
    }
    if (options.failAudit && normalized.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
    return result<T>([]);
  };
  const client = { query, release() {} } as unknown as DatabaseClient;
  const pool = { query, connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls, parameters };
}

test('postgres ranking rollback commits status, audit and outbox in one transaction', async () => {
  const { pool, calls, parameters } = createRankingPool();
  const repository = new PostgresRepository(pool);
  const config = await repository.activateRankingConfig('v1-distance.1', {
    reason: '恢复距离优先版本用于线上异常回滚',
    actorId: 'operator.ranking',
    activatedAt: new Date('2026-07-22T03:30:00.000Z')
  });
  assert.equal(config.version, 'v1-distance.1');
  assert.equal(config.status, 'active');
  assert.equal(calls[0], 'BEGIN');
  assert.match(calls.join('\n'), /ORDER BY version FOR UPDATE/);
  assert.match(calls.join('\n'), /SET status = 'retired'/);
  assert.match(calls.join('\n'), /SET status = 'active', published_at = \$2/);
  assert.match(calls.join('\n'), /INSERT INTO audit_logs/);
  assert.match(calls.join('\n'), /ranking\.config_activated/);
  const auditIndex = calls.findIndex(sql => sql.includes('INSERT INTO audit_logs'));
  assert.equal(parameters[auditIndex]?.[1], 'rollback');
  assert.equal(calls.at(-1), 'COMMIT');
});

test('postgres ranking activation rolls back the status change when audit persistence fails', async () => {
  const { pool, calls } = createRankingPool({ failAudit: true });
  const repository = new PostgresRepository(pool);
  await assert.rejects(repository.activateRankingConfig('v1-distance.1', {
    reason: '验证审计失败时配置不会半发布',
    actorId: 'operator.ranking',
    activatedAt: new Date('2026-07-22T03:30:00.000Z')
  }), /audit unavailable/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(calls.some(sql => sql.includes('ranking.config_activated')), false);
});
