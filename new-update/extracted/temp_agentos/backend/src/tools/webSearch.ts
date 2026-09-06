import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.js';
export type { SearchResult };

export interface SearchOptions {
  timeoutMs?: number;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number, options?: SearchOptions): Promise<SearchResult[]>;
}

export class SearchRateLimitError extends Error {
  constructor(message = 'Search provider is rate limiting requests. Try again shortly.') {
    super(message);
    this.name = 'SearchRateLimitError';
  }
}

export class SearchProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

export class DuckDuckGoSearchError extends SearchProviderError {
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'http' | 'parse' | 'no_results'
  ) {
    super(message);
    this.name = 'DuckDuckGoSearchError';
  }
}

export function isProbablyRateLimited(message: string): boolean {
  return /rate limit|too many requests|anomaly|blocked|429/i.test(message);
}

function sanitizeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function sanitizeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const url = normalizeUrl(r.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = r.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (title && url) out.push({ title, url, snippet: sanitizeSnippet(r.snippet ?? '') });
  }
  return out;
}

function normalizeUrl(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') return trimmed;
    return null;
  } catch {
    return null;
  }
}

export function decodeDuckDuckGoUrl(href: string): string {
  if (!href) return href;
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    if (url.hostname === 'duckduckgo.com' && (url.pathname === '/l/' || url.pathname === '/l')) {
      const target = url.searchParams.get('uddg');
      if (target) return target;
    }
    return href.startsWith('//') ? `https:${href}` : href;
  } catch {
    return href;
  }
}

export function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $('.result').each((_, el) => {
    if (out.length >= limit) return;
    const a = $(el).find('.result__a').first();
    const title = a.text().replace(/\s+/g, ' ').trim();
    const rawHref = a.attr('href') ?? '';
    const url = decodeDuckDuckGoUrl(rawHref);
    const snippet = $(el).find('.result__snippet').first().text();
    if (title && url) out.push({ title, url, snippet: sanitizeSnippet(snippet) });
  });
  return sanitizeSearchResults(out);
}

export async function duckDuckGoSearch(query: string, limit = 5, options?: { timeoutMs?: number }): Promise<SearchResult[]> {
  const timeoutMs = options?.timeoutMs ?? 10000;
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; AgentOS/1.0; +https://agentos.app)',
        accept: 'text/html'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new DuckDuckGoSearchError('Search provider timed out.', 'timeout');
    }
    throw new DuckDuckGoSearchError(`Search request failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'parse');
  }

  if (response.status === 429) throw new SearchRateLimitError();
  if (response.status === 202) throw new SearchRateLimitError('Search provider is temporarily throttling this network.');
  if (!response.ok) throw new DuckDuckGoSearchError(`Search provider returned HTTP ${response.status}.`, 'http');

  const results = parseDuckDuckGoHtml(await response.text(), limit);
  if (results.length === 0) throw new DuckDuckGoSearchError('No search results returned for this query.', 'no_results');
  return results;
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'duckduckgo';
  async search(query: string, limit: number, options?: SearchOptions): Promise<SearchResult[]> {
    return duckDuckGoSearch(query, limit, options);
  }
}

export const searchProvider: SearchProvider = new DuckDuckGoProvider();

export async function webSearch(query: string, limit = 5, options?: SearchOptions): Promise<SearchResult[]> {
  return searchProvider.search(query, limit, options);
}