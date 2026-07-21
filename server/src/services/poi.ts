import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoiCandidateRecord, PoiCandidateReview, PoiCandidateStatus, PoiImportSubmission } from '../domain/poi.js';
import { normalizeToWgs84 } from '../geo/coordinates.js';

const providerSchema = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,31}$/);
const cleanText = (max: number) => z.string().trim().min(1).max(max);
const poiStatuses = ['pending', 'matched', 'new_branch', 'rejected'] as const satisfies readonly PoiCandidateStatus[];

const poiCandidateInputSchema = z.object({
  provider_poi_id: cleanText(128),
  name: cleanText(160),
  address: cleanText(300),
  district: cleanText(80),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    coord_type: z.enum(['wgs84', 'gcj02'])
  }),
  phone: z.string().trim().max(40).optional(),
  raw_category: z.string().trim().max(120).optional(),
  observed_at: z.iso.datetime({ offset: true })
});

export const poiImportRequestSchema = z.object({
  coverage_area_id: cleanText(80),
  provider: providerSchema,
  source_label: cleanText(120),
  authorization_basis: z.string().trim().min(10).max(500),
  idempotency_key: z.uuid(),
  candidates: z.array(poiCandidateInputSchema).min(1).max(50)
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.candidates.forEach((candidate, index) => {
    if (ids.has(candidate.provider_poi_id)) {
      context.addIssue({ code: 'custom', path: ['candidates', index, 'provider_poi_id'], message: 'provider_poi_id is duplicated in this batch' });
    }
    ids.add(candidate.provider_poi_id);
  });
});

export const poiCandidateQuerySchema = z.object({
  status: z.enum(poiStatuses).optional(),
  coverage_area_id: cleanText(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const poiCandidateParamsSchema = z.object({ id: z.uuid() });

export const poiCandidateReviewSchema = z.object({
  decision: z.enum(['match_existing', 'new_branch', 'reject']),
  restaurant_id: cleanText(80).optional(),
  resolution_note: z.string().trim().min(5).max(500)
}).superRefine((value, context) => {
  if (value.decision === 'match_existing' && !value.restaurant_id) {
    context.addIssue({ code: 'custom', path: ['restaurant_id'], message: 'restaurant_id is required when matching an existing restaurant' });
  }
  if (value.decision !== 'match_existing' && value.restaurant_id) {
    context.addIssue({ code: 'custom', path: ['restaurant_id'], message: 'restaurant_id is only valid when matching an existing restaurant' });
  }
});

function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 5 && digits.length <= 24 ? digits : null;
}

export function preparePoiImport(
  input: z.infer<typeof poiImportRequestSchema>,
  actorId: string,
  importedAt: Date
): PoiImportSubmission {
  const candidates = input.candidates.map(candidate => {
    const sourceLocation = { lat: candidate.location.lat, lng: candidate.location.lng };
    return {
      providerPoiId: candidate.provider_poi_id,
      name: candidate.name,
      address: candidate.address,
      district: candidate.district,
      sourceCoordType: candidate.location.coord_type,
      sourceLocation,
      locationWgs84: normalizeToWgs84(sourceLocation, candidate.location.coord_type),
      phoneNormalized: normalizePhone(candidate.phone),
      rawCategory: candidate.raw_category || null,
      observedAt: new Date(candidate.observed_at)
    };
  });
  const hashInput = JSON.stringify({
    coverageAreaId: input.coverage_area_id,
    provider: input.provider,
    sourceLabel: input.source_label,
    authorizationBasis: input.authorization_basis,
    candidates: candidates.map(candidate => ({
      ...candidate,
      observedAt: candidate.observedAt.toISOString()
    }))
  });
  return {
    coverageAreaId: input.coverage_area_id,
    provider: input.provider,
    sourceLabel: input.source_label,
    authorizationBasis: input.authorization_basis,
    idempotencyKey: input.idempotency_key,
    payloadSha256: createHash('sha256').update(hashInput).digest('hex'),
    candidates,
    actorId,
    importedAt
  };
}

export function assertPoiCandidateTransition(current: PoiCandidateStatus, review: PoiCandidateReview): PoiCandidateStatus {
  const next = review.decision === 'match_existing' ? 'matched' : review.decision === 'new_branch' ? 'new_branch' : 'rejected';
  if (current === 'pending') return next;
  if (current === 'new_branch' && (next === 'new_branch' || next === 'matched' || next === 'rejected')) return next;
  if (current === next) return next;
  throw new Error('INVALID_POI_CANDIDATE_TRANSITION');
}

export function toPoiCandidateDto(candidate: PoiCandidateRecord) {
  return {
    id: candidate.id,
    provider: candidate.provider,
    provider_poi_id: candidate.providerPoiId,
    city_code: candidate.cityCode,
    coverage_area: { id: candidate.coverageAreaId, name: candidate.coverageAreaName },
    name: candidate.name,
    address: candidate.address,
    district: candidate.district,
    location: {
      source: { ...candidate.sourceLocation, coord_type: candidate.sourceCoordType },
      wgs84: candidate.locationWgs84
    },
    phone_normalized: candidate.phoneNormalized,
    raw_category: candidate.rawCategory,
    observed_at: candidate.observedAt,
    status: candidate.status,
    matched_restaurant: candidate.matchedRestaurantId ? {
      id: candidate.matchedRestaurantId,
      legacy_id: candidate.matchedRestaurantLegacyId,
      name: candidate.matchedRestaurantName
    } : null,
    draft_restaurant: candidate.draftRestaurantId ? {
      id: candidate.draftRestaurantId,
      status: candidate.draftRestaurantStatus
    } : null,
    suggested_restaurant: candidate.suggestedRestaurantId ? {
      id: candidate.suggestedRestaurantId,
      legacy_id: candidate.suggestedRestaurantLegacyId,
      name: candidate.suggestedRestaurantName,
      score: candidate.suggestionScore
    } : null,
    match_method: candidate.matchMethod,
    resolution_note: candidate.resolutionNote,
    reviewed_by: candidate.reviewedBy,
    reviewed_at: candidate.reviewedAt,
    first_seen_at: candidate.firstSeenAt,
    last_seen_at: candidate.lastSeenAt
  };
}
