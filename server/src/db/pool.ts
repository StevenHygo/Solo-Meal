import pg from 'pg';

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export function createPool(connectionString: string): DatabasePool {
  return new Pool({
    connectionString,
    application_name: 'solo-meal-api',
    max: 10,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: true
  });
}

export async function withTransaction<T>(pool: DatabasePool, work: (client: DatabaseClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
