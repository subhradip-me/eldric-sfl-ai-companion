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

const get = (p) => fetch(`/api/${p}`, {
  headers: getAuthHeaders()
}).then((r) => r.json());

export const api = {
  farm: () => get("farm"),
  market: () => get("market"),
  planner: () => get("planner"),
  activity: () => get("activity"),
  recipes: () => get("recipes"),

  chat: (message, sessionId) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ message, sessionId }),
    }).then((r) => r.json()),
  sessions: () => get("sessions").then((r) => (Array.isArray(r) ? r : (r?.sessions ?? []))),
  session: (id) => get(`sessions/${id}`).then((r) => (Array.isArray(r) ? r : (r?.messages ?? []))),
};
