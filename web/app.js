import {
  WEB_VERSION,
  cities,
  coverageStatus,
  cuisineCategories,
  getCity,
  getCoverageArea,
  getCuisine,
  locationSuggestions
} from './config.js';
import { restaurantRepository } from './services/restaurant-repository.js';

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
  { value: 'all', label: '全部品类', icon: getCuisine('other').icon },
  ...cuisineCategories.map(category => ({ value: category.code, label: category.label, icon: category.icon }))
];

const distanceOptions = [
  { value: '', label: '不限距离' },
  { value: '1000', label: '1 公里内' },
  { value: '2000', label: '2 公里内' }
];

const reportTypes = [
  { code: 'closed_or_moved', label: '店已关闭或搬迁' },
  { code: 'rejects_solo', label: '不接待单人' },
  { code: 'hours_incorrect', label: '营业时间错误' },
  { code: 'price_incorrect', label: '价格区间错误' },
  { code: 'seating_incorrect', label: '单人座位信息错误' },
  { code: 'branch_mismatch', label: '分店匹配错误' },
  { code: 'other', label: '其他' }
];

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
  locationLabel: '静安寺附近',
  cityCode: 'shanghai',
  coverageAreaCode: 'sh-jingan-huangpu',
  location: { lat: 31.2231, lng: 121.4452, coordType: 'gcj02' },
  dataSource: { source: 'static', snapshotVersion: 'v1-beta.1', cachedAt: null },
  searchSequence: 0,
  detailSequence: 0,
  favoritesSequence: 0,
  fallbackNotified: false
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

function createIdempotencyKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
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

function cuisineIconMarkup(code, extraClass = '') {
  const category = getCuisine(code);
  return `<span class="cuisine-icon ${extraClass}" style="--cuisine-icon:url('${category.icon}')" aria-hidden="true"></span>`;
}

function getCurrentCoverage() {
  const city = getCity(state.cityCode);
  const area = getCoverageArea(state.cityCode, state.coverageAreaCode);
  const status = area?.status || city?.status || 'unsupported';
  return { city, area, status, searchable: status === 'live' || status === 'beta' };
}

function formatCacheTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function renderCoverageState() {
  const { city, area, status } = getCurrentCoverage();
  const statusCopy = coverageStatus[status] || coverageStatus.unsupported;
  const areaName = area?.name || city?.name || '当前区域';
  const cityName = city?.name || '当前城市';
  const coverageText = status === 'live' ? `${areaName}已覆盖` : `${areaName} · ${statusCopy.description}`;

  el('coverageKicker').textContent = `${cityName} · ${statusCopy.label}`;
  el('coverageText').textContent = coverageText;
  el('resultsAreaTitle').textContent = `${areaName}的稳妥选择`;
  el('heroSignal').dataset.status = status;
  el('coverageStatus').textContent = statusCopy.label;
  el('coverageStatus').dataset.status = status;
  const baseMessage = status === 'beta'
    ? '当前为 Beta 覆盖，数据仍在持续补充；推荐来自已核验样本。'
    : statusCopy.description;
  const fallbackMessage = state.dataSource.source === 'fallback' ? ' API 暂不可用，已回退到随版本发布的快照。' : '';
  const cacheTime = formatCacheTime(state.dataSource.cachedAt);
  const cacheMessage = state.dataSource.source === 'cache'
    ? ` 当前显示${cacheTime ? ` ${cacheTime}` : ''}的上次成功结果。`
    : '';
  el('coverageMessage').textContent = `${baseMessage}${fallbackMessage}${cacheMessage}`;
  const degraded = state.dataSource.source === 'fallback' || state.dataSource.source === 'cache';
  el('coverageBanner').classList.toggle('hidden', status === 'live' && !degraded);

  const sourceLabels = { api: 'API 实时查询', static: '静态快照', fallback: '静态降级', cache: '上次结果' };
  el('dataSourceStatus').textContent = sourceLabels[state.dataSource.source] || '数据源未知';
}

function renderEmptyState() {
  const { status } = getCurrentCoverage();
  const copy = {
    live: ['还没有合适的结果', '可以清除搜索和筛选条件，仍然保留“一个人可吃”这个核心条件。', '查看全部餐厅'],
    beta: ['还没有合适的结果', '可以清除搜索和筛选条件，仍然保留“一个人可吃”这个核心条件。', '查看全部餐厅'],
    upcoming: ['这个区域正在补充', '餐厅仍在核验，达到开放门槛后才会显示单人友好推荐。', '更换位置'],
    paused: ['这个区域暂停更新', '暂不返回新增推荐；已经收藏的餐厅详情仍可在本机查看。', '更换位置'],
    unsupported: ['这里暂未覆盖', '当前没有经过核验的单人友好数据，可以切换到已开放区域。', '更换位置']
  }[status] || ['这里暂未覆盖', '请切换到已开放区域。', '更换位置'];

  el('emptyTitle').textContent = copy[0];
  el('emptyDescription').textContent = copy[1];
  el('relaxButton').textContent = copy[2];
}

async function searchRestaurants() {
  const sequence = ++state.searchSequence;
  const coverage = getCurrentCoverage();
  el('resultList').setAttribute('aria-busy', 'true');
  const response = await restaurantRepository.search({
    keyword: state.keyword,
    scene: state.scene,
    filters: { ...state.filters },
    cityCode: state.cityCode,
    coverageAreaCode: state.coverageAreaCode,
    coverageSearchable: coverage.searchable,
    location: { ...state.location }
  });
  if (sequence !== state.searchSequence) return;
  state.results = response.results;
  state.dataSource = {
    source: response.source,
    snapshotVersion: response.snapshotVersion,
    cachedAt: response.cachedAt
  };
  el('resultList').setAttribute('aria-busy', 'false');

  if (response.source === 'fallback' && !state.fallbackNotified) {
    state.fallbackNotified = true;
    showToast('API 暂不可用，已使用静态快照');
  }
  if (response.source === 'api') state.fallbackNotified = false;

  renderResults();
  renderMap();
  renderCoverageState();
  updateFilterSummary();
}

function renderResults() {
  const list = el('resultList');
  const empty = el('emptyState');
  const layout = document.querySelector('.results-layout');
  el('resultCount').textContent = state.results.length;
  renderEmptyState();

  if (!state.results.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    layout.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  layout.classList.remove('hidden');
  list.innerHTML = state.results.map(item => {
    const cuisine = getCuisine(item.cuisineCode);
    return `
    <article class="result-card" data-open-detail="${item.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(item.name)}">
      <div class="result-main">
        <div class="score-badge ${item.confidence}"><strong>${item.soloScore}</strong><small>适合度</small></div>
        <div class="result-info">
          <div class="result-title-row"><span class="result-title">${escapeHtml(item.name)}</span><span class="status-badge ${item.openNow ? '' : 'closed'}">${item.openNow ? '营业中' : '暂未营业'}</span></div>
          <div class="result-meta"><span class="cuisine-meta">${cuisineIconMarkup(item.cuisineCode)}${escapeHtml(cuisine.label)}</span><span aria-hidden="true">·</span><span>${item.distance}m</span><span aria-hidden="true">·</span><span>¥${item.priceMin}-${item.priceMax}</span></div>
          <div class="result-address">${escapeHtml(item.address)}</div>
        </div>
        <span class="result-chevron" aria-hidden="true">›</span>
      </div>
      <div class="result-reasons">${item.reasons.map(reason => `<span class="tag">${escapeHtml(reason)}</span>`).join('')}</div>
      <div class="result-foot"><span>✓ ${escapeHtml(item.verifiedAt)}核验 · ${escapeHtml(item.confidenceLabel)}</span><span>${item.mealMinutes[0]}-${item.mealMinutes[1]} 分钟</span></div>
    </article>
  `;
  }).join('');
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
  el(containerId).innerHTML = options.map(option => `<button class="option-button ${option.value === selected ? 'selected' : ''}" data-option-group="${dataKey}" data-value="${escapeHtml(option.value)}" type="button">${option.icon ? cuisineIconMarkup(option.value === 'all' ? 'other' : option.value) : ''}${escapeHtml(option.label)}</button>`).join('');
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

function renderDetail(item) {
  const id = item.id;
  const noiseText = ['未知', '很安静', '较安静', '一般', '较热闹', '很热闹'][item.noiseLevel] || '未知';
  const minimumSpendText = item.minSpend ? `最低约 ¥${item.minSpend}` : '无明确最低消费';
  const favorite = isFavorite(id);
  const cuisine = getCuisine(item.cuisineCode);

  el('detailPanel').innerHTML = `
    <div class="detail-cover">
      <button class="close-button detail-close" data-close="detailOverlay" type="button" aria-label="关闭">×</button>
      <div class="detail-cover-content"><p class="eyebrow">SOLO VERIFIED</p><h2 id="detailTitle">${escapeHtml(item.name)}</h2><p class="detail-cuisine">${cuisineIconMarkup(item.cuisineCode, 'detail-cuisine-icon')}${escapeHtml(cuisine.label)} · ${item.distance}m · ${escapeHtml(item.district)}</p></div>
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
}

async function openDetail(id) {
  const sequence = ++state.detailSequence;
  closeOverlay('favoritesOverlay');
  state.selectedRestaurantId = id;
  el('detailPanel').innerHTML = `
    <div class="detail-loading" role="status">
      <button class="close-button detail-close" data-close="detailOverlay" type="button" aria-label="关闭">×</button>
      <span>正在读取餐厅信息…</span>
    </div>
  `;
  openOverlay('detailOverlay');

  const response = await restaurantRepository.getRestaurant(id);
  if (sequence !== state.detailSequence || state.selectedRestaurantId !== id) return;
  if (!response.restaurant) {
    el('detailPanel').innerHTML = `
      <div class="detail-loading detail-error" role="alert">
        <button class="close-button detail-close" data-close="detailOverlay" type="button" aria-label="关闭">×</button>
        <div><strong>暂时无法读取餐厅详情</strong><span>可以稍后重试，已有收藏不会受影响。</span><button class="secondary-button" data-open-detail="${escapeHtml(id)}" type="button">重新加载</button></div>
      </div>
    `;
    return;
  }
  renderDetail(response.restaurant);
}

async function renderFavorites() {
  const sequence = ++state.favoritesSequence;
  const favoriteIds = getFavoriteIds();
  const container = el('favoritesContent');
  container.className = 'favorites-content';
  if (!favoriteIds.length) {
    container.innerHTML = '<div class="empty-list"><strong>还没有收藏</strong>在餐厅详情中点击爱心，收藏会只保存在这台设备。</div>';
    return;
  }

  container.innerHTML = '<div class="favorites-loading" role="status">正在读取收藏…</div>';
  const favoriteItems = await Promise.all(favoriteIds.map(async id => {
    const cached = restaurantRepository.getCachedRestaurant(id);
    if (cached) return { id, item: cached };
    const response = await restaurantRepository.getRestaurant(id);
    return { id, item: response.restaurant };
  }));
  if (sequence !== state.favoritesSequence) return;

  container.innerHTML = favoriteItems.map(({ id, item }) => {
    if (!item) {
      return `<div class="favorite-row favorite-unavailable"><div><h3>餐厅信息暂不可用</h3><p>收藏编号 ${escapeHtml(id)}</p><button class="favorite-remove" data-remove-favorite="${escapeHtml(id)}" type="button">取消收藏</button></div></div>`;
    }
    const cuisine = getCuisine(item.cuisineCode);
    return `
    <div class="favorite-row"><div><h3><button class="text-button" data-open-detail="${item.id}" type="button">${escapeHtml(item.name)} ›</button></h3><p>${cuisineIconMarkup(item.cuisineCode)}${escapeHtml(cuisine.label)} · ${item.distance}m · ¥${item.priceMin}-${item.priceMax}</p><small>${escapeHtml(item.reasons?.[0] || '已收藏，详情待核验')}</small><button class="favorite-remove" data-remove-favorite="${item.id}" type="button">取消收藏</button></div><span class="favorite-score">${item.soloScore}</span></div>
  `;
  }).join('');
}

function openReport(id) {
  state.selectedRestaurantId = id;
  state.selectedReportType = '';
  el('reportNote').value = '';
  el('reportCounter').textContent = '0';
  el('reportDeliveryNote').textContent = restaurantRepository.mode() === 'api'
    ? '纠错会发送到一人食复核队列，不会直接修改页面。'
    : '当前为本机模式，纠错先保存在这台设备。';
  el('reportOptions').innerHTML = reportTypes.map(type => `<button class="report-option" data-report-type="${escapeHtml(type.code)}" type="button">${escapeHtml(type.label)}</button>`).join('');
  openOverlay('reportOverlay');
}

async function submitReport() {
  if (!state.selectedReportType) {
    showToast('请选择问题类型');
    return;
  }
  const button = el('submitReport');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '正在提交…';
  const note = el('reportNote').value.slice(0, 200);
  const reports = readStorage(STORAGE.reports, []);
  const type = reportTypes.find(item => item.code === state.selectedReportType);
  const report = {
    restaurantId: state.selectedRestaurantId,
    type: state.selectedReportType,
    typeLabel: type?.label || '其他',
    note,
    idempotencyKey: createIdempotencyKey(),
    createdAt: new Date().toISOString(),
    syncStatus: 'local'
  };
  try {
    const result = await restaurantRepository.submitFeedback({
      restaurantId: report.restaurantId,
      reportType: report.type,
      note: report.note,
      idempotencyKey: report.idempotencyKey
    });
    report.syncStatus = result.submitted ? 'submitted' : (restaurantRepository.mode() === 'api' ? 'pending' : 'local');
    if (result.report) report.serverReportId = result.report.id;
    reports.push(report);
    writeStorage(STORAGE.reports, reports.slice(-30));
    closeOverlay('reportOverlay');
    renderReportSyncStatus();
    if (result.submitted) showToast('已进入复核队列');
    else if (restaurantRepository.mode() === 'api') showToast('服务暂不可用，已保存在本机');
    else showToast('已保存在本机');
  } finally {
    button.disabled = false;
    button.textContent = '提交复核';
  }
}

function renderReportSyncStatus() {
  const pending = readStorage(STORAGE.reports, []).filter(report => report.syncStatus === 'pending' && report.idempotencyKey);
  const button = el('syncReportsButton');
  button.classList.toggle('hidden', pending.length === 0);
  el('syncReportsStatus').textContent = pending.length ? `${pending.length} 条保存在本机` : '没有待同步记录';
}

async function syncPendingReports() {
  if (restaurantRepository.mode() !== 'api') {
    showToast('当前未连接服务端');
    return;
  }
  const reports = readStorage(STORAGE.reports, []);
  const pending = reports.filter(report => report.syncStatus === 'pending' && report.idempotencyKey);
  if (!pending.length) return renderReportSyncStatus();
  const button = el('syncReportsButton');
  button.disabled = true;
  let synced = 0;
  try {
    for (const report of pending) {
      const result = await restaurantRepository.submitFeedback({
        restaurantId: report.restaurantId,
        reportType: report.type,
        note: report.note,
        idempotencyKey: report.idempotencyKey
      });
      if (!result.submitted) continue;
      report.syncStatus = 'submitted';
      report.serverReportId = result.report?.id;
      synced += 1;
    }
    writeStorage(STORAGE.reports, reports);
    renderReportSyncStatus();
    showToast(synced ? `已同步 ${synced} 条纠错` : '暂时无法同步');
  } finally {
    button.disabled = false;
  }
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
  if (!getCurrentCoverage().searchable) {
    openLocationSelector();
    return;
  }
  state.keyword = '';
  el('searchInput').value = '';
  resetFilters();
}

function renderLocationSuggestions(query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = locationSuggestions.filter(suggestion => {
    if (!normalizedQuery) return true;
    const cityName = getCity(suggestion.cityCode)?.name || '';
    return `${suggestion.label} ${suggestion.detail} ${cityName}`.toLowerCase().includes(normalizedQuery);
  });

  el('locationResultHint').textContent = normalizedQuery ? `${matches.length} 个匹配位置` : '最近位置与试点区域';
  el('locationSuggestions').innerHTML = matches.length
    ? matches.map(suggestion => {
      const statusCopy = coverageStatus[suggestion.status] || coverageStatus.unsupported;
      return `<button class="location-row" data-select-location type="button" data-city-code="${escapeHtml(suggestion.cityCode)}" data-area-code="${escapeHtml(suggestion.areaCode || '')}" data-location-label="${escapeHtml(suggestion.label)}"><span><strong>${escapeHtml(suggestion.label)}</strong><small>${escapeHtml(suggestion.detail)}</small></span><span class="coverage-status" data-status="${escapeHtml(suggestion.status)}">${escapeHtml(statusCopy.label)}</span></button>`;
    }).join('')
    : '<div class="location-empty">没有匹配位置，可以从下方城市覆盖中选择。</div>';
}

function renderCityList() {
  el('cityList').innerHTML = cities.map(city => {
    const statusCopy = coverageStatus[city.status] || coverageStatus.unsupported;
    const areaText = city.areas.length ? city.areas.map(area => area.name).join('、') : '尚无开放区域';
    return `<button class="city-row ${city.code === state.cityCode ? 'selected' : ''}" data-select-city="${escapeHtml(city.code)}" type="button"><span><strong>${escapeHtml(city.name)}</strong><small>${escapeHtml(areaText)}</small></span><span class="coverage-status" data-status="${escapeHtml(city.status)}">${escapeHtml(statusCopy.label)}</span></button>`;
  }).join('');
}

function openLocationSelector() {
  el('locationSearch').value = '';
  renderLocationSuggestions();
  renderCityList();
  openOverlay('locationOverlay');
  requestAnimationFrame(() => el('locationSearch').focus());
}

function selectLocation(cityCode, areaCode, label, location = null) {
  const city = getCity(cityCode);
  state.cityCode = cityCode;
  state.coverageAreaCode = areaCode || '';
  state.locationLabel = label || city?.name || '当前位置';
  if (location) state.location = { ...location };
  else if (city?.locationCenterWgs84) state.location = { ...city.locationCenterWgs84, coordType: 'wgs84' };
  state.keyword = '';
  state.filters.maxDistance = '';
  el('locationLabel').textContent = state.locationLabel;
  el('searchInput').value = '';
  syncFilterControls();
  closeOverlay('locationOverlay');
  searchRestaurants();

  const { status } = getCurrentCoverage();
  if (status === 'beta') showToast('已切换到 Beta 覆盖区域');
  if (status === 'upcoming') showToast('该区域正在补充数据');
  if (status === 'paused') showToast('该区域目前暂停更新');
  if (status === 'unsupported') showToast('该城市暂未覆盖');
}

function distanceKm(from, to) {
  const radians = degrees => degrees * Math.PI / 180;
  const latDelta = radians(to.lat - from.lat);
  const lngDelta = radians(to.lng - from.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function requestLocation() {
  if (!navigator.geolocation) {
    showToast('当前浏览器不支持定位，可直接搜索地点');
    return;
  }
  el('locationLabel').textContent = '正在定位…';
  navigator.geolocation.getCurrentPosition(
    position => {
      const current = { lat: position.coords.latitude, lng: position.coords.longitude, coordType: 'wgs84' };
      const nearest = cities
        .filter(city => city.locationCenterWgs84)
        .map(city => ({ city, distance: distanceKm(current, city.locationCenterWgs84) }))
        .sort((a, b) => a.distance - b.distance)[0];

      if (nearest && nearest.distance <= 50) {
        const area = nearest.city.areas.find(candidate => candidate.status === 'live' || candidate.status === 'beta')
          || nearest.city.areas[0];
        selectLocation(nearest.city.code, area?.code || '', '当前位置附近', current);
        return;
      }

      state.cityCode = '';
      state.coverageAreaCode = '';
      state.location = current;
      state.locationLabel = '当前位置附近';
      el('locationLabel').textContent = state.locationLabel;
      closeOverlay('locationOverlay');
      searchRestaurants();
      showToast('当前位置暂未覆盖，可手动切换城市');
    },
    () => {
      el('locationLabel').textContent = state.locationLabel;
      showToast('未获得定位，已保留手动位置');
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
  );
}

function handleDocumentClick(event) {
  const close = event.target.closest('[data-close]');
  if (close) return closeOverlay(close.dataset.close);

  const location = event.target.closest('[data-select-location]');
  if (location) {
    const suggestion = locationSuggestions.find(item => item.cityCode === location.dataset.cityCode
      && (item.areaCode || '') === location.dataset.areaCode
      && item.label === location.dataset.locationLabel);
    selectLocation(location.dataset.cityCode, location.dataset.areaCode, location.dataset.locationLabel, suggestion?.location);
    return;
  }

  const cityChoice = event.target.closest('[data-select-city]');
  if (cityChoice) {
    const city = getCity(cityChoice.dataset.selectCity);
    const area = city?.areas.find(candidate => candidate.status === 'live' || candidate.status === 'beta')
      || city?.areas[0];
    if (city) selectLocation(city.code, area?.code || '', city.name, city.locationCenterWgs84
      ? { ...city.locationCenterWgs84, coordType: 'wgs84' }
      : null);
    return;
  }

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
    const item = restaurantRepository.getCachedRestaurant(copy.dataset.copyAddress);
    if (!item) return showToast('餐厅信息暂不可用');
    if (!navigator.clipboard?.writeText) return showToast('当前浏览器不支持自动复制');
    navigator.clipboard.writeText(`${item.name} ${item.address}`).then(() => showToast('地址已复制')).catch(() => showToast('复制失败，请手动复制'));
    return;
  }

  const map = event.target.closest('[data-open-map]');
  if (map) {
    const item = restaurantRepository.getCachedRestaurant(map.dataset.openMap);
    if (!item || !Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) return showToast('餐厅坐标暂不可用');
    const coordinate = item.mapCoordType === 'wgs84' ? 'wgs84' : 'gaode';
    const url = `https://uri.amap.com/marker?position=${item.longitude},${item.latitude}&name=${encodeURIComponent(item.name)}&src=solo-meal&coordinate=${coordinate}&callnative=0`;
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
  el('aboutButton').addEventListener('click', () => { renderPreferenceOptions(); renderReportSyncStatus(); openOverlay('settingsOverlay'); });
  el('locationButton').addEventListener('click', openLocationSelector);
  el('manualLocation').addEventListener('click', openLocationSelector);
  el('changeCoverageButton').addEventListener('click', openLocationSelector);
  el('currentLocationButton').addEventListener('click', requestLocation);
  el('locationSearchForm').addEventListener('submit', event => event.preventDefault());
  el('locationSearch').addEventListener('input', event => renderLocationSuggestions(event.target.value));
  el('submitReport').addEventListener('click', submitReport);
  el('syncReportsButton').addEventListener('click', syncPendingReports);
  el('reportNote').addEventListener('input', event => { el('reportCounter').textContent = event.target.value.length; });
  el('privacyButton').addEventListener('click', () => showToast('位置只在点击后用于当前搜索，不保存轨迹'));
  el('clearDataButton').addEventListener('click', () => {
    if (!window.confirm('确认清除收藏、预算和纠错记录？')) return;
    Object.values(STORAGE).forEach(key => localStorage.removeItem(key));
    renderPreferenceOptions();
    renderReportSyncStatus();
    searchRestaurants();
    showToast('本机数据已清除');
  });

  document.querySelector('.mobile-nav').addEventListener('click', event => {
    const item = event.target.closest('[data-nav]');
    if (!item) return;
    document.querySelectorAll('.mobile-nav-item').forEach(button => button.classList.toggle('active', button === item));
    if (item.dataset.nav === 'discover') window.scrollTo({ top: 0, behavior: 'smooth' });
    if (item.dataset.nav === 'favorites') { renderFavorites(); openOverlay('favoritesOverlay'); }
    if (item.dataset.nav === 'settings') { renderPreferenceOptions(); renderReportSyncStatus(); openOverlay('settingsOverlay'); }
  });

  document.querySelectorAll('.overlay').forEach(overlay => overlay.addEventListener('click', event => {
    if (event.target === overlay) closeOverlay(overlay.id);
  }));
}

function initialize() {
  document.documentElement.dataset.version = WEB_VERSION;
  renderOptionGroup('budgetOptions', budgetOptions, state.filters.budget, 'budget');
  renderOptionGroup('cuisineOptions', cuisineOptions, state.filters.cuisine, 'cuisine');
  renderOptionGroup('distanceOptions', distanceOptions, state.filters.maxDistance, 'maxDistance');
  renderPreferenceOptions();
  bindEvents();
  searchRestaurants();
}

initialize();
