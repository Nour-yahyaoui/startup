const TOKEN_KEY = 'nexa_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function request(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
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
    // Send scope before the stream; the server also validates fields sent after it.
    if (projectId) fd.append('projectId', projectId);
    fd.append('file', file);
    const token = getToken();
    const res = await fetch('/api/files', { method: 'POST', body: fd, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Upload failed');
    return body;
  },
  async download(id, filename = 'download') {
    // Navigation links cannot attach the bearer token; fetch before saving instead.
    const token = getToken();
    const res = await fetch(`/api/files/${encodeURIComponent(id)}/download`, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Download failed');
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

// ---- Auth helpers stored in localStorage for UI state ----
const USER_KEY = 'nexa_user';
export const getStoredUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } };
export const setStoredUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));
export const clearStoredUser = () => localStorage.removeItem(USER_KEY);
