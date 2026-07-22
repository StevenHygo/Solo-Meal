import type { OutboxEventRecord } from '../domain/operations-control.js';

export interface OutboxPublisher {
  publish(event: OutboxEventRecord): Promise<void>;
}

interface WebhookPublisherOptions {
  url: string;
  token?: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
}

export class WebhookPublisher implements OutboxPublisher {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: WebhookPublisherOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async publish(event: OutboxEventRecord): Promise<void> {
    const response = await this.fetchImplementation(this.options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'solo-meal-outbox/1.0',
        'x-solo-meal-event-id': event.id,
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {})
      },
      body: JSON.stringify({
        id: event.id,
        topic: event.topic,
        aggregate_id: event.aggregateId,
        payload: event.payload,
        created_at: event.createdAt,
        attempt: event.attempts
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs)
    });
    if (!response.ok) throw new Error(`WEBHOOK_HTTP_${response.status}`);
  }
}
