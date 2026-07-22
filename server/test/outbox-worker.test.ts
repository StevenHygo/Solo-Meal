import assert from 'node:assert/strict';
import test from 'node:test';
import { FixtureRepository } from '../src/repositories/fixture-repository.js';
import { WebhookPublisher, type OutboxPublisher } from '../src/outbox/publisher.js';
import { runOutboxBatch } from '../src/outbox/worker.js';

const submittedAt = new Date('2026-07-21T03:30:00.000Z');

async function repositoryWithEvent() {
  const repository = new FixtureRepository();
  await repository.createFeedbackReport({
    restaurantId: 'r001',
    reportType: 'hours_incorrect',
    note: '周二午后没有营业',
    idempotencyKey: 'a6ad05eb-5ab7-47c7-9494-817f3635aee6',
    priority: 1,
    submittedAt
  });
  return repository;
}

test('outbox worker claims and completes a batch once', async () => {
  const repository = await repositoryWithEvent();
  const published: string[] = [];
  const publisher: OutboxPublisher = { publish: async event => { published.push(event.id); } };
  const result = await runOutboxBatch(repository, publisher, {
    workerId: 'worker-a', batchSize: 10, maxAttempts: 3, leaseSeconds: 60,
    clock: () => submittedAt
  });
  assert.deepEqual(result, { claimed: 1, processed: 1, deferred: 0, failed: 0 });
  assert.equal(published.length, 1);
  const events = await repository.listOutboxEvents({ status: 'processed', topic: null, aggregateId: null, limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.attempts, 1);
  assert.equal(events[0]?.lockedBy, null);
});

test('outbox worker backs off before moving an exhausted event to failed', async () => {
  const repository = await repositoryWithEvent();
  let now = submittedAt;
  const publisher: OutboxPublisher = { publish: async () => { throw new Error('temporary\nsecret-free failure'); } };
  const options = {
    workerId: 'worker-a', batchSize: 10, maxAttempts: 2, leaseSeconds: 60,
    clock: () => now
  };
  const first = await runOutboxBatch(repository, publisher, options);
  assert.deepEqual(first, { claimed: 1, processed: 0, deferred: 1, failed: 0 });
  const deferred = (await repository.listOutboxEvents({ status: 'pending', topic: null, aggregateId: null, limit: 10 }))[0];
  assert.equal(deferred?.lastError, 'temporary secret-free failure');

  now = new Date(submittedAt.getTime() + 1000);
  const second = await runOutboxBatch(repository, publisher, options);
  assert.deepEqual(second, { claimed: 1, processed: 0, deferred: 0, failed: 1 });
  const failed = (await repository.listOutboxEvents({ status: 'failed', topic: null, aggregateId: null, limit: 10 }))[0];
  assert.equal(failed?.attempts, 2);
  assert.equal(failed?.failedAt, now.toISOString());
});

test('expired processing leases can be recovered by another worker', async () => {
  const repository = await repositoryWithEvent();
  const first = await repository.claimOutboxEvents({
    workerId: 'worker-a', claimedAt: submittedAt,
    leaseExpiredBefore: new Date(submittedAt.getTime() - 60000), limit: 1
  });
  assert.equal(first[0]?.attempts, 1);
  const recoveredAt = new Date(submittedAt.getTime() + 61000);
  const recovered = await repository.claimOutboxEvents({
    workerId: 'worker-b', claimedAt: recoveredAt,
    leaseExpiredBefore: new Date(recoveredAt.getTime() - 60000), limit: 1
  });
  assert.equal(recovered[0]?.lockedBy, 'worker-b');
  assert.equal(recovered[0]?.attempts, 2);
  await assert.rejects(repository.completeOutboxEvent(recovered[0]!.id, 'worker-a', recoveredAt), /OUTBOX_LEASE_LOST/);
});

test('webhook publisher sends a stable envelope without following redirects', async () => {
  let request: RequestInit | undefined;
  const fetchImplementation: typeof fetch = async (_input, init) => {
    request = init;
    return new Response(null, { status: 204 });
  };
  const publisher = new WebhookPublisher({
    url: 'https://events.example.com/solo-meal', token: 'delivery-token', timeoutMs: 1000,
    fetchImplementation
  });
  await publisher.publish({
    id: '70000000-0000-4000-8000-000000000001', topic: 'feedback.created', aggregateId: 'report-1',
    payload: { report_id: 'report-1' }, status: 'processing', availableAt: submittedAt.toISOString(),
    processedAt: null, attempts: 1, lastError: null, failedAt: null,
    lockedBy: 'worker-a', lockedAt: submittedAt.toISOString(), createdAt: submittedAt.toISOString()
  });
  assert.equal(request?.redirect, 'error');
  assert.equal((request?.headers as Record<string, string>).authorization, 'Bearer delivery-token');
  assert.match(String(request?.body), /"attempt":1/);
});
