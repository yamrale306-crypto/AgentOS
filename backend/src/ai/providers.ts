import OpenAI from 'openai';
import { DEFAULT_PROVIDERS, type ProviderSpec } from './catalog.js';
import { TokenManager } from './tokenManager.js';
import { logger } from '../lib/logger.js';

export interface ProviderRuntime extends ProviderSpec {
  tokenValues: string[];
  headerTitle: string | null;
}

interface ProviderEnvInput {
  OPENROUTER_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_API_KEYS?: string;
  GROQ_API_KEY?: string;
  GROQ_API_KEYS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEYS?: string;
  ZAI_API_KEY?: string;
  ZAI_API_KEYS?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  APP_URL?: string;
  NODE_ENV?: string;
}

function tokenList(value: string | undefined, alt?: string): string[] {
  const raw = (value && value.trim()) || (alt && alt.trim()) || '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

export function providerBaseUrl(spec: ProviderSpec, input: ProviderEnvInput): string {
  if (spec.id === 'cloudflare') {
    if (!input.CLOUDFLARE_ACCOUNT_ID) return '';
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.CLOUDFLARE_ACCOUNT_ID)}/ai/v1`;
  }
  return spec.baseUrl;
}

export function buildProviders(input: ProviderEnvInput): ProviderRuntime[] {
  const tokenByProvider: Record<string, string[]> = {
    openrouter: tokenList(input.OPENROUTER_API_KEY),
    deepseek: tokenList(input.DEEPSEEK_API_KEYS, input.DEEPSEEK_API_KEY),
    groq: tokenList(input.GROQ_API_KEYS, input.GROQ_API_KEY),
    gemini: tokenList(input.GEMINI_API_KEYS, input.GEMINI_API_KEY),
    zai: tokenList(input.ZAI_API_KEYS, input.ZAI_API_KEY),
    cloudflare: tokenList(input.CLOUDFLARE_API_TOKEN)
  };

  const providers: ProviderRuntime[] = [];
  for (const spec of DEFAULT_PROVIDERS) {
    let tokens = tokenByProvider[spec.id] ?? [];
    if (spec.id === 'cloudflare' && !input.CLOUDFLARE_ACCOUNT_ID) tokens = [];
    const baseUrl = providerBaseUrl(spec, input);
    if (tokens.length === 0 || !baseUrl) {
      if (tokens.length === 0 && input.NODE_ENV !== 'test') {
        logger.debug('provider_no_token', { provider: spec.id });
      }
      continue;
    }
    providers.push({ ...spec, baseUrl, tokenValues: tokens, headerTitle: spec.id === 'openrouter' ? 'AgentOS' : null });
  }
  if (providers.length === 0) {
    throw new Error('No AI providers configured. Set at least one provider API key environment variable.');
  }
  return providers;
}

export class ProviderManager {
  private readonly clients = new Map<string, OpenAI>();
  private readonly tokens: TokenManager;

  constructor(
    private readonly providers: ProviderRuntime[],
    tokens: TokenManager
  ) {
    this.tokens = tokens;
    for (const provider of providers) {
      for (const value of provider.tokenValues) {
        this.tokens.register(provider.id, value);
      }
    }
  }

  get(providerId: string): ProviderRuntime | undefined {
    return this.providers.find((p) => p.id === providerId);
  }

  all(): ProviderRuntime[] {
    return this.providers.slice();
  }

  clientFor(providerId: string, tokenValue: string): OpenAI {
    const cacheKey = `${providerId}:${tokenValue}`;
    let client = this.clients.get(cacheKey);
    if (client) return client;
    const provider = this.get(providerId);
    if (!provider) throw new Error(`Unknown provider "${providerId}".`);
    const headers: Record<string, string> = {
      ...(provider.headerTitle ? { 'X-Title': provider.headerTitle } : {}),
      ...(provider.id === 'openrouter' ? { 'HTTP-Referer': process.env.APP_URL ?? 'https://agentos.app' } : {})
    };
    client = new OpenAI({ baseURL: provider.baseUrl, apiKey: tokenValue, defaultHeaders: headers, maxRetries: 0 });
    this.clients.set(cacheKey, client);
    return client;
  }

  hasTokenFor(providerId: string): boolean {
    return this.tokens.hasAnyToken(providerId);
  }
}

interface RegisterContext {
  providers: ProviderRuntime[];
  tokens: TokenManager;
  providerManager: ProviderManager;
}

export function createAiRuntime(input: ProviderEnvInput, tokens: TokenManager): RegisterContext {
  const providers = buildProviders(input);
  const providerManager = new ProviderManager(providers, tokens);
  return { providers, tokens, providerManager };
}