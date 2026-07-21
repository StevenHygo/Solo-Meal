import type { CoverageStatus } from './types.js';

export interface CoverageQualityMetrics {
  publishedRestaurants: number;
  recentVerificationRate: number | null;
  coreCompletenessRate: number | null;
  providerReferenceRate: number | null;
  searchSampleCoverageRate: number | null;
  branchMismatchRate: number | null;
  visitConformityRate: number | null;
  highPriorityFeedbackSlaRate: number | null;
  incidentFreeWeeks: number | null;
  pendingHighConfidenceMatches: number;
  providerTermsReviewed: boolean | null;
  privacyReviewed: boolean | null;
  postgisRehearsalPassed: boolean | null;
}

export interface CoverageQualityRecord {
  areaId: string;
  areaName: string;
  cityCode: string;
  status: CoverageStatus;
  metrics: CoverageQualityMetrics;
  measuredAt: string;
}

export interface CoverageGateCheck {
  code: string;
  label: string;
  value: number | boolean | null;
  target: string;
  passed: boolean;
  source: 'database' | 'manual';
}

export interface CoverageGateResult {
  policyVersion: string;
  eligible: boolean;
  checks: CoverageGateCheck[];
}

export interface CoverageQualityManualUpdate {
  searchSampleCoverageRate?: number;
  branchMismatchRate?: number;
  visitConformityRate?: number;
  incidentFreeWeeks?: number;
  providerTermsReviewed?: boolean;
  privacyReviewed?: boolean;
  postgisRehearsalPassed?: boolean;
  evidenceNote: string;
  actorId: string;
  updatedAt: Date;
}
