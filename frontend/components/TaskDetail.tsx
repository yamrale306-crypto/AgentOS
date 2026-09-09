import { TaskProgress } from './TaskProgress';
import { SourceList } from './SourceList';
import { EmptyState } from './EmptyState';
import { AgentActivity } from './AgentActivity';
import { isActiveStatus, type Task } from '@/lib/types';

interface TaskDetailProps {
  task: Task | null;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
}

function hasPlan(plan: Task['plan']): plan is { goal: string; steps: string[] } {
  return !!plan && typeof plan === 'object' && !!(plan as { goal?: string }).goal;
}

export function TaskDetail({ task, busy, onCancel, onRetry, onDelete }: TaskDetailProps) {
  if (!task) {
    return <EmptyState message="Select a task from the list to see its progress, result, and sources." />;
  }

  const active = isActiveStatus(task.status);

  return (
    <div className="task-workspace">
      <div className="task-sidebar-panel">
        <AgentActivity lifecycle={task.lifecycle || []} tools={task.tools} currentStep={task.current_step} />

        <div style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>Model</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            {task.model_mode && <div>Mode: <span style={{ color: 'var(--text)' }}>{task.model_mode}</span></div>}
            {task.model_used && <div>Model: <span className="code">{task.model_used}</span></div>}
            {task.provider_used && <div>Provider: <span style={{ color: 'var(--text)' }}>{task.provider_used}</span></div>}
            {task.fallback_used !== null && (
              <div>
                <span className={`status-dot ${task.fallback_used ? 'status-dot-warning' : 'status-dot-success'}`} style={{ marginRight: 6 }} />
                {task.fallback_used ? 'Fallback used' : 'Primary used'}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active && (
              <button className="btn danger" onClick={onCancel} disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Working…' : 'Stop'}
              </button>
            )}
            {task.status === 'failed' && (
              <button className="btn" onClick={onRetry} disabled={busy} style={{ width: '100%' }}>
                Retry
              </button>
            )}
            {!active && (
              <button className="btn secondary" onClick={onDelete} disabled={busy} style={{ width: '100%' }}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="task-main-panel">
        <div className="task-header">
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Task</div>
            <div className="task-title">{task.prompt}</div>
          </div>
          <div className="task-meta-row">
            <span className={`badge ${task.status === 'completed' ? 'badge-success' : task.status === 'failed' ? 'badge-error' : task.status === 'cancelled' ? 'badge-default' : 'badge-info'}`}>
              {task.status}
            </span>
          </div>
        </div>

        {active && <TaskProgress currentStep={task.current_step} />}

        {hasPlan(task.plan) && (
          <div className="plan-box">
            <div className="label" style={{ marginBottom: 8 }}>Plan</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{task.plan.goal}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {task.plan.steps.map((step, index) => (
                <div key={index} className="plan-step">
                  <span className="plan-step-num">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {task.status === 'completed' && task.result && (
          <div className="result-block">
            <div className="label" style={{ marginBottom: 8 }}>Result</div>
            <pre>{task.result}</pre>
          </div>
        )}

        {task.status === 'failed' && (
          <div className="result-block" style={{ borderColor: 'var(--error)', background: 'var(--error-soft)' }}>
            <div className="label" style={{ marginBottom: 8, color: 'var(--error)' }}>Error</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{task.error || 'The task failed. Try again.'}</div>
          </div>
        )}

        {task.status === 'cancelled' && (
          <div className="result-block" style={{ borderColor: 'var(--border-strong)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Task cancelled by request.</div>
          </div>
        )}

        <div className="divider" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          <div>{task.steps_used || 0} steps • {task.searches_used || 0} searches</div>
          {task.completed_at && <div>finished {new Date(task.completed_at).toLocaleString()}</div>}
          {task.artifact && (
            <div style={{ marginTop: 4 }}>
              Artifact: <span style={{ color: 'var(--accent)' }}>{task.artifact.title || task.artifact.type}</span>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <SourceList sources={task.sources || []} />
        </div>
      </div>
    </div>
  );
}