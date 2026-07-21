export type FeedbackReportType =
  | 'closed_or_moved'
  | 'rejects_solo'
  | 'hours_incorrect'
  | 'price_incorrect'
  | 'seating_incorrect'
  | 'branch_mismatch'
  | 'other';

export interface FeedbackSubmission {
  restaurantId: string;
  reportType: FeedbackReportType;
  note: string;
  idempotencyKey: string;
  priority: number;
  submittedAt: Date;
}

export interface FeedbackReceipt {
  reportId: string;
  taskId: string;
  status: 'open';
  created: boolean;
  receivedAt: string;
}

export type CurationTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

export interface CurationTaskRecord {
  id: string;
  cityCode: string;
  restaurantId: string | null;
  restaurantLegacyId: string | null;
  restaurantName: string | null;
  feedbackReportId: string | null;
  reportType: FeedbackReportType | null;
  reportNote: string | null;
  feedbackStatus: 'open' | 'triaged' | 'resolved' | 'rejected' | null;
  reason: string;
  priority: number;
  status: CurationTaskStatus;
  assignee: string | null;
  resolutionNote: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurationTaskUpdate {
  status: CurationTaskStatus;
  assignee?: string | null;
  resolutionNote?: string;
  feedbackStatus?: 'resolved' | 'rejected';
  actorId: string;
  updatedAt: Date;
}

export interface EvidenceSweepResult {
  expiredEvidence: number;
  createdTasks: number;
  processedAt: string;
}
