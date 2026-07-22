export interface RankingWeights {
  soloFit: number;
  distanceFit: number;
  budgetFit: number;
  cuisineFit: number;
  timeFit: number;
}

export type RankingConfigStatus = 'draft' | 'active' | 'retired';

export interface RankingConfigRecord {
  version: string;
  status: RankingConfigStatus;
  weights: RankingWeights;
  checksum: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface RankingConfigDraft {
  version: string;
  weights: RankingWeights;
  checksum: string;
  reason: string;
  actorId: string;
  createdAt: Date;
}

export interface RankingConfigActivation {
  reason: string;
  actorId: string;
  activatedAt: Date;
}
