import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoverageQualityRecord } from '../src/domain/coverage-quality.js';
import { evaluateBetaGate, evaluateLiveGate } from '../src/services/coverage-quality.js';

function quality(overrides: Partial<CoverageQualityRecord['metrics']> = {}): CoverageQualityRecord {
  return {
    areaId: 'sh-xujiahui',
    areaName: '徐家汇',
    cityCode: 'shanghai',
    status: 'upcoming',
    measuredAt: '2026-07-21T03:30:00.000Z',
    metrics: {
      publishedRestaurants: 30,
      recentVerificationRate: 0.8,
      coreCompletenessRate: 0.85,
      providerReferenceRate: 0.9,
      searchSampleCoverageRate: 0.6,
      branchMismatchRate: 0.02,
      visitConformityRate: 0.7,
      highPriorityFeedbackSlaRate: 0.8,
      incidentFreeWeeks: 2,
      pendingHighConfidenceMatches: 0,
      providerTermsReviewed: true,
      privacyReviewed: true,
      postgisRehearsalPassed: true,
      ...overrides
    }
  };
}

test('beta gate passes only when every versioned threshold is present', () => {
  assert.equal(evaluateBetaGate(quality()).eligible, true);
  assert.equal(evaluateBetaGate(quality({ privacyReviewed: null })).eligible, false);
  assert.equal(evaluateBetaGate(quality({ pendingHighConfidenceMatches: 1 })).eligible, false);
});

test('live gate keeps the stricter design thresholds', () => {
  assert.equal(evaluateLiveGate(quality()).eligible, false);
  const result = evaluateLiveGate(quality({
    publishedRestaurants: 100,
    searchSampleCoverageRate: 0.8,
    providerReferenceRate: 0.95,
    branchMismatchRate: 0.01,
    visitConformityRate: 0.75,
    highPriorityFeedbackSlaRate: 0.9
  }));
  assert.equal(result.eligible, true);
});
