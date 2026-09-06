import { useState } from 'react';
import { useAuth } from './authContext';

export function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [farmId, setFarmId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let result;
      if (isLogin) {
        result = await login(username, password);
      } else {
        if (!email) {
          setError('Email is required');
          setLoading(false);
          return;
        }
        result = await register(username, email, password, farmId || null);
      }

      if (!result.success) {
        setError(result.error || 'Authentication failed');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] dark:bg-[#000000] transition-colors">
      <div className="w-full max-w-md p-8 bg-white dark:bg-[#212121] rounded-2xl border border-slate-200 dark:border-[#424242] shadow-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-[#424242] flex items-center justify-center text-3xl">
            🌻
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isLogin ? 'Login to your Sunflower AI account' : 'Get started with Sunflower AI'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-[#424242] text-red-600 dark:text-red-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#303030] border border-slate-200 dark:border-[#424242] rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-yellow-400 dark:focus:border-yellow-600 transition-colors"
              placeholder="Enter your username"
              required
              autoComplete="username"
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#303030] border border-slate-200 dark:border-[#424242] rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-yellow-400 dark:focus:border-yellow-600 transition-colors"
                placeholder="Enter your email"
                required
                autoComplete="email"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#303030] border border-slate-200 dark:border-[#424242] rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-yellow-400 dark:focus:border-yellow-600 transition-colors"
              placeholder="Enter your password"
              required
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={6}
            />
            {!isLogin && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Minimum 6 characters
              </p>
            )}
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Sunflower Farm ID <span className="text-slate-400">(Optional)</span>
              </label>
              <input
                type="text"
                value={farmId}
                onChange={(e) => setFarmId(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#303030] border border-slate-200 dark:border-[#424242] rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-yellow-400 dark:focus:border-yellow-600 transition-colors"
                placeholder="Your farm ID (can add later)"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold rounded-xl py-3 transition-colors shadow-sm"
          >
            {loading ? 'Please wait...' : isLogin ? 'Login' : 'Create Account'}
          </button>
        </form>

        {/* Toggle */}
        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Login'}
          </button>
        </div>

        {/* Demo Mode */}
        {isLogin && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-[#424242]">
            <p className="text-xs text-center text-slate-500 dark:text-slate-400">
              Demo credentials: username: <code className="bg-slate-100 dark:bg-[#303030] px-1.5 py-0.5 rounded">demo</code> / password: <code className="bg-slate-100 dark:bg-[#303030] px-1.5 py-0.5 rounded">demo123</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
