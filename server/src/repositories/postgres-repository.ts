import type { CandidateQuery, RestaurantRecord, RestaurantRepository, RepositoryHealth } from '../domain/repository.js';
import type { CurationTaskRecord, CurationTaskStatus, CurationTaskUpdate, EvidenceSweepResult, FeedbackReceipt, FeedbackSubmission } from '../domain/operations.js';
import type { City, CoverageArea, LocationSuggestion } from '../domain/types.js';
import { withTransaction, type DatabasePool } from '../db/pool.js';
import { assertTaskClaim, assertTaskTransition } from '../services/curation.js';

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

const restaurantSelect = (distanceExpression: string) => `
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
    FROM evidence e WHERE e.restaurant_id = r.id AND e.status IN ('published', 'expired')
  ) evidence_items ON true
`;

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
      const restaurantResult = await client.query<{ id: string; city_id: string }>(`
        SELECT id, city_id FROM restaurants
        WHERE publish_status = 'published' AND (id::text = $1 OR legacy_id = $1) LIMIT 1
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
        new Date(input.submittedAt.getTime() + 5 * 86400000), input.submittedAt]);
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
