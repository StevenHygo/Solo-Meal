import { restaurants } from './data.js';

const STORAGE = {
  favorites: 'solo-meal-web-favorites',
  reports: 'solo-meal-web-reports',
  preferences: 'solo-meal-web-preferences'
};

const budgetOptions = [
  { value: '', label: '不限预算' },
  { value: '30', label: '¥30 以内' },
  { value: '60', label: '¥60 以内' },
  { value: '100', label: '¥100 以内' }
];

const cuisineOptions = [
  { value: 'all', label: '全部品类' },
  { value: 'noodles', label: '面食' },
  { value: 'japanese', label: '日式简餐' },
  { value: 'local', label: '本帮菜' },
  { value: 'fast_food', label: '快餐小吃' },
  { value: 'bbq', label: '烧肉' },
  { value: 'rice', label: '粥饭' }
];

const distanceOptions = [
  { value: '', label: '不限距离' },
  { value: '1000', label: '1 公里内' },
  { value: '2000', label: '2 公里内' }
];

const reportTypes = ['店已关闭或搬迁', '不接待单人', '营业时间错误', '价格区间错误', '单人座位信息错误', '分店匹配错误', '其他'];

const state = {
  keyword: '',
  scene: 'now',
  view: 'list',
  filters: {
    budget: loadPreferences().budget || '',
    cuisine: 'all',
    onlySolo: true,
    openNow: true,
    fastMeal: false,
    maxDistance: ''
  },
  results: [],
  selectedRestaurantId: null,
  selectedReportType: '',
  locationLabel: '静安寺附近'
};

const el = id => document.getElementById(id);

function readStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadPreferences() {
  return readStorage(STORAGE.preferences, {});
}

function getFavoriteIds() {
  return readStorage(STORAGE.favorites, []);
}

function isFavorite(id) {
  return getFavoriteIds().includes(id);
}

function toggleFavorite(id) {
  const favorites = getFavoriteIds();
  const index = favorites.indexOf(id);
  if (index === -1) favorites.push(id);
  else favorites.splice(index, 1);
  writeStorage(STORAGE.favorites, favorites);
  return index === -1;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function searchRestaurants() {
  const keyword = state.keyword.trim().toLowerCase();
  const { budget, cuisine, onlySolo, openNow, fastMeal, maxDistance } = state.filters;
  const quietMode = state.scene === 'quiet';

  state.results = restaurants
    .filter(item => {
      const searchable = [item.name, item.cuisine, item.district, item.address].join(' ').toLowerCase();
      if (keyword && !searchable.includes(keyword)) return false;
      if (budget && item.priceMin > Number(budget)) return false;
      if (cuisine !== 'all' && item.cuisineCode !== cuisine) return false;
      if (onlySolo && !item.acceptsSolo) return false;
      if (openNow && !item.openNow) return false;
      if (fastMeal && item.mealMinutes[1] > 40) return false;
      if (maxDistance && item.distance > Number(maxDistance)) return false;
      return true;
    })
    .sort((a, b) => {
      const quietA = quietMode ? (5 - a.noiseLevel) * 3 : 0;
      const quietB = quietMode ? (5 - b.noiseLevel) * 3 : 0;
      const scoreA = a.soloScore - a.distance / 250 + quietA;
      const scoreB = b.soloScore - b.distance / 250 + quietB;
      return scoreB - scoreA;
    });

  renderResults();
  renderMap();
  updateFilterSummary();
}

function renderResults() {
  const list = el('resultList');
  const empty = el('emptyState');
  const layout = document.querySelector('.results-layout');
  el('resultCount').textContent = state.results.length;

  if (!state.results.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    layout.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  layout.classList.remove('hidden');
  list.innerHTML = state.results.map(item => `
    <article class="result-card" data-open-detail="${item.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(item.name)}">
      <div class="result-main">
        <div class="score-badge ${item.confidence}"><strong>${item.soloScore}</strong><small>适合度</small></div>
        <div class="result-info">
          <div class="result-title-row"><span class="result-title">${escapeHtml(item.name)}</span><span class="status-badge ${item.openNow ? '' : 'closed'}">${item.openNow ? '营业中' : '暂未营业'}</span></div>
          <div class="result-meta">${escapeHtml(item.cuisine)} · ${item.distance}m · ¥${item.priceMin}-${item.priceMax}</div>
          <div class="result-address">${escapeHtml(item.address)}</div>
        </div>
        <span class="result-chevron" aria-hidden="true">›</span>
      </div>
      <div class="result-reasons">${item.reasons.map(reason => `<span class="tag">${escapeHtml(reason)}</span>`).join('')}</div>
      <div class="result-foot"><span>✓ ${escapeHtml(item.verifiedAt)}核验 · ${escapeHtml(item.confidenceLabel)}</span><span>${item.mealMinutes[0]}-${item.mealMinutes[1]} 分钟</span></div>
    </article>
  `).join('');
}

function renderMap() {
  const positions = [[12, 18], [51, 12], [70, 41], [25, 57], [58, 72], [15, 78]];
  el('mapMarkers').innerHTML = state.results.map((item, index) => {
    const position = positions[index % positions.length];
    return `<button class="map-marker" style="left:${position[0]}%;top:${position[1]}%" data-open-detail="${item.id}" type="button" aria-label="${escapeHtml(item.name)}，适合度 ${item.soloScore}">${item.soloScore}</button>`;
  }).join('');
}

function updateFilterSummary() {
  const parts = [];
  const sceneLabels = { now: '现在吃', quick: '快速解决', quiet: '安静坐坐', budget: '预算友好' };
  parts.push(sceneLabels[state.scene]);
  if (state.filters.onlySolo) parts.push('一个人');
  if (state.filters.budget) parts.push(`¥${state.filters.budget} 内`);
  if (state.filters.cuisine !== 'all') parts.push(cuisineOptions.find(option => option.value === state.filters.cuisine)?.label || '指定品类');
  if (state.filters.maxDistance) parts.push(`${Number(state.filters.maxDistance) / 1000}km 内`);
  el('activeFilterSummary').textContent = parts.join(' · ');

  const hasFilters = state.filters.budget || state.filters.cuisine !== 'all' || state.filters.fastMeal || state.filters.maxDistance || !state.filters.onlySolo || !state.filters.openNow;
  el('filterIndicator').classList.toggle('hidden', !hasFilters);
  el('applyFilters').textContent = `查看 ${state.results.length} 家结果`;
}

function applyScene(scene) {
  state.scene = scene;
  state.filters.openNow = scene === 'now' || scene === 'quick';
  state.filters.fastMeal = scene === 'quick';
  state.filters.budget = scene === 'budget' ? '30' : (loadPreferences().budget || '');
  state.filters.cuisine = 'all';
  state.filters.onlySolo = true;
  state.filters.maxDistance = '';
  document.querySelectorAll('.scene-card').forEach(button => button.classList.toggle('active', button.dataset.scene === scene));
  syncFilterControls();
  searchRestaurants();
  document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderOptionGroup(containerId, options, selected, dataKey) {
  el(containerId).innerHTML = options.map(option => `<button class="option-button ${option.value === selected ? 'selected' : ''}" data-option-group="${dataKey}" data-value="${escapeHtml(option.value)}" type="button">${escapeHtml(option.label)}</button>`).join('');
}

function syncFilterControls() {
  renderOptionGroup('budgetOptions', budgetOptions, state.filters.budget, 'budget');
  renderOptionGroup('cuisineOptions', cuisineOptions, state.filters.cuisine, 'cuisine');
  renderOptionGroup('distanceOptions', distanceOptions, state.filters.maxDistance, 'maxDistance');
  el('soloToggle').checked = state.filters.onlySolo;
  el('openToggle').checked = state.filters.openNow;
  el('fastToggle').checked = state.filters.fastMeal;
}

function renderPreferenceOptions() {
  const budget = loadPreferences().budget || '';
  el('preferenceOptions').innerHTML = budgetOptions.map(option => `<button class="option-button ${option.value === budget ? 'selected' : ''}" data-preference-budget="${option.value}" type="button">${escapeHtml(option.label)}</button>`).join('');
}

function openDetail(id) {
  const item = restaurants.find(restaurant => restaurant.id === id);
  if (!item) return;
  closeOverlay('favoritesOverlay');
  state.selectedRestaurantId = id;
  const noiseText = ['未知', '很安静', '较安静', '一般', '较热闹', '很热闹'][item.noiseLevel] || '未知';
  const minimumSpendText = item.minSpend ? `最低约 ¥${item.minSpend}` : '无明确最低消费';
  const favorite = isFavorite(id);

  el('detailPanel').innerHTML = `
    <div class="detail-cover">
      <button class="close-button detail-close" data-close="detailOverlay" type="button" aria-label="关闭">×</button>
      <div class="detail-cover-content"><p class="eyebrow">SOLO VERIFIED</p><h2 id="detailTitle">${escapeHtml(item.name)}</h2><p>${escapeHtml(item.cuisine)} · ${item.distance}m · ${escapeHtml(item.district)}</p></div>
    </div>
    <div class="detail-content">
      <div class="detail-summary">
        <div class="detail-score ${item.confidence}">${item.soloScore}</div>
        <div><strong>一个人来，比较稳妥</strong><small>${escapeHtml(item.confidenceLabel)} · ${escapeHtml(item.verifiedAt)}核验</small></div>
        <button class="detail-favorite ${favorite ? 'active' : ''}" data-toggle-favorite="${item.id}" type="button" aria-label="${favorite ? '取消收藏' : '收藏'}">${favorite ? '♥' : '♡'}</button>
      </div>
      <div class="detail-tags">${item.reasons.map(reason => `<span class="tag accent">${escapeHtml(reason)}</span>`).join('')}</div>
      <section class="detail-section"><h3>最重要的几件事</h3><div class="fact-grid">
        <div class="fact"><span>座位</span><strong>${escapeHtml(item.seatTypes.join('、'))}</strong><small>吧台 ${item.counterSeats} 席</small></div>
        <div class="fact"><span>点餐</span><strong>${item.soloPortion ? '有单人份' : '部分可小份'}</strong><small>${escapeHtml(minimumSpendText)}</small></div>
        <div class="fact"><span>时间</span><strong>${item.mealMinutes[0]}-${item.mealMinutes[1]} 分钟</strong><small>非实时排队数据</small></div>
        <div class="fact"><span>氛围</span><strong>${escapeHtml(noiseText)}</strong><small>运营现场观察</small></div>
      </div></section>
      <section class="detail-section"><h3>为什么这样判断</h3><div class="evidence-list">${item.evidence.map(evidence => `
        <div class="evidence-row"><span class="evidence-mark">✓</span><div><div class="evidence-heading"><span>${escapeHtml(evidence.title)}</span><small>${escapeHtml(evidence.time)}</small></div><div class="evidence-value">${escapeHtml(evidence.value)}</div><div class="evidence-source">来源：${escapeHtml(evidence.source)}</div></div></div>
      `).join('')}</div></section>
      <section class="detail-section"><h3>点什么</h3><div class="dish-list">${item.dishes.map(dish => `<span class="dish">${escapeHtml(dish)}</span>`).join('')}</div></section>
      <section class="detail-section"><h3>到店信息</h3><div class="detail-info">
        <div class="info-row"><span>营业</span><strong class="${item.openNow ? 'status-open' : ''}">${escapeHtml(item.hours)} · ${item.openNow ? '营业中' : '暂未营业'}</strong></div>
        <div class="info-row"><span>地址</span><strong>${escapeHtml(item.address)}</strong></div>
        <div class="info-row"><span>高峰</span><strong>${escapeHtml(item.peakPolicy)}</strong></div>
      </div><div class="detail-buttons"><button class="secondary-button" data-copy-address="${item.id}" type="button">复制地址</button><button class="primary-button" data-open-map="${item.id}" type="button">地图导航 →</button></div></section>
      <div class="operator-note">“${escapeHtml(item.note)}”</div>
      <button class="report-button" data-open-report="${item.id}" type="button">信息不准确？提交纠错</button>
    </div>
  `;
  openOverlay('detailOverlay');
}

function renderFavorites() {
  const favoriteItems = getFavoriteIds().map(id => restaurants.find(item => item.id === id)).filter(Boolean);
  const container = el('favoritesContent');
  container.className = 'favorites-content';
  if (!favoriteItems.length) {
    container.innerHTML = '<div class="empty-list"><strong>还没有收藏</strong>在餐厅详情中点击爱心，收藏会只保存在这台设备。</div>';
    return;
  }
  container.innerHTML = favoriteItems.map(item => `
    <div class="favorite-row"><div><h3><button class="text-button" data-open-detail="${item.id}" type="button">${escapeHtml(item.name)} ›</button></h3><p>${escapeHtml(item.cuisine)} · ${item.distance}m · ¥${item.priceMin}-${item.priceMax}</p><small>${escapeHtml(item.reasons[0])}</small><button class="favorite-remove" data-remove-favorite="${item.id}" type="button">取消收藏</button></div><span class="favorite-score">${item.soloScore}</span></div>
  `).join('');
}

function openReport(id) {
  state.selectedRestaurantId = id;
  state.selectedReportType = '';
  el('reportNote').value = '';
  el('reportCounter').textContent = '0';
  el('reportOptions').innerHTML = reportTypes.map(type => `<button class="report-option" data-report-type="${escapeHtml(type)}" type="button">${escapeHtml(type)}</button>`).join('');
  openOverlay('reportOverlay');
}

function submitReport() {
  if (!state.selectedReportType) {
    showToast('请选择问题类型');
    return;
  }
  const note = el('reportNote').value.slice(0, 200);
  const reports = readStorage(STORAGE.reports, []);
  reports.push({ restaurantId: state.selectedRestaurantId, type: state.selectedReportType, note, createdAt: new Date().toISOString() });
  writeStorage(STORAGE.reports, reports.slice(-30));
  closeOverlay('reportOverlay');
  showToast('已提交，等待复核');
}

function openOverlay(id) {
  el(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => el(id).querySelector('button, input, textarea')?.focus());
}

function closeOverlay(id) {
  el(id).classList.add('hidden');
  if (![...document.querySelectorAll('.overlay')].some(overlay => !overlay.classList.contains('hidden'))) document.body.style.overflow = '';
}

function showToast(message) {
  const toast = el('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 1800);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const layout = document.querySelector('.results-layout');
  const map = el('mapPanel');
  layout.classList.toggle('map-only', view === 'map');
  map.classList.toggle('mobile-visible', view === 'map');
}

function resetFilters() {
  state.filters = { budget: '', cuisine: 'all', onlySolo: true, openNow: true, fastMeal: false, maxDistance: '' };
  state.scene = 'now';
  document.querySelectorAll('.scene-card').forEach(button => button.classList.toggle('active', button.dataset.scene === 'now'));
  syncFilterControls();
  searchRestaurants();
}

function showAllRestaurants() {
  state.keyword = '';
  el('searchInput').value = '';
  resetFilters();
}

function requestLocation() {
  if (!navigator.geolocation) {
    showToast('当前浏览器不支持定位，可直接搜索地点');
    return;
  }
  el('locationLabel').textContent = '正在定位…';
  navigator.geolocation.getCurrentPosition(
    () => {
      state.locationLabel = '当前位置附近';
      el('locationLabel').textContent = state.locationLabel;
      showToast('已使用当前位置；v0 仍展示试点数据');
    },
    () => {
      state.locationLabel = '静安寺附近';
      el('locationLabel').textContent = state.locationLabel;
      showToast('未获得定位，已保留手动位置');
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
  );
}

function handleDocumentClick(event) {
  const close = event.target.closest('[data-close]');
  if (close) return closeOverlay(close.dataset.close);

  const detail = event.target.closest('[data-open-detail]');
  if (detail) return openDetail(detail.dataset.openDetail);

  const favorite = event.target.closest('[data-toggle-favorite]');
  if (favorite) {
    const added = toggleFavorite(favorite.dataset.toggleFavorite);
    openDetail(favorite.dataset.toggleFavorite);
    showToast(added ? '已收藏' : '已取消收藏');
    return;
  }

  const remove = event.target.closest('[data-remove-favorite]');
  if (remove) {
    if (isFavorite(remove.dataset.removeFavorite)) toggleFavorite(remove.dataset.removeFavorite);
    renderFavorites();
    showToast('已取消收藏');
    return;
  }

  const copy = event.target.closest('[data-copy-address]');
  if (copy) {
    const item = restaurants.find(restaurant => restaurant.id === copy.dataset.copyAddress);
    navigator.clipboard?.writeText(`${item.name} ${item.address}`).then(() => showToast('地址已复制')).catch(() => showToast('复制失败，请手动复制'));
    return;
  }

  const map = event.target.closest('[data-open-map]');
  if (map) {
    const item = restaurants.find(restaurant => restaurant.id === map.dataset.openMap);
    const url = `https://uri.amap.com/marker?position=${item.longitude},${item.latitude}&name=${encodeURIComponent(item.name)}&src=solo-meal&coordinate=gaode&callnative=0`;
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  const report = event.target.closest('[data-open-report]');
  if (report) return openReport(report.dataset.openReport);

  const reportType = event.target.closest('[data-report-type]');
  if (reportType) {
    state.selectedReportType = reportType.dataset.reportType;
    document.querySelectorAll('[data-report-type]').forEach(button => button.classList.toggle('selected', button.dataset.reportType === state.selectedReportType));
    return;
  }

  const option = event.target.closest('[data-option-group]');
  if (option) {
    state.filters[option.dataset.optionGroup] = option.dataset.value;
    syncFilterControls();
    searchRestaurants();
    return;
  }

  const preference = event.target.closest('[data-preference-budget]');
  if (preference) {
    writeStorage(STORAGE.preferences, { ...loadPreferences(), budget: preference.dataset.preferenceBudget });
    renderPreferenceOptions();
    showToast('默认预算已保存');
  }
}

function bindEvents() {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const openOverlays = [...document.querySelectorAll('.overlay:not(.hidden)')];
      if (openOverlays.length) closeOverlay(openOverlays.at(-1).id);
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.result-card')) openDetail(event.target.dataset.openDetail);
  });

  el('searchForm').addEventListener('submit', event => {
    event.preventDefault();
    state.keyword = el('searchInput').value;
    searchRestaurants();
    document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  el('sceneGrid').addEventListener('click', event => {
    const scene = event.target.closest('[data-scene]');
    if (scene) applyScene(scene.dataset.scene);
  });
  el('filterButton').addEventListener('click', () => { syncFilterControls(); openOverlay('filterOverlay'); });
  el('applyFilters').addEventListener('click', () => closeOverlay('filterOverlay'));
  el('resetFilters').addEventListener('click', resetFilters);
  el('relaxButton').addEventListener('click', showAllRestaurants);
  el('soloToggle').addEventListener('change', event => { state.filters.onlySolo = event.target.checked; searchRestaurants(); });
  el('openToggle').addEventListener('change', event => { state.filters.openNow = event.target.checked; searchRestaurants(); });
  el('fastToggle').addEventListener('change', event => { state.filters.fastMeal = event.target.checked; searchRestaurants(); });
  document.querySelector('.view-switch').addEventListener('click', event => { if (event.target.dataset.view) setView(event.target.dataset.view); });

  el('favoritesButton').addEventListener('click', () => { renderFavorites(); openOverlay('favoritesOverlay'); });
  el('aboutButton').addEventListener('click', () => { renderPreferenceOptions(); openOverlay('settingsOverlay'); });
  el('locationButton').addEventListener('click', requestLocation);
  el('manualLocation').addEventListener('click', requestLocation);
  el('submitReport').addEventListener('click', submitReport);
  el('reportNote').addEventListener('input', event => { el('reportCounter').textContent = event.target.value.length; });
  el('privacyButton').addEventListener('click', () => showToast('位置只在点击后用于当前搜索，不保存轨迹'));
  el('clearDataButton').addEventListener('click', () => {
    if (!window.confirm('确认清除收藏、预算和纠错记录？')) return;
    Object.values(STORAGE).forEach(key => localStorage.removeItem(key));
    renderPreferenceOptions();
    searchRestaurants();
    showToast('本机数据已清除');
  });

  document.querySelector('.mobile-nav').addEventListener('click', event => {
    const item = event.target.closest('[data-nav]');
    if (!item) return;
    document.querySelectorAll('.mobile-nav-item').forEach(button => button.classList.toggle('active', button === item));
    if (item.dataset.nav === 'discover') window.scrollTo({ top: 0, behavior: 'smooth' });
    if (item.dataset.nav === 'favorites') { renderFavorites(); openOverlay('favoritesOverlay'); }
    if (item.dataset.nav === 'settings') { renderPreferenceOptions(); openOverlay('settingsOverlay'); }
  });

  document.querySelectorAll('.overlay').forEach(overlay => overlay.addEventListener('click', event => {
    if (event.target === overlay) closeOverlay(overlay.id);
  }));
}

function initialize() {
  renderOptionGroup('budgetOptions', budgetOptions, state.filters.budget, 'budget');
  renderOptionGroup('cuisineOptions', cuisineOptions, state.filters.cuisine, 'cuisine');
  renderOptionGroup('distanceOptions', distanceOptions, state.filters.maxDistance, 'maxDistance');
  renderPreferenceOptions();
  bindEvents();
  searchRestaurants();
}

initialize();
