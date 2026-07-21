import { cuisineCategories } from '../catalog.js';
import type { RestaurantRecord } from '../domain/repository.js';
import type { RankedRestaurant } from './ranking.js';
import { formatHours, isRestaurantOpen } from './hours.js';

const cuisineByCode = new Map(cuisineCategories.map(category => [category.code, category]));

function reasonLabel(code: string, restaurant: RestaurantRecord): string {
  const labels: Record<string, string> = {
    counter_seats: `${restaurant.counterSeats} 个吧台位`,
    solo_noodles: '支持单人面',
    quick_meal: `${restaurant.mealMinutes[1]} 分钟内吃完`,
    solo_set: '单人套餐清晰',
    quiet: '环境较安静',
    accepts_solo: '全天接待单人',
    wall_seats: '有少量靠墙位',
    small_portions: '可单点小份菜',
    budget_friendly: `人均 ${Math.ceil(restaurant.priceMaxFen / 100)} 元内`,
    takeaway_fast: '外带速度快',
    single_grill: `${restaurant.counterSeats} 个单人炉位`,
    dinner_only: '晚餐营业',
    transit_access: '商场内易到达'
  };
  return labels[code] ?? code;
}

export function toRestaurantDto(ranked: RankedRestaurant, now: Date) {
  const restaurant = ranked.restaurant;
  const primaryCuisine = cuisineByCode.get(restaurant.primaryCuisineCode) ?? cuisineByCode.get('other');
  if (!primaryCuisine) throw new Error('Missing other cuisine category');
  return {
    id: restaurant.id,
    legacy_id: restaurant.legacyId,
    name: restaurant.name,
    address: restaurant.address,
    district: restaurant.district,
    city_code: restaurant.cityCode,
    coverage_area: restaurant.coverageArea,
    distance_m: restaurant.distanceM === null ? null : Math.round(restaurant.distanceM),
    location: {
      wgs84: restaurant.locationWgs84,
      gcj02: restaurant.locationGcj02
    },
    price: { min_fen: restaurant.priceMinFen, max_fen: restaurant.priceMaxFen },
    primary_cuisine_code: restaurant.primaryCuisineCode,
    cuisine_codes: restaurant.cuisineCodes,
    cuisine_icon_key: primaryCuisine.iconKey,
    open_now: isRestaurantOpen(restaurant.hours, now, restaurant.cityTimezone),
    hours_label: formatHours(restaurant.hours),
    accepts_solo: restaurant.acceptsSolo,
    meal_minutes: { min: restaurant.mealMinutes[0], max: restaurant.mealMinutes[1] },
    solo_score: restaurant.soloScore,
    confidence: restaurant.confidence,
    reason_codes: restaurant.reasonCodes,
    reasons: restaurant.reasonCodes.map(code => reasonLabel(code, restaurant)),
    last_verified_at: restaurant.lastVerifiedAt,
    data_freshness: ranked.freshness,
    rank_score: ranked.rankScore
  };
}

export function toRestaurantDetailDto(ranked: RankedRestaurant, now: Date) {
  const summary = toRestaurantDto(ranked, now);
  const restaurant = ranked.restaurant;
  return {
    ...summary,
    peak_policy: restaurant.peakPolicy,
    seat_types: restaurant.seatTypes,
    counter_seats: restaurant.counterSeats,
    solo_portion: restaurant.soloPortion,
    min_spend_fen: restaurant.minSpendFen,
    noise_level: restaurant.noiseLevel,
    dishes: restaurant.dishes,
    note: restaurant.note,
    hours: restaurant.hours,
    evidence: restaurant.evidence.map(item => ({
      attribute: item.attribute,
      title: item.title,
      value: item.value,
      source_type: item.sourceType,
      source_label: item.sourceLabel,
      observed_at: item.observedAt,
      expires_at: item.expiresAt,
      status: item.status
    }))
  };
}
