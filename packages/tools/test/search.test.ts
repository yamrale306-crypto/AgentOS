import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  decodeDuckDuckGoUrl,
  parseDuckDuckGoHtml,
  sanitizeSearchResults,
  duckDuckGoSearch,
  SearchRateLimitError,
  webSearch
} from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeDuckDuckGoUrl', () => {
  it('decodes the uddg= param into the real target URL', () => {
    const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle%3Fa%3D1%26b%3D2&rut=abc';
    expect(decodeDuckDuckGoUrl(href)).toBe('https://example.com/article?a=1&b=2');
  });

  it('decodes a plain encoded http URL', () => {
    const href = '//duckduckgo.com/l/?uddg=http%3A%2F%2Fwww.example.org%2Fdoc';
    expect(decodeDuckDuckGoUrl(href)).toBe('http://www.example.org/doc');
  });

  it('leaves a non-redirect href untouched', () => {
    expect(decodeDuckDuckGoUrl('https://example.com/direct')).toBe('https://example.com/direct');
  });

  it('upgrades a protocol-relative link except the redirect path', () => {
    expect(decodeDuckDuckGoUrl('//example.com/x')).toBe('https://example.com/x');
  });

  it('returns empty string for empty input', () => {
    expect(decodeDuckDuckGoUrl('')).toBe('');
  });
});

describe('parseDuckDuckGoHtml', () => {
  const html = `
<html><body>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite.example%2Fpage&rut=x">Great Page</a>
  <a class="result__snippet" href="#">Snippet  text   with   extra spacing.</a>
</div>
<div class="result">
  <a class="result__a" href="https://other.example/plain">Second result</a>
  <a class="result__snippet" href="#">Real snippet here</a>
</div>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite.example%2Fpage&rut=y">Duplicate URL</a>
  <a class="result__snippet" href="#">duplicate snippet content</a>
</div>
</body></html>`;

  it('extracts title, decoded url and normalized snippet', () => {
    const results = parseDuckDuckGoHtml(html, 5);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Great Page',
      url: 'https://site.example/page',
      snippet: 'Snippet text with extra spacing.'
    });
    expect(results[1].url).toBe('https://other.example/plain');
  });

  it('respects the limit', () => {
    expect(parseDuckDuckGoHtml(html, 1)).toHaveLength(1);
  });

  it('returns empty array for an empty page', () => {
    expect(parseDuckDuckGoHtml('<html></html>', 5)).toEqual([]);
  });
});

describe('sanitizeSearchResults', () => {
  it('dedupes identical urls keeping the first and drops dangerous schemes', () => {
    const input = [
      { title: 'A', url: 'javascript:alert(1)', snippet: 'x' },
      { title: 'One', url: 'https://a.example', snippet: '1' },
      { title: 'One copy', url: 'https://a.example', snippet: 'copy' },
      { title: 'Two', url: 'https://b.example', snippet: '2' }
    ];
    const out = sanitizeSearchResults(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: 'One', url: 'https://a.example', snippet: '1' });
  });
});

describe('duckDuckGoSearch error handling', () => {
  it('throws SearchRateLimitError on 429', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 429, ok: false, text: async () => '' })
      .mockResolvedValueOnce({ status: 429, ok: false, text: async () => '' }));
    await expect(duckDuckGoSearch('test', 5, { retryDelayMs: 0 })).rejects.toBeInstanceOf(SearchRateLimitError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a transient server error once before succeeding', async () => {
    const html = `<div class="result"><a class="result__a" href="https://ok.example/retry">OK</a></div>`;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 503, ok: false, text: async () => '' })
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => html }));
    await expect(duckDuckGoSearch('test', 5, { retryDelayMs: 0 })).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws a DuckDuckGoSearchError on other HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false, text: async () => '' }));
    await expect(duckDuckGoSearch('test')).rejects.toMatchObject({ kind: 'http' });
  });

  it('throws a timeout error when the request aborts', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));
    await expect(duckDuckGoSearch('test')).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('throws no_results when the page has no results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => '<html></html>' }));
    await expect(duckDuckGoSearch('test')).rejects.toMatchObject({ kind: 'no_results' });
  });

  it('returns parsed results on a successful response', async () => {
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fok.example%2Fp">OK</a><a class="result__snippet">hi</a></div>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => html }));
    const results = await duckDuckGoSearch('test');
    expect(results[0].url).toBe('https://ok.example/p');
  });

  it('detects rate-limit text in error messages', async () => {
    const { isProbablyRateLimited } = await import('../src/index.js');
    expect(isProbablyRateLimited('rate limit exceeded')).toBe(true);
    expect(isProbablyRateLimited('generic failure')).toBe(false);
  });
});

describe('webSearch provider abstraction', () => {
  it('routes through the configured search provider', async () => {
    const html = `<div class="result"><a class="result__a" href="https://z.example/q">Z</a><a class="result__snippet">s</a></div>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => html }));
    const results = await webSearch('anything');
    expect(results[0].url).toBe('https://z.example/q');
  });
});

describe('DuckDuckGo html with malformed markup', () => {
  it('parses snippet-like text in the wrong container without crashing', () => {
    const html = `<div class="result"><a class="result__a" href="https://t.example/1">Title</a><span class="result__snippet">snippet</span></div>`;
    const out = parseDuckDuckGoHtml(html, 5);
    expect(out[0].snippet).toBe('snippet');
  });
});