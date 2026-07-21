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
const state = { apiBase: '', token: '', operator: '', status: 'open', tasks: [], selectedTaskId: null, busy: false };
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
    loadTasks();
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
}

function initialize() {
  const localApi = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://127.0.0.1:8787' : '';
  el('apiBaseInput').value = localApi;
  bindEvents();
}

initialize();
