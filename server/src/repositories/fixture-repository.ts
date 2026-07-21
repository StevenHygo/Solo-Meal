import { randomUUID } from 'node:crypto';
import { cities, locationSuggestions, rankingConfig } from '../catalog.js';
import type { CandidateQuery, RestaurantRecord, RestaurantRepository, RepositoryHealth } from '../domain/repository.js';
import type { CurationTaskRecord, CurationTaskStatus, CurationTaskUpdate, EvidenceSweepResult, FeedbackReceipt, FeedbackSubmission } from '../domain/operations.js';
import type { City, Coordinate, CoverageArea, LocationSuggestion, RestaurantFixture } from '../domain/types.js';
import { v0Restaurants } from '../fixtures/v0-restaurants.js';
import { normalizeToWgs84 } from '../geo/coordinates.js';
import { assertTaskClaim, assertTaskTransition } from '../services/curation.js';

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
  private readonly feedbackByKey = new Map<string, { input: FeedbackSubmission; receipt: FeedbackReceipt }>();
  private readonly tasks = new Map<string, CurationTaskRecord>();
  private readonly expiredEvidence = new Set<string>();

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

  async createFeedbackReport(input: FeedbackSubmission): Promise<FeedbackReceipt> {
    const restaurant = v0Restaurants.find(item => item.id === input.restaurantId || item.legacyId === input.restaurantId);
    if (!restaurant) throw new Error('RESTAURANT_NOT_FOUND');
    const existing = this.feedbackByKey.get(input.idempotencyKey);
    if (existing) {
      const sameRequest = existing.input.restaurantId === input.restaurantId
        && existing.input.reportType === input.reportType
        && existing.input.note === input.note;
      if (!sameRequest) throw new Error('IDEMPOTENCY_KEY_REUSED');
      return { ...existing.receipt, created: false };
    }

    const reportId = randomUUID();
    const taskId = randomUUID();
    const receivedAt = input.submittedAt.toISOString();
    const dueAt = new Date(input.submittedAt.getTime() + 5 * 86400000).toISOString();
    const receipt: FeedbackReceipt = { reportId, taskId, status: 'open', created: true, receivedAt };
    this.feedbackByKey.set(input.idempotencyKey, { input: { ...input }, receipt });
    this.tasks.set(taskId, {
      id: taskId,
      cityCode: restaurant.cityCode,
      restaurantId: restaurant.id,
      restaurantLegacyId: restaurant.legacyId,
      restaurantName: restaurant.name,
      feedbackReportId: reportId,
      reportType: input.reportType,
      reportNote: input.note,
      feedbackStatus: 'open',
      reason: `feedback:${input.reportType}`,
      priority: input.priority,
      status: 'open',
      assignee: null,
      resolutionNote: null,
      dueAt,
      createdAt: receivedAt,
      updatedAt: receivedAt
    });
    return receipt;
  }

  async listCurationTasks(status: CurationTaskStatus | null, limit: number): Promise<CurationTaskRecord[]> {
    return [...this.tasks.values()]
      .filter(task => status === null || task.status === status)
      .sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(task => structuredClone(task));
  }

  async updateCurationTask(id: string, update: CurationTaskUpdate): Promise<CurationTaskRecord> {
    const task = this.tasks.get(id);
    if (!task) throw new Error('CURATION_TASK_NOT_FOUND');
    assertTaskTransition(task.status, update.status);
    assertTaskClaim(task.status, task.assignee, update.status, update.assignee);
    const terminal = update.status === 'completed' || update.status === 'cancelled';
    if (terminal && !update.resolutionNote) throw new Error('RESOLUTION_REQUIRED');
    const next: CurationTaskRecord = {
      ...task,
      status: update.status,
      assignee: update.assignee === undefined ? task.assignee : update.assignee,
      resolutionNote: update.resolutionNote ?? task.resolutionNote,
      feedbackStatus: terminal
        ? (update.feedbackStatus ?? (update.status === 'completed' ? 'resolved' : 'rejected'))
        : (update.status === 'in_progress' && task.feedbackStatus === 'open' ? 'triaged' : task.feedbackStatus),
      updatedAt: update.updatedAt.toISOString()
    };
    this.tasks.set(id, next);
    return structuredClone(next);
  }

  async sweepExpiredEvidence(at: Date, _actorId: string): Promise<EvidenceSweepResult> {
    const affectedRestaurants = new Set<string>();
    let expiredEvidence = 0;
    for (const restaurant of v0Restaurants) {
      for (const evidence of restaurant.evidence) {
        if (!evidence.expiresAt || new Date(evidence.expiresAt) > at) continue;
        const evidenceId = `${restaurant.id}:${evidence.attribute}:${evidence.observedAt}`;
        if (this.expiredEvidence.has(evidenceId)) continue;
        this.expiredEvidence.add(evidenceId);
        affectedRestaurants.add(restaurant.id);
        expiredEvidence += 1;
      }
    }

    let createdTasks = 0;
    for (const restaurantId of affectedRestaurants) {
      const existing = [...this.tasks.values()].some(task => task.restaurantId === restaurantId
        && task.reason === 'evidence_expired'
        && (task.status === 'open' || task.status === 'in_progress'));
      if (existing) continue;
      const restaurant = v0Restaurants.find(item => item.id === restaurantId);
      if (!restaurant) continue;
      const taskId = randomUUID();
      const timestamp = at.toISOString();
      this.tasks.set(taskId, {
        id: taskId,
        cityCode: restaurant.cityCode,
        restaurantId: restaurant.id,
        restaurantLegacyId: restaurant.legacyId,
        restaurantName: restaurant.name,
        feedbackReportId: null,
        reportType: null,
        reportNote: null,
        feedbackStatus: null,
        reason: 'evidence_expired',
        priority: 1,
        status: 'open',
        assignee: null,
        resolutionNote: null,
        dueAt: new Date(at.getTime() + 7 * 86400000).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp
      });
      createdTasks += 1;
    }
    return { expiredEvidence, createdTasks, processedAt: at.toISOString() };
  }

  async close(): Promise<void> {}
}
