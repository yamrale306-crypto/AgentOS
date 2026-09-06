'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase';
import { createApi, ApiError, type ApiClient } from '@/lib/api';
import { isActiveStatus, type Task, type TaskListItem } from '@/lib/types';
import { Header } from '@/components/Header';
import { AuthForm, type AuthMode } from '@/components/AuthForm';
import { TaskComposer } from '@/components/TaskComposer';
import { TaskList } from '@/components/TaskList';
import { TaskDetail } from '@/components/TaskDetail';
import { ErrorState } from '@/components/ErrorState';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export default function Home() {
  const [supabase] = useState<SupabaseClient | null>(() => {
    if (typeof window === 'undefined') return null;
    return getSupabaseBrowser();
  });
  const api: ApiClient | null = useMemo(() => (supabase ? createApi(supabase) : null), [supabase]);

  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setTasks([]);
        setSelectedId(null);
        setSelected(null);
        setBanner(null);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  const refreshAll = useCallback(async () => {
    if (!api) return;
    const id = selectedIdRef.current;
    try {
      setTasks(await api.listTasks());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await supabase?.auth.signOut();
      } else {
        setBanner(errorMessage(e));
      }
      return;
    }
    if (id) {
      try {
        setSelected(await api.getTask(id));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await supabase?.auth.signOut();
        } else if (e instanceof ApiError && e.status === 404) {
          setSelectedId(null);
          setSelected(null);
        } else {
          setBanner(errorMessage(e));
        }
      }
    }
  }, [api, supabase]);

  const anyActive =
    tasks.some((t) => isActiveStatus(t.status)) || (selected ? isActiveStatus(selected.status) : false);

  useEffect(() => {
    if (!session || !api) return;
    refreshAll();
    if (!anyActive) return;
    const id = window.setInterval(refreshAll, 2200);
    return () => window.clearInterval(id);
  }, [session, anyActive, refreshAll, api]);

  const selectTask = useCallback(
    async (id: string) => {
      if (!api) return;
      if (id === selectedIdRef.current) return;
      setSelectedId(id);
      try {
        setSelected(await api.getTask(id));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await supabase?.auth.signOut();
        } else {
          setBanner(errorMessage(e));
        }
      }
    },
    [api, supabase]
  );

  const submitPrompt = useCallback(
    async (prompt: string) => {
      if (!api) return;
      setBanner(null);
      setBusy(true);
      try {
        const created = await api.createTask(prompt);
        selectedIdRef.current = created.id;
        setSelectedId(created.id);
        setSelected(await api.getTask(created.id));
        await refreshAll();
      } catch (e) {
        setBanner(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [api, refreshAll]
  );

  const cancelSelected = useCallback(async () => {
    if (!api || !selectedId) return;
    setBanner(null);
    setBusy(true);
    try {
      await api.cancelTask(selectedId);
      await refreshAll();
    } catch (e) {
      setBanner(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [api, refreshAll, selectedId]);

  const retrySelected = useCallback(async () => {
    if (!api || !selectedId) return;
    setBanner(null);
    setBusy(true);
    try {
      const created = await api.retryTask(selectedId);
      selectedIdRef.current = created.id;
      setSelectedId(created.id);
      setSelected(await api.getTask(created.id));
      await refreshAll();
    } catch (e) {
      setBanner(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [api, refreshAll, selectedId]);

  const deleteSelected = useCallback(async () => {
    if (!api || !selectedId) return;
    if (!window.confirm('Delete this task permanently?')) return;
    setBanner(null);
    setBusy(true);
    try {
      await api.deleteTask(selectedId);
      setSelectedId(null);
      setSelected(null);
      await refreshAll();
    } catch (e) {
      setBanner(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [api, refreshAll, selectedId]);

  const handleAuth = useCallback(
    async (mode: AuthMode, email: string, password: string): Promise<string | null> => {
      if (!supabase) return null;
      setAuthError(null);
      const { error } =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (error) {
        setAuthError(error.message);
        return null;
      }
      return mode === 'signup' ? 'Check your email to confirm your account, then sign in.' : null;
    },
    [supabase]
  );

  const signOut = useCallback(() => {
    supabase?.auth.signOut();
  }, [supabase]);

  if (!session) {
    return (
      <main className="app">
        <Header email={null} onSignOut={signOut} />
        <section className="card hero">
          <h1 className="hero-title">Give AI a goal.</h1>
          <h1 className="hero-title">Get the finished result.</h1>
          <p className="muted hero-sub">
            AgentOS plans the research, searches the web, analyzes what it finds, and verifies the answer — with
            sources you can check.
          </p>
          <AuthForm onSubmit={handleAuth} error={authError} />
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <Header email={session.user.email ?? null} onSignOut={signOut} />

      {banner && <ErrorState message={banner} />}

      <section className="card hero">
        <h1>What should I do?</h1>
        <p className="muted">Describe the outcome. The agent figures out the research steps.</p>
        <TaskComposer onSubmit={submitPrompt} />
      </section>

      <div className="grid">
        <section className="card">
          <h2>Recent tasks</h2>
          <TaskList tasks={tasks} selectedId={selectedId} onSelect={selectTask} />
        </section>

        <section className="card">
          <h2>Task</h2>
          <TaskDetail
            task={selected}
            busy={busy}
            onCancel={cancelSelected}
            onRetry={retrySelected}
            onDelete={deleteSelected}
          />
        </section>
      </div>
    </main>
  );
}