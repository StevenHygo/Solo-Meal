import { cities, locationSuggestions, rankingConfig } from '../catalog.js';
import type { CandidateQuery, RestaurantRecord, RestaurantRepository, RepositoryHealth } from '../domain/repository.js';
import type { City, Coordinate, CoverageArea, LocationSuggestion, RestaurantFixture } from '../domain/types.js';
import { v0Restaurants } from '../fixtures/v0-restaurants.js';
import { normalizeToWgs84 } from '../geo/coordinates.js';

function distanceMeters(left: Coordinate, right: Coordinate): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitude = radians(right.lat - left.lat);
  const longitude = radians(right.lng - left.lng);
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRecord(fixture: RestaurantFixture, distanceM: number | null): RestaurantRecord {
  const city = cities.find(item => item.code === fixture.cityCode);
  const area = city?.areas.find(item => item.id === fixture.coverageAreaId);
  if (!city || !area) throw new Error(`Fixture ${fixture.legacyId} references missing coverage`);
  return {
    id: fixture.id,
    legacyId: fixture.legacyId,
    cityCode: fixture.cityCode,
    cityTimezone: city.timezone,
    coverageArea: area,
    name: fixture.name,
    address: fixture.address,
    district: fixture.district,
    locationWgs84: normalizeToWgs84(fixture.sourceLocation, fixture.sourceCoordType),
    locationGcj02: fixture.sourceCoordType === 'gcj02' ? fixture.sourceLocation : null,
    distanceM,
    primaryCuisineCode: fixture.primaryCuisineCode,
    cuisineCodes: fixture.cuisineCodes,
    priceMinFen: fixture.priceMinFen,
    priceMaxFen: fixture.priceMaxFen,
    acceptsSolo: fixture.acceptsSolo,
    peakPolicy: fixture.peakPolicy,
    seatTypes: fixture.seatTypes,
    counterSeats: fixture.counterSeats,
    soloPortion: fixture.soloPortion,
    minSpendFen: fixture.minSpendFen,
    mealMinutes: fixture.mealMinutes,
    noiseLevel: fixture.noiseLevel,
    soloScore: fixture.soloScore,
    confidence: fixture.confidence,
    scoringVersion: rankingConfig.version,
    lastVerifiedAt: fixture.lastVerifiedAt,
    reasonCodes: fixture.reasonCodes,
    hours: Array.from({ length: 7 }, (_, dayOfWeek) => fixture.weeklyHours.map(interval => ({
      ...interval, dayOfWeek, specialDate: null, isClosed: false
    }))).flat(),
    dishes: fixture.dishes,
    note: fixture.note,
    evidence: fixture.evidence.map(item => ({ ...item, status: 'published' }))
  };
}

export class FixtureRepository implements RestaurantRepository {
  async health(): Promise<RepositoryHealth> {
    return { ok: true, source: 'fixture', latencyMs: 0 };
  }

  async listCities(): Promise<City[]> {
    return structuredClone(cities);
  }

  async getCoverageArea(id: string): Promise<(CoverageArea & { cityCode: string; cityTimezone: string }) | null> {
    for (const city of cities) {
      const area = city.areas.find(item => item.id === id);
      if (area) return { ...area, cityCode: city.code, cityTimezone: city.timezone };
    }
    return null;
  }

  async suggestLocations(query: string, limit: number): Promise<LocationSuggestion[]> {
    const normalized = query.trim().toLowerCase();
    return locationSuggestions.filter(item => {
      const city = cities.find(candidate => candidate.code === item.cityCode);
      return !normalized || `${item.label} ${item.detail} ${city?.name ?? ''}`.toLowerCase().includes(normalized);
    }).slice(0, limit).map(item => ({ ...item }));
  }

  async findCandidates(query: CandidateQuery): Promise<RestaurantRecord[]> {
    const keyword = query.keyword.toLowerCase();
    return v0Restaurants.flatMap(fixture => {
      if (fixture.coverageAreaId !== query.coverageAreaId) return [];
      if (keyword && !`${fixture.name} ${fixture.address} ${fixture.district}`.toLowerCase().includes(keyword)) return [];
      if (query.budgetMaxFen !== null && fixture.priceMinFen > query.budgetMaxFen) return [];
      if (query.cuisineCodes.length && !fixture.cuisineCodes.some(code => query.cuisineCodes.includes(code))) return [];
      if (query.onlySoloVerified && !fixture.acceptsSolo) return [];
      if (query.fastMeal && fixture.mealMinutes[1] > 40) return [];
      const normalized = normalizeToWgs84(fixture.sourceLocation, fixture.sourceCoordType);
      const distanceM = distanceMeters(query.locationWgs84, normalized);
      if (distanceM > query.radiusM) return [];
      return [toRecord(fixture, distanceM)];
    });
  }

  async findRestaurant(id: string): Promise<RestaurantRecord | null> {
    const fixture = v0Restaurants.find(item => item.id === id || item.legacyId === id);
    return fixture ? toRecord(fixture, null) : null;
  }

  async close(): Promise<void> {}
}
