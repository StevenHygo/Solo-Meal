import { dataSourceConfig } from '../config.js';

function runtimeOptions() {
  const query = new URLSearchParams(window.location.search);
  const mode = query.get('dataSource') === 'api' ? 'api' : dataSourceConfig.defaultMode;
  const localApi = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://127.0.0.1:8787' : '';
  const apiBaseUrl = (query.get('apiBase') || dataSourceConfig.apiBaseUrl || localApi).replace(/\/$/, '');
  return { mode, apiBaseUrl };
}

async function request(path, init = {}) {
  const { apiBaseUrl } = runtimeOptions();
  if (!apiBaseUrl) throw new Error('API_BASE_URL_MISSING');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dataSourceConfig.timeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.code || `API_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = {
  options: runtimeOptions,
  searchRestaurants: payload => request('/api/v1/restaurants/search', { method: 'POST', body: JSON.stringify(payload) }),
  getRestaurant: id => request(`/api/v1/restaurants/${encodeURIComponent(id)}`),
  submitFeedback: payload => request('/api/v1/feedback-reports', { method: 'POST', body: JSON.stringify(payload) })
};
