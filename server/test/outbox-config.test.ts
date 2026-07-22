import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import { readOutboxConfig } from '../src/outbox/config.js';

test('outbox config accepts HTTPS and bounded worker controls', () => {
  const config = readOutboxConfig({
    NODE_ENV: 'production', OUTBOX_WEBHOOK_URL: 'https://events.example.com/solo-meal',
    OUTBOX_BATCH_SIZE: '50', OUTBOX_MAX_ATTEMPTS: '7', OUTBOX_LEASE_SECONDS: '90'
  });
  assert.equal(config.batchSize, 50);
  assert.equal(config.maxAttempts, 7);
  assert.equal(config.leaseSeconds, 90);
});

test('outbox config only permits insecure URLs for non-production localhost', () => {
  assert.equal(readOutboxConfig({ NODE_ENV: 'development', OUTBOX_WEBHOOK_URL: 'http://localhost:9000/events' }).webhookUrl,
    'http://localhost:9000/events');
  assert.throws(
    () => readOutboxConfig({ NODE_ENV: 'production', OUTBOX_WEBHOOK_URL: 'http://localhost:9000/events' }),
    error => error instanceof ZodError
  );
  assert.throws(
    () => readOutboxConfig({ NODE_ENV: 'development', OUTBOX_WEBHOOK_URL: 'http://events.example.com/solo-meal' }),
    error => error instanceof ZodError
  );
});
