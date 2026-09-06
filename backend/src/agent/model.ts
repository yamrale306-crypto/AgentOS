import OpenAI from 'openai';
import { z } from 'zod';
import env from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { route, type AiMode, type AgentStage, type TaskCategory, type RouteDecision } from '../ai/router.js';
import { normalizeError, AiError } from '../ai/errors.js';
import { healthMonitor } from '../ai/health.js';
import { tokens, providerManager, seedModelRegistry, startModelDiscovery } from '../ai/runtime.js';
import { modelRegistry } from '../ai/registry.js';
import type { ModelSpec } from '../ai/catalog.js';

seedModelRegistry();
void startModelDiscovery();

export interface ChatOptions {
  stage?: AgentStage;
  mode?: AiMode;
  override?: string | null;
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ChatModelResult {
  response: OpenAI.Chat.Completions.ChatCompletion;
  model: string;
  provider: string;
  modelKey: string;
  category: TaskCategory;
  fallback: boolean;
  tokenMasked: string;
  stage: AgentStage;
}

export interface StructuredResult<T> {
  value: T;
  model: string;
  provider: string;
  ok: boolean;
  fallback: boolean;
}

type MessageLike = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function contentLength(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    return content.reduce((sum: number, part) => {
      if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
        return sum + (part as { text: string }).text.length;
      }
      return sum;
    }, 0);
  }
  return 0;
}

export function estimateContextChars(messages: MessageLike[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg && typeof msg.content === 'string') total += msg.content.length;
    else if (msg && Array.isArray(msg.content)) total += contentLength(msg.content);
  }
  return total;
}

function firstUserPrompt(messages: MessageLike[]): string {
  for (const msg of messages) {
    if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) return msg.content.slice(0, 2000);
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as { text: string }).text === 'string') {
          return (part as { text: string }).text.slice(0, 2000);
        }
      }
    }
  }
  return '';
}

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1800;

async function callModel(
  spec: ModelSpec,
  tokenValue: string,
  messages: MessageLike[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  envTimeoutMs: number,
  temperature: number,
  maxTokens: number
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const client = providerManager.clientFor(spec.providerId, tokenValue);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), envTimeoutMs);
  try {
    return await client.chat.completions.create(
      {
        model: spec.modelId,
        messages,
        tools,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        temperature,
        max_tokens: maxTokens
      },
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }
}

interface AttemptOutcome {
  response: OpenAI.Chat.Completions.ChatCompletion;
  spec: ModelSpec;
  tokenMasked: string;
  attemptsUsed: number;
}

export async function chatWithFallback(
  messages: MessageLike[],
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  opts: ChatOptions = {}
): Promise<ChatModelResult> {
  const stage: AgentStage = opts.stage ?? 'general';
  const mode: AiMode = opts.mode ?? env.AI_DEFAULT_MODE;
  const overrideVal = opts.override ?? env.AI_DEFAULT_MODEL ?? null;
  const estimatedContextChars = estimateContextChars(messages);
  const promptText = opts.prompt ?? firstUserPrompt(messages);
  const timeoutMs = opts.timeoutMs ?? env.MODEL_TIMEOUT_MS;
  const maxAttempts = Math.min(opts.maxAttempts ?? env.MAX_MODEL_ATTEMPTS, 10);
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = Math.min(opts.maxTokens ?? DEFAULT_MAX_TOKENS, 8192);

  let decision: RouteDecision;
  if (!env.AI_ROUTING_ENABLED) {
    // Legacy single-provider mode: use the configured OpenRouter primary/fallback pair.
    const primaryId = env.OPENROUTER_MODEL_PRIMARY ?? 'openrouter/free';
    const fallbackId = env.OPENROUTER_MODEL_FALLBACK ?? primaryId;
    const primary = modelRegistry.ensureEnvModel(primaryId, false);
    const fallback = fallbackId === primaryId ? primary : modelRegistry.ensureEnvModel(fallbackId, true);
    const seen = new Set<string>();
    const candidates: ModelSpec[] = [];
    for (const spec of [primary, fallback]) {
      if (seen.has(spec.key)) continue;
      seen.add(spec.key);
      candidates.push(spec);
    }
    decision = { candidates, category: 'WEB_RESEARCH_ANALYSIS' };
  } else {
    decision = route({ stage, mode, override: overrideVal, estimatedContextChars, prompt: promptText });
  }

  let attempts = 0;
  let lastError: unknown = null;

  for (const spec of decision.candidates) {
    if (attempts >= maxAttempts) break;
    const availableTokens = tokens.tokensFor(spec.providerId);
    const avoided: string[] = [];
    for (const _ of availableTokens) {
      if (attempts >= maxAttempts) break;
      const token = tokens.select(spec.providerId, { avoid: avoided, modelKey: spec.key });
      if (!token) break;
      avoided.push(token.id);
      const rawValue = tokens.valueFor(token.id);
      if (!rawValue) continue;
      attempts += 1;
      const startedAt = Date.now();
      try {
        const response = await callModel(spec, rawValue, messages, tools, timeoutMs, temperature, maxTokens);
        const latencyMs = Date.now() - startedAt;
        healthMonitor.recordSuccess(spec.key, spec.providerId, latencyMs);
        tokens.recordSuccess(token, { modelKey: spec.key });
        modelRegistry.markVerified(spec.key);
        logger.debug('model_request_ok', {
          provider: spec.providerId,
          model: spec.modelId,
          stage,
          latency_ms: latencyMs,
          token: token.masked,
          attempt: attempts
        });
        return {
          response,
          model: spec.modelId,
          provider: spec.providerId,
          modelKey: spec.key,
          category: decision.category,
          fallback: attempts > 1,
          tokenMasked: token.masked,
          stage
        };
      } catch (e) {
        const norm = normalizeError(e) as AiError;
        const latencyMs = Date.now() - startedAt;
        healthMonitor.recordFailure(spec.key, spec.providerId, norm.category);
        tokens.recordFailure(token, norm.category, { modelKey: spec.key });
        lastError = norm;
        logger.warn('model_request_failed', {
          provider: spec.providerId,
          model: spec.modelId,
          stage,
          category: norm.category,
          token: token.masked,
          attempt: attempts,
          latency_ms: latencyMs
        }, norm);
        if (norm.category === 'AUTH_ERROR') {
          logger.warn('model_token_skipped', { provider: spec.providerId, model: spec.modelId, token: token.masked, reason: 'auth_error' });
        }
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'All configured AI models failed.';
  throw lastError instanceof AiError ? lastError : new AiError('UNKNOWN', message);
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return null;
}

export function parseStructured<T extends z.ZodType>(schema: T, text: string, fallback: z.infer<T>): { parsed: z.infer<T>; ok: boolean } {
  const json = extractJson(text);
  if (json !== null) {
    try {
      const result = schema.safeParse(JSON.parse(json));
      if (result.success) return { parsed: result.data, ok: true };
    } catch {
      // fall through to recovery
    }
  }
  return { parsed: fallback, ok: false };
}

export async function structuredWithFallback<T extends z.ZodType>(
  schema: T,
  messages: MessageLike[],
  fallback: z.infer<T>,
  opts: ChatOptions = {}
): Promise<StructuredResult<z.infer<T>>> {
  const result = await chatWithFallback(messages, undefined, { ...opts, temperature: opts.temperature ?? 0.1 });
  const text = result.response.choices[0]?.message?.content ?? '';
  const { parsed, ok } = parseStructured(schema, text, fallback);
  return { value: parsed, model: result.model, provider: result.provider, ok, fallback: result.fallback };
}