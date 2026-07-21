import assert from 'node:assert/strict';
import test from 'node:test';
import type { ManagedRestaurantRecord, RestaurantPublicationTransition } from '../src/domain/publishing.js';
import type { RestaurantRecord } from '../src/domain/repository.js';
import { nextPublicationStatus } from '../src/services/publishing.js';

const transitionAt = new Date('2026-07-22T04:00:00.000Z');

function managedRestaurant(overrides: Partial<ManagedRestaurantRecord> = {}): ManagedRestaurantRecord {
  const restaurant: RestaurantRecord = {
    id: '51000000-0000-4000-8000-000000000001',
    legacyId: null,
    cityCode: 'shanghai',
    cityTimezone: 'Asia/Shanghai',
    coverageArea: { id: 'sh-jingan-huangpu', name: '静安 / 黄浦', status: 'beta' },
    name: '青禾单人食堂',
    address: '常熟路 88 号',
    district: '静安寺',
    locationWgs84: { lat: 31.219, lng: 121.445 },
    locationGcj02: { lat: 31.217, lng: 121.449 },
    distanceM: null,
    primaryCuisineCode: 'rice_noodles',
    cuisineCodes: ['rice_noodles'],
    priceMinFen: 2200,
    priceMaxFen: 4200,
    acceptsSolo: true,
    peakPolicy: '高峰期可单人入座',
    seatTypes: ['单人桌'],
    counterSeats: 6,
    soloPortion: true,
    minSpendFen: null,
    mealMinutes: [20, 35],
    noiseLevel: 2,
    soloScore: 95,
    confidence: 'high',
    scoringVersion: 'v1.0.0-beta.1',
    lastVerifiedAt: null,
    reasonCodes: ['accepts_solo', 'counter_seats'],
    hours: [{ dayOfWeek: 2, specialDate: null, opensAt: '11:00', closesAt: '21:00', isClosed: false }],
    dishes: ['青菜牛肉饭'],
    note: '运营核验草稿',
    evidence: [{
      attribute: 'accepts_solo',
      title: '单人接待确认',
      value: '电话确认全天可接待单人',
      sourceType: 'operator_call',
      sourceLabel: '运营电话核验',
      observedAt: '2026-07-21T04:00:00.000Z',
      expiresAt: '2026-10-21T04:00:00.000Z',
      status: 'candidate'
    }]
  };
  return {
    sourceCandidate: { id: '41000000-0000-4000-8000-000000000010', provider: 'licensed-map', providerPoiId: 'poi-001' },
    publishStatus: 'draft',
    version: 1,
    createdBy: 'operator.editor',
    reviewSubmittedBy: null,
    reviewSubmittedAt: null,
    publishedBy: null,
    publishedAt: null,
    withdrawnBy: null,
    withdrawnAt: null,
    statusNote: null,
    updatedBy: 'operator.editor',
    updatedAt: '2026-07-21T04:00:00.000Z',
    ...overrides,
    restaurant: { ...restaurant, ...overrides.restaurant }
  };
}

function transition(action: RestaurantPublicationTransition['action'], actorId = 'operator.editor'): RestaurantPublicationTransition {
  return { action, actorId, note: '核心字段和单人接待证据已完成复核', transitionedAt: transitionAt };
}

test('expired core evidence blocks review submission and publication', () => {
  const expired = managedRestaurant();
  expired.restaurant.evidence[0]!.expiresAt = transitionAt.toISOString();
  assert.throws(() => nextPublicationStatus(expired, transition('submit_review')), /PUBLISHING_REQUIREMENTS_NOT_MET/);

  expired.publishStatus = 'review';
  expired.reviewSubmittedBy = 'operator.editor';
  assert.throws(() => nextPublicationStatus(expired, transition('publish', 'operator.reviewer')), /PUBLISHING_REQUIREMENTS_NOT_MET/);
});

test('restaurant without confirmed solo acceptance cannot enter review', () => {
  const unconfirmed = managedRestaurant();
  unconfirmed.restaurant.acceptsSolo = false;
  assert.throws(() => nextPublicationStatus(unconfirmed, transition('submit_review')), /PUBLISHING_REQUIREMENTS_NOT_MET/);
});

test('reviewer can request changes and return a review item to draft', () => {
  const inReview = managedRestaurant({
    publishStatus: 'review',
    reviewSubmittedBy: 'operator.editor',
    reviewSubmittedAt: '2026-07-22T03:00:00.000Z'
  });
  assert.equal(nextPublicationStatus(inReview, transition('request_changes', 'operator.reviewer')), 'draft');
});
