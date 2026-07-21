const restaurants = require('../data/restaurants');

const FAVORITE_KEY = 'solo_meal_favorites';
const PREFERENCES_KEY = 'solo_meal_preferences';
const REPORTS_KEY = 'solo_meal_reports';

function getRestaurants() {
  return restaurants.map(item => ({ ...item }));
}

function getById(id) {
  return restaurants.find(item => item.id === id) || null;
}

function getFavorites() {
  return wx.getStorageSync(FAVORITE_KEY) || [];
}

function isFavorite(id) {
  return getFavorites().indexOf(id) !== -1;
}

function toggleFavorite(id) {
  const favorites = getFavorites();
  const index = favorites.indexOf(id);
  if (index === -1) favorites.push(id);
  else favorites.splice(index, 1);
  wx.setStorageSync(FAVORITE_KEY, favorites);
  return index === -1;
}

function getPreference(key, fallback) {
  const preferences = wx.getStorageSync(PREFERENCES_KEY) || {};
  return preferences[key] === undefined ? fallback : preferences[key];
}

function setPreference(key, value) {
  const preferences = wx.getStorageSync(PREFERENCES_KEY) || {};
  preferences[key] = value;
  wx.setStorageSync(PREFERENCES_KEY, preferences);
}

function search(options = {}) {
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const budget = options.budget === undefined || options.budget === '' ? null : Number(options.budget);
  const cuisine = options.cuisine || 'all';
  const onlySolo = options.onlySolo !== false;
  const openNow = options.openNow === true;
  const fastMeal = options.fastMeal === true;
  const maxDistance = options.maxDistance ? Number(options.maxDistance) : null;

  let result = restaurants.filter(item => {
    if (keyword && ![item.name, item.cuisine, item.district, item.address].join(' ').toLowerCase().includes(keyword)) return false;
    if (budget && item.priceMin > budget) return false;
    if (cuisine !== 'all' && item.cuisineCode !== cuisine) return false;
    if (onlySolo && !item.acceptsSolo) return false;
    if (openNow && !item.openNow) return false;
    if (fastMeal && item.mealMinutes[1] > 40) return false;
    if (maxDistance && item.distance > maxDistance) return false;
    return true;
  });

  result = result.sort((a, b) => {
    const scoreA = a.soloScore - a.distance / 250;
    const scoreB = b.soloScore - b.distance / 250;
    return scoreB - scoreA;
  });
  return result.map(item => ({ ...item, favorite: isFavorite(item.id) }));
}

function saveReport(report) {
  const reports = wx.getStorageSync(REPORTS_KEY) || [];
  reports.push({ ...report, createdAt: new Date().toISOString() });
  wx.setStorageSync(REPORTS_KEY, reports.slice(-30));
}

function clearLocalData() {
  wx.removeStorageSync(FAVORITE_KEY);
  wx.removeStorageSync(PREFERENCES_KEY);
  wx.removeStorageSync(REPORTS_KEY);
}

module.exports = {
  getRestaurants,
  getById,
  getFavorites,
  isFavorite,
  toggleFavorite,
  getPreference,
  setPreference,
  search,
  saveReport,
  clearLocalData
};
