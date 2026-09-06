import { Compass, Search, Cpu, ShieldCheck, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import type { TaskStatus } from '../types';

interface TaskProgressProps {
  status: TaskStatus;
  currentStep: string | null;
  error?: string | null;
}

interface StepDef {
  key: string;
  label: string;
  sublabel: string;
  icon: typeof Compass;
}

const STEPS: StepDef[] = [
  {
    key: 'planning',
    label: 'Planning',
    sublabel: 'Decomposing research goal',
    icon: Compass
  },
  {
    key: 'searching',
    label: 'Searching',
    sublabel: 'Querying web & extracting sources',
    icon: Search
  },
  {
    key: 'analyzing',
    label: 'Analyzing',
    sublabel: 'Synthesizing evidence & claims',
    icon: Cpu
  },
  {
    key: 'verifying',
    label: 'Verifying',
    sublabel: 'Cross-checking source integrity',
    icon: ShieldCheck
  },
  {
    key: 'finalizing',
    label: 'Finalizing',
    sublabel: 'Assembling verified response',
    icon: CheckCircle2
  }
];

function getActiveStepIndex(status: TaskStatus): number {
  switch (status) {
    case 'queued':
      return 0;
    case 'planning':
      return 0;
    case 'searching':
      return 1;
    case 'analyzing':
      return 2;
    case 'verifying':
      return 3;
    case 'completed':
      return 5; // All done
    case 'failed':
    case 'cancelled':
      return -1;
    default:
      return 0;
  }
}

export function TaskProgress({ status, currentStep, error }: TaskProgressProps) {
  const currentIndex = getActiveStepIndex(status);
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  const isComplete = status === 'completed';

  return (
    <div
      id="task-progress-card"
      className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md my-4"
    >
      {/* Real-time agent status header */}
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          {!isComplete && !isFailed && !isCancelled && (
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
            </div>
          )}
          {isComplete && <CheckCircle2 size={16} className="text-emerald-400" />}
          {isFailed && <AlertCircle size={16} className="text-rose-400" />}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {isComplete
                ? 'Research complete'
                : isFailed
                ? 'Research failed'
                : isCancelled
                ? 'Research cancelled'
                : 'Agent research in progress'}
            </div>
            <div className="text-sm font-medium text-slate-100 mt-0.5">
              {currentStep || (status === 'queued' ? 'Queued in orchestrator...' : 'Working...')}
            </div>
          </div>
        </div>

        {error && (
          <span className="text-xs font-mono text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
            Error encountered
          </span>
        )}
      </div>

      {/* 5-Step Pipeline Stepper */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-2.5 relative">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isDone = isComplete || (currentIndex > idx && currentIndex !== -1);
          const isCurrent = !isComplete && currentIndex === idx && !isFailed && !isCancelled;
          const isPending = !isComplete && currentIndex < idx && !isFailed && !isCancelled;

          return (
            <div
              key={step.key}
              id={`progress-step-${step.key}`}
              className={`flex items-start sm:flex-col gap-3 sm:gap-2 p-2.5 rounded-lg border transition-all ${
                isCurrent
                  ? 'bg-blue-950/40 border-blue-500/40 shadow-sm shadow-blue-500/10'
                  : isDone
                  ? 'bg-slate-900/60 border-slate-800'
                  : 'bg-slate-950/30 border-slate-850 opacity-60'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isCurrent
                    ? 'bg-blue-600 text-white ring-2 ring-blue-500/30'
                    : isDone
                    ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/40'
                    : 'bg-slate-800 text-slate-500 border border-slate-700/40'
                }`}
              >
                {isCurrent ? (
                  <Loader2 size={14} className="animate-spin text-white" />
                ) : isDone ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : (
                  <Icon size={14} />
                )}
              </div>

              <div className="min-w-0">
                <div
                  className={`text-xs font-medium leading-tight ${
                    isCurrent
                      ? 'text-blue-300 font-semibold'
                      : isDone
                      ? 'text-slate-200'
                      : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate leading-tight hidden sm:block">
                  {step.sublabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Subtle indeterminate progress bar */}
      {!isComplete && !isFailed && !isCancelled && (
        <div className="mt-4 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full w-1/3 animate-progress-slide" />
        </div>
      )}
    </div>
  );
}
