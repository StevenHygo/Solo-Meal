App({
  globalData: {
    appName: '一人食',
    dataMode: 'mock',
    apiBaseUrl: ''
  },
  onLaunch() {
    const saved = wx.getStorageSync('solo_meal_preferences') || {};
    this.globalData.preferences = saved;
  }
});
