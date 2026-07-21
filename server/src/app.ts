import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { cuisineCategories, rankingConfig } from './catalog.js';
import type { AppConfig } from './config/env.js';
import type { RestaurantRepository } from './domain/repository.js';
import { toRestaurantDetailDto } from './services/presentation.js';
import { rankRestaurant } from './services/ranking.js';
import { searchRequestSchema, searchRestaurants } from './services/search.js';
import { feedbackPriority, feedbackRequestSchema } from './services/feedback.js';
import { curationTaskParamsSchema, curationTaskQuerySchema, curationTaskUpdateSchema, toCurationTaskDto } from './services/curation.js';
import { poiCandidateParamsSchema, poiCandidateQuerySchema, poiCandidateReviewSchema, poiImportRequestSchema, preparePoiImport, toPoiCandidateDto } from './services/poi.js';
import { coverageQualityUpdateSchema, toCoverageQualityDto } from './services/coverage-quality.js';

interface AppOptions {
  config: AppConfig;
  repository: RestaurantRepository;
  clock?: () => Date;
}

const suggestionQuerySchema = z.object({ q: z.string().trim().max(80).default(''), limit: z.coerce.number().int().min(1).max(20).default(8) });
const restaurantParamsSchema = z.object({ id: z.string().min(1).max(80) });
const coverageParamsSchema = z.object({ id: z.string().min(1).max(80) });
const operatorIdSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9._@-]+$/);

function tokensMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function createApp({ config, repository, clock = () => new Date() }: AppOptions) {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    trustProxy: config.nodeEnv === 'production',
    bodyLimit: 64 * 1024,
    requestIdHeader: 'x-request-id'
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
      else callback(new Error('ORIGIN_NOT_ALLOWED'), false);
    },
    methods: ['GET', 'POST', 'PATCH'],
    maxAge: 86400
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: '请求参数不符合接口约定', details: error.issues }, request_id: request.id });
      return;
    }
    const normalizedError = error instanceof Error ? error : new Error('Unknown API error');
    const frameworkStatus = (normalizedError as Error & { statusCode?: number }).statusCode;
    if (frameworkStatus === 429) {
      void reply.status(429).send({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' }, request_id: request.id });
      return;
    }
    if (frameworkStatus === 413) {
      void reply.status(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求内容超过接口限制' }, request_id: request.id });
      return;
    }
    const known: Record<string, { status: number; message: string }> = {
      INVALID_CURSOR: { status: 400, message: '分页游标无效或已经过期' },
      COVERAGE_AREA_NOT_FOUND: { status: 404, message: '覆盖区域不存在' },
      ORIGIN_NOT_ALLOWED: { status: 403, message: '请求来源不在允许列表中' },
      FEEDBACK_API_DISABLED: { status: 503, message: '服务端纠错暂未开启' },
      RESTAURANT_NOT_FOUND: { status: 404, message: '餐厅不存在或已撤回' },
      IDEMPOTENCY_KEY_REUSED: { status: 409, message: '幂等键已经用于其他纠错内容' },
      CURATION_TASK_NOT_FOUND: { status: 404, message: '复核任务不存在' },
      INVALID_TASK_TRANSITION: { status: 409, message: '复核任务状态不能这样变更' },
      TASK_ALREADY_CLAIMED: { status: 409, message: '复核任务已由其他运营人员认领' },
      RESOLUTION_REQUIRED: { status: 400, message: '结束任务前必须填写处理说明' },
      POI_IDEMPOTENCY_KEY_REUSED: { status: 409, message: '幂等键已经用于其他 POI 导入内容' },
      POI_COVERAGE_MISMATCH: { status: 409, message: '同一 Provider POI 已归入其他覆盖区域' },
      POI_CANDIDATE_NOT_FOUND: { status: 404, message: 'POI 候选不存在' },
      INVALID_POI_CANDIDATE_TRANSITION: { status: 409, message: 'POI 候选状态不能这样变更' },
      POI_RESTAURANT_COVERAGE_MISMATCH: { status: 409, message: '候选与目标餐厅不在同一覆盖区域' },
      PROVIDER_REF_CONFLICT: { status: 409, message: 'Provider POI 已关联其他餐厅' }
    };
    const match = known[normalizedError.message];
    if (match) {
      void reply.status(match.status).send({ error: { code: normalizedError.message, message: match.message }, request_id: request.id });
      return;
    }
    request.log.error({ err: normalizedError }, 'Unhandled API error');
    void reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' }, request_id: request.id });
  });

  app.get('/api/v1/health', async (_request, reply) => {
    const health = await repository.health();
    return reply.status(health.ok ? 200 : 503).send({ status: health.ok ? 'ok' : 'degraded', ...health });
  });

  app.get('/api/v1/config', async request => ({
    request_id: request.id,
    version: '1.0.0-beta.1',
    cuisines: cuisineCategories.map(category => ({ code: category.code, label: category.label, icon_key: category.iconKey })),
    budgets: [3000, 6000, 10000],
    ranking_version: rankingConfig.version,
    features: {
      natural_language_search: false,
      account_favorites: false,
      feedback_api: config.feedbackApiEnabled,
      operations_api: Boolean(config.adminApiToken)
    }
  }));

  app.get('/api/v1/cities', async request => ({ request_id: request.id, cities: await repository.listCities() }));

  app.get('/api/v1/locations/suggest', async request => {
    const query = suggestionQuerySchema.parse(request.query);
    return { request_id: request.id, suggestions: await repository.suggestLocations(query.q, query.limit) };
  });

  app.post('/api/v1/restaurants/search', async request => {
    const input = searchRequestSchema.parse(request.body);
    return searchRestaurants(repository, input, request.id, clock());
  });

  app.get('/api/v1/restaurants/:id', async (request, reply) => {
    const { id } = restaurantParamsSchema.parse(request.params);
    const restaurant = await repository.findRestaurant(id);
    if (!restaurant) return reply.status(404).send({ error: { code: 'RESTAURANT_NOT_FOUND', message: '餐厅不存在或已撤回' }, request_id: request.id });
    const now = clock();
    const ranked = rankRestaurant(restaurant, { radiusM: 2000, budgetMaxFen: null, cuisineCodes: [], fastMeal: false, now });
    return { request_id: request.id, restaurant: toRestaurantDetailDto(ranked, now), ranking_version: restaurant.scoringVersion };
  });

  app.post('/api/v1/feedback-reports', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!config.feedbackApiEnabled) throw new Error('FEEDBACK_API_DISABLED');
    const input = feedbackRequestSchema.parse(request.body);
    const receipt = await repository.createFeedbackReport({
      restaurantId: input.restaurant_id,
      reportType: input.report_type,
      note: input.note,
      idempotencyKey: input.idempotency_key,
      priority: feedbackPriority(input.report_type),
      submittedAt: clock()
    });
    return reply.status(receipt.created ? 201 : 200).send({
      request_id: request.id,
      report: {
        id: receipt.reportId,
        task_id: receipt.taskId,
        status: receipt.status,
        received_at: receipt.receivedAt
      },
      idempotent_replay: !receipt.created
    });
  });

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminApiToken) {
      return reply.status(503).send({ error: { code: 'ADMIN_API_DISABLED', message: '运营接口未配置' }, request_id: request.id });
    }
    const authorization = request.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!tokensMatch(token, config.adminApiToken)) {
      return reply.status(401).send({ error: { code: 'ADMIN_UNAUTHORIZED', message: '运营凭据无效' }, request_id: request.id });
    }
  };

  app.get('/api/v1/admin/tasks', { preHandler: requireAdmin }, async request => {
    const query = curationTaskQuerySchema.parse(request.query);
    const tasks = await repository.listCurationTasks(query.status ?? null, query.limit);
    return { request_id: request.id, tasks: tasks.map(toCurationTaskDto) };
  });

  app.patch('/api/v1/admin/tasks/:id', { preHandler: requireAdmin }, async request => {
    const { id } = curationTaskParamsSchema.parse(request.params);
    const input = curationTaskUpdateSchema.parse(request.body);
    const actorId = operatorIdSchema.parse(request.headers['x-operator-id']);
    const assignee = input.assignee === undefined && input.status === 'in_progress' ? actorId : input.assignee;
    const task = await repository.updateCurationTask(id, {
      status: input.status,
      ...(assignee !== undefined ? { assignee } : {}),
      ...(input.resolution_note ? { resolutionNote: input.resolution_note } : {}),
      ...(input.feedback_status ? { feedbackStatus: input.feedback_status } : {}),
      actorId,
      updatedAt: clock()
    });
    return { request_id: request.id, task: toCurationTaskDto(task) };
  });

  app.post('/api/v1/admin/evidence/sweep', { preHandler: requireAdmin }, async request => {
    const actorId = operatorIdSchema.parse(request.headers['x-operator-id']);
    const result = await repository.sweepExpiredEvidence(clock(), actorId);
    return {
      request_id: request.id,
      result: {
        expired_evidence: result.expiredEvidence,
        created_tasks: result.createdTasks,
        processed_at: result.processedAt
      }
    };
  });

  app.post('/api/v1/admin/poi/imports', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const actorId = operatorIdSchema.parse(request.headers['x-operator-id']);
    const input = poiImportRequestSchema.parse(request.body);
    const receipt = await repository.importPoiCandidates(preparePoiImport(input, actorId, clock()));
    return reply.status(receipt.created ? 201 : 200).send({
      request_id: request.id,
      batch: {
        id: receipt.batchId,
        input_count: receipt.inputCount,
        created_count: receipt.createdCount,
        updated_count: receipt.updatedCount,
        exact_match_count: receipt.exactMatchCount,
        imported_at: receipt.importedAt
      },
      idempotent_replay: !receipt.created
    });
  });

  app.get('/api/v1/admin/poi/candidates', { preHandler: requireAdmin }, async request => {
    const query = poiCandidateQuerySchema.parse(request.query);
    const candidates = await repository.listPoiCandidates({
      status: query.status ?? null,
      coverageAreaId: query.coverage_area_id ?? null,
      limit: query.limit
    });
    return { request_id: request.id, candidates: candidates.map(toPoiCandidateDto) };
  });

  app.patch('/api/v1/admin/poi/candidates/:id', { preHandler: requireAdmin }, async request => {
    const actorId = operatorIdSchema.parse(request.headers['x-operator-id']);
    const { id } = poiCandidateParamsSchema.parse(request.params);
    const input = poiCandidateReviewSchema.parse(request.body);
    const candidate = await repository.reviewPoiCandidate(id, {
      decision: input.decision,
      ...(input.restaurant_id ? { restaurantId: input.restaurant_id } : {}),
      resolutionNote: input.resolution_note,
      actorId,
      reviewedAt: clock()
    });
    return { request_id: request.id, candidate: toPoiCandidateDto(candidate) };
  });

  app.get('/api/v1/admin/coverage/:id/quality', { preHandler: requireAdmin }, async request => {
    const { id } = coverageParamsSchema.parse(request.params);
    const quality = await repository.getCoverageQuality(id, clock());
    return { request_id: request.id, quality: toCoverageQualityDto(quality) };
  });

  app.patch('/api/v1/admin/coverage/:id/quality', { preHandler: requireAdmin }, async request => {
    const actorId = operatorIdSchema.parse(request.headers['x-operator-id']);
    const { id } = coverageParamsSchema.parse(request.params);
    const input = coverageQualityUpdateSchema.parse(request.body);
    const quality = await repository.updateCoverageQuality(id, {
      ...(input.search_sample_coverage_rate !== undefined ? { searchSampleCoverageRate: input.search_sample_coverage_rate } : {}),
      ...(input.branch_mismatch_rate !== undefined ? { branchMismatchRate: input.branch_mismatch_rate } : {}),
      ...(input.visit_conformity_rate !== undefined ? { visitConformityRate: input.visit_conformity_rate } : {}),
      ...(input.incident_free_weeks !== undefined ? { incidentFreeWeeks: input.incident_free_weeks } : {}),
      ...(input.provider_terms_reviewed !== undefined ? { providerTermsReviewed: input.provider_terms_reviewed } : {}),
      ...(input.privacy_reviewed !== undefined ? { privacyReviewed: input.privacy_reviewed } : {}),
      ...(input.postgis_rehearsal_passed !== undefined ? { postgisRehearsalPassed: input.postgis_rehearsal_passed } : {}),
      evidenceNote: input.evidence_note,
      actorId,
      updatedAt: clock()
    });
    return { request_id: request.id, quality: toCoverageQualityDto(quality) };
  });

  app.addHook('onClose', async () => repository.close());
  return app;
}
