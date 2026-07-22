import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  RankingConfigDraft,
  RankingConfigRecord,
  RankingWeights
} from '../domain/ranking-config.js';

const weightSchema = z.number().min(0).max(1);
const weightsSchema = z.object({
  solo_fit: weightSchema,
  distance_fit: weightSchema,
  budget_fit: weightSchema,
  cuisine_fit: weightSchema,
  time_fit: weightSchema
}).strict().superRefine((weights, context) => {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.000001) {
    context.addIssue({ code: 'custom', path: [], message: 'ranking weights must sum to 1' });
  }
});

export const rankingConfigQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const rankingConfigParamsSchema = z.object({
  version: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
});

export const rankingConfigDraftSchema = z.object({
  version: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  weights: weightsSchema,
  reason: z.string().trim().min(5).max(500)
}).strict();

export const rankingConfigActivationSchema = z.object({
  reason: z.string().trim().min(5).max(500)
}).strict();

export function rankingChecksum(weights: RankingWeights): string {
  const canonical = JSON.stringify([
    weights.soloFit,
    weights.distanceFit,
    weights.budgetFit,
    weights.cuisineFit,
    weights.timeFit
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export function prepareRankingConfigDraft(
  input: z.infer<typeof rankingConfigDraftSchema>,
  actorId: string,
  createdAt: Date
): RankingConfigDraft {
  const weights: RankingWeights = {
    soloFit: input.weights.solo_fit,
    distanceFit: input.weights.distance_fit,
    budgetFit: input.weights.budget_fit,
    cuisineFit: input.weights.cuisine_fit,
    timeFit: input.weights.time_fit
  };
  return {
    version: input.version,
    weights,
    checksum: rankingChecksum(weights),
    reason: input.reason,
    actorId,
    createdAt
  };
}

export function toRankingConfigDto(config: RankingConfigRecord) {
  return {
    version: config.version,
    status: config.status,
    weights: {
      solo_fit: config.weights.soloFit,
      distance_fit: config.weights.distanceFit,
      budget_fit: config.weights.budgetFit,
      cuisine_fit: config.weights.cuisineFit,
      time_fit: config.weights.timeFit
    },
    checksum: config.checksum,
    published_at: config.publishedAt,
    created_at: config.createdAt
  };
}
