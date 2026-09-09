'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentOS } from '@/lib/useAgentOS';
import { AuthGate } from '@/components/AuthGate';
import { TaskList } from '@/components/TaskList';
import { TaskDetail } from '@/components/TaskDetail';
import { ApiError } from '@/lib/api';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusDot } from '@/components/ui/StatusDot';
import { Badge } from '@/components/ui/Badge';
import { isActiveStatus } from '@/lib/types';
import type { Task, TaskListItem } from '@/lib/types';

type Filter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function matchesFilter(t: TaskListItem, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return isActiveStatus(t.status);
    case 'completed':
      return t.status === 'completed';
    case 'failed':
      return t.status === 'failed';
    case 'cancelled':
      return t.status === 'cancelled';
  }
}

export default function TasksPage() {
  const os = useAgentOS();
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { api } = os;

  const refreshTasks = useCallback(async () => {
    if (!api) return;
    try {
      setTasks(await api.listTasks(100));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks.');
    }
  }, [api]);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  const anyActive = tasks.some((t) => isActiveStatus(t.status));

  useEffect(() => {
    if (!api || !anyActive) return;
    const id = window.setInterval(refreshTasks, 2200);
    return () => window.clearInterval(id);
  }, [api, anyActive, refreshTasks]);

  const filtered = useMemo(() => tasks.filter((t) => matchesFilter(t, filter)), [tasks, filter]);

  const selectTask = useCallback(
    async (id: string) => {
      if (!api) return;
      try {
        setSelected(await api.getTask(id));
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setSelected(null);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load task.');
        }
      }
    },
    [api]
  );

  const cancelTask = useCallback(async () => {
    if (!api || !selected) return;
    try {
      await api.cancelTask(selected.id);
      await refreshTasks();
      setSelected(await api.getTask(selected.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel task.');
    }
  }, [api, selected, refreshTasks]);

  const retryTask = useCallback(async () => {
    if (!api || !selected) return;
    setBusy(true);
    try {
      const created = await api.retryTask(selected.id);
      await refreshTasks();
      setSelected(await api.getTask(created.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to retry task.');
    } finally {
      setBusy(false);
    }
  }, [api, selected, refreshTasks]);

  const deleteTask = useCallback(async () => {
    if (!api || !selected) return;
    if (!window.confirm('Delete this task permanently?')) return;
    setBusy(true);
    try {
      await api.deleteTask(selected.id);
      setSelected(null);
      await refreshTasks();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete task.');
    } finally {
      setBusy(false);
    }
  }, [api, selected, refreshTasks]);

  return (
    <AuthGate os={os}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="display" style={{ marginBottom: 8 }}>Tasks</h1>
        <p className="body" style={{ maxWidth: 600 }}>
          View and manage all your tasks. Filter by status to focus on active, completed, or failed work.
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: 20 }}>
          <ErrorState message={error} onRetry={refreshTasks} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`btn ${filter === f.value ? 'btn-primary' : 'btn-ghost'} btn-sm`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={tasks.length === 0 ? 'No tasks yet' : 'Nothing matches this filter'}
          message={
            tasks.length === 0
              ? 'Tasks will appear here once you start working with AgentOS.'
              : 'Try a different status filter to see more tasks.'
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="heading-3" style={{ margin: 0 }}>
                {filter === 'all' ? 'All tasks' : `${filter[0].toUpperCase()}${filter.slice(1)}`} ({filtered.length})
              </h3>
            </div>
            <TaskList tasks={filtered} selectedId={selected?.id ?? null} onSelect={selectTask} />
          </section>

          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
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
                  <Badge
                    variant={
                      selected.status === 'completed'
                        ? 'success'
                        : selected.status === 'failed'
                          ? 'error'
                          : selected.status === 'cancelled'
                            ? 'default'
                            : 'info'
                    }
                  >
                    {selected.status}
                  </Badge>
                </div>
              )}
            </div>
            <div style={{ padding: 20 }}>
              <TaskDetail
                task={selected}
                busy={busy}
                onCancel={cancelTask}
                onRetry={retryTask}
                onDelete={deleteTask}
              />
            </div>
          </section>
        </div>
      )}
    </AuthGate>
  );
}
