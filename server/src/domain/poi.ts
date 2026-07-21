import type { Coordinate, CoordinateType } from './types.js';

export type PoiCandidateStatus = 'pending' | 'matched' | 'new_branch' | 'rejected';

export interface PoiCandidateSubmission {
  providerPoiId: string;
  name: string;
  address: string;
  district: string;
  sourceCoordType: CoordinateType;
  sourceLocation: Coordinate;
  locationWgs84: Coordinate;
  phoneNormalized: string | null;
  rawCategory: string | null;
  observedAt: Date;
}

export interface PoiImportSubmission {
  coverageAreaId: string;
  provider: string;
  sourceLabel: string;
  authorizationBasis: string;
  idempotencyKey: string;
  payloadSha256: string;
  candidates: PoiCandidateSubmission[];
  actorId: string;
  importedAt: Date;
}

export interface PoiImportReceipt {
  batchId: string;
  inputCount: number;
  createdCount: number;
  updatedCount: number;
  exactMatchCount: number;
  created: boolean;
  importedAt: string;
}

export interface PoiCandidateRecord {
  id: string;
  provider: string;
  providerPoiId: string;
  cityCode: string;
  coverageAreaId: string;
  coverageAreaName: string;
  name: string;
  address: string;
  district: string;
  sourceCoordType: CoordinateType;
  sourceLocation: Coordinate;
  locationWgs84: Coordinate;
  phoneNormalized: string | null;
  rawCategory: string | null;
  observedAt: string;
  status: PoiCandidateStatus;
  matchedRestaurantId: string | null;
  matchedRestaurantLegacyId: string | null;
  matchedRestaurantName: string | null;
  draftRestaurantId: string | null;
  draftRestaurantStatus: 'draft' | 'review' | 'published' | 'withdrawn' | null;
  suggestedRestaurantId: string | null;
  suggestedRestaurantLegacyId: string | null;
  suggestedRestaurantName: string | null;
  suggestionScore: number | null;
  matchMethod: 'provider_ref' | 'name_address_distance' | 'operator' | null;
  resolutionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PoiCandidateQuery {
  status: PoiCandidateStatus | null;
  coverageAreaId: string | null;
  limit: number;
}

export interface PoiCandidateReview {
  decision: 'match_existing' | 'new_branch' | 'reject';
  restaurantId?: string;
  resolutionNote: string;
  actorId: string;
  reviewedAt: Date;
}
