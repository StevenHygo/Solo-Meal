export const restaurants = [
  {
    id: 'r001', name: '杉木面所', cuisine: '面食', cuisineCode: 'noodles', district: '静安寺',
    address: '华山路 388 号 B1 层', distance: 420, priceMin: 32, priceMax: 48,
    latitude: 31.2231, longitude: 121.4452, openNow: true, hours: '10:30 - 21:30',
    acceptsSolo: true, peakPolicy: '午餐高峰可直接入座，晚餐 18:30 后偶尔需要等位',
    seatTypes: ['吧台', '单人桌'], counterSeats: 10, soloPortion: true, minSpend: null,
    mealMinutes: [20, 35], noiseLevel: 2, soloScore: 92, confidence: 'high', confidenceLabel: '高可信', verifiedAt: '7 天前',
    reasons: ['10 个吧台位', '支持单人面', '午餐通常 35 分钟内'],
    evidence: [
      { title: '座位', value: '10 个吧台位 + 4 张双人桌', source: '运营现场核验', time: '2026-07-14' },
      { title: '点餐', value: '面类均可单点，无最低消费', source: '运营电话核验', time: '2026-07-14' },
      { title: '速度', value: '工作日午餐出餐约 12-18 分钟', source: '运营现场核验', time: '2026-07-14' }
    ],
    dishes: ['葱油拌面', '番茄牛腩面', '鸡丝冷面'], note: '适合一个人快速吃一顿，吧台正对开放厨房。'
  },
  {
    id: 'r002', name: '米仓食堂', cuisine: '日式简餐', cuisineCode: 'japanese', district: '静安寺',
    address: '愚园路 116 号', distance: 680, priceMin: 45, priceMax: 68,
    latitude: 31.2257, longitude: 121.4398, openNow: true, hours: '11:00 - 14:00 / 17:00 - 21:00',
    acceptsSolo: true, peakPolicy: '晚餐高峰建议避开 18:30 - 19:30',
    seatTypes: ['吧台', '普通桌'], counterSeats: 6, soloPortion: true, minSpend: null,
    mealMinutes: [30, 45], noiseLevel: 2, soloScore: 88, confidence: 'high', confidenceLabel: '高可信', verifiedAt: '12 天前',
    reasons: ['6 个吧台位', '定食一人份', '环境较安静'],
    evidence: [
      { title: '座位', value: '吧台 6 席，桌间距适中', source: '运营现场核验', time: '2026-07-09' },
      { title: '点餐', value: '定食均为单人份，无最低消费', source: '运营菜单核验', time: '2026-07-09' },
      { title: '氛围', value: '工作日午后安静，适合独自用餐', source: '运营现场核验', time: '2026-07-09' }
    ],
    dishes: ['照烧鸡腿定食', '盐烤鲭鱼定食', '咖喱猪排饭'], note: '定食分量稳定，适合不想花时间研究菜单的时候。'
  },
  {
    id: 'r003', name: '南风小馆', cuisine: '本帮菜', cuisineCode: 'local', district: '静安寺',
    address: '常德路 702 号', distance: 920, priceMin: 55, priceMax: 85,
    latitude: 31.2274, longitude: 121.4511, openNow: true, hours: '11:00 - 22:00',
    acceptsSolo: true, peakPolicy: '全天接受单人，周末晚餐可能等位',
    seatTypes: ['普通桌', '靠墙位'], counterSeats: 0, soloPortion: false, minSpend: 50,
    mealMinutes: [35, 55], noiseLevel: 3, soloScore: 76, confidence: 'medium', confidenceLabel: '中可信', verifiedAt: '28 天前',
    reasons: ['全天接待单人', '靠墙位较舒适', '可单点小份菜'],
    evidence: [
      { title: '接待', value: '店员确认全天接待单人', source: '运营电话核验', time: '2026-06-23' },
      { title: '点餐', value: '部分热菜可做半份，最低消费约 50 元', source: '运营菜单核验', time: '2026-06-23' },
      { title: '座位', value: '靠墙位 4 个，暂无独立吧台', source: '运营现场核验', time: '2026-06-23' }
    ],
    dishes: ['葱油拌面', '红烧肉', '虾籽大乌参'], note: '想吃几道本帮菜又不想去商场正餐厅，可以优先看这里。'
  },
  {
    id: 'r004', name: '小满饭团', cuisine: '快餐小吃', cuisineCode: 'fast_food', district: '静安寺',
    address: '乌鲁木齐中路 91 号', distance: 1150, priceMin: 18, priceMax: 32,
    latitude: 31.2199, longitude: 121.4518, openNow: true, hours: '07:30 - 20:00',
    acceptsSolo: true, peakPolicy: '早餐和午餐高峰排队，外带更快',
    seatTypes: ['靠墙位', '外带'], counterSeats: 0, soloPortion: true, minSpend: null,
    mealMinutes: [10, 20], noiseLevel: 3, soloScore: 84, confidence: 'medium', confidenceLabel: '中可信', verifiedAt: '18 天前',
    reasons: ['单人饭团套餐', '人均 30 元内', '外带速度快'],
    evidence: [
      { title: '点餐', value: '饭团、豆浆均可单点，适合一人', source: '运营菜单核验', time: '2026-07-03' },
      { title: '速度', value: '非高峰平均 10 分钟内取餐', source: '运营现场核验', time: '2026-07-03' },
      { title: '座位', value: '店内座位少，推荐外带或错峰', source: '运营现场核验', time: '2026-07-03' }
    ],
    dishes: ['梅干菜饭团', '海苔肉松饭团', '豆浆'], note: '预算友好，但座位有限，适合快速解决或外带。'
  },
  {
    id: 'r005', name: '炭町一人烧', cuisine: '烧肉', cuisineCode: 'bbq', district: '静安寺',
    address: '陕西北路 430 号 2 楼', distance: 1380, priceMin: 98, priceMax: 168,
    latitude: 31.2312, longitude: 121.4475, openNow: false, hours: '17:00 - 23:00',
    acceptsSolo: true, peakPolicy: '接受单人，周五晚建议提前电话确认',
    seatTypes: ['单人桌'], counterSeats: 12, soloPortion: true, minSpend: null,
    mealMinutes: [45, 70], noiseLevel: 4, soloScore: 81, confidence: 'medium', confidenceLabel: '中可信', verifiedAt: '35 天前',
    reasons: ['12 个单人炉位', '单人套餐清晰', '晚餐营业'],
    evidence: [
      { title: '座位', value: '每桌独立炉位，适合一人用餐', source: '运营现场核验', time: '2026-06-16' },
      { title: '点餐', value: '有单人套餐，肉类可追加', source: '运营菜单核验', time: '2026-06-16' },
      { title: '营业', value: '目前仅开放晚餐时段', source: '运营电话核验', time: '2026-06-16' }
    ],
    dishes: ['一人牛五花套餐', '盐葱牛舌', '石锅拌饭'], note: '适合想认真吃一顿烧肉的人，价格和用餐时间都更高。'
  },
  {
    id: 'r006', name: '禾下粥铺', cuisine: '粥饭', cuisineCode: 'rice', district: '南京西路',
    address: '南京西路 1688 号 B2 层', distance: 1740, priceMin: 26, priceMax: 42,
    latitude: 31.2298, longitude: 121.4589, openNow: true, hours: '10:00 - 22:00',
    acceptsSolo: true, peakPolicy: '商场餐饮高峰可能需要排队',
    seatTypes: ['普通桌', '靠墙位'], counterSeats: 4, soloPortion: true, minSpend: null,
    mealMinutes: [25, 40], noiseLevel: 3, soloScore: 79, confidence: 'low', confidenceLabel: '待补充', verifiedAt: '61 天前',
    reasons: ['单人粥饭套餐', '商场内易到达', '有少量靠墙位'],
    evidence: [
      { title: '点餐', value: '主食可单点，套餐分量适中', source: '运营菜单核验', time: '2026-05-21' },
      { title: '位置', value: '商场 B2 层，地铁出口步行约 6 分钟', source: '地图 POI', time: '2026-05-21' }
    ],
    dishes: ['皮蛋瘦肉粥', '砂锅鸡丝粥', '卤味拼盘'], note: '基础信息较完整，但近期核验时间较久，建议到店前再次确认。'
  }
];
