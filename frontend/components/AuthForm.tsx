'use client';

import { useState } from 'react';

export type AuthMode = 'signin' | 'signup';

interface AuthFormProps {
  onSubmit: (mode: AuthMode, email: string, password: string) => Promise<string | null>;
  error?: string | null;
}

export function AuthForm({ onSubmit, error }: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const message = await onSubmit(mode, email, password);
      setMessage(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        type="email"
        autoComplete="email"
        required
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (at least 6 characters)"
        type="password"
        minLength={6}
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        required
      />
      <div className="actions">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? 'Create account' : 'Back to sign in'}
        </button>
      </div>
      {error && <p className="banner error-banner">{error}</p>}
      {message && <p className="muted auth-message">{message}</p>}
    </form>
  );
}