import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, DatabasePool } from '../src/db/pool.js';
import { PostgresRepository } from '../src/repositories/postgres-repository.js';

function createPool(options: { failAudit?: boolean; replay?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized.includes('SELECT r.id, r.city_id, c.timezone FROM restaurants')) {
        return { rows: [{
          id: '10000000-0000-4000-8000-000000000001', city_id: 'city-1', timezone: 'Asia/Shanghai'
        }] } as unknown as QueryResult<T>;
      }
      if (normalized.includes('FROM feedback_reports f WHERE f.idempotency_key')) {
        return { rows: options.replay ? [{
          id: '20000000-0000-4000-8000-000000000001',
          restaurant_id: '10000000-0000-4000-8000-000000000001',
          report_type: 'hours_incorrect',
          note: '周二午后没有营业',
          created_at: '2026-07-21 03:30:00+00',
          task_id: '30000000-0000-4000-8000-000000000001'
        }] : [] } as unknown as QueryResult<T>;
      }
      if (normalized.includes('INSERT INTO feedback_reports')) {
        return { rows: options.replay ? [] : [{
          id: '20000000-0000-4000-8000-000000000001',
          created_at: '2026-07-21 03:30:00+00'
        }] } as unknown as QueryResult<T>;
      }
      if (normalized.includes('INSERT INTO curation_tasks')) {
        return { rows: [{ id: '30000000-0000-4000-8000-000000000001' }] } as unknown as QueryResult<T>;
      }
      if (options.failAudit && normalized.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
      return { rows: [] } as unknown as QueryResult<T>;
    },
    release() {}
  } as unknown as DatabaseClient;
  const pool = { connect: async () => client, end: async () => {} } as unknown as DatabasePool;
  return { pool, calls };
}

const submission = {
  restaurantId: 'r001',
  reportType: 'hours_incorrect' as const,
  note: '周二午后没有营业',
  idempotencyKey: 'a6ad05eb-5ab7-47c7-9494-817f3635aee6',
  priority: 1,
  submittedAt: new Date('2026-07-21T03:30:00.000Z')
};

test('postgres feedback transaction writes task, audit and outbox before commit', async () => {
  const { pool, calls } = createPool();
  const repository = new PostgresRepository(pool);
  const receipt = await repository.createFeedbackReport(submission);
  assert.equal(receipt.created, true);
  assert.equal(receipt.reportId, '20000000-0000-4000-8000-000000000001');
  assert.equal(receipt.taskId, '30000000-0000-4000-8000-000000000001');
  assert.equal(calls[0], 'BEGIN');
  assert.match(calls.join('\n'), /publish_status = 'published'/);
  assert.match(calls.join('\n'), /INSERT INTO feedback_reports/);
  assert.match(calls.join('\n'), /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(calls.join('\n'), /INSERT INTO curation_tasks/);
  assert.match(calls.join('\n'), /INSERT INTO audit_logs/);
  assert.match(calls.join('\n'), /INSERT INTO outbox_events/);
  assert.equal(calls.at(-1), 'COMMIT');
  assert.equal(calls.includes('ROLLBACK'), false);
});

test('postgres feedback conflict replays the committed report without duplicate writes', async () => {
  const { pool, calls } = createPool({ replay: true });
  const repository = new PostgresRepository(pool);
  const receipt = await repository.createFeedbackReport(submission);
  assert.equal(receipt.created, false);
  assert.equal(receipt.reportId, '20000000-0000-4000-8000-000000000001');
  assert.equal(receipt.taskId, '30000000-0000-4000-8000-000000000001');
  assert.match(calls.join('\n'), /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(calls.join('\n'), /FROM feedback_reports f WHERE f.idempotency_key/);
  assert.equal(calls.some(sql => sql.includes('INSERT INTO curation_tasks')), false);
  assert.equal(calls.some(sql => sql.includes('INSERT INTO audit_logs')), false);
  assert.equal(calls.some(sql => sql.includes('INSERT INTO outbox_events')), false);
  assert.equal(calls.at(-1), 'COMMIT');
});

test('postgres feedback transaction rolls back when audit persistence fails', async () => {
  const { pool, calls } = createPool({ failAudit: true });
  const repository = new PostgresRepository(pool);
  await assert.rejects(repository.createFeedbackReport(submission), /audit unavailable/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(calls.some(sql => sql.includes('INSERT INTO outbox_events')), false);
});
