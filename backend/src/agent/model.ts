import OpenAI from 'openai';
import { z } from 'zod';
import env from '../lib/config.js';
import { logger } from '../lib/logger.js';

export const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': env.APP_URL,
    'X-Title': 'AgentOS'
  },
  maxRetries: 1
});

const MODEL_TIMEOUT_MS = env.MODEL_TIMEOUT_MS;

export interface ChatModelResult {
  response: OpenAI.Chat.Completions.ChatCompletion;
  model: string;
}

export async function chatWithFallback(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[]
): Promise<ChatModelResult> {
  const models = [env.OPENROUTER_MODEL_PRIMARY, env.OPENROUTER_MODEL_FALLBACK];
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const response = await withTimeout(() =>
        client.chat.completions.create({
          model,
          messages,
          tools,
          tool_choice: tools ? 'auto' : undefined,
          temperature: 0.2,
          max_tokens: 1800
        }),
        MODEL_TIMEOUT_MS
      );
      return { response, model };
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      logger.warn('model_request_failed', { model }, e instanceof Error ? e : undefined);
      if (model === env.OPENROUTER_MODEL_PRIMARY) {
        logger.warn('model_fallback', { from: model, to: env.OPENROUTER_MODEL_FALLBACK, reason: message });
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All configured AI models failed.');
}

async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`AI request timed out after ${ms}ms.`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  fallback: z.infer<T>
): Promise<{ value: z.infer<T>; model: string; ok: boolean }> {
  const { response, model } = await chatWithFallback(messages);
  const text = response.choices[0]?.message?.content ?? '';
  const { parsed, ok } = parseStructured(schema, text, fallback);
  return { value: parsed, model, ok };
}