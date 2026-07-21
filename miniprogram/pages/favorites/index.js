const dataService = require('../../services/data-service');

Page({
  data: {
    favorites: [],
    count: 0,
    subtitle: '还没有收藏'
  },

  onShow() {
    this.loadFavorites();
  },

  loadFavorites() {
    const ids = dataService.getFavorites();
    const items = ids.map(id => dataService.getRestaurant(id)).filter(Boolean).sort((a, b) => a.distance - b.distance);
    this.setData({
      favorites: items,
      count: items.length,
      subtitle: items.length ? `${items.length} 家，按距离排列` : '还没有收藏'
    });
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/index?id=${event.currentTarget.dataset.id}` });
  },

  removeFavorite(event) {
    const id = event.currentTarget.dataset.id;
    if (dataService.isFavorite(id)) dataService.toggleFavorite(id);
    this.loadFavorites();
    wx.showToast({ title: '已取消收藏', icon: 'none' });
  },

  goDiscover() {
    wx.switchTab({ url: '/pages/discover/index' });
  }
});
