const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

const get = (p) => fetch(`/api/${p}`, {
  headers: getAuthHeaders()
}).then((r) => r.json());

export const api = {
  farm: () => get("farm"),
  market: () => get("market"),
  planner: () => get("planner"),
  activity: () => get("activity"),
  chat: (message, sessionId) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ message, sessionId }),
    }).then((r) => r.json()),
  sessions: () => get("sessions"),
  session: (id) => get(`sessions/${id}`),
};
