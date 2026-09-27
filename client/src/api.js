/**
 * api.js — Authenticated fetch helpers with automatic token refresh.
 *
 * On any 401/403 response the module:
 *   1. Tries to exchange the stored refresh_token for a new access token.
 *   2. Retries the original request once with the new token.
 *   3. If refresh fails (expired, revoked) it clears auth storage so the
 *      AuthContext's next render will redirect the user to login.
 */

const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  const devModeActive = localStorage.getItem('dev_mode_active') === 'true';
  const devFarmId = localStorage.getItem('dev_override_farm_id');

  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (devModeActive && devFarmId && devFarmId.trim()) {
    headers['x-dev-farm-id'] = devFarmId.trim();
  }
  return headers;
};

/** Attempt to exchange the stored refresh token for a new access token.
 *  Returns the new access token string, or null on failure. */
async function tryRefresh() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json();
    if (data.success && data.accessToken) {
      localStorage.setItem('auth_token', data.accessToken);
      return data.accessToken;
    }
  } catch {
    // Network error during refresh — fall through
  }

  // Refresh failed: clear credentials so AuthContext redirects to login
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  return null;
}

/**
 * Fetch wrapper that transparently handles token expiry.
 * On 401/403 it refreshes the token once and retries.
 */
async function authFetch(url, options = {}) {
  const headers = { ...getAuthHeaders(), ...(options.headers || {}) };
  let res = await fetch(url, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    const newToken = await tryRefresh();
    if (newToken) {
      const retryHeaders = {
        ...getAuthHeaders(), // now includes the new token
        ...(options.headers || {}),
      };
      res = await fetch(url, { ...options, headers: retryHeaders });
    }
  }

  return res.json();
}

const get = (p) => authFetch(`/api/${p}`);

export const api = {
  farm: (force = false) => get(`farm${force ? '?force=true' : ''}`),
  market: () => get('market'),
  planner: () => get('planner'),
  activity: () => get('activity'),
  recipes: () => get('recipes'),

  chat: (message, sessionId, history = []) =>
    authFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId, history }),
    }),

  sessions: () => get('sessions').then((r) => (Array.isArray(r) ? r : (r?.sessions ?? []))),
  session: (id) => get(`sessions/${id}`).then((r) => (Array.isArray(r) ? r : (r?.messages ?? []))),
  dailyProduction: (days = 7) => get(`activity/daily?days=${days}`),
};
