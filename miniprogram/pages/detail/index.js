const dataService = require('../../services/data-service');

Page({
  data: {
    restaurant: null,
    favorite: false,
    reportOpen: false,
    selectedReport: '',
    reportNote: '',
    reportTypes: [
      '店已关闭或搬迁',
      '不接待单人',
      '营业时间错误',
      '价格区间错误',
      '单人座位信息错误',
      '分店匹配错误',
      '其他'
    ],
    noiseText: '',
    seatText: '',
    minimumSpendText: ''
  },

  onLoad(options) {
    const restaurant = dataService.getRestaurant(options.id);
    if (!restaurant) {
      wx.showToast({ title: '餐厅信息不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({
      restaurant,
      favorite: dataService.isFavorite(restaurant.id),
      noiseText: ['未知', '很安静', '较安静', '一般', '较热闹', '很热闹'][restaurant.noiseLevel] || '未知',
      seatText: restaurant.seatTypes.join('、'),
      minimumSpendText: restaurant.minSpend ? `最低约 ¥${restaurant.minSpend}` : '无明确最低消费'
    });
  },

  toggleFavorite() {
    const favorite = dataService.toggleFavorite(this.data.restaurant.id);
    this.setData({ favorite });
    wx.showToast({ title: favorite ? '已收藏' : '已取消收藏', icon: 'none' });
  },

  copyAddress() {
    wx.setClipboardData({
      data: `${this.data.restaurant.name} ${this.data.restaurant.address}`,
      success: () => wx.showToast({ title: '地址已复制', icon: 'none' })
    });
  },

  openLocation() {
    const item = this.data.restaurant;
    wx.openLocation({
      latitude: item.latitude,
      longitude: item.longitude,
      name: item.name,
      address: item.address,
      scale: 16,
      fail: () => wx.showToast({ title: '当前环境无法打开地图', icon: 'none' })
    });
  },

  openReport() {
    this.setData({ reportOpen: true, selectedReport: '', reportNote: '' });
  },

  closeReport() {
    this.setData({ reportOpen: false });
  },

  chooseReport(event) {
    this.setData({ selectedReport: event.currentTarget.dataset.value });
  },

  onReportNote(event) {
    this.setData({ reportNote: event.detail.value.slice(0, 200) });
  },

  submitReport() {
    if (!this.data.selectedReport) {
      wx.showToast({ title: '请选择问题类型', icon: 'none' });
      return;
    }
    dataService.submitFeedbackReport({
      restaurantId: this.data.restaurant.id,
      type: this.data.selectedReport,
      note: this.data.reportNote
    });
    this.setData({ reportOpen: false });
    wx.showToast({ title: '已提交，等待复核', icon: 'none' });
  },

  noop() {}
});
