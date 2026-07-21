export type CoverageStatus = 'live' | 'beta' | 'upcoming' | 'paused' | 'unsupported';
export type Confidence = 'low' | 'medium' | 'high';
export type CoordinateType = 'wgs84' | 'gcj02';

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface CuisineCategory {
  code: string;
  label: string;
  iconKey: string;
  sortOrder: number;
}

export interface CoverageArea {
  id: string;
  name: string;
  status: CoverageStatus;
}

export interface City {
  code: string;
  name: string;
  timezone: string;
  status: CoverageStatus;
  areas: CoverageArea[];
}

export interface LocationSuggestion {
  label: string;
  detail: string;
  kind: 'city' | 'district' | 'business_area' | 'metro_station';
  cityCode: string;
  areaId: string | null;
  status: CoverageStatus;
}

export interface EvidenceFixture {
  attribute: string;
  title: string;
  value: string;
  sourceType: string;
  sourceLabel: string;
  observedAt: string;
  expiresAt: string | null;
}

export interface HoursInterval {
  opensAt: string;
  closesAt: string;
}

export interface RestaurantFixture {
  id: string;
  legacyId: string;
  cityCode: string;
  coverageAreaId: string;
  name: string;
  address: string;
  district: string;
  sourceCoordType: CoordinateType;
  sourceLocation: Coordinate;
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
  soloScore: number;
  confidence: Confidence;
  lastVerifiedAt: string;
  reasonCodes: string[];
  weeklyHours: HoursInterval[];
  dishes: string[];
  note: string;
  evidence: EvidenceFixture[];
}
