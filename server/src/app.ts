import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError, z } from 'zod';
import { cuisineCategories, rankingConfig } from './catalog.js';
import type { AppConfig } from './config/env.js';
import type { RestaurantRepository } from './domain/repository.js';
import { toRestaurantDetailDto } from './services/presentation.js';
import { rankRestaurant } from './services/ranking.js';
import { searchRequestSchema, searchRestaurants } from './services/search.js';

interface AppOptions {
  config: AppConfig;
  repository: RestaurantRepository;
  clock?: () => Date;
}

const suggestionQuerySchema = z.object({ q: z.string().trim().max(80).default(''), limit: z.coerce.number().int().min(1).max(20).default(8) });
const restaurantParamsSchema = z.object({ id: z.string().min(1).max(80) });

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
    methods: ['GET', 'POST'],
    maxAge: 86400
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: '请求参数不符合接口约定', details: error.issues }, request_id: request.id });
      return;
    }
    const normalizedError = error instanceof Error ? error : new Error('Unknown API error');
    const known: Record<string, { status: number; message: string }> = {
      INVALID_CURSOR: { status: 400, message: '分页游标无效或已经过期' },
      COVERAGE_AREA_NOT_FOUND: { status: 404, message: '覆盖区域不存在' },
      ORIGIN_NOT_ALLOWED: { status: 403, message: '请求来源不在允许列表中' }
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
    features: { natural_language_search: false, account_favorites: false, feedback_api: false }
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

  app.addHook('onClose', async () => repository.close());
  return app;
}
