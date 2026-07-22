import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabasePool } from '../src/db/pool.js';
import { PostgresRepository } from '../src/repositories/postgres-repository.js';

test('postgres outbox claim uses skip-locked leases and increments attempts atomically', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    async query<T extends QueryResultRow>(sql: string, values: unknown[]): Promise<QueryResult<T>> {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, values });
      return { rows: [{
        id: '70000000-0000-4000-8000-000000000001', topic: 'feedback.created',
        aggregate_id: 'report-1', payload: { report_id: 'report-1' }, status: 'processing',
        available_at: '2026-07-21T03:30:00.000Z', processed_at: null, attempts: 2,
        last_error: 'previous failure', failed_at: null, locked_by: 'worker-b',
        locked_at: '2026-07-21T03:32:00.000Z', created_at: '2026-07-21T03:30:00.000Z'
      }] } as unknown as QueryResult<T>;
    },
    end: async () => {}
  } as unknown as DatabasePool;
  const repository = new PostgresRepository(pool);
  const claimedAt = new Date('2026-07-21T03:32:00.000Z');
  const events = await repository.claimOutboxEvents({
    workerId: 'worker-b', claimedAt,
    leaseExpiredBefore: new Date('2026-07-21T03:31:00.000Z'), limit: 25
  });
  assert.equal(events[0]?.attempts, 2);
  assert.equal(events[0]?.lockedBy, 'worker-b');
  assert.match(calls[0]!.sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0]!.sql, /attempts = event\.attempts \+ 1/);
  assert.match(calls[0]!.sql, /status = 'processing'.*locked_at IS NOT NULL/);
  assert.deepEqual(calls[0]!.values, ['worker-b', claimedAt, new Date('2026-07-21T03:31:00.000Z'), 25]);
});
