import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Loader2, Sparkles, CornerDownLeft } from 'lucide-react';

interface TaskComposerProps {
  onSubmit: (prompt: string) => Promise<void>;
  disabled?: boolean;
  initialPrompt?: string;
}

const EXAMPLE_PROMPTS = [
  'Compare pgvector vs Pinecone vs Qdrant for 10M+ embeddings in production',
  'EU AI Act compliance deadlines and obligations for GPAI models',
  'Solid-state battery commercialization roadmaps from Toyota, QuantumScape, and CATL',
  'Analyze WebAssembly garbage collection performance vs native JS in V8'
];

export function TaskComposer({ onSubmit, disabled = false, initialPrompt = '' }: TaskComposerProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, [initialPrompt]);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 96), 260)}px`;
    }
  }, [prompt]);

  async function handleSubmit(e?: FormEvent) {
    if (e) e.preventDefault();
    const trimmed = prompt.trim();
    if (busy || disabled || trimmed.length < 3) return;

    setBusy(true);
    try {
      await onSubmit(trimmed);
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.style.height = '96px';
      }
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  const isValid = prompt.trim().length >= 3;
  const isTooLong = prompt.length > 4000;

  return (
    <div id="task-composer-wrapper" className="w-full">
      <form
        onSubmit={handleSubmit}
        className={`relative rounded-xl bg-slate-900/90 border transition-all duration-200 shadow-xl ${
          busy
            ? 'border-blue-500/40 ring-1 ring-blue-500/20'
            : 'border-slate-800 hover:border-slate-700/80 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
        }`}
      >
        <div className="p-3.5 sm:p-4">
          <label htmlFor="agent-task-input" className="sr-only">
            Research goal or prompt
          </label>
          <textarea
            ref={textareaRef}
            id="agent-task-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy || disabled}
            placeholder="Research a topic, compare products, investigate a claim, or answer a complex question..."
            maxLength={4000}
            rows={3}
            className="w-full bg-transparent text-slate-100 placeholder:text-slate-500 text-sm sm:text-base resize-none focus:outline-none leading-relaxed min-h-[80px]"
          />
        </div>

        <div className="flex items-center justify-between px-3.5 pb-3 pt-1 border-t border-slate-800/60 bg-slate-950/40 rounded-b-xl gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <span
              className={`text-xs tabular-nums font-mono ${
                isTooLong ? 'text-rose-400 font-semibold' : 'text-slate-500'
              }`}
            >
              {prompt.length} / 4000
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-400">
                ⌘
              </kbd>
              <span>+</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-400 flex items-center">
                <CornerDownLeft size={10} />
              </kbd>
              <span className="ml-0.5">to run</span>
            </span>
          </div>

          <button
            id="start-research-submit-btn"
            type="submit"
            disabled={busy || disabled || !isValid || isTooLong}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 cursor-pointer ${
              isValid && !busy && !disabled
                ? 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white shadow-md shadow-blue-500/20'
                : 'bg-slate-800/80 text-slate-500 cursor-not-allowed border border-slate-800'
            }`}
          >
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin text-blue-300" />
                <span>Initializing Agent…</span>
              </>
            ) : (
              <>
                <span>Start research</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Suggested prompts */}
      <div className="mt-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2 font-medium">
          <Sparkles size={13} className="text-amber-400/90" />
          <span>Suggested research queries</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((sample, idx) => (
            <button
              key={idx}
              id={`sample-prompt-btn-${idx}`}
              type="button"
              onClick={() => {
                setPrompt(sample);
                if (textareaRef.current) textareaRef.current.focus();
              }}
              className="text-left text-xs px-2.5 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-800/80 hover:border-slate-700 text-slate-300 hover:text-slate-100 transition-colors truncate max-w-full sm:max-w-[48%] md:max-w-none cursor-pointer"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
