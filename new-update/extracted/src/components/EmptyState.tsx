import { Inbox, Search, Sparkles } from 'lucide-react';

interface EmptyStateProps {
  message: string;
  title?: string;
  icon?: 'inbox' | 'search' | 'sparkles';
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  message,
  title = 'No items found',
  icon = 'inbox',
  actionLabel,
  onAction
}: EmptyStateProps) {
  return (
    <div
      id="empty-state-container"
      className="flex flex-col items-center justify-center py-12 px-6 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40 my-2"
    >
      <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
        {icon === 'search' && <Search size={22} />}
        {icon === 'sparkles' && <Sparkles size={22} />}
        {icon === 'inbox' && <Inbox size={22} />}
      </div>
      <h3 className="text-sm font-semibold text-slate-200 mb-1">{title}</h3>
      <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-4">{message}</p>
      {actionLabel && onAction && (
        <button
          id="empty-state-action-btn"
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
