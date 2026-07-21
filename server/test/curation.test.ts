import assert from 'node:assert/strict';
import test from 'node:test';
import { addBusinessDays } from '../src/services/curation.js';

test('feedback due dates skip weekends in the restaurant timezone', () => {
  const fridayShanghai = new Date('2026-07-24T04:00:00.000Z');
  assert.equal(addBusinessDays(fridayShanghai, 5, 'Asia/Shanghai').toISOString(), '2026-07-31T04:00:00.000Z');

  const sundayShanghai = new Date('2026-07-26T04:00:00.000Z');
  assert.equal(addBusinessDays(sundayShanghai, 1, 'Asia/Shanghai').toISOString(), '2026-07-27T04:00:00.000Z');
});
