import { useState, useMemo } from 'react';
import { Search, Filter, Sparkles, Inbox } from 'lucide-react';
import { TaskRow } from './TaskRow';
import { EmptyState } from './EmptyState';
import { isActiveStatus, type TaskListItem } from '../types';

interface TaskListProps {
  tasks: TaskListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewResearch?: () => void;
}

type FilterTab = 'all' | 'active' | 'completed' | 'failed';

export function TaskList({ tasks, selectedId, onSelect, onNewResearch }: TaskListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Tab filter
      if (activeTab === 'active' && !isActiveStatus(task.status)) return false;
      if (activeTab === 'completed' && task.status !== 'completed') return false;
      if (activeTab === 'failed' && task.status !== 'failed' && task.status !== 'cancelled') return false;

      // Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          task.prompt.toLowerCase().includes(q) ||
          (task.current_step && task.current_step.toLowerCase().includes(q)) ||
          task.status.toLowerCase().includes(q)
        );
      }

      return true;
    });
  }, [tasks, activeTab, searchQuery]);

  const activeCount = tasks.filter((t) => isActiveStatus(t.status)).length;

  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No research tasks yet"
        message="Enter a research objective above to activate the autonomous web research agent."
        icon="sparkles"
        actionLabel={onNewResearch ? 'Start First Research' : undefined}
        onAction={onNewResearch}
      />
    );
  }

  return (
    <div id="task-list-wrapper" className="space-y-3">
      {/* Search & filter toolbar */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="search-tasks-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search past research goals..."
            className="w-full pl-8.5 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/20 text-xs text-slate-200 placeholder:text-slate-400 focus:outline-none transition-colors"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            id="filter-tab-all"
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'all'
                ? 'bg-slate-800 text-slate-100 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            All ({tasks.length})
          </button>
          <button
            id="filter-tab-active"
            type="button"
            onClick={() => setActiveTab('active')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'active'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            {activeCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
            <span>Active ({activeCount})</span>
          </button>
          <button
            id="filter-tab-completed"
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'completed'
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Completed ({tasks.filter((t) => t.status === 'completed').length})
          </button>
          <button
            id="filter-tab-failed"
            type="button"
            onClick={() => setActiveTab('failed')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'failed'
                ? 'bg-rose-600/20 text-rose-300 border border-rose-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Issues ({tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled').length})
          </button>
        </div>
      </div>

      {/* Task list rows */}
      {filteredTasks.length === 0 ? (
        <EmptyState
          title="No matching tasks"
          message="Try changing the filter or search query."
          icon="search"
        />
      ) : (
        <div className="space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-0.5">
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
