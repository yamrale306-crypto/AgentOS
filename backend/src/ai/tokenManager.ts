import type { AiErrorCategory } from './errors.js';

export interface TokenState {
  id: string;
  providerId: string;
  masked: string;
  tokenHash: string;
  enabled: boolean;
  healthy: boolean;
  consecutiveFailures: number;
  failureCount: number;
  successCount: number;
  lastUsedAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: AiErrorCategory | null;
}

const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 5 * 60_000;
const MAX_FAILURES_BEFORE_UNHEALTHY = 5;

export function maskToken(value: string): string {
  if (value.length <= 8) return '***';
  const head = value.slice(0, Math.min(3, Math.max(value.length - 4, 1)));
  const tail = value.slice(-4);
  return `${head}***${tail}`;
}

function hashToken(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function cooldownFor(failures: number): number {
  const ms = COOLDOWN_BASE_MS * 2 ** (failures - 1);
  return Math.min(ms, COOLDOWN_MAX_MS);
}

function cooldownKey(tokenId: string, modelKey: string): string {
  return `${tokenId}::${modelKey}`;
}

interface RecordOptions {
  modelKey?: string;
  now?: number;
}

interface SelectOptions {
  avoid?: string[];
  now?: number;
  modelKey?: string;
}

export class TokenManager {
  private readonly tokens = new Map<string, TokenState[]>();
  private readonly rawValues = new Map<string, string>();
  private readonly cooldowns = new Map<string, number>();

  register(providerId: string, value: string): TokenState {
    const providerTokens = this.tokens.get(providerId) ?? [];
    const existing = providerTokens.find((t) => this.rawValues.get(t.id) === value);
    if (existing) return existing;
    const token: TokenState = {
      id: `${providerId}-t${providerTokens.length + 1}`,
      providerId,
      masked: maskToken(value),
      tokenHash: hashToken(value),
      enabled: true,
      healthy: true,
      consecutiveFailures: 0,
      failureCount: 0,
      successCount: 0,
      lastUsedAt: null,
      lastFailureAt: null,
      lastFailureCategory: null
    };
    providerTokens.push(token);
    this.tokens.set(providerId, providerTokens);
    this.rawValues.set(token.id, value);
    return token;
  }

  valueFor(id: string): string | undefined {
    return this.rawValues.get(id);
  }

  tokensFor(providerId: string): TokenState[] {
    return this.tokens.get(providerId) ?? [];
  }

  hasAnyToken(providerId: string): boolean {
    return this.tokensFor(providerId).some((t) => t.enabled && t.healthy);
  }

  select(providerId: string, options: SelectOptions = {}): TokenState | null {
    const now = options.now ?? Date.now();
    const candidates = this.tokensFor(providerId)
      .filter((t) => t.enabled && t.healthy)
      .filter((t) => !options.avoid || !options.avoid.includes(t.id))
      .filter((t) => !options.modelKey || (this.cooldowns.get(cooldownKey(t.id, options.modelKey)) ?? 0) <= now)
      .sort((a, b) => {
        const lastUsedA = a.lastUsedAt ?? 0;
        const lastUsedB = b.lastUsedAt ?? 0;
        if (lastUsedA !== lastUsedB) return lastUsedA - lastUsedB;
        return a.consecutiveFailures - b.consecutiveFailures || a.failureCount - b.failureCount;
      });
    const picked = candidates[0] ?? null;
    if (picked) picked.lastUsedAt = now;
    return picked;
  }

  recordSuccess(token: TokenState, opts: RecordOptions = {}): void {
    const now = opts.now ?? Date.now();
    token.successCount += 1;
    token.consecutiveFailures = 0;
    token.healthy = true;
    token.lastUsedAt = now;
    token.lastFailureAt = null;
    token.lastFailureCategory = null;
    if (opts.modelKey) this.cooldowns.delete(cooldownKey(token.id, opts.modelKey));
  }

  recordFailure(token: TokenState, category: AiErrorCategory, opts: RecordOptions = {}): void {
    const now = opts.now ?? Date.now();
    token.failureCount += 1;
    token.consecutiveFailures += 1;
    token.lastUsedAt = now;
    token.lastFailureAt = now;
    token.lastFailureCategory = category;
    if (category === 'AUTH_ERROR') {
      token.healthy = false;
      return;
    }
    if (opts.modelKey) {
      this.cooldowns.set(cooldownKey(token.id, opts.modelKey), now + cooldownFor(token.consecutiveFailures));
    }
    if (token.consecutiveFailures >= MAX_FAILURES_BEFORE_UNHEALTHY) {
      token.healthy = false;
    }
  }

  reset(token: TokenState, opts: { modelKey?: string } = {}): void {
    token.healthy = true;
    token.enabled = true;
    token.consecutiveFailures = 0;
    if (opts.modelKey) this.cooldowns.delete(cooldownKey(token.id, opts.modelKey));
  }

  snapshot(): Array<{
    id: string;
    providerId: string;
    masked: string;
    tokenHash: string;
    enabled: boolean;
    healthy: boolean;
    inCooldown: boolean;
    cooldownModelKeys: string[];
    consecutiveFailures: number;
    failureCount: number;
    successCount: number;
    lastUsedAt: number | null;
    lastFailureAt: number | null;
    lastFailureCategory: AiErrorCategory | null;
  }> {
    const now = Date.now();
    const out: ReturnType<TokenManager['snapshot']> = [];
    for (const tokens of this.tokens.values()) {
      for (const t of tokens) {
        const active: string[] = [];
        for (const [key, until] of this.cooldowns) {
          if (key.startsWith(`${t.id}::`) && until > now) active.push(key.slice(t.id.length + 2));
        }
        out.push({
          id: t.id,
          providerId: t.providerId,
          masked: t.masked,
          tokenHash: t.tokenHash,
          enabled: t.enabled,
          healthy: t.healthy,
          inCooldown: active.length > 0,
          cooldownModelKeys: active,
          consecutiveFailures: t.consecutiveFailures,
          failureCount: t.failureCount,
          successCount: t.successCount,
          lastUsedAt: t.lastUsedAt,
          lastFailureAt: t.lastFailureAt,
          lastFailureCategory: t.lastFailureCategory
        });
      }
    }
    return out;
  }
}