import { useState, type MouseEvent } from 'react';
import { ExternalLink, Globe, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import type { SearchResult } from '../types';

interface SourceListProps {
  sources: SearchResult[];
}

function displayHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SourceList({ sources }: SourceListProps) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());

  if (!sources || sources.length === 0) return null;

  function toggleExpand(index: number) {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function handleCopy(url: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  }

  return (
    <div id="sources-container" className="mt-6 pt-5 border-t border-slate-800">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <Globe size={15} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Verified Sources
          </h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
            {sources.length}
          </span>
        </div>
        <span className="text-xs text-slate-400 hidden sm:inline">
          Click any reference to inspect primary source
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {sources.map((source, index) => {
          const host = displayHost(source.url);
          const isExpanded = expandedIndices.has(index);
          const isCopied = copiedUrl === source.url;

          return (
            <div
              key={`${source.url}-${index}`}
              id={`source-card-${index}`}
              className="group relative flex flex-col justify-between p-3 rounded-xl bg-slate-900/70 hover:bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition-all duration-150"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-slate-800 text-[11px] font-mono font-semibold text-slate-400 shrink-0">
                      {index + 1}
                    </span>
                    <span className="text-xs font-medium text-blue-400/90 truncate font-mono">
                      {host}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      id={`copy-source-url-${index}`}
                      type="button"
                      onClick={(e) => handleCopy(source.url, e)}
                      title="Copy URL"
                      className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      {isCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                    <a
                      id={`open-source-link-${index}`}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded text-slate-500 hover:text-blue-400 hover:bg-slate-800 transition-colors flex items-center gap-0.5"
                      title="Open source in new tab"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>

                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs sm:text-sm font-medium text-slate-200 group-hover:text-blue-300 transition-colors leading-snug line-clamp-2"
                >
                  {source.title || host}
                </a>

                {source.snippet && (
                  <p
                    className={`mt-1.5 text-xs text-slate-400 leading-relaxed ${
                      isExpanded ? '' : 'line-clamp-2'
                    }`}
                  >
                    {source.snippet}
                  </p>
                )}
              </div>

              {source.snippet && source.snippet.length > 120 && (
                <button
                  type="button"
                  onClick={() => toggleExpand(index)}
                  className="mt-2 text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1 self-start font-medium cursor-pointer"
                >
                  {isExpanded ? (
                    <>
                      <span>Show less</span>
                      <ChevronUp size={11} />
                    </>
                  ) : (
                    <>
                      <span>Show snippet</span>
                      <ChevronDown size={11} />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
