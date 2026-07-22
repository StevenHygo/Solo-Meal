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
const restaurantStatusLabels = { draft: '草稿', review: '待审核', published: '已发布', withdrawn: '已撤回' };
const outboxStatusLabels = { pending: '待投递', processing: '投递中', failed: '失败', processed: '已完成' };
const coverageStatusLabels = { live: '正式开放', beta: 'Beta', upcoming: '即将开放', paused: '暂停', unsupported: '未覆盖' };
const coverageStatuses = ['live', 'beta', 'upcoming', 'paused', 'unsupported'];
const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const evidenceAttributeLabels = {
  accepts_solo: '单人接待', seating: '座位情况', ordering: '点餐规则',
  minimum_spend: '最低消费', solo_portion: '单人份', meal_speed: '用餐速度',
  hours: '营业时间', location: '位置', noise: '氛围'
};
const evidenceSourceLabels = {
  operator_visit: '运营到店', operator_call: '运营电话', menu_review: '菜单核验', merchant_provided: '商户提供'
};
const state = {
  apiBase: '', token: '', operator: '', mode: 'tasks', status: 'open', tasks: [], selectedTaskId: null,
  poiStatus: 'pending', poiCandidates: [], selectedPoiId: null, poiImportCandidates: [],
  restaurantStatus: 'draft', restaurants: [], selectedRestaurantId: null, draftCandidate: null,
  outboxStatus: 'pending', outboxEvents: [], selectedOutboxId: null, auditLogs: [], expiringEvidence: [],
  coverageCities: [],
  restaurantDirty: false, busy: false
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

function currentRestaurant() {
  return state.restaurants.find(restaurant => restaurant.id === state.selectedRestaurantId) || null;
}

function currentOutboxEvent() {
  return state.outboxEvents.find(event => event.id === state.selectedOutboxId) || null;
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
    actions.innerHTML = candidate.draft_restaurant
      ? '<button class="primary-button" data-poi-action="open_draft" type="button">打开餐厅草稿</button>'
      : '<button class="primary-button" data-poi-action="create_draft" type="button">创建餐厅草稿</button><button class="secondary-button" data-poi-action="match_existing" type="button">改为匹配已有</button><button class="danger-button" data-poi-action="reject" type="button">驳回候选</button>';
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
  const terminal = candidate.status === 'matched' || candidate.status === 'rejected'
    || candidate.draft_restaurant?.status === 'published' || candidate.draft_restaurant?.status === 'withdrawn';
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

function splitList(value) {
  return [...new Set(String(value || '').split(/[，,]/).map(item => item.trim()).filter(Boolean))];
}

function toLocalDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultEvidence() {
  const observed = new Date();
  const expires = new Date(observed.getTime() + 90 * 86400000);
  return {
    attribute: 'accepts_solo', title: '单人接待确认', value: '', source_type: 'operator_call',
    source_label: '运营电话核验', observed_at: observed.toISOString(), expires_at: expires.toISOString()
  };
}

function hoursRow(hours = { dayOfWeek: 1, opensAt: '11:00', closesAt: '21:00' }) {
  const day = hours.dayOfWeek ?? hours.day_of_week ?? 1;
  return `
    <div class="repeat-row" data-hours-row>
      <label><span>星期</span><select data-hours-field="day_of_week" required>${weekdayLabels.map((label, index) => `<option value="${index}" ${index === day ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label><span>开始</span><input data-hours-field="opens_at" type="time" value="${escapeHtml(hours.opensAt ?? hours.opens_at ?? '11:00')}" required></label>
      <label><span>结束</span><input data-hours-field="closes_at" type="time" value="${escapeHtml(hours.closesAt ?? hours.closes_at ?? '21:00')}" required></label>
      <button class="remove-row-button" data-remove-hours type="button" title="移除营业时段" aria-label="移除营业时段">×</button>
    </div>`;
}

function evidenceRow(evidence = defaultEvidence()) {
  return `
    <div class="repeat-row evidence-row" data-evidence-row>
      <label><span>核验属性</span><select data-evidence-field="attribute" required>${Object.entries(evidenceAttributeLabels).map(([value, label]) => `<option value="${value}" ${value === evidence.attribute ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label><span>来源类型</span><select data-evidence-field="source_type" required>${Object.entries(evidenceSourceLabels).map(([value, label]) => `<option value="${value}" ${value === evidence.source_type ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <button class="remove-row-button" data-remove-evidence type="button" title="移除证据" aria-label="移除证据">×</button>
      <label><span>证据标题</span><input data-evidence-field="title" type="text" maxlength="120" value="${escapeHtml(evidence.title)}" required></label>
      <label><span>来源标签</span><input data-evidence-field="source_label" type="text" maxlength="160" value="${escapeHtml(evidence.source_label)}" required></label>
      <label class="evidence-wide"><span>核验结论</span><textarea data-evidence-field="value" maxlength="500" rows="2" required>${escapeHtml(evidence.value)}</textarea></label>
      <label><span>观察时间</span><input data-evidence-field="observed_at" type="datetime-local" value="${escapeHtml(toLocalDateTime(evidence.observed_at))}" required></label>
      <label><span>有效期至</span><input data-evidence-field="expires_at" type="datetime-local" value="${escapeHtml(toLocalDateTime(evidence.expires_at))}" required></label>
    </div>`;
}

function setRestaurantDirty(dirty) {
  state.restaurantDirty = dirty;
  const label = el('restaurantDirtyState');
  label.dataset.dirty = String(dirty);
  label.textContent = state.draftCandidate && dirty ? '尚未创建' : dirty ? '有未保存更改' : '所有更改已保存';
}

function setDraftEditable(editable) {
  el('restaurantDraftForm').querySelectorAll('input, textarea, select, button').forEach(control => {
    control.disabled = !editable;
  });
  el('restaurantSaveRow').classList.toggle('hidden', !editable);
}

function renderRestaurantList() {
  el('restaurantCount').textContent = state.restaurants.length;
  const list = el('restaurantList');
  if (!state.restaurants.length) {
    list.innerHTML = '<div class="queue-empty">当前状态没有餐厅记录</div>';
    if (!state.draftCandidate) renderRestaurantDetail();
    return;
  }
  list.innerHTML = state.restaurants.map(record => `
    <button class="task-row ${record.id === state.selectedRestaurantId ? 'active' : ''}" data-restaurant-id="${escapeHtml(record.id)}" type="button">
      <span class="candidate-source restaurant-status-mark" data-status="${escapeHtml(record.status)}">${escapeHtml(record.status === 'published' ? 'ON' : record.status === 'withdrawn' ? 'OFF' : `V${record.version}`)}</span>
      <span><strong>${escapeHtml(record.fields.name)}</strong><small>${escapeHtml(record.fields.district)} · ${escapeHtml(record.coverage_area.name)}</small></span>
      <time>${escapeHtml(formatTime(record.workflow.updated_at))}</time>
    </button>
  `).join('');
}

function renderWorkflow(record) {
  const workflow = record.workflow;
  el('restaurantWorkflowSummary').textContent = workflow.status_note || restaurantStatusLabels[record.status];
  const steps = [
    ['创建', workflow.created_by, null],
    ['提交审核', workflow.review_submitted_by, workflow.review_submitted_at],
    ['发布', workflow.published_by, workflow.published_at],
    ['撤回', workflow.withdrawn_by, workflow.withdrawn_at]
  ];
  el('restaurantWorkflowTimeline').innerHTML = steps.map(([label, actor, at]) => `
    <div class="workflow-step"><span>${label}</span><strong>${actor ? `${escapeHtml(actor)}<br>${escapeHtml(formatTime(at))}` : '未发生'}</strong></div>
  `).join('');
  const actions = el('restaurantReviewActions');
  if (record.status === 'draft') {
    actions.innerHTML = '<button class="primary-button" data-restaurant-action="submit_review" type="button">提交审核</button>';
  } else if (record.status === 'review') {
    actions.innerHTML = '<button class="primary-button" data-restaurant-action="publish" type="button">发布餐厅</button><button class="secondary-button" data-restaurant-action="request_changes" type="button">退回修改</button>';
  } else if (record.status === 'published') {
    actions.innerHTML = '<button class="danger-button" data-restaurant-action="withdraw" type="button">撤回餐厅</button>';
  } else {
    actions.innerHTML = '';
  }
  const hasAction = record.status !== 'withdrawn';
  el('restaurantTransitionNoteInput').closest('label').classList.toggle('hidden', !hasAction);
}

function fillRestaurantForm(record) {
  const fields = record?.fields;
  const candidate = state.draftCandidate;
  el('restaurantNameInput').value = fields?.name || candidate?.name || '';
  el('restaurantAddressInput').value = fields?.address || candidate?.address || '';
  el('restaurantDistrictInput').value = fields?.district || candidate?.district || '';
  el('restaurantPrimaryCuisineInput').value = fields?.primary_cuisine_code || '';
  el('restaurantCuisineCodesInput').value = fields ? fields.cuisine_codes.filter(code => code !== fields.primary_cuisine_code).join(', ') : '';
  el('restaurantPriceMinInput').value = fields ? String(fields.price.min_fen / 100) : '20';
  el('restaurantPriceMaxInput').value = fields ? String(fields.price.max_fen / 100) : '50';
  el('restaurantAcceptsSoloInput').checked = fields?.accepts_solo === true;
  el('restaurantPeakPolicyInput').value = fields?.peak_policy || '';
  el('restaurantSeatTypesInput').value = fields?.seat_types?.join(', ') || '';
  el('restaurantCounterSeatsInput').value = String(fields?.counter_seats ?? 0);
  el('restaurantSoloPortionInput').checked = fields?.solo_portion === true;
  el('restaurantMinSpendInput').value = fields?.min_spend_fen === null || fields?.min_spend_fen === undefined ? '' : String(fields.min_spend_fen / 100);
  el('restaurantMealMinInput').value = String(fields?.meal_minutes?.min ?? 20);
  el('restaurantMealMaxInput').value = String(fields?.meal_minutes?.max ?? 40);
  el('restaurantNoiseInput').value = String(fields?.noise_level ?? 3);
  el('restaurantDishesInput').value = fields?.dishes?.join(', ') || '';
  el('restaurantNoteInput').value = fields?.note || '';
  el('restaurantHoursRows').innerHTML = (fields?.hours?.length ? fields.hours : [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '21:00' }]).map(hoursRow).join('');
  el('restaurantEvidenceRows').innerHTML = (fields?.evidence?.length ? fields.evidence : [defaultEvidence()]).map(evidenceRow).join('');
}

function renderRestaurantDetail() {
  const record = currentRestaurant();
  const creating = Boolean(state.draftCandidate && !record);
  const visible = Boolean(record || creating);
  el('restaurantDetailEmpty').classList.toggle('hidden', visible);
  el('restaurantDetailContent').classList.toggle('hidden', !visible);
  if (!visible) return;
  const status = record?.status || 'draft';
  el('restaurantDetailTitle').textContent = record?.fields.name || state.draftCandidate.name;
  el('restaurantStatusBadge').textContent = creating ? '新草稿' : restaurantStatusLabels[status];
  el('restaurantStatusBadge').dataset.status = status;
  const source = record?.source_candidate || state.draftCandidate;
  el('restaurantSourceValue').textContent = source ? `${source.provider} / ${source.provider_poi_id}` : '-';
  el('restaurantCoverageValue').textContent = record?.coverage_area.name || state.draftCandidate.coverage_area.name;
  el('restaurantVersionValue').textContent = record ? `v${record.version}` : '未创建';
  el('restaurantUpdatedValue').textContent = record ? formatTime(record.workflow.updated_at) : '-';
  el('restaurantDraftContext').textContent = creating ? '来源候选预填' : `ID ${record.id}`;
  fillRestaurantForm(record);
  const editable = creating || record.status === 'draft';
  setDraftEditable(editable);
  el('saveRestaurantDraftButton').textContent = creating ? '创建草稿' : '保存草稿';
  el('restaurantWorkflowBlock').classList.toggle('hidden', creating);
  el('restaurantTransitionNoteInput').value = record?.workflow.status_note || '';
  el('restaurantTransitionNoteCount').textContent = el('restaurantTransitionNoteInput').value.length;
  if (record) renderWorkflow(record);
  setRestaurantDirty(creating);
}

async function loadRestaurants({ preserveSelection = false, selectedId = null } = {}) {
  if (!state.token || state.busy) return;
  state.busy = true;
  setConnection('idle', '正在读取');
  try {
    const response = await request(`/api/v1/admin/restaurants?status=${encodeURIComponent(state.restaurantStatus)}&limit=100`);
    state.restaurants = response.restaurants;
    const preferred = selectedId || (preserveSelection ? state.selectedRestaurantId : null);
    state.selectedRestaurantId = state.draftCandidate
      ? null
      : state.restaurants.some(record => record.id === preferred) ? preferred : state.restaurants[0]?.id || null;
    renderRestaurantList();
    renderRestaurantDetail();
    setConnection('ready', '已连接');
  } catch (error) {
    state.restaurants = [];
    state.selectedRestaurantId = null;
    renderRestaurantList();
    renderRestaurantDetail();
    setConnection('error', '连接失败');
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

function openRestaurantDraft(candidate) {
  state.draftCandidate = candidate.draft_restaurant ? null : candidate;
  state.restaurantStatus = candidate.draft_restaurant?.status || 'draft';
  state.selectedRestaurantId = candidate.draft_restaurant?.id || null;
  document.querySelectorAll('[data-restaurant-status]').forEach(button => {
    const selected = button.dataset.restaurantStatus === state.restaurantStatus;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  setMode('restaurants');
  if (state.draftCandidate) {
    renderRestaurantList();
    renderRestaurantDetail();
  }
}

function restaurantDraftPayload() {
  const form = el('restaurantDraftForm');
  if (!form.reportValidity()) return null;
  const primaryCuisine = el('restaurantPrimaryCuisineInput').value;
  const cuisineCodes = [...new Set([primaryCuisine, ...splitList(el('restaurantCuisineCodesInput').value)])];
  const hours = [...el('restaurantHoursRows').querySelectorAll('[data-hours-row]')].map(row => ({
    day_of_week: Number(row.querySelector('[data-hours-field="day_of_week"]').value),
    opens_at: row.querySelector('[data-hours-field="opens_at"]').value,
    closes_at: row.querySelector('[data-hours-field="closes_at"]').value
  }));
  const evidence = [...el('restaurantEvidenceRows').querySelectorAll('[data-evidence-row]')].map(row => {
    const field = name => row.querySelector(`[data-evidence-field="${name}"]`).value;
    return {
      attribute: field('attribute'), title: field('title').trim(), value: field('value').trim(),
      source_type: field('source_type'), source_label: field('source_label').trim(),
      observed_at: new Date(field('observed_at')).toISOString(), expires_at: new Date(field('expires_at')).toISOString()
    };
  });
  const minSpend = el('restaurantMinSpendInput').value;
  return {
    name: el('restaurantNameInput').value.trim(), address: el('restaurantAddressInput').value.trim(),
    district: el('restaurantDistrictInput').value.trim(), cuisine_codes: cuisineCodes,
    primary_cuisine_code: primaryCuisine,
    price_min_fen: Math.round(Number(el('restaurantPriceMinInput').value) * 100),
    price_max_fen: Math.round(Number(el('restaurantPriceMaxInput').value) * 100),
    accepts_solo: el('restaurantAcceptsSoloInput').checked,
    peak_policy: el('restaurantPeakPolicyInput').value.trim(), seat_types: splitList(el('restaurantSeatTypesInput').value),
    counter_seats: Number(el('restaurantCounterSeatsInput').value), solo_portion: el('restaurantSoloPortionInput').checked,
    min_spend_fen: minSpend === '' ? null : Math.round(Number(minSpend) * 100),
    meal_minutes: { min: Number(el('restaurantMealMinInput').value), max: Number(el('restaurantMealMaxInput').value) },
    noise_level: Number(el('restaurantNoiseInput').value), hours, dishes: splitList(el('restaurantDishesInput').value),
    note: el('restaurantNoteInput').value.trim(), evidence
  };
}

async function saveRestaurantDraft(event) {
  event.preventDefault();
  if (state.busy) return;
  let payload;
  try {
    payload = restaurantDraftPayload();
  } catch {
    showToast('请检查证据时间');
    return;
  }
  if (!payload) return;
  const creating = Boolean(state.draftCandidate);
  const record = currentRestaurant();
  if (!creating && !record) return;
  state.busy = true;
  try {
    const path = creating
      ? `/api/v1/admin/poi/candidates/${encodeURIComponent(state.draftCandidate.id)}/draft`
      : `/api/v1/admin/restaurants/${encodeURIComponent(record.id)}/draft`;
    const response = await request(path, { method: creating ? 'POST' : 'PUT', body: JSON.stringify(payload) });
    const id = response.restaurant.id;
    state.draftCandidate = null;
    state.restaurantStatus = 'draft';
    state.selectedRestaurantId = id;
    setRestaurantDirty(false);
    showToast(creating ? '餐厅草稿已创建' : '餐厅草稿已保存');
  } catch (error) {
    showToast(error.message);
    state.busy = false;
    return;
  }
  state.busy = false;
  await loadRestaurants({ preserveSelection: true, selectedId: state.selectedRestaurantId });
}

async function transitionRestaurant(action) {
  const record = currentRestaurant();
  if (!record || state.busy) return;
  if (action === 'submit_review' && state.restaurantDirty) {
    showToast('请先保存草稿更改');
    return;
  }
  const note = el('restaurantTransitionNoteInput').value.trim();
  if (note.length < 5) {
    showToast('请填写至少 5 个字的操作说明');
    el('restaurantTransitionNoteInput').focus();
    return;
  }
  if (action === 'withdraw' && !window.confirm('确认撤回该餐厅？撤回后会立即退出公开搜索。')) return;
  state.busy = true;
  try {
    const response = await request(`/api/v1/admin/restaurants/${encodeURIComponent(record.id)}/transitions`, {
      method: 'POST', body: JSON.stringify({ action, note })
    });
    const updated = response.restaurant;
    state.restaurantStatus = updated.status;
    state.selectedRestaurantId = updated.id;
    document.querySelectorAll('[data-restaurant-status]').forEach(button => {
      const selected = button.dataset.restaurantStatus === state.restaurantStatus;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    showToast(action === 'submit_review' ? '已提交审核' : action === 'request_changes' ? '已退回修改' : action === 'publish' ? '餐厅已发布' : '餐厅已撤回');
  } catch (error) {
    showToast(error.message);
    state.busy = false;
    return;
  }
  state.busy = false;
  await loadRestaurants({ preserveSelection: true, selectedId: state.selectedRestaurantId });
}

async function reviewPoiCandidate(decision) {
  const candidate = currentPoiCandidate();
  if (!candidate || state.busy) return;
  if (decision === 'create_draft' || decision === 'open_draft') {
    openRestaurantDraft(candidate);
    return;
  }
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

function coverageStatusOptions(selected) {
  return coverageStatuses.map(status => `<option value="${status}" ${status === selected ? 'selected' : ''}>${escapeHtml(coverageStatusLabels[status])}</option>`).join('');
}

function renderCoverage() {
  const list = el('coverageList');
  if (!state.coverageCities.length) {
    list.innerHTML = '<div class="queue-empty">没有可管理的城市或覆盖区域</div>';
    return;
  }
  list.innerHTML = state.coverageCities.map(city => `
    <section class="coverage-city">
      <div class="coverage-city-heading"><h3>${escapeHtml(city.name)}</h3><span>${escapeHtml(city.code)}</span></div>
      <div class="coverage-row" data-coverage-kind="city" data-coverage-id="${escapeHtml(city.code)}">
        <div><strong>城市总开关</strong><small>暂停时覆盖全部区域，但不改写区域原状态</small></div>
        <span class="coverage-effective">${escapeHtml(coverageStatusLabels[city.status] || city.status)}</span>
        <select aria-label="${escapeHtml(city.name)}城市状态">${coverageStatusOptions(city.status)}</select>
        <button class="secondary-button compact-button" data-update-coverage type="button">应用</button>
      </div>
      ${city.areas.map(area => `
        <div class="coverage-row" data-coverage-kind="area" data-coverage-id="${escapeHtml(area.id)}">
          <div><strong>${escapeHtml(area.name)}</strong><small>${escapeHtml(area.id)} · 原状态 ${escapeHtml(coverageStatusLabels[area.configured_status] || area.configured_status)}</small></div>
          <span class="coverage-effective" data-masked="${area.configured_status !== area.effective_status}">${escapeHtml(coverageStatusLabels[area.effective_status] || area.effective_status)}</span>
          <select aria-label="${escapeHtml(area.name)}覆盖状态">${coverageStatusOptions(area.configured_status)}</select>
          <button class="secondary-button compact-button" data-update-coverage type="button">应用</button>
        </div>
      `).join('')}
    </section>
  `).join('');
}

async function loadCoverage() {
  if (!state.token || state.busy) return;
  state.busy = true;
  try {
    const response = await request('/api/v1/admin/coverage');
    state.coverageCities = response.cities;
    renderCoverage();
  } catch (error) {
    state.coverageCities = [];
    renderCoverage();
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

async function updateCoverageStatus(button) {
  if (!state.token || state.busy) return;
  const row = button.closest('[data-coverage-kind]');
  const kind = row?.dataset.coverageKind;
  const id = row?.dataset.coverageId;
  const status = row?.querySelector('select')?.value;
  const reason = el('coverageReasonInput').value.trim();
  if (!kind || !id || !coverageStatuses.includes(status)) return;
  if (reason.length < 5) {
    showToast('请填写至少 5 个字的操作说明');
    el('coverageReasonInput').focus();
    return;
  }
  if ((status === 'paused' || status === 'unsupported')
    && !window.confirm(`确认将${kind === 'city' ? '城市' : '覆盖区域'}设为“${coverageStatusLabels[status]}”？`)) return;
  const path = kind === 'city'
    ? `/api/v1/admin/cities/${encodeURIComponent(id)}/status`
    : `/api/v1/admin/coverage/${encodeURIComponent(id)}/status`;
  state.busy = true;
  try {
    await request(path, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
    showToast('覆盖状态已更新');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
  await loadCoverage();
}

function renderOutboxEvents() {
  el('outboxCount').textContent = state.outboxEvents.length;
  const list = el('outboxList');
  if (!state.outboxEvents.length) {
    list.innerHTML = '<div class="queue-empty">当前状态没有投递事件</div>';
    renderOutboxDetail();
    return;
  }
  list.innerHTML = state.outboxEvents.map(event => `
    <button class="task-row ${event.id === state.selectedOutboxId ? 'active' : ''}" data-outbox-id="${escapeHtml(event.id)}" type="button">
      <span class="candidate-source">${escapeHtml(String(event.attempts))}</span>
      <span><strong>${escapeHtml(event.topic)}</strong><small>${escapeHtml(event.aggregate_id)}</small></span>
      <time>${escapeHtml(formatTime(event.created_at))}</time>
    </button>
  `).join('');
}

function renderOutboxDetail() {
  const event = currentOutboxEvent();
  el('outboxDetailEmpty').classList.toggle('hidden', Boolean(event));
  el('outboxDetailContent').classList.toggle('hidden', !event);
  if (!event) return;
  el('outboxDetailTitle').textContent = event.topic;
  el('outboxStatusBadge').textContent = outboxStatusLabels[event.status] || event.status;
  el('outboxStatusBadge').dataset.status = event.status;
  el('outboxTopicValue').textContent = event.topic;
  el('outboxAggregateValue').textContent = event.aggregate_id;
  el('outboxAttemptsValue').textContent = String(event.attempts);
  el('outboxAvailableValue').textContent = formatTime(event.available_at);
  el('outboxErrorBlock').classList.toggle('hidden', !event.last_error);
  el('outboxErrorValue').textContent = event.last_error || '-';
  el('outboxPayloadValue').textContent = JSON.stringify(event.payload, null, 2);
  el('retryOutboxButton').classList.toggle('hidden', event.status !== 'failed');
}

function auditQuery() {
  const params = new URLSearchParams({ limit: '100' });
  for (const [id, key] of [
    ['auditActorInput', 'actor_id'], ['auditActionInput', 'action'],
    ['auditEntityTypeInput', 'entity_type'], ['auditEntityIdInput', 'entity_id']
  ]) {
    const value = el(id).value.trim();
    if (value) params.set(key, value);
  }
  return params.toString();
}

function expiryQuery() {
  const params = new URLSearchParams({
    within_days: el('expiryDaysInput').value,
    limit: '100'
  });
  const coverage = el('expiryCoverageInput').value.trim();
  const attribute = el('expiryAttributeInput').value;
  if (coverage) params.set('coverage_area_id', coverage);
  if (attribute) params.set('attribute', attribute);
  return params.toString();
}

function renderExpiringEvidence() {
  el('expiringEvidenceCount').textContent = state.expiringEvidence.length;
  const list = el('expiringEvidenceList');
  if (!state.expiringEvidence.length) {
    list.innerHTML = '<div class="queue-empty">当前窗口没有即将过期的证据</div>';
    return;
  }
  list.innerHTML = state.expiringEvidence.map(evidence => `
    <article class="expiry-row">
      <span class="expiry-days">${escapeHtml(String(evidence.expires_in_days))} 天</span>
      <div><strong>${escapeHtml(evidence.restaurant.name)} · ${escapeHtml(evidenceAttributeLabels[evidence.attribute] || evidence.attribute)}</strong><small>${escapeHtml(evidence.coverage_area.name)} · ${escapeHtml(evidence.title)}</small></div>
      <div><strong>${escapeHtml(evidence.source_label)}</strong><small>${escapeHtml(evidence.source_type)}</small></div>
      <time>${escapeHtml(formatTime(evidence.expires_at))}</time>
    </article>
  `).join('');
}

function renderAuditLogs() {
  el('auditCount').textContent = state.auditLogs.length;
  const list = el('auditList');
  if (!state.auditLogs.length) {
    list.innerHTML = '<div class="queue-empty">当前条件没有审计记录</div>';
    return;
  }
  list.innerHTML = state.auditLogs.map(log => `
    <article class="audit-row">
      <span class="audit-action">${escapeHtml(log.action)}</span>
      <div><strong>${escapeHtml(log.entity_type)} · ${escapeHtml(log.entity_id)}</strong><small>${escapeHtml(log.actor_id)} · ${escapeHtml(log.reason)}</small></div>
      <time>${escapeHtml(formatTime(log.created_at))}</time>
    </article>
  `).join('');
}

async function loadOperations({ preserveSelection = false } = {}) {
  if (!state.token || state.busy) return;
  state.busy = true;
  setConnection('idle', '正在读取');
  try {
    const [outboxResponse, auditResponse, expiryResponse] = await Promise.all([
      request(`/api/v1/admin/outbox-events?status=${encodeURIComponent(state.outboxStatus)}&limit=100`),
      request(`/api/v1/admin/audit-logs?${auditQuery()}`),
      request(`/api/v1/admin/evidence/expiring?${expiryQuery()}`)
    ]);
    state.outboxEvents = outboxResponse.outbox_events;
    state.auditLogs = auditResponse.audit_logs;
    state.expiringEvidence = expiryResponse.evidence;
    if (!preserveSelection || !state.outboxEvents.some(event => event.id === state.selectedOutboxId)) {
      state.selectedOutboxId = state.outboxEvents[0]?.id || null;
    }
    renderOutboxEvents();
    renderOutboxDetail();
    renderAuditLogs();
    renderExpiringEvidence();
    setConnection('ready', '已连接');
  } catch (error) {
    state.outboxEvents = [];
    state.auditLogs = [];
    state.expiringEvidence = [];
    state.selectedOutboxId = null;
    renderOutboxEvents();
    renderAuditLogs();
    renderExpiringEvidence();
    setConnection('error', '连接失败');
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

async function retryOutboxEvent() {
  const event = currentOutboxEvent();
  if (!event || event.status !== 'failed' || state.busy) return;
  state.busy = true;
  try {
    await request(`/api/v1/admin/outbox-events/${encodeURIComponent(event.id)}/retry`, { method: 'POST', body: '{}' });
    showToast('失败事件已重新入队');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
  await loadOperations();
}

async function downloadOperationsExport(event) {
  event.preventDefault();
  if (!state.token || state.busy) return;
  const dataset = el('exportDatasetInput').value;
  const limit = el('exportLimitInput').value;
  state.busy = true;
  try {
    const response = await fetch(`${state.apiBase}/api/v1/admin/exports/${encodeURIComponent(dataset)}.csv?limit=${encodeURIComponent(limit)}`, {
      headers: { authorization: `Bearer ${state.token}`, 'x-operator-id': state.operator }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message || body?.error?.code || `HTTP ${response.status}`);
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `solo-meal-${dataset}.csv`;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('CSV 已生成');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

function setMode(mode) {
  if (!['tasks', 'poi', 'restaurants', 'operations'].includes(mode)) return;
  state.mode = mode;
  el('taskWorkspace').classList.toggle('hidden', mode !== 'tasks');
  el('poiWorkspace').classList.toggle('hidden', mode !== 'poi');
  el('restaurantWorkspace').classList.toggle('hidden', mode !== 'restaurants');
  el('operationsWorkspace').classList.toggle('hidden', mode !== 'operations');
  if (mode !== 'poi') {
    el('poiImportBand').classList.add('hidden');
    el('qualityBand').classList.add('hidden');
    el('coverageBand').classList.add('hidden');
  }
  document.querySelectorAll('[data-mode]').forEach(button => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (!state.token) return;
  if (mode === 'tasks') loadTasks();
  else if (mode === 'poi') loadPoiCandidates();
  else if (mode === 'restaurants') loadRestaurants({ preserveSelection: true });
  else loadOperations({ preserveSelection: true });
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
    else if (state.mode === 'poi') loadPoiCandidates();
    else if (state.mode === 'restaurants') loadRestaurants({ preserveSelection: true });
    else loadOperations({ preserveSelection: true });
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
    el('coverageBand').classList.add('hidden');
    el('poiImportBand').classList.toggle('hidden');
  });
  el('cancelPoiImportButton').addEventListener('click', () => el('poiImportBand').classList.add('hidden'));
  el('openQualityButton').addEventListener('click', () => {
    el('poiImportBand').classList.add('hidden');
    el('coverageBand').classList.add('hidden');
    el('qualityBand').classList.toggle('hidden');
  });
  el('closeQualityButton').addEventListener('click', () => el('qualityBand').classList.add('hidden'));
  el('openCoverageButton').addEventListener('click', () => {
    el('poiImportBand').classList.add('hidden');
    el('qualityBand').classList.add('hidden');
    el('coverageBand').classList.toggle('hidden');
    if (!el('coverageBand').classList.contains('hidden')) loadCoverage();
  });
  el('closeCoverageButton').addEventListener('click', () => el('coverageBand').classList.add('hidden'));
  el('coverageList').addEventListener('click', event => {
    const button = event.target.closest('[data-update-coverage]');
    if (button) updateCoverageStatus(button);
  });
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
  el('refreshRestaurantButton').addEventListener('click', () => loadRestaurants({ preserveSelection: true }));
  el('restaurantStatusTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-restaurant-status]');
    if (!button || button.dataset.restaurantStatus === state.restaurantStatus) return;
    state.restaurantStatus = button.dataset.restaurantStatus;
    state.draftCandidate = null;
    document.querySelectorAll('[data-restaurant-status]').forEach(item => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    state.selectedRestaurantId = null;
    loadRestaurants();
  });
  el('restaurantList').addEventListener('click', event => {
    const button = event.target.closest('[data-restaurant-id]');
    if (!button) return;
    state.draftCandidate = null;
    state.selectedRestaurantId = button.dataset.restaurantId;
    renderRestaurantList();
    renderRestaurantDetail();
  });
  el('restaurantDraftForm').addEventListener('submit', saveRestaurantDraft);
  el('restaurantDraftForm').addEventListener('input', () => {
    const record = currentRestaurant();
    if (state.draftCandidate || record?.status === 'draft') setRestaurantDirty(true);
  });
  el('addHoursButton').addEventListener('click', () => {
    el('restaurantHoursRows').insertAdjacentHTML('beforeend', hoursRow());
    setRestaurantDirty(true);
  });
  el('addEvidenceButton').addEventListener('click', () => {
    el('restaurantEvidenceRows').insertAdjacentHTML('beforeend', evidenceRow());
    setRestaurantDirty(true);
  });
  el('restaurantHoursRows').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-hours]');
    if (!button) return;
    const rows = el('restaurantHoursRows').querySelectorAll('[data-hours-row]');
    if (rows.length === 1) return showToast('至少保留一个营业时段');
    button.closest('[data-hours-row]').remove();
    setRestaurantDirty(true);
  });
  el('restaurantEvidenceRows').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-evidence]');
    if (!button) return;
    const rows = el('restaurantEvidenceRows').querySelectorAll('[data-evidence-row]');
    if (rows.length === 1) return showToast('至少保留一条核验证据');
    button.closest('[data-evidence-row]').remove();
    setRestaurantDirty(true);
  });
  el('restaurantTransitionNoteInput').addEventListener('input', event => {
    el('restaurantTransitionNoteCount').textContent = event.target.value.length;
  });
  el('restaurantReviewActions').addEventListener('click', event => {
    const button = event.target.closest('[data-restaurant-action]');
    if (button) transitionRestaurant(button.dataset.restaurantAction);
  });
  el('refreshOperationsButton').addEventListener('click', () => loadOperations({ preserveSelection: true }));
  el('outboxStatusTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-outbox-status]');
    if (!button || button.dataset.outboxStatus === state.outboxStatus) return;
    state.outboxStatus = button.dataset.outboxStatus;
    document.querySelectorAll('[data-outbox-status]').forEach(item => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    state.selectedOutboxId = null;
    loadOperations();
  });
  el('outboxList').addEventListener('click', event => {
    const button = event.target.closest('[data-outbox-id]');
    if (!button) return;
    state.selectedOutboxId = button.dataset.outboxId;
    renderOutboxEvents();
    renderOutboxDetail();
  });
  el('retryOutboxButton').addEventListener('click', retryOutboxEvent);
  el('auditFilterForm').addEventListener('submit', event => {
    event.preventDefault();
    loadOperations({ preserveSelection: true });
  });
  el('expiryFilterForm').addEventListener('submit', event => {
    event.preventDefault();
    loadOperations({ preserveSelection: true });
  });
  el('exportForm').addEventListener('submit', downloadOperationsExport);
}

function initialize() {
  const localApi = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://127.0.0.1:8787' : '';
  el('apiBaseInput').value = localApi;
  bindEvents();
}

initialize();
