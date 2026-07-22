import { dataSourceConfig, getCuisine } from '../config.js';
import { restaurants as sourceRestaurants } from '../data.js';
import { apiClient } from './api-client.js';

const staticRestaurants = sourceRestaurants.map(restaurant => ({ ...restaurant, mapCoordType: restaurant.mapCoordType || 'gcj02' }));
const cache = new Map(staticRestaurants.map(restaurant => [restaurant.id, restaurant]));
const successfulSearches = new Map();

function outOfChina(coordinate) {
  return coordinate.lng < 72.004 || coordinate.lng > 137.8347 || coordinate.lat < 0.8293 || coordinate.lat > 55.8271;
}

function transformLat(x, y) {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  value += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return value;
}

function transformLng(x, y) {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  value += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return value;
}

function gcj02ToWgs84(coordinate) {
  if (outOfChina(coordinate)) return { ...coordinate };
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(coordinate.lng - 105, coordinate.lat - 35);
  let dLng = transformLng(coordinate.lng - 105, coordinate.lat - 35);
  const radLat = coordinate.lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: coordinate.lat * 2 - (coordinate.lat + dLat), lng: coordinate.lng * 2 - (coordinate.lng + dLng) };
}

function normalizeToWgs84(coordinate, coordType = 'wgs84') {
  return coordType === 'gcj02' ? gcj02ToWgs84(coordinate) : { lat: coordinate.lat, lng: coordinate.lng };
}

function distanceMeters(left, right) {
  const radians = degrees => degrees * Math.PI / 180;
  const latDelta = radians(right.lat - left.lat);
  const lngDelta = radians(right.lng - left.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

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
  const queryLocation = normalizeToWgs84(query.location, query.location.coordType);
  return staticRestaurants
    .flatMap(item => {
      if (!query.coverageSearchable) return [];
      if (item.cityCode !== query.cityCode || item.coverageAreaCode !== query.coverageAreaCode) return [];
      const searchable = [item.name, item.cuisine, item.district, item.address].join(' ').toLowerCase();
      if (keyword && !searchable.includes(keyword)) return [];
      if (budget && item.priceMin > Number(budget)) return [];
      if (cuisine !== 'all' && item.cuisineCode !== cuisine) return [];
      if (onlySolo && !item.acceptsSolo) return [];
      if (openNow && !item.openNow) return [];
      if (fastMeal && item.mealMinutes[1] > 40) return [];
      const restaurantLocation = normalizeToWgs84({ lat: item.latitude, lng: item.longitude }, item.mapCoordType);
      const distance = distanceMeters(queryLocation, restaurantLocation);
      if (maxDistance && distance > Number(maxDistance)) return [];
      const result = { ...item, distance };
      cache.set(result.id, { ...cache.get(result.id), ...result });
      return [result];
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
  async submitFeedback(input) {
    if (apiClient.options().mode !== 'api') return { submitted: false, source: 'local' };
    try {
      const response = await apiClient.submitFeedback({
        restaurant_id: input.restaurantId,
        report_type: input.reportType,
        note: input.note,
        idempotency_key: input.idempotencyKey
      });
      return { submitted: true, source: 'api', report: response.report, idempotentReplay: response.idempotent_replay === true };
    } catch (error) {
      return { submitted: false, source: 'local', error: error.message };
    }
  },
  getCachedRestaurant: id => cache.get(id) || null
};
