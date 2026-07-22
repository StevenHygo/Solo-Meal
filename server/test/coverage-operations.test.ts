import assert from 'node:assert/strict';
import test from 'node:test';
import { FixtureRepository } from '../src/repositories/fixture-repository.js';
import { effectiveCoverageStatus } from '../src/services/coverage-operations.js';

test('city status overrides effective area status without replacing configured status', async () => {
  const repository = new FixtureRepository();
  const at = new Date('2026-07-21T03:30:00.000Z');

  assert.equal(effectiveCoverageStatus('paused', 'beta'), 'paused');
  assert.equal(effectiveCoverageStatus('beta', 'upcoming'), 'upcoming');

  const paused = await repository.updateCityStatus('shanghai', {
    status: 'paused', reason: '临时暂停公开推荐进行质量复核', actorId: 'operator.coverage', updatedAt: at
  });
  assert.equal(paused.status, 'paused');
  assert.equal(paused.areas.find(area => area.id === 'sh-jingan-huangpu')?.configuredStatus, 'beta');
  assert.equal(paused.areas.find(area => area.id === 'sh-jingan-huangpu')?.effectiveStatus, 'paused');
  assert.equal((await repository.getCoverageArea('sh-jingan-huangpu'))?.status, 'paused');

  const restored = await repository.updateCityStatus('shanghai', {
    status: 'beta', reason: '质量复核完成后恢复原覆盖状态', actorId: 'operator.coverage', updatedAt: at
  });
  assert.equal(restored.areas.find(area => area.id === 'sh-jingan-huangpu')?.configuredStatus, 'beta');
  assert.equal(restored.areas.find(area => area.id === 'sh-jingan-huangpu')?.effectiveStatus, 'beta');

  const audit = await repository.listAuditLogs({ actorId: 'operator.coverage', action: 'update_status', entityType: 'city', entityId: null, limit: 10 });
  const outbox = await repository.listOutboxEvents({ status: 'pending', topic: 'coverage.city_status_updated', aggregateId: 'shanghai', limit: 10 });
  assert.equal(audit.length, 2);
  assert.equal(outbox.length, 2);
});

test('expiring evidence query includes only the requested future window', async () => {
  const repository = new FixtureRepository();
  const at = new Date('2026-07-21T03:30:00.000Z');
  const withinThirty = await repository.listExpiringEvidence({
    withinDays: 30, coverageAreaId: 'sh-jingan-huangpu', attribute: null, limit: 100, at
  });
  assert.equal(withinThirty.length, 2);
  assert.ok(withinThirty.every(item => item.restaurantLegacyId === 'r006'));
  assert.ok(withinThirty.every(item => item.expiresInDays === 30));
  assert.ok(withinThirty.every(item => item.id.startsWith('fixture-evidence:')));

  const withinTwentyNine = await repository.listExpiringEvidence({
    withinDays: 29, coverageAreaId: null, attribute: null, limit: 100, at
  });
  assert.deepEqual(withinTwentyNine, []);

  const orderingOnly = await repository.listExpiringEvidence({
    withinDays: 30, coverageAreaId: null, attribute: 'ordering', limit: 100, at
  });
  assert.equal(orderingOnly.length, 1);
  assert.equal(orderingOnly[0]?.attribute, 'ordering');
});
