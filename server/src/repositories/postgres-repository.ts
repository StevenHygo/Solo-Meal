import type { CandidateQuery, RestaurantRecord, RestaurantRepository, RepositoryHealth } from '../domain/repository.js';
import type { City, CoverageArea, LocationSuggestion } from '../domain/types.js';
import type { DatabasePool } from '../db/pool.js';

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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
