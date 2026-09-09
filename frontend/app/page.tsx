'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase';
import { createApi, ApiError, type ApiClient } from '@/lib/api';
import { isActiveStatus, type ModelMode, type Task, type TaskListItem } from '@/lib/types';
import { AppShell } from '@/components/app/AppShell';
import { AuthForm, type AuthMode } from '@/components/AuthForm';
import { TaskComposer } from '@/components/TaskComposer';
import { TaskList } from '@/components/TaskList';
import { TaskDetail } from '@/components/TaskDetail';
import { SystemDashboard } from '@/components/SystemDashboard';
import { ErrorState } from '@/components/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusDot } from '@/components/ui/StatusDot';
import { Badge } from '@/components/ui/Badge';

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
  const [showSystem, setShowSystem] = useState(false);

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
    async (prompt: string, options: { mode: ModelMode; model: string | null }) => {
      if (!api) return;
      setBanner(null);
      setBusy(true);
      try {
        const created = await api.createTask(prompt, options);
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
      <div className="app-shell">
        <div className="app-main">
          <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
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
                <p className="body">
                  Tell AgentOS what you want accomplished. It handles the rest.
                </p>
              </div>
              <AuthForm onSubmit={handleAuth} error={authError} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const SUGGESTIONS = [
    'Fix an error in my project',
    'Research a topic',
    'Analyze a document',
    'Create something new',
    'Automate a task',
  ];

  return (
    <AppShell email={session.user.email ?? null} onSignOut={signOut}>
      {banner && <ErrorState message={banner} />}

      <div style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 className="display" style={{ marginBottom: 8 }}>What do you want to get done?</h1>
        <p className="body" style={{ maxWidth: 560, marginBottom: 20 }}>
          Describe the outcome. AgentOS figures out the agent, tools, and workflow needed to complete the task.
        </p>
      </div>
      </div>

      <div className="card" style={{ marginBottom: 24, padding: 20 }}>
        <TaskComposer onSubmit={submitPrompt} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
                if (textarea) {
                  textarea.value = s;
                  textarea.dispatchEvent(new Event('input', { bubbles: true }));
                  textarea.focus();
                }
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <h2 className="heading-2" style={{ margin: 0 }}>
          Recent work
        </h2>
        <span className="muted">{tasks.length} tasks</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h3 className="heading-3" style={{ margin: 0 }}>Tasks</h3>
          </div>
          <TaskList tasks={tasks} selectedId={selectedId} onSelect={selectTask} />
        </section>

        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="heading-3" style={{ margin: 0 }}>Task detail</h3>
            {selected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusDot
                  status={
                    selected.status === 'completed'
                      ? 'success'
                      : selected.status === 'failed'
                        ? 'error'
                        : selected.status === 'cancelled'
                          ? 'neutral'
                          : 'info'
                  }
                  pulse={isActiveStatus(selected.status)}
                />
                <Badge variant={
                  selected.status === 'completed' ? 'success' :
                  selected.status === 'failed' ? 'error' :
                  selected.status === 'cancelled' ? 'default' : 'info'
                }>
                  {selected.status}
                </Badge>
              </div>
            )}
          </div>
          <div style={{ padding: 20 }}>
            <TaskDetail
              task={selected}
              busy={busy}
              onCancel={cancelSelected}
              onRetry={retrySelected}
              onDelete={deleteSelected}
            />
          </div>
        </section>
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowSystem((v) => !v)}
          aria-expanded={showSystem}
        >
          {showSystem ? 'Hide' : 'Show'} System &amp; Diagnostics
        </button>
        {showSystem && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="heading-3" style={{ marginBottom: 12 }}>System &amp; API</h3>
            {api && <SystemDashboard api={api} onError={setBanner} />}
          </div>
        )}
      </div>
    </AppShell>
  );
}
