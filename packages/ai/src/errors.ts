export const AI_ERROR_CATEGORIES = [
  'AUTH_ERROR',
  'RATE_LIMIT',
  'TIMEOUT',
  'MODEL_UNAVAILABLE',
  'BAD_REQUEST',
  'SERVER_ERROR',
  'NETWORK_ERROR',
  'UNKNOWN'
] as const;

export type AiErrorCategory = (typeof AI_ERROR_CATEGORIES)[number];

const RETRYABLE: ReadonlySet<AiErrorCategory> = new Set<AiErrorCategory>(['RATE_LIMIT', 'TIMEOUT', 'SERVER_ERROR', 'NETWORK_ERROR']);

export class AiError extends Error {
  constructor(
    public readonly category: AiErrorCategory,
    message: string,
    public readonly retryable: boolean = RETRYABLE.has(category as AiErrorCategory)
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function hasStatus(e: unknown): number | null {
  if (e && typeof e === 'object' && ('status' in e || 'statusCode' in e)) {
    const maybe = Number((e as Record<string, unknown>).status ?? (e as Record<string, unknown>).statusCode);
    if (Number.isInteger(maybe) && maybe >= 100 && maybe <= 599) return maybe;
  }
  return null;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? 'unknown error');
}

export function normalizeError(e: unknown): AiError {
  const message = messageOf(e);
  if (e instanceof AiError) return e;

  const status = hasStatus(e);
  if (status !== null) {
    if (status === 401 || status === 403) return new AiError('AUTH_ERROR', message);
    if (status === 429) return new AiError('RATE_LIMIT', message);
    if (status === 400 || status === 422) return new AiError('BAD_REQUEST', message);
    if (status === 402 || status === 404 || status === 410) return new AiError('MODEL_UNAVAILABLE', message);
    if (status === 408 || status === 409) return new AiError('TIMEOUT', message);
    if (status >= 500) return new AiError('SERVER_ERROR', message);
    return new AiError('UNKNOWN', message);
  }

  const lower = message.toLowerCase();
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('timeouterror') || lower.includes('aborted') || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))) {
    return new AiError('TIMEOUT', message);
  }
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return new AiError('RATE_LIMIT', message);
  }
  if (lower.includes('invalid api key') || lower.includes('auth') || lower.includes('api key') || lower.includes('unauthorized') || lower.includes('permission') || lower.includes('forbidden')) {
    return new AiError('AUTH_ERROR', message);
  }
  if (lower.includes('model not found') || lower.includes('does not exist') || lower.includes('not found') || lower.includes('unavailable') || lower.includes('not supported')) {
    return new AiError('MODEL_UNAVAILABLE', message);
  }
  if (lower.includes('fetch failed') || lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('eai_again') || lower.includes('network ') || (e instanceof Error && e.name === 'TypeError')) {
    return new AiError('NETWORK_ERROR', message);
  }
  return new AiError('UNKNOWN', message);
}

export function isRetryable(category: AiErrorCategory): boolean {
  return RETRYABLE.has(category);
}

export function describeAiError(e: unknown): string {
  const norm = normalizeError(e);
  const suffix = norm.category === 'UNKNOWN' && messageOf(e) ? ` (${messageOf(e)})` : '';
  return `${norm.category}${suffix}`;
}