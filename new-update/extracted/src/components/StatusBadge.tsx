import {
  Clock,
  Compass,
  Search,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Ban,
  Loader2
} from 'lucide-react';
import type { TaskStatus } from '../types';

interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
  showIcon?: boolean;
}

export function StatusBadge({ status, size = 'sm', showIcon = true }: StatusBadgeProps) {
  const isSm = size === 'sm';
  const sizeClasses = isSm ? 'px-2 py-0.5 text-xs gap-1.5' : 'px-2.5 py-1 text-xs gap-1.5 font-medium';
  const iconSize = isSm ? 12 : 14;

  switch (status) {
    case 'queued':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20 ${sizeClasses}`}
        >
          {showIcon && <Clock size={iconSize} className="text-amber-400" />}
          <span>Queued</span>
        </span>
      );

    case 'planning':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20 ${sizeClasses}`}
        >
          {showIcon && <Compass size={iconSize} className="animate-spin text-blue-400" />}
          <span>Planning</span>
        </span>
      );

    case 'searching':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-sky-500/10 text-sky-300 border border-sky-500/20 ${sizeClasses}`}
        >
          {showIcon && <Search size={iconSize} className="animate-pulse text-sky-400" />}
          <span>Searching</span>
        </span>
      );

    case 'analyzing':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 ${sizeClasses}`}
        >
          {showIcon && <Cpu size={iconSize} className="animate-pulse text-indigo-400" />}
          <span>Analyzing</span>
        </span>
      );

    case 'verifying':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-teal-500/10 text-teal-300 border border-teal-500/20 ${sizeClasses}`}
        >
          {showIcon && <ShieldCheck size={iconSize} className="animate-bounce text-teal-400" />}
          <span>Verifying</span>
        </span>
      );

    case 'completed':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 ${sizeClasses}`}
        >
          {showIcon && <CheckCircle2 size={iconSize} className="text-emerald-400" />}
          <span>Completed</span>
        </span>
      );

    case 'failed':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20 ${sizeClasses}`}
        >
          {showIcon && <XCircle size={iconSize} className="text-rose-400" />}
          <span>Failed</span>
        </span>
      );

    case 'cancelled':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center rounded-md font-medium bg-slate-500/10 text-slate-300 border border-slate-500/20 ${sizeClasses}`}
        >
          {showIcon && <Ban size={iconSize} className="text-slate-400" />}
          <span>Cancelled</span>
        </span>
      );

    default:
      return (
        <span
          id={`status-badge-unknown`}
          className={`inline-flex items-center rounded-md font-medium bg-slate-800 text-slate-300 border border-slate-700 ${sizeClasses}`}
        >
          {showIcon && <Loader2 size={iconSize} className="animate-spin text-slate-400" />}
          <span className="capitalize">{status}</span>
        </span>
      );
  }
}
