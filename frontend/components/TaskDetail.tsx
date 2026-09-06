import { TaskProgress } from './TaskProgress';
import { SourceList } from './SourceList';
import { EmptyState } from './EmptyState';
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
    <div className="task-detail">
      <div className="detail-header">
        <h3 className="detail-prompt">{task.prompt}</h3>
        <div className="detail-meta">
          <span className={`status status-${task.status}`}>{task.status}</span>
          {task.provider_used && <span className="muted model-badge">{task.provider_used}</span>}
          {task.model_used && <span className="muted model-badge">{task.model_used}</span>}
        </div>
      </div>

      {(task.model_mode || task.fallback_used) && (
        <div className="run-meta muted">
          {task.model_mode && <span>mode: {task.model_mode}</span>}
          {task.model && <span>override: {task.model}</span>}
          {task.fallback_used !== null && <span>{task.fallback_used ? 'fallback used' : 'primary used'}</span>}
        </div>
      )}

      {active && <TaskProgress currentStep={task.current_step} />}

      {hasPlan(task.plan) && (
        <div className="plan">
          <h4>Plan</h4>
          <p className="plan-goal">{task.plan.goal}</p>
          <ol className="plan-steps">
            {task.plan.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {task.status === 'completed' && task.result && (
        <div className="result">
          <h4>Result</h4>
          <pre>{task.result}</pre>
        </div>
      )}

      {task.status === 'failed' && (
        <p className="banner error-banner">{task.error || 'The task failed. Try again.'}</p>
      )}

      {task.status === 'cancelled' && <p className="banner notice-banner">Task cancelled by request.</p>}

      <div className="stats muted">
        <span>{task.steps_used || 0} steps</span>
        <span>{task.searches_used || 0} searches</span>
        {task.completed_at && <span>finished {new Date(task.completed_at).toLocaleString()}</span>}
      </div>

      <div className="actions">
        {active && (
          <button className="btn danger" onClick={onCancel} disabled={busy}>
            {busy ? 'Working…' : 'Stop'}
          </button>
        )}
        {task.status === 'failed' && (
          <button className="btn" onClick={onRetry} disabled={busy}>
            Retry
          </button>
        )}
        {!active && (
          <button className="btn secondary" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      <SourceList sources={task.sources || []} />
    </div>
  );
}