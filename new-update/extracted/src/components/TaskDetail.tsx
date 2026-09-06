import { useState, type ReactNode } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  StopCircle,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Layers,
  Search,
  Clock,
  ChevronDown,
  ChevronUp,
  Cpu,
  Share2
} from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { TaskProgress } from './TaskProgress';
import { SourceList } from './SourceList';
import { EmptyState } from './EmptyState';
import { isActiveStatus, type Task } from '../types';

interface TaskDetailProps {
  task: Task | null;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onNewResearch?: () => void;
}

interface ParsedResult {
  answerBody: string;
  verification: {
    verified: 'yes' | 'partial' | null;
    reason: string | null;
    missing: string | null;
  } | null;
}

function parseAgentResult(rawResult: string | null): ParsedResult {
  if (!rawResult) {
    return { answerBody: '', verification: null };
  }

  // Check for ### Agent verification section
  const verifyHeaderIndex = rawResult.indexOf('### Agent verification');
  if (verifyHeaderIndex === -1) {
    return { answerBody: rawResult, verification: null };
  }

  const answerBody = rawResult.slice(0, verifyHeaderIndex).replace(/---\s*$/, '').trim();
  const verifySection = rawResult.slice(verifyHeaderIndex);

  const verifiedMatch = verifySection.match(/- Verified:\s*(yes|partial|no)/i);
  const reasonMatch = verifySection.match(/- Reason:\s*(.+?)(?=\n- Missing:|\n\n|$)/is);
  const missingMatch = verifySection.match(/- Missing:\s*(.+?)(?=\n\n|$)/is);

  const verifiedStatus = verifiedMatch
    ? (verifiedMatch[1].toLowerCase() as 'yes' | 'partial')
    : null;

  return {
    answerBody,
    verification: {
      verified: verifiedStatus,
      reason: reasonMatch ? reasonMatch[1].trim() : null,
      missing: missingMatch ? missingMatch[1].trim() : null
    }
  };
}

// Simple markdown renderer to HTML for clean typography without unstyled pre dumps
function renderMarkdownSections(text: string) {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let inList = false;
  let listItems: string[] = [];

  function flushList() {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="my-3 pl-5 space-y-1 list-disc text-slate-300">
          {listItems.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={i} className="text-xl sm:text-2xl font-bold text-slate-100 mt-5 mb-2.5">
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={i} className="text-lg sm:text-xl font-semibold text-slate-100 mt-4 mb-2 pb-1 border-b border-slate-800">
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={i} className="text-base font-semibold text-slate-200 mt-3.5 mb-1.5">
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(trimmed.slice(2));
    } else if (trimmed === '---') {
      flushList();
      elements.push(<hr key={i} className="my-5 border-slate-800" />);
    } else if (trimmed.length > 0) {
      flushList();
      elements.push(
        <p key={i} className="text-sm sm:text-base text-slate-300 leading-relaxed mb-3">
          {trimmed}
        </p>
      );
    }
  });

  flushList();
  return elements;
}

export function TaskDetail({
  task,
  busy,
  onCancel,
  onRetry,
  onDelete,
  onNewResearch
}: TaskDetailProps) {
  const [copied, setCopied] = useState(false);
  const [showPlan, setShowPlan] = useState(true);

  if (!task) {
    return (
      <EmptyState
        title="No research selected"
        message="Select an investigation from the sidebar or start a fresh inquiry."
        icon="search"
        actionLabel={onNewResearch ? 'Start New Research' : undefined}
        onAction={onNewResearch}
      />
    );
  }

  const active = isActiveStatus(task.status);
  const { answerBody, verification } = parseAgentResult(task.result);

  function handleCopyResult() {
    if (!task) return;
    const textToCopy = task.result || task.prompt;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <article id="task-detail-container" className="w-full max-w-4xl mx-auto space-y-6">
      {/* Task Header & Controls */}
      <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800/90 shadow-lg">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <StatusBadge status={task.status} size="md" />
              {task.model_used && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono text-slate-400 bg-slate-800 border border-slate-700/60">
                  <Cpu size={12} className="text-slate-500" />
                  <span>{task.model_used}</span>
                </span>
              )}
            </div>

            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-100 leading-snug tracking-tight">
              {task.prompt}
            </h1>
          </div>

          {/* Action toolbar */}
          <div className="flex items-center gap-2 shrink-0">
            {task.result && (
              <button
                id="copy-result-btn"
                type="button"
                onClick={handleCopyResult}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                title="Copy research markdown"
              >
                {copied ? (
                  <>
                    <Check size={13} className="text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}

            {active && (
              <button
                id="cancel-task-btn"
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer disabled:opacity-50"
              >
                <StopCircle size={13} />
                <span>{busy ? 'Stopping…' : 'Cancel'}</span>
              </button>
            )}

            {task.status === 'failed' && (
              <button
                id="retry-task-btn"
                type="button"
                onClick={onRetry}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Retry</span>
              </button>
            )}

            {!active && (
              <button
                id="delete-task-btn"
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors cursor-pointer disabled:opacity-50"
                title="Delete task"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Metadata bar */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400 flex-wrap">
          <span className="flex items-center gap-1.5 font-medium">
            <Layers size={13} className="text-slate-500" />
            <span>{task.steps_used || 0} steps executed</span>
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <Search size={13} className="text-slate-500" />
            <span>{task.searches_used || 0} web queries</span>
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <Clock size={13} className="text-slate-500" />
            <span>
              {task.completed_at
                ? `Finished ${new Date(task.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : `Initiated ${new Date(task.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          </span>
        </div>
      </div>

      {/* Real-time Agent Progress Stepper */}
      {active && (
        <TaskProgress
          status={task.status}
          currentStep={task.current_step}
          error={task.error}
        />
      )}

      {/* Research Plan Accordion */}
      {task.plan && task.plan.steps && task.plan.steps.length > 0 && (
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
          <button
            id="toggle-plan-accordion"
            type="button"
            onClick={() => setShowPlan((prev) => !prev)}
            className="w-full flex items-center justify-between p-3.5 sm:p-4 text-left hover:bg-slate-850/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Agent Research Plan
              </span>
              <span className="text-xs text-slate-500">
                ({task.plan.steps.length} milestones)
              </span>
            </div>
            {showPlan ? <ChevronUp size={15} className="text-slate-500" /> : <ChevronDown size={15} />}
          </button>

          {showPlan && (
            <div className="px-4 pb-4 pt-1 border-t border-slate-800/60 text-xs text-slate-300">
              {task.plan.goal && (
                <p className="text-xs text-slate-400 mb-2.5 font-medium italic">
                  Objective: {task.plan.goal}
                </p>
              )}
              <ol className="space-y-1.5 pl-4 list-decimal marker:text-slate-600">
                {task.plan.steps.map((step, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Error Banner if Failed */}
      {task.status === 'failed' && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200">
          <div className="flex items-center gap-2 font-semibold text-sm mb-1 text-rose-100">
            <AlertTriangle size={16} className="text-rose-400" />
            <span>Research Execution Encountered an Issue</span>
          </div>
          <p className="text-xs text-rose-300 leading-relaxed">
            {task.error || 'The agent could not complete all verification passes. You can retry the inquiry.'}
          </p>
        </div>
      )}

      {/* Verification Card & Verified Answer */}
      {task.status === 'completed' && task.result && (
        <div className="space-y-5">
          {/* Agent Verification Box */}
          {verification && verification.verified && (
            <div
              id="agent-verification-card"
              className={`p-4 rounded-xl border flex items-start gap-3.5 ${
                verification.verified === 'yes'
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-amber-950/20 border-amber-500/30'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  verification.verified === 'yes'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}
              >
                <ShieldCheck size={18} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Agent Verification
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                      verification.verified === 'yes'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {verification.verified === 'yes' ? 'Verified Complete' : 'Partially Verified'}
                  </span>
                </div>

                {verification.reason && (
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {verification.reason}
                  </p>
                )}

                {verification.missing && (
                  <p className="text-xs text-amber-400 mt-1.5 font-medium">
                    Missing verification points: {verification.missing}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Primary Answer Surface */}
          <div
            id="research-answer-section"
            className="p-5 sm:p-7 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl"
          >
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Sparkles size={15} className="text-blue-400" />
                <span>Verified Findings</span>
              </h2>
              <span className="text-xs text-slate-500">
                AgentOS Research Output
              </span>
            </div>

            <div className="markdown-body">
              {renderMarkdownSections(answerBody || task.result)}
            </div>
          </div>
        </div>
      )}

      {/* Sources list */}
      <SourceList sources={task.sources || []} />
    </article>
  );
}
