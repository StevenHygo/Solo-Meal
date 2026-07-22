export type AuditValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface AuditLogRecord {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  beforeValue: AuditValue;
  afterValue: AuditValue;
  createdAt: string;
}

export interface AuditLogQuery {
  actorId: string | null;
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  limit: number;
}

export type OutboxStatus = 'pending' | 'processing' | 'failed' | 'processed';

export interface OutboxEventRecord {
  id: string;
  topic: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  availableAt: string;
  processedAt: string | null;
  attempts: number;
  lastError: string | null;
  failedAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export interface OutboxEventQuery {
  status: OutboxStatus | null;
  topic: string | null;
  aggregateId: string | null;
  limit: number;
}

export interface OutboxClaim {
  workerId: string;
  claimedAt: Date;
  leaseExpiredBefore: Date;
  limit: number;
}

export interface OutboxFailure {
  eventId: string;
  workerId: string;
  error: string;
  failedAt: Date;
  nextAvailableAt: Date;
  maxAttempts: number;
}

export type OperationsExportDataset = 'restaurants' | 'poi_candidates' | 'curation_tasks' | 'audit_logs';
export type OperationsExportValue = string | number | boolean | null;

export interface OperationsExport {
  columns: string[];
  rows: OperationsExportValue[][];
}
