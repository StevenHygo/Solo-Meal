import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OUTBOX_WEBHOOK_URL: z.url(),
  OUTBOX_WEBHOOK_TOKEN: z.string().min(1).optional(),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  OUTBOX_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(250).max(60000).default(5000)
}).superRefine((value, context) => {
  const url = new URL(value.OUTBOX_WEBHOOK_URL);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(value.NODE_ENV !== 'production' && local && url.protocol === 'http:')) {
    context.addIssue({ code: 'custom', path: ['OUTBOX_WEBHOOK_URL'], message: 'Webhook URL must use HTTPS except localhost in non-production' });
  }
});

export interface OutboxConfig {
  webhookUrl: string;
  webhookToken: string | undefined;
  batchSize: number;
  maxAttempts: number;
  leaseSeconds: number;
  requestTimeoutMs: number;
}

export function readOutboxConfig(source: NodeJS.ProcessEnv = process.env): OutboxConfig {
  const parsed = schema.parse(source);
  return {
    webhookUrl: parsed.OUTBOX_WEBHOOK_URL,
    webhookToken: parsed.OUTBOX_WEBHOOK_TOKEN,
    batchSize: parsed.OUTBOX_BATCH_SIZE,
    maxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
    leaseSeconds: parsed.OUTBOX_LEASE_SECONDS,
    requestTimeoutMs: parsed.OUTBOX_REQUEST_TIMEOUT_MS
  };
}
