import { AlertCircle, X, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  message: string;
  title?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorState({
  message,
  title = 'Operation error',
  onRetry,
  onDismiss
}: ErrorStateProps) {
  return (
    <div
      id="error-state-banner"
      role="alert"
      className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-200 text-xs shadow-sm my-3 animate-in fade-in"
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <strong className="block font-semibold text-rose-100 text-xs">{title}</strong>
          <p className="mt-0.5 text-rose-300/90 leading-relaxed break-words">{message}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        {onRetry && (
          <button
            id="error-state-retry-btn"
            type="button"
            onClick={onRetry}
            className="p-1 rounded-md text-rose-300 hover:text-white hover:bg-rose-500/20 transition-colors"
            title="Retry operation"
          >
            <RefreshCw size={13} />
          </button>
        )}
        {onDismiss && (
          <button
            id="error-state-dismiss-btn"
            type="button"
            onClick={onDismiss}
            className="p-1 rounded-md text-rose-300 hover:text-white hover:bg-rose-500/20 transition-colors"
            title="Dismiss error"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
