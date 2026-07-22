import { z } from 'zod';
import type {
  AuditLogRecord,
  OperationsExport,
  OperationsExportValue,
  OutboxEventRecord
} from '../domain/operations-control.js';

const optionalFilter = z.string().trim().min(1).max(120).optional();

export const auditLogQuerySchema = z.object({
  actor_id: optionalFilter,
  action: optionalFilter,
  entity_type: optionalFilter,
  entity_id: optionalFilter,
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const outboxEventQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'failed', 'processed']).optional(),
  topic: optionalFilter,
  aggregate_id: optionalFilter,
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const outboxEventParamsSchema = z.object({ id: z.uuid() });

export const operationsExportParamsSchema = z.object({
  dataset: z.enum(['restaurants', 'poi_candidates', 'curation_tasks', 'audit_logs'])
});

export const operationsExportQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(1000)
});

export function toAuditLogDto(log: AuditLogRecord) {
  return {
    id: log.id,
    actor_id: log.actorId,
    action: log.action,
    entity_type: log.entityType,
    entity_id: log.entityId,
    reason: log.reason,
    before_value: log.beforeValue,
    after_value: log.afterValue,
    created_at: log.createdAt
  };
}

export function toOutboxEventDto(event: OutboxEventRecord) {
  return {
    id: event.id,
    topic: event.topic,
    aggregate_id: event.aggregateId,
    payload: event.payload,
    status: event.status,
    available_at: event.availableAt,
    processed_at: event.processedAt,
    attempts: event.attempts,
    last_error: event.lastError,
    failed_at: event.failedAt,
    locked_by: event.lockedBy,
    locked_at: event.lockedAt,
    created_at: event.createdAt
  };
}

function csvCell(value: OperationsExportValue): string {
  if (value === null) return '';
  let normalized = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replaceAll('"', '""')}"`;
}

export function serializeOperationsCsv(data: OperationsExport): string {
  const lines = [data.columns.map(csvCell).join(',')];
  for (const row of data.rows) lines.push(row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
