import assert from 'node:assert/strict';
import test from 'node:test';
import type { RestaurantHours } from '../src/domain/repository.js';
import { formatHours, isRestaurantOpen } from '../src/services/hours.js';

function hours(overrides: Partial<RestaurantHours> = {}): RestaurantHours {
  return {
    dayOfWeek: 2,
    specialDate: null,
    opensAt: '10:30',
    closesAt: '21:30',
    isClosed: false,
    ...overrides
  };
}

test('weekly hours use the restaurant timezone', () => {
  const schedule = [hours()];
  assert.equal(isRestaurantOpen(schedule, new Date('2026-07-21T03:30:00.000Z'), 'Asia/Shanghai'), true);
  assert.equal(isRestaurantOpen(schedule, new Date('2026-07-21T14:00:00.000Z'), 'Asia/Shanghai'), false);
});

test('cross-midnight intervals remain open on the following local day', () => {
  const schedule = [hours({ opensAt: '22:00', closesAt: '02:00' })];
  assert.equal(isRestaurantOpen(schedule, new Date('2026-07-21T15:30:00.000Z'), 'Asia/Shanghai'), true);
  assert.equal(isRestaurantOpen(schedule, new Date('2026-07-21T17:30:00.000Z'), 'Asia/Shanghai'), true);
  assert.equal(isRestaurantOpen(schedule, new Date('2026-07-21T19:00:00.000Z'), 'Asia/Shanghai'), false);
});

test('special-date closure overrides normal weekly hours', () => {
  const schedule = [
    hours(),
    hours({ dayOfWeek: null, specialDate: '2026-07-21', opensAt: '00:00', closesAt: '00:00', isClosed: true })
  ];
  assert.equal(isRestaurantOpen(schedule, new Date('2026-07-21T03:30:00.000Z'), 'Asia/Shanghai'), false);
});

test('representative split hours format remains compatible with v0 detail copy', () => {
  const schedule = [hours({ opensAt: '11:00', closesAt: '14:00' }), hours({ opensAt: '17:00', closesAt: '21:00' })];
  assert.equal(formatHours(schedule), '11:00 - 14:00 / 17:00 - 21:00');
});
