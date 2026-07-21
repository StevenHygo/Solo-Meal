import type { RestaurantFixture } from '../domain/types.js';

const daily = (...intervals: RestaurantFixture['weeklyHours']): RestaurantFixture['weeklyHours'] => intervals;

export const v0Restaurants: RestaurantFixture[] = [
  {
    id: '10000000-0000-4000-8000-000000000001', legacyId: 'r001', cityCode: 'shanghai', coverageAreaId: 'sh-jingan-huangpu',
    name: '杉木面所', address: '华山路 388 号 B1 层', district: '静安寺', sourceCoordType: 'gcj02', sourceLocation: { lat: 31.2231, lng: 121.4452 },
    cuisineCodes: ['noodles'], primaryCuisineCode: 'noodles', priceMinFen: 3200, priceMaxFen: 4800, acceptsSolo: true,
    peakPolicy: '午餐高峰可直接入座，晚餐 18:30 后偶尔需要等位', seatTypes: ['吧台', '单人桌'], counterSeats: 10, soloPortion: true, minSpendFen: null,
    mealMinutes: [20, 35], noiseLevel: 2, soloScore: 92, confidence: 'high', lastVerifiedAt: '2026-07-14T04:00:00.000Z',
    reasonCodes: ['counter_seats', 'solo_noodles', 'quick_meal'], weeklyHours: daily({ opensAt: '10:30', closesAt: '21:30' }),
    dishes: ['葱油拌面', '番茄牛腩面', '鸡丝冷面'], note: '适合一个人快速吃一顿，吧台正对开放厨房。',
    evidence: [
      { attribute: 'seating', title: '座位', value: '10 个吧台位 + 4 张双人桌', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-07-14T04:00:00.000Z', expiresAt: '2026-10-12T04:00:00.000Z' },
      { attribute: 'ordering', title: '点餐', value: '面类均可单点，无最低消费', sourceType: 'operator_call', sourceLabel: '运营电话核验', observedAt: '2026-07-14T04:00:00.000Z', expiresAt: '2026-10-12T04:00:00.000Z' },
      { attribute: 'meal_speed', title: '速度', value: '工作日午餐出餐约 12-18 分钟', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-07-14T04:00:00.000Z', expiresAt: '2026-10-12T04:00:00.000Z' }
    ]
  },
  {
    id: '10000000-0000-4000-8000-000000000002', legacyId: 'r002', cityCode: 'shanghai', coverageAreaId: 'sh-jingan-huangpu',
    name: '米仓食堂', address: '愚园路 116 号', district: '静安寺', sourceCoordType: 'gcj02', sourceLocation: { lat: 31.2257, lng: 121.4398 },
    cuisineCodes: ['japanese'], primaryCuisineCode: 'japanese', priceMinFen: 4500, priceMaxFen: 6800, acceptsSolo: true,
    peakPolicy: '晚餐高峰建议避开 18:30 - 19:30', seatTypes: ['吧台', '普通桌'], counterSeats: 6, soloPortion: true, minSpendFen: null,
    mealMinutes: [30, 45], noiseLevel: 2, soloScore: 88, confidence: 'high', lastVerifiedAt: '2026-07-09T04:00:00.000Z',
    reasonCodes: ['counter_seats', 'solo_set', 'quiet'], weeklyHours: daily({ opensAt: '11:00', closesAt: '14:00' }, { opensAt: '17:00', closesAt: '21:00' }),
    dishes: ['照烧鸡腿定食', '盐烤鲭鱼定食', '咖喱猪排饭'], note: '定食分量稳定，适合不想花时间研究菜单的时候。',
    evidence: [
      { attribute: 'seating', title: '座位', value: '吧台 6 席，桌间距适中', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-07-09T04:00:00.000Z', expiresAt: '2026-10-07T04:00:00.000Z' },
      { attribute: 'ordering', title: '点餐', value: '定食均为单人份，无最低消费', sourceType: 'menu_review', sourceLabel: '运营菜单核验', observedAt: '2026-07-09T04:00:00.000Z', expiresAt: '2026-10-07T04:00:00.000Z' },
      { attribute: 'noise', title: '氛围', value: '工作日午后安静，适合独自用餐', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-07-09T04:00:00.000Z', expiresAt: '2026-10-07T04:00:00.000Z' }
    ]
  },
  {
    id: '10000000-0000-4000-8000-000000000003', legacyId: 'r003', cityCode: 'shanghai', coverageAreaId: 'sh-jingan-huangpu',
    name: '南风小馆', address: '常德路 702 号', district: '静安寺', sourceCoordType: 'gcj02', sourceLocation: { lat: 31.2274, lng: 121.4511 },
    cuisineCodes: ['local_chinese'], primaryCuisineCode: 'local_chinese', priceMinFen: 5500, priceMaxFen: 8500, acceptsSolo: true,
    peakPolicy: '全天接受单人，周末晚餐可能等位', seatTypes: ['普通桌', '靠墙位'], counterSeats: 0, soloPortion: false, minSpendFen: 5000,
    mealMinutes: [35, 55], noiseLevel: 3, soloScore: 76, confidence: 'medium', lastVerifiedAt: '2026-06-23T04:00:00.000Z',
    reasonCodes: ['accepts_solo', 'wall_seats', 'small_portions'], weeklyHours: daily({ opensAt: '11:00', closesAt: '22:00' }),
    dishes: ['葱油拌面', '红烧肉', '虾籽大乌参'], note: '想吃几道本帮菜又不想去商场正餐厅，可以优先看这里。',
    evidence: [
      { attribute: 'accepts_solo', title: '接待', value: '店员确认全天接待单人', sourceType: 'operator_call', sourceLabel: '运营电话核验', observedAt: '2026-06-23T04:00:00.000Z', expiresAt: '2026-09-21T04:00:00.000Z' },
      { attribute: 'ordering', title: '点餐', value: '部分热菜可做半份，最低消费约 50 元', sourceType: 'menu_review', sourceLabel: '运营菜单核验', observedAt: '2026-06-23T04:00:00.000Z', expiresAt: '2026-09-21T04:00:00.000Z' },
      { attribute: 'seating', title: '座位', value: '靠墙位 4 个，暂无独立吧台', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-06-23T04:00:00.000Z', expiresAt: '2026-09-21T04:00:00.000Z' }
    ]
  },
  {
    id: '10000000-0000-4000-8000-000000000004', legacyId: 'r004', cityCode: 'shanghai', coverageAreaId: 'sh-jingan-huangpu',
    name: '小满饭团', address: '乌鲁木齐中路 91 号', district: '静安寺', sourceCoordType: 'gcj02', sourceLocation: { lat: 31.2199, lng: 121.4518 },
    cuisineCodes: ['fast_food'], primaryCuisineCode: 'fast_food', priceMinFen: 1800, priceMaxFen: 3200, acceptsSolo: true,
    peakPolicy: '早餐和午餐高峰排队，外带更快', seatTypes: ['靠墙位', '外带'], counterSeats: 0, soloPortion: true, minSpendFen: null,
    mealMinutes: [10, 20], noiseLevel: 3, soloScore: 84, confidence: 'medium', lastVerifiedAt: '2026-07-03T04:00:00.000Z',
    reasonCodes: ['solo_set', 'budget_friendly', 'takeaway_fast'], weeklyHours: daily({ opensAt: '07:30', closesAt: '20:00' }),
    dishes: ['梅干菜饭团', '海苔肉松饭团', '豆浆'], note: '预算友好，但座位有限，适合快速解决或外带。',
    evidence: [
      { attribute: 'ordering', title: '点餐', value: '饭团、豆浆均可单点，适合一人', sourceType: 'menu_review', sourceLabel: '运营菜单核验', observedAt: '2026-07-03T04:00:00.000Z', expiresAt: '2026-10-01T04:00:00.000Z' },
      { attribute: 'meal_speed', title: '速度', value: '非高峰平均 10 分钟内取餐', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-07-03T04:00:00.000Z', expiresAt: '2026-10-01T04:00:00.000Z' },
      { attribute: 'seating', title: '座位', value: '店内座位少，推荐外带或错峰', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-07-03T04:00:00.000Z', expiresAt: '2026-10-01T04:00:00.000Z' }
    ]
  },
  {
    id: '10000000-0000-4000-8000-000000000005', legacyId: 'r005', cityCode: 'shanghai', coverageAreaId: 'sh-jingan-huangpu',
    name: '炭町一人烧', address: '陕西北路 430 号 2 楼', district: '静安寺', sourceCoordType: 'gcj02', sourceLocation: { lat: 31.2312, lng: 121.4475 },
    cuisineCodes: ['bbq'], primaryCuisineCode: 'bbq', priceMinFen: 9800, priceMaxFen: 16800, acceptsSolo: true,
    peakPolicy: '接受单人，周五晚建议提前电话确认', seatTypes: ['单人桌'], counterSeats: 12, soloPortion: true, minSpendFen: null,
    mealMinutes: [45, 70], noiseLevel: 4, soloScore: 81, confidence: 'medium', lastVerifiedAt: '2026-06-16T04:00:00.000Z',
    reasonCodes: ['single_grill', 'solo_set', 'dinner_only'], weeklyHours: daily({ opensAt: '17:00', closesAt: '23:00' }),
    dishes: ['一人牛五花套餐', '盐葱牛舌', '石锅拌饭'], note: '适合想认真吃一顿烧肉的人，价格和用餐时间都更高。',
    evidence: [
      { attribute: 'seating', title: '座位', value: '每桌独立炉位，适合一人用餐', sourceType: 'operator_visit', sourceLabel: '运营现场核验', observedAt: '2026-06-16T04:00:00.000Z', expiresAt: '2026-09-14T04:00:00.000Z' },
      { attribute: 'ordering', title: '点餐', value: '有单人套餐，肉类可追加', sourceType: 'menu_review', sourceLabel: '运营菜单核验', observedAt: '2026-06-16T04:00:00.000Z', expiresAt: '2026-09-14T04:00:00.000Z' },
      { attribute: 'hours', title: '营业', value: '目前仅开放晚餐时段', sourceType: 'operator_call', sourceLabel: '运营电话核验', observedAt: '2026-06-16T04:00:00.000Z', expiresAt: '2026-09-14T04:00:00.000Z' }
    ]
  },
  {
    id: '10000000-0000-4000-8000-000000000006', legacyId: 'r006', cityCode: 'shanghai', coverageAreaId: 'sh-jingan-huangpu',
    name: '禾下粥铺', address: '南京西路 1688 号 B2 层', district: '南京西路', sourceCoordType: 'gcj02', sourceLocation: { lat: 31.2298, lng: 121.4589 },
    cuisineCodes: ['congee'], primaryCuisineCode: 'congee', priceMinFen: 2600, priceMaxFen: 4200, acceptsSolo: true,
    peakPolicy: '商场餐饮高峰可能需要排队', seatTypes: ['普通桌', '靠墙位'], counterSeats: 4, soloPortion: true, minSpendFen: null,
    mealMinutes: [25, 40], noiseLevel: 3, soloScore: 79, confidence: 'low', lastVerifiedAt: '2026-05-21T04:00:00.000Z',
    reasonCodes: ['solo_set', 'transit_access', 'wall_seats'], weeklyHours: daily({ opensAt: '10:00', closesAt: '22:00' }),
    dishes: ['皮蛋瘦肉粥', '砂锅鸡丝粥', '卤味拼盘'], note: '基础信息较完整，但近期核验时间较久，建议到店前再次确认。',
    evidence: [
      { attribute: 'ordering', title: '点餐', value: '主食可单点，套餐分量适中', sourceType: 'menu_review', sourceLabel: '运营菜单核验', observedAt: '2026-05-21T04:00:00.000Z', expiresAt: '2026-08-19T04:00:00.000Z' },
      { attribute: 'location', title: '位置', value: '商场 B2 层，地铁出口步行约 6 分钟', sourceType: 'map_provider', sourceLabel: '地图 POI', observedAt: '2026-05-21T04:00:00.000Z', expiresAt: '2026-08-19T04:00:00.000Z' }
    ]
  }
];
