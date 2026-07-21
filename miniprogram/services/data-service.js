const mockRepository = require('../utils/repository');

// Pages depend on this facade instead of data files or a specific backend.
// A remote implementation can replace these methods without changing page code.
module.exports = {
  mode: 'mock',
  searchRestaurants: options => mockRepository.search(options),
  getRestaurant: id => mockRepository.getById(id),
  getAllRestaurants: () => mockRepository.getRestaurants(),
  getFavorites: () => mockRepository.getFavorites(),
  isFavorite: id => mockRepository.isFavorite(id),
  toggleFavorite: id => mockRepository.toggleFavorite(id),
  getPreference: (key, fallback) => mockRepository.getPreference(key, fallback),
  setPreference: (key, value) => mockRepository.setPreference(key, value),
  submitFeedbackReport: report => mockRepository.saveReport(report),
  clearLocalData: () => mockRepository.clearLocalData()
};
