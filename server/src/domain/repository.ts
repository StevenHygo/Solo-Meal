import type { City, Coordinate, CoverageArea, EvidenceFixture, HoursInterval, LocationSuggestion } from './types.js';
import type { CurationTaskRecord, CurationTaskStatus, CurationTaskUpdate, EvidenceSweepResult, FeedbackReceipt, FeedbackSubmission } from './operations.js';
import type { PoiCandidateQuery, PoiCandidateRecord, PoiCandidateReview, PoiImportReceipt, PoiImportSubmission } from './poi.js';
import type { CoverageQualityManualUpdate, CoverageQualityRecord } from './coverage-quality.js';
import type { ManagedRestaurantQuery, ManagedRestaurantRecord, RestaurantDraftSave, RestaurantPublicationTransition } from './publishing.js';

export interface RestaurantHours extends HoursInterval {
  dayOfWeek: number | null;
  specialDate: string | null;
  isClosed: boolean;
}

export interface RestaurantEvidence extends EvidenceFixture {
  status: 'candidate' | 'published' | 'expired' | 'rejected';
}

export interface RestaurantRecord {
  id: string;
  legacyId: string | null;
  cityCode: string;
  cityTimezone: string;
  coverageArea: CoverageArea;
  name: string;
  address: string;
  district: string;
  locationWgs84: Coordinate;
  locationGcj02: Coordinate | null;
  distanceM: number | null;
  primaryCuisineCode: string;
  cuisineCodes: string[];
  priceMinFen: number;
  priceMaxFen: number;
  acceptsSolo: boolean | null;
  peakPolicy: string;
  seatTypes: string[];
  counterSeats: number;
  soloPortion: boolean | null;
  minSpendFen: number | null;
  mealMinutes: [number, number];
  noiseLevel: number | null;
  soloScore: number;
  confidence: 'low' | 'medium' | 'high';
  scoringVersion: string;
  lastVerifiedAt: string | null;
  reasonCodes: string[];
  hours: RestaurantHours[];
  dishes: string[];
  note: string;
  evidence: RestaurantEvidence[];
}

export interface CandidateQuery {
  coverageAreaId: string;
  locationWgs84: Coordinate;
  radiusM: number;
  keyword: string;
  budgetMaxFen: number | null;
  cuisineCodes: string[];
  onlySoloVerified: boolean;
  fastMeal: boolean;
}

export interface RepositoryHealth {
  ok: boolean;
  source: 'postgres' | 'fixture';
  latencyMs: number;
}

export interface RestaurantRepository {
  health(): Promise<RepositoryHealth>;
  listCities(): Promise<City[]>;
  getCoverageArea(id: string): Promise<(CoverageArea & { cityCode: string; cityTimezone: string }) | null>;
  suggestLocations(query: string, limit: number): Promise<LocationSuggestion[]>;
  findCandidates(query: CandidateQuery): Promise<RestaurantRecord[]>;
  findRestaurant(id: string): Promise<RestaurantRecord | null>;
  createFeedbackReport(input: FeedbackSubmission): Promise<FeedbackReceipt>;
  listCurationTasks(status: CurationTaskStatus | null, limit: number): Promise<CurationTaskRecord[]>;
  updateCurationTask(id: string, update: CurationTaskUpdate): Promise<CurationTaskRecord>;
  sweepExpiredEvidence(at: Date, actorId: string): Promise<EvidenceSweepResult>;
  importPoiCandidates(input: PoiImportSubmission): Promise<PoiImportReceipt>;
  listPoiCandidates(query: PoiCandidateQuery): Promise<PoiCandidateRecord[]>;
  reviewPoiCandidate(id: string, review: PoiCandidateReview): Promise<PoiCandidateRecord>;
  createRestaurantDraft(candidateId: string, draft: RestaurantDraftSave): Promise<ManagedRestaurantRecord>;
  updateRestaurantDraft(id: string, draft: RestaurantDraftSave): Promise<ManagedRestaurantRecord>;
  listManagedRestaurants(query: ManagedRestaurantQuery): Promise<ManagedRestaurantRecord[]>;
  getManagedRestaurant(id: string): Promise<ManagedRestaurantRecord | null>;
  transitionManagedRestaurant(id: string, transition: RestaurantPublicationTransition): Promise<ManagedRestaurantRecord>;
  getCoverageQuality(areaId: string, at: Date): Promise<CoverageQualityRecord>;
  updateCoverageQuality(areaId: string, update: CoverageQualityManualUpdate): Promise<CoverageQualityRecord>;
  close(): Promise<void>;
}
