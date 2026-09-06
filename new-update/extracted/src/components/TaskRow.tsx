import { Clock, Layers, Search, ChevronRight } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { isActiveStatus, type TaskListItem } from '../types';

interface TaskRowProps {
  key?: string;
  task: TaskListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

function formatRelativeTime(dateString: string): string {
  try {
    const diff = Date.now() - new Date(dateString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateString).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
}

export function TaskRow({ task, selected, onSelect }: TaskRowProps) {
  const active = isActiveStatus(task.status);

  return (
    <button
      id={`task-row-${task.id}`}
      type="button"
      onClick={() => onSelect(task.id)}
      aria-pressed={selected}
      className={`group w-full text-left p-3.5 rounded-xl border transition-all duration-150 relative cursor-pointer ${
        selected
          ? 'bg-blue-950/30 border-blue-500/50 shadow-sm shadow-blue-500/10'
          : 'bg-slate-900/40 hover:bg-slate-900/80 border-slate-800/80 hover:border-slate-700/80'
      }`}
    >
      {/* Selected Indicator Bar */}
      {selected && (
        <div className="absolute left-0 top-3 bottom-3 w-1 bg-blue-500 rounded-r-full" />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 pl-1">
          {/* Status & time */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <StatusBadge status={task.status} size="sm" />
            <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
              <Clock size={11} className="text-slate-400" />
              <span>{formatRelativeTime(task.created_at)}</span>
            </span>
          </div>

          {/* Goal / Prompt */}
          <h4
            className={`text-xs sm:text-sm font-medium leading-snug line-clamp-2 transition-colors ${
              selected ? 'text-slate-100 font-semibold' : 'text-slate-300 group-hover:text-slate-100'
            }`}
          >
            {task.prompt}
          </h4>

          {/* Step or current activity */}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400 font-mono">
            {active && task.current_step ? (
              <span className="text-blue-400 truncate animate-pulse flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span>{task.current_step}</span>
              </span>
            ) : (
              <>
                {task.steps_used > 0 && (
                  <span className="flex items-center gap-1">
                    <Layers size={11} className="text-slate-400" />
                    <span>{task.steps_used} steps</span>
                  </span>
                )}
                {task.searches_used > 0 && (
                  <span className="flex items-center gap-1">
                    <Search size={11} className="text-slate-400" />
                    <span>{task.searches_used} queries</span>
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <ChevronRight
          size={15}
          className={`shrink-0 transition-transform ${
            selected ? 'text-blue-400 translate-x-0.5' : 'text-slate-400 group-hover:text-slate-300'
          }`}
        />
      </div>
    </button>
  );
}
