import { z } from 'zod';
import type { CurationTaskRecord, CurationTaskStatus } from '../domain/operations.js';

const taskStatuses = ['open', 'in_progress', 'completed', 'cancelled'] as const satisfies readonly CurationTaskStatus[];

export const curationTaskQuerySchema = z.object({
  status: z.enum(taskStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const curationTaskParamsSchema = z.object({ id: z.uuid() });

export const curationTaskUpdateSchema = z.object({
  status: z.enum(taskStatuses),
  assignee: z.string().trim().min(1).max(80).nullable().optional(),
  resolution_note: z.string().trim().min(1).max(500).optional(),
  feedback_status: z.enum(['resolved', 'rejected']).optional()
}).superRefine((value, context) => {
  const terminal = value.status === 'completed' || value.status === 'cancelled';
  if (terminal && !value.resolution_note) {
    context.addIssue({ code: 'custom', path: ['resolution_note'], message: 'resolution_note is required for terminal tasks' });
  }
  if (value.feedback_status && !terminal) {
    context.addIssue({ code: 'custom', path: ['feedback_status'], message: 'feedback_status is only valid for terminal tasks' });
  }
  if (value.status === 'in_progress' && value.assignee === null) {
    context.addIssue({ code: 'custom', path: ['assignee'], message: 'assignee cannot be null for in-progress tasks' });
  }
});

const transitions: Record<CurationTaskStatus, CurationTaskStatus[]> = {
  open: ['open', 'in_progress', 'completed', 'cancelled'],
  in_progress: ['open', 'in_progress', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled']
};

export function assertTaskTransition(current: CurationTaskStatus, next: CurationTaskStatus): void {
  if (!transitions[current].includes(next)) throw new Error('INVALID_TASK_TRANSITION');
}

export function assertTaskClaim(
  currentStatus: CurationTaskStatus,
  currentAssignee: string | null,
  nextStatus: CurationTaskStatus,
  nextAssignee: string | null | undefined
): void {
  if (currentStatus !== 'in_progress' || nextStatus !== 'in_progress') return;
  if (currentAssignee && nextAssignee && currentAssignee !== nextAssignee) throw new Error('TASK_ALREADY_CLAIMED');
}

export function toCurationTaskDto(task: CurationTaskRecord) {
  return {
    id: task.id,
    city_code: task.cityCode,
    restaurant: task.restaurantId ? {
      id: task.restaurantId,
      legacy_id: task.restaurantLegacyId,
      name: task.restaurantName
    } : null,
    feedback: task.feedbackReportId ? {
      id: task.feedbackReportId,
      report_type: task.reportType,
      note: task.reportNote,
      status: task.feedbackStatus
    } : null,
    reason: task.reason,
    priority: task.priority,
    status: task.status,
    assignee: task.assignee,
    resolution_note: task.resolutionNote,
    due_at: task.dueAt,
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
}
