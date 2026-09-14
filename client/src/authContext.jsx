import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

function normalizeUser(userData) {
  if (!userData) return null;
  const isDev = userData.username === 'dev' || userData.role === 'DEVELOPER';
  const credits = userData.aiCredits ?? userData.ai_credits ?? (isDev ? 999999 : 50);
  const creditsUsed = userData.aiCreditsUsed ?? userData.ai_credits_used ?? 0;
  return {
    ...userData,
    farmId: userData.farmId ?? userData.farm_id,
    aiCredits: credits,
    ai_credits: credits,
    aiCreditsUsed: creditsUsed,
    ai_credits_used: creditsUsed,
    role: userData.role || (userData.username === 'dev' ? 'DEVELOPER' : 'USER'),
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'));
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem('refresh_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      // Verify token and fetch user
      fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
        .then((res) => res.json())
        .then(async (data) => {
          if (data.success) {
            setUser(normalizeUser(data.user));
          } else if (refreshToken) {
            // Attempt token renewal
            const refRes = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });
            const refData = await refRes.json();
            if (refData.success && refData.accessToken) {
              localStorage.setItem('auth_token', refData.accessToken);
              setToken(refData.accessToken);
              const retry = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${refData.accessToken}` },
              }).then((r) => r.json());
              if (retry.success) setUser(normalizeUser(retry.user));
            } else {
              logout();
            }
          } else {
            logout();
          }
        })
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (username, password, { forceDisconnect = false } = {}) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, forceDisconnect }),
    });

    const data = await res.json();

    if (res.status === 409 && data.error === 'SESSION_CONFLICT') {
      return { conflict: true, deviceType: data.deviceType, message: data.message };
    }

    if (data.success) {
      const accToken = data.accessToken || data.token;
      localStorage.setItem('auth_token', accToken);
      setToken(accToken);
      if (data.refreshToken) {
        localStorage.setItem('refresh_token', data.refreshToken);
        setRefreshToken(data.refreshToken);
      }
      setUser(normalizeUser(data.user));
      return { success: true };
    }

    return { success: false, error: data.error };
  };

  const register = async (username, email, password, farmId) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, farmId }),
    });

    const data = await res.json();

    if (data.success) {
      const accToken = data.accessToken || data.token;
      localStorage.setItem('auth_token', accToken);
      setToken(accToken);
      if (data.refreshToken) {
        localStorage.setItem('refresh_token', data.refreshToken);
        setRefreshToken(data.refreshToken);
      }
      setUser(normalizeUser(data.user));
      return { success: true };
    }

    return { success: false, error: data.error };
  };

  const logout = () => {
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    setToken(null);
    setRefreshToken(null);
    setUser(null);
  };

  const setAiCredits = (credits) => {
    setUser((prev) => (prev ? { ...prev, aiCredits: credits, ai_credits: credits } : prev));
  };

  const updateFarmId = async (farmId) => {
    const res = await fetch('/api/auth/farm', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ farmId }),
    });

    const data = await res.json();

    if (data.success && user) {
      const savedId = data.farmId ?? farmId;
      setUser({ ...user, farmId: savedId, farm_id: savedId });
      return { success: true };
    }

    return { success: false, error: data.error };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        updateFarmId,
        setAiCredits,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
