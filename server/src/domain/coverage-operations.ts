import type { CoverageStatus } from './types.js';

export interface ManagedCoverageArea {
  id: string;
  name: string;
  configuredStatus: CoverageStatus;
  effectiveStatus: CoverageStatus;
}

export interface ManagedCoverageCity {
  code: string;
  name: string;
  timezone: string;
  status: CoverageStatus;
  areas: ManagedCoverageArea[];
}

export interface CoverageStatusUpdate {
  status: CoverageStatus;
  reason: string;
  actorId: string;
  updatedAt: Date;
}

export interface ExpiringEvidenceQuery {
  withinDays: number;
  coverageAreaId: string | null;
  attribute: string | null;
  limit: number;
  at: Date;
}

export interface ExpiringEvidenceRecord {
  id: string;
  restaurantId: string;
  restaurantLegacyId: string | null;
  restaurantName: string;
  cityCode: string;
  coverageAreaId: string;
  coverageAreaName: string;
  attribute: string;
  title: string;
  sourceType: string;
  sourceLabel: string;
  expiresAt: string;
  expiresInDays: number;
}
