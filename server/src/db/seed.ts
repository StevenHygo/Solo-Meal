import { createHash } from 'node:crypto';
import { cities, cuisineCategories, locationSuggestions, rankingConfig } from '../catalog.js';
import { readConfig } from '../config/env.js';
import { v0Restaurants } from '../fixtures/v0-restaurants.js';
import { normalizeToWgs84 } from '../geo/coordinates.js';
import { createPool, withTransaction, type DatabaseClient } from './pool.js';

const shanghaiBoundaryWgs84 = 'MULTIPOLYGON(((121.39 31.18,121.50 31.18,121.50 31.27,121.39 31.27,121.39 31.18)))';

async function seedCatalog(client: DatabaseClient): Promise<Map<string, string>> {
  const cityIds = new Map<string, string>();
  for (const city of cities) {
    const result = await client.query<{ id: string }>(`
      INSERT INTO cities (code, name, timezone, status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone, status = EXCLUDED.status, updated_at = now()
      RETURNING id
    `, [city.code, city.name, city.timezone, city.status]);
    const cityId = result.rows[0]?.id;
    if (!cityId) throw new Error(`Unable to seed city ${city.code}`);
    cityIds.set(city.code, cityId);

    for (const area of city.areas) {
      const boundary = area.id === 'sh-jingan-huangpu' ? shanghaiBoundaryWgs84 : null;
      await client.query(`
        INSERT INTO coverage_areas (id, city_id, name, status, boundary_wgs84)
        VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NULL THEN NULL ELSE ST_GeogFromText($5) END)
        ON CONFLICT (id) DO UPDATE SET city_id = EXCLUDED.city_id, name = EXCLUDED.name, status = EXCLUDED.status,
          boundary_wgs84 = EXCLUDED.boundary_wgs84, updated_at = now()
      `, [area.id, cityId, area.name, area.status, boundary]);
    }
  }

  for (const category of cuisineCategories) {
    await client.query(`
      INSERT INTO cuisine_categories (code, name, icon_key, sort_order, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, icon_key = EXCLUDED.icon_key,
        sort_order = EXCLUDED.sort_order, is_active = true
    `, [category.code, category.label, category.iconKey, category.sortOrder]);
  }

  for (const [index, suggestion] of locationSuggestions.entries()) {
    const cityId = cityIds.get(suggestion.cityCode);
    if (!cityId) throw new Error(`Missing city for location ${suggestion.label}`);
    await client.query(`
      INSERT INTO location_aliases (city_id, coverage_area_id, name, detail, kind, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (city_id, name) DO UPDATE SET coverage_area_id = EXCLUDED.coverage_area_id,
        detail = EXCLUDED.detail, kind = EXCLUDED.kind, sort_order = EXCLUDED.sort_order
    `, [cityId, suggestion.areaId, suggestion.label, suggestion.detail, suggestion.kind, index * 10]);
  }

  const weights = JSON.stringify(rankingConfig.weights);
  const checksum = createHash('sha256').update(weights).digest('hex');
  await client.query(`
    INSERT INTO ranking_configs (version, status, weights, checksum, published_at)
    VALUES ($1, 'active', $2::jsonb, $3, now())
    ON CONFLICT (version) DO UPDATE SET status = 'active', weights = EXCLUDED.weights,
      checksum = EXCLUDED.checksum, published_at = EXCLUDED.published_at
  `, [rankingConfig.version, weights, checksum]);
  return cityIds;
}

async function seedRestaurant(client: DatabaseClient, cityIds: Map<string, string>, fixtureIndex: number): Promise<void> {
  const restaurant = v0Restaurants[fixtureIndex];
  if (!restaurant) throw new Error(`Missing fixture at index ${fixtureIndex}`);
  const cityId = cityIds.get(restaurant.cityCode);
  if (!cityId) throw new Error(`Missing city ${restaurant.cityCode}`);
  const wgs84 = normalizeToWgs84(restaurant.sourceLocation, restaurant.sourceCoordType);
  const gcj02 = restaurant.sourceCoordType === 'gcj02' ? restaurant.sourceLocation : null;

  await client.query(`
    INSERT INTO restaurants (
      id, legacy_id, city_id, coverage_area_id, name, address, district,
      source_coord_type, source_lat, source_lng, gcj02_lat, gcj02_lng, location_wgs84,
      price_min_fen, price_max_fen, peak_policy, seat_types, counter_seats, solo_portion,
      min_spend_fen, meal_minutes_min, meal_minutes_max, noise_level, dishes, operator_note,
      publish_status, version, last_verified_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, ST_SetSRID(ST_MakePoint($13, $14), 4326)::geography,
      $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26,
      'published', 1, $27
    ) ON CONFLICT (id) DO UPDATE SET
      legacy_id = EXCLUDED.legacy_id, city_id = EXCLUDED.city_id, coverage_area_id = EXCLUDED.coverage_area_id,
      name = EXCLUDED.name, address = EXCLUDED.address, district = EXCLUDED.district,
      source_coord_type = EXCLUDED.source_coord_type, source_lat = EXCLUDED.source_lat, source_lng = EXCLUDED.source_lng,
      gcj02_lat = EXCLUDED.gcj02_lat, gcj02_lng = EXCLUDED.gcj02_lng, location_wgs84 = EXCLUDED.location_wgs84,
      price_min_fen = EXCLUDED.price_min_fen, price_max_fen = EXCLUDED.price_max_fen,
      peak_policy = EXCLUDED.peak_policy, seat_types = EXCLUDED.seat_types, counter_seats = EXCLUDED.counter_seats,
      solo_portion = EXCLUDED.solo_portion, min_spend_fen = EXCLUDED.min_spend_fen,
      meal_minutes_min = EXCLUDED.meal_minutes_min, meal_minutes_max = EXCLUDED.meal_minutes_max,
      noise_level = EXCLUDED.noise_level, dishes = EXCLUDED.dishes, operator_note = EXCLUDED.operator_note,
      publish_status = 'published', last_verified_at = EXCLUDED.last_verified_at, updated_at = now()
  `, [
    restaurant.id, restaurant.legacyId, cityId, restaurant.coverageAreaId, restaurant.name, restaurant.address, restaurant.district,
    restaurant.sourceCoordType, restaurant.sourceLocation.lat, restaurant.sourceLocation.lng, gcj02?.lat ?? null, gcj02?.lng ?? null,
    wgs84.lng, wgs84.lat, restaurant.priceMinFen, restaurant.priceMaxFen, restaurant.peakPolicy, restaurant.seatTypes,
    restaurant.counterSeats, restaurant.soloPortion, restaurant.minSpendFen, restaurant.mealMinutes[0], restaurant.mealMinutes[1],
    restaurant.noiseLevel, restaurant.dishes, restaurant.note, restaurant.lastVerifiedAt
  ]);

  await client.query('DELETE FROM restaurant_cuisines WHERE restaurant_id = $1', [restaurant.id]);
  for (const cuisineCode of restaurant.cuisineCodes) {
    await client.query(`
      INSERT INTO restaurant_cuisines (restaurant_id, cuisine_code, is_primary)
      VALUES ($1, $2, $3)
    `, [restaurant.id, cuisineCode, cuisineCode === restaurant.primaryCuisineCode]);
  }

  await client.query('DELETE FROM restaurant_hours WHERE restaurant_id = $1', [restaurant.id]);
  for (let day = 0; day <= 6; day += 1) {
    for (const interval of restaurant.weeklyHours) {
      await client.query(`
        INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, source_label, observed_at)
        VALUES ($1, $2, $3, $4, 'v0 fixture 结构化迁移', $5)
      `, [restaurant.id, day, interval.opensAt, interval.closesAt, restaurant.lastVerifiedAt]);
    }
  }

  await client.query(`
    INSERT INTO solo_profiles (restaurant_id, accepts_solo, score, confidence, scoring_version, reason_codes, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (restaurant_id) DO UPDATE SET accepts_solo = EXCLUDED.accepts_solo, score = EXCLUDED.score,
      confidence = EXCLUDED.confidence, scoring_version = EXCLUDED.scoring_version,
      reason_codes = EXCLUDED.reason_codes, updated_at = EXCLUDED.updated_at
  `, [restaurant.id, restaurant.acceptsSolo, restaurant.soloScore, restaurant.confidence, rankingConfig.version, restaurant.reasonCodes, restaurant.lastVerifiedAt]);

  await client.query('DELETE FROM evidence WHERE restaurant_id = $1', [restaurant.id]);
  for (const evidence of restaurant.evidence) {
    await client.query(`
      INSERT INTO evidence (restaurant_id, attribute, title, value, source_type, source_label, observed_at, expires_at, status)
      VALUES ($1, $2, $3, jsonb_build_object('text', $4::text), $5, $6, $7, $8, 'published')
    `, [restaurant.id, evidence.attribute, evidence.title, evidence.value, evidence.sourceType, evidence.sourceLabel, evidence.observedAt, evidence.expiresAt]);
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required to seed the database');
  const pool = createPool(config.databaseUrl);
  try {
    await withTransaction(pool, async client => {
      const migration = await client.query<{ table_name: string | null }>("SELECT to_regclass('public.restaurants')::text AS table_name");
      if (!migration.rows[0]?.table_name) throw new Error('Run database migrations before seeding');
      const cityIds = await seedCatalog(client);
      for (let index = 0; index < v0Restaurants.length; index += 1) await seedRestaurant(client, cityIds, index);
    });
    console.log(`Seeded ${v0Restaurants.length} v0 restaurants`);
  } finally {
    await pool.end();
  }
}

await main();
