import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { readConfig } from '../config/env.js';

const { Client } = pg;

interface Migration {
  name: string;
  upSql: string;
  downSql: string;
  checksum: string;
}

async function readMigrations(directory: string): Promise<Migration[]> {
  const files = (await readdir(directory)).filter(file => file.endsWith('.up.sql')).sort();
  return Promise.all(files.map(async file => {
    const name = file.slice(0, -'.up.sql'.length);
    const upSql = await readFile(path.join(directory, file), 'utf8');
    const downSql = await readFile(path.join(directory, `${name}.down.sql`), 'utf8');
    return { name, upSql, downSql, checksum: createHash('sha256').update(upSql).digest('hex') };
  }));
}

async function ensureMigrationTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS solo_meal_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function migrateUp(client: pg.Client, migrations: Migration[]): Promise<void> {
  const applied = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM solo_meal_migrations ORDER BY name');
  const appliedByName = new Map(applied.rows.map(row => [row.name, row.checksum]));

  for (const migration of migrations) {
    const checksum = appliedByName.get(migration.name);
    if (checksum && checksum !== migration.checksum) throw new Error(`Applied migration ${migration.name} has changed`);
    if (checksum) continue;

    await client.query('BEGIN');
    try {
      await client.query(migration.upSql);
      await client.query('INSERT INTO solo_meal_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
      await client.query('COMMIT');
      console.log(`Applied ${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function migrateDown(client: pg.Client, migrations: Migration[]): Promise<void> {
  const latest = await client.query<{ name: string }>('SELECT name FROM solo_meal_migrations ORDER BY name DESC LIMIT 1');
  const name = latest.rows[0]?.name;
  if (!name) {
    console.log('No migration to roll back');
    return;
  }

  const migration = migrations.find(candidate => candidate.name === name);
  if (!migration) throw new Error(`Missing down migration for ${name}`);
  await client.query('BEGIN');
  try {
    await client.query(migration.downSql);
    await client.query('DELETE FROM solo_meal_migrations WHERE name = $1', [name]);
    await client.query('COMMIT');
    console.log(`Rolled back ${name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  if (direction !== 'up' && direction !== 'down') throw new Error('Migration direction must be up or down');
  const config = readConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required to run migrations');
  const directory = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'migrations');
  const migrations = await readMigrations(directory);
  const client = new Client({ connectionString: config.databaseUrl, application_name: 'solo-meal-migrate' });

  await client.connect();
  try {
    await ensureMigrationTable(client);
    if (direction === 'up') await migrateUp(client, migrations);
    else await migrateDown(client, migrations);
  } finally {
    await client.end();
  }
}

await main();
