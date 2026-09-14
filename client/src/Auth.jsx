import { useState, useEffect } from 'react';
import { useAuth } from './authContext';

function useAuthTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark');
      document.body.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.remove('dark');
      document.body.classList.add('light');
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  return { theme, toggleTheme };
}

import { SessionConflictModal } from './components/SessionConflictModal.jsx';

export function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState(null);

  const { theme, toggleTheme } = useAuthTheme();
  const { login, register } = useAuth();

  const handleConfirmForceDisconnect = async () => {
    setConflict(null);
    setLoading(true);
    try {
      const result = await login(username, password, { forceDisconnect: true });
      if (!result.success) {
        setError(result.error || 'Authentication failed');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let result;
      if (isLogin) {
        result = await login(username, password);
        if (result?.conflict) {
          setConflict({ deviceType: result.deviceType, message: result.message });
          setLoading(false);
          return;
        }
      } else {
        if (!email) {
          setError('Email is required');
          setLoading(false);
          return;
        }
        result = await register(username, email, password, null);
      }

      if (!result.success) {
        setError(result.error || 'Authentication failed');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#faf9f6] dark:bg-[#191919] text-[#1a1a1a] dark:text-[#e6e6e6] p-4 selection:bg-[#705335] transition-colors duration-200">
      {/* Subtle obsidian ambient glow behind card */}
      <div className="w-full max-w-md relative">
        <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500/10 via-purple-600/10 to-amber-500/10 blur-xl opacity-60 pointer-events-none" />

        <div className="relative bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/80 overflow-hidden transition-colors duration-200">
          {/* Obsidian Window Header Bar */}
          <div className="h-9 px-4 bg-[#f4f3ef] dark:bg-[#181818] border-b border-black/5 dark:border-white/5 flex items-center justify-between text-xs text-[#787774] dark:text-[#888888] select-none">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/60 inline-block"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60 inline-block"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/60 inline-block"></span>
              <span className="ml-2 font-mono text-[11px] text-[#888] dark:text-[#777777]">vault.sunflower-ai</span>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-xs transition-colors"
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              >
                {theme === 'light' ? '🌙' : '☀️'}
              </button>
              <span className="text-[11px] text-[#999] dark:text-[#666666] font-mono">v2.4</span>
            </div>
          </div>

          <div className="p-5 md:p-8">
            {/* Header / Vault Emblem */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-black/5 dark:bg-[#262626] border border-black/10 dark:border-white/10 shadow-inner mb-3.5 group">
                <span className="text-2xl transition-transform duration-200 group-hover:scale-110">🌻</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-[#1a1a1a] dark:text-white flex items-center justify-center gap-2 font-display">
                <span>SFL Shanty</span>
                <span className="text-[11px] font-mono font-normal uppercase px-1.5 py-0.5 rounded bg-amber-500/15 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 dark:border-amber-500/20">Vault</span>
              </h1>
              <p className="text-xs text-[#787774] dark:text-[#8e8e8e] mt-1.5">
                {isLogin ? 'Unlock your personal workspace & farm intelligence' : 'Create an isolated workspace & command center'}
              </p>
            </div>

            {/* Segmented Mode Switcher */}
            <div className="grid grid-cols-2 p-1 bg-black/5 dark:bg-[#161616] rounded-xl border border-black/5 dark:border-white/5 mb-6 text-xs font-medium">
              <button
                type="button"
                onClick={() => { setIsLogin(true); setError(''); }}
                className={`py-2 rounded-lg transition-all ${isLogin ? 'bg-white dark:bg-[#2b2b2b] text-[#1a1a1a] dark:text-white shadow-sm font-semibold' : 'text-[#787774] dark:text-[#888888] hover:text-[#1a1a1a] dark:hover:text-white'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setIsLogin(false); setError(''); }}
                className={`py-2 rounded-lg transition-all ${!isLogin ? 'bg-white dark:bg-[#2b2b2b] text-[#1a1a1a] dark:text-white shadow-sm font-semibold' : 'text-[#787774] dark:text-[#888888] hover:text-[#1a1a1a] dark:hover:text-white'}`}
              >
                New Account
              </button>
            </div>

            {/* Error callout */}
            {error && (
              <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#787774] dark:text-[#aaaaaa] mb-1.5 flex items-center justify-between">
                  <span>Username</span>
                  <span className="font-mono text-[10px] text-[#999] dark:text-[#666666]">required</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-black/[0.03] dark:bg-[#161616] border border-black/10 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-[#1a1a1a] dark:text-white placeholder-[#999] dark:placeholder-[#555555] outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all font-sans"
                    placeholder="e.g. subhradip"
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-xs font-medium text-[#787774] dark:text-[#aaaaaa] mb-1.5 flex items-center justify-between">
                    <span>Email Address</span>
                    <span className="font-mono text-[10px] text-[#999] dark:text-[#666666]">private</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-black/[0.03] dark:bg-[#161616] border border-black/10 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-[#1a1a1a] dark:text-white placeholder-[#999] dark:placeholder-[#555555] outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all font-sans"
                    placeholder="you@domain.com"
                    required
                    autoComplete="email"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#787774] dark:text-[#aaaaaa] mb-1.5 flex items-center justify-between">
                  <span>Password</span>
                  {!isLogin && <span className="font-mono text-[10px] text-[#999] dark:text-[#666666]">min 6 chars</span>}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black/[0.03] dark:bg-[#161616] border border-black/10 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-[#1a1a1a] dark:text-white placeholder-[#999] dark:placeholder-[#555555] outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all font-sans"
                  placeholder="••••••••"
                  required
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold text-sm rounded-xl py-2.5 transition-all shadow-lg shadow-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.99]"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin"></span>
                    <span>Synchronizing...</span>
                  </span>
                ) : (
                  <span>{isLogin ? 'Open Workspace ↵' : 'Create Vault & Continue ↵'}</span>
                )}
              </button>
            </form>

            {/* Demo Mode / Callout */}
            {isLogin && (
              <div className="mt-6 pt-4 border-t border-black/5 dark:border-white/5">
                <div className="rounded-xl bg-black/[0.02] dark:bg-[#181818] border border-black/5 dark:border-white/5 p-3 text-[11px] text-[#787774] dark:text-[#888888] flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="text-amber-500">💡</span>
                    <span>Demo Account:</span>
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => { setUsername('demo'); setPassword('demo123'); }}
                      className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/20 transition-colors"
                    >
                      Fill demo / demo123
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-[#888] dark:text-[#555555] font-mono">
          SFL Shanty · Hybrid Notion Workspace + Obsidian Engine
        </div>
      </div>

      {conflict && (
        <SessionConflictModal
          deviceType={conflict.deviceType}
          onCancel={() => setConflict(null)}
          onConfirm={handleConfirmForceDisconnect}
        />
      )}
    </div>
  );
}
