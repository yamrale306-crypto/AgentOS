'use client';

import { useState } from 'react';
import { AuthForm } from './AuthForm';
import { AppShell } from '@/components/app/AppShell';
import type { AgentOSSession } from '@/lib/useAgentOS';

interface AuthGateProps {
  os: AgentOSSession;
  children: React.ReactNode;
}

/**
 * Renders either the authentication screen (signed out) or the app shell with
 * the page content. `children` are only rendered once the session exists.
 */
export function AuthGate({ os, children }: AuthGateProps) {
  const [authError, setAuthError] = useState<string | null>(null);

  if (os.loading) {
    return (
      <div
        className="app-shell"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}
      >
        <div className="muted">Loading…</div>
      </div>
    );
  }

  if (!os.session) {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div
            className="app-content"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}
          >
            <div className="card" style={{ maxWidth: 420, width: '100%', padding: 32 }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--accent)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    fontWeight: 700,
                    color: '#fff',
                    marginBottom: 16,
                  }}
                >
                  A
                </div>
                <h1 className="heading-1" style={{ marginBottom: 8 }}>
                  Welcome to AgentOS
                </h1>
                <p className="body">Tell AgentOS what you want accomplished. It handles the rest.</p>
              </div>
              <AuthForm
                onSubmit={async (mode, email, password) => {
                  const result = await os.handleAuth(mode, email, password);
                  setAuthError(result);
                  return result;
                }}
                error={authError}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppShell email={os.session.user.email ?? null} onSignOut={os.signOut}>
      {children}
    </AppShell>
  );
}
