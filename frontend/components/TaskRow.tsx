import type { TaskListItem } from '@/lib/types';

interface TaskRowProps {
  task: TaskListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function TaskRow({ task, selected, onSelect }: TaskRowProps) {
  return (
    <button
      className={`task-row${selected ? ' selected' : ''}`}
      onClick={() => onSelect(task.id)}
      aria-pressed={selected}
    >
      <div className="task-main">
        <strong className="task-title">
          {task.prompt.length > 90 ? `${task.prompt.slice(0, 90)}…` : task.prompt}
        </strong>
        <div className="muted task-meta">
          {task.current_step || task.status}
          {task.provider_used ? ` · ${task.provider_used}` : ''}
          {task.model_mode && task.model_mode !== 'auto' ? ` · ${task.model_mode}` : ''}
        </div>
      </div>
      <span className={`status status-${task.status}`}>{task.status}</span>
    </button>
  );
}