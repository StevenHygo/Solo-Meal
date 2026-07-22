import type { RestaurantRecord } from '../domain/repository.js';
import type { RankingWeights } from '../domain/ranking-config.js';

export interface RankingPreferences {
  radiusM: number;
  budgetMaxFen: number | null;
  cuisineCodes: string[];
  fastMeal: boolean;
  now: Date;
}

export interface RankedRestaurant {
  restaurant: RestaurantRecord;
  rankScore: number;
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function dataFreshness(verifiedAt: string | null, now: Date): RankedRestaurant['freshness'] {
  if (!verifiedAt) return 'unknown';
  const days = Math.max(0, (now.getTime() - new Date(verifiedAt).getTime()) / 86400000);
  if (days <= 30) return 'fresh';
  if (days <= 90) return 'aging';
  return 'stale';
}

function freshnessFactor(freshness: RankedRestaurant['freshness']): number {
  return { fresh: 1, aging: 0.88, stale: 0.68, unknown: 0.6 }[freshness];
}

export function rankRestaurant(
  restaurant: RestaurantRecord,
  preferences: RankingPreferences,
  weights: RankingWeights
): RankedRestaurant {
  const freshness = dataFreshness(restaurant.lastVerifiedAt, preferences.now);
  const soloFit = restaurant.soloScore * freshnessFactor(freshness);
  const distance = restaurant.distanceM ?? preferences.radiusM;
  const distanceFit = clamp(100 * (1 - distance / preferences.radiusM), 0, 100);
  const budgetFit = preferences.budgetMaxFen === null ? 50 : 100;
  const cuisineFit = preferences.cuisineCodes.length ? 100 : 50;
  const timeFit = preferences.fastMeal ? 100 : 50;
  const rankScore = weights.soloFit * soloFit
    + weights.distanceFit * distanceFit
    + weights.budgetFit * budgetFit
    + weights.cuisineFit * cuisineFit
    + weights.timeFit * timeFit;
  return { restaurant, rankScore: Math.round(rankScore * 10000) / 10000, freshness };
}

const confidenceOrder = { high: 3, medium: 2, low: 1 } as const;

export function compareRanked(left: RankedRestaurant, right: RankedRestaurant): number {
  return right.rankScore - left.rankScore
    || confidenceOrder[right.restaurant.confidence] - confidenceOrder[left.restaurant.confidence]
    || (left.restaurant.distanceM ?? Number.MAX_SAFE_INTEGER) - (right.restaurant.distanceM ?? Number.MAX_SAFE_INTEGER)
    || left.restaurant.id.localeCompare(right.restaurant.id);
}
