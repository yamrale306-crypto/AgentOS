import { useState, type FormEvent } from 'react';
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

export type AuthMode = 'signin' | 'signup';

interface AuthFormProps {
  onSubmit: (mode: AuthMode, email: string, password: string) => Promise<string | null>;
  error?: string | null;
  onContinueAsGuest?: () => void;
}

export function AuthForm({ onSubmit, error, onContinueAsGuest }: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const resultMessage = await onSubmit(mode, email, password);
      setMessage(resultMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="auth-modal-card" className="w-full max-w-md mx-auto">
      <div className="p-6 sm:p-8 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-sm">
        {/* Mode Switcher Tabs */}
        <div className="flex p-1 rounded-xl bg-slate-950/80 border border-slate-800/80 mb-6">
          <button
            id="auth-tab-signin"
            type="button"
            onClick={() => {
              setMode('signin');
              setMessage(null);
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === 'signin'
                ? 'bg-slate-850 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign in
          </button>
          <button
            id="auth-tab-signup"
            type="button"
            onClick={() => {
              setMode('signup');
              setMessage(null);
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === 'signup'
                ? 'bg-slate-850 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create account
          </button>
        </div>

        <div className="mb-5">
          <h2 className="text-lg font-bold text-slate-100 tracking-tight">
            {mode === 'signin' ? 'Welcome back to AgentOS' : 'Create your AgentOS account'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {mode === 'signin'
              ? 'Enter your credentials to access your autonomous research tasks.'
              : 'Sign up to persist research history and sync sources across devices.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email input */}
          <div>
            <label htmlFor="auth-email-input" className="block text-xs font-medium text-slate-300 mb-1.5">
              Email address
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                id="auth-email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="researcher@example.com"
                type="email"
                autoComplete="email"
                required
                className="w-full pl-10 pr-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/20 transition-colors"
              />
            </div>
          </div>

          {/* Password input */}
          <div>
            <label htmlFor="auth-password-input" className="block text-xs font-medium text-slate-300 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                id="auth-password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                type={showPassword ? 'text' : 'password'}
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                className="w-full pl-10 pr-10 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/20 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {message && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
              {message}
            </div>
          )}

          {/* Submit button */}
          <button
            id="auth-submit-btn"
            type="submit"
            disabled={busy || !email || password.length < 6}
            className="w-full py-2.5 rounded-xl font-medium text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin text-white" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>{mode === 'signin' ? 'Sign in to AgentOS' : 'Create AgentOS Account'}</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        {/* Guest mode option */}
        {onContinueAsGuest && (
          <div className="mt-5 pt-4 border-t border-slate-800 text-center">
            <button
              id="auth-guest-mode-btn"
              type="button"
              onClick={onContinueAsGuest}
              className="text-xs text-slate-400 hover:text-blue-400 font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles size={13} className="text-amber-400" />
              <span>Explore as Guest in Local Agent Sandbox</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
