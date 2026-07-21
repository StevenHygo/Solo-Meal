import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

loadDotEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  API_DATA_SOURCE: z.enum(['postgres', 'fixture']).default('postgres'),
  DATABASE_URL: z.string().min(1).optional(),
  CORS_ORIGINS: z.string().default('http://127.0.0.1:4173,http://localhost:4173'),
  FEEDBACK_API_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  ADMIN_API_TOKEN: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
}).superRefine((value, context) => {
  if (value.API_DATA_SOURCE === 'postgres' && !value.DATABASE_URL) {
    context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL is required for the postgres data source' });
  }
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  dataSource: 'postgres' | 'fixture';
  databaseUrl: string | undefined;
  corsOrigins: string[];
  feedbackApiEnabled: boolean;
  adminApiToken: string | undefined;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

export function readConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    dataSource: parsed.API_DATA_SOURCE,
    databaseUrl: parsed.DATABASE_URL,
    corsOrigins: parsed.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),
    feedbackApiEnabled: parsed.FEEDBACK_API_ENABLED,
    adminApiToken: parsed.ADMIN_API_TOKEN,
    logLevel: parsed.LOG_LEVEL
  };
}
