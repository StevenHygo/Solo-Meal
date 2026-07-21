import type { AppConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import type { RestaurantRepository } from '../domain/repository.js';
import { FixtureRepository } from './fixture-repository.js';
import { PostgresRepository } from './postgres-repository.js';

export function createRepository(config: AppConfig): RestaurantRepository {
  if (config.dataSource === 'fixture') return new FixtureRepository();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for the postgres repository');
  return new PostgresRepository(createPool(config.databaseUrl));
}
