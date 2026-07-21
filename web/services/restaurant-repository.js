import { dataSourceConfig, getCuisine } from '../config.js';
import { restaurants as staticRestaurants } from '../data.js';
import { apiClient } from './api-client.js';

const cache = new Map(staticRestaurants.map(restaurant => [restaurant.id, restaurant]));
const successfulSearches = new Map();

function confidenceLabel(confidence) {
  return { high: '高可信', medium: '中可信', low: '待补充' }[confidence] || '待补充';
}

function relativeVerifiedAt(value) {
  if (!value) return '待核验';
  const days = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return '今天';
  return `${days} 天前`;
}

function adaptSummary(item) {
  const cuisine = getCuisine(item.primary_cuisine_code);
  const location = item.location.gcj02 || item.location.wgs84;
  const adapted = {
    id: item.legacy_id || item.id,
    apiId: item.id,
    name: item.name,
    cuisine: cuisine.label,
    cuisineCode: item.primary_cuisine_code,
    cityCode: item.city_code,
    coverageAreaCode: item.coverage_area.id,
    district: item.district,
    address: item.address,
    distance: item.distance_m ?? 0,
    priceMin: Math.round(item.price.min_fen / 100),
    priceMax: Math.round(item.price.max_fen / 100),
    latitude: location.lat,
    longitude: location.lng,
    mapCoordType: item.location.gcj02 ? 'gcj02' : 'wgs84',
    openNow: item.open_now,
    hours: item.hours_label,
    acceptsSolo: item.accepts_solo === true,
    mealMinutes: [item.meal_minutes.min, item.meal_minutes.max],
    soloScore: item.solo_score,
    confidence: item.confidence,
    confidenceLabel: confidenceLabel(item.confidence),
    verifiedAt: relativeVerifiedAt(item.last_verified_at),
    reasons: item.reasons,
    reasonCodes: item.reason_codes,
    dataFreshness: item.data_freshness
  };
  cache.set(adapted.id, { ...cache.get(adapted.id), ...adapted });
  return adapted;
}

function adaptDetail(item) {
  const summary = adaptSummary(item);
  const detail = {
    ...summary,
    peakPolicy: item.peak_policy,
    seatTypes: item.seat_types,
    counterSeats: item.counter_seats,
    soloPortion: item.solo_portion === true,
    minSpend: item.min_spend_fen === null ? null : Math.round(item.min_spend_fen / 100),
    noiseLevel: item.noise_level,
    dishes: item.dishes,
    note: item.note,
    evidence: item.evidence.map(evidence => ({
      title: evidence.title,
      value: evidence.value,
      source: evidence.source_label,
      time: evidence.observed_at.slice(0, 10),
      status: evidence.status
    }))
  };
  cache.set(detail.id, detail);
  return detail;
}

function staticSearch(query) {
  const keyword = query.keyword.trim().toLowerCase();
  const { budget, cuisine, onlySolo, openNow, fastMeal, maxDistance } = query.filters;
  const quietMode = query.scene === 'quiet';
  return staticRestaurants
    .filter(item => {
      if (!query.coverageSearchable) return false;
      if (item.cityCode !== query.cityCode || item.coverageAreaCode !== query.coverageAreaCode) return false;
      const searchable = [item.name, item.cuisine, item.district, item.address].join(' ').toLowerCase();
      if (keyword && !searchable.includes(keyword)) return false;
      if (budget && item.priceMin > Number(budget)) return false;
      if (cuisine !== 'all' && item.cuisineCode !== cuisine) return false;
      if (onlySolo && !item.acceptsSolo) return false;
      if (openNow && !item.openNow) return false;
      if (fastMeal && item.mealMinutes[1] > 40) return false;
      if (maxDistance && item.distance > Number(maxDistance)) return false;
      return true;
    })
    .sort((left, right) => {
      const quietLeft = quietMode ? (5 - left.noiseLevel) * 3 : 0;
      const quietRight = quietMode ? (5 - right.noiseLevel) * 3 : 0;
      const leftScore = left.soloScore - left.distance / 250 + quietLeft;
      const rightScore = right.soloScore - right.distance / 250 + quietRight;
      return rightScore - leftScore;
    });
}

function apiSearchPayload(query) {
  return {
    location: { lat: query.location.lat, lng: query.location.lng, coord_type: query.location.coordType },
    coverage_area_id: query.coverageAreaCode,
    radius_m: Number(query.filters.maxDistance) || 2000,
    keyword: query.keyword,
    filters: {
      budget_max_fen: query.filters.budget ? Number(query.filters.budget) * 100 : null,
      cuisine_codes: query.filters.cuisine === 'all' ? [] : [query.filters.cuisine],
      open_now: query.filters.openNow,
      fast_meal: query.filters.fastMeal,
      only_solo_verified: query.filters.onlySolo
    },
    sort: 'recommended',
    page_size: 50,
    cursor: null
  };
}

function searchCacheKey(query) {
  return JSON.stringify({
    keyword: query.keyword.trim(),
    scene: query.scene,
    filters: query.filters,
    cityCode: query.cityCode,
    coverageAreaCode: query.coverageAreaCode,
    location: query.location
  });
}

function hasDetail(item) {
  return item && Array.isArray(item.evidence) && Array.isArray(item.dishes) && Array.isArray(item.seatTypes);
}

export const restaurantRepository = {
  mode: () => apiClient.options().mode,
  async search(query) {
    if (apiClient.options().mode !== 'api') {
      return { results: staticSearch(query), source: 'static', snapshotVersion: dataSourceConfig.snapshotVersion, cachedAt: null };
    }
    if (!query.coverageAreaCode) {
      return { results: [], source: 'fallback', snapshotVersion: dataSourceConfig.snapshotVersion, cachedAt: null, error: 'COVERAGE_AREA_MISSING' };
    }
    const cacheKey = searchCacheKey(query);
    try {
      const response = await apiClient.searchRestaurants(apiSearchPayload(query));
      const result = { results: response.results.map(adaptSummary), source: 'api', snapshotVersion: response.ranking_version, cachedAt: new Date().toISOString() };
      successfulSearches.set(cacheKey, result);
      return result;
    } catch (error) {
      const cached = successfulSearches.get(cacheKey);
      if (cached) return { ...cached, source: 'cache', error: error.message };
      const fallback = staticSearch(query);
      return { results: fallback, source: 'fallback', snapshotVersion: dataSourceConfig.snapshotVersion, cachedAt: null, error: error.message };
    }
  },
  async getRestaurant(id) {
    if (apiClient.options().mode === 'api') {
      try {
        const response = await apiClient.getRestaurant(cache.get(id)?.apiId || id);
        return { restaurant: adaptDetail(response.restaurant), source: 'api' };
      } catch (error) {
        const cached = cache.get(id);
        return { restaurant: hasDetail(cached) ? cached : null, source: 'fallback', error: error.message };
      }
    }
    return { restaurant: cache.get(id) || null, source: 'static' };
  },
  getCachedRestaurant: id => cache.get(id) || null
};
