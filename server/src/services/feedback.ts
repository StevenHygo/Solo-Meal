import { z } from 'zod';
import type { FeedbackReportType } from '../domain/operations.js';

export const feedbackReportTypes = [
  'closed_or_moved',
  'rejects_solo',
  'hours_incorrect',
  'price_incorrect',
  'seating_incorrect',
  'branch_mismatch',
  'other'
] as const satisfies readonly FeedbackReportType[];

export const feedbackRequestSchema = z.object({
  restaurant_id: z.string().min(1).max(80),
  report_type: z.enum(feedbackReportTypes),
  note: z.string().trim().max(200)
    .refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), 'note contains unsupported control characters')
    .default(''),
  idempotency_key: z.uuid()
});

export function feedbackPriority(type: FeedbackReportType): number {
  if (type === 'closed_or_moved' || type === 'rejects_solo' || type === 'branch_mismatch') return 0;
  if (type === 'hours_incorrect' || type === 'seating_incorrect') return 1;
  if (type === 'price_incorrect') return 2;
  return 3;
}
