import { EmptyState } from './EmptyState';
import { TaskRow } from './TaskRow';
import type { TaskListItem } from '@/lib/types';

interface TaskListProps {
  tasks: TaskListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TaskList({ tasks, selectedId, onSelect }: TaskListProps) {
  if (tasks.length === 0) {
    return <EmptyState message="No tasks yet. Describe a goal above and the agent will get to work." />;
  }
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} selected={task.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}