const dataService = require('../../services/data-service');

Page({
  data: {
    budget: '',
    budgets: [
      { key: '', label: '每次决定' },
      { key: '30', label: '¥30 以内' },
      { key: '60', label: '¥60 以内' },
      { key: '100', label: '¥100 以内' }
    ],
    favoriteCount: 0,
    reportCount: 0,
    version: 'v0.1.0'
  },

  onShow() {
    this.setData({
      budget: dataService.getPreference('budget', ''),
      favoriteCount: dataService.getFavorites().length,
      reportCount: (wx.getStorageSync('solo_meal_reports') || []).length
    });
  },

  chooseBudget(event) {
    const budget = event.currentTarget.dataset.value;
    dataService.setPreference('budget', budget);
    this.setData({ budget });
    wx.showToast({ title: '默认预算已保存', icon: 'none' });
  },

  clearData() {
    wx.showModal({
      title: '清除本机数据',
      content: '将删除收藏、偏好和已提交的纠错记录，且无法恢复。',
      confirmText: '确认清除',
      confirmColor: '#b75c40',
      success: result => {
        if (!result.confirm) return;
        dataService.clearLocalData();
        this.setData({ budget: '', favoriteCount: 0, reportCount: 0 });
        wx.showToast({ title: '本机数据已清除', icon: 'none' });
      }
    });
  },

  openPrivacy() {
    wx.showModal({
      title: '隐私说明',
      content: '位置仅在你主动点击后用于当前搜索。v0 不读取通讯录、好友关系、微信昵称或头像，也不申请后台持续定位。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  openAbout() {
    wx.showModal({
      title: '一人食 v0',
      content: '当前版本使用静安寺与南京西路的本地演示数据，不含社交、LLM、实时排队和第三方评价。',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
