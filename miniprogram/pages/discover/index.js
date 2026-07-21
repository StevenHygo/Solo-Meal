const dataService = require('../../services/data-service');

Page({
  data: {
    locationLabel: '选择你要去吃的地方',
    locationReady: false,
    searchText: '',
    currentScene: 'now',
    scenes: [
      { key: 'now', label: '现在吃', icon: '◷' },
      { key: 'quick', label: '快速解决', icon: '↯' },
      { key: 'quiet', label: '安静坐坐', icon: '○' },
      { key: 'budget', label: '预算友好', icon: '¥' }
    ],
    featured: [],
    favoriteIds: []
  },

  onShow() {
    this.setData({
      featured: dataService.searchRestaurants({ onlySolo: true, openNow: true }).slice(0, 3),
      favoriteIds: dataService.getFavorites()
    });
  },

  onSceneTap(event) {
    const scene = event.currentTarget.dataset.scene;
    this.setData({ currentScene: scene });
    if (scene === 'quick') {
      wx.navigateTo({ url: '/pages/results/index?scene=quick' });
    } else if (scene === 'budget') {
      wx.navigateTo({ url: '/pages/results/index?scene=budget' });
    } else if (scene === 'quiet') {
      wx.navigateTo({ url: '/pages/results/index?scene=quiet' });
    } else {
      wx.navigateTo({ url: '/pages/results/index?scene=now' });
    }
  },

  onSearchInput(event) {
    this.setData({ searchText: event.detail.value });
  },

  submitSearch() {
    wx.navigateTo({
      url: `/pages/results/index?q=${encodeURIComponent(this.data.searchText.trim())}`
    });
  },

  onSearchFocus() {
    if (!this.data.searchText) {
      this.setData({ searchText: '' });
    }
  },

  useCurrentLocation() {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: false,
      success: () => {
        this.setData({ locationLabel: '当前位置 · 静安寺', locationReady: true });
        wx.showToast({ title: '已使用当前位置', icon: 'none' });
      },
      fail: () => {
        wx.showModal({
          title: '需要位置权限',
          content: '你也可以直接搜索商圈、地铁站或地址。',
          confirmText: '去搜索',
          cancelText: '稍后',
          success: result => {
            if (result.confirm) this.openLocationSearch();
          }
        });
      }
    });
  },

  openLocationSearch() {
    wx.navigateTo({ url: '/pages/results/index?chooseLocation=1' });
  },

  openFeatured(event) {
    wx.navigateTo({ url: `/pages/detail/index?id=${event.currentTarget.dataset.id}` });
  },

  openFavorites() {
    wx.switchTab({ url: '/pages/favorites/index' });
  }
});
