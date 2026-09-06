import type { SearchResult } from '@/lib/types';

interface SourceListProps {
  sources: SearchResult[];
}

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function SourceList({ sources }: SourceListProps) {
  if (sources.length === 0) return null;
  return (
    <div className="sources">
      <h3>Sources ({sources.length})</h3>
      <ol className="source-list">
        {sources.map((source, index) => (
          <li key={`${source.url}-${index}`} className="source-card">
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              <span className="source-index">{index + 1}</span>
              <span className="source-body">
                <strong>{source.title}</strong>
                <span className="muted source-snippet">{source.snippet}</span>
                <span className="source-host">{displayHost(source.url)}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}