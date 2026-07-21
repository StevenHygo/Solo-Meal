import type { RestaurantRecord } from './repository.js';

export type RestaurantPublishStatus = 'draft' | 'review' | 'published' | 'withdrawn';
export type RestaurantPublicationAction = 'submit_review' | 'request_changes' | 'publish' | 'withdraw';

export interface RestaurantDraftHoursInput {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface RestaurantDraftEvidenceInput {
  attribute: string;
  title: string;
  value: string;
  sourceType: 'operator_visit' | 'operator_call' | 'menu_review' | 'merchant_provided';
  sourceLabel: string;
  observedAt: Date;
  expiresAt: Date;
}

export interface RestaurantDraftFields {
  name: string;
  address: string;
  district: string;
  cuisineCodes: string[];
  primaryCuisineCode: string;
  priceMinFen: number;
  priceMaxFen: number;
  acceptsSolo: boolean;
  peakPolicy: string;
  seatTypes: string[];
  counterSeats: number;
  soloPortion: boolean;
  minSpendFen: number | null;
  mealMinutes: [number, number];
  noiseLevel: number;
  hours: RestaurantDraftHoursInput[];
  dishes: string[];
  note: string;
  evidence: RestaurantDraftEvidenceInput[];
}

export interface RestaurantDraftSave extends RestaurantDraftFields {
  actorId: string;
  savedAt: Date;
}

export interface ManagedRestaurantRecord {
  restaurant: RestaurantRecord;
  sourceCandidate: {
    id: string;
    provider: string;
    providerPoiId: string;
  } | null;
  publishStatus: RestaurantPublishStatus;
  version: number;
  createdBy: string;
  reviewSubmittedBy: string | null;
  reviewSubmittedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  statusNote: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface ManagedRestaurantQuery {
  status: RestaurantPublishStatus | null;
  coverageAreaId: string | null;
  limit: number;
}

export interface RestaurantPublicationTransition {
  action: RestaurantPublicationAction;
  note: string;
  actorId: string;
  transitionedAt: Date;
}

export interface DerivedSoloProfile {
  score: number;
  confidence: 'low' | 'medium' | 'high';
  reasonCodes: string[];
}
