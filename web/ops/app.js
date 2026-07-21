const reportLabels = {
  closed_or_moved: '店已关闭或搬迁',
  rejects_solo: '不接待单人',
  hours_incorrect: '营业时间错误',
  price_incorrect: '价格区间错误',
  seating_incorrect: '单人座位信息错误',
  branch_mismatch: '分店匹配错误',
  other: '其他'
};

const statusLabels = { open: '待处理', in_progress: '处理中', completed: '已完成', cancelled: '已驳回' };
const poiStatusLabels = { pending: '待去重', matched: '已匹配', new_branch: '新分店', rejected: '已驳回' };
const state = {
  apiBase: '', token: '', operator: '', mode: 'tasks', status: 'open', tasks: [], selectedTaskId: null,
  poiStatus: 'pending', poiCandidates: [], selectedPoiId: null, poiImportCandidates: [], busy: false
};
const el = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setConnection(status, label) {
  el('connectionState').dataset.state = status;
  el('connectionState').querySelector('span').textContent = label;
}

function showToast(message) {
  const toast = el('opsToast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2200);
}

async function request(path, init = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${state.token}`,
      'x-operator-id': state.operator,
      ...init.headers
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.error?.code || `HTTP ${response.status}`);
  return body;
}

function formatTime(value) {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function renderTasks() {
  el('taskCount').textContent = state.tasks.length;
  const list = el('taskList');
  if (!state.tasks.length) {
    list.innerHTML = '<div class="queue-empty">当前状态没有复核任务</div>';
    renderDetail();
    return;
  }
  list.innerHTML = state.tasks.map(task => `
    <button class="task-row ${task.id === state.selectedTaskId ? 'active' : ''}" data-task-id="${escapeHtml(task.id)}" type="button">
      <span class="task-priority">P${task.priority}</span>
      <span><strong>${escapeHtml(task.restaurant?.name || '未关联餐厅')}</strong><small>${escapeHtml(reportLabels[task.feedback?.report_type] || task.reason)}</small></span>
      <time>${escapeHtml(formatTime(task.created_at))}</time>
    </button>
  `).join('');
}

function currentTask() {
  return state.tasks.find(task => task.id === state.selectedTaskId) || null;
}

function currentPoiCandidate() {
  return state.poiCandidates.find(candidate => candidate.id === state.selectedPoiId) || null;
}

function renderActions(task) {
  const actions = el('reviewActions');
  if (task.status === 'open') {
    actions.innerHTML = '<button class="primary-button" data-task-action="start" type="button">开始处理</button>';
    return;
  }
  if (task.status === 'in_progress') {
    actions.innerHTML = '<button class="primary-button" data-task-action="complete" type="button">完成复核</button><button class="danger-button" data-task-action="reject" type="button">驳回纠错</button><button class="secondary-button" data-task-action="release" type="button">退回队列</button>';
    return;
  }
  actions.innerHTML = '';
}

function renderDetail() {
  const task = currentTask();
  el('detailEmpty').classList.toggle('hidden', Boolean(task));
  el('detailContent').classList.toggle('hidden', !task);
  if (!task) return;
  el('detailTitle').textContent = task.restaurant?.name || '未关联餐厅';
  el('priorityBadge').textContent = `P${task.priority}`;
  el('restaurantValue').textContent = task.restaurant?.legacy_id || task.restaurant?.id || '-';
  el('cityValue').textContent = task.city_code;
  el('statusValue').textContent = statusLabels[task.status] || task.status;
  el('dueValue').textContent = formatTime(task.due_at);
  el('reportTypeValue').textContent = reportLabels[task.feedback?.report_type] || task.reason;
  el('reportNoteValue').textContent = task.feedback?.note || '未填写补充说明';
  el('assigneeInput').value = task.assignee || state.operator;
  el('resolutionInput').value = task.resolution_note || '';
  el('resolutionCount').textContent = el('resolutionInput').value.length;
  const terminal = task.status === 'completed' || task.status === 'cancelled';
  el('reviewForm').classList.toggle('hidden', terminal);
  el('resolvedBlock').classList.toggle('hidden', !terminal);
  el('resolvedValue').textContent = task.resolution_note || '未填写处理说明';
  renderActions(task);
}

async function loadTasks({ preserveSelection = false } = {}) {
  if (!state.token || state.busy) return;
  state.busy = true;
  setConnection('idle', '正在读取');
  try {
    const response = await request(`/api/v1/admin/tasks?status=${encodeURIComponent(state.status)}&limit=100`);
    state.tasks = response.tasks;
    if (!preserveSelection || !state.tasks.some(task => task.id === state.selectedTaskId)) state.selectedTaskId = state.tasks[0]?.id || null;
    renderTasks();
    renderDetail();
    setConnection('ready', '已连接');
  } catch (error) {
    state.tasks = [];
    state.selectedTaskId = null;
    renderTasks();
    setConnection('error', '连接失败');
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

async function updateTask(action) {
  const task = currentTask();
  if (!task || state.busy) return;
  const resolution = el('resolutionInput').value.trim();
  const assignee = el('assigneeInput').value.trim() || state.operator;
  const payloads = {
    start: { status: 'in_progress', assignee },
    release: { status: 'open', assignee: null },
    complete: { status: 'completed', assignee, resolution_note: resolution, feedback_status: 'resolved' },
    reject: { status: 'cancelled', assignee, resolution_note: resolution, feedback_status: 'rejected' }
  };
  const payload = payloads[action];
  if (!payload) return;
  if ((action === 'complete' || action === 'reject') && !resolution) {
    showToast('请填写处理说明');
    el('resolutionInput').focus();
    return;
  }
  state.busy = true;
  try {
    await request(`/api/v1/admin/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    showToast(action === 'complete' ? '复核已完成' : action === 'reject' ? '纠错已驳回' : '任务状态已更新');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
  await loadTasks();
}

async function sweepEvidence() {
  if (!state.token || state.busy) return;
  if (!window.confirm('确认扫描并标记已过期证据？')) return;
  state.busy = true;
  try {
    const response = await request('/api/v1/admin/evidence/sweep', { method: 'POST', body: '{}' });
    const result = response.result;
    showToast(`已过期 ${result.expired_evidence} 条证据，新增 ${result.created_tasks} 条任务`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
  await loadTasks();
}

function renderPoiCandidates() {
  el('poiCount').textContent = state.poiCandidates.length;
  const list = el('poiList');
  if (!state.poiCandidates.length) {
    list.innerHTML = '<div class="queue-empty">当前状态没有 POI 候选</div>';
    renderPoiDetail();
    return;
  }
  list.innerHTML = state.poiCandidates.map(candidate => `
    <button class="task-row ${candidate.id === state.selectedPoiId ? 'active' : ''}" data-poi-id="${escapeHtml(candidate.id)}" type="button">
      <span class="candidate-source">${escapeHtml(candidate.provider.slice(0, 2).toUpperCase())}</span>
      <span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.district)} · ${escapeHtml(candidate.provider_poi_id)}</small></span>
      <time>${escapeHtml(formatTime(candidate.last_seen_at))}</time>
    </button>
  `).join('');
}

function renderPoiActions(candidate) {
  const actions = el('poiReviewActions');
  if (candidate.status === 'pending') {
    actions.innerHTML = '<button class="primary-button" data-poi-action="match_existing" type="button">匹配已有分店</button><button class="secondary-button" data-poi-action="new_branch" type="button">确认为新分店</button><button class="danger-button" data-poi-action="reject" type="button">驳回候选</button>';
  } else if (candidate.status === 'new_branch') {
    actions.innerHTML = '<button class="primary-button" data-poi-action="match_existing" type="button">改为匹配已有</button><button class="danger-button" data-poi-action="reject" type="button">驳回候选</button>';
  } else {
    actions.innerHTML = '';
  }
}

function renderPoiDetail() {
  const candidate = currentPoiCandidate();
  el('poiDetailEmpty').classList.toggle('hidden', Boolean(candidate));
  el('poiDetailContent').classList.toggle('hidden', !candidate);
  if (!candidate) return;
  el('poiDetailTitle').textContent = candidate.name;
  el('poiStatusBadge').textContent = poiStatusLabels[candidate.status] || candidate.status;
  el('poiProviderValue').textContent = `${candidate.provider} / ${candidate.provider_poi_id}`;
  el('poiCoverageValue').textContent = candidate.coverage_area.name;
  el('poiCategoryValue').textContent = candidate.raw_category || '未分类';
  el('poiObservedValue').textContent = formatTime(candidate.observed_at);
  el('poiNameValue').textContent = candidate.name;
  el('poiAddressValue').textContent = candidate.address;
  const source = candidate.location.source;
  el('poiLocationValue').textContent = `${source.coord_type.toUpperCase()} ${source.lat.toFixed(5)}, ${source.lng.toFixed(5)}`;
  const match = candidate.matched_restaurant || candidate.suggested_restaurant;
  el('poiSuggestionValue').textContent = match
    ? `${match.name} · ${match.legacy_id || match.id}`
    : '未发现相似分店';
  const score = candidate.suggested_restaurant?.score;
  el('poiSuggestionScore').textContent = score === null || score === undefined ? '-' : `建议置信 ${Math.round(score * 100)}%`;
  el('poiRestaurantInput').value = candidate.matched_restaurant?.legacy_id
    || candidate.matched_restaurant?.id
    || candidate.suggested_restaurant?.legacy_id
    || candidate.suggested_restaurant?.id
    || '';
  el('poiResolutionInput').value = candidate.resolution_note || '';
  el('poiResolutionCount').textContent = el('poiResolutionInput').value.length;
  const terminal = candidate.status === 'matched' || candidate.status === 'rejected';
  el('poiReviewForm').classList.toggle('hidden', terminal);
  el('poiResolvedBlock').classList.toggle('hidden', !terminal);
  el('poiResolvedValue').textContent = candidate.resolution_note || '未填写处理说明';
  renderPoiActions(candidate);
}

async function loadPoiCandidates({ preserveSelection = false } = {}) {
  if (!state.token || state.busy) return;
  state.busy = true;
  setConnection('idle', '正在读取');
  try {
    const response = await request(`/api/v1/admin/poi/candidates?status=${encodeURIComponent(state.poiStatus)}&limit=100`);
    state.poiCandidates = response.candidates;
    if (!preserveSelection || !state.poiCandidates.some(candidate => candidate.id === state.selectedPoiId)) {
      state.selectedPoiId = state.poiCandidates[0]?.id || null;
    }
    renderPoiCandidates();
    renderPoiDetail();
    setConnection('ready', '已连接');
  } catch (error) {
    state.poiCandidates = [];
    state.selectedPoiId = null;
    renderPoiCandidates();
    setConnection('error', '连接失败');
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

async function reviewPoiCandidate(decision) {
  const candidate = currentPoiCandidate();
  if (!candidate || state.busy) return;
  const resolution = el('poiResolutionInput').value.trim();
  const restaurantId = el('poiRestaurantInput').value.trim();
  if (resolution.length < 5) {
    showToast('请填写至少 5 个字的决策说明');
    el('poiResolutionInput').focus();
    return;
  }
  if (decision === 'match_existing' && !restaurantId) {
    showToast('请填写已有餐厅 ID');
    el('poiRestaurantInput').focus();
    return;
  }
  const payload = {
    decision,
    resolution_note: resolution,
    ...(decision === 'match_existing' ? { restaurant_id: restaurantId } : {})
  };
  state.busy = true;
  try {
    await request(`/api/v1/admin/poi/candidates/${encodeURIComponent(candidate.id)}`, {
      method: 'PATCH', body: JSON.stringify(payload)
    });
    showToast(decision === 'match_existing' ? '已匹配已有分店' : decision === 'new_branch' ? '已进入新分店核验' : '候选已驳回');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
  await loadPoiCandidates();
}

async function readPoiFile(file) {
  const parsed = JSON.parse(await file.text());
  const candidates = Array.isArray(parsed) ? parsed : parsed?.candidates;
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 50) {
    throw new Error('JSON 必须包含 1-50 条标准化候选');
  }
  state.poiImportCandidates = candidates;
  el('poiFileStatus').textContent = `${candidates.length} 条候选`;
}

async function submitPoiImport(event) {
  event.preventDefault();
  if (!state.poiImportCandidates.length || state.busy) {
    showToast('请选择有效的标准化 JSON 文件');
    return;
  }
  if (!crypto.randomUUID) {
    showToast('当前浏览器不支持安全幂等键');
    return;
  }
  const payload = {
    coverage_area_id: el('poiCoverageInput').value.trim(),
    provider: el('poiProviderInput').value.trim(),
    source_label: el('poiSourceInput').value.trim(),
    authorization_basis: el('poiAuthorizationInput').value.trim(),
    idempotency_key: crypto.randomUUID(),
    candidates: state.poiImportCandidates
  };
  const submitButton = el('poiImportForm').querySelector('button[type="submit"]');
  state.busy = true;
  submitButton.disabled = true;
  try {
    const response = await request('/api/v1/admin/poi/imports', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`已接收 ${response.batch.input_count} 条候选`);
    el('poiImportForm').reset();
    state.poiImportCandidates = [];
    el('poiFileStatus').textContent = '未选择文件';
    el('poiImportBand').classList.add('hidden');
    state.poiStatus = 'pending';
    document.querySelectorAll('[data-poi-status]').forEach(button => {
      const selected = button.dataset.poiStatus === state.poiStatus;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    submitButton.disabled = false;
  }
  await loadPoiCandidates();
}

function formatGateValue(code, value) {
  if (value === null || value === undefined) return '缺失';
  if (typeof value === 'boolean') return value ? '已通过' : '未通过';
  if (code === 'published_restaurants' || code === 'pending_dedup') return String(value);
  if (code === 'incident_free') return `${value} 周`;
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function renderQuality(quality) {
  for (const [id, gate] of [['betaGateSummary', quality.gates.beta], ['liveGateSummary', quality.gates.live]]) {
    const summary = el(id);
    summary.dataset.ready = String(gate.eligible);
    summary.querySelector('strong').textContent = gate.eligible ? '已达标' : '未达标';
  }
  const activeGate = quality.area.status === 'beta' || quality.area.status === 'live'
    ? quality.gates.live
    : quality.gates.beta;
  el('qualityChecks').innerHTML = activeGate.checks.map(check => `
    <div class="gate-check" data-passed="${check.passed}">
      <i aria-hidden="true">${check.passed ? '✓' : '×'}</i>
      <span>${escapeHtml(check.label)}</span>
      <small>${escapeHtml(formatGateValue(check.code, check.value))} / ${escapeHtml(check.target)}</small>
    </div>
  `).join('');
  el('qualityResults').classList.remove('hidden');
  const metrics = quality.metrics;
  el('qualitySearchInput').value = metrics.search_sample_coverage_rate === null ? '' : String(metrics.search_sample_coverage_rate * 100);
  el('qualityMismatchInput').value = metrics.branch_mismatch_rate === null ? '' : String(metrics.branch_mismatch_rate * 100);
  el('qualityVisitInput').value = metrics.visit_conformity_rate === null ? '' : String(metrics.visit_conformity_rate * 100);
  el('qualityIncidentInput').value = metrics.incident_free_weeks ?? '';
  el('qualityProviderTermsInput').checked = metrics.provider_terms_reviewed === true;
  el('qualityPrivacyInput').checked = metrics.privacy_reviewed === true;
  el('qualityPostgisInput').checked = metrics.postgis_rehearsal_passed === true;
  el('qualityEvidenceInput').value = '';
  el('qualityUpdateForm').classList.remove('hidden');
}

async function loadCoverageQuality(event) {
  event.preventDefault();
  if (!state.token || state.busy) return;
  const areaId = el('qualityAreaInput').value.trim();
  state.busy = true;
  try {
    const response = await request(`/api/v1/admin/coverage/${encodeURIComponent(areaId)}/quality`);
    renderQuality(response.quality);
  } catch (error) {
    el('qualityResults').classList.add('hidden');
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

function optionalPercent(id) {
  const value = el(id).value;
  return value === '' ? undefined : Number(value) / 100;
}

async function updateCoverageQuality(event) {
  event.preventDefault();
  if (!state.token || state.busy) return;
  const areaId = el('qualityAreaInput').value.trim();
  const search = optionalPercent('qualitySearchInput');
  const mismatch = optionalPercent('qualityMismatchInput');
  const visit = optionalPercent('qualityVisitInput');
  const incidents = el('qualityIncidentInput').value;
  const payload = {
    ...(search !== undefined ? { search_sample_coverage_rate: search } : {}),
    ...(mismatch !== undefined ? { branch_mismatch_rate: mismatch } : {}),
    ...(visit !== undefined ? { visit_conformity_rate: visit } : {}),
    ...(incidents !== '' ? { incident_free_weeks: Number(incidents) } : {}),
    provider_terms_reviewed: el('qualityProviderTermsInput').checked,
    privacy_reviewed: el('qualityPrivacyInput').checked,
    postgis_rehearsal_passed: el('qualityPostgisInput').checked,
    evidence_note: el('qualityEvidenceInput').value.trim()
  };
  state.busy = true;
  try {
    const response = await request(`/api/v1/admin/coverage/${encodeURIComponent(areaId)}/quality`, {
      method: 'PATCH', body: JSON.stringify(payload)
    });
    renderQuality(response.quality);
    showToast('人工质量指标已记录');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

function setMode(mode) {
  if (mode !== 'tasks' && mode !== 'poi') return;
  state.mode = mode;
  el('taskWorkspace').classList.toggle('hidden', mode !== 'tasks');
  el('poiWorkspace').classList.toggle('hidden', mode !== 'poi');
  if (mode !== 'poi') {
    el('poiImportBand').classList.add('hidden');
    el('qualityBand').classList.add('hidden');
  }
  document.querySelectorAll('[data-mode]').forEach(button => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (!state.token) return;
  if (mode === 'tasks') loadTasks();
  else loadPoiCandidates();
}

function bindEvents() {
  el('connectionForm').addEventListener('submit', event => {
    event.preventDefault();
    const apiBase = el('apiBaseInput').value.trim().replace(/\/$/, '');
    let parsedUrl;
    try {
      parsedUrl = new URL(apiBase);
    } catch {
      showToast('API 地址无效');
      return;
    }
    const local = ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname);
    if (parsedUrl.protocol !== 'https:' && !(local && parsedUrl.protocol === 'http:')) {
      showToast('运营连接需要 HTTPS 或本机地址');
      return;
    }
    state.apiBase = apiBase;
    state.operator = el('operatorInput').value.trim();
    state.token = el('tokenInput').value;
    el('tokenInput').value = '';
    if (state.mode === 'tasks') loadTasks();
    else loadPoiCandidates();
  });
  el('modeNav').addEventListener('click', event => {
    const button = event.target.closest('[data-mode]');
    if (button && button.dataset.mode !== state.mode) setMode(button.dataset.mode);
  });
  el('refreshButton').addEventListener('click', () => loadTasks({ preserveSelection: true }));
  el('sweepButton').addEventListener('click', sweepEvidence);
  el('statusTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-status]');
    if (!button || button.dataset.status === state.status) return;
    state.status = button.dataset.status;
    document.querySelectorAll('[data-status]').forEach(item => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    state.selectedTaskId = null;
    loadTasks();
  });
  el('taskList').addEventListener('click', event => {
    const button = event.target.closest('[data-task-id]');
    if (!button) return;
    state.selectedTaskId = button.dataset.taskId;
    renderTasks();
    renderDetail();
  });
  el('reviewActions').addEventListener('click', event => {
    const button = event.target.closest('[data-task-action]');
    if (button) updateTask(button.dataset.taskAction);
  });
  el('resolutionInput').addEventListener('input', event => { el('resolutionCount').textContent = event.target.value.length; });
  el('refreshPoiButton').addEventListener('click', () => loadPoiCandidates({ preserveSelection: true }));
  el('openPoiImportButton').addEventListener('click', () => {
    el('qualityBand').classList.add('hidden');
    el('poiImportBand').classList.toggle('hidden');
  });
  el('cancelPoiImportButton').addEventListener('click', () => el('poiImportBand').classList.add('hidden'));
  el('openQualityButton').addEventListener('click', () => {
    el('poiImportBand').classList.add('hidden');
    el('qualityBand').classList.toggle('hidden');
  });
  el('closeQualityButton').addEventListener('click', () => el('qualityBand').classList.add('hidden'));
  el('qualityForm').addEventListener('submit', loadCoverageQuality);
  el('qualityUpdateForm').addEventListener('submit', updateCoverageQuality);
  el('poiImportForm').addEventListener('submit', submitPoiImport);
  el('poiFileInput').addEventListener('change', async event => {
    state.poiImportCandidates = [];
    el('poiFileStatus').textContent = '正在读取';
    try {
      const file = event.target.files?.[0];
      if (!file) throw new Error('未选择文件');
      await readPoiFile(file);
    } catch (error) {
      event.target.value = '';
      el('poiFileStatus').textContent = '文件无效';
      showToast(error.message);
    }
  });
  el('poiStatusTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-poi-status]');
    if (!button || button.dataset.poiStatus === state.poiStatus) return;
    state.poiStatus = button.dataset.poiStatus;
    document.querySelectorAll('[data-poi-status]').forEach(item => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    state.selectedPoiId = null;
    loadPoiCandidates();
  });
  el('poiList').addEventListener('click', event => {
    const button = event.target.closest('[data-poi-id]');
    if (!button) return;
    state.selectedPoiId = button.dataset.poiId;
    renderPoiCandidates();
    renderPoiDetail();
  });
  el('poiReviewActions').addEventListener('click', event => {
    const button = event.target.closest('[data-poi-action]');
    if (button) reviewPoiCandidate(button.dataset.poiAction);
  });
  el('poiResolutionInput').addEventListener('input', event => { el('poiResolutionCount').textContent = event.target.value.length; });
}

function initialize() {
  const localApi = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://127.0.0.1:8787' : '';
  el('apiBaseInput').value = localApi;
  bindEvents();
}

initialize();
