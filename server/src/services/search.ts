import { z } from 'zod';
import { rankingConfig } from '../catalog.js';
import type { RestaurantRepository } from '../domain/repository.js';
import { normalizeToWgs84 } from '../geo/coordinates.js';
import { isRestaurantOpen } from './hours.js';
import { toRestaurantDto } from './presentation.js';
import { compareRanked, rankRestaurant } from './ranking.js';

export const searchRequestSchema = z.object({
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    coord_type: z.enum(['wgs84', 'gcj02'])
  }),
  coverage_area_id: z.string().min(1).max(80),
  radius_m: z.number().int().min(100).max(10000).default(2000),
  keyword: z.string().trim().max(80).default(''),
  filters: z.object({
    budget_max_fen: z.number().int().nonnegative().nullable().default(null),
    cuisine_codes: z.array(z.string().min(1).max(40)).max(16).default([]),
    open_now: z.boolean().default(false),
    fast_meal: z.boolean().default(false),
    only_solo_verified: z.boolean().default(true)
  }).default({ budget_max_fen: null, cuisine_codes: [], open_now: false, fast_meal: false, only_solo_verified: true }),
  sort: z.enum(['recommended', 'distance']).default('recommended'),
  page_size: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(256).nullable().default(null)
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

const cursorSchema = z.object({ offset: z.number().int().nonnegative(), rankingVersion: z.string() });

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (parsed.rankingVersion !== rankingConfig.version) throw new Error('Ranking version changed');
    return parsed.offset;
  } catch {
    throw new Error('INVALID_CURSOR');
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset, rankingVersion: rankingConfig.version })).toString('base64url');
}

export async function searchRestaurants(repository: RestaurantRepository, request: SearchRequest, requestId: string, now = new Date()) {
  const area = await repository.getCoverageArea(request.coverage_area_id);
  if (!area) throw new Error('COVERAGE_AREA_NOT_FOUND');
  const searchable = area.status === 'live' || area.status === 'beta';
  const offset = decodeCursor(request.cursor);
  if (!searchable) {
    return {
      request_id: requestId,
      city_code: area.cityCode,
      coverage_area: { id: area.id, name: area.name },
      coverage_status: area.status,
      data_freshness: 'unavailable',
      ranking_version: rankingConfig.version,
      results: [],
      next_cursor: null
    };
  }

  const locationWgs84 = normalizeToWgs84(request.location, request.location.coord_type);
  const candidates = await repository.findCandidates({
    coverageAreaId: request.coverage_area_id,
    locationWgs84,
    radiusM: request.radius_m,
    keyword: request.keyword,
    budgetMaxFen: request.filters.budget_max_fen,
    cuisineCodes: request.filters.cuisine_codes,
    onlySoloVerified: request.filters.only_solo_verified,
    fastMeal: request.filters.fast_meal
  });

  const visible = request.filters.open_now
    ? candidates.filter(candidate => isRestaurantOpen(candidate.hours, now, candidate.cityTimezone))
    : candidates;
  const ranked = visible.map(restaurant => rankRestaurant(restaurant, {
    radiusM: request.radius_m,
    budgetMaxFen: request.filters.budget_max_fen,
    cuisineCodes: request.filters.cuisine_codes,
    fastMeal: request.filters.fast_meal,
    now
  }));

  if (request.sort === 'distance') {
    ranked.sort((left, right) => (left.restaurant.distanceM ?? Number.MAX_SAFE_INTEGER) - (right.restaurant.distanceM ?? Number.MAX_SAFE_INTEGER)
      || left.restaurant.id.localeCompare(right.restaurant.id));
  } else ranked.sort(compareRanked);

  const page = ranked.slice(offset, offset + request.page_size);
  const nextOffset = offset + page.length;
  return {
    request_id: requestId,
    city_code: area.cityCode,
    coverage_area: { id: area.id, name: area.name },
    coverage_status: area.status,
    data_freshness: page.some(item => item.freshness === 'stale' || item.freshness === 'unknown') ? 'mixed' : 'fresh',
    ranking_version: rankingConfig.version,
    results: page.map(item => toRestaurantDto(item, now)),
    next_cursor: nextOffset < ranked.length ? encodeCursor(nextOffset) : null
  };
}
