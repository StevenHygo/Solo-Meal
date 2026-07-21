export const WEB_VERSION = '1.0.0-beta.1';

export const dataSourceConfig = {
  defaultMode: 'static',
  apiBaseUrl: '',
  timeoutMs: 2500,
  snapshotVersion: 'v1-beta.1'
};

export const coverageStatus = {
  live: { label: '已覆盖', description: '已达到公开区域的数据质量门槛' },
  beta: { label: 'Beta', description: '可搜索，数据仍在持续补充' },
  upcoming: { label: '即将开放', description: '区域正在核验，暂不返回推荐' },
  paused: { label: '暂停更新', description: '暂停新增推荐，已收藏餐厅仍可查看' },
  unsupported: { label: '暂未覆盖', description: '当前区域还没有经过核验的单人友好数据' }
};

export const cuisineCategories = [
  { code: 'noodles', label: '面食', icon: './assets/cuisine/noodles.svg' },
  { code: 'rice_meal', label: '米饭简餐', icon: './assets/cuisine/rice-meal.svg' },
  { code: 'congee', label: '粥品', icon: './assets/cuisine/congee.svg' },
  { code: 'dumplings_buns', label: '饺子包点', icon: './assets/cuisine/dumplings-buns.svg' },
  { code: 'fast_food', label: '快餐小吃', icon: './assets/cuisine/fast-food.svg' },
  { code: 'local_chinese', label: '地方中餐', icon: './assets/cuisine/local-chinese.svg' },
  { code: 'japanese', label: '日式料理', icon: './assets/cuisine/japanese.svg' },
  { code: 'korean', label: '韩式料理', icon: './assets/cuisine/korean.svg' },
  { code: 'hotpot', label: '火锅', icon: './assets/cuisine/hotpot.svg' },
  { code: 'bbq', label: '烧肉烤串', icon: './assets/cuisine/bbq.svg' },
  { code: 'seafood', label: '海鲜', icon: './assets/cuisine/seafood.svg' },
  { code: 'vegetarian', label: '素食轻食', icon: './assets/cuisine/vegetarian.svg' },
  { code: 'western', label: '西餐', icon: './assets/cuisine/western.svg' },
  { code: 'cafe_bakery', label: '咖啡烘焙', icon: './assets/cuisine/cafe-bakery.svg' },
  { code: 'dessert_drinks', label: '甜品饮品', icon: './assets/cuisine/dessert-drinks.svg' },
  { code: 'other', label: '其他', icon: './assets/cuisine/other.svg' }
];

export const cities = [
  {
    code: 'shanghai',
    name: '上海',
    timezone: 'Asia/Shanghai',
    locationCenterWgs84: { lat: 31.2231, lng: 121.4452 },
    status: 'beta',
    areas: [
      { code: 'sh-jingan-huangpu', name: '静安 / 黄浦', status: 'beta' },
      { code: 'sh-xujiahui', name: '徐家汇', status: 'upcoming' },
      { code: 'sh-huaihai', name: '淮海中路', status: 'upcoming' },
      { code: 'sh-lujiazui', name: '陆家嘴', status: 'paused' }
    ]
  },
  {
    code: 'beijing',
    name: '北京',
    timezone: 'Asia/Shanghai',
    locationCenterWgs84: { lat: 39.9042, lng: 116.4074 },
    status: 'upcoming',
    areas: [
      { code: 'bj-guomao', name: '国贸', status: 'upcoming' },
      { code: 'bj-sanlitun', name: '三里屯', status: 'upcoming' }
    ]
  },
  {
    code: 'shenzhen',
    name: '深圳',
    timezone: 'Asia/Shanghai',
    locationCenterWgs84: { lat: 22.5431, lng: 114.0579 },
    status: 'upcoming',
    areas: [
      { code: 'sz-futian', name: '福田中心区', status: 'upcoming' },
      { code: 'sz-nanshan', name: '南山科技园', status: 'upcoming' }
    ]
  },
  {
    code: 'hangzhou',
    name: '杭州',
    timezone: 'Asia/Shanghai',
    locationCenterWgs84: { lat: 30.2741, lng: 120.1551 },
    status: 'unsupported',
    areas: []
  }
];

export const locationSuggestions = [
  { label: '静安寺', detail: '上海 · 地铁 2/7/14 号线', cityCode: 'shanghai', areaCode: 'sh-jingan-huangpu', status: 'beta', location: { lat: 31.2231, lng: 121.4452, coordType: 'gcj02' } },
  { label: '南京西路', detail: '上海 · 静安 / 黄浦覆盖区', cityCode: 'shanghai', areaCode: 'sh-jingan-huangpu', status: 'beta', location: { lat: 31.2298, lng: 121.4589, coordType: 'gcj02' } },
  { label: '徐家汇', detail: '上海 · 数据核验中', cityCode: 'shanghai', areaCode: 'sh-xujiahui', status: 'upcoming', location: { lat: 31.1838, lng: 121.4365, coordType: 'gcj02' } },
  { label: '淮海中路', detail: '上海 · 数据核验中', cityCode: 'shanghai', areaCode: 'sh-huaihai', status: 'upcoming', location: { lat: 31.2206, lng: 121.4707, coordType: 'gcj02' } },
  { label: '陆家嘴', detail: '上海 · 暂停新增推荐', cityCode: 'shanghai', areaCode: 'sh-lujiazui', status: 'paused', location: { lat: 31.2382, lng: 121.4997, coordType: 'gcj02' } },
  { label: '国贸', detail: '北京 · 即将开放', cityCode: 'beijing', areaCode: 'bj-guomao', status: 'upcoming', location: { lat: 39.9087, lng: 116.4600, coordType: 'gcj02' } },
  { label: '福田中心区', detail: '深圳 · 即将开放', cityCode: 'shenzhen', areaCode: 'sz-futian', status: 'upcoming', location: { lat: 22.5410, lng: 114.0590, coordType: 'gcj02' } },
  { label: '杭州', detail: '暂未覆盖，可登记需求', cityCode: 'hangzhou', areaCode: null, status: 'unsupported', location: { lat: 30.2741, lng: 120.1551, coordType: 'wgs84' } }
];

export function getCuisine(code) {
  return cuisineCategories.find(category => category.code === code)
    || cuisineCategories.find(category => category.code === 'other');
}

export function getCity(code) {
  return cities.find(city => city.code === code);
}

export function getCoverageArea(cityCode, areaCode) {
  return getCity(cityCode)?.areas.find(area => area.code === areaCode);
}
