const TOKEN_KEY = 'teamroom_token';
const LEGACY_TOKEN_KEY = 'nexa_token'; // pre-rebrand sessions stay valid

export function getToken() { return localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(LEGACY_TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(LEGACY_TOKEN_KEY); }

async function request(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  get: (url) => request(url),
  post: (url, data) => request(url, { method: 'POST', body: JSON.stringify(data || {}) }),
  patch: (url, data) => request(url, { method: 'PATCH', body: JSON.stringify(data || {}) }),
  del: (url) => request(url, { method: 'DELETE' }),
  async upload(file, projectId) {
    const fd = new FormData();
    fd.append('file', file);
    if (projectId) fd.append('projectId', projectId);
    const token = getToken();
    const res = await fetch('/api/files', { method: 'POST', body: fd, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Upload failed');
    return body;
  },
  downloadUrl(id) { return `/api/files/${id}/download`; }
};

// ---- Auth helpers stored in localStorage for UI state ----
const USER_KEY = 'teamroom_user';
const LEGACY_USER_KEY = 'nexa_user';
export const getStoredUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) ?? localStorage.getItem(LEGACY_USER_KEY)); } catch { return null; } };
export const setStoredUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));
export const clearStoredUser = () => { localStorage.removeItem(USER_KEY); localStorage.removeItem(LEGACY_USER_KEY); };
