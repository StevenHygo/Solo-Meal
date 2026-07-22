import { z } from 'zod';
import type {
  ExpiringEvidenceRecord,
  ManagedCoverageCity
} from '../domain/coverage-operations.js';
import type { CoverageStatus } from '../domain/types.js';

export const coverageStatusSchema = z.enum(['live', 'beta', 'upcoming', 'paused', 'unsupported']);

export const cityCoverageParamsSchema = z.object({ code: z.string().min(1).max(80) });
export const coverageAreaParamsSchema = z.object({ id: z.string().min(1).max(80) });

export const coverageStatusUpdateSchema = z.object({
  status: coverageStatusSchema,
  reason: z.string().trim().min(5).max(500)
});

export const expiringEvidenceQuerySchema = z.object({
  within_days: z.coerce.number().int().min(1).max(365).default(30),
  coverage_area_id: z.string().trim().min(1).max(80).optional(),
  attribute: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export function effectiveCoverageStatus(cityStatus: CoverageStatus, areaStatus: CoverageStatus): CoverageStatus {
  return cityStatus === 'live' || cityStatus === 'beta' ? areaStatus : cityStatus;
}

export function toManagedCoverageDto(cities: ManagedCoverageCity[]) {
  return cities.map(city => ({
    code: city.code,
    name: city.name,
    timezone: city.timezone,
    status: city.status,
    areas: city.areas.map(area => ({
      id: area.id,
      name: area.name,
      configured_status: area.configuredStatus,
      effective_status: area.effectiveStatus
    }))
  }));
}

export function toExpiringEvidenceDto(record: ExpiringEvidenceRecord) {
  return {
    id: record.id,
    restaurant: {
      id: record.restaurantId,
      legacy_id: record.restaurantLegacyId,
      name: record.restaurantName
    },
    city_code: record.cityCode,
    coverage_area: { id: record.coverageAreaId, name: record.coverageAreaName },
    attribute: record.attribute,
    title: record.title,
    source_type: record.sourceType,
    source_label: record.sourceLabel,
    expires_at: record.expiresAt,
    expires_in_days: record.expiresInDays
  };
}
