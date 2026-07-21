import assert from 'node:assert/strict';
import test from 'node:test';
import { gcj02ToWgs84, normalizeToWgs84, wgs84ToGcj02 } from '../src/geo/coordinates.js';

test('GCJ-02 coordinates are normalized without relabeling the source values', () => {
  const gcj02 = { lat: 31.2231, lng: 121.4452 };
  const wgs84 = gcj02ToWgs84(gcj02);
  assert.ok(Math.abs(wgs84.lat - gcj02.lat) > 0.001);
  assert.ok(Math.abs(wgs84.lng - gcj02.lng) > 0.001);
  const roundTrip = wgs84ToGcj02(wgs84);
  assert.ok(Math.abs(roundTrip.lat - gcj02.lat) < 0.00005);
  assert.ok(Math.abs(roundTrip.lng - gcj02.lng) < 0.00005);
});

test('WGS84 input remains unchanged and coordinates outside China are untouched', () => {
  const london = { lat: 51.5074, lng: -0.1278 };
  assert.deepEqual(normalizeToWgs84(london, 'wgs84'), london);
  assert.deepEqual(gcj02ToWgs84(london), london);
});
