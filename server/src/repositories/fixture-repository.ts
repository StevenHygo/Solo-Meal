import { randomUUID } from 'node:crypto';
import { cities, locationSuggestions, rankingConfig } from '../catalog.js';
import type { CandidateQuery, RestaurantRecord, RestaurantRepository, RepositoryHealth } from '../domain/repository.js';
import type { CurationTaskRecord, CurationTaskStatus, CurationTaskUpdate, EvidenceSweepResult, FeedbackReceipt, FeedbackSubmission } from '../domain/operations.js';
import type { PoiCandidateQuery, PoiCandidateRecord, PoiCandidateReview, PoiImportReceipt, PoiImportSubmission } from '../domain/poi.js';
import type { CoverageQualityManualUpdate, CoverageQualityRecord } from '../domain/coverage-quality.js';
import type { ManagedRestaurantQuery, ManagedRestaurantRecord, RestaurantDraftSave, RestaurantPublicationTransition } from '../domain/publishing.js';
import type {
  AuditLogQuery,
  AuditLogRecord,
  AuditValue,
  OperationsExport,
  OperationsExportDataset,
  OutboxClaim,
  OutboxEventQuery,
  OutboxEventRecord,
  OutboxFailure
} from '../domain/operations-control.js';
import type { City, Coordinate, CoverageArea, LocationSuggestion, RestaurantFixture } from '../domain/types.js';
import { v0Restaurants } from '../fixtures/v0-restaurants.js';
import { normalizeToWgs84 } from '../geo/coordinates.js';
import { addBusinessDays, assertTaskClaim, assertTaskTransition } from '../services/curation.js';
import { assertPoiCandidateTransition } from '../services/poi.js';
import { deriveSoloProfile, nextPublicationStatus } from '../services/publishing.js';

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
  private readonly managedRestaurants = new Map<string, ManagedRestaurantRecord>();
  private readonly auditLogs: AuditLogRecord[] = [];
  private readonly outboxEvents = new Map<string, OutboxEventRecord>();
  private auditSequence = 0;

  private recordOperation(input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    beforeValue?: AuditValue;
    afterValue?: AuditValue;
    topic: string;
    payload: Record<string, unknown>;
    at: Date;
  }): void {
    const createdAt = input.at.toISOString();
    this.auditSequence += 1;
    this.auditLogs.push({
      id: String(this.auditSequence),
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason,
      beforeValue: input.beforeValue ?? null,
      afterValue: input.afterValue ?? null,
      createdAt
    });
    const id = randomUUID();
    this.outboxEvents.set(id, {
      id,
      topic: input.topic,
      aggregateId: input.entityId,
      payload: structuredClone(input.payload),
      status: 'pending',
      availableAt: createdAt,
      processedAt: null,
      attempts: 0,
      lastError: null,
      failedAt: null,
      lockedBy: null,
      lockedAt: null,
      createdAt
    });
  }

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
    const records = [
      ...v0Restaurants.map(fixture => toRecord(fixture, null)),
      ...[...this.managedRestaurants.values()]
        .filter(item => item.publishStatus === 'published')
        .map(item => structuredClone(item.restaurant))
    ];
    return records.flatMap(restaurant => {
      if (restaurant.coverageArea.id !== query.coverageAreaId) return [];
      if (keyword && !`${restaurant.name} ${restaurant.address} ${restaurant.district}`.toLowerCase().includes(keyword)) return [];
      if (query.budgetMaxFen !== null && restaurant.priceMinFen > query.budgetMaxFen) return [];
      if (query.cuisineCodes.length && !restaurant.cuisineCodes.some(code => query.cuisineCodes.includes(code))) return [];
      if (query.onlySoloVerified && !restaurant.acceptsSolo) return [];
      if (query.fastMeal && restaurant.mealMinutes[1] > 40) return [];
      const distanceM = distanceMeters(query.locationWgs84, restaurant.locationWgs84);
      if (distanceM > query.radiusM) return [];
      return [{ ...restaurant, distanceM }];
    });
  }

  async findRestaurant(id: string): Promise<RestaurantRecord | null> {
    const fixture = v0Restaurants.find(item => item.id === id || item.legacyId === id);
    if (fixture) return toRecord(fixture, null);
    const managed = this.managedRestaurants.get(id);
    return managed?.publishStatus === 'published' ? structuredClone(managed.restaurant) : null;
  }

  async createFeedbackReport(input: FeedbackSubmission): Promise<FeedbackReceipt> {
    const fixture = v0Restaurants.find(item => item.id === input.restaurantId || item.legacyId === input.restaurantId);
    const managed = this.managedRestaurants.get(input.restaurantId);
    const restaurant = fixture ? toRecord(fixture, null)
      : managed?.publishStatus === 'published' ? managed.restaurant : null;
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
    const dueAt = addBusinessDays(input.submittedAt, 5, restaurant.cityTimezone).toISOString();
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
    this.recordOperation({
      actorId: 'public-feedback', action: 'create', entityType: 'feedback_report', entityId: reportId,
      reason: 'user_submitted_correction',
      afterValue: { restaurant_id: restaurant.id, report_type: input.reportType, task_id: taskId },
      topic: 'feedback.created', payload: { report_id: reportId, task_id: taskId }, at: input.submittedAt
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
    this.recordOperation({
      actorId: update.actorId, action: 'transition', entityType: 'curation_task', entityId: id,
      reason: 'operator_task_update',
      beforeValue: { status: task.status, assignee: task.assignee, resolution_note: task.resolutionNote },
      afterValue: { status: next.status, assignee: next.assignee, resolution_note: next.resolutionNote },
      topic: 'curation.task_updated', payload: { task_id: id, status: next.status }, at: update.updatedAt
    });
    return structuredClone(next);
  }

  async sweepExpiredEvidence(at: Date, actorId: string): Promise<EvidenceSweepResult> {
    const affectedRestaurants = new Set<string>();
    let expiredEvidence = 0;
    const restaurants = [
      ...v0Restaurants.map(fixture => toRecord(fixture, null)),
      ...[...this.managedRestaurants.values()]
        .filter(item => item.publishStatus === 'published')
        .map(item => item.restaurant)
    ];
    for (const restaurant of restaurants) {
      for (const evidence of restaurant.evidence) {
        if (!evidence.expiresAt || new Date(evidence.expiresAt) > at) continue;
        const evidenceId = `${restaurant.id}:${evidence.attribute}:${evidence.observedAt}`;
        if (this.expiredEvidence.has(evidenceId)) continue;
        this.expiredEvidence.add(evidenceId);
        evidence.status = 'expired';
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
      const fixture = v0Restaurants.find(item => item.id === restaurantId);
      const managed = this.managedRestaurants.get(restaurantId);
      const restaurant = fixture ? toRecord(fixture, null) : managed?.restaurant;
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
    if (expiredEvidence > 0 || createdTasks > 0) {
      const payload = { expired_evidence: expiredEvidence, created_tasks: createdTasks };
      this.recordOperation({
        actorId, action: 'expire', entityType: 'evidence_batch', entityId: at.toISOString(),
        reason: 'scheduled_freshness_sweep', afterValue: payload,
        topic: 'evidence.expired', payload, at
      });
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
      const exactFixture = exactRestaurantId
        ? v0Restaurants.find(restaurant => restaurant.id === exactRestaurantId || restaurant.legacyId === exactRestaurantId)
        : null;
      const exactManaged = exactRestaurantId ? this.managedRestaurants.get(exactRestaurantId) : null;
      const exactRestaurant = exactFixture ? {
        id: exactFixture.id,
        legacyId: exactFixture.legacyId,
        name: exactFixture.name,
        coverageAreaId: exactFixture.coverageAreaId
      } : exactManaged ? {
        id: exactManaged.restaurant.id,
        legacyId: exactManaged.restaurant.legacyId,
        name: exactManaged.restaurant.name,
        coverageAreaId: exactManaged.restaurant.coverageArea.id
      } : null;
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
        draftRestaurantId: existing?.draftRestaurantId ?? null,
        draftRestaurantStatus: existing?.draftRestaurantId
          ? (this.managedRestaurants.get(existing.draftRestaurantId)?.publishStatus ?? existing.draftRestaurantStatus)
          : null,
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
    const operationPayload = {
      batch_id: receipt.batchId,
      provider: input.provider,
      coverage_area_id: input.coverageAreaId,
      input_count: input.candidates.length,
      created_count: createdCount,
      updated_count: updatedCount,
      exact_match_count: exactMatchCount
    };
    this.recordOperation({
      actorId: input.actorId, action: 'import', entityType: 'poi_import_batch', entityId: receipt.batchId,
      reason: 'authorized_poi_import', afterValue: operationPayload,
      topic: 'poi.imported', payload: operationPayload, at: input.importedAt
    });
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
    if (candidate.draftRestaurantId) throw new Error('POI_CANDIDATE_DRAFT_IN_PROGRESS');
    const nextStatus = assertPoiCandidateTransition(candidate.status, review);
    let restaurant: { id: string; legacyId: string | null; name: string; coverageAreaId: string } | null = null;
    if (review.decision === 'match_existing') {
      const fixture = v0Restaurants.find(item => item.id === review.restaurantId || item.legacyId === review.restaurantId);
      const managed = review.restaurantId ? this.managedRestaurants.get(review.restaurantId) : null;
      restaurant = fixture ? {
        id: fixture.id,
        legacyId: fixture.legacyId,
        name: fixture.name,
        coverageAreaId: fixture.coverageAreaId
      } : managed?.publishStatus === 'published' ? {
        id: managed.restaurant.id,
        legacyId: managed.restaurant.legacyId,
        name: managed.restaurant.name,
        coverageAreaId: managed.restaurant.coverageArea.id
      } : null;
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
    this.recordOperation({
      actorId: review.actorId, action: 'review', entityType: 'poi_candidate', entityId: id,
      reason: 'operator_poi_decision',
      beforeValue: { status: candidate.status, matched_restaurant_id: candidate.matchedRestaurantId },
      afterValue: { status: next.status, matched_restaurant_id: next.matchedRestaurantId, resolution_note: next.resolutionNote },
      topic: 'poi.candidate_reviewed', payload: { candidate_id: id, status: next.status }, at: review.reviewedAt
    });
    return structuredClone(next);
  }

  async createRestaurantDraft(candidateId: string, draft: RestaurantDraftSave): Promise<ManagedRestaurantRecord> {
    const candidate = this.poiCandidates.get(candidateId);
    if (!candidate) throw new Error('POI_CANDIDATE_NOT_FOUND');
    if (candidate.status !== 'new_branch') throw new Error('POI_CANDIDATE_NOT_NEW_BRANCH');
    if (candidate.draftRestaurantId) throw new Error('RESTAURANT_DRAFT_ALREADY_EXISTS');
    const coverage = await this.getCoverageArea(candidate.coverageAreaId);
    if (!coverage) throw new Error('COVERAGE_AREA_NOT_FOUND');
    const id = randomUUID();
    const profile = deriveSoloProfile(draft);
    const timestamp = draft.savedAt.toISOString();
    const restaurant: RestaurantRecord = {
      id,
      legacyId: null,
      cityCode: candidate.cityCode,
      cityTimezone: coverage.cityTimezone,
      coverageArea: { id: coverage.id, name: coverage.name, status: coverage.status },
      name: draft.name,
      address: draft.address,
      district: draft.district,
      locationWgs84: { ...candidate.locationWgs84 },
      locationGcj02: candidate.sourceCoordType === 'gcj02' ? { ...candidate.sourceLocation } : null,
      distanceM: null,
      primaryCuisineCode: draft.primaryCuisineCode,
      cuisineCodes: [...draft.cuisineCodes],
      priceMinFen: draft.priceMinFen,
      priceMaxFen: draft.priceMaxFen,
      acceptsSolo: draft.acceptsSolo,
      peakPolicy: draft.peakPolicy,
      seatTypes: [...draft.seatTypes],
      counterSeats: draft.counterSeats,
      soloPortion: draft.soloPortion,
      minSpendFen: draft.minSpendFen,
      mealMinutes: [...draft.mealMinutes],
      noiseLevel: draft.noiseLevel,
      soloScore: profile.score,
      confidence: profile.confidence,
      scoringVersion: rankingConfig.version,
      lastVerifiedAt: null,
      reasonCodes: profile.reasonCodes,
      hours: draft.hours.map(hours => ({ ...hours, specialDate: null, isClosed: false })),
      dishes: [...draft.dishes],
      note: draft.note,
      evidence: draft.evidence.map(evidence => ({
        attribute: evidence.attribute,
        title: evidence.title,
        value: evidence.value,
        sourceType: evidence.sourceType,
        sourceLabel: evidence.sourceLabel,
        observedAt: evidence.observedAt.toISOString(),
        expiresAt: evidence.expiresAt.toISOString(),
        status: 'candidate'
      }))
    };
    const managed: ManagedRestaurantRecord = {
      restaurant,
      sourceCandidate: { id: candidate.id, provider: candidate.provider, providerPoiId: candidate.providerPoiId },
      publishStatus: 'draft',
      version: 1,
      createdBy: draft.actorId,
      reviewSubmittedBy: null,
      reviewSubmittedAt: null,
      publishedBy: null,
      publishedAt: null,
      withdrawnBy: null,
      withdrawnAt: null,
      statusNote: null,
      updatedBy: draft.actorId,
      updatedAt: timestamp
    };
    this.managedRestaurants.set(id, managed);
    this.poiCandidates.set(candidateId, {
      ...candidate,
      draftRestaurantId: id,
      draftRestaurantStatus: 'draft'
    });
    const operationPayload = {
      restaurant_id: id, candidate_id: candidateId, provider: candidate.provider,
      provider_poi_id: candidate.providerPoiId, status: 'draft', version: 1
    };
    this.recordOperation({
      actorId: draft.actorId, action: 'create_draft', entityType: 'restaurant', entityId: id,
      reason: 'poi_new_branch_draft', afterValue: operationPayload,
      topic: 'restaurant.draft_created', payload: operationPayload, at: draft.savedAt
    });
    return structuredClone(managed);
  }

  async updateRestaurantDraft(id: string, draft: RestaurantDraftSave): Promise<ManagedRestaurantRecord> {
    const current = this.managedRestaurants.get(id);
    if (!current) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
    if (current.publishStatus !== 'draft') throw new Error('RESTAURANT_DRAFT_NOT_EDITABLE');
    const profile = deriveSoloProfile(draft);
    const next: ManagedRestaurantRecord = {
      ...current,
      restaurant: {
        ...current.restaurant,
        name: draft.name,
        address: draft.address,
        district: draft.district,
        primaryCuisineCode: draft.primaryCuisineCode,
        cuisineCodes: [...draft.cuisineCodes],
        priceMinFen: draft.priceMinFen,
        priceMaxFen: draft.priceMaxFen,
        acceptsSolo: draft.acceptsSolo,
        peakPolicy: draft.peakPolicy,
        seatTypes: [...draft.seatTypes],
        counterSeats: draft.counterSeats,
        soloPortion: draft.soloPortion,
        minSpendFen: draft.minSpendFen,
        mealMinutes: [...draft.mealMinutes],
        noiseLevel: draft.noiseLevel,
        soloScore: profile.score,
        confidence: profile.confidence,
        reasonCodes: profile.reasonCodes,
        hours: draft.hours.map(hours => ({ ...hours, specialDate: null, isClosed: false })),
        dishes: [...draft.dishes],
        note: draft.note,
        evidence: draft.evidence.map(evidence => ({
          attribute: evidence.attribute,
          title: evidence.title,
          value: evidence.value,
          sourceType: evidence.sourceType,
          sourceLabel: evidence.sourceLabel,
          observedAt: evidence.observedAt.toISOString(),
          expiresAt: evidence.expiresAt.toISOString(),
          status: 'candidate'
        }))
      },
      version: current.version + 1,
      statusNote: null,
      updatedBy: draft.actorId,
      updatedAt: draft.savedAt.toISOString()
    };
    this.managedRestaurants.set(id, next);
    const afterValue = { status: 'draft', version: next.version, name: draft.name, address: draft.address, district: draft.district };
    this.recordOperation({
      actorId: draft.actorId, action: 'update_draft', entityType: 'restaurant', entityId: id,
      reason: 'operator_draft_edit',
      beforeValue: { status: current.publishStatus, version: current.version, name: current.restaurant.name, address: current.restaurant.address, district: current.restaurant.district },
      afterValue, topic: 'restaurant.draft_updated', payload: { restaurant_id: id, ...afterValue }, at: draft.savedAt
    });
    return structuredClone(next);
  }

  async listManagedRestaurants(query: ManagedRestaurantQuery): Promise<ManagedRestaurantRecord[]> {
    return [...this.managedRestaurants.values()]
      .filter(item => query.status === null || item.publishStatus === query.status)
      .filter(item => query.coverageAreaId === null || item.restaurant.coverageArea.id === query.coverageAreaId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.restaurant.id.localeCompare(right.restaurant.id))
      .slice(0, query.limit)
      .map(item => structuredClone(item));
  }

  async getManagedRestaurant(id: string): Promise<ManagedRestaurantRecord | null> {
    const managed = this.managedRestaurants.get(id);
    return managed ? structuredClone(managed) : null;
  }

  async transitionManagedRestaurant(id: string, transition: RestaurantPublicationTransition): Promise<ManagedRestaurantRecord> {
    const current = this.managedRestaurants.get(id);
    if (!current) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
    const nextStatus = nextPublicationStatus(current, transition);
    const timestamp = transition.transitionedAt.toISOString();
    let restaurant = structuredClone(current.restaurant);
    let reviewSubmittedBy = current.reviewSubmittedBy;
    let reviewSubmittedAt = current.reviewSubmittedAt;
    let publishedBy = current.publishedBy;
    let publishedAt = current.publishedAt;
    let withdrawnBy = current.withdrawnBy;
    let withdrawnAt = current.withdrawnAt;

    if (transition.action === 'submit_review') {
      reviewSubmittedBy = transition.actorId;
      reviewSubmittedAt = timestamp;
    } else if (transition.action === 'request_changes') {
      reviewSubmittedBy = null;
      reviewSubmittedAt = null;
    } else if (transition.action === 'publish') {
      const source = current.sourceCandidate;
      if (!source) throw new Error('SOURCE_CANDIDATE_REQUIRED');
      const refKey = `${source.provider}:${source.providerPoiId}`;
      const currentRef = this.providerRefs.get(refKey);
      if (currentRef && currentRef !== id) throw new Error('PROVIDER_REF_CONFLICT');
      const currentRestaurantRef = [...this.providerRefs.entries()].find(([key, restaurantId]) =>
        restaurantId === id && key.startsWith(`${source.provider}:`));
      if (currentRestaurantRef && currentRestaurantRef[0] !== refKey) throw new Error('PROVIDER_REF_CONFLICT');
      this.providerRefs.set(refKey, id);
      restaurant.evidence = restaurant.evidence.map(evidence => ({ ...evidence, status: 'published' }));
      restaurant.lastVerifiedAt = restaurant.evidence
        .map(evidence => evidence.observedAt)
        .sort((left, right) => right.localeCompare(left))[0] ?? timestamp;
      publishedBy = transition.actorId;
      publishedAt = timestamp;
      const candidate = this.poiCandidates.get(source.id);
      if (!candidate) throw new Error('POI_CANDIDATE_NOT_FOUND');
      this.poiCandidates.set(source.id, {
        ...candidate,
        status: 'matched',
        matchedRestaurantId: id,
        matchedRestaurantLegacyId: null,
        matchedRestaurantName: restaurant.name,
        draftRestaurantStatus: 'published',
        matchMethod: 'operator',
        resolutionNote: transition.note,
        reviewedBy: transition.actorId,
        reviewedAt: timestamp
      });
    } else if (transition.action === 'withdraw') {
      withdrawnBy = transition.actorId;
      withdrawnAt = timestamp;
    }

    const next: ManagedRestaurantRecord = {
      ...current,
      restaurant,
      publishStatus: nextStatus,
      reviewSubmittedBy,
      reviewSubmittedAt,
      publishedBy,
      publishedAt,
      withdrawnBy,
      withdrawnAt,
      statusNote: transition.note,
      updatedBy: transition.actorId,
      updatedAt: timestamp
    };
    this.managedRestaurants.set(id, next);
    if (current.sourceCandidate) {
      const candidate = this.poiCandidates.get(current.sourceCandidate.id);
      if (candidate) this.poiCandidates.set(candidate.id, { ...candidate, draftRestaurantStatus: nextStatus });
    }
    const afterValue = { status: nextStatus, note: transition.note };
    this.recordOperation({
      actorId: transition.actorId, action: transition.action, entityType: 'restaurant', entityId: id,
      reason: 'restaurant_publication_transition',
      beforeValue: { status: current.publishStatus, version: current.version }, afterValue,
      topic: 'restaurant.publication_transitioned',
      payload: { restaurant_id: id, action: transition.action, ...afterValue }, at: transition.transitionedAt
    });
    return structuredClone(next);
  }

  async getCoverageQuality(areaId: string, at: Date): Promise<CoverageQualityRecord> {
    const coverage = await this.getCoverageArea(areaId);
    if (!coverage) throw new Error('COVERAGE_AREA_NOT_FOUND');
    const restaurants = [
      ...v0Restaurants.map(fixture => toRecord(fixture, null)),
      ...[...this.managedRestaurants.values()]
        .filter(item => item.publishStatus === 'published')
        .map(item => item.restaurant)
    ].filter(restaurant => restaurant.coverageArea.id === areaId);
    const published = restaurants.length;
    const recentCutoff = at.getTime() - 90 * 86400000;
    const recent = restaurants.filter(restaurant => restaurant.lastVerifiedAt
      && new Date(restaurant.lastVerifiedAt).getTime() >= recentCutoff).length;
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
    const next = {
      ...current,
      ...(update.searchSampleCoverageRate !== undefined ? { searchSampleCoverageRate: update.searchSampleCoverageRate } : {}),
      ...(update.branchMismatchRate !== undefined ? { branchMismatchRate: update.branchMismatchRate } : {}),
      ...(update.visitConformityRate !== undefined ? { visitConformityRate: update.visitConformityRate } : {}),
      ...(update.incidentFreeWeeks !== undefined ? { incidentFreeWeeks: update.incidentFreeWeeks } : {}),
      ...(update.providerTermsReviewed !== undefined ? { providerTermsReviewed: update.providerTermsReviewed } : {}),
      ...(update.privacyReviewed !== undefined ? { privacyReviewed: update.privacyReviewed } : {}),
      ...(update.postgisRehearsalPassed !== undefined ? { postgisRehearsalPassed: update.postgisRehearsalPassed } : {})
    };
    this.manualCoverageQuality.set(areaId, next);
    this.recordOperation({
      actorId: update.actorId, action: 'update_quality', entityType: 'coverage_area', entityId: areaId,
      reason: update.evidenceNote, beforeValue: current, afterValue: next,
      topic: 'coverage.quality_updated', payload: { coverage_area_id: areaId, quality_metrics: next }, at: update.updatedAt
    });
    return this.getCoverageQuality(areaId, update.updatedAt);
  }

  async listAuditLogs(query: AuditLogQuery): Promise<AuditLogRecord[]> {
    return this.auditLogs
      .filter(log => query.actorId === null || log.actorId === query.actorId)
      .filter(log => query.action === null || log.action === query.action)
      .filter(log => query.entityType === null || log.entityType === query.entityType)
      .filter(log => query.entityId === null || log.entityId === query.entityId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || Number(right.id) - Number(left.id))
      .slice(0, query.limit)
      .map(log => structuredClone(log));
  }

  async listOutboxEvents(query: OutboxEventQuery): Promise<OutboxEventRecord[]> {
    return [...this.outboxEvents.values()]
      .filter(event => query.status === null || event.status === query.status)
      .filter(event => query.topic === null || event.topic === query.topic)
      .filter(event => query.aggregateId === null || event.aggregateId === query.aggregateId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
      .slice(0, query.limit)
      .map(event => structuredClone(event));
  }

  async claimOutboxEvents(claim: OutboxClaim): Promise<OutboxEventRecord[]> {
    const claimedAt = claim.claimedAt.toISOString();
    const leaseExpiredBefore = claim.leaseExpiredBefore.toISOString();
    const candidates = [...this.outboxEvents.values()]
      .filter(event => (event.status === 'pending' && event.availableAt <= claimedAt)
        || (event.status === 'processing' && event.lockedAt !== null && event.lockedAt <= leaseExpiredBefore))
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt)
        || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, claim.limit);
    return candidates.map(event => {
      const next: OutboxEventRecord = {
        ...event,
        status: 'processing',
        attempts: event.attempts + 1,
        lockedBy: claim.workerId,
        lockedAt: claimedAt
      };
      this.outboxEvents.set(event.id, next);
      return structuredClone(next);
    });
  }

  async completeOutboxEvent(id: string, workerId: string, completedAt: Date): Promise<void> {
    const event = this.outboxEvents.get(id);
    if (!event || event.status !== 'processing' || event.lockedBy !== workerId) throw new Error('OUTBOX_LEASE_LOST');
    this.outboxEvents.set(id, {
      ...event,
      status: 'processed',
      processedAt: completedAt.toISOString(),
      lastError: null,
      failedAt: null,
      lockedBy: null,
      lockedAt: null
    });
  }

  async failOutboxEvent(failure: OutboxFailure): Promise<OutboxEventRecord> {
    const event = this.outboxEvents.get(failure.eventId);
    if (!event || event.status !== 'processing' || event.lockedBy !== failure.workerId) throw new Error('OUTBOX_LEASE_LOST');
    const terminal = event.attempts >= failure.maxAttempts;
    const next: OutboxEventRecord = {
      ...event,
      status: terminal ? 'failed' : 'pending',
      availableAt: failure.nextAvailableAt.toISOString(),
      lastError: failure.error,
      failedAt: terminal ? failure.failedAt.toISOString() : null,
      lockedBy: null,
      lockedAt: null
    };
    this.outboxEvents.set(event.id, next);
    return structuredClone(next);
  }

  async retryOutboxEvent(id: string, actorId: string, retriedAt: Date): Promise<OutboxEventRecord> {
    const event = this.outboxEvents.get(id);
    if (!event) throw new Error('OUTBOX_EVENT_NOT_FOUND');
    if (event.status !== 'failed') throw new Error('OUTBOX_EVENT_NOT_FAILED');
    const next: OutboxEventRecord = {
      ...event,
      status: 'pending',
      availableAt: retriedAt.toISOString(),
      processedAt: null,
      lastError: null,
      failedAt: null,
      lockedBy: null,
      lockedAt: null
    };
    this.outboxEvents.set(id, next);
    this.auditSequence += 1;
    this.auditLogs.push({
      id: String(this.auditSequence),
      actorId,
      action: 'retry',
      entityType: 'outbox_event',
      entityId: id,
      reason: 'operator_manual_retry',
      beforeValue: { status: event.status, attempts: event.attempts, last_error: event.lastError },
      afterValue: { status: next.status, attempts: next.attempts },
      createdAt: retriedAt.toISOString()
    });
    return structuredClone(next);
  }

  async exportOperationsData(dataset: OperationsExportDataset, limit: number): Promise<OperationsExport> {
    if (dataset === 'restaurants') {
      const managed = [...this.managedRestaurants.values()].map(item => ({
        id: item.restaurant.id,
        legacyId: item.restaurant.legacyId,
        cityCode: item.restaurant.cityCode,
        coverageAreaId: item.restaurant.coverageArea.id,
        name: item.restaurant.name,
        publishStatus: item.publishStatus,
        primaryCuisineCode: item.restaurant.primaryCuisineCode,
        priceMinFen: item.restaurant.priceMinFen,
        priceMaxFen: item.restaurant.priceMaxFen,
        acceptsSolo: item.restaurant.acceptsSolo,
        updatedAt: item.updatedAt
      }));
      const fixtures = v0Restaurants.map(item => ({
        id: item.id,
        legacyId: item.legacyId,
        cityCode: item.cityCode,
        coverageAreaId: item.coverageAreaId,
        name: item.name,
        publishStatus: 'published',
        primaryCuisineCode: item.primaryCuisineCode,
        priceMinFen: item.priceMinFen,
        priceMaxFen: item.priceMaxFen,
        acceptsSolo: item.acceptsSolo,
        updatedAt: item.lastVerifiedAt
      }));
      const columns = ['id', 'legacy_id', 'city_code', 'coverage_area_id', 'name', 'publish_status', 'primary_cuisine_code', 'price_min_fen', 'price_max_fen', 'accepts_solo', 'updated_at'];
      const rows = [...managed, ...fixtures]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map(item => [item.id, item.legacyId, item.cityCode, item.coverageAreaId, item.name, item.publishStatus,
          item.primaryCuisineCode, item.priceMinFen, item.priceMaxFen, item.acceptsSolo, item.updatedAt]);
      return { columns, rows };
    }
    if (dataset === 'poi_candidates') {
      const columns = ['id', 'provider', 'provider_poi_id', 'city_code', 'coverage_area_id', 'name', 'address', 'status', 'matched_restaurant_id', 'suggestion_score', 'reviewed_by', 'reviewed_at', 'last_seen_at'];
      const rows = [...this.poiCandidates.values()]
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
        .slice(0, limit)
        .map(item => [item.id, item.provider, item.providerPoiId, item.cityCode, item.coverageAreaId, item.name,
          item.address, item.status, item.matchedRestaurantId, item.suggestionScore, item.reviewedBy, item.reviewedAt, item.lastSeenAt]);
      return { columns, rows };
    }
    if (dataset === 'curation_tasks') {
      const columns = ['id', 'city_code', 'restaurant_id', 'feedback_report_id', 'reason', 'priority', 'status', 'assignee', 'due_at', 'created_at', 'updated_at'];
      const rows = [...this.tasks.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map(item => [item.id, item.cityCode, item.restaurantId, item.feedbackReportId, item.reason,
          item.priority, item.status, item.assignee, item.dueAt, item.createdAt, item.updatedAt]);
      return { columns, rows };
    }
    const columns = ['id', 'actor_id', 'action', 'entity_type', 'entity_id', 'reason', 'created_at'];
    const rows = this.auditLogs.slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(item => [item.id, item.actorId, item.action, item.entityType, item.entityId, item.reason, item.createdAt]);
    return { columns, rows };
  }

  async close(): Promise<void> {}
}
