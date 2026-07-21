import type { City, CuisineCategory, LocationSuggestion } from './domain/types.js';

export const cuisineCategories: CuisineCategory[] = [
  { code: 'noodles', label: '面食', iconKey: 'noodles', sortOrder: 10 },
  { code: 'rice_meal', label: '米饭简餐', iconKey: 'rice-meal', sortOrder: 20 },
  { code: 'congee', label: '粥品', iconKey: 'congee', sortOrder: 30 },
  { code: 'dumplings_buns', label: '饺子包点', iconKey: 'dumplings-buns', sortOrder: 40 },
  { code: 'fast_food', label: '快餐小吃', iconKey: 'fast-food', sortOrder: 50 },
  { code: 'local_chinese', label: '地方中餐', iconKey: 'local-chinese', sortOrder: 60 },
  { code: 'japanese', label: '日式料理', iconKey: 'japanese', sortOrder: 70 },
  { code: 'korean', label: '韩式料理', iconKey: 'korean', sortOrder: 80 },
  { code: 'hotpot', label: '火锅', iconKey: 'hotpot', sortOrder: 90 },
  { code: 'bbq', label: '烧肉烤串', iconKey: 'bbq', sortOrder: 100 },
  { code: 'seafood', label: '海鲜', iconKey: 'seafood', sortOrder: 110 },
  { code: 'vegetarian', label: '素食轻食', iconKey: 'vegetarian', sortOrder: 120 },
  { code: 'western', label: '西餐', iconKey: 'western', sortOrder: 130 },
  { code: 'cafe_bakery', label: '咖啡烘焙', iconKey: 'cafe-bakery', sortOrder: 140 },
  { code: 'dessert_drinks', label: '甜品饮品', iconKey: 'dessert-drinks', sortOrder: 150 },
  { code: 'other', label: '其他', iconKey: 'other', sortOrder: 160 }
];

export const cities: City[] = [
  {
    code: 'shanghai', name: '上海', timezone: 'Asia/Shanghai', status: 'beta',
    areas: [
      { id: 'sh-jingan-huangpu', name: '静安 / 黄浦', status: 'beta' },
      { id: 'sh-xujiahui', name: '徐家汇', status: 'upcoming' },
      { id: 'sh-huaihai', name: '淮海中路', status: 'upcoming' },
      { id: 'sh-lujiazui', name: '陆家嘴', status: 'paused' }
    ]
  },
  {
    code: 'beijing', name: '北京', timezone: 'Asia/Shanghai', status: 'upcoming',
    areas: [
      { id: 'bj-guomao', name: '国贸', status: 'upcoming' },
      { id: 'bj-sanlitun', name: '三里屯', status: 'upcoming' }
    ]
  },
  {
    code: 'shenzhen', name: '深圳', timezone: 'Asia/Shanghai', status: 'upcoming',
    areas: [
      { id: 'sz-futian', name: '福田中心区', status: 'upcoming' },
      { id: 'sz-nanshan', name: '南山科技园', status: 'upcoming' }
    ]
  },
  { code: 'hangzhou', name: '杭州', timezone: 'Asia/Shanghai', status: 'unsupported', areas: [] }
];

export const locationSuggestions: LocationSuggestion[] = [
  { label: '静安寺', detail: '上海 · 地铁 2/7/14 号线', kind: 'metro_station', cityCode: 'shanghai', areaId: 'sh-jingan-huangpu', status: 'beta' },
  { label: '南京西路', detail: '上海 · 静安 / 黄浦覆盖区', kind: 'business_area', cityCode: 'shanghai', areaId: 'sh-jingan-huangpu', status: 'beta' },
  { label: '徐家汇', detail: '上海 · 数据核验中', kind: 'business_area', cityCode: 'shanghai', areaId: 'sh-xujiahui', status: 'upcoming' },
  { label: '淮海中路', detail: '上海 · 数据核验中', kind: 'business_area', cityCode: 'shanghai', areaId: 'sh-huaihai', status: 'upcoming' },
  { label: '陆家嘴', detail: '上海 · 暂停新增推荐', kind: 'business_area', cityCode: 'shanghai', areaId: 'sh-lujiazui', status: 'paused' },
  { label: '国贸', detail: '北京 · 即将开放', kind: 'business_area', cityCode: 'beijing', areaId: 'bj-guomao', status: 'upcoming' },
  { label: '福田中心区', detail: '深圳 · 即将开放', kind: 'business_area', cityCode: 'shenzhen', areaId: 'sz-futian', status: 'upcoming' },
  { label: '杭州', detail: '暂未覆盖，可登记需求', kind: 'city', cityCode: 'hangzhou', areaId: null, status: 'unsupported' }
];

export const rankingConfig = {
  version: 'v1-beta.1',
  weights: { soloFit: 0.35, distanceFit: 0.25, budgetFit: 0.15, cuisineFit: 0.15, timeFit: 0.1 }
} as const;
