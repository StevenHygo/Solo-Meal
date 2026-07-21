import { z } from 'zod';
import { cuisineCategories, rankingConfig } from '../catalog.js';
import type {
  DerivedSoloProfile,
  ManagedRestaurantRecord,
  RestaurantDraftFields,
  RestaurantDraftSave,
  RestaurantPublicationAction,
  RestaurantPublicationTransition,
  RestaurantPublishStatus
} from '../domain/publishing.js';

const cuisineCodes = new Set(cuisineCategories.map(category => category.code));
const cleanText = (max: number) => z.string().trim().min(1).max(max);
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const evidenceSourceSchema = z.enum(['operator_visit', 'operator_call', 'menu_review', 'merchant_provided']);
const coreEvidenceAttributes = new Set(['accepts_solo', 'seating', 'ordering', 'minimum_spend', 'solo_portion']);
const publishStatuses = ['draft', 'review', 'published', 'withdrawn'] as const satisfies readonly RestaurantPublishStatus[];
const publicationActions = ['submit_review', 'request_changes', 'publish', 'withdraw'] as const satisfies readonly RestaurantPublicationAction[];

const hoursSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  opens_at: timeSchema,
  closes_at: timeSchema
}).refine(value => value.opens_at !== value.closes_at, { message: 'opening and closing times must differ' });

const evidenceSchema = z.object({
  attribute: cleanText(80),
  title: cleanText(120),
  value: cleanText(500),
  source_type: evidenceSourceSchema,
  source_label: cleanText(160),
  observed_at: z.iso.datetime({ offset: true }),
  expires_at: z.iso.datetime({ offset: true })
}).superRefine((value, context) => {
  if (new Date(value.expires_at) <= new Date(value.observed_at)) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'expires_at must be later than observed_at' });
  }
});

export const restaurantDraftSchema = z.object({
  name: cleanText(160),
  address: cleanText(300),
  district: cleanText(80),
  cuisine_codes: z.array(cleanText(40)).min(1).max(6),
  primary_cuisine_code: cleanText(40),
  price_min_fen: z.number().int().min(0).max(1000000),
  price_max_fen: z.number().int().min(0).max(1000000),
  accepts_solo: z.boolean(),
  peak_policy: cleanText(300),
  seat_types: z.array(cleanText(40)).min(1).max(12),
  counter_seats: z.number().int().min(0).max(1000),
  solo_portion: z.boolean(),
  min_spend_fen: z.number().int().min(0).max(1000000).nullable(),
  meal_minutes: z.object({
    min: z.number().int().min(1).max(480),
    max: z.number().int().min(1).max(480)
  }),
  noise_level: z.number().int().min(1).max(5),
  hours: z.array(hoursSchema).min(1).max(28),
  dishes: z.array(cleanText(100)).max(20),
  note: z.string().trim().max(500),
  evidence: z.array(evidenceSchema).min(1).max(20)
}).superRefine((value, context) => {
  const uniqueCuisines = new Set(value.cuisine_codes);
  if (uniqueCuisines.size !== value.cuisine_codes.length) {
    context.addIssue({ code: 'custom', path: ['cuisine_codes'], message: 'cuisine codes must be unique' });
  }
  for (const [index, code] of value.cuisine_codes.entries()) {
    if (!cuisineCodes.has(code)) context.addIssue({ code: 'custom', path: ['cuisine_codes', index], message: 'unknown cuisine code' });
  }
  if (!uniqueCuisines.has(value.primary_cuisine_code)) {
    context.addIssue({ code: 'custom', path: ['primary_cuisine_code'], message: 'primary cuisine must be included in cuisine_codes' });
  }
  if (value.price_max_fen < value.price_min_fen) {
    context.addIssue({ code: 'custom', path: ['price_max_fen'], message: 'maximum price must not be lower than minimum price' });
  }
  if (value.meal_minutes.max < value.meal_minutes.min) {
    context.addIssue({ code: 'custom', path: ['meal_minutes', 'max'], message: 'maximum meal time must not be lower than minimum meal time' });
  }
  const hourKeys = new Set<string>();
  value.hours.forEach((hours, index) => {
    const key = `${hours.day_of_week}:${hours.opens_at}`;
    if (hourKeys.has(key)) context.addIssue({ code: 'custom', path: ['hours', index], message: 'duplicate weekly interval' });
    hourKeys.add(key);
  });
});

export const managedRestaurantQuerySchema = z.object({
  status: z.enum(publishStatuses).optional(),
  coverage_area_id: cleanText(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const managedRestaurantParamsSchema = z.object({ id: z.uuid() });

export const publicationTransitionSchema = z.object({
  action: z.enum(publicationActions),
  note: z.string().trim().min(5).max(500)
});

export function prepareRestaurantDraft(
  input: z.infer<typeof restaurantDraftSchema>,
  actorId: string,
  savedAt: Date
): RestaurantDraftSave {
  const draft: RestaurantDraftSave = {
    name: input.name,
    address: input.address,
    district: input.district,
    cuisineCodes: input.cuisine_codes,
    primaryCuisineCode: input.primary_cuisine_code,
    priceMinFen: input.price_min_fen,
    priceMaxFen: input.price_max_fen,
    acceptsSolo: input.accepts_solo,
    peakPolicy: input.peak_policy,
    seatTypes: input.seat_types,
    counterSeats: input.counter_seats,
    soloPortion: input.solo_portion,
    minSpendFen: input.min_spend_fen,
    mealMinutes: [input.meal_minutes.min, input.meal_minutes.max],
    noiseLevel: input.noise_level,
    hours: input.hours.map(hours => ({ dayOfWeek: hours.day_of_week, opensAt: hours.opens_at, closesAt: hours.closes_at })),
    dishes: input.dishes,
    note: input.note,
    evidence: input.evidence.map(evidence => ({
      attribute: evidence.attribute,
      title: evidence.title,
      value: evidence.value,
      sourceType: evidence.source_type,
      sourceLabel: evidence.source_label,
      observedAt: new Date(evidence.observed_at),
      expiresAt: new Date(evidence.expires_at)
    })),
    actorId,
    savedAt
  };
  if (draft.evidence.some(evidence => evidence.observedAt > savedAt)) throw new Error('INVALID_EVIDENCE_TIME');
  return draft;
}

export function deriveSoloProfile(fields: RestaurantDraftFields): DerivedSoloProfile {
  const reasonCodes: string[] = fields.acceptsSolo ? ['accepts_solo'] : [];
  let score = fields.acceptsSolo ? 55 : 0;
  if (fields.counterSeats > 0) {
    score += 15;
    reasonCodes.push('counter_seats');
  }
  if (fields.soloPortion) {
    score += 10;
    reasonCodes.push('solo_set');
  }
  if (fields.mealMinutes[1] <= 40) {
    score += 10;
    reasonCodes.push('quick_meal');
  }
  if (fields.priceMaxFen <= 6000) {
    score += 5;
    reasonCodes.push('budget_friendly');
  }
  if (fields.seatTypes.some(type => type.includes('靠墙'))) {
    score += 5;
    reasonCodes.push('wall_seats');
  }
  const strongEvidence = fields.evidence.filter(evidence =>
    coreEvidenceAttributes.has(evidence.attribute)
    && (evidence.sourceType === 'operator_visit' || evidence.sourceType === 'operator_call')).length;
  return {
    score: Math.min(100, score),
    confidence: strongEvidence >= 2 ? 'high' : strongEvidence === 1 ? 'medium' : 'low',
    reasonCodes: [...new Set(reasonCodes)]
  };
}

export function assertReadyForReview(record: ManagedRestaurantRecord, at: Date): void {
  const restaurant = record.restaurant;
  if (!restaurant.acceptsSolo || !restaurant.primaryCuisineCode || !restaurant.cuisineCodes.length
    || !restaurant.seatTypes.length || restaurant.priceMaxFen < restaurant.priceMinFen || !restaurant.hours.length) {
    throw new Error('PUBLISHING_REQUIREMENTS_NOT_MET');
  }
  const coreEvidence = restaurant.evidence.filter(evidence =>
    evidence.status === 'candidate'
    && coreEvidenceAttributes.has(evidence.attribute)
    && new Date(evidence.observedAt) <= at
    && evidence.expiresAt !== null
    && new Date(evidence.expiresAt) > at);
  if (!coreEvidence.length) throw new Error('PUBLISHING_REQUIREMENTS_NOT_MET');
}

export function nextPublicationStatus(
  record: ManagedRestaurantRecord,
  transition: RestaurantPublicationTransition
): RestaurantPublishStatus {
  const allowed: Record<RestaurantPublicationAction, RestaurantPublishStatus> = {
    submit_review: 'review',
    request_changes: 'draft',
    publish: 'published',
    withdraw: 'withdrawn'
  };
  const valid = (record.publishStatus === 'draft' && transition.action === 'submit_review')
    || (record.publishStatus === 'review' && (transition.action === 'request_changes' || transition.action === 'publish'))
    || (record.publishStatus === 'published' && transition.action === 'withdraw');
  if (!valid) throw new Error('INVALID_PUBLICATION_TRANSITION');
  if (transition.action === 'submit_review' || transition.action === 'publish') {
    assertReadyForReview(record, transition.transitionedAt);
  }
  if (transition.action === 'publish' && (!record.reviewSubmittedBy || record.reviewSubmittedBy === transition.actorId)) {
    throw new Error('SECOND_REVIEWER_REQUIRED');
  }
  return allowed[transition.action];
}

export function toManagedRestaurantDto(record: ManagedRestaurantRecord) {
  const restaurant = record.restaurant;
  return {
    id: restaurant.id,
    source_candidate: record.sourceCandidate ? {
      id: record.sourceCandidate.id,
      provider: record.sourceCandidate.provider,
      provider_poi_id: record.sourceCandidate.providerPoiId
    } : null,
    status: record.publishStatus,
    version: record.version,
    city_code: restaurant.cityCode,
    coverage_area: restaurant.coverageArea,
    fields: {
      name: restaurant.name,
      address: restaurant.address,
      district: restaurant.district,
      location: { wgs84: restaurant.locationWgs84, gcj02: restaurant.locationGcj02 },
      cuisine_codes: restaurant.cuisineCodes,
      primary_cuisine_code: restaurant.primaryCuisineCode,
      price: { min_fen: restaurant.priceMinFen, max_fen: restaurant.priceMaxFen },
      accepts_solo: restaurant.acceptsSolo,
      peak_policy: restaurant.peakPolicy,
      seat_types: restaurant.seatTypes,
      counter_seats: restaurant.counterSeats,
      solo_portion: restaurant.soloPortion,
      min_spend_fen: restaurant.minSpendFen,
      meal_minutes: { min: restaurant.mealMinutes[0], max: restaurant.mealMinutes[1] },
      noise_level: restaurant.noiseLevel,
      hours: restaurant.hours,
      dishes: restaurant.dishes,
      note: restaurant.note,
      solo_score: restaurant.soloScore,
      confidence: restaurant.confidence,
      reason_codes: restaurant.reasonCodes,
      evidence: restaurant.evidence.map(evidence => ({
        attribute: evidence.attribute,
        title: evidence.title,
        value: evidence.value,
        source_type: evidence.sourceType,
        source_label: evidence.sourceLabel,
        observed_at: evidence.observedAt,
        expires_at: evidence.expiresAt,
        status: evidence.status
      }))
    },
    workflow: {
      created_by: record.createdBy,
      review_submitted_by: record.reviewSubmittedBy,
      review_submitted_at: record.reviewSubmittedAt,
      published_by: record.publishedBy,
      published_at: record.publishedAt,
      withdrawn_by: record.withdrawnBy,
      withdrawn_at: record.withdrawnAt,
      status_note: record.statusNote,
      updated_by: record.updatedBy,
      updated_at: record.updatedAt
    },
    scoring_version: rankingConfig.version
  };
}
