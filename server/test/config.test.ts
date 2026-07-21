import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import { readConfig } from '../src/config/env.js';

function hasIssue(error: unknown, path: string): boolean {
  return error instanceof ZodError && error.issues.some(issue => issue.path.join('.') === path);
}

test('feedback and operator APIs default to disabled for fixture development', () => {
  const config = readConfig({ API_DATA_SOURCE: 'fixture' });
  assert.equal(config.feedbackApiEnabled, false);
  assert.equal(config.adminApiToken, undefined);
});

test('operator API rejects admin tokens shorter than 32 characters', () => {
  assert.throws(
    () => readConfig({ API_DATA_SOURCE: 'fixture', ADMIN_API_TOKEN: 'too-short' }),
    error => hasIssue(error, 'ADMIN_API_TOKEN')
  );
});

test('postgres data source requires an explicit database URL', () => {
  assert.throws(
    () => readConfig({ API_DATA_SOURCE: 'postgres' }),
    error => hasIssue(error, 'DATABASE_URL')
  );
});
