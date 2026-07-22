import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../config/env.js';
import { createRepository } from '../repositories/create-repository.js';
import { readOutboxConfig } from './config.js';
import { WebhookPublisher } from './publisher.js';
import { runOutboxBatch } from './worker.js';

const appConfig = readConfig();
const outboxConfig = readOutboxConfig();
const repository = createRepository(appConfig);
const workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

try {
  const result = await runOutboxBatch(repository, new WebhookPublisher({
    url: outboxConfig.webhookUrl,
    ...(outboxConfig.webhookToken ? { token: outboxConfig.webhookToken } : {}),
    timeoutMs: outboxConfig.requestTimeoutMs
  }), {
    workerId,
    batchSize: outboxConfig.batchSize,
    maxAttempts: outboxConfig.maxAttempts,
    leaseSeconds: outboxConfig.leaseSeconds
  });
  process.stdout.write(`${JSON.stringify({ worker_id: workerId, ...result })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown outbox worker error';
  process.stderr.write(`${JSON.stringify({ worker_id: workerId, error: message })}\n`);
  process.exitCode = 1;
} finally {
  await repository.close();
}
