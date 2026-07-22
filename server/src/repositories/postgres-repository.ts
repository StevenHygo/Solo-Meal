import type { CandidateQuery, RestaurantRecord, RestaurantRepository, RepositoryHealth } from '../domain/repository.js';
import type { CurationTaskRecord, CurationTaskStatus, CurationTaskUpdate, EvidenceSweepResult, FeedbackReceipt, FeedbackSubmission } from '../domain/operations.js';
import type { PoiCandidateQuery, PoiCandidateRecord, PoiCandidateReview, PoiCandidateStatus, PoiImportReceipt, PoiImportSubmission } from '../domain/poi.js';
import type { CoverageQualityManualUpdate, CoverageQualityRecord } from '../domain/coverage-quality.js';
import type { ManagedRestaurantQuery, ManagedRestaurantRecord, RestaurantDraftSave, RestaurantPublicationTransition, RestaurantPublishStatus } from '../domain/publishing.js';
import type {
  AuditLogQuery,
  AuditLogRecord,
  AuditValue,
  OperationsExport,
  OperationsExportDataset,
  OperationsExportValue,
  OutboxClaim,
  OutboxEventQuery,
  OutboxEventRecord,
  OutboxFailure,
  OutboxStatus
} from '../domain/operations-control.js';
import type { City, CoverageArea, LocationSuggestion } from '../domain/types.js';
import { rankingConfig } from '../catalog.js';
import { withTransaction, type DatabaseClient, type DatabasePool } from '../db/pool.js';
import { addBusinessDays, assertTaskClaim, assertTaskTransition } from '../services/curation.js';
import { assertPoiCandidateTransition } from '../services/poi.js';
import { deriveSoloProfile, nextPublicationStatus } from '../services/publishing.js';

interface RestaurantRow {
  id: string;
  legacy_id: string | null;
  city_code: string;
  city_timezone: string;
  coverage_area_id: string;
  coverage_area_name: string;
  coverage_status: CoverageArea['status'];
  name: string;
  address: string;
  district: string;
  wgs84_lat: number;
  wgs84_lng: number;
  gcj02_lat: number | null;
  gcj02_lng: number | null;
  distance_m: number | null;
  primary_cuisine_code: string;
  cuisine_codes: string[];
  price_min_fen: number;
  price_max_fen: number;
  accepts_solo: boolean | null;
  peak_policy: string;
  seat_types: string[];
  counter_seats: number;
  solo_portion: boolean | null;
  min_spend_fen: number | null;
  meal_minutes_min: number;
  meal_minutes_max: number;
  noise_level: number | null;
  solo_score: number;
  confidence: RestaurantRecord['confidence'];
  scoring_version: string;
  last_verified_at: string | null;
  reason_codes: string[];
  hours: Array<{ dayOfWeek: number | null; specialDate: string | null; opensAt: string | null; closesAt: string | null; isClosed: boolean }>;
  dishes: string[];
  operator_note: string;
  evidence: Array<{
    attribute: string; title: string; value: { text?: string }; sourceType: string; sourceLabel: string;
    observedAt: string; expiresAt: string | null; status: RestaurantRecord['evidence'][number]['status'];
  }>;
}

interface CurationTaskRow {
  id: string;
  city_code: string;
  restaurant_id: string | null;
  restaurant_legacy_id: string | null;
  restaurant_name: string | null;
  feedback_report_id: string | null;
  report_type: CurationTaskRecord['reportType'];
  report_note: string | null;
  feedback_status: CurationTaskRecord['feedbackStatus'];
  reason: string;
  priority: number;
  status: CurationTaskStatus;
  assignee: string | null;
  resolution_note: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PoiCandidateRow {
  id: string;
  provider: string;
  provider_poi_id: string;
  city_code: string;
  coverage_area_id: string;
  coverage_area_name: string;
  name: string;
  address: string;
  district: string;
  source_coord_type: PoiCandidateRecord['sourceCoordType'];
  source_lat: number;
  source_lng: number;
  wgs84_lat: number;
  wgs84_lng: number;
  phone_normalized: string | null;
  raw_category: string | null;
  observed_at: string;
  status: PoiCandidateStatus;
  matched_restaurant_id: string | null;
  matched_restaurant_legacy_id: string | null;
  matched_restaurant_name: string | null;
  draft_restaurant_id: string | null;
  draft_restaurant_status: RestaurantPublishStatus | null;
  suggested_restaurant_id: string | null;
  suggested_restaurant_legacy_id: string | null;
  suggested_restaurant_name: string | null;
  suggestion_score: number | null;
  match_method: PoiCandidateRecord['matchMethod'];
  resolution_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface ManagedRestaurantRow extends RestaurantRow {
  publish_status: RestaurantPublishStatus;
  version: number;
  created_by: string;
  review_submitted_by: string | null;
  review_submitted_at: string | null;
  published_by: string | null;
  published_at: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  status_note: string | null;
  updated_by: string;
  updated_at: string;
  source_candidate_id: string | null;
  source_provider: string | null;
  source_provider_poi_id: string | null;
}

interface AuditLogRow {
  id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  before_value: AuditValue;
  after_value: AuditValue;
  created_at: string;
}

interface OutboxEventRow {
  id: string;
  topic: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  available_at: string;
  processed_at: string | null;
  attempts: number;
  last_error: string | null;
  failed_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
}

interface OperationsExportRow {
  [column: string]: OperationsExportValue;
}

function mapAuditLog(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    createdAt: row.created_at
  };
}

function mapOutboxEvent(row: OutboxEventRow): OutboxEventRecord {
  return {
    id: row.id,
    topic: row.topic,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    status: row.status,
    availableAt: row.available_at,
    processedAt: row.processed_at,
    attempts: row.attempts,
    lastError: row.last_error,
    failedAt: row.failed_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    createdAt: row.created_at
  };
}

const auditLogSelect = `
  SELECT id::text, actor_id, action, entity_type, entity_id, reason,
    before_value, after_value, created_at::text
  FROM audit_logs
`;

const outboxEventSelect = `
  SELECT id, topic, aggregate_id, payload, status, available_at::text,
    processed_at::text, attempts, last_error, failed_at::text,
    locked_by, locked_at::text, created_at::text
  FROM outbox_events
`;

function mapCurationTask(row: CurationTaskRow): CurationTaskRecord {
  return {
    id: row.id,
    cityCode: row.city_code,
    restaurantId: row.restaurant_id,
    restaurantLegacyId: row.restaurant_legacy_id,
    restaurantName: row.restaurant_name,
    feedbackReportId: row.feedback_report_id,
    reportType: row.report_type,
    reportNote: row.report_note,
    feedbackStatus: row.feedback_status,
    reason: row.reason,
    priority: row.priority,
    status: row.status,
    assignee: row.assignee,
    resolutionNote: row.resolution_note,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const curationTaskSelect = `
  SELECT t.id, c.code AS city_code, t.restaurant_id, r.legacy_id AS restaurant_legacy_id,
    r.name AS restaurant_name, t.feedback_report_id, f.report_type, f.note AS report_note,
    f.status AS feedback_status, t.reason, t.priority, t.status, t.assignee,
    t.resolution_note, t.due_at::text, t.created_at::text, t.updated_at::text
  FROM curation_tasks t
  JOIN cities c ON c.id = t.city_id
  LEFT JOIN restaurants r ON r.id = t.restaurant_id
  LEFT JOIN feedback_reports f ON f.id = t.feedback_report_id
`;

const poiCandidateSelect = `
  SELECT pc.id, pc.provider, pc.provider_poi_id, c.code AS city_code,
    pc.coverage_area_id, ca.name AS coverage_area_name, pc.name, pc.address, pc.district,
    pc.source_coord_type, pc.source_lat, pc.source_lng,
    ST_Y(pc.location_wgs84::geometry) AS wgs84_lat,
    ST_X(pc.location_wgs84::geometry) AS wgs84_lng,
    pc.phone_normalized, pc.raw_category, pc.observed_at::text, pc.status,
    pc.matched_restaurant_id, matched.legacy_id AS matched_restaurant_legacy_id,
    matched.name AS matched_restaurant_name,
    pc.draft_restaurant_id, draft.publish_status AS draft_restaurant_status,
    pc.suggested_restaurant_id, suggested.legacy_id AS suggested_restaurant_legacy_id,
    suggested.name AS suggested_restaurant_name, pc.suggestion_score,
    pc.match_method, pc.resolution_note, pc.reviewed_by, pc.reviewed_at::text,
    pc.first_seen_at::text, pc.last_seen_at::text
  FROM poi_candidates pc
  JOIN coverage_areas ca ON ca.id = pc.coverage_area_id
  JOIN cities c ON c.id = ca.city_id
  LEFT JOIN restaurants matched ON matched.id = pc.matched_restaurant_id
  LEFT JOIN restaurants draft ON draft.id = pc.draft_restaurant_id
  LEFT JOIN restaurants suggested ON suggested.id = pc.suggested_restaurant_id
`;

function mapPoiCandidate(row: PoiCandidateRow): PoiCandidateRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerPoiId: row.provider_poi_id,
    cityCode: row.city_code,
    coverageAreaId: row.coverage_area_id,
    coverageAreaName: row.coverage_area_name,
    name: row.name,
    address: row.address,
    district: row.district,
    sourceCoordType: row.source_coord_type,
    sourceLocation: { lat: Number(row.source_lat), lng: Number(row.source_lng) },
    locationWgs84: { lat: Number(row.wgs84_lat), lng: Number(row.wgs84_lng) },
    phoneNormalized: row.phone_normalized,
    rawCategory: row.raw_category,
    observedAt: row.observed_at,
    status: row.status,
    matchedRestaurantId: row.matched_restaurant_id,
    matchedRestaurantLegacyId: row.matched_restaurant_legacy_id,
    matchedRestaurantName: row.matched_restaurant_name,
    draftRestaurantId: row.draft_restaurant_id,
    draftRestaurantStatus: row.draft_restaurant_status,
    suggestedRestaurantId: row.suggested_restaurant_id,
    suggestedRestaurantLegacyId: row.suggested_restaurant_legacy_id,
    suggestedRestaurantName: row.suggested_restaurant_name,
    suggestionScore: row.suggestion_score === null ? null : Number(row.suggestion_score),
    matchMethod: row.match_method,
    resolutionNote: row.resolution_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at
  };
}

function mapManagedRestaurant(row: ManagedRestaurantRow): ManagedRestaurantRecord {
  return {
    restaurant: mapRestaurant(row),
    sourceCandidate: row.source_candidate_id && row.source_provider && row.source_provider_poi_id ? {
      id: row.source_candidate_id,
      provider: row.source_provider,
      providerPoiId: row.source_provider_poi_id
    } : null,
    publishStatus: row.publish_status,
    version: row.version,
    createdBy: row.created_by,
    reviewSubmittedBy: row.review_submitted_by,
    reviewSubmittedAt: row.review_submitted_at,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
    withdrawnBy: row.withdrawn_by,
    withdrawnAt: row.withdrawn_at,
    statusNote: row.status_note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  };
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function mapRestaurant(row: RestaurantRow): RestaurantRecord {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    cityCode: row.city_code,
    cityTimezone: row.city_timezone,
    coverageArea: { id: row.coverage_area_id, name: row.coverage_area_name, status: row.coverage_status },
    name: row.name,
    address: row.address,
    district: row.district,
    locationWgs84: { lat: Number(row.wgs84_lat), lng: Number(row.wgs84_lng) },
    locationGcj02: row.gcj02_lat === null || row.gcj02_lng === null ? null : { lat: Number(row.gcj02_lat), lng: Number(row.gcj02_lng) },
    distanceM: row.distance_m === null ? null : Number(row.distance_m),
    primaryCuisineCode: row.primary_cuisine_code,
    cuisineCodes: row.cuisine_codes,
    priceMinFen: row.price_min_fen,
    priceMaxFen: row.price_max_fen,
    acceptsSolo: row.accepts_solo,
    peakPolicy: row.peak_policy,
    seatTypes: row.seat_types,
    counterSeats: row.counter_seats,
    soloPortion: row.solo_portion,
    minSpendFen: row.min_spend_fen,
    mealMinutes: [row.meal_minutes_min, row.meal_minutes_max],
    noiseLevel: row.noise_level,
    soloScore: row.solo_score,
    confidence: row.confidence,
    scoringVersion: row.scoring_version,
    lastVerifiedAt: row.last_verified_at,
    reasonCodes: row.reason_codes,
    hours: row.hours.map(item => ({
      dayOfWeek: item.dayOfWeek,
      specialDate: item.specialDate,
      opensAt: item.opensAt ?? '00:00',
      closesAt: item.closesAt ?? '00:00',
      isClosed: item.isClosed
    })),
    dishes: row.dishes,
    note: row.operator_note,
    evidence: row.evidence.map(item => ({
      attribute: item.attribute,
      title: item.title,
      value: item.value.text ?? '',
      sourceType: item.sourceType,
      sourceLabel: item.sourceLabel,
      observedAt: item.observedAt,
      expiresAt: item.expiresAt,
      status: item.status
    }))
  };
}

const restaurantSelect = (distanceExpression: string, managed = false) => `
  SELECT
    r.id, r.legacy_id, c.code AS city_code, c.timezone AS city_timezone,
    ca.id AS coverage_area_id, ca.name AS coverage_area_name, ca.status AS coverage_status,
    r.name, r.address, r.district,
    ST_Y(r.location_wgs84::geometry) AS wgs84_lat,
    ST_X(r.location_wgs84::geometry) AS wgs84_lng,
    r.gcj02_lat, r.gcj02_lng, ${distanceExpression} AS distance_m,
    primary_cuisine.cuisine_code AS primary_cuisine_code,
    cuisines.codes AS cuisine_codes,
    r.price_min_fen, r.price_max_fen, sp.accepts_solo, r.peak_policy, r.seat_types,
    r.counter_seats, r.solo_portion, r.min_spend_fen, r.meal_minutes_min, r.meal_minutes_max,
    r.noise_level, sp.score AS solo_score, sp.confidence, sp.scoring_version,
    r.last_verified_at::text, sp.reason_codes, hours.items AS hours, r.dishes,
    r.operator_note, evidence_items.items AS evidence
    ${managed ? `, r.publish_status, r.version, r.created_by, r.review_submitted_by,
      r.review_submitted_at::text, r.published_by, r.published_at::text,
      r.withdrawn_by, r.withdrawn_at::text, r.status_note, r.updated_by, r.updated_at::text,
      pc.id AS source_candidate_id, pc.provider AS source_provider,
      pc.provider_poi_id AS source_provider_poi_id` : ''}
  FROM restaurants r
  JOIN cities c ON c.id = r.city_id
  JOIN coverage_areas ca ON ca.id = r.coverage_area_id
  JOIN solo_profiles sp ON sp.restaurant_id = r.id
  JOIN LATERAL (
    SELECT rc.cuisine_code FROM restaurant_cuisines rc
    WHERE rc.restaurant_id = r.id AND rc.is_primary
  ) primary_cuisine ON true
  JOIN LATERAL (
    SELECT array_agg(rc.cuisine_code ORDER BY rc.cuisine_code) AS codes
    FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id
  ) cuisines ON true
  JOIN LATERAL (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'dayOfWeek', h.day_of_week, 'specialDate', h.special_date,
      'opensAt', h.opens_at, 'closesAt', h.closes_at, 'isClosed', h.is_closed
    ) ORDER BY h.special_date NULLS LAST, h.day_of_week, h.opens_at), '[]'::jsonb) AS items
    FROM restaurant_hours h WHERE h.restaurant_id = r.id
  ) hours ON true
  JOIN LATERAL (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'attribute', e.attribute, 'title', e.title, 'value', e.value,
      'sourceType', e.source_type, 'sourceLabel', e.source_label,
      'observedAt', e.observed_at, 'expiresAt', e.expires_at, 'status', e.status
    ) ORDER BY e.observed_at DESC), '[]'::jsonb) AS items
    FROM evidence e WHERE e.restaurant_id = r.id
      ${managed ? '' : "AND e.status IN ('published', 'expired')"}
  ) evidence_items ON true
  ${managed ? 'LEFT JOIN poi_candidates pc ON pc.draft_restaurant_id = r.id' : ''}
`;

async function replaceDraftRelations(client: DatabaseClient, restaurantId: string, draft: RestaurantDraftSave): Promise<void> {
  await client.query('DELETE FROM restaurant_cuisines WHERE restaurant_id = $1', [restaurantId]);
  for (const cuisineCode of draft.cuisineCodes) {
    await client.query(`
      INSERT INTO restaurant_cuisines (restaurant_id, cuisine_code, is_primary)
      VALUES ($1, $2, $3)
    `, [restaurantId, cuisineCode, cuisineCode === draft.primaryCuisineCode]);
  }

  await client.query('DELETE FROM restaurant_hours WHERE restaurant_id = $1', [restaurantId]);
  for (const hours of draft.hours) {
    await client.query(`
      INSERT INTO restaurant_hours (
        restaurant_id, day_of_week, opens_at, closes_at, source_label, observed_at
      ) VALUES ($1, $2, $3, $4, '运营草稿核验', $5)
    `, [restaurantId, hours.dayOfWeek, hours.opensAt, hours.closesAt, draft.savedAt]);
  }

  const profile = deriveSoloProfile(draft);
  await client.query(`
    INSERT INTO solo_profiles (
      restaurant_id, accepts_solo, score, confidence, scoring_version, reason_codes, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (restaurant_id) DO UPDATE SET accepts_solo = EXCLUDED.accepts_solo,
      score = EXCLUDED.score, confidence = EXCLUDED.confidence,
      scoring_version = EXCLUDED.scoring_version, reason_codes = EXCLUDED.reason_codes,
      updated_at = EXCLUDED.updated_at
  `, [restaurantId, draft.acceptsSolo, profile.score, profile.confidence,
    rankingConfig.version, profile.reasonCodes, draft.savedAt]);

  await client.query('DELETE FROM evidence WHERE restaurant_id = $1', [restaurantId]);
  for (const evidence of draft.evidence) {
    await client.query(`
      INSERT INTO evidence (
        restaurant_id, attribute, title, value, source_type, source_label,
        observed_at, expires_at, status
      ) VALUES ($1, $2, $3, jsonb_build_object('text', $4::text), $5, $6, $7, $8, 'candidate')
    `, [restaurantId, evidence.attribute, evidence.title, evidence.value,
      evidence.sourceType, evidence.sourceLabel, evidence.observedAt, evidence.expiresAt]);
  }
}

async function loadManagedRestaurant(
  source: Pick<DatabaseClient, 'query'>,
  id: string
): Promise<ManagedRestaurantRecord | null> {
  const result = await source.query<ManagedRestaurantRow>(`${restaurantSelect('NULL::double precision', true)}
    WHERE r.id = $1 LIMIT 1
  `, [id]);
  const row = result.rows[0];
  return row ? mapManagedRestaurant(row) : null;
}

export class PostgresRepository implements RestaurantRepository {
  constructor(private readonly pool: DatabasePool) {}

  async health(): Promise<RepositoryHealth> {
    const started = performance.now();
    try {
      await this.pool.query('SELECT PostGIS_Version()');
      return { ok: true, source: 'postgres', latencyMs: Math.round(performance.now() - started) };
    } catch {
      return { ok: false, source: 'postgres', latencyMs: Math.round(performance.now() - started) };
    }
  }

  async listCities(): Promise<City[]> {
    const result = await this.pool.query<{
      code: string; name: string; timezone: string; status: City['status'];
      areas: Array<{ id: string; name: string; status: CoverageArea['status'] }>;
    }>(`
      SELECT c.code, c.name, c.timezone, c.status,
        coalesce(jsonb_agg(jsonb_build_object('id', ca.id, 'name', ca.name, 'status', ca.status)
          ORDER BY ca.created_at) FILTER (WHERE ca.id IS NOT NULL), '[]'::jsonb) AS areas
      FROM cities c LEFT JOIN coverage_areas ca ON ca.city_id = c.id
      GROUP BY c.id ORDER BY c.created_at
    `);
    return result.rows;
  }

  async getCoverageArea(id: string): Promise<(CoverageArea & { cityCode: string; cityTimezone: string }) | null> {
    const result = await this.pool.query<{
      id: string; name: string; status: CoverageArea['status']; city_code: string; city_timezone: string;
    }>(`
      SELECT ca.id, ca.name, ca.status, c.code AS city_code, c.timezone AS city_timezone
      FROM coverage_areas ca JOIN cities c ON c.id = ca.city_id WHERE ca.id = $1
    `, [id]);
    const row = result.rows[0];
    return row ? { id: row.id, name: row.name, status: row.status, cityCode: row.city_code, cityTimezone: row.city_timezone } : null;
  }

  async suggestLocations(query: string, limit: number): Promise<LocationSuggestion[]> {
    const result = await this.pool.query<{
      label: string; detail: string; kind: LocationSuggestion['kind']; city_code: string;
      area_id: string | null; status: LocationSuggestion['status'];
    }>(`
      SELECT la.name AS label, la.detail, la.kind, c.code AS city_code, la.coverage_area_id AS area_id,
        coalesce(ca.status, c.status) AS status
      FROM location_aliases la
      JOIN cities c ON c.id = la.city_id
      LEFT JOIN coverage_areas ca ON ca.id = la.coverage_area_id
      WHERE $1 = '' OR la.search_text LIKE '%' || lower($1) || '%' OR lower(c.name) LIKE '%' || lower($1) || '%'
      ORDER BY la.sort_order, la.name LIMIT $2
    `, [query, limit]);
    return result.rows.map(row => ({
      label: row.label, detail: row.detail, kind: row.kind, cityCode: row.city_code,
      areaId: row.area_id, status: row.status
    }));
  }

  async findCandidates(query: CandidateQuery): Promise<RestaurantRecord[]> {
    const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography';
    const result = await this.pool.query<RestaurantRow>(`${restaurantSelect(`ST_Distance(r.location_wgs84, ${point})`)}
      WHERE r.publish_status = 'published' AND r.coverage_area_id = $3
        AND ST_DWithin(r.location_wgs84, ${point}, $4)
        AND ($5 = '' OR r.name ILIKE '%' || $5 || '%' OR r.address ILIKE '%' || $5 || '%' OR r.district ILIKE '%' || $5 || '%')
        AND ($6::integer IS NULL OR r.price_min_fen <= $6)
        AND (cardinality($7::text[]) = 0 OR cuisines.codes && $7::text[])
        AND (NOT $8::boolean OR sp.accepts_solo IS TRUE)
        AND (NOT $9::boolean OR r.meal_minutes_max <= 40)
      ORDER BY distance_m, r.id LIMIT 200
    `, [query.locationWgs84.lng, query.locationWgs84.lat, query.coverageAreaId, query.radiusM, query.keyword,
      query.budgetMaxFen, query.cuisineCodes, query.onlySoloVerified, query.fastMeal]);
    return result.rows.map(mapRestaurant);
  }

  async findRestaurant(id: string): Promise<RestaurantRecord | null> {
    const result = await this.pool.query<RestaurantRow>(`${restaurantSelect('NULL::double precision')}
      WHERE r.publish_status = 'published' AND (r.id::text = $1 OR r.legacy_id = $1) LIMIT 1
    `, [id]);
    const row = result.rows[0];
    return row ? mapRestaurant(row) : null;
  }

  async createFeedbackReport(input: FeedbackSubmission): Promise<FeedbackReceipt> {
    return withTransaction(this.pool, async client => {
      const restaurantResult = await client.query<{ id: string; city_id: string; timezone: string }>(`
        SELECT r.id, r.city_id, c.timezone FROM restaurants r
        JOIN cities c ON c.id = r.city_id
        WHERE r.publish_status = 'published' AND (r.id::text = $1 OR r.legacy_id = $1) LIMIT 1
      `, [input.restaurantId]);
      const restaurant = restaurantResult.rows[0];
      if (!restaurant) throw new Error('RESTAURANT_NOT_FOUND');

      const reportResult = await client.query<{ id: string; created_at: string }>(`
        INSERT INTO feedback_reports (restaurant_id, report_type, note, idempotency_key, status, created_at)
        VALUES ($1, $2, $3, $4, 'open', $5)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id, created_at::text
      `, [restaurant.id, input.reportType, input.note, input.idempotencyKey, input.submittedAt]);
      const report = reportResult.rows[0];
      if (!report) {
        const existingResult = await client.query<{
          id: string; restaurant_id: string; report_type: string; note: string; created_at: string; task_id: string | null;
        }>(`
          SELECT f.id, f.restaurant_id, f.report_type, f.note, f.created_at::text,
            (SELECT t.id FROM curation_tasks t WHERE t.feedback_report_id = f.id ORDER BY t.created_at LIMIT 1) AS task_id
          FROM feedback_reports f WHERE f.idempotency_key = $1
        `, [input.idempotencyKey]);
        const existing = existingResult.rows[0];
        if (!existing) throw new Error('FEEDBACK_INSERT_FAILED');
        const sameRequest = existing.restaurant_id === restaurant.id
          && existing.report_type === input.reportType
          && existing.note === input.note;
        if (!sameRequest) throw new Error('IDEMPOTENCY_KEY_REUSED');
        if (!existing.task_id) throw new Error('FEEDBACK_TASK_MISSING');
        return { reportId: existing.id, taskId: existing.task_id, status: 'open', created: false, receivedAt: existing.created_at };
      }

      const taskResult = await client.query<{ id: string }>(`
        INSERT INTO curation_tasks (
          city_id, restaurant_id, feedback_report_id, reason, priority, status, due_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $7)
        RETURNING id
      `, [restaurant.city_id, restaurant.id, report.id, `feedback:${input.reportType}`, input.priority,
        addBusinessDays(input.submittedAt, 5, restaurant.timezone), input.submittedAt]);
      const task = taskResult.rows[0];
      if (!task) throw new Error('CURATION_TASK_INSERT_FAILED');

      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, after_value, created_at)
        VALUES ('public-feedback', 'create', 'feedback_report', $1, 'user_submitted_correction', $2::jsonb, $3)
      `, [report.id, JSON.stringify({ restaurant_id: restaurant.id, report_type: input.reportType, task_id: task.id }), input.submittedAt]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('feedback.created', $1, $2::jsonb, $3, $3)
      `, [report.id, JSON.stringify({ report_id: report.id, task_id: task.id }), input.submittedAt]);

      return { reportId: report.id, taskId: task.id, status: 'open', created: true, receivedAt: report.created_at };
    });
  }

  async listCurationTasks(status: CurationTaskStatus | null, limit: number): Promise<CurationTaskRecord[]> {
    const result = await this.pool.query<CurationTaskRow>(`${curationTaskSelect}
      WHERE ($1::curation_task_status IS NULL OR t.status = $1)
      ORDER BY t.priority, t.created_at, t.id LIMIT $2
    `, [status, limit]);
    return result.rows.map(mapCurationTask);
  }

  async updateCurationTask(id: string, update: CurationTaskUpdate): Promise<CurationTaskRecord> {
    return withTransaction(this.pool, async client => {
      const currentResult = await client.query<CurationTaskRow>(`${curationTaskSelect}
        WHERE t.id = $1 FOR UPDATE OF t
      `, [id]);
      const currentRow = currentResult.rows[0];
      if (!currentRow) throw new Error('CURATION_TASK_NOT_FOUND');
      assertTaskTransition(currentRow.status, update.status);
      assertTaskClaim(currentRow.status, currentRow.assignee, update.status, update.assignee);
      const terminal = update.status === 'completed' || update.status === 'cancelled';
      if (terminal && !update.resolutionNote) throw new Error('RESOLUTION_REQUIRED');

      await client.query(`
        UPDATE curation_tasks SET status = $2,
          assignee = CASE WHEN $3::boolean THEN $4 ELSE assignee END,
          resolution_note = coalesce($5, resolution_note), updated_at = $6 WHERE id = $1
      `, [id, update.status, update.assignee !== undefined, update.assignee ?? null,
        update.resolutionNote ?? null, update.updatedAt]);

      if (terminal && currentRow.feedback_report_id) {
        const feedbackStatus = update.feedbackStatus ?? (update.status === 'completed' ? 'resolved' : 'rejected');
        await client.query(`
          UPDATE feedback_reports SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = $5
          WHERE id = $1
        `, [currentRow.feedback_report_id, feedbackStatus, update.resolutionNote, update.actorId, update.updatedAt]);
      } else if (update.status === 'in_progress' && currentRow.feedback_report_id) {
        await client.query(`UPDATE feedback_reports SET status = 'triaged' WHERE id = $1 AND status = 'open'`, [currentRow.feedback_report_id]);
      }

      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, before_value, after_value, created_at)
        VALUES ($1, 'transition', 'curation_task', $2, 'operator_task_update', $3::jsonb, $4::jsonb, $5)
      `, [update.actorId, id,
        JSON.stringify({ status: currentRow.status, assignee: currentRow.assignee, resolution_note: currentRow.resolution_note }),
        JSON.stringify({
          status: update.status,
          assignee: update.assignee === undefined ? currentRow.assignee : update.assignee,
          resolution_note: update.resolutionNote ?? currentRow.resolution_note
        }),
        update.updatedAt]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('curation.task_updated', $1, $2::jsonb, $3, $3)
      `, [id, JSON.stringify({ task_id: id, status: update.status }), update.updatedAt]);

      const updatedResult = await client.query<CurationTaskRow>(`${curationTaskSelect} WHERE t.id = $1`, [id]);
      const updated = updatedResult.rows[0];
      if (!updated) throw new Error('CURATION_TASK_NOT_FOUND');
      return mapCurationTask(updated);
    });
  }

  async sweepExpiredEvidence(at: Date, actorId: string): Promise<EvidenceSweepResult> {
    return withTransaction(this.pool, async client => {
      const result = await client.query<{ expired_count: number; created_count: number }>(`
        WITH expired AS MATERIALIZED (
          UPDATE evidence SET status = 'expired'
          WHERE status = 'published' AND expires_at IS NOT NULL AND expires_at <= $1
          RETURNING restaurant_id
        ), affected AS (
          SELECT DISTINCT restaurant_id FROM expired
        ), inserted AS (
          INSERT INTO curation_tasks (
            city_id, restaurant_id, reason, priority, status, due_at, created_at, updated_at
          )
          SELECT r.city_id, r.id, 'evidence_expired', 1, 'open', $1 + interval '7 days', $1, $1
          FROM restaurants r JOIN affected a ON a.restaurant_id = r.id
          WHERE NOT EXISTS (
            SELECT 1 FROM curation_tasks t WHERE t.restaurant_id = r.id
              AND t.reason = 'evidence_expired' AND t.status IN ('open', 'in_progress')
          )
          RETURNING id
        )
        SELECT (SELECT count(*) FROM expired)::integer AS expired_count,
          (SELECT count(*) FROM inserted)::integer AS created_count
      `, [at]);
      const counts = result.rows[0] ?? { expired_count: 0, created_count: 0 };
      if (counts.expired_count > 0 || counts.created_count > 0) {
        const payload = { expired_evidence: counts.expired_count, created_tasks: counts.created_count };
        await client.query(`
          INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, after_value, created_at)
          VALUES ($1, 'expire', 'evidence_batch', $2, 'scheduled_freshness_sweep', $3::jsonb, $4)
        `, [actorId, at.toISOString(), JSON.stringify(payload), at]);
        await client.query(`
          INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
          VALUES ('evidence.expired', $1, $2::jsonb, $3, $3)
        `, [at.toISOString(), JSON.stringify(payload), at]);
      }
      return { expiredEvidence: counts.expired_count, createdTasks: counts.created_count, processedAt: at.toISOString() };
    });
  }

  async importPoiCandidates(input: PoiImportSubmission): Promise<PoiImportReceipt> {
    return withTransaction(this.pool, async client => {
      const coverageResult = await client.query<{ id: string }>('SELECT id FROM coverage_areas WHERE id = $1', [input.coverageAreaId]);
      if (!coverageResult.rows[0]) throw new Error('COVERAGE_AREA_NOT_FOUND');

      const batchResult = await client.query<{ id: string; imported_at: string }>(`
        INSERT INTO poi_import_batches (
          coverage_area_id, provider, source_label, authorization_basis, idempotency_key,
          payload_sha256, input_count, imported_by, imported_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id, imported_at::text
      `, [input.coverageAreaId, input.provider, input.sourceLabel, input.authorizationBasis,
        input.idempotencyKey, input.payloadSha256, input.candidates.length, input.actorId, input.importedAt]);
      const batch = batchResult.rows[0];
      if (!batch) {
        const replayResult = await client.query<{
          id: string; payload_sha256: string; input_count: number; created_count: number;
          updated_count: number; exact_match_count: number; imported_at: string;
        }>(`
          SELECT id, payload_sha256, input_count, created_count, updated_count,
            exact_match_count, imported_at::text
          FROM poi_import_batches WHERE idempotency_key = $1
        `, [input.idempotencyKey]);
        const replay = replayResult.rows[0];
        if (!replay) throw new Error('POI_IMPORT_INSERT_FAILED');
        if (replay.payload_sha256 !== input.payloadSha256) throw new Error('POI_IDEMPOTENCY_KEY_REUSED');
        return {
          batchId: replay.id,
          inputCount: replay.input_count,
          createdCount: replay.created_count,
          updatedCount: replay.updated_count,
          exactMatchCount: replay.exact_match_count,
          created: false,
          importedAt: replay.imported_at
        };
      }

      let createdCount = 0;
      let updatedCount = 0;
      let exactMatchCount = 0;
      for (const candidate of input.candidates) {
        const exactResult = await client.query<{ id: string; coverage_area_id: string }>(`
          SELECT r.id, r.coverage_area_id
          FROM restaurant_provider_refs pr
          JOIN restaurants r ON r.id = pr.restaurant_id
          WHERE pr.provider = $1 AND pr.provider_poi_id = $2
        `, [input.provider, candidate.providerPoiId]);
        const exact = exactResult.rows[0] ?? null;
        if (exact && exact.coverage_area_id !== input.coverageAreaId) throw new Error('POI_COVERAGE_MISMATCH');

        const suggestionResult = exact ? { rows: [] as Array<{ id: string; score: number }> } : await client.query<{ id: string; score: number }>(`
          SELECT ranked.id, ranked.score FROM (
            SELECT r.id,
              greatest(similarity(lower(r.name), lower($2)), word_similarity(lower($2), lower(r.name))) * 0.75
              + similarity(lower(r.address), lower($3)) * 0.15
              + greatest(0, 1 - ST_Distance(r.location_wgs84, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography) / 200) * 0.10 AS score
            FROM restaurants r
            WHERE r.coverage_area_id = $1 AND r.publish_status <> 'withdrawn'
              AND ST_DWithin(r.location_wgs84, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 200)
              AND (similarity(lower(r.name), lower($2)) >= 0.25 OR similarity(lower(r.address), lower($3)) >= 0.25)
          ) ranked
          WHERE ranked.score >= 0.40
          ORDER BY ranked.score DESC, ranked.id LIMIT 1
        `, [input.coverageAreaId, candidate.name, candidate.address,
          candidate.locationWgs84.lng, candidate.locationWgs84.lat]);
        const suggestion = suggestionResult.rows[0] ?? null;
        const gcj02 = candidate.sourceCoordType === 'gcj02' ? candidate.sourceLocation : null;

        const insertResult = await client.query<{ id: string }>(`
          INSERT INTO poi_candidates (
            provider, provider_poi_id, coverage_area_id, last_batch_id, name, address, district,
            source_coord_type, source_lat, source_lng, gcj02_lat, gcj02_lng, location_wgs84,
            phone_normalized, raw_category, observed_at, status, matched_restaurant_id,
            suggested_restaurant_id, suggestion_score, match_method, first_seen_at, last_seen_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, ST_SetSRID(ST_MakePoint($13, $14), 4326)::geography,
            $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $23
          ) ON CONFLICT (provider, provider_poi_id) DO NOTHING
          RETURNING id
        `, [input.provider, candidate.providerPoiId, input.coverageAreaId, batch.id,
          candidate.name, candidate.address, candidate.district, candidate.sourceCoordType,
          candidate.sourceLocation.lat, candidate.sourceLocation.lng, gcj02?.lat ?? null, gcj02?.lng ?? null,
          candidate.locationWgs84.lng, candidate.locationWgs84.lat, candidate.phoneNormalized,
          candidate.rawCategory, candidate.observedAt, exact ? 'matched' : 'pending', exact?.id ?? null,
          exact?.id ?? suggestion?.id ?? null, exact ? 1 : suggestion?.score ?? null,
          exact ? 'provider_ref' : suggestion ? 'name_address_distance' : null, input.importedAt]);
        let candidateId = insertResult.rows[0]?.id;
        let action: 'created' | 'updated' | 'exact_match';
        if (candidateId) {
          createdCount += 1;
          action = exact ? 'exact_match' : 'created';
        } else {
          const existingResult = await client.query<{
            id: string; coverage_area_id: string;
          }>('SELECT id, coverage_area_id FROM poi_candidates WHERE provider = $1 AND provider_poi_id = $2 FOR UPDATE',
          [input.provider, candidate.providerPoiId]);
          const existing = existingResult.rows[0];
          if (!existing) throw new Error('POI_CANDIDATE_UPSERT_FAILED');
          if (existing.coverage_area_id !== input.coverageAreaId) throw new Error('POI_COVERAGE_MISMATCH');
          candidateId = existing.id;
          await client.query(`
            UPDATE poi_candidates SET last_batch_id = $2, name = $3, address = $4, district = $5,
              source_coord_type = $6, source_lat = $7, source_lng = $8, gcj02_lat = $9, gcj02_lng = $10,
              location_wgs84 = ST_SetSRID(ST_MakePoint($11, $12), 4326)::geography,
              phone_normalized = $13, raw_category = $14, observed_at = $15,
              status = CASE WHEN $16::uuid IS NOT NULL THEN 'matched' ELSE status END,
              matched_restaurant_id = coalesce($16, matched_restaurant_id),
              suggested_restaurant_id = CASE WHEN $16::uuid IS NOT NULL THEN $16
                WHEN status = 'pending' THEN $17 ELSE suggested_restaurant_id END,
              suggestion_score = CASE WHEN $16::uuid IS NOT NULL THEN 1
                WHEN status = 'pending' THEN $18 ELSE suggestion_score END,
              match_method = CASE WHEN $16::uuid IS NOT NULL THEN 'provider_ref'
                WHEN status = 'pending' AND $17::uuid IS NOT NULL THEN 'name_address_distance' ELSE match_method END,
              last_seen_at = $19, updated_at = $19
            WHERE id = $1
          `, [candidateId, batch.id, candidate.name, candidate.address, candidate.district,
            candidate.sourceCoordType, candidate.sourceLocation.lat, candidate.sourceLocation.lng,
            gcj02?.lat ?? null, gcj02?.lng ?? null, candidate.locationWgs84.lng, candidate.locationWgs84.lat,
            candidate.phoneNormalized, candidate.rawCategory, candidate.observedAt, exact?.id ?? null,
            suggestion?.id ?? null, suggestion?.score ?? null, input.importedAt]);
          updatedCount += 1;
          action = exact ? 'exact_match' : 'updated';
        }
        if (exact) exactMatchCount += 1;
        await client.query(`
          INSERT INTO poi_import_batch_items (batch_id, candidate_id, provider_poi_id, action)
          VALUES ($1, $2, $3, $4)
        `, [batch.id, candidateId, candidate.providerPoiId, action]);
      }

      await client.query(`
        UPDATE poi_import_batches
        SET created_count = $2, updated_count = $3, exact_match_count = $4 WHERE id = $1
      `, [batch.id, createdCount, updatedCount, exactMatchCount]);
      const auditPayload = {
        provider: input.provider,
        coverage_area_id: input.coverageAreaId,
        input_count: input.candidates.length,
        created_count: createdCount,
        updated_count: updatedCount,
        exact_match_count: exactMatchCount,
        authorization_basis: input.authorizationBasis
      };
      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, after_value, created_at)
        VALUES ($1, 'import', 'poi_import_batch', $2, 'authorized_poi_import', $3::jsonb, $4)
      `, [input.actorId, batch.id, JSON.stringify(auditPayload), input.importedAt]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('poi.imported', $1, $2::jsonb, $3, $3)
      `, [batch.id, JSON.stringify({ batch_id: batch.id, ...auditPayload }), input.importedAt]);
      return {
        batchId: batch.id,
        inputCount: input.candidates.length,
        createdCount,
        updatedCount,
        exactMatchCount,
        created: true,
        importedAt: batch.imported_at
      };
    });
  }

  async listPoiCandidates(query: PoiCandidateQuery): Promise<PoiCandidateRecord[]> {
    const result = await this.pool.query<PoiCandidateRow>(`${poiCandidateSelect}
      WHERE ($1::poi_candidate_status IS NULL OR pc.status = $1)
        AND ($2::text IS NULL OR pc.coverage_area_id = $2)
      ORDER BY pc.last_seen_at DESC, pc.id LIMIT $3
    `, [query.status, query.coverageAreaId, query.limit]);
    return result.rows.map(mapPoiCandidate);
  }

  async reviewPoiCandidate(id: string, review: PoiCandidateReview): Promise<PoiCandidateRecord> {
    return withTransaction(this.pool, async client => {
      const currentResult = await client.query<PoiCandidateRow>(`${poiCandidateSelect}
        WHERE pc.id = $1 FOR UPDATE OF pc
      `, [id]);
      const current = currentResult.rows[0];
      if (!current) throw new Error('POI_CANDIDATE_NOT_FOUND');
      if (current.draft_restaurant_id) throw new Error('POI_CANDIDATE_DRAFT_IN_PROGRESS');
      const nextStatus = assertPoiCandidateTransition(current.status, review);
      let restaurant: { id: string; coverage_area_id: string } | null = null;
      if (review.decision === 'match_existing') {
        const restaurantResult = await client.query<{ id: string; coverage_area_id: string }>(`
          SELECT id, coverage_area_id FROM restaurants
          WHERE publish_status <> 'withdrawn' AND (id::text = $1 OR legacy_id = $1) LIMIT 1
        `, [review.restaurantId]);
        restaurant = restaurantResult.rows[0] ?? null;
        if (!restaurant) throw new Error('RESTAURANT_NOT_FOUND');
        if (restaurant.coverage_area_id !== current.coverage_area_id) throw new Error('POI_RESTAURANT_COVERAGE_MISMATCH');
        await client.query(`
          INSERT INTO restaurant_provider_refs (restaurant_id, provider, provider_poi_id, observed_at, raw_category)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [restaurant.id, current.provider, current.provider_poi_id, review.reviewedAt, current.raw_category]);
        const refResult = await client.query<{ restaurant_id: string }>(`
          SELECT restaurant_id FROM restaurant_provider_refs WHERE provider = $1 AND provider_poi_id = $2
        `, [current.provider, current.provider_poi_id]);
        if (refResult.rows[0]?.restaurant_id !== restaurant.id) throw new Error('PROVIDER_REF_CONFLICT');
      }

      await client.query(`
        UPDATE poi_candidates SET status = $2, matched_restaurant_id = coalesce($3, matched_restaurant_id),
          match_method = CASE WHEN $3::uuid IS NOT NULL THEN 'operator' ELSE match_method END,
          resolution_note = $4, reviewed_by = $5, reviewed_at = $6, updated_at = $6
        WHERE id = $1
      `, [id, nextStatus, restaurant?.id ?? null, review.resolutionNote, review.actorId, review.reviewedAt]);
      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, before_value, after_value, created_at)
        VALUES ($1, 'review', 'poi_candidate', $2, 'operator_poi_decision', $3::jsonb, $4::jsonb, $5)
      `, [review.actorId, id,
        JSON.stringify({ status: current.status, matched_restaurant_id: current.matched_restaurant_id }),
        JSON.stringify({ status: nextStatus, matched_restaurant_id: restaurant?.id ?? current.matched_restaurant_id, resolution_note: review.resolutionNote }),
        review.reviewedAt]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('poi.candidate_reviewed', $1, $2::jsonb, $3, $3)
      `, [id, JSON.stringify({ candidate_id: id, status: nextStatus }), review.reviewedAt]);
      const updatedResult = await client.query<PoiCandidateRow>(`${poiCandidateSelect} WHERE pc.id = $1`, [id]);
      const updated = updatedResult.rows[0];
      if (!updated) throw new Error('POI_CANDIDATE_NOT_FOUND');
      return mapPoiCandidate(updated);
    });
  }

  async createRestaurantDraft(candidateId: string, draft: RestaurantDraftSave): Promise<ManagedRestaurantRecord> {
    const restaurantId = await withTransaction(this.pool, async client => {
      const candidateResult = await client.query<{
        id: string; status: PoiCandidateStatus; draft_restaurant_id: string | null;
        provider: string; provider_poi_id: string; coverage_area_id: string;
        city_id: string; source_coord_type: 'wgs84' | 'gcj02'; source_lat: number; source_lng: number;
        wgs84_lat: number; wgs84_lng: number;
      }>(`
        SELECT pc.id, pc.status, pc.draft_restaurant_id, pc.provider, pc.provider_poi_id,
          pc.coverage_area_id, ca.city_id, pc.source_coord_type, pc.source_lat, pc.source_lng,
          ST_Y(pc.location_wgs84::geometry) AS wgs84_lat,
          ST_X(pc.location_wgs84::geometry) AS wgs84_lng
        FROM poi_candidates pc JOIN coverage_areas ca ON ca.id = pc.coverage_area_id
        WHERE pc.id = $1 FOR UPDATE OF pc
      `, [candidateId]);
      const candidate = candidateResult.rows[0];
      if (!candidate) throw new Error('POI_CANDIDATE_NOT_FOUND');
      if (candidate.status !== 'new_branch') throw new Error('POI_CANDIDATE_NOT_NEW_BRANCH');
      if (candidate.draft_restaurant_id) throw new Error('RESTAURANT_DRAFT_ALREADY_EXISTS');
      const gcj02 = candidate.source_coord_type === 'gcj02';
      const insertResult = await client.query<{ id: string }>(`
        INSERT INTO restaurants (
          city_id, coverage_area_id, name, address, district,
          source_coord_type, source_lat, source_lng, gcj02_lat, gcj02_lng, location_wgs84,
          price_min_fen, price_max_fen, peak_policy, seat_types, counter_seats, solo_portion,
          min_spend_fen, meal_minutes_min, meal_minutes_max, noise_level, dishes, operator_note,
          publish_status, version, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, ST_SetSRID(ST_MakePoint($11, $12), 4326)::geography,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24,
          'draft', 1, $25, $25, $26, $26
        ) RETURNING id
      `, [candidate.city_id, candidate.coverage_area_id, draft.name, draft.address, draft.district,
        candidate.source_coord_type, candidate.source_lat, candidate.source_lng,
        gcj02 ? candidate.source_lat : null, gcj02 ? candidate.source_lng : null,
        candidate.wgs84_lng, candidate.wgs84_lat, draft.priceMinFen, draft.priceMaxFen,
        draft.peakPolicy, draft.seatTypes, draft.counterSeats, draft.soloPortion,
        draft.minSpendFen, draft.mealMinutes[0], draft.mealMinutes[1], draft.noiseLevel,
        draft.dishes, draft.note, draft.actorId, draft.savedAt]);
      const restaurant = insertResult.rows[0];
      if (!restaurant) throw new Error('RESTAURANT_DRAFT_INSERT_FAILED');
      await replaceDraftRelations(client, restaurant.id, draft);
      await client.query('UPDATE poi_candidates SET draft_restaurant_id = $2, updated_at = $3 WHERE id = $1',
        [candidateId, restaurant.id, draft.savedAt]);
      const auditPayload = {
        candidate_id: candidateId,
        provider: candidate.provider,
        provider_poi_id: candidate.provider_poi_id,
        status: 'draft',
        version: 1
      };
      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, after_value, created_at)
        VALUES ($1, 'create_draft', 'restaurant', $2, 'poi_new_branch_draft', $3::jsonb, $4)
      `, [draft.actorId, restaurant.id, JSON.stringify(auditPayload), draft.savedAt]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('restaurant.draft_created', $1, $2::jsonb, $3, $3)
      `, [restaurant.id, JSON.stringify({ restaurant_id: restaurant.id, ...auditPayload }), draft.savedAt]);
      return restaurant.id;
    });
    const created = await this.getManagedRestaurant(restaurantId);
    if (!created) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
    return created;
  }

  async updateRestaurantDraft(id: string, draft: RestaurantDraftSave): Promise<ManagedRestaurantRecord> {
    await withTransaction(this.pool, async client => {
      const currentResult = await client.query<{
        publish_status: RestaurantPublishStatus; version: number; name: string; address: string; district: string;
      }>('SELECT publish_status, version, name, address, district FROM restaurants WHERE id = $1 FOR UPDATE', [id]);
      const current = currentResult.rows[0];
      if (!current) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
      if (current.publish_status !== 'draft') throw new Error('RESTAURANT_DRAFT_NOT_EDITABLE');
      await client.query(`
        UPDATE restaurants SET name = $2, address = $3, district = $4,
          price_min_fen = $5, price_max_fen = $6, peak_policy = $7, seat_types = $8,
          counter_seats = $9, solo_portion = $10, min_spend_fen = $11,
          meal_minutes_min = $12, meal_minutes_max = $13, noise_level = $14,
          dishes = $15, operator_note = $16, version = version + 1,
          status_note = NULL, updated_by = $17, updated_at = $18
        WHERE id = $1
      `, [id, draft.name, draft.address, draft.district, draft.priceMinFen, draft.priceMaxFen,
        draft.peakPolicy, draft.seatTypes, draft.counterSeats, draft.soloPortion, draft.minSpendFen,
        draft.mealMinutes[0], draft.mealMinutes[1], draft.noiseLevel, draft.dishes, draft.note,
        draft.actorId, draft.savedAt]);
      await replaceDraftRelations(client, id, draft);
      const afterValue = { status: 'draft', version: current.version + 1, name: draft.name, address: draft.address, district: draft.district };
      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, before_value, after_value, created_at)
        VALUES ($1, 'update_draft', 'restaurant', $2, 'operator_draft_edit', $3::jsonb, $4::jsonb, $5)
      `, [draft.actorId, id,
        JSON.stringify({ status: current.publish_status, version: current.version, name: current.name, address: current.address, district: current.district }),
        JSON.stringify(afterValue), draft.savedAt]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('restaurant.draft_updated', $1, $2::jsonb, $3, $3)
      `, [id, JSON.stringify({ restaurant_id: id, ...afterValue }), draft.savedAt]);
    });
    const updated = await this.getManagedRestaurant(id);
    if (!updated) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
    return updated;
  }

  async listManagedRestaurants(query: ManagedRestaurantQuery): Promise<ManagedRestaurantRecord[]> {
    const result = await this.pool.query<ManagedRestaurantRow>(`${restaurantSelect('NULL::double precision', true)}
      WHERE ($1::restaurant_publish_status IS NULL OR r.publish_status = $1)
        AND ($2::text IS NULL OR r.coverage_area_id = $2)
      ORDER BY r.updated_at DESC, r.id LIMIT $3
    `, [query.status, query.coverageAreaId, query.limit]);
    return result.rows.map(mapManagedRestaurant);
  }

  async getManagedRestaurant(id: string): Promise<ManagedRestaurantRecord | null> {
    return loadManagedRestaurant(this.pool, id);
  }

  async transitionManagedRestaurant(id: string, transition: RestaurantPublicationTransition): Promise<ManagedRestaurantRecord> {
    await withTransaction(this.pool, async client => {
      const lockResult = await client.query<{ id: string }>('SELECT id FROM restaurants WHERE id = $1 FOR UPDATE', [id]);
      if (!lockResult.rows[0]) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
      const current = await loadManagedRestaurant(client, id);
      if (!current) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
      const nextStatus = nextPublicationStatus(current, transition);
      const timestamp = transition.transitionedAt;

      if (transition.action === 'submit_review') {
        await client.query(`
          UPDATE restaurants SET publish_status = 'review', review_submitted_by = $2,
            review_submitted_at = $3, status_note = $4, updated_by = $2, updated_at = $3
          WHERE id = $1
        `, [id, transition.actorId, timestamp, transition.note]);
      } else if (transition.action === 'request_changes') {
        await client.query(`
          UPDATE restaurants SET publish_status = 'draft', review_submitted_by = NULL,
            review_submitted_at = NULL, status_note = $4, updated_by = $2, updated_at = $3
          WHERE id = $1
        `, [id, transition.actorId, timestamp, transition.note]);
      } else if (transition.action === 'publish') {
        const source = current.sourceCandidate;
        if (!source) throw new Error('SOURCE_CANDIDATE_REQUIRED');
        await client.query(`
          INSERT INTO restaurant_provider_refs (restaurant_id, provider, provider_poi_id, observed_at, raw_category)
          SELECT $1, pc.provider, pc.provider_poi_id, pc.observed_at, pc.raw_category
          FROM poi_candidates pc WHERE pc.id = $2
          ON CONFLICT DO NOTHING
        `, [id, source.id]);
        const providerRefResult = await client.query<{ restaurant_id: string }>(`
          SELECT restaurant_id FROM restaurant_provider_refs
          WHERE provider = $1 AND provider_poi_id = $2
        `, [source.provider, source.providerPoiId]);
        if (providerRefResult.rows[0]?.restaurant_id !== id) throw new Error('PROVIDER_REF_CONFLICT');
        const restaurantRefResult = await client.query<{ provider_poi_id: string }>(`
          SELECT provider_poi_id FROM restaurant_provider_refs WHERE restaurant_id = $1 AND provider = $2
        `, [id, source.provider]);
        if (restaurantRefResult.rows[0]?.provider_poi_id !== source.providerPoiId) throw new Error('PROVIDER_REF_CONFLICT');
        await client.query(`UPDATE evidence SET status = 'published' WHERE restaurant_id = $1 AND status = 'candidate'`, [id]);
        await client.query(`
          UPDATE restaurants SET publish_status = 'published', published_by = $2, published_at = $3,
            withdrawn_by = NULL, withdrawn_at = NULL, status_note = $4,
            last_verified_at = (SELECT max(observed_at) FROM evidence WHERE restaurant_id = $1 AND status = 'published'),
            updated_by = $2, updated_at = $3 WHERE id = $1
        `, [id, transition.actorId, timestamp, transition.note]);
        const candidateResult = await client.query<{ id: string }>(`
          UPDATE poi_candidates SET status = 'matched', matched_restaurant_id = $2,
            match_method = 'operator', resolution_note = $3, reviewed_by = $4,
            reviewed_at = $5, updated_at = $5
          WHERE id = $1 AND status = 'new_branch' RETURNING id
        `, [source.id, id, transition.note, transition.actorId, timestamp]);
        if (!candidateResult.rows[0]) throw new Error('POI_CANDIDATE_NOT_NEW_BRANCH');
      } else if (transition.action === 'withdraw') {
        await client.query(`
          UPDATE restaurants SET publish_status = 'withdrawn', withdrawn_by = $2,
            withdrawn_at = $3, status_note = $4, updated_by = $2, updated_at = $3 WHERE id = $1
        `, [id, transition.actorId, timestamp, transition.note]);
      }

      const afterValue = { status: nextStatus, note: transition.note };
      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, before_value, after_value, created_at)
        VALUES ($1, $2, 'restaurant', $3, 'restaurant_publication_transition', $4::jsonb, $5::jsonb, $6)
      `, [transition.actorId, transition.action, id,
        JSON.stringify({ status: current.publishStatus, version: current.version }),
        JSON.stringify(afterValue), timestamp]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('restaurant.publication_transitioned', $1, $2::jsonb, $3, $3)
      `, [id, JSON.stringify({ restaurant_id: id, action: transition.action, ...afterValue }), timestamp]);
    });
    const updated = await this.getManagedRestaurant(id);
    if (!updated) throw new Error('MANAGED_RESTAURANT_NOT_FOUND');
    return updated;
  }

  async getCoverageQuality(areaId: string, at: Date): Promise<CoverageQualityRecord> {
    const areaResult = await this.pool.query<{
      id: string; name: string; city_code: string; status: CoverageQualityRecord['status']; quality_metrics: Record<string, unknown>;
    }>(`
      SELECT ca.id, ca.name, c.code AS city_code, ca.status, ca.quality_metrics
      FROM coverage_areas ca JOIN cities c ON c.id = ca.city_id WHERE ca.id = $1
    `, [areaId]);
    const area = areaResult.rows[0];
    if (!area) throw new Error('COVERAGE_AREA_NOT_FOUND');

    const restaurantResult = await this.pool.query<{
      published_count: number; recent_count: number; complete_count: number; provider_ref_count: number;
    }>(`
      SELECT
        count(*)::integer AS published_count,
        count(*) FILTER (WHERE r.last_verified_at >= $2 - interval '90 days')::integer AS recent_count,
        count(*) FILTER (
          WHERE sp.accepts_solo IS NOT NULL
            AND cardinality(r.seat_types) > 0
            AND EXISTS (
              SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id AND rc.is_primary
            )
        )::integer AS complete_count,
        count(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM restaurant_provider_refs pr WHERE pr.restaurant_id = r.id)
        )::integer AS provider_ref_count
      FROM restaurants r
      JOIN solo_profiles sp ON sp.restaurant_id = r.id
      WHERE r.coverage_area_id = $1 AND r.publish_status = 'published'
    `, [areaId, at]);
    const restaurantMetrics = restaurantResult.rows[0]
      ?? { published_count: 0, recent_count: 0, complete_count: 0, provider_ref_count: 0 };

    const candidateResult = await this.pool.query<{ pending_high_confidence: number }>(`
      SELECT count(*)::integer AS pending_high_confidence FROM poi_candidates
      WHERE coverage_area_id = $1 AND status = 'pending' AND suggestion_score >= 0.8
    `, [areaId]);
    const pendingHighConfidence = candidateResult.rows[0]?.pending_high_confidence ?? 0;

    const slaResult = await this.pool.query<{ eligible_count: number; on_time_count: number }>(`
      SELECT
        count(*) FILTER (
          WHERE t.status IN ('completed', 'cancelled') OR (t.due_at IS NOT NULL AND t.due_at <= $2)
        )::integer AS eligible_count,
        count(*) FILTER (
          WHERE t.status IN ('completed', 'cancelled') AND t.due_at IS NOT NULL AND t.updated_at <= t.due_at
        )::integer AS on_time_count
      FROM curation_tasks t
      JOIN restaurants r ON r.id = t.restaurant_id
      WHERE r.coverage_area_id = $1 AND t.priority = 0 AND t.reason LIKE 'feedback:%'
    `, [areaId, at]);
    const sla = slaResult.rows[0] ?? { eligible_count: 0, on_time_count: 0 };
    const published = restaurantMetrics.published_count;
    const manual = area.quality_metrics ?? {};
    return {
      areaId: area.id,
      areaName: area.name,
      cityCode: area.city_code,
      status: area.status,
      metrics: {
        publishedRestaurants: published,
        recentVerificationRate: published ? restaurantMetrics.recent_count / published : null,
        coreCompletenessRate: published ? restaurantMetrics.complete_count / published : null,
        providerReferenceRate: published ? restaurantMetrics.provider_ref_count / published : null,
        searchSampleCoverageRate: optionalNumber(manual.search_sample_coverage_rate),
        branchMismatchRate: optionalNumber(manual.branch_mismatch_rate),
        visitConformityRate: optionalNumber(manual.visit_conformity_rate),
        highPriorityFeedbackSlaRate: sla.eligible_count ? sla.on_time_count / sla.eligible_count : null,
        incidentFreeWeeks: optionalNumber(manual.incident_free_weeks),
        pendingHighConfidenceMatches: pendingHighConfidence,
        providerTermsReviewed: optionalBoolean(manual.provider_terms_reviewed),
        privacyReviewed: optionalBoolean(manual.privacy_reviewed),
        postgisRehearsalPassed: optionalBoolean(manual.postgis_rehearsal_passed)
      },
      measuredAt: at.toISOString()
    };
  }

  async updateCoverageQuality(areaId: string, update: CoverageQualityManualUpdate): Promise<CoverageQualityRecord> {
    await withTransaction(this.pool, async client => {
      const currentResult = await client.query<{ quality_metrics: Record<string, unknown> }>(`
        SELECT quality_metrics FROM coverage_areas WHERE id = $1 FOR UPDATE
      `, [areaId]);
      const current = currentResult.rows[0]?.quality_metrics;
      if (!current) throw new Error('COVERAGE_AREA_NOT_FOUND');
      const next = {
        ...current,
        ...(update.searchSampleCoverageRate !== undefined ? { search_sample_coverage_rate: update.searchSampleCoverageRate } : {}),
        ...(update.branchMismatchRate !== undefined ? { branch_mismatch_rate: update.branchMismatchRate } : {}),
        ...(update.visitConformityRate !== undefined ? { visit_conformity_rate: update.visitConformityRate } : {}),
        ...(update.incidentFreeWeeks !== undefined ? { incident_free_weeks: update.incidentFreeWeeks } : {}),
        ...(update.providerTermsReviewed !== undefined ? { provider_terms_reviewed: update.providerTermsReviewed } : {}),
        ...(update.privacyReviewed !== undefined ? { privacy_reviewed: update.privacyReviewed } : {}),
        ...(update.postgisRehearsalPassed !== undefined ? { postgis_rehearsal_passed: update.postgisRehearsalPassed } : {})
      };
      await client.query(`
        UPDATE coverage_areas SET quality_metrics = $2::jsonb, updated_at = $3 WHERE id = $1
      `, [areaId, JSON.stringify(next), update.updatedAt]);
      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, before_value, after_value, created_at)
        VALUES ($1, 'update_quality', 'coverage_area', $2, $3, $4::jsonb, $5::jsonb, $6)
      `, [update.actorId, areaId, update.evidenceNote, JSON.stringify(current), JSON.stringify(next), update.updatedAt]);
      await client.query(`
        INSERT INTO outbox_events (topic, aggregate_id, payload, available_at, created_at)
        VALUES ('coverage.quality_updated', $1, $2::jsonb, $3, $3)
      `, [areaId, JSON.stringify({ coverage_area_id: areaId, quality_metrics: next }), update.updatedAt]);
    });
    return this.getCoverageQuality(areaId, update.updatedAt);
  }

  async listAuditLogs(query: AuditLogQuery): Promise<AuditLogRecord[]> {
    const result = await this.pool.query<AuditLogRow>(`${auditLogSelect}
      WHERE ($1::text IS NULL OR actor_id = $1)
        AND ($2::text IS NULL OR action = $2)
        AND ($3::text IS NULL OR entity_type = $3)
        AND ($4::text IS NULL OR entity_id = $4)
      ORDER BY created_at DESC, id DESC LIMIT $5
    `, [query.actorId, query.action, query.entityType, query.entityId, query.limit]);
    return result.rows.map(mapAuditLog);
  }

  async listOutboxEvents(query: OutboxEventQuery): Promise<OutboxEventRecord[]> {
    const result = await this.pool.query<OutboxEventRow>(`${outboxEventSelect}
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR topic = $2)
        AND ($3::text IS NULL OR aggregate_id = $3)
      ORDER BY created_at DESC, id LIMIT $4
    `, [query.status, query.topic, query.aggregateId, query.limit]);
    return result.rows.map(mapOutboxEvent);
  }

  async claimOutboxEvents(claim: OutboxClaim): Promise<OutboxEventRecord[]> {
    const result = await this.pool.query<OutboxEventRow>(`
      WITH candidates AS (
        SELECT id FROM outbox_events
        WHERE (status = 'pending' AND available_at <= $2)
          OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at <= $3)
        ORDER BY available_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $4
      )
      UPDATE outbox_events event
      SET status = 'processing', locked_by = $1, locked_at = $2,
        attempts = event.attempts + 1
      FROM candidates WHERE event.id = candidates.id
      RETURNING event.id, event.topic, event.aggregate_id, event.payload, event.status,
        event.available_at::text, event.processed_at::text, event.attempts,
        event.last_error, event.failed_at::text, event.locked_by,
        event.locked_at::text, event.created_at::text
    `, [claim.workerId, claim.claimedAt, claim.leaseExpiredBefore, claim.limit]);
    return result.rows.map(mapOutboxEvent)
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt)
        || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  async completeOutboxEvent(id: string, workerId: string, completedAt: Date): Promise<void> {
    const result = await this.pool.query<{ id: string }>(`
      UPDATE outbox_events
      SET status = 'processed', processed_at = $3, last_error = NULL,
        failed_at = NULL, locked_by = NULL, locked_at = NULL
      WHERE id = $1 AND status = 'processing' AND locked_by = $2
      RETURNING id
    `, [id, workerId, completedAt]);
    if (!result.rows[0]) throw new Error('OUTBOX_LEASE_LOST');
  }

  async failOutboxEvent(failure: OutboxFailure): Promise<OutboxEventRecord> {
    const result = await this.pool.query<OutboxEventRow>(`
      UPDATE outbox_events
      SET status = CASE WHEN attempts >= $5 THEN 'failed' ELSE 'pending' END,
        available_at = $4, last_error = $3,
        failed_at = CASE WHEN attempts >= $5 THEN $6 ELSE NULL END,
        locked_by = NULL, locked_at = NULL
      WHERE id = $1 AND status = 'processing' AND locked_by = $2
      RETURNING id, topic, aggregate_id, payload, status, available_at::text,
        processed_at::text, attempts, last_error, failed_at::text,
        locked_by, locked_at::text, created_at::text
    `, [failure.eventId, failure.workerId, failure.error, failure.nextAvailableAt,
      failure.maxAttempts, failure.failedAt]);
    const event = result.rows[0];
    if (!event) throw new Error('OUTBOX_LEASE_LOST');
    return mapOutboxEvent(event);
  }

  async retryOutboxEvent(id: string, actorId: string, retriedAt: Date): Promise<OutboxEventRecord> {
    return withTransaction(this.pool, async client => {
      const currentResult = await client.query<OutboxEventRow>(`${outboxEventSelect}
        WHERE id = $1 FOR UPDATE
      `, [id]);
      const current = currentResult.rows[0];
      if (!current) throw new Error('OUTBOX_EVENT_NOT_FOUND');
      if (current.status !== 'failed') throw new Error('OUTBOX_EVENT_NOT_FAILED');
      const updatedResult = await client.query<OutboxEventRow>(`
        UPDATE outbox_events
        SET status = 'pending', available_at = $2, processed_at = NULL,
          last_error = NULL, failed_at = NULL, locked_by = NULL, locked_at = NULL
        WHERE id = $1
        RETURNING id, topic, aggregate_id, payload, status, available_at::text,
          processed_at::text, attempts, last_error, failed_at::text,
          locked_by, locked_at::text, created_at::text
      `, [id, retriedAt]);
      await client.query(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, before_value, after_value, created_at)
        VALUES ($1, 'retry', 'outbox_event', $2, 'operator_manual_retry', $3::jsonb, $4::jsonb, $5)
      `, [actorId, id,
        JSON.stringify({ status: current.status, attempts: current.attempts, last_error: current.last_error }),
        JSON.stringify({ status: 'pending', attempts: current.attempts }), retriedAt]);
      const updated = updatedResult.rows[0];
      if (!updated) throw new Error('OUTBOX_EVENT_NOT_FOUND');
      return mapOutboxEvent(updated);
    });
  }

  async exportOperationsData(dataset: OperationsExportDataset, limit: number): Promise<OperationsExport> {
    const definitions: Record<OperationsExportDataset, { columns: string[]; sql: string }> = {
      restaurants: {
        columns: ['id', 'legacy_id', 'city_code', 'coverage_area_id', 'name', 'publish_status', 'primary_cuisine_code', 'price_min_fen', 'price_max_fen', 'accepts_solo', 'updated_at'],
        sql: `
          SELECT r.id::text, r.legacy_id, c.code AS city_code, r.coverage_area_id::text,
            r.name, r.publish_status::text, primary_cuisine.cuisine_code AS primary_cuisine_code,
            r.price_min_fen, r.price_max_fen, sp.accepts_solo, r.updated_at::text
          FROM restaurants r
          JOIN cities c ON c.id = r.city_id
          LEFT JOIN restaurant_cuisines primary_cuisine
            ON primary_cuisine.restaurant_id = r.id AND primary_cuisine.is_primary
          LEFT JOIN solo_profiles sp ON sp.restaurant_id = r.id
          ORDER BY r.updated_at DESC, r.id LIMIT $1
        `
      },
      poi_candidates: {
        columns: ['id', 'provider', 'provider_poi_id', 'city_code', 'coverage_area_id', 'name', 'address', 'status', 'matched_restaurant_id', 'suggestion_score', 'reviewed_by', 'reviewed_at', 'last_seen_at'],
        sql: `
          SELECT pc.id::text, pc.provider, pc.provider_poi_id, c.code AS city_code,
            pc.coverage_area_id::text, pc.name, pc.address, pc.status::text,
            pc.matched_restaurant_id::text, pc.suggestion_score::double precision,
            pc.reviewed_by, pc.reviewed_at::text, pc.last_seen_at::text
          FROM poi_candidates pc
          JOIN coverage_areas ca ON ca.id = pc.coverage_area_id
          JOIN cities c ON c.id = ca.city_id
          ORDER BY pc.last_seen_at DESC, pc.id LIMIT $1
        `
      },
      curation_tasks: {
        columns: ['id', 'city_code', 'restaurant_id', 'feedback_report_id', 'reason', 'priority', 'status', 'assignee', 'due_at', 'created_at', 'updated_at'],
        sql: `
          SELECT t.id::text, c.code AS city_code, t.restaurant_id::text,
            t.feedback_report_id::text, t.reason, t.priority, t.status::text,
            t.assignee, t.due_at::text, t.created_at::text, t.updated_at::text
          FROM curation_tasks t JOIN cities c ON c.id = t.city_id
          ORDER BY t.updated_at DESC, t.id LIMIT $1
        `
      },
      audit_logs: {
        columns: ['id', 'actor_id', 'action', 'entity_type', 'entity_id', 'reason', 'created_at'],
        sql: `
          SELECT id::text, actor_id, action, entity_type, entity_id, reason, created_at::text
          FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT $1
        `
      }
    };
    const definition = definitions[dataset];
    const result = await this.pool.query<OperationsExportRow>(definition.sql, [limit]);
    return {
      columns: definition.columns,
      rows: result.rows.map(row => definition.columns.map(column => row[column] ?? null))
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
