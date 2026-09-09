'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentOS } from '@/lib/useAgentOS';
import { AuthGate } from '@/components/AuthGate';
import { SourceList } from '@/components/SourceList';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import type { Task, TaskListItem } from '@/lib/types';

interface Artifact {
  taskId: string;
  title: string;
  prompt: string;
  result: string;
  sources: Task['sources'];
  completedAt: string | null;
  stepsUsed: number;
  searchesUsed: number;
  modelUsed: string | null;
  providerUsed: string | null;
}

export default function ArtifactsPage() {
  const os = useAgentOS();
  const { api } = os;
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadArtifacts = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      setTasks(await api.listTasks(100));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load artifacts.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  // Fetch full records for completed tasks so we can surface their results as artifacts.
  useEffect(() => {
    const completed = tasks.filter((t) => t.status === 'completed');
    if (completed.length === 0) {
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const loaded: Artifact[] = [];
      for (const t of completed) {
        try {
          const full: Task = await api!.getTask(t.id);
          loaded.push({
            taskId: full.id,
            title: full.prompt.length > 80 ? `${full.prompt.slice(0, 80)}…` : full.prompt,
            prompt: full.prompt,
            result: full.result ?? '',
            sources: full.sources || [],
            completedAt: full.completed_at ?? null,
            stepsUsed: full.steps_used ?? 0,
            searchesUsed: full.searches_used ?? 0,
            modelUsed: full.model_used ?? null,
            providerUsed: full.provider_used ?? null,
          });
        } catch {
          // skip unreadable task
        }
      }
      if (!cancelled) setArtifacts(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [tasks, api]);

  const sortedArtifacts = useMemo(
    () =>
      [...artifacts].sort((a, b) => {
        const at = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bt = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return bt - at;
      }),
    [artifacts]
  );

  return (
    <AuthGate os={os}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="display" style={{ marginBottom: 8 }}>Artifacts</h1>
        <p className="body" style={{ maxWidth: 600 }}>
          Every significant result your agent produces becomes an artifact you can open, review, and reuse.
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: 20 }}>
          <ErrorState message={error} onRetry={loadArtifacts} />
        </div>
      )}

      {loading && sortedArtifacts.length === 0 ? (
        <EmptyState title="Loading artifacts…" message="Fetching your completed results." />
      ) : sortedArtifacts.length === 0 ? (
        <EmptyState
          title="No artifacts yet"
          message="Artifacts appear here when tasks complete. Create a task and the result will show up as an artifact."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="heading-3" style={{ margin: 0 }}>Artifacts ({sortedArtifacts.length})</h3>
            </div>
            <div className="task-list">
              {sortedArtifacts.map((a) => (
                <button
                  key={a.taskId}
                  className={`task-row${selected?.taskId === a.taskId ? ' selected' : ''}`}
                  onClick={() => setSelected(a)}
                  aria-pressed={selected?.taskId === a.taskId}
                >
                  <div className="task-main">
                    <strong className="task-title">{a.title}</strong>
                    <div className="muted task-meta">
                      {a.completedAt ? new Date(a.completedAt).toLocaleString() : ''}
                      {a.providerUsed ? ` · ${a.providerUsed}` : ''}
                      {a.sources.length ? ` · ${a.sources.length} sources` : ''}
                    </div>
                  </div>
                  <Badge variant="success">completed</Badge>
                </button>
              ))}
            </div>
          </section>

          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="heading-3" style={{ margin: 0 }}>Artifact detail</h3>
            </div>
            <div style={{ padding: 20 }}>
              {!selected ? (
                <EmptyState message="Select an artifact from the list to review its result and sources." />
              ) : (
                <div>
                  <div className="label" style={{ marginBottom: 6 }}>Prompt</div>
                  <div className="task-title" style={{ marginBottom: 12 }}>{selected.prompt}</div>

                  {selected.result ? (
                    <div className="result-block">
                      <div className="label" style={{ marginBottom: 8 }}>Result</div>
                      <pre>{selected.result}</pre>
                    </div>
                  ) : (
                    <p className="muted" style={{ marginBottom: 12 }}>No result body captured for this task.</p>
                  )}

                  <div className="divider" />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                    <div>{selected.stepsUsed} steps • {selected.searchesUsed} searches</div>
                    {selected.modelUsed && <div>Model: <span className="code">{selected.modelUsed}</span></div>}
                    {selected.completedAt && <div>finished {new Date(selected.completedAt).toLocaleString()}</div>}
                  </div>

                  <SourceList sources={selected.sources || []} />
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </AuthGate>
  );
}
