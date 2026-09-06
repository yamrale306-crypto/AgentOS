import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowser } from './lib/supabase';
import { createApi, ApiError, type ApiClient } from './lib/api';
import { isActiveStatus, type Task, type TaskListItem, type ViewMode } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { TaskComposer } from './components/TaskComposer';
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { AuthForm, type AuthMode } from './components/AuthForm';
import { ErrorState } from './components/ErrorState';
import { SettingsModal } from './components/SettingsModal';
import { Sparkles, Radio, ArrowRight, ShieldCheck, Search, Compass, ExternalLink } from 'lucide-react';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export default function App() {
  const [supabase] = useState<SupabaseClient | null>(() => {
    if (typeof window === 'undefined') return null;
    return getSupabaseBrowser();
  });

  const api: ApiClient = useMemo(() => createApi(supabase), [supabase]);

  const [session, setSession] = useState<Session | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    // Default to true in standalone preview if no Supabase credentials exist
    return !supabase;
  });

  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<ViewMode>('composer');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backendHealthy, setBackendHealthy] = useState(false);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // Check backend health periodically
  useEffect(() => {
    api.isBackendConnected().then(setBackendHealthy);
    const interval = setInterval(() => {
      api.isBackendConnected().then(setBackendHealthy);
    }, 15000);
    return () => clearInterval(interval);
  }, [api]);

  // Auth listener
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSession(data.session);
        setIsGuest(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) {
        setIsGuest(false);
      } else {
        setTasks([]);
        setSelectedId(null);
        setSelected(null);
        setBanner(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  // Data refresh
  const refreshAll = useCallback(async () => {
    const id = selectedIdRef.current;
    try {
      const list = await api.listTasks();
      setTasks(list);
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
        const item = await api.getTask(id);
        setSelected(item);
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
    if (!session && !isGuest) return;
    refreshAll();
    if (!anyActive) return;
    const id = window.setInterval(refreshAll, 2000);
    return () => window.clearInterval(id);
  }, [session, isGuest, anyActive, refreshAll]);

  // If user opens a task, automatically switch to tasks view
  const selectTask = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setActiveView('tasks');
      try {
        const item = await api.getTask(id);
        setSelected(item);
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
      setBanner(null);
      setBusy(true);
      try {
        const created = await api.createTask(prompt);
        selectedIdRef.current = created.id;
        setSelectedId(created.id);
        setActiveView('tasks');
        const item = await api.getTask(created.id);
        setSelected(item);
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
    if (!selectedId) return;
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
    if (!selectedId) return;
    setBanner(null);
    setBusy(true);
    try {
      const created = await api.retryTask(selectedId);
      selectedIdRef.current = created.id;
      setSelectedId(created.id);
      const item = await api.getTask(created.id);
      setSelected(item);
      await refreshAll();
    } catch (e) {
      setBanner(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [api, refreshAll, selectedId]);

  const deleteSelected = useCallback(async () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this research task permanently?')) return;
    setBanner(null);
    setBusy(true);
    try {
      await api.deleteTask(selectedId);
      setSelectedId(null);
      setSelected(null);
      await refreshAll();
      setActiveView('composer');
    } catch (e) {
      setBanner(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [api, refreshAll, selectedId]);

  const handleAuth = useCallback(
    async (mode: AuthMode, email: string, password: string): Promise<string | null> => {
      if (!supabase) {
        // In local mode without Supabase env vars, simulate signin
        setIsGuest(false);
        setSession({
          access_token: 'sandbox-jwt',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'sandbox-refresh',
          user: {
            id: 'sandbox-user',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: new Date().toISOString(),
            email
          }
        } as Session);
        return null;
      }

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
    if (supabase) {
      supabase.auth.signOut();
    } else {
      setSession(null);
      setIsGuest(true);
    }
  }, [supabase]);

  const activeCount = tasks.filter((t) => isActiveStatus(t.status)).length;
  const userEmail = session?.user?.email ?? (isGuest ? 'Guest Researcher' : null);

  // Unauthenticated screen if not in guest mode
  if (!session && !isGuest) {
    return (
      <div className="min-h-screen bg-[#090d14] text-slate-100 flex flex-col justify-between">
        <header className="h-16 border-b border-slate-800/80 px-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
              <Radio size={18} />
            </div>
            <span className="font-bold text-base text-slate-100 tracking-tight font-mono">AgentOS</span>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-8">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Sparkles size={12} />
                <span>Autonomous Web Research Agent</span>
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 tracking-tight">
                Research anything. Verify everything.
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
                AgentOS plans searches, collects sources, evaluates evidence, and provides verifiable citations.
              </p>
            </div>

            <AuthForm
              onSubmit={handleAuth}
              error={authError}
              onContinueAsGuest={() => setIsGuest(true)}
            />
          </div>
        </main>

        <footer className="py-4 border-t border-slate-800/60 text-center text-xs text-slate-500">
          AgentOS • Linear × Perplexity × Raycast design philosophy
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d14] text-slate-100 flex">
      {/* Sidebar Navigation */}
      <Sidebar
        activeView={activeView}
        onSelectView={(view) => {
          setActiveView(view);
          if (view === 'settings') {
            setSettingsOpen(true);
          }
        }}
        onNewResearch={() => {
          setActiveView('composer');
          setSelectedId(null);
          setSelected(null);
        }}
        activeTasksCount={activeCount}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        email={userEmail}
      />

      {/* Primary Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          email={userEmail}
          activeView={activeView}
          onSignOut={signOut}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleSidebar={() => setMobileSidebarOpen(true)}
          backendHealthy={backendHealthy}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {banner && (
            <ErrorState
              message={banner}
              title="Agent Notification"
              onDismiss={() => setBanner(null)}
              onRetry={refreshAll}
            />
          )}

          {/* VIEW 1: COMPOSER & HERO */}
          {activeView === 'composer' && (
            <div className="space-y-8 animate-in fade-in duration-200">
              {/* Hero Section */}
              <div className="pt-2 sm:pt-6 pb-2 text-center max-w-2xl mx-auto space-y-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Radio size={13} className="text-blue-400" />
                  <span>AgentOS</span>
                </div>
                <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-100 leading-tight">
                  Research anything. Get answers you can verify.
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-xl mx-auto">
                  Give AgentOS a goal. It plans the research, searches the web, analyzes the evidence, verifies the result, and shows you the sources.
                </p>
              </div>

              {/* Main Task Composer Surface */}
              <div className="max-w-2xl mx-auto">
                <TaskComposer onSubmit={submitPrompt} disabled={busy} />
              </div>

              {/* Recent Research Showcase */}
              {tasks.length > 0 && (
                <div className="pt-6 border-t border-slate-800/80 max-w-4xl mx-auto space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Compass size={14} className="text-blue-400" />
                      <span>Recent Investigations</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveView('tasks')}
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>View all tasks</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>

                  <TaskList
                    tasks={tasks.slice(0, 5)}
                    selectedId={selectedId}
                    onSelect={selectTask}
                  />
                </div>
              )}
            </div>
          )}

          {/* VIEW 2: ACTIVE TASKS / SPLIT VIEW */}
          {activeView === 'tasks' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in fade-in duration-200">
              {/* Left Column: Tasks List */}
              <div className="lg:col-span-4 rounded-2xl bg-slate-900/60 border border-slate-800 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/80">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Investigations
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('composer');
                      setSelectedId(null);
                      setSelected(null);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                  >
                    + New
                  </button>
                </div>

                <TaskList
                  tasks={tasks}
                  selectedId={selectedId}
                  onSelect={selectTask}
                  onNewResearch={() => setActiveView('composer')}
                />
              </div>

              {/* Right Column: Selected Task Details */}
              <div className="lg:col-span-8 min-w-0">
                <TaskDetail
                  task={selected}
                  busy={busy}
                  onCancel={cancelSelected}
                  onRetry={retrySelected}
                  onDelete={deleteSelected}
                  onNewResearch={() => setActiveView('composer')}
                />
              </div>
            </div>
          )}

          {/* VIEW 3: HISTORY / ARCHIVE */}
          {activeView === 'history' && (
            <div className="space-y-4 max-w-4xl mx-auto animate-in fade-in duration-200">
              <div className="pb-3 border-b border-slate-800/80">
                <h1 className="text-xl font-bold text-slate-100">Research History & Archive</h1>
                <p className="text-xs text-slate-400 mt-1">
                  Full log of completed investigations, verified findings, and source citations.
                </p>
              </div>

              <TaskList
                tasks={tasks}
                selectedId={selectedId}
                onSelect={selectTask}
                onNewResearch={() => setActiveView('composer')}
              />
            </div>
          )}

          {/* VIEW 4: SYSTEM SETTINGS INLINE */}
          {activeView === 'settings' && (
            <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-200">
              <div className="pb-3 border-b border-slate-800/80">
                <h1 className="text-xl font-bold text-slate-100">System & API Status</h1>
                <p className="text-xs text-slate-400 mt-1">
                  Review AgentOS backend connectivity, Supabase configuration, and model specs.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        backendHealthy ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                      }`}
                    />
                    <span className="text-sm font-semibold text-slate-200">
                      Backend Status: {backendHealthy ? 'Connected & Healthy' : 'Local Agent Sandbox'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    Configure Endpoints
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="text-slate-500 font-mono text-[11px] mb-1">AUTH PROVIDER</div>
                    <div className="font-semibold text-slate-200">
                      {supabase ? 'Supabase Auth' : 'Local Sandbox Session'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="text-slate-500 font-mono text-[11px] mb-1">SEARCH ENGINE</div>
                    <div className="font-semibold text-slate-200">DuckDuckGo Sanitized API</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="text-slate-500 font-mono text-[11px] mb-1">PRIMARY MODEL</div>
                    <div className="font-semibold text-slate-200 font-mono">claude-3.7-sonnet / gpt-4o</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="text-slate-500 font-mono text-[11px] mb-1">ACTIVE TASKS</div>
                    <div className="font-semibold text-slate-200">{tasks.length} in store</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={refreshAll}
      />
    </div>
  );
}
