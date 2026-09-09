import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'));
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
        .then((data) => {
          if (data.success) {
            setUser(data.user);
          } else {
            // Invalid token
            localStorage.removeItem('auth_token');
            setToken(null);
          }
        })
        .catch(() => {
          localStorage.removeItem('auth_token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (data.success) {
      localStorage.setItem('auth_token', data.token);
      setToken(data.token);
      setUser(data.user);
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
      localStorage.setItem('auth_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    }

    return { success: false, error: data.error };
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
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
      // Use the server-returned farmId (it may have been normalised, e.g. trimmed)
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
