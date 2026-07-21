const dataService = require('../../services/data-service');

const CUISINES = [
  { key: 'all', label: '全部品类' },
  { key: 'noodles', label: '面食' },
  { key: 'japanese', label: '日式简餐' },
  { key: 'local', label: '本帮菜' },
  { key: 'fast_food', label: '快餐小吃' },
  { key: 'bbq', label: '烧肉' },
  { key: 'rice', label: '粥饭' }
];

const BUDGETS = [
  { key: '', label: '不限预算' },
  { key: '30', label: '¥30 以内' },
  { key: '60', label: '¥60 以内' },
  { key: '100', label: '¥100 以内' }
];

Page({
  data: {
    queryText: '',
    locationLabel: '静安寺附近',
    sceneLabel: '现在吃',
    viewMode: 'list',
    filterOpen: false,
    onlySolo: true,
    openNow: false,
    fastMeal: false,
    selectedCuisine: 'all',
    selectedBudget: '',
    maxDistance: '',
    cuisines: CUISINES,
    budgets: BUDGETS,
    results: [],
    resultCount: 0,
    hasFilters: false,
    noResult: false,
    mapMarkers: []
  },

  onLoad(options) {
    const scene = options.scene || 'now';
    const sceneConfig = {
      now: { label: '现在吃', openNow: true },
      quick: { label: '快速解决', fastMeal: true },
      quiet: { label: '安静坐坐', cuisine: 'all' },
      budget: { label: '预算友好', budget: '30' }
    }[scene] || { label: '现在吃' };

    const initial = {
      queryText: options.q ? decodeURIComponent(options.q) : '',
      sceneLabel: sceneConfig.label,
      openNow: !!sceneConfig.openNow,
      fastMeal: !!sceneConfig.fastMeal,
      selectedBudget: sceneConfig.budget || dataService.getPreference('budget', ''),
      locationLabel: options.chooseLocation ? '静安寺附近' : '静安寺附近'
    };
    this.setData(initial, () => this.performSearch());
  },

  onPullDownRefresh() {
    this.performSearch();
    wx.stopPullDownRefresh();
  },

  onSearchInput(event) {
    this.setData({ queryText: event.detail.value });
  },

  submitSearch() {
    this.performSearch();
  },

  performSearch() {
    const options = {
      keyword: this.data.queryText,
      budget: this.data.selectedBudget,
      cuisine: this.data.selectedCuisine,
      onlySolo: this.data.onlySolo,
      openNow: this.data.openNow,
      fastMeal: this.data.fastMeal,
      maxDistance: this.data.maxDistance
    };
    const results = dataService.searchRestaurants(options).map((item, index) => ({
      ...item,
      mapLeft: 72 + ((index * 91) % 410),
      mapTop: 88 + ((index * 67) % 280)
    }));
    this.setData({
      results,
      resultCount: results.length,
      noResult: results.length === 0,
      hasFilters: !!(this.data.selectedBudget || this.data.selectedCuisine !== 'all' || this.data.openNow || this.data.fastMeal || this.data.maxDistance)
    });
  },

  toggleView() {
    this.setData({ viewMode: this.data.viewMode === 'list' ? 'map' : 'list' });
  },

  toggleFilter() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },

  chooseCuisine(event) {
    this.setData({ selectedCuisine: event.currentTarget.dataset.value }, () => this.performSearch());
  },

  chooseBudget(event) {
    this.setData({ selectedBudget: event.currentTarget.dataset.value }, () => this.performSearch());
  },

  toggleOpenNow() {
    this.setData({ openNow: !this.data.openNow }, () => this.performSearch());
  },

  toggleFastMeal() {
    this.setData({ fastMeal: !this.data.fastMeal }, () => this.performSearch());
  },

  toggleSolo() {
    this.setData({ onlySolo: !this.data.onlySolo }, () => this.performSearch());
  },

  chooseDistance(event) {
    this.setData({ maxDistance: event.currentTarget.dataset.value }, () => this.performSearch());
  },

  clearFilters() {
    this.setData({ selectedCuisine: 'all', selectedBudget: '', openNow: false, fastMeal: false, maxDistance: '', onlySolo: true }, () => this.performSearch());
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/index?id=${event.currentTarget.dataset.id}` });
  },

  useLocation() {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: false,
      success: () => {
        this.setData({ locationLabel: '当前位置附近' });
        wx.showToast({ title: '已更新位置', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '已保留手动位置', icon: 'none' })
    });
  },

  openReport() {
    wx.showToast({ title: '请在餐厅详情页纠错', icon: 'none' });
  },

  noop() {
  }
});
