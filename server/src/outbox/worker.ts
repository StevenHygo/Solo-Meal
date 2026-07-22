import type { RestaurantRepository } from '../domain/repository.js';
import type { OutboxPublisher } from './publisher.js';

export interface OutboxWorkerOptions {
  workerId: string;
  batchSize: number;
  maxAttempts: number;
  leaseSeconds: number;
  clock?: () => Date;
}

export interface OutboxWorkerResult {
  claimed: number;
  processed: number;
  deferred: number;
  failed: number;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'UNKNOWN_PUBLISH_ERROR';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
}

function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(Math.max(attempts - 1, 0), 12));
}

export async function runOutboxBatch(
  repository: RestaurantRepository,
  publisher: OutboxPublisher,
  options: OutboxWorkerOptions
): Promise<OutboxWorkerResult> {
  const clock = options.clock ?? (() => new Date());
  const claimedAt = clock();
  const events = await repository.claimOutboxEvents({
    workerId: options.workerId,
    claimedAt,
    leaseExpiredBefore: new Date(claimedAt.getTime() - options.leaseSeconds * 1000),
    limit: options.batchSize
  });
  const result: OutboxWorkerResult = { claimed: events.length, processed: 0, deferred: 0, failed: 0 };
  for (const event of events) {
    try {
      await publisher.publish(event);
      await repository.completeOutboxEvent(event.id, options.workerId, clock());
      result.processed += 1;
    } catch (error) {
      const failedAt = clock();
      const updated = await repository.failOutboxEvent({
        eventId: event.id,
        workerId: options.workerId,
        error: errorMessage(error),
        failedAt,
        nextAvailableAt: new Date(failedAt.getTime() + retryDelayMs(event.attempts)),
        maxAttempts: options.maxAttempts
      });
      if (updated.status === 'failed') result.failed += 1;
      else result.deferred += 1;
    }
  }
  return result;
}
