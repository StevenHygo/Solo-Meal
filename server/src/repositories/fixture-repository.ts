import { randomUUID } from 'node:crypto';
import { cities, locationSuggestions, rankingConfig } from '../catalog.js';
import type { CandidateQuery, RestaurantRecord, RestaurantRepository, RepositoryHealth } from '../domain/repository.js';
import type { CurationTaskRecord, CurationTaskStatus, CurationTaskUpdate, EvidenceSweepResult, FeedbackReceipt, FeedbackSubmission } from '../domain/operations.js';
import type { PoiCandidateQuery, PoiCandidateRecord, PoiCandidateReview, PoiImportReceipt, PoiImportSubmission } from '../domain/poi.js';
import type { CoverageQualityManualUpdate, CoverageQualityRecord } from '../domain/coverage-quality.js';
import type { City, Coordinate, CoverageArea, LocationSuggestion, RestaurantFixture } from '../domain/types.js';
import { v0Restaurants } from '../fixtures/v0-restaurants.js';
import { normalizeToWgs84 } from '../geo/coordinates.js';
import { addBusinessDays, assertTaskClaim, assertTaskTransition } from '../services/curation.js';
import { assertPoiCandidateTransition } from '../services/poi.js';

function distanceMeters(left: Coordinate, right: Coordinate): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitude = radians(right.lat - left.lat);
  const longitude = radians(right.lng - left.lng);
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function textSimilarity(left: string, right: string): number {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (value: string) => new Set(Array.from({ length: Math.max(1, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  const intersection = [...leftGrams].filter(value => rightGrams.has(value)).length;
  return intersection / (leftGrams.size + rightGrams.size - intersection);
}

function suggestFixtureRestaurant(input: PoiImportSubmission['candidates'][number], coverageAreaId: string) {
  const suggestions = v0Restaurants.flatMap(restaurant => {
    if (restaurant.coverageAreaId !== coverageAreaId) return [];
    const restaurantWgs84 = normalizeToWgs84(restaurant.sourceLocation, restaurant.sourceCoordType);
    const distance = distanceMeters(input.locationWgs84, restaurantWgs84);
    if (distance > 200) return [];
    const name = textSimilarity(input.name, restaurant.name);
    const address = textSimilarity(input.address, restaurant.address);
    const score = name * 0.75 + address * 0.15 + Math.max(0, 1 - distance / 200) * 0.1;
    return score >= 0.4 ? [{ restaurant, score }] : [];
  }).sort((left, right) => right.score - left.score || left.restaurant.id.localeCompare(right.restaurant.id));
  return suggestions[0] ?? null;
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
  private readonly poiImportsByKey = new Map<string, { payloadSha256: string; receipt: PoiImportReceipt }>();
  private readonly poiCandidates = new Map<string, PoiCandidateRecord>();
  private readonly poiCandidateIdByProviderRef = new Map<string, string>();
  private readonly providerRefs = new Map<string, string>();
  private readonly manualCoverageQuality = new Map<string, Partial<CoverageQualityRecord['metrics']>>();

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
    const cityTimezone = cities.find(city => city.code === restaurant.cityCode)?.timezone ?? 'Asia/Shanghai';
    const dueAt = addBusinessDays(input.submittedAt, 5, cityTimezone).toISOString();
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

  async importPoiCandidates(input: PoiImportSubmission): Promise<PoiImportReceipt> {
    const replay = this.poiImportsByKey.get(input.idempotencyKey);
    if (replay) {
      if (replay.payloadSha256 !== input.payloadSha256) throw new Error('POI_IDEMPOTENCY_KEY_REUSED');
      return { ...replay.receipt, created: false };
    }
    const coverage = await this.getCoverageArea(input.coverageAreaId);
    if (!coverage) throw new Error('COVERAGE_AREA_NOT_FOUND');

    let createdCount = 0;
    let updatedCount = 0;
    let exactMatchCount = 0;
    for (const candidate of input.candidates) {
      const refKey = `${input.provider}:${candidate.providerPoiId}`;
      const existingId = this.poiCandidateIdByProviderRef.get(refKey);
      const existing = existingId ? this.poiCandidates.get(existingId) : undefined;
      if (existing && existing.coverageAreaId !== input.coverageAreaId) throw new Error('POI_COVERAGE_MISMATCH');
      const exactRestaurantId = this.providerRefs.get(refKey) ?? null;
      const exactRestaurant = exactRestaurantId
        ? v0Restaurants.find(restaurant => restaurant.id === exactRestaurantId || restaurant.legacyId === exactRestaurantId)
        : null;
      if (exactRestaurant && exactRestaurant.coverageAreaId !== input.coverageAreaId) throw new Error('POI_COVERAGE_MISMATCH');
      const suggestion = exactRestaurant ? null : suggestFixtureRestaurant(candidate, input.coverageAreaId);
      const id = existing?.id ?? randomUUID();
      const timestamp = input.importedAt.toISOString();
      const record: PoiCandidateRecord = {
        id,
        provider: input.provider,
        providerPoiId: candidate.providerPoiId,
        cityCode: coverage.cityCode,
        coverageAreaId: input.coverageAreaId,
        coverageAreaName: coverage.name,
        name: candidate.name,
        address: candidate.address,
        district: candidate.district,
        sourceCoordType: candidate.sourceCoordType,
        sourceLocation: { ...candidate.sourceLocation },
        locationWgs84: { ...candidate.locationWgs84 },
        phoneNormalized: candidate.phoneNormalized,
        rawCategory: candidate.rawCategory,
        observedAt: candidate.observedAt.toISOString(),
        status: exactRestaurant ? 'matched' : (existing?.status ?? 'pending'),
        matchedRestaurantId: exactRestaurant?.id ?? existing?.matchedRestaurantId ?? null,
        matchedRestaurantLegacyId: exactRestaurant?.legacyId ?? existing?.matchedRestaurantLegacyId ?? null,
        matchedRestaurantName: exactRestaurant?.name ?? existing?.matchedRestaurantName ?? null,
        suggestedRestaurantId: exactRestaurant ? exactRestaurant.id : (suggestion?.restaurant.id ?? existing?.suggestedRestaurantId ?? null),
        suggestedRestaurantLegacyId: exactRestaurant ? exactRestaurant.legacyId : (suggestion?.restaurant.legacyId ?? existing?.suggestedRestaurantLegacyId ?? null),
        suggestedRestaurantName: exactRestaurant ? exactRestaurant.name : (suggestion?.restaurant.name ?? existing?.suggestedRestaurantName ?? null),
        suggestionScore: exactRestaurant ? 1 : (suggestion?.score ?? existing?.suggestionScore ?? null),
        matchMethod: exactRestaurant ? 'provider_ref' : (existing?.matchMethod ?? (suggestion ? 'name_address_distance' : null)),
        resolutionNote: existing?.resolutionNote ?? null,
        reviewedBy: existing?.reviewedBy ?? null,
        reviewedAt: existing?.reviewedAt ?? null,
        firstSeenAt: existing?.firstSeenAt ?? timestamp,
        lastSeenAt: timestamp
      };
      this.poiCandidates.set(id, record);
      this.poiCandidateIdByProviderRef.set(refKey, id);
      if (existing) updatedCount += 1;
      else createdCount += 1;
      if (exactRestaurant) exactMatchCount += 1;
    }
    const receipt: PoiImportReceipt = {
      batchId: randomUUID(),
      inputCount: input.candidates.length,
      createdCount,
      updatedCount,
      exactMatchCount,
      created: true,
      importedAt: input.importedAt.toISOString()
    };
    this.poiImportsByKey.set(input.idempotencyKey, { payloadSha256: input.payloadSha256, receipt });
    return receipt;
  }

  async listPoiCandidates(query: PoiCandidateQuery): Promise<PoiCandidateRecord[]> {
    return [...this.poiCandidates.values()]
      .filter(candidate => query.status === null || candidate.status === query.status)
      .filter(candidate => query.coverageAreaId === null || candidate.coverageAreaId === query.coverageAreaId)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.id.localeCompare(right.id))
      .slice(0, query.limit)
      .map(candidate => structuredClone(candidate));
  }

  async reviewPoiCandidate(id: string, review: PoiCandidateReview): Promise<PoiCandidateRecord> {
    const candidate = this.poiCandidates.get(id);
    if (!candidate) throw new Error('POI_CANDIDATE_NOT_FOUND');
    const nextStatus = assertPoiCandidateTransition(candidate.status, review);
    let restaurant: (typeof v0Restaurants)[number] | null = null;
    if (review.decision === 'match_existing') {
      restaurant = v0Restaurants.find(item => item.id === review.restaurantId || item.legacyId === review.restaurantId) ?? null;
      if (!restaurant) throw new Error('RESTAURANT_NOT_FOUND');
      if (restaurant.coverageAreaId !== candidate.coverageAreaId) throw new Error('POI_RESTAURANT_COVERAGE_MISMATCH');
      const refKey = `${candidate.provider}:${candidate.providerPoiId}`;
      const restaurantId = restaurant.id;
      const currentRef = this.providerRefs.get(refKey);
      if (currentRef && currentRef !== restaurantId) throw new Error('PROVIDER_REF_CONFLICT');
      const currentRestaurantRef = [...this.providerRefs.entries()].find(([key, mappedRestaurantId]) =>
        mappedRestaurantId === restaurantId && key.startsWith(`${candidate.provider}:`));
      if (currentRestaurantRef && currentRestaurantRef[0] !== refKey) throw new Error('PROVIDER_REF_CONFLICT');
      this.providerRefs.set(refKey, restaurantId);
    }
    const next: PoiCandidateRecord = {
      ...candidate,
      status: nextStatus,
      matchedRestaurantId: restaurant?.id ?? candidate.matchedRestaurantId,
      matchedRestaurantLegacyId: restaurant?.legacyId ?? candidate.matchedRestaurantLegacyId,
      matchedRestaurantName: restaurant?.name ?? candidate.matchedRestaurantName,
      matchMethod: restaurant ? 'operator' : candidate.matchMethod,
      resolutionNote: review.resolutionNote,
      reviewedBy: review.actorId,
      reviewedAt: review.reviewedAt.toISOString()
    };
    this.poiCandidates.set(id, next);
    return structuredClone(next);
  }

  async getCoverageQuality(areaId: string, at: Date): Promise<CoverageQualityRecord> {
    const coverage = await this.getCoverageArea(areaId);
    if (!coverage) throw new Error('COVERAGE_AREA_NOT_FOUND');
    const restaurants = v0Restaurants.filter(restaurant => restaurant.coverageAreaId === areaId);
    const published = restaurants.length;
    const recentCutoff = at.getTime() - 90 * 86400000;
    const recent = restaurants.filter(restaurant => new Date(restaurant.lastVerifiedAt).getTime() >= recentCutoff).length;
    const complete = restaurants.filter(restaurant => restaurant.acceptsSolo !== null
      && restaurant.priceMinFen >= 0
      && restaurant.primaryCuisineCode.length > 0
      && restaurant.seatTypes.length > 0).length;
    const referenced = restaurants.filter(restaurant => [...this.providerRefs.values()].includes(restaurant.id)).length;
    const eligibleHighPriority = [...this.tasks.values()].filter(task => task.priority === 0
      && task.reason.startsWith('feedback:')
      && ((task.status === 'completed' || task.status === 'cancelled') || (task.dueAt && new Date(task.dueAt) <= at)));
    const onTimeHighPriority = eligibleHighPriority.filter(task => (task.status === 'completed' || task.status === 'cancelled')
      && task.dueAt !== null
      && new Date(task.updatedAt) <= new Date(task.dueAt)).length;
    const manual = this.manualCoverageQuality.get(areaId) ?? {};
    return {
      areaId,
      areaName: coverage.name,
      cityCode: coverage.cityCode,
      status: coverage.status,
      metrics: {
        publishedRestaurants: published,
        recentVerificationRate: published ? recent / published : null,
        coreCompletenessRate: published ? complete / published : null,
        providerReferenceRate: published ? referenced / published : null,
        searchSampleCoverageRate: manual.searchSampleCoverageRate ?? null,
        branchMismatchRate: manual.branchMismatchRate ?? null,
        visitConformityRate: manual.visitConformityRate ?? null,
        highPriorityFeedbackSlaRate: eligibleHighPriority.length ? onTimeHighPriority / eligibleHighPriority.length : null,
        incidentFreeWeeks: manual.incidentFreeWeeks ?? null,
        pendingHighConfidenceMatches: [...this.poiCandidates.values()].filter(candidate => candidate.coverageAreaId === areaId
          && candidate.status === 'pending' && (candidate.suggestionScore ?? 0) >= 0.8).length,
        providerTermsReviewed: manual.providerTermsReviewed ?? null,
        privacyReviewed: manual.privacyReviewed ?? null,
        postgisRehearsalPassed: manual.postgisRehearsalPassed ?? null
      },
      measuredAt: at.toISOString()
    };
  }

  async updateCoverageQuality(areaId: string, update: CoverageQualityManualUpdate): Promise<CoverageQualityRecord> {
    const coverage = await this.getCoverageArea(areaId);
    if (!coverage) throw new Error('COVERAGE_AREA_NOT_FOUND');
    const current = this.manualCoverageQuality.get(areaId) ?? {};
    this.manualCoverageQuality.set(areaId, {
      ...current,
      ...(update.searchSampleCoverageRate !== undefined ? { searchSampleCoverageRate: update.searchSampleCoverageRate } : {}),
      ...(update.branchMismatchRate !== undefined ? { branchMismatchRate: update.branchMismatchRate } : {}),
      ...(update.visitConformityRate !== undefined ? { visitConformityRate: update.visitConformityRate } : {}),
      ...(update.incidentFreeWeeks !== undefined ? { incidentFreeWeeks: update.incidentFreeWeeks } : {}),
      ...(update.providerTermsReviewed !== undefined ? { providerTermsReviewed: update.providerTermsReviewed } : {}),
      ...(update.privacyReviewed !== undefined ? { privacyReviewed: update.privacyReviewed } : {}),
      ...(update.postgisRehearsalPassed !== undefined ? { postgisRehearsalPassed: update.postgisRehearsalPassed } : {})
    });
    return this.getCoverageQuality(areaId, update.updatedAt);
  }

  async close(): Promise<void> {}
}
