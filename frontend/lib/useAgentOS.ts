'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { getSupabaseBrowser } from './supabase';
import { createApi, type ApiClient } from './api';

export interface AgentOSSession {
  /** The browser Supabase client; null before hydration. */
  supabase: SupabaseClient | null;
  /** The authenticated session; null when signed out. */
  session: Session | null;
  /** API client bound to the current session; null until both supabase + session exist. */
  api: ApiClient | null;
  /** True while initial session restoration is pending. */
  loading: boolean;
  /** Sign in / sign up. Returns an informational success message or null. */
  handleAuth: (mode: 'signin' | 'signup', email: string, password: string) => Promise<string | null>;
  /** Clears the session / redirects to the auth gate. */
  signOut: () => void;
}

/**
 * Shared client-side auth + API wiring for every authenticated page.
 * Pages render a loading state while `loading` is true, an auth gate when
 * `session` is null, and the app shell + content once `api` is available.
 */
export function useAgentOS(): AgentOSSession {
  const [supabase] = useState<SupabaseClient | null>(() => {
    if (typeof window === 'undefined') return null;
    return getSupabaseBrowser();
  });
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setLoading(false));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  const api: ApiClient | null = useMemo(() => (supabase ? createApi(supabase) : null), [supabase]);

  const handleAuth = useCallback(
    async (mode: 'signin' | 'signup', email: string, password: string): Promise<string | null> => {
      if (!supabase) return null;
      const { error } =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (error) return error.message;
      return mode === 'signup'
        ? 'Check your email to confirm your account, then sign in.'
        : null;
    },
    [supabase]
  );

  const signOut = useCallback(() => {
    supabase?.auth.signOut();
  }, [supabase]);

  return { supabase, session, api, loading, handleAuth, signOut };
}
